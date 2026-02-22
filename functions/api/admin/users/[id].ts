import { json } from "../../_auth";
import { requireAdminRequest } from "../_helpers";

export const onRequestGet: PagesFunction = async (context) => {
  const { request, env, params } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const userId = String(params?.id || "").trim();
  if (!userId) return json({ error: "user id required" }, 400);

  const db = env.DB as D1Database;

  const user = await db
    .prepare(
      `SELECT
        id,
        email,
        phone,
        first_name,
        last_name,
        dob,
        created_at,
        points_balance,
        lifetime_spend_cents,
        tier,
        account_status,
        verified_at,
        verified_by_admin_id,
        status_reason,
        updated_at
      FROM users
      WHERE id = ?`
    )
    .bind(userId)
    .first();

  if (!user) return json({ error: "User not found" }, 404);

  const verification = await db
    .prepare(`SELECT * FROM user_verification WHERE user_id = ?`)
    .bind(userId)
    .first();

  return json({ ok: true, user, verification: verification || null });
};
