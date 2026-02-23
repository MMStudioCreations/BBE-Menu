import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const query = (url.searchParams.get("query") || "").trim();
  const status = (url.searchParams.get("status") || "").trim().toLowerCase();
  const tier = (url.searchParams.get("tier") || "").trim().toLowerCase();
  const active = (url.searchParams.get("active") || "").trim();
  const tag = (url.searchParams.get("tag") || "").trim();
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50) || 50));

  const where: string[] = [];
  const binds: unknown[] = [];

  if (query) {
    where.push(`(u.email LIKE ? COLLATE NOCASE OR u.first_name LIKE ? COLLATE NOCASE OR u.last_name LIKE ? COLLATE NOCASE OR u.phone LIKE ? COLLATE NOCASE)`);
    const like = `%${query}%`;
    binds.push(like, like, like, like);
  }

  if (status && status !== "all") {
    where.push("COALESCE(u.account_status, 'pending') = ?");
    binds.push(status);
  }

  if (tier && tier !== "all") {
    where.push("LOWER(COALESCE(u.tier_override, u.tier, 'member')) = ?");
    binds.push(tier);
  }

  if (active === "0" || active === "1") {
    where.push("COALESCE(u.is_active, 1) = ?");
    binds.push(Number(active));
  }

  let join = "";
  if (tag) {
    join = "INNER JOIN customer_tags ct ON ct.user_id = u.id";
    where.push("ct.tag = ?");
    binds.push(tag);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { results } = await db
    .prepare(
      `SELECT DISTINCT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        COALESCE(u.is_active, 1) AS is_active,
        u.deactivated_at,
        COALESCE(u.account_status, 'pending') AS account_status,
        u.verified_at,
        COALESCE(u.tier_override, u.tier, 'member') AS effectiveTier,
        COALESCE(u.points_balance, 0) AS points_balance,
        COALESCE(u.lifetime_spend_cents, 0) AS lifetime_spend_cents,
        COALESCE((SELECT COUNT(1) FROM orders o WHERE o.user_id = u.id), 0) AS orders_count,
        u.created_at
      FROM users u
      ${join}
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ?`
    )
    .bind(...binds, limit)
    .all();

  return json({ ok: true, customers: results || [] });
};
