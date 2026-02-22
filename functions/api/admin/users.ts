import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

const ALLOWED_STATUSES = new Set(["pending", "approved", "denied", "all"]);

export const onRequestGet: PagesFunction = async (context) => {
  const { request, env } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const query = (url.searchParams.get("query") || "").trim();
  const status = (url.searchParams.get("status") || "all").trim().toLowerCase();
  const parsedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));

  if (!ALLOWED_STATUSES.has(status)) {
    return json({ error: "status must be pending|approved|denied|all" }, 400);
  }

  const where: string[] = [];
  const binds: unknown[] = [];

  if (status !== "all") {
    where.push("COALESCE(u.account_status, 'pending') = ?");
    binds.push(status);
  }

  if (query) {
    where.push(`(
      u.email LIKE ? COLLATE NOCASE OR
      u.first_name LIKE ? COLLATE NOCASE OR
      u.last_name LIKE ? COLLATE NOCASE OR
      u.phone LIKE ? COLLATE NOCASE
    )`);
    const q = `%${query}%`;
    binds.push(q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { results } = await db
    .prepare(
      `SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.account_status,
        u.verified_at,
        u.points_balance,
        u.tier,
        u.created_at
      FROM users u
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ?`
    )
    .bind(...binds, limit)
    .all();

  return json({ ok: true, users: results || [] });
};
