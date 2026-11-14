/* Offline smoke test: node test/smoke.js
 * Feeds the server a small fixture of real Venice records (no network) and checks
 * the catalogue logic, the pages, the agent endpoints and the MCP tools.
 */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const C = require('../assets/core.js');
const { server, install } = require('../server.js');
const fx = require('./fixture.json');

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + String(err.message).split('\n')[0]); }
}

function request(port, pathname, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: pathname, method: opts.method || 'GET', headers: opts.headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

(async () => {
  const videoPrices = C.parseVideoPrices(fx.pricingMd);
  const rows = C.build(fx.models, videoPrices);
  const row = id => rows.find(r => r.id === id);

  // ---- core ---------------------------------------------------------------
  await test('prices are printed exactly, never rounded', () => {
    assert.strictEqual(C.fmtUsd(12.5), '$12.50');
    assert.strictEqual(C.fmtUsd(0.125), '$0.125');
    assert.strictEqual(C.fmtUsd(0.0001), '$0.0001');
    assert.strictEqual(C.fmtUsd(0.11500000000000002), '$0.115');
    assert.strictEqual(C.fmtUsd(0.1), '$0.10');
    assert.strictEqual(C.fmtUsd(0), '$0');
  });
  await test('text model: in, out and cache rates per 1M tokens', () => {
    const r = row('claude-fable-5-2');
    assert.deepStrictEqual(r.price.cells.map(c => c.k), ['In', 'Out', 'Cache read', 'Cache write']);
    assert.strictEqual(r.price.text, '$8.00 in / $40.00 out per 1M tokens');
    assert.strictEqual(r.provider, 'Anthropic');
    assert.ok(r.ctx > 0 && r.caps.includes('tools'));
  });
  await test('long-context pricing becomes its own table', () => {
    const r = rows.find(x => x.raw.model_spec.pricing && x.raw.model_spec.pricing.extended);
    assert.ok(r.price.tables.some(t => /Long-context/.test(t.title)));
  });
  await test('video price comes from the pricing page; unlisted and by-source are said plainly', () => {
    const v = row('wan-3-0-text-to-video');
    assert.ok(v.price.cells[0].v > 0 && /per second of video/.test(v.price.text));
    assert.strictEqual(row('flux-3-extend-video').price.cells[0].s, 'By source');
    assert.strictEqual(row('seedance-2-5-edit-video-basic').price.cells[0].s, 'Quote');
    assert.strictEqual(row('seedance-2-5-edit-video-basic').price.sort, Infinity);
  });
  await test('every other type has a price line', () => {
    ['venice-sd35', 'seedream-v5-5', 'tts-kokoro', 'ace-step-15', 'elevenlabs-tts-v3', 'nvidia/parakeet-tdt-0.6b-v3', 'firered-image-edit', 'upscaler', 'text-embedding-bge-m3', 'jev-latest']
      .forEach(id => assert.ok(/\$\d/.test(row(id).price.text), id + ': ' + row(id).price.text));
  });
  await test('policy ratings: curated, inferred and API-reported are told apart', () => {
    const v = row('wan-3-0-text-to-video').policy;
    assert.strictEqual(v.kind, 'video');
    assert.ok(['open', 'limited', 'blocked', 'unrated'].includes(v.likeness.state));
    assert.strictEqual(v.voice.source, 'Venice API');
    assert.strictEqual(row('venice-sd35').policy.filter.state, 'open');
  });
  await test('query: type, capability, price ceiling and sort', () => {
    const cheap = C.query(rows, { type: 'text', sort: 'price' });
    assert.ok(cheap.length >= 2 && cheap[0].price.sort <= cheap[1].price.sort);
    assert.ok(C.query(rows, { cap: 'vision,tools' }).every(r => r.caps.includes('vision') && r.caps.includes('tools')));
    assert.ok(C.query(rows, { type: 'text', max_price: 1 }).every(r => r.price.sort <= 1));
    assert.strictEqual(C.query(rows, { q: 'kokoro' })[0].id, 'tts-kokoro');
  });

  // ---- server -------------------------------------------------------------
  install(fx.models, videoPrices, fx.traits, Date.now());
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const get = (p, headers) => request(port, p, { headers });

  await test('home page carries the catalogue inline and nothing blocks it', async () => {
    const r = await get('/');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<script id="boot" type="application/json">'), 'boot data missing');
    assert.ok(r.body.includes('claude-fable-5-2'));
    assert.ok(!/<link[^>]+rel="stylesheet"[^>]+href=/.test(r.body), 'a stylesheet is still loaded by URL');
    assert.ok(!/fonts\.googleapis|gstatic/.test(r.body), 'third-party font request');
    assert.ok(/rel="alternate"/.test(r.headers.link || ''));
  });
  await test('responses are compressed and revalidate with an ETag', async () => {
    const br = await get('/', { 'Accept-Encoding': 'br' });
    assert.strictEqual(br.headers['content-encoding'], 'br');
    const again = await get('/', { 'If-None-Match': br.headers.etag });
    assert.strictEqual(again.status, 304);
  });
  await test('every page is served and none pulls a third-party stylesheet or font', async () => {
    for (const p of ['/chat.html', '/benchmark.html', '/api-guide.html', '/agents.html', '/chat', '/fusion', '/models']) {
      const r = await get(p);
      assert.strictEqual(r.status, 200, p);
      const head = r.body.slice(0, r.body.indexOf('</head>'));
      assert.ok(!/fonts\.googleapis|gstatic/.test(head), p + ' loads a third-party font');
    }
  });
  await test('old addresses redirect', async () => {
    assert.strictEqual((await get('/dashboard.html')).status, 301);
    assert.strictEqual((await get('/index.html')).headers.location, '/');
  });
  await test('private files are not served', async () => {
    for (const p of ['/server.js', '/package.json', '/.git/config', '/test/fixture.json', '/PRODUCT.md', '/assets/../server.js', '/%2e%2e/etc/passwd']) {
      assert.strictEqual((await get(p)).status, 404, p);
    }
  });
  await test('hashed assets are cached for a year', async () => {
    const r = await get('/assets/core.js?v=abc');
    assert.strictEqual(r.status, 200);
    assert.ok(/immutable/.test(r.headers['cache-control']));
  });
  await test('voice clips support Range requests', async () => {
    const r = await get('/assets/voice-clips/tts-kokoro/af_alloy.mp3', { Range: 'bytes=0-99' });
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.headers['content-length'], '100');
  });

  await test('llms.txt indexes the agent endpoints with absolute URLs', async () => {
    const r = await get('/llms.txt', { Host: 'example.test', 'X-Forwarded-Proto': 'https' });
    assert.strictEqual(r.status, 200);
    ['https://example.test/models.md', 'https://example.test/models.json', 'https://example.test/docs/llms.txt', 'https://example.test/openapi.yaml', 'https://example.test/mcp'].forEach(u => assert.ok(r.body.includes(u), u));
    assert.strictEqual(r.headers['access-control-allow-origin'], '*');
  });
  await test('asking the front door for Markdown returns the index, not the app', async () => {
    const r = await get('/', { Accept: 'text/markdown' });
    assert.ok(/^# /.test(r.body) && /text\/markdown/.test(r.headers['content-type']));
  });
  await test('models.md and models.json agree, and filters apply', async () => {
    const md = await get('/models.md');
    assert.ok(md.body.includes('| `claude-fable-5-2` |') && md.body.includes('$40.00'));
    const all = JSON.parse((await get('/models.json')).body);
    assert.strictEqual(all.count, fx.models.length);
    const f = JSON.parse((await get('/models.json?type=text&sort=price&limit=1')).body);
    assert.strictEqual(f.count, 1);
    assert.strictEqual(f.models[0].type, 'text');
    assert.ok(f.models[0].pricing.input.usd >= 0 && typeof f.models[0].price === 'string');
  });
  await test('one model, including an ID with a slash and dots', async () => {
    const md = await get('/models/nvidia/parakeet-tdt-0.6b-v3.md');
    assert.ok(md.status === 200 && md.body.includes('Model ID: `nvidia/parakeet-tdt-0.6b-v3`'));
    const js = JSON.parse((await get('/models/claude-fable-5-2.json')).body);
    assert.strictEqual(js.venice.id, 'claude-fable-5-2');
    const miss = await get('/models/claude-fable.md');
    assert.ok(miss.status === 404 && miss.body.includes('claude-fable-5-2'));
  });
  await test('docs mirror refuses anything that is not a docs path', async () => {
    assert.strictEqual((await get('/docs/..%2f..%2fetc/passwd')).status, 400);
    assert.strictEqual((await get('/docs/page.html')).status, 400);
  });

  const rpc = body => request(port, '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await test('MCP: initialize, list tools, call them', async () => {
    const init = JSON.parse((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })).body);
    assert.strictEqual(init.result.protocolVersion, '2025-06-18');
    assert.strictEqual((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const tools = JSON.parse((await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).body).result.tools.map(t => t.name);
    assert.deepStrictEqual(tools, ['list_models', 'get_model', 'read_venice_docs']);
    const list = JSON.parse((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_models', arguments: { type: 'tts' } } })).body);
    assert.ok(list.result.content[0].text.includes('`tts-kokoro`'));
    const one = JSON.parse((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_model', arguments: { id: 'nope' } } })).body);
    assert.strictEqual(one.result.isError, true);
    const bad = JSON.parse((await rpc({ jsonrpc: '2.0', id: 5, method: 'nope' })).body);
    assert.strictEqual(bad.error.code, -32601);
  });

  server.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
