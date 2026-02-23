import { json } from "../../_auth";
import { nowIso } from "../../_products";
import { requireAdminRequest } from "../_helpers";

const resolveBucket = (env: Env): R2Bucket | undefined => env.BBE_IMAGES as R2Bucket | undefined;

const isDebugEnabled = (request: Request) => {
  const url = new URL(request.url);
  return url.searchParams.get("debug") === "1";
};

const sanitizeUploadFilename = (name: string) =>
  String(name || "file")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "") || "file";

const errorJson = (request: Request, error: string, status: number, detail?: string) => {
  if (isDebugEnabled(request) && detail) return json({ ok: false, error, detail }, status);
  return json({ ok: false, error }, status);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await requireAdminRequest(request, env);
    if (!auth.ok) return auth.response;

    const db = env.DB as D1Database | undefined;

    const form = await request.formData();
    const fileEntry = form.get("file");
    const productId = String(form.get("product_id") || "").trim();

    if (fileEntry === null) return errorJson(request, "missing_file", 400);
    if (!productId) return errorJson(request, "missing_product_id", 400);
    if (!(fileEntry instanceof File)) return errorJson(request, "invalid_file", 400);
    if (!fileEntry.type.startsWith("image/")) return json({ ok: false, error: "invalid_type" }, 400);
    if (fileEntry.size > 5 * 1024 * 1024) return json({ ok: false, error: "file_too_large" }, 400);

    const bucket = resolveBucket(env as Env);
    if (!bucket) {
      return errorJson(request, "no_r2_configured", 500, "step=no_r2_configured: missing env.BBE_IMAGES binding");
    }

    const cleanedName = sanitizeUploadFilename(fileEntry.name || "upload");
    const key = `products/${productId}/${Date.now()}-${cleanedName}`;
    const buf = await fileEntry.arrayBuffer();

    try {
      await bucket.put(key, buf, {
        httpMetadata: { contentType: fileEntry.type },
      });
    } catch (error: any) {
      return errorJson(request, "upload_failed", 500, `step=r2_put_failed: ${error?.message || String(error)}`);
    }

    const url = `/api/images/${encodeURIComponent(key)}`;

    let dbWarning: string | null = null;
    if (db) {
      try {
        const pragma = await db.prepare("PRAGMA table_info(products)").all<any>();
        const columns = new Set(
          (pragma.results || [])
            .map((column: any) => String(column?.name || "").toLowerCase())
            .filter(Boolean)
        );
        const updates: string[] = [];
        const binds: unknown[] = [];

        if (columns.has("image_key")) {
          updates.push("image_key = ?");
          binds.push(key);
        }
        if (columns.has("image_path")) {
          updates.push("image_path = ?");
          binds.push(url);
        }
        if (columns.has("image_url")) {
          updates.push("image_url = ?");
          binds.push(url);
        }
        if (columns.has("updated_at")) {
          updates.push("updated_at = ?");
          binds.push(nowIso());
        }

        if (updates.length) {
          const updateResult = await db
            .prepare(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`)
            .bind(...binds, productId)
            .run();
          if (!updateResult.meta?.changes) {
            dbWarning = "step=db_update_no_rows: no products row updated";
          }
        }
      } catch (error: any) {
        dbWarning = `step=db_update_failed: ${error?.message || String(error)}`;
      }
    } else {
      dbWarning = "step=db_binding_missing: env.DB not configured";
    }

    if (isDebugEnabled(request) && dbWarning) {
      return json({ ok: true, key, url, warning: dbWarning });
    }
    return json({ ok: true, key, url });
  } catch (error: any) {
    console.error("upload-image failed", error);
    return errorJson(request, "upload_failed", 500, `step=unhandled: ${error?.message || String(error)}`);
  }
};
