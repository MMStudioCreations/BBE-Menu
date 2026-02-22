import { hashPassword } from "../../auth/_utils";
import { json, requireOwner } from "../../_auth";

export const onRequestPatch: PagesFunction = async ({ request, env, params }) => {
  const auth = await requireOwner(request, env);
  if (auth instanceof Response) return auth;

  const id = String(params?.id || "").trim();
  if (!id) return json({ ok: false, error: "id_required" }, 400);

  const body = await request.json<any>().catch(() => null);
  const updates: string[] = ["updated_at = ?"];
  const binds: unknown[] = [new Date().toISOString()];

  if (typeof body?.name === "string") { updates.push("name = ?"); binds.push(body.name.trim()); }
  if (typeof body?.is_active !== "undefined") { updates.push("is_active = ?"); binds.push(body.is_active ? 1 : 0); }
  if (typeof body?.role === "string") {
    const role = ["owner", "super_admin", "admin", "staff"].includes(body.role) ? body.role : "admin";
    updates.push("role = ?", "is_super_admin = ?", "is_owner = ?");
    binds.push(role, role === "super_admin" ? 1 : 0, role === "owner" ? 1 : 0);
  }
  if (typeof body?.password === "string" && body.password.length >= 8) {
    updates.push("password_hash = ?");
    binds.push(await hashPassword(body.password));
  }

  if (updates.length === 1) return json({ ok: false, error: "no_changes" }, 400);

  const db = env.DB as D1Database;
  if (body?.role && body.role !== "super_admin") {
    const target = await db.prepare("SELECT id, COALESCE(role, CASE WHEN COALESCE(is_owner,0)=1 THEN 'owner' WHEN COALESCE(is_super_admin,0)=1 THEN 'super_admin' ELSE 'admin' END) AS role FROM admin_users WHERE id=?").bind(id).first<any>();
    if (target && ["super_admin","owner"].includes(String(target.role))) {
      const count = await db.prepare("SELECT COUNT(*) AS c FROM admin_users WHERE COALESCE(is_active,1)=1 AND (COALESCE(role,'') IN ('super_admin','owner') OR COALESCE(is_super_admin,0)=1 OR COALESCE(is_owner,0)=1) AND id != ?").bind(id).first<any>();
      if (Number(count?.c || 0) < 1) return json({ ok:false, error:"cannot_remove_last_owner_or_super_admin" }, 400);
    }
  }

  binds.push(id);
  await db.prepare(`UPDATE admin_users SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction = async ({ request, env, params }) => {
  const auth = await requireOwner(request, env);
  if (auth instanceof Response) return auth;

  const id = String(params?.id || "").trim();
  if (!id) return json({ ok: false, error: "id_required" }, 400);
  if (id === auth.admin.id) return json({ ok: false, error: "cannot_delete_self" }, 400);

  const db = env.DB as D1Database;
  const target = await db.prepare("SELECT id, COALESCE(role, CASE WHEN COALESCE(is_owner,0)=1 THEN 'owner' WHEN COALESCE(is_super_admin,0)=1 THEN 'super_admin' ELSE 'admin' END) AS role FROM admin_users WHERE id=?").bind(id).first<any>();
  if (!target) return json({ ok: false, error: "not_found" }, 404);

  if (["super_admin","owner"].includes(String(target.role))) {
    const count = await db.prepare("SELECT COUNT(*) AS c FROM admin_users WHERE COALESCE(is_active,1)=1 AND (COALESCE(role,'') IN ('super_admin','owner') OR COALESCE(is_super_admin,0)=1 OR COALESCE(is_owner,0)=1) AND id != ?").bind(id).first<any>();
    if (Number(count?.c || 0) < 1) return json({ ok: false, error: "cannot_delete_last_owner_or_super_admin" }, 400);
  }

  const hard = new URL(request.url).searchParams.get("hard") === "1";
  if (hard) {
    await db.prepare("DELETE FROM sessions WHERE admin_user_id = ?").bind(id).run();
    await db.prepare("DELETE FROM admin_users WHERE id = ?").bind(id).run();
  } else {
    await db.prepare("UPDATE admin_users SET is_active = 0, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  }

  return json({ ok: true });
};
