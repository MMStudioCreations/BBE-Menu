export const onRequestGet: PagesFunction = async (context) => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  try {
    const db = (context.env as any).DB as D1Database | undefined;
    if (!db) {
      return new Response(JSON.stringify({ ok: false, error: "env.DB is missing" }), {
        status: 500,
        headers,
      });
    }

    const usersCountRow = await db.prepare("SELECT COUNT(*) AS c FROM users;").first<{ c: number | string | null }>();
    const newestEmailRow = await db
      .prepare("SELECT email FROM users ORDER BY created_at DESC LIMIT 1;")
      .first<{ email: string | null }>();

    const usersCount = Number(usersCountRow?.c ?? 0);

    return new Response(
      JSON.stringify({
        ok: true,
        users_count: Number.isFinite(usersCount) ? usersCount : 0,
        newest_email: newestEmailRow?.email ?? null,
      }),
      { status: 200, headers },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers,
    });
  }
};
