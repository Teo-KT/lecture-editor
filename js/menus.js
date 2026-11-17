/* lecture-editor v4 · popup menus, menu bar, toolbar, context menus */
(function () {
  'use strict';
  var LE = window.LE, h = LE.h;

  /* ------------------------------------------------------------------ *
   * generic popup menu
   * item: {cmd:'id', arg} | {label, icon, run, key, disabled, checked, sub:[...]} | '-' | {header:'text'}
   * ------------------------------------------------------------------ */
  var M = LE.menu = {
    stack: [],
    isOpen: function () { return this.stack.length > 0; },
    close: function () {
      if (!this.stack.length) return false;
      this.stack.forEach(function (m) { m.el.remove(); });
      this.stack = [];
      document.removeEventListener('mousedown', this._out, true);
      LE.$$('.mb-btn.open').forEach(function (b) { b.classList.remove('open'); });
      if (this.onClose) { var f = this.onClose; this.onClose = null; f(); }
      return true;
    },
    resolve: function (it) {
      if (it === '-' || it.header) return it;
      if (it.cmd) {
        var d = LE.cmd.get(it.cmd) || {};
        return { label: it.label || d.label, icon: it.icon || d.icon, key: LE.cmd.keyLabel(it.cmd) || (d.keyHint ? labelOf(d.keyHint) : ''), disabled: !LE.cmd.can(it.cmd), checked: d.checked ? LE.cmd.on(it.cmd) : undefined,
          run: function () { LE.cmd.run(it.cmd, it.arg); } };
      }
      return it;
    },
    build: function (items, level) {
      var el = h('div', { class: 'menu', role: 'menu' });
      var self = this;
      items.forEach(function (raw) {
        var it = self.resolve(raw);
        if (!it) return;
        if (it === '-') { el.appendChild(h('div', { class: 'menu-sep' })); return; }
        if (it.header) { el.appendChild(h('div', { class: 'menu-head', text: it.header })); return; }
        var row = h('div', { class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.sub ? ' has-sub' : ''), role: 'menuitem', tabindex: '-1' },
          h('span', { class: 'mi-ic', html: it.checked !== undefined ? (it.checked ? LE.icon('check') : '') : (it.icon ? LE.icon(it.icon) : '') }),
          h('span', { class: 'mi-label', text: it.label }),
          it.key ? h('span', { class: 'mi-key', text: it.key }) : null,
          it.sub ? h('span', { class: 'mi-arrow', html: LE.icon('chev-right') }) : null);
        if (it.sub && !it.disabled) {
          row.addEventListener('mouseenter', function () { self.openSub(row, it.sub, level + 1); });
          row.addEventListener('click', function (e) { e.stopPropagation(); self.openSub(row, it.sub, level + 1); });
        } else {
          row.addEventListener('mouseenter', function () { self.trim(level + 1); });
          if (!it.disabled) row.addEventListener('click', function (e) { e.stopPropagation(); self.close(); if (it.run) it.run(); });
        }
        el.appendChild(row);
      });
      return el;
    },
    trim: function (level) { while (this.stack.length > level) this.stack.pop().el.remove(); },
    openSub: function (row, items, level) {
      this.trim(level);
      var el = this.build(items, level);
      document.getElementById('layer-menus').appendChild(el);
      var r = row.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
      var x = r.right - 4, y = r.top - 6;
      if (x + w > window.innerWidth - 6) x = r.left - w + 4;
      if (y + hh > window.innerHeight - 6) y = Math.max(6, window.innerHeight - hh - 6);
      el.style.left = x + 'px'; el.style.top = y + 'px';
      this.stack.push({ el: el });
    },
    open: function (items, x, y, o) {
      o = o || {};
      this.close();
      var el = this.build(items, 0);
      document.getElementById('layer-menus').appendChild(el);
      var w = el.offsetWidth, hh = el.offsetHeight;
      if (o.anchor) { var r = o.anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 4; }
      if (x + w > window.innerWidth - 6) x = Math.max(6, window.innerWidth - w - 6);
      if (y + hh > window.innerHeight - 6) y = Math.max(6, (o.anchor ? o.anchor.getBoundingClientRect().top - hh - 4 : window.innerHeight - hh - 6));
      el.style.left = x + 'px'; el.style.top = y + 'px';
      this.stack.push({ el: el });
      var self = this;
      this.onClose = o.onClose || null;
      this._out = function (e) {
        if (self.stack.some(function (m) { return m.el.contains(e.target); })) return;
        if (o.anchor && o.anchor.contains(e.target)) return;
        self.close();
      };
      setTimeout(function () { document.addEventListener('mousedown', self._out, true); }, 0);
      return el;
    },
    key: function (e) {
      if (!this.stack.length) return false;
      var m = this.stack[this.stack.length - 1].el;
      var items = LE.$$('.menu-item:not(.disabled)', m), cur = m.querySelector('.menu-item.focus'), i = items.indexOf(cur);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (cur) cur.classList.remove('focus');
        i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        if (items[i]) items[i].classList.add('focus');
        return true;
      }
      if (e.key === 'Enter' && cur) { e.preventDefault(); cur.click(); return true; }
      if (e.key === 'ArrowRight' && cur && cur.classList.contains('has-sub')) { e.preventDefault(); cur.click(); return true; }
      if (e.key === 'ArrowLeft' && this.stack.length > 1) { e.preventDefault(); this.trim(this.stack.length - 1); return true; }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
      return false;
    }
  };
  function labelOf(k) {
    var fake = { key: k };
    LE.cmd.reg.__tmp = fake;
    var s = LE.cmd.keyLabel('__tmp');
    delete LE.cmd.reg.__tmp;
    return s;
  }

  /* ------------------------------------------------------------------ *
   * menu definitions
   * ------------------------------------------------------------------ */
  var shapes = [{ cmd: 'insert.rect' }, { cmd: 'insert.rounded' }, { cmd: 'insert.ellipse' }, { cmd: 'insert.triangle' }, { cmd: 'insert.line' }, { cmd: 'insert.arrow' }];
  var aligns = [{ cmd: 'align.left' }, { cmd: 'align.hcenter' }, { cmd: 'align.right' }, '-', { cmd: 'align.top' }, { cmd: 'align.vcenter' }, { cmd: 'align.bottom' }, '-', { cmd: 'dist.h' }, { cmd: 'dist.v' }];
  var order = [{ cmd: 'arrange.front' }, { cmd: 'arrange.forward' }, { cmd: 'arrange.backward' }, { cmd: 'arrange.back' }];
  LE.menus = {
    bar: [
      { id: 'file', label: '파일', items: function () {
        return [{ cmd: 'file.new' }, { cmd: 'file.open' }, { cmd: 'file.openDrive' }, { cmd: 'file.openUrl' }, { label: '최근 파일', icon: 'clock', sub: LE.recent.menuItems() },
          '-', { cmd: 'file.save' }, { cmd: 'file.saveAs' }, { cmd: 'file.download' },
          '-', { cmd: 'file.saveDrive' }, { cmd: 'file.saveDriveAs' },
          '-', { label: '내보내기', icon: 'download', sub: [{ cmd: 'file.pdf' }, { cmd: 'file.print' }, { cmd: 'file.png' }] },
          { cmd: 'file.static' }, { cmd: 'file.folder' },
          '-', { cmd: 'file.driveOff' }];
      } },
      { id: 'edit', label: '편집', items: function () {
        var u = LE.hist.peekUndo(), r = LE.hist.peekRedo();
        return [{ cmd: 'edit.undo', label: '실행 취소' + (u ? ': ' + u.label : '') }, { cmd: 'edit.redo', label: '다시 실행' + (r ? ': ' + r.label : '') },
          '-', { cmd: 'edit.cut' }, { cmd: 'edit.copy' }, { cmd: 'edit.paste' }, { cmd: 'edit.duplicate' }, { cmd: 'edit.delete' },
          '-', { cmd: 'edit.selectAll' }, { cmd: 'edit.selectSiblings' }, { cmd: 'edit.selectParent' }, { cmd: 'edit.deselect' },
          '-', { cmd: 'edit.editText' }, { cmd: 'edit.editHTML' }];
      } },
      { id: 'insert', label: '삽입', items: function () {
        return [{ cmd: 'insert.text' }, { label: '도형', icon: 'shapes', sub: shapes }, { cmd: 'insert.image' }, { cmd: 'insert.table' }, { cmd: 'insert.divider' }, { cmd: 'insert.button' }, { cmd: 'insert.video' }, { cmd: 'insert.html' },
          '-', { cmd: 'slide.new' }, { cmd: 'slide.duplicate' }];
      } },
      { id: 'format', label: '서식', items: function () {
        return [{ cmd: 'format.bold' }, { cmd: 'format.italic' }, { cmd: 'format.underline' }, { cmd: 'format.strike' },
          '-', { cmd: 'format.bigger' }, { cmd: 'format.smaller' },
          '-', { cmd: 'format.left' }, { cmd: 'format.center' }, { cmd: 'format.right' }, { cmd: 'format.justify' },
          '-', { cmd: 'format.ul' }, { cmd: 'format.ol' }, { cmd: 'format.link' }, '-', { cmd: 'format.clear' }];
      } },
      { id: 'arrange', label: '배치', items: function () {
        return order.concat(['-', { header: '맞춤' }]).concat(aligns).concat(['-', { cmd: 'arrange.reset' }]);
      } },
      { id: 'slide', label: '슬라이드', items: function () {
        return [{ cmd: 'slide.new' }, { cmd: 'slide.duplicate' }, { cmd: 'slide.delete' }, '-', { cmd: 'slide.up' }, { cmd: 'slide.down' }, '-', { cmd: 'slide.prev' }, { cmd: 'slide.next' }, '-', { cmd: 'view.slideSize' }];
      } },
      { id: 'view', label: '보기', items: function () {
        return [{ cmd: 'view.preview' }, { cmd: 'view.previewStart' }, '-', { cmd: 'view.zoomIn' }, { cmd: 'view.zoomOut' }, { cmd: 'view.fit' }, { cmd: 'view.actual' },
          '-', { cmd: 'view.left' }, { cmd: 'view.right' }, '-', { cmd: 'view.interact' }, { cmd: 'view.builds' }, { cmd: 'view.snap' }, { cmd: 'view.anim' },
          '-', { cmd: 'view.theme' }, { cmd: 'view.reload' }];
      } },
      { id: 'help', label: '도움말', items: function () {
        return [{ cmd: 'help.guide' }, { cmd: 'help.keys' }, { cmd: 'help.compat' }, '-', { cmd: 'help.legacy' }, { cmd: 'help.about' }];
      } }
    ],
    canvasContext: function (d) {
      var pt = d.pt, info = LE.sel.info;
      if (d.empty || !info) {
        return [{ cmd: 'edit.paste', arg: pt }, '-',
          { cmd: 'insert.text', label: '여기에 텍스트 상자', arg: pt },
          { label: '여기에 도형', icon: 'shapes', sub: shapes.map(function (s) { return { cmd: s.cmd, arg: pt }; }) },
          { cmd: 'insert.image' }, { cmd: 'insert.table', arg: pt },
          '-', { cmd: 'edit.selectAll' },
          LE.view.docMode ? null : '-',
          LE.view.docMode ? null : { label: '슬라이드', icon: 'slides', sub: [{ cmd: 'slide.new' }, { cmd: 'slide.duplicate' }, { cmd: 'slide.delete' }] }].filter(Boolean);
      }
      var items = [];
      if (info.canEdit && LE.sel.count === 1) items.push({ cmd: 'edit.editText' });
      if (info.kind === 'image') items.push({ cmd: 'insert.replaceImage' });
      items.push({ cmd: 'edit.selectParent' }, { cmd: 'edit.selectSiblings' }, '-',
        { cmd: 'edit.cut' }, { cmd: 'edit.copy' }, { cmd: 'edit.paste' }, { cmd: 'edit.duplicate' }, { cmd: 'edit.delete' }, '-',
        { label: '순서', icon: 'front', sub: order }, { label: '맞춤', icon: 'al-hcenter', sub: aligns }, { cmd: 'arrange.reset' });
      if (d.cell) {
        items.push('-', { label: '표', icon: 'table', sub: [
          { label: '위에 행 추가', run: function () { LE.table.op('rowAbove', d.cell); } }, { label: '아래에 행 추가', run: function () { LE.table.op('rowBelow', d.cell); } },
          { label: '왼쪽에 열 추가', run: function () { LE.table.op('colLeft', d.cell); } }, { label: '오른쪽에 열 추가', run: function () { LE.table.op('colRight', d.cell); } },
          '-', { label: '행 삭제', run: function () { LE.table.op('rowDel', d.cell); } }, { label: '열 삭제', run: function () { LE.table.op('colDel', d.cell); } }] });
      }
      items.push('-', { cmd: 'format.link' }, { cmd: 'edit.editHTML' });
      return items;
    },
    slideContext: function (i) {
      return [{ cmd: 'slide.new' }, { cmd: 'slide.duplicate' }, { cmd: 'slide.delete' }, '-', { cmd: 'slide.up' }, { cmd: 'slide.down' }, '-', { cmd: 'view.preview', label: '이 슬라이드부터 미리보기' }];
    }
  };

  /* ------------------------------------------------------------------ *
   * menu bar
   * ------------------------------------------------------------------ */
  LE.menubar = {
    init: function () {
      var bar = document.getElementById('menubar');
      LE.menus.bar.forEach(function (m) {
        var b = h('button', { class: 'mb-btn', text: m.label, 'data-menu': m.id });
        b.addEventListener('mousedown', function (e) {
          e.preventDefault();
          if (b.classList.contains('open')) { M.close(); return; }
          openBar(b, m);
        });
        b.addEventListener('mouseenter', function () {
          var open = document.querySelector('.mb-btn.open');
          if (open && open !== b) openBar(b, m);
        });
        bar.appendChild(b);
      });
      function openBar(b, m) {
        M.open(m.items(), 0, 0, { anchor: b });
        b.classList.add('open');
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * toolbar
   * ------------------------------------------------------------------ */
  function tb(cmd, extra) {
    var d = LE.cmd.get(cmd);
    var b = h('button', { class: 'tb', 'data-cmd': cmd, title: d.label + (LE.cmd.keyLabel(cmd) ? ' (' + LE.cmd.keyLabel(cmd) + ')' : ''), html: LE.icon(d.icon) + (extra || '') });
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () { LE.cmd.run(cmd); });
    return b;
  }
  function tdrop(icon, title, items, label) {
    var b = h('button', { class: 'tb drop', title: title, html: LE.icon(icon) + (label ? '<span class="tb-l">' + label + '</span>' : '') + LE.icon('chev-down', 'caret') });
    b.addEventListener('mousedown', function (e) { e.preventDefault(); if (M.isOpen()) { M.close(); return; } M.open(typeof items === 'function' ? items() : items, 0, 0, { anchor: b }); });
    return b;
  }
  function sep() { return h('span', { class: 'tb-sep' }); }
  LE.toolbar = {
    init: function () {
      var t = document.getElementById('toolbar');
      var mode = h('div', { class: 'seg mode-seg' },
        h('button', { class: 'seg-b on', 'data-mode': 'edit', title: '편집 모드: 요소 선택·이동·글자 편집', html: LE.icon('pointer') + '<span>편집</span>' }),
        h('button', { class: 'seg-b', 'data-mode': 'interact', title: '상호작용 모드: 문서 안의 탭·접기·버튼을 직접 눌러 열어 봅니다 (Esc로 복귀)', html: LE.icon('hand') + '<span>상호작용</span>' }));
      LE.$$('.seg-b', mode).forEach(function (b) { b.addEventListener('click', function () { LE.app.setMode(b.getAttribute('data-mode')); }); });
      this.fontSel = h('select', { class: 'select tb-font', title: '글꼴' });
      this.fontSel.addEventListener('change', function () { LE.fmt.apply('font', LE.toolbar.fontSel.value); LE.toolbar.fontSel.blur(); });
      this.sizeIn = h('input', { class: 'tb-size', title: '글자 크기 (px)', inputmode: 'decimal' });
      this.sizeIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var n = parseFloat(LE.toolbar.sizeIn.value); if (n > 0) LE.fmt.apply('size', n + 'px'); LE.toolbar.sizeIn.blur(); } });
      this.colorBtn = h('button', { class: 'tb color', title: '글자색', html: LE.icon('text-color') + '<span class="tb-bar"></span>' });
      this.colorBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      this.colorBtn.addEventListener('click', function () {
        var c = LE.text.editing && LE.text.f ? LE.text.f.color : (LE.sel.info ? LE.sel.info.computed.color : '#000000');
        LE.colorPop.open(LE.toolbar.colorBtn, { value: c, title: '글자색', allowNone: false, onPick: function (v) { LE.fmt.apply('color', v); } });
      });
      this.hiBtn = h('button', { class: 'tb color', title: '강조색(배경)', html: LE.icon('highlight') + '<span class="tb-bar hi"></span>' });
      this.hiBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      this.hiBtn.addEventListener('click', function () { LE.colorPop.open(LE.toolbar.hiBtn, { value: '#fde68a', title: LE.text.editing ? '강조색' : '배경색', onPick: function (v) { LE.fmt.apply('highlight', v); } }); });
      t.appendChild(h('div', { class: 'tb-group' }, mode));
      t.appendChild(sep());
      t.appendChild(h('div', { class: 'tb-group' }, tb('edit.undo'), tb('edit.redo')));
      t.appendChild(sep());
      t.appendChild(h('div', { class: 'tb-group' },
        tb('insert.text'),
        tdrop('shapes', '도형', shapes),
        tb('insert.image'), tb('insert.table'),
        tdrop('plus', '더 넣기', [{ cmd: 'insert.divider' }, { cmd: 'insert.button' }, { cmd: 'insert.video' }, { cmd: 'insert.html' }, '-', { cmd: 'slide.new' }, { cmd: 'slide.duplicate' }])));
      t.appendChild(sep());
      t.appendChild(h('div', { class: 'tb-group text-tools' }, this.fontSel, this.sizeIn,
        tb('format.bold'), tb('format.italic'), tb('format.underline'), tb('format.strike'), this.colorBtn, this.hiBtn));
      t.appendChild(sep());
      t.appendChild(h('div', { class: 'tb-group' },
        tdrop('align-left', '문단 정렬', [{ cmd: 'format.left' }, { cmd: 'format.center' }, { cmd: 'format.right' }, { cmd: 'format.justify' }, '-', { cmd: 'format.ul' }, { cmd: 'format.ol' }]),
        tdrop('al-hcenter', '요소 맞춤', aligns),
        tdrop('front', '순서', order)));
      t.appendChild(sep());
      t.appendChild(h('div', { class: 'tb-group' }, tb('edit.duplicate'), tb('edit.delete')));
      t.appendChild(h('div', { class: 'tb-flex' }));
      t.appendChild(h('div', { class: 'tb-group' }, tb('view.snap'), tb('view.builds')));
      this.fillFonts();
    },
    fillFonts: function () {
      var s = this.fontSel, cur = s.value;
      s.innerHTML = '';
      s.appendChild(h('option', { value: '', text: '글꼴' }));
      var docF = (LE.fonts.doc || []).filter(function (n) { return !LE.fonts.list.some(function (x) { return x.label === n; }); });
      if (docF.length) { var g = h('optgroup', { label: '문서의 글꼴' }); docF.forEach(function (n) { g.appendChild(h('option', { value: /\s/.test(n) ? "'" + n + "'" : n, text: n })); }); s.appendChild(g); }
      var g2 = h('optgroup', { label: '글꼴' });
      LE.fonts.list.forEach(function (f) { g2.appendChild(h('option', { value: f.value, text: f.label })); });
      s.appendChild(g2);
      s.value = cur;
    },
    refresh: function () {
      LE.$$('#toolbar [data-cmd]').forEach(function (b) {
        var id = b.getAttribute('data-cmd');
        b.disabled = !LE.cmd.can(id);
        var d = LE.cmd.get(id);
        if (d.checked) b.classList.toggle('on', LE.cmd.on(id));
      });
      var on = function (id, v) { var b = document.querySelector('#toolbar [data-cmd="' + id + '"]'); if (b) b.classList.toggle('on', !!v); };
      var info = LE.sel.info, ed = LE.text.editing, f = LE.text.f || {}, c = info ? info.computed : null;
      if (ed) { on('format.bold', f.bold); on('format.italic', f.italic); on('format.underline', f.underline); on('format.strike', f.strike); }
      else if (c) { on('format.bold', parseInt(c['font-weight'], 10) >= 600); on('format.italic', c['font-style'] === 'italic'); on('format.underline', /underline/.test(c['text-decoration-line'])); on('format.strike', /line-through/.test(c['text-decoration-line'])); }
      else { ['format.bold', 'format.italic', 'format.underline', 'format.strike'].forEach(function (id) { on(id, false); }); }
      var has = !!(info || ed);
      this.fontSel.disabled = !has; this.sizeIn.disabled = !has; this.colorBtn.disabled = !has; this.hiBtn.disabled = !has;
      if (document.activeElement !== this.sizeIn) this.sizeIn.value = has ? Math.round(parseFloat(ed && f.size ? f.size : c ? c['font-size'] : '') || 0) || '' : '';
      if (document.activeElement !== this.fontSel) {
        var fam = ed && f.font ? f.font : c ? c['font-family'] : '';
        var first = (fam || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase(), match = '';
        LE.$$('option', this.fontSel).forEach(function (o) { if (o.value && o.value.split(',')[0].replace(/["']/g, '').trim().toLowerCase() === first) match = o.value; });
        this.fontSel.value = match;
      }
      var col = ed && f.color ? f.color : c ? c.color : 'transparent';
      this.colorBtn.querySelector('.tb-bar').style.background = col;
      LE.$$('#toolbar .mode-seg .seg-b').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === LE.app.mode); });
    }
  };
})();
