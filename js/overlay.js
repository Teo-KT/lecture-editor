/* lecture-editor v4 · selection overlay drawn over the view (crisp at any zoom) */
(function () {
  'use strict';
  var LE = window.LE;
  var DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  var O = LE.overlay = {
    el: null, last: { sel: [], hover: null, editing: null, hoverLabel: '' }, guides: [], marquee: null, size: null,
    resizing: false, hidden: false,
    init: function () {
      this.el = document.getElementById('overlay');
      this.boxes = [];
      this.hoverBox = this.mk('ov-hover');
      this.hoverTag = this.mk('ov-tag');
      this.editBox = this.mk('ov-edit');
      this.marqueeBox = this.mk('ov-marquee');
      this.sizeTag = this.mk('ov-size');
      this.guideEls = [];
      this.handles = DIRS.map(function (d) {
        var h = LE.h('div', { class: 'ov-handle h-' + d, 'data-dir': d });
        h.addEventListener('pointerdown', function (e) { O.startResize(e, d, h); });
        O.el.appendChild(h);
        return h;
      });
      this.redraw = LE.raf(this._draw.bind(this));
    },
    mk: function (cls) { var d = LE.h('div', { class: cls }); this.el.appendChild(d); return d; },
    clear: function () { this.last = { sel: [], hover: null, editing: null, hoverLabel: '' }; this.guides = []; this.marquee = null; this.size = null; if (this.redraw) this.redraw(); },
    setRects: function (d) { this.last = d || this.last; this.redraw(); },
    setGuides: function (g) { this.guides = g || []; this.redraw(); },
    setMarquee: function (r) { this.marquee = r; this.redraw(); },
    setSize: function (s) { this.size = s; this.redraw(); },
    place: function (el, r, z) {
      if (!r) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.left = Math.round(r.x * z) + 'px';
      el.style.top = Math.round(r.y * z) + 'px';
      el.style.width = Math.max(0, Math.round(r.w * z)) + 'px';
      el.style.height = Math.max(0, Math.round(r.h * z)) + 'px';
    },
    _draw: function () {
      if (!this.el) return;
      var z = LE.view.z || 1, L = this.last || {}, sel = (L.sel || []).filter(Boolean);
      var interact = LE.app && LE.app.mode === 'interact';
      this.el.classList.toggle('off', !!interact || !LE.view.ready);
      // selection boxes
      while (this.boxes.length < sel.length) this.boxes.push(this.mk('ov-sel'));
      for (var i = 0; i < this.boxes.length; i++) this.place(this.boxes[i], sel[i] || null, z);
      this.boxes.forEach(function (b, i) { b.classList.toggle('multi', sel.length > 1); b.classList.toggle('slide', !!(LE.sel.info && LE.sel.info.isSlide && i === 0)); });
      // hover
      this.place(this.hoverBox, L.hover, z);
      if (L.hover && L.hoverLabel && !this.resizing) {
        this.hoverTag.style.display = 'block';
        this.hoverTag.textContent = L.hoverLabel;
        this.hoverTag.style.left = Math.round(L.hover.x * z) + 'px';
        this.hoverTag.style.top = Math.round(L.hover.y * z) + 'px';
      } else this.hoverTag.style.display = 'none';
      // text editing frame
      this.place(this.editBox, L.editing, z);
      // handles (single selection, not editing, not the slide itself)
      var one = sel.length === 1 && !L.editing && !(LE.sel.info && LE.sel.info.isSlide) ? sel[0] : null;
      var small = one && (one.w * z < 26 || one.h * z < 26);
      this.handles.forEach(function (h) {
        var d = h.getAttribute('data-dir');
        if (!one || (small && d.length === 1)) { h.style.display = 'none'; return; }
        var x = one.x * z, y = one.y * z, w = one.w * z, hh = one.h * z;
        var px = d.indexOf('w') >= 0 ? x : d.indexOf('e') >= 0 ? x + w : x + w / 2;
        var py = d.indexOf('n') >= 0 ? y : d.indexOf('s') >= 0 ? y + hh : y + hh / 2;
        h.style.display = 'block';
        h.style.left = Math.round(px) + 'px';
        h.style.top = Math.round(py) + 'px';
      });
      // size label
      if (this.size && one) {
        this.sizeTag.style.display = 'block';
        this.sizeTag.textContent = this.size.w + ' × ' + this.size.h;
        this.sizeTag.style.left = Math.round((one.x + one.w / 2) * z) + 'px';
        this.sizeTag.style.top = Math.round((one.y + one.h) * z + 10) + 'px';
      } else this.sizeTag.style.display = 'none';
      // guides
      var g = this.guides || [];
      while (this.guideEls.length < g.length) this.guideEls.push(this.mk('ov-guide'));
      this.guideEls.forEach(function (el, k) {
        var q = g[k];
        if (!q) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        if (q.x != null) { el.className = 'ov-guide v'; el.style.left = Math.round(q.x * z) + 'px'; el.style.top = Math.round(q.y1 * z) + 'px'; el.style.width = '1px'; el.style.height = Math.round((q.y2 - q.y1) * z) + 'px'; }
        else { el.className = 'ov-guide h'; el.style.top = Math.round(q.y * z) + 'px'; el.style.left = Math.round(q.x1 * z) + 'px'; el.style.height = '1px'; el.style.width = Math.round((q.x2 - q.x1) * z) + 'px'; }
      });
      this.place(this.marqueeBox, this.marquee, z);
    },
    startResize: function (e, dir, h) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { h.setPointerCapture(e.pointerId); } catch (x) {}
      var x0 = e.clientX, y0 = e.clientY, z = LE.view.z || 1;
      O.resizing = true;
      document.body.classList.add('resizing', 'rz-' + dir);
      LE.view.send('resizeStart', { dir: dir });
      var lastEv = null, queued = false;
      function send(ev) { LE.view.send('resizeMove', { dx: (ev.clientX - x0) / z, dy: (ev.clientY - y0) / z, shift: ev.shiftKey, alt: ev.altKey, nosnap: ev.metaKey || ev.ctrlKey }); }
      function mv(ev) {
        lastEv = ev;
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; if (lastEv) { send(lastEv); lastEv = null; } });
      }
      function up(ev) {
        h.removeEventListener('pointermove', mv);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        if (lastEv) { send(lastEv); lastEv = null; } else if (ev && ev.type === 'pointerup') send(ev);
        O.resizing = false;
        document.body.classList.remove('resizing', 'rz-' + dir);
        LE.view.send('resizeEnd', {});
      }
      h.addEventListener('pointermove', mv);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    }
  };
})();
