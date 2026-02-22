import { getCookie, json } from "../auth/_utils";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

  const sid =
    getCookie(request, "admin_session") ||
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "bbe_admin_session") ||
    getCookie(request, "bb_session");
  if (!sid) return json({ ok: false }, 401);

  const session = await db
    .prepare("SELECT admin_user_id, expires_at, COALESCE(session_type, 'user') AS session_type FROM sessions WHERE id = ?")
    .bind(sid)
    .first<any>();

  if (!session || !session.admin_user_id || String(session.session_type) !== "admin") {
    return json({ ok: false }, 401);
  }

  if (Date.parse(String(session.expires_at || "")) < Date.now()) {
    return json({ ok: false }, 401);
  }

  const admin = await db.prepare("SELECT name, email, role FROM admin_users WHERE id = ?").bind(session.admin_user_id).first<any>();
  const username = String(admin?.name || admin?.email || env.ADMIN_USERNAME || "admin");
  const role = String(admin?.role || "admin");

  return json({ ok: true, admin: { username, role } }, 200);
};
