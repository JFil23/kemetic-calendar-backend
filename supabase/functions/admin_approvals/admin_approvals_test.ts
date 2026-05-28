import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminApprovalsHandler } from "./index.ts";

Deno.test("admin_approvals creates and decides approval requests", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
  });
  const handler = createAdminApprovalsHandler({ client, environment: "test" });

  const createResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_approvals",
    {
      method: "POST",
      body: JSON.stringify({
        kind: "create_codex_task",
        summary: "Approve a test Codex task",
        risk_level: "low",
        payload: { source: "test" },
      }),
    },
  ));
  const createBody = await createResponse.json();

  assertEquals(createResponse.status, 201);
  assertEquals(tables.haw_approval_requests.length, 1);

  const decideResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_approvals",
    {
      method: "PATCH",
      body: JSON.stringify({
        id: createBody.approval.id,
        status: "approved",
        decision_notes: "Looks fine.",
      }),
    },
  ));
  const decideBody = await decideResponse.json();

  assertEquals(decideResponse.status, 200);
  assertEquals(decideBody.approval.status, "approved");
  assertEquals(auditRows.at(-1)?.action, "approval.decided");
});
