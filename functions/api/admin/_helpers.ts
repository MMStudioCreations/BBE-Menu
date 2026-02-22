import { getCookie, json } from "../_auth";

export const TIERS = new Set(["member", "insider", "elite", "reserve"]);

export const requireAdminSession = async (request: Request, env: any) => {
  const db = env.DB as D1Database;
  const sessionId = getCookie(request, "bb_session");
  if (!sessionId) return null;

  const session = await db
    .prepare(`SELECT id, admin_user_id, expires_at, COALESCE(session_type, 'user') AS session_type FROM sessions WHERE id = ?`)
    .bind(sessionId)
    .first<any>();

  if (!session || !session.admin_user_id || String(session.session_type) !== "admin") return null;
  if (Date.parse(session.expires_at) < Date.now()) return null;

  const admin = await db
    .prepare("SELECT id, email, name, role, is_active FROM admin_users WHERE id = ?")
    .bind(session.admin_user_id)
    .first<any>();

  if (!admin || Number(admin.is_active) !== 1) return null;
  return admin;
};

export const requireAdminRequest = async (request: Request, env: any) => {
  const admin = await requireAdminSession(request, env);
  if (!admin) return { ok: false as const, response: json({ error: "Forbidden" }, 403) };
  return { ok: true as const, admin };
};

export const nowIso = () => new Date().toISOString();
