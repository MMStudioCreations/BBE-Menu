import { getCookie, json } from "../auth/_utils";

export type AdminAuth = {
  id: string;
  email: string;
  role: string;
  is_active: number;
  force_password_change: number;
};

export async function ensureAdminAuthSchema(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        is_active INTEGER NOT NULL DEFAULT 1,
        force_password_change INTEGER NOT NULL DEFAULT 1,
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

  const pragma = await db.prepare("PRAGMA table_info(admin_users)").all<any>();
  const columns = new Set((pragma.results || []).map((r: any) => String(r.name || "").toLowerCase()));

  const addCol = async (name: string, ddl: string) => {
    if (columns.has(name)) return;
    await db.prepare(ddl).run();
    columns.add(name);
  };

  await addCol("id", "ALTER TABLE admin_users ADD COLUMN id TEXT");
  await addCol("email", "ALTER TABLE admin_users ADD COLUMN email TEXT");
  await addCol("password_hash", "ALTER TABLE admin_users ADD COLUMN password_hash TEXT");
  await addCol("role", "ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  await addCol("is_active", "ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  await addCol(
    "force_password_change",
    "ALTER TABLE admin_users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 1"
  );

  // D1/SQLite rejects ALTER TABLE ADD COLUMN with non-constant defaults
  // (e.g. DEFAULT (datetime('now'))), so add timestamp columns as nullable.
  await addCol("created_at", "ALTER TABLE admin_users ADD COLUMN created_at TEXT");
  await addCol("updated_at", "ALTER TABLE admin_users ADD COLUMN updated_at TEXT");

  await db
    .prepare(
      `UPDATE admin_users
       SET created_at = COALESCE(created_at, datetime('now')),
           updated_at = COALESCE(updated_at, datetime('now'))
       WHERE created_at IS NULL OR updated_at IS NULL`
    )
    .run();
}

async function getSessionAdminFromSessions(
  db: D1Database,
  sessionId: string,
  cookieName: string
): Promise<any | null> {
  try {
    const sessionsInfo = await db.prepare("PRAGMA table_info(sessions)").all<any>();
    const sessionColumns = new Set((sessionsInfo.results || []).map((r: any) => String(r?.name || "").toLowerCase()));

    if (!sessionColumns.size) return null;

    const joinColumn = sessionColumns.has("admin_user_id")
      ? "admin_user_id"
      : sessionColumns.has("user_id")
      ? "user_id"
      : null;
    if (!joinColumn) return null;

    const typeColumn = sessionColumns.has("session_type")
      ? "session_type"
      : sessionColumns.has("type")
      ? "type"
      : null;

    const hasExpiresAt = sessionColumns.has("expires_at");

    const adminCookieNames = new Set(["bb_admin_session", "admin_session", "bbe_admin_session"]);
    if (!typeColumn && !adminCookieNames.has(cookieName)) {
      return null;
    }

    const whereClauses = ["s.id = ?", "COALESCE(a.is_active,1) = 1"];
    if (typeColumn) {
      whereClauses.push(`lower(COALESCE(s.${typeColumn}, '')) = 'admin'`);
    }
    if (hasExpiresAt) {
      whereClauses.push("s.expires_at > datetime('now')");
    }

    const sql = `SELECT a.id, a.email, a.role, COALESCE(a.is_active,1) AS is_active,
                        COALESCE(a.force_password_change,0) AS force_password_change
                 FROM sessions s
                 JOIN admin_users a ON a.id = s.${joinColumn}
                 WHERE ${whereClauses.join(" AND ")}
                 LIMIT 1`;

    return await db.prepare(sql).bind(sessionId).first<any>();
  } catch {
    return null;
  }
}

async function getSessionAdminFromLegacySessions(db: D1Database, sessionId: string): Promise<any | null> {
  return db
    .prepare(
      `SELECT a.id, a.email, a.role, COALESCE(a.is_active,1) AS is_active,
              COALESCE(a.force_password_change,0) AS force_password_change
       FROM admin_sessions s
       JOIN admin_users a ON a.id = s.admin_id
       WHERE s.id = ? AND s.expires_at > datetime('now')
       LIMIT 1`
    )
    .bind(sessionId)
    .first<any>();
}

export async function getAdminFromRequest(request: Request, env: any): Promise<AdminAuth | null> {
  const db = env.DB as D1Database;
  if (!db) return null;
  try {
    await ensureAdminAuthSchema(db);
  } catch {
    return null;
  }

  const adminCookieNames = ["bb_admin_session", "admin_session", "bbe_admin_session"] as const;
  let sessionId: string | null = null;
  let sessionCookieName: (typeof adminCookieNames)[number] | null = null;
  for (const cookieName of adminCookieNames) {
    const value = getCookie(request, cookieName);
    if (value) {
      sessionId = value;
      sessionCookieName = cookieName;
      break;
    }
  }
  if (!sessionId || !sessionCookieName) return null;

  let admin: any | null = null;
  try {
    admin = await getSessionAdminFromSessions(db, sessionId, sessionCookieName);
  } catch {
    admin = null;
  }
  if (!admin) {
    admin = await getSessionAdminFromLegacySessions(db, sessionId);
  }

  if (!admin) return null;
  if (Number(admin.is_active) !== 1) return null;

  return {
    id: String(admin.id || ""),
    email: String(admin.email || ""),
    role: String(admin.role || "admin"),
    is_active: Number(admin.is_active || 1),
    force_password_change: Number(admin.force_password_change || 0),
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
