import { json } from "../../_auth";
import { requireAdminSession } from "../_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const admin = await requireAdminSession(request, env);
  if (!admin) return json({ ok: false });
  return json({ ok: true, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
};
