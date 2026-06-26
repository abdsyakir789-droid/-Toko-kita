// worker.js
// ── Berdasarkan source asli yallamart-upload (ditarik dari Cloudflare) ──
// Perubahan 1: setelah upload foto folder "ads" sukses, kirim message ke
// Queue agar thumbnail kecil dibuat di background.
// Perubahan 2: endpoint baru /broadcast-enqueue buat antrian fan-out push
// notification broadcast (dipanggil dari sendBroadcast() di index.html).

import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon/workerd";

const THUMB_WIDTH = 300;   // lebar target thumbnail (px)
const THUMB_QUALITY = 75;  // kualitas JPEG thumbnail

// Sama persis dengan yang sudah dipakai di index.html (sendPushToUser),
// service_role JWT ini sudah publik di source client, jadi aman dipakai di sini.
const QUICK_RESPONDER_URL = "https://jgnjgfuypcelwjztebsy.supabase.co/functions/v1/quick-responder";
const QUICK_RESPONDER_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnbmpnZnV5cGNlbHdqenRlYnN5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzMwNTQyOSwiZXhwIjoyMDkyODgxNDI5fQ.xRvytPczKgu_gC4_8V4RJnA0cqcuh38F7BSOc90wi60";

// Ubah "ads/171234-abc.jpg" → "ads/171234-abc_thumb.jpg"
function toThumbKey(key) {
  const lastDot = key.lastIndexOf(".");
  if (lastDot === -1) return key + "_thumb";
  return key.slice(0, lastDot) + "_thumb" + key.slice(lastDot);
}

async function pushToOneUser(userId, title, body, url) {
  try {
    await fetch(QUICK_RESPONDER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + QUICK_RESPONDER_TOKEN,
      },
      body: JSON.stringify({ user_id: userId, title, body, url: url || "/" }),
    });
  } catch (e) {
    console.warn("[broadcast push]", userId, e.message);
  }
}

