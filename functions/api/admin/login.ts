import { clearCookie, getCookie, json, setCookie, uuid, verifyPassword } from "../auth/_utils";
import { authorizeAdminUser } from "./_admin_authz";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const email = String(body?.email || body?.username || "").trim().toLowerCase();
  const password = String(body?.password || body?.secret || "");
  if (!email || !password) {
    return json({ ok: false, error: "Email and password required" }, 400);
  }

  const user = await db
    .prepare("SELECT id, email, password_hash, COALESCE(is_active, 1) AS is_active FROM users WHERE lower(email) = lower(?)")
    .bind(email)
    .first<any>();

  if (!user) return json({ ok: false, error: "Invalid credentials" }, 401);

  const validPassword = await verifyPassword(password, String(user.password_hash || ""));
  if (!validPassword) return json({ ok: false, error: "Invalid credentials" }, 401);
  if (Number(user.is_active) === 0) return json({ ok: false, error: "account_deactivated" }, 403);

  const authz = await authorizeAdminUser(user, db, env);
  if (!authz.authorized) {
    const response = json({ ok: false, error: "Not authorized for admin" }, 403);
    response.headers.append("set-cookie", clearCookie("bb_session"));
    response.headers.append("set-cookie", clearCookie("admin_session"));
    response.headers.append("set-cookie", clearCookie("bb_admin_session"));
    response.headers.append("set-cookie", clearCookie("bbe_admin_session"));
    return response;
  }

  const priorSessionId =
    getCookie(request, "bb_session") ||
    getCookie(request, "admin_session") ||
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "bbe_admin_session");
  if (priorSessionId) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(priorSessionId).run();
  }

  const sessionId = uuid();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(sessionId, user.id, expiresAt, createdAt)
    .run();

  const response = json({ ok: true, admin: { email: String(user.email || email), role: authz.role || "admin" } }, 200);
  response.headers.append("set-cookie", setCookie("bb_session", sessionId, 7));
  return response;
};
