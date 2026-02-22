import { json } from "../../_auth";
import { requireAdminRequest } from "../_helpers";
import { parseCartLines, toRangeStartIso } from "./_shared";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") || "30").toLowerCase();
  if (!["7", "30", "today"].includes(range)) return json({ error: "Invalid range" }, 400);

  const fromIso = toRangeStartIso(range);
  const { results } = await db
    .prepare(
      `SELECT id, cart_json
       FROM orders
       WHERE created_at >= ?
         AND LOWER(COALESCE(status, '')) != 'cancelled'
       ORDER BY created_at DESC
       LIMIT 800`
    )
    .bind(fromIso)
    .all<any>();

  const map = new Map<string, { key: string; product_name: string; quantity: number }>();
  for (const order of results || []) {
    const lines = parseCartLines(order.cart_json);
    for (const line of lines) {
      const key = line.productId || line.productName || "unknown";
      const item = map.get(key) || { key, product_name: line.productName || "Unknown product", quantity: 0 };
      item.quantity += line.quantity;
      if (!item.product_name && line.productName) item.product_name = line.productName;
      map.set(key, item);
    }
  }

  const items = [...map.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  return json({ ok: true, range, products: items });
};
