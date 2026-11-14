/* server.js — the whole back end, no dependencies.
 *
 * What it does, and why it exists instead of a plain static file server:
 *
 *   1. Keeps Venice's model list in memory, refreshed in the background, so the
 *      catalogue is in the first HTML response. No API key, no client fetch, no
 *      spinner: the page arrives with its data.
 *   2. Serves every page as one compressed response with its CSS and JS inlined,
 *      and answers repeat visits with a 304.
 *   3. Gives agents the same catalogue as Markdown, JSON and MCP tools, plus a
 *      cached mirror of Venice's documentation and OpenAPI spec.
 *
 * Run: node server.js   (PORT defaults to 3000)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const os = require('os');
const C = require('./assets/core.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const VENICE_API = 'https://api.venice.ai/api/v1';
const VENICE_DOCS = 'https://docs.venice.ai';
const MODELS_TTL = 5 * 60 * 1000;        // refresh the model list every 5 minutes
const PRICES_TTL = 30 * 60 * 1000;       // video prices come from the docs; they move slowly
const DOCS_TTL = 60 * 60 * 1000;
const SNAPSHOT = path.join(os.tmpdir(), 'multichat-catalog.json');
const SITE_NAME = "V's MultiGen AI Chat";

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|yaml)|image\/svg)/;
const PAGES = { '/': 'index.html', '/models': 'index.html', '/chat': 'chat.html', '/fusion': 'chat.html', '/benchmark': 'benchmark.html', '/api-guide': 'api-guide.html', '/agents': 'agents.html' };
// Only these top-level files are public; everything else in the repo stays private.
const PUBLIC_FILES = new Set(['index.html', 'chat.html', 'benchmark.html', 'api-guide.html', 'agents.html', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'logo.png', 'config.js', 'manifest.webmanifest']);

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------
const cat = { raw: [], videoPrices: {}, traits: {}, rows: [], byId: new Map(), fetchedAt: 0, pricesAt: 0, triedAt: 0, version: '0', error: '' };
let derived = new Map();     // memo of generated bodies, dropped whenever the catalogue changes
let refreshing = null;

async function getText(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms || 15000), headers: { 'User-Agent': 'multichat-catalog/2', 'Accept': '*/*' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).host);
  return r.text();
}

