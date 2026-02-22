import { hashPassword, uuid } from "../../auth/_utils";
import { adminAuthJson, ensureAdminSessionSchema, ensureAdminUserSchema, getErrorMessage } from "./_helpers";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const db = env.DB as D1Database;
    await ensureAdminSessionSchema(db);
    await ensureAdminUserSchema(db);
    const body = await request.json<any>().catch(() => null);
    const secret = String(body?.secret || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const name = String(body?.name || "").trim();
    const ownerEmail = String(env.OWNER_EMAIL || "").trim().toLowerCase();

    if (!env.ADMIN_BOOTSTRAP_SECRET || secret !== String(env.ADMIN_BOOTSTRAP_SECRET)) {
      return adminAuthJson({ ok: false, error: "invalid_secret" }, 403);
    }

    if (!ownerEmail || email !== ownerEmail || !password || password.length < 8) {
      return adminAuthJson({ ok: false, error: "invalid_payload" }, 400);
    }

    const count = await db.prepare("SELECT COUNT(*) AS c FROM admin_users").first<any>();
    if (Number(count?.c || 0) > 0) return adminAuthJson({ ok: false, error: "bootstrap_disabled" }, 409);

    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO admin_users (id, email, name, password_hash, role, is_active, is_super_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 'super_admin', 1, 1, ?, ?)")
      .bind(uuid(), email, name || "", await hashPassword(password), now, now)
      .run();

    return adminAuthJson({ ok: true }, 200);
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled bootstrap error");
  }
};

export const onRequestGet: PagesFunction = async ({ env }) => {
  try {
    const db = env.DB as D1Database;
    await ensureAdminSessionSchema(db);
    await ensureAdminUserSchema(db);
    const row = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<any>();
    return adminAuthJson({ ok: true, needs_bootstrap: Number(row?.count || 0) === 0 }, 200);
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled bootstrap status error");
  }
};
