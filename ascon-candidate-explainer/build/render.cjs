// Render explainer.html into video frames with headless Chromium.
//
//   node build/render.cjs stills <outdir> <t1> <t2> ...      PNG previews at given seconds
//   node build/render.cjs video  <out.mp4> [fps] [workers]    full silent video (+ build/out/cues.json)
//
// Needs Playwright (NODE_PATH=$(npm root -g)) and ffmpeg on PATH.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'explainer.html') + '?render';

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // Offline render: the Google Fonts request is skipped, the locally installed Inter is used.
  await page.route(/^https?:/, (r) => r.abort());
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exit(1); });
  await page.goto(URL);
  await page.waitForFunction(() => window.seek && document.fonts.status === 'loaded');
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  return page;
}

async function stills(outDir, times) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await openPage(browser);
  for (const t of times) {
    await page.evaluate((t) => window.seek(t), +t);
    await page.screenshot({ path: path.join(outDir, `t${String(t).padStart(6, '0')}.png`) });
  }
  await browser.close();
}

function encoder(file, fps) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error('ffmpeg ' + c)) : res())));
  return { ff, done };
}

async function renderRange(browser, file, fps, f0, f1, label) {
  const page = await openPage(browser);
  const { ff, done } = encoder(file, fps);
  for (let f = f0; f < f1; f++) {
    await page.evaluate((t) => window.seek(t), f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - f0) % 250 === 0) console.log(`[${label}] frame ${f - f0}/${f1 - f0}`);
  }
  ff.stdin.end();
  await done;
  await page.close();
}

async function video(out, fps, workers) {
  const outDir = path.join(ROOT, 'build', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const probe = await openPage(browser);
  const { total, cues } = await probe.evaluate(() => ({ total: window.TOTAL, cues: window.CUES }));
  await probe.close();
  fs.writeFileSync(path.join(outDir, 'cues.json'), JSON.stringify({ total, cues }));

  const frames = Math.ceil(total * fps);
  const per = Math.ceil(frames / workers);
  const parts = [];
  const jobs = [];
  for (let w = 0; w < workers; w++) {
    const f0 = w * per, f1 = Math.min(frames, f0 + per);
    if (f0 >= f1) break;
    const part = path.join(outDir, `part${w}.mp4`);
    parts.push(part);
    jobs.push(renderRange(browser, part, fps, f0, f1, 'w' + w));
  }
  await Promise.all(jobs);
  await browser.close();
  const list = path.join(outDir, 'parts.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'inherit' })
    .on('close', (c) => (c ? rej(new Error('concat ' + c)) : res())));
  console.log('wrote', out, frames, 'frames');
}

const [mode, a, ...rest] = process.argv.slice(2);
(mode === 'stills' ? stills(a, rest) : video(a, +(rest[0] || 30), +(rest[1] || 4))).catch((e) => { console.error(e); process.exit(1); });
