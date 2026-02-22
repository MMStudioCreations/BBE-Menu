export function adminAuthJson(
  data: unknown,
  status = 200,
  phase = "unknown",
  err = "none",
  errMsg = ""
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "X-BB-Phase": phase,
      "X-BB-Err": err,
      "X-BB-ErrMsg": errMsg,
    },
  });
}

export function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

type SessionColumn = { name?: string | null };

export async function ensureAdminSessionSchema(db: D1Database) {
  const pragmaRows = await db.prepare("PRAGMA table_info(sessions)").all<SessionColumn>();
  const columns = new Set((pragmaRows.results || []).map((row) => String(row.name || "")).filter(Boolean));

  const missingColumns: Array<{ name: string; ddl: string }> = [];
  if (!columns.has("created_at")) missingColumns.push({ name: "created_at", ddl: "ALTER TABLE sessions ADD COLUMN created_at TEXT" });
  if (!columns.has("ip")) missingColumns.push({ name: "ip", ddl: "ALTER TABLE sessions ADD COLUMN ip TEXT" });
  if (!columns.has("user_agent")) missingColumns.push({ name: "user_agent", ddl: "ALTER TABLE sessions ADD COLUMN user_agent TEXT" });
  if (!columns.has("admin_user_id")) missingColumns.push({ name: "admin_user_id", ddl: "ALTER TABLE sessions ADD COLUMN admin_user_id TEXT" });
  if (!columns.has("session_type")) {
    missingColumns.push({ name: "session_type", ddl: "ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'user'" });
  }

  for (const column of missingColumns) {
    try {
      await db.prepare(column.ddl).run();
    } catch (err) {
      const msg = getErrorMessage(err).toLowerCase();
      if (!msg.includes("duplicate column") && !msg.includes(`duplicate column name: ${column.name}`)) {
        throw err;
      }
    }
  }
}


export async function ensureAdminUserSchema(db: D1Database) {
  const pragmaRows = await db.prepare("PRAGMA table_info(admin_users)").all<SessionColumn>();
  const columns = new Set((pragmaRows.results || []).map((row) => String(row.name || "")).filter(Boolean));
  if (!columns.has("role")) {
    try {
      await db.prepare("ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'").run();
      await db.prepare("UPDATE admin_users SET role = CASE WHEN COALESCE(is_super_admin,0)=1 THEN 'super_admin' ELSE 'admin' END WHERE role IS NULL OR role = ''").run();
    } catch (err) {
      const msg = getErrorMessage(err).toLowerCase();
      if (!msg.includes("duplicate column")) throw err;
    }
  }
  if (!columns.has("is_owner")) {
    try {
      await db.prepare("ALTER TABLE admin_users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0").run();
    } catch (err) {
      const msg = getErrorMessage(err).toLowerCase();
      if (!msg.includes("duplicate column")) throw err;
    }
  }
}
