import { nowIso } from "../../_products";
import { requireAdminRequest } from "../_helpers";

const resolveBucket = (env: Env): R2Bucket | undefined => env.BBE_IMAGES as R2Bucket | undefined;

const sanitizeUploadFilename = (name: string) =>
  String(name || "file")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "") || "file";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";
  let step = "start";
  const fail = (status: number, error: string, detail?: unknown) => {
    const body: Record<string, unknown> = { ok: false, error };
    if (debug && detail) body.detail = String((detail as any)?.message || detail);
    if (debug) body.step = step;
    if (debug && detail && (detail as any)?.stack) {
      body.stack = String((detail as any).stack)
        .split("\n")
        .slice(0, 3)
        .join("\n");
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  };

  try {
    step = "auth";
    const auth = await requireAdminRequest(request, env);
    if (!auth.ok) {
      const status = auth.response.status;
      if (status === 401) return fail(401, "unauthorized");
      return fail(403, "forbidden");
    }

    step = "parse_form";
    const form = await request.formData();
    const fileEntry = form.get("file");
    const productId = String(form.get("product_id") || "").trim();

    if (!productId) return fail(400, "missing_product_id");
    if (fileEntry === null) return fail(400, "missing_file");
    if (!(fileEntry instanceof File)) return fail(400, "invalid_file_type");

    step = "validate_file";
    if (!fileEntry.type || !fileEntry.type.startsWith("image/")) return fail(400, "invalid_mime");
    if (fileEntry.size > 5 * 1024 * 1024) return fail(400, "file_too_large");

    step = "bucket";
    const bucket = resolveBucket(env as Env);
    if (!bucket) return fail(500, "no_r2_configured");

    step = "buffer";
    const buf = await fileEntry.arrayBuffer();

    step = "key";
    const cleanedName = sanitizeUploadFilename(fileEntry.name || "upload");
    const key = `products/${productId}/${Date.now()}-${cleanedName}`;

    step = "r2_put";
    await bucket.put(key, buf, {
      httpMetadata: { contentType: fileEntry.type },
    });

    step = "db";
    const db = env.DB as D1Database | undefined;
    if (!db) return fail(500, "db_missing");

    step = "db_schema";
    const info = await db.prepare("PRAGMA table_info(products)").all<any>();
    const cols = new Set((info.results || []).map((c: any) => String(c.name || "").toLowerCase()));

    const updates: string[] = [];
    const binds: unknown[] = [];
    const imageUrl = `/api/images/${encodeURIComponent(key)}`;

    if (cols.has("image_key")) {
      updates.push("image_key = ?");
      binds.push(key);
    }
    if (cols.has("image_path")) {
      updates.push("image_path = ?");
      binds.push(imageUrl);
    }
    if (cols.has("image_url")) {
      updates.push("image_url = ?");
      binds.push(imageUrl);
    }
    if (cols.has("updated_at")) {
      updates.push("updated_at = ?");
      binds.push(nowIso());
    }

    step = "db_update";
    if (updates.length) {
      const res = await db
        .prepare(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...binds, productId)
        .run();
      if (debug && (res.meta?.changes ?? 0) === 0) {
        return new Response(JSON.stringify({ ok: true, key, url: imageUrl, warning: "product_not_updated" }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
    }

    step = "ok";
    return new Response(JSON.stringify({ ok: true, key, url: imageUrl }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("upload-image failed", error);
    return fail(500, "upload_failed", error);
  }
};
