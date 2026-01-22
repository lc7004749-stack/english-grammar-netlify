// netlify/functions/llm.js
// Netlify Node Function (CommonJS) - 稳定版：兼容两种请求体格式，错误返回 JSON，不再 503

const json = (statusCode, obj) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    // 允许同源/跨源都不阻塞（你的前端在同域一般不需要，但加了更稳）
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

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { error: "Invalid JSON body", detail: String(e) });
    }

    // ✅ 兼容两种前端写法：
    // A) 直接发 OpenAI payload: { model, messages, ... }
    // B) 包一层: { endpoint: "chat/completions", payload: { ... } }
    const endpoint = body.endpoint || "chat/completions";
    const payload = body.payload || body;

    // 基本校验，避免 undefined 直接 throw
    if (!payload || typeof payload !== "object") {
      return json(400, { error: "Missing payload" });
    }

    const url = `${API_BASE.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();

    // 透传上游错误，前端能看到具体原因（而不是 503）
    if (!upstream.ok) {
      return json(upstream.status, {
        error: "Upstream error",
        url,
        status: upstream.status,
        body: safeTruncate(text, 2000),
      });
    }

    // 正常情况：尽量按 JSON 返回
    try {
      const data = JSON.parse(text);
      return json(200, data);
    } catch {
      // 上游不是 JSON，也照样返回
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: text,
      };
    }
  } catch (e) {
    // ✅ 最关键：捕获所有异常，返回 JSON（不让 Netlify 变 503）
    return json(500, { error: "Function crashed", detail: String(e?.stack || e) });
  }
};

function safeTruncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…(truncated)" : s;
}
