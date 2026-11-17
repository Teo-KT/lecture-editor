/* lecture-editor v4 · shared utilities (namespace LE) */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {};
  LE.version = '4.0.0';
  LE.isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  LE.modLabel = LE.isMac ? '⌘' : 'Ctrl+';
  LE.dev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  LE.$ = function (s, r) { return (r || document).querySelector(s); };
  LE.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  LE.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  LE.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  LE.rand = function (n) { var s = ''; while (s.length < (n || 8)) s += Math.random().toString(36).slice(2); return s.slice(0, n || 8); };

  /* element builder: LE.h('div', {class:'x', onclick: fn}, child, 'text', [more]) */
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  LE.h = function (tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  };

  LE.debounce = function (fn, ms) {
    var t = null;
    var d = function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
    d.cancel = function () { clearTimeout(t); };
    d.flush = function () { clearTimeout(t); fn(); };
    return d;
  };
  LE.raf = function (fn) {
    var q = false, args = null;
    return function () { args = arguments; if (q) return; q = true; requestAnimationFrame(function () { q = false; fn.apply(null, args); }); };
  };

  /* event bus */
  LE.bus = (function () {
    var m = Object.create(null);
    return {
      on: function (n, f) { (m[n] = m[n] || []).push(f); return f; },
      off: function (n, f) { if (m[n]) m[n] = m[n].filter(function (x) { return x !== f; }); },
      emit: function (n, d) { (m[n] || []).slice().forEach(function (f) { try { f(d); } catch (e) { console.error('[bus ' + n + ']', e); } }); }
    };
  })();

  /* preferences (localStorage, never throws) */
  LE.prefs = {
    get: function (k, d) { try { var v = localStorage.getItem('le4.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('le4.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* toasts */
  LE.toast = function (msg, type, ms) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = LE.h('div', { class: 'toast ' + (type || 'info'), role: 'status' },
      LE.h('span', { class: 'toast-ic', html: LE.icon ? LE.icon(type === 'error' ? 'alert' : type === 'ok' ? 'check' : type === 'warn' ? 'alert' : 'info') : '' }),
      LE.h('span', { class: 'toast-msg', text: msg }));
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    var t = setTimeout(close, ms || (type === 'error' ? 6500 : 2800));
    el.addEventListener('click', close);
    function close() { clearTimeout(t); el.classList.remove('in'); setTimeout(function () { el.remove(); }, 220); }
    return close;
  };

  /* modal dialogs (replace native alert/confirm/prompt) */
  LE.dialog = (function () {
    var stack = [];
    function open(o) {
      return new Promise(function (resolve) {
        var host = document.getElementById('layer-modal');
        var backdrop = LE.h('div', { class: 'modal-backdrop' });
        var box = LE.h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || '' });
        if (o.title) box.appendChild(LE.h('div', { class: 'modal-head' }, LE.h('h2', { text: o.title }),
          LE.h('button', { class: 'icon-btn modal-x', title: '닫기', html: LE.icon('x'), onclick: function () { done(null); } })));
        var body = LE.h('div', { class: 'modal-body' });
        if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
        box.appendChild(body);
        var foot = LE.h('div', { class: 'modal-foot' });
        (o.buttons || [{ label: '확인', value: true, primary: true }]).forEach(function (b) {
          foot.appendChild(LE.h('button', { class: 'btn ' + (b.primary ? 'primary' : b.danger ? 'danger' : 'secondary'), text: b.label,
            onclick: function () { var v = typeof b.value === 'function' ? b.value(body) : b.value; if (v === undefined && b.keepOpen) return; done(v); } }));
        });
        box.appendChild(foot);
        backdrop.appendChild(box);
        host.appendChild(backdrop);
        var prevFocus = document.activeElement;
        function key(e) {
          if (stack[stack.length - 1] !== api) return;
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
          else if (e.key === 'Enter' && !e.isComposing && !(e.target && e.target.tagName === 'TEXTAREA')) {
            var pb = o.buttons ? o.buttons.filter(function (b) { return b.primary; })[0] : { value: true };
            if (pb) { e.preventDefault(); e.stopPropagation(); var v = typeof pb.value === 'function' ? pb.value(body) : pb.value; done(v); }
          }
        }
        var api = { done: done };
        stack.push(api);
        document.addEventListener('keydown', key, true);
        backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop && !o.sticky) done(null); });
        requestAnimationFrame(function () {
          backdrop.classList.add('in');
          var f = box.querySelector('[autofocus], input, textarea, select') || box.querySelector('.btn.primary');
          if (f) { f.focus(); if (f.select && f.type !== 'checkbox') try { f.select(); } catch (e) {} }
        });
        function done(v) {
          document.removeEventListener('keydown', key, true);
          stack = stack.filter(function (x) { return x !== api; });
          backdrop.classList.remove('in');
          setTimeout(function () { backdrop.remove(); }, 160);
          if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
          resolve(v);
        }
        if (o.onOpen) o.onOpen(body, done);
      });
    }
    return {
      open: open,
      isOpen: function () { return stack.length > 0; },
      closeAll: function () { stack.slice().forEach(function (d) { d.done(null); }); },
      alert: function (title, msg) { return open({ title: title, body: LE.h('p', { class: 'modal-text', text: msg }), buttons: [{ label: '확인', value: true, primary: true }] }); },
      confirm: function (title, msg, o) {
        o = o || {};
        return open({ title: title, body: LE.h('p', { class: 'modal-text', text: msg }), buttons: [
          { label: o.cancel || '취소', value: false },
          o.danger ? { label: o.ok || '확인', value: true, danger: true } : { label: o.ok || '확인', value: true, primary: true }] }).then(function (v) { return !!v; });
      },
      prompt: function (title, label, value, o) {
        o = o || {};
        var input = LE.h(o.multiline ? 'textarea' : 'input', { class: 'input' + (o.multiline ? ' mono' : ''), value: value || '', placeholder: o.placeholder || '', spellcheck: 'false', rows: o.multiline ? 10 : null });
        var body = LE.h('div', { class: 'form' }, label ? LE.h('label', { class: 'field-label', text: label }) : null, input, o.hint ? LE.h('p', { class: 'hint', text: o.hint }) : null);
        return open({ title: title, body: body, wide: !!o.multiline, buttons: [{ label: '취소', value: null }, { label: o.ok || '확인', primary: true, value: function () { return input.value; } }] });
      }
    };
  })();

  /* script loader (cached) */
  var scriptCache = {};
  LE.loadScript = function (src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { delete scriptCache[src]; rej(new Error('스크립트를 불러오지 못했습니다: ' + src)); };
      document.head.appendChild(s);
    });
    return scriptCache[src];
  };

  LE.download = function (data, name, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };
  LE.dataUrlToBlob = function (url) {
    var p = url.split(','), mime = (/data:([^;]+)/.exec(p[0]) || [])[1] || 'application/octet-stream';
    var bin = atob(p[1]), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  };
  LE.fmtBytes = function (n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
  LE.baseName = function (name) { return String(name || 'slides').replace(/\.x?html?$/i, ''); };
  LE.timeLabel = function (t) {
    var d = new Date(t), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return d.toDateString() === now.toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  };

  /* colours */
  LE.alpha = function (c) {
    if (!c || c === 'transparent') return 0;
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return 1;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  };
  LE.hex = function (c) {
    if (!c) return '';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return '';
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return '#' + p.slice(0, 3).map(function (x) { return Math.round(LE.clamp(x, 0, 255)).toString(16).padStart(2, '0'); }).join('');
  };

  /* inline style text helpers that preserve unknown declarations verbatim */
  function parseDecls(text) {
    var out = [], buf = '', depth = 0, q = null;
    text = String(text || '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { buf += ch; if (ch === q && text[i - 1] !== '\\') q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
      if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { push(buf); buf = ''; continue; }
      buf += ch;
    }
    push(buf);
    function push(s) {
      var t = s.trim();
      if (!t) return;
      var c = t.indexOf(':');
      if (c < 1) { out.push({ raw: t }); return; }
      var p = t.slice(0, c).trim(), v = t.slice(c + 1).trim();
      var imp = /!\s*important\s*$/i.test(v);
      if (imp) v = v.replace(/\s*!\s*important\s*$/i, '');
      out.push({ p: p, lp: p.toLowerCase(), v: v, imp: imp });
    }
    return out;
  }
  function serializeDecls(list) {
    return list.map(function (d) { return d.raw ? d.raw : d.p + ': ' + d.v + (d.imp ? ' !important' : ''); }).join('; ') + (list.length ? ';' : '');
  }
  LE.css = {
    parse: parseDecls,
    get: function (text, prop) {
      var lp = prop.toLowerCase(), list = parseDecls(text);
      for (var i = list.length - 1; i >= 0; i--) if (list[i].lp === lp) return list[i];
      return null;
    },
    set: function (text, prop, value) {
      var lp = prop.toLowerCase();
      var list = parseDecls(text).filter(function (d) { return d.lp !== lp; });
      if (value !== '' && value != null) {
        var v = String(value), imp = /!\s*important\s*$/i.test(v);
        list.push({ p: prop, lp: lp, v: v.replace(/\s*!\s*important\s*$/i, ''), imp: imp });
      }
      return serializeDecls(list);
    }
  };

  /* tiny IndexedDB wrapper: stores "drafts" and "recent" */
  LE.idb = (function () {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        try {
          var r = indexedDB.open('lecture-editor', 1);
          r.onupgradeneeded = function () {
            var d = r.result;
            if (!d.objectStoreNames.contains('drafts')) d.createObjectStore('drafts');
            if (!d.objectStoreNames.contains('recent')) d.createObjectStore('recent');
          };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        } catch (e) { rej(e); }
      });
      return dbp;
    }
    function tx(store, mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction(store, mode), s = t.objectStore(store), out;
          var r = fn(s);
          if (r) r.onsuccess = function () { out = r.result; };
          t.oncomplete = function () { res(out); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      get: function (st, k) { return tx(st, 'readonly', function (s) { return s.get(k); }).catch(function () { return null; }); },
      put: function (st, k, v) { return tx(st, 'readwrite', function (s) { return s.put(v, k); }).catch(function (e) { console.warn('idb put', e); }); },
      del: function (st, k) { return tx(st, 'readwrite', function (s) { return s.delete(k); }).catch(function () {}); },
      all: function (st) {
        return db().then(function (d) {
          return new Promise(function (res) {
            var out = [], t = d.transaction(st, 'readonly'), r = t.objectStore(st).openCursor();
            r.onsuccess = function () { var c = r.result; if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else res(out); };
            r.onerror = function () { res(out); };
          });
        }).catch(function () { return []; });
      }
    };
  })();
})();
