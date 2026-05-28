import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminMaatDryRunHandler } from "./index.ts";

Deno.test("admin_maat_dry_run returns fixture decision without writes", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.maat.read"],
      is_active: true,
    },
    tables: {
      maat_guidance_deliveries: [],
      maat_guidance_evaluations: [],
    },
  });
  const handler = createAdminMaatDryRunHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_dry_run",
    {
      method: "POST",
      body: JSON.stringify({ fixture_id: "G1-01" }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.dry_run, true);
  assertEquals(body.fixture.id, "G1-01");
  assertEquals(body.decision.would_create_delivery, true);
  assertEquals(body.side_effects.deliveries_written, 0);
  assertEquals(tables.maat_guidance_deliveries.length, 0);
  assertEquals(tables.maat_guidance_evaluations.length, 0);
  assertEquals(auditRows.at(-1)?.action, "maat.dry_run");
});

Deno.test("admin_maat_dry_run rejects non-staff", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "user-1" },
    staff: null,
  });
  const handler = createAdminMaatDryRunHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_dry_run",
    { method: "POST", body: JSON.stringify({ fixture_id: "G1-01" }) },
  ));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "staff_required");
  assertEquals(auditRows[0].action, "maat.dry_run.denied");
});

Deno.test("admin_maat_dry_run rejects staff missing product.maat.read", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "support-1" },
    staff: {
      role: "support",
      scopes: ["product.users.support"],
      is_active: true,
    },
  });
  const handler = createAdminMaatDryRunHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_maat_dry_run",
    { method: "POST", body: JSON.stringify({ fixture_id: "G1-01" }) },
  ));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "missing_scope");
  assertEquals(auditRows[0].action, "maat.dry_run.denied");
});

Deno.test("admin_maat_dry_run rejects missing token", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.maat.read"],
      is_active: true,
    },
  });
  const handler = createAdminMaatDryRunHandler({ client, environment: "test" });

  const response = await handler(
    new Request(
      "https://example.test/functions/v1/admin_maat_dry_run",
      { method: "POST", body: JSON.stringify({ fixture_id: "G1-01" }) },
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "auth_required");
  assertEquals(auditRows[0].action, "maat.dry_run.denied");
});
