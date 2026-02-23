import { json, verifyPassword } from "../auth/_utils";

type LoginBody = { email?: string; password?: string };

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const db = env?.DB as D1Database | undefined;
  if (!db) return json({ ok: false, error: "login_failed" }, 500);

  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!email || !password) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const admin = await db
    .prepare(
      `SELECT id, email, password_hash, role, is_active,
              COALESCE(must_change_password,0) AS must_change_password
       FROM admins
       WHERE lower(email)=lower(?)
       LIMIT 1`
    )
    .bind(email)
    .first<any>();

  if (!admin) return json({ ok: false, error: "invalid_credentials" }, 401);
  if (Number(admin.is_active) !== 1) return json({ ok: false, error: "account_deactivated" }, 403);

  const valid = await verifyPassword(password, String(admin.password_hash ?? ""));
  if (!valid) return json({ ok: false, error: "invalid_credentials" }, 401);

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  const inserted = await db
    .prepare("INSERT INTO admin_sessions (id, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(sessionId, Number(admin.id), expiresAt, createdAt)
    .run();

  if (!inserted.success) return json({ ok: false, error: "login_failed" }, 500);

  return new Response(
    JSON.stringify({
      ok: true,
      role: String(admin.role ?? "admin"),
      must_change_password: Number(admin.must_change_password) === 1,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `bb_admin_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
      },
    }
  );
};

export const onRequestGet: PagesFunction = async () => {
  return json({ ok: false, error: "invalid_request" }, 400);
};
