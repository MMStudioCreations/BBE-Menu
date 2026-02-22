import { json } from "../_auth";
import { createId, nowIso, parseEffects, slugify, toBoolInt, uniqueSlug } from "../_products";
import { requireAdminRequest } from "./_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const query = (url.searchParams.get("query") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const brand = (url.searchParams.get("brand") || "").trim();
  const published = (url.searchParams.get("published") || "").trim();
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50) || 50));

  const where: string[] = [];
  const binds: unknown[] = [];

  if (query) {
    where.push("(p.name LIKE ? COLLATE NOCASE OR p.brand LIKE ? COLLATE NOCASE OR p.category LIKE ? COLLATE NOCASE OR p.subcategory LIKE ? COLLATE NOCASE)");
    const like = `%${query}%`;
    binds.push(like, like, like, like);
  }
  if (category) {
    where.push("p.category = ?");
    binds.push(category);
  }
  if (brand) {
    where.push("p.brand = ?");
    binds.push(brand);
  }
  if (published === "0" || published === "1") {
    where.push("p.is_published = ?");
    binds.push(Number(published));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { results } = await db
    .prepare(
      `SELECT
        p.*,
        COUNT(v.id) AS variant_count,
        COALESCE(SUM(CASE WHEN v.is_active = 1 THEN v.inventory_qty ELSE 0 END), 0) AS total_inventory,
        MAX(CASE WHEN v.is_active = 1 AND v.inventory_qty <= COALESCE(v.low_stock_threshold, 5) THEN 1 ELSE 0 END) AS low_stock
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      ${whereSql}
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT ?`
    )
    .bind(...binds, limit)
    .all<any>();

  const products = (results || []).map((row: any) => ({
    ...row,
    variant_count: Number(row.variant_count || 0),
    total_inventory: Number(row.total_inventory || 0),
    low_stock: Number(row.low_stock || 0),
    effects: parseEffects(row.effects_json),
  }));

  return json({ ok: true, products });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const body = await request.json<any>();

  const name = String(body?.name || "").trim();
  const brand = String(body?.brand || "").trim();
  const category = String(body?.category || "").trim();
  if (!name || !brand || !category) return json({ error: "name, brand, and category are required" }, 400);

  const slug = body?.slug ? await uniqueSlug(db, String(body.slug)) : await uniqueSlug(db, name);
  const id = createId("prd");
  const now = nowIso();

  const payload = {
    id,
    slug: slugify(slug),
    name,
    brand,
    category,
    subcategory: body?.subcategory ? String(body.subcategory).trim() : null,
    description: body?.description ? String(body.description).trim() : null,
    effects_json: JSON.stringify(Array.isArray(body?.effects) ? body.effects.map((v: unknown) => String(v)).filter(Boolean) : []),
    image_path: body?.image_path ? String(body.image_path).trim() : null,
    is_published: toBoolInt(body?.is_published, 1),
    is_featured: toBoolInt(body?.is_featured, 0),
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO products (id, slug, name, brand, category, subcategory, description, effects_json, image_path, is_published, is_featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      payload.id,
      payload.slug,
      payload.name,
      payload.brand,
      payload.category,
      payload.subcategory,
      payload.description,
      payload.effects_json,
      payload.image_path,
      payload.is_published,
      payload.is_featured,
      payload.created_at,
      payload.updated_at
    )
    .run();

  return json({ ok: true, product: { ...payload, effects: parseEffects(payload.effects_json) } }, 201);
};
