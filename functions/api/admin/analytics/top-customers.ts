import { json } from "../../_auth";
import { requireAdminRequest } from "../_helpers";
import { toRangeStartIso } from "./_shared";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") || "all").toLowerCase();
  if (!["all", "30"].includes(range)) return json({ error: "Invalid range" }, 400);

  const filterClause = range === "30" ? "WHERE o.created_at >= ?" : "";
  const stmt = db.prepare(
    `SELECT
      COALESCE(o.user_id, o.customer_email, o.customer_phone, o.id) AS customer_key,
      COALESCE(MAX(u.email), MAX(o.customer_email), 'Guest') AS email,
      COALESCE(MAX(u.first_name || ' ' || u.last_name), MAX(o.customer_name), 'Guest') AS name,
      COALESCE(SUM(o.total_cents), 0) AS spend_cents,
      COUNT(*) AS order_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    ${filterClause}
    GROUP BY customer_key
    ORDER BY spend_cents DESC
    LIMIT 5`
  );
  const result = range === "30" ? await stmt.bind(toRangeStartIso("30")).all<any>() : await stmt.all<any>();

  return json({ ok: true, range, customers: result.results || [] });
};
