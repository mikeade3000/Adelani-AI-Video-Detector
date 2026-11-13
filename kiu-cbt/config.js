/* ===========================================================================
 * KIU CBT — front-end configuration
 * ---------------------------------------------------------------------------
 * Google version: paste the Web App URL of your Apps Script deployment below
 * (Deploy → Manage deployments → Web app URL, ending in /exec).
 * The Cloudflare version needs no change here: cloudflare/tools/build.mjs sets API_URL to "/api".
 * Everything else (duration, recording quality, photo/camera rules…) is set in admin.html → Settings.
 * =========================================================================== */
window.KIU_CONFIG = {
  API_URL: "PASTE_YOUR_WEB_APP_URL_HERE",

  // Fallback only: the save interval is set in admin → Settings → "Load" and sent to every browser.
  SYNC_SECONDS: 30,

  // Spreads synchronised bursts (everyone signing in or auto-submitting at the
  // same second) over a random 0..N second window.
  BURST_SPREAD_SECONDS: 3,

  // Page lock: right-click menu, F12 / developer tools, view source and save page are blocked on every
  // page, and a page is covered while developer tools are open. Set to false only for maintenance.
  PROTECT: true,

  // How often the Live Monitor / Live Proctoring pages refresh (seconds).
  MONITOR_REFRESH_SECONDS: 15,

  // ---- MORE THAN ONE BACKEND (large sittings, e.g. 1,000 candidates at once) ----
  // Each Google account runs at most 30 requests at the same time — Google Workspace included — so a
  // very large sitting is split over several Apps Script copies, each deployed by a DIFFERENT account
  // (e.g. cbt1@kiu.ac.ug, cbt2@kiu.ac.ug …). List them here; this one website then serves them all.
  // Exam links and observer links made in the admin page carry the right backend (?b=<id>).
  // "programmes" (optional): only these programmes are taken when that backend imports the KIU workbook.
  // Leave BACKENDS empty to use API_URL above.
  BACKENDS: [
    // { id: "sci", name: "Faculty of Science",  url: "https://script.google.com/macros/s/AAAA/exec", programmes: ["BSc Computer Science", "BSc Mathematics"] },
    // { id: "edu", name: "Faculty of Education", url: "https://script.google.com/macros/s/BBBB/exec", programmes: ["BEd Arts", "BEd Science"] },
  ]
};
