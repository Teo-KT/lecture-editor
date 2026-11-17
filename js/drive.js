/*
 * lecture-editor v4 · Google Drive (open / save / save as new)
 * Security model (unchanged from v3):
 *  - scope drive.file only: the app can touch just the files the user picks in Google's Picker
 *  - the access token lives in this closure (memory only) and is revoked on "disconnect"
 *  - Google libraries load lazily on first use
 *  - CLIENT_ID / API_KEY / APP_ID in drive-config.js are public identifiers (referrer/origin restricted)
 */
(function () {
  'use strict';
  var LE = window.LE;
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var API = 'https://www.googleapis.com/drive/v3/files/';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files/';
  var MAX = 60 * 1024 * 1024;
  var token = null, tokenClient = null, pending = null, libs = null, pickerLoaded = false;

  function cfg() { return window.LECTURE_EDITOR_DRIVE || {}; }
  function isSet(v) { return typeof v === 'string' && v.trim().length > 8 && !/^(YOUR_|<|1234567890)/.test(v) && v.indexOf('...') < 0; }
  function configured() { var c = cfg(); return isSet(c.CLIENT_ID) && isSet(c.API_KEY) && isSet(c.APP_ID); }
  function loadLibs() {
    if (libs) return libs;
    libs = Promise.all([
      window.google && google.accounts && google.accounts.oauth2 ? Promise.resolve() : LE.loadScript('https://accounts.google.com/gsi/client'),
      window.gapi ? Promise.resolve() : LE.loadScript('https://apis.google.com/js/api.js')
    ]).then(function () {
      return new Promise(function (res, rej) {
        if (pickerLoaded) return res();
        gapi.load('picker', { callback: function () { pickerLoaded = true; res(); }, onerror: function () { rej(new Error('Picker 라이브러리를 불러오지 못했습니다.')); } });
      });
    }).catch(function (e) { libs = null; throw e; });
    return libs;
  }
  function tokenValid() { return !!(token && token.t && Date.now() < token.exp); }
  function ensureClient() {
    if (tokenClient) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg().CLIENT_ID, scope: SCOPE,
      callback: function (resp) {
        var p = pending; pending = null;
        if (!p) return;
        if (resp && resp.access_token) {
          var ttl = Math.max(60, (parseInt(resp.expires_in, 10) || 3600) - 60);
          token = { t: resp.access_token, exp: Date.now() + ttl * 1000 };
          p.resolve(resp.access_token);
        } else p.reject(new Error((resp && (resp.error_description || resp.error)) || '구글 로그인에 실패했습니다.'));
      },
      error_callback: function (err) {
        var p = pending; pending = null;
        if (!p) return;
        var t = err && err.type;
        p.reject(new Error(t === 'popup_closed' ? '로그인 창이 닫혔습니다.' : t === 'popup_failed_to_open' ? '팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.' : '구글 로그인에 실패했습니다.'));
      }
    });
  }
  function getToken() {
    if (tokenValid()) return Promise.resolve(token.t);
    ensureClient();
    return new Promise(function (resolve, reject) {
      if (pending) pending.reject(new Error('이전 로그인 요청이 취소되었습니다.'));
      pending = { resolve: resolve, reject: reject };
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }
  async function apiFetch(url, init, retried) {
    var t = await getToken();
    var opts = Object.assign({}, init || {});
    opts.headers = Object.assign({}, (init && init.headers) || {}, { Authorization: 'Bearer ' + t });
    var r = await fetch(url, opts);
    if (r.status === 401 && !retried) { token = null; return apiFetch(url, init, true); }
    if (!r.ok) {
      var msg = 'HTTP ' + r.status;
      try { var j = await r.json(); if (j && j.error && j.error.message) msg += ' — ' + j.error.message; } catch (e) {}
      if (r.status === 403) msg += '\n(이 파일에 대한 권한이 없거나 API 설정 제한 때문일 수 있습니다)';
      throw new Error(msg);
    }
    return r;
  }
  function picker(t, folders) {
    return new Promise(function (resolve) {
      var view = folders
        ? new google.picker.DocsView(google.picker.ViewId.FOLDERS).setMimeTypes('application/vnd.google-apps.folder').setSelectFolderEnabled(true).setMode(google.picker.DocsViewMode.LIST)
        : new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes('text/html,application/xhtml+xml').setIncludeFolders(true).setMode(google.picker.DocsViewMode.LIST);
      var done = false;
      new google.picker.PickerBuilder()
        .setAppId(cfg().APP_ID).setOAuthToken(t).setDeveloperKey(cfg().API_KEY)
        .setOrigin(location.protocol + '//' + location.host).setLocale('ko')
        .setTitle(folders ? '저장할 드라이브 폴더 선택' : '편집할 HTML 파일 선택')
        .addView(view).enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .setCallback(function (d) {
          if (done || !d || !d.action) return;
          if (d.action === google.picker.Action.PICKED) { done = true; resolve((d.docs && d.docs[0]) || null); }
          else if (d.action === google.picker.Action.CANCEL) { done = true; resolve(null); }
        }).build().setVisible(true);
    });
  }
  function precheck() {
    if (!configured()) { LE.dialog.alert('드라이브 연동이 설정되지 않았습니다', 'drive-config.js 에 CLIENT_ID / API_KEY / APP_ID를 채워 주세요. 방법은 README의 "구글 드라이브 연동"에 있습니다.'); return false; }
    if (location.protocol === 'file:') { LE.dialog.alert('드라이브는 웹 주소에서만 쓸 수 있습니다', 'GitHub Pages 주소로 접속하거나 로컬 서버로 실행해 주세요.'); return false; }
    return true;
  }

  var DR = LE.drive = {
    configured: configured,
    open: async function () {
      if (!precheck()) return;
      try {
        var close = LE.toast('구글 드라이브에 연결하는 중…', 'info', 20000);
        await loadLibs();
        var t = await getToken();
        close();
        var doc = await picker(t, false);
        if (!doc) return;
        return this.openById(doc.id, doc.name);
      } catch (e) { LE.dialog.alert('드라이브에서 불러오지 못했습니다', e.message || String(e)); }
    },
    openById: async function (id, nameHint) {
      if (!precheck()) return;
      try {
        await loadLibs();
        var q = 'supportsAllDrives=true';
        var meta = await (await apiFetch(API + encodeURIComponent(id) + '?fields=id,name,mimeType,modifiedTime,size,capabilities(canEdit)&' + q)).json();
        if (meta.mimeType && meta.mimeType.indexOf('application/vnd.google-apps') === 0) { LE.dialog.alert('열 수 없는 형식입니다', '구글 문서·프레젠테이션 형식은 열 수 없습니다. HTML 파일을 골라 주세요.'); return; }
        var looksHtml = /\.x?html?$/i.test(meta.name || nameHint || '') || /html/i.test(meta.mimeType || '');
        if (!looksHtml && !(await LE.dialog.confirm('HTML 파일이 아닌 것 같습니다', (meta.mimeType || '형식 미상') + ' 파일입니다. 그래도 열까요?'))) return;
        if (meta.size && parseInt(meta.size, 10) > MAX) { LE.dialog.alert('파일이 너무 큽니다', LE.fmtBytes(+meta.size) + '입니다. 60MB 이하만 열 수 있습니다.'); return; }
        var close = LE.toast('드라이브에서 내려받는 중… ' + (meta.name || ''), 'info', 30000);
        var text = await (await apiFetch(API + encodeURIComponent(id) + '?alt=media&' + q)).text();
        close();
        var name = meta.name || nameHint || 'drive.html';
        return LE.app.openDoc(text, { name: name, kind: 'drive', drive: { id: id, name: name, modifiedTime: meta.modifiedTime || null, canEdit: !(meta.capabilities && meta.capabilities.canEdit === false) } });
      } catch (e) { LE.dialog.alert('드라이브에서 불러오지 못했습니다', e.message || String(e)); }
    },
    save: async function () {
      var f = LE.file;
      if (!f || f.kind !== 'drive' || !f.drive) { return this.saveAs(); }
      if (!precheck()) return;
      if (f.drive.canEdit === false) { LE.dialog.alert('편집 권한이 없습니다', '이 드라이브 파일에는 쓸 수 없습니다. [드라이브에 새 파일로 저장]이나 [다른 이름으로 저장]을 써 주세요.'); return; }
      try {
        await LE.io.flush();
        var html = LE.src.html();
        await loadLibs();
        var q = 'supportsAllDrives=true';
        var cur = await (await apiFetch(API + encodeURIComponent(f.drive.id) + '?fields=modifiedTime&' + q)).json();
        if (f.drive.modifiedTime && cur.modifiedTime && cur.modifiedTime !== f.drive.modifiedTime) {
          if (!(await LE.dialog.confirm('다른 곳에서 바뀐 파일입니다', '이 파일이 ' + new Date(cur.modifiedTime).toLocaleString() + '에 다른 곳에서 수정되었습니다. 덮어쓸까요? 이전 판은 드라이브의 "버전 기록"에 남습니다.', { ok: '덮어쓰기', danger: true }))) return;
        }
        var r = await apiFetch(UPLOAD + encodeURIComponent(f.drive.id) + '?uploadType=media&fields=modifiedTime,name&' + q, { method: 'PATCH', headers: { 'Content-Type': 'text/html; charset=UTF-8' }, body: html });
        var j = await r.json();
        if (j && j.modifiedTime) f.drive.modifiedTime = j.modifiedTime;
        LE.app.markSaved('드라이브에 저장했습니다 · ' + f.name);
      } catch (e) { LE.dialog.alert('드라이브에 저장하지 못했습니다', (e.message || String(e)) + '\n\n작업을 잃지 않도록 [다른 이름으로 저장]으로 내려받아 두세요.'); }
    },
    saveAs: async function () {
      if (!LE.file) return;
      if (!precheck()) return;
      try {
        var name = await LE.dialog.prompt('드라이브에 새 파일로 저장', '파일 이름', LE.file.name);
        if (!name) return;
        if (!/\.x?html?$/i.test(name)) name += '.html';
        await loadLibs();
        var t = await getToken();
        var folder = await picker(t, true);
        var folderId = folder && folder.id;
        if (!folderId && !(await LE.dialog.confirm('폴더를 고르지 않았습니다', '내 드라이브 최상위에 저장할까요?'))) return;
        await LE.io.flush();
        var html = LE.src.html();
        var close = LE.toast('드라이브에 올리는 중… ' + name, 'info', 60000);
        var boundary = '-------lecture-editor-' + Date.now();
        var meta = { name: name, mimeType: 'text/html' };
        if (folderId) meta.parents = [folderId];
        var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
          '\r\n--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n' + html + '\r\n--' + boundary + '--';
        var r = await apiFetch(UPLOAD.replace(/\/$/, '') + '?uploadType=multipart&fields=id,name,modifiedTime&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body });
        var j = await r.json();
        close();
        if (!j || !j.id) throw new Error('업로드 응답에 파일 ID가 없습니다.');
        var oldKey = LE.file.key;
        Object.assign(LE.file, { kind: 'drive', name: j.name || name, handle: null, url: null, drive: { id: j.id, name: j.name || name, modifiedTime: j.modifiedTime || null, canEdit: true } });
        LE.file.key = LE.fileKey(LE.file);
        LE.idb.del('drafts', oldKey);
        LE.recent.add(LE.file);
        LE.app.markSaved('드라이브에 새 파일로 저장했습니다 · ' + LE.file.name + (folder ? ' (' + folder.name + ')' : ''));
      } catch (e) { LE.dialog.alert('드라이브에 올리지 못했습니다', (e.message || String(e)) + '\n\n작업을 잃지 않도록 [다른 이름으로 저장]으로 내려받아 두세요.'); }
    },
    disconnect: function () {
      var t = token && token.t;
      token = null;
      if (t && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(t, function () {}); } catch (e) {} }
      LE.toast(t ? '드라이브 연결을 해제했습니다 (액세스 토큰 폐기)' : '연결된 드라이브 세션이 없습니다', 'info');
    }
  };
})();
