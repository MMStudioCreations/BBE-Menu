import { json, uuid, verifyPassword, setCookie } from "./_utils";

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

    if (!email || !password) return json({ error: "Email and password required" }, 400);

    const user = await db.prepare(
      "SELECT id, password_hash, COALESCE(is_active, 1) AS is_active FROM users WHERE email = ?"
    ).bind(email).first<any>();

    if (!user) return json({ error: "Invalid credentials" }, 401);

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return json({ error: "Invalid credentials" }, 401);
    if (Number(user.is_active) === 0) return json({ ok: false, error: "account_deactivated" }, 403);

    const sessionId = uuid();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
    ).bind(sessionId, user.id, expiresAt, createdAt).run();

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
