import { json, requireAdmin, verifyAdminCredential } from "../_auth";

const makeCookie = (secret: string) => `bb_admin_secret=${encodeURIComponent(secret)}; HttpOnly; Secure; SameSite=Lax; Path=/`;

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  return json({ ok: requireAdmin(request, env) });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const secret = String(body?.secret || "").trim();
  const username = String(body?.username || "admin").trim() || "admin";
  if (!verifyAdminCredential(env, secret, username)) {
    return json({ ok: false, error: "invalid" }, 401);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": makeCookie(secret),
    },
  });
};
