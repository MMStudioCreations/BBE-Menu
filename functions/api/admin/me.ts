const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type SessionsSchemaInfo = {
  fkColumn?: "admin_id" | "user_id";
  columns: string[];
};

type AdminSchemaInfo = {
  table?: "admin_users" | "admins";
  columnsByTable: Record<string, string[]>;
};

function getCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (key !== name) continue;

    const value = trimmed.slice(eqIndex + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function jsonResponse(body: unknown, status: number, setCookie?: string): Response {
  const headers = new Headers(JSON_HEADERS);
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function parseExpiresAt(expiresAt: unknown): number | null {
  if (expiresAt === null || expiresAt === undefined) return null;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) return expiresAt;

  if (typeof expiresAt === "string") {
    const asNumber = Number(expiresAt);
    if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) return asNumber;

    const parsedDate = Date.parse(expiresAt);
    if (!Number.isNaN(parsedDate)) return Math.floor(parsedDate / 1000);
  }

  return null;
}

function withDebug(
  body: Record<string, unknown>,
  debug: boolean,
  debugData: Record<string, unknown>
): Record<string, unknown> {
  if (!debug) return body;
  return {
    ...body,
    debug: debugData,
  };
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";

  const sessionsSchema: SessionsSchemaInfo = { columns: [] };
  const adminSchema: AdminSchemaInfo = { columnsByTable: {} };

  const errorJson = (
    status: number,
    error: string,
    step: string,
    err?: unknown,
    setCookie?: string
  ): Response => {
    const detail = err instanceof Error ? err.message : err ? String(err) : undefined;
    return jsonResponse(
      withDebug({ ok: false, error }, debug, {
        error,
        step,
        detail,
        sessions: {
          fkColumn: sessionsSchema.fkColumn,
          columns: sessionsSchema.columns,
        },
        admin: {
          table: adminSchema.table,
          columnsByTable: adminSchema.columnsByTable,
        },
      }),
      status,
      setCookie
    );
  };

  try {
    const sessionId = getCookie(request, "bb_admin_session");
    const adminSecret = getCookie(request, "bb_admin_secret");

    if (!sessionId || !adminSecret || !adminSecret.startsWith("bb_admin_")) {
      return errorJson(401, "not_authenticated", "parse_cookie");
    }

    if (!env?.DB) {
      return errorJson(500, "db_missing", "env_db");
    }

    try {
      const sessionsColsResult = await env.DB.prepare("PRAGMA table_info(sessions)").all();
      const sessionsRows = Array.isArray(sessionsColsResult?.results)
        ? sessionsColsResult.results
        : [];

      sessionsSchema.columns = sessionsRows
        .map((row: Record<string, unknown>) => String(row.name || ""))
        .filter(Boolean);

      if (sessionsSchema.columns.includes("admin_id")) {
        sessionsSchema.fkColumn = "admin_id";
      } else if (sessionsSchema.columns.includes("user_id")) {
        sessionsSchema.fkColumn = "user_id";
      } else {
        return errorJson(500, "sessions_schema_unknown", "sessions_schema");
      }
    } catch (err) {
      return errorJson(500, "sessions_schema_unknown", "sessions_schema", err);
    }

    let sessionRow: Record<string, unknown> | null = null;
    try {
      const sessionLookup = await env.DB.prepare(
        `SELECT id, ${sessionsSchema.fkColumn} as principal_id, expires_at FROM sessions WHERE id = ? LIMIT 1`
      )
        .bind(sessionId)
        .first();
      sessionRow = (sessionLookup as Record<string, unknown> | null) ?? null;
    } catch (err) {
      return errorJson(500, "session_query_failed", "sessions_query", err);
    }

    if (!sessionRow) {
      return errorJson(
        401,
        "session_not_found",
        "sessions_query",
        undefined,
        clearCookieHeader("bb_admin_session")
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = parseExpiresAt(sessionRow.expires_at);
    if (expiresAt !== null && expiresAt <= nowSeconds) {
      try {
        await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
      } catch {
        // Ignore cleanup failures and continue to return deterministic JSON.
      }

      return errorJson(
        401,
        "session_expired",
        "sessions_query",
        undefined,
        clearCookieHeader("bb_admin_session")
      );
    }

    const principalId = sessionRow.principal_id;
    if (principalId === null || principalId === undefined) {
      return errorJson(
        401,
        "session_not_found",
        "sessions_query",
        undefined,
        clearCookieHeader("bb_admin_session")
      );
    }

    try {
      const adminUsersColsResult = await env.DB.prepare("PRAGMA table_info(admin_users)").all();
      const adminUsersRows = Array.isArray(adminUsersColsResult?.results)
        ? adminUsersColsResult.results
        : [];
      const adminUsersCols = adminUsersRows
        .map((row: Record<string, unknown>) => String(row.name || ""))
        .filter(Boolean);
      adminSchema.columnsByTable.admin_users = adminUsersCols;

      if (adminUsersCols.length > 0) {
        adminSchema.table = "admin_users";
      } else {
        const adminsColsResult = await env.DB.prepare("PRAGMA table_info(admins)").all();
        const adminsRows = Array.isArray(adminsColsResult?.results) ? adminsColsResult.results : [];
        const adminsCols = adminsRows
          .map((row: Record<string, unknown>) => String(row.name || ""))
          .filter(Boolean);
        adminSchema.columnsByTable.admins = adminsCols;
        if (adminsCols.length > 0) {
          adminSchema.table = "admins";
        }
      }

      if (!adminSchema.table) {
        return errorJson(500, "admin_table_missing", "admin_table_detect");
      }
    } catch (err) {
      return errorJson(500, "admin_table_missing", "admin_table_detect", err);
    }

    let admin: Record<string, unknown> | null = null;
    try {
      const table = adminSchema.table;
      const query = `SELECT id, email, COALESCE(role, 'admin') as role, COALESCE(is_active, 1) as is_active, COALESCE(force_password_change, 0) as force_password_change FROM ${table} WHERE id = ? LIMIT 1`;
      admin = ((await env.DB.prepare(query).bind(principalId).first()) as Record<string, unknown> | null) ?? null;
    } catch (err) {
      return errorJson(500, "admin_query_failed", "admin_query", err);
    }

    if (!admin) {
      return errorJson(
        401,
        "admin_not_found",
        "admin_query",
        undefined,
        clearCookieHeader("bb_admin_session")
      );
    }

    if (Number(admin.is_active ?? 1) !== 1) {
      return errorJson(
        403,
        "admin_inactive",
        "admin_query",
        undefined,
        clearCookieHeader("bb_admin_session")
      );
    }

    return jsonResponse(
      {
        ok: true,
        admin: {
          id: admin.id,
          email: admin.email,
          role: admin.role,
        },
        must_change_password: Number(admin.force_password_change ?? 0) === 1,
      },
      200
    );
  } catch (err) {
    return errorJson(500, "internal_error", "unknown", err);
  }
};
