import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const scope = new URL(request.url).searchParams.get("scope") || "dashboard";
  const db = env.DB as D1Database;
  const rows = await db.prepare("SELECT * FROM admin_saved_views WHERE admin_user_id=? AND scope=? ORDER BY updated_at DESC").bind(auth.admin.id, scope).all();
  return json({ ok:true, data:{ views: rows.results||[] } });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;
  const body = await request.json<any>().catch(() => null);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = env.DB as D1Database;
  await db.prepare("INSERT INTO admin_saved_views (id, admin_user_id, scope, name, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, auth.admin.id, String(body?.scope||'dashboard'), String(body?.name||'Untitled'), JSON.stringify(body?.filters||{}), now, now).run();
  return json({ ok:true, data:{ id } });
};
