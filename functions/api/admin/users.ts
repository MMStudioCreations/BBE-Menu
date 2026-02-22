import { hashPassword, uuid } from "../auth/_utils";
import { json, requireOwner } from "../_auth";

const normalizeRole = (value: unknown) => {
  const v = String(value || "admin").toLowerCase();
  return v === "owner" || v === "super_admin" || v === "staff" ? v : "admin";
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if (auth instanceof Response) return auth;

  const db = env.DB as D1Database;
  const { results } = await db
    .prepare("SELECT id, email, name, COALESCE(role, CASE WHEN COALESCE(is_owner,0)=1 THEN 'owner' WHEN COALESCE(is_super_admin,0)=1 THEN 'super_admin' ELSE 'admin' END) AS role, COALESCE(is_active,1) AS is_active, created_at FROM admin_users ORDER BY created_at DESC")
    .all();

  return json({ ok: true, data: { admins: results || [] } });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if (auth instanceof Response) return auth;

  const body = await request.json<any>().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const name = String(body?.name || "").trim();
  const password = String(body?.password || "");
  const role = normalizeRole(body?.role);

  if (!email || !password || password.length < 8) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const db = env.DB as D1Database;
  const existing = await db.prepare("SELECT id FROM admin_users WHERE lower(email)=lower(?)").bind(email).first();
  if (existing) return json({ ok: false, error: "email_in_use" }, 409);

  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO admin_users (id, email, name, password_hash, role, is_active, is_super_admin, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
    .bind(uuid(), email, name || "", await hashPassword(password), role, role === "super_admin" ? 1 : 0, role === "owner" ? 1 : 0, now, now)
    .run();

  return json({ ok: true });
};
