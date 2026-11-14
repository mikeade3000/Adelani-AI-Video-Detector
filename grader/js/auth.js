/*! © 2026 Michael Adelani Adewusi · Adelani Super Intelligent Agents. All rights reserved. No part or section of this application may be copied. */
/*
 * Sign-in for the hosted version. When the app is served by the grader
 * server (server/), users must sign in; the super admin manages accounts and
 * AI reading/grading runs through the server, so no API key is needed in the
 * browser. When the files are opened from static hosting with no server,
 * the app runs stand-alone exactly as before.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function api(path, body, method) {
    var opts = { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'X-Requested-With': 'grader' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch('api/' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Request failed (' + r.status + ')')); e.status = r.status; e.code = j.code; throw e; }
        return j;
      });
    });
  }

  var Server = window.GraderServer = { enabled: false, user: null, ai: null, usage: null, api: api };

  function startApp() {
    var s = document.createElement('script');
    s.src = 'js/app.js';
    document.body.appendChild(s);
  }

  function showScreen(which, message) {
    $('authScreen').classList.remove('hidden');
    document.body.classList.add('signed-out');
    $('loginForm').classList.toggle('hidden', which !== 'login');
    $('pwForm').classList.toggle('hidden', which !== 'password');
    var m = $('authMessage');
    m.textContent = message || '';
    m.classList.toggle('hidden', !message);
    var focus = which === 'login' ? $('loginEmail') : $('pwCurrent');
    setTimeout(function () { focus.focus(); }, 50);
  }

  function signedIn(me) {
    Server.user = me.user;
    Server.ai = me.ai;
    Server.usage = me.usage;
    if (me.user.mustChangePassword) {
      showScreen('password', 'Welcome, ' + me.user.name + '. Please replace your temporary password before you start.');
      return;
    }
    $('authScreen').classList.add('hidden');
    document.body.classList.remove('signed-out');
    window.GraderStore.setNamespace('u_' + me.user.id.replace(/-/g, '').slice(0, 16));
    $('userChip').classList.remove('hidden');
    $('userName').textContent = me.user.name + (me.user.role === 'superadmin' ? ' · super admin' : '');
    document.querySelectorAll('[data-role="superadmin"]').forEach(function (n) { n.classList.toggle('hidden', me.user.role !== 'superadmin'); });
    document.querySelectorAll('[data-needs="server-ai"]').forEach(function (n) { n.classList.toggle('hidden', !(me.ai && me.ai.enabled)); });
    if (!started) { started = true; startApp(); }
  }

  var started = false;

  function wire() {
    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('loginBtn');
      btn.disabled = true;
      api('auth/login', { email: $('loginEmail').value, password: $('loginPassword').value })
        .then(function () { $('loginPassword').value = ''; return api('me'); })
        .then(signedIn)
        .catch(function (err) {
          // A temporary password still needs changing: /me answers 403.
          if (err.code === 'must_change_password') return api('me').then(signedIn);
          showScreen('login', err.message);
        })
        .then(function () { btn.disabled = false; });
    });
    $('pwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if ($('pwNext').value !== $('pwNext2').value) { showScreen('password', 'The two new passwords do not match.'); return; }
      api('auth/password', { current: $('pwCurrent').value, next: $('pwNext').value })
        .then(function () {
          ['pwCurrent', 'pwNext', 'pwNext2'].forEach(function (id) { $(id).value = ''; });
          return api('me');
        })
        .then(signedIn)
        .catch(function (err) { showScreen('password', err.message); });
    });
    $('pwCancel').addEventListener('click', function () {
      if (Server.user && !Server.user.mustChangePassword) { $('authScreen').classList.add('hidden'); document.body.classList.remove('signed-out'); }
      else signOut();
    });
    $('changePwBtn').addEventListener('click', function () { showScreen('password', 'Choose a new password (at least 10 characters, with letters and numbers).'); });
    $('signOutBtn').addEventListener('click', signOut);
  }

  function signOut() {
    api('auth/logout', {}).catch(function () {}).then(function () {
      // Reload so no previous user's data stays in memory.
      location.reload();
    });
  }

  // Any request that finds the session expired sends the user back to sign-in.
  Server.handleAuthError = function (err) {
    if (err && err.status === 401) { showScreen('login', 'Your session has ended. Please sign in again.'); return true; }
    return false;
  };

  wire();
  fetch('api/health', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (health) {
      if (!health || health.ok !== true) { startApp(); return; } // static hosting: stand-alone mode
      Server.enabled = true;
      document.body.classList.add('server-mode');
      return api('me').then(signedIn).catch(function (err) {
        if (err.code === 'must_change_password') {
          // Signed in with a temporary password; we only know the user after changing it.
          Server.user = { mustChangePassword: true };
          showScreen('password', 'Please replace your temporary password before you start.');
          return;
        }
        showScreen('login', health.setupNeeded ? 'No accounts exist yet. The administrator must set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD on the server.' : '');
      });
    });
})();
