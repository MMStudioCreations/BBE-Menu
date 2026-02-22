import { json, clearCookie, getCookie } from "../../auth/_utils";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  const sid = getCookie(request, "bb_session");
  if (sid) {
    await db.prepare("DELETE FROM sessions WHERE id = ? AND COALESCE(session_type, 'user') = 'admin'").bind(sid).run();
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": clearCookie("bb_session"),
    },
  });
};
