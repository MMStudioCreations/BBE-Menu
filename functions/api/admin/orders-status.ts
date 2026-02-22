import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";
import { computeTierFromLifetimeSpend } from "../orders/_create";
import { awardPointsForOrder } from "../_rewards";

const allowedStatuses = new Set(["pending", "completed", "cancelled"]);

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  let body: { order_id?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";

  if (!orderId) return json({ ok: false, error: "order_id is required" }, 400);
  if (!allowedStatuses.has(status)) {
    return json({ ok: false, error: "status must be pending, completed, or cancelled" }, 400);
  }

  const db = env.DB as D1Database;

  const order = await db
    .prepare(`SELECT id, user_id, status, subtotal_cents FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{ id: string; user_id: string | null; status: string | null; subtotal_cents: number | null }>();

  if (!order) {
    return json({ ok: false, error: "Order not found" }, 404);
  }

  const previousStatus = String(order.status || "").toLowerCase();
  const nextStatus = status.toLowerCase();

  const updateResult = await db
    .prepare(`UPDATE orders SET status = ? WHERE id = ?`)
    .bind(status, orderId)
    .run();

  if (!updateResult.success || (updateResult.meta?.changes || 0) < 1) {
    return json({ ok: false, error: "Order not found" }, 404);
  }

  const subtotalCents = Math.max(0, Number(order.subtotal_cents || 0));
  const userId = String(order.user_id || "").trim();
  if (userId && subtotalCents > 0 && previousStatus !== nextStatus) {
    if (nextStatus === "cancelled") {
      const user = await db.prepare(`SELECT COALESCE(lifetime_spend_cents, 0) AS lifetime_spend_cents FROM users WHERE id = ?`).bind(userId).first<{ lifetime_spend_cents: number }>();
      if (user) {
        const updatedLifetimeSpend = Math.max(0, Number(user.lifetime_spend_cents || 0) - subtotalCents);
        await db
          .prepare(
            `UPDATE users
             SET lifetime_spend_cents = ?,
                 tier = ?,
                 updated_at = ?
             WHERE id = ?`
          )
          .bind(updatedLifetimeSpend, computeTierFromLifetimeSpend(updatedLifetimeSpend), new Date().toISOString(), userId)
          .run();
      }
    } else if (previousStatus === "cancelled") {
      const user = await db.prepare(`SELECT COALESCE(lifetime_spend_cents, 0) AS lifetime_spend_cents FROM users WHERE id = ?`).bind(userId).first<{ lifetime_spend_cents: number }>();
      if (user) {
        const updatedLifetimeSpend = Math.max(0, Number(user.lifetime_spend_cents || 0) + subtotalCents);
        await db
          .prepare(
            `UPDATE users
             SET lifetime_spend_cents = ?,
                 tier = ?,
                 updated_at = ?
             WHERE id = ?`
          )
          .bind(updatedLifetimeSpend, computeTierFromLifetimeSpend(updatedLifetimeSpend), new Date().toISOString(), userId)
          .run();
      }
    }
  }

  if (status !== "completed") {
    return json({ ok: true });
  }

  const awardResult = await awardPointsForOrder(db, orderId);
  if (!awardResult.ok) {
    return json({ ok: false, error: awardResult.reason || "Unable to award points" }, 400);
  }

  if (awardResult.skipped) {
    return json({ ok: true, awarded: { skipped: true } });
  }

  return json({ ok: true, awarded: { pointsEarned: awardResult.pointsEarned || 0 } });
};
