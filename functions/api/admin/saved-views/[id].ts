import { json } from "../../_auth";
import { requireAdminRequest } from "../_helpers";

export const onRequestDelete: PagesFunction = async ({ request, env, params }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const id = String(params.id || "");
  const db = env.DB as D1Database;
  await db.prepare("DELETE FROM admin_saved_views WHERE id=? AND admin_user_id=?").bind(id, auth.admin.id).run();
  return json({ ok:true });
};
