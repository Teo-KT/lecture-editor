/* lecture-editor v4 · inserting content and clipboard */
(function () {
  'use strict';
  var LE = window.LE, h = LE.h;
  var lastAt = { t: 0, n: 0 };

  function k() { return LE.view.docMode ? 1 : (LE.view.W || 1920) / 1920; }
  function r(v) { return Math.round(v); }

  var INS = LE.insert = {
    /* where new content goes */
    target: function () {
      if (!LE.view.docMode) {
        var sid = LE.slides.curId(), meta = LE.slides.list[LE.slides.index], pre = [];
        var srcEl = LE.src.el(sid);
        var inlinePos = srcEl ? LE.css.get(srcEl.getAttribute('style') || '', 'position') : null;
        if (meta && (meta.pos === 'static' || meta.pos === 'sticky') && !(inlinePos && inlinePos.v !== 'static')) pre.push({ t: 'css', id: sid, set: { position: 'relative' } });
        return { parent: sid, before: null, abs: true, pre: pre };
      }
      var info = LE.sel.info, el = info ? LE.src.el(info.id) : null;
      if (el && el.parentElement && el !== LE.src.doc.body) return { parent: LE.src.idOf(el.parentElement), before: LE.src.nextId(el), abs: false, pre: [] };
      return { parent: LE.src.bodyId(), before: null, abs: false, pre: [] };
    },
    /* top-left position for a w×h box: at the point if given, else centred (cascading) */
    spot: function (w, hh, pt) {
      var W = LE.view.W, H = LE.view.H;
      if (pt && typeof pt.x === 'number') return { x: r(Math.min(Math.max(0, pt.x), W - 20)), y: r(Math.min(Math.max(0, pt.y), H - 20)) };
      var now = Date.now();
      lastAt.n = now - lastAt.t < 8000 ? (lastAt.n + 1) % 8 : 0;
      lastAt.t = now;
      var off = lastAt.n * r(28 * k());
      return { x: r((W - w) / 2) + off, y: r((H - hh) / 2) + off };
    },
    place: function (html, label, o) {
      o = o || {};
      if (!LE.src.doc || !LE.view.ready) return null;
      var tg = INS.target();
      var f = LE.src.fresh(html, !!o.external);
      if (!f) return null;
      var ops = tg.pre.concat([{ t: 'insert', parent: o.parent || tg.parent, before: o.parent ? null : tg.before, html: f.html }]);
      LE.ops.run(ops, label, { select: [f.id] });
      if (o.edit) setTimeout(function () { LE.view.focus(); LE.view.send('enterText', { id: f.id, all: true }); }, 60);
      return f.id;
    },
    absStyle: function (w, hh, pt, extra) {
      if (LE.view.docMode) return 'width:' + r(w) + 'px;' + (hh != null ? 'height:' + r(hh) + 'px;' : '') + 'max-width:100%;margin:16px 0;' + (extra || '');
      var p = INS.spot(w, hh || 0, pt);
      return 'position:absolute;left:' + p.x + 'px;top:' + p.y + 'px;width:' + r(w) + 'px;' + (hh != null ? 'height:' + r(hh) + 'px;' : '') + 'margin:0;box-sizing:border-box;' + (extra || '');
    },
    shape: function (kind, pt) {
      var s = k(), w = 480 * s, hh = 280 * s, extra = 'background:#3b82f6;', inner = '', tag = 'div', cls = 'le-shape';
      if (kind === 'rounded') extra += 'border-radius:' + r(36 * s) + 'px;';
      if (kind === 'ellipse') { w = hh = 300 * s; extra += 'border-radius:50%;background:#10b981;'; }
      if (kind === 'triangle') { w = 340 * s; hh = 300 * s; extra = 'background:#f59e0b;clip-path:polygon(50% 0,100% 100%,0 100%);'; }
      if (kind === 'line') { w = 560 * s; hh = Math.max(2, 6 * s); extra = 'background:#1f2937;'; cls += ' le-line'; }
      if (kind === 'arrow') {
        w = 520 * s; hh = 64 * s; tag = 'svg'; extra = 'color:#1f2937;overflow:visible;';
        inner = '<line x1="0" y1="32" x2="476" y2="32" stroke="currentColor" stroke-width="8" vector-effect="non-scaling-stroke"/><path d="M468 8 L520 32 L468 56 Z" fill="currentColor"/>';
      }
      var html = tag === 'svg'
        ? '<svg class="' + cls + ' le-arrow" viewBox="0 0 520 64" preserveAspectRatio="none" style="' + INS.absStyle(w, hh, pt, extra) + '">' + inner + '</svg>'
        : '<div class="' + cls + '" style="' + INS.absStyle(w, hh, pt, extra) + '"></div>';
      var names = { rect: '사각형', rounded: '둥근 사각형', ellipse: '원', triangle: '삼각형', line: '선', arrow: '화살표' };
      return INS.place(html, '도형 삽입: ' + (names[kind] || kind));
    },
    textBox: function (pt, text) {
      var s = k(), w = (LE.view.docMode ? 640 : 900 * s);
      var fs = LE.view.docMode ? 18 : r(48 * s);
      var body = text ? LE.esc(text).replace(/\r?\n/g, '<br>') : '텍스트를 입력하세요';
      return INS.place('<div class="le-text" style="' + INS.absStyle(w, null, pt, 'font-size:' + fs + 'px;line-height:1.35;') + '">' + body + '</div>', '텍스트 상자', { edit: !text });
    },
    table: function (rows, cols, pt) {
      rows = rows || 3; cols = cols || 3;
      var s = k(), fs = LE.view.docMode ? 16 : r(30 * s), pad = LE.view.docMode ? '8px 12px' : r(18 * s) + 'px ' + r(24 * s) + 'px';
      var cell = 'border:1px solid #cbd5e1;padding:' + pad + ';text-align:left;vertical-align:top;';
      var t = '<table class="le-table" style="' + INS.absStyle(LE.view.docMode ? 640 : 1100 * s, null, pt, 'border-collapse:collapse;font-size:' + fs + 'px;line-height:1.35;background:#ffffff;color:#0f172a;') + '"><tbody>';
      for (var i = 0; i < rows; i++) {
        t += '<tr>';
        for (var j = 0; j < cols; j++) t += i === 0 ? '<th style="' + cell + 'background:#f1f5f9;font-weight:700;">제목 ' + (j + 1) + '</th>' : '<td style="' + cell + '">내용</td>';
        t += '</tr>';
      }
      return INS.place(t + '</tbody></table>', '표 삽입');
    },
    divider: function (pt) {
      if (LE.view.docMode) return INS.place('<hr style="border:none;border-top:2px solid #cbd5e1;margin:24px 0;">', '구분선');
      var s = k();
      return INS.place('<div class="le-shape le-line" style="' + INS.absStyle(1200 * s, Math.max(2, 3 * s), pt, 'background:#cbd5e1;') + '"></div>', '구분선');
    },
    button: function (pt) {
      var s = k(), fs = LE.view.docMode ? 16 : r(32 * s);
      var base = 'display:inline-block;padding:' + r(LE.view.docMode ? 10 : 20 * s) + 'px ' + r(LE.view.docMode ? 22 : 44 * s) + 'px;background:#2563eb;color:#ffffff;border-radius:' + r(LE.view.docMode ? 8 : 14 * s) + 'px;font-size:' + fs + 'px;font-weight:600;text-decoration:none;';
      var style = LE.view.docMode ? base : INS.absStyle(360 * s, null, pt, base + 'width:auto;text-align:center;');
      return INS.place('<a class="le-button" href="#" style="' + style + '">버튼</a>', '버튼 삽입');
    },
    video: function (url, pt) {
      url = String(url || '').trim();
      if (!url) return null;
      var s = k(), w = LE.view.docMode ? 640 : 1280 * s, hh = w * 9 / 16, html, m;
      if ((m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url))) {
        html = '<iframe src="https://www.youtube.com/embed/' + m[1] + '" title="YouTube" style="' + INS.absStyle(w, hh, pt, 'border:0;') + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>';
      } else if ((m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url))) {
        html = '<iframe src="https://player.vimeo.com/video/' + m[1] + '" title="Vimeo" style="' + INS.absStyle(w, hh, pt, 'border:0;') + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
      } else if (/^(https?:|data:video)/i.test(url)) {
        html = '<video src="' + LE.esc(url) + '" controls playsinline style="' + INS.absStyle(w, hh, pt, 'background:#000;') + '"></video>';
      } else { LE.toast('유튜브·비메오 주소나 동영상 파일 주소(https://…mp4)를 넣어 주세요.', 'warn'); return null; }
      return INS.place(html, '동영상 삽입');
    },
    html: function (code) {
      var items = LE.src.freshAll(code, false);
      if (!items.length) { LE.toast('넣을 수 있는 요소가 없습니다.', 'warn'); return; }
      var tg = INS.target();
      var ops = tg.pre.concat(items.map(function (it) { return { t: 'insert', parent: tg.parent, before: tg.before, html: it.html }; }));
      LE.ops.run(ops, 'HTML 삽입', { select: items.map(function (i) { return i.id; }) });
    },

    /* images */
    optimize: function (dataUrl, maxSide) {
      maxSide = maxSide || 2400;
      return new Promise(function (res) {
        if (!/^data:image\/(png|jpe?g|webp|bmp)/i.test(dataUrl)) { res(dataUrl); return; }
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, hh = img.naturalHeight, big = Math.max(w, hh) > maxSide, heavy = dataUrl.length > 1.6e6;
          if (!big && !heavy) { res(dataUrl); return; }
          var sc = big ? maxSide / Math.max(w, hh) : 1;
          var c = document.createElement('canvas');
          c.width = Math.round(w * sc); c.height = Math.round(hh * sc);
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, c.width, c.height);
          var png = /^data:image\/png/i.test(dataUrl), out;
          try {
            if (png) {
              var px = ctx.getImageData(0, 0, Math.min(c.width, 64), Math.min(c.height, 64)).data, alpha = false;
              for (var i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
              out = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
            } else out = c.toDataURL('image/jpeg', 0.88);
          } catch (e) { out = dataUrl; }
          res(out.length < dataUrl.length ? out : dataUrl);
        };
        img.onerror = function () { res(dataUrl); };
        img.src = dataUrl;
      });
    },
    readFile: function (file) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = function () { rej(fr.error); };
        fr.readAsDataURL(file);
      });
    },
    pickImage: function () {
      return new Promise(function (res) {
        var inp = document.getElementById('imageInput');
        inp.value = '';
        var done = false;
        inp.onchange = function () {
          done = true;
          var f = inp.files && inp.files[0];
          if (!f) { res(null); return; }
          INS.readFile(f).then(function (u) { return LE.prefs.get('optImages', true) ? INS.optimize(u) : u; }).then(res, function () { res(null); });
        };
        inp.click();
        setTimeout(function () { if (!done) {} }, 0);
      });
    },
    imageSize: function (url) {
      return new Promise(function (res) {
        var img = new Image();
        img.onload = function () { res({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 }); };
        img.onerror = function () { res({ w: 800, h: 600 }); };
        img.src = url;
      });
    },
    image: function (url, pt, opt) {
      opt = opt || {};
      return (opt.optimize === false ? Promise.resolve(url) : INS.optimize(url)).then(function (u) {
        return INS.imageSize(u).then(function (sz) {
          var W = LE.view.W, H = LE.view.H, w = sz.w, hh = sz.h;
          if (!LE.view.docMode) {
            var sc = Math.min(1, (W * 0.6) / w, (H * 0.6) / hh);
            w = w * sc; hh = hh * sc;
            return INS.place('<img src="' + u + '" alt="" style="' + INS.absStyle(w, hh, pt, 'object-fit:contain;') + '">', '그림 삽입');
          }
          return INS.place('<img src="' + u + '" alt="" style="display:block;max-width:100%;width:' + Math.min(w, 800) + 'px;height:auto;margin:16px 0;">', '그림 삽입');
        });
      });
    },
    imageDialog: function (replaceId) {
      var url = h('input', { class: 'input', placeholder: 'https://… 또는 붙여넣기', spellcheck: 'false' });
      var opt = h('input', { type: 'checkbox', checked: LE.prefs.get('optImages', true) });
      var drop = h('div', { class: 'dropzone small', tabindex: '0' }, h('div', { html: LE.icon('image', 'xl') }), h('div', { class: 'dz-t', text: '클릭해서 그림 파일 고르기' }), h('div', { class: 'dz-s', text: '또는 여기로 끌어 놓기 · PNG JPG GIF SVG WebP' }));
      var chosen = null;
      var preview = h('div', { class: 'img-preview' });
      function setChosen(u) { chosen = u; preview.innerHTML = ''; preview.appendChild(h('img', { src: u, alt: '' })); }
      drop.addEventListener('click', function () {
        var inp = document.getElementById('imageInput');
        inp.value = '';
        inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) INS.readFile(f).then(setChosen); };
        inp.click();
      });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) INS.readFile(f).then(setChosen); });
      url.addEventListener('input', function () { var v = url.value.trim(); if (/^(https?:|data:image)/i.test(v)) setChosen(v); });
      var body = h('div', { class: 'form' }, drop, h('label', { class: 'field-label', text: '또는 그림 주소' }), url, preview,
        h('label', { class: 'check' }, opt, h('span', { text: '큰 사진은 웹용 크기로 줄이기 (2400px, 파일 크기 절약)' })));
      return LE.dialog.open({ title: replaceId ? '그림 바꾸기' : '그림 넣기', body: body, buttons: [{ label: '취소', value: null }, { label: replaceId ? '바꾸기' : '넣기', primary: true, value: function () { return chosen || null; } }] }).then(function (u) {
        if (!u) return;
        LE.prefs.set('optImages', opt.checked);
        var p = opt.checked ? INS.optimize(u) : Promise.resolve(u);
        return p.then(function (fin) {
          if (replaceId) LE.ops.run([{ t: 'attr', id: replaceId, name: 'src', value: fin }, { t: 'attr', id: replaceId, name: 'srcset', value: null }], '그림 바꾸기');
          else INS.image(fin, null, { optimize: false });
        });
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * clipboard
   * ------------------------------------------------------------------ */
  var CL = LE.clip = {
    token: null, items: [], srcIds: [], slide: null,
    outer: function (id) { var el = LE.src.el(id); return el ? el.outerHTML.replace(/ data-ed-id="[^"]*"/g, '') : ''; },
    remember: function (token, ids) { this.token = token; this.srcIds = ids.slice(); this.items = ids.map(this.outer).filter(Boolean); this.slide = LE.slides.curId(); },
    fromView: function (d) {
      this.remember(d.token, d.ids || []);
      if (d.cut) this.removeIds(d.ids || [], '잘라내기');
    },
    removeIds: function (ids, label) {
      ids = ids.filter(function (id) { return id && id !== LE.slides.curId() && LE.src.el(id); });
      if (!ids.length) return;
      LE.ops.run(ids.map(function (id) { return { t: 'remove', id: id }; }), label || '삭제');
    },
    copy: function (cut, e) {
      var ids = (LE.sel.ids || []).slice();
      if (!ids.length) return false;
      var token = 'c' + Date.now().toString(36) + LE.rand(5);
      this.remember(token, ids);
      var html = '<' + '!--le-clip:' + token + '--' + '>' + this.items.join('');
      var text = '';
      try {
        if (e && e.clipboardData) { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', text || ' '); }
        else if (navigator.clipboard && window.ClipboardItem) navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([' '], { type: 'text/plain' }) })]).catch(function () {});
      } catch (x) {}
      if (cut) this.removeIds(ids, '잘라내기');
      else LE.toast(ids.length + '개 요소를 복사했습니다.', 'ok', 1400);
      return true;
    },
    pasteInternal: function (pt) { if (this.items.length) this.pasteHTML(this.items, { pt: pt, internal: true }); else LE.toast('붙여넣을 내용이 없습니다. ' + LE.modLabel + 'V를 쓰면 다른 곳에서 복사한 내용도 넣을 수 있습니다.', 'info'); },
    onPaste: function (d) {
      if (!LE.src.doc || !LE.view.ready) return;
      if (d.kind === 'clip' && d.token === this.token && this.items.length) return this.pasteHTML(this.items, { internal: true });
      if (d.kind === 'clip' || d.kind === 'html') {
        var html = String(d.html || '').replace(/<!--[\s\S]*?-->/g, '');
        var body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
        if (body) html = body[1];
        var tmp = document.createElement('template'); tmp.innerHTML = html;
        var blocks = Array.prototype.slice.call(tmp.content.children);
        var rich = blocks.length && blocks.some(function (b) { return /^(DIV|SECTION|TABLE|IMG|SVG|UL|OL|FIGURE|H[1-6]|P|A|SPAN|ARTICLE|BLOCKQUOTE|PRE|VIDEO|IFRAME)$/i.test(b.tagName); });
        if (d.kind === 'clip' && rich) return this.pasteHTML(blocks.map(function (b) { return b.outerHTML; }), { external: true });
        if (d.text && d.text.trim()) return INS.textBox(null, d.text.trim());
        if (rich) return this.pasteHTML(blocks.map(function (b) { return b.outerHTML; }), { external: true });
        return;
      }
      if (d.kind === 'text') return INS.textBox(null, d.text);
      if (d.kind === 'image') return INS.image(d.data);
    },
    pasteHTML: function (htmls, o) {
      o = o || {};
      var info = LE.sel.info, tg;
      var selEl = info && !info.isSlide ? LE.src.el(info.id) : null;
      if (selEl && selEl.parentElement && LE.slides.slideOfId(info.id) === LE.slides.curId() && selEl.parentElement !== LE.src.doc.documentElement) {
        tg = { parent: LE.src.idOf(selEl.parentElement), before: LE.src.nextId(selEl), pre: [] };
      } else tg = INS.target();
      var s = k(), sameSlide = o.offset || (o.internal && this.slide === LE.slides.curId());
      var items = [];
      htmls.forEach(function (h0) {
        var f = LE.src.fresh(h0, !!o.external);
        if (!f) return;
        if (!LE.view.docMode) {
          var tpl = document.createElement('template'); tpl.innerHTML = f.html;
          var el = tpl.content.firstElementChild, st = el.getAttribute('style') || '';
          var pos = LE.css.get(st, 'position');
          if (pos && /absolute|fixed/.test(pos.v)) {
            var L = LE.css.get(st, 'left'), T = LE.css.get(st, 'top');
            if (o.pt) { st = LE.css.set(st, 'left', Math.round(o.pt.x) + 'px'); st = LE.css.set(st, 'top', Math.round(o.pt.y) + 'px'); }
            else if (sameSlide) { if (L) st = LE.css.set(st, 'left', (parseFloat(L.v) + Math.round(24 * s)) + 'px'); if (T) st = LE.css.set(st, 'top', (parseFloat(T.v) + Math.round(24 * s)) + 'px'); }
            el.setAttribute('style', st);
            f.html = el.outerHTML;
          }
        }
        items.push(f);
      });
      if (!items.length) return;
      var ops = tg.pre.concat(items.map(function (f) { return { t: 'insert', parent: tg.parent, before: tg.before, html: f.html }; }));
      var verb = o.label || '붙여넣기';
      LE.ops.run(ops, items.length > 1 ? '요소 ' + items.length + '개 ' + verb : verb, { select: items.map(function (f) { return f.id; }) });
    }
  };
})();
