import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminArchiveHandler } from "./index.ts";

Deno.test("admin_archive creates manual archive entries for archive.write staff", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "user-1", email: "founder@example.com" },
    staff: { role: "operator", scopes: ["archive.write"], is_active: true },
  });
  const handler = createAdminArchiveHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_archive",
    {
      method: "POST",
      body: JSON.stringify({
        namespace: "technical",
        title: "Manual note",
        content_md: "Phase 3 note",
        tags: ["phase3"],
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(body.entry.title, "Manual note");
  assertEquals(tables.haw_archive_entries.length, 1);
  assertEquals(auditRows.at(-1)?.action, "archive.entry_created");
});

Deno.test("admin_archive rejects staff missing archive.read", async () => {
  const { client } = createMockAdminClient({
    user: { id: "user-2" },
    staff: { role: "readonly", scopes: ["war_room.read"], is_active: true },
  });
  const handler = createAdminArchiveHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_archive",
    { method: "GET" },
  ));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "missing_scope");
});
