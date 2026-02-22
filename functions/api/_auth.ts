export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return p.substring(name.length + 1);
  }
  return null;
}

export async function getSessionUserId(request: Request, env: any): Promise<string | null> {
  const sessionId = getCookie(request, "bb_session");
  if (!sessionId) return null;

  const db = env.DB as D1Database;
  const session = await db
    .prepare("SELECT user_id, expires_at, COALESCE(session_type, 'user') AS session_type FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<any>();

  if (!session) return null;
  if (Date.parse(session.expires_at) < Date.now()) return null;
  if (String(session.session_type || "user") !== "user") return null;

  return session.user_id || null;
}

export async function getVerificationStatus(userId: string, env: any): Promise<string> {
  const db = env.DB as D1Database;
  const row = await db
    .prepare("SELECT account_status FROM users WHERE id = ?")
    .bind(userId)
    .first<{ account_status?: string }>();

  return row?.account_status || "pending";
}

export type AdminAuthInfo = {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "admin" | "staff";
  is_super_admin: number;
};

async function getAdminSession(request: Request, env: any): Promise<AdminAuthInfo | null> {
  const sessionId =
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "bbe_admin_session") ||
    getCookie(request, "bb_session");
  if (!sessionId) return null;

  const db = env.DB as D1Database;
  const session = await db
    .prepare(`SELECT admin_user_id, expires_at, COALESCE(session_type, 'user') AS session_type FROM sessions WHERE id = ?`)
    .bind(sessionId)
    .first<any>();

  if (!session || !session.admin_user_id || String(session.session_type) !== "admin") return null;
  if (Date.parse(String(session.expires_at || "")) < Date.now()) return null;

  const admin = await db
    .prepare("SELECT id, email, name, COALESCE(role, CASE WHEN COALESCE(is_super_admin,0)=1 THEN 'super_admin' ELSE 'admin' END) AS role, COALESCE(is_super_admin, 0) AS is_super_admin, COALESCE(is_active, 1) AS is_active FROM admin_users WHERE id = ?")
    .bind(session.admin_user_id)
    .first<any>();

  if (!admin || Number(admin.is_active) !== 1) return null;

  const role = String(admin.role || "admin").toLowerCase();
  const normalizedRole = (role === "super_admin" || role === "staff") ? role : "admin";
  const isSuperAdmin = normalizedRole === "super_admin" || Number(admin.is_super_admin || 0) === 1;

  return {
    id: String(admin.id),
    email: String(admin.email),
    name: admin.name ? String(admin.name) : null,
    role: isSuperAdmin ? "super_admin" : (normalizedRole as "admin" | "staff"),
    is_super_admin: isSuperAdmin ? 1 : 0,
  };
}

export async function requireAdmin(request: Request, env: any): Promise<{ admin: AdminAuthInfo } | Response> {
  const admin = await getAdminSession(request, env);
  if (!admin) return json({ ok: false, error: "forbidden" }, 403);
  return { admin };
}

export async function requireSuperAdmin(request: Request, env: any): Promise<{ admin: AdminAuthInfo } | Response> {
  const required = await requireAdmin(request, env);
  if (required instanceof Response) return required;
  if (Number(required.admin.is_super_admin) !== 1) {
    return json({ ok: false, error: "super_admin_required" }, 403);
  }
  return required;
}
