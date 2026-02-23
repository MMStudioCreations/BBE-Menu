import { hashPassword, json, verifyPassword } from "../auth/_utils";
import { ensureAdminAuthSchema, requireAdmin } from "./_auth";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);
  await ensureAdminAuthSchema(db);

  const body = await request.json<any>().catch(() => null);
  const newPassword = String(body?.newPassword ?? body?.new_password ?? "");
  const currentPassword = String(body?.currentPassword ?? body?.current_password ?? "");

  if (!newPassword || newPassword.length < 8) {
    return json({ ok: false, error: "new_password_too_short" }, 400);
  }

  const row = await db
    .prepare("SELECT password_hash, COALESCE(force_password_change,0) AS force_password_change FROM admin_users WHERE id = ? LIMIT 1")
    .bind(auth.id)
    .first<any>();

  if (!row) return json({ ok: false, error: "unauthorized" }, 401);

  const mustChange = Number(row.force_password_change || 0) === 1;

  if (!mustChange) {
    if (!currentPassword) return json({ ok: false, error: "current_password_required" }, 400);
    const validCurrent = await verifyPassword(currentPassword, String(row.password_hash || ""));
    if (!validCurrent) return json({ ok: false, error: "invalid_current_password" }, 401);
  }

  const nextHash = await hashPassword(newPassword);
  await db
    .prepare("UPDATE admin_users SET password_hash = ?, force_password_change = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(nextHash, auth.id)
    .run();

  return json({ ok: true });
};
