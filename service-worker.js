// ═══════════════════════════════════════════
//  YallaMart Service Worker
//  Notifikasi muncul meski app ditutup
//  + Offline First Cache (App Shell + Gambar)
// ═══════════════════════════════════════════

const CACHE_NAME = 'yallamart-v3';
const IMG_CACHE  = 'yallamart-img-v1';
const CDN_CACHE  = 'yallamart-cdn-v1';

const IMG_DOMAINS = [
  'pub-6965427fe22841f2b1a71e9df9a3522f.r2.dev',
  'res.cloudinary.com'
];

// CDN library (Tailwind, Font Awesome, Lucide, Bootstrap Icons, Supabase-js).
// CATATAN: googletagmanager.com & sentry-cdn.com SENGAJA tidak dimasukkan —
// itu script analytics/monitoring, di luar scope perbaikan ini.
const CDN_DOMAINS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com'
];

const APP_SHELL = ['/', '/index.html'];

// ── Fetch dengan timeout ──────────────────
function fetchWithTimeout(req, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(r => { clearTimeout(timer); resolve(r); })
              .catch(e => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
      .catch(e => console.warn('[SW] install cache error:', e))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== IMG_CACHE && k !== CDN_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // ── Gambar: Cache First + timeout fallback ──
  const isImg = IMG_DOMAINS.some(d => url.hostname.includes(d));
  if (isImg) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached; // cache dulu, tidak perlu network

        try {
          const response = await fetchWithTimeout(req, 4000);
          if (response && response.status === 200) {
            cache.put(req, response.clone());
          }
          return response;
        } catch(e) {
          // Timeout atau offline — return kosong
          return new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // ── CDN Library (Tailwind/FontAwesome/Lucide/jsdelivr): Stale-While-Revalidate.
  // Kasih versi cache dulu (kalau ada) biar instan, TAPI tetap fetch versi baru
  // di background untuk dipakai di reload berikutnya — jadi tidak pernah
  // kepake versi lama selamanya, cuma "1 siklus refresh" ketinggalan paling lambat. ──
  const isCdnLib = CDN_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith('.' + d));
  if (isCdnLib) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async cache => {
        const cached = await cache.match(req);

        const networkFetch = fetchWithTimeout(req, 5000)
          .then(response => {
            if (response && response.status === 200) {
              cache.put(req, response.clone());
            }
            return response;
          })
          .catch(() => cached); // network gagal → fallback ke cache kalau ada

        return cached || networkFetch;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // ── App shell: Cache First untuk performa, network untuk update ──
  event.respondWith(
    caches.match(req).then(cached => {
      // Serve cache dulu (instant)
      const networkFetch = fetchWithTimeout(req, 5000)
        .then(response => {
          if (response && response.status === 200) {
            const toCache = response.clone(); // clone DULUAN, sebelum response dipakai/dibaca
            caches.open(CACHE_NAME).then(cache => cache.put(req, toCache));
          }
          return response;
        }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});

self.addEventListener('push', event => {
  let payload = {};
  if (event.data) {
    try { payload = event.data.json(); }
    catch(e) { payload = { title: 'YallaMart', body: event.data.text() }; }
  }

  const title  = payload.title  || payload.headings?.id || 'YallaMart';
  const body   = payload.body   || payload.contents?.id || 'Kamu mendapat pesan baru.';
  const chatId = payload.chatId || payload.data?.chatId || '';
  const url    = payload.url    || (chatId ? '/?chatId=' + chatId : '/');
  const image  = payload.image  || null;

  const options = {
    body,
    icon    : 'https://res.cloudinary.com/dsy4hjc7a/image/upload/w_192,h_192,c_fill,f_png/v1777071286/file_00000000061071f4a2bf027d7ff5df98_gaknb3.png',
    badge   : 'https://res.cloudinary.com/dsy4hjc7a/image/upload/w_72,h_72,c_fill,f_png/v1777071286/file_00000000061071f4a2bf027d7ff5df98_gaknb3.png',
    vibrate : [200, 100, 200],
    tag     : chatId ? 'chat-' + chatId : 'yallamart-' + Date.now(),
    renotify: true,
    data    : { chatId, url },
    actions : chatId ? [
      { action: 'open',    title: '\uD83D\uDCAC Buka Chat' },
      { action: 'dismiss', title: '\u2715 Tutup' }
    ] : [
      { action: 'open',    title: '\uD83D\uDED2 Lihat Sekarang' },
      { action: 'dismiss', title: '\u2715 Tutup' }
    ]
  };

  if (image) options.image = image;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const chatId = event.notification.data?.chatId || '';
  const url    = event.notification.data?.url    || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        for (const c of list) {
          try {
            if (new URL(c.url).origin === self.location.origin) {
              if (chatId) c.postMessage({ type: 'OPEN_CHAT', chatId });
              return c.focus();
            }
          } catch(e) {}
        }
        return clients.openWindow(self.location.origin + url);
      })
  );
});
