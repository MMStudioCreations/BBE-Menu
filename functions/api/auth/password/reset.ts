import { hashPassword, json } from "../_utils";

export const onRequestPost: PagesFunction = async (context) => {
  try {
    const { request, env } = context;
    const db = env.DB as D1Database;
    if (!db) return json({ ok: false, error: "DB binding missing" }, 500);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const token = String(body?.token || "").trim();
    const newPassword = String(body?.newPassword || "");
    const confirmPassword = String(body?.confirmPassword || "");

    if (!token) return json({ ok: false, error: "invalid_or_expired" }, 400);
    if (newPassword.length < 10) return json({ ok: false, error: "password_too_short" }, 400);
    if (confirmPassword && newPassword !== confirmPassword) return json({ ok: false, error: "password_mismatch" }, 400);

    const tokenHash = await sha256Hex(token);
    const tokenRow = await db
      .prepare(
        `SELECT id, user_id, expires_at, used_at
         FROM password_reset_tokens
         WHERE token_hash = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(tokenHash)
      .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();

    if (!tokenRow) return json({ ok: false, error: "invalid_or_expired" }, 400);
    if (tokenRow.used_at) return json({ ok: false, error: "invalid_or_expired" }, 400);
    if (Date.parse(tokenRow.expires_at) <= Date.now()) return json({ ok: false, error: "invalid_or_expired" }, 400);

    const newHash = await hashPassword(newPassword);
    const now = new Date().toISOString();

    await db.batch([
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, tokenRow.user_id),
      db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").bind(now, tokenRow.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(tokenRow.user_id),
    ]);

    console.log("[auth/password/reset] password reset success", { userId: tokenRow.user_id });
    return json({ ok: true });
  } catch (err) {
    console.error("[auth/password/reset] error", err);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}
