/*
 * lecture-editor v4 · bridge
 * ---------------------------------------------------------------------------
 * This function is serialised and injected as the very first <head> script of
 * the view document, which runs in a sandboxed iframe with an opaque origin
 * (sandbox="allow-scripts", no allow-same-origin). The editor shell never
 * touches this document directly; everything goes through postMessage.
 *
 * Responsibilities
 *  - neutralise the deck's own runtime while editing (keyboard/click/wheel
 *    navigation, autoplay, dialogs) without breaking its rendering
 *  - find the slides (reveal, Marp, impress, swiper, #stage decks, scroll decks,
 *    generic .slide / section patterns) and the deck's native slide size
 *  - show exactly one slide at native size ("isolation"), regardless of how the
 *    deck itself positions, scales or hides slides
 *  - selection, hover, drag-move with snapping, resize, marquee, text editing
 *  - apply primitive ops sent by the shell and report user edits back as ops
 *  - thumbnails / snapshots (html2canvas loaded on demand)
 *
 * Elements carry data-ed-id attributes that map them to the shell's source
 * model. Anything the deck's scripts change at runtime never reaches the saved
 * file, because the shell saves its own source model, not this live DOM.
 */
window.LE_BRIDGE = function (CFG) {
  'use strict';
  if (window.__LE_BRIDGE__) return;
  window.__LE_BRIDGE__ = 1;

  var W = window, D = document, DE = D.documentElement;
  var NONCE = CFG.nonce;
  var idSeq = 0;
  function genId() { return CFG.idPrefix + (++idSeq).toString(36); }
  function noop() {}
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(v) { return Math.round(v * 100) / 100; }

  /* ------------------------------------------------------------------ *
   * 1. sandbox shims (opaque origin: storage and cookies throw)
   * ------------------------------------------------------------------ */
  function memStorage() {
    var m = Object.create(null);
    return {
      get length() { return Object.keys(m).length; },
      key: function (i) { return Object.keys(m)[i] || null; },
      getItem: function (k) { k = String(k); return k in m ? m[k] : null; },
      setItem: function (k, v) { m[String(k)] = String(v); },
      removeItem: function (k) { delete m[String(k)]; },
      clear: function () { m = Object.create(null); }
    };
  }
  var shims = [];
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var ok = false;
    try { var st = W[name]; st.setItem('__le', '1'); st.removeItem('__le'); ok = true; } catch (e) {}
    if (!ok) {
      var mem = memStorage();
      try { Object.defineProperty(W, name, { configurable: true, enumerable: true, get: function () { return mem; } }); shims.push(name); } catch (e) {}
    }
  });
  try { void D.cookie; } catch (e) {
    try {
      var jar = '';
      Object.defineProperty(D, 'cookie', { configurable: true, get: function () { return jar; }, set: function (v) { jar = String(v).split(';')[0]; } });
      shims.push('cookie');
    } catch (e2) {}
  }
  try { W.alert = noop; W.confirm = function () { return false; }; W.prompt = function () { return null; }; W.print = noop; } catch (e) {}
  // srcdoc documents cannot change their URL; decks that sync the slide number into the
  // address bar would throw and abort their own init. Swallow those errors.
  try {
    ['pushState', 'replaceState'].forEach(function (k) {
      var orig = W.history[k];
      W.history[k] = function () { try { return orig.apply(W.history, arguments); } catch (e) { return undefined; } };
    });
  } catch (e) {}

  /* ------------------------------------------------------------------ *
   * 2. state
   * ------------------------------------------------------------------ */
  var S = {
    ready: false, mode: 'edit', kind: 'document', docMode: true,
    slides: [], slideSel: null, slideIdx: -1, cur: null,
    W: 0, H: 0, basis: 'fixed', display: 'block', perSlide: false, tallH: 0,
    sel: [], hover: null, editing: null, edit0: '', editCE: null, editSC: null, editRange: null,
    opts: { builds: true, snap: true, zoom: 1, anim: false },
    origPos: Object.create(null), natDisp: Object.create(null), allowPlay: false
  };

  /* ------------------------------------------------------------------ *
   * 3. messaging
   * ------------------------------------------------------------------ */
  function post(type, data) {
    try { W.parent.postMessage({ __le: 1, n: NONCE, type: type, data: data }, '*'); } catch (e) {}
  }
  var errors = [], resErrors = 0;
  W.addEventListener('error', function (e) {
    if (e && e.target && e.target !== W && e.target.nodeType === 1) { resErrors++; return; }
    if (errors.length < 12) errors.push(String((e && e.message) || 'error').slice(0, 220));
  }, true);
  W.addEventListener('unhandledrejection', function (e) {
    if (errors.length < 12) errors.push('Promise: ' + String(e && e.reason && (e.reason.message || e.reason)).slice(0, 220));
  });

  var CMD = Object.create(null);
  W.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.__le !== 1 || m.n !== NONCE || e.source !== W.parent) return;
    e.stopImmediatePropagation();
    var fn = CMD[m.cmd], res, err = null;
    try {
      if (m.cmd !== 'resizeMove' && m.cmd !== 'hoverId') flushPending();
      if (!fn) err = 'unknown command: ' + m.cmd; else res = fn(m.args || {});
    } catch (ex) { err = String((ex && ex.message) || ex); }
    if (res && typeof res.then === 'function') {
      res.then(function (v) { if (m.rid) post('reply', { rid: m.rid, data: v }); },
               function (ex) { if (m.rid) post('reply', { rid: m.rid, err: String((ex && ex.message) || ex) }); });
    } else if (m.rid) post('reply', { rid: m.rid, data: res, err: err });
  }, true);

  /* ------------------------------------------------------------------ *
   * 4. canonical element registry
   *    The first element seen with a given data-ed-id is the original;
   *    later copies (overview thumbnails, carousel loop clones...) are
   *    runtime artefacts and are never treated as editable.
   * ------------------------------------------------------------------ */
  var canon = new Map();
  function regEl(el, force) {
    var id = el.getAttribute && el.getAttribute('data-ed-id');
    if (!id) return;
    var cur = canon.get(id);
    if (force || !cur || !cur.isConnected) canon.set(id, el);
  }
  function regTree(root, force) {
    if (!root || root.nodeType !== 1) return;
    regEl(root, force);
    var all = root.querySelectorAll('[data-ed-id]');
    for (var i = 0; i < all.length; i++) regEl(all[i], force);
  }
  regTree(DE, false);
  var mo = new MutationObserver(function (recs) {
    for (var i = 0; i < recs.length; i++) {
      var add = recs[i].addedNodes;
      for (var j = 0; j < add.length; j++) if (add[j].nodeType === 1) regTree(add[j], false);
    }
  });
  mo.observe(DE, { childList: true, subtree: true });

  function byId(id) {
    if (!id) return null;
    var el = canon.get(id);
    if (el && el.isConnected) return el;
    el = D.querySelector('[data-ed-id="' + String(id).replace(/[^A-Za-z0-9_\-]/g, '') + '"]');
    if (el) canon.set(id, el); else canon.delete(id);
    return el;
  }
  function idOf(el) { return el && el.nodeType === 1 ? el.getAttribute('data-ed-id') : null; }
  function isCanon(el) { var id = idOf(el); return !!id && byId(id) === el; }
  function nearestCanon(n) {
    while (n && n.nodeType !== 1) n = n.parentNode;
    while (n && n !== DE) { if (isCanon(n)) return n; n = n.parentElement; }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 5. styles injected into the view (never saved)
   * ------------------------------------------------------------------ */
  var R = ':root:root';
  var STATIC_CSS = [
    R + '[data-ed-mode="edit"] body *:not([data-ed-editing]):not([data-ed-editing] *){-webkit-user-select:none!important;user-select:none!important}',
    R + '[data-ed-mode="edit"] *{cursor:default!important}',
    R + '[data-ed-mode="edit"] [data-ed-editing],' + R + '[data-ed-mode="edit"] [data-ed-editing] *{-webkit-user-select:text!important;user-select:text!important;cursor:text!important}',
    '[data-ed-editing]{outline:none!important}',
    R + '[data-ed-mode="edit"] iframe,' + R + '[data-ed-mode="edit"] video,' + R + '[data-ed-mode="edit"] embed,' + R + '[data-ed-mode="edit"] object{pointer-events:none!important}',
    R + '[data-ed-noanim] *,' + R + '[data-ed-noanim] *::before,' + R + '[data-ed-noanim] *::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}',
    R + '[data-ed-iso]{overflow:hidden!important}',
    R + '[data-ed-iso] body{visibility:hidden!important;overflow:hidden!important}',
    R + '[data-ed-iso] [data-ed-chain]{transform:none!important;translate:none!important;scale:none!important;rotate:none!important;filter:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;perspective:none!important;contain:none!important;will-change:auto!important;opacity:1!important;clip-path:none!important;-webkit-mask:none!important;mask:none!important;content-visibility:visible!important;zoom:1!important}',
    R + '[data-ed-iso] [data-ed-chain][data-ed-shown]{display:block!important}',
    R + '[data-ed-iso] [data-ed-current]{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;margin:0!important;transform:none!important;translate:none!important;scale:none!important;rotate:none!important;visibility:visible!important;opacity:1!important;filter:none!important;clip-path:none!important;z-index:2147483000!important;box-sizing:border-box!important;max-width:none!important;max-height:none!important;min-width:0!important;transition:none!important;animation:none!important;pointer-events:auto!important;content-visibility:visible!important;zoom:1!important}',
    '[data-ed-measure]{display:block!important;visibility:hidden!important}',
    '[data-ed-reveal]{opacity:1!important;visibility:visible!important}',
    // build/animation classes: only inside the slide being shown (or staged for a snapshot)
    ['.fragment', '.animate', '[data-aos]', '.aos-init', '.wow'].map(function (c) { return R + '[data-ed-builds] [data-ed-current] ' + c + ',' + R + '[data-ed-builds] [data-ed-snap] ' + c; }).join(',') + '{opacity:1!important;visibility:visible!important;transform:none!important}',
    // other slides never paint, even if the deck forces visibility:visible on parts of them
    R + '[data-ed-iso] [data-ed-slide]:not([data-ed-current]):not([data-ed-snap]){display:none!important}'
  ].join('\n');
  var styleEl = null, dynEl = null;
  function ensureStyles() {
    var host = D.head || DE;
    if (!styleEl || !styleEl.isConnected) { styleEl = D.createElement('style'); styleEl.id = '__le_style'; styleEl.textContent = STATIC_CSS; }
    if (!dynEl || !dynEl.isConnected) { dynEl = D.createElement('style'); dynEl.id = '__le_dyn'; }
    host.appendChild(styleEl); host.appendChild(dynEl);
  }

  /* ------------------------------------------------------------------ *
   * 6. media: no autoplay / looping videos while editing
   * ------------------------------------------------------------------ */
  try {
    var origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!S.allowPlay && S.mode === 'edit') { try { this.pause(); } catch (e) {} return Promise.resolve(); }
      return origPlay.apply(this, arguments);
    };
  } catch (e) {}
  W.addEventListener('play', function (e) {
    if (!S.allowPlay && S.mode === 'edit' && e.target && e.target.pause) { try { e.target.pause(); } catch (x) {} }
  }, true);
  function pauseMedia() {
    var ms = D.querySelectorAll('video,audio');
    for (var i = 0; i < ms.length; i++) { try { ms[i].pause(); } catch (e) {} }
  }

  /* ------------------------------------------------------------------ *
   * 7. element classification
   * ------------------------------------------------------------------ */
  var REPLACED = { IMG: 1, SVG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, PICTURE: 1, OBJECT: 1, EMBED: 1, AUDIO: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, BUTTON: 1, HR: 1, TABLE: 1, MATH: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TEMPLATE: 1, NOSCRIPT: 1, TITLE: 1, HEAD: 1, BASE: 1, BR: 1, WBR: 1, SOURCE: 1, TRACK: 1, PARAM: 1 };
  var VOID_TEXT = { IMG: 1, SVG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, HR: 1, BR: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, OBJECT: 1, EMBED: 1, AUDIO: 1, PICTURE: 1, MATH: 1 };
  var NAMES = { P: '문단', H1: '제목 1', H2: '제목 2', H3: '제목 3', H4: '제목 4', H5: '제목 5', H6: '제목 6', IMG: '그림', UL: '목록', OL: '번호 목록', LI: '항목', TABLE: '표', TR: '행', TD: '셀', TH: '머리글 셀', A: '링크', BUTTON: '버튼', DIV: '상자', SECTION: '구역', ARTICLE: '구역', SPAN: '글자', SVG: '그래픽', VIDEO: '동영상', IFRAME: '임베드', FIGURE: '그림 상자', FIGCAPTION: '그림 설명', BLOCKQUOTE: '인용', PRE: '코드', CODE: '코드', HEADER: '머리말', FOOTER: '꼬리말', NAV: '탐색', ASIDE: '곁글', MAIN: '본문', DETAILS: '접기', SUMMARY: '접기 제목', LABEL: '라벨', STRONG: '굵게', EM: '기울임', B: '굵게', I: '기울임', HR: '구분선', CANVAS: '캔버스', DL: '정의 목록', DT: '용어', DD: '설명', SMALL: '작은 글자', MARK: '강조', BODY: '문서' };
  function tagOf(el) { return el && el.tagName ? el.tagName.toUpperCase() : ''; }
  function cs(el) { return W.getComputedStyle(el); }
  function alphaOf(c) {
    if (!c || c === 'transparent') return 0;
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return 1;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  }
  function edgeVisible(st, side) {
    return parseFloat(st['border' + side + 'Width']) > 0 && st['border' + side + 'Style'] !== 'none' && st['border' + side + 'Style'] !== 'hidden' && alphaOf(st['border' + side + 'Color']) > 0.05;
  }
  function isVisual(el, st) {
    var t = tagOf(el);
    if (REPLACED[t]) return true;
    if (el.classList && (el.classList.contains('le-shape') || el.classList.contains('le-text'))) return true;
    st = st || cs(el);
    if (alphaOf(st.backgroundColor) > 0.02 || (st.backgroundImage && st.backgroundImage !== 'none')) return true;
    if (edgeVisible(st, 'Top') || edgeVisible(st, 'Left') || edgeVisible(st, 'Right') || edgeVisible(st, 'Bottom')) return true;
    if (st.boxShadow && st.boxShadow !== 'none') return true;
    return false;
  }
  function hasDirectText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }
  function isInlineEl(el) { var d = cs(el).display; return d === 'inline' || d === 'contents'; }
  function hasContent(el) {
    if (REPLACED[tagOf(el)]) return true;
    if ((el.textContent || '').trim()) return true;
    return !!el.querySelector('img,svg,video,canvas,picture,iframe');
  }
  function scopeEl() { return S.docMode ? D.body : S.cur; }
  function inScope(el) { var sc = scopeEl(); return !!(sc && el && el !== sc && sc.contains(el)); }
  function area(r) { return Math.max(0, r.width) * Math.max(0, r.height); }
  function isWrapper(el, scope, sr) {
    if (!scope) return false;
    if (el === scope) return true;
    if (!el.children.length || hasDirectText(el)) return false;
    sr = sr || scope.getBoundingClientRect();
    var a = area(sr);
    return a > 0 && area(el.getBoundingClientRect()) >= 0.8 * a;
  }
  function selectable(el) {
    if (!el || el.nodeType !== 1 || SKIP[tagOf(el)] || !isCanon(el)) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }
  function chainOf(el, top) { // top-down list of selectable elements strictly below `top`
    var out = [];
    for (var n = el; n && n !== top && n !== DE; n = n.parentElement) if (selectable(n)) out.unshift(n);
    return out;
  }
  function blockOf(el, top) {
    var n = el;
    while (n && n !== top && n.parentElement && n.parentElement !== top && isInlineEl(n) && !isVisual(n)) {
      var p = n.parentElement;
      if (!isCanon(p)) break;
      n = p;
    }
    return n;
  }
  function labelOf(el) {
    if (!el) return '';
    if (el === S.cur) return '슬라이드';
    var t = tagOf(el), name = NAMES[t] || t.toLowerCase();
    if (el.classList && el.classList.contains('le-shape')) name = '도형';
    if (el.classList && el.classList.contains('le-text')) name = '텍스트 상자';
    var extra = '';
    if (el.id) extra = '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) {
      var c = el.className.trim().split(/\s+/).filter(function (x) { return x.indexOf('le-') !== 0; })[0];
      if (c) extra = '.' + c;
    }
    return name + (extra ? ' ' + extra.slice(0, 24) : '');
  }
  function shortText(el) { return ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim().slice(0, 48); }
  function mediaAt(x, y) {
    var sc = scopeEl(); if (!sc) return null;
    var ms = sc.querySelectorAll('iframe,video,embed,object'), hit = null;
    for (var i = 0; i < ms.length; i++) {
      var r = ms[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && isCanon(ms[i])) hit = ms[i];
    }
    return hit;
  }

  /* ------------------------------------------------------------------ *
   * 8. slide detection
   * ------------------------------------------------------------------ */
  var CANDS = [
    ['marp', 'svg[data-marpit-svg]', 1],
    ['impress', '#impress .step, .impress .step', 1],
    ['swiper', '.swiper-slide:not(.swiper-slide-duplicate)', 2],
    ['shower', '.shower .slide', 2],
    ['webslides', '#webslides > section, #webslides > .slide', 2],
    ['deckjs', '.deck-container .slide', 2],
    ['stage', '#stage .slide, #stage > section, #deck .slide, #deck > section', 1],
    ['slides', 'section.slide', 2],
    ['slides', '.slide', 2],
    ['slides', '[data-slide]', 2],
    ['slides', '.slides > section, .slides > .slide, .deck > section', 2],
    ['pages', '.page', 2],
    ['sections', 'body > section, body > main > section, main > section, body > article > section', 3]
  ];
  var KIND_LABEL = { reveal: 'reveal.js 덱', 'reveal-static': 'reveal.js 덱 (정적)', marp: 'Marp 덱', impress: 'impress.js 덱', swiper: 'Swiper 슬라이드', shower: 'Shower 덱', webslides: 'WebSlides 덱', deckjs: 'deck.js 덱', stage: '무대형 슬라이드 덱', slides: '슬라이드 덱', scroll: '스크롤형 슬라이드 덱', pages: '페이지형 문서', sections: '스크롤형 섹션 덱', document: '일반 HTML 문서' };
  function qsa(sel) { try { return Array.prototype.slice.call(D.querySelectorAll(sel)); } catch (e) { return []; } }
  function outermost(list) { return list.filter(function (el) { return !list.some(function (o) { return o !== el && o.contains(el); }); }); }
  function bigEnough(list, frac) {
    var vis = list.filter(function (el) { return el.offsetWidth > 0 && el.offsetHeight > 0; });
    if (!vis.length) return true; // all hidden: classic one-at-a-time deck
    var vw = W.innerWidth, vh = W.innerHeight, ok = 0;
    vis.forEach(function (el) { if (el.offsetWidth >= vw * frac && el.offsetHeight >= vh * frac) ok++; });
    return ok / vis.length >= 0.7;
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) && String(v).indexOf('%') < 0 ? n : d; }
  function detect() {
    var Rv = W.Reveal, generated = false, genList = null;
    if (D.querySelector('.reveal .slides')) {
      if (Rv && typeof Rv.getSlides === 'function' && (typeof Rv.isReady !== 'function' || Rv.isReady())) {
        var rl = Rv.getSlides().filter(function (s) { return !s.querySelector('section'); });
        var rc = rl.filter(isCanon);
        if (rc.length) {
          var cfg = typeof Rv.getConfig === 'function' ? Rv.getConfig() : {};
          return { kind: 'reveal', slides: rc, W: num(cfg.width, 960), H: num(cfg.height, 700), display: 'block' };
        }
      } else if (Rv) return { wait: true };
      var leaf = qsa('.reveal .slides section').filter(function (s) { return !s.querySelector('section'); });
      var lc = leaf.filter(isCanon);
      if (lc.length) return { kind: 'reveal-static', slides: lc, sel: '.reveal .slides section' };
    }
    for (var i = 0; i < CANDS.length; i++) {
      var c = CANDS[i], all = qsa(c[1]);
      if (!all.length) continue;
      var can = outermost(all.filter(isCanon));
      if (can.length < c[2]) { if (!generated && outermost(all).length >= c[2]) { generated = true; genList = outermost(all); } continue; }
      if (c[0] === 'pages' && !bigEnough(can, 0.45)) continue;
      if (c[0] === 'sections' && !bigEnough(can, 0.85)) continue;
      if ((c[0] === 'slides') && !bigEnough(can, 0.3)) continue;
      var res = { kind: c[0], slides: can, sel: c[1] };
      if (c[0] === 'marp') {
        var vb = (can[0].getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
        if (vb.length === 4 && vb[2] > 0) { res.W = vb[2]; res.H = vb[3]; res.display = 'block'; }
      }
      if (c[0] === 'impress') res.perSlide = true;
      return res;
    }
    return { kind: 'document', slides: [], generated: generated, genList: genList };
  }
  function guessDisplay(list) {
    // the deck hides inactive slides; find the display value of its "active" rule
    var el = list[0], classes = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean);
    var re = /\.(active|on|current|present|show|shown|visible|is-active|selected|is-current)\b/;
    for (var i = 0; i < D.styleSheets.length; i++) {
      var rules; try { rules = D.styleSheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (!r.selectorText || !r.style || !r.style.display || r.style.display === 'none') continue;
        if (!re.test(r.selectorText)) continue;
        for (var k = 0; k < classes.length; k++) if (r.selectorText.indexOf('.' + classes[k]) >= 0) return r.style.display;
        if (r.selectorText.indexOf(tagOf(el).toLowerCase()) >= 0) return r.style.display;
      }
    }
    return 'block';
  }
  function measure(list) {
    var vw = W.innerWidth, vh = W.innerHeight, active = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        var st = cs(el);
        if (st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.05) { active = el; break; }
      }
    }
    var disp, w, h;
    if (active) { disp = cs(active).display; w = active.offsetWidth; h = active.offsetHeight; }
    else {
      var f = list[0];
      f.setAttribute('data-ed-measure', '');
      w = f.offsetWidth; h = f.offsetHeight;
      f.removeAttribute('data-ed-measure');
      disp = guessDisplay(list);
    }
    if (!disp || disp === 'none' || disp === 'inline' || disp === 'contents') disp = 'block';
    var r;
    if (!w || !h || Math.abs(w - vw) <= 2) r = { W: vw, H: vh, basis: 'viewport' };
    else r = { W: Math.round(w), H: Math.round(h), basis: 'fixed' };
    r.display = disp; r.active = active;
    return r;
  }
  function slideTitle(el, i) {
    var h = null;
    try { h = el.querySelector('h1,h2,h3,h4,[class*="title"],[class*="Title"]'); } catch (e) {}
    var t = ((h ? h.textContent : el.textContent) || '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 60) : '슬라이드 ' + (i + 1);
  }
  function notesOf(el) {
    if (!el) return null;
    var a = null;
    try { a = el.querySelector('aside.notes, .notes[data-ed-id]'); } catch (e) {}
    if (a && isCanon(a)) return { type: 'aside', id: idOf(a), text: (a.textContent || '').trim() };
    var attrs = ['data-notes', 'data-note', 'data-n'];
    for (var i = 0; i < attrs.length; i++) if (el.hasAttribute(attrs[i])) return { type: 'attr', attr: attrs[i], id: idOf(el), text: el.getAttribute(attrs[i]) };
    return { type: 'none', id: idOf(el), text: '' };
  }
  function slideMeta(el, i) { return { id: idOf(el), title: slideTitle(el, i), pos: S.origPos[idOf(el)] || 'static' }; }

  /* ------------------------------------------------------------------ *
   * 9. isolation: show exactly one slide at native size
   * ------------------------------------------------------------------ */
  function markSlides(list) {
    var old = D.querySelectorAll('[data-ed-slide]');
    for (var i = 0; i < old.length; i++) if (list.indexOf(old[i]) < 0) old[i].removeAttribute('data-ed-slide');
    if (S.kind !== 'reveal') list.forEach(function (s) { s.setAttribute('data-ed-slide', ''); });
  }
  function natDisplay(el) { var d = S.natDisp[idOf(el)]; return d || S.display; }
  function clearIso() {
    DE.removeAttribute('data-ed-iso');
    var ns = D.querySelectorAll('[data-ed-current],[data-ed-chain],[data-ed-shown],[data-ed-tall]');
    for (var i = 0; i < ns.length; i++) {
      ns[i].removeAttribute('data-ed-current'); ns[i].removeAttribute('data-ed-chain');
      ns[i].removeAttribute('data-ed-shown'); ns[i].removeAttribute('data-ed-tall');
    }
  }
  function bgCss(el) {
    // background behind a transparent slide comes from the nearest painted ancestor
    for (var n = el.parentElement; n && n !== D.body && n !== DE; n = n.parentElement) {
      var st = cs(n);
      if (alphaOf(st.backgroundColor) > 0.02 || (st.backgroundImage && st.backgroundImage !== 'none')) {
        return R + '[data-ed-iso]{background-color:' + st.backgroundColor + '!important;background-image:' + st.backgroundImage + '!important;background-size:' + st.backgroundSize + '!important;background-position:' + st.backgroundPosition + '!important;background-repeat:' + st.backgroundRepeat + '!important}';
      }
    }
    return '';
  }
  function setDyn(el, disp) {
    var css = '';
    if (S.kind === 'reveal') {
      css += '.reveal .controls,.reveal .progress,.reveal .slide-number,.reveal .speaker-notes,.reveal .pause-overlay{display:none!important}';
    } else if (el) {
      css += R + '[data-ed-iso] [data-ed-current]{display:' + disp + '!important;width:' + S.W + 'px!important;height:' + S.H + 'px!important;min-height:0!important}';
      css += R + '[data-ed-iso] [data-ed-current][data-ed-tall]{height:auto!important;min-height:' + S.H + 'px!important}';
      css += bgCss(el);
    }
    if (dynEl) dynEl.textContent = css;
  }
  function checkTall() {
    S.tallH = 0;
    var el = S.cur;
    if (!el || S.kind === 'reveal' || S.basis !== 'viewport') return;
    var op = S.origPos[idOf(el)];
    if (op === 'absolute' || op === 'fixed') return; // stage decks keep the slide frame
    el.removeAttribute('data-ed-tall');
    var oy = cs(el).overflowY;
    if (oy !== 'hidden' && oy !== 'clip' && el.scrollHeight > S.H + 4) {
      el.setAttribute('data-ed-tall', '');
      S.tallH = Math.ceil(el.getBoundingClientRect().height);
    }
  }
  function revealBuilds(slide) {
    var old = D.querySelectorAll('[data-ed-reveal]');
    for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-ed-reveal');
    if (!S.opts.builds || !slide) return;
    var all = slide.querySelectorAll('*'), n = Math.min(all.length, 4000);
    for (var j = 0; j < n; j++) {
      var e = all[j];
      if (SKIP[tagOf(e)]) continue;
      var st = cs(e);
      if (st.display === 'none') continue;
      if ((parseFloat(st.opacity) < 0.05 || st.visibility === 'hidden') && hasContent(e)) e.setAttribute('data-ed-reveal', '');
    }
  }
  function revealConfigure() {
    var Rv = W.Reveal;
    if (!Rv || typeof Rv.configure !== 'function') return;
    try {
      Rv.configure({ margin: 0, controls: false, progress: false, slideNumber: false, keyboard: false, overview: false, touch: false, hash: false, history: false, transition: 'none', backgroundTransition: 'none', fragments: false, autoSlide: 0, help: false, pause: false, embedded: false, mouseWheel: false });
      if (typeof Rv.layout === 'function') Rv.layout();
    } catch (e) {}
  }
  function showSlide(i, initial) {
    if (S.docMode || !S.slides.length) return;
    if (S.editing) exitText(true);
    flushPending();
    i = clamp(i | 0, 0, S.slides.length - 1);
    var el = S.slides[i];
    S.slideIdx = i; S.cur = el; S.hover = null;
    if (S.kind === 'reveal') {
      try { var idx = W.Reveal.getIndices(el); W.Reveal.slide(idx.h, idx.v || 0); } catch (e) {}
      setDyn(null);
    } else {
      clearIso();
      var d0 = cs(el).display;
      var disp = d0 && d0 !== 'none' && d0 !== 'inline' && d0 !== 'contents' ? d0 : natDisplay(el);
      if (S.perSlide) {
        el.setAttribute('data-ed-measure', '');
        S.W = Math.max(200, el.offsetWidth || S.W); S.H = Math.max(120, el.offsetHeight || S.H);
        el.removeAttribute('data-ed-measure');
      }
      DE.setAttribute('data-ed-iso', '');
      el.setAttribute('data-ed-current', '');
      for (var p = el.parentElement; p; p = p.parentElement) {
        p.setAttribute('data-ed-chain', '');
        if (cs(p).display === 'none') p.setAttribute('data-ed-shown', '');
      }
      setDyn(el, disp);
      checkTall();
    }
    revealBuilds(el);
    if (!initial) setSel([], true);
    post('slide', { index: i, id: idOf(el), tall: S.tallH, W: S.W, H: S.H, notes: notesOf(el) });
    postRects();
  }

  /* ------------------------------------------------------------------ *
   * 10. selection state & reporting
   * ------------------------------------------------------------------ */
  var IPROPS = ['color', 'background-color', 'background-image', 'background-size', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration-line', 'text-align', 'line-height', 'letter-spacing', 'text-transform', 'border-top-width', 'border-top-style', 'border-top-color', 'border-top-left-radius', 'box-shadow', 'opacity', 'position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'display', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'z-index', 'object-fit', 'vertical-align', 'list-style-type'];
  function rectOf(el) {
    if (!el || !el.getBoundingClientRect || !el.isConnected) return null;
    var r = el.getBoundingClientRect();
    return { x: rnd(r.left), y: rnd(r.top), w: rnd(r.width), h: rnd(r.height) };
  }
  function pathOf(el) {
    var out = [], sc = scopeEl();
    for (var n = el; n && n !== DE; n = n.parentElement) {
      if (isCanon(n) && !SKIP[tagOf(n)]) out.unshift({ id: idOf(n), label: labelOf(n) });
      if (n === sc) break;
    }
    return out;
  }
  function cellInfo(el) {
    var c = el && el.closest ? el.closest('td,th') : null;
    if (!c || !isCanon(c) || !inScope(c)) return null;
    var tr = c.parentElement, table = c.closest('table');
    if (!table || !isCanon(table)) return null;
    var rows = table.rows;
    return { cell: idOf(c), table: idOf(table), row: tr.rowIndex, col: c.cellIndex, rows: rows.length, cols: rows[0] ? rows[0].cells.length : 0 };
  }
  function kindOf(el) {
    var t = tagOf(el);
    if (el === S.cur) return 'slide';
    if (t === 'IMG' || t === 'PICTURE') return 'image';
    if (t === 'VIDEO' || t === 'IFRAME' || t === 'EMBED' || t === 'OBJECT' || t === 'AUDIO') return 'media';
    if (t === 'TABLE') return 'table';
    if (t === 'TD' || t === 'TH') return 'cell';
    if (t === 'SVG' || el instanceof SVGElement) return 'svg';
    if (t === 'A') return 'link';
    if (t === 'DETAILS') return 'details';
    if (t === 'HR') return 'divider';
    if (el.classList && el.classList.contains('le-shape')) return 'shape';
    if (hasDirectText(el)) return 'text';
    return 'box';
  }
  function info(el) {
    if (!el || !el.isConnected) return null;
    var st = cs(el), c = {};
    for (var i = 0; i < IPROPS.length; i++) c[IPROPS[i]] = st.getPropertyValue(IPROPS[i]);
    var sc = scopeEl(), sr = sc && sc !== D.body ? sc.getBoundingClientRect() : { left: 0, top: 0 };
    var r = el.getBoundingClientRect();
    var src = el.getAttribute('src') || '';
    var link = el.closest ? el.closest('a[href]') : null;
    var pst = el.parentElement ? cs(el.parentElement) : null;
    return {
      id: idOf(el), tag: el.tagName.toLowerCase(), label: labelOf(el), kind: kindOf(el),
      attr: {
        id: el.id || '', cls: typeof el.className === 'string' ? el.className : '',
        href: el.getAttribute('href') || '', src: src.slice(0, 5) === 'data:' ? 'data:… (' + Math.round(src.length / 1365) + ' KB)' : src,
        alt: el.getAttribute('alt') || '', title: el.getAttribute('title') || '', target: el.getAttribute('target') || '',
        open: el.hasAttribute('open')
      },
      link: link && isCanon(link) ? { id: idOf(link), href: link.getAttribute('href') || '', target: link.getAttribute('target') || '' } : null,
      computed: c, inline: el.getAttribute('style') || '',
      text: shortText(el), hasText: hasDirectText(el) || (!el.children.length && !!(el.textContent || '').trim()),
      canEdit: canEditText(el),
      x: Math.round(r.left - sr.left), y: Math.round(r.top - sr.top), w: Math.round(r.width), h: Math.round(r.height),
      ow: el.offsetWidth || Math.round(r.width), oh: el.offsetHeight || Math.round(r.height),
      natural: tagOf(el) === 'IMG' ? { w: el.naturalWidth, h: el.naturalHeight } : null,
      parentFlex: !!(pst && /flex|grid/.test(pst.display)),
      path: pathOf(el), cell: cellInfo(el), isSlide: el === S.cur
    };
  }
  function setSel(arr, silent) {
    arr = (arr || []).filter(function (el, i, a) { return el && el.isConnected && a.indexOf(el) === i; });
    arr = arr.filter(function (el) { return !arr.some(function (o) { return o !== el && o.contains(el); }); });
    var same = arr.length === S.sel.length && arr.every(function (el, i) { return el === S.sel[i]; });
    S.sel = arr;
    if (!same || !silent) postSelect();
    postRects();
  }
  function toggleSel(el) {
    var a = S.sel.slice(), i = a.indexOf(el);
    if (i >= 0) a.splice(i, 1); else a.push(el);
    setSel(a);
  }
  function postSelect() {
    var p = S.sel[S.sel.length - 1];
    post('select', { ids: S.sel.map(idOf), count: S.sel.length, info: p ? info(p) : null, editing: S.editing ? idOf(S.editing) : null });
  }
  var rectsQueued = false, lastRectSig = '';
  function postRects() {
    if (rectsQueued) return;
    rectsQueued = true;
    var go = function () {
      rectsQueued = false;
      var d = {
        sel: S.sel.map(rectOf),
        hover: S.hover && S.hover.isConnected && S.sel.indexOf(S.hover) < 0 ? rectOf(S.hover) : null,
        hoverLabel: S.hover ? labelOf(S.hover) : '',
        editing: S.editing ? rectOf(S.editing) : null
      };
      lastRectSig = JSON.stringify(d.sel);
      post('rects', d);
    };
    setTimeout(go, 12);
  }
  setInterval(function () {
    if (!S.ready || !S.sel.length || rectsQueued) return;
    var sig = JSON.stringify(S.sel.map(rectOf));
    if (sig !== lastRectSig) postRects();
  }, 400);
  W.addEventListener('scroll', function () { postRects(); }, true);
  W.addEventListener('resize', function () {
    if (S.ready && !S.docMode && S.cur && S.kind !== 'reveal') { checkTall(); post('slide', { index: S.slideIdx, id: idOf(S.cur), tall: S.tallH, W: S.W, H: S.H, notes: notesOf(S.cur), resize: true }); }
    postRects();
  });

  /* ------------------------------------------------------------------ *
   * 11. picking: what does a click select?
   *     first click  → the outermost visual box under the pointer
   *                    (card, shape, image...), else the text block
   *     click again  → one level deeper (handled on pointer-up)
   *     ⌘/Ctrl click → deepest element directly
   * ------------------------------------------------------------------ */
  function pick(target, ev) {
    var scope = scopeEl();
    if (!scope) return null;
    var el = nearestCanon(target);
    var m = ev ? mediaAt(ev.clientX, ev.clientY) : null;
    if (m && (!el || el === scope || !scope.contains(el) || isWrapper(el, scope) || el.contains(m))) el = m;
    if (!el || el === scope || !scope.contains(el)) return null;
    if (ev && (ev.metaKey || ev.ctrlKey)) return blockOf(el, scope);
    var chain = chainOf(el, scope);
    if (!chain.length) return null;
    var sr = scope.getBoundingClientRect(), deep = chain[chain.length - 1];
    var fl = chain.filter(function (n) { return n === deep || !isWrapper(n, scope, sr); });
    if (S.sel.length === 1 && fl.indexOf(S.sel[0]) >= 0) return S.sel[0];
    for (var k = 0; k < fl.length; k++) if (isVisual(fl[k])) return fl[k];
    return blockOf(deep, scope);
  }
  function drillFrom(cur, target, ev) {
    var el = nearestCanon(target);
    var m = ev ? mediaAt(ev.clientX, ev.clientY) : null;
    if (m && cur.contains(m) && m !== cur) el = m;
    if (!el || el === cur || !cur.contains(el)) return null;
    var chain = chainOf(el, cur);
    if (!chain.length) return null;
    for (var i = 0; i < chain.length; i++) if (isVisual(chain[i]) || hasDirectText(chain[i])) return blockOf(chain[i], cur);
    return blockOf(chain[chain.length - 1], cur);
  }
  function hoverTarget(target, ev) {
    if (S.sel.length === 1 && S.sel[0].contains(target)) return drillFrom(S.sel[0], target, ev) || null;
    return pick(target, ev);
  }

  /* ------------------------------------------------------------------ *
   * 12. event interception
   * ------------------------------------------------------------------ */
  var H = Object.create(null);
  var BLOCK = ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'dragstart', 'drag', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop', 'focusin', 'focusout', 'input', 'beforeinput', 'change', 'submit', 'reset', 'copy', 'cut', 'paste', 'selectstart', 'compositionstart', 'compositionupdate', 'compositionend'];
  var PREVENT = { click: 1, dblclick: 1, auxclick: 1, contextmenu: 1, dragstart: 1, drop: 1, dragover: 1, submit: 1, reset: 1, selectstart: 1 };
  var EDIT_PASS = { keydown: 1, keyup: 1, keypress: 1, input: 1, beforeinput: 1, mousedown: 1, mouseup: 1, click: 1, dblclick: 1, pointerdown: 1, pointerup: 1, pointermove: 1, selectstart: 1, copy: 1, cut: 1, paste: 1, contextmenu: 1, compositionstart: 1, compositionupdate: 1, compositionend: 1, focusin: 1, focusout: 1 };
  function inEditing(t) {
    if (!S.editing || !t) return false;
    var n = t.nodeType === 1 ? t : t.parentNode;
    return !!n && S.editing.contains(n);
  }
  function route(type, e) {
    if (S.mode === 'interact') {
      if (type === 'keydown') {
        var mod = e.metaKey || e.ctrlKey;
        if (e.key === 'Escape' || (mod && /^(KeyS|KeyO|KeyZ|KeyY|KeyP|Equal|Minus|Digit0|Enter)$/.test(e.code))) {
          e.preventDefault(); e.stopImmediatePropagation(); fwdKey(e);
        }
      }
      return;
    }
    if (!S.ready) { e.stopImmediatePropagation(); if (PREVENT[type] && e.cancelable) e.preventDefault(); return; }
    var ie = inEditing(e.target), h = H[type];
    if (h) { try { h(e, ie); } catch (x) { if (errors.length < 30) errors.push('bridge ' + type + ': ' + x.message); } }
    e.stopImmediatePropagation();
    if (ie && EDIT_PASS[type]) return;
    if (PREVENT[type] && e.cancelable) e.preventDefault();
  }
  BLOCK.forEach(function (type) {
    W.addEventListener(type, function (e) { route(type, e); }, { capture: true, passive: false });
  });

  function fwdKey(e) {
    post('key', { key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
  }

  /* pointer: select / drill / drag / marquee */
  var P = null;
  H.pointerdown = function (e, ie) {
    if (e.button !== 0) return;
    if (ie) return;
    if (S.editing) exitText(true);
    flushPending();
    var scope = scopeEl();
    if (!scope) return;
    var media = mediaAt(e.clientX, e.clientY);
    var hitSel = null;
    for (var i = 0; i < S.sel.length; i++) {
      if (S.sel[i].contains(e.target) || S.sel[i] === media) { hitSel = S.sel[i]; break; }
    }
    if (e.shiftKey) {
      var t = pick(e.target, e);
      if (t) toggleSel(t);
      P = null;
      return;
    }
    if (hitSel) {
      P = { kind: 'press', x0: e.clientX, y0: e.clientY, drill: S.sel.length === 1 ? drillFrom(hitSel, e.target, e) : null };
    } else {
      var el = pick(e.target, e);
      if (!el) { setSel([]); P = { kind: 'marquee', x0: e.clientX, y0: e.clientY }; }
      else { setSel([el]); P = { kind: 'press', x0: e.clientX, y0: e.clientY, drill: null }; }
    }
    try { DE.setPointerCapture(e.pointerId); } catch (x) {}
  };
  H.pointermove = function (e, ie) {
    if (P) {
      var dx = e.clientX - P.x0, dy = e.clientY - P.y0;
      if (P.kind === 'press' && S.sel.length && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) beginDrag(P);
      if (P.kind === 'drag') moveDrag(dx, dy, e);
      else if (P.kind === 'marquee') moveMarquee(e);
      return;
    }
    if (ie || S.editing) return;
    scheduleHover(e);
  };
  H.pointerup = function (e) {
    var p = P; P = null;
    try { DE.releasePointerCapture(e.pointerId); } catch (x) {}
    if (!p) return;
    if (p.kind === 'drag') endDrag(p);
    else if (p.kind === 'marquee') endMarquee(p);
    else if (p.kind === 'press' && p.drill) setSel([p.drill]);
  };
  H.pointercancel = function () { if (P && P.kind === 'drag') endDrag(P); P = null; post('marquee', null); };
  H.pointerout = function (e) { if (!e.relatedTarget && !P) { S.hover = null; postRects(); } };

  var hoverEv = null, hoverQueued = false;
  function scheduleHover(e) {
    hoverEv = { target: e.target, clientX: e.clientX, clientY: e.clientY, metaKey: e.metaKey, ctrlKey: e.ctrlKey };
    if (hoverQueued) return;
    hoverQueued = true;
    setTimeout(function () {
      hoverQueued = false;
      if (!hoverEv || P || S.editing) return;
      var h = hoverTarget(hoverEv.target, hoverEv);
      if (h !== S.hover) { S.hover = h; postRects(); }
    }, 16);
  }

  /* drag-move with snapping */
  function movable(el) { return el && el !== S.cur && el !== D.body && el !== DE && isCanon(el); }
  function prepMove(el) {
    var st = cs(el), pos = st.position, it = { el: el, id: idOf(el), newPos: null, clearR: false, clearB: false };
    if (pos === 'static' || pos === 'sticky') { it.newPos = 'relative'; it.l0 = 0; it.t0 = 0; }
    else {
      it.l0 = st.left !== 'auto' ? parseFloat(st.left) || 0 : (pos === 'relative' ? 0 : el.offsetLeft);
      it.t0 = st.top !== 'auto' ? parseFloat(st.top) || 0 : (pos === 'relative' ? 0 : el.offsetTop);
      if (pos !== 'relative') { it.clearR = st.right !== 'auto'; it.clearB = st.bottom !== 'auto'; }
    }
    return it;
  }
  function applyMove(it, dx, dy) {
    if (it.newPos) it.el.style.position = it.newPos;
    it.el.style.left = Math.round(it.l0 + dx) + 'px';
    it.el.style.top = Math.round(it.t0 + dy) + 'px';
    if (it.clearR) it.el.style.right = 'auto';
    if (it.clearB) it.el.style.bottom = 'auto';
  }
  function moveOp(it) {
    var set = { left: it.el.style.left, top: it.el.style.top };
    if (it.newPos) set.position = it.newPos;
    if (it.clearR) set.right = 'auto';
    if (it.clearB) set.bottom = 'auto';
    return { t: 'css', id: it.id, set: set };
  }
  function unionRect(els) {
    var l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    els.forEach(function (el) { var q = el.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
    return { x: l, y: t, w: r - l, h: b - t };
  }
  function snapCands(moving) {
    var scope = scopeEl(), sr = scope.getBoundingClientRect(), xs = [], ys = [];
    if (!S.docMode) { xs.push(sr.left, sr.left + sr.width / 2, sr.right); ys.push(sr.top, sr.top + sr.height / 2, sr.bottom); }
    var all = scope.querySelectorAll('*'), n = Math.min(all.length, 700), sa = area(sr);
    for (var i = 0; i < n; i++) {
      var e = all[i];
      if (SKIP[tagOf(e)] || !isCanon(e)) continue;
      var skip = false;
      for (var k = 0; k < moving.length; k++) if (moving[k] === e || moving[k].contains(e) || e.contains(moving[k])) { skip = true; break; }
      if (skip) continue;
      var r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || area(r) > 0.8 * sa) continue;
      xs.push(r.left, r.left + r.width / 2, r.right);
      ys.push(r.top, r.top + r.height / 2, r.bottom);
    }
    return { xs: xs, ys: ys, sr: sr };
  }
  function snapAxis(vals, cands, th) {
    var best = null;
    for (var i = 0; i < vals.length; i++) for (var j = 0; j < cands.length; j++) {
      var d = cands[j] - vals[i];
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: cands[j] };
    }
    return best;
  }
  function beginDrag(p) {
    var items = S.sel.filter(movable).map(prepMove);
    if (!items.length) { p.kind = 'none'; return; }
    p.kind = 'drag'; p.items = items;
    p.bbox = unionRect(items.map(function (it) { return it.el; }));
    p.cands = S.opts.snap ? snapCands(items.map(function (it) { return it.el; })) : null;
    S.hover = null;
  }
  function moveDrag(dx, dy, e) {
    var guides = [];
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (p_snapOn(e) && P.cands) {
      var b = P.bbox, th = 6 / (S.opts.zoom || 1), sr = P.cands.sr;
      var sx = snapAxis([b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w], P.cands.xs, th);
      var sy = snapAxis([b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h], P.cands.ys, th);
      if (sx && !(e.shiftKey && dx === 0)) { dx += sx.d; guides.push({ x: sx.at, y1: S.docMode ? 0 : sr.top, y2: S.docMode ? W.innerHeight : sr.bottom }); }
      if (sy && !(e.shiftKey && dy === 0)) { dy += sy.d; guides.push({ y: sy.at, x1: S.docMode ? 0 : sr.left, x2: S.docMode ? W.innerWidth : sr.right }); }
    }
    P.items.forEach(function (it) { applyMove(it, dx, dy); });
    post('guides', guides);
    postRects();
  }
  function p_snapOn(e) { return S.opts.snap && !(e.metaKey || e.ctrlKey); }
  function endDrag(p) {
    post('guides', []);
    if (!p.items) return;
    post('commit', { ops: p.items.map(moveOp), label: p.items.length > 1 ? '요소 ' + p.items.length + '개 이동' : '이동' });
    postSelect(); postRects();
  }

  /* marquee */
  function normRect(x0, y0, x1, y1) { return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; }
  function moveMarquee(e) { P.rect = normRect(P.x0, P.y0, e.clientX, e.clientY); post('marquee', P.rect); }
  function topBoxes(scope) {
    var out = [], sr = scope.getBoundingClientRect();
    (function walk(node, depth) {
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
        if (SKIP[tagOf(c)]) continue;
        if (!isCanon(c)) continue;
        var r = c.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue;
        if (depth < 6 && c.children.length && (isWrapper(c, scope, sr) || (!isVisual(c) && !hasDirectText(c)))) walk(c, depth + 1);
        else out.push(c);
      }
    })(scope, 0);
    return out;
  }
  function endMarquee(p) {
    post('marquee', null);
    if (!p.rect || (p.rect.w < 4 && p.rect.h < 4)) return;
    var m = p.rect;
    function inside(r) { return r.left >= m.x - 1 && r.top >= m.y - 1 && r.right <= m.x + m.w + 1 && r.bottom <= m.y + m.h + 1; }
    function hits(r) { return r.right > m.x && r.left < m.x + m.w && r.bottom > m.y && r.top < m.y + m.h; }
    var out = [];
    // fully covered boxes; for boxes only partly covered, look for fully covered children
    (function collect(list, depth) {
      list.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (inside(r)) { out.push(el); return; }
        if (depth > 0 && hits(r)) collect(Array.prototype.filter.call(el.children, function (c) { return selectable(c); }), depth - 1);
      });
    })(topBoxes(scopeEl()), 4);
    setSel(out);
  }

  /* double-click: text editing / image replace */
  function textBlockAt(x, y, scope) {
    var n = null;
    try { var r = D.caretRangeFromPoint ? D.caretRangeFromPoint(x, y) : null; n = r && r.startContainer; } catch (e) {}
    var el = n ? (n.nodeType === 3 ? n.parentElement : n) : null;
    if (!el) return null;
    while (el && el !== scope && el !== DE && (!isCanon(el) || isInlineEl(el))) el = el.parentElement;
    if (!el || el === scope || el === D.body || el === DE) return null;
    if (!(el.textContent || '').trim()) return null;
    return el;
  }
  H.dblclick = function (e, ie) {
    if (ie || S.editing) return;
    var scope = scopeEl();
    // pointer capture retargets click/dblclick to <html>; resolve the real element by position
    var hit = D.elementFromPoint(e.clientX, e.clientY) || e.target;
    var t = nearestCanon(hit);
    var media = mediaAt(e.clientX, e.clientY);
    if (media) { setSel([media]); post('dbl', { id: idOf(media), kind: 'media' }); return; }
    if (t && tagOf(t) === 'IMG') { setSel([t]); post('dbl', { id: idOf(t), kind: 'image' }); return; }
    var blk = textBlockAt(e.clientX, e.clientY, scope);
    if (blk && inScope(blk)) { enterText(blk, e.clientX, e.clientY); return; }
    if (t && inScope(t) && canEditText(t)) enterText(t, e.clientX, e.clientY);
  };
  H.contextmenu = function (e, ie) {
    if (ie) return; // native menu inside text editing (spelling, paste…)
    var el = pick(e.target, e);
    var inSel = S.sel.some(function (s) { return s === el || s.contains(e.target); });
    if (!inSel) setSel(el ? [el] : []);
    var sr = S.cur && !S.docMode ? S.cur.getBoundingClientRect() : { left: 0, top: 0 };
    post('context', { x: e.clientX, y: e.clientY, pt: { x: Math.round(e.clientX - sr.left), y: Math.round(e.clientY - sr.top) }, empty: !el && !inSel, cell: cellInfo(nearestCanon(e.target)), img: el && tagOf(el) === 'IMG' ? idOf(el) : null });
  };
  H.wheel = function (e) {
    if (e.ctrlKey || e.metaKey) { if (e.cancelable) e.preventDefault(); post('zoom', { dy: e.deltaY, x: e.clientX, y: e.clientY }); }
  };

  /* keyboard */
  H.keydown = function (e, ie) {
    var k = e.key, mod = e.metaKey || e.ctrlKey, code = e.code || '';
    if (S.editing) {
      if (!ie) { exitText(true); }
      else {
        if (k === 'Escape') { e.preventDefault(); exitText(true); return; }
        if (mod && !e.altKey) {
          if (code === 'KeyB' || code === 'KeyI' || code === 'KeyU') { e.preventDefault(); execCmd({ cmd: code === 'KeyB' ? 'bold' : code === 'KeyI' ? 'italic' : 'underline' }); return; }
          if (code === 'KeyS' || code === 'KeyO' || code === 'KeyP' || k === 'Enter' || code === 'KeyK') { e.preventDefault(); fwdKey(e); return; }
          return; // native copy/paste/undo/select-all inside the text
        }
        if (k === 'Enter' && !e.isComposing && (e.shiftKey || leafText(S.editing))) { e.preventDefault(); D.execCommand('insertLineBreak'); return; }
        if (k === 'Tab') { e.preventDefault(); exitText(true); return; }
        return; // typing
      }
    }
    if (mod && !e.altKey && (code === 'KeyC' || code === 'KeyX' || code === 'KeyV')) return; // native clipboard events follow
    if (e.cancelable) e.preventDefault();
    if (!mod && !e.altKey && /^Arrow/.test(k) && S.sel.length) { nudge(k, e.shiftKey ? 10 : 1); return; }
    if (!mod && k === 'Enter' && S.sel.length === 1) { enterText(S.sel[0], null, null, true); return; }
    if (!mod && k === 'Escape' && S.sel.length) { setSel([]); return; }
    if (!mod && k === 'Tab' && S.sel.length === 1) { cycleSibling(e.shiftKey ? -1 : 1); return; }
    fwdKey(e);
  };
  function cycleSibling(dir) {
    var el = S.sel[0], p = el.parentElement;
    if (!p) return;
    var sib = Array.prototype.filter.call(p.children, function (c) { return selectable(c); });
    var i = sib.indexOf(el);
    if (i < 0 || sib.length < 2) return;
    setSel([sib[(i + dir + sib.length) % sib.length]]);
  }

  /* clipboard */
  function viewOnlyStrip(root) {
    var attrs = ['data-ed-editing', 'data-ed-reveal', 'data-ed-current', 'data-ed-chain', 'data-ed-shown', 'data-ed-tall', 'data-ed-measure', 'data-ed-slide', 'data-ed-snap', 'data-ed-snapreveal'];
    var list = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    list.forEach(function (n) { attrs.forEach(function (a) { if (n.hasAttribute(a)) n.removeAttribute(a); }); });
    return root;
  }
  function cleanOuter(el) {
    var c = viewOnlyStrip(el.cloneNode(true));
    if (el === S.editing) { c.removeAttribute('contenteditable'); c.removeAttribute('spellcheck'); }
    return c.outerHTML;
  }
  function clipOut(e, cut) {
    var token = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try {
      e.clipboardData.setData('text/html', '<' + '!--le-clip:' + token + '--' + '>' + S.sel.map(cleanOuter).join(''));
      e.clipboardData.setData('text/plain', S.sel.map(function (el) { return (el.innerText || '').trim(); }).join('\n'));
    } catch (x) {}
    post('clip', { token: token, ids: S.sel.map(idOf), cut: !!cut });
  }
  H.copy = function (e, ie) { if (ie || !S.sel.length) return; if (e.cancelable) e.preventDefault(); clipOut(e, false); };
  H.cut = function (e, ie) { if (ie || !S.sel.length) return; if (e.cancelable) e.preventDefault(); clipOut(e, true); };
  function readFile(f, cb) { var fr = new FileReader(); fr.onload = function () { cb(fr.result, f.name || 'image'); }; fr.readAsDataURL(f); }
  H.paste = function (e, ie) {
    var cd = e.clipboardData;
    if (!cd) return;
    if (ie) {
      if (e.cancelable) e.preventDefault();
      var txt = cd.getData('text/plain');
      if (txt) D.execCommand('insertText', false, txt);
      return;
    }
    if (e.cancelable) e.preventDefault();
    var items = cd.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        if (f) { readFile(f, function (url, name) { post('paste', { kind: 'image', data: url, name: name }); }); return; }
      }
    }
    var html = cd.getData('text/html'), text = cd.getData('text/plain');
    var m = html && new RegExp('<' + '!--le-clip:([a-z0-9]+)--' + '>').exec(html);
    if (m) post('paste', { kind: 'clip', token: m[1], html: html });
    else if (html) post('paste', { kind: 'html', html: html, text: text });
    else if (text) post('paste', { kind: 'text', text: text });
  };
  H.drop = function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/^image\//.test(f.type)) readFile(f, function (url, name) { post('paste', { kind: 'image', data: url, name: name, drop: true }); });
    else if (/\.x?html?$/i.test(f.name) || /html/.test(f.type || '')) { var fr = new FileReader(); fr.onload = function () { post('dropfile', { name: f.name, text: String(fr.result) }); }; fr.readAsText(f); }
    else post('dropfile', { name: f.name });
  };

  /* ------------------------------------------------------------------ *
   * 13. text editing
   * ------------------------------------------------------------------ */
  function canEditText(el) { return !!el && !VOID_TEXT[tagOf(el)] && !(el instanceof SVGElement) && el !== D.body && el !== DE; }
  function leafText(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      var d = cs(c).display;
      if (d !== 'inline' && d !== 'inline-block' && tagOf(c) !== 'BR') return false;
    }
    return true;
  }
  function enterText(el, x, y, selectAll) {
    if (!el || !isCanon(el) || !canEditText(el)) return false;
    if (S.editing === el) return true;
    if (S.editing) exitText(true);
    flushPending();
    if (S.sel.length !== 1 || S.sel[0] !== el) { S.sel = [el]; }
    S.editing = el; S.edit0 = el.innerHTML; S.hover = null;
    S.editCE = el.getAttribute('contenteditable'); S.editSC = el.getAttribute('spellcheck');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-ed-editing', '');
    try { D.execCommand('styleWithCSS', false, true); } catch (e) {}
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    var s = W.getSelection();
    try {
      var r = null;
      if (x != null && D.caretRangeFromPoint) { r = D.caretRangeFromPoint(x, y); if (r && !el.contains(r.startContainer)) r = null; }
      if (!r) { r = D.createRange(); r.selectNodeContents(el); if (!selectAll) r.collapse(false); }
      s.removeAllRanges(); s.addRange(r);
      S.editRange = r.cloneRange();
    } catch (e) {}
    postSelect(); postText(); postRects();
    return true;
  }
  function fixIds(live) {
    // Chrome copies attributes (data-ed-id too) when splitting nodes on Enter:
    // give duplicates and brand-new elements fresh ids.
    var seen = Object.create(null), news = [];
    var all = live.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var n = all[i], id = n.getAttribute('data-ed-id');
      var other = id ? byId(id) : null;
      if (!id || seen[id] || (other && other !== n && !live.contains(other))) {
        var nid = genId();
        n.setAttribute('data-ed-id', nid);
        canon.set(nid, n);
        news.push(nid);
        id = nid;
      }
      seen[id] = 1;
    }
    return news;
  }
  function exitText(commit) {
    var el = S.editing;
    if (!el) return;
    S.editing = null; S.editRange = null;
    el.removeAttribute('data-ed-editing');
    if (S.editCE == null) el.removeAttribute('contenteditable'); else el.setAttribute('contenteditable', S.editCE);
    if (S.editSC == null) el.removeAttribute('spellcheck'); else el.setAttribute('spellcheck', S.editSC);
    try { W.getSelection().removeAllRanges(); } catch (e) {}
    if (commit !== false && el.isConnected && el.innerHTML !== S.edit0) {
      fixIds(el);
      var c = viewOnlyStrip(el.cloneNode(true));
      post('commit', { ops: [{ t: 'html', id: idOf(el), html: c.innerHTML }], label: '텍스트 편집' });
    }
    postText(); postSelect(); postRects();
  }
  function formats() {
    var f = { bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, collapsed: true };
    try { var sl = W.getSelection(); f.collapsed = !sl || !sl.rangeCount || sl.isCollapsed; } catch (e) {}
    try {
      f.bold = D.queryCommandState('bold'); f.italic = D.queryCommandState('italic');
      f.underline = D.queryCommandState('underline'); f.strike = D.queryCommandState('strikeThrough');
      f.ul = D.queryCommandState('insertUnorderedList'); f.ol = D.queryCommandState('insertOrderedList');
    } catch (e) {}
    try {
      var s = W.getSelection(), n = s && s.anchorNode;
      var el = n ? (n.nodeType === 3 ? n.parentElement : n) : S.editing;
      if (el && S.editing && S.editing.contains(el)) {
        var st = cs(el);
        f.color = st.color; f.size = st.fontSize; f.font = st.fontFamily; f.weight = st.fontWeight; f.align = cs(S.editing).textAlign;
      }
    } catch (e) {}
    return f;
  }
  var textQueued = false;
  function postText() {
    if (textQueued) return;
    textQueued = true;
    setTimeout(function () {
      textQueued = false;
      post('text', S.editing ? { editing: true, id: idOf(S.editing), f: formats() } : { editing: false });
    }, 30);
  }
  D.addEventListener('selectionchange', function () {
    if (!S.editing) return;
    try {
      var s = W.getSelection();
      if (s.rangeCount && S.editing.contains(s.getRangeAt(0).commonAncestorContainer)) S.editRange = s.getRangeAt(0).cloneRange();
    } catch (e) {}
    postText();
    postRects();
  });
  function restoreRange() {
    if (!S.editing) return;
    try {
      if (D.activeElement !== S.editing) S.editing.focus({ preventScroll: true });
      if (S.editRange) { var s = W.getSelection(); s.removeAllRanges(); s.addRange(S.editRange); }
    } catch (e) {}
  }
  function wrapSel(prop, val) {
    restoreRange();
    var s = W.getSelection();
    if (!s.rangeCount) return false;
    var r = s.getRangeAt(0);
    if (r.collapsed || !S.editing.contains(r.commonAncestorContainer)) return false;
    var span = D.createElement('span');
    span.style.setProperty(prop, val);
    try { span.appendChild(r.extractContents()); r.insertNode(span); } catch (e) { return false; }
    var inner = span.querySelectorAll('span');
    for (var i = 0; i < inner.length; i++) {
      var sp = inner[i];
      if (sp.style.getPropertyValue(prop)) {
        sp.style.removeProperty(prop);
        if (!sp.getAttribute('style') && !sp.attributes.length) { while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.remove(); }
        else if (!sp.getAttribute('style')) sp.removeAttribute('style');
      }
    }
    s.removeAllRanges();
    var nr = D.createRange(); nr.selectNodeContents(span); s.addRange(nr);
    S.editRange = nr.cloneRange();
    postText(); postRects();
    return true;
  }
  function execCmd(a) {
    if (!S.editing) return false;
    var c = a.cmd, v = a.value;
    if (c === 'fontSize') return wrapSel('font-size', v);
    if (c === 'fontName') return wrapSel('font-family', v);
    restoreRange();
    try {
      D.execCommand('styleWithCSS', false, true);
      D.execCommand(c, false, v == null ? null : v);
    } catch (e) { return false; }
    postText(); postRects();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 14. geometry edits computed here, reported as ops
   * ------------------------------------------------------------------ */
  var pend = null;
  function flushPending() {
    if (!pend) return;
    var p = pend; pend = null;
    clearTimeout(p.timer);
    post('commit', { ops: Object.keys(p.ops).map(function (k) { return p.ops[k]; }), label: p.label });
  }
  function moveItems(items, dxs, dys, label, defer) {
    // drop elements that would not move (no style noise in the saved file)
    var keep = [];
    items.forEach(function (it, i) { if (Math.abs(dxs[i]) >= 0.5 || Math.abs(dys[i]) >= 0.5) keep.push(i); });
    if (!keep.length) { post('notice', { text: '이미 맞춰져 있습니다.' }); return; }
    items = keep.map(function (i) { return items[i]; }); dxs = keep.map(function (i) { return dxs[i]; }); dys = keep.map(function (i) { return dys[i]; });
    items.forEach(function (it, i) { applyMove(it, dxs[i], dys[i]); });
    var ops = items.map(moveOp);
    if (defer) {
      if (!pend) pend = { ops: {}, label: label };
      ops.forEach(function (o) { var prev = pend.ops[o.id]; pend.ops[o.id] = prev ? { t: 'css', id: o.id, set: Object.assign({}, prev.set, o.set) } : o; });
      clearTimeout(pend.timer);
      pend.timer = setTimeout(flushPending, 650);
    } else post('commit', { ops: ops, label: label });
    postRects();
    postSelect();
  }
  function nudge(key, d) {
    var dx = key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0;
    var dy = key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0;
    var items = S.sel.filter(movable).map(prepMove);
    if (!items.length) return;
    moveItems(items, items.map(function () { return dx; }), items.map(function () { return dy; }), '이동', true);
  }

  /* resize (handles live in the shell; it streams pointer deltas here) */
  var RZ = null;
  function rzPrep() {
    if (RZ.prepared) return;
    RZ.prepared = true;
    var el = RZ.el, st = cs(el), t = RZ.touch;
    function set(p, v) { el.style.setProperty(p, v); t[p] = v; }
    if (st.boxSizing !== 'border-box') set('box-sizing', 'border-box');
    if (RZ.isMedia) return;
    if (st.display === 'inline') set('display', 'inline-block');
    if (el.parentElement && /flex/.test(cs(el.parentElement).display)) set('flex', '0 0 auto');
    if (st.maxWidth !== 'none') set('max-width', 'none');
    if (st.maxHeight !== 'none') set('max-height', 'none');
    if (parseFloat(st.minWidth) > 0) set('min-width', '0');
    if (parseFloat(st.minHeight) > 0) set('min-height', '0');
  }
  CMD.resizeStart = function (a) {
    var el = S.sel.length === 1 ? S.sel[0] : null;
    if (!el || !movable(el)) { RZ = null; return false; }
    if (S.editing) exitText(true);
    var st = cs(el), r = el.getBoundingClientRect(), t = tagOf(el);
    var w0 = el.offsetWidth || r.width, h0 = el.offsetHeight || r.height;
    RZ = { el: el, id: idOf(el), dir: a.dir, w0: w0, h0: h0, ratio: h0 ? w0 / h0 : 1, pos: st.position, touch: {},
      isMedia: t === 'IMG' || t === 'VIDEO' || t === 'SVG' || t === 'CANVAS' || t === 'IFRAME' || t === 'PICTURE',
      l0: st.left !== 'auto' ? parseFloat(st.left) || 0 : (st.position === 'relative' || st.position === 'static' ? 0 : el.offsetLeft),
      t0: st.top !== 'auto' ? parseFloat(st.top) || 0 : (st.position === 'relative' || st.position === 'static' ? 0 : el.offsetTop),
      cands: S.opts.snap ? snapCands([el]) : null, r0: { x: r.left, y: r.top, w: r.width, h: r.height } };
    return true;
  };
  CMD.resizeMove = function (a) {
    if (!RZ) return;
    rzPrep();
    var d = RZ.dir, el = RZ.el, dx = a.dx, dy = a.dy;
    var E = d.indexOf('e') >= 0, Wst = d.indexOf('w') >= 0, N = d.indexOf('n') >= 0, So = d.indexOf('s') >= 0;
    var guides = [];
    if (RZ.cands && !a.nosnap) {
      var th = 6 / (S.opts.zoom || 1), r0 = RZ.r0, sr = RZ.cands.sr;
      if (E) { var sx = snapAxis([r0.x + r0.w + dx], RZ.cands.xs, th); if (sx) { dx += sx.d; guides.push({ x: sx.at, y1: sr.top, y2: sr.bottom }); } }
      if (Wst) { var sw = snapAxis([r0.x + dx], RZ.cands.xs, th); if (sw) { dx += sw.d; guides.push({ x: sw.at, y1: sr.top, y2: sr.bottom }); } }
      if (So) { var sy = snapAxis([r0.y + r0.h + dy], RZ.cands.ys, th); if (sy) { dy += sy.d; guides.push({ y: sy.at, x1: sr.left, x2: sr.right }); } }
      if (N) { var sn = snapAxis([r0.y + dy], RZ.cands.ys, th); if (sn) { dy += sn.d; guides.push({ y: sn.at, x1: sr.left, x2: sr.right }); } }
    }
    var k = a.alt ? 2 : 1;
    var w = RZ.w0 + (E ? dx * k : 0) - (Wst ? dx * k : 0);
    var h = RZ.h0 + (So ? dy * k : 0) - (N ? dy * k : 0);
    w = Math.max(4, w); h = Math.max(4, h);
    var corner = (E || Wst) && (N || So);
    var keep = corner && (RZ.isMedia ? !a.shift : a.shift);
    if (keep) { if (Math.abs(w - RZ.w0) / RZ.w0 >= Math.abs(h - RZ.h0) / RZ.h0) h = w / RZ.ratio; else w = h * RZ.ratio; }
    var t = RZ.touch;
    function set(p, v) { el.style.setProperty(p, v); t[p] = v; }
    if (E || Wst || keep) set('width', Math.round(w) + 'px');
    if (N || So || keep) set('height', Math.round(h) + 'px');
    if (RZ.isMedia && tagOf(el) === 'IMG' && (E || Wst) && !(N || So) && !keep) set('height', 'auto');
    var needPos = Wst || N || a.alt;
    if (needPos) {
      if (RZ.pos === 'static' || RZ.pos === 'sticky') { set('position', 'relative'); }
      var ox = Wst ? (RZ.w0 - w) : 0, oy = N ? (RZ.h0 - h) : 0;
      if (a.alt) { ox = (RZ.w0 - w) / 2; oy = (RZ.h0 - h) / 2; }
      if (Wst || a.alt) set('left', Math.round(RZ.l0 + ox) + 'px');
      if (N || a.alt) set('top', Math.round(RZ.t0 + oy) + 'px');
    }
    post('guides', guides);
    post('size', { w: Math.round(w), h: Math.round(h) });
    postRects();
  };
  CMD.resizeEnd = function () {
    if (!RZ) return;
    var z = RZ; RZ = null;
    post('guides', []); post('size', null);
    if (!Object.keys(z.touch).length) return;
    post('commit', { ops: [{ t: 'css', id: z.id, set: z.touch }], label: '크기 조절' });
    postSelect(); postRects();
  };

  /* numeric position / size from the inspector */
  CMD.moveTo = function (a) {
    var el = S.sel[S.sel.length - 1];
    if (!movable(el)) return false;
    var sc = scopeEl(), sr = sc && sc !== D.body ? sc.getBoundingClientRect() : { left: 0, top: 0 };
    var r = el.getBoundingClientRect();
    var it = prepMove(el);
    var dx = a.x != null ? a.x - (r.left - sr.left) : 0, dy = a.y != null ? a.y - (r.top - sr.top) : 0;
    moveItems([it], [dx], [dy], '위치 변경', false);
    return true;
  };
  CMD.resizeTo = function (a) {
    var el = S.sel[S.sel.length - 1];
    if (!movable(el)) return false;
    CMD.resizeStart({ dir: 'se' });
    if (!RZ) return false;
    rzPrep();
    var w = a.w != null ? Math.max(4, a.w) : null, h = a.h != null ? Math.max(4, a.h) : null;
    if (a.keep && RZ.ratio) { if (w != null && h == null) h = w / RZ.ratio; else if (h != null && w == null) w = h * RZ.ratio; }
    if (w != null) { el.style.width = Math.round(w) + 'px'; RZ.touch.width = Math.round(w) + 'px'; }
    if (h != null) { el.style.height = Math.round(h) + 'px'; RZ.touch.height = Math.round(h) + 'px'; }
    CMD.resizeEnd();
    return true;
  };
  CMD.align = function (a) {
    var els = S.sel.filter(movable);
    if (!els.length) return false;
    var sc = scopeEl();
    var ref = (els.length > 1 && a.to !== 'slide') ? unionRect(els) : (function () { var q = sc.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; })();
    if (S.docMode && (els.length === 1 || a.to === 'slide')) {
      var p = els[0].parentElement.getBoundingClientRect(); ref = { x: p.left, y: p.top, w: p.width, h: p.height };
    }
    var items = els.map(prepMove), dxs = [], dys = [];
    els.forEach(function (el) {
      var r = el.getBoundingClientRect(), dx = 0, dy = 0;
      switch (a.mode) {
        case 'left': dx = ref.x - r.left; break;
        case 'hcenter': dx = ref.x + ref.w / 2 - (r.left + r.width / 2); break;
        case 'right': dx = ref.x + ref.w - r.right; break;
        case 'top': dy = ref.y - r.top; break;
        case 'vcenter': dy = ref.y + ref.h / 2 - (r.top + r.height / 2); break;
        case 'bottom': dy = ref.y + ref.h - r.bottom; break;
      }
      dxs.push(dx); dys.push(dy);
    });
    moveItems(items, dxs, dys, '정렬', false);
    return true;
  };
  CMD.distribute = function (a) {
    var els = S.sel.filter(movable);
    if (els.length < 3) return false;
    var hz = a.axis !== 'v';
    var rs = els.map(function (el) { var r = el.getBoundingClientRect(); return { el: el, a: hz ? r.left : r.top, s: hz ? r.width : r.height }; });
    rs.sort(function (p, q) { return p.a - q.a; });
    var first = rs[0], last = rs[rs.length - 1];
    var total = rs.reduce(function (s, r) { return s + r.s; }, 0);
    var gap = ((last.a + last.s) - first.a - total) / (rs.length - 1);
    var pos = first.a, items = [], dxs = [], dys = [];
    rs.forEach(function (r) {
      var d = pos - r.a;
      items.push(prepMove(r.el)); dxs.push(hz ? d : 0); dys.push(hz ? 0 : d);
      pos += r.s + gap;
    });
    moveItems(items, dxs, dys, '간격 맞춤', false);
    return true;
  };
  CMD.arrange = function (a) {
    var el = S.sel[S.sel.length - 1];
    if (!movable(el) || !el.parentElement) return false;
    var p = el.parentElement, st = cs(el), free = st.position === 'absolute' || st.position === 'fixed';
    var sibs = Array.prototype.filter.call(p.children, function (c) { return isCanon(c) && !SKIP[tagOf(c)]; });
    var i = sibs.indexOf(el), op = null, label = '';
    function mv(before) { return { t: 'move', id: idOf(el), parent: idOf(p), before: before ? idOf(before) : null }; }
    if (a.mode === 'forward') { if (i < sibs.length - 1) op = mv(sibs[i + 2] || null); label = '앞으로'; }
    else if (a.mode === 'backward') { if (i > 0) op = mv(sibs[i - 1]); label = '뒤로'; }
    else if (a.mode === 'front') {
      label = '맨 앞으로';
      if (free) { if (i < sibs.length - 1) op = mv(null); }
      else {
        var zs = sibs.filter(function (c) { return c !== el; }).map(function (c) { return parseInt(cs(c).zIndex, 10); }).filter(function (n) { return isFinite(n); });
        var set = { 'z-index': String((zs.length ? Math.max.apply(null, zs) : 0) + 1) };
        if (st.position === 'static') set.position = 'relative';
        op = { t: 'css', id: idOf(el), set: set };
      }
    } else if (a.mode === 'back') {
      label = '맨 뒤로';
      if (free) { if (i > 0) op = mv(sibs[0]); }
      else { var s2 = { 'z-index': '0' }; if (st.position === 'static') s2.position = 'relative'; op = { t: 'css', id: idOf(el), set: s2 }; }
    }
    if (!op) return false;
    applyOps([op]);
    post('commit', { ops: [op], label: '배치: ' + label });
    return true;
  };

  /* ------------------------------------------------------------------ *
   * 15. primitive ops from the shell
   * ------------------------------------------------------------------ */
  function setCss(el, p, v) {
    if (v === '' || v == null) { el.style.removeProperty(p); return; }
    var imp = /!\s*important\s*$/i.test(v);
    el.style.setProperty(p, String(v).replace(/\s*!\s*important\s*$/i, ''), imp ? 'important' : '');
  }
  function applyOps(ops) {
    var structural = false;
    (ops || []).forEach(function (op) {
      if (!op) return;
      try {
        var el = op.id ? byId(op.id) : null;
        switch (op.t) {
          case 'css':
            if (el) Object.keys(op.set || {}).forEach(function (p) { setCss(el, p, op.set[p]); });
            break;
          case 'attr':
            if (!el || op.name === 'data-ed-id') break;
            if (op.value == null) el.removeAttribute(op.name); else el.setAttribute(op.name, op.value);
            break;
          case 'html':
            if (!el) break;
            if (S.editing && (S.editing === el || el.contains(S.editing))) { S.editing = null; }
            el.innerHTML = op.html; regTree(el, true); structural = true;
            break;
          case 'insert':
            var p = byId(op.parent); if (!p) break;
            var tp = D.createElement('template'); tp.innerHTML = op.html;
            var node = tp.content.firstElementChild; if (!node) break;
            var b = op.before ? byId(op.before) : null; if (b && b.parentNode !== p) b = null;
            p.insertBefore(node, b); regTree(node, true); structural = true;
            break;
          case 'remove':
            if (!el) break;
            if (S.editing && el.contains(S.editing)) S.editing = null;
            el.remove(); structural = true;
            break;
          case 'move':
            if (!el) break;
            var mp = byId(op.parent); if (!mp) break;
            var mb = op.before ? byId(op.before) : null; if (mb && mb.parentNode !== mp) mb = null;
            if (mb === el) break;
            mp.insertBefore(el, mb); structural = true;
            break;
        }
      } catch (e) { if (errors.length < 30) errors.push('apply ' + op.t + ': ' + e.message); }
    });
    afterOps(structural);
  }
  function afterOps(structural) {
    S.sel = S.sel.filter(function (el) { return el.isConnected; });
    if (S.hover && !S.hover.isConnected) S.hover = null;
    if (structural && !S.docMode) refreshSlides();
    else if (!S.docMode && S.cur) { checkTall(); }
    postSelect(); postRects();
  }
  function listSlides() {
    if (S.kind === 'reveal') {
      try { if (W.Reveal.sync) W.Reveal.sync(); } catch (e) {}
      try { return W.Reveal.getSlides().filter(function (s) { return !s.querySelector('section') && isCanon(s); }); } catch (e) { return S.slides.filter(function (s) { return s.isConnected; }); }
    }
    if (S.slideSel) return outermost(qsa(S.slideSel).filter(isCanon));
    return S.slides.filter(function (s) { return s.isConnected; });
  }
  function refreshSlides() {
    var list = listSlides();
    list.forEach(function (s) { var id = idOf(s); if (!(id in S.origPos)) { var tmp = s.getAttribute('data-ed-current'); S.origPos[id] = tmp != null ? (S.origPos[idOf(S.cur)] || 'static') : cs(s).position; } });
    var changed = list.length !== S.slides.length || list.some(function (s, i) { return s !== S.slides[i]; });
    S.slides = list;
    markSlides(list);
    if (!list.length) { S.cur = null; S.slideIdx = -1; post('slides', { slides: [], index: -1 }); return; }
    var idx = S.cur ? list.indexOf(S.cur) : -1;
    if (changed) post('slides', { slides: list.map(slideMeta), index: idx >= 0 ? idx : clamp(S.slideIdx, 0, list.length - 1) });
    if (idx < 0) showSlide(clamp(S.slideIdx, 0, list.length - 1));
    else { S.slideIdx = idx; if (S.kind !== 'reveal' && !S.cur.hasAttribute('data-ed-current')) showSlide(idx, true); else checkTall(); }
  }

  /* ------------------------------------------------------------------ *
   * 16. snapshots (thumbnails, PDF/PNG export)
   *     html-to-image renders through an SVG foreignObject inside this
   *     document (html2canvas needs a nested frame, which a sandboxed
   *     opaque-origin document cannot script). Slides other than the
   *     current one are staged off-screen with the same isolation rules.
   * ------------------------------------------------------------------ */
  var libP = null, fontCSS = null;
  function loadLib() {
    if (W.htmlToImage) return Promise.resolve();
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var savedDefine = W.define;
      try { W.define = undefined; } catch (e) {}
      var s = D.createElement('script');
      s.src = CFG.h2i; s.async = true; s.setAttribute('data-le', '');
      s.onload = function () { try { W.define = savedDefine; } catch (e) {} if (W.htmlToImage) res(); else { libP = null; rej(new Error('html-to-image unavailable')); } };
      s.onerror = function () { try { W.define = savedDefine; } catch (e) {} libP = null; rej(new Error('그림 변환 라이브러리를 불러오지 못했습니다')); };
      (D.head || DE).appendChild(s);
    });
    return libP;
  }
  // a short timer, not requestAnimationFrame: rAF pauses in background tabs and would stall exports
  function frames(n) { return new Promise(function (res) { setTimeout(res, 16 * n + 8); }); }
  function buildsIn(el, on) {
    var all = el.querySelectorAll('*'), n = Math.min(all.length, 4000), out = [];
    for (var j = 0; j < n; j++) {
      var e = all[j];
      if (SKIP[tagOf(e)]) continue;
      if (!on) { if (e.hasAttribute('data-ed-snapreveal')) { e.removeAttribute('data-ed-snapreveal'); e.removeAttribute('data-ed-reveal'); } continue; }
      if (e.hasAttribute('data-ed-reveal')) continue;
      var st = cs(e);
      if (st.display === 'none') continue;
      if ((parseFloat(st.opacity) < 0.05 || st.visibility === 'hidden') && hasContent(e)) { e.setAttribute('data-ed-reveal', ''); e.setAttribute('data-ed-snapreveal', ''); out.push(e); }
    }
    return out;
  }
  function stage(target) {
    // put a non-current slide on an off-screen "stage" with the isolation rules
    var disp = natDisplay(target);
    var added = [];
    target.setAttribute('data-ed-snap', '');
    for (var p = target.parentElement; p; p = p.parentElement) {
      if (!p.hasAttribute('data-ed-chain')) { p.setAttribute('data-ed-chain', ''); added.push(p); }
      if (cs(p).display === 'none' && !p.hasAttribute('data-ed-shown')) { p.setAttribute('data-ed-shown', ''); added.push(p); }
    }
    var st = D.createElement('style');
    st.setAttribute('data-le', '');
    st.textContent = R + ' [data-ed-snap]{position:fixed!important;left:' + (-(S.W + 600)) + 'px!important;top:0!important;right:auto!important;bottom:auto!important;margin:0!important;transform:none!important;translate:none!important;scale:none!important;rotate:none!important;visibility:visible!important;opacity:1!important;filter:none!important;clip-path:none!important;display:' + disp + '!important;width:' + S.W + 'px!important;height:' + S.H + 'px!important;min-height:0!important;max-width:none!important;max-height:none!important;box-sizing:border-box!important;transition:none!important;animation:none!important;content-visibility:visible!important;zoom:1!important}' +
      R + ':not([data-ed-iso]) body{visibility:visible}' ;
    (D.head || DE).appendChild(st);
    var wasIso = DE.hasAttribute('data-ed-iso');
    if (!wasIso) DE.setAttribute('data-ed-iso', '');
    return function () {
      target.removeAttribute('data-ed-snap');
      added.forEach(function (n) { if (n !== S.cur && !(S.cur && n.contains(S.cur))) { n.removeAttribute('data-ed-chain'); } n.removeAttribute('data-ed-shown'); });
      if (S.cur) for (var q = S.cur.parentElement; q; q = q.parentElement) { if (cs(q).display === 'none') q.setAttribute('data-ed-shown', ''); }
      st.remove();
      if (!wasIso) DE.removeAttribute('data-ed-iso');
    };
  }
  /* SVG data images (noise textures with filters, icons) render black inside the
     SVG/foreignObject pipeline; rasterise them to PNG for the duration of a snapshot. */
  var rasterCache = new Map();
  function rasterize(url, w, hh) {
    var key = url + '|' + w + 'x' + hh;
    if (rasterCache.has(key)) return Promise.resolve(rasterCache.get(key));
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var cw = Math.max(1, Math.min(2048, Math.round(w || img.naturalWidth || 300)));
          var ch = Math.max(1, Math.min(2048, Math.round(hh || img.naturalHeight || 150)));
          var c = D.createElement('canvas'); c.width = cw; c.height = ch;
          c.getContext('2d').drawImage(img, 0, 0, cw, ch);
          var out = c.toDataURL('image/png');
          rasterCache.set(key, out); res(out);
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = url;
    });
  }
  function cssUrls(v) { // url(...) values, honouring quotes and nested parentheses
    var out = [], i = 0;
    while ((i = v.indexOf('url(', i)) >= 0) {
      i += 4;
      while (v[i] === ' ') i++;
      var q = v[i] === '"' || v[i] === "'" ? v[i] : null, j;
      if (q) { j = i + 1; while (j < v.length && !(v[j] === q && v[j - 1] !== '\\')) j++; out.push(v.slice(i + 1, j)); i = j + 1; }
      else { var depth = 0; j = i; while (j < v.length && !(v[j] === ')' && depth === 0)) { if (v[j] === '(') depth++; else if (v[j] === ')') depth--; j++; } out.push(v.slice(i, j).trim()); i = j + 1; }
    }
    return out;
  }
  function rasterSvgIn(root) {
    var list = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'), 0, 3000));
    var jobs = [], restores = [];
    list.forEach(function (el) {
      var bi = cs(el).backgroundImage;
      if (bi && bi.indexOf('data:image/svg+xml') >= 0) {
        var urls = cssUrls(bi).filter(function (u) { return u.indexOf('data:image/svg+xml') === 0; });
        if (!urls.length) return;
        jobs.push(Promise.all(urls.map(function (u) {
          var dims = /width=['"%2722]*([\d.]+)/i.exec(decodeURIComponent(u)), dimh = /height=['"%2722]*([\d.]+)/i.exec(decodeURIComponent(u));
          return rasterize(u, dims ? parseFloat(dims[1]) : 0, dimh ? parseFloat(dimh[1]) : 0).then(function (png) { return [u, png]; });
        })).then(function (pairs) {
          var nb = bi;
          pairs.forEach(function (p) { if (p[1]) nb = nb.split(p[0]).join(p[1]); });
          if (nb === bi) return;
          restores.push([el, 'background-image', el.style.getPropertyValue('background-image'), el.style.getPropertyPriority('background-image')]);
          el.style.setProperty('background-image', nb, 'important');
        }));
      }
      if (el.tagName === 'IMG' && /^data:image\/svg\+xml/i.test(el.currentSrc || el.src || '')) {
        var r = el.getBoundingClientRect();
        jobs.push(rasterize(el.currentSrc || el.src, r.width * 2 || 0, r.height * 2 || 0).then(function (png) {
          if (!png) return;
          restores.push([el, 'src', el.getAttribute('src')]);
          el.setAttribute('src', png);
        }));
      }
    });
    return Promise.all(jobs).then(function () {
      return function () {
        restores.forEach(function (r) {
          if (r[1] === 'src') r[0].setAttribute('src', r[2]);
          else if (r[2]) r[0].style.setProperty(r[1], r[2], r[3]); else r[0].style.removeProperty(r[1]);
        });
      };
    });
  }
  function bgColor(el) {
    var own = cs(el);
    if (alphaOf(own.backgroundColor) > 0.98) return own.backgroundColor;
    for (var n = el.parentElement; n; n = n.parentElement) {
      var st = cs(n);
      if (alphaOf(st.backgroundColor) > 0.02) return st.backgroundColor;
    }
    return '#ffffff';
  }
  function snap(a) {
    return loadLib().then(function () {
      var lib = W.htmlToImage, scale = a.scale || 0.2, type = a.type || 'image/jpeg';
      var node, w, hh, undo = null, extra = [];
      var common = { cacheBust: false, imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
        filter: function (n) { return !(n && n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.hasAttribute('data-le') || n.id === '__le_style' || n.id === '__le_dyn')); } };
      if (S.docMode || a.view) {
        node = D.body; w = W.innerWidth; hh = W.innerHeight;
        common.style = { transform: 'translate(' + (-W.scrollX) + 'px,' + (-W.scrollY) + 'px)', transformOrigin: '0 0' };
      } else {
        node = byId(a.id);
        if (!node) throw new Error('slide not found');
        w = S.W; hh = S.H;
        if (node !== S.cur || S.kind === 'reveal') undo = stage(node);
        extra = buildsIn(node, S.opts.builds);
        common.style = { position: 'relative', left: '0px', top: '0px', right: 'auto', bottom: 'auto', margin: '0px', transform: 'none', zIndex: 'auto' };
      }
      var bgc = bgColor(node);
      if (!S.docMode && !a.view && node.getAttribute('data-background-color')) bgc = node.getAttribute('data-background-color'); // reveal paints these on a separate layer
      var bgi = !S.docMode && !a.view ? node.getAttribute('data-background-image') : null;
      if (bgi && common.style) { common.style.backgroundImage = 'url("' + bgi + '")'; common.style.backgroundSize = node.getAttribute('data-background-size') || 'cover'; common.style.backgroundPosition = 'center'; }
      var opts = Object.assign({ width: w, height: hh, canvasWidth: Math.round(w * scale), canvasHeight: Math.round(hh * scale), pixelRatio: 1, backgroundColor: bgc }, common);
      var unraster = null;
      function cleanup() { if (unraster) unraster(); if (extra.length) buildsIn(node, false); if (undo) undo(); }
      var mark = function (k) { if (CFG.dev) { W.__leSnap = W.__leSnap || {}; W.__leSnap[k] = Date.now(); } };
      mark('start');
      return rasterSvgIn(node).then(function (u) { mark('raster'); unraster = u; return frames(2); }).then(function () { mark('frames');
        var fp = a.fonts ? (fontCSS ? Promise.resolve(fontCSS) : lib.getFontEmbedCSS(node).then(function (c) { fontCSS = c; return c; }).catch(function () { return ''; })) : Promise.resolve(null);
        return fp.then(function (css) {
          if (css != null) opts.fontEmbedCSS = css; else opts.skipFonts = true;
          return type === 'image/png' ? lib.toPng(node, opts) : lib.toJpeg(node, Object.assign({ quality: a.q || 0.82 }, opts));
        });
      }).then(function (url) {
        cleanup();
        return { url: url, w: Math.round(w * scale), h: Math.round(hh * scale) };
      }, function (e) { cleanup(); throw e; });
    });
  }
  var snapChain = Promise.resolve();
  CMD.snapshot = function (a) {
    var p = snapChain.then(function () { return snap(a); });
    snapChain = p.catch(function () {});
    return p;
  };

  /* ------------------------------------------------------------------ *
   * 17. other commands
   * ------------------------------------------------------------------ */
  CMD.ping = function () { return 'pong'; };
  CMD.nudge = function (a) { if (S.editing) return false; nudge(a.key, a.d || 1); return true; };
  CMD.showSlide = function (a) { showSlide(a.index); return { index: S.slideIdx }; };
  CMD.select = function (a) {
    if (S.editing) exitText(true);
    var els = (a.ids || []).map(byId).filter(Boolean);
    setSel(els);
    if (a.reveal && els[0] && S.docMode) { try { els[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    return els.length;
  };
  CMD.selectAll = function (a) {
    if (S.editing) exitText(true);
    var scope = scopeEl();
    if (!scope) return 0;
    var items;
    if (a.scope === 'siblings' && S.sel.length && S.sel[0].parentElement) items = Array.prototype.filter.call(S.sel[0].parentElement.children, selectable);
    else items = topBoxes(scope);
    setSel(items);
    return items.length;
  };
  CMD.hoverId = function (a) { S.hover = a.id ? byId(a.id) : null; postRects(); };
  CMD.apply = function (a) { applyOps(a.ops); if (a.select) setSel(a.select.map(byId).filter(Boolean)); return true; };
  CMD.setMode = function (a) {
    if (S.editing) exitText(true);
    S.mode = a.mode === 'interact' ? 'interact' : 'edit';
    DE.setAttribute('data-ed-mode', S.mode);
    S.hover = null;
    if (S.mode === 'interact') { setSel([]); }
    postRects();
    return S.mode;
  };
  CMD.setOpts = function (a) {
    var o = S.opts;
    if ('zoom' in a) o.zoom = a.zoom || 1;
    if ('snap' in a) o.snap = !!a.snap;
    if ('builds' in a) {
      o.builds = !!a.builds;
      if (o.builds) DE.setAttribute('data-ed-builds', ''); else DE.removeAttribute('data-ed-builds');
      if (S.cur) revealBuilds(S.cur);
    }
    if ('anim' in a) { o.anim = !!a.anim; if (o.anim) DE.removeAttribute('data-ed-noanim'); else DE.setAttribute('data-ed-noanim', ''); }
    postRects();
    return o;
  };
  CMD.setSize = function (a) {
    if (S.docMode) return false;
    S.W = a.W; S.H = a.H; S.basis = a.basis || S.basis;
    if (S.cur) showSlide(S.slideIdx, true);
    return true;
  };
  CMD.enterText = function (a) {
    var el = a.id ? byId(a.id) : S.sel[0];
    return enterText(el, null, null, !!a.all);
  };
  CMD.exitText = function () { exitText(true); return true; };
  CMD.exec = function (a) { return execCmd(a); };
  CMD.flush = function () { flushPending(); if (S.editing) exitText(true); return true; };
  CMD.info = function () { var p = S.sel[S.sel.length - 1]; return p ? info(p) : null; };
  CMD.infoOf = function (a) { var el = a.id ? byId(a.id) : S.cur; return el ? info(el) : null; };
  CMD.tree = function (a) {
    var root = scopeEl(), count = 0, max = a.max || 900;
    if (!root) return null;
    function node(el, depth) {
      count++;
      var kids = [];
      if (depth > 0) for (var c = el.firstElementChild; c && count < max; c = c.nextElementSibling) {
        if (SKIP[tagOf(c)] || !isCanon(c)) continue;
        kids.push(node(c, depth - 1));
      }
      return { id: idOf(el), label: labelOf(el), text: el.children.length ? '' : shortText(el), kids: kids };
    }
    return node(root, a.depth || 7);
  };
  CMD.fonts = function () {
    var set = Object.create(null), out = [];
    function add(f) { f = (f || '').split(',')[0].replace(/["']/g, '').trim(); if (f && !set[f]) { set[f] = 1; out.push(f); } }
    try { D.fonts.forEach(function (ff) { add(ff.family); }); } catch (e) {}
    var root = scopeEl() || D.body, all = root.querySelectorAll('*');
    for (var i = 0; i < Math.min(all.length, 600); i++) add(cs(all[i]).fontFamily);
    return out.slice(0, 30);
  };
  CMD.colors = function () {
    var freq = Object.create(null);
    var root = scopeEl() || D.body, all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'), 0, 800));
    all.forEach(function (el) {
      var st = cs(el);
      [st.color, st.backgroundColor, st.borderTopColor].forEach(function (c, k) {
        if (k === 2 && !(parseFloat(st.borderTopWidth) > 0)) return;
        if (alphaOf(c) < 0.5) return;
        freq[c] = (freq[c] || 0) + 1;
      });
    });
    return Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 16);
  };
  CMD.extractStatic = function () {
    var list = S.slides.length ? S.slides : (S.genList || []).filter(function (s) { return s.isConnected; });
    if (!list.length) throw new Error('슬라이드를 찾지 못했습니다.');
    var size = S.slides.length ? { W: S.W, H: S.H, display: S.display } : measure(list);
    if (!S.slides.length && size.basis === 'viewport') { size.W = 1920; size.H = 1080; } // screen-relative slides get a standard 16:9 frame
    var styles = [];
    qsa('style, link[rel~="stylesheet"]').forEach(function (n) {
      if (n === styleEl || n === dynEl || n.hasAttribute('data-le')) return;
      var c = n.cloneNode(true); c.removeAttribute('data-ed-id'); styles.push(c.outerHTML);
    });
    var chain = [];
    if (list[0]) for (var p = list[0].parentElement; p && p !== D.body && p !== DE; p = p.parentElement) {
      chain.unshift({ tag: p.tagName.toLowerCase(), id: p.id || '', cls: typeof p.className === 'string' ? p.className : '' });
    }
    var slides = list.map(function (s) {
      var c = viewOnlyStrip(s.cloneNode(true));
      var dead = c.querySelectorAll('script');
      for (var i = 0; i < dead.length; i++) dead[i].remove();
      c.removeAttribute('data-ed-id');
      var withIds = c.querySelectorAll('[data-ed-id]');
      for (var j = 0; j < withIds.length; j++) withIds[j].removeAttribute('data-ed-id');
      return c.outerHTML;
    });
    return { styles: styles, chain: chain, slides: slides, W: size.W, H: size.H, display: size.display, htmlCls: DE.className || '', bodyCls: D.body.className || '', bodyStyle: D.body.getAttribute('style') || '', lang: DE.getAttribute('lang') || '' };
  };
  CMD.debugEval = function (a) {
    if (!CFG.dev) return 'disabled';
    /* eslint-disable no-new-func */
    return Function('S', 'byId', 'D', 'W', a.code)(S, byId, D, W);
  };

  /* ------------------------------------------------------------------ *
   * 18. init
   * ------------------------------------------------------------------ */
  function report(refresh) {
    var label = KIND_LABEL[S.kind] || S.kind;
    if (S.kind === 'slides' && S.slides.length && S.slides.every(function (s) { var p = S.origPos[idOf(s)]; return p === 'static' || p === 'relative'; }) && S.basis === 'viewport') label = KIND_LABEL.scroll;
    return {
      refresh: !!refresh, kind: S.kind, label: label, docMode: S.docMode,
      slides: S.slides.map(slideMeta), index: S.slideIdx,
      W: S.W, H: S.H, basis: S.basis, display: S.display, perSlide: S.perSlide,
      errors: errors.slice(0, 8), errorCount: errors.length, resErrors: resErrors, shims: shims,
      generated: !!S.generated, selector: S.slideSel || null, title: D.title || ''
    };
  }
  function finish(res, refresh) {
    ensureStyles();
    DE.setAttribute('data-ed-mode', S.mode);
    if (!S.opts.anim) DE.setAttribute('data-ed-noanim', '');
    if (S.opts.builds) DE.setAttribute('data-ed-builds', '');
    pauseMedia();
    S.kind = res.kind; S.docMode = res.kind === 'document'; S.generated = !!res.generated; S.genList = res.genList || null;
    S.slideSel = res.sel || null; S.perSlide = !!res.perSlide;
    if (!S.docMode) {
      var keepCur = refresh && S.cur && res.slides.indexOf(S.cur) >= 0 ? S.cur : null;
      clearIso();
      S.slides = res.slides;
      S.slides.forEach(function (s) {
        var st = cs(s);
        S.origPos[idOf(s)] = st.position;
        if (st.display && st.display !== 'none' && st.display !== 'inline' && st.display !== 'contents') S.natDisp[idOf(s)] = st.display;
      });
      markSlides(S.slides);
      if (res.kind === 'reveal') revealConfigure();
      var m = res.W ? { W: res.W, H: res.H, display: res.display || 'block', basis: 'fixed' } : measure(res.slides);
      if (res.kind === 'reveal' && (!res.W || !res.H)) { m.W = W.innerWidth; m.H = W.innerHeight; }
      S.W = m.W; S.H = m.H; S.display = m.display; S.basis = m.basis;
      var start = keepCur ? res.slides.indexOf(keepCur) : clamp(CFG.start | 0, 0, res.slides.length - 1);
      showSlide(start, true);
    } else {
      clearIso(); DE.removeAttribute('data-ed-iso');
      S.slides = []; S.cur = null; S.slideIdx = -1;
    }
    S.ready = true;
    // let web fonts arrive before the shell removes its loading veil (max 2.5 s)
    var sent = false;
    function send() { if (sent) return; sent = true; post('ready', report(refresh)); }
    try { if (!refresh && D.fonts && D.fonts.status !== 'loaded') { D.fonts.ready.then(send, send); setTimeout(send, 2500); return; } } catch (e) {}
    send();
  }
  var t0 = Date.now(), started = false;
  function attempt() {
    var res = detect();
    if (res.wait && Date.now() - t0 < 5000) { setTimeout(attempt, 150); return; }
    if (res.wait) { res = detect.call(null); if (res.wait) res = { kind: 'document', slides: [] }; }
    if (res.kind === 'document' && Date.now() - t0 < 1200) { setTimeout(attempt, 250); return; }
    finish(res, false);
  }
  function start() {
    if (started) return;
    started = true;
    ensureStyles();
    setTimeout(attempt, 120);
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start); else start();
  W.addEventListener('load', function () {
    setTimeout(function () {
      if (!S.ready) return;
      ensureStyles();
      var res = detect();
      if (res.wait || res.kind === 'document' && !S.docMode) return;
      var sameSlides = res.slides.length === S.slides.length && res.slides.every(function (s, i) { return s === S.slides[i]; });
      if (res.kind === S.kind && sameSlides && S.basis === 'fixed') return;
      if (res.kind === 'document' && S.docMode) return;
      var oldW = S.W, oldH = S.H;
      finish(res, true);
      if (sameSlides && oldW === S.W && oldH === S.H) return;
    }, 160);
  });
};
