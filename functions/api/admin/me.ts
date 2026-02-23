import { getCookie, json } from "../auth/_utils";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

  const sessionId = getCookie(request, "bb_admin_session");
  if (!sessionId) return json({ ok: false }, 401);

  const row = await db
    .prepare(
      "SELECT a.email, a.role, COALESCE(a.is_active,1) AS is_active FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id=? AND s.expires_at > ? LIMIT 1"
    )
    .bind(sessionId, new Date().toISOString())
    .first<any>();

  if (!row) return json({ ok: false }, 401);
  if (Number(row.is_active) === 0) return json({ ok: false }, 401);

  return json({ ok: true, admin: { email: String(row.email || ""), role: String(row.role || "admin") } }, 200);
};
