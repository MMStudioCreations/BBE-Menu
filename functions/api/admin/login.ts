import { verifyPassword } from "../auth/_utils";

type LoginErrorCode =
  | "db_missing"
  | "invalid_request"
  | "invalid_credentials"
  | "account_deactivated"
  | "login_failed";

type ErrorStep = "parse_json" | "query_admins" | "verify_password" | "insert_session";

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

function errorResponse(
  request: Request,
  status: number,
  error: LoginErrorCode,
  step?: ErrorStep,
  err?: unknown
) {
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const body: Record<string, unknown> = { ok: false, error };

  if (debug) {
    const e = err instanceof Error ? err : undefined;
    body.debug = {
      step,
      detail: e?.message ?? String(err ?? "unknown_error"),
      stack: e?.stack,
    };
  }

  return jsonResponse(body, status);
}

export const onRequestGet: PagesFunction = async ({ request }) => {
  return errorResponse(request, 405, "invalid_request");
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  void params;

  let step: ErrorStep | undefined;

  try {
    const db = env.DB as D1Database | undefined;
    if (!db) {
      return jsonResponse({ ok: false, error: "db_missing" }, 500);
    }

    step = "parse_json";
    const body = (await request.json()) as { email?: string; password?: string };
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return errorResponse(request, 400, "invalid_request", step);
    }

    step = "query_admins";

    const admin = await db
      .prepare(
        `SELECT id, email, password_hash,
                COALESCE(is_active,1) AS is_active,
                COALESCE(role,'admin') AS role,
                COALESCE(must_change_password,0) AS must_change_password
         FROM admins
         WHERE lower(email)=lower(?)
         LIMIT 1`
      )
      .bind(email)
      .first<{
        id: string;
        email: string;
        password_hash: string;
        is_active: number;
        role: string;
        must_change_password: number;
      }>();

    if (!admin) {
      return errorResponse(request, 401, "invalid_credentials", step);
    }

    if (Number(admin.is_active) === 0) {
      return errorResponse(request, 403, "account_deactivated", step);
    }

    step = "verify_password";
    const isValidPassword = await verifyPassword(password, String(admin.password_hash ?? ""));
    if (!isValidPassword) {
      return errorResponse(request, 401, "invalid_credentials", step);
    }

    step = "insert_session";
    const sessionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS admin_sessions (
          id TEXT PRIMARY KEY,
          admin_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`
      )
      .run();

    await db
      .prepare(`INSERT INTO admin_sessions (id, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
      .bind(sessionId, String(admin.id), expiresAt, createdAt)
      .run();

    return jsonResponse(
      {
        ok: true,
        admin: {
          id: String(admin.id),
          email: String(admin.email),
          role: String(admin.role || "admin"),
        },
        must_change_password: Number(admin.must_change_password) === 1,
      },
      200,
      {
        "set-cookie": `bb_admin_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
      }
    );
  } catch (err) {
    return errorResponse(request, 500, "login_failed", step, err);
  }
};
