import { hashPassword, json } from "../auth/_utils";

export const onRequestPost: PagesFunction = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const password = String(body?.password || "");
  if (!password) {
    return json({ ok: false, error: "password is required" }, 400);
  }

  const hash = await hashPassword(password);
  return json({ hash });
};
