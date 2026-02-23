import { getCookie, json } from "../auth/_utils";
import { ensureAdminAuthSchema } from "./_auth";

function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
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

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env?.DB as D1Database | undefined;
  if (!db) return json({ ok: false, error: "db_missing" }, 500);

  await ensureAdminAuthSchema(db);

  const sessionId =
    getCookie(request, "bb_admin_session") ||
    getCookie(request, "admin_session") ||
    getCookie(request, "bbe_admin_session");

  if (!sessionId) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

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

  if (!row) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": clearCookie("bb_admin_session"),
      },
    });
  }

  const expiresMs = parseDateMs(row.expires_at);
  if (expiresMs !== null && expiresMs <= Date.now()) {
    try {
      await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(sessionId).run();
    } catch {}
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": clearCookie("bb_admin_session"),
      },
    });
  }

  if (Number(row.is_active ?? 1) !== 1) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": clearCookie("bb_admin_session"),
      },
    });
  }

  return json({
    ok: true,
    admin: { id: Number(row.id), email: String(row.email || ""), role: String(row.role || "admin") },
    must_change_password: Number(row.force_password_change ?? 0) === 1,
  });
};