function install(raw, videoPrices, traits, fetchedAt) {
  cat.raw = raw;
  cat.videoPrices = videoPrices || {};
  cat.traits = traits || {};
  cat.rows = C.build(raw, cat.videoPrices);
  cat.byId = new Map(cat.rows.map(r => [r.id.toLowerCase(), r]));
  cat.fetchedAt = fetchedAt;
  const version = crypto.createHash('sha1').update(JSON.stringify(raw)).update(JSON.stringify(cat.videoPrices)).digest('hex').slice(0, 12);
  if (version !== cat.version) { cat.version = version; derived = new Map(); }
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    cat.triedAt = Date.now();
    try {
      const needPrices = !cat.pricesAt || Date.now() - cat.pricesAt > PRICES_TTL;
      const [modelsTxt, traitsTxt, pricingMd] = await Promise.all([
        getText(VENICE_API + '/models?type=all'),
        getText(VENICE_API + '/models/traits').catch(() => ''),
        needPrices ? getText(VENICE_DOCS + '/pricing.md').catch(() => '') : Promise.resolve(''),
      ]);
      const raw = JSON.parse(modelsTxt).data;
      if (!Array.isArray(raw) || !raw.length) throw new Error('Venice returned no models');
      let videoPrices = cat.videoPrices;
      if (pricingMd) {
        const parsed = C.parseVideoPrices(pricingMd);
        if (Object.keys(parsed).length) { videoPrices = parsed; cat.pricesAt = Date.now(); }
      }
      let traits = cat.traits;
      try { if (traitsTxt) traits = JSON.parse(traitsTxt).data || traits; } catch (e) { /* keep the last good set */ }
      install(raw, videoPrices, traits, Date.now());
      cat.error = '';
      fs.writeFile(SNAPSHOT, JSON.stringify({ raw, videoPrices, traits, fetchedAt: cat.fetchedAt }), () => {});
    } catch (err) {
      cat.error = err.message;
      console.warn('[catalog] refresh failed:', err.message);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function loadSnapshot() {
  try {
    const s = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    if (Array.isArray(s.raw) && s.raw.length) install(s.raw, s.videoPrices, s.traits, s.fetchedAt || 0);
  } catch (e) { /* first boot */ }
}

// A request never waits on Venice once there is data; stale data is refreshed behind it.
async function ready(maxWaitMs) {
  if (!cat.raw.length) {
    // Nothing yet (first boot, or Venice is down). Wait a little, not forever,
    // and do not start a new attempt for every request while it stays down.
    const recentlyFailed = cat.error && Date.now() - cat.triedAt < 20000;
    if (!recentlyFailed) {
      const attempt = refresh();
      await (maxWaitMs ? Promise.race([attempt, new Promise(r => setTimeout(r, maxWaitMs))]) : attempt);
    }
  } else if (Date.now() - cat.fetchedAt > MODELS_TTL) refresh();
  return cat.raw.length > 0;
}

// ---------------------------------------------------------------------------
// Responses: compress once, remember, answer conditionals
// ---------------------------------------------------------------------------
function pack(body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const entry = { buf, type, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"' };
  if (COMPRESSIBLE.test(type) && buf.length > 512) {
    entry.br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: buf.length > 600000 ? 6 : 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    entry.gz = zlib.gzipSync(buf, { level: 7 });
  }
  return entry;
}

function memo(key, type, make) {
  let e = derived.get(key);
  if (!e) {
    e = pack(make(), type);
    // Keys include the query string and the Host header, so the memo is bounded.
    if (derived.size >= 500) derived.delete(derived.keys().next().value);
    derived.set(key, e);
  }
  return e;
}

function send(req, res, entry, opts) {
  opts = opts || {};
  const headers = Object.assign({
    'Content-Type': entry.type,
    'ETag': entry.etag,
    'Cache-Control': opts.cache || 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Accept-Encoding' + (opts.vary ? ', ' + opts.vary : ''),
  }, opts.headers);
  if (opts.cors) headers['Access-Control-Allow-Origin'] = '*';
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); return res.end(); }
  const accept = String(req.headers['accept-encoding'] || '');
  let body = entry.buf;
  if (entry.br && /\bbr\b/.test(accept)) { body = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (entry.gz && /\bgzip\b/.test(accept)) { body = entry.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(opts.status || 200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendText(req, res, status, text, type) {
  send(req, res, pack(text, type || 'text/plain; charset=utf-8'), { status, cors: true });
}
function sendJson(req, res, status, obj) {
  send(req, res, pack(JSON.stringify(obj), MIME['.json']), { status, cors: true });
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const fileCache = new Map();   // rel path → { mtimeMs, entry }
const hashCache = new Map();   // rel path → { mtimeMs, hash }

function readPacked(rel) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  const hit = fileCache.get(rel);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.entry;
  const entry = pack(fs.readFileSync(abs), MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream');
  fileCache.set(rel, { mtimeMs: st.mtimeMs, entry });
  return entry;
}

function fileHash(rel) {
  try {
    const st = fs.statSync(path.join(ROOT, rel));
    const hit = hashCache.get(rel);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.hash;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 10);
    hashCache.set(rel, { mtimeMs: st.mtimeMs, hash });
    return hash;
  } catch (e) { return ''; }
}

function publicPath(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath).replace(/^\/+/, ''); } catch (e) { return null; }
  if (!rel || rel.includes('\0') || rel.split('/').some(s => s === '..' || s.startsWith('.'))) return null;
  if (!rel.startsWith('assets/') && !PUBLIC_FILES.has(rel)) return null;
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep)) return null;
  try { if (!fs.statSync(abs).isFile()) return null; } catch (e) { return null; }
  return rel;
}

// Big binaries (the voice clips) are streamed, with Range support so a phone can seek.
function streamFile(req, res, rel) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  const type = MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream';
  const etag = '"' + st.size.toString(36) + '-' + Math.round(st.mtimeMs).toString(36) + '"';
  const headers = { 'Content-Type': type, 'ETag': etag, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  let start = 0, end = st.size - 1, status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
    else start = Math.max(0, st.size - Number(m[2]));
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
    status = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs, { start, end }).on('error', () => res.destroy()).pipe(res);
}

// ---------------------------------------------------------------------------
// Pages: inline the page's own CSS and JS, and hand the catalogue to it
// ---------------------------------------------------------------------------
const LS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const safeJson = obj => JSON.stringify(obj).replace(/</g, '\\u003c').replace(LS, c => '\\u' + c.charCodeAt(0).toString(16));

function bootPayload() {
  return { fetchedAt: cat.fetchedAt, version: cat.version, models: cat.raw, videoPrices: cat.videoPrices, traits: cat.traits };
}

