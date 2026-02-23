import { json, setCookie, uuid, verifyPassword } from "../auth/_utils";
import { ensureAdminAuthSchema } from "./_auth";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database;
  if (!db) return json({ ok: false, error: "DB binding missing" }, 500);
  await ensureAdminAuthSchema(db);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const email = String(body?.email || body?.username || "").trim().toLowerCase();
  const password = String(body?.password || body?.secret || "");
  if (!email || !password) return json({ ok: false, error: "Email and password required" }, 400);

  const admin = await db
    .prepare(
      `SELECT id, email, password_hash, role,
              COALESCE(is_active,1) AS is_active,
              COALESCE(force_password_change,0) AS force_password_change
       FROM admin_users
       WHERE lower(email)=lower(?)
       LIMIT 1`
    )
    .bind(email)
    .first<any>();

  if (!admin) return json({ ok: false, error: "Invalid credentials" }, 401);

  const validPassword = await verifyPassword(password, String(admin.password_hash || ""));
  if (!validPassword) return json({ ok: false, error: "Invalid credentials" }, 401);
  if (Number(admin.is_active) === 0) return json({ ok: false, error: "account_deactivated" }, 403);

  const sessionId = uuid();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare("INSERT INTO admin_sessions (id, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(sessionId, admin.id, expiresAt, createdAt)
    .run();

  const response = json(
    {
      ok: true,
      must_change_password: Number(admin.force_password_change || 0) === 1,
      role: String(admin.role || "admin"),
      admin: {
        id: admin.id,
        email: String(admin.email || email),
        role: String(admin.role || "admin"),
        mustChangePassword: Number(admin.force_password_change || 0) === 1,
      },
    },
    200
  );
  response.headers.append("set-cookie", setCookie("bb_admin_session", sessionId, 7));
  return response;
};
