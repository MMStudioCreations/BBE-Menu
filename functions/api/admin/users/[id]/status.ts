import { json } from "../../../_auth";
import { requireAdminRequest } from "../../_helpers";

const VALID_STATUSES = new Set(["approved", "denied", "pending"]);

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env, params } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const userId = String(params?.id || "").trim();
  if (!userId) return json({ error: "user id required" }, 400);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const accountStatus = String(body?.account_status || "").trim().toLowerCase();
  const statusReason = body?.status_reason == null ? null : String(body.status_reason).trim() || null;

  if (!VALID_STATUSES.has(accountStatus)) {
    return json({ error: "account_status must be approved|denied|pending" }, 400);
  }

  const db = env.DB as D1Database;
  const now = new Date().toISOString();
  const adminId = auth.admin.id;

  const verifiedAt = accountStatus === "approved" ? now : null;
  const verifiedByAdminId = accountStatus === "approved" ? adminId : null;
  const reasonToSave = accountStatus === "denied" ? statusReason : null;

  const userExists = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!userExists) return json({ error: "User not found" }, 404);

  await db
    .prepare(
      `UPDATE users
       SET account_status = ?,
           verified_at = ?,
           verified_by_admin_id = ?,
           status_reason = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(accountStatus, verifiedAt, verifiedByAdminId, reasonToSave, now, userId)
    .run();

  await db
    .prepare(
      `INSERT INTO user_verification (user_id, status, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .bind(userId, accountStatus, now)
    .run();

  const user = await db
    .prepare(
      `SELECT
        id,
        account_status,
        verified_at,
        verified_by_admin_id,
        status_reason,
        updated_at
      FROM users
      WHERE id = ?`
    )
    .bind(userId)
    .first();

  return json({ ok: true, user });
};
