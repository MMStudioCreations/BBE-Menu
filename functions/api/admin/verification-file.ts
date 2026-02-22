import { json } from "../_auth";
import { requireAdminRequest } from "./_helpers";

export const onRequestGet: PagesFunction = async (context) => {
  const { request, env } = context;

  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const key = (url.searchParams.get("key") || "").trim();
  if (!key) return json({ error: "key required" }, 400);

  const obj = await env.VERIFICATIONS.get(key);
  if (!obj) return json({ error: "Not found" }, 404);

  const ct =
    obj.httpMetadata && (obj.httpMetadata as any).contentType
      ? (obj.httpMetadata as any).contentType
      : "application/octet-stream";

  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": ct,
      "cache-control": "no-store",
    },
  });
};
