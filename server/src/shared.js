/* Loads the game's own JavaScript (content, store, engine, grader, actions) from ../sql-quest/js into an
 * isolated VM context, so the server applies exactly the same rules as the browser. The grader's
 * sandbox is swapped for the Node worker pool. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const sandbox = require('./sandbox');

const CLIENT_DIR = path.resolve(process.env.CLIENT_DIR || path.join(__dirname, '..', '..', 'sql-quest'));
const FILES = ['content.js', 'store.js', 'engine.js', 'grader.js', 'actions.js'];

function load() {
  const context = vm.createContext({ console, setTimeout, clearTimeout, crypto: crypto.webcrypto });
  context.window = context;
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(CLIENT_DIR, 'js', f), 'utf8');
    vm.runInContext(code, context, { filename: f });
  }
  const SQ = context.SQ;
  SQ.Sandbox = {
    run(sql, opts) {
      opts = opts || {};
      return sandbox.run(SQ.SANDBOX_SQL, sql, { check: opts.check, maxRows: opts.maxRows, timeout: SQ.Store.settings().queryTimeoutMs || 2000 });
    }
  };
  return SQ;
}

const SQ = load();

/* ───────── removing answers before anything is sent to a browser ───────── */
const SECRET_KEYS = ['solution', 'answer', 'accept', 'explain', 'explainWrong'];
function stripChallenge(ch) {
  const c = JSON.parse(JSON.stringify(ch));
  SECRET_KEYS.forEach((k) => { delete c[k]; });
  c.hintCount = (ch.hints || []).length; delete c.hints;
  if (Array.isArray(c.items)) c.items = c.items.map((it) => ({ label: it.label }));
  return c;
}
function strippedWorlds() {
  return SQ.WORLDS.map((w) => Object.assign({}, w, {
    levels: w.levels.map((l) => Object.assign({}, l, { challenges: l.challenges.map(stripChallenge) })),
    boss: Object.assign({}, w.boss, { challenges: w.boss.challenges.map(stripChallenge) })
  }));
}
let contentJs = null;
function publicContentJs() {
  if (!contentJs) {
    contentJs = '/* SQL Quest content (served by the server — answers removed) */\nwindow.SQ = window.SQ || {};\n' +
      'SQ.SANDBOX_SQL = ' + JSON.stringify(SQ.SANDBOX_SQL) + ';\n' +
      'SQ.TOPICS = ' + JSON.stringify(SQ.TOPICS) + ';\n' +
      'SQ.WORLDS = ' + JSON.stringify(strippedWorlds()) + ';\n' +
      'SQ.DEFAULT_BADGES = ' + JSON.stringify(SQ.DEFAULT_BADGES) + ';\n' +
      'SQ.TEAM_MISSIONS = ' + JSON.stringify(SQ.TEAM_MISSIONS.map(stripChallenge)) + ';\n';
  }
  return contentJs;
}

module.exports = { SQ, CLIENT_DIR, stripChallenge, publicContentJs };
