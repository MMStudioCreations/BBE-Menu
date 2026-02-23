import { json } from "../../_auth";
import { getTableColumns, nowIso, sanitizeFilename } from "../../_products";
import { requireAdminRequest } from "../_helpers";

const resolveBucket = (env: Env): R2Bucket | undefined => env.BBE_IMAGES as R2Bucket | undefined;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireAdminRequest(request, env);
  if (!auth.ok) return auth.response;

  const db = env.DB as D1Database;
  const bucket = resolveBucket(env as Env);
  if (!bucket) {
    return json({ ok: false, error: "no_r2_configured", hint: "Bind R2 bucket as BBE_IMAGES in Pages settings" }, 500);
  }
  try {
    const form = await request.formData();
    const fileEntry = form.get("file");
    const productId = String(form.get("product_id") || "").trim();

    if (!(fileEntry instanceof File)) return json({ ok: false, error: "missing_file" }, 400);
    if (!productId) return json({ ok: false, error: "missing_product_id" }, 400);
    if (!fileEntry.type.startsWith("image/")) return json({ ok: false, error: "invalid_type" }, 400);
    if (fileEntry.size > 5 * 1024 * 1024) return json({ ok: false, error: "file_too_large" }, 400);

    const cleanedName = sanitizeFilename(fileEntry.name || "upload");
    const key = `products/${productId}/${Date.now()}-${cleanedName}`;

    await bucket.put(key, await fileEntry.arrayBuffer(), {
      httpMetadata: { contentType: fileEntry.type },
    });

    const publicBase = String((env as any).PUBLIC_IMAGE_BASE_URL || "").trim().replace(/\/+$/, "");
    const proxyPath = `/api/images/${encodeURIComponent(key)}`;
    const url = publicBase ? `${publicBase}/${key}` : proxyPath;

    const columns = await getTableColumns(db, "products");
    const updates: string[] = [];
    const binds: unknown[] = [];

    if (columns.has("image_key")) {
      updates.push("image_key = ?");
      binds.push(key);
    }
    if (columns.has("image_url")) {
      updates.push("image_url = ?");
      binds.push(url);
    }
    if (columns.has("image_path")) {
      updates.push("image_path = ?");
      binds.push(proxyPath);
    }
    if (columns.has("updated_at")) {
      updates.push("updated_at = ?");
      binds.push(nowIso());
    }

    if (updates.length) {
      await db
        .prepare(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...binds, productId)
        .run();
    }

    return json({ ok: true, key, url: proxyPath });
  } catch (error) {
    console.error("upload-image failed", error);
    return json({ ok: false, error: "upload_failed" }, 500);
  }
};
