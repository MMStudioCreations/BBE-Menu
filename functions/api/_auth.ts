export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return p.substring(name.length + 1);
  }
  return null;
}

type AdminCredential = {
  username: string;
  secret: string;
};

const parseAdminCredentials = (env: any): AdminCredential[] => {
  const entries: AdminCredential[] = [];
  const singleSecret = String(env.ADMIN_SECRET || "").trim();
  if (singleSecret) entries.push({ username: "admin", secret: singleSecret });

  const csvSecrets = String(env.ADMIN_SECRETS || "")
    .split(",")
    .map((x: string) => x.trim())
    .filter(Boolean);
  csvSecrets.forEach((secret: string, idx: number) => entries.push({ username: `admin${idx + 1}`, secret }));

  const rawLoginMap = String(env.ADMIN_LOGIN_MAP || "").trim();
  if (!rawLoginMap) return entries;

  try {
    const parsed = JSON.parse(rawLoginMap);
    if (!parsed || typeof parsed !== "object") return entries;
    for (const [username, secret] of Object.entries(parsed)) {
      const cleanUsername = String(username || "").trim();
      const cleanSecret = String(secret || "").trim();
      if (!cleanUsername || !cleanSecret) continue;
      entries.push({ username: cleanUsername, secret: cleanSecret });
    }
  } catch {
    return entries;
  }

  return entries;
};

export const verifyAdminCredential = (env: any, secret: string, username?: string | null): boolean => {
  const cleanSecret = String(secret || "").trim();
  const cleanUsername = String(username || "").trim();
  if (!cleanSecret) return false;

  const credentials = parseAdminCredentials(env);
  if (!credentials.length) return false;

  if (cleanUsername) {
    return credentials.some((entry) => entry.username === cleanUsername && entry.secret === cleanSecret);
  }

  return credentials.some((entry) => entry.secret === cleanSecret);
};

export async function getSessionUserId(request: Request, env: any): Promise<string | null> {
  const sessionId = getCookie(request, "bb_session");
  if (!sessionId) return null;

  const db = env.DB as D1Database;
  const session = await db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<any>();

  if (!session) return null;
  if (Date.parse(session.expires_at) < Date.now()) return null;

  return session.user_id || null;
}

export async function getVerificationStatus(userId: string, env: any): Promise<string> {
  const db = env.DB as D1Database;
  const row = await db
    .prepare("SELECT account_status FROM users WHERE id = ?")
    .bind(userId)
    .first<{ account_status?: string }>();

  return row?.account_status || "pending";
}

export function requireAdmin(request: Request, env: any): boolean {
  const secret = request.headers.get("x-admin-secret") || getCookie(request, "bb_admin_secret");
  const username = request.headers.get("x-admin-user") || getCookie(request, "bb_admin_user") || null;
  return verifyAdminCredential(env, secret || "", username);
}
