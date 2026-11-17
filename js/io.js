/* lecture-editor v4 · files: open/save, drafts, recent, exports, conversions */
(function () {
  'use strict';
  var LE = window.LE, h = LE.h;
  var JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  LE.file = null;
  LE.fileKey = function (m) {
    if (m.kind === 'drive' && m.drive) return 'drive:' + m.drive.id;
    if (m.kind === 'url') return 'url:' + m.url;
    if (m.kind === 'local') return 'local:' + m.name + ':' + (m.size || 0);
    return (m.kind || 'new') + ':' + (m.name || '') + ':' + Date.now();
  };

  async function writeHandle(handle, text) {
    if (handle.queryPermission) {
      var p = await handle.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('저장 권한이 허락되지 않았습니다.');
    }
    var w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }

  var IO = LE.io = {
    flush: async function () { if (LE.view.ready) { try { await LE.view.call('flush', {}, 4000); } catch (e) {} } },

    open: async function () {
      if (window.showOpenFilePicker) {
        try {
          var hs = await window.showOpenFilePicker({ types: [{ description: 'HTML 문서', accept: { 'text/html': ['.html', '.htm'] } }], multiple: false });
          var f = await hs[0].getFile();
          return this.openFile(f, hs[0]);
        } catch (e) { if (e && e.name === 'AbortError') return; console.warn(e); }
      }
      var inp = document.getElementById('fileInput'), self = this;
      inp.value = '';
      inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) self.openFile(f, null); };
      inp.click();
    },
    openFile: async function (file, handle) {
      if (!/\.x?html?$/i.test(file.name) && !/html/.test(file.type || '')) {
        if (!(await LE.dialog.confirm('HTML 파일이 아닌 것 같습니다', file.name + ' 파일을 HTML로 열까요?'))) return;
      }
      if (file.size > 80 * 1024 * 1024) { await LE.dialog.alert('파일이 너무 큽니다', LE.fmtBytes(file.size) + '입니다. 80MB 이하만 열 수 있습니다. 내장된 큰 그림·영상을 줄여 주세요.'); return; }
      var text = await file.text();
      return LE.app.openDoc(text, { name: file.name, kind: 'local', handle: handle || null, size: file.size, modified: file.lastModified });
    },
    openUrlDialog: async function () {
      var u = await LE.dialog.prompt('주소로 열기', 'HTML 파일 주소', 'https://', { hint: '다른 사이트의 파일은 그 서버가 교차 출처 접근(CORS)을 허용해야 불러올 수 있습니다. 그림·스타일의 상대 경로는 이 주소를 기준으로 보입니다.' });
      if (u && u.trim() && u.trim() !== 'https://') return this.openUrl(u.trim());
    },
    openUrl: async function (url) {
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      var close = LE.toast('불러오는 중…', 'info', 30000);
      try {
        var r = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var text = await r.text();
        close();
        var name = decodeURIComponent((url.split(/[?#]/)[0].split('/').pop() || 'page.html'));
        if (!/\.x?html?$/i.test(name)) name += '.html';
        return LE.app.openDoc(text, { name: name, kind: 'url', url: url, base: url });
      } catch (e) {
        close();
        LE.dialog.alert('주소에서 불러오지 못했습니다', '대부분 그 서버가 교차 출처 접근(CORS)을 허용하지 않기 때문입니다. 파일을 내려받은 뒤 [열기]로 열어 주세요.\n\n(오류: ' + e.message + ')');
      }
    },

    save: async function () {
      await this.flush();
      var f = LE.file;
      if (!f) return;
      if (f.kind === 'drive') return LE.drive.save();
      if (f.handle && f.handle.createWritable) {
        try { await writeHandle(f.handle, LE.src.html()); LE.app.markSaved('저장했습니다 · ' + f.name); return; }
        catch (e) { if (e && e.name === 'AbortError') return; LE.toast('원래 파일에 쓰지 못했습니다 (' + e.message + '). 저장할 곳을 다시 골라 주세요.', 'warn'); }
      }
      return this.saveAs();
    },
    saveAs: async function () {
      await this.flush();
      var name = (LE.file && LE.file.name) || 'slides.html';
      if (window.showSaveFilePicker) {
        try {
          var handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'HTML 문서', accept: { 'text/html': ['.html', '.htm'] } }] });
          await writeHandle(handle, LE.src.html());
          var oldKey = LE.file.key;
          Object.assign(LE.file, { name: handle.name, kind: 'local', handle: handle, drive: null, url: null });
          LE.file.key = LE.fileKey(LE.file);
          LE.idb.del('drafts', oldKey);
          LE.recent.add(LE.file);
          LE.app.markSaved('저장했습니다 · ' + handle.name);
          return;
        } catch (e) { if (e && e.name === 'AbortError') return; console.warn(e); }
      }
      var nm = await LE.dialog.prompt('다른 이름으로 저장', '파일 이름 (브라우저의 다운로드 폴더에 저장됩니다)', name);
      if (!nm) return;
      if (!/\.x?html?$/i.test(nm)) nm += '.html';
      LE.download(LE.src.html(), nm);
      LE.file.name = nm;
      LE.app.markSaved('내려받았습니다 · ' + nm);
    },
    download: async function () {
      await this.flush();
      LE.download(LE.src.html(), (LE.file && LE.file.name) || 'slides.html');
      LE.toast('HTML 파일을 내려받았습니다.', 'ok');
    },

    /* ---------- exports ---------- */
    exportPdf: async function () {
      await this.flush();
      if (LE.view.docMode) return this.print();
      var body = h('div', { class: 'form' },
        h('p', { class: 'modal-text', text: '슬라이드 ' + LE.slides.list.length + '장을 한 장씩 그림으로 찍어 PDF 한 페이지씩 담습니다. 인쇄 창 설정과 관계없이 슬라이드 1장이 1페이지가 됩니다.' }),
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'q', value: '1.5', checked: true }), h('span', { text: '표준 화질 (빠름, 파일 작음)' })),
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'q', value: '2.2' }), h('span', { text: '고화질 (인쇄·확대용)' })),
        h('p', { class: 'hint', text: '글자를 선택할 수 있는 PDF가 필요하면 [인쇄 / PDF 저장]을 쓰세요.' }));
      var scale = await LE.dialog.open({ title: 'PDF로 내보내기', body: body, buttons: [{ label: '취소', value: null }, { label: 'PDF 만들기', primary: true, value: function (b) { var r = b.querySelector('input[name=q]:checked'); return r ? parseFloat(r.value) : 1.5; } }] });
      if (!scale) return;
      var W = LE.view.W, H = LE.view.H;
      scale = Math.min(scale, 3600 / Math.max(W, H) * 1.5);
      await LE.loadScript(JSPDF);
      var list = LE.slides.list.slice(), prog = LE.app.progress('PDF 만드는 중', list.length), pdf = null;
      try {
        var jsPDF = window.jspdf.jsPDF, wpt = W * 0.75, hpt = H * 0.75, orient = wpt >= hpt ? 'landscape' : 'portrait';
        for (var i = 0; i < list.length; i++) {
          if (prog.cancelled) break;
          var r = await LE.view.call('snapshot', { id: list[i].id, scale: scale, type: 'image/jpeg', q: 0.92 }, 120000);
          if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [wpt, hpt], compress: true });
          else pdf.addPage([wpt, hpt], orient);
          pdf.addImage(r.url, 'JPEG', 0, 0, wpt, hpt, undefined, 'FAST');
          prog.set(i + 1);
        }
        prog.close();
        if (prog.cancelled || !pdf) { LE.toast('PDF 만들기를 취소했습니다.', 'info'); return; }
        pdf.save(LE.baseName(LE.file.name) + '.pdf');
        LE.toast('PDF를 저장했습니다 · ' + list.length + '페이지', 'ok');
      } catch (e) {
        prog.close();
        LE.dialog.alert('PDF를 만들지 못했습니다', (e.message || String(e)) + '\n\n[인쇄 / PDF 저장]으로 시도해 보세요.');
      }
    },
    buildPrintDoc: function () {
      var html = LE.src.serialize(false);
      var doc = new DOMParser().parseFromString(html, 'text/html');
      Array.prototype.forEach.call(doc.querySelectorAll('script'), function (s) { s.remove(); });
      var css = '*{animation:none!important;transition:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '.fragment,.animate,[data-aos],.aos-init,.wow{opacity:1!important;visibility:visible!important;transform:none!important}';
      if (!LE.view.docMode && LE.slides.list.length) {
        var W = LE.view.W, H = LE.view.H, disp = (LE.view.info && LE.view.info.display) || 'block', body = doc.body;
        var pages = LE.slides.list.map(function (s) {
          var sl = doc.querySelector('[data-ed-id="' + s.id + '"]');
          if (!sl) return null;
          var chain = [];
          for (var p = sl.parentElement; p && p !== body && p !== doc.documentElement; p = p.parentElement) chain.unshift(p);
          var page = doc.createElement('div');
          page.className = 'le-print-page';
          var cur = page;
          chain.forEach(function (a) { var c = a.cloneNode(false); c.setAttribute('data-le-chain', ''); cur.appendChild(c); cur = c; }); // ids kept: deck CSS often keys on #stage/#deck
          var sc = sl.cloneNode(true);
          sc.setAttribute('data-le-slide', '');
          cur.appendChild(sc);
          return page;
        }).filter(Boolean);
        while (body.firstChild) body.removeChild(body.firstChild);
        pages.forEach(function (p) { body.appendChild(p); });
        css += '@page{size:' + W + 'px ' + H + 'px;margin:0}' +
          'html,body{margin:0!important;padding:0!important;width:' + W + 'px!important;height:auto!important;min-height:0!important;overflow:visible!important;display:block!important;transform:none!important}' +
          '.le-print-page{position:relative;width:' + W + 'px;height:' + H + 'px;overflow:hidden;page-break-after:always;break-after:page;page-break-inside:avoid;break-inside:avoid}' +
          '.le-print-page:last-child{page-break-after:auto;break-after:auto}' +
          '[data-le-chain]{position:static!important;display:block!important;transform:none!important;inset:auto!important;width:auto!important;height:auto!important;min-height:0!important;max-height:none!important;margin:0!important;padding:0!important;opacity:1!important;visibility:visible!important;overflow:visible!important;filter:none!important;zoom:1!important}' +
          '[data-le-slide]{display:' + disp + '!important;position:relative!important;inset:auto!important;left:0!important;top:0!important;width:' + W + 'px!important;height:' + H + 'px!important;min-height:0!important;max-height:none!important;margin:0!important;transform:none!important;opacity:1!important;visibility:visible!important;box-sizing:border-box!important;overflow:hidden!important;zoom:1!important}';
      }
      var st = doc.createElement('style');
      st.textContent = css;
      (doc.head || doc.documentElement).appendChild(st);
      var sc2 = doc.createElement('script');
      sc2.textContent = "window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},600);});";
      doc.body.appendChild(sc2);
      var out = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      return out.replace(/ data-ed-id="[^"]*"/g, '');
    },
    print: async function () {
      await this.flush();
      var html = this.buildPrintDoc();
      var w = window.open('', '_blank');
      if (!w) { LE.dialog.alert('새 창이 차단되었습니다', '이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.'); return; }
      w.document.open(); w.document.write(html); w.document.close();
      try { w.document.title = LE.baseName(LE.file.name); } catch (e) {}
      LE.toast('인쇄 창에서 대상은 "PDF로 저장", 여백은 "없음", 배율은 100%로 고르세요.', 'info', 7000);
    },
    exportPng: async function () {
      await this.flush();
      try {
        var r = LE.view.docMode
          ? await LE.view.call('snapshot', { view: true, scale: 2, type: 'image/png' }, 60000)
          : await LE.view.call('snapshot', { id: LE.slides.curId(), scale: Math.min(2, 4000 / LE.view.W), type: 'image/png' }, 60000);
        var nm = LE.baseName(LE.file.name) + (LE.view.docMode ? '' : '-' + (LE.slides.index + 1)) + '.png';
        LE.download(LE.dataUrlToBlob(r.url), nm);
        LE.toast('PNG를 저장했습니다 · ' + nm, 'ok');
      } catch (e) { LE.dialog.alert('PNG를 만들지 못했습니다', e.message || String(e)); }
    },

    /* script-built decks → plain, fully editable slides */
    toStatic: async function () {
      var ok = await LE.dialog.confirm('정적 슬라이드로 변환', '지금 화면에 보이는 그대로 슬라이드마다 HTML을 떠서 새 덱을 만듭니다. 원래 덱의 스크립트(자동 생성·애니메이션·인터랙션)는 빠지고, 대신 모든 요소를 자유롭게 편집할 수 있습니다. 원본 파일은 바뀌지 않습니다.', { ok: '새 덱으로 변환' });
      if (!ok) return;
      try {
        var d = await LE.view.call('extractStatic', {}, 60000);
        var html = buildStatic(d, LE.src.doc.title || LE.baseName(LE.file.name));
        await LE.app.openDoc(html, { name: LE.baseName(LE.file.name) + '-정적.html', kind: 'new' }, { dirty: true });
      } catch (e) { LE.dialog.alert('변환하지 못했습니다', e.message || String(e)); }
    },
    newDeck: async function () { return LE.app.openDoc(LE.templates.deck(), { name: '새 슬라이드.html', kind: 'new' }); }
  };

  var NAV_JS = "(function(){var pages=[].slice.call(document.querySelectorAll('.le-page')),i=0,deck=document.getElementById('le-deck'),W=+deck.getAttribute('data-w'),H=+deck.getAttribute('data-h');" +
    "function fit(){var s=Math.min(innerWidth/W,innerHeight/H);deck.style.transform='scale('+s+')';}" +
    "function show(n){i=Math.max(0,Math.min(pages.length-1,n));pages.forEach(function(p,k){p.classList.toggle('active',k===i);});}" +
    "addEventListener('resize',fit);addEventListener('keydown',function(e){var k=e.key;if(k==='ArrowRight'||k==='PageDown'||k===' '||k==='ArrowDown'){e.preventDefault();show(i+1);}else if(k==='ArrowLeft'||k==='PageUp'||k==='ArrowUp'){e.preventDefault();show(i-1);}else if(k==='Home'){show(0);}else if(k==='End'){show(pages.length-1);}else if(k==='f'||k==='F'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen();}});" +
    "var x0=null;addEventListener('touchstart',function(e){x0=e.changedTouches[0].clientX;},{passive:true});addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>50)show(dx<0?i+1:i-1);x0=null;},{passive:true});" +
    "fit();show(0);})();";
  function buildStatic(d, title) {
    var W = d.W, H = d.H, disp = d.display || 'block';
    var chainOpen = '', chainClose = '';
    (d.chain || []).forEach(function (c) { chainOpen += '<' + c.tag + (c.cls ? ' class="' + LE.esc(c.cls) + '"' : '') + ' data-le-chain>'; chainClose = '</' + c.tag + '>' + chainClose; });
    var pages = d.slides.map(function (s) {
      var tpl = document.createElement('template'); tpl.innerHTML = s;
      var el = tpl.content.firstElementChild;
      if (el) { el.setAttribute('data-le-slide', ''); s = el.outerHTML; }
      return '<div class="le-page">' + chainOpen + s + chainClose + '</div>';
    }).join('\n');
    return '<!DOCTYPE html>\n<html lang="' + LE.esc(d.lang || 'ko') + '"' + (d.htmlCls ? ' class="' + LE.esc(d.htmlCls) + '"' : '') + '>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + LE.esc(title) + '</title>\n' +
      d.styles.join('\n') + '\n<style id="le-static">\n' +
      'html,body{margin:0;height:100%;overflow:hidden;background:#111}\n' +
      '#le-stage{position:fixed;inset:0;display:grid;place-items:center;overflow:hidden}\n' +
      '#le-deck{position:relative;width:' + W + 'px;height:' + H + 'px;flex:none;transform-origin:center center}\n' +
      '.le-page{position:absolute;inset:0;display:none;overflow:hidden}\n.le-page.active{display:block}\n' +
      '[data-le-chain]{position:static!important;display:block!important;transform:none!important;inset:auto!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;opacity:1!important;visibility:visible!important;filter:none!important}\n' +
      '[data-le-slide]{display:' + disp + '!important;position:absolute!important;inset:0!important;width:' + W + 'px!important;height:' + H + 'px!important;margin:0!important;transform:none!important;opacity:1!important;visibility:visible!important;box-sizing:border-box!important}\n' +
      '@media print{@page{size:' + W + 'px ' + H + 'px;margin:0}html,body{height:auto;overflow:visible;background:none}#le-stage{position:static;display:block}#le-deck{transform:none!important}.le-page{display:block!important;position:relative;width:' + W + 'px;height:' + H + 'px;page-break-after:always;break-after:page}}\n' +
      '</style>\n</head>\n<body' + (d.bodyCls ? ' class="' + LE.esc(d.bodyCls) + '"' : '') + (d.bodyStyle ? ' style="' + LE.esc(d.bodyStyle) + '"' : '') + '>\n' +
      '<div id="le-stage"><div id="le-deck" data-w="' + W + '" data-h="' + H + '">\n' + pages + '\n</div></div>\n<script>' + NAV_JS + '<\/script>\n</body>\n</html>\n';
  }

  /* ---------- new deck template ---------- */
  LE.templates = {
    deck: function () {
      var css = [
        ':root{--bg:#ffffff;--ink:#0f172a;--muted:#64748b;--accent:#2563eb;--soft:#eff6ff;--line:#e2e8f0}',
        '*{box-sizing:border-box}',
        "html,body{margin:0;height:100%;overflow:hidden;background:#0b1020;font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}",
        '#stage{position:fixed;inset:0;display:grid;place-items:center;overflow:hidden}',
        '#deck{position:relative;width:1920px;height:1080px;flex:none;transform-origin:center center}',
        '.slide{position:absolute;inset:0;width:1920px;height:1080px;display:none;flex-direction:column;justify-content:center;padding:120px 150px;background:var(--bg);color:var(--ink);overflow:hidden}',
        '.slide.active{display:flex}',
        '.slide h1{font-size:104px;line-height:1.12;letter-spacing:-2px;margin:0 0 32px;font-weight:800}',
        '.slide h2{font-size:68px;line-height:1.2;letter-spacing:-1px;margin:0 0 48px;font-weight:750}',
        '.slide p{font-size:40px;line-height:1.55;margin:0 0 24px;color:#334155}',
        '.slide ul{margin:0;padding-left:1.1em}.slide li{font-size:40px;line-height:1.55;margin:0 0 18px;color:#334155}',
        '.slide .kicker{font-size:28px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:28px}',
        '.slide.cover{background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);color:#fff}.slide.cover p{color:#cbd5e1}.slide.cover .kicker{color:#93c5fd}',
        '.slide .cols{display:grid;grid-template-columns:1fr 1fr;gap:64px}',
        '.slide .card{background:var(--soft);border:1px solid #dbeafe;border-radius:28px;padding:48px}',
        '.slide .card h3{font-size:44px;margin:0 0 16px;color:var(--accent)}.slide .card p{font-size:34px;margin:0}',
        '.slide .foot{position:absolute;left:150px;right:150px;bottom:56px;display:flex;justify-content:space-between;font-size:22px;color:var(--muted)}',
        '#bar{position:fixed;left:0;bottom:0;height:5px;background:var(--accent);width:0;transition:width .25s}',
        '@media print{@page{size:1920px 1080px;margin:0}html,body{height:auto;overflow:visible;background:none}#stage{position:static;display:block}#deck{transform:none!important}.slide{display:flex!important;position:relative;page-break-after:always;break-after:page}#bar{display:none}}'
      ].join('\n');
      var nav = "(function(){var s=[].slice.call(document.querySelectorAll('.slide')),i=0,deck=document.getElementById('deck'),bar=document.getElementById('bar');" +
        "function fit(){var k=Math.min(innerWidth/1920,innerHeight/1080);deck.style.transform='scale('+k+')';}" +
        "function show(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach(function(e,k){e.classList.toggle('active',k===i);});bar.style.width=((i+1)/s.length*100)+'%';}" +
        "addEventListener('resize',fit);addEventListener('keydown',function(e){var k=e.key;if(k==='ArrowRight'||k==='PageDown'||k===' '){e.preventDefault();show(i+1);}else if(k==='ArrowLeft'||k==='PageUp'){e.preventDefault();show(i-1);}else if(k==='Home')show(0);else if(k==='End')show(s.length-1);else if(k==='f'||k==='F'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();}});" +
        "addEventListener('click',function(e){if(e.target.closest('a,button'))return;show(e.clientX>innerWidth*0.3?i+1:i-1);});" +
        "fit();show(0);})();";
      return '<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>새 슬라이드</title>\n' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">\n<style>\n' + css + '\n</style>\n</head>\n<body>\n<div id="stage"><div id="deck">\n' +
        '<section class="slide cover active">\n  <div class="kicker">강의 제목</div>\n  <h1>슬라이드 제목을<br>여기에 입력하세요</h1>\n  <p>부제목 · 발표자 이름 · 날짜</p>\n</section>\n' +
        '<section class="slide">\n  <div class="kicker">개요</div>\n  <h2>오늘 다룰 내용</h2>\n  <ul>\n    <li>첫 번째 핵심 내용</li>\n    <li>두 번째 핵심 내용</li>\n    <li>세 번째 핵심 내용</li>\n  </ul>\n  <div class="foot"><span>강의 제목</span><span>2</span></div>\n</section>\n' +
        '<section class="slide">\n  <h2>두 가지를 비교합니다</h2>\n  <div class="cols">\n    <div class="card"><h3>왼쪽</h3><p>설명을 입력하세요.</p></div>\n    <div class="card"><h3>오른쪽</h3><p>설명을 입력하세요.</p></div>\n  </div>\n  <div class="foot"><span>강의 제목</span><span>3</span></div>\n</section>\n' +
        '</div></div>\n<div id="bar"></div>\n<script>' + nav + '<\/script>\n</body>\n</html>\n';
    }
  };

  /* ---------- drafts (crash / tab-close recovery) ---------- */
  LE.drafts = {
    schedule: LE.debounce(function () { LE.drafts.write(); }, 3000),
    write: function () {
      if (!LE.src.doc || !LE.file || !LE.app.isDirty()) return;
      var f = LE.file;
      return LE.idb.put('drafts', f.key, { name: f.name, html: LE.src.html(), time: Date.now(), kind: f.kind, url: f.url || null, driveId: f.drive ? f.drive.id : null }).then(function () { LE.app.draftAt = Date.now(); LE.app.updateSaveState(); });
    },
    clear: function () { if (LE.file) LE.idb.del('drafts', LE.file.key); },
    check: async function (html) {
      var d = await LE.idb.get('drafts', LE.file.key);
      if (!d || !d.html || d.html === html) return false;
      var v = await LE.dialog.open({ title: '저장하지 않은 편집 내용이 있습니다', sticky: true,
        body: h('p', { class: 'modal-text', text: '이 파일을 ' + LE.timeLabel(d.time) + '에 편집하다가 저장하지 않고 닫은 기록이 있습니다. 그때 내용으로 복구할까요?' }),
        buttons: [{ label: '버리기', value: 'discard' }, { label: '나중에', value: null }, { label: '복구하기', value: 'restore', primary: true }] });
      if (v === 'restore') { await LE.app.restoreDraft(d.html); return true; }
      if (v === 'discard') LE.idb.del('drafts', LE.file.key);
      return false;
    }
  };

  /* ---------- recent files ---------- */
  LE.recent = {
    cache: [],
    add: function (f) {
      if (!f || f.kind === 'new') return;
      var v = { name: f.name, kind: f.kind, time: Date.now(), handle: f.handle || null, driveId: f.drive ? f.drive.id : null, url: f.url || null, key: f.key };
      var self = this;
      LE.idb.put('recent', f.kind + ':' + (f.drive ? f.drive.id : f.url || f.name), v).then(function () { return self.load(); }).then(function (list) {
        list.slice(12).forEach(function (x) { LE.idb.del('recent', x.k); });
      });
    },
    load: function () {
      var self = this;
      return LE.idb.all('recent').then(function (all) {
        var list = all.map(function (x) { x.value.k = x.key; return x.value; }).sort(function (a, b) { return b.time - a.time; });
        self.cache = list.slice(0, 10);
        return list;
      });
    },
    menuItems: function () {
      if (!this.cache.length) return [{ label: '(최근 파일 없음)', disabled: true }];
      var self = this;
      return this.cache.map(function (r) { return { label: r.name, icon: r.kind === 'drive' ? 'cloud' : r.kind === 'url' ? 'globe' : 'file-text', key: LE.timeLabel(r.time), run: function () { self.open(r); } }; })
        .concat(['-', { label: '목록 지우기', icon: 'trash', run: function () { self.cache.forEach(function (r) { LE.idb.del('recent', r.k); }); self.cache = []; LE.app.renderWelcome(); } }]);
    },
    open: async function (r) {
      try {
        if (r.kind === 'drive' && r.driveId) return LE.drive.openById(r.driveId);
        if (r.kind === 'url' && r.url) return IO.openUrl(r.url);
        if (r.handle) {
          if (r.handle.queryPermission && (await r.handle.queryPermission({ mode: 'read' })) !== 'granted') {
            if ((await r.handle.requestPermission({ mode: 'read' })) !== 'granted') return;
          }
          var f = await r.handle.getFile();
          return IO.openFile(f, r.handle);
        }
        LE.toast('이 파일은 다시 열 수 있는 정보가 없습니다. [열기]로 골라 주세요.', 'warn');
      } catch (e) { LE.toast('열지 못했습니다: ' + (e.message || e), 'error'); }
    }
  };

  /* ---------- local folder for relative images/styles ---------- */
  async function resolvePath(dir, ref) {
    var path = decodeURIComponent(ref.split(/[?#]/)[0]).replace(/^\.\//, '');
    var parts = path.split('/').filter(function (p) { return p && p !== '.'; });
    var cur = dir;
    for (var i = 0; i < parts.length - 1; i++) {
      if (parts[i] === '..') throw new Error('outside');
      cur = await cur.getDirectoryHandle(parts[i]);
    }
    var fh = await cur.getFileHandle(parts[parts.length - 1]);
    return fh.getFile();
  }
  function readAsDataURL(file) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(fr.error); }; fr.readAsDataURL(file); }); }
  LE.assets = {
    map: null, dirName: '',
    reset: function () { this.map = null; this.dirName = ''; },
    rewriter: function () {
      var map = this.map;
      if (!map || !Object.keys(map).length) return null;
      var keys = Object.keys(map).sort(function (a, b) { return b.length - a.length; });
      return function (html) {
        keys.forEach(function (k) {
          var v = map[k];
          html = html.split('"' + k + '"').join('"' + v + '"').split("'" + k + "'").join("'" + v + "'").split('&quot;' + k + '&quot;').join('&quot;' + v + '&quot;').split('(' + k + ')').join('(' + v + ')');
        });
        return html;
      };
    },
    connect: async function () {
      if (!window.showDirectoryPicker) { LE.dialog.alert('폴더를 연결할 수 없습니다', '이 기능은 크롬·엣지 브라우저에서 쓸 수 있습니다.'); return; }
      var refs = LE.src.relativeRefs();
      if (!refs.length) { LE.toast('이 문서에는 같은 폴더의 그림·스타일을 가리키는 경로가 없습니다.', 'info'); return; }
      var dir;
      try { dir = await window.showDirectoryPicker({ mode: 'read' }); } catch (e) { return; }
      var map = {}, ok = 0, miss = [];
      for (var i = 0; i < refs.length; i++) {
        var ref = refs[i];
        try {
          var f = await resolvePath(dir, ref);
          if (f.size > 40 * 1024 * 1024) { miss.push(ref); continue; }
          if (/\.css$/i.test(f.name)) {
            var txt = await f.text(), base = ref.split('/').slice(0, -1).join('/');
            var re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, m, parts = [], last = 0;
            while ((m = re.exec(txt))) {
              parts.push(txt.slice(last, m.index));
              var u = m[2];
              if (!/^(?:[a-z][a-z0-9+.\-]*:|\/\/|#|\/)/i.test(u)) {
                try { parts.push('url("' + (await readAsDataURL(await resolvePath(dir, (base ? base + '/' : '') + u))) + '")'); } catch (e2) { parts.push(m[0]); }
              } else parts.push(m[0]);
              last = re.lastIndex;
            }
            parts.push(txt.slice(last));
            map[ref] = 'data:text/css;charset=utf-8,' + encodeURIComponent(parts.join(''));
          } else map[ref] = await readAsDataURL(f);
          ok++;
        } catch (e) { miss.push(ref); }
      }
      this.map = map; this.dirName = dir.name;
      await LE.app.rerender('연결한 그림을 불러오는 중…');
      LE.app.hideBanner('assets');
      LE.toast("'" + dir.name + "' 폴더에서 " + ok + '개를 연결했습니다' + (miss.length ? ' · 찾지 못한 경로 ' + miss.length + '개' : ''), ok ? 'ok' : 'warn', 6000);
    }
  };
})();
