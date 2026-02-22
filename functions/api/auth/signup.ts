import { json, uuid, hashPassword, setCookie } from "./_utils";

export const onRequestPost: PagesFunction = async (context) => {
  try {
    const { request, env } = context;
    const db = env.DB as D1Database;
    if (!db) return json({ error: "DB binding missing (env.DB undefined)" }, 500);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const first_name = String(body.first_name || "").trim();
    const last_name = String(body.last_name || "").trim();
    const phone = String(body.phone || "").trim();
    const dob = String(body.dob || "").trim();

    if (!email || !password) return json({ error: "Email and password required" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) return json({ error: "Email already registered" }, 409);

    const userId = uuid();
    const createdAt = new Date().toISOString();
    const password_hash = await hashPassword(password);

    await db.prepare(
      `INSERT INTO users (id, email, phone, password_hash, first_name, last_name, dob, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, email, phone, password_hash, first_name, last_name, dob, createdAt).run();

    await db.prepare(
      `INSERT INTO user_verification (user_id, status, id_key, selfie_key, id_expiration, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, ?)`
    ).bind(userId, "unverified", createdAt).run();

    const sessionId = uuid();
    const sessionCreatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
    ).bind(sessionId, userId, expiresAt, sessionCreatedAt).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": setCookie("bb_session", sessionId, 7),
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return json({ error: err?.message || String(err) }, 500);
  }
};