function renderPage(rel) {
  let html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // <link rel="stylesheet" href="assets/x.css" data-inline>  →  <style>…</style>
  html = html.replace(/<link rel="stylesheet" href="(assets\/[\w.\-/]+\.css)" data-inline>/g, (m, f) => {
    try { return '<style>' + fs.readFileSync(path.join(ROOT, f), 'utf8') + '</style>'; } catch (e) { return m; }
  });
  // <script src="assets/x.js" data-inline></script>  →  <script>…</script>
  html = html.replace(/<script src="(assets\/[\w.\-/]+\.js)" data-inline><\/script>/g, (m, f) => {
    try { return '<script>' + fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<\/script/gi, '<\\/script') + '</script>'; } catch (e) { return m; }
  });
  // Anything still loaded by URL gets a content hash, so it can be cached for a year.
  html = html.replace(/((?:href|src)=")(assets\/[\w.\-/]+\.(?:css|js|woff2|png|svg))(")/g, (m, a, f, z) => {
    const h = fileHash(f);
    return h ? a + f + '?v=' + h + z : m;
  });
  html = html.replace(/url\((assets\/[\w.\-/]+\.woff2)\)/g, (m, f) => { const h = fileHash(f); return h ? 'url(' + f + '?v=' + h + ')' : m; });
  if (html.includes('<!--BOOT-->')) {
    html = html.replace('<!--BOOT-->', cat.raw.length ? '<script id="boot" type="application/json">' + safeJson(bootPayload()) + '</script>' : '');
  }
  return html;
}

function pageDeps(rel) {
  // The memo key carries every file the page was built from, so an edit shows up without a restart.
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const deps = [rel].concat((src.match(/assets\/[\w.\-/]+\.(?:css|js)/g) || []));
  return deps.map(f => { try { return fs.statSync(path.join(ROOT, f)).mtimeMs; } catch (e) { return 0; } }).join('.');
}

function servePage(req, res, rel) {
  const entry = memo('page:' + rel + ':' + pageDeps(rel), MIME['.html'], () => renderPage(rel));
  send(req, res, entry, {
    headers: { 'Link': '</llms.txt>; rel="alternate"; type="text/markdown"; title="For agents"' },
  });
}

// ---------------------------------------------------------------------------
// Venice docs mirror
// ---------------------------------------------------------------------------
const mirror = new Map();   // url → { entry, at, pending }
async function mirrored(url, type) {
  const hit = mirror.get(url);
  if (hit && hit.entry && Date.now() - hit.at < DOCS_TTL) return hit.entry;
  if (hit && hit.pending) return hit.entry || hit.pending;
  const pending = getText(url, 20000).then(text => {
    const entry = pack(text, type);
    if (mirror.size > 400) mirror.delete(mirror.keys().next().value);
    mirror.set(url, { entry, at: Date.now(), pending: null });
    return entry;
  }).catch(err => {
    if (hit && hit.entry) { mirror.set(url, { entry: hit.entry, at: Date.now() - DOCS_TTL + 60000, pending: null }); return hit.entry; }
    mirror.delete(url);
    throw err;
  });
  mirror.set(url, { entry: hit && hit.entry, at: hit ? hit.at : 0, pending });
  return (hit && hit.entry) || pending;   // stale-while-revalidate
}

const DOC_PATH = /^[a-z0-9][a-z0-9\-_./]*\.(md|txt|yaml|json)$/i;
function docType(p) {
  return p.endsWith('.yaml') ? 'application/yaml; charset=utf-8' : p.endsWith('.json') ? MIME['.json'] : p.endsWith('.txt') ? MIME['.txt'] : MIME['.md'];
}

// ---------------------------------------------------------------------------
// Agent-facing documents
// ---------------------------------------------------------------------------
function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:' + PORT).split(',')[0].trim();
  return (/^[\w.\-:[\]]+$/.test(host) ? proto + '://' + host : 'http://localhost:' + PORT);
}

function counts() {
  const n = {};
  cat.rows.forEach(r => { n[r.type] = (n[r.type] || 0) + 1; });
  return C.TYPE_ORDER.filter(t => n[t]).map(t => n[t] + ' ' + C.typeLabel(t).toLowerCase()).join(', ');
}
const updatedLine = () => 'Model data read from the Venice API at ' + new Date(cat.fetchedAt).toISOString() + ' (refreshed every 5 minutes).';

