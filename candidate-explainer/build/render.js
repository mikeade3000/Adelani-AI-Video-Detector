// Renders stage.html frame by frame: node render.js <render dir> <frames dir> <fps> <worker> <workers>
const { chromium } = require("playwright");
const fs = require("fs");
const [DIR, OUT, FPS, WK, NW] = process.argv.slice(2); const fps = +FPS, wk = +WK, nw = +NW;
(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on("pageerror", e => console.error("PAGEERR", e.message));
  await p.goto("file://" + DIR + "/stage.html"); await p.evaluate(() => window.ready);
  const dur = await p.evaluate(() => window.DURATION);
  if (wk === 0) fs.writeFileSync(DIR + "/sfx.json", JSON.stringify(await p.evaluate(() => window.SFX)));
  const n = Math.ceil(dur * fps), per = Math.ceil(n / nw), a = wk * per, z = Math.min(n, a + per);
  const cdp = await p.context().newCDPSession(p);
  for (let i = a; i < z; i++) {
    const f = `${OUT}/f${String(i).padStart(6, "0")}.jpg`;
    if (fs.existsSync(f)) continue;
    await p.evaluate(t => window.render(t), i / fps);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
    fs.writeFileSync(f, Buffer.from(data, "base64"));
    if (i % 500 === 0) console.log(`worker ${wk}: frame ${i}/${z}`);
  }
  await b.close();
})();
