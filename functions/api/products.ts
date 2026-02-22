import { json } from "./_auth";
import { parseEffects } from "./_products";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const category = (url.searchParams.get("category") || "").trim();
  const subcategory = (url.searchParams.get("subcategory") || "").trim();
  const brand = (url.searchParams.get("brand") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();

  const featuredParam = (url.searchParams.get("featured") || "").trim();
  const publishedParam = (url.searchParams.get("published") || url.searchParams.get("is_published") || "").trim();
  const rawLimit = Number.parseInt((url.searchParams.get("limit") || "").trim(), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 100;

  const excludedSlugs = ["jelly-fish", "space-candy"];

  const where: string[] = ["LOWER(p.slug) NOT IN (?, ?)"];
  const binds: unknown[] = [...excludedSlugs];

  if (featuredParam === "1") {
    where.push("p.is_featured = ?");
    binds.push(1);
    where.push("LOWER(p.category) = LOWER(?)");
    binds.push("Flower");
  }

  if (publishedParam === "0" || publishedParam === "1") {
    where.push("p.is_published = ?");
    binds.push(Number(publishedParam));
  } else {
    where.push("p.is_published = ?");
    binds.push(1);
  }

  if (category) {
    where.push("LOWER(p.category) = LOWER(?)");
    binds.push(category);
  }
  if (subcategory) {
    where.push("(p.subcategory IS NULL OR LOWER(p.subcategory) = LOWER(?))");
    binds.push(subcategory);
  }
  if (brand) {
    where.push("LOWER(p.brand) = LOWER(?)");
    binds.push(brand);
  }
  if (q) {
    where.push("(p.name LIKE ? COLLATE NOCASE OR p.brand LIKE ? COLLATE NOCASE OR p.description LIKE ? COLLATE NOCASE)");
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  const { results } = await db
    .prepare(
      `SELECT
        p.id,
        p.slug,
        p.name,
        p.brand,
        p.category,
        p.subcategory,
        p.image_key,
        p.image_url,
        p.image_path,
        p.effects_json,
        MIN(CASE WHEN v.is_active = 1 THEN v.price_cents END) AS from_price_cents
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id
      ORDER BY CASE WHEN p.featured_rank IS NULL THEN 1 ELSE 0 END ASC, p.featured_rank ASC, p.updated_at DESC, p.name ASC
      LIMIT ?`
    )
    .bind(...binds, limit)
    .all();

  const products = (results || []).map((row: any) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category,
    subcategory: row.subcategory,
    image_url: row.image_url || null,
    image_key: row.image_key || null,
    image_path: row.image_url || (row.image_key ? `/api/images/${encodeURIComponent(row.image_key)}` : row.image_path || null),
    effects: parseEffects(row.effects_json),
    from_price_cents: row.from_price_cents === null ? null : Number(row.from_price_cents),
  }));

  return json(products);
};
