export type AdminAuthorization = {
  authorized: boolean;
  role: string | null;
};

type UserRow = Record<string, unknown>;

function normalizeRole(value: unknown): string | null {
  const role = String(value || "").trim().toLowerCase();
  if (!role) return null;
  if (role === "superadmin") return "super_admin";
  return role;
}

function hasAdminRole(role: string | null) {
  return role === "admin" || role === "super_admin" || role === "owner";
}

function isTruthy(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "y" || text === "on";
}

function emailAllowlistFromEnv(env: any) {
  const raw = String(env?.ADMIN_EMAILS || "");
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function getUsersColumns(db: D1Database) {
  const pragma = await db.prepare("PRAGMA table_info(users)").all<any>();
  return new Set((pragma.results || []).map((row: any) => String(row?.name || "").toLowerCase()));
}

export async function authorizeAdminUser(user: UserRow, db: D1Database, env: any): Promise<AdminAuthorization> {
  const email = String(user?.email || "").trim().toLowerCase();
  const columns = await getUsersColumns(db);

  const roleColumns = ["role"];
  const adminFlagColumns = ["is_admin", "isadmin", "admin", "is_super_admin", "super_admin"];
  const permissionsColumns = ["permissions"];

  const hasRoleColumn = roleColumns.some((column) => columns.has(column));
  const hasAdminFlagColumn = adminFlagColumns.some((column) => columns.has(column));
  const hasPermissionsColumn = permissionsColumns.some((column) => columns.has(column));

  if (hasRoleColumn || hasAdminFlagColumn || hasPermissionsColumn) {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(user || {})) {
      normalized[key.toLowerCase()] = value;
    }

    const role = normalizeRole(normalized.role);
    if (hasAdminRole(role)) return { authorized: true, role };

    for (const col of adminFlagColumns) {
      if (columns.has(col) && isTruthy(normalized[col])) {
        return { authorized: true, role: "admin" };
      }
    }

    if (columns.has("permissions")) {
      const permissions = String(normalized.permissions || "").toLowerCase();
      if (permissions.includes("admin") || permissions.includes("superadmin") || permissions.includes("super_admin")) {
        return { authorized: true, role: "admin" };
      }
    }

    return { authorized: false, role: role || null };
  }

  const allowlistedEmails = emailAllowlistFromEnv(env);
  if (email && allowlistedEmails.has(email)) {
    return { authorized: true, role: "admin" };
  }

  return { authorized: false, role: null };
}
