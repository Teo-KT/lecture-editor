/* lecture-editor v4 · inspector (right panel), formatting controller, colour picker */
(function () {
  'use strict';
  var LE = window.LE, h = LE.h;

  var GF = 'https://fonts.googleapis.com/css2?family=';
  var FONTS = [
    { label: 'Pretendard', value: "'Pretendard Variable', Pretendard, sans-serif", href: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css' },
    { label: 'Noto Sans KR', value: "'Noto Sans KR', sans-serif", href: GF + 'Noto+Sans+KR:wght@300;400;500;700;900&display=swap' },
    { label: 'Noto Serif KR', value: "'Noto Serif KR', serif", href: GF + 'Noto+Serif+KR:wght@400;600;700;900&display=swap' },
    { label: '나눔고딕', value: "'Nanum Gothic', sans-serif", href: GF + 'Nanum+Gothic:wght@400;700;800&display=swap' },
    { label: '나눔명조', value: "'Nanum Myeongjo', serif", href: GF + 'Nanum+Myeongjo:wght@400;700;800&display=swap' },
    { label: 'IBM Plex Sans KR', value: "'IBM Plex Sans KR', sans-serif", href: GF + 'IBM+Plex+Sans+KR:wght@300;400;500;600;700&display=swap' },
    { label: 'Gowun Dodum', value: "'Gowun Dodum', sans-serif", href: GF + 'Gowun+Dodum&display=swap' },
    { label: 'Black Han Sans', value: "'Black Han Sans', sans-serif", href: GF + 'Black+Han+Sans&display=swap' },
    { label: 'Inter', value: 'Inter, sans-serif', href: GF + 'Inter:wght@300;400;500;600;700;800&display=swap' },
    { label: 'Roboto', value: 'Roboto, sans-serif', href: GF + 'Roboto:wght@300;400;500;700;900&display=swap' },
    { label: 'Montserrat', value: 'Montserrat, sans-serif', href: GF + 'Montserrat:wght@300;400;600;700;800&display=swap' },
    { label: 'Playfair Display', value: "'Playfair Display', serif", href: GF + 'Playfair+Display:wght@400;600;700;800&display=swap' },
    { label: 'Merriweather', value: 'Merriweather, serif', href: GF + 'Merriweather:wght@300;400;700;900&display=swap' },
    { label: '시스템 고딕', value: "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" },
    { label: '명조 (serif)', value: "Georgia, 'Times New Roman', serif" },
    { label: '고정폭', value: "'SFMono-Regular', Menlo, Consolas, monospace" }
  ];
  LE.fonts = { list: FONTS, doc: [] };
  var SHADOWS = [
    { label: '없음', value: 'none' },
    { label: '얕게', value: '0 2px 6px rgba(15,23,42,.18)' },
    { label: '보통', value: '0 10px 28px rgba(15,23,42,.22)' },
    { label: '깊게', value: '0 24px 60px rgba(15,23,42,.30)' }
  ];
  var PALETTE = ['#000000', '#1f2937', '#4b5563', '#9ca3af', '#d1d5db', '#f3f4f6', '#ffffff',
    '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed',
    '#ca8a04', '#059669', '#0d9488', '#4f46e5', '#c026d3', '#db2777', '#1e40af',
    '#fecaca', '#fed7aa', '#fde68a', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe',
    '#fef08a', '#a7f3d0', '#99f6e4', '#c7d2fe', '#f5d0fe', '#fbcfe8', '#e0f2fe',
    '#7f1d1d', '#7c2d12', '#78350f', '#14532d', '#164e63', '#1e3a8a', '#4c1d95',
    '#713f12', '#064e3b', '#134e4a', '#312e81', '#701a75', '#831843', '#0f172a'];

  /* ------------------------------------------------------------------ *
   * editing helpers
   * ------------------------------------------------------------------ */
  LE.edit = {
    ids: function () { return (LE.sel.ids || []).slice(); },
    css: function (props, label, merge, ids) {
      ids = ids || this.ids();
      if (!ids.length) return;
      LE.ops.run(ids.map(function (id) { return { t: 'css', id: id, set: Object.assign({}, props) }; }), label || '스타일',
        { merge: merge ? merge + ':' + ids.join(',') : null });
    },
    attr: function (name, value, label, id) {
      id = id || (LE.sel.info && LE.sel.info.id);
      if (!id) return;
      LE.ops.run([{ t: 'attr', id: id, name: name, value: value }], label || '속성 변경');
    },
    fontOps: function (font) {
      if (!font || !font.href || !LE.src.doc || !LE.src.doc.head) return [];
      var exists = Array.prototype.some.call(LE.src.doc.head.querySelectorAll('link'), function (l) { return (l.getAttribute('href') || '') === font.href; });
      if (exists) return [];
      var f = LE.src.fresh('<link rel="stylesheet" href="' + LE.esc(font.href) + '">');
      return [{ t: 'insert', parent: LE.src.headId(), before: null, html: f.html }];
    },
    replaceHTML: function (id, html) {
      var el = LE.src.el(id);
      if (!el || !el.parentElement) return;
      var items = LE.src.freshAll(html, false);
      if (!items.length) { LE.toast('올바른 HTML이 아닙니다.', 'error'); return; }
      var parent = LE.src.idOf(el.parentElement), before = LE.src.nextId(el);
      var ops = [{ t: 'remove', id: id }];
      items.forEach(function (it) { ops.push({ t: 'insert', parent: parent, before: before, html: it.html }); });
      LE.ops.run(ops, 'HTML 편집', { select: items.map(function (i) { return i.id; }) });
    }
  };

  /* ------------------------------------------------------------------ *
   * formatting controller — used by toolbar, menus, shortcuts, inspector
   * ------------------------------------------------------------------ */
  var EXEC = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough', ul: 'insertUnorderedList', ol: 'insertOrderedList' };
  LE.fmt = {
    apply: function (kind, value) {
      var info = LE.sel.info, c = info ? info.computed : {};
      var editing = LE.text && LE.text.editing, f = (LE.text && LE.text.f) || {};
      if (!info && !editing) { LE.toast('먼저 요소를 선택하세요.', 'info'); return; }
      if (editing) {
        if (EXEC[kind]) { LE.view.send('exec', { cmd: EXEC[kind] }); return; }
        if (kind === 'clear') { LE.view.send('exec', { cmd: 'removeFormat' }); return; }
        if (kind === 'link') { this.link(); return; }
        if (kind === 'align') { LE.edit.css({ 'text-align': value }, '정렬', null, [LE.text.id]); return; }
        if (!f.collapsed) {
          if (kind === 'color') { LE.view.send('exec', { cmd: 'foreColor', value: value || 'inherit' }); return; }
          if (kind === 'highlight') { LE.view.send('exec', { cmd: 'hiliteColor', value: value || 'transparent' }); return; }
          if (kind === 'size') { LE.view.send('exec', { cmd: 'fontSize', value: value }); return; }
          if (kind === 'font') { this.fontLinks(value); LE.view.send('exec', { cmd: 'fontName', value: value }); return; }
          if (kind === 'sizeStep') { var cur = parseFloat(f.size) || parseFloat(c['font-size']) || 16; LE.view.send('exec', { cmd: 'fontSize', value: Math.max(6, Math.round(cur * (value > 0 ? 1.12 : 1 / 1.12))) + 'px' }); return; }
        }
        // collapsed caret: style the whole edited element
        var ids = [LE.text.id];
        if (kind === 'color') return LE.edit.css({ color: value }, '글자색', null, ids);
        if (kind === 'size') return LE.edit.css({ 'font-size': value }, '글자 크기', null, ids);
        if (kind === 'font') return this.setFont(value, ids);
        if (kind === 'sizeStep') { var fs = parseFloat(f.size) || parseFloat(c['font-size']) || 16; return LE.edit.css({ 'font-size': Math.max(6, Math.round(fs * (value > 0 ? 1.12 : 1 / 1.12))) + 'px' }, '글자 크기', null, ids); }
        if (kind === 'highlight') return LE.toast('강조색은 글자를 드래그해 선택한 뒤 적용하세요.', 'info');
        return;
      }
      var w = parseInt(c['font-weight'], 10) || 400, deco = c['text-decoration-line'] || '';
      switch (kind) {
        case 'bold': return LE.edit.css({ 'font-weight': w >= 600 ? 'normal' : 'bold' }, '굵게');
        case 'italic': return LE.edit.css({ 'font-style': c['font-style'] === 'italic' ? 'normal' : 'italic' }, '기울임');
        case 'underline': return LE.edit.css({ 'text-decoration-line': /underline/.test(deco) ? 'none' : (deco.replace('none', '') + ' underline').trim() }, '밑줄');
        case 'strike': return LE.edit.css({ 'text-decoration-line': /line-through/.test(deco) ? 'none' : (deco.replace('none', '') + ' line-through').trim() }, '취소선');
        case 'color': return LE.edit.css({ color: value }, '글자색');
        case 'highlight': return LE.edit.css({ 'background-color': value }, '배경색');
        case 'size': return LE.edit.css({ 'font-size': value }, '글자 크기');
        case 'sizeStep': { var fs2 = parseFloat(c['font-size']) || 16; return LE.edit.css({ 'font-size': Math.max(6, Math.round(fs2 * (value > 0 ? 1.12 : 1 / 1.12))) + 'px' }, '글자 크기', 'fsstep'); }
        case 'font': return this.setFont(value);
        case 'align': return LE.edit.css({ 'text-align': value }, '정렬');
        case 'clear': return LE.edit.css({ color: '', 'font-size': '', 'font-weight': '', 'font-style': '', 'font-family': '', 'text-decoration': '', 'text-decoration-line': '', 'background-color': '', 'text-align': '', 'line-height': '', 'letter-spacing': '' }, '서식 지우기');
        case 'ul': case 'ol': return LE.toast('목록은 글자 편집 중(더블클릭)에 쓸 수 있습니다.', 'info');
        case 'link': return this.link();
      }
    },
    fontLinks: function (value) {
      var font = FONTS.filter(function (f) { return f.value === value; })[0];
      var ops = LE.edit.fontOps(font);
      if (ops.length) LE.ops.run(ops, '글꼴 불러오기');
    },
    setFont: function (value, ids) {
      ids = ids || LE.edit.ids();
      if (!ids.length) return;
      var font = FONTS.filter(function (f) { return f.value === value; })[0];
      var ops = LE.edit.fontOps(font).concat(ids.map(function (id) { return { t: 'css', id: id, set: { 'font-family': value } }; }));
      LE.ops.run(ops, '글꼴');
    },
    link: function () {
      var info = LE.sel.info;
      var cur = info && info.link ? info.link.href : '';
      LE.dialog.prompt('링크', '연결할 주소 (URL)', cur || 'https://', { placeholder: 'https://example.com' }).then(function (url) {
        if (url == null) return;
        url = url.trim();
        if (LE.text && LE.text.editing) { if (url) LE.view.send('exec', { cmd: 'createLink', value: url }); else LE.view.send('exec', { cmd: 'unlink' }); return; }
        if (info && info.link) { LE.edit.attr('href', url || null, url ? '링크 주소' : '링크 제거', info.link.id); return; }
        if (info && url) {
          var el = LE.src.el(info.id);
          if (!el) return;
          var f = LE.src.fresh('<a href="' + LE.esc(url) + '">' + el.innerHTML + '</a>', false);
          LE.ops.run([{ t: 'html', id: info.id, html: f.html }], '링크 걸기');
        }
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * colour popover
   * ------------------------------------------------------------------ */
  LE.colorPop = {
    el: null,
    close: function () { if (this.el) { this.el.remove(); this.el = null; document.removeEventListener('mousedown', this._out, true); } },
    open: function (anchor, o) {
      this.close();
      var self = this, cur = LE.hex(o.value) || '';
      function pick(v, keep) { o.onPick(v, !!keep); if (!keep) self.close(); }
      var sw = function (c) { return h('button', { class: 'sw' + (LE.hex(c) === cur ? ' on' : ''), style: { background: c }, title: c, onclick: function () { pick(c); } }); };
      var docRow = h('div', { class: 'cp-grid doc' }, h('span', { class: 'cp-loading', text: '…' }));
      var hex = h('input', { class: 'input cp-hex', value: cur, placeholder: '#000000', spellcheck: 'false' });
      hex.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var v = hex.value.trim(); if (v) pick(/^[0-9a-f]{3,8}$/i.test(v) ? '#' + v : v); } });
      var nat = h('input', { type: 'color', class: 'cp-native', value: cur && cur.length === 7 ? cur : '#3b82f6', title: '직접 고르기' });
      nat.addEventListener('input', function () { hex.value = nat.value; pick(nat.value, true); });
      nat.addEventListener('change', function () { pick(nat.value); });
      var el = h('div', { class: 'pop colorpop', role: 'dialog' },
        o.title ? h('div', { class: 'cp-title', text: o.title }) : null,
        h('div', { class: 'cp-label', text: '문서에서 쓰는 색' }), docRow,
        h('div', { class: 'cp-label', text: '기본 색' }), h('div', { class: 'cp-grid' }, PALETTE.map(sw)),
        h('div', { class: 'cp-row' }, hex, nat,
          o.allowNone !== false ? h('button', { class: 'btn ghost sm', text: '없음', onclick: function () { pick(o.noneValue != null ? o.noneValue : 'transparent'); } }) : null));
      document.body.appendChild(el);
      this.el = el;
      var r = anchor.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight;
      var x = Math.min(window.innerWidth - pw - 8, Math.max(8, r.left)), y = r.bottom + 6;
      if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6);
      el.style.left = x + 'px'; el.style.top = y + 'px';
      this._out = function (e) { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) self.close(); };
      setTimeout(function () { document.addEventListener('mousedown', self._out, true); }, 0);
      LE.view.call('colors', {}, 4000).then(function (cols) {
        docRow.innerHTML = '';
        var seen = {};
        (cols || []).map(LE.hex).filter(function (c) { if (!c || seen[c]) return false; seen[c] = 1; return true; }).slice(0, 14).forEach(function (c) { docRow.appendChild(sw(c)); });
        if (!docRow.children.length) docRow.appendChild(h('span', { class: 'cp-loading', text: '—' }));
      }).catch(function () { docRow.innerHTML = ''; });
    }
  };

  /* ------------------------------------------------------------------ *
   * small control builders
   * ------------------------------------------------------------------ */
  function sec(id, title, icon, body, open) {
    var st = LE.prefs.get('sec.' + id, open !== false);
    var d = h('details', { class: 'isec', 'data-sec': id });
    if (st) d.setAttribute('open', '');
    d.appendChild(h('summary', null, h('span', { class: 'isec-ic', html: LE.icon(icon) }), h('span', { text: title }), h('span', { class: 'isec-chev', html: LE.icon('chev-down') })));
    d.appendChild(h('div', { class: 'isec-body' }, body));
    d.addEventListener('toggle', function () { LE.prefs.set('sec.' + id, d.open); });
    return d;
  }
  function row(label) {
    var r = h('div', { class: 'irow' }, label ? h('span', { class: 'ilabel', text: label }) : null);
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) r.appendChild(arguments[i]);
    return r;
  }
  function num(o) {
    var wrap = h('label', { class: 'num' + (o.wide ? ' wide' : ''), title: o.title || '' });
    var lab = o.prefix ? h('span', { class: 'num-pre', text: o.prefix }) : null;
    var inp = h('input', { class: 'num-in', value: o.value == null ? '' : String(o.value), placeholder: o.placeholder || '', inputmode: 'decimal', spellcheck: 'false' });
    var unit = o.unit ? h('span', { class: 'num-unit', text: o.unit }) : null;
    if (lab) wrap.appendChild(lab);
    wrap.appendChild(inp);
    if (unit) wrap.appendChild(unit);
    function commit() {
      var v = inp.value.trim();
      if (v === String(o.value == null ? '' : o.value)) return;
      o.onCommit(v);
    }
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        var n = parseFloat(inp.value) || 0, st = (o.step || 1) * (e.shiftKey ? 10 : 1);
        n = e.key === 'ArrowUp' ? n + st : n - st;
        if (o.min != null) n = Math.max(o.min, n);
        if (o.max != null) n = Math.min(o.max, n);
        inp.value = String(Math.round(n * 100) / 100);
        o.onCommit(inp.value, true);
      } else if (e.key === 'Escape') { inp.value = o.value == null ? '' : String(o.value); inp.blur(); }
    });
    inp.addEventListener('change', commit);
    if (lab && o.scrub !== false) {
      lab.classList.add('scrub');
      lab.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        lab.setPointerCapture(e.pointerId);
        var x0 = e.clientX, v0 = parseFloat(inp.value) || 0, st = o.step || 1;
        LE.inspector.dragging = true;
        function mv(ev) {
          var n = v0 + Math.round((ev.clientX - x0) / 2) * st * (ev.shiftKey ? 10 : 1);
          if (o.min != null) n = Math.max(o.min, n);
          if (o.max != null) n = Math.min(o.max, n);
          n = Math.round(n * 100) / 100;
          if (String(n) !== inp.value) { inp.value = String(n); o.onCommit(inp.value, true); }
        }
        function up() { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); LE.inspector.dragging = false; LE.inspector.render(true); }
        lab.addEventListener('pointermove', mv);
        lab.addEventListener('pointerup', up);
      });
    }
    return wrap;
  }
  function colorBtn(o) {
    var c = o.value, none = LE.alpha(c) < 0.02;
    var b = h('button', { class: 'colorbtn' + (none ? ' none' : ''), title: o.title || '' },
      h('span', { class: 'chip', style: { background: none ? 'transparent' : c } }),
      h('span', { class: 'colorbtn-hex', text: none ? '없음' : LE.hex(c) }));
    b.addEventListener('click', function () { LE.colorPop.open(b, { value: c, title: o.title, allowNone: o.allowNone, noneValue: o.noneValue, onPick: o.onPick }); });
    return b;
  }
  function select(options, value, onChange, cls) {
    var s = h('select', { class: 'select' + (cls ? ' ' + cls : '') });
    var found = false;
    options.forEach(function (op) {
      if (op.group) { var g = h('optgroup', { label: op.group }); op.items.forEach(function (it) { var o2 = h('option', { value: it.value, text: it.label }); if (it.value === value) { o2.selected = true; found = true; } g.appendChild(o2); }); s.appendChild(g); return; }
      var o = h('option', { value: op.value, text: op.label });
      if (op.value === value) { o.selected = true; found = true; }
      s.appendChild(o);
    });
    if (!found && value) { var x = h('option', { value: value, text: value.split(',')[0].replace(/["']/g, '') }); x.selected = true; s.insertBefore(x, s.firstChild); }
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }
  function iconBtn(icon, title, onClick, on) {
    return h('button', { class: 'ibtn' + (on ? ' on' : ''), title: title, html: LE.icon(icon), onclick: onClick });
  }
  function seg(items, value, onPick) {
    var s = h('div', { class: 'seg' });
    items.forEach(function (it) {
      s.appendChild(h('button', { class: 'seg-b' + (it.value === value ? ' on' : ''), title: it.title, html: it.icon ? LE.icon(it.icon) : '', text: it.icon ? null : it.label, onclick: function () { onPick(it.value); } }));
    });
    return s;
  }
  function px(v) { var n = parseFloat(v); return isFinite(n) ? Math.round(n * 10) / 10 : ''; }
  function withUnit(v, unit) { v = String(v).trim(); if (!v) return ''; return /^-?\d+(\.\d+)?$/.test(v) ? v + (unit || 'px') : v; }

  /* ------------------------------------------------------------------ *
   * the inspector
   * ------------------------------------------------------------------ */
  var I = LE.inspector = {
    el: null, key: '', dragging: false, slideInfo: null,
    init: function () {
      this.el = document.getElementById('inspector');
      this.render = LE.debounce(this._render.bind(this), 30);
      var self = this;
      this.el.addEventListener('pointerdown', function (e) { if (e.target.type === 'range') self.dragging = true; });
      document.addEventListener('pointerup', function () { if (self.dragging) { self.dragging = false; self.render(true); } });
    },
    _render: function (force) {
      var el = this.el;
      if (!el) return;
      if (!LE.src.doc) { el.innerHTML = ''; el.appendChild(h('div', { class: 'empty-note', text: '문서를 열면 여기에서 속성을 편집할 수 있습니다.' })); return; }
      if (this.dragging) return;
      var s = LE.sel || {}, key = (s.ids || []).join(',') + '|' + (LE.text.editing ? 'e' : '') + '|' + (LE.slides.curId() || '');
      var ae = document.activeElement;
      if (!force && key === this.key && ae && el.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      var scroll = el.scrollTop;
      this.key = key;
      el.innerHTML = '';
      if (!s.ids || !s.ids.length) this.renderNone(el);
      else this.renderSel(el, s);
      el.scrollTop = scroll;
    },

    renderNone: function (el) {
      var V = LE.view, info = V.info;
      if (!info) return;
      if (info.docMode) {
        el.appendChild(h('div', { class: 'insp-head' }, h('div', { class: 'insp-title', html: LE.icon('file-text') + '<span>문서</span>' })));
        el.appendChild(sec('doc', '보기', 'eye', [
          row('보기 폭', select([{ value: '1440', label: '와이드 1440' }, { value: '1280', label: '데스크톱 1280' }, { value: '1024', label: '노트북 1024' }, { value: '768', label: '태블릿 768' }, { value: '390', label: '모바일 390' }], String(V.docW), function (v) { V.setDocWidth(+v); })),
          h('p', { class: 'hint', text: '일반 HTML 문서로 인식했습니다. 요소를 클릭해 편집하고, 더블클릭으로 글자를 고칩니다.' })
        ]));
        this.renderDocInfo(el, info);
        return;
      }
      var cur = LE.slides.list[LE.slides.index], self = this;
      el.appendChild(h('div', { class: 'insp-head' }, h('div', { class: 'insp-title', html: LE.icon('slides') + '<span>슬라이드 ' + (LE.slides.index + 1) + '</span>' }),
        h('div', { class: 'insp-sub', text: cur ? cur.title : '' })));
      var si = this.slideInfo, c = si && si.computed ? si.computed : {};
      var sid = LE.slides.curId();
      var bgRows = [
        row('배경색', colorBtn({ value: c['background-color'] || 'transparent', title: '슬라이드 배경색', onPick: function (v, live) { LE.edit.css({ 'background-color': v }, '슬라이드 배경', live ? 'slidebg' : null, [sid]); } })),
        row('배경 그림', h('div', { class: 'btnrow' },
          h('button', { class: 'btn secondary sm', html: LE.icon('image') + '<span>그림 넣기</span>', onclick: function () { LE.insert.pickImage().then(function (url) { if (url) LE.edit.css({ 'background-image': 'url("' + url + '")', 'background-size': 'cover', 'background-position': 'center' }, '배경 그림', null, [sid]); }); } }),
          c['background-image'] && c['background-image'] !== 'none' ? h('button', { class: 'btn ghost sm', text: '지우기', onclick: function () { LE.edit.css({ 'background-image': 'none' }, '배경 그림 지우기', null, [sid]); } }) : null))
      ];
      el.appendChild(sec('slide', '슬라이드', 'fill', bgRows));
      var notes = LE.slides.curNotes;
      if (notes && notes.type !== 'none') {
        var ta = h('textarea', { class: 'input notes', rows: 5, placeholder: '발표자 노트', value: notes.text || '' });
        ta.addEventListener('change', function () {
          if (notes.type === 'aside') LE.ops.run([{ t: 'html', id: notes.id, html: LE.esc(ta.value) }], '발표자 노트');
          else LE.edit.attr(notes.attr, ta.value, '발표자 노트', notes.id);
          notes.text = ta.value;
        });
        el.appendChild(sec('notes', '발표자 노트', 'note', [ta]));
      }
      el.appendChild(sec('slideops', '슬라이드 관리', 'slides', [h('div', { class: 'btngrid' },
        h('button', { class: 'btn secondary sm', html: LE.icon('plus') + '<span>새 슬라이드</span>', onclick: function () { LE.slides.add(); } }),
        h('button', { class: 'btn secondary sm', html: LE.icon('duplicate') + '<span>복제</span>', onclick: function () { LE.slides.duplicate(); } }),
        h('button', { class: 'btn secondary sm', html: LE.icon('chev-up') + '<span>앞으로</span>', onclick: function () { LE.slides.move(LE.slides.index, LE.slides.index - 1); } }),
        h('button', { class: 'btn secondary sm', html: LE.icon('chev-down') + '<span>뒤로</span>', onclick: function () { LE.slides.move(LE.slides.index, LE.slides.index + 1); } }),
        h('button', { class: 'btn danger-ghost sm', html: LE.icon('trash') + '<span>삭제</span>', onclick: function () { LE.slides.remove(); } }))]));
      this.renderDocInfo(el, info);
      if (!si || si.id !== sid) LE.view.call('infoOf', { id: sid }, 3000).then(function (r) { self.slideInfo = r; if (!LE.sel.ids.length) { self.key = ''; self.render(true); } }).catch(function () {});
    },
    renderDocInfo: function (el, info) {
      var V = LE.view;
      var rows = [
        row('형식', h('span', { class: 'ival', text: info.label })),
        info.docMode ? null : row('슬라이드', h('span', { class: 'ival', text: info.slides.length + '장 · ' + V.W + ' × ' + V.H })),
        row('상태', h('span', { class: 'ival ' + (info.errorCount ? 'warn' : 'ok'), text: info.errorCount ? '문서 스크립트 오류 ' + info.errorCount + '건 (편집에는 영향 없음)' : '정상' }))
      ];
      var btns = h('div', { class: 'btnrow' }, h('button', { class: 'btn ghost sm', html: LE.icon('info') + '<span>호환성 정보</span>', onclick: function () { LE.app.showCompat(); } }));
      if (!info.docMode && info.basis === 'viewport') btns.appendChild(h('button', { class: 'btn ghost sm', html: LE.icon('fit') + '<span>슬라이드 크기</span>', onclick: function () { LE.cmd.run('view.slideSize'); } }));
      rows.push(btns);
      el.appendChild(sec('docinfo', '문서 정보', 'info', rows, false));
    },

    renderSel: function (el, s) {
      var info = s.info, self = this;
      if (!info) return;
      var c = info.computed || {}, multi = s.count > 1, editing = LE.text.editing;
      // header + path
      var head = h('div', { class: 'insp-head' },
        h('div', { class: 'insp-title', html: LE.icon(kindIcon(info.kind)) + '<span>' + LE.esc(multi ? s.count + '개 요소' : info.label) + '</span>' }),
        editing ? h('div', { class: 'insp-badge', text: '글자 편집 중 — 선택한 글자에 적용' }) : (info.text && !multi ? h('div', { class: 'insp-sub', text: info.text }) : null));
      el.appendChild(head);
      if (!multi && info.path && info.path.length > 1) {
        var pth = h('div', { class: 'insp-path' });
        info.path.forEach(function (p, i) {
          if (i) pth.appendChild(h('span', { class: 'pth-sep', html: LE.icon('chev-right') }));
          pth.appendChild(h('button', { class: 'pth' + (p.id === info.id ? ' on' : ''), text: p.label, title: p.id === info.id ? '현재 선택' : '이 요소 선택', onclick: function () { if (p.id !== info.id) LE.view.send('select', { ids: [p.id] }); } }));
        });
        el.appendChild(pth);
      }
      el.appendChild(h('div', { class: 'quick' },
        iconBtn('parent', '바깥 요소 선택 (Alt+↑)', function () { LE.cmd.run('edit.selectParent'); }),
        info.canEdit && !multi ? iconBtn('type', '글자 편집 (Enter)', function () { LE.cmd.run('edit.editText'); }, editing) : null,
        iconBtn('duplicate', '복제 (' + LE.modLabel + 'D)', function () { LE.cmd.run('edit.duplicate'); }),
        iconBtn('front', '맨 앞으로', function () { LE.cmd.run('arrange.front'); }),
        iconBtn('back', '맨 뒤로', function () { LE.cmd.run('arrange.back'); }),
        h('span', { class: 'quick-sp' }),
        iconBtn('trash', '삭제 (Del)', function () { LE.cmd.run('edit.delete'); })));

      // text first when editing
      var textSec = (info.canEdit || info.hasText || multi) ? this.textSection(info, c, editing) : null;
      if (editing && textSec) el.appendChild(textSec);

      // layout
      var isImg = info.kind === 'image';
      var keep = LE.prefs.get('keepRatio', true);
      var lay = [
        multi ? null : row('위치', num({ prefix: 'X', value: info.x, onCommit: function (v) { LE.view.send('moveTo', { x: parseFloat(v) || 0 }); } }), num({ prefix: 'Y', value: info.y, onCommit: function (v) { LE.view.send('moveTo', { y: parseFloat(v) || 0 }); } })),
        multi ? null : row('크기', num({ prefix: 'W', value: info.w, min: 1, onCommit: function (v) { LE.view.send('resizeTo', { w: parseFloat(v), keep: isImg && keep }); } }),
          num({ prefix: 'H', value: info.h, min: 1, onCommit: function (v) { LE.view.send('resizeTo', { h: parseFloat(v), keep: isImg && keep }); } }),
          isImg ? iconBtn('lock', '비율 고정', function () { LE.prefs.set('keepRatio', !keep); self.render(true); }, keep) : null),
        row('정렬', h('div', { class: 'tools' },
          iconBtn('al-left', multi ? '왼쪽 맞춤' : '슬라이드 왼쪽에 맞춤', function () { LE.view.send('align', { mode: 'left' }); }),
          iconBtn('al-hcenter', '가로 가운데', function () { LE.view.send('align', { mode: 'hcenter' }); }),
          iconBtn('al-right', '오른쪽 맞춤', function () { LE.view.send('align', { mode: 'right' }); }),
          iconBtn('al-top', '위쪽 맞춤', function () { LE.view.send('align', { mode: 'top' }); }),
          iconBtn('al-vcenter', '세로 가운데', function () { LE.view.send('align', { mode: 'vcenter' }); }),
          iconBtn('al-bottom', '아래쪽 맞춤', function () { LE.view.send('align', { mode: 'bottom' }); }))),
        multi && s.count > 2 ? row('간격', h('div', { class: 'tools' },
          iconBtn('dist-h', '가로 간격 같게', function () { LE.view.send('distribute', { axis: 'h' }); }),
          iconBtn('dist-v', '세로 간격 같게', function () { LE.view.send('distribute', { axis: 'v' }); }))) : null,
        row('순서', h('div', { class: 'tools' },
          iconBtn('front', '맨 앞으로 (' + LE.modLabel + '⌥])', function () { LE.cmd.run('arrange.front'); }),
          iconBtn('forward', '앞으로 (' + LE.modLabel + '])', function () { LE.cmd.run('arrange.forward'); }),
          iconBtn('back', '맨 뒤로 (' + LE.modLabel + '⌥[)', function () { LE.cmd.run('arrange.back'); }),
          iconBtn('move', '위치 초기화', function () { LE.cmd.run('arrange.reset'); })))
      ];
      el.appendChild(sec('layout', '배치', 'move', lay));

      // fill & border
      var bw = c['border-top-style'] === 'none' ? 0 : px(c['border-top-width']);
      var fill = [
        row('배경색', colorBtn({ value: c['background-color'], title: '배경색', onPick: function (v, live) { LE.edit.css({ 'background-color': v }, '배경색', live ? 'bg' : null); } })),
        c['background-image'] && c['background-image'] !== 'none' ? row('배경 그림', h('button', { class: 'btn ghost sm', text: '배경 그림 지우기', onclick: function () { LE.edit.css({ 'background-image': 'none' }, '배경 그림 지우기'); } })) : null,
        row('테두리', num({ prefix: '두께', value: bw, unit: 'px', min: 0, onCommit: function (v, live) { var n = parseFloat(v) || 0; LE.edit.css(n ? { 'border-width': n + 'px', 'border-style': c['border-top-style'] === 'none' ? 'solid' : c['border-top-style'] } : { 'border-width': '0px' }, '테두리 두께', live ? 'bw' : null); } }),
          select([{ value: 'solid', label: '실선' }, { value: 'dashed', label: '파선' }, { value: 'dotted', label: '점선' }, { value: 'double', label: '이중선' }, { value: 'none', label: '없음' }], c['border-top-style'], function (v) {
            var set = { 'border-style': v };
            if (v !== 'none' && !(parseFloat(c['border-top-width']) > 0)) set['border-width'] = Math.max(1, Math.round((LE.view.W || 1920) / 960)) + 'px';
            LE.edit.css(set, '테두리 모양');
          }, 'sm')),
        row('테두리색', colorBtn({ value: c['border-top-color'], title: '테두리색', allowNone: true, onPick: function (v, live) {
          var set = { 'border-color': v };
          if (c['border-top-style'] === 'none' || !(parseFloat(c['border-top-width']) > 0)) { set['border-style'] = 'solid'; set['border-width'] = Math.max(1, Math.round((LE.view.W || 1920) / 960)) + 'px'; }
          LE.edit.css(set, '테두리색', live ? 'bc' : null);
        } })),
        row('둥글기', num({ prefix: 'R', value: px(c['border-top-left-radius']), unit: 'px', min: 0, onCommit: function (v, live) { LE.edit.css({ 'border-radius': withUnit(v) }, '모서리 둥글기', live ? 'radius' : null); } })),
        row('그림자', select(SHADOWS.map(function (x) { return { value: x.value, label: x.label }; }).concat(c['box-shadow'] !== 'none' && !SHADOWS.some(function (x) { return x.value === c['box-shadow']; }) ? [{ value: c['box-shadow'], label: '사용자 지정' }] : []), c['box-shadow'] === 'none' ? 'none' : c['box-shadow'], function (v) { LE.edit.css({ 'box-shadow': v }, '그림자'); })),
        row('투명도', (function () {
          var v0 = Math.round((parseFloat(c.opacity) || 1) * 100);
          var r = h('input', { type: 'range', class: 'range', min: 0, max: 100, value: v0 });
          var lab = h('span', { class: 'ival mono', text: v0 + '%' });
          r.addEventListener('input', function () { lab.textContent = r.value + '%'; LE.edit.css({ opacity: String(r.value / 100) }, '투명도', 'op'); });
          return h('div', { class: 'rangewrap' }, r, lab);
        })())
      ];
      el.appendChild(sec('fill', '채우기 · 테두리', 'fill', fill));
      if (!editing && textSec) el.appendChild(textSec);

      // kind specific
      if (isImg && !multi) {
        var alt = h('input', { class: 'input', value: info.attr.alt, placeholder: '그림 설명 (접근성)' });
        alt.addEventListener('change', function () { LE.edit.attr('alt', alt.value, '대체 텍스트'); });
        el.appendChild(sec('image', '그림', 'image', [
          h('div', { class: 'btnrow' },
            h('button', { class: 'btn secondary sm', html: LE.icon('replace') + '<span>그림 바꾸기</span>', onclick: function () { LE.cmd.run('insert.replaceImage'); } }),
            h('button', { class: 'btn ghost sm', text: '원래 비율', onclick: function () { LE.edit.css({ height: 'auto' }, '원래 비율'); } })),
          row('맞춤', select([{ value: 'fill', label: '늘이기' }, { value: 'contain', label: '전체 보이기' }, { value: 'cover', label: '채우기(잘림)' }, { value: 'none', label: '원래 크기' }, { value: 'scale-down', label: '줄이기만' }], c['object-fit'], function (v) { LE.edit.css({ 'object-fit': v }, '그림 맞춤'); })),
          row('설명', alt),
          info.natural ? h('p', { class: 'hint', text: '원본 ' + info.natural.w + ' × ' + info.natural.h + ' · ' + (info.attr.src || '').slice(0, 60) }) : null
        ]));
      }
      if (info.link && !multi) {
        var href = h('input', { class: 'input', value: info.link.href, placeholder: 'https://' });
        href.addEventListener('change', function () { LE.edit.attr('href', href.value.trim() || null, '링크 주소', info.link.id); });
        var nt = h('input', { type: 'checkbox', checked: info.link.target === '_blank' });
        nt.addEventListener('change', function () { LE.edit.attr('target', nt.checked ? '_blank' : null, '새 탭에서 열기', info.link.id); });
        el.appendChild(sec('link', '링크', 'link', [row('주소', href), h('label', { class: 'check' }, nt, h('span', { text: '새 탭에서 열기' }))]));
      }
      if (info.cell && !multi) {
        el.appendChild(sec('table', '표', 'table', [h('div', { class: 'btngrid' },
          h('button', { class: 'btn secondary sm', text: '위에 행 추가', onclick: function () { LE.table.op('rowAbove', info.cell); } }),
          h('button', { class: 'btn secondary sm', text: '아래에 행 추가', onclick: function () { LE.table.op('rowBelow', info.cell); } }),
          h('button', { class: 'btn secondary sm', text: '왼쪽에 열 추가', onclick: function () { LE.table.op('colLeft', info.cell); } }),
          h('button', { class: 'btn secondary sm', text: '오른쪽에 열 추가', onclick: function () { LE.table.op('colRight', info.cell); } }),
          h('button', { class: 'btn danger-ghost sm', text: '행 삭제', onclick: function () { LE.table.op('rowDel', info.cell); } }),
          h('button', { class: 'btn danger-ghost sm', text: '열 삭제', onclick: function () { LE.table.op('colDel', info.cell); } }))]));
      }
      if (info.kind === 'details' && !multi) {
        var op = h('input', { type: 'checkbox', checked: info.attr.open });
        op.addEventListener('change', function () { LE.edit.attr('open', op.checked ? '' : null, '기본 펼침'); });
        el.appendChild(sec('details', '접기 요소', 'chev-down', [h('label', { class: 'check' }, op, h('span', { text: '처음부터 펼친 상태로 저장' })), h('p', { class: 'hint', text: '내용을 보며 편집하려면 위쪽 "상호작용" 모드에서 펼친 뒤 다시 편집 모드로 돌아오세요.' })]));
      }

      // spacing
      function sides(pfx) { return [c[pfx + '-top'], c[pfx + '-right'], c[pfx + '-bottom'], c[pfx + '-left']].map(px); }
      function compact(a) { if (a[0] === a[1] && a[1] === a[2] && a[2] === a[3]) return a[0] + ''; if (a[0] === a[2] && a[1] === a[3]) return a[0] + ' ' + a[1]; return a.join(' '); }
      function spacing(v) { return String(v).trim().split(/\s+/).map(function (x) { return withUnit(x); }).join(' '); }
      el.appendChild(sec('spacing', '여백', 'border', [
        row('안쪽', num({ wide: true, value: compact(sides('padding')), unit: 'px', title: '안쪽 여백 (위 오른쪽 아래 왼쪽)', onCommit: function (v) { LE.edit.css({ padding: spacing(v) }, '안쪽 여백'); }, scrub: false })),
        row('바깥', num({ wide: true, value: compact(sides('margin')), unit: 'px', title: '바깥 여백 (위 오른쪽 아래 왼쪽)', onCommit: function (v) { LE.edit.css({ margin: spacing(v) }, '바깥 여백'); }, scrub: false })),
        h('p', { class: 'hint', text: '값 하나는 네 방향 모두, 두 개는 위아래·좌우, 네 개는 위·오른쪽·아래·왼쪽입니다.' })
      ], false));

      // advanced
      if (!multi) {
        var cls = h('input', { class: 'input mono', value: info.attr.cls, spellcheck: 'false' });
        cls.addEventListener('change', function () { LE.edit.attr('class', cls.value.trim() || null, '클래스'); });
        var css = h('textarea', { class: 'input mono', rows: 4, value: info.inline, spellcheck: 'false', placeholder: 'color: red; font-size: 40px;' });
        el.appendChild(sec('adv', '고급', 'code', [
          row('태그', h('span', { class: 'ival mono', text: '<' + info.tag + '>' + (info.attr.id ? ' #' + info.attr.id : '') })),
          row('클래스', cls),
          h('div', { class: 'ilabel block', text: '인라인 CSS' }), css,
          h('div', { class: 'btnrow' },
            h('button', { class: 'btn secondary sm', text: 'CSS 적용', onclick: function () { LE.edit.attr('style', css.value.trim() || null, 'CSS 직접 편집'); } }),
            h('button', { class: 'btn ghost sm', html: LE.icon('code') + '<span>HTML 편집</span>', onclick: function () { LE.cmd.run('edit.editHTML'); } }))
        ], false));
      }
    },

    textSection: function (info, c, editing) {
      var f = editing ? (LE.text.f || {}) : {};
      var fs = px(editing && f.size ? f.size : c['font-size']);
      var fam = editing && f.font ? f.font : c['font-family'];
      var weight = String(parseInt(editing && f.weight ? f.weight : c['font-weight'], 10) || 400);
      var color = editing && f.color ? f.color : c.color;
      var lhRaw = c['line-height'], lh = lhRaw === 'normal' ? '' : Math.round(parseFloat(lhRaw) / (parseFloat(c['font-size']) || 16) * 100) / 100;
      var ls = c['letter-spacing'] === 'normal' ? 0 : px(c['letter-spacing']);
      var align = editing && f.align ? f.align : c['text-align'];
      if (align === 'start') align = 'left';
      var docFonts = (LE.fonts.doc || []).filter(function (n) { return !FONTS.some(function (x) { return x.label === n; }); }).map(function (n) { return { value: /\s/.test(n) ? "'" + n + "'" : n, label: n }; });
      var fontOpts = [{ value: '', label: '(상속)' }];
      if (docFonts.length) fontOpts.push({ group: '문서의 글꼴', items: docFonts });
      fontOpts.push({ group: '글꼴', items: FONTS.map(function (x) { return { value: x.value, label: x.label }; }) });
      var famSel = select(fontOpts, matchFont(fam), function (v) { LE.fmt.apply('font', v); });
      var deco = c['text-decoration-line'] || '';
      var rows = [
        row('글꼴', famSel),
        row('크기', h('div', { class: 'tools' },
          num({ value: fs, unit: 'px', min: 1, step: 1, onCommit: function (v, live) { var n = parseFloat(v); if (n > 0) { if (editing) LE.fmt.apply('size', n + 'px'); else LE.edit.css({ 'font-size': n + 'px' }, '글자 크기', live ? 'fs' : null); } } }),
          iconBtn('size-down', '작게 (' + LE.modLabel + '⇧<)', function () { LE.fmt.apply('sizeStep', -1); }),
          iconBtn('size-up', '크게 (' + LE.modLabel + '⇧>)', function () { LE.fmt.apply('sizeStep', 1); }))),
        row('굵기', select([{ value: '300', label: '가늘게' }, { value: '400', label: '보통' }, { value: '500', label: '중간' }, { value: '600', label: '약간 굵게' }, { value: '700', label: '굵게' }, { value: '800', label: '아주 굵게' }, { value: '900', label: '가장 굵게' }], weight, function (v) {
          if (editing && !f.collapsed) LE.view.send('exec', { cmd: v >= 600 ? 'bold' : 'bold' });
          else LE.edit.css({ 'font-weight': v }, '굵기', null, editing ? [LE.text.id] : null);
        })),
        row('글자색', colorBtn({ value: color, title: '글자색', allowNone: false, onPick: function (v, live) { if (editing) LE.fmt.apply('color', v); else LE.edit.css({ color: v }, '글자색', live ? 'color' : null); } })),
        row('모양', h('div', { class: 'tools' },
          iconBtn('bold', '굵게 (' + LE.modLabel + 'B)', function () { LE.fmt.apply('bold'); }, editing ? f.bold : parseInt(c['font-weight'], 10) >= 600),
          iconBtn('italic', '기울임 (' + LE.modLabel + 'I)', function () { LE.fmt.apply('italic'); }, editing ? f.italic : c['font-style'] === 'italic'),
          iconBtn('underline', '밑줄 (' + LE.modLabel + 'U)', function () { LE.fmt.apply('underline'); }, editing ? f.underline : /underline/.test(deco)),
          iconBtn('strike', '취소선', function () { LE.fmt.apply('strike'); }, editing ? f.strike : /line-through/.test(deco)),
          iconBtn('highlight', '강조색', function (e) { var b = e.currentTarget; LE.colorPop.open(b, { value: '#fde68a', title: '강조색', onPick: function (v) { LE.fmt.apply('highlight', v); } }); }),
          iconBtn('eraser', '서식 지우기', function () { LE.fmt.apply('clear'); }))),
        row('정렬', seg([{ value: 'left', icon: 'align-left', title: '왼쪽' }, { value: 'center', icon: 'align-center', title: '가운데' }, { value: 'right', icon: 'align-right', title: '오른쪽' }, { value: 'justify', icon: 'align-justify', title: '양쪽' }], align, function (v) { LE.fmt.apply('align', v); })),
        row('줄 간격', num({ value: lh, placeholder: '기본', step: 0.05, min: 0.5, onCommit: function (v, live) { LE.edit.css({ 'line-height': v.trim() ? String(parseFloat(v)) : '' }, '줄 간격', live ? 'lh' : null, editing ? [LE.text.id] : null); } }),
          num({ prefix: '자간', value: ls, unit: 'px', step: 0.5, onCommit: function (v, live) { LE.edit.css({ 'letter-spacing': withUnit(v) }, '자간', live ? 'ls' : null, editing ? [LE.text.id] : null); } })),
        editing ? row('목록', h('div', { class: 'tools' },
          iconBtn('list', '글머리 목록', function () { LE.fmt.apply('ul'); }, f.ul),
          iconBtn('list-ol', '번호 목록', function () { LE.fmt.apply('ol'); }, f.ol),
          iconBtn('link', '링크 (' + LE.modLabel + 'K)', function () { LE.fmt.apply('link'); }))) : null
      ];
      return sec('text', '글자', 'type', rows);
    }
  };
  function matchFont(fam) {
    if (!fam) return '';
    var first = fam.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].value.split(',')[0].replace(/["']/g, '').trim().toLowerCase() === first) return FONTS[i].value;
    return fam;
  }
  function kindIcon(k) {
    return { image: 'image', media: 'video', table: 'table', cell: 'table', svg: 'shapes', link: 'link', details: 'chev-down', divider: 'divider', shape: 'shapes', text: 'type', slide: 'slides' }[k] || 'square';
  }

  /* table structure edits (computed on the source, applied as one html op) */
  LE.table = {
    op: function (kind, cell) {
      var table = LE.src.el(cell.table);
      if (!table) return;
      var t = table.cloneNode(true), rows = t.rows, r = cell.row, ci = cell.col;
      if (!rows[r]) return;
      function blankLike(td) { var n = td.cloneNode(false); n.removeAttribute('data-ed-id'); n.innerHTML = '&nbsp;'; return n; }
      if (kind === 'rowAbove' || kind === 'rowBelow') {
        var src = rows[r], nr = src.cloneNode(false); nr.removeAttribute('data-ed-id');
        Array.prototype.forEach.call(src.cells, function (td) { nr.appendChild(blankLike(td)); });
        if (kind === 'rowAbove') src.parentNode.insertBefore(nr, src); else src.parentNode.insertBefore(nr, src.nextSibling);
      } else if (kind === 'colLeft' || kind === 'colRight') {
        Array.prototype.forEach.call(rows, function (tr) { var ref = tr.cells[Math.min(ci, tr.cells.length - 1)]; if (!ref) return; var n = blankLike(ref); if (kind === 'colLeft') tr.insertBefore(n, ref); else tr.insertBefore(n, ref.nextSibling); });
      } else if (kind === 'rowDel') {
        if (rows.length <= 1) { LE.toast('마지막 행은 지울 수 없습니다. 표 전체를 지우려면 표를 선택하고 Del을 누르세요.', 'warn'); return; }
        rows[r].remove();
      } else if (kind === 'colDel') {
        if (rows[0] && rows[0].cells.length <= 1) { LE.toast('마지막 열은 지울 수 없습니다.', 'warn'); return; }
        Array.prototype.forEach.call(rows, function (tr) { if (tr.cells[ci]) tr.cells[ci].remove(); });
      }
      LE.src.assign(t);
      LE.ops.run([{ t: 'html', id: cell.table, html: t.innerHTML }], '표 편집');
    }
  };
})();
