/* Service worker: cache do app e das bibliotecas (CDN) para uso offline no centro cirúrgico. */
const CACHE = 'vetanest-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
const CDN = [
  'https://cdn.tailwindcss.com/3.4.16',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE);
    await Promise.all(CDN.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro para o app (sempre a versão mais nova quando online); cache primeiro para as bibliotecas versionadas.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin) {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else {
    e.respondWith(caches.match(req.url).then(hit => hit || fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req.url, cp)); return r; })));
  }
});
