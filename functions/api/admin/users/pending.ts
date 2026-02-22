import { json } from "../../_auth";
import { requireAdminRequest } from "../_helpers";

export const onRequestGet: PagesFunction = async (context) => {
  const { request, env } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;

  const { results } = await db
    .prepare(
      `SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.account_status,
        u.created_at,
        u.updated_at,
        uv.status AS verification_status,
        uv.updated_at AS verification_updated_at
      FROM users u
      LEFT JOIN user_verification uv ON uv.user_id = u.id
      WHERE COALESCE(u.account_status, 'pending') = 'pending'
      ORDER BY COALESCE(uv.updated_at, u.updated_at, u.created_at) DESC`
    )
    .all();

  return json({ ok: true, users: results || [] });
};
