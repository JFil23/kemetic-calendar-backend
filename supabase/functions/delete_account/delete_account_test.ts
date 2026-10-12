import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { createDeleteAccountHandler } from "./index.ts";

function fixture(
  options: { invalid?: boolean; failTable?: string; failAuthDelete?: boolean } =
    {},
) {
  const tokens: string[] = [];
  const deletes: { table: string; column: string; userId: string }[] = [];
  const users: string[] = [];
  const admin = {
    auth: {
      getUser(token: string) {
        tokens.push(token);
        return Promise.resolve({
          data: { user: options.invalid ? null : { id: "owner" } },
          error: null,
        });
      },
      admin: {
        deleteUser(id: string) {
          users.push(id);
          return Promise.resolve({
            error: options.failAuthDelete
              ? new Error("auth removal unavailable")
              : null,
          });
        },
      },
    },
    from(table: string) {
      return {
        delete() {
          return {
            eq(column: string, userId: string) {
              deletes.push({ table, column, userId });
              return Promise.resolve({
                count: 1,
                error: table === options.failTable
                  ? { code: "57014", message: "write unavailable" }
                  : null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return {
    tokens,
    deletes,
    users,
    handler: createDeleteAccountHandler({ admin }),
    admin,
  };
}
function request(auth = "Bearer owner-token", body = {}) {
  return new Request("https://example.test/functions/v1/delete_account", {
    method: "POST",
    headers: { authorization: auth },
    body: JSON.stringify(body),
  });
}
Deno.test("delete_account preflight does not authenticate or delete", async () => {
  const f = fixture();
  const r = await f.handler(
    new Request("https://example.test", { method: "OPTIONS" }),
  );
  assertEquals(r.status, 200);
  assertEquals(f.tokens, []);
  assertEquals(f.deletes, []);
  assertEquals(f.users, []);
});
Deno.test("delete_account verifies the bearer session and only removes its owner", async () => {
  const f = fixture();
  const r = await f.handler(request("Bearer owner-token", { userId: "other" }));
  assertEquals(r.status, 200);
  assertEquals(f.tokens, ["owner-token"]);
  assertEquals(f.deletes.every((d) => d.userId === "owner"), true);
  assertEquals(
    f.deletes.some((d) => d.table === "profiles" && d.column === "id"),
    true,
  );
  assertEquals(f.users, ["owner"]);
  assertEquals((await r.json()).deleted, true);
});
Deno.test("delete_account rejects missing and invalid sessions before writes", async () => {
  for (const auth of ["", "Bearer invalid"]) {
    const f = fixture({ invalid: true });
    const r = await f.handler(request(auth));
    assertEquals(r.status, 401);
    assertEquals(f.deletes, []);
    assertEquals(f.users, []);
  }
});
Deno.test("delete_account rejects non-POST requests and missing configuration", async () => {
  const f = fixture();
  assertEquals(
    (await f.handler(new Request("https://example.test"))).status,
    405,
  );
  assertEquals(
    (await createDeleteAccountHandler({
      admin: f.admin,
      serverConfigured: false,
    })(request())).status,
    500,
  );
  assertEquals(f.deletes, []);
});
Deno.test("delete_account does not remove auth or report success after a failed data write", async () => {
  const f = fixture({ failTable: "flows" });
  const r = await f.handler(request());
  assertEquals(r.status, 500);
  assertEquals((await r.json()).error, "delete_failed");
  assertEquals(f.users, []);
});
Deno.test("delete_account does not report success after auth removal fails", async () => {
  const f = fixture({ failAuthDelete: true });
  const r = await f.handler(request());
  assertEquals(r.status, 500);
  assertEquals((await r.json()).error, "delete_failed");
});
