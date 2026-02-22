import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

export const onRequestGet: PagesFunction = async (context) => {
  const { request, env } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;

  const { results } = await db
    .prepare(
      `SELECT
        uv.user_id,
        u.email,
        u.first_name,
        u.last_name,
        u.account_status,
        u.verified_at,
        u.status_reason,
        uv.id_key,
        uv.selfie_key,
        uv.id_expiration,
        uv.updated_at
      FROM user_verification uv
      LEFT JOIN users u ON u.id = uv.user_id
      WHERE COALESCE(u.account_status, 'pending') IN ('pending','denied')
      ORDER BY uv.updated_at DESC`
    )
    .all();

  return json({ ok: true, verifications: results });
};
