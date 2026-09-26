import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { listActiveMaatUserIds } from "./maat_active_users.ts";

Deno.test("listActiveMaatUserIds returns a sorted unique active set", async () => {
  let capturedSince = "";
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "active_maat_user_ids");
      capturedSince = String(args.p_since);
      return Promise.resolve({
        data: [
          { user_id: "user-b" },
          { user_id: "user-a" },
          { user_id: "user-b" },
          { user_id: null },
        ],
        error: null,
      });
    },
  };

  const result = await listActiveMaatUserIds(
    client,
    new Date("2026-05-31T00:00:00.000Z"),
  );

  assertEquals(result, ["user-a", "user-b"]);
  assertEquals(capturedSince, "2026-05-01T00:00:00.000Z");
});

Deno.test("listActiveMaatUserIds fails closed on lookup error", async () => {
  await assertRejects(
    () =>
      listActiveMaatUserIds({
        rpc: () => Promise.resolve({ data: null, error: "unavailable" }),
      }, new Date("2026-05-31T00:00:00.000Z")),
    Error,
    "Active Ma'at user lookup failed",
  );
});
