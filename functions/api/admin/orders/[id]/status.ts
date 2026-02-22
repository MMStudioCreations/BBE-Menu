import { json } from "../../../_auth";
import { requireAdminRequest } from "../../_helpers";

const valid = new Set(["completed", "cancelled"]);

export const onRequestPatch: PagesFunction = async ({ request, env, params }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const id = String(params.id || "").trim();
  const body = await request.json<any>().catch(() => null);
  const next = String(body?.status || "").toLowerCase();
  if (!id || !valid.has(next)) return json({ ok:false, error:"invalid_payload" }, 400);

  const db = env.DB as D1Database;
  const order = await db.prepare("SELECT id, user_id, status, COALESCE(subtotal_cents,0) AS subtotal_cents, COALESCE(points_earned,0) AS points_earned FROM orders WHERE id=?").bind(id).first<any>();
  if (!order) return json({ ok:false, error:"not_found" }, 404);

  const current = String(order.status || "placed").toLowerCase();
  if (current === "cancelled") return json({ ok:false, error:"cancelled_locked" }, 400);
  if (current === "placed" && !["completed","cancelled"].includes(next)) return json({ ok:false, error:"invalid_transition" }, 400);
  if (current === "completed" && next !== "cancelled") return json({ ok:false, error:"invalid_transition" }, 400);

  await db.prepare("UPDATE orders SET status=? WHERE id=?").bind(next, id).run();

  const userId = String(order.user_id || "").trim();
  if (userId && next === "cancelled") {
    const subtotal = Math.max(0, Number(order.subtotal_cents || 0));
    const points = Math.max(0, Number(order.points_earned || 0));
    await db.prepare("UPDATE users SET lifetime_spend_cents = MAX(0, COALESCE(lifetime_spend_cents,0) - ?), points_balance = MAX(0, COALESCE(points_balance,0) - ?) WHERE id = ?").bind(subtotal, points, userId).run();
    if (points > 0) {
      await db.prepare("INSERT INTO points_ledger (id, user_id, created_at, type, points_delta, reason, order_id, meta_json) VALUES (?, ?, ?, 'reversal', ?, 'order_cancelled', ?, ?)")
        .bind(crypto.randomUUID(), userId, new Date().toISOString(), -points, id, JSON.stringify({ reversed_points: points }))
        .run();
    }
  }

  return json({ ok:true, data:{ id, status: next } });
};
