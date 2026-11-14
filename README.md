# V's MultiGen AI Chat

A fast, phone-first front end for the Venice AI API.

- **Models** (`/`): every model Venice serves, with its exact model ID one tap from the clipboard and its price next to it. Search, filter, sort, and open a sheet with every rate, limit and content-policy rating. No API key needed.
- **Chat** (`/chat.html`): one prompt across several models, Fusion, images, batch runs. Uses the visitor's own Venice key, kept in their browser.
- **Benchmark** (`/benchmark.html`): side-by-side model trials with an AI judge.
- **API guide** (`/api-guide.html`): the Venice API with copyable requests.
- **For agents** (`/agents.html`): the same catalogue and the Venice docs as Markdown, JSON and MCP.

## Run it

```bash
node server.js          # http://localhost:3000, PORT overrides
npm test                # offline smoke tests
```

Node 18 or newer, no dependencies, no build step. Railway runs `node server.js` (see `railway.toml`); the health check is `/healthz`.

## How it is fast

`server.js` keeps Venice's public model list in memory and refreshes it every five minutes in the background. A page request never waits on Venice.

- The catalogue's HTML arrives with its CSS, its JavaScript and the model data inside it, compressed with Brotli: one request, about 70 KB, and the first paint is the model list.
- Repeat visits revalidate with an ETag and usually get a 304.
- System fonts only. The icon font used by the chat and benchmark pages is served from this site and cached for a year.
- Nothing is loaded from a third party.

Served as plain files instead (Netlify, `python -m http.server`), the catalogue still works: it reads the public Venice model list from the browser. The agent endpoints below need the server.

## For agents

Everything is read-only, needs no key, and sends `Access-Control-Allow-Origin: *`.

| Path | What it is |
| - | - |
| `/llms.txt` | Index of everything below. Also returned for `GET /` with `Accept: text/markdown` |
| `/agents.md` | How to pick a model here and call it on the Venice API |
| `/models.md`, `/models.json` | Every model with ID and price. Filters: `type`, `q`, `cap`, `privacy`, `provider`, `max_price`, `uncensored`, `sort`, `limit` |
| `/models/{id}.md`, `/models/{id}.json` | One model in full |
| `/api/catalog.json` | The raw Venice `GET /models?type=all` payload, plus video prices |
| `/docs/llms.txt`, `/docs/{path}.md` | Venice's documentation, mirrored and cached for an hour |
| `/openapi.yaml` | Venice's OpenAPI spec, mirrored |
| `/mcp` | MCP over Streamable HTTP: `list_models`, `get_model`, `read_venice_docs` |

## Layout

```
server.js            the whole back end
index.html           catalogue          assets/catalog.js, assets/catalog.css
agents.html          agent endpoints
api-guide.html       API guide          assets/guide.css
chat.html            chat, Fusion, images, batch (self-contained)
benchmark.html       benchmark lab (self-contained)
assets/core.js       shared by browser and server: pricing, policy ratings, filters, Markdown
assets/base.css      design tokens and the shared chrome (top bar, phone tab bar)
assets/app.css       components for the pages built on the shared system
assets/app.js        shell, theme, copy-to-clipboard, Back-button layers
assets/skin.css      maps the chat's and benchmark's own token names onto the shared ones
test/smoke.js        offline tests against test/fixture.json
```

## Things worth knowing

- **Prices are never rounded.** `core.js` prints what Venice reports. Video rates are not on `/models`; they are parsed from Venice's pricing page and marked as such, and a model with no listed rate says "Quote".
- **Policy ratings are curated by hand** in `assets/core.js` (`VIDEO_POLICY`, `IMAGE_POLICY`). "Open" means not blocked, never a promise. A rating derived from the privacy tier is marked inferred. Re-check the tables when Venice adds a model family.
- **Back stays inside the app.** Opening a model, the filter sheet, a tab, a benchmark suite or any overlay in the chat adds one history entry, and Back undoes exactly that step before it leaves the page.
- **The API key** is only ever used by the chat and benchmark pages, straight from the browser to Venice. The server never sees one.
