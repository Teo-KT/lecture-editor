/*
 * lecture-editor v4 · source model
 * The document as it will be saved. Parsed with DOMParser (scripts inert),
 * every element carries a data-ed-id shared with the view. Edits are
 * primitive ops applied here and in the view; saving serialises this model,
 * so runtime changes made by a deck's own scripts never leak into the file.
 */
(function () {
  'use strict';
  var LE = window.LE;
  var cache = new Map();

  var LEGACY_NODES = '#editor-injected-styles,#editor-deck-styles,#editor-print-styles,#editor-raster-styles,#__le_style,#__le_dyn,[data-ed-handle],[data-editor-guide],[data-editor-toggle-indicator]';
  var LEGACY_CLASSES = ['editor-highlight', 'editor-hover', 'editor-multi', 'editor-dragging', 'editor-move-cursor', '__ed_current'];
  function cleanLegacy(doc) {
    var n = 0;
    Array.prototype.forEach.call(doc.querySelectorAll(LEGACY_NODES), function (e) { e.remove(); n++; });
    LEGACY_CLASSES.forEach(function (c) {
      Array.prototype.forEach.call(doc.querySelectorAll('.' + c), function (e) {
        e.classList.remove(c);
        if (!e.getAttribute('class')) e.removeAttribute('class');
        n++;
      });
    });
    var b = doc.body;
    if (b) {
      if (b.classList.contains('editor-mode')) { b.classList.remove('editor-mode'); if (!b.getAttribute('class')) b.removeAttribute('class'); n++; }
      var st = b.getAttribute('style');
      if (st && /--editor-zoom/.test(st)) { var ns = LE.css.set(st, '--editor-zoom', ''); if (ns.trim()) b.setAttribute('style', ns); else b.removeAttribute('style'); n++; }
    }
    var VIEW_ATTRS = ['data-ed-editing', 'data-ed-current', 'data-ed-chain', 'data-ed-reveal', 'data-ed-shown', 'data-ed-tall', 'data-ed-slide', 'data-ed-snap', 'data-ed-snapreveal', 'data-ed-measure'];
    Array.prototype.forEach.call(doc.querySelectorAll(VIEW_ATTRS.map(function (a) { return '[' + a + ']'; }).join(',')), function (e) {
      VIEW_ATTRS.forEach(function (a) { e.removeAttribute(a); });
      n++;
    });
    return n;
  }
  function doctypeString(n) {
    var s = '<!DOCTYPE ' + (n.name || 'html');
    if (n.publicId) s += ' PUBLIC "' + n.publicId + '"' + (n.systemId ? ' "' + n.systemId + '"' : '');
    else if (n.systemId) s += ' SYSTEM "' + n.systemId + '"';
    return s + '>';
  }
  function indexIn(el) { var i = 0; for (var n = el.parentNode.firstChild; n; n = n.nextSibling, i++) if (n === el) return i; return -1; }

  var S = LE.src = {
    doc: null, seq: 0, legacy: 0,

    load: function (html) {
      html = String(html || '').replace(/^﻿/, '');
      cache.clear();
      this.doc = new DOMParser().parseFromString(html, 'text/html');
      this.seq = 0;
      this.legacy = cleanLegacy(this.doc);
      Array.prototype.forEach.call(this.doc.querySelectorAll('[data-ed-id]'), function (e) { e.removeAttribute('data-ed-id'); });
      this.assign(this.doc.documentElement);
      return this.doc;
    },
    gen: function () { return 'e' + (++this.seq).toString(36); },
    assign: function (root) {
      if (!root || root.nodeType !== 1) return;
      var list = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!el.hasAttribute('data-ed-id')) { var id = this.gen(); el.setAttribute('data-ed-id', id); cache.set(id, el); }
      }
    },
    el: function (id) {
      if (!id || !this.doc) return null;
      var e = cache.get(id);
      if (e && e.isConnected && e.ownerDocument === this.doc && e.getAttribute('data-ed-id') === id) return e;
      e = this.doc.querySelector('[data-ed-id="' + String(id).replace(/[^A-Za-z0-9_\-]/g, '') + '"]');
      if (e) cache.set(id, e); else cache.delete(id);
      return e;
    },
    idOf: function (el) { return el && el.nodeType === 1 ? el.getAttribute('data-ed-id') : null; },
    nextId: function (el) {
      for (var n = el.nextElementSibling; n; n = n.nextElementSibling) { var id = this.idOf(n); if (id) return id; }
      return null;
    },
    headId: function () { return this.idOf(this.doc.head); },
    bodyId: function () { return this.idOf(this.doc.body); },

    /* Turn an HTML fragment into one element with fresh ids. external=true strips active content. */
    fresh: function (html, external) {
      var tpl = this.doc.createElement('template');
      tpl.innerHTML = html;
      var root = tpl.content.firstElementChild;
      if (!root) return null;
      if (external) {
        Array.prototype.forEach.call(tpl.content.querySelectorAll('script,iframe,object,embed,meta,link,base,form'), function (n) { n.remove(); });
        Array.prototype.forEach.call(tpl.content.querySelectorAll('*'), function (n) {
          Array.prototype.slice.call(n.attributes).forEach(function (a) {
            if (/^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
          });
        });
        root = tpl.content.firstElementChild;
        if (!root) return null;
      }
      [root].concat(Array.prototype.slice.call(root.querySelectorAll('[data-ed-id]'))).forEach(function (n) { n.removeAttribute('data-ed-id'); });
      this.assign(root);
      return { html: root.outerHTML, id: root.getAttribute('data-ed-id') };
    },
    /* several top-level elements (e.g. pasted HTML) → array of fresh elements */
    freshAll: function (html, external) {
      var tpl = this.doc.createElement('template'), out = [], self = this;
      tpl.innerHTML = html;
      Array.prototype.slice.call(tpl.content.children).forEach(function (c) {
        var f = self.fresh(c.outerHTML, external);
        if (f) out.push(f);
      });
      return out;
    },

    inverse: function (op) {
      var el = op.id ? this.el(op.id) : null;
      switch (op.t) {
        case 'css': {
          var st = el ? (el.getAttribute('style') || '') : '', set = {};
          Object.keys(op.set || {}).forEach(function (p) { var d = LE.css.get(st, p); set[p] = d ? d.v + (d.imp ? ' !important' : '') : ''; });
          return { t: 'css', id: op.id, set: set };
        }
        case 'attr': return { t: 'attr', id: op.id, name: op.name, value: el && el.hasAttribute(op.name) ? el.getAttribute(op.name) : null };
        case 'html': return { t: 'html', id: op.id, html: el ? el.innerHTML : '' };
        case 'insert': { var m = /data-ed-id="([^"]+)"/.exec(op.html || ''); return m ? { t: 'remove', id: m[1] } : null; }
        case 'remove': return el && el.parentElement ? { t: 'insert', parent: this.idOf(el.parentElement), before: this.nextId(el), index: indexIn(el), html: el.outerHTML } : null;
        case 'move': return el && el.parentElement ? { t: 'move', id: op.id, parent: this.idOf(el.parentElement), before: this.nextId(el), index: indexIn(el) } : null;
      }
      return null;
    },
    apply: function (op) {
      var el = op.id ? this.el(op.id) : null, self = this;
      function place(node, parent) {
        var ref = null;
        if (op.index != null && op.index >= 0 && op.index <= parent.childNodes.length) ref = parent.childNodes[op.index] || null;
        else if (op.before) { ref = self.el(op.before); if (ref && ref.parentNode !== parent) ref = null; }
        if (ref === node) return;
        parent.insertBefore(node, ref);
      }
      switch (op.t) {
        case 'css': {
          if (!el) return;
          var st = el.getAttribute('style') || '';
          Object.keys(op.set || {}).forEach(function (p) { st = LE.css.set(st, p, op.set[p]); });
          if (st.trim()) el.setAttribute('style', st); else el.removeAttribute('style');
          return;
        }
        case 'attr':
          if (!el || op.name === 'data-ed-id') return;
          if (op.value == null) el.removeAttribute(op.name); else el.setAttribute(op.name, op.value);
          return;
        case 'html':
          if (!el) return;
          el.innerHTML = op.html;
          this.assign(el);
          return;
        case 'insert': {
          var p = this.el(op.parent);
          if (!p) return;
          var tpl = this.doc.createElement('template');
          tpl.innerHTML = op.html;
          var node = tpl.content.firstElementChild;
          if (!node) return;
          place(node, p);
          this.assign(node);
          return;
        }
        case 'remove':
          if (el) el.remove();
          return;
        case 'move': {
          if (!el) return;
          var mp = this.el(op.parent);
          if (!mp) return;
          if (op.index != null) el.remove();
          place(el, mp);
          return;
        }
      }
    },

    /* nearest ancestor (or self) whose id is in the slide set */
    slideOf: function (id, slideIds) {
      var el = this.el(id);
      for (var n = el; n && n.nodeType === 1; n = n.parentElement) { var i = this.idOf(n); if (i && slideIds[i]) return i; }
      return null;
    },

    serialize: function (strip) {
      var out = '';
      for (var n = this.doc.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 10) out += doctypeString(n) + '\n';
        else if (n.nodeType === 8) out += '<!--' + n.data + '-->\n';
        else if (n.nodeType === 1) out += n.outerHTML;
      }
      return strip ? out.replace(/ data-ed-id="[^"]*"/g, '') : out;
    },
    html: function () { return this.serialize(true); },

    /* Markup for the sandboxed view: ids kept, bridge injected first in <head>. */
    viewHTML: function (o) {
      var pre = '', root = this.doc.documentElement;
      for (var n = this.doc.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 10) pre += doctypeString(n) + '\n';
        else if (n.nodeType === 8) pre += '<!--' + n.data + '-->\n';
      }
      var html = root.outerHTML;
      // a deck's own CSP would block the injected bridge; refresh would navigate away
      html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*(content-security-policy|refresh)\b[^>]*>/gi, '');
      if (o.assets) html = o.assets(html);
      var inj = (o.base ? '<base href="' + LE.esc(o.base) + '">' : '') + '<script>' + o.bridge + '<\/script>';
      var m = /<head\b[^>]*>/i.exec(html);
      if (m) html = html.slice(0, m.index + m[0].length) + inj + html.slice(m.index + m[0].length);
      else html = inj + html;
      return pre + html;
    },

    /* relative asset references (for the "connect folder" feature) */
    relativeRefs: function () {
      var out = Object.create(null);
      function rel(u) { return u && !/^(?:[a-z][a-z0-9+.\-]*:|\/\/|#|\/)/i.test(u.trim()); }
      Array.prototype.forEach.call(this.doc.querySelectorAll('[src],[href],[poster],[data-src]'), function (e) {
        var tag = e.tagName;
        ['src', 'poster', 'data-src'].forEach(function (a) { var v = e.getAttribute(a); if (rel(v)) out[v.trim()] = 1; });
        if (tag === 'LINK' && /stylesheet|icon/i.test(e.getAttribute('rel') || '')) { var h = e.getAttribute('href'); if (rel(h)) out[h.trim()] = 1; }
      });
      var css = '';
      Array.prototype.forEach.call(this.doc.querySelectorAll('style'), function (s) { css += s.textContent + '\n'; });
      Array.prototype.forEach.call(this.doc.querySelectorAll('[style*="url("]'), function (s) { css += s.getAttribute('style') + '\n'; });
      var re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, mm;
      while ((mm = re.exec(css))) if (rel(mm[2]) && !/^data:/i.test(mm[2])) out[mm[2].trim()] = 1;
      return Object.keys(out);
    }
  };
})();
