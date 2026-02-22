import { hashPassword, uuid } from "../../auth/_utils";
import { adminAuthJson, ensureAdminSessionSchema, getErrorMessage } from "./_helpers";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const db = env.DB as D1Database;
    await ensureAdminSessionSchema(db);
    const body = await request.json<any>().catch(() => null);
    const secret = String(body?.secret || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const name = String(body?.name || "").trim();

    const countRow = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<any>();
    if (Number(countRow?.count || 0) > 0) {
      return adminAuthJson({ ok: false, error: "already_bootstrapped" }, 403, "bootstrap_check", "already_bootstrapped", "Admin already exists");
    }

    if (!env.ADMIN_BOOTSTRAP_SECRET || secret !== String(env.ADMIN_BOOTSTRAP_SECRET)) {
      return adminAuthJson({ ok: false, error: "invalid_secret" }, 403, "validate_secret", "invalid_secret", "Bootstrap secret mismatch");
    }

    if (!email || !password || password.length < 8) {
      return adminAuthJson({ ok: false, error: "invalid_payload" }, 400, "validate_payload", "invalid_payload", "Invalid bootstrap payload");
    }

    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO admin_users (id, email, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 'owner', 1, ?)")
      .bind(uuid(), email, name || null, await hashPassword(password), now)
      .run();

    return adminAuthJson({ ok: true }, 200, "done", "none", "");
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled bootstrap error");
  }
};

export const onRequestGet: PagesFunction = async ({ env }) => {
  try {
    const db = env.DB as D1Database;
    await ensureAdminSessionSchema(db);
    const row = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<any>();
    return adminAuthJson({ ok: true, needs_bootstrap: Number(row?.count || 0) === 0 }, 200, "done", "none", "");
  } catch (err) {
    return adminAuthJson({ ok: false, error: "server_error", msg: getErrorMessage(err) }, 500, "exception", "server_error", "Unhandled bootstrap status error");
  }
};
