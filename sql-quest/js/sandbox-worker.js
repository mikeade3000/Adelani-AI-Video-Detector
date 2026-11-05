/* Sandbox worker: every request gets a brand-new in-memory SQLite database (reset after each run).
 * Running in a worker lets the main thread kill runaway queries (time limit). */
importScripts('../vendor/sql-wasm.js');

var SQLready = initSqlJs({ locateFile: function (f) { return '../vendor/' + f; } });

function lastResult(res) { return res && res.length ? res[res.length - 1] : null; }

self.onmessage = function (ev) {
  var m = ev.data;
  SQLready.then(function (SQL) {
    var db = new SQL.Database();
    var out = { id: m.id };
    try {
      db.exec(m.setup);
      var res;
      try {
        res = db.exec(m.sql);
      } catch (e) {
        out.error = String(e.message || e);
        self.postMessage(out); db.close(); return;
      }
      var r = lastResult(res);
      out.result = r ? { columns: r.columns, values: r.values.slice(0, m.maxRows || 500), total: r.values.length } : null;
      out.changes = db.getRowsModified();
      if (m.check && m.check.length) {
        out.check = m.check.map(function (q) {
          try { var c = lastResult(db.exec(q)); return c ? { columns: c.columns, values: c.values } : { columns: [], values: [] }; }
          catch (e) { return { error: String(e.message || e) }; }
        });
      }
    } catch (e) {
      out.error = String(e.message || e);
    }
    db.close();
    self.postMessage(out);
  });
};
