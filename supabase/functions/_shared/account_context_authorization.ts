// deno-lint-ignore-file no-import-prefix
import { timingSafeEqual } from "node:crypto";

function sameSecret(candidate: string, expected: string) {
  if (!candidate || !expected) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(candidate), b = encoder.encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authorizeAccountContext(
  req: Request,
  targetUserId: string | undefined,
  serviceKey: string,
  getUser: (token: string) => Promise<{ id: string } | null>,
): Promise<
  { ok: true; mode: "service" | "user" } | { ok: false; status: 401 | 403 }
> {
  const token =
    req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ??
      "";
  // Keep the existing server sender compatible while it moves to apikey only.
  if (
    sameSecret(req.headers.get("apikey") ?? "", serviceKey) ||
    sameSecret(token, serviceKey)
  ) {
    return { ok: true, mode: "service" };
  }
  if (!token) return { ok: false, status: 401 };
  let user: { id: string } | null;
  try {
    user = await getUser(token);
  } catch {
    return { ok: false, status: 401 };
  }
  if (!user) return { ok: false, status: 401 };
  if (targetUserId !== undefined && targetUserId !== user.id) {
    return { ok: false, status: 403 };
  }
  return { ok: true, mode: "user" };
}
