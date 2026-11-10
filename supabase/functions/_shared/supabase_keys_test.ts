import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { publishableKey, serviceSecretKey } from "./supabase_keys.ts";
const secret = "sb_secret_abcdefghijklmnopqrstuvwxyz123456";
const publicKey = "sb_publishable_abcdefghijklmnopqrstuvwxyz123456";
const read = (values: Record<string, string>) => (name: string) => values[name];
Deno.test("opaque server key wins over both legacy aliases", () => {
  assertEquals(
    serviceSecretKey(
      undefined,
      read({
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: secret }),
        SUPABASE_SERVICE_ROLE_KEY: "old",
        SERVICE_ROLE_KEY: "custom",
      }),
    ),
    secret,
  );
});
Deno.test("public key selection retains client privileges", () => {
  assertEquals(
    publishableKey(
      read({
        SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publicKey }),
        SUPABASE_ANON_KEY: "old",
      }),
    ),
    publicKey,
  );
});
Deno.test("malformed new config never falls back to legacy credentials", () => {
  for (
    const value of [
      "",
      "{",
      "[]",
      "null",
      "{}",
      JSON.stringify({ default: "masked" }),
      JSON.stringify({ default: "eyJlegacy" }),
    ]
  ) {
    assertThrows(
      () =>
        serviceSecretKey(
          undefined,
          read({
            SUPABASE_SECRET_KEYS: value,
            SUPABASE_SERVICE_ROLE_KEY: "old",
          }),
        ),
      Error,
      "Invalid Supabase",
    );
  }
});
Deno.test("publishable and secret key types cannot be exchanged", () => {
  assertThrows(() =>
    publishableKey(
      read({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: secret }) }),
    )
  );
  assertThrows(() =>
    serviceSecretKey(
      undefined,
      read({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: publicKey }) }),
    )
  );
});
Deno.test("older local CLI preserves each owner's existing fallback order", () => {
  const env = read({
    SUPABASE_SERVICE_ROLE_KEY: "built-in",
    SERVICE_ROLE_KEY: "custom",
    SUPABASE_ANON_KEY: "public",
  });
  assertEquals(serviceSecretKey(undefined, env), "built-in");
  assertEquals(
    serviceSecretKey(["SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"], env),
    "custom",
  );
  assertEquals(publishableKey(env), "public");
  assertEquals(serviceSecretKey(undefined, read({})), "");
});
