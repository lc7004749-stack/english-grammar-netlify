export default async (req, context) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json();
    const { text, model, voice, format } = body || {};

    const API_BASE = process.env.API_BASE;
    const API_KEY = process.env.API_KEY;

    if (!API_BASE || !API_KEY) {
      return new Response("Missing API_BASE or API_KEY in environment variables.", { status: 500 });
    }
    if (!text) {
      return new Response("Missing 'text' in request body.", { status: 400 });
    }

    const base = API_BASE.replace(/\/+$/, "");
    const url = `${base}/audio/speech`;

    const payload = {
      model: model || process.env.TTS_MODEL || "gpt-4o-mini-tts",
      voice: voice || process.env.TTS_VOICE || "alloy",
      input: text,
      format: format || "mp3",
    };

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errTxt = await upstream.text();
      return new Response(errTxt, { status: upstream.status, headers: { "Content-Type": "text/plain" } });
    }

    const arrayBuf = await upstream.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString("base64");

    return new Response(JSON.stringify({ audio_base64: b64, format: payload.format }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  } catch (e) {
    return new Response(String(e?.stack || e), { status: 500 });
  }
};
