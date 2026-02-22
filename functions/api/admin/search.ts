import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const type = (url.searchParams.get("type") || "").trim().toLowerCase();
  const like = `%${q}%`;

  if (!q) return json({ ok: true, results: [] });

  if (type === "customers") {
    const { results } = await db
      .prepare(
        `SELECT id, email, first_name, last_name, phone
         FROM users
         WHERE email LIKE ? COLLATE NOCASE OR first_name LIKE ? COLLATE NOCASE OR last_name LIKE ? COLLATE NOCASE OR phone LIKE ? COLLATE NOCASE
         ORDER BY created_at DESC
         LIMIT 10`
      )
      .bind(like, like, like, like)
      .all();
    return json({ ok: true, results: (results || []).map((r: any) => ({ ...r, type: "customer" })) });
  }

  if (type === "orders") {
    const { results } = await db
      .prepare(
        `SELECT id, customer_email, status, created_at
         FROM orders
         WHERE id LIKE ? COLLATE NOCASE OR customer_email LIKE ? COLLATE NOCASE OR status LIKE ? COLLATE NOCASE
         ORDER BY created_at DESC
         LIMIT 10`
      )
      .bind(like, like, like)
      .all();
    return json({ ok: true, results: (results || []).map((r: any) => ({ ...r, type: "order" })) });
  }

  if (type === "products") {
    const { results } = await db
      .prepare(
        `SELECT id, name, slug, category
         FROM products
         WHERE name LIKE ? COLLATE NOCASE OR slug LIKE ? COLLATE NOCASE OR category LIKE ? COLLATE NOCASE
         ORDER BY updated_at DESC
         LIMIT 10`
      )
      .bind(like, like, like)
      .all();
    return json({ ok: true, results: (results || []).map((r: any) => ({ ...r, type: "product" })) });
  }

  return json({ error: "Invalid type" }, 400);
};
