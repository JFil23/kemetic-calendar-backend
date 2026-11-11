// One owner for platform API keys. New configuration fails closed; legacy
// fallback preserves older local CLI behavior only during the staged migration.
export type KeyEnvironment = (name: string) => string | undefined;
const environment: KeyEnvironment = (name) => Deno.env.get(name);

function platformKey(name: string, prefix: string, read: KeyEnvironment) {
  const configured = read(name);
  if (configured === undefined) return undefined;
  let keys: unknown;
  try {
    keys = JSON.parse(configured);
  } catch {
    throw new Error("Invalid Supabase API-key configuration");
  }
  const key = keys && typeof keys === "object" && !Array.isArray(keys)
    ? (keys as Record<string, unknown>)["default"]
    : undefined;
  if (
    typeof key !== "string" ||
    !new RegExp(`^${prefix}[A-Za-z0-9_-]{20,128}$`).test(key)
  ) {
    throw new Error("Invalid Supabase API-key configuration");
  }
  return key;
}

export function serviceSecretKey(
  legacyNames: readonly string[] = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
  ],
  read: KeyEnvironment = environment,
): string {
  const key = platformKey("SUPABASE_SECRET_KEYS", "sb_secret_", read);
  if (key !== undefined) return key;
  for (const name of legacyNames) {
    const value = read(name);
    if (value !== undefined) return value;
  }
  return "";
}

export function publishableKey(read: KeyEnvironment = environment): string {
  return platformKey("SUPABASE_PUBLISHABLE_KEYS", "sb_publishable_", read) ??
    read("SUPABASE_ANON_KEY") ?? "";
}
