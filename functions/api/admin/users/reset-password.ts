import { hashPassword, json } from "../../auth/_utils";
import { ensureAdminAuthSchema, requirePasswordReady, requireSuperAdmin } from "../_auth";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  const passwordGate = requirePasswordReady(auth);
  if (passwordGate) return passwordGate;

  const body = await request.json<any>().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const newPassword = String(body?.new_password ?? body?.newPassword ?? "");

  if (!email || !newPassword || newPassword.length < 8) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const db = env.DB as D1Database;
  await ensureAdminAuthSchema(db);

  const result = await db
    .prepare(
      `UPDATE admin_users
       SET password_hash = ?, force_password_change = 1, updated_at = datetime('now')
       WHERE lower(email) = lower(?)`
    )
    .bind(await hashPassword(newPassword), email)
    .run();

  if (!result.success || Number(result.meta?.changes || 0) === 0) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  return json({ ok: true });
};