function llmsTxt(o) {
  return `# ${SITE_NAME}

> A live catalogue of every model the Venice AI API serves, with its exact model ID, its price, its limits and its content-policy ratings. Everything a person can read on the site, an agent can read here as Markdown or JSON, with no API key and no JavaScript.

${cat.rows.length} models right now: ${counts()}. ${updatedLine()}

## Instructions for agents

- Read model IDs and prices from this site at run time; do not rely on memory. Models are added and retired often.
- Use a model by sending its ID as \`model\` to the Venice API. Base URL: \`${VENICE_API}\`. It is OpenAI-compatible: any OpenAI SDK works with that base URL and a Venice API key as the Bearer token.
- This site never needs a key and never sees one. Calls to the Venice API itself need a key from https://venice.ai/settings/api.
- Prices are US dollars exactly as Venice reports them. Video rates come from Venice's pricing page; \`POST /video/quote\` returns the exact price of a job.
- Content-policy ratings (likeness, NSFW, native audio, filter) are hand-curated by the site's author. "open" means not blocked; it is not a promise that a prompt will render.

## Models and prices

- [All models, Markdown](${o}/models.md): every model ID with price, context and capabilities, grouped by type
- [All models, JSON](${o}/models.json): the same, as records with the raw Venice pricing object
- [One model](${o}/models/claude-fable-5-2.md): \`/models/{id}.md\` or \`/models/{id}.json\` for the full sheet of a single model
- [Filtered list](${o}/models.md?type=text&cap=vision,tools&sort=price): add \`type\`, \`q\`, \`cap\`, \`privacy\`, \`provider\`, \`max_price\`, \`uncensored=1\`, \`sort\` (\`price\`, \`price-desc\`, \`newest\`, \`name\`, \`context\`) and \`limit\` to either list
- [Raw Venice response](${o}/api/catalog.json): the unmodified \`GET /models?type=all\` payload this site is built from, plus video prices and trait defaults
- [Venice pricing page](${o}/docs/pricing.md): Venice's own price tables, mirrored

Types: ${C.TYPE_ORDER.map(t => '`' + t + '` (' + C.typeLabel(t) + ')').join(', ')}.
Capabilities for \`cap\`: ${C.CAPS.map(c => '`' + c.key + '`').join(', ')}.

## Venice API documentation

- [Agent guide to this site and the API](${o}/agents.md): how to pick a model here and call it, with request examples
- [Venice docs index](${o}/docs/llms.txt): every page of the Venice documentation, mirrored from ${VENICE_DOCS}/llms.txt
- [Any Venice docs page as Markdown](${o}/docs/api-reference/endpoint/chat/completions.md): take a docs URL, replace \`${VENICE_DOCS}/\` with \`${o}/docs/\` and end it in \`.md\`
- [OpenAPI specification](${o}/openapi.yaml): the full Venice API schema, mirrored from ${VENICE_DOCS}/swagger.yaml
- [Venice's own agent guide](${o}/docs/agents.md)

## MCP

- [MCP endpoint](${o}/mcp): Streamable HTTP, no key. Tools: \`list_models\`, \`get_model\`, \`read_venice_docs\`
- Venice also runs a docs-search MCP server at ${VENICE_DOCS}/mcp

## Pages for people

- [Model catalogue](${o}/): search, filter, copy a model ID, read its price
- [Chat](${o}/chat.html): run one prompt across several models, needs the visitor's own Venice key
- [Benchmark lab](${o}/benchmark.html): side-by-side model trials, needs the visitor's own Venice key
- [API guide](${o}/api-guide.html): the Venice API explained with examples
- [For agents](${o}/agents.html): this index, as a page
`;
}

