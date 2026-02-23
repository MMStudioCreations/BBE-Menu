import { getCookie, json } from "../auth/_utils";

export type AdminAuth = {
  id: number;
  email: string;
  role: string;
  is_active: number;
  force_password_change: number;
};

export async function ensureAdminAuthSchema(db: D1Database) {
  // Keep the original working system: admins + admin_sessions.
  // Only ensure admin_sessions exists; do NOT attempt ALTERs with non-constant defaults.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      )`
    )
    .run();

  await db.prepare("CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at)").run();
}

function parseDateMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && !Number.isNaN(n)) return n;
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

export async function getAdminFromRequest(request: Request, env: any): Promise<AdminAuth | null> {
  const db = env?.DB as D1Database | undefined;
  if (!db) return null;

  await ensureAdminAuthSchema(db);

  const sessionId =
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "admin_session") ||
    getCookie(request, "bbe_admin_session");

  if (!sessionId) return null;

  // admin_sessions -> admins
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at,
              a.id, a.email,
              COALESCE(a.role,'admin') AS role,
              COALESCE(a.is_active,1) AS is_active,
              COALESCE(a.force_password_change,0) AS force_password_change
       FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       WHERE s.id = ?
       LIMIT 1`
    )
    .bind(sessionId)
    .first<any>();

  if (!row) return null;

  const expiresMs = parseDateMs(row.expires_at);
  if (expiresMs !== null && expiresMs <= Date.now()) {
    // best-effort cleanup
    try {
      await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(sessionId).run();
    } catch {}
    return null;
  }

  if (Number(row.is_active ?? 1) !== 1) return null;

  return {
    id: Number(row.id),
    email: String(row.email || ""),
    role: String(row.role || "admin"),
    is_active: Number(row.is_active || 1),
    force_password_change: Number(row.force_password_change || 0),
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
  if (Number(admin.force_password_change) === 1) {
    return json({ ok: false, error: "password_change_required" }, 403);
  }
  return null;
}