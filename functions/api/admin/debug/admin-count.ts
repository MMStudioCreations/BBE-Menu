import { adminAuthJson, getErrorMessage } from "../auth/_helpers";

export const onRequestGet: PagesFunction = async ({ env }) => {
  try {
    const db = env.DB as D1Database;
    const row = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<any>();
    return adminAuthJson({ ok: true, admins: Number(row?.count || 0) }, 200, "done", "none", "");
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled debug error");
  }
};
