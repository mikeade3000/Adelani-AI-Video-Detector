import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID } from "node:crypto";
var SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sheet_meta (name TEXT PRIMARY KEY, max_rows INTEGER NOT NULL, max_cols INTEGER NOT NULL, ord INTEGER NOT NULL)",
  // WITHOUT ROWID: the key is the table itself, so a write updates one row and no separate key index
  // (Cloudflare bills every row written, index rows included).
  "CREATE TABLE IF NOT EXISTS sheet_rows (name TEXT NOT NULL, r INTEGER NOT NULL, v TEXT NOT NULL, PRIMARY KEY (name, r)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS log_rows (name TEXT NOT NULL, r INTEGER NOT NULL, k1 TEXT, k2 TEXT, v TEXT NOT NULL, PRIMARY KEY (name, r)) WITHOUT ROWID",
  "CREATE INDEX IF NOT EXISTS log_k1 ON log_rows (name, k1)",
  "CREATE INDEX IF NOT EXISTS log_k2 ON log_rows (name, k2)",
  "CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, folder INTEGER NOT NULL, parent TEXT, name TEXT, mime TEXT, size INTEGER, r2key TEXT, sharing INTEGER NOT NULL DEFAULT 0, trashed INTEGER NOT NULL DEFAULT 0, created TEXT)",
  "CREATE INDEX IF NOT EXISTS files_parent ON files (parent, folder, name)"
];
export var LOG_SHEETS = { Activity: { k1: 2, k2: -1 }, Recordings: { k1: 1, k2: 4 } };
var BIG_CACHE = 2048;
var VOLATILE = /^(seen|snapt|ih):/;
var MAX_TTL_S = 21600;
export function enc(row) {
  return JSON.stringify(Array.from(row || [], (v) => v instanceof Date ? { $d: v.toISOString() } : v === void 0 || v === null ? "" : v));
}
export function dec(s) {
  return JSON.parse(s).map((v) => v === null ? "" : v && typeof v === "object" && v.$d ? new Date(v.$d) : v);
}
function toBuf(x) {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Int8Array || x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (Array.isArray(x)) return Buffer.from(x.map((b) => b & 255));
  return Buffer.from(String(x), "utf8");
}
function bytesOut(buf) {
  if (buf.length > 65536) return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    out[i] = v > 127 ? v - 256 : v;
  }
  return out;
}
var isRef = (x) => x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Int8Array) && (x.__r2ref || x.__r2get);
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function formatDate(d, tz, pat) {
  d = d instanceof Date ? d : new Date(d);
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "long" }).formatToParts(d).forEach((x) => {
    p[x.type] = x.value;
  });
  const pad = (n) => String(n).padStart(2, "0"), H = +p.hour % 24, h12 = H % 12 || 12;
  const map = {
    yyyy: p.year,
    yy: p.year.slice(-2),
    MMMM: MONTHS[+p.month - 1],
    MMM: MONTHS[+p.month - 1].slice(0, 3),
    MM: p.month,
    M: String(+p.month),
    dd: p.day,
    d: String(+p.day),
    EEEE: p.weekday,
    EEE: p.weekday.slice(0, 3),
    HH: pad(H),
    H: String(H),
    hh: pad(h12),
    h: String(h12),
    mm: p.minute,
    m: String(+p.minute),
    ss: p.second,
    s: String(+p.second),
    a: H < 12 ? "AM" : "PM"
  };
  return String(pat).replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|m|ss|s|a/g, (t, lit) => lit !== void 0 ? lit : map[t]);
}
export function createShims(db, opts = {}) {
  const io = { cellsRead: 0, sheetCalls: 0, sheetWrites: 0, cacheOps: 0, cacheBytes: 0, hmacCalls: 0, lockHeld: 0, lockAcquisitions: 0 };
  const now = () => Date.now();
  db.tx(() => SCHEMA.forEach((q) => db.run(q)));
  class Range {
    constructor(sh, r, c, nr, nc) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols)
        throw new Error("Range " + r + "," + c + " (" + nr + "x" + nc + ") is outside the sheet " + sh.name + " (" + sh.maxRows + "x" + sh.maxCols + ")");
      this.sh = sh;
      this.r = r;
      this.c = c;
      this.nr = nr;
      this.nc = nc;
    }
    cell(i, j) {
      const row = this.sh.data[this.r - 1 + i];
      const v = row ? row[this.c - 1 + j] : void 0;
      return v === void 0 || v === null ? "" : v;
    }
    getValues() {
      io.cellsRead += this.nr * this.nc;
      io.sheetCalls++;
      const out = new Array(this.nr);
      for (let i = 0; i < this.nr; i++) {
        const row = new Array(this.nc);
        for (let j = 0; j < this.nc; j++) row[j] = this.cell(i, j);
        out[i] = row;
      }
      return out;
    }
    getValue() {
      return this.cell(0, 0);
    }
    getDisplayValues() {
      return this.getValues().map((r) => r.map((v) => v instanceof Date ? v.toISOString() : String(v)));
    }
    setValues(v) {
      io.sheetCalls++;
      io.sheetWrites++;
      if (!v || v.length !== this.nr || !v[0] || v[0].length !== this.nc) throw new Error("The number of rows or columns in the data does not match the range.");
      const sh = this.sh;
      for (let i = 0; i < this.nr; i++) {
        const ri = this.r - 1 + i;
        const row = sh.data[ri] || (sh.data[ri] = []);
        for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = v[i][j];
        sh.touch(ri);
      }
      return this;
    }
    setValue(x) {
      return this.setValues([[x]]);
    }
    clearContent() {
      const blank = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push("");
        blank.push(row);
      }
      return this.setValues(blank);
    }
    setNumberFormat() {
      return this;
    }
    getRow() {
      return this.r;
    }
    getColumn() {
      return this.c;
    }
    getNumRows() {
      return this.nr;
    }
    getNumColumns() {
      return this.nc;
    }
    createTextFinder(text) {
      const self = this;
      let exact = false;
      text = String(text);
      return { matchEntireCell(b) {
        exact = !!b;
        return this;
      }, matchCase() {
        return this;
      }, findNext() {
        for (let i = 0; i < self.nr; i++) for (let j = 0; j < self.nc; j++) {
          const v = String(self.cell(i, j));
          if (exact ? v === text : v.indexOf(text) >= 0) return { getRow: () => self.r + i, getColumn: () => self.c + j };
        }
        return null;
      } };
    }
  }
  class Sheet {
    constructor(name, maxRows, maxCols, ord) {
      this.name = name;
      this.data = [];
      this.maxRows = maxRows;
      this.maxCols = maxCols;
      this.ord = ord;
      this.dirty = /* @__PURE__ */ new Set();
      this.metaDirty = false;
      this.lastCol = -1;
    }
    touch(ri) {
      this.dirty.add(ri);
      this.lastCol = -1;
    }
    getName() {
      return this.name;
    }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) {
        const r = this.data[i];
        if (r) for (let j = 0; j < r.length; j++) {
          const v = r[j];
          if (v !== "" && v !== void 0 && v !== null) return i + 1;
        }
      }
      return 0;
    }
    getLastColumn() {
      if (this.lastCol >= 0) return this.lastCol;
      let m = 0;
      for (let i = 0; i < this.data.length; i++) {
        const r = this.data[i];
        if (!r) continue;
        for (let j = r.length - 1; j >= m; j--) {
          const v = r[j];
          if (v !== "" && v !== void 0 && v !== null) {
            m = j + 1;
            break;
          }
        }
      }
      return this.lastCol = m;
    }
    getMaxColumns() {
      return this.maxCols;
    }
    getMaxRows() {
      return this.maxRows;
    }
    insertColumnsAfter(_, n) {
      this.maxCols += n;
      this.metaDirty = true;
    }
    insertRowsAfter(_, n) {
      this.maxRows += n;
      this.metaDirty = true;
    }
    getRange(r, c, nr = 1, nc = 1) {
      return new Range(this, r, c, nr, nc);
    }
    getDataRange() {
      return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
    }
    setFrozenRows() {
    }
    appendRow(row) {
      io.sheetCalls++;
      io.sheetWrites++;
      const r = this.getLastRow() + 1;
      if (r > this.maxRows) {
        this.maxRows = r;
        this.metaDirty = true;
      }
      if (row.length > this.maxCols) {
        this.maxCols = row.length;
        this.metaDirty = true;
      }
      this.data[r - 1] = row.slice();
      this.touch(r - 1);
      return this;
    }
    flush() {
      if (this.metaDirty) {
        db.run("INSERT OR REPLACE INTO sheet_meta (name, max_rows, max_cols, ord) VALUES (?, ?, ?, ?)", this.name, this.maxRows, this.maxCols, this.ord);
        this.metaDirty = false;
      }
      for (const ri of this.dirty) {
        const row = this.data[ri];
        const empty = !row || !row.some((v) => v !== "" && v !== void 0 && v !== null);
        if (empty) db.run("DELETE FROM sheet_rows WHERE name = ? AND r = ?", this.name, ri + 1);
        else db.run("INSERT OR REPLACE INTO sheet_rows (name, r, v) VALUES (?, ?, ?)", this.name, ri + 1, enc(row));
      }
      this.dirty.clear();
    }
  }
  class LogRange {
    constructor(sh, r, c, nr, nc) {
      this.sh = sh;
      this.r = r;
      this.c = c;
      this.nr = nr;
      this.nc = nc;
    }
    getValues() {
      io.cellsRead += this.nr * this.nc;
      io.sheetCalls++;
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push("");
        out.push(row);
      }
      for (const x of db.all("SELECT r, v FROM log_rows WHERE name = ? AND r BETWEEN ? AND ?", this.sh.name, this.r, this.r + this.nr - 1)) {
        const vals = dec(x.v), o = out[x.r - this.r];
        for (let j = 0; j < this.nc; j++) {
          const v = vals[this.c - 1 + j];
          o[j] = v === void 0 ? "" : v;
        }
      }
      return out;
    }
    getValue() {
      return this.getValues()[0][0];
    }
    setValues(v) {
      io.sheetCalls++;
      io.sheetWrites++;
      for (let i = 0; i < this.nr; i++) {
        const r = this.r + i, cur = db.all("SELECT v FROM log_rows WHERE name = ? AND r = ?", this.sh.name, r)[0];
        const row = cur ? dec(cur.v) : [];
        for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = v[i][j];
        this.sh.put(r, row);
      }
      return this;
    }
    setValue(x) {
      return this.setValues([[x]]);
    }
    setNumberFormat() {
      return this;
    }
    getRow() {
      return this.r;
    }
    getColumn() {
      return this.c;
    }
    getNumRows() {
      return this.nr;
    }
    getNumColumns() {
      return this.nc;
    }
    createTextFinder(text) {
      return Range.prototype.createTextFinder.call({ nr: this.nr, nc: this.nc, r: this.r, c: this.c, cell: (() => {
        const v = this.getValues();
        return (i, j) => v[i][j];
      })() }, text);
    }
  }
  class LogSheet {
    constructor(name, maxRows, maxCols, ord) {
      this.name = name;
      this.cfg = LOG_SHEETS[name];
      this.ord = ord;
      this.maxCols = maxCols;
      this.metaDirty = false;
      const m = db.all("SELECT MAX(r) AS m FROM log_rows WHERE name = ?", name)[0];
      this.last = m && m.m || 0;
      this.maxRows = Math.max(maxRows, this.last);
      const h = db.all("SELECT v FROM log_rows WHERE name = ? AND r = 1", name)[0];
      this.width = h ? dec(h.v).length : 0;
    }
    put(r, row) {
      const k = this.cfg, s = (v) => v === void 0 || v === null ? "" : String(v);
      db.run("INSERT OR REPLACE INTO log_rows (name, r, k1, k2, v) VALUES (?, ?, ?, ?, ?)", this.name, r, r === 1 ? null : s(row[k.k1]), r === 1 || k.k2 < 0 ? null : s(row[k.k2]), enc(row));
      if (r > this.last) this.last = r;
      if (r > this.maxRows) {
        this.maxRows = r;
      }
      if (row.length > this.width) this.width = row.length;
    }
    getName() {
      return this.name;
    }
    getLastRow() {
      return this.last;
    }
    getLastColumn() {
      return this.last ? this.width : 0;
    }
    getMaxColumns() {
      return this.maxCols;
    }
    getMaxRows() {
      return this.maxRows;
    }
    insertColumnsAfter(_, n) {
      this.maxCols += n;
      this.metaDirty = true;
    }
    insertRowsAfter(_, n) {
      this.maxRows += n;
    }
    getRange(r, c, nr = 1, nc = 1) {
      return new LogRange(this, r, c, nr, nc);
    }
    getDataRange() {
      return new LogRange(this, 1, 1, Math.max(1, this.last), Math.max(1, this.getLastColumn()));
    }
    setFrozenRows() {
    }
    appendRow(row) {
      io.sheetCalls++;
      io.sheetWrites++;
      this.put(this.last + 1, row.slice());
      return this;
    }
    rows(where, params, order, limit) {
      return db.all("SELECT v FROM log_rows WHERE name = ? AND r > 1" + (where ? " AND " + where : "") + " ORDER BY r " + (order || "ASC") + (limit ? " LIMIT " + (limit | 0) : ""), this.name, ...params || []).map((x) => dec(x.v));
    }
    flush() {
      if (this.metaDirty) {
        db.run("INSERT OR REPLACE INTO sheet_meta (name, max_rows, max_cols, ord) VALUES (?, ?, ?, ?)", this.name, this.maxRows, this.maxCols, this.ord);
        this.metaDirty = false;
      }
    }
    get data() {
      const out = [];
      for (const x of db.all("SELECT r, v FROM log_rows WHERE name = ? ORDER BY r", this.name)) out[x.r - 1] = dec(x.v);
      return out;
    }
  }
  const sheets = {};
  let nextOrd = 0;
  function loadSheets() {
    for (const k of Object.keys(sheets)) delete sheets[k];
    nextOrd = 0;
    for (const m of db.all("SELECT name, max_rows, max_cols, ord FROM sheet_meta ORDER BY ord")) {
      nextOrd = Math.max(nextOrd, m.ord + 1);
      if (LOG_SHEETS[m.name]) {
        sheets[m.name] = new LogSheet(m.name, m.max_rows, m.max_cols, m.ord);
        continue;
      }
      const sh = sheets[m.name] = new Sheet(m.name, m.max_rows, m.max_cols, m.ord);
      for (const x of db.all("SELECT r, v FROM sheet_rows WHERE name = ?", m.name)) sh.data[x.r - 1] = dec(x.v);
    }
  }
  loadSheets();
  const book = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet(n) {
      if (sheets[n]) throw new Error('A sheet with the name "' + n + '" already exists.');
      const sh = sheets[n] = LOG_SHEETS[n] ? new LogSheet(n, 1e3, 26, nextOrd++) : new Sheet(n, 1e3, 26, nextOrd++);
      sh.metaDirty = true;
      if (sh.flush) sh.flush();
      return sh;
    },
    getSheets: () => Object.values(sheets).sort((a, b) => a.ord - b.ord),
    getId: () => "cloudflare",
    getName: () => "KIU CBT"
  };
  const mem = /* @__PURE__ */ new Map();
  const parsed = /* @__PURE__ */ new Map();
  let lastPurge = 0, seq = 0;
  function loadCache() {
    mem.clear();
    db.run("DELETE FROM cache WHERE exp <= ?", now());
    parsed.clear();
    for (const x of db.all("SELECT k, length(v) AS n, exp FROM cache")) mem.set(x.k, x.n > BIG_CACHE ? { big: true, exp: x.exp, dbExp: x.exp, seq: ++seq } : null);
    for (const x of db.all("SELECT k, v, exp FROM cache WHERE length(v) <= ?", BIG_CACHE)) mem.set(x.k, { v: x.v, exp: x.exp, dbExp: x.exp, seq: ++seq });
  }
  loadCache();
  function cget(k) {
    io.cacheOps++;
    const m = mem.get(k);
    if (!m) return null;
    if (m.exp <= now()) {
      mem.delete(k);
      db.run("DELETE FROM cache WHERE k = ?", k);
      return null;
    }
    let v = m.v;
    if (m.big) {
      const x = db.all("SELECT v FROM cache WHERE k = ?", k)[0];
      if (!x) {
        mem.delete(k);
        return null;
      }
      v = x.v;
    }
    io.cacheBytes += v.length;
    return v;
  }
  function cput(k, v, ttl) {
    io.cacheOps++;
    v = String(v);
    const t = now(), life = Math.min(MAX_TTL_S, Math.max(1, ttl == null ? 600 : +ttl || 600)) * 1e3, exp = t + life;
    const m = mem.get(k);
    if (VOLATILE.test(k) && v.length <= BIG_CACHE) {
      if (m && m.dbExp) db.run("DELETE FROM cache WHERE k = ?", k);
      mem.set(k, { v, exp, seq: ++seq });
      return;
    }
    if (m && !m.big && m.v === v && m.dbExp && m.dbExp - t > life / 2) {
      m.exp = exp;
      return;
    }
    db.run("INSERT OR REPLACE INTO cache (k, v, exp) VALUES (?, ?, ?)", k, v, exp);
    if (m && !m.big && m.v === v) {
      m.exp = exp;
      m.dbExp = exp;
      return;
    }
    mem.set(k, v.length > BIG_CACHE ? { big: true, exp, dbExp: exp, seq: ++seq } : { v, exp, dbExp: exp, seq: ++seq });
  }
  function cdel(k) {
    const m = mem.get(k);
    if (mem.delete(k) && (!m || m.dbExp || m.big)) db.run("DELETE FROM cache WHERE k = ?", k);
  }
  const cache = {
    get: cget,
    put: cput,
    getAll(keys) {
      const o = {};
      for (const k of keys) {
        const v = cget(k);
        if (v !== null) o[k] = v;
      }
      return o;
    },
    putAll(m, ttl) {
      for (const k of Object.keys(m)) cput(k, m[k], ttl);
    },
    remove: cdel,
    removeAll(keys) {
      for (const k of keys) cdel(k);
    }
  };
  function purgeCache() {
    if (now() - lastPurge < 3e5) return;
    lastPurge = now();
    const t = now();
    for (const [k, m] of mem) if (m.exp <= t) mem.delete(k);
    db.run("DELETE FROM cache WHERE exp <= ?", t);
  }
  const props = /* @__PURE__ */ new Map();
  function loadProps() {
    props.clear();
    for (const x of db.all("SELECT k, v FROM props")) props.set(x.k, x.v);
  }
  loadProps();
  const properties = {
    getProperty: (k) => props.has(k) ? props.get(k) : null,
    setProperty(k, v) {
      v = String(v);
      props.set(k, v);
      db.run("INSERT OR REPLACE INTO props (k, v) VALUES (?, ?)", k, v);
      return this;
    },
    deleteProperty(k) {
      props.delete(k);
      db.run("DELETE FROM props WHERE k = ?", k);
      return this;
    },
    getProperties: () => Object.fromEntries(props)
  };
  const pending = /* @__PURE__ */ new Map();
  let req = { refs: {}, claimed: [], puts: [], deletes: [], mail: [] };
  const newId = (p) => p + randomUUID().replace(/-/g, "");
  const fileRow = (id) => db.all("SELECT * FROM files WHERE id = ?", String(id))[0];
  function blobOf(data, mime, name) {
    let d = data;
    const ref = isRef(d);
    return {
      _d: d,
      mime: mime || (typeof d === "string" ? "text/plain" : "application/octet-stream"),
      name: name || "",
      getBytes() {
        return ref ? d : typeof d === "string" ? bytesOut(Buffer.from(d, "utf8")) : d;
      },
      getDataAsString() {
        if (ref) throw new Error("Stored file contents are not available here.");
        return toBuf(d).toString("utf8");
      },
      getContentType() {
        return this.mime;
      },
      setContentType(m) {
        this.mime = m;
        return this;
      },
      getName() {
        return this.name;
      },
      setName(n) {
        this.name = n;
        return this;
      },
      getSize() {
        return ref ? d.length : toBuf(d).length;
      }
    };
  }
  function fileApi(row) {
    const id = row.id;
    return {
      getId: () => id,
      getName: () => row.name,
      getUrl: () => "/media/" + id,
      getSize: () => row.size,
      getMimeType: () => row.mime,
      getDateCreated: () => new Date(row.created),
      setSharing(a) {
        db.run("UPDATE files SET sharing = ? WHERE id = ?", +a || 0, id);
        row.sharing = +a || 0;
        return this;
      },
      getSharingAccess: () => row.sharing,
      setTrashed(b) {
        if (b && !row.trashed) {
          db.run("UPDATE files SET trashed = 1 WHERE id = ?", id);
          row.trashed = 1;
          pending.delete(row.r2key);
          req.deletes.push(row.r2key);
        }
        return this;
      },
      isTrashed: () => !!row.trashed,
      getBlob() {
        const p = pending.get(row.r2key);
        return blobOf(p ? bytesOut(p.buf) : { length: row.size, __r2get: row.r2key }, row.mime, row.name);
      }
    };
  }
  function iter(list) {
    let i = 0;
    return { hasNext: () => i < list.length, next: () => {
      if (i >= list.length) throw new Error("No more items.");
      return list[i++];
    } };
  }
  function createFile(blob, parent) {
    const id = newId("f"), d = blob._d;
    let key, size;
    if (d && d.__r2ref) {
      key = d.__key;
      size = d.length;
      req.claimed.push(d.__r2ref);
    } else {
      const buf = toBuf(d == null ? "" : d);
      key = "m/" + id;
      size = buf.length;
      pending.set(key, { buf, mime: blob.mime });
      req.puts.push(key);
    }
    db.run("INSERT INTO files (id, folder, parent, name, mime, size, r2key, sharing, trashed, created) VALUES (?, 0, ?, ?, ?, ?, ?, 0, 0, ?)", id, parent || null, blob.name || "file", blob.mime, size, key, (/* @__PURE__ */ new Date()).toISOString());
    return fileApi(fileRow(id));
  }
  function folderApi(row) {
    const id = row.id;
    return {
      getId: () => id,
      getName: () => row.name,
      createFile: (blob) => createFile(blob, id),
      createFolder: (n) => createFolder(n, id),
      getFoldersByName: (n) => iter(db.all("SELECT * FROM files WHERE parent = ? AND folder = 1 AND name = ? AND trashed = 0", id, String(n)).map(folderApi)),
      getFiles: () => iter(db.all("SELECT * FROM files WHERE parent = ? AND folder = 0 AND trashed = 0 ORDER BY created", id).map(fileApi)),
      getFilesByName: (n) => iter(db.all("SELECT * FROM files WHERE parent = ? AND folder = 0 AND name = ? AND trashed = 0", id, String(n)).map(fileApi)),
      setSharing() {
        return this;
      },
      setTrashed() {
        return this;
      }
    };
  }
  function createFolder(name, parent) {
    const id = newId("d");
    db.run("INSERT INTO files (id, folder, parent, name, mime, size, r2key, sharing, trashed, created) VALUES (?, 1, ?, ?, NULL, 0, NULL, 0, 0, ?)", id, parent || null, String(name), (/* @__PURE__ */ new Date()).toISOString());
    return folderApi(fileRow(id));
  }
  const DriveApp = {
    createFolder: (n) => createFolder(n, null),
    createFile: (blob) => createFile(blob, null),
    getFolderById(id) {
      const r = fileRow(id);
      if (!r || !r.folder || r.trashed) throw new Error("No item with the given ID could be found.");
      return folderApi(r);
    },
    getFileById(id) {
      const r = fileRow(id);
      if (!r || r.folder || r.trashed) throw new Error("No item with the given ID could be found.");
      return fileApi(r);
    },
    getRootFolder: () => ({ getId: () => "root", createFile: (b) => createFile(b, null), createFolder: (n) => createFolder(n, null) }),
    Access: { PRIVATE: 0, ANYONE_WITH_LINK: 1, ANYONE: 2, DOMAIN: 3, DOMAIN_WITH_LINK: 4 },
    Permission: { NONE: 0, VIEW: 1, COMMENT: 2, EDIT: 3 }
  };
  const Utilities = {
    getUuid: () => randomUUID(),
    base64Encode(b) {
      if (isRef(b)) return "R2GET:" + (b.__r2get || b.__key);
      return toBuf(b).toString("base64");
    },
    base64EncodeWebSafe: (b) => toBuf(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    base64Decode(s) {
      s = String(s);
      if (s.lastIndexOf("R2REF:", 0) === 0) {
        const p = s.split(":"), ref = req.refs[p[1]];
        if (!ref) throw new Error("This upload has expired. Please try again.");
        return { length: ref.size, __r2ref: p[1], __key: ref.key };
      }
      return bytesOut(Buffer.from(s, "base64"));
    },
    base64DecodeWebSafe: (s) => bytesOut(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64")),
    computeHmacSha256Signature(v, k) {
      io.hmacCalls++;
      return bytesOut(createHmac("sha256", toBuf(k)).update(toBuf(v)).digest());
    },
    computeDigest(alg, v) {
      return bytesOut(createHash(alg || "sha256").update(toBuf(v)).digest());
    },
    DigestAlgorithm: { MD5: "md5", SHA_1: "sha1", SHA_256: "sha256", SHA_384: "sha384", SHA_512: "sha512" },
    newBlob: (data, mime, name) => blobOf(data, mime, name),
    formatDate: (d, tz, pat) => formatDate(d, tz, pat),
    sleep() {
    }
  };
  const lock = {
    waitLock() {
      io.lockHeld++;
      io.lockAcquisitions++;
    },
    tryLock() {
      io.lockHeld++;
      io.lockAcquisitions++;
      return true;
    },
    releaseLock() {
      io.lockHeld = Math.max(0, io.lockHeld - 1);
    },
    hasLock: () => io.lockHeld > 0
  };
  const logs = [];
  const G = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {
    } },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => lock },
    DriveApp,
    Utilities,
    ContentService: { createTextOutput: (s) => ({ s: String(s), mime: "text", setMimeType(m) {
      this.mime = m;
      return this;
    }, getContent() {
      return this.s;
    } }), MimeType: { JSON: "json", TEXT: "text" } },
    HtmlService: { createHtmlOutput: (s) => ({ s: String(s), html: true, setTitle() {
      return this;
    }, getContent() {
      return this.s;
    } }) },
    Session: { getScriptTimeZone: () => opts.tz || "UTC", getEffectiveUser: () => ({ getEmail: () => opts.operator || "cloudflare" }), getActiveUser: () => ({ getEmail: () => "" }) },
    Logger: { log: (m) => {
      logs.push(String(m));
      if (logs.length > 50) logs.shift();
    } },
    MailApp: { getRemainingDailyQuota: () => 0, sendEmail() {
      throw new Error("Use the Email Service.");
    } }
  };
  const log = (n) => sheets[n] instanceof LogSheet ? sheets[n] : null;
  const hooks = {
    activityFor_: (id) => {
      const s = log("Activity");
      return s ? s.rows("k1 = ?", [String(id)]) : [];
    },
    activityRecent_: (limit) => {
      const s = log("Activity");
      return s ? s.rows("", [], "DESC", limit) : [];
    },
    recordingsFor_: (id) => {
      const s = log("Recordings");
      return s ? s.rows("k1 = ?", [String(id)]) : [];
    },
    removeRecordings_: (id) => {
      const s = log("Recordings");
      if (!s) return 0;
      const n = db.all("SELECT COUNT(*) AS n FROM log_rows WHERE name = 'Recordings' AND r > 1 AND k1 = ?", String(id))[0].n;
      db.run("DELETE FROM log_rows WHERE name = 'Recordings' AND r > 1 AND k1 = ?", String(id));
      return n;
    },
    recordingOwner_: (fid) => {
      const s = log("Recordings");
      const r = s ? s.rows("k2 = ?", [String(fid)], "ASC", 1)[0] : null;
      return r ? String(r[1]) : null;
    },
    // Apps Script keeps nothing between requests, so Code.gs re-reads and re-parses its large cached objects
    // (the index of every candidate) on each request. The engine stays in memory, so the parsed object is
    // kept while its cache entries are unchanged: any rewrite or removal gives them new sequence numbers.
    // Email: Cloudflare Email Service. Messages are queued here and sent by the host once the request's
    // database work is saved (Code.gs then reports them as "pending" and the host fills in the result).
    mailStatus_: () => {
      const m = opts.mail || {};
      return { ready: !!m.ready, via: "Cloudflare Email Service", from: m.from || "", reason: m.ready ? "" : m.reason || 'Email is not set up yet: see DEPLOY.md, "Email".' };
    },
    deliverMail_: (msgs) => msgs.map((m) => {
      req.mail.push({ id: req.mail.length + 1, to: m.to, subject: m.subject, text: m.text, name: m.name });
      return { pending: req.mail.length };
    }),
    cacheGetLarge_: (key) => {
      const n = cget(key + ".n");
      if (!n) return null;
      const cnt = parseInt(n, 10), t = now();
      let stamp = String(mem.get(key + ".n").seq);
      for (let i = 0; i < cnt; i++) {
        const e = mem.get(key + "." + i);
        if (!e || e.exp <= t) return null;
        stamp += ":" + e.seq;
      }
      const m = parsed.get(key);
      if (m && m.stamp === stamp) return m.obj;
      let text = "";
      for (let i = 0; i < cnt; i++) {
        const v = cget(key + "." + i);
        if (v === null) return null;
        text += v;
      }
      let obj = null;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        return null;
      }
      parsed.set(key, { stamp, obj });
      return obj;
    }
  };
  return {
    G,
    hooks,
    io,
    sheets,
    logs,
    LogSheet,
    cacheMem: mem,
    cacheApi: cache,
    props,
    // one request
    begin(refs) {
      req = { refs: refs || {}, claimed: [], puts: [], deletes: [], mail: [] };
      purgeCache();
    },
    flush() {
      db.tx(() => {
        for (const sh of Object.values(sheets)) sh.flush();
      });
    },
    end() {
      const r = req;
      req = { refs: {}, claimed: [], puts: [], deletes: [], mail: [] };
      return { mail: r.mail, puts: r.puts.filter((k) => pending.has(k)).map((k) => ({ key: k, buf: pending.get(k).buf, mime: pending.get(k).mime })), deletes: r.deletes, claimed: r.claimed };
    },
    stored(key) {
      pending.delete(key);
    },
    dropParsed() {
      parsed.clear();
    },
    reload() {
      loadSheets();
      loadCache();
      loadProps();
      pending.clear();
    },
    fileRow
  };
}
