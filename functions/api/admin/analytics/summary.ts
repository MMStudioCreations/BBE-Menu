import { json } from "../../_auth";
import { requireAdminRequest } from "../_helpers";
import { toRangeStartIso } from "./_shared";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") || "30").toLowerCase();
  if (!["today", "7", "30"].includes(range)) return json({ error: "Invalid range" }, 400);

  const fromIso = toRangeStartIso(range);
  const scoped = await db
    .prepare(
      `SELECT
        COUNT(*) AS orders_count,
        COALESCE(SUM(total_cents), 0) AS revenue_cents,
        COALESCE(SUM(CASE WHEN COALESCE(points_redeemed, 0) > 0 THEN 1 ELSE 0 END), 0) AS redeemed_orders
      FROM orders
      WHERE created_at >= ?
        AND LOWER(COALESCE(status, '')) != 'cancelled' `
    )
    .bind(fromIso)
    .first<any>();

  const today = await db
    .prepare(
      `SELECT COUNT(*) AS orders_count, COALESCE(SUM(total_cents), 0) AS revenue_cents
       FROM orders
       WHERE created_at >= ?
         AND LOWER(COALESCE(status, '')) != 'cancelled' `
    )
    .bind(toRangeStartIso("today"))
    .first<any>();

  const last7 = await db
    .prepare(
      `SELECT COUNT(*) AS orders_count, COALESCE(SUM(total_cents), 0) AS revenue_cents
       FROM orders
       WHERE created_at >= ?
         AND LOWER(COALESCE(status, '')) != 'cancelled' `
    )
    .bind(toRangeStartIso("7"))
    .first<any>();

  const last30 = await db
    .prepare(
      `SELECT COUNT(*) AS orders_count, COALESCE(SUM(total_cents), 0) AS revenue_cents
       FROM orders
       WHERE created_at >= ?
         AND LOWER(COALESCE(status, '')) != 'cancelled' `
    )
    .bind(toRangeStartIso("30"))
    .first<any>();

  const ordersCount = Number(scoped?.orders_count || 0);
  const redeemedOrders = Number(scoped?.redeemed_orders || 0);

  return json({
    ok: true,
    range,
    period: {
      orders: ordersCount,
      revenue_cents: Number(scoped?.revenue_cents || 0),
      redemption_rate: ordersCount ? redeemedOrders / ordersCount : 0,
    },
    snapshots: {
      today: { orders: Number(today?.orders_count || 0), revenue_cents: Number(today?.revenue_cents || 0) },
      last7: { orders: Number(last7?.orders_count || 0), revenue_cents: Number(last7?.revenue_cents || 0) },
      last30: { orders: Number(last30?.orders_count || 0), revenue_cents: Number(last30?.revenue_cents || 0) },
    },
  });
};
