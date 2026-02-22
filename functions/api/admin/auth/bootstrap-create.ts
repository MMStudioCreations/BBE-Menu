import { hashPassword, json, uuid } from "../../auth/_utils";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  const body = await request.json<any>().catch(() => null);
  const secret = String(body?.secret || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const name = String(body?.name || "").trim();

  const countRow = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<any>();
  if (Number(countRow?.count || 0) > 0) return json({ ok: false, error: "already_bootstrapped" }, 403);

  if (!env.ADMIN_BOOTSTRAP_SECRET || secret !== String(env.ADMIN_BOOTSTRAP_SECRET)) {
    return json({ ok: false, error: "invalid_secret" }, 403);
  }
  if (!email || !password || password.length < 8) return json({ ok: false, error: "invalid_payload" }, 400);

  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO admin_users (id, email, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 'owner', 1, ?)")
    .bind(uuid(), email, name || null, await hashPassword(password), now)
    .run();

  return json({ ok: true });
};

export const onRequestGet: PagesFunction = async ({ env }) => {
  const db = env.DB as D1Database;
  const row = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<any>();
  return json({ ok: true, needs_bootstrap: Number(row?.count || 0) === 0 });
};
