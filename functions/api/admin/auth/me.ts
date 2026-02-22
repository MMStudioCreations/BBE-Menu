import { requireAdminSession } from "../_helpers";
import { adminAuthJson, getErrorMessage } from "./_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    const admin = await requireAdminSession(request, env);
    if (!admin) {
      return adminAuthJson({ ok: false, error: "not_authenticated" }, 401, "require_session", "not_authenticated", "No active admin session");
    }
    return adminAuthJson(
      { ok: true, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } },
      200,
      "done",
      "none",
      ""
    );
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled me error");
  }
};
