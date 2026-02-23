import { clearCookie, getCookie, json } from "../auth/_utils";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

  const sessionId = getCookie(request, "bb_admin_session");
  if (sessionId) {
    await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(sessionId).run();
  }

  const response = json({ ok: true }, 200);
  response.headers.append("set-cookie", clearCookie("bb_admin_session"));
  return response;
};
