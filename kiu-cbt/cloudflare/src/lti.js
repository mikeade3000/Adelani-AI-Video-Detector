var LTI = "https://purl.imsglobal.org/spec/lti/claim/";
var ROLE_LEARNER = /membership#Learner$|^Learner$|institution\/person#Student$|^Student$/;
var ROLE_STAFF = /membership#(Instructor|ContentDeveloper|Administrator|Mentor)$|system\/person#(Administrator|SysAdmin)$|institution\/person#(Instructor|Faculty|Administrator|Staff)$/;
var SKEW_S = 120;
var enc = new TextEncoder();
function b64urlBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}
function rand() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
var esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var norm = (s) => String(s || "").trim().replace(/\/+$/, "");
function page(title, html, status) {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>body{margin:0;background:#056b39;font:18px/1.5 "Times New Roman",serif;color:#10231a}.c{max-width:620px;margin:8vh auto;background:#fff;border-radius:14px;padding:28px 32px;border-top:7px solid #c9a227}h1{margin:0 0 10px;font-size:26px;color:#034a27}a{color:#056b39}</style></head><body><div class="c"><h1>' + esc(title) + "</h1>" + html + "</div></body></html>", { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
var JWKS = /* @__PURE__ */ new Map();
async function platformKey(url, kid) {
  let e = JWKS.get(url);
  const fresh = e && Date.now() - e.at < 6e5;
  let jwk = fresh ? e.keys.find((k) => !kid || k.kid === kid) : null;
  if (!jwk && (!e || Date.now() - e.at > 6e4 || !fresh)) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Could not read the LMS public keys (" + res.status + ") from " + url);
    const body = await res.json();
    e = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
    JWKS.set(url, e);
    jwk = e.keys.find((k) => !kid || k.kid === kid);
  }
  if (!jwk) throw new Error("The LMS signed with a key it does not publish (key ID " + kid + ").");
  return crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
export async function verifyLaunch(token, cfg, nonce, nowMs) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("The LMS sent no valid sign-in token.");
  const header = b64urlJson(parts[0]);
  if (header.alg !== "RS256") throw new Error("Unsupported signature type: " + header.alg);
  const key = await platformKey(cfg.jwks_url, header.kid);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("The sign-in token's signature is not valid.");
  const c = b64urlJson(parts[1]), now = (nowMs || Date.now()) / 1e3;
  if (norm(c.iss) !== norm(cfg.issuer)) throw new Error("The sign-in token comes from another platform (" + c.iss + ").");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (aud.indexOf(cfg.client_id) < 0) throw new Error("The sign-in token is for another tool (client ID).");
  if (aud.length > 1 && c.azp !== cfg.client_id) throw new Error("The sign-in token is for another tool (azp).");
  if (!(c.exp > now - SKEW_S)) throw new Error("The sign-in token has expired. Open the examination again from the LMS.");
  if (c.iat && c.iat > now + SKEW_S) throw new Error("The sign-in token is dated in the future. Check the LMS server clock.");
  if (!nonce || c.nonce !== nonce) throw new Error("The sign-in token does not belong to this sign-in (nonce).");
  const dep = c[LTI + "deployment_id"];
  if (cfg.deployments && cfg.deployments.length && cfg.deployments.indexOf(String(dep)) < 0) throw new Error("This LMS deployment (" + dep + ") is not allowed. Add its deployment ID in Settings \u2192 LMS connection.");
  if (c[LTI + "version"] !== "1.3.0") throw new Error("Unsupported LTI version: " + c[LTI + "version"]);
  if (c[LTI + "message_type"] !== "LtiResourceLinkRequest") throw new Error("Unsupported LTI message: " + c[LTI + "message_type"]);
  return c;
}
export function admissionOf(c) {
  const custom = c[LTI + "custom"] || {}, ext = c[LTI + "ext"] || {}, lis = c[LTI + "lis"] || {};
  for (const v of [custom.admission, custom.admission_number, ext.user_username, lis.person_sourcedid])
    if (v && !/^\$/.test(String(v)) && String(v).trim()) return String(v).trim();
  return "";
}
export async function lti(request, env, stub, path) {
  const url = new URL(request.url), origin = url.origin;
  if (path === "/lti/jwks") return new Response(JSON.stringify(await stub.toolJwks()), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
  const cfg = await stub.internal("ltiConfig_");
  const ready = cfg.enabled && cfg.issuer && cfg.client_id && cfg.jwks_url && cfg.auth_url;
  if (!ready) return page("LMS sign-in is not switched on", '<p>The connection with the LMS is not set up on the examination system yet. The examinations office completes it under <b>Settings \u2192 LMS connection</b>.</p><p>You can still sign in at <a href="' + esc(origin) + '/index.html">' + esc(origin) + "/index.html</a> with your username and password.</p>", 503);
  if (path === "/lti/login") {
    const p = request.method === "POST" ? Object.fromEntries(await request.formData()) : Object.fromEntries(url.searchParams);
    if (norm(p.iss) !== norm(cfg.issuer)) return page("Unknown LMS", "<p>This sign-in request comes from <b>" + esc(p.iss || "(none)") + "</b>, which is not the LMS configured in Settings \u2192 LMS connection (<b>" + esc(cfg.issuer) + "</b>).</p>", 400);
    if (p.client_id && p.client_id !== cfg.client_id) return page("Unknown tool", "<p>The client ID sent by the LMS does not match Settings \u2192 LMS connection.</p>", 400);
    if (!p.login_hint) return page("Sign-in request incomplete", "<p>The LMS did not send a login hint. Open the examination again from the LMS.</p>", 400);
    const nonce = rand();
    const state = await stub.internal("ltiNewState_", { nonce, at: Date.now() });
    const q = new URLSearchParams({
      scope: "openid",
      response_type: "id_token",
      response_mode: "form_post",
      prompt: "none",
      client_id: cfg.client_id,
      redirect_uri: origin + "/lti/launch",
      login_hint: p.login_hint,
      state,
      nonce
    });
    if (p.lti_message_hint) q.set("lti_message_hint", p.lti_message_hint);
    return Response.redirect(cfg.auth_url + (cfg.auth_url.indexOf("?") >= 0 ? "&" : "?") + q.toString(), 302);
  }
  if (path === "/lti/launch") {
    if (request.method !== "POST") return page("Open the examination from the LMS", '<p>This address is used by the LMS. Open the examination from your course page in the LMS, or sign in at <a href="' + esc(origin) + '/index.html">' + esc(origin) + "/index.html</a>.</p>", 405);
    const f = await request.formData();
    if (f.get("error")) return page("The LMS could not sign you in", "<p>" + esc(f.get("error_description") || f.get("error")) + "</p>", 400);
    const st = await stub.internal("ltiTakeState_", String(f.get("state") || ""));
    if (!st) return page("This sign-in has expired", "<p>Open the examination again from the LMS.</p>", 400);
    let c;
    try {
      c = await verifyLaunch(String(f.get("id_token") || ""), cfg, st.nonce);
    } catch (e) {
      return page("The LMS sign-in could not be verified", "<p>" + esc(e.message) + "</p><p>If this keeps happening, ask the examinations office to check Settings \u2192 LMS connection.</p>", 401);
    }
    const roles = (c[LTI + "roles"] || []).map(String);
    if (!roles.some((r2) => ROLE_LEARNER.test(r2)) && roles.some((r2) => ROLE_STAFF.test(r2)))
      return page("Staff: please use the staff portal", '<p>This link signs students in to their examinations. Lecturers and staff use the staff portal: <a href="' + esc(origin) + '/admin.html" target="_blank" rel="noopener">' + esc(origin) + "/admin.html</a>.</p>");
    const ctx = c[LTI + "context"] || {};
    const r = await stub.internal("ltiIssue_", { admission: admissionOf(c), course: ctx.label || "", course_title: ctx.title || "", issuer: c.iss, name: c.name || "" });
    if (!r || r.error) return page("No examination found", "<p>" + esc(r && r.error || "Please contact the examinations office.") + "</p>", 404);
    return Response.redirect(origin + "/index.html#lti=" + r.code, 303);
  }
  return page("Not found", "<p>Unknown LMS address.</p>", 404);
}
