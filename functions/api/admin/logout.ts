import { clearCookie, getCookie, json } from "../auth/_utils";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

  const sid =
    getCookie(request, "admin_session") ||
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "bbe_admin_session") ||
    getCookie(request, "bb_session");

  if (sid) {
    await db.prepare("DELETE FROM sessions WHERE id = ? AND COALESCE(session_type, 'user') = 'admin'").bind(sid).run();
  }

  const response = json({ ok: true }, 200);
  response.headers.append("set-cookie", clearCookie("admin_session"));
  response.headers.append("set-cookie", clearCookie("bb_admin_session"));
  response.headers.append("set-cookie", clearCookie("bbe_admin_session"));
  response.headers.append("set-cookie", clearCookie("bb_session"));
  return response;
};
