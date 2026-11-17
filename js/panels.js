/* lecture-editor v4 · left panel: slide filmstrip (thumbnails, reorder) and layers */
(function () {
  'use strict';
  var LE = window.LE;

  var SL = LE.slides = {
    list: [], index: -1, ids: Object.create(null), thumbs: new Map(), ver: new Map(),
    queue: [], busy: false, pendingGo: null,
    init: function () {
      this.el = document.getElementById('slideList');
      this.countEl = document.getElementById('slideCount');
      var self = this;
      this.io = window.IntersectionObserver ? new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { if (en.isIntersecting) self.want(en.target.getAttribute('data-id')); });
      }, { root: this.el, rootMargin: '300px 0px' }) : null;
      this.el.addEventListener('click', function (e) {
        var it = e.target.closest('.slide-item');
        if (it) { self.go(+it.getAttribute('data-i')); self.el.focus(); }
      });
      this.el.addEventListener('contextmenu', function (e) {
        var it = e.target.closest('.slide-item');
        if (!it) return;
        e.preventDefault();
        var i = +it.getAttribute('data-i');
        if (i !== self.index) self.go(i);
        LE.menu.open(LE.menus.slideContext(i), e.clientX, e.clientY);
      });
      this.el.addEventListener('dblclick', function (e) { if (e.target.closest('.slide-item')) LE.view.focus(); });
      // drag reorder
      var dragFrom = -1, marker = LE.h('div', { class: 'slide-drop' });
      this.el.addEventListener('dragstart', function (e) {
        var it = e.target.closest('.slide-item');
        if (!it) return;
        dragFrom = +it.getAttribute('data-i');
        it.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'slide:' + dragFrom); } catch (x) {}
      });
      this.el.addEventListener('dragend', function (e) {
        var it = e.target.closest('.slide-item');
        if (it) it.classList.remove('dragging');
        marker.remove(); dragFrom = -1;
      });
      this.el.addEventListener('dragover', function (e) {
        if (dragFrom < 0) return;
        e.preventDefault();
        var it = e.target.closest('.slide-item');
        if (!it) return;
        var r = it.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        marker.setAttribute('data-to', String(+it.getAttribute('data-i') + (after ? 1 : 0)));
        if (after) it.after(marker); else it.before(marker);
      });
      this.el.addEventListener('drop', function (e) {
        if (dragFrom < 0) return;
        e.preventDefault();
        var to = +(marker.getAttribute('data-to') || dragFrom);
        marker.remove();
        if (to > dragFrom) to--;
        if (to !== dragFrom) self.move(dragFrom, to);
        dragFrom = -1;
      });
    },
    reset: function () { this.list = []; this.index = -1; this.ids = Object.create(null); this.thumbs.clear(); this.ver.clear(); this.queue = []; this.render(); },
    set: function (list, index) {
      this.list = list || [];
      this.ids = Object.create(null);
      var self = this;
      this.list.forEach(function (s) { self.ids[s.id] = 1; });
      if (index != null) this.index = index;
      this.render();
      if (this.pendingGo && this.ids[this.pendingGo]) { var g = this.pendingGo; this.pendingGo = null; this.goId(g); }
      // visible ones first (IntersectionObserver), then everything in the background
      clearTimeout(this._pf);
      this._pf = setTimeout(function () { self.list.slice(0, 12).forEach(function (s) { self.want(s.id); }); }, 200);
      clearTimeout(this._pf2);
      this._pf2 = setTimeout(function () { self.list.forEach(function (s) { self.want(s.id); }); }, 2500);
    },
    curId: function () { var s = this.list[this.index]; return s ? s.id : null; },
    indexOf: function (id) { for (var i = 0; i < this.list.length; i++) if (this.list[i].id === id) return i; return -1; },
    slideOfId: function (id) { return LE.src.doc ? LE.src.slideOf(id, this.ids) : null; },
    go: function (i) {
      if (!this.list.length) return;
      i = LE.clamp(i, 0, this.list.length - 1);
      LE.view.send('showSlide', { index: i });
    },
    goId: function (id) { var i = this.indexOf(id); if (i >= 0) this.go(i); },
    next: function () { this.go(this.index + 1); },
    prev: function () { this.go(this.index - 1); },
    onSlide: function (d) {
      this.index = d.index;
      LE.$$('.slide-item', this.el).forEach(function (it) { it.classList.toggle('active', +it.getAttribute('data-i') === d.index); });
      var cur = this.el.querySelector('.slide-item.active');
      if (cur) { var r = cur.getBoundingClientRect(), pr = this.el.getBoundingClientRect(); if (r.top < pr.top || r.bottom > pr.bottom) cur.scrollIntoView({ block: 'nearest' }); }
      LE.app.updateNav();
    },
    render: function () {
      var el = this.el, self = this;
      if (!el) return;
      if (this.io) this.io.disconnect();
      el.innerHTML = '';
      var V = LE.view, ar = (V.W || 16) + ' / ' + (V.H || 9);
      this.list.forEach(function (s, i) {
        var t = self.thumbs.get(s.id), fresh = t && t.ver === (self.ver.get(s.id) || 0);
        var box = LE.h('div', { class: 'si-thumb', style: { aspectRatio: ar } });
        if (t && t.url) box.appendChild(LE.h('img', { src: t.url, alt: '', draggable: 'false' }));
        else box.appendChild(LE.h('div', { class: 'si-ph', text: s.title || '' }));
        if (t && !fresh) box.classList.add('stale');
        var it = LE.h('div', { class: 'slide-item' + (i === self.index ? ' active' : ''), draggable: 'true', 'data-id': s.id, 'data-i': String(i), title: s.title || '' },
          LE.h('div', { class: 'si-num', text: String(i + 1) }), box);
        el.appendChild(it);
        if (self.io) self.io.observe(it);
      });
      if (this.countEl) this.countEl.textContent = this.list.length ? String(this.list.length) : '';
      LE.app.updateNav();
    },
    /* thumbnails */
    want: function (id) {
      if (!id || !LE.view.ready || LE.view.docMode) return;
      var t = this.thumbs.get(id), v = this.ver.get(id) || 0;
      if (t && t.ver === v) return;
      if (this.queue.indexOf(id) < 0) this.queue.push(id);
      this.pump();
    },
    pump: function () {
      if (this.busy || !this.queue.length || !LE.view.ready) return;
      var self = this, id = this.queue.shift();
      if (!this.ids[id]) { setTimeout(function () { self.pump(); }, 0); return; }
      var v = this.ver.get(id) || 0, W = LE.view.W || 1920;
      this.busy = true;
      LE.view.call('snapshot', { id: id, scale: Math.min(0.4, 300 / W), q: 0.78 }, 30000).then(function (r) {
        self.thumbs.set(id, { url: r.url, ver: v });
        var img = self.el.querySelector('.slide-item[data-id="' + id + '"] .si-thumb');
        if (img) { img.innerHTML = ''; img.classList.remove('stale'); img.appendChild(LE.h('img', { src: r.url, alt: '', draggable: 'false' })); }
      }).catch(function () {
        self.thumbs.set(id, { url: null, ver: v });
      }).then(function () {
        self.busy = false;
        setTimeout(function () { self.pump(); }, 20);
      });
    },
    touch: function (ops, slides) {
      var self = this, hit = Object.create(null);
      (slides || []).forEach(function (sid) { if (LE.src.el(sid)) hit[sid] = 1; });
      (ops || []).forEach(function (o) {
        var id = o.id || o.parent;
        if (o.t === 'insert') { var m = /data-ed-id="([^"]+)"/.exec(o.html || ''); if (m && LE.src.el(m[1])) id = m[1]; }
        var sid = id && LE.src.el(id) ? self.slideOfId(id) : null;
        if (sid) hit[sid] = 1;
      });
      Object.keys(hit).forEach(function (sid) {
        self.ver.set(sid, (self.ver.get(sid) || 0) + 1);
        var box = self.el.querySelector('.slide-item[data-id="' + sid + '"] .si-thumb');
        if (box) box.classList.add('stale');
      });
      clearTimeout(this._tt);
      this._tt = setTimeout(function () { Object.keys(hit).forEach(function (sid) { self.want(sid); }); }, 900);
    },
    /* slide operations (all undoable) */
    duplicate: function (i) {
      var s = this.list[i == null ? this.index : i];
      if (!s) return;
      var el = LE.src.el(s.id);
      if (!el) return;
      var f = LE.src.fresh(el.outerHTML, false);
      this.pendingGo = f.id;
      LE.ops.run([{ t: 'insert', parent: LE.src.idOf(el.parentElement), before: LE.src.nextId(el), html: f.html }], '슬라이드 복제');
    },
    remove: function (i) {
      i = i == null ? this.index : i;
      var s = this.list[i];
      if (!s) return;
      if (this.list.length <= 1) { LE.toast('마지막 슬라이드는 지울 수 없습니다.', 'warn'); return; }
      LE.ops.run([{ t: 'remove', id: s.id }], '슬라이드 삭제');
      LE.toast('슬라이드 ' + (i + 1) + '을(를) 지웠습니다. ' + LE.modLabel + 'Z로 되돌릴 수 있습니다.', 'info');
    },
    move: function (from, to) {
      var a = this.list[from], b = this.list[to];
      if (!a || !b || from === to) return;
      var tgt = LE.src.el(b.id);
      if (!tgt) return;
      var parent = LE.src.idOf(tgt.parentElement);
      var before = to > from ? LE.src.nextId(tgt) : b.id;
      this.pendingGo = a.id;
      LE.ops.run([{ t: 'move', id: a.id, parent: parent, before: before }], '슬라이드 이동 ' + (from + 1) + ' → ' + (to + 1));
    },
    add: function () {
      var s = this.list[this.index];
      if (!s) return;
      var el = LE.src.el(s.id);
      var shell = el.cloneNode(false);
      shell.removeAttribute('data-ed-id');
      shell.removeAttribute('id');
      ['data-notes', 'data-note', 'data-n'].forEach(function (a) { shell.removeAttribute(a); });
      shell.innerHTML = '<h2>새 슬라이드</h2><p>내용을 입력하세요.</p>';
      var f = LE.src.fresh(shell.outerHTML, false);
      this.pendingGo = f.id;
      LE.ops.run([{ t: 'insert', parent: LE.src.idOf(el.parentElement), before: LE.src.nextId(el), html: f.html }], '새 슬라이드');
    }
  };

  /* layers: element tree of the current slide */
  var LY = LE.layers = {
    tree: null, open: Object.create(null),
    init: function () {
      this.el = document.getElementById('layerTree');
      var self = this;
      this.refresh = LE.debounce(function () { self.load(); }, 350);
      this.el.addEventListener('click', function (e) {
        var tw = e.target.closest('.ly-tw');
        var row = e.target.closest('.ly-row');
        if (!row) return;
        var id = row.getAttribute('data-id');
        if (tw) { self.open[id] = !self.open[id]; self.draw(); return; }
        LE.view.send('select', { ids: [id], reveal: true });
      });
      this.el.addEventListener('mouseover', function (e) { var row = e.target.closest('.ly-row'); LE.view.send('hoverId', { id: row ? row.getAttribute('data-id') : null }); });
      this.el.addEventListener('mouseleave', function () { LE.view.send('hoverId', { id: null }); });
    },
    visible: function () { return document.getElementById('app').classList.contains('tab-layers'); },
    load: function () {
      if (!this.visible() || !LE.view.ready) return;
      var self = this;
      LE.view.call('tree', { depth: 8 }).then(function (t) { self.tree = t; if (t) self.open[t.id] = true; self.draw(); }).catch(function () {});
    },
    draw: function () {
      var el = this.el, self = this, sel = Object.create(null);
      (LE.sel.ids || []).forEach(function (id) { sel[id] = 1; });
      el.innerHTML = '';
      if (!this.tree) { el.appendChild(LE.h('div', { class: 'empty-note', text: '표시할 요소가 없습니다.' })); return; }
      (function walk(n, depth) {
        var has = n.kids && n.kids.length, op = !!self.open[n.id];
        el.appendChild(LE.h('div', { class: 'ly-row' + (sel[n.id] ? ' sel' : ''), 'data-id': n.id, style: { paddingLeft: (8 + depth * 14) + 'px' } },
          LE.h('span', { class: 'ly-tw' + (has ? '' : ' none'), html: has ? LE.icon(op ? 'chev-down' : 'chev-right') : '' }),
          LE.h('span', { class: 'ly-label', text: n.label }),
          n.text ? LE.h('span', { class: 'ly-text', text: n.text }) : null));
        if (has && op) n.kids.forEach(function (k) { walk(k, depth + 1); });
      })(this.tree, 0);
    },
    revealSelection: function () {
      if (!this.tree || !this.visible()) return;
      var ids = LE.sel.ids || [], self = this, changed = false;
      (function walk(n, path) {
        if (ids.indexOf(n.id) >= 0) path.forEach(function (p) { if (!self.open[p]) { self.open[p] = true; changed = true; } });
        (n.kids || []).forEach(function (k) { walk(k, path.concat(n.id)); });
      })(this.tree, []);
      this.draw();
      var r = this.el.querySelector('.ly-row.sel');
      if (r) r.scrollIntoView({ block: 'nearest' });
      return changed;
    }
  };
})();
