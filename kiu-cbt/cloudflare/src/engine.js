import { createShims, LOG_SHEETS, enc } from './shims.js';
import { createApp } from './app.generated.js';

export function createEngine({ db, tz, operator, mail }) {
  const shims = createShims(db, { tz, operator, mail });
  let app = createApp(shims.G, shims.hooks);
  function run(fn) {
    try {
      return fn();
    } finally {
      shims.flush();
    }
  }
  return {
    shims,
    get app() {
      return app;
    },
    // POST /api — returns the JSON text and the R2 work this request left (puts, deletes, claimed uploads).
    post(text, refs) {
      shims.begin(refs);
      const out = run(() => app.doPost({ postData: { contents: String(text) } }));
      if (out.s.lastIndexOf('{"error"', 0) === 0) shims.dropParsed();
      return Object.assign({ text: out.s }, shims.end());
    },
    // GET /api — first-time setup (?setup=1) and the health check.
    get(params) {
      shims.begin({});
      const out = run(() => app.doGet({ parameter: params || {} }));
      shims.end();
      return { text: out.s, html: !!out.html };
    },
    // A function that is "run from the editor" on Google (runSetup, resetSuperAdmin, makeScansPrivate).
    call(name) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || typeof app[name] !== "function") throw new Error("Unknown function: " + name);
      shims.begin({});
      const r = run(() => app[name]());
      return Object.assign({ result: r === void 0 ? "done" : r, log: shims.logs.slice(-10) }, shims.end());
    },
    // Called only by the Worker (never through /api): the LMS sign-in steps in Code.gs.
    internal(name, arg) {
      if (["ltiConfig_", "ltiNewState_", "ltiTakeState_", "ltiIssue_"].indexOf(name) < 0) throw new Error("Not allowed: " + name);
      shims.begin({});
      const r = run(() => app[name](arg));
      shims.end();
      return r;
    },
    // Every tab and the script properties, in the same format as exportForCloudflare() on Google.
    exportAll() {
      shims.flush();
      const out = { kind: "kiu-cbt-export", at: (/* @__PURE__ */ new Date()).toISOString(), props: shims.G.PropertiesService.getScriptProperties().getProperties(), sheets: {} };
      for (const sh of shims.G.SpreadsheetApp.getActiveSpreadsheet().getSheets()) {
        const v = sh.getLastRow() ? sh.getDataRange().getValues() : [];
        out.sheets[sh.getName()] = v.map((r) => r.map((x) => x instanceof Date ? x.toISOString() : x));
      }
      return out;
    },
    // Replaces everything with an export (from Google or from this server). Media files are not included.
    importAll(data) {
      if (!data || data.kind !== "kiu-cbt-export" || !data.sheets) throw new Error("This is not a KIU CBT export file.");
      db.tx(() => {
        for (const t of ["sheet_meta", "sheet_rows", "log_rows", "cache"]) db.run("DELETE FROM " + t);
        let ord = 0;
        for (const name of Object.keys(data.sheets)) {
          const rows = data.sheets[name] || [], width = rows.reduce((m, r) => Math.max(m, (r || []).length), 0);
          db.run("INSERT INTO sheet_meta (name, max_rows, max_cols, ord) VALUES (?, ?, ?, ?)", name, Math.max(1e3, rows.length + 200), Math.max(26, width), ord++);
          rows.forEach((r, i) => {
            if (!r || !r.some((v) => v !== "" && v !== null && v !== void 0)) return;
            const L = LOG_SHEETS[name];
            if (L) db.run("INSERT INTO log_rows (name, r, k1, k2, v) VALUES (?, ?, ?, ?, ?)", name, i + 1, i ? String(r[L.k1] == null ? "" : r[L.k1]) : null, i && L.k2 >= 0 ? String(r[L.k2] == null ? "" : r[L.k2]) : null, enc(r));
            else db.run("INSERT INTO sheet_rows (name, r, v) VALUES (?, ?, ?)", name, i + 1, enc(r));
          });
        }
        for (const k of Object.keys(data.props || {})) if (data.props[k] !== null && data.props[k] !== void 0 && k !== "SCHEMA_VERSION") db.run("INSERT OR REPLACE INTO props (k, v) VALUES (?, ?)", k, String(data.props[k]));
        db.run("DELETE FROM props WHERE k = 'SCHEMA_VERSION'");
      });
      shims.reload();
      app = createApp(shims.G, shims.hooks);
      const counts = {};
      for (const n of Object.keys(data.sheets)) counts[n] = Math.max(0, (data.sheets[n] || []).length - 1);
      return { ok: true, rows: counts };
    },
    stats() {
      const t = {};
      for (const sh of shims.G.SpreadsheetApp.getActiveSpreadsheet().getSheets()) t[sh.getName()] = Math.max(0, sh.getLastRow() - 1);
      const f = db.all("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM files WHERE folder = 0 AND trashed = 0")[0];
      return { ok: true, rows: t, files: f.n, file_bytes: f.b, cache_entries: shims.cacheMem.size, time_zone: tz || "UTC" };
    }
  };
}
export async function storeMedia(engine, media, r) {
  for (const p of r.puts || []) {
    await media.put(p.key, p.buf, { httpMetadata: { contentType: p.mime || "application/octet-stream" } });
    engine.shims.stored(p.key);
  }
}
export class EngineHost {
  // mailer: async ({ to, subject, text, name }) → { ok, error } (Cloudflare Email Service; a test double in the tests)
  constructor(engine, media, mailer) {
    this.engine = engine;
    this.media = media;
    this.mailer = mailer || null;
  }
  async api(text, refs) {
    const r = this.engine.post(text, refs);
    await storeMedia(this.engine, this.media, r);
    let out = r.text;
    if (r.mail && r.mail.length) out = await this.sendMail(out, r.mail);
    return { text: out, claimed: r.claimed, deletes: r.deletes };
  }
  // Sends the queued messages (8 at a time) and puts each result into the answer in place of "pending".
  async sendMail(text, mail) {
    const done = {};
    const send = this.mailer || (async () => ({ ok: false, error: "Email is not set up yet." }));
    for (let i = 0; i < mail.length; i += 8) {
      await Promise.all(mail.slice(i, i + 8).map(async (m) => {
        try {
          done[m.id] = await send(m);
        } catch (e) {
          done[m.id] = { ok: false, error: String(e && e.message || e) };
        }
      }));
    }
    let o;
    try {
      o = JSON.parse(text);
    } catch (e) {
      return text;
    }
    for (const x of o.results || []) if (x.status === "pending") {
      const s = done[x.pending] || {};
      x.status = s.ok ? "sent" : "failed";
      if (!s.ok) x.reason = s.error || "Not sent.";
      delete x.pending;
    }
    const n = (st) => (o.results || []).filter((x) => x.status === st).length;
    o.sent = n("sent");
    o.failed = n("failed");
    o.pending = 0;
    return JSON.stringify(o);
  }
  async get(params) {
    return this.engine.get(params);
  }
  async call(name) {
    const r = this.engine.call(name);
    await storeMedia(this.engine, this.media, r);
    if (r.deletes && r.deletes.length) await this.media.delete(r.deletes).catch(() => {
    });
    return { ok: true, result: r.result, log: r.log };
  }
  // Exports and imports pass through R2: they can be larger than one message between Worker and engine.
  async exportAll() {
    const key = "exports/kiu-cbt-export-" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + ".json";
    await this.media.put(key, JSON.stringify(this.engine.exportAll()), { httpMetadata: { contentType: "application/json" } });
    return { key };
  }
  async importAll(key) {
    const o = await this.media.get(key);
    if (!o) return { error: "The uploaded file was not found." };
    let data;
    try {
      data = JSON.parse(await o.text());
    } catch (e) {
      return { error: "The file is not valid JSON." };
    }
    try {
      return this.engine.importAll(data);
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }
  async stats() {
    return this.engine.stats();
  }
  async internal(name, arg) {
    return this.engine.internal(name, arg);
  }
  // This tool's own RSA key pair for LTI (made once, kept in the database); only the public half is published.
  async toolJwks() {
    const props = this.engine.shims.G.PropertiesService.getScriptProperties();
    let pub = props.getProperty("LTI_TOOL_PUBLIC_JWK");
    if (!pub) {
      if (!this.making) this.making = (async () => {
        const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
        const kid = "kiu-cbt-" + Date.now().toString(36);
        const p = await crypto.subtle.exportKey("jwk", kp.publicKey), s = await crypto.subtle.exportKey("jwk", kp.privateKey);
        if (!props.getProperty("LTI_TOOL_PUBLIC_JWK")) {
          props.setProperty("LTI_TOOL_PRIVATE_JWK", JSON.stringify(Object.assign(s, { kid, alg: "RS256" })));
          props.setProperty("LTI_TOOL_PUBLIC_JWK", JSON.stringify({ kty: p.kty, n: p.n, e: p.e, alg: "RS256", use: "sig", kid }));
        }
      })();
      await this.making;
      this.making = null;
      pub = props.getProperty("LTI_TOOL_PUBLIC_JWK");
    }
    return { keys: [JSON.parse(pub)] };
  }
};
