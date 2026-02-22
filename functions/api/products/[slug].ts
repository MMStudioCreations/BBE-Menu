import { json } from "../_auth";
import { parseEffects } from "../_products";

export const onRequestGet: PagesFunction = async ({ params, env }) => {
  const db = env.DB as D1Database;
  const slug = String(params.slug || "").trim();
  if (!slug) return json({ error: "Missing slug" }, 400);

  const excludedSlugs = new Set(["jelly-fish", "space-candy"]);
  if (excludedSlugs.has(slug.toLowerCase())) return json({ error: "Not found" }, 404);

  const product = await db
    .prepare(
      `SELECT
        id,
        slug,
        name,
        brand,
        category,
        subcategory,
        description,
        effects_json,
        image_key,
        image_url,
        image_path,
        is_published,
        is_featured,
        created_at,
        updated_at
      FROM products
      WHERE slug = ? AND is_published = 1`
    )
    .bind(slug)
    .first<any>();

  if (!product) return json({ error: "Not found" }, 404);

  const variants = await db
    .prepare(
      `SELECT id, label, price_cents, inventory_qty, low_stock_threshold, is_active, sort_order
       FROM product_variants
       WHERE product_id = ? AND is_active = 1
       ORDER BY sort_order ASC, price_cents ASC`
    )
    .bind(product.id)
    .all<any>();

  return json({
    ok: true,
    product: {
      ...product,
      image_path: product.image_url || (product.image_key ? `/api/images/${encodeURIComponent(product.image_key)}` : product.image_path || null),
      effects: parseEffects(product.effects_json),
      variants: variants.results || [],
    },
  });
};
