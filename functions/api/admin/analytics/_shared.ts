export type CartLine = {
  productId: string;
  productName: string;
  variantId: string;
  variantLabel: string;
  quantity: number;
  lineTotalCents: number;
};

export const toRangeStartIso = (range: string | null) => {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = Number(range || "30");
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() - days * 86400000).toISOString();
};

const asNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const pickFirst = (item: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};

export const parseCartLines = (cartJson: unknown): CartLine[] => {
  if (!cartJson) return [];
  let parsed: unknown = cartJson;
  if (typeof cartJson === "string") {
    try {
      parsed = JSON.parse(cartJson);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map((raw) => {
    const item = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
    const quantity = Math.max(1, Math.round(asNumber(item.quantity ?? item.qty ?? item.count, 1)));
    const priceCents = Math.max(
      0,
      Math.round(asNumber(item.price_cents ?? item.priceCents ?? item.unit_price_cents ?? item.price ?? item.unitPrice, 0))
    );

    return {
      productId: pickFirst(item, ["product_id", "productId", "id", "slug"]),
      productName: pickFirst(item, ["product_name", "productName", "name", "title"]),
      variantId: pickFirst(item, ["variant_id", "variantId", "sku"]),
      variantLabel: pickFirst(item, ["variant_label", "variantLabel", "size", "label"]),
      quantity,
      lineTotalCents: Math.max(0, Math.round(asNumber(item.line_total_cents ?? item.total_cents, priceCents * quantity))),
    };
  });
};
