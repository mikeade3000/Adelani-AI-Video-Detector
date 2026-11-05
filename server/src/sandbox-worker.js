/* Runs one student query at a time in a brand-new in-memory SQLite database.
 * Rows are streamed with a cap, so a huge result cannot exhaust memory. */
'use strict';
const { parentPort } = require('worker_threads');
const initSqlJs = require('sql.js');

const HARD_ROW_LIMIT = 200000;
const ready = initSqlJs();

function runAll(db, sql, cap) {
  let last = null;
  for (const stmt of db.iterateStatements(sql)) {
    try {
      const columns = stmt.getColumnNames();
      const values = [];
      let total = 0;
      while (stmt.step()) {
        if (total < cap) values.push(stmt.get());
        total++;
        if (total > HARD_ROW_LIMIT) throw new Error('Your query returned too many rows (over ' + HARD_ROW_LIMIT + ').');
      }
      if (columns.length) last = { columns, values, total };
    } finally { stmt.free(); }
  }
  return last;
}

parentPort.on('message', async (m) => {
  const SQL = await ready;
  const db = new SQL.Database();
  const out = { id: m.id };
  try {
    db.exec(m.setup);
    try {
      out.result = runAll(db, m.sql, m.maxRows || 500);
    } catch (e) {
      out.error = String(e.message || e);
      parentPort.postMessage(out); db.close(); return;
    }
    out.changes = db.getRowsModified();
    if (m.check && m.check.length) {
      out.check = m.check.map((q) => {
        try { const r = runAll(db, q, 5000); return r ? { columns: r.columns, values: r.values } : { columns: [], values: [] }; }
        catch (e) { return { error: String(e.message || e) }; }
      });
    }
  } catch (e) {
    out.error = String(e.message || e);
  }
  db.close();
  parentPort.postMessage(out);
});
