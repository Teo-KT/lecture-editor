/* lecture-editor v4 · command registry and keyboard shortcuts */
(function () {
  'use strict';
  var LE = window.LE;

  function hasDoc() { return !!LE.src.doc && LE.view.ready; }
  function hasSel() { return hasDoc() && (LE.sel.ids || []).length > 0; }
  function isDeck() { return hasDoc() && !LE.view.docMode; }
  function selNotSlide() { return hasSel() && !(LE.sel.info && LE.sel.info.isSlide); }
  function hosted() { return !!(LE.host && LE.host.on); }       // served by a host server (테오 슬라이드): Drive is replaced by the host
  function notHosted() { return !hosted(); }

  var C = LE.cmd = {
    reg: Object.create(null),
    add: function (id, d) { d.id = id; this.reg[id] = d; },
    get: function (id) { return this.reg[id]; },
    can: function (id) { var d = this.reg[id]; return !!d && (!d.enabled || !!d.enabled()); },
    on: function (id) { var d = this.reg[id]; return !!(d && d.checked && d.checked()); },
    run: function (id, arg) {
      var d = this.reg[id];
      if (!d) { console.warn('no command', id); return; }
      if (d.enabled && !d.enabled()) return;
      try { var r = d.run(arg); if (r && r.catch) r.catch(function (e) { console.error(e); LE.toast(e.message || String(e), 'error'); }); }
      catch (e) { console.error(e); LE.toast(e.message || String(e), 'error'); }
      LE.bus.emit('cmd', id);
    },
    keyLabel: function (id) {
      var d = this.reg[id];
      if (!d || !d.key) return '';
      var k = (Array.isArray(d.key) ? d.key[0] : d.key).split('+');
      var map = LE.isMac ? { mod: '⌘', shift: '⇧', alt: '⌥', enter: '↵', delete: '⌫', backspace: '⌫', escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', pagedown: 'PgDn', pageup: 'PgUp' }
        : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', enter: 'Enter', delete: 'Del', backspace: 'Backspace', escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', pagedown: 'PgDn', pageup: 'PgUp' };
      var parts = k.map(function (p) { return map[p] || (p.length === 1 ? p.toUpperCase() : p.toUpperCase()); });
      return LE.isMac ? parts.join('') : parts.join('+');
    }
  };
  var add = C.add.bind(C);

  /* file */
  add('file.new', { label: '새 슬라이드 덱', icon: 'file-plus', run: function () { return LE.io.newDeck(); } });
  add('file.open', { label: '열기…', icon: 'folder-open', key: 'mod+o', run: function () { return LE.io.open(); } });
  add('host.open', { label: '서버에서 열기…', icon: 'slides', hidden: notHosted, run: function () { return LE.host.pick().then(function (s) { if (s) return LE.host.open(s); }); } });
  add('host.upload', { label: '서버에 새 덱으로 올리기…', icon: 'upload', hidden: notHosted, enabled: hasDoc, run: function () { return LE.host.upload(); } });
  add('host.present', { label: '저장된 판을 발표 화면으로 열기', icon: 'present', hidden: notHosted, enabled: function () { return hosted() && LE.host.isHostDoc(); }, run: function () { LE.host.present(); } });
  add('host.home', { label: '서버 목록으로', icon: 'external', hidden: notHosted, run: function () { LE.host.home(); } });
  add('file.openDrive', { label: '구글 드라이브에서 열기…', icon: 'cloud', hidden: hosted, run: function () { return LE.drive.open(); } });
  add('file.openUrl', { label: '주소(URL)로 열기…', icon: 'globe', run: function () { return LE.io.openUrlDialog(); } });
  add('file.save', { label: '저장', icon: 'save', key: 'mod+s', enabled: hasDoc, run: function () { return LE.io.save(); } });
  add('file.saveAs', { label: '다른 이름으로 저장…', icon: 'save', key: 'mod+shift+s', enabled: hasDoc, run: function () { return LE.io.saveAs(); } });
  add('file.download', { label: 'HTML 파일로 내려받기', icon: 'download', enabled: hasDoc, run: function () { return LE.io.download(); } });
  add('file.saveDrive', { hidden: hosted, label: '드라이브의 같은 파일에 저장', icon: 'cloud', enabled: function () { return hasDoc() && LE.file && LE.file.kind === 'drive'; }, run: function () { return LE.drive.save(); } });
  add('file.saveDriveAs', { hidden: hosted, label: '드라이브에 새 파일로 저장…', icon: 'cloud-up', enabled: hasDoc, run: function () { return LE.drive.saveAs(); } });
  add('file.pdf', { label: 'PDF로 내보내기', icon: 'file-text', enabled: hasDoc, run: function () { return LE.io.exportPdf(); } });
  add('file.print', { label: '인쇄 / PDF 저장(인쇄 창)…', icon: 'print', key: 'mod+p', enabled: hasDoc, run: function () { return LE.io.print(); } });
  add('file.png', { label: '현재 화면을 PNG로', icon: 'image', enabled: hasDoc, run: function () { return LE.io.exportPng(); } });
  add('file.static', { label: '정적 슬라이드로 변환', icon: 'wand', enabled: function () { return isDeck() || !!(hasDoc() && LE.view.info && LE.view.info.generated); }, run: function () { return LE.io.toStatic(); } });
  add('file.folder', { label: '그림 폴더 연결…', icon: 'folder', enabled: hasDoc, run: function () { return LE.assets.connect(); } });
  add('file.driveOff', { hidden: hosted, label: '구글 드라이브 연결 해제', icon: 'cloud', run: function () { return LE.drive.disconnect(); } });

  /* edit */
  add('edit.undo', { label: '실행 취소', icon: 'undo', key: 'mod+z', enabled: function () { return hasDoc() && LE.hist.canUndo(); }, run: function () { LE.ops.undo(); } });
  add('edit.redo', { label: '다시 실행', icon: 'redo', key: ['mod+shift+z', 'mod+y'], enabled: function () { return hasDoc() && LE.hist.canRedo(); }, run: function () { LE.ops.redo(); } });
  add('edit.cut', { label: '잘라내기', icon: 'scissors', keyHint: 'mod+x', enabled: selNotSlide, run: function () { LE.clip.copy(true); } });
  add('edit.copy', { label: '복사', icon: 'copy', keyHint: 'mod+c', enabled: selNotSlide, run: function () { LE.clip.copy(false); } });
  add('edit.paste', { label: '붙여넣기', icon: 'clipboard', keyHint: 'mod+v', enabled: function () { return hasDoc() && LE.clip.items.length > 0; }, run: function (pt) { LE.clip.pasteInternal(pt && pt.x != null ? pt : null); } });
  add('edit.duplicate', { label: '복제', icon: 'duplicate', key: 'mod+d', enabled: selNotSlide, run: function () {
    var ids = LE.sel.ids.slice();
    LE.clip.pasteHTML(ids.map(LE.clip.outer), { offset: true, label: '복제' });
  } });
  add('edit.delete', { label: '삭제', icon: 'trash', key: ['delete', 'backspace'], enabled: selNotSlide, run: function () {
    var n = LE.sel.ids.length;
    LE.clip.removeIds(LE.sel.ids.slice(), n > 1 ? '요소 ' + n + '개 삭제' : '삭제');
  } });
  add('edit.selectAll', { label: '슬라이드 전체 선택', icon: 'select-all', key: 'mod+a', enabled: hasDoc, run: function () { LE.app.selectAll(); } });
  add('edit.selectSiblings', { label: '같은 상자 안 모두 선택', icon: 'select-all', enabled: selNotSlide, run: function () { LE.app.selectSiblings(); } });
  add('edit.deselect', { label: '선택 해제', icon: 'x', enabled: hasSel, run: function () { LE.view.send('select', { ids: [] }); } });
  add('edit.selectParent', { label: '바깥 요소 선택', icon: 'parent', key: 'alt+arrowup', enabled: selNotSlide, run: function () {
    var p = LE.sel.info && LE.sel.info.path;
    if (p && p.length > 1) { var par = p[p.length - 2]; if (par.label === '슬라이드') { LE.view.send('select', { ids: [] }); return; } LE.view.send('select', { ids: [par.id] }); }
  } });
  add('edit.editText', { label: '글자 편집', icon: 'type', key: 'enter', enabled: function () { return hasSel() && LE.sel.info && LE.sel.info.canEdit && !LE.sel.info.isSlide && LE.sel.count === 1; }, run: function () { LE.view.focus(); LE.view.send('enterText', { id: LE.sel.info.id, all: true }); } });
  add('edit.editHTML', { label: 'HTML 직접 편집…', icon: 'code', enabled: function () { return hasSel() && LE.sel.count === 1 && !LE.sel.info.isSlide; }, run: function () {
    var id = LE.sel.info.id, el = LE.src.el(id);
    if (!el) return;
    LE.dialog.prompt('HTML 편집', '선택한 요소의 HTML입니다. 고친 뒤 적용하면 이 요소를 바꿉니다.', el.outerHTML.replace(/ data-ed-id="[^"]*"/g, ''), { multiline: true, ok: '적용' }).then(function (v) {
      if (v == null) return;
      LE.edit.replaceHTML(id, v);
    });
  } });

  /* insert */
  add('insert.text', { label: '텍스트 상자', icon: 'textbox', enabled: hasDoc, run: function (pt) { LE.insert.textBox(pt); } });
  ['rect:사각형:square', 'rounded:둥근 사각형:rounded', 'ellipse:원:circle', 'triangle:삼각형:triangle', 'line:선:line', 'arrow:화살표:arrow'].forEach(function (s) {
    var p = s.split(':');
    add('insert.' + p[0], { label: p[1], icon: p[2], enabled: hasDoc, run: function (pt) { LE.insert.shape(p[0], pt); } });
  });
  add('insert.image', { label: '그림…', icon: 'image', enabled: hasDoc, run: function () { return LE.insert.imageDialog(); } });
  add('insert.replaceImage', { label: '그림 바꾸기…', icon: 'replace', enabled: function () { return hasSel() && LE.sel.info && LE.sel.info.kind === 'image'; }, run: function () { return LE.insert.imageDialog(LE.sel.info.id); } });
  add('insert.table', { label: '표', icon: 'table', enabled: hasDoc, run: function (pt) { LE.insert.table(3, 3, pt); } });
  add('insert.divider', { label: '구분선', icon: 'divider', enabled: hasDoc, run: function (pt) { LE.insert.divider(pt); } });
  add('insert.button', { label: '버튼', icon: 'button', enabled: hasDoc, run: function (pt) { LE.insert.button(pt); } });
  add('insert.video', { label: '동영상(유튜브·파일)…', icon: 'video', enabled: hasDoc, run: function () {
    return LE.dialog.prompt('동영상 넣기', '유튜브·비메오 주소 또는 동영상 파일 주소', '', { placeholder: 'https://www.youtube.com/watch?v=…' }).then(function (v) { if (v) LE.insert.video(v); });
  } });
  add('insert.html', { label: 'HTML 코드…', icon: 'code', enabled: hasDoc, run: function () {
    return LE.dialog.prompt('HTML 넣기', '넣을 HTML 코드 (스크립트는 저장 후 발표할 때 실행됩니다)', '', { multiline: true, ok: '넣기', placeholder: '<div>…</div>' }).then(function (v) { if (v && v.trim()) LE.insert.html(v); });
  } });

  /* slides */
  add('slide.new', { label: '새 슬라이드', icon: 'plus', key: 'mod+m', enabled: isDeck, run: function () { LE.slides.add(); } });
  add('slide.duplicate', { label: '슬라이드 복제', icon: 'duplicate', key: 'mod+shift+d', enabled: isDeck, run: function () { LE.slides.duplicate(); } });
  add('slide.delete', { label: '슬라이드 삭제', icon: 'trash', enabled: function () { return isDeck() && LE.slides.list.length > 1; }, run: function () { LE.slides.remove(); } });
  add('slide.up', { label: '슬라이드를 앞으로', icon: 'chev-up', enabled: function () { return isDeck() && LE.slides.index > 0; }, run: function () { LE.slides.move(LE.slides.index, LE.slides.index - 1); } });
  add('slide.down', { label: '슬라이드를 뒤로', icon: 'chev-down', enabled: function () { return isDeck() && LE.slides.index < LE.slides.list.length - 1; }, run: function () { LE.slides.move(LE.slides.index, LE.slides.index + 1); } });
  add('slide.next', { label: '다음 슬라이드', icon: 'chev-right', key: 'pagedown', enabled: isDeck, run: function () { LE.slides.next(); } });
  add('slide.prev', { label: '이전 슬라이드', icon: 'chev-left', key: 'pageup', enabled: isDeck, run: function () { LE.slides.prev(); } });

  /* format */
  var ed = function () { return hasSel() || (LE.text && LE.text.editing); };
  add('format.bold', { label: '굵게', icon: 'bold', key: 'mod+b', enabled: ed, run: function () { LE.fmt.apply('bold'); } });
  add('format.italic', { label: '기울임', icon: 'italic', key: 'mod+i', enabled: ed, run: function () { LE.fmt.apply('italic'); } });
  add('format.underline', { label: '밑줄', icon: 'underline', key: 'mod+u', enabled: ed, run: function () { LE.fmt.apply('underline'); } });
  add('format.strike', { label: '취소선', icon: 'strike', key: 'mod+shift+x', enabled: ed, run: function () { LE.fmt.apply('strike'); } });
  add('format.bigger', { label: '글자 크게', icon: 'size-up', key: 'mod+shift+.', enabled: ed, run: function () { LE.fmt.apply('sizeStep', 1); } });
  add('format.smaller', { label: '글자 작게', icon: 'size-down', key: 'mod+shift+,', enabled: ed, run: function () { LE.fmt.apply('sizeStep', -1); } });
  add('format.left', { label: '왼쪽 정렬', icon: 'align-left', key: 'mod+shift+l', enabled: ed, run: function () { LE.fmt.apply('align', 'left'); } });
  add('format.center', { label: '가운데 정렬', icon: 'align-center', key: 'mod+shift+e', enabled: ed, run: function () { LE.fmt.apply('align', 'center'); } });
  add('format.right', { label: '오른쪽 정렬', icon: 'align-right', key: 'mod+shift+r', enabled: ed, run: function () { LE.fmt.apply('align', 'right'); } });
  add('format.justify', { label: '양쪽 정렬', icon: 'align-justify', key: 'mod+shift+j', enabled: ed, run: function () { LE.fmt.apply('align', 'justify'); } });
  add('format.ul', { label: '글머리 목록', icon: 'list', key: 'mod+shift+8', enabled: ed, run: function () { LE.fmt.apply('ul'); } });
  add('format.ol', { label: '번호 목록', icon: 'list-ol', key: 'mod+shift+7', enabled: ed, run: function () { LE.fmt.apply('ol'); } });
  add('format.link', { label: '링크…', icon: 'link', key: 'mod+k', enabled: ed, run: function () { LE.fmt.apply('link'); } });
  add('format.clear', { label: '서식 지우기', icon: 'eraser', key: 'mod+\\', enabled: ed, run: function () { LE.fmt.apply('clear'); } });

  /* arrange */
  add('arrange.front', { label: '맨 앞으로 가져오기', icon: 'front', key: 'mod+alt+]', enabled: selNotSlide, run: function () { LE.view.send('arrange', { mode: 'front' }); } });
  add('arrange.forward', { label: '앞으로 가져오기', icon: 'forward', key: 'mod+]', enabled: selNotSlide, run: function () { LE.view.send('arrange', { mode: 'forward' }); } });
  add('arrange.backward', { label: '뒤로 보내기', icon: 'forward', key: 'mod+[', enabled: selNotSlide, run: function () { LE.view.send('arrange', { mode: 'backward' }); } });
  add('arrange.back', { label: '맨 뒤로 보내기', icon: 'back', key: 'mod+alt+[', enabled: selNotSlide, run: function () { LE.view.send('arrange', { mode: 'back' }); } });
  add('arrange.reset', { label: '위치 초기화', icon: 'move', enabled: selNotSlide, run: function () { LE.edit.css({ position: '', left: '', top: '', right: '', bottom: '' }, '위치 초기화'); } });
  [['left', '왼쪽', 'al-left'], ['hcenter', '가로 가운데', 'al-hcenter'], ['right', '오른쪽', 'al-right'], ['top', '위쪽', 'al-top'], ['vcenter', '세로 가운데', 'al-vcenter'], ['bottom', '아래쪽', 'al-bottom']].forEach(function (a) {
    add('align.' + a[0], { label: a[1] + ' 맞춤', icon: a[2], enabled: selNotSlide, run: function () { LE.view.send('align', { mode: a[0] }); } });
  });
  add('dist.h', { label: '가로 간격 같게', icon: 'dist-h', enabled: function () { return LE.sel.count > 2; }, run: function () { LE.view.send('distribute', { axis: 'h' }); } });
  add('dist.v', { label: '세로 간격 같게', icon: 'dist-v', enabled: function () { return LE.sel.count > 2; }, run: function () { LE.view.send('distribute', { axis: 'v' }); } });

  /* view */
  add('view.zoomIn', { label: '확대', icon: 'zoom-in', key: 'mod+=', enabled: hasDoc, run: function () { LE.view.zoomBy(1.2); } });
  add('view.zoomOut', { label: '축소', icon: 'zoom-out', key: 'mod+-', enabled: hasDoc, run: function () { LE.view.zoomBy(1 / 1.2); } });
  add('view.fit', { label: '화면에 맞추기', icon: 'fit', key: 'mod+0', enabled: hasDoc, run: function () { LE.view.setZoom('fit'); } });
  add('view.actual', { label: '실제 크기 (100%)', icon: 'zoom-in', key: 'mod+1', enabled: hasDoc, run: function () { LE.view.setZoom(1); } });
  add('view.left', { label: '슬라이드 패널', icon: 'panel-left', checked: function () { return !document.getElementById('app').classList.contains('no-left'); }, run: function () { LE.app.togglePanel('left'); } });
  add('view.right', { label: '속성 패널', icon: 'panel-right', checked: function () { return !document.getElementById('app').classList.contains('no-right'); }, run: function () { LE.app.togglePanel('right'); } });
  add('view.builds', { label: '숨은 애니메이션 요소 모두 보기', icon: 'eye', checked: function () { return LE.prefs.get('builds', true); }, run: function () { var v = !LE.prefs.get('builds', true); LE.prefs.set('builds', v); LE.view.send('setOpts', { builds: v }); LE.toast(v ? '등장 효과로 숨어 있는 요소도 보이게 했습니다.' : '등장 효과 요소를 원래 상태로 보여 줍니다.', 'info'); } });
  add('view.snap', { label: '맞춤선에 붙이기', icon: 'magnet', checked: function () { return LE.prefs.get('snap', true); }, run: function () { var v = !LE.prefs.get('snap', true); LE.prefs.set('snap', v); LE.view.send('setOpts', { snap: v }); } });
  add('view.anim', { label: '편집 중 애니메이션 재생', icon: 'play', checked: function () { return LE.prefs.get('anim', false); }, run: function () { var v = !LE.prefs.get('anim', false); LE.prefs.set('anim', v); LE.view.send('setOpts', { anim: v }); } });
  add('view.theme', { label: '어두운 화면', icon: 'moon', checked: function () { return document.documentElement.getAttribute('data-theme') === 'dark'; }, run: function () { LE.app.toggleTheme(); } });
  add('view.interact', { label: '상호작용 모드 (탭·접기 열기)', icon: 'hand', checked: function () { return LE.app.mode === 'interact'; }, enabled: hasDoc, run: function () { LE.app.setMode(LE.app.mode === 'interact' ? 'edit' : 'interact'); } });
  add('view.slideSize', { label: '슬라이드 크기…', icon: 'fit', enabled: function () { return isDeck() && LE.view.info && LE.view.info.basis === 'viewport'; }, run: function () { return LE.app.slideSizeDialog(); } });
  add('view.reload', { label: '편집 화면 다시 그리기', icon: 'refresh', enabled: hasDoc, run: function () { return LE.app.rerender(); } });
  add('view.preview', { label: '발표 미리보기', icon: 'present', key: ['mod+enter', 'f5'], enabled: hasDoc, run: function () { LE.present.open(true); } });
  add('view.previewStart', { label: '처음부터 미리보기', icon: 'play', enabled: hasDoc, run: function () { LE.present.open(false); } });

  /* help */
  add('help.keys', { label: '단축키', icon: 'keyboard', key: 'mod+/', run: function () { LE.app.showShortcuts(); } });
  add('help.compat', { label: '호환성 정보', icon: 'info', enabled: hasDoc, run: function () { LE.app.showCompat(); } });
  add('help.guide', { label: '사용 안내', icon: 'help', run: function () { LE.app.showGuide(); } });
  add('help.legacy', { label: '이전 편집기(v3) 열기', icon: 'external', run: function () { window.open(hosted() && LE.host.legacy ? LE.host.legacy : 'legacy/', '_blank', 'noopener'); } });
  add('help.about', { label: '이 편집기에 대하여', icon: 'logo', run: function () { LE.app.showAbout(); } });

  /* ------------------------------------------------------------------ *
   * keyboard
   * ------------------------------------------------------------------ */
  var KEYMAP = Object.create(null);
  Object.keys(C.reg).forEach(function (id) {
    var d = C.reg[id];
    if (!d.key) return;
    (Array.isArray(d.key) ? d.key : [d.key]).forEach(function (k) { KEYMAP[k] = id; });
  });
  var CODES = { BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Period: '.', Comma: ',', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Space: 'space', NumpadAdd: '=', NumpadSubtract: '-', NumpadEnter: 'enter' };
  function keyName(code, key) {
    if (/^Key[A-Z]$/.test(code || '')) return code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(code || '')) return code.slice(5);
    if (CODES[code]) return CODES[code];
    return String(key || '').toLowerCase();
  }
  function combo(e) {
    var meta = e.metaKey != null ? e.metaKey : e.meta, ctrl = e.ctrlKey != null ? e.ctrlKey : e.ctrl;
    var shift = e.shiftKey != null ? e.shiftKey : e.shift, alt = e.altKey != null ? e.altKey : e.alt;
    var mod = LE.isMac ? meta : ctrl;
    return (mod ? 'mod+' : '') + (alt ? 'alt+' : '') + (shift ? 'shift+' : '') + keyName(e.code, e.key);
  }
  LE.keys = {
    combo: combo,
    handle: function (e, ctx) {
      var c = combo(e);
      if (ctx.typing) {
        if (c === 'mod+s' || c === 'mod+shift+s' || c === 'mod+o' || c === 'mod+enter') { if (e.preventDefault) e.preventDefault(); C.run(KEYMAP[c]); return true; }
        return false;
      }
      if (c === 'escape') {
        if (LE.menu.close() || (LE.colorPop.el && (LE.colorPop.close(), true))) return true;
        if (LE.app.mode === 'interact') { LE.app.setMode('edit'); return true; }
        if (hasSel()) { LE.view.send('select', { ids: [] }); return true; }
        return false;
      }
      if (ctx.slides) {
        if (c === 'delete' || c === 'backspace') { e.preventDefault && e.preventDefault(); C.run('slide.delete'); return true; }
        if (c === 'arrowdown' || c === 'arrowright') { e.preventDefault && e.preventDefault(); LE.slides.next(); return true; }
        if (c === 'arrowup' || c === 'arrowleft') { e.preventDefault && e.preventDefault(); LE.slides.prev(); return true; }
        if (c === 'mod+d') { e.preventDefault && e.preventDefault(); C.run('slide.duplicate'); return true; }
        if (c === 'mod+c' || c === 'mod+v' || c === 'mod+x') return false;
      }
      if (!hasSel() && isDeck() && !ctx.typing) {
        if (c === 'arrowdown' || c === 'arrowright') { e.preventDefault && e.preventDefault(); LE.slides.next(); return true; }
        if (c === 'arrowup' || c === 'arrowleft') { e.preventDefault && e.preventDefault(); LE.slides.prev(); return true; }
        if (c === 'home') { LE.slides.go(0); return true; }
        if (c === 'end') { LE.slides.go(LE.slides.list.length - 1); return true; }
      }
      if (hasSel() && /^(shift\+)?arrow(up|down|left|right)$/.test(c) && ctx.native) {
        e.preventDefault();
        var d = /shift/.test(c) ? 10 : 1, k = c.replace('shift+', '');
        LE.view.send('nudge', { key: k === 'arrowup' ? 'ArrowUp' : k === 'arrowdown' ? 'ArrowDown' : k === 'arrowleft' ? 'ArrowLeft' : 'ArrowRight', d: d });
        return true;
      }
      var id = KEYMAP[c];
      if (!id) return false;
      if (e.preventDefault) e.preventDefault();
      C.run(id);
      return true;
    }
  };
})();
