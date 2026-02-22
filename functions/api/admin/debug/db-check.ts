import { json, requireAdmin } from "../../_auth";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  const db = env.DB as D1Database;
  const tables = ["users", "orders", "products", "admin_users", "sessions", "admin_saved_views"];
  const data: Record<string, number> = {};
  for (const t of tables) {
    try {
      const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).first<any>();
      data[t] = Number(row?.c || 0);
    } catch {
      data[t] = -1;
    }
  }
  return json({ ok: true, data });
};
