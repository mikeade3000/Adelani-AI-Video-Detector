/* Backend selector.
 *  • Server mode  — when the page is served by the SQL Quest Node.js server (server/), all data lives in
 *    PostgreSQL and every action is checked and applied on the server. Answers never reach the browser.
 *  • Browser-only mode — on a plain static host, data lives in this browser's localStorage and the
 *    same actions (js/actions.js) run locally.
 * The mode is chosen automatically: the server marks its pages with window.SQ_SERVER.
 */
window.SQ = window.SQ || {};

SQ.Backend = (function () {
  var S = SQ.Store, mode = null, lastSync = 0;
  var KEY = 'sqlquest_v1', SESSION = 'sqlquest_session';

  /* ───────── browser-only ───────── */
  var local = (function () {
    var ephemeral = {};
    function verify(u, pw) {
      if (!u.passHash) return false;
      if (u.passHash.indexOf('sha$') === 0) return u.passHash === S.hashLocal(u.salt, pw);
      return 'sha$' + u.passHash === S.hashLocal(u.salt, pw); /* data saved by the first version */
    }
    var ctx = {
      get userId() { return S.currentId(); },
      hash: function (pw) { var salt = S.uid('s'); return { salt: salt, passHash: S.hashLocal(salt, pw) }; },
      verify: verify,
      login: function (id) { S.setCurrent(id); try { localStorage.setItem(SESSION, id); } catch (e) {} },
      logout: function () { S.setCurrent(null); try { localStorage.removeItem(SESSION); } catch (e) {} },
      ephemeral: ephemeral, caps: { allowReset: true, server: false }
    };
    function persist() { try { localStorage.setItem(KEY, JSON.stringify(S.raw())); } catch (e) { console.warn('Could not save', e); } }
    function init() {
      var d = null, sid = null;
      try { d = JSON.parse(localStorage.getItem(KEY)); sid = localStorage.getItem(SESSION); } catch (e) {}
      if (!d || d.version !== 1) { S.attach(S.blank(), null); SQ.Actions.seedDemo(ctx); persist(); }
      else { S.attach(d, sid); if (d._seedPlan) { SQ.Engine.finishSeed(); persist(); } }
      return Promise.resolve();
    }
    function act(name, payload) {
      return SQ.Actions.run(name, payload, ctx).then(function (r) { persist(); return r; });
    }
    function exportData() { return Promise.resolve(S.raw()); }
    return { init: init, act: act, exportData: exportData, refresh: function () { return Promise.resolve(); }, caps: ctx.caps };
  })();

  /* ───────── server ───────── */
  var remote = (function () {
    var caps = { server: true, allowReset: false };
    function apply(state) {
      if (!state) return;
      S.attach(state.db, state.meId || null);
      Object.assign(caps, state.caps || {});
      lastSync = Date.now();
    }
    function req(method, url, body) {
      return fetch(url, { method: method, credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'sqlquest' } : { 'X-Requested-With': 'sqlquest' },
        body: body ? JSON.stringify(body) : undefined })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (j.state) apply(j.state);
            if (!r.ok || j.error) { var e = new Error(j.error || ('Server error (' + r.status + ')')); e.status = r.status; throw e; }
            return j;
          });
        }, function () { throw new Error('Cannot reach the server. Check your internet connection.'); });
    }
    return {
      init: function () { return req('GET', 'api/state'); },
      refresh: function () { return req('GET', 'api/state').catch(function () {}); },
      act: function (name, payload) { return req('POST', 'api/act/' + encodeURIComponent(name), payload || {}).then(function (j) { return j.result; }); },
      exportData: function () { return req('GET', 'api/export').then(function (j) { return j.data; }); },
      caps: caps
    };
  })();

  function detect() {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 4000);
    return fetch('api/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { clearTimeout(t); return !!(j && j.app === 'sqlquest'); })
      .catch(function () { clearTimeout(t); return false; });
  }

  function impl() { return mode === 'server' ? remote : local; }
  return {
    init: function () {
      /* The Node.js server marks the pages it serves with window.SQ_SERVER; static hosts never do. */
      if (!window.SQ_SERVER) { mode = 'local'; return local.init(); }
      return detect().then(function (isServer) {
        if (!isServer) throw new Error('The SQL Quest server is not responding. Please try again in a moment.');
        mode = 'server'; return remote.init();
      });
    },
    mode: function () { return mode; },
    act: function (name, payload) { return impl().act(name, payload); },
    refresh: function () { return impl().refresh(); },
    stale: function () { return mode === 'server' && Date.now() - lastSync > 4000; },
    exportData: function () { return impl().exportData(); },
    caps: function () { return impl().caps; }
  };
})();

/* Convenience for UI code: run an action; on error show a toast and resolve to null. */
SQ.act = function (name, payload) {
  return SQ.Backend.act(name, payload).catch(function (e) {
    if (SQ.UI) SQ.UI.toast(e.message || 'Something went wrong.');
    if (e.status === 401 && SQ.App) SQ.App.go('#/login');
    return null;
  });
};
