import { getCookie, json } from "../auth/_utils";
import { authorizeAdminUser } from "./_admin_authz";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

  const sessionId =
    getCookie(request, "bb_session") ||
    getCookie(request, "admin_session") ||
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "bbe_admin_session");

  if (!sessionId) return json({ ok: false, error: "Not authorized" }, 401);

  const session = await db
    .prepare("SELECT user_id, admin_user_id, expires_at, COALESCE(session_type, 'user') AS session_type FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<any>();

  if (!session || Date.parse(String(session.expires_at || "")) < Date.now()) {
    return json({ ok: false, error: "Not authorized" }, 401);
  }

  if (String(session.session_type) === "admin" && session.admin_user_id) {
    const admin = await db
      .prepare("SELECT email, name, COALESCE(role, CASE WHEN COALESCE(is_owner,0)=1 THEN 'owner' WHEN COALESCE(is_super_admin,0)=1 THEN 'super_admin' ELSE 'admin' END) AS role FROM admin_users WHERE id = ?")
      .bind(session.admin_user_id)
      .first<any>();

    if (!admin) return json({ ok: false, error: "Not authorized" }, 401);
    return json({ ok: true, admin: { email: admin.email, name: admin.name || null, role: String(admin.role || "admin") } }, 200);
  }

  if (!session.user_id) return json({ ok: false, error: "Not authorized" }, 401);

  const user = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(session.user_id)
    .first<any>();

  if (!user) return json({ ok: false, error: "Not authorized" }, 401);

  const authz = await authorizeAdminUser(user, db, env);
  if (!authz.authorized) return json({ ok: false, error: "Not authorized" }, 401);

  return json({ ok: true, admin: { email: user.email, role: authz.role || "admin" } }, 200);
};
