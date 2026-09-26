// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createCronDecanReflectionReconcileHandler } from "./index.ts";

function request(secret?: string) {
  return new Request("http://localhost/cron_decan_reflection_reconcile", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
    body: "{}",
  });
}

Deno.test("daily reflection reconciler requires its cron secret", async () => {
  const handler = createCronDecanReflectionReconcileHandler({
    client: {} as never,
    cronSecret: "expected",
    listActiveUserIds: () => Promise.resolve([]),
  });
  const response = await handler(request());
  assertEquals(response.status, 401);
});

Deno.test("daily reflection reconciler repairs scheduler state without delivery", async () => {
  const calls: string[] = [];
  const client = {
    from: (_table: string) => {
      throw new Error("No table scan is needed for an empty active set");
    },
    rpc: (name: string) => {
      calls.push(name);
      return Promise.resolve({
        data: {
          recovered_claims: 0,
          pending_buckets: 5,
          missing_buckets: 0,
        },
        error: null,
      });
    },
  };
  const handler = createCronDecanReflectionReconcileHandler({
    client,
    cronSecret: "expected",
    now: () => new Date("2026-09-26T12:00:00.000Z"),
    listActiveUserIds: () => Promise.resolve([]),
  });
  const response = await handler(request("expected"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.schedules.active_user_count, 0);
  assertEquals(calls, ["reconcile_decan_reflection_scheduler"]);
});
