/* lecture-editor v4 · view controller: sandboxed iframe, messaging, sizing, zoom */
(function () {
  'use strict';
  var LE = window.LE;
  var H2I = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';
  var PAD = 44;
  // CSS zoom would render slightly crisper, but it changes the frame's devicePixelRatio, which
  // snaps border widths (a 2px border reads back as 1.9px) and lowers canvas resolution in
  // decks that draw charts. Exact values matter more for an editor, so scale with a transform.
  var ZOOM_OK = false;

  var V = LE.view = {
    frame: null, wrap: null, scroller: null, nonce: '', ready: false, info: null,
    docMode: false, W: 1920, H: 1080, tallH: 0, docW: 1280, z: 1, zMode: 'fit',
    pending: Object.create(null), rid: 0,

    init: function () {
      this.frame = document.getElementById('view');
      this.wrap = document.getElementById('frameWrap');
      this.scroller = document.getElementById('canvasScroll');
      this.docW = LE.prefs.get('docWidth', 1280);
      window.addEventListener('message', this.onMessage.bind(this));
      var lay = LE.debounce(this.layout.bind(this), 40);
      if (window.ResizeObserver) new ResizeObserver(lay).observe(this.scroller);
      else window.addEventListener('resize', lay);
      var self = this;
      this.scroller.addEventListener('wheel', function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        self.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }, { passive: false });
    },

    render: function (o) {
      o = o || {};
      var self = this;
      this.ready = false; this.info = null;
      Object.keys(this.pending).forEach(function (k) { clearTimeout(self.pending[k].t); self.pending[k].rej(new Error('re-render')); });
      this.pending = Object.create(null);
      LE.overlay.clear();
      this.nonce = LE.rand(12);
      var cfg = { nonce: this.nonce, idPrefix: 'v' + LE.rand(4) + '-', dev: LE.dev, start: o.start || 0, h2i: H2I };
      var bridge = '(' + window.LE_BRIDGE.toString() + ')(' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ');';
      var html = LE.src.viewHTML({ bridge: bridge, base: LE.file && LE.file.base, assets: LE.assets && LE.assets.rewriter() });
      if (!o.keepSize) { this.docMode = false; this.W = 1920; this.H = 1080; this.tallH = 0; this.zMode = 'fit'; }
      this.layout();
      void this.frame.offsetWidth; // apply the frame size before the new document is laid out
      LE.app.loading(true, o.message || '슬라이드를 분석하는 중…');
      clearTimeout(this._readyTimer);
      this._readyTimer = setTimeout(function () {
        if (!self.ready) { LE.app.loading(false); LE.toast('편집 화면 준비가 늦어지고 있습니다. 문서의 스크립트나 외부 자원을 기다리는 중일 수 있습니다.', 'warn', 8000); }
      }, 15000);
      this.frame.srcdoc = html;
      return new Promise(function (res) { self._onReady = res; });
    },

    onReady: function (d) {
      this.ready = true;
      this.info = d;
      clearTimeout(this._readyTimer);
      this.docMode = !!d.docMode;
      this.basis = d.basis || 'fixed';
      this.perSlide = !!d.perSlide;
      if (!d.docMode) {
        if (this.basis === 'viewport' && !this.perSlide) {
          // screen-relative deck: the editor picks the slide size and tells the frame
          var vp = this.vp || { W: 1920, H: 1080 };
          this.W = vp.W; this.H = vp.H;
          if (d.W !== vp.W || d.H !== vp.H) { d.W = vp.W; d.H = vp.H; this.send('setSize', { W: vp.W, H: vp.H }); }
        } else { this.W = d.W; this.H = d.H; }
      }
      this.layout();
      LE.app.loading(false);
      this.send('setOpts', { zoom: this.z, snap: LE.prefs.get('snap', true), builds: LE.prefs.get('builds', true) });
      if (this._onReady) { var r = this._onReady; this._onReady = null; r(d); }
    },

    onMessage: function (e) {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      var m = e.data;
      if (!m || m.__le !== 1 || m.n !== this.nonce) return;
      if (m.type === 'reply') {
        var d = m.data || {}, p = this.pending[d.rid];
        if (p) { delete this.pending[d.rid]; clearTimeout(p.t); if (d.err) p.rej(new Error(d.err)); else p.res(d.data); }
        return;
      }
      if (m.type === 'ready') this.onReady(m.data);
      if (m.type === 'slide' && m.data) {
        var t = m.data.tall || 0;
        var trustSize = this.ready ? (this.basis === 'fixed' || this.perSlide) : false;
        var sizeChanged = !this.docMode && trustSize && (m.data.W !== this.W || m.data.H !== this.H);
        if (sizeChanged) { this.W = m.data.W; this.H = m.data.H; }
        if (t !== this.tallH || sizeChanged) { this.tallH = t; this.layout(); }
      }
      LE.bus.emit('v:' + m.type, m.data);
    },
    send: function (cmd, args) {
      if (!this.frame || !this.frame.contentWindow) return;
      this.frame.contentWindow.postMessage({ __le: 1, n: this.nonce, cmd: cmd, args: args || {} }, '*');
    },
    call: function (cmd, args, ms) {
      var self = this;
      return new Promise(function (res, rej) {
        if (!self.frame || !self.frame.contentWindow) { rej(new Error('no view')); return; }
        var rid = ++self.rid;
        self.pending[rid] = { res: res, rej: rej, t: setTimeout(function () { delete self.pending[rid]; rej(new Error('응답 시간 초과: ' + cmd)); }, ms || 12000) };
        self.frame.contentWindow.postMessage({ __le: 1, n: self.nonce, cmd: cmd, args: args || {}, rid: rid }, '*');
      });
    },
    apply: function (ops, select) { this.send('apply', { ops: ops, select: select || null }); },
    focus: function () { try { this.frame.focus(); this.frame.contentWindow.focus(); } catch (e) {} },

    /* sizing & zoom */
    fitZoom: function () {
      var sc = this.scroller;
      var aw = Math.max(80, sc.clientWidth - PAD * 2), ah = Math.max(80, sc.clientHeight - PAD * 2);
      if (this.docMode) return LE.clamp(Math.min(1, aw / this.docW), 0.1, 1);
      return LE.clamp(Math.min(aw / this.W, ah / this.H), 0.05, 4);
    },
    layout: function () {
      if (!this.frame) return;
      var sc = this.scroller;
      if (this.zMode === 'fit') this.z = this.fitZoom();
      var W, H;
      if (this.docMode) {
        W = this.docW;
        H = Math.max(240, Math.floor((sc.clientHeight - PAD * 2) / this.z));
      } else {
        W = this.W;
        H = this.tallH > this.H ? this.tallH : this.H;
      }
      this.frame.style.width = W + 'px';
      this.frame.style.height = H + 'px';
      // CSS zoom keeps the frame's own viewport at native size and renders crisply at the
      // zoomed size; fall back to a transform where zoom is unsupported.
      if (ZOOM_OK) { this.frame.style.zoom = String(this.z); this.frame.style.transform = 'none'; }
      else { this.frame.style.zoom = ''; this.frame.style.transform = Math.abs(this.z - 1) < 1e-6 ? 'none' : 'scale(' + this.z + ')'; }
      this.wrap.style.width = Math.round(W * this.z) + 'px';
      this.wrap.style.height = Math.round(H * this.z) + 'px';
      this.wrap.classList.toggle('doc', this.docMode);
      LE.overlay.redraw();
      LE.bus.emit('zoom', this.z);
      if (this.ready) this.send('setOpts', { zoom: this.z });
    },
    setZoom: function (v) {
      if (v === 'fit') this.zMode = 'fit';
      else { this.zMode = 'manual'; this.z = LE.clamp(v, 0.05, 4); }
      this.layout();
    },
    zoomBy: function (f) {
      var sc = this.scroller;
      var cx = (sc.scrollLeft + sc.clientWidth / 2) / Math.max(1, sc.scrollWidth);
      var cy = (sc.scrollTop + sc.clientHeight / 2) / Math.max(1, sc.scrollHeight);
      this.setZoom(this.z * f);
      sc.scrollLeft = cx * sc.scrollWidth - sc.clientWidth / 2;
      sc.scrollTop = cy * sc.scrollHeight - sc.clientHeight / 2;
    },
    setDocWidth: function (w) { this.docW = w; LE.prefs.set('docWidth', w); this.zMode = 'fit'; this.layout(); },
    setSlideSize: function (W, H) {
      if (this.docMode) return;
      this.vp = { W: W, H: H };
      this.W = W; this.H = H; this.tallH = 0; this.zMode = 'fit';
      this.layout();
      this.send('setSize', { W: W, H: H });
    }
  };
})();
