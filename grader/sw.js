/*
 * Offline support: cache the app shell and the bundled OCR engine/model on
 * first visit, then serve them from the cache (network first for the app's
 * own HTML/JS so updates arrive when online).
 */
const CACHE = 'hwgrader-v3';
const SHELL = [
  './', 'index.html', 'css/app.css', 'icon.svg', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/words.js', 'js/scoring.js', 'js/stats.js', 'js/preprocess.js', 'js/ocr.js', 'js/store.js', 'js/evaluation.js', 'js/app.js',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/anthropic/anthropic-sdk.min.js'
];
// Large files: cached on first use rather than at install time.
const LAZY = /vendor\/(tesseract-core|lang)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(url.host);
  if (!sameOrigin && !cdn) return; // e.g. OCR.space API: never cached
  const cacheFirst = cdn || LAZY.test(url.pathname) || /vendor\//.test(url.pathname);
  if (cacheFirst) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  } else {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
  }
});
