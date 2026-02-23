import { hashPassword, json } from "../auth/_utils";
import { ensureAdminAuthSchema, requirePasswordReady, requireSuperAdmin } from "./_auth";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  const passwordGate = requirePasswordReady(auth);
  if (passwordGate) return passwordGate;

  const db = env.DB as D1Database;
  await ensureAdminAuthSchema(db);

  const adminUsersInfo = await db.prepare("PRAGMA table_info(admins)").all<any>();
  const adminUserColumns = new Set((adminUsersInfo.results || []).map((r: any) => String(r?.name || "").toLowerCase()));
  const createdAtExpr = adminUserColumns.has("created_at") ? "created_at" : "'' AS created_at";
  const updatedAtExpr = adminUserColumns.has("updated_at") ? "updated_at" : "'' AS updated_at";

  const { results } = await db
    .prepare(
      `SELECT id, email, role,
              COALESCE(is_active,1) AS is_active,
              COALESCE(must_change_password,0) AS must_change_password,
              ${createdAtExpr}, ${updatedAtExpr}
       FROM admins
       ORDER BY ${adminUserColumns.has("created_at") ? "created_at DESC" : "email ASC"}`
    )
    .all<any>();

  return json({ ok: true, admins: results || [] });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  const passwordGate = requirePasswordReady(auth);
  if (passwordGate) return passwordGate;

  const body = await request.json<any>().catch(() => null);
  const normalizedEmail = String(body?.email || "").trim().toLowerCase();
  const role = String(body?.role || "").trim().toLowerCase();
  const tempPassword = String(body?.temp_password ?? body?.tempPassword ?? "");

  if (!normalizedEmail) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }
  if (!["admin", "superadmin"].includes(role)) {
    return json({ ok: false, error: "invalid_role" }, 400);
  }
  if (!tempPassword || tempPassword.length < 8) {
    return json({ ok: false, error: "invalid_temp_password" }, 400);
  }

  const db = env.DB as D1Database;
  await ensureAdminAuthSchema(db);

  const hashedPassword = await hashPassword(tempPassword);
  let insertedId: number | null = null;

  try {
    await db
      .prepare(
        `INSERT INTO admins
         (email, password_hash, role, is_active, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, datetime('now'), datetime('now'))`
      )
      .bind(normalizedEmail, hashedPassword, role)
      .run();

    const row = await db.prepare("SELECT last_insert_rowid() AS id").first<{ id: number }>();
    insertedId = Number(row?.id ?? 0) || null;
  } catch (err: any) {
    const message = String(err?.message || err || "");
    if (/unique|constraint/i.test(message) && /email/i.test(message)) {
      return json({ ok: false, error: "email_exists" }, 409);
    }
    return json({ ok: false, error: "create_admin_failed", detail: message }, 500);
  }

  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const payload: any = {
    ok: true,
    created: { id: insertedId, email: normalizedEmail, role },
  };

  if (debug) {
    const countRow = await db.prepare("SELECT COUNT(*) AS count FROM admins").first<any>();
    payload.admins_count_after = Number(countRow?.count || 0);
    payload.normalized_email = normalizedEmail;
    payload.inserted_id = insertedId;
  }

  return json(payload);
};
