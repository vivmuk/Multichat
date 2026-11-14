/* app.js — the shell every page shares: theme, top bar, phone tab bar, icons,
 * toast, copy-to-clipboard, and Back-button handling for anything that opens
 * over the page. Runs synchronously at the top of <body>, so the chrome is in
 * the first paint and never shifts.
 */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;

  // ---- theme: follow the system unless the visitor chose ------------------
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: nothing to remember */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* same */ } },
  };
  var chosen = store.get('venice_theme');
  if (chosen === 'dark' || chosen === 'light') root.setAttribute('data-theme', chosen);
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncThemeColor() {
    var m = doc.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', isDark() ? '#15141B' : '#FFFFFF');
  }
  function toggleTheme() {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    store.set('venice_theme', next);
    syncThemeColor();
    doc.dispatchEvent(new CustomEvent('themechange', { detail: next }));
  }

  // ---- icons: inline SVG paths, 24px grid, stroked -------------------------
  var ICONS = {
    models: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 3 12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/>',
    bench: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    api: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    agent: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 13v2M15 13v2M2 13v2M22 13v2"/><circle cx="12" cy="3.5" r="1"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    share: '<path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    download: '<path d="M12 3v12M8 11l4 4 4-4M5 21h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  };
  function icon(name, cls) {
    return '<svg class="ico v-ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  // ---- chrome ---------------------------------------------------------------
  var NAV = [
    { href: './', file: 'index.html', label: 'Models', icon: 'models' },
    { href: 'chat.html', file: 'chat.html', label: 'Chat', icon: 'chat' },
    { href: 'benchmark.html', file: 'benchmark.html', label: 'Benchmark', short: 'Bench', icon: 'bench' },
    { href: 'api-guide.html', file: 'api-guide.html', label: 'API guide', short: 'API', icon: 'api' },
    { href: 'agents.html', file: 'agents.html', label: 'For agents', short: 'Agents', icon: 'agent' },
  ];
  var LOGO = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="116" fill="#121117"/><path d="M148 150 256 372" stroke="#CBFB45" stroke-width="70" stroke-linecap="round" fill="none"/><path d="M364 150 256 372" stroke="#F4F2EC" stroke-width="70" stroke-linecap="round" fill="none"/><circle cx="256" cy="150" r="36" fill="#FF6A45"/></svg>';

  function currentFile() {
    var f = location.pathname.replace(/\/+$/, '').split('/').pop() || 'index.html';
    var alias = { '': 'index.html', models: 'index.html', chat: 'chat.html', fusion: 'chat.html', benchmark: 'benchmark.html', 'api-guide': 'api-guide.html', agents: 'agents.html' };
    return alias[f] || (/\.html$/.test(f) ? f : 'index.html');
  }

  function shell() {
    var here = currentFile();
    var links = function (short) {
      return NAV.map(function (n) {
        return '<a href="' + n.href + '"' + (n.file === here ? ' aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + (short && n.short ? n.short : n.label) + '</span></a>';
      }).join('');
    };
    var html =
      '<header class="v-top">' +
        '<a class="v-brand" href="./" aria-label="V\'s MultiGen AI Chat, model catalogue">' + LOGO + '<span>V’s MultiGen <small>AI</small></span></a>' +
        '<nav class="v-nav" aria-label="Sections">' + links(false) + '</nav>' +
        '<span class="v-space"></span>' +
        '<span id="topExtra"></span>' +
        '<button class="v-tbtn" id="themeBtn" type="button" aria-label="Switch between light and dark">' + icon(isDark() ? 'sun' : 'moon') + '</button>' +
      '</header>' +
      '<nav class="v-tabbar" aria-label="Sections">' + links(true) + '</nav>' +
      '<div class="v-toast" id="vToast" role="status" aria-live="polite"></div>';
    // Pages with their own app bar (chat, benchmark) ask for the tab bar only.
    var lite = root.getAttribute('data-shell') === 'tabbar';
    if (lite) html = html.slice(html.indexOf('<nav class="v-tabbar"'));
    var here2 = doc.currentScript;
    if (here2 && here2.parentNode === doc.body) here2.insertAdjacentHTML('beforebegin', html);
    else doc.body.insertAdjacentHTML('afterbegin', html);
    doc.body.classList.add(lite ? 'v-lite' : 'v-app');
    var tb = doc.getElementById('themeBtn');
    if (tb) tb.addEventListener('click', function () { toggleTheme(); tb.innerHTML = icon(isDark() ? 'sun' : 'moon'); });
    syncThemeColor();
  }

  // ---- toast ------------------------------------------------------------------
  var toastTimer;
  function toast(msg) {
    var el = doc.getElementById('vToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1700);
  }

  // ---- clipboard ----------------------------------------------------------------
  function copy(text) {
    function legacy() {
      var ta = doc.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      doc.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
    }
    return Promise.resolve(legacy());
  }

  // Any element with data-copy copies that text; data-copy-from copies another element's text.
  doc.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-copy],[data-copy-from]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    var from = el.getAttribute('data-copy-from');
    var text = from ? (doc.querySelector(from) || {}).textContent || '' : el.getAttribute('data-copy');
    copy(text).then(function (ok) {
      if (!ok) { toast('Copy was blocked. Press and hold the text to copy it.'); return; }
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { /* not supported */ } }
      var label = el.getAttribute('data-copy-label') || (text.length > 44 ? 'Copied' : 'Copied ' + text);
      toast(label);
      el.classList.add('done');
      var cta = el.querySelector('.copy-cta');
      var old = cta && cta.innerHTML;
      if (cta) cta.innerHTML = icon('check', 'sm') + 'Copied';
      setTimeout(function () { el.classList.remove('done'); if (cta) cta.innerHTML = old; }, 1300);
    });
  }, true);

  // ---- layers: anything that opens over the page closes with Back -----------------
  // open() pushes one history entry; the Back button (or gesture) pops it and
  // runs the layer's close function instead of leaving the site.
  var layers = [];
  function openLayer(name, close, url) {
    layers.push({ name: name, close: close });
    try { history.pushState({ vLayer: layers.length, name: name }, '', url || location.href); } catch (e) { /* sandboxed */ }
  }
  function closeLayer(name) {
    if (!layers.length) return;
    if (name && layers[layers.length - 1].name !== name) {
      // Not the top layer (closed out of order): drop it without touching history.
      for (var i = layers.length - 1; i >= 0; i--) if (layers[i].name === name) { layers.splice(i, 1)[0].close(); return; }
      return;
    }
    if (history.state && history.state.vLayer === layers.length) history.back();
    else layers.pop().close();
  }
  function hasLayer(name) { return layers.some(function (l) { return l.name === name; }); }
  // For pages whose overlays are driven by a CSS class: watch the class, and
  // keep the history stack in step with it, whoever opens or closes the overlay.
  function watchLayer(el, cls, name, close) {
    if (!el || !window.MutationObserver) return;
    var was = el.classList.contains(cls);
    new MutationObserver(function () {
      var now = el.classList.contains(cls);
      if (now === was) return;
      was = now;
      if (now) { if (!hasLayer(name)) openLayer(name, function () { if (close) close(); else el.classList.remove(cls); }); }
      else if (hasLayer(name)) closeLayer(name);
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('popstate', function (e) {
    var depth = (e.state && e.state.vLayer) || 0;
    while (layers.length > depth) layers.pop().close();
  });
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && layers.length) { e.preventDefault(); closeLayer(); }
  });

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.VApp = {
    icon: icon, toast: toast, copy: copy, esc: esc, store: store, isDark: isDark, toggleTheme: toggleTheme,
    openLayer: openLayer, closeLayer: closeLayer, hasLayer: hasLayer, watchLayer: watchLayer, shell: shell,
  };
  if (!root.hasAttribute('data-no-shell')) shell();
})();
