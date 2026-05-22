import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminMaatOpsHandler } from "./index.ts";

Deno.test("admin_maat_ops returns fixtures for staff with product.maat.read", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: {
      role: "operator",
      scopes: ["product.maat.read"],
      is_active: true,
    },
  });
  const handler = createAdminMaatOpsHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_ops?action=fixtures",
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(typeof body.policy_version, "string");
  assertEquals(Array.isArray(body.fixtures), true);
  assertEquals(auditRows.at(-1)?.action, "maat.fixtures.view");
});

Deno.test("admin_maat_ops delivery lookup requires support scope and returns safe rows", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "support-1" },
    staff: {
      role: "support",
      scopes: ["product.users.support"],
      is_active: true,
    },
    tables: {
      maat_guidance_deliveries: [
        {
          id: "delivery-1",
          user_id: "user-a",
          kind: "drift_nudge",
          decan_period_key: "2026-05-18",
          status: "shown",
          priority: 20,
          teaser_text: "A concise safe preview.",
          body_text: "This body is intentionally not returned.",
          cta_type: "flow_template",
          cta_ref: "dawn-house-rite",
          created_at: "2026-05-18T00:00:00Z",
        },
        {
          id: "delivery-2",
          user_id: "user-b",
          kind: "strength_nudge",
          decan_period_key: "2026-05-18",
          status: "pending",
          priority: 10,
          teaser_text: "Other user.",
          created_at: "2026-05-18T00:00:00Z",
        },
      ],
    },
  });
  const handler = createAdminMaatOpsHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_ops?action=deliveries&user_id=user-a",
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.deliveries.length, 1);
  assertEquals(body.deliveries[0].id, "delivery-1");
  assertEquals("body_text" in body.deliveries[0], false);
  assertEquals(auditRows.at(-1)?.action, "maat.delivery_lookup");
});

Deno.test("admin_maat_ops evaluation lookup returns decision summaries", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "support-1" },
    staff: {
      role: "support",
      scopes: ["product.users.support"],
      is_active: true,
    },
    tables: {
      maat_guidance_evaluations: [
        {
          id: "eval-1",
          user_id: "user-a",
          snapshot_id: "snapshot-1",
          decan_period_key: "2026-05-18",
          window_date: "2026-05-18",
          policy_version: "maat_policy_v3",
          maturity_level: "L3",
          suppressed: ["drift:stable"],
          created_delivery_ids: [],
          decision: {
            drift: { create: false, reason: "stable" },
            strength: { create: false, reason: "not_ready" },
            memory_brief: { context_quality: "partial" },
          },
          created_at: "2026-05-18T00:00:00Z",
        },
        {
          id: "eval-2",
          user_id: "user-b",
          decan_period_key: "2026-05-18",
          window_date: "2026-05-18",
          policy_version: "maat_policy_v3",
          decision: {},
          suppressed: [],
          created_delivery_ids: [],
          created_at: "2026-05-18T00:00:00Z",
        },
      ],
    },
  });
  const handler = createAdminMaatOpsHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_ops?action=evaluations&user_id=user-a",
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluations.length, 1);
  assertEquals(body.evaluations[0].id, "eval-1");
  assertEquals(body.evaluations[0].drift.reason, "stable");
  assertEquals(body.evaluations[0].memory_brief.context_quality, "partial");
  assertEquals(auditRows.at(-1)?.action, "maat.evaluation_lookup");
});

Deno.test("admin_maat_ops rejects delivery lookup without support scope", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.maat.read"],
      is_active: true,
    },
  });
  const handler = createAdminMaatOpsHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_ops?action=deliveries&user_id=user-a",
  ));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "missing_scope");
  assertEquals(auditRows[0].action, "maat.delivery_lookup.denied");
});

Deno.test("admin_maat_ops creates approval-gated routing override draft", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      maat_routing_overrides: [],
      haw_approval_requests: [],
    },
  });
  const handler = createAdminMaatOpsHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_ops",
    {
      method: "POST",
      body: JSON.stringify({
        scope: "cta",
        cta_type: "flow_template",
        cta_ref: "dawn-house-rite",
        reason: "Test draft only.",
        override: { weight: 0.75 },
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(tables.maat_routing_overrides.length, 1);
  assertEquals(tables.haw_approval_requests.length, 1);
  assertEquals(body.override.status, "pending_approval");
  assertEquals(body.approval.kind, "maat_policy_change");
  assertEquals(auditRows.at(-1)?.action, "maat.override_draft_created");
});

Deno.test("admin_maat_ops rejects missing token", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
  });
  const handler = createAdminMaatOpsHandler({ client, environment: "test" });

  const response = await handler(
    new Request(
      "https://example.test/functions/v1/admin_maat_ops?action=fixtures",
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "auth_required");
  assertEquals(auditRows[0].action, "maat.denied");
});
