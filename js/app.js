/* lecture-editor v4 · application shell: boot, state, wiring, dialogs */
(function () {
  'use strict';
  var LE = window.LE, h = LE.h;
  LE.sel = { ids: [], count: 0, info: null, editing: null };
  LE.text = { editing: false };

  var A = LE.app = {
    mode: 'edit', forceDirty: false, draftAt: 0, banners: Object.create(null),

    /* ---------------- boot ---------------- */
    boot: function () {
      LE.injectIcons();
      var theme = LE.prefs.get('theme', null) || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
      if (LE.prefs.get('hideLeft', false)) this.el().classList.add('no-left');
      if (LE.prefs.get('hideRight', false)) this.el().classList.add('no-right');
      this.decorate();
      LE.view.init(); LE.overlay.init(); LE.slides.init(); LE.layers.init(); LE.inspector.init();
      LE.menubar.init(); LE.toolbar.init();
      this.wire();
      this.renderWelcome();
      this.showDoc(false);
      LE.toolbar.refresh();
      LE.inspector.render(true);
      LE.recent.load().then(function () { A.renderWelcome(); });
      var q = new URLSearchParams(location.search);
      if (q.get('url')) LE.io.openUrl(q.get('url'));
      else if (q.get('new') != null) LE.io.newDeck();
    },
    el: function () { return document.getElementById('app'); },
    decorate: function () {
      LE.$$('[data-icon]').forEach(function (e) { e.insertAdjacentHTML('afterbegin', LE.icon(e.getAttribute('data-icon'))); });
      LE.$$('[data-cmd]:not(#toolbar [data-cmd])').forEach(function (b) {
        var id = b.getAttribute('data-cmd'), d = LE.cmd.get(id);
        if (!d) return;
        if (!b.title) b.title = d.label + (LE.cmd.keyLabel(id) ? ' (' + LE.cmd.keyLabel(id) + ')' : '');
        b.addEventListener('mousedown', function (e) { if (b.classList.contains('tb') || b.classList.contains('icon-btn')) e.preventDefault(); });
        b.addEventListener('click', function () { LE.cmd.run(id); });
      });
    },

    /* ---------------- event wiring ---------------- */
    wire: function () {
      var B = LE.bus;
      B.on('v:ready', function (d) { A.onReady(d); });
      B.on('v:slides', function (d) { LE.slides.set(d.slides, d.index); A.updateStatus(); LE.layers.refresh(); });
      B.on('v:slide', function (d) {
        LE.slides.curNotes = d.notes || null;
        LE.slides.onSlide(d);
        LE.inspector.slideInfo = null;
        LE.inspector.render(true);
        LE.layers.refresh();
      });
      B.on('v:select', function (d) {
        LE.sel = { ids: d.ids || [], count: d.count || 0, info: d.info || null, editing: d.editing };
        LE.overlay.redraw();
        LE.inspector.render();
        LE.toolbar.refresh();
        A.updateStatus();
        if (LE.layers.visible()) LE.layers.revealSelection();
      });
      B.on('v:rects', function (d) { LE.overlay.setRects(d); });
      B.on('v:guides', function (g) { LE.overlay.setGuides(g); });
      B.on('v:marquee', function (r) { LE.overlay.setMarquee(r); });
      B.on('v:size', function (s) { LE.overlay.setSize(s); });
      B.on('v:commit', function (d) { if (d && d.ops && d.ops.length) LE.ops.fromView(d.ops, d.label); });
      B.on('v:key', function (d) {
        if (LE.dialog.isOpen() || LE.present.isOpen()) return;
        if (LE.menu.isOpen() && d.key === 'Escape') { LE.menu.close(); return; }
        LE.keys.handle(d, { typing: false, native: false });
      });
      B.on('v:context', function (d) {
        var r = LE.view.frame.getBoundingClientRect(), z = LE.view.z;
        LE.menu.open(LE.menus.canvasContext(d), r.left + d.x * z, r.top + d.y * z);
      });
      B.on('v:text', function (d) {
        var sig = JSON.stringify(d);
        if (sig === A._textSig) return;
        var wasEditing = LE.text.editing;
        A._textSig = sig;
        LE.text = d;
        LE.toolbar.refresh();
        LE.overlay.redraw();
        if (wasEditing !== d.editing || d.editing) LE.inspector.render(wasEditing !== d.editing);
        A.updateStatus();
      });
      B.on('v:paste', function (d) { LE.clip.onPaste(d); });
      B.on('v:notice', function (d) { if (d && d.text) LE.toast(d.text, 'info', 1600); });
      B.on('v:clip', function (d) { LE.clip.fromView(d); });
      B.on('v:zoom', function (d) { LE.view.zoomBy(d.dy < 0 ? 1.1 : 1 / 1.1); });
      B.on('v:dbl', function (d) {
        if (d.kind === 'image') LE.insert.imageDialog(d.id);
        else LE.toast('동영상·임베드 주소는 속성 패널의 [고급 → HTML 편집]에서 바꿀 수 있습니다.', 'info');
      });
      B.on('v:dropfile', function (d) { if (d.text) LE.app.openDoc(d.text, { name: d.name, kind: 'local' }); else LE.toast(d.name + ' 파일은 넣을 수 없습니다. 그림이나 HTML 파일을 끌어 놓으세요.', 'warn'); });
      B.on('doc:changed', function (d) {
        LE.slides.touch(d.ops, d.slides);
        LE.drafts.schedule();
        A.updateSaveState();
        LE.layers.refresh();
        LE.toolbar.refresh();
      });
      B.on('hist', function () { A.updateSaveState(); LE.toolbar.refresh(); });
      B.on('zoom', function (z) { var l = document.getElementById('zoomLabel'); if (l) l.textContent = Math.round(z * 100) + '%'; });

      // keyboard (shell document)
      document.addEventListener('keydown', function (e) {
        if (LE.dialog.isOpen() || LE.present.isOpen()) return;
        if (LE.menu.isOpen() && LE.menu.key(e)) return;
        var t = e.target, typing = !!(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable));
        var slides = !!(t && t.closest && t.closest('#slideList'));
        LE.keys.handle(e, { typing: typing, native: true, slides: slides });
      });
      // clipboard (shell document, e.g. after clicking a panel)
      function typingTarget() { var t = document.activeElement; return !!(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)); }
      document.addEventListener('copy', function (e) { if (typingTarget() || !LE.sel.ids.length || (LE.sel.info && LE.sel.info.isSlide)) return; e.preventDefault(); LE.clip.copy(false, e); });
      document.addEventListener('cut', function (e) { if (typingTarget() || !LE.sel.ids.length || (LE.sel.info && LE.sel.info.isSlide)) return; e.preventDefault(); LE.clip.copy(true, e); });
      document.addEventListener('paste', function (e) {
        if (typingTarget() || LE.dialog.isOpen() || !LE.src.doc) return;
        var cd = e.clipboardData;
        if (!cd) return;
        e.preventDefault();
        var items = cd.items || [];
        for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { var f = items[i].getAsFile(); if (f) { LE.insert.readFile(f).then(function (u) { LE.clip.onPaste({ kind: 'image', data: u }); }); return; } }
        var html = cd.getData('text/html'), text = cd.getData('text/plain');
        var m = html && new RegExp('<' + '!--le-clip:([a-z0-9]+)--' + '>').exec(html);
        if (m) LE.clip.onPaste({ kind: 'clip', token: m[1], html: html, text: text });
        else if (html) LE.clip.onPaste({ kind: 'html', html: html, text: text });
        else if (text) LE.clip.onPaste({ kind: 'text', text: text });
      });
      // drag & drop files onto the window
      window.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); A.el().classList.add('dropping'); } });
      window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) A.el().classList.remove('dropping'); });
      window.addEventListener('drop', function (e) {
        A.el().classList.remove('dropping');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        e.preventDefault();
        if (/^image\//.test(f.type) && LE.src.doc) { LE.insert.readFile(f).then(function (u) { LE.insert.image(u); }); return; }
        var item = e.dataTransfer.items && e.dataTransfer.items[0];
        if (item && item.getAsFileSystemHandle) item.getAsFileSystemHandle().then(function (hd) { LE.io.openFile(f, hd && hd.kind === 'file' ? hd : null); }).catch(function () { LE.io.openFile(f, null); });
        else LE.io.openFile(f, null);
      });
      window.addEventListener('beforeunload', function (e) {
        if (!A.isDirty()) return;
        LE.drafts.write();
        e.preventDefault(); e.returnValue = '';
      });
      // left panel tabs
      LE.$$('.lp-tab').forEach(function (t) {
        t.addEventListener('click', function () {
          var tab = t.getAttribute('data-tab');
          A.el().classList.toggle('tab-layers', tab === 'layers');
          LE.$$('.lp-tab').forEach(function (x) { x.classList.toggle('on', x === t); });
          if (tab === 'layers') LE.layers.load();
        });
      });
      document.getElementById('docTitle').addEventListener('click', function () { A.rename(); });
      document.getElementById('compatChip').addEventListener('click', function () { A.showCompat(); });
      LE.$$('.wl-btn[data-cmd]').forEach(function () {});
    },

    /* ---------------- documents ---------------- */
    openDoc: async function (html, meta, o) {
      o = o || {};
      if (this.isDirty()) {
        var v = await LE.dialog.open({ title: '저장하지 않은 변경 내용', body: h('p', { class: 'modal-text', text: '지금 문서에 저장하지 않은 변경 내용이 있습니다. 다른 문서를 열기 전에 저장할까요?' }),
          buttons: [{ label: '취소', value: null }, { label: '저장하지 않음', value: 'discard' }, { label: '저장', value: 'save', primary: true }] });
        if (!v) return false;
        if (v === 'save') { await LE.io.save(); if (this.isDirty()) return false; }
      }
      LE.present.close(); LE.menu.close(); LE.colorPop.close(); LE.dialog.closeAll();
      try { LE.src.load(html); } catch (e) { LE.dialog.alert('문서를 읽지 못했습니다', e.message || String(e)); return false; }
      LE.file = Object.assign({ name: 'untitled.html', kind: 'new' }, meta);
      LE.file.key = LE.fileKey(LE.file);
      LE.hist.clear();
      this.forceDirty = !!o.dirty; this.draftAt = 0; this.mode = 'edit';
      LE.sel = { ids: [], count: 0, info: null }; LE.text = { editing: false }; this._textSig = '';
      LE.slides.reset(); LE.assets.reset(); this.hideBanner();
      LE.inspector.slideInfo = null; LE.layers.tree = null;
      this.showDoc(true);
      this.setTitle(); this.updateSaveState();
      await LE.view.render({ start: 0 });
      LE.recent.add(LE.file);
      if (LE.src.legacy) LE.toast('이전 편집기가 남긴 표시 ' + LE.src.legacy + '개를 정리했습니다. 저장하면 파일에도 반영됩니다.', 'info', 5000);
      await LE.drafts.check(html);
      return true;
    },
    restoreDraft: async function (html) {
      LE.src.load(html);
      LE.hist.clear();
      this.forceDirty = true;
      this.updateSaveState();
      await LE.view.render({ start: 0, message: '복구한 내용을 불러오는 중…' });
      LE.toast('저장하지 않았던 편집 내용을 복구했습니다. 저장해야 파일에 반영됩니다.', 'ok', 5000);
    },
    rerender: function (msg) {
      if (!LE.src.doc) return;
      return LE.view.render({ start: Math.max(0, LE.slides.index), keepSize: true, message: msg || '편집 화면을 다시 그리는 중…' });
    },
    onReady: function (d) {
      LE.slides.set(d.slides || [], d.index);
      // documents have no slides: show the element tree instead
      var wantTab = d.docMode ? 'layers' : 'slides';
      var tabBtn = document.querySelector('.lp-tab[data-tab="' + wantTab + '"]');
      if (tabBtn && !d.refresh && !tabBtn.classList.contains('on')) tabBtn.click();
      if (!d.refresh) this.setMode('edit', true);
      this.updateStatus(); this.updateNav();
      LE.inspector.render(true); LE.toolbar.refresh();
      LE.view.call('fonts', {}, 4000).then(function (f) { LE.fonts.doc = f || []; LE.toolbar.fillFonts(); }).catch(function () {});
      LE.layers.refresh();
      if (d.refresh) return;
      if (d.generated && d.docMode) {
        this.banner('gen', 'wand', '이 문서는 스크립트가 실행되면서 슬라이드를 만드는 형식입니다. 그대로는 편집해도 저장되지 않으니, 정적 슬라이드로 바꾼 뒤 편집하세요.', '정적 슬라이드로 변환', function () { LE.cmd.run('file.static'); });
      }
      var refs = LE.src.relativeRefs();
      if (refs.length && !(LE.file && LE.file.base) && !LE.assets.map) {
        if (window.showDirectoryPicker && LE.file && LE.file.kind !== 'drive') this.banner('assets', 'image', '이 문서는 같은 폴더의 그림·스타일 ' + refs.length + '개를 참조합니다. 편집 화면에서 보려면 그 파일이 있는 폴더를 연결하세요. 파일 내용은 바뀌지 않습니다.', '폴더 연결', function () { LE.assets.connect(); });
        else this.banner('assets', 'image', '이 문서가 참조하는 그림·스타일 ' + refs.length + '개는 상대 경로라 여기서 보이지 않을 수 있습니다. 저장한 파일을 원래 폴더에 두면 정상적으로 보입니다.');
      }
    },

    /* ---------------- state ---------------- */
    isDirty: function () { return !!LE.src.doc && (!LE.hist.isClean() || this.forceDirty); },
    markSaved: function (msg) {
      LE.hist.markSaved();
      this.forceDirty = false;
      LE.drafts.clear();
      this.draftAt = 0;
      this.updateSaveState();
      this.setTitle();
      if (msg) LE.toast(msg, 'ok');
    },
    updateSaveState: function () {
      var s = document.getElementById('saveState');
      if (!s) return;
      var dirty = this.isDirty();
      s.className = 'save-state ' + (LE.src.doc ? (dirty ? 'dirty' : 'clean') : '');
      s.textContent = !LE.src.doc ? '' : dirty ? ('저장 안 됨' + (this.draftAt ? ' · 임시 보관 ' + LE.timeLabel(this.draftAt) : '')) : '저장됨';
      var name = LE.file ? LE.file.name : '';
      document.title = (LE.src.doc ? (dirty ? '● ' : '') + name + ' — ' : '') + 'HTML 슬라이드 편집기';
      var sb = document.getElementById('saveBtnLabel');
      if (sb) sb.textContent = LE.file && LE.file.kind === 'drive' ? '드라이브에 저장' : '저장';
    },
    setTitle: function () {
      var t = document.getElementById('docTitle');
      if (!t) return;
      var f = LE.file;
      t.innerHTML = f ? LE.icon(f.kind === 'drive' ? 'cloud' : f.kind === 'url' ? 'globe' : f.kind === 'new' ? 'sparkle' : 'file-text') + '<span>' + LE.esc(f.name) + '</span>' : '';
      t.title = f ? (f.kind === 'drive' ? '구글 드라이브 파일 · 저장하면 같은 파일에 덮어씁니다' : f.kind === 'url' ? f.url : f.kind === 'local' ? (f.handle ? '내 컴퓨터 파일 · 저장하면 같은 파일에 덮어씁니다' : '내 컴퓨터 파일 · 저장하면 새로 내려받습니다') : '저장하지 않은 새 문서') + ' (클릭해서 이름 바꾸기)' : '';
    },
    rename: async function () {
      if (!LE.file) return;
      var v = await LE.dialog.prompt('이름 바꾸기', '저장할 때 쓸 파일 이름', LE.file.name, { hint: LE.file.handle ? '컴퓨터에 있는 원래 파일의 이름은 바뀌지 않습니다. 새 이름은 [다른 이름으로 저장]에 쓰입니다.' : '' });
      if (!v) return;
      if (!/\.x?html?$/i.test(v)) v += '.html';
      LE.file.name = v;
      this.setTitle(); this.updateSaveState();
    },
    showDoc: function (on) {
      this.el().classList.toggle('no-doc', !on);
      document.getElementById('welcome').hidden = !!on;
      if (!on) this.renderWelcome();
    },
    loading: function (on, msg) {
      var l = document.getElementById('loading');
      l.hidden = !on;
      if (msg) l.querySelector('.ld-msg').textContent = msg;
    },
    setMode: function (m, silent) {
      this.mode = m === 'interact' ? 'interact' : 'edit';
      this.el().classList.toggle('interact', this.mode === 'interact');
      if (LE.view.ready) LE.view.send('setMode', { mode: this.mode });
      LE.toolbar.refresh();
      LE.overlay.redraw();
      this.updateStatus();
      if (!silent && this.mode === 'interact') LE.toast('상호작용 모드: 문서 안의 탭·접기·버튼을 직접 눌러 볼 수 있습니다. 여기서 바뀐 상태는 저장되지 않습니다. Esc로 편집 모드로 돌아갑니다.', 'info', 5000);
    },
    togglePanel: function (side) {
      var cls = side === 'left' ? 'no-left' : 'no-right';
      var on = this.el().classList.toggle(cls);
      LE.prefs.set(side === 'left' ? 'hideLeft' : 'hideRight', on);
      setTimeout(function () { LE.view.layout(); }, 10);
    },
    toggleTheme: function () {
      var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      LE.prefs.set('theme', t);
    },
    selectAll: function () { LE.view.send('selectAll', { scope: 'slide' }); },
    selectSiblings: function () { LE.view.send('selectAll', { scope: 'siblings' }); },
    updateNav: function () {
      var info = document.getElementById('navInfo'), n = LE.slides.list.length;
      if (info) info.textContent = n ? (LE.slides.index + 1) + ' / ' + n : '';
      this.el().classList.toggle('doc-mode', !!(LE.view.info && LE.view.info.docMode));
    },
    updateStatus: function () {
      var chip = document.getElementById('compatChip'), info = LE.view.info;
      if (chip) {
        if (!info) chip.innerHTML = '';
        else chip.innerHTML = LE.icon(info.errorCount ? 'alert' : 'check') + '<span>' + LE.esc(info.label + (info.docMode ? '' : ' · ' + LE.view.W + '×' + LE.view.H)) + '</span>';
        chip.classList.toggle('warn', !!(info && (info.errorCount || info.generated)));
      }
      var hint = document.getElementById('statusHint');
      if (!hint) return;
      var s;
      if (!LE.src.doc) s = '';
      else if (this.mode === 'interact') s = '상호작용 모드 · 문서를 직접 눌러 봅니다 · Esc로 편집 모드';
      else if (LE.text.editing) s = '글자 편집 중 · Esc 또는 바깥 클릭으로 마침 · ' + LE.modLabel + 'B/I/U 서식';
      else if (LE.sel.count > 1) s = LE.sel.count + '개 선택 · 끌어서 함께 이동 · 화살표로 미세 이동 · Del 삭제';
      else if (LE.sel.count === 1 && LE.sel.info) s = LE.sel.info.label + ' · 다시 클릭하면 안쪽 요소 · 더블클릭 글자 편집 · Alt+↑ 바깥 요소';
      else s = LE.view.docMode ? '요소를 클릭해 선택 · 더블클릭으로 글자 편집' : '요소를 클릭해 선택 · 빈 곳을 끌어 여러 개 선택 · 우클릭으로 메뉴';
      hint.textContent = s;
    },

    /* ---------------- banners & progress ---------------- */
    banner: function (id, icon, text, action, fn) {
      var host = document.getElementById('banners');
      this.hideBanner(id);
      var b = h('div', { class: 'banner', 'data-id': id },
        h('span', { class: 'banner-ic', html: LE.icon(icon) }), h('span', { class: 'banner-t', text: text }),
        action ? h('button', { class: 'btn primary sm', text: action, onclick: fn }) : null,
        h('button', { class: 'icon-btn sm', title: '닫기', html: LE.icon('x'), onclick: function () { A.hideBanner(id); } }));
      host.appendChild(b);
    },
    hideBanner: function (id) { LE.$$('#banners .banner' + (id ? '[data-id="' + id + '"]' : '')).forEach(function (b) { b.remove(); }); },
    progress: function (title, total) {
      var bar = h('div', { class: 'pg-fill' }), txt = h('span', { class: 'pg-txt', text: '0 / ' + total });
      var api = { cancelled: false };
      var el = h('div', { class: 'progress' }, h('div', { class: 'pg-head' }, h('strong', { text: title }), txt), h('div', { class: 'pg-bar' }, bar),
        h('button', { class: 'btn ghost sm', text: '취소', onclick: function () { api.cancelled = true; txt.textContent = '취소하는 중…'; } }));
      document.body.appendChild(el);
      api.set = function (n) { bar.style.width = Math.round(n / total * 100) + '%'; txt.textContent = n + ' / ' + total; };
      api.close = function () { el.remove(); };
      return api;
    },

    /* ---------------- welcome ---------------- */
    renderWelcome: function () {
      var host = document.getElementById('welcomeRecent');
      if (!host) return;
      host.innerHTML = '';
      var list = LE.recent.cache || [];
      if (!list.length) { host.appendChild(h('div', { class: 'wl-empty', text: '최근에 연 파일이 여기에 표시됩니다.' })); return; }
      list.slice(0, 8).forEach(function (r) {
        host.appendChild(h('button', { class: 'wl-recent', onclick: function () { LE.recent.open(r); } },
          h('span', { class: 'wl-r-ic', html: LE.icon(r.kind === 'drive' ? 'cloud' : r.kind === 'url' ? 'globe' : 'file-text') }),
          h('span', { class: 'wl-r-name', text: r.name }),
          h('span', { class: 'wl-r-meta', text: (r.kind === 'drive' ? '드라이브' : r.kind === 'url' ? '웹 주소' : '내 컴퓨터') + ' · ' + LE.timeLabel(r.time) })));
      });
    },

    /* ---------------- dialogs ---------------- */
    slideSizeDialog: async function () {
      var cur = LE.view.W + '×' + LE.view.H;
      var opts = [['1920×1080', '16:9 · 1920 × 1080 (기본)'], ['1600×900', '16:9 · 1600 × 900'], ['1280×720', '16:9 · 1280 × 720'], ['1024×768', '4:3 · 1024 × 768'], ['1440×1080', '4:3 · 1440 × 1080'], ['1080×1350', '세로 4:5 · 1080 × 1350']];
      var body = h('div', { class: 'form' }, h('p', { class: 'modal-text', text: '화면 크기에 맞춰 늘어나는 덱(100vw·100vh 기준)입니다. 편집 화면의 기준 크기를 고르세요. 파일 내용은 바뀌지 않습니다.' }));
      opts.forEach(function (o) { body.appendChild(h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'sz', value: o[0], checked: o[0] === cur }), h('span', { text: o[1] }))); });
      var v = await LE.dialog.open({ title: '슬라이드 크기', body: body, buttons: [{ label: '취소', value: null }, { label: '적용', primary: true, value: function (b) { var r = b.querySelector('input[name=sz]:checked'); return r ? r.value : null; } }] });
      if (!v) return;
      var p = v.split('×').map(Number);
      LE.view.setSlideSize(p[0], p[1]);
      LE.slides.thumbs.clear(); LE.slides.render();
    },
    showCompat: function () {
      var i = LE.view.info;
      if (!i) return;
      var rows = [
        ['형식', i.label],
        i.docMode ? ['보기 폭', LE.view.docW + 'px'] : ['슬라이드', i.slides.length + '장 · ' + LE.view.W + ' × ' + LE.view.H + (i.basis === 'viewport' ? ' (화면 크기 기준)' : ' (고정 크기)')],
        i.selector ? ['슬라이드 인식', i.selector] : null,
        ['덱 스크립트', '편집 중에는 격리합니다. 키보드·클릭·휠로 넘기기, 자동 재생, 대화상자가 막히고, 스크립트가 실행 중에 바꾼 내용은 저장 파일에 들어가지 않습니다.'],
        ['오류', i.errorCount ? i.errorCount + '건 (편집 화면 안에서 발생, 편집에는 영향 없음)' : '없음'],
        i.shims && i.shims.length ? ['보안 격리', '이 문서는 브라우저 저장소(' + i.shims.join(', ') + ')를 쓰려 했습니다. 편집 화면에서는 임시 저장소로 대신합니다.'] : null,
        i.resErrors ? ['불러오지 못한 자원', i.resErrors + '개 (그림·스타일 경로 확인)'] : null,
        LE.src.legacy ? ['정리한 흔적', '이전 편집기가 남긴 표시 ' + LE.src.legacy + '개'] : null
      ].filter(Boolean);
      var tbl = h('div', { class: 'kv' });
      rows.forEach(function (r) { tbl.appendChild(h('div', { class: 'kv-k', text: r[0] })); tbl.appendChild(h('div', { class: 'kv-v', text: r[1] })); });
      var body = h('div', null, tbl);
      if (i.errors && i.errors.length) body.appendChild(h('details', { class: 'errs' }, h('summary', { text: '오류 내용 보기' }), h('pre', { class: 'mono', text: i.errors.join('\n') })));
      body.appendChild(h('p', { class: 'hint', text: '편집 화면이 이상하게 보이면 [보기 → 편집 화면 다시 그리기]나 [파일 → 정적 슬라이드로 변환]을 써 보세요. 발표할 때의 모습은 [발표 미리보기]가 정확합니다.' }));
      LE.dialog.open({ title: '호환성 정보', body: body, wide: true, buttons: [{ label: '닫기', value: true, primary: true }] });
    },
    showShortcuts: function () {
      var groups = [
        ['파일', ['file.open', 'file.save', 'file.saveAs', 'file.print', 'view.preview']],
        ['편집', ['edit.undo', 'edit.redo', 'edit.duplicate', 'edit.delete', 'edit.selectAll', 'edit.selectParent', 'edit.editText']],
        ['서식', ['format.bold', 'format.italic', 'format.underline', 'format.strike', 'format.bigger', 'format.smaller', 'format.center', 'format.link']],
        ['배치', ['arrange.front', 'arrange.forward', 'arrange.backward', 'arrange.back']],
        ['슬라이드·보기', ['slide.new', 'slide.duplicate', 'slide.next', 'slide.prev', 'view.zoomIn', 'view.zoomOut', 'view.fit']]
      ];
      var body = h('div', { class: 'keys' });
      groups.forEach(function (g) {
        var col = h('div', { class: 'keys-col' }, h('h3', { text: g[0] }));
        g[1].forEach(function (id) { var d = LE.cmd.get(id); if (d) col.appendChild(h('div', { class: 'keys-row' }, h('span', { text: d.label }), h('kbd', { text: LE.cmd.keyLabel(id) }))); });
        body.appendChild(col);
      });
      var extra = h('div', { class: 'keys-col' }, h('h3', { text: '마우스' }));
      [['클릭', '요소 선택 (카드·도형 같은 상자 먼저)'], ['다시 클릭', '안쪽 요소로 들어가기'], ['더블클릭', '글자 편집 / 그림 바꾸기'], ['Shift+클릭', '여러 개 선택'], [LE.modLabel + '클릭', '가장 안쪽 요소 바로 선택'], ['빈 곳 끌기', '범위로 여러 개 선택'], ['끌기 중 Shift', '가로·세로로만 이동'], ['끌기 중 ' + LE.modLabel, '맞춤선 끄기'], ['화살표 / Shift+화살표', '1px / 10px 이동'], ['우클릭', '메뉴']].forEach(function (r) { extra.appendChild(h('div', { class: 'keys-row' }, h('span', { text: r[1] }), h('kbd', { text: r[0] }))); });
      body.appendChild(extra);
      LE.dialog.open({ title: '단축키', body: body, wide: true, buttons: [{ label: '닫기', value: true, primary: true }] });
    },
    showGuide: function () {
      var items = [
        ['열기', 'HTML 파일을 화면에 끌어 놓거나 [열기]를 누릅니다. 구글 드라이브와 웹 주소에서도 열 수 있습니다.'],
        ['선택', '요소를 클릭하면 카드·도형·그림 같은 상자가 먼저 잡힙니다. 한 번 더 클릭하면 안쪽 글자로 들어가고, 속성 패널의 경로에서 바깥 요소를 고를 수도 있습니다.'],
        ['글자 편집', '더블클릭하거나 Enter를 누르면 그 자리에서 고칩니다. 글자를 드래그해 고른 뒤 툴바로 굵게·색·크기를 바꿉니다.'],
        ['이동·크기', '끌어서 옮기고, 파란 손잡이로 크기를 바꿉니다. 분홍 맞춤선에 저절로 붙습니다.'],
        ['슬라이드', '왼쪽 목록에서 끌어 순서를 바꾸고, 우클릭으로 복제·삭제합니다.'],
        ['발표 스크립트', '덱에 붙은 넘기기·편집 기능은 편집 중에는 잠시 꺼 둡니다. 저장한 파일에는 그대로 남고, [발표 미리보기]로 확인할 수 있습니다.'],
        ['저장', '내 컴퓨터에서 연 파일은 크롬·엣지에서 같은 파일에 바로 저장됩니다. 편집 내용은 몇 초마다 브라우저에 임시 보관되어, 창을 닫아도 복구할 수 있습니다.']
      ];
      var body = h('div', { class: 'guide' });
      items.forEach(function (it) { body.appendChild(h('div', { class: 'guide-row' }, h('strong', { text: it[0] }), h('p', { text: it[1] }))); });
      LE.dialog.open({ title: '사용 안내', body: body, wide: true, buttons: [{ label: '단축키 보기', value: 'keys' }, { label: '닫기', value: true, primary: true }] }).then(function (v) { if (v === 'keys') A.showShortcuts(); });
    },
    showAbout: function () {
      LE.dialog.open({ title: 'HTML 슬라이드 편집기', body: h('div', { class: 'guide' },
        h('p', { class: 'modal-text', text: '버전 ' + LE.version + '. HTML로 만든 강의 슬라이드를 브라우저에서 바로 고치는 편집기입니다. 서버 없이 동작하며, 파일 내용은 내 컴퓨터와 내 구글 드라이브 사이에서만 오갑니다.' }),
        h('p', { class: 'modal-text', text: '편집 화면은 보안 격리된 영역에서 문서를 그립니다. 문서 안의 스크립트는 편집기나 드라이브 연결에 접근할 수 없습니다.' }),
        h('p', { class: 'hint', text: '제작: 김광태' })), buttons: [{ label: '이전 버전(v3) 열기', value: 'legacy' }, { label: '닫기', value: true, primary: true }] }).then(function (v) { if (v === 'legacy') LE.cmd.run('help.legacy'); });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { A.boot(); });
  else A.boot();
})();
