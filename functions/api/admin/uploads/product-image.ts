import { json } from "../../_auth";
import { requireAdminRequest } from "../_helpers";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const bucket = env.R2_IMAGES as R2Bucket | undefined;
  if (!bucket) return json({ ok: false, error: "no_r2_configured" }, 400);

  const form = await request.formData();
  const file = form.get("image");
  const productId = String(form.get("productId") || crypto.randomUUID());
  if (!(file instanceof File)) return json({ ok: false, error: "image_required" }, 400);
  if (!file.type.startsWith("image/")) return json({ ok: false, error: "invalid_type" }, 400);
  if (file.size > 5 * 1024 * 1024) return json({ ok: false, error: "file_too_large" }, 400);

  const ext = (file.name.split('.').pop() || "bin").toLowerCase();
  const key = `products/${productId}/${Date.now()}.${ext}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  return json({ ok: true, image_key: key, public_url: `/api/images/${encodeURIComponent(key)}` });
};
