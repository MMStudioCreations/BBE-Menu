import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

function resolveRange(url: URL) {
  const range = (url.searchParams.get("range") || "7d").toLowerCase();
  const now = new Date();
  let days = 7;
  if (range === "30d") days = 30;
  if (range === "90d") days = 90;

  if (range === "custom") {
    const from = url.searchParams.get("from") || url.searchParams.get("start") || "";
    const to = url.searchParams.get("to") || url.searchParams.get("end") || "";
    const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.now() - 6 * 86400000);
    const end = to ? new Date(`${to}T23:59:59.999Z`) : now;
    return { start: start.toISOString(), end: end.toISOString(), range: "custom" };
  }

  const start = new Date(Date.now() - (days - 1) * 86400000);
  return { start: start.toISOString(), end: now.toISOString(), range: `${days}d` };
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);
  const { start, end, range } = resolveRange(url);

  const metrics = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN LOWER(status)='completed' THEN total_cents ELSE 0 END),0) AS revenue_cents,
    COALESCE(SUM(CASE WHEN LOWER(status)='completed' THEN 1 ELSE 0 END),0) AS orders_completed,
    COALESCE(SUM(CASE WHEN LOWER(status)='pending' THEN 1 ELSE 0 END),0) AS orders_pending,
    COALESCE(SUM(CASE WHEN LOWER(status)='cancelled' THEN 1 ELSE 0 END),0) AS orders_cancelled,
    COALESCE(SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END),0) AS guest_orders
    FROM orders WHERE created_at >= ? AND created_at <= ?`).bind(start, end).first<any>();

  const topProducts = await db.prepare(`SELECT oi.product_id, oi.product_name, COALESCE(SUM(oi.quantity),0) AS qty, COALESCE(SUM(oi.line_total_cents),0) AS revenue_cents
      FROM order_items oi
      INNER JOIN orders o ON o.id=oi.order_id
      WHERE o.created_at >= ? AND o.created_at <= ? AND LOWER(COALESCE(o.status,'pending'))='completed'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC, revenue_cents DESC
      LIMIT 10`).bind(start, end).all<any>().catch(() => ({ results: [] } as any));

  const newUsers = await db.prepare(`SELECT COUNT(*) AS c FROM users WHERE created_at >= ? AND created_at <= ?`).bind(start, end).first<any>();

  const totalUsers = await db.prepare("SELECT COUNT(*) AS c FROM users").first<any>();
  const activeUsers = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE COALESCE(is_active, 1) = 1").first<any>();
  const pendingVerification = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE COALESCE(account_status, 'pending') = 'pending'").first<any>();

  const completed = Number(metrics?.orders_completed || 0);
  const revenue = Number(metrics?.revenue_cents || 0);

  return json({ ok: true, range: { start, end, range },
    revenue_cents: revenue,
    orders_completed: completed,
    orders_pending: Number(metrics?.orders_pending || 0),
    orders_cancelled: Number(metrics?.orders_cancelled || 0),
    avg_order_value_cents: completed ? Math.round(revenue / completed) : 0,
    top_products: topProducts.results || [],
    new_users: Number(newUsers?.c || 0),
    guest_orders: Number(metrics?.guest_orders || 0),
    totalUsers: Number(totalUsers?.c || 0),
    activeUsers: Number(activeUsers?.c || 0),
    ordersLast7Days: Number(metrics?.orders_completed || 0) + Number(metrics?.orders_pending || 0) + Number(metrics?.orders_cancelled || 0),
    pendingVerification: Number(pendingVerification?.c || 0),
    metrics: {
      revenue_completed_cents: revenue,
      orders_completed_count: completed,
      orders_pending_count: Number(metrics?.orders_pending || 0),
      orders_cancelled_count: Number(metrics?.orders_cancelled || 0),
      aov_completed_cents: completed ? Math.round(revenue / completed) : 0,
    }
  });
};
