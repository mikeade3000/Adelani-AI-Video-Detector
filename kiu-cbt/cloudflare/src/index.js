import { DurableObject } from "cloudflare:workers";
import { EmailMessage } from "cloudflare:email";
import { createEngine, EngineHost } from "./engine.js";
import { handle } from "./http.js";

function sqliteOf(storage) {
  const sql = storage.sql;
  return {
    all: (q, ...p) => sql.exec(q, ...p).toArray(),
    run: (q, ...p) => {
      sql.exec(q, ...p);
    },
    tx: (fn) => storage.transactionSync(fn)
  };
}
function htmlOf(text) {
  const esc2 = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font:16px/1.5 'Times New Roman',serif;white-space:pre-wrap">` + esc2.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') + "</div>";
}
function b64(s) {
  let out = "";
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(out);
}
function mimeOf(from, name, m) {
  const wrap = (s) => s.replace(/.{1,76}/g, "$&\r\n");
  return [
    "From: =?UTF-8?B?" + b64(name) + "?= <" + from + ">",
    "To: <" + m.to + ">",
    "Subject: =?UTF-8?B?" + b64(m.subject) + "?=",
    "Date: " + (/* @__PURE__ */ new Date()).toUTCString(),
    "Message-ID: <" + crypto.randomUUID() + "@" + from.split("@")[1] + ">",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(m.text))
  ].join("\r\n");
}
function mailerOf(env) {
  const from = String(env.MAIL_FROM || "").trim();
  if (!env.EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) return null;
  let form = null;
  const forms = {
    object: (m) => env.EMAIL.send({ to: m.to, from: { email: from, name: m.name || env.MAIL_NAME || "KIU Examinations" }, subject: m.subject, text: m.text, html: htmlOf(m.text) }),
    plain: (m) => env.EMAIL.send({ to: m.to, from, subject: m.subject, text: m.text, html: htmlOf(m.text) }),
    mime: (m) => env.EMAIL.send(new EmailMessage(from, m.to, mimeOf(from, m.name || env.MAIL_NAME || "KIU Examinations", m)))
  };
  return async (m) => {
    if (form) {
      try {
        await forms[form](m);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
    let first = null;
    for (const f of ["object", "plain", "mime"]) {
      try {
        await forms[f](m);
        form = f;
        return { ok: true };
      } catch (e) {
        if (!first) first = String(e && e.message || e);
      }
    }
    return { ok: false, error: "Cloudflare Email Service refused the message: " + first };
  };
}
export class CbtEngine extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const mailer = mailerOf(env);
      const engine = createEngine({
        db: sqliteOf(ctx.storage),
        tz: env.TIME_ZONE || "Africa/Kampala",
        operator: "maintenance key",
        mail: { ready: !!mailer, from: env.MAIL_FROM || "", reason: env.EMAIL ? 'Set MAIL_FROM in wrangler.toml to an address on a domain added to Cloudflare Email Service (DEPLOY.md, "Email").' : "" }
      });
      this.host = new EngineHost(engine, env.MEDIA, mailer);
    });
  }
  api(text, refs) {
    return this.host.api(text, refs);
  }
  get(params) {
    return this.host.get(params);
  }
  call(name) {
    return this.host.call(name);
  }
  exportAll() {
    return this.host.exportAll();
  }
  importAll(key) {
    return this.host.importAll(key);
  }
  stats() {
    return this.host.stats();
  }
  internal(name, arg) {
    return this.host.internal(name, arg);
  }
  toolJwks() {
    return this.host.toolJwks();
  }
};
export default { fetch: (request, env, ctx) => handle(request, env, ctx) };
