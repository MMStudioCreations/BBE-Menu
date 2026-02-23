import { clearCookie, getCookie, json } from "../auth/_utils";

function unauthorizedWithClearCookie() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": clearCookie("bb_admin_session"),
    },
  });
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env?.DB as D1Database | undefined;
  if (!db) return json({ ok: false, error: "unauthorized" }, 401);

  const sessionId = getCookie(request, "bb_admin_session");
  if (!sessionId) return unauthorizedWithClearCookie();

  const admin = await db
    .prepare(
      `SELECT a.id, a.email, a.role, a.is_active,
              COALESCE(a.must_change_password,0) AS must_change_password
       FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       WHERE s.id = ? AND s.expires_at > datetime('now')
       LIMIT 1`
    )
    .bind(sessionId)
    .first<any>();

  if (!admin) return unauthorizedWithClearCookie();
  if (Number(admin.is_active) !== 1) return unauthorizedWithClearCookie();

  return json({
    ok: true,
    admin: {
      id: Number(admin.id),
      email: String(admin.email || ""),
      role: String(admin.role || "admin"),
    },
    must_change_password: Number(admin.must_change_password || 0) === 1,
  });
};
