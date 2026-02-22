import { json, setCookie, uuid, verifyPassword } from "../../auth/_utils";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  const body = await request.json<any>().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!email || !password) return json({ ok: false, error: "invalid_payload" }, 400);

  const admin = await db
    .prepare("SELECT id, email, name, role, password_hash, is_active FROM admin_users WHERE lower(email) = lower(?)")
    .bind(email)
    .first<any>();

  if (!admin || Number(admin.is_active) !== 1) return json({ ok: false, error: "invalid_credentials" }, 401);
  const valid = await verifyPassword(password, String(admin.password_hash || ""));
  if (!valid) return json({ ok: false, error: "invalid_credentials" }, 401);

  const sessionId = uuid();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, admin_user_id, session_type, expires_at, created_at) VALUES (?, NULL, ?, 'admin', ?, ?)")
    .bind(sessionId, admin.id, expiresAt, now)
    .run();

  await db.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").bind(now, admin.id).run();

  return new Response(JSON.stringify({ ok: true, admin: { email: admin.email, name: admin.name, role: admin.role } }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": setCookie("bb_session", sessionId, 7),
    },
  });
};