function agentsMd(o) {
  const t = cat.traits || {};
  const def = (k, fallback) => t[k] || fallback;
  return `# Agent guide: ${SITE_NAME}

This site is a read-only catalogue of the Venice AI API's models. Use it to choose a model and learn its exact ID and price, then call the Venice API directly. ${updatedLine()}

## 1. Find a model

\`\`\`bash
# Everything, as Markdown tables grouped by type
curl ${o}/models.md

# The five cheapest text models that accept images and call tools
curl "${o}/models.json?type=text&cap=vision,tools&sort=price&limit=5"

# Video models, cheapest first
curl "${o}/models.md?type=video&sort=price"

# One model's full sheet: pricing tables, limits, policy ratings
curl ${o}/models/${def('default', 'venice-uncensored')}.md
\`\`\`

Query parameters, usable on \`/models.md\` and \`/models.json\`:

| Parameter | Meaning |
| - | - |
| \`type\` | ${C.TYPE_ORDER.map(x => '`' + x + '`').join(', ')} |
| \`q\` | Free text matched against ID, name, vendor, capabilities |
| \`cap\` | Comma list, all must match: ${C.CAPS.map(c => '`' + c.key + '`').join(', ')} |
| \`privacy\` | \`private\` (Venice-hosted, zero retention) or \`anonymized\` (proxied to the provider) |
| \`provider\` | Vendor name, for example \`Google\`, \`Anthropic\`, \`Alibaba\` |
| \`max_price\` | Ceiling in USD on the model's headline rate (input price for text, per-unit price otherwise) |
| \`uncensored\` | \`1\` to keep only models Venice marks uncensored |
| \`sort\` | \`newest\` (default), \`price\`, \`price-desc\`, \`name\`, \`context\` |
| \`limit\` | Maximum rows |

Each JSON record carries \`id\`, \`name\`, \`type\`, \`endpoint\`, \`price\` (one readable line), \`pricing\` (Venice's raw object, USD and DIEM), \`privacy\`, \`description\`, and where they apply \`context_tokens\`, \`max_output_tokens\`, \`capabilities\`, \`content_policy\`, \`beta\`, \`offline\`, \`retires\`, \`replacement\`.

## 2. Call the Venice API

Base URL \`${VENICE_API}\`, header \`Authorization: Bearer $VENICE_API_KEY\`. The API follows the OpenAI shape.

\`\`\`bash
curl ${VENICE_API}/chat/completions \\
  -H "Authorization: Bearer $VENICE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${def('default', 'venice-uncensored')}", "messages": [{"role": "user", "content": "Hello"}]}'
\`\`\`

| Model type | Endpoint |
| - | - |
${C.TYPE_ORDER.map(x => '| ' + C.typeLabel(x) + ' (`' + x + '`) | `' + C.TYPE_META[x].endpoint + '` |').join('\n')}

Venice's current defaults (from \`GET /models/traits\`): ${Object.keys(t).length ? Object.keys(t).map(k => k + ' = `' + t[k] + '`').join(', ') : 'unavailable right now'}.

Things that differ from OpenAI and are worth knowing:

- Venice-only options go in \`venice_parameters\` on a chat request, for example \`{"enable_web_search": "on"}\` or \`{"include_venice_system_prompt": false}\`.
- Video and music are asynchronous: queue a job, then poll. Quote first with \`POST /video/quote\` or \`POST /audio/quote\`.
- A key is created at https://venice.ai/settings/api. An agent with a wallet can instead pay per request over x402, with no account.
- \`402\` means the balance cannot cover the request; \`429\` means a rate limit, see \`GET /api_keys/rate_limits\`.

## 3. Read the documentation

- Index of every Venice docs page: ${o}/docs/llms.txt
- Any page as Markdown: \`${o}/docs/{path}.md\`, for example ${o}/docs/api-reference/endpoint/image/generate.md
- OpenAPI spec: ${o}/openapi.yaml
- Pricing tables: ${o}/docs/pricing.md
- Venice's own agent guide: ${o}/docs/agents.md

These are cached copies of ${VENICE_DOCS}, refreshed hourly. The originals are authoritative.

## 4. MCP

\`${o}/mcp\` speaks MCP over Streamable HTTP with no authentication.

| Tool | Arguments | Returns |
| - | - | - |
| \`list_models\` | \`type\`, \`q\`, \`cap\`, \`privacy\`, \`provider\`, \`max_price\`, \`uncensored\`, \`sort\`, \`limit\` | Matching models with ID and price, as a Markdown table |
| \`get_model\` | \`id\` | One model's full sheet |
| \`read_venice_docs\` | \`path\` (omit for the index) | A Venice documentation page as Markdown |

## Ground rules

- Read-only: nothing here accepts a key, and no endpoint changes state.
- Prices are quoted in US dollars exactly as Venice reports them, never rounded.
- Policy ratings are the site author's curated reading of provider policy. Treat "open" as "not blocked", and an "inferred" rating as a prior to confirm.
`;
}

function filterFrom(q) {
  const f = {};
  ['type', 'q', 'cap', 'privacy', 'provider', 'sort'].forEach(k => { if (q.get(k)) f[k] = q.get(k); });
  if (q.get('max_price')) f.max_price = Number(q.get('max_price'));
  if (/^(1|true|yes)$/i.test(q.get('uncensored') || '')) f.uncensored = true;
  if (f.sort === 'newest') delete f.sort;
  return f;
}
function limited(rows, q) {
  const n = parseInt(q.get('limit') || '', 10);
  return n > 0 ? rows.slice(0, n) : rows;
}

