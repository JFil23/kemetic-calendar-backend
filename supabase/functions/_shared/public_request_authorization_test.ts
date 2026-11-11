import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizePublicRequest } from "./public_request_authorization.ts";
const publicKey = "sb_publishable_test_public_key";
const secret = "sb_secret_test_selected_secret";
const request = (headers: Record<string, string>) =>
  new Request("http://localhost", { headers });
Deno.test("public computation preserves guest and user access without accepting forged JWTs", async () => {
  let calls = 0;
  const getUser = (token: string) => {
    calls++;
    return Promise.resolve(token === "valid-user" ? { id: "own-user" } : null);
  };
  assertEquals(
    await authorizePublicRequest(
      request({ apikey: publicKey }),
      publicKey,
      secret,
      getUser,
    ),
    true,
  );
  assertEquals(
    await authorizePublicRequest(
      request({ apikey: publicKey, authorization: "Bearer " + publicKey }),
      publicKey,
      secret,
      getUser,
    ),
    true,
  );
  assertEquals(calls, 0);
  assertEquals(
    await authorizePublicRequest(
      request({ apikey: publicKey, authorization: "Bearer valid-user" }),
      publicKey,
      secret,
      getUser,
    ),
    true,
  );
  for (const token of ["forged-user", "retired-service-token"]) {
    assertEquals(
      await authorizePublicRequest(
        request({ apikey: publicKey, authorization: "Bearer " + token }),
        publicKey,
        secret,
        getUser,
      ),
      false,
    );
  }
  assertEquals(
    await authorizePublicRequest(request({}), publicKey, secret, getUser),
    false,
  );
  assertEquals(
    await authorizePublicRequest(
      request({ apikey: secret }),
      publicKey,
      secret,
      getUser,
    ),
    true,
  );
});
