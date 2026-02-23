import { hashPassword, json, verifyPassword } from "../auth/_utils";
import { ensureAdminAuthSchema, getAdminPasswordChangeColumn, requireAdmin } from "./_auth";

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

  const passwordChangeColumn = await getAdminPasswordChangeColumn(db);

  const row = await db
    .prepare(`SELECT password_hash, COALESCE(${passwordChangeColumn},0) AS must_change_password FROM admins WHERE id = ? LIMIT 1`)
    .bind(auth.id)
    .first<any>();

  if (!row) return json({ ok: false, error: "unauthorized" }, 401);

  const mustChange = Number(row.must_change_password || 0) === 1;

  if (!mustChange) {
    if (!currentPassword) return json({ ok: false, error: "current_password_required" }, 400);
    const validCurrent = await verifyPassword(currentPassword, String(row.password_hash || ""));
    if (!validCurrent) return json({ ok: false, error: "invalid_current_password" }, 401);
  }

  const nextHash = await hashPassword(newPassword);
  await db
    .prepare(`UPDATE admins SET password_hash = ?, ${passwordChangeColumn} = 0, updated_at = datetime('now') WHERE id = ?`)
    .bind(nextHash, auth.id)
    .run();

  return json({ ok: true });
};
