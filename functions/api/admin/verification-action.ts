import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const user_id = String(body?.user_id || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();
  const reason = body?.reason == null ? null : String(body.reason).trim() || null;

  if (!user_id) return json({ error: "user_id required" }, 400);
  if (!["approve", "deny", "pending", "reject"].includes(action)) {
    return json({ error: "action must be approve|deny|pending" }, 400);
  }

  const db = env.DB as D1Database;
  const now = new Date().toISOString();
  const adminId = auth.admin.id;

  let accountStatus: "approved" | "denied" | "pending";
  if (action === "approve") {
    accountStatus = "approved";
  } else if (action === "deny" || action === "reject") {
    accountStatus = "denied";
  } else {
    accountStatus = "pending";
  }

  const verifiedAt = accountStatus === "approved" ? now : null;
  const verifiedByAdminId = accountStatus === "approved" ? adminId : null;
  const statusReason = accountStatus === "denied" ? reason : null;

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
    .bind(accountStatus, verifiedAt, verifiedByAdminId, statusReason, now, user_id)
    .run();

  await db
    .prepare(
      `INSERT INTO user_verification (user_id, status, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .bind(user_id, accountStatus, now)
    .run();

  const updatedUser = await db
    .prepare("SELECT account_status, verified_at, status_reason FROM users WHERE id = ?")
    .bind(user_id)
    .first<{ account_status: string; verified_at: string | null; status_reason: string | null }>();

  return json({
    ok: true,
    account_status: updatedUser?.account_status || accountStatus,
    verified_at: updatedUser?.verified_at || verifiedAt,
    status_reason: updatedUser?.status_reason ?? statusReason,
  });
};
