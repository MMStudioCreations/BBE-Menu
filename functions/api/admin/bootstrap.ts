import { hashPassword, uuid } from "../auth/_utils";
import { adminAuthJson } from "./auth/_helpers";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  const body = await request.json<any>().catch(() => ({}));

  const secret = String(body?.secret || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const name = String(body?.name || "").trim();
  const password = String(body?.password || "");
  const ownerEmail = String(env.OWNER_EMAIL || "").trim().toLowerCase();

  if (!env.ADMIN_BOOTSTRAP_SECRET || secret !== String(env.ADMIN_BOOTSTRAP_SECRET)) {
    return adminAuthJson({ ok: false, error: "invalid_secret" }, 403);
  }
  if (!ownerEmail || email !== ownerEmail || !password || password.length < 8) {
    return adminAuthJson({ ok: false, error: "invalid_payload" }, 400);
  }

  const count = await db.prepare("SELECT COUNT(*) AS c FROM admin_users").first<any>();
  if (Number(count?.c || 0) > 0) {
    return adminAuthJson({ ok: false, error: "bootstrap_disabled" }, 409);
  }

  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO admin_users (id, email, name, password_hash, role, is_active, is_super_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 'super_admin', 1, 1, ?, ?)")
    .bind(uuid(), email, name || "", await hashPassword(password), now, now)
    .run();

  return adminAuthJson({ ok: true, data: { bootstrapped: true } });
};
