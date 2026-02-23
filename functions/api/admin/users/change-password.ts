import { hashPassword, json, verifyPassword } from "../../auth/_utils";
import { ensureAdminAuthSchema, requireAdmin } from "../_auth";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const body = await request.json<any>().catch(() => null);
  const currentPassword = String(body?.current_password ?? body?.currentPassword ?? "");
  const newPassword = String(body?.new_password ?? body?.newPassword ?? "");

  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const db = env.DB as D1Database;
  await ensureAdminAuthSchema(db);

  const admin = await db
    .prepare("SELECT id, password_hash FROM admin_users WHERE id = ? LIMIT 1")
    .bind(auth.id)
    .first<any>();

  if (!admin) return json({ ok: false, error: "unauthorized" }, 401);

  const validCurrent = await verifyPassword(currentPassword, String(admin.password_hash || ""));
  if (!validCurrent) {
    return json({ ok: false, error: "invalid_current_password" }, 401);
  }

  await db
    .prepare("UPDATE admin_users SET password_hash = ?, force_password_change = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(await hashPassword(newPassword), auth.id)
    .run();

  return json({ ok: true });
};
