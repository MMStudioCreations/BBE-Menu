import { getCookie, json } from "../auth/_utils";

export type AdminAuth = {
  id: string;
  email: string;
  role: string;
  is_active: number;
  must_change_password: number;
};

export async function ensureAdminAuthSchema(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        is_active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        created_at TEXT,
        updated_at TEXT
      )`
    )
    .run();

  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at)").run();
}

export async function getAdminFromRequest(request: Request, env: any): Promise<AdminAuth | null> {
  const db = env.DB as D1Database;
  if (!db) return null;
  try {
    await ensureAdminAuthSchema(db);
  } catch {
    return null;
  }

  const sessionId = getCookie(request, "bb_admin_session");
  if (!sessionId) return null;

  const session = await db
    .prepare("SELECT id, admin_id, expires_at FROM admin_sessions WHERE id=? LIMIT 1")
    .bind(sessionId)
    .first<{ id: string; admin_id: string; expires_at: string }>();

  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;


  const admin = await db
    .prepare(
      `SELECT a.id, a.email,
              COALESCE(a.role,'admin') AS role,
              COALESCE(a.is_active,1) AS is_active,
              COALESCE(a.must_change_password,0) AS must_change_password
       FROM admins a
       WHERE a.id = ?
       LIMIT 1`
    )
    .bind(session.admin_id)
    .first<any>();

  if (!admin) return null;
  if (Number(admin.is_active) !== 1) return null;

  return {
    id: String(admin.id || ""),
    email: String(admin.email || ""),
    role: String(admin.role || "admin"),
    is_active: Number(admin.is_active || 1),
    must_change_password: Number(admin.must_change_password || 0),
  };
}

export async function requireAdmin(request: Request, env: any): Promise<AdminAuth | Response> {
  const admin = await getAdminFromRequest(request, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401);
  return admin;
}

export async function requireSuperAdmin(request: Request, env: any): Promise<AdminAuth | Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const role = String(admin.role || "").toLowerCase();
  if (role !== "superadmin" && role !== "super_admin" && role !== "owner") {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  return admin;
}

export function requirePasswordReady(admin: AdminAuth): Response | null {
  if (Number(admin.must_change_password) === 1) {
    return json({ ok: false, error: "password_change_required" }, 403);
  }
  return null;
}
