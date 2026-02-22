import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const range = url.searchParams.get("range") || "7d";
  const now = new Date();
  const start = new Date(now);
  if (range === "30d") start.setDate(now.getDate() - 29);
  else if (range === "90d") start.setDate(now.getDate() - 89);
  else if (range === "custom") start.setTime(Date.parse(url.searchParams.get("from") || "") || now.getTime() - 6 * 86400000);
  else start.setDate(now.getDate() - 6);
  const from = start.toISOString();
  const to = range === "custom" ? (url.searchParams.get("to") || now.toISOString()) : now.toISOString();

  const totals = await db.prepare(`SELECT
    SUM(CASE WHEN status='placed' THEN COALESCE(subtotal_cents,0) ELSE 0 END) revenuePlaced,
    SUM(CASE WHEN status='completed' THEN COALESCE(subtotal_cents,0) ELSE 0 END) revenueCompleted,
    SUM(CASE WHEN status='cancelled' THEN COALESCE(subtotal_cents,0) ELSE 0 END) revenueCancelled,
    SUM(CASE WHEN status='placed' THEN 1 ELSE 0 END) ordersPlaced,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) ordersCompleted,
    SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) ordersCancelled
    FROM orders WHERE created_at BETWEEN ? AND ?`).bind(from,to).first<any>();

  const series = await db.prepare(`SELECT substr(created_at,1,10) AS day,
    SUM(CASE WHEN status IN ('placed','completed') THEN COALESCE(subtotal_cents,0) ELSE 0 END) AS revenue,
    COUNT(*) AS orders
    FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY substr(created_at,1,10) ORDER BY day ASC`).bind(from,to).all<any>();

  return json({ ok:true, data:{ ...(totals||{}), daily: series.results||[] } });
};
