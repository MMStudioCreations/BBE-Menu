import { json } from "./_auth";
import { getTableColumns, parseEffects } from "./_products";

const asTruthy = (value: string) => ["1", "true", "yes", "on"].includes(value.toLowerCase());

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  const url = new URL(request.url);

  const category = (url.searchParams.get("category") || "").trim();
  const subcategory = (url.searchParams.get("subcategory") || "").trim();
  const brand = (url.searchParams.get("brand") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();
  const featured = asTruthy((url.searchParams.get("featured") || "").trim());

  const publishedParam = (url.searchParams.get("published") || url.searchParams.get("is_published") || "").trim();
  const rawLimit = Number.parseInt((url.searchParams.get("limit") || "").trim(), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;

  const excludedSlugs = ["jelly-fish", "space-candy"];

  try {
    const productColumns = await getTableColumns(db, "products");
    if (!productColumns.size) {
      console.warn("[api/products] products table missing or unreadable; returning empty list");
      return json([]);
    }

    const hasIsFeatured = productColumns.has("is_featured");
    const hasLegacyFeatured = productColumns.has("featured");
    const hasFeaturedRank = productColumns.has("featured_rank");
    const hasIsPublished = productColumns.has("is_published");
    const hasImageKey = productColumns.has("image_key");
    const hasImageUrl = productColumns.has("image_url");
    const hasImagePath = productColumns.has("image_path");
    const hasEffectsJson = productColumns.has("effects_json");

    const where: string[] = ["LOWER(p.slug) NOT IN (?, ?)"];
    const binds: unknown[] = [...excludedSlugs];

    if (featured) {
      if (hasIsFeatured && hasLegacyFeatured) where.push("(COALESCE(p.is_featured, 0) = 1 OR COALESCE(p.featured, 0) = 1)");
      else if (hasIsFeatured) where.push("COALESCE(p.is_featured, 0) = 1");
      else if (hasLegacyFeatured) where.push("COALESCE(p.featured, 0) = 1");
      else console.warn("[api/products] featured filter requested but no featured column exists");
    }

    if (hasIsPublished) {
      if (publishedParam === "0" || publishedParam === "1") {
        where.push("COALESCE(p.is_published, 1) = ?");
        binds.push(Number(publishedParam));
      } else {
        where.push("COALESCE(p.is_published, 1) = 1");
      }
    }

    if (category) {
      where.push("LOWER(COALESCE(p.category, '')) = LOWER(?)");
      binds.push(category);
    }
    if (subcategory) {
      where.push("(p.subcategory IS NULL OR LOWER(p.subcategory) = LOWER(?))");
      binds.push(subcategory);
    }
    if (brand) {
      where.push("LOWER(COALESCE(p.brand, '')) = LOWER(?)");
      binds.push(brand);
    }
    if (q) {
      where.push("(COALESCE(p.name, '') LIKE ? COLLATE NOCASE OR COALESCE(p.brand, '') LIKE ? COLLATE NOCASE OR COALESCE(p.description, '') LIKE ? COLLATE NOCASE)");
      const like = `%${q}%`;
      binds.push(like, like, like);
    }

    const selectColumns = [
      "p.id",
      "p.slug",
      "p.name",
      "p.brand",
      "p.category",
      "p.subcategory",
      hasImageKey ? "p.image_key" : "NULL AS image_key",
      hasImageUrl ? "p.image_url" : "NULL AS image_url",
      hasImagePath ? "p.image_path" : "NULL AS image_path",
      hasEffectsJson ? "p.effects_json" : "NULL AS effects_json",
      "MIN(CASE WHEN v.is_active = 1 THEN v.price_cents END) AS from_price_cents",
      hasIsFeatured ? "COALESCE(p.is_featured, 0) AS is_featured" : hasLegacyFeatured ? "COALESCE(p.featured, 0) AS is_featured" : "0 AS is_featured",
    ];

    const orderByParts = [
      hasFeaturedRank ? "CASE WHEN p.featured_rank IS NULL THEN 1 ELSE 0 END ASC" : null,
      hasFeaturedRank ? "p.featured_rank ASC" : null,
      "p.updated_at DESC",
      "p.name ASC",
    ].filter(Boolean);

    const sql = `SELECT
      ${selectColumns.join(",\n      ")}
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id
      ORDER BY ${orderByParts.join(", ")}
      LIMIT ?`;

    const { results } = await db.prepare(sql).bind(...binds, limit).all();

    if (!results || !results.length) return json([]);

    // Fetch all active variants for the returned products in a single query
    const productIds = (results as any[]).map((r: any) => r.id).filter(Boolean);
    let variantsByProductId = new Map<string, Array<{ id: string; label: string; price_cents: number; sort_order: number }>>();
    if (productIds.length) {
      const placeholders = productIds.map(() => "?").join(", ");
      try {
        const variantRows = await db
          .prepare(
            `SELECT id, product_id, label, price_cents, sort_order
             FROM product_variants
             WHERE product_id IN (${placeholders}) AND is_active = 1
             ORDER BY sort_order ASC, price_cents ASC`
          )
          .bind(...productIds)
          .all<any>();
        for (const v of variantRows.results || []) {
          if (!variantsByProductId.has(v.product_id)) variantsByProductId.set(v.product_id, []);
          variantsByProductId.get(v.product_id)!.push({
            id: v.id,
            label: v.label,
            price_cents: Number(v.price_cents),
            sort_order: Number(v.sort_order),
          });
        }
      } catch (err) {
        console.warn("[api/products] variant batch fetch failed, continuing without variants", err);
      }
    }

    const products = (results as any[]).map((row: any) => ({
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
      is_featured: Number(row.is_featured || 0),
      variants: variantsByProductId.get(row.id) || [],
    }));

    return json(products);
  } catch (error) {
    console.error("[api/products] query failed", error);
    return json([]);
  }
};
