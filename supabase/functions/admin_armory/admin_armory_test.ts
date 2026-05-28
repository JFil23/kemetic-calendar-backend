import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminArmoryHandler } from "./index.ts";

Deno.test("admin_armory lists active playbooks for armory.read staff", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "user-1" },
    staff: { role: "operator", scopes: ["armory.read"], is_active: true },
    tables: {
      haw_armory_playbooks: [
        {
          id: "playbook-1",
          slug: "copy-v1",
          agent_slug: "copy",
          version: 1,
          name: "Copy v1",
          system_prompt_md: "Draft copy.",
          tools_allowed: [],
          output_schema: {},
          requires_approval: true,
          is_active: true,
          created_at: "2026-05-18T00:00:00Z",
          updated_at: "2026-05-18T00:00:00Z",
        },
      ],
    },
  });
  const handler = createAdminArmoryHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_armory",
    { method: "GET" },
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.playbooks.length, 1);
  assertEquals(body.playbooks[0].slug, "copy-v1");
  assertEquals(auditRows.at(-1)?.action, "armory.view");
});
