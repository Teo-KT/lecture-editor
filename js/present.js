/* lecture-editor v4 · presentation preview: the saved file, exactly as the audience sees it */
(function () {
  'use strict';
  var LE = window.LE, h = LE.h;
  var SHIM = "(function(){function mem(){var m={};return{get length(){return Object.keys(m).length},key:function(i){return Object.keys(m)[i]||null},getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}}}" +
    "['localStorage','sessionStorage'].forEach(function(n){try{window[n].setItem('__p','1');window[n].removeItem('__p')}catch(e){var s=mem();try{Object.defineProperty(window,n,{configurable:true,get:function(){return s}})}catch(e2){}}});" +
    "try{['pushState','replaceState'].forEach(function(k){var o=history[k];history[k]=function(){try{return o.apply(history,arguments)}catch(e){}}})}catch(e){}" +
    "try{document.cookie}catch(e){try{Object.defineProperty(document,'cookie',{configurable:true,get:function(){return ''},set:function(){}})}catch(e2){}}" +
    "window.addEventListener('keydown',function(e){if(e.key==='Escape'&&!document.fullscreenElement){parent.postMessage({lePresent:'close'},'*');}},true);" +
    "var START=__START__;if(START>0){window.addEventListener('load',function(){setTimeout(function(){for(var i=0;i<START;i++){var o={key:'ArrowRight',code:'ArrowRight',keyCode:39,which:39,bubbles:true,cancelable:true};document.dispatchEvent(new KeyboardEvent('keydown',o));document.dispatchEvent(new KeyboardEvent('keyup',o));}},350);});}})();";

  var P = LE.present = {
    el: null,
    open: async function (fromCurrent) {
      await LE.io.flush();
      this.close();
      var start = fromCurrent && !LE.view.docMode ? Math.max(0, LE.slides.index) : 0;
      var html = LE.src.html();
      var inj = '<script>' + SHIM.replace('__START__', String(start)) + '<\/script>';
      var m = /<head\b[^>]*>/i.exec(html);
      html = m ? html.slice(0, m.index + m[0].length) + inj + html.slice(m.index + m[0].length) : inj + html;
      html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*content-security-policy\b[^>]*>/gi, '');
      if (LE.file && LE.file.base) html = html.replace(/<head\b[^>]*>/i, function (t) { return t + '<base href="' + LE.esc(LE.file.base) + '">'; });
      if (LE.assets.rewriter()) html = LE.assets.rewriter()(html);
      var frame = h('iframe', { class: 'present-frame', sandbox: 'allow-scripts allow-forms allow-pointer-lock allow-modals allow-popups', allow: 'autoplay; fullscreen', allowfullscreen: true, title: '발표 미리보기' });
      var bar = h('div', { class: 'present-bar' },
        h('span', { class: 'present-title', html: LE.icon('present') + '<span>발표 미리보기 · 저장했을 때와 똑같이 동작합니다</span>' }),
        h('span', { class: 'present-hint', text: start ? (start + 1) + '번 슬라이드부터 · 키보드로 넘기기' : '키보드로 넘기기' }),
        h('button', { class: 'btn ghost sm', html: LE.icon('fit') + '<span>전체 화면</span>', onclick: function () { var t = P.el; if (t && t.requestFullscreen) t.requestFullscreen(); } }),
        h('button', { class: 'btn secondary sm', html: LE.icon('x') + '<span>닫기 (Esc)</span>', onclick: function () { P.close(); } }));
      this.el = h('div', { class: 'present' }, bar, h('div', { class: 'present-stage' }, frame));
      document.body.appendChild(this.el);
      frame.srcdoc = html;
      setTimeout(function () { try { frame.focus(); frame.contentWindow.focus(); } catch (e) {} }, 300);
      this._msg = function (e) { if (e.source === frame.contentWindow && e.data && e.data.lePresent === 'close') P.close(); };
      this._key = function (e) { if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); P.close(); } };
      window.addEventListener('message', this._msg);
      document.addEventListener('keydown', this._key, true);
    },
    close: function () {
      if (!this.el) return;
      if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
      this.el.remove(); this.el = null;
      window.removeEventListener('message', this._msg);
      document.removeEventListener('keydown', this._key, true);
      LE.view.focus();
    },
    isOpen: function () { return !!this.el; }
  };
})();
