// api/send-wa-notif.js
// Kirim notifikasi WhatsApp via Fonnte (untuk notifikasi order ke seller)

function formatPhone(phone) {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('010') || p.startsWith('011') ||
      p.startsWith('012') || p.startsWith('015')) {
    p = '20' + p;
  }
  return p;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, message } = req.body || {};
  const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

  if (!FONNTE_TOKEN) return res.status(500).json({ error: 'FONNTE_TOKEN tidak terkonfigurasi' });
  if (!phone || !message) return res.status(400).json({ error: 'phone dan message wajib diisi' });

  const formattedPhone = formatPhone(phone);
  if (formattedPhone.length < 10) return res.status(400).json({ error: 'Nomor tidak valid' });

  const formData = new URLSearchParams();
  formData.append('target', formattedPhone);
  formData.append('message', message);
  formData.append('countryCode', '0');

  const fonnteRes = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: {
      'Authorization': FONNTE_TOKEN,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  const fonnteJson = await fonnteRes.json();
  if (!fonnteRes.ok || fonnteJson.status === false) {
    return res.status(500).json({ error: 'Gagal kirim notifikasi WA' });
  }

  return res.status(200).json({ success: true });
}
