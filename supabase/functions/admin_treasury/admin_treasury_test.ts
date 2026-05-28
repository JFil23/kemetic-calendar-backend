import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminTreasuryHandler } from "./index.ts";

Deno.test("admin_treasury returns cost summary for treasury.read staff", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "user-1" },
    staff: { role: "operator", scopes: ["treasury.read"], is_active: true },
    tables: {
      haw_treasury_ledger: [
        {
          id: "ledger-1",
          run_id: "run-1",
          agent_slug: "research",
          provider: "stub",
          model: "echo-stub",
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0.125,
          duration_ms: 12,
          budget_period: "2026-05",
          created_at: "2026-05-18T00:00:00Z",
        },
      ],
      haw_treasury_budgets: [
        {
          id: "budget-1",
          scope: "global",
          agent_slug: null,
          period: "monthly",
          limit_usd: 25,
          is_active: true,
          created_at: "2026-05-18T00:00:00Z",
          updated_at: "2026-05-18T00:00:00Z",
        },
      ],
    },
  });
  const handler = createAdminTreasuryHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_treasury",
    { method: "GET" },
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.totals.run_count, 1);
  assertEquals(body.totals.cost_usd, 0.125);
  assertEquals(body.budgets.length, 1);
  assertEquals(auditRows.at(-1)?.action, "treasury.view");
});
