/* catalog.js — the model catalogue.
 *
 * The page arrives with the model list already in it (a JSON block the server
 * writes into the HTML), so the first paint is the catalogue, not a spinner.
 * Everything the visitor does is reflected in the URL and in the browser
 * history: Back closes a sheet or returns to the previous tab before it ever
 * leaves the site.
 */
(function () {
  'use strict';
  var C = window.VCore, A = window.VApp, esc = A.esc, icon = A.icon;
  var $ = function (id) { return document.getElementById(id); };
  var VENICE = 'https://api.venice.ai/api/v1';
  var CACHE_KEY = 'mc_catalog_v2';
  var CLIP_EXT = { 'tts-chatterbox-hd': 'wav', 'tts-gradium-v1': 'wav', 'tts-inworld-1-5-max': 'wav', 'tts-orpheus': 'wav', 'tts-elevenlabs-turbo-v2-5': 'mp3', 'tts-gemini-3-1-flash': 'mp3', 'tts-kokoro': 'mp3', 'tts-minimax-speech-02-hd': 'mp3', 'tts-qwen3-0-6b': 'mp3', 'tts-qwen3-1-7b': 'mp3', 'tts-xai-v1': 'mp3' };
  var SORTS = [['newest', 'Newest'], ['price', 'Cheapest'], ['price-desc', 'Priciest'], ['name', 'Name A–Z'], ['context', 'Largest context']];
  var FLAGS = [
    { key: 'uncensored', label: 'Uncensored', test: function (r) { return r.uncensored; } },
    { key: 'recommended', label: 'Venice pick', test: function (r) { return r.recommended; } },
    { key: 'beta', label: 'Beta', test: function (r) { return r.beta; } },
    { key: 'online', label: 'Hide offline', test: function (r) { return !r.offline; } },
  ];
  // A policy filter value → the ratings it lets through.
  var POL_OPTS = {
    rated: [['allowed', 'Allowed', ['open', 'limited']], ['open', 'Open', ['open']], ['limited', 'Limited', ['limited']], ['blocked', 'Blocked', ['blocked']]],
    yesno: [['yes', 'Yes', ['open']], ['no', 'No', ['blocked']]],
  };
  var POL_KIND = { likeness: 'rated', nsfw: 'rated', voice: 'yesno', filter: 'yesno' };
  var POL_LABEL = { likeness: 'Likeness / IP', nsfw: 'Adult / NSFW', voice: 'Native audio', filter: 'No provider filter' };

  var rows = [], byId = {}, fetchedAt = 0, version = '';
  var S = blank();
  var nodes = {};          // id → rendered card
  var renderToken = 0;
  var audio = null, audioBtn = null;

  function blank() { return { type: 'all', q: '', sort: 'newest', caps: {}, flags: {}, privacy: '', provider: '', mode: '', pol: {} }; }

  // ------------------------------------------------------------------ data
  function install(payload, from) {
    if (!payload || !payload.models || !payload.models.length) return false;
    if (payload.version && payload.version === version) { fetchedAt = payload.fetchedAt || fetchedAt; stamp(); return true; }
    rows = C.build(payload.models, payload.videoPrices || {});
    byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    fetchedAt = payload.fetchedAt || Date.now();
    version = payload.version || String(fetchedAt);
    nodes = {};
    if (from !== 'cache') { try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (e) { /* too big or blocked: fine */ } }
    return true;
  }

  function fromServer() {
    return fetch('api/catalog.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  // No server behind the page (plain static hosting): read Venice directly. The
  // model list is public, so this still needs no key.
  function fromVenice() {
    return Promise.all([
      fetch(VENICE + '/models?type=all').then(function (r) { if (!r.ok) throw new Error('Venice returned HTTP ' + r.status); return r.json(); }),
      fetch('https://docs.venice.ai/pricing.md').then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }),
    ]).then(function (res) {
      return { fetchedAt: Date.now(), version: '', models: res[0].data, videoPrices: res[1] ? C.parseVideoPrices(res[1]) : {} };
    });
  }
  function refresh(quiet) {
    return fromServer().catch(fromVenice).then(function (p) {
      var before = version;
      if (install(p) && version !== before) { apply(); if (quiet && before) A.toast('Model list updated'); }
      return true;
    });
  }

  // ------------------------------------------------------------------ URL ⇄ state
  function readUrl() {
    var q = new URLSearchParams(location.search), s = blank();
    s.type = q.get('type') || 'all';
    s.q = q.get('q') || '';
    s.sort = SORTS.some(function (x) { return x[0] === q.get('sort'); }) ? q.get('sort') : 'newest';
    (q.get('cap') || '').split(',').forEach(function (c) { if (C.CAP_BY_KEY[c]) s.caps[c] = 1; });
    (q.get('flag') || '').split(',').forEach(function (f) { if (FLAGS.some(function (x) { return x.key === f; })) s.flags[f] = 1; });
    s.privacy = q.get('privacy') || '';
    s.provider = q.get('provider') || '';
    s.mode = q.get('mode') || '';
    Object.keys(POL_KIND).forEach(function (k) { if (q.get(k)) s.pol[k] = q.get(k); });
    return s;
  }
  function urlFor(s, hash) {
    var q = new URLSearchParams();
    if (s.type !== 'all') q.set('type', s.type);
    if (s.q) q.set('q', s.q);
    if (s.sort !== 'newest') q.set('sort', s.sort);
    var caps = Object.keys(s.caps); if (caps.length) q.set('cap', caps.join(','));
    var flags = Object.keys(s.flags); if (flags.length) q.set('flag', flags.join(','));
    if (s.privacy) q.set('privacy', s.privacy);
    if (s.provider) q.set('provider', s.provider);
    if (s.mode) q.set('mode', s.mode);
    Object.keys(s.pol).forEach(function (k) { q.set(k, s.pol[k]); });
    var qs = q.toString();
    return location.pathname + (qs ? '?' + qs : '') + (hash || '');
  }
  // push = a step the Back button should undo (a tab, a sheet); otherwise the
  // current entry is rewritten, so typing in the search box never piles up history.
  function go(s, hash, push) {
    var url = urlFor(s, hash);
    try {
      if (push) history.pushState({ mc: 1 }, '', url);
      else history.replaceState(history.state, '', url);
    } catch (e) { /* sandboxed frame */ }
    apply();
  }
  // A sheet is opened by an ordinary fragment navigation (#m/<id>, #filters),
  // the same thing a plain in-page link does. Every browser, and every in-app
  // browser, records that as a history entry, so Back closes the sheet.
  var sheetsOpened = 0;
  function openSheet(hash) {
    if (location.hash === hash) { apply(); return; }
    sheetsOpened++;
    location.hash = hash;          // fires hashchange → apply()
  }
  function closeSheet() {
    if (sheetsOpened > 0) history.back();                        // we opened it: step back (popstate keeps count)
    else go(S, '', false);                                       // arrived by deep link: just clear it
  }

  // ------------------------------------------------------------------ filtering
  function polPass(r, key, val) {
    var opt = (POL_OPTS[POL_KIND[key]] || []).filter(function (o) { return o[0] === val; })[0];
    if (!opt) return true;
    return !!(r.policy && r.policy[key] && opt[2].indexOf(r.policy[key].state) !== -1);
  }
  function matches(r, s, skip) {
    if (s.type !== 'all' && r.type !== s.type) return false;
    if (s.q) {
      var terms = s.q.toLowerCase().split(/\s+/);
      for (var i = 0; i < terms.length; i++) if (terms[i] && r.hay.indexOf(terms[i]) === -1) return false;
    }
    for (var c in s.caps) if (skip !== 'cap:' + c && r.caps.indexOf(c) === -1) return false;
    for (var f = 0; f < FLAGS.length; f++) if (s.flags[FLAGS[f].key] && skip !== 'flag:' + FLAGS[f].key && !FLAGS[f].test(r)) return false;
    if (s.privacy && skip !== 'privacy' && r.privacy !== s.privacy) return false;
    if (s.provider && skip !== 'provider' && r.provider !== s.provider) return false;
    if (s.mode && skip !== 'mode' && r.mode !== s.mode) return false;
    for (var k in s.pol) if (skip !== 'pol:' + k && !polPass(r, k, s.pol[k])) return false;
    return true;
  }
  function visible() { return C.sortRows(rows.filter(function (r) { return matches(r, S); }), S.sort); }
  // How many models an option would leave standing, given everything else that is set.
  function countIf(skip, test) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) if (matches(rows[i], S, skip) && test(rows[i])) n++;
    return n;
  }
  function activeFilterCount() {
    return Object.keys(S.caps).length + Object.keys(S.flags).length + Object.keys(S.pol).length + (S.privacy ? 1 : 0) + (S.provider ? 1 : 0) + (S.mode ? 1 : 0);
  }

  // ------------------------------------------------------------------ cards
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000), now = new Date();
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + (d.getUTCFullYear() !== now.getUTCFullYear() ? ', ' + d.getUTCFullYear() : '');
  }
  function isNew(r) { return r.created && (fetchedAt / 1000 - r.created) < 14 * 86400; }
  function mark(r, size) {
    return r.mark
      ? '<img class="mark" src="assets/providers/' + r.mark + '-48.png" alt="" width="' + size + '" height="' + size + '" loading="lazy" decoding="async">'
      : '<span class="mark none" aria-hidden="true">' + esc((r.provider || r.name).charAt(0).toUpperCase()) + '</span>';
  }
  function tags(r) {
    var t = '';
    if (isNew(r)) t += '<span class="tag new">New</span>';
    if (r.offline) t += '<span class="tag bad">Offline</span>';
    if (r.retires) t += '<span class="tag warn">Retiring</span>';
    if (r.beta) t += '<span class="tag mute">Beta</span>';
    return t;
  }
  function subline(r) {
    var bits = [];
    if (r.provider) bits.push(r.provider);
    if (r.type === 'video' && r.mode) bits.push(r.mode);   // the type itself is the coloured tag below
    if (r.ctx) bits.push(C.fmtTokens(r.ctx) + (r.type === 'embedding' ? ' in' : ' ctx'));
    if (r.voices && r.voices.length) bits.push(r.voices.length + ' voices');
    bits.push(shortDate(r.created));
    return bits.filter(Boolean).join(' · ');
  }
  function priceCells(r, max) {
    var cells = r.price.cells.slice(0, max || 9);
    if (!cells.length) return '<span class="pc"><b>—</b><span>Not listed</span></span>';
    return cells.map(function (c) {
      return '<span class="pc' + (c.s ? ' soft' : '') + '"><b>' + esc(C.cellText(c)) + '</b><span>' + esc(c.k) + '</span></span>';
    }).join('');
  }
  var POL_TAG = { open: 'ok', limited: 'warn', blocked: 'bad', unrated: 'mute' };
  // One hue per model type and per capability, so a card can be told apart
  // before a word of it is read. The colours themselves live in catalog.css.
  var TYPE_HUE = { text: 245, image: 212, video: 22, tts: 150, music: 335, asr: 44, inpaint: 275, upscale: 190, embedding: 172, decision: 300 };
  var CAP_HUE = { vision: 212, reasoning: 275, tools: 22, web: 190, code: 150, schema: 245, audio: 335, video: 44, xsearch: 200, tee: 172, e2ee: 160, logprobs: 300 };
  function hueTag(hue, label, extra) {
    return hue === undefined ? '<span class="tag' + (extra || '') + '">' + esc(label) + '</span>'
      : '<span class="tag hue' + (extra || '') + '" style="--h:' + hue + '">' + esc(label) + '</span>';
  }
  function typeTag(r) { return hueTag(TYPE_HUE[r.type], C.typeLabel(r.type), ' type'); }
  function chipsFor(r) {
    var out = typeTag(r);
    if (r.type === 'text') {
      out += r.caps.slice(0, 6).map(function (k) { return hueTag(CAP_HUE[k], C.CAP_BY_KEY[k].label); }).join('');
      if (r.caps.length > 6) out += '<span class="tag mute">+' + (r.caps.length - 6) + '</span>';
    } else if (r.policy) {
      out += (C.POLICY_AXES[r.policy.kind] || []).map(function (a) {
        var v = r.policy[a.key];
        return '<span class="tag ' + POL_TAG[v.state] + (v.inferred ? ' dashed' : '') + '">' + C.axisText(a.key, v.state, a.short) + '</span>';
      }).join('');
    }
    if (r.uncensored) out += '<span class="tag accent">Uncensored</span>';
    if (r.privacy === 'private') out += '<span class="tag">Private</span>';
    return out;
  }
  function cardHtml(r) {
    var href = '#m/' + esc(encodeURIComponent(r.id));
    return '<a class="m-head" href="' + href + '" data-open="' + esc(r.id) + '">' + mark(r, 22) +
        '<span class="m-name">' + esc(r.name) + '</span><span class="m-tags">' + tags(r) + '</span>' +
        '<span class="m-sub">' + esc(subline(r)) + '</span>' + icon('chevron', 'sm m-go') + '</a>' +
      '<button class="copy" type="button" data-copy="' + esc(r.id) + '" aria-label="Copy model ID ' + esc(r.id) + '"><code>' + esc(r.id) + '</code><span class="copy-cta">' + icon('copy', 'sm') + 'Copy</span></button>' +
      '<a class="m-price" href="' + href + '" data-open="' + esc(r.id) + '" aria-label="Price: ' + esc(r.price.text || 'not listed') + '">' + priceCells(r, 3) + '<span class="unit">' + esc(r.price.unit) + '</span></a>' +
      '<div class="m-chips">' + chipsFor(r) + '</div>';
  }
  function node(r) {
    var n = nodes[r.id];
    if (!n) {
      n = document.createElement('article');
      n.className = 'm' + (r.offline ? ' off' : '');
      n.innerHTML = cardHtml(r);
      nodes[r.id] = n;
    }
    return n;
  }

  // ------------------------------------------------------------------ rendering
  function renderTabs() {
    var counts = { all: 0 };
    var s2 = Object.assign({}, S, { type: 'all' });
    rows.forEach(function (r) { if (matches(r, s2)) { counts.all++; counts[r.type] = (counts[r.type] || 0) + 1; } });
    var types = ['all'].concat(C.TYPE_ORDER.filter(function (t) { return rows.some(function (r) { return r.type === t; }); }));
    rows.forEach(function (r) { if (types.indexOf(r.type) === -1) types.push(r.type); });
    $('types').innerHTML = types.map(function (t) {
      return '<button class="chip" type="button" role="tab" data-type="' + esc(t) + '" aria-selected="' + (S.type === t) + '">' +
        (TYPE_HUE[t] !== undefined ? '<i class="dot" style="--h:' + TYPE_HUE[t] + '"></i>' : '') +
        (t === 'all' ? 'All' : esc(C.typeLabel(t))) + ' <b>' + (counts[t] || 0) + '</b></button>';
    }).join('');
    var on = $('types').querySelector('[aria-selected="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function renderList() {
    var list = visible(), el = $('list'), token = ++renderToken;
    var n = activeFilterCount();
    $('count').textContent = list.length + (list.length === 1 ? ' model' : ' models');
    $('filterCount').hidden = !n; $('filterCount').textContent = n;
    $('clearBtn').hidden = !(n || S.q);
    if (!list.length) {
      el.innerHTML = '<div class="empty"><h2>No model matches</h2><p>' +
        (S.q ? 'Nothing matches “' + esc(S.q) + '” with these filters. ' : 'These filters leave nothing standing. ') +
        '</p><button class="btn" type="button" data-act="clear">Clear search and filters</button></div>';
      return;
    }
    // Paint one screenful now, then fill in the rest without blocking the thumb.
    var first = document.createDocumentFragment();
    list.slice(0, 24).forEach(function (r) { first.appendChild(node(r)); });
    el.replaceChildren(first);
    var i = 24;
    (function more() {
      if (token !== renderToken || i >= list.length) return;
      var frag = document.createDocumentFragment();
      list.slice(i, i + 80).forEach(function (r) { frag.appendChild(node(r)); });
      el.appendChild(frag);
      i += 80;
      setTimeout(more, 0);
    })();
  }

  function stamp() {
    var el = $('fresh');
    if (!el || !fetchedAt) return;
    var mins = Math.max(0, Math.round((Date.now() - fetchedAt) / 60000));
    el.textContent = 'Venice API, ' + (mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : Math.round(mins / 60) + ' h ago');
  }

  // ------------------------------------------------------------------ filter sheet
  function optChip(attrs, label, n, on) {
    return '<button class="chip" type="button" ' + attrs + ' aria-pressed="' + !!on + '"' + (!n && !on ? ' disabled' : '') + '>' + esc(label) + ' <b>' + n + '</b></button>';
  }
  function renderFilters() {
    var html = '';
    var inType = function (r) { return true; };
    var has = function (test) { return rows.some(function (r) { return (S.type === 'all' || r.type === S.type) && test(r); }); };

    if (has(function (r) { return r.caps.length; })) {
      html += '<section class="sec"><h3>Can do</h3><div class="opts">' + C.CAPS.map(function (c) {
        return optChip('data-cap="' + c.key + '" style="--h:' + CAP_HUE[c.key] + '"', c.label, countIf('cap:' + c.key, function (r) { return r.caps.indexOf(c.key) !== -1; }), S.caps[c.key]);
      }).join('') + '</div></section>';
    }
    if (has(function (r) { return r.type === 'video'; })) {
      var modes = {};
      rows.forEach(function (r) { if (r.mode) modes[r.mode] = 1; });
      html += '<section class="sec"><h3>Video input</h3><div class="opts">' + Object.keys(modes).sort().map(function (m) {
        return optChip('data-mode="' + esc(m) + '"', m, countIf('mode', function (r) { return r.mode === m; }), S.mode === m);
      }).join('') + '</div></section>';
    }
    var axes = S.type === 'image' ? ['likeness', 'filter', 'nsfw'] : S.type === 'video' ? ['likeness', 'voice', 'nsfw'] : S.type === 'all' ? ['likeness', 'nsfw'] : [];
    Object.keys(S.pol).forEach(function (k) { if (axes.indexOf(k) === -1) axes.push(k); });
    if (axes.length) {
      html += '<section class="sec"><h3>Content policy</h3>' + axes.map(function (k) {
        return '<div class="opt-row"><span>' + POL_LABEL[k] + '</span><div class="opts">' + POL_OPTS[POL_KIND[k]].map(function (o) {
          return optChip('data-pol="' + k + '" data-val="' + o[0] + '"', o[1], countIf('pol:' + k, function (r) { return polPass(r, k, o[0]) && !!r.policy; }), S.pol[k] === o[0]);
        }).join('') + '</div></div>';
      }).join('') + '<p class="hint">Ratings are curated by hand, not promised by the provider. “Allowed” means not blocked. A dashed mark was inferred from the privacy tier.</p></section>';
    }
    html += '<section class="sec"><h3>Privacy</h3><div class="opts">' + [['private', 'Private (Venice-hosted)'], ['anonymized', 'Anonymized (proxied)']].map(function (p) {
      return optChip('data-privacy="' + p[0] + '"', p[1], countIf('privacy', function (r) { return r.privacy === p[0]; }), S.privacy === p[0]);
    }).join('') + '</div></section>';
    html += '<section class="sec"><h3>More</h3><div class="opts">' + FLAGS.map(function (f) {
      return optChip('data-flag="' + f.key + '"', f.label, countIf('flag:' + f.key, f.test), S.flags[f.key]);
    }).join('') + '</div></section>';

    var vendors = {};
    rows.forEach(function (r) { if (r.provider && matches(r, S, 'provider')) vendors[r.provider] = (vendors[r.provider] || 0) + 1; });
    if (S.provider && !vendors[S.provider]) vendors[S.provider] = 0;
    html += '<section class="sec"><h3>Built by</h3><select class="field" id="vendorSel" aria-label="Vendor"><option value="">Any vendor</option>' +
      Object.keys(vendors).sort().map(function (v) { return '<option value="' + esc(v) + '"' + (S.provider === v ? ' selected' : '') + '>' + esc(v) + ' (' + vendors[v] + ')</option>'; }).join('') + '</select></section>';

    $('filterBody').innerHTML = html;
    var n = visible().length;
    $('filterDone').textContent = 'Show ' + n + (n === 1 ? ' model' : ' models');
  }

  // ------------------------------------------------------------------ detail sheet
  function snippet(r) {
    var body = null, ep = '';
    if (r.type === 'text') { ep = '/chat/completions'; body = { model: r.id, messages: [{ role: 'user', content: 'Hello' }] }; }
    else if (r.type === 'image') { ep = '/image/generate'; body = { model: r.id, prompt: 'A lighthouse at dawn' }; }
    else if (r.type === 'embedding') { ep = '/embeddings'; body = { model: r.id, input: 'Text to embed' }; }
    else if (r.type === 'tts') { ep = '/audio/speech'; body = { model: r.id, input: 'Hello from Venice', voice: (r.voices && r.voices[0]) || undefined }; }
    if (!body) return '';
    return 'curl ' + VENICE + ep + ' \\\n  -H "Authorization: Bearer $VENICE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'' + JSON.stringify(body) + '\'';
  }
  function budgetHtml(r, budget) {
    if (!r.price.buys.length) return '';
    return r.price.buys.map(function (b) {
      return '<li><b>' + C.fmtCount(budget / b.per * b.scale) + '</b> ' + esc(b.label) + '</li>';
    }).join('');
  }
  function renderDetail(r) {
    var meta = C.TYPE_META[r.type] || {};
    $('dTitle').textContent = r.name;
    $('dSub').textContent = [r.provider, C.typeLabel(r.type), r.mode].filter(Boolean).join(' · ');
    var h = '';
    var t = typeTag(r) + tags(r) + (r.uncensored ? '<span class="tag accent">Uncensored</span>' : '') + (r.recommended ? '<span class="tag">Venice pick</span>' : '') +
      '<span class="tag">' + (r.privacy === 'private' ? 'Private, Venice-hosted' : r.privacy === 'anonymized' ? 'Anonymized, proxied' : esc(r.privacy)) + '</span>';
    h += '<div class="d-tags">' + t + '</div>';
    h += '<button class="copy big" type="button" data-copy="' + esc(r.id) + '" aria-label="Copy model ID"><code>' + esc(r.id) + '</code><span class="copy-cta">' + icon('copy', 'sm') + 'Copy ID</span></button>';

    // Price first: it is what people open this sheet for.
    h += '<section class="sec"><h3>Price <span class="unit">' + esc(r.price.unit) + '</span></h3><div class="d-price">' + priceCells(r) + '</div>';
    if (r.price.note) h += '<p class="hint">' + esc(r.price.note) + '</p>';
    r.price.tables.forEach(function (tb) {
      h += '<details class="ptable"><summary>' + esc(tb.title) + '</summary><dl class="kv">' + tb.rows.map(function (x) {
        return '<dt>' + esc(x[0]) + '</dt><dd class="mono">' + C.fmtUsd(x[1]) + '</dd>';
      }).join('') + '</dl></details>';
    });
    if (r.price.buys.length) {
      var budget = Number(A.store.get('mc_budget')) || 48;
      h += '<div class="budget"><label for="budget">What <span class="money">$<input id="budget" type="number" inputmode="decimal" min="0" step="1" value="' + budget + '" aria-label="Budget in dollars"></span> buys</label><ul id="buys">' + budgetHtml(r, budget) + '</ul></div>';
    }
    h += '</section>';

    var snip = snippet(r);
    h += '<section class="sec"><h3>Use it</h3>';
    if (meta.endpoint) h += '<p class="endpoint"><code>' + esc(meta.endpoint) + '</code></p>';
    h += '<div class="acts">';
    if (snip) h += '<button class="btn sm" type="button" data-copy="' + esc(snip) + '" data-copy-label="Copied curl request">' + icon('copy', 'sm') + 'Copy curl</button>';
    if (r.type === 'text') h += '<a class="btn sm" href="chat.html?model=' + encodeURIComponent(r.id) + '">' + icon('chat', 'sm') + 'Open in chat</a>';
    h += '<button class="btn sm" type="button" data-act="share" data-id="' + esc(r.id) + '">' + icon('share', 'sm') + 'Share</button>';
    if (meta.doc) h += '<a class="btn sm" href="https://docs.venice.ai/' + meta.doc + '" target="_blank" rel="noopener">' + icon('ext', 'sm') + 'Endpoint docs</a>';
    h += '<a class="btn sm" href="models/' + r.id.split('/').map(encodeURIComponent).join('/') + '.md" target="_blank" rel="noopener">' + icon('doc', 'sm') + 'Markdown</a>';
    h += '</div></section>';

    if (r.desc) h += '<section class="sec"><h3>About</h3><p class="desc">' + esc(r.desc) + '</p></section>';

    if (r.caps.length) {
      h += '<section class="sec"><h3>Capabilities</h3><ul class="caplist">' + r.caps.map(function (k) {
        return '<li>' + hueTag(CAP_HUE[k], C.CAP_BY_KEY[k].label) + '<span>' + C.CAP_BY_KEY[k].long + '</span></li>';
      }).join('') + '</ul></section>';
    }
    if (r.policy) {
      h += '<section class="sec"><h3>Content policy</h3>' + (C.POLICY_AXES[r.policy.kind] || []).map(function (a) {
        var v = r.policy[a.key];
        return '<div class="pol"><div class="pol-top"><b>' + a.label + '</b><span class="tag ' + POL_TAG[v.state] + (v.inferred ? ' dashed' : '') + '">' + C.axisText(a.key, v.state) + (v.inferred ? ', inferred' : '') + '</span></div>' +
          '<p>' + esc(v.note) + '</p>' + (v.source ? '<p class="src">Basis: ' + esc(v.source) + '</p>' : '') + '</div>';
      }).join('') + '<p class="hint">Curated by hand, not promised by the provider. “Open” means not blocked, never guaranteed to render.</p></section>';
    }
    if (r.voices && r.voices.length) {
      var ext = CLIP_EXT[r.id];
      h += '<section class="sec"><h3>Voices <span class="unit">' + r.voices.length + (ext ? ', play to hear, tap a name to copy it' : ', tap a name to copy it') + '</span></h3><div class="voices">' + r.voices.map(function (v) {
        return ext
          ? '<span class="voice"><button type="button" class="v-play" data-voice="' + esc(v) + '" data-model="' + esc(r.id) + '" data-ext="' + ext + '" aria-label="Play ' + esc(v) + '">' + icon('play', 'sm') + '</button><button type="button" class="v-name" data-copy="' + esc(v) + '">' + esc(v) + '</button></span>'
          : '<span class="voice"><button type="button" class="v-name solo" data-copy="' + esc(v) + '">' + esc(v) + '</button></span>';
      }).join('') + '</div></section>';
    }
    if (r.facts.length) {
      h += '<section class="sec"><h3>Specifications</h3><dl class="kv">' + r.facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '</dl></section>';
    }
    if (r.source) h += '<section class="sec"><a class="btn sm ghost" href="' + esc(r.source) + '" target="_blank" rel="noopener">' + icon('ext', 'sm') + 'Model source</a></section>';
    $('dBody').innerHTML = h;
    $('dBody').scrollTop = 0;
    $('detail').setAttribute('data-id', r.id);
  }

  function stopAudio() {
    if (audio) { audio.pause(); audio = null; }
    if (audioBtn) { audioBtn.innerHTML = icon('play', 'sm'); audioBtn.classList.remove('on'); audioBtn = null; }
  }
  function playVoice(btn) {
    if (audioBtn === btn) { stopAudio(); return; }
    stopAudio();
    audio = new Audio('assets/voice-clips/' + btn.dataset.model + '/' + encodeURIComponent(btn.dataset.voice) + '.' + btn.dataset.ext);
    audioBtn = btn;
    btn.innerHTML = icon('stop', 'sm'); btn.classList.add('on');
    audio.addEventListener('ended', stopAudio);
    audio.addEventListener('error', function () { stopAudio(); A.toast('No sample recorded for ' + btn.dataset.voice); });
    audio.play().catch(function () { stopAudio(); });
  }

  // ------------------------------------------------------------------ apply: URL → screen
  var lastSheet = '';
  function setSheet(which) {
    ['detail', 'filters'].forEach(function (id) {
      var open = id === which;
      $(id).classList.toggle('open', open);
      $(id).setAttribute('aria-hidden', String(!open));
      if ('inert' in $(id)) $(id).inert = !open;
    });
    $('scrim').classList.toggle('open', !!which);
    document.documentElement.style.overflow = which ? 'hidden' : '';
    if (!which) stopAudio();
    if (which && which !== lastSheet) { var c = $(which).querySelector('.sheet-close'); if (c) c.focus({ preventScroll: true }); }
    lastSheet = which;
  }
  function apply() {
    var prevKey = JSON.stringify(S);
    S = readUrl();
    var changed = JSON.stringify(S) !== prevKey || !$('list').firstChild;
    var hash = location.hash;
    var input = $('q');
    if (document.activeElement !== input) input.value = S.q;
    $('qClear').hidden = !S.q;
    $('sort').value = S.sort;
    if (changed) { renderTabs(); renderList(); }
    stamp();
    if (hash.indexOf('#m/') === 0) {
      var id; try { id = decodeURIComponent(hash.slice(3)); } catch (e) { id = ''; }
      var r = byId[id];
      if (r) { if ($('detail').getAttribute('data-id') !== id || lastSheet !== 'detail') renderDetail(r); setSheet('detail'); document.title = r.name + ' · ' + r.id; return; }
    }
    document.title = 'Venice AI models and prices · V’s MultiGen AI Chat';
    if (hash === '#filters') { renderFilters(); setSheet('filters'); return; }
    setSheet('');
  }

  // ------------------------------------------------------------------ events
  function mutate(fn, push) { var s = readUrl(); fn(s); go(s, location.hash === '#filters' ? '#filters' : '', push); }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var open = t.closest('[data-open]');
    if (open && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      openSheet('#m/' + encodeURIComponent(open.getAttribute('data-open')));
      return;
    }
    var type = t.closest('[data-type]');
    if (type) { var v = type.getAttribute('data-type'); if (v !== S.type) { mutate(function (s) { s.type = v; s.mode = ''; s.pol = {}; s.caps = v === 'all' || v === 'text' ? s.caps : {}; }, true); window.scrollTo(0, 0); } return; }
    var el;
    if ((el = t.closest('[data-cap]'))) return mutate(function (s) { var k = el.getAttribute('data-cap'); if (s.caps[k]) delete s.caps[k]; else s.caps[k] = 1; });
    if ((el = t.closest('[data-flag]'))) return mutate(function (s) { var k = el.getAttribute('data-flag'); if (s.flags[k]) delete s.flags[k]; else s.flags[k] = 1; });
    if ((el = t.closest('[data-privacy]'))) return mutate(function (s) { var k = el.getAttribute('data-privacy'); s.privacy = s.privacy === k ? '' : k; });
    if ((el = t.closest('[data-mode]'))) return mutate(function (s) { var k = el.getAttribute('data-mode'); s.mode = s.mode === k ? '' : k; });
    if ((el = t.closest('[data-pol]'))) return mutate(function (s) { var k = el.getAttribute('data-pol'), val = el.getAttribute('data-val'); if (s.pol[k] === val) delete s.pol[k]; else s.pol[k] = val; });
    if ((el = t.closest('.v-play'))) return playVoice(el);
    var act = t.closest('[data-act]');
    if (!act) return;
    switch (act.getAttribute('data-act')) {
      case 'filters': openSheet('#filters'); break;
      case 'close': closeSheet(); break;
      case 'clear': mutate(function (s) { var keep = { type: s.type, sort: s.sort }; Object.assign(s, blank(), keep); }); $('q').value = ''; break;
      case 'qclear': $('q').value = ''; mutate(function (s) { s.q = ''; }); $('q').focus(); break;
      case 'share': {
        var r = byId[act.getAttribute('data-id')];
        var url = location.origin + location.pathname + '#m/' + encodeURIComponent(r.id);
        if (navigator.share) navigator.share({ title: r.name, text: r.name + ' (' + r.id + '): ' + r.price.text, url: url }).catch(function () {});
        else A.copy(url).then(function (ok) { A.toast(ok ? 'Link copied' : 'Could not copy the link'); });
        break;
      }
    }
  });

  var typing;
  $('q').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(typing);
    typing = setTimeout(function () { mutate(function (s) { s.q = v.trim(); }); }, 90);
  });
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
  $('sort').addEventListener('change', function () { var v = this.value; mutate(function (s) { s.sort = v; }); });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'vendorSel') { var v = e.target.value; mutate(function (s) { s.provider = v; }); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'budget') return;
    var b = Number(e.target.value);
    if (!(b > 0)) return;
    A.store.set('mc_budget', String(b));
    var r = byId[$('detail').getAttribute('data-id')];
    if (r) $('buys').innerHTML = budgetHtml(r, b);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lastSheet) { e.preventDefault(); closeSheet(); }
    else if (e.key === '/' && !lastSheet && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); }
  });
  window.addEventListener('popstate', function () {
    if (lastSheet && !location.hash && sheetsOpened > 0) sheetsOpened--;
    // Leaving the filter sheet with Back keeps what was chosen in it.
    if (lastSheet === 'filters' && location.hash !== '#filters') {
      try { history.replaceState(history.state, '', urlFor(S, location.hash)); } catch (e) { /* sandboxed */ }
    }
    apply();
  });
  window.addEventListener('hashchange', apply);
  // Left open on a phone for an hour? Pick up new models when the tab comes back.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - fetchedAt > 5 * 60000) refresh(true).catch(function () {});
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted && Date.now() - fetchedAt > 5 * 60000) refresh(true).catch(function () {}); });
  setInterval(stamp, 60000);

  // ------------------------------------------------------------------ start
  $('sort').innerHTML = SORTS.map(function (s) { return '<option value="' + s[0] + '">' + s[1] + '</option>'; }).join('');
  var boot = $('boot'), started = false;
  if (boot) { try { started = install(JSON.parse(boot.textContent), 'boot'); } catch (e) { started = false; } }
  if (!started) { try { started = install(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'), 'cache'); } catch (e) { started = false; } }
  if (started) {
    apply();
    if (!boot || Date.now() - fetchedAt > 5 * 60000) refresh(true).catch(function () {});
  } else {
    $('list').innerHTML = '<div class="empty"><h2>Loading the model list</h2><p>Reading it from Venice.</p></div>';
    refresh(false).catch(function (err) {
      $('list').innerHTML = '<div class="empty"><h2>The model list did not load</h2><p>' + esc(err.message || 'Network error') +
        '. Venice may be unreachable from this network.</p><button class="btn primary" type="button" onclick="location.reload()">Try again</button></div>';
    });
  }
})();