// Logic hapus key dari R2, dipakai bareng oleh DELETE (dari client) dan
// POST /delete-batch (dipanggil dari Supabase cron job via pg_net).
async function deleteKeysFromR2(env, body) {
  let keys = Array.isArray(body.keys) ? body.keys.slice() : [];
  if (Array.isArray(body.urls)) {
    for (const u of body.urls) {
      try {
        const parsed = new URL(u);
        if (
          parsed.hostname === "yallamart-upload.abdsyakir789.workers.dev" ||
          parsed.hostname.includes("pub-6965427fe22841f2b1a71e9df9a3522f.r2.dev")
        ) {
          const key = parsed.pathname.replace(/^\/+/, "");
          if (key) keys.push(key);
        }
      } catch (_e) {}
    }
  }
  keys = keys.filter((k) => typeof k === "string" && k.length > 0 && !k.includes(".."));
  if (!keys.length) return { error: "No valid keys provided", status: 400 };

  // Hapus juga thumbnail terkait (kalau ada) — aman walau belum sempat dibuat.
  const thumbKeys = keys.map(toThumbKey);
  await env.R2_BUCKET.delete([...keys, ...thumbKeys]);
  return { deleted: keys, count: keys.length };
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    // ── Endpoint baru: enqueue 1 kelompok user_id buat broadcast push ──
    if (request.method === "POST" && url.pathname === "/broadcast-enqueue") {
      const authToken = request.headers.get("X-Auth-Token");
      if (authToken !== env.AUTH_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      try {
        const payload = await request.json();
        const userIds = Array.isArray(payload.user_ids) ? payload.user_ids : [];
        if (!userIds.length) {
          return new Response(JSON.stringify({ error: "No user_ids provided" }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        await env.BROADCAST_QUEUE.send({
          user_ids: userIds,
          title: payload.title || "",
          body: payload.body || "",
          url: payload.url || "/",
        });
        return new Response(JSON.stringify({ queued: userIds.length }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // ── Endpoint baru: hapus banyak file R2 via POST (dipanggil dari Supabase
    // cron job lewat pg_net — pg_net cuma reliable buat POST dengan body JSON,
    // makanya dibikin terpisah dari DELETE yang dipakai client). ──
    if (request.method === "POST" && url.pathname === "/delete-batch") {
      const authToken = request.headers.get("X-Auth-Token");
      if (authToken !== env.AUTH_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      try {
        const body = await request.json();
        const result = await deleteKeysFromR2(env, body);
        return new Response(JSON.stringify(result), {
          status: result.status || 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    if (request.method === "POST") {
      const authToken = request.headers.get("X-Auth-Token");
      if (authToken !== env.AUTH_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file) {
          return new Response(JSON.stringify({ error: "No file" }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        const folder = formData.get("folder") || "ads";
        const ext = (file.name || "photo.jpg").split(".").pop();
        const key =
          folder + "/" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;

        await env.R2_BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type || "image/jpeg" },
        });

        const fileUrl = "https://yallamart-upload.abdsyakir789.workers.dev/" + key;

        // ── Queue: generate thumbnail di background, khusus folder ads ──
        // Non-blocking: kalau gagal kirim ke queue, upload tetap dianggap sukses.
        if (folder === "ads" && env.IMG_QUEUE) {
          try {
            await env.IMG_QUEUE.send({ key });
          } catch (qErr) {
            console.warn("[queue send]", qErr.message);
          }
        }

        return new Response(JSON.stringify({ url: fileUrl, key }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    if (request.method === "DELETE") {
      const authToken = request.headers.get("X-Auth-Token");
      if (authToken !== env.AUTH_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      try {
        const body = await request.json();
        const result = await deleteKeysFromR2(env, body);
        return new Response(JSON.stringify(result), {
          status: result.status || 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    if (request.method === "GET") {
      const key = url.pathname.slice(1);
      if (!key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_BUCKET.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
          "Cache-Control": "public, max-age=31536000",
          ...cors,
        },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  },

  // ── Queue consumer: dipakai 2 queue berbeda, dibedain lewat batch.queue ──
  async queue(batch, env) {
    // Broadcast push fan-out
    if (batch.queue === "yallamart-broadcast-queue") {
      for (const message of batch.messages) {
        try {
          const { user_ids, title, body, url: pushUrl } = message.body;
          if (!Array.isArray(user_ids) || !user_ids.length) { message.ack(); continue; }
          await Promise.allSettled(
            user_ids.map((uid) => pushToOneUser(uid, title, body, pushUrl))
          );
          message.ack();
        } catch (e) {
          console.error("[broadcast queue consumer]", e.message);
          message.retry();
        }
      }
      return;
    }

    // Thumbnail generation (queue default: yallamart-img-queue)
    for (const message of batch.messages) {
      try {
        const { key } = message.body;
        if (!key) { message.ack(); continue; }

        const thumbKey = toThumbKey(key);

        // Skip kalau thumbnail sudah pernah dibuat (mis. retry setelah sukses sebagian)
        const already = await env.R2_BUCKET.head(thumbKey);
        if (already) { message.ack(); continue; }

        const original = await env.R2_BUCKET.get(key);
        if (!original) { message.ack(); continue; } // file sudah dihapus, skip

        const inputBytes = new Uint8Array(await original.arrayBuffer());
        const inputImage = PhotonImage.new_from_byteslice(inputBytes);

        const scale = Math.min(1, THUMB_WIDTH / inputImage.get_width());
        const targetW = Math.round(inputImage.get_width() * scale);
        const targetH = Math.round(inputImage.get_height() * scale);

        const outputImage = resize(inputImage, targetW, targetH, SamplingFilter.Triangle);
        const outputBytes = outputImage.get_bytes_jpeg(THUMB_QUALITY);

        await env.R2_BUCKET.put(thumbKey, outputBytes, {
          httpMetadata: { contentType: "image/jpeg" },
        });

        inputImage.free();
        outputImage.free();

        message.ack();
      } catch (e) {
        console.error("[queue consumer]", e.message);
        message.retry();
      }
    }
  },
};
