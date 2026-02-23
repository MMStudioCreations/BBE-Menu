import { json } from "../auth/_utils";
import { getAdminFromRequest } from "./_auth";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const admin = await getAdminFromRequest(request, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401);

  return json(
    {
      ok: true,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        mustChangePassword: Number(admin.force_password_change) === 1,
      },
    },
    200
  );
};
