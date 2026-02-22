import { requireAdmin, json } from "../_auth";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  if (Number(auth.admin.is_owner || 0) !== 1 && Number(auth.admin.is_super_admin || 0) !== 1) {
    return json({ ok: false, error: "forbidden", code: "FORBIDDEN" }, 403);
  }

  return json({
    ok: true,
    bindings: {
      DB: !!env.DB,
      R2: !!(env.PRODUCT_IMAGES || env.R2 || env.IMAGES_BUCKET),
      RESEND_API_KEY: !!env.RESEND_API_KEY,
      MAIL_FROM: String(env.MAIL_FROM || "budtender@bobbyblacknyc.com"),
      SITE_URL: String(env.SITE_URL || "https://bobbyblacknyc.com"),
      OWNER_EMAIL: !!String(env.OWNER_EMAIL || "").trim(),
    },
  });
};
