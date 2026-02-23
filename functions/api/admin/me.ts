import { getCookie } from "../auth/_utils";
import { ensureAdminAuthSchema, getAdminPasswordChangeColumn } from "./_auth";

const CLEAR_COOKIE = "bb_admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  const baseHeaders = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });

  if (headers) {
    const extras = new Headers(headers);
    extras.forEach((value, key) => baseHeaders.append(key, value));
  }

  return new Response(JSON.stringify(payload), { status, headers: baseHeaders });
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const db = env.DB as D1Database | undefined;
  if (!db) return jsonResponse({ ok: false, error: "db_missing" }, 500);

  await ensureAdminAuthSchema(db);

  const sessionId = getCookie(request, "bb_admin_session");
  if (!sessionId) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401, { "set-cookie": CLEAR_COOKIE });
  }

  const passwordChangeColumn = await getAdminPasswordChangeColumn(db);

  const session = await db
    .prepare("SELECT id, admin_id, expires_at FROM admin_sessions WHERE id=? LIMIT 1")
    .bind(sessionId)
    .first<{ id: string; admin_id: string; expires_at: string }>();

  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401, { "set-cookie": CLEAR_COOKIE });
  }

  const admin = await db
    .prepare(
      `SELECT a.id, a.email, COALESCE(a.role,'admin') AS role,
              COALESCE(a.is_active,1) AS is_active,
              COALESCE(a.${passwordChangeColumn},0) AS must_change_password
       FROM admins a
       WHERE a.id = ?
       LIMIT 1`
    )
    .bind(session.admin_id)
    .first<{ id: string; email: string; role: string; is_active: number; must_change_password: number }>();

  if (!admin) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401, { "set-cookie": CLEAR_COOKIE });
  }

  if (Number(admin.is_active) !== 1) {
    return jsonResponse({ ok: false, error: "forbidden" }, 403, { "set-cookie": CLEAR_COOKIE });
  }

  return jsonResponse(
    {
      ok: true,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
      must_change_password: Number(admin.must_change_password) === 1,
    },
    200
  );
};
