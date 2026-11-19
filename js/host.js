/* lecture-editor v4 · host integration
 *
 * A server that serves this editor itself (for example 테오 슬라이드) sets window.LE_HOST before the scripts load:
 *   { name: '테오 슬라이드', api: '/api', home: '/', present: '/d/{slug}/', legacy: 'https://…/legacy/' }
 * The server must answer, for its signed-in owner only:
 *   GET  {api}/decks                     → [{ slug, title, slides, updated }]
 *   GET  {api}/decks/<slug>/source       → { slug, title, html, rev, base }   (base: URL that relative media paths resolve against)
 *   POST {api}/decks/<slug>/source       body = HTML, headers X-Deck: 1, X-Rev: <rev> [, X-Force: 1] → { ok, rev } | 409 conflict
 *   POST {api}/upload                    body = HTML, headers X-Deck: 1, X-Filename, X-Title → { ok, slug, rev, base }
 * Without LE_HOST (the public GitHub Pages copy) nothing here is active and the Drive features stay as they are.
 */
(function () {
  'use strict';
  var LE = window.LE, h = LE.h;
  var CFG = window.LE_HOST && typeof window.LE_HOST === 'object' ? window.LE_HOST : null;
  var enc = encodeURIComponent;

  function api(p) { return String(CFG.api || '/api').replace(/\/$/, '') + p; }
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return null; } }
  function loginLost() { return new Error('로그인이 풀렸습니다. ' + CFG.name + ' 첫 화면에서 다시 들어온 뒤 저장해 주세요. 지금 내용은 이 브라우저에 임시 저장되어 있습니다.'); }
  async function getJson(p) {
    var r = await fetch(api(p), { credentials: 'same-origin', cache: 'no-store' });
    var j = null; try { j = await r.json(); } catch (e) {}
    if (r.status === 401) throw loginLost();
    if (!r.ok) throw new Error((j && (j.message || j.error)) || ('HTTP ' + r.status));
    return j;
  }
  async function postHtml(p, html, headers) {
    var r = await fetch(api(p), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'X-Deck': '1' }, headers || {}), body: html });
    var j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok, body: j || {} };
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  var HOST = LE.host = {
    on: !!CFG,
    name: CFG ? String(CFG.name || '서버') : '',
    legacy: CFG && CFG.legacy ? String(CFG.legacy) : null,
    isHostDoc: function () { return !!(CFG && LE.file && LE.file.kind === 'host' && LE.file.slug); },
    presentUrl: function (slug) { return String(CFG.present || '/d/{slug}/').replace('{slug}', enc(slug)); },

    /* deck picker */
    pick: async function () {
      var close = LE.toast('덱 목록을 불러오는 중…', 'info', 20000), list;
      try { list = await getJson('/decks'); } catch (e) { close(); LE.dialog.alert('덱 목록을 불러오지 못했습니다', e.message); return null; }
      close();
      list = Array.isArray(list) ? list : (list && list.decks) || [];
      if (!list.length) { LE.dialog.alert(HOST.name, '올라온 덱이 없습니다. 지금 문서를 [' + HOST.name + '에 새 덱으로 올리기]로 올릴 수 있습니다.'); return null; }
      var q = h('input', { class: 'input', type: 'search', placeholder: '제목으로 찾기', autofocus: 'autofocus' });
      var box = h('div', { class: 'host-list' });
      var body = h('div', { class: 'form' }, q, box);
      return LE.dialog.open({ title: HOST.name + '에서 열기', wide: true, body: body, buttons: [{ label: '취소', value: null }],
        onOpen: function (b, done) {
          function draw() {
            var s = q.value.trim().toLowerCase();
            box.innerHTML = '';
            list.filter(function (d) { return !s || String(d.title || d.slug).toLowerCase().indexOf(s) >= 0 || d.slug.indexOf(s) >= 0; }).forEach(function (d) {
              box.appendChild(h('button', { class: 'host-item', type: 'button', onclick: function () { done(d.slug); } },
                h('span', { class: 'hi-ic', html: LE.icon('slides') }),
                h('span', { class: 'hi-name', text: d.title || d.slug }),
                h('span', { class: 'hi-meta', text: [d.slides ? d.slides + '장' : '', when(d.updated) ? when(d.updated) + ' 고침' : ''].filter(Boolean).join(' · ') })));
            });
            if (!box.children.length) box.appendChild(h('div', { class: 'wl-empty', text: '찾는 덱이 없습니다.' }));
          }
          q.addEventListener('input', draw);
          q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var first = box.querySelector('.host-item'); if (first) { e.preventDefault(); e.stopPropagation(); first.click(); } } });
          draw();
        } });
    },

    /* The edit view is a sandboxed frame with an opaque origin. Browsers refuse its requests to this Mac's own or tailnet
       addresses (local network protection), so the deck's media/ files are fetched here, by the page, and handed to the
       view as data URLs (view only: the saved document keeps media/… paths). Very large files keep their server URL. */
    mediaMap: async function (html, base, onProgress) {
      if (!base) return null;
      var refs = {}, re = /["'(](media\/[A-Za-z0-9._-]{1,80})(?=["')])/g, m;
      while ((m = re.exec(html))) refs[m[1]] = 1;
      var list = Object.keys(refs);
      if (!list.length) return null;
      var map = {}, total = 0, done = 0, ONE = 40e6, ALL = 150e6, next = 0;
      function toData(blob) { return new Promise(function (ok, no) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = no; fr.readAsDataURL(blob); }); }
      async function worker() {
        while (next < list.length) {
          var ref = list[next++];
          try {
            var r = await fetch(new URL(ref, base).href, { credentials: 'same-origin' });
            if (r.ok) {
              var blob = await r.blob();
              if (blob.size <= ONE && total + blob.size <= ALL) { total += blob.size; map[ref] = await toData(blob); }
            }
          } catch (e) {}
          done++; if (onProgress) onProgress(done, list.length);
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
      return Object.keys(map).length ? map : null;
    },

    open: async function (slug, o) {
      o = o || {};
      if (!slug) return false;
      var close = LE.toast(HOST.name + '에서 덱을 불러오는 중…', 'info', 120000), d, assets = null;
      try { d = await getJson('/decks/' + enc(slug) + '/source'); }
      catch (e) { close(); LE.dialog.alert('덱을 불러오지 못했습니다', e.message); return false; }
      var base = d.base ? abs(d.base) : null;
      try {
        assets = await HOST.mediaMap(d.html, base, function (n, all) {
          if (all > 3) { close(); close = LE.toast('덱의 그림·영상을 받는 중… ' + n + '/' + all, 'info', 120000); }
        });
      } catch (e) {}
      close();
      var title = d.title || d.slug;
      var ok = await LE.app.openDoc(d.html, { name: title + '.html', title: title, kind: 'host', slug: d.slug, rev: d.rev, base: base }, { start: o.start || 0, assets: assets });
      if (ok) try { history.replaceState(null, '', location.pathname + '?deck=' + enc(d.slug)); } catch (e) {}
      return ok;
    },

    save: async function (force) {
      if (!HOST.isHostDoc()) return;
      await LE.io.flush();
      var f = LE.file;
      var close = LE.toast(HOST.name + '에 저장하는 중…', 'info', 120000), r;
      try { r = await postHtml('/decks/' + enc(f.slug) + '/source', LE.src.html(), Object.assign({ 'X-Rev': f.rev || '' }, force ? { 'X-Force': '1' } : {})); }
      catch (e) { close(); LE.dialog.alert('저장하지 못했습니다', HOST.name + ' 서버에 닿지 못했습니다. 연결을 확인하고 다시 저장해 주세요. 지금 내용은 이 브라우저에 임시 저장되어 있습니다.'); return; }
      close();
      if (r.status === 409) {
        var go = await LE.dialog.confirm('다른 곳에서 바뀐 덱입니다', '이 덱을 연 뒤에 발표 화면의 [이 장 고치기]나 다른 창에서 저장한 내용이 있습니다. 덮어쓰면 그쪽 변경은 이 판에서 빠지지만, 덮어쓰기 전 판은 ' + HOST.name + '의 이전 판 목록에 남습니다.', { ok: '덮어쓰기', danger: true });
        return go ? HOST.save(true) : undefined;
      }
      if (r.status === 401) { LE.dialog.alert('저장하지 못했습니다', loginLost().message); return; }
      if (!r.ok) { LE.dialog.alert('저장하지 못했습니다', r.body.message || r.body.error || ('HTTP ' + r.status)); return; }
      f.rev = r.body.rev || f.rev;
      LE.app.markSaved(HOST.name + '에 저장했습니다 · 이전 판은 서버에 남습니다');
    },

    /* any open document → a new deck on the server */
    upload: async function () {
      if (!LE.src.doc) return;
      await LE.io.flush();
      var f = LE.file || {};
      var title = await LE.dialog.prompt(HOST.name + '에 새 덱으로 올리기', '덱 제목', String(f.title || LE.baseName(f.name || '새 덱')), { hint: '올리면 ' + HOST.name + ' 목록에 새 덱으로 생기고, 이후 저장은 그 덱에 합니다.' });
      if (!title || !title.trim()) return;
      var close = LE.toast(HOST.name + '에 올리는 중…', 'info', 300000), r;
      try { r = await postHtml('/upload', LE.src.html(), { 'X-Filename': enc(f.name || 'deck.html'), 'X-Title': enc(title.trim()) }); }
      catch (e) { close(); LE.dialog.alert('올리지 못했습니다', HOST.name + ' 서버에 닿지 못했습니다.'); return; }
      close();
      if (r.status === 401) { LE.dialog.alert('올리지 못했습니다', loginLost().message); return; }
      if (!r.ok || !r.body.slug) { LE.dialog.alert('올리지 못했습니다', r.body.message || r.body.error || ('HTTP ' + r.status)); return; }
      var oldKey = f.key;
      Object.assign(LE.file, { kind: 'host', slug: r.body.slug, rev: r.body.rev || null, title: title.trim(), name: title.trim() + '.html', handle: null, drive: null, url: null });
      if (r.body.base) LE.file.base = abs(r.body.base);
      LE.file.key = LE.fileKey(LE.file);
      if (oldKey && oldKey !== LE.file.key) LE.idb.del('drafts', oldKey);
      LE.recent.add(LE.file);
      LE.app.markSaved(HOST.name + '에 새 덱으로 올렸습니다 · ' + title.trim());
      try { history.replaceState(null, '', location.pathname + '?deck=' + enc(r.body.slug)); } catch (e) {}
    },

    present: function () { if (HOST.isHostDoc()) window.open(HOST.presentUrl(LE.file.slug), '_blank', 'noopener'); },
    home: function () { location.href = CFG.home || '/'; },

    /* welcome screen, app bar and deep link (?deck=<slug>&slide=<n>) */
    boot: function () {
      if (!CFG) return;
      document.documentElement.setAttribute('data-host', 'on');
      var L = { 'host.open': HOST.name + '에서 열기…', 'host.upload': HOST.name + '에 새 덱으로 올리기…', 'host.home': HOST.name + ' 목록으로' };
      Object.keys(L).forEach(function (id) { var d = LE.cmd.get(id); if (d) d.label = L[id]; });
      var drive = document.querySelector('.wl-actions [data-cmd="file.openDrive"]');
      if (drive) {
        var b = h('button', { class: 'btn secondary lg', 'data-cmd': 'host.open', 'data-icon': 'slides' }, h('span', { text: HOST.name }));
        drive.replaceWith(b);
      }
      var sub = document.querySelector('.wl-head p');
      if (sub) sub.textContent = HOST.name + '의 덱을 열어 고치고 그대로 저장합니다. 저장할 때마다 이전 판이 서버에 남습니다. 내 컴퓨터의 HTML 파일을 열어 새 덱으로 올릴 수도 있습니다.';
      var actions = document.querySelector('.appbar-actions');
      if (actions) {
        actions.insertBefore(h('button', { class: 'btn ghost doc-only host-only', 'data-cmd': 'host.present', 'data-icon': 'present', title: '저장된 판을 발표 화면으로 엽니다' }, h('span', { class: 'hide-sm', text: '발표 화면' })), actions.firstChild);
        actions.insertBefore(h('button', { class: 'btn ghost', 'data-cmd': 'host.home', 'data-icon': 'external', title: HOST.name + ' 목록으로 갑니다' }, h('span', { class: 'hide-sm', text: HOST.name })), actions.firstChild);
      }
    },
    deepLink: function () {
      if (!CFG) return;
      var p = new URLSearchParams(location.search), slug = p.get('deck');
      if (slug && /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) HOST.open(slug, { start: Math.max(0, (parseInt(p.get('slide'), 10) || 1) - 1) });
    }
  };

  HOST.boot();
})();
