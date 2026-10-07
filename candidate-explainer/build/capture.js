// Captures real portal screens (demo mode, fictional candidate) for the explainer video.
// usage: node capture.js <portal index.html> <out dir>
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const [SRC, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

// Demo copy: no backend, one fictional candidate, demo banner hidden.
const CAND = `["ANCSC/2026/001","OKAFOR TEMITOPE AISHA","ANAMBRA STATE CIVIL SERVICE COMMISSION","AWKA",0,72,68,65,70,74,69.8,"CREDIT"]`;
let html = fs.readFileSync(SRC, "utf8")
  .replace(/API_URL:\s*"[^"]*"/, 'API_URL: ""')
  .replace("const DEMO_DATA = [];", `const DEMO_DATA = [${CAND}];`)
  .replace("</style>", "#demoFlag{display:none!important}</style>");
const demoFile = path.join(OUT, "portal-demo.html");
fs.writeFileSync(demoFile, html);
const URL0 = "file://" + demoFile;

const W = 1320, H = 699, DSF = 4 / 3;     // -> 1760 x 932 images
const boxes = {};
const jpg = { type: "jpeg", quality: 88 };

async function box(page, name, sel) {
  const b = await page.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; });
  boxes[name] = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +(v * DSF).toFixed(1)]));
}
async function typeShots(page, sel, text, prefix) {
  await page.click(sel);
  for (let i = 1; i <= text.length; i++) {
    await page.locator(sel).fill(text.slice(0, i));
    await page.screenshot({ path: `${OUT}/${prefix}_${String(i).padStart(2, "0")}.jpg`, ...jpg });
  }
}

(async () => {
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, colorScheme: "light" });
  // cdnjs is unreachable from the build box: serve the same qrcodejs 1.0.0 from a local copy
  const qr = r => process.env.QR_LIB ? r.fulfill({ path: process.env.QR_LIB, contentType: "application/javascript" }) : r.continue();
  await ctx.route("**/qrcodejs/**", qr);
  await ctx.addInitScript(() => { window.confirm = () => true; window.print = () => {}; });
  const page = await ctx.newPage();
  await page.goto(URL0 + "#print");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/p_empty.jpg`, ...jpg });
  for (const [n, s] of [["tabPrint", 'nav.tabs a[data-page="print"]'], ["tabVerify", 'nav.tabs a[data-page="verify"]'], ["tabHelp", 'nav.tabs a[data-page="help"]'],
    ["regInput", "#regInput"], ["surnameInput", "#surnameInput"], ["lookupBtn", "#lookupBtn"], ["steps", "ol.steps"], ["notice", ".notice.info"]]) await box(page, n, s);

  // Error states (cropped) for troubleshooting scene
  await page.fill("#regInput", "ANCSC/2026/999"); await page.fill("#surnameInput", "Okafor"); await page.click("#lookupBtn");
  await page.waitForSelector("#lookupMsg .notice"); await page.locator("#lookupMsg .notice").screenshot({ path: `${OUT}/err_notfound.png` });
  await page.fill("#regInput", "ANCSC/2026/001"); await page.fill("#surnameInput", "Johnson"); await page.click("#lookupBtn");
  await page.waitForTimeout(200); await page.locator("#lookupMsg .notice").screenshot({ path: `${OUT}/err_name.png` });
  await page.goto(URL0 + "?r=1#print"); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);

  await typeShots(page, "#regInput", "ancsc/2026/001", "p_reg");
  await typeShots(page, "#surnameInput", "Okafor", "p_sur");
  await page.click("#lookupBtn");
  await page.waitForSelector("#resultBlock:not([hidden])");
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(900);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/p_result_full.jpg`, fullPage: true, ...jpg });
  for (const [n, s] of [["msg", "#lookupMsg .notice"], ["facts", "#facts"], ["uses", "#usesDots"], ["printBtn", "#printBtn"], ["stage", "#stage"], ["regInputR", "#regInput"]]) await box(page, n, s);

  await page.click("#printBtn");
  await page.waitForSelector("#lookupMsg .notice.ok >> text=issued");
  await page.waitForTimeout(400); await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/p_issued_full.jpg`, fullPage: true, ...jpg });
  for (const [n, s] of [["msgI", "#lookupMsg .notice"], ["usesI", "#usesDots"]]) await box(page, n, s);
  const certNo = (await page.locator("#lookupMsg .notice").innerText()).match(/PSE26-\w{4}-\w{4}/)[0];

  // Printed certificate, as it comes out of the printer (print media)
  await page.emulateMedia({ media: "print" }); await page.waitForTimeout(300);
  await page.locator("#printRoot .cert").screenshot({ path: `${OUT}/cert_print.png` });
  await page.emulateMedia({ media: "screen" });

  // Verify tab
  await page.goto(URL0 + "#verify"); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/v_empty.jpg`, ...jpg });
  for (const [n, s] of [["certInput", "#certInput"], ["verifyBtn", "#verifyBtn"]]) await box(page, n, s);
  await typeShots(page, "#certInput", certNo, "v_cert");
  await page.click("#verifyBtn");
  await page.waitForSelector(".verify-badge"); await page.waitForTimeout(300); await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/v_result_full.jpg`, fullPage: true, ...jpg });
  await box(page, "badge", ".verify-badge");

  // Help tab
  await page.goto(URL0 + "#help"); await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/help.jpg`, ...jpg });

  // Phone: verifying by QR (opens ?v=CERT)
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.route("**/qrcodejs/**", qr);
  await phone.addInitScript(([k, v]) => localStorage.setItem(k, v), ["ascon_pse26_demo_prints", await page.evaluate(() => localStorage.getItem("ascon_pse26_demo_prints"))]);
  const mp = await phone.newPage(); await mp.goto(URL0 + "?v=" + certNo);
  await mp.waitForSelector(".verify-badge"); await mp.evaluate(() => document.fonts.ready); await mp.waitForTimeout(300);
  await mp.evaluate(() => document.querySelector("#verifyOut").scrollIntoView({ block: "start" }) || scrollBy(0, -90));
  await mp.screenshot({ path: `${OUT}/phone_verify.jpg`, ...jpg });

  fs.writeFileSync(`${OUT}/boxes.json`, JSON.stringify({ size: [W * DSF, Math.round(H * DSF)], certNo, boxes }, null, 1));
  await browser.close();
  console.log("done", certNo);
})().catch(e => { console.error(e); process.exit(1); });
