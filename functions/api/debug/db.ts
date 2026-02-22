import { requireAdminSession } from "../admin/_helpers";

export const onRequestGet: PagesFunction = async (context) => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  try {
    if (!(await requireAdminSession(context.request, context.env))) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers });
    }

    const db = (context.env as any).DB as D1Database | undefined;
    if (!db) return new Response(JSON.stringify({ ok: false, error: "env.DB missing" }), { status: 500, headers });

    const usersCountRow = await db.prepare("SELECT COUNT(*) c FROM users").first<{ c: number | string | null }>();
    const newestUserRow = await db.prepare("SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 1").first<{ email: string | null; created_at: string | null }>();
    const resetTokensCountRow = await db.prepare("SELECT COUNT(*) c FROM password_reset_tokens").first<{ c: number | string | null }>();

    return new Response(JSON.stringify({
      ok: true,
      users_count: Number(usersCountRow?.c ?? 0),
      newest_user_email: newestUserRow?.email ?? null,
      newest_user_created_at: newestUserRow?.created_at ?? null,
      reset_tokens_count: Number(resetTokensCountRow?.c ?? 0),
    }), { status: 200, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), { status: 500, headers });
  }
};
