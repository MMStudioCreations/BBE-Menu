import { uuid } from "../_utils";

const RESET_WINDOW_MINUTES = 30;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_LIMIT_PER_IP = 5;
const THROTTLE_LIMIT_PER_EMAIL = 3;

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;
  const db = env.DB as D1Database;
  const responseHeaders = new Headers({
    "X-BB-Reset-UserFound": "0",
    "X-BB-Reset-Inserted": "0",
    "X-BB-Reset-EmailSent": "0",
  });

  if (!db) return okResponse(responseHeaders);

  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const email = String(body?.email ?? body?.Email ?? "").trim().toLowerCase();
    const ip = getIpAddress(request);
    const userAgent = (request.headers.get("user-agent") || "").slice(0, 512);
    const emailMasked = maskEmail(email);

    console.log("reset: requested", emailMasked);

    if (!email || !email.includes("@")) return okResponse(responseHeaders);

    const now = new Date();
    const throttledIp = await isThrottled(db, "ip", ip || "unknown", now, THROTTLE_LIMIT_PER_IP);
    const throttledEmail = await isThrottled(db, "email", email, now, THROTTLE_LIMIT_PER_EMAIL);
    if (throttledIp || throttledEmail) {
      console.log("[auth/password/forgot] throttled request", { ipPresent: Boolean(ip), emailDomain: email.split("@")[1] || "" });
      return okResponse(responseHeaders);
    }

    const user = await db
      .prepare("SELECT id, email FROM users WHERE lower(email)=? LIMIT 1")
      .bind(email)
      .first<{ id: string; email: string }>();

    const userFound = Boolean(user?.id);
    console.log("reset: userFound", userFound);

    if (!userFound) return okResponse(responseHeaders);
    responseHeaders.set("X-BB-Reset-UserFound", "1");

    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + RESET_WINDOW_MINUTES * 60 * 1000).toISOString();

    let inserted = false;
    try {
      await db
        .prepare(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at, request_ip, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(uuid(), user.id, tokenHash, expiresAt, createdAt, ip, userAgent)
        .run();
      responseHeaders.set("X-BB-Reset-Inserted", "1");
      inserted = true;
    } catch (error) {
      console.error("reset insert failed", error);
      responseHeaders.set("X-BB-Reset-Inserted", "0");
    }
    console.log("reset: inserted", inserted);

    if (inserted) {
      const resetUrl = `https://bobbyblacknyc.com/reset-password.html?token=${encodeURIComponent(token)}`;
      const emailSent = await sendPasswordResetEmail(env, email, resetUrl);
      responseHeaders.set("X-BB-Reset-EmailSent", emailSent ? "1" : "0");
      console.log("reset: emailSent", emailSent);
    } else {
      console.log("reset: emailSent", false);
    }

    return okResponse(responseHeaders);
  } catch (err) {
    console.error("[auth/password/forgot] error", err);
    return okResponse(responseHeaders);
  }
};

function okResponse(headers: Headers) {
  const merged = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  headers.forEach((value, key) => merged.set(key, value));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: merged,
  });
}

function getIpAddress(request: Request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (!xForwardedFor) return "";
  return xForwardedFor.split(",")[0].trim();
}

async function isThrottled(db: D1Database, scope: string, identifier: string, now: Date, limit: number) {
  const row = await db
    .prepare("SELECT window_start, request_count FROM password_reset_throttle WHERE scope = ? AND identifier = ?")
    .bind(scope, identifier)
    .first<{ window_start: string; request_count: number }>();

  const nowIso = now.toISOString();
  if (!row) {
    await db
      .prepare(
        `INSERT INTO password_reset_throttle (scope, identifier, window_start, request_count, updated_at)
         VALUES (?, ?, ?, 1, ?)`
      )
      .bind(scope, identifier, nowIso, nowIso)
      .run();
    return false;
  }

  const inWindow = Date.parse(row.window_start) + THROTTLE_WINDOW_MS > now.getTime();
  const nextCount = inWindow ? Number(row.request_count || 0) + 1 : 1;
  const nextWindowStart = inWindow ? row.window_start : nowIso;

  await db
    .prepare(
      `UPDATE password_reset_throttle
       SET window_start = ?, request_count = ?, updated_at = ?
       WHERE scope = ? AND identifier = ?`
    )
    .bind(nextWindowStart, nextCount, nowIso, scope, identifier)
    .run();

  return inWindow && nextCount > limit;
}

function randomToken(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendPasswordResetEmail(env: any, email: string, resetUrl: string) {
  const apiKey = env.RESEND_API_KEY;
  const mailFrom = env.MAIL_FROM;
  if (!apiKey || !mailFrom) {
    console.error("reset: emailSent", "missing RESEND_API_KEY or MAIL_FROM");
    return false;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0b0b0b;color:#f2f2f2;border:1px solid #222;border-radius:12px;">
      <h2 style="margin:0 0 12px;color:#fff;">Bobby Black NYC</h2>
      <p style="margin:0 0 18px;color:#d7d7d7;">We received a request to reset your Bobby Black password. This link expires in 30 minutes.</p>
      <p style="margin:0 0 20px;">
        <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#ffffff;color:#000000;text-decoration:none;border-radius:8px;font-weight:600;">Reset Password</a>
      </p>
      <p style="margin:0 0 8px;color:#d7d7d7;">Or paste this link into your browser:</p>
      <p style="word-break:break-all;margin:0 0 8px;"><a href="${resetUrl}" style="color:#fff;">${resetUrl}</a></p>
      <p style="margin:18px 0 0;color:#9a9a9a;font-size:12px;">If you did not request this, you can safely ignore this email.</p>
    </div>
  `;

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mailFrom,
        to: [email],
        subject: "Reset your Bobby Black password",
        html,
      }),
    });

    if (!resendResponse.ok) {
      console.error("reset: emailSent", `resend_failed_${resendResponse.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("reset: emailSent", error);
    return false;
  }
}

function maskEmail(email: string) {
  const [localRaw, domainRaw] = email.split("@");
  const local = localRaw || "";
  const domain = domainRaw || "unknown";
  if (!local) return `***@${domain}`;
  return `${local[0]}***@${domain}`;
}
