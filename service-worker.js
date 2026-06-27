// ═══════════════════════════════════════════
//  YallaMart Service Worker
//  Notifikasi muncul meski app ditutup
//  + Offline First Cache (App Shell + Gambar)
// ═══════════════════════════════════════════

const CACHE_NAME = 'yallamart-v3';
const IMG_CACHE  = 'yallamart-img-v2'; // v2: stale-while-revalidate + max entries
const CDN_CACHE  = 'yallamart-cdn-v1';

const IMG_DOMAINS = [
  'pub-6965427fe22841f2b1a71e9df9a3522f.r2.dev',
  'res.cloudinary.com'
];

const CDN_DOMAINS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com'
];

const APP_SHELL = ['/', '/index.html'];
const IMG_CACHE_MAX = 120; // maksimal gambar yang di-cache

// ── Fetch dengan timeout ──────────────────
function fetchWithTimeout(req, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(r => { clearTimeout(timer); resolve(r); })
              .catch(e => { clearTimeout(timer); reject(e); });
  });
}

// ── Hapus cache gambar lama jika melebihi batas ──
async function trimImgCache() {
  try {
    const cache = await caches.open(IMG_CACHE);
    const keys = await cache.keys();
    if (keys.length > IMG_CACHE_MAX) {
      // Hapus yang paling lama (FIFO)
      const toDelete = keys.slice(0, keys.length - IMG_CACHE_MAX);
      await Promise.all(toDelete.map(k => cache.delete(k)));
    }
  } catch(e) {}
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

  // ── Gambar: Stale-While-Revalidate ──
  // Return cache DULU (instant, gambar tidak hilang saat refresh)
  // lalu update cache di background untuk request berikutnya
  const isImg = IMG_DOMAINS.some(d => url.hostname.includes(d));
  if (isImg) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async cache => {
        const cached = await cache.match(req);

        // Fetch network di background (update cache)
        const networkFetch = fetchWithTimeout(req, 5000)
          .then(response => {
            if (response && response.status === 200) {
              cache.put(req, response.clone());
              // Trim cache kalau sudah terlalu banyak (fire & forget)
              trimImgCache();
            }
            return response;
          })
          .catch(() => cached || new Response('', { status: 408 }));

        // Return cache dulu kalau ada (stale-while-revalidate)
        // Kalau belum ada di cache, tunggu network
        return cached || networkFetch;
      })
    );
    return;
  }

  // ── CDN Library: Stale-While-Revalidate ──
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
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // ── App shell: Cache First ──
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetchWithTimeout(req, 5000)
        .then(response => {
          if (response && response.status === 200) {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, toCache));
          }
          return response;
        }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});

// ══════════════════════════════════════════
// PUSH NOTIFICATION — tidak diubah
// ══════════════════════════════════════════

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
