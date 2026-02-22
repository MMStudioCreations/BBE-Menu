import { setCookie, uuid, verifyPassword } from "../../auth/_utils";
import { adminAuthJson, ensureAdminSessionSchema, ensureAdminUserSchema, getErrorMessage } from "./_helpers";

const attempts = new Map<string, { count: number; firstTs: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function keyFor(request: Request, email: string) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  return `${ip}:${email}`;
}

function blocked(key: string) {
  const row = attempts.get(key);
  if (!row) return false;
  if (Date.now() - row.firstTs > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return row.count >= MAX_ATTEMPTS;
}

function bump(key: string) {
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || now - row.firstTs > WINDOW_MS) {
    attempts.set(key, { count: 1, firstTs: now });
  } else {
    row.count += 1;
    attempts.set(key, row);
  }
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const db = env.DB as D1Database;
    await ensureAdminSessionSchema(db);
    await ensureAdminUserSchema(db);
    const body = await request.json<any>().catch(() => null);
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!email || !password) {
      return adminAuthJson({ ok: false, error: "invalid_credentials" }, 401);
    }

    const rateLimitKey = keyFor(request, email);
    if (blocked(rateLimitKey)) {
      return adminAuthJson({ ok: false, error: "too_many_attempts" }, 429);
    }

    const admin = await db
      .prepare("SELECT id, email, name, password_hash, COALESCE(role, CASE WHEN COALESCE(is_super_admin,0)=1 THEN 'super_admin' ELSE 'admin' END) AS role, COALESCE(is_active, 1) AS is_active, COALESCE(is_super_admin, 0) AS is_super_admin FROM admin_users WHERE lower(email) = lower(?)")
      .bind(email)
      .first<any>();

    if (!admin || Number(admin.is_active) !== 1) {
      bump(rateLimitKey);
      return adminAuthJson({ ok: false, error: "invalid_credentials" }, 401);
    }

    const valid = await verifyPassword(password, String(admin.password_hash || ""));
    if (!valid) {
      bump(rateLimitKey);
      return adminAuthJson({ ok: false, error: "invalid_credentials" }, 401);
    }

    attempts.delete(rateLimitKey);

    const sessionId = uuid();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;
    const userAgent = request.headers.get("user-agent") || null;

    await db
      .prepare("INSERT INTO sessions (id, user_id, admin_user_id, session_type, expires_at, created_at, ip, user_agent) VALUES (?, NULL, ?, 'admin', ?, ?, ?, ?)")
      .bind(sessionId, admin.id, expiresAt, now, ip, userAgent)
      .run();

    await db.prepare("UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, admin.id).run();

    const role = String(admin.role || "admin").toLowerCase() === "staff" ? "staff" : (Number(admin.is_super_admin) === 1 || String(admin.role || "").toLowerCase() === "super_admin" ? "super_admin" : "admin");
    const response = adminAuthJson({ ok: true, data: { admin: { id: admin.id, email: admin.email, name: admin.name, role } } }, 200);
    response.headers.append("set-cookie", setCookie("bb_admin_session", sessionId, 7));
    response.headers.append("set-cookie", setCookie("bbe_admin_session", sessionId, 7));
    response.headers.append("set-cookie", setCookie("bb_session", sessionId, 7));
    return response;
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled login error");
  }
};
