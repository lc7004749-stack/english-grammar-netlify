// netlify/functions/tts.js
const json = (statusCode, obj) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

    const API_BASE = process.env.API_BASE;
    const API_KEY = process.env.API_KEY;

    if (!API_BASE || !API_KEY) {
      return json(500, {
        error: "Missing env vars",
        need: ["API_BASE", "API_KEY"],
        got: { API_BASE: !!API_BASE, API_KEY: !!API_KEY },
      });
    }

    const body = JSON.parse(event.body || "{}");
    const text = (body.text || "").toString().trim();
    if (!text) return json(400, { error: "Missing text" });

    // 如果你的中转不支持 /audio/speech，这里会返回上游错误（前端能看到原因）
    const url = `${API_BASE.replace(/\/$/, "")}/audio/speech`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.TTS_VOICE || "alloy",
        input: text.slice(0, 2000),
        format: "mp3",
      }),
    });

    const buf = Buffer.from(await upstream.arrayBuffer());

    if (!upstream.ok) {
      return json(upstream.status, {
        error: "Upstream TTS error",
        status: upstream.status,
        body: safeTruncate(buf.toString("utf8"), 2000),
      });
    }

    return json(200, { audio_base64: buf.toString("base64") });
  } catch (e) {
    return json(500, { error: "Function crashed", detail: String(e?.stack || e) });
  }
};

function safeTruncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…(truncated)" : s;
}
