import { json } from "../../_auth";
import { nowIso, toBoolInt } from "../../_products";
import { requireAdminRequest } from "../_helpers";

export const onRequestPut: PagesFunction = async ({ params, request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const id = String(params.id || "").trim();
  const body = await request.json<any>();
  const label = String(body?.label || "").trim();
  const price = Math.round(Number(body?.price_cents || 0));
  if (!label) return json({ error: "label is required" }, 400);

  const db = env.DB as D1Database;
  await db.prepare("UPDATE product_variants SET label=?, price_cents=?, is_active=?, sort_order=?, updated_at=? WHERE id=?")
    .bind(label, Math.max(0, price), toBoolInt(body?.is_active, 1), Number(body?.sort_order || 0), nowIso(), id).run();
  const variant = await db.prepare("SELECT * FROM product_variants WHERE id = ?").bind(id).first<any>();
  return json({ ok: true, variant });
};

export const onRequestDelete: PagesFunction = async ({ params, request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const id = String(params.id || "").trim();
  await (env.DB as D1Database).prepare("DELETE FROM product_variants WHERE id = ?").bind(id).run();
  return json({ ok: true });
};
