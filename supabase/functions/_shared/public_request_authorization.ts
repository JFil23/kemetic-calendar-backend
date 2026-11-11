import { authorizeAccountContext } from "./account_context_authorization.ts";

// Public computations accept the configured publishable key. A supplied user
// JWT is still verified; a forged or retired token never inherits public access.
export async function authorizePublicRequest(
  request: Request,
  publicKey: string,
  serviceKey: string,
  getUser: (token: string) => Promise<{ id: string } | null>,
): Promise<boolean> {
  const token =
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? "";
  if (
    publicKey && request.headers.get("apikey") === publicKey &&
    (!token || token === publicKey)
  ) return true;
  return (await authorizeAccountContext(
    request,
    undefined,
    serviceKey,
    getUser,
  )).ok;
}
