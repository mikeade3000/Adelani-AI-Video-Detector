// Quick stills of the stage at given times: node snap.js <render dir> <out dir> t1 t2 ...
const { chromium } = require("playwright");
const [DIR, OUT, ...ts] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on("pageerror", e => console.error("PAGEERR", e.message));
  await p.goto("file://" + DIR + "/stage.html"); await p.evaluate(() => window.ready);
  for (const t of ts) { await p.evaluate(t => window.render(t), +t); await p.screenshot({ path: `${OUT}/snap_${t}.jpg`, type: "jpeg", quality: 70 }); }
  await b.close();
})();
