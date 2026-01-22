export default async (req, context) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const { endpoint = "chat/completions", payload } = await req.json();

    const API_BASE = process.env.API_BASE;
    const API_KEY = process.env.API_KEY;

    if (!API_BASE || !API_KEY) {
      return new Response("Missing API_BASE or API_KEY in environment variables.", { status: 500 });
    }

    // Ensure no double slashes
    const base = API_BASE.replace(/\/+$/, "");
    const path = endpoint.replace(/^\/+/, "");
    const url = `${base}/${path}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload ?? {}),
    });

    const txt = await upstream.text();
    return new Response(txt, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        // Basic CORS (useful for local preview / cross-origin use; same-origin is fine)
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  } catch (e) {
    return new Response(String(e?.stack || e), { status: 500 });
  }
};
