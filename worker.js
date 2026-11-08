// ════════════════════════════════════════════════════════════════════
// YallaMart — Worker kecil untuk PRATINJAU LINK (WhatsApp, Telegram, FB, dll)
//
// Hanya bekerja di alamat  /share?toko=<uid>  dan  /share?p=<id-produk>.
// Semua alamat lain (beranda, gambar, manifest, service worker, assetlinks,
// dll) TIDAK lewat sini — tetap disajikan langsung oleh Cloudflare seperti biasa.
//
// Isi halaman /share = index.html yang SAMA PERSIS, hanya ditambah tag
// Open Graph (judul + foto toko/produk) di <head>. Kalau database lambat/error,
// halaman disajikan apa adanya (pratinjau kembali ke logo) — tidak pernah gagal.
// ════════════════════════════════════════════════════════════════════

const SUPA_URL = 'https://jgnjgfuypcelwjztebsy.supabase.co';
const SUPA_ANON = 'eyJhbGci••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'; // kunci publik (sama dgn yang ada di index.html)
const SITE_NAME = 'YallaMart';
const DEFAULT_IMG = 'https://res.cloudinary.com/dsy4hjc7a/image/upload/w_512,h_512,c_fill,f_png/v1777071286/file_00000000061071f4a2bf027d7ff5df98_gaknb3.png';
const DEFAULT_DESC = 'Marketplace, pesan makanan, & kirim barang untuk mahasiswa Indonesia di Kairo.';
const TIMEOUT_MS = 1500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isShare = url.pathname === '/share' || url.pathname === '/share/';
    if (!isShare || request.method !== 'GET') return env.ASSETS.fetch(request);

    // index.html yang sama dengan beranda
    const pageReq = new Request(new URL('/', url).toString(), { method: 'GET', headers: request.headers });
    let page;
    try { page = await env.ASSETS.fetch(pageReq); } catch (e) { return env.ASSETS.fetch(request); }
    if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;

    let meta = null;
    try { meta = await withTimeout(buildMeta(url), TIMEOUT_MS); } catch (e) { meta = null; }
    if (!meta) return page;

    try {
      const tags = renderTags(meta, url);
      const res = new HTMLRewriter()
        .on('head', { element(el) { el.prepend(tags, { html: true }); } })
        .on('title', { element(el) { el.setInnerContent(meta.title); } })
        .transform(page);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'public, max-age=0, must-revalidate');
      return out;
    } catch (e) {
      return page;
    }
  }
};

async function buildMeta(url) {
  const toko = (url.searchParams.get('toko') || '').trim();
  const pid = (url.searchParams.get('p') || '').trim();
  if (toko && UUID_RE.test(toko)) return storeMeta(toko);
  if (pid && SAFE_ID_RE.test(pid)) return productMeta(pid);
  return null;
}

async function storeMeta(uid) {
  const [u, s] = await Promise.all([
    sb(`/rest/v1/users?uid=eq.${uid}&select=name,photo_url,cover_photo_url,cover_photo&limit=1`),
    sb(`/rest/v1/shops?user_id=eq.${uid}&select=nama_toko,alamat&limit=1`)
  ]);
  const user = (u && u[0]) || null;
  const shop = (s && s[0]) || null;
  if (!user && !shop) return null;
  const name = clean((shop && shop.nama_toko) || (user && user.name) || 'Toko');
  const img = firstUrl(user && user.photo_url, user && user.cover_photo_url, user && user.cover_photo) || DEFAULT_IMG;
  const alamat = clean(shop && shop.alamat);
  return {
    title: `${name} | ${SITE_NAME}`,
    desc: alamat ? `Kunjungi toko ${name} di YallaMart · ${alamat}` : `Kunjungi toko ${name} di YallaMart. ${DEFAULT_DESC}`,
    image: img,
    type: 'profile',
    card: 'summary'
  };
}

async function productMeta(id) {
  const r = await sb(`/rest/v1/ads?id=eq.${encodeURIComponent(id)}&select=title,price,img_url,seller_name&limit=1`);
  const ad = r && r[0];
  if (!ad) return null;
  const title = clean(ad.title || 'Produk');
  const price = Number(ad.price);
  const priceTxt = isFinite(price) && price > 0 ? `LE ${price.toLocaleString('en-EG')}` : '';
  const seller = clean(ad.seller_name);
  const parts = [priceTxt, seller ? `dari ${seller}` : '', 'di YallaMart'].filter(Boolean);
  return {
    title: `${title} | ${SITE_NAME}`,
    desc: parts.join(' · '),
    image: firstUrl(ad.img_url) || DEFAULT_IMG,
    type: 'product',
    card: 'summary_large_image'
  };
}

async function sb(path) {
  const r = await fetch(SUPA_URL + path, {
    headers: { apikey: SUPA_ANON, authorization: 'Bearer ' + SUPA_ANON, accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!r.ok) return null;
  return r.json();
}

function renderTags(m, url) {
  const e = escAttr;
  return [
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${e(m.type)}">`,
    `<meta property="og:title" content="${e(m.title)}">`,
    `<meta property="og:description" content="${e(m.desc)}">`,
    `<meta property="og:image" content="${e(m.image)}">`,
    `<meta property="og:url" content="${e(url.toString())}">`,
    `<meta name="description" content="${e(m.desc)}">`,
    `<meta name="twitter:card" content="${e(m.card)}">`,
    `<meta name="twitter:title" content="${e(m.title)}">`,
    `<meta name="twitter:description" content="${e(m.desc)}">`,
    `<meta name="twitter:image" content="${e(m.image)}">`
  ].join('\n');
}

function firstUrl(...xs) {
  for (const x of xs) { if (typeof x === 'string' && /^https:\/\//i.test(x.trim())) return x.trim(); }
  return '';
}
function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 120); }
function escAttr(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function withTimeout(p, ms) {
  return Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
}
