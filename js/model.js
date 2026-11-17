/* lecture-editor v4 · history (undo/redo) and op dispatch */
(function () {
  'use strict';
  var LE = window.LE;

  function mergeOps(a, b) {
    var out = a.map(function (o) { return o.t === 'css' ? { t: 'css', id: o.id, set: Object.assign({}, o.set) } : o; });
    b.forEach(function (o) {
      if (o.t === 'css') {
        var hit = null;
        for (var i = 0; i < out.length; i++) if (out[i].t === 'css' && out[i].id === o.id) { hit = out[i]; break; }
        if (hit) { Object.assign(hit.set, o.set); return; }
      }
      out.push(o);
    });
    return out;
  }

  var H = LE.hist = {
    list: [], pos: 0, savedPos: 0,
    push: function (e) {
      var last = this.list[this.pos - 1];
      if (e.merge && last && last.merge === e.merge && Date.now() - last.time < 1500 && this.pos === this.list.length && this.savedPos !== this.pos) {
        last.do = mergeOps(last.do, e.do);
        last.time = Date.now();
        LE.bus.emit('hist');
        return;
      }
      this.list.length = this.pos;
      if (this.savedPos > this.pos) this.savedPos = -1;
      this.list.push(e);
      if (this.list.length > 500) { this.list.shift(); this.savedPos--; }
      this.pos = this.list.length;
      LE.bus.emit('hist');
    },
    canUndo: function () { return this.pos > 0; },
    canRedo: function () { return this.pos < this.list.length; },
    clear: function () { this.list = []; this.pos = 0; this.savedPos = 0; LE.bus.emit('hist'); },
    isClean: function () { return this.pos === this.savedPos; },
    markSaved: function () { this.savedPos = this.pos; LE.bus.emit('hist'); },
    peekUndo: function () { return this.list[this.pos - 1] || null; },
    peekRedo: function () { return this.list[this.pos] || null; }
  };

  function firstId(ops) {
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.id && LE.src.el(o.id)) return o.id;
      if (o.t === 'insert') { var m = /data-ed-id="([^"]+)"/.exec(o.html || ''); if (m && LE.src.el(m[1])) return m[1]; if (o.parent) return o.parent; }
      if (o.parent && LE.src.el(o.parent)) return o.parent;
    }
    return null;
  }

  /* slides an op list touches, read from the source BEFORE the ops run
     (a remove makes the element unknown afterwards) */
  function affected(ops) {
    var out = [];
    (ops || []).forEach(function (o) {
      [o.id, o.parent].forEach(function (x) {
        if (!x || !LE.src.el(x)) return;
        var s = LE.slides.slideOfId(x);
        if (s && out.indexOf(s) < 0) out.push(s);
      });
    });
    return out;
  }

  LE.ops = {
    /* apply ops to source + view, record history. o.fromView: view already has them. */
    run: function (ops, label, o) {
      o = o || {};
      ops = (ops || []).filter(Boolean);
      if (!ops.length || !LE.src.doc) return null;
      var undo = [], pre = affected(ops);
      ops.forEach(function (op) {
        var inv = LE.src.inverse(op);
        LE.src.apply(op);
        if (inv) undo.unshift(inv);
      });
      if (!o.fromView) LE.view.apply(ops, o.select || null);
      var entry = { label: label || '편집', do: ops, undo: undo, time: Date.now(), merge: o.merge || null, selBefore: (LE.sel.ids || []).slice(), slide: LE.slides.curId() };
      H.push(entry);
      this.changed(ops, entry.label, pre);
      return entry;
    },
    fromView: function (ops, label) { return this.run(ops, label, { fromView: true }); },
    undo: function () {
      if (!H.canUndo()) return;
      LE.view.send('flush');
      var e = H.list[H.pos - 1];
      H.pos--;
      var pre = affected(e.undo);
      e.undo.forEach(function (op) { LE.src.apply(op); });
      LE.view.apply(e.undo);
      this.reveal(e.undo, e.selBefore, pre);
      this.changed(e.undo, e.label, pre);
      LE.bus.emit('hist');
      LE.toast('실행 취소: ' + e.label, 'info', 1500);
    },
    redo: function () {
      if (!H.canRedo()) return;
      LE.view.send('flush');
      var e = H.list[H.pos];
      H.pos++;
      var pre = affected(e.do);
      e.do.forEach(function (op) { LE.src.apply(op); });
      LE.view.apply(e.do);
      this.reveal(e.do, null, pre);
      this.changed(e.do, e.label, pre);
      LE.bus.emit('hist');
      LE.toast('다시 실행: ' + e.label, 'info', 1500);
    },
    /* after undo/redo: show the slide that changed and reselect */
    reveal: function (ops, sel, pre) {
      var id = firstId(ops);
      var sid = id ? LE.slides.slideOfId(id) : null;
      if (!sid && pre && pre.length && LE.src.el(pre[0])) sid = pre[0];
      if (sid && sid !== LE.slides.curId()) LE.slides.goId(sid);
      var ids = (sel || []).filter(function (x) { return LE.src.el(x); });
      if (!ids.length && id && LE.src.el(id) && id !== sid) ids = [id];
      if (ids.length) LE.view.send('select', { ids: ids });
    },
    changed: function (ops, label, slides) { LE.bus.emit('doc:changed', { ops: ops, label: label, slides: slides || [] }); }
  };
})();
