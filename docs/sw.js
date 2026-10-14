// Service worker: cache the app shell (and the Supabase client module) so the app opens with no signal.
const CACHE = 'sg-tracker-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './api.js', './store.js', './sg.js', './baselines.js', './config.js', './manifest.json', './icon.svg',
  './vendor/supabase.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co')) return;           // data always goes to the network
  // App shell and CDN modules: network first, fall back to cache; cache every successful response.
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))));
});