function modelsDoc(o, q) {
  const f = filterFrom(q);
  const rows = limited(C.query(cat.rows, f), q);
  const filtered = Object.keys(f).length || q.get('limit');
  let table = C.modelsMarkdown(rows);
  // A sorted or limited request should come back in that order, not regrouped alphabetically.
  if (f.sort || q.get('limit')) {
    table = '| Model ID | Name | Type | Price | Context | Privacy |\n| - | - | - | - | - | - |\n' +
      rows.map(r => '| `' + r.id + '` | ' + r.name.replace(/\|/g, '\\|') + ' | ' + r.type + ' | ' + (r.price.text || '—') + ' | ' + C.fmtTokens(r.ctx) + ' | ' + r.privacy + ' |').join('\n') + '\n';
  }
  return `# Venice AI models${filtered ? ' (filtered)' : ''}

${rows.length} model${rows.length === 1 ? '' : 's'}${filtered ? ' matching ' + (q.toString() || 'the request') : ''}. Prices in US dollars as reported by Venice. ${updatedLine()}

Pass the Model ID as \`model\` to \`${VENICE_API}\`. Full sheet for one model: \`${o}/models/{id}.md\`. Filters and JSON: ${o}/agents.md

${table}`;
}

function modelsJson(o, q) {
  const rows = limited(C.query(cat.rows, filterFrom(q)), q);
  return { updated: new Date(cat.fetchedAt).toISOString(), source: VENICE_API + '/models?type=all', api_base_url: VENICE_API, docs: o + '/agents.md', count: rows.length, models: rows.map(C.agentRecord) };
}

// ---------------------------------------------------------------------------
// MCP — Streamable HTTP, stateless, tools only
// ---------------------------------------------------------------------------
const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MCP_TOOLS = [
  {
    name: 'list_models',
    description: 'List Venice AI models with their exact model ID and price. Filter by type, capability, vendor, privacy tier or price ceiling. Returns a Markdown table.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: C.TYPE_ORDER, description: 'Model type' },
        q: { type: 'string', description: 'Free text matched against ID, name, vendor and capabilities' },
        cap: { type: 'string', description: 'Comma-separated capabilities that must all be present: ' + C.CAPS.map(c => c.key).join(', ') },
        privacy: { type: 'string', enum: ['private', 'anonymized'] },
        provider: { type: 'string', description: 'Vendor name, e.g. Google, Anthropic, Alibaba' },
        max_price: { type: 'number', description: 'Ceiling in USD on the headline rate (input price per 1M tokens for text; per-unit price otherwise)' },
        uncensored: { type: 'boolean' },
        sort: { type: 'string', enum: ['newest', 'price', 'price-desc', 'name', 'context'] },
        limit: { type: 'integer', minimum: 1, description: 'Maximum rows (default 50)' },
      },
    },
  },
  {
    name: 'get_model',
    description: 'Full sheet for one Venice AI model: every price, limits, capabilities, voices and content-policy ratings.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Exact model ID, e.g. claude-fable-5-2' } }, required: ['id'] },
  },
  {
    name: 'read_venice_docs',
    description: 'Read a page of the Venice API documentation as Markdown. Omit path for the index of all pages. Use "swagger.yaml" for the OpenAPI spec and "pricing" for the price tables.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Docs path, e.g. api-reference/endpoint/chat/completions' } } },
  },
];

