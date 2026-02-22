import { getCookie, hashPassword, json, setCookie, uuid } from "../auth/_utils";
import { ensureAdminSessionSchema, ensureAdminUserSchema } from "./auth/_helpers";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const username = String(body?.username || "").trim();
  const secret = String(body?.secret || "");
  if (!username || !secret) {
    return json({ ok: false, error: "username and secret are required" }, 400);
  }

  const expectedUsername = String(env.ADMIN_USERNAME || "admin").trim();
  const expectedSecret = String(env.ADMIN_SECRET || "");
  if (!expectedSecret) {
    return json({ ok: false, error: "Admin auth is not configured" }, 500);
  }

  if (username !== expectedUsername || secret !== expectedSecret) {
    return json({ ok: false, error: "Invalid credentials" }, 401);
  }

  await ensureAdminSessionSchema(db);
  await ensureAdminUserSchema(db);

  const now = new Date().toISOString();
  const sessionDays = Math.max(1, Number(env.ADMIN_SESSION_DAYS || 14) || 14);
  const expiresAt = new Date(Date.now() + sessionDays * 86400000).toISOString();

  const canonicalEmail = username.includes("@") ? username.toLowerCase() : `${username.toLowerCase()}@admin.local`;
  const existing = await db
    .prepare("SELECT id FROM admin_users WHERE lower(email) = lower(?)")
    .bind(canonicalEmail)
    .first<{ id: string }>();

  let adminId = existing?.id;
  if (!adminId) {
    adminId = uuid();
    const passwordHash = await hashPassword(secret);
    await db
      .prepare("INSERT INTO admin_users (id, email, name, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)")
      .bind(adminId, canonicalEmail, username, passwordHash, now, now)
      .run();
  } else {
    await db
      .prepare("UPDATE admin_users SET name = COALESCE(NULLIF(name, ''), ?), updated_at = ? WHERE id = ?")
      .bind(username, now, adminId)
      .run();
  }

  const priorSessionId =
    getCookie(request, "admin_session") ||
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "bbe_admin_session") ||
    getCookie(request, "bb_session");
  if (priorSessionId) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(priorSessionId).run();
  }

  const sessionId = uuid();
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;
  const userAgent = request.headers.get("user-agent") || null;

  await db
    .prepare("INSERT INTO sessions (id, user_id, admin_user_id, session_type, expires_at, created_at, ip, user_agent) VALUES (?, NULL, ?, 'admin', ?, ?, ?, ?)")
    .bind(sessionId, adminId, expiresAt, now, ip, userAgent)
    .run();

  const response = json({ ok: true, admin: { username, role: "admin" } }, 200);
  response.headers.append("set-cookie", setCookie("admin_session", sessionId, sessionDays));
  response.headers.append("set-cookie", setCookie("bb_admin_session", sessionId, sessionDays));
  response.headers.append("set-cookie", setCookie("bbe_admin_session", sessionId, sessionDays));
  response.headers.append("set-cookie", setCookie("bb_session", sessionId, sessionDays));
  return response;
};
