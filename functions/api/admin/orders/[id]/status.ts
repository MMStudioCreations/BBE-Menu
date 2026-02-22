import { json } from "../../../_auth";
import { requireAdminRequest } from "../../_helpers";

const valid = new Set(["pending", "completed", "cancelled"]);

export const onRequestPatch: PagesFunction = async ({ request, env, params }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const id = String(params.id || "").trim();
  const body = await request.json<any>().catch(() => null);
  const next = String(body?.status || "").toLowerCase();
  if (!id || !valid.has(next)) return json({ ok:false, error:"invalid_payload", code:"INVALID_PAYLOAD" }, 400);

  const db = env.DB as D1Database;
  const order = await db.prepare("SELECT id, user_id, status, COALESCE(subtotal_cents,0) AS subtotal_cents, COALESCE(total_cents,0) AS total_cents, COALESCE(points_earned,0) AS points_earned FROM orders WHERE id=?").bind(id).first<any>();
  if (!order) return json({ ok:false, error:"not_found", code:"NOT_FOUND" }, 404);

  const current = String(order.status || "pending").toLowerCase();
  if (current === next) return json({ ok: true, data: { id, status: next, unchanged: true } });

  await db.prepare("UPDATE orders SET status=? WHERE id=?").bind(next, id).run();

  const userId = String(order.user_id || "").trim();
  if (userId) {
    const points = Math.max(0, Number(order.points_earned || 0));

    const hasCancelReversal = await db.prepare("SELECT id FROM points_ledger WHERE user_id=? AND order_id=? AND reason='order_cancelled' LIMIT 1").bind(userId, id).first<any>();
    const hasRestore = await db.prepare("SELECT id FROM points_ledger WHERE user_id=? AND order_id=? AND reason='order_reinstated' LIMIT 1").bind(userId, id).first<any>();

    if (next === "cancelled" && current !== "cancelled") {
      if (!hasCancelReversal && points > 0) {
        await db.prepare("INSERT INTO points_ledger (id, user_id, created_at, type, points_delta, reason, order_id, meta_json) VALUES (?, ?, ?, 'reversal', ?, 'order_cancelled', ?, ?)")
          .bind(crypto.randomUUID(), userId, new Date().toISOString(), -points, id, JSON.stringify({ reversed_points: points }))
          .run();
      }
    }

    if (current === "cancelled" && next === "completed") {
      if (!hasRestore && points > 0) {
        await db.prepare("INSERT INTO points_ledger (id, user_id, created_at, type, points_delta, reason, order_id, meta_json) VALUES (?, ?, ?, 'earn', ?, 'order_reinstated', ?, ?)")
          .bind(crypto.randomUUID(), userId, new Date().toISOString(), points, id, JSON.stringify({ restored_points: points }))
          .run();
      }
    }

    await db.prepare(`UPDATE users
      SET lifetime_spend_cents = COALESCE((SELECT SUM(COALESCE(total_cents,0)) FROM orders WHERE user_id = ? AND LOWER(COALESCE(status,'pending')) = 'completed'), 0),
          points_balance = COALESCE((SELECT SUM(points_delta) FROM points_ledger WHERE user_id = ?), 0)
      WHERE id = ?`).bind(userId, userId, userId).run();
  }

  return json({ ok:true, data:{ id, status: next } });
};
