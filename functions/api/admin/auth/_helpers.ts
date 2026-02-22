export function adminAuthJson(
  data: unknown,
  status = 200,
  phase = "unknown",
  err = "none",
  errMsg = ""
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "X-BB-Phase": phase,
      "X-BB-Err": err,
      "X-BB-ErrMsg": errMsg,
    },
  });
}

export function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}
