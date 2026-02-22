import { requireAdmin } from "../../_auth";
import { adminAuthJson, ensureAdminSessionSchema, ensureAdminUserSchema, getErrorMessage } from "./_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    const db = env.DB as D1Database;
    await ensureAdminSessionSchema(db);
    await ensureAdminUserSchema(db);

    const auth = await requireAdmin(request, env);
    if (auth instanceof Response) {
      return adminAuthJson({ ok: false, error: "not_authenticated" }, 401);
    }

    return adminAuthJson(
      { ok: true, data: { admin: { id: auth.admin.id, email: auth.admin.email, name: auth.admin.name, role: auth.admin.role } } },
      200
    );
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled me error");
  }
};
