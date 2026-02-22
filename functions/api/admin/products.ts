import { json } from "../_auth";
import { createId, nowIso, parseEffects, slugify, toBoolInt, uniqueSlug } from "../_products";
import { requireAdminRequest } from "./_helpers";

const productRow = (row: any) => ({
  ...row,
  effects: parseEffects(row.effects_json),
  is_published: Number(row.is_published || 0),
});

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const query = (url.searchParams.get("query") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const subcategory = (url.searchParams.get("subcategory") || "").trim();
  const published = (url.searchParams.get("published") || "").trim();

  const where: string[] = [];
  const binds: unknown[] = [];
  if (query) {
    const like = `%${query}%`;
    where.push("(p.name LIKE ? COLLATE NOCASE OR p.slug LIKE ? COLLATE NOCASE OR p.brand LIKE ? COLLATE NOCASE)");
    binds.push(like, like, like);
  }
  if (category) {
    where.push("p.category = ?");
    binds.push(category);
  }
  if (subcategory) {
    where.push("p.subcategory = ?");
    binds.push(subcategory);
  }
  if (published === "0" || published === "1") {
    where.push("p.is_published = ?");
    binds.push(Number(published));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { results } = await db.prepare(
    `SELECT p.*, COUNT(v.id) AS variant_count, MIN(CASE WHEN v.is_active=1 THEN v.price_cents END) AS from_price_cents
     FROM products p LEFT JOIN product_variants v ON v.product_id = p.id ${whereSql}
     GROUP BY p.id ORDER BY p.updated_at DESC`
  ).bind(...binds).all<any>();

  return json({ ok: true, products: (results || []).map(productRow) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const db = env.DB as D1Database;
  const body = await request.json<any>();

  const name = String(body?.name || "").trim();
  const category = String(body?.category || "").trim();
  if (!name || !category) return json({ error: "name and category are required" }, 400);

  const id = createId("prd");
  const slug = await uniqueSlug(db, String(body?.slug || name));
  const now = nowIso();
  const effects = Array.isArray(body?.effects) ? body.effects.map((x: unknown) => String(x)).filter(Boolean) : [];

  await db.prepare(
    `INSERT INTO products (id, slug, name, brand, category, subcategory, description, effects_json, image_key, image_url, image_path, is_published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    slugify(slug),
    name,
    String(body?.brand || "").trim() || null,
    category,
    String(body?.subcategory || "").trim() || null,
    String(body?.description || "").trim() || null,
    JSON.stringify(effects),
    String(body?.image_key || "").trim() || null,
    String(body?.image_url || "").trim() || null,
    String(body?.image_path || "").trim() || null,
    toBoolInt(body?.is_published, 1),
    now,
    now
  ).run();

  const variants = Array.isArray(body?.variants) ? body.variants : [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i] || {};
    if (!v.label) continue;
    await db.prepare(
      `INSERT INTO product_variants (id, product_id, label, price_cents, sort_order, is_active, inventory_qty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(createId("var"), id, String(v.label).trim(), Math.round(Number(v.price_cents || 0) || 0), Number(v.sort_order ?? i), toBoolInt(v.is_active, 1), now, now).run();
  }

  const product = await db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<any>();
  return json({ ok: true, product: productRow(product) }, 201);
};
