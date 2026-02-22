import { json } from "../../../_auth";
import { createId, nowIso, toBoolInt } from "../../../_products";
import { requireAdminRequest } from "../../_helpers";

export const onRequestPost: PagesFunction = async ({ params, request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const productId = String(params.id || "").trim();
  const body = await request.json<any>();
  const label = String(body?.label || "").trim();
  const priceCents = Math.round(Number(body?.price_cents || 0));
  if (!label) return json({ error: "label is required" }, 400);

  const now = nowIso();
  const variant = {
    id: createId("var"),
    product_id: productId,
    label,
    price_cents: Math.max(0, priceCents),
    sort_order: Number(body?.sort_order || 0),
    is_active: toBoolInt(body?.is_active, 1),
    inventory_qty: 0,
    created_at: now,
    updated_at: now,
  };
  await (env.DB as D1Database).prepare(
    `INSERT INTO product_variants (id, product_id, label, price_cents, sort_order, is_active, inventory_qty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(variant.id, variant.product_id, variant.label, variant.price_cents, variant.sort_order, variant.is_active, variant.inventory_qty, variant.created_at, variant.updated_at).run();

  return json({ ok: true, variant }, 201);
};