async function mcpCall(name, args, o) {
  args = args || {};
  await ready();
  if (name === 'list_models') {
    const q = new URLSearchParams();
    Object.keys(args).forEach(k => { if (args[k] !== undefined && args[k] !== null && args[k] !== '') q.set(k, args[k] === true ? '1' : String(args[k])); });
    if (!q.get('limit')) q.set('limit', '50');
    return modelsDoc(o, q);
  }
  if (name === 'get_model') {
    const row = cat.byId.get(String(args.id || '').toLowerCase());
    if (!row) {
      const near = C.query(cat.rows, { q: String(args.id || '').replace(/[-_/.]+/g, ' ') }).slice(0, 8).map(r => r.id);
      throw new Error('No model with ID "' + args.id + '".' + (near.length ? ' Close matches: ' + near.join(', ') : ' Use list_models to search.'));
    }
    return C.modelMarkdown(row);
  }
  if (name === 'read_venice_docs') {
    let p = String(args.path || 'llms.txt').replace(/^https?:\/\/docs\.venice\.ai\//i, '').replace(/^\/+/, '').replace(/[#?].*$/, '');
    if (p === 'pricing') p = 'pricing.md';
    if (!/\.(md|txt|yaml|json)$/i.test(p)) p += '.md';
    if (!DOC_PATH.test(p) || p.includes('..')) throw new Error('Not a docs path: ' + args.path);
    const entry = await mirrored(VENICE_DOCS + '/' + p, docType(p));
    const text = entry.buf.toString('utf8');
    return text.length > 200000 ? text.slice(0, 200000) + '\n\n[Truncated. Fetch ' + o + '/docs/' + p + ' for the whole file.]' : text;
  }
  throw new Error('Unknown tool: ' + name);
}

async function mcpHandle(msg, o) {
  const isRequest = msg && Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== null;
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: isRequest ? msg.id : null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (!isRequest) return null;   // notifications get no reply
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      return ok({
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'multichat-venice-catalog', title: SITE_NAME, version: '2.0.0' },
        instructions: 'Read-only catalogue of Venice AI models. Use list_models to find a model ID and price, get_model for one model in full, read_venice_docs for the Venice API documentation. Call the Venice API itself at ' + VENICE_API + ' with your own key.',
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: MCP_TOOLS });
    case 'tools/call': {
      const p = msg.params || {};
      if (!MCP_TOOLS.some(t => t.name === p.name)) return fail(-32602, 'Unknown tool: ' + p.name);
      try { return ok({ content: [{ type: 'text', text: await mcpCall(p.name, p.arguments, o) }] }); }
      catch (err) { return ok({ content: [{ type: 'text', text: err.message }], isError: true }); }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return fail(-32601, 'Method not found: ' + msg.method);
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveMcp(req, res, o) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET' && /text\/html/.test(req.headers.accept || '')) { res.writeHead(302, { Location: '/agents.html#mcp' }); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, Object.assign({ 'Allow': 'POST, OPTIONS', 'Content-Type': MIME['.json'] }, cors));
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'This MCP endpoint is stateless: POST JSON-RPC messages to it. See ' + o + '/agents.md' } }));
  }
  let payload;
  try { payload = JSON.parse(await readBody(req, 256 * 1024)); }
  catch (e) {
    res.writeHead(400, Object.assign({ 'Content-Type': MIME['.json'] }, cors));
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
  }
  const batch = Array.isArray(payload);
  const replies = (await Promise.all((batch ? payload : [payload]).map(m => mcpHandle(m, o)))).filter(Boolean);
  if (!replies.length) { res.writeHead(202, cors); return res.end(); }
  res.writeHead(200, Object.assign({ 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }, cors));
  res.end(JSON.stringify(batch ? replies : replies[0]));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const o = originOf(req);

  if (p === '/mcp') return serveMcp(req, res, o);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' }); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }); return res.end(); }

  if (p === '/healthz') return sendJson(req, res, 200, { ok: true, models: cat.rows.length, fetchedAt: cat.fetchedAt, error: cat.error || undefined });
  if (p === '/dashboard' || p === '/dashboard.html' || p === '/index.html') { res.writeHead(301, { Location: '/' + url.search }); return res.end(); }

  // ---- pages --------------------------------------------------------------
  if (p === '/' && !url.search) {
    // An agent that asks for Markdown at the front door gets the index, not an app shell.
    const accept = String(req.headers.accept || '');
    if (/text\/(markdown|plain)/.test(accept) && !/text\/html/.test(accept)) {
      await ready();
      return send(req, res, memo('llms:' + o, MIME['.md'], () => llmsTxt(o)), { cors: true, vary: 'Accept' });
    }
  }
  const page = PAGES[p] || (p.endsWith('.html') && PUBLIC_FILES.has(p.slice(1)) ? p.slice(1) : null);
  if (page) {
    // If Venice is slow on a cold start, send the shell anyway: the page fetches the list itself.
    if (page === 'index.html') await ready(2500);
    return servePage(req, res, page);
  }

  // ---- agent documents ----------------------------------------------------
  if (p === '/robots.txt') return sendText(req, res, 200, 'User-agent: *\nAllow: /\n\n# Agents: start at ' + o + '/llms.txt\nSitemap: ' + o + '/sitemap.xml\n');
  if (p === '/sitemap.xml') {
    const locs = ['/', '/chat.html', '/benchmark.html', '/api-guide.html', '/agents.html', '/llms.txt', '/agents.md', '/models.md'];
    return sendText(req, res, 200, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + locs.map(l => '  <url><loc>' + o + l + '</loc></url>').join('\n') + '\n</urlset>\n', 'application/xml; charset=utf-8');
  }

  const needsCatalog = p === '/llms.txt' || p === '/.well-known/llms.txt' || p === '/llms-full.txt' || p === '/agents.md' || p.startsWith('/models') || p.startsWith('/api/');
  if (needsCatalog && !(await ready())) return sendText(req, res, 503, 'The Venice model list is unavailable right now (' + (cat.error || 'no data yet') + '). Try again shortly, or read ' + VENICE_API + '/models?type=all directly.\n');

  const short = { cors: true, cache: 'public, max-age=60, stale-while-revalidate=600' };
  if (p === '/llms.txt' || p === '/.well-known/llms.txt') return send(req, res, memo('llms:' + o, MIME['.md'], () => llmsTxt(o)), short);
  if (p === '/agents.md') return send(req, res, memo('agents:' + o, MIME['.md'], () => agentsMd(o)), short);
  if (p === '/llms-full.txt') return send(req, res, memo('full:' + o, MIME['.md'], () => llmsTxt(o) + '\n---\n\n' + agentsMd(o) + '\n---\n\n' + modelsDoc(o, new URLSearchParams())), short);
  if (p === '/models.md') return send(req, res, memo('md:' + o + '?' + url.searchParams.toString(), MIME['.md'], () => modelsDoc(o, url.searchParams)), short);
  if (p === '/models.json' || p === '/api/models') return send(req, res, memo('json:' + o + '?' + url.searchParams.toString(), MIME['.json'], () => JSON.stringify(modelsJson(o, url.searchParams))), short);
  if (p === '/api/catalog.json') return send(req, res, memo('catalog', MIME['.json'], () => JSON.stringify(bootPayload())), short);

  if (p.startsWith('/models/') || p.startsWith('/api/models/')) {
    let id;
    try { id = decodeURIComponent(p.replace(/^\/(api\/)?models\//, '')); } catch (e) { id = ''; }
    const asJson = p.startsWith('/api/') || id.endsWith('.json');
    const row = cat.byId.get(id.toLowerCase()) || cat.byId.get(id.replace(/\.(md|json|txt)$/i, '').toLowerCase());
    if (!row) {
      const near = C.query(cat.rows, { q: id.replace(/\.(md|json|txt)$/i, '').replace(/[-_/.]+/g, ' ') }).slice(0, 8).map(r => r.id);
      return sendText(req, res, 404, 'No model with that ID.' + (near.length ? ' Close matches: ' + near.join(', ') + '.' : '') + ' Full list: ' + o + '/models.md\n');
    }
    if (asJson) return send(req, res, memo('one.json:' + row.id, MIME['.json'], () => JSON.stringify(Object.assign(C.agentRecord(row), { facts: Object.fromEntries(row.facts), voices: row.voices && row.voices.length ? row.voices : undefined, venice: row.raw }))), short);
    return send(req, res, memo('one.md:' + row.id, MIME['.md'], () => C.modelMarkdown(row) + '\nSource: ' + VENICE_API + '/models · ' + updatedLine() + '\n'), short);
  }

  // ---- Venice docs mirror -------------------------------------------------
  if (p === '/openapi.yaml' || p === '/pricing.md' || p === '/docs' || p.startsWith('/docs/')) {
    const dp = p === '/openapi.yaml' ? 'swagger.yaml' : p === '/pricing.md' ? 'pricing.md' : p === '/docs' ? 'llms.txt' : p.slice(6);
    if (!DOC_PATH.test(dp) || dp.includes('..')) return sendText(req, res, 400, 'Docs paths end in .md, .txt, .yaml or .json, for example ' + o + '/docs/api-reference/endpoint/chat/completions.md\n');
    try { return send(req, res, await mirrored(VENICE_DOCS + '/' + dp, docType(dp)), { cors: true, cache: 'public, max-age=600, stale-while-revalidate=3600', headers: { 'X-Mirrored-From': VENICE_DOCS + '/' + dp } }); }
    catch (err) { return sendText(req, res, 502, 'Could not fetch ' + VENICE_DOCS + '/' + dp + ' (' + err.message + ').\n'); }
  }

  // ---- static files -------------------------------------------------------
  const rel = publicPath(p);
  if (rel) {
    const ext = path.extname(rel).toLowerCase();
    if (ext === '.wav' || ext === '.mp3') return streamFile(req, res, rel);
    const versioned = url.searchParams.has('v');
    return send(req, res, readPacked(rel), { cache: versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' });
  }

  sendText(req, res, 404, 'Not found. Pages: /, /chat.html, /benchmark.html, /api-guide.html, /agents.html. For agents: /llms.txt\n');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error('[server]', req.url, err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal error\n');
  });
});
server.keepAliveTimeout = 65000;

if (require.main === module) {
  loadSnapshot();
  refresh();
  setInterval(refresh, MODELS_TTL).unref();
  server.listen(PORT, () => console.log(SITE_NAME + ' listening on :' + PORT));
}

module.exports = { server, cat, refresh, install };
