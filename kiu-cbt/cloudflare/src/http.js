import { Buffer } from 'node:buffer';
import { lti } from './lti.js';

var MEDIA_FIELDS = { photoUpload: "image", recUpload: "data", theoryUpload: "image" };
var MEDIA_PREFIX = { photoUpload: "photo/", recUpload: "rec/", theoryUpload: "scan/" };
var MAX_BODY = 40 * 1024 * 1024;
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Ops-Key" };
function json(text, status) {
  return new Response(text, { status: status || 200, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, CORS) });
}
function busy() {
  return new Response("<html><body>The examination service is busy. Please wait \u2014 retrying.</body></html>", { status: 503, headers: Object.assign({ "Content-Type": "text/html; charset=utf-8", "Retry-After": "2" }, CORS) });
}
async function fillMedia(obj, media) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === "string" && v.lastIndexOf("R2GET:", 0) === 0) {
      const o = await media.get(v.slice(6));
      if (!o) {
        obj[k] = "";
        if (!obj.error && "ok" in obj) {
          obj.ok = false;
          obj.error = "That file is no longer stored.";
        }
      } else obj[k] = Buffer.from(await o.arrayBuffer()).toString("base64");
    } else if (v && typeof v === "object") await fillMedia(v, media);
  }
}
export function engineStub(env) {
  const id = env.ENGINE.idFromName("main");
  return env.ENGINE.get(id, env.LOCATION_HINT ? { locationHint: env.LOCATION_HINT } : void 0);
}
async function callEngine(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e && (e.overloaded || e.retryable) && i < 1) {
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));
        continue;
      }
      if (e && (e.overloaded || e.retryable)) return null;
      throw e;
    }
  }
}
async function api(request, env, ctx, stub) {
  if (request.method === "GET") {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const r2 = await callEngine(() => stub.get(params));
    if (!r2) return busy();
    return new Response(r2.text, { headers: Object.assign({ "Content-Type": r2.html ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store" }, CORS) });
  }
  const len = +(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) return json(JSON.stringify({ error: "That upload is too large." }), 413);
  let text = await request.text();
  if (text.length > MAX_BODY) return json(JSON.stringify({ error: "That upload is too large." }), 413);
  const refs = {}, uploaded = [];
  const m = /"action"\s*:\s*"(photoUpload|recUpload|theoryUpload)"/.exec(text.slice(0, 4096)) || (text.length < 2e5 ? null : /"action"\s*:\s*"(photoUpload|recUpload|theoryUpload)"/.exec(text));
  if (m) {
    let body = null;
    try {
      body = JSON.parse(text);
    } catch (e) {
    }
    const field = body && MEDIA_FIELDS[body.action], val = field && body[field];
    const i = typeof val === "string" && val.lastIndexOf("data:", 0) === 0 ? val.indexOf(";base64,") : -1;
    const mime = i > 5 && i < 300 ? val.slice(5, i).split(";")[0].trim() : "";
    if (/^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
      const buf = Buffer.from(val.slice(i + 8), "base64"), uid = crypto.randomUUID().replace(/-/g, ""), key = MEDIA_PREFIX[body.action] + uid;
      await env.MEDIA.put(key, buf, { httpMetadata: { contentType: mime } });
      refs[uid] = { key, size: buf.length, mime };
      uploaded.push(uid);
      body[field] = "data:" + mime + ";base64,R2REF:" + uid + ":" + buf.length;
      text = JSON.stringify(body);
    }
  }
  let r;
  try {
    r = await callEngine(() => stub.api(text, refs));
  } catch (e) {
    r = null;
  }
  const cleanup = [];
  for (const uid of uploaded) if (!r || (r.claimed || []).indexOf(uid) < 0) cleanup.push(refs[uid].key);
  if (r && r.deletes && r.deletes.length) cleanup.push(...r.deletes);
  if (cleanup.length) {
    const p = env.MEDIA.delete(cleanup).catch(() => {
    });
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
    else await p;
  }
  if (!r) return busy();
  let out = r.text;
  if (out.indexOf('"R2GET:') >= 0) {
    const o = JSON.parse(out);
    await fillMedia(o, env.MEDIA);
    out = JSON.stringify(o);
  }
  return json(out);
}
async function ops(request, env, stub, name) {
  const key = env.OPS_KEY ? String(env.OPS_KEY) : "";
  if (!key) return json(JSON.stringify({ error: "Maintenance is switched off: set the OPS_KEY secret first (see DEPLOY.md)." }), 403);
  const given = request.headers.get("X-Ops-Key") || "";
  let diff = given.length ^ key.length;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i % (given.length || 1));
  if (diff) return json(JSON.stringify({ error: "Wrong maintenance key." }), 403);
  if (request.method !== "POST") return json(JSON.stringify({ error: "Use POST." }), 405);
  switch (name) {
    case "reset-super-admin":
      return json(JSON.stringify(await stub.call("resetSuperAdmin")));
    case "setup":
      return json(JSON.stringify(await stub.call("runSetup")));
    case "stats":
      return json(JSON.stringify(await stub.stats()));
    case "export": {
      const { key: key2 } = await stub.exportAll(), o = await env.MEDIA.get(key2);
      return new Response(o.body, { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="' + key2.slice(8) + '"' } });
    }
    case "import": {
      const key2 = "imports/" + crypto.randomUUID() + ".json";
      await env.MEDIA.put(key2, request.body ? await request.arrayBuffer() : "");
      try {
        return json(JSON.stringify(await stub.importAll(key2)));
      } finally {
        await env.MEDIA.delete(key2).catch(() => {
        });
      }
    }
  }
  return json(JSON.stringify({ error: "Unknown maintenance command." }), 404);
}
export async function handle(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (path === "/api" || path === "/exec") return await api(request, env, ctx, engineStub(env));
    if (path.lastIndexOf("/ops/", 0) === 0) return await ops(request, env, engineStub(env), path.slice(5));
    if (path === "/lti/login" || path === "/lti/launch" || path === "/lti/jwks") return await lti(request, env, engineStub(env), path);
  } catch (e) {
    return json(JSON.stringify({ error: "Server error: " + String(e && e.message || e) }), 500);
  }
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response("Not found", { status: 404 });
}
