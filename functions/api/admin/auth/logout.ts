import { clearCookie, getCookie } from "../../auth/_utils";
import { adminAuthJson, ensureAdminSessionSchema, getErrorMessage } from "./_helpers";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const db = env.DB as D1Database;
    await ensureAdminSessionSchema(db);
    const sid = getCookie(request, "admin_session") || getCookie(request, "bb_admin_session") || getCookie(request, "bbe_admin_session") || getCookie(request, "bb_session");
    if (sid) {
      await db.prepare("DELETE FROM sessions WHERE id = ? AND COALESCE(session_type, 'user') = 'admin'").bind(sid).run();
    }

    const response = adminAuthJson({ ok: true }, 200, "done", "none", "");
    response.headers.append("set-cookie", clearCookie("admin_session"));
    response.headers.append("set-cookie", clearCookie("bb_admin_session"));
    response.headers.append("set-cookie", clearCookie("bb_session"));
    response.headers.append("set-cookie", clearCookie("bbe_admin_session"));
    return response;
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled logout error");
  }
};
