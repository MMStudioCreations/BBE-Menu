import { json } from "../_auth";
import { parseEffects } from "../_products";

export const onRequestGet: PagesFunction = async ({ params, env, request }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ error: "DB binding missing" }, 500);

  const isDebug = new URL(request.url).searchParams.get("debug") === "1";
  const sqlErrorResponse = (err: unknown, fallbackError: "Not found" | "Server error") => {
    if (isDebug) {
      const detail = err instanceof Error ? err.message : String(err);
      return json({ error: "products_endpoint_failed", detail }, 500);
    }
    const status = fallbackError === "Not found" ? 404 : 500;
    return json({ error: fallbackError }, status);
  };

  const slug = String(params.slug || "").trim();
  if (!slug) return json({ error: "Missing slug" }, 400);

  const excludedSlugs = new Set(["jelly-fish", "space-candy"]);
  if (excludedSlugs.has(slug.toLowerCase())) return json({ error: "Not found" }, 404);

  let product: any = null;
  try {
    const baseColumns = [
      "id",
      "slug",
      "name",
      "brand",
      "category",
      "description",
      "image_url",
      "image_key",
      "image_path",
      "is_published",
      "is_featured",
      "created_at",
      "updated_at",
    ];

    let selectedColumns = [...baseColumns];
    const tableInfo = await db.prepare("PRAGMA table_info(products)").all<any>();
    const available = new Set((tableInfo.results || []).map((col: any) => String(col.name)));
    if (available.has("subcategory")) selectedColumns.push("subcategory");
    if (available.has("effects_json")) selectedColumns.push("effects_json");

    product = await db
      .prepare(
        `SELECT ${selectedColumns.join(", ")} FROM products WHERE slug = ? AND is_published = 1`
      )
      .bind(slug)
      .first<any>();
  } catch (err) {
    return sqlErrorResponse(err, "Not found");
  }

  if (!product) return json({ error: "Not found" }, 404);

  let variants: any[] = [];
  try {
    const variantsResult = await db
      .prepare(
        `SELECT id, label, price_cents, inventory_qty, low_stock_threshold, is_active, sort_order
         FROM product_variants
         WHERE product_id = ? AND is_active = 1
         ORDER BY sort_order ASC, price_cents ASC`
      )
      .bind(product.id)
      .all<any>();
    variants = variantsResult.results || [];
  } catch (err) {
    if (isDebug) return sqlErrorResponse(err, "Server error");
    variants = [];
  }

  let effects: any[] = [];
  if (typeof product.effects_json === "string" && product.effects_json.trim()) {
    try {
      effects = parseEffects(product.effects_json);
    } catch {
      effects = [];
    }
  }

  return json({
    ok: true,
    product: {
      ...product,
      image_path: product.image_url || (product.image_key ? `/api/images/${encodeURIComponent(product.image_key)}` : product.image_path || null),
      effects,
      variants,
    },
  });
};
