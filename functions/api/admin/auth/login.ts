import { setCookie, uuid, verifyPassword } from "../../auth/_utils";
import { adminAuthJson, getErrorMessage } from "./_helpers";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const db = env.DB as D1Database;
    const body = await request.json<any>().catch(() => null);
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!email || !password) {
      return adminAuthJson({ ok: false, error: "invalid_payload" }, 400, "validate", "invalid_payload", "Email and password are required");
    }

    const admin = await db
      .prepare("SELECT id, email, name, role, password_hash, is_active FROM admin_users WHERE lower(email) = lower(?)")
      .bind(email)
      .first<any>();

    if (!admin || Number(admin.is_active) !== 1) {
      return adminAuthJson({ ok: false, error: "invalid_credentials" }, 401, "lookup_admin", "invalid_credentials", "Invalid email/password");
    }

    const valid = await verifyPassword(password, String(admin.password_hash || ""));
    if (!valid) {
      return adminAuthJson({ ok: false, error: "invalid_credentials" }, 401, "verify_password", "invalid_credentials", "Invalid email/password");
    }

    const sessionId = uuid();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    await db
      .prepare("INSERT INTO sessions (id, user_id, admin_user_id, session_type, expires_at, created_at) VALUES (?, NULL, ?, 'admin', ?, ?)")
      .bind(sessionId, admin.id, expiresAt, now)
      .run();

    await db.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").bind(now, admin.id).run();

    const response = adminAuthJson({ ok: true, admin: { email: admin.email, name: admin.name, role: admin.role } }, 200, "done", "none", "");
    response.headers.set("set-cookie", setCookie("bb_session", sessionId, 7));
    return response;
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled login error");
  }
};
