import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeAccountContext } from "./account_context_authorization.ts";
const key = "sb_secret_abcdefghijklmnopqrstuvwxyz123456";
const req = (headers: HeadersInit = {}) =>
  new Request("https://example.test/reflection", { headers });
const user = async (token: string) =>
  token === "valid-user-session" ? { id: "owner" } : null;
Deno.test("reflection rejects missing, public, invalid and forged credentials", async () => {
  for (
    const headers of [{}, { apikey: "sb_publishable_public" }, {
      authorization: "Bearer forged",
    }, { authorization: "Bearer leaked-legacy-service-token" }]
  ) {
    assertEquals(
      await authorizeAccountContext(req(headers), "owner", key, user),
      { ok: false, status: 401 },
    );
  }
});
Deno.test("reflection session can read only its own account context", async () => {
  const r = req({ authorization: "Bearer valid-user-session" });
  assertEquals(await authorizeAccountContext(r, "owner", key, user), {
    ok: true,
    mode: "user",
  });
  assertEquals(await authorizeAccountContext(r, "another-account", key, user), {
    ok: false,
    status: 403,
  });
});
Deno.test("reflection accepts the selected server key without a user impersonation", async () => {
  const never = async () => {
    throw new Error("must not validate a server key as a session");
  };
  assertEquals(
    await authorizeAccountContext(
      req({ apikey: key }),
      "another-account",
      key,
      never,
    ),
    { ok: true, mode: "service" },
  );
  assertEquals(
    await authorizeAccountContext(
      req({ authorization: `Bearer ${key}` }),
      undefined,
      key,
      never,
    ),
    { ok: true, mode: "service" },
  );
});
Deno.test("session verification failure fails closed before context reads", async () => {
  assertEquals(
    await authorizeAccountContext(
      req({ authorization: "Bearer valid-user-session" }),
      "owner",
      key,
      async () => {
        throw new Error("offline");
      },
    ),
    { ok: false, status: 401 },
  );
  assertEquals(await authorizeAccountContext(req(), undefined, "", user), {
    ok: false,
    status: 401,
  });
});
Deno.test("authenticated legacy summaries retain their existing caller path", async () => {
  assertEquals(
    await authorizeAccountContext(
      req({ authorization: "Bearer valid-user-session" }),
      undefined,
      key,
      user,
    ),
    { ok: true, mode: "user" },
  );
});
