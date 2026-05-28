import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminNodesHandler } from "./index.ts";

Deno.test("admin_nodes lists drafts with published node comparison", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.nodes.read"],
      is_active: true,
    },
    tables: {
      node_drafts: [{
        id: "draft-1",
        slug: "ma-at",
        title: "Ma'at",
        body_md: "Draft body",
        metadata: {},
        status: "draft",
        linked_node_slug: "ma-at",
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      }],
      node_draft_versions: [{
        id: "version-1",
        draft_id: "draft-1",
        version_number: 1,
        title: "Ma'at",
        body_md: "Draft body",
        metadata: {},
        created_at: "2026-05-18T00:00:00Z",
      }],
      nodes: [{
        id: "node-1",
        slug: "ma-at",
        title: "Ma'at",
        glyph: null,
        body_text: "Published stub",
        is_active: true,
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      }],
    },
  });
  const handler = createAdminNodesHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_nodes",
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.drafts.length, 1);
  assertEquals(body.drafts[0].published_node.body_text, "Published stub");
  assertEquals(body.drafts[0].version_count, 1);
  assertEquals(
    body.source_of_truth.includes("ADR-002 Option C"),
    true,
  );
  assertEquals(auditRows.at(-1)?.action, "node_drafts.view");
});

Deno.test("admin_nodes creates draft and initial version", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      node_drafts: [],
      node_draft_versions: [],
    },
  });
  const handler = createAdminNodesHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_nodes",
    {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        slug: "New Node",
        title: "New Node",
        body_md: "Draft markdown body.",
        metadata: { source: "test" },
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(body.draft.slug, "new-node");
  assertEquals(tables.node_drafts.length, 1);
  assertEquals(tables.node_draft_versions.length, 1);
  assertEquals(tables.node_draft_versions[0].version_number, 1);
  assertEquals(auditRows.at(-1)?.action, "node_draft.created");
});

Deno.test("admin_nodes creates approval request for draft without publishing", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      node_drafts: [{
        id: "draft-1",
        slug: "ma-at",
        title: "Ma'at",
        body_md: "Draft body.",
        metadata: {},
        status: "draft",
        linked_node_slug: "ma-at",
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      }],
      node_draft_versions: [],
      nodes: [],
      haw_approval_requests: [],
    },
  });
  const handler = createAdminNodesHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_nodes",
    {
      method: "POST",
      body: JSON.stringify({
        action: "request_approval",
        id: "draft-1",
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.draft.status, "pending_approval");
  assertEquals(body.approval.kind, "node_draft_later");
  assertEquals(tables.haw_approval_requests.length, 1);
  assertEquals(
    (tables.haw_approval_requests[0].payload as Record<string, unknown>)
      .app_visible_after_approval,
    false,
  );
  assertEquals(auditRows.at(-1)?.action, "node_draft.approval_requested");
});

Deno.test("admin_nodes can mark draft approved without app-visible publish", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["approvals.decide"],
      is_active: true,
    },
    tables: {
      node_drafts: [{
        id: "draft-1",
        slug: "ma-at",
        title: "Ma'at",
        body_md: "Draft body.",
        metadata: {},
        status: "pending_approval",
        linked_node_slug: "ma-at",
        created_at: "2026-05-18T00:00:00Z",
        updated_at: "2026-05-18T00:00:00Z",
      }],
    },
  });
  const handler = createAdminNodesHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_nodes",
    {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        id: "draft-1",
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.draft.status, "approved");
  assertEquals(tables.node_drafts[0].status, "approved");
  assertEquals(
    (auditRows.at(-1)?.metadata as Record<string, unknown>).app_visible,
    false,
  );
});

Deno.test("admin_nodes rejects staff missing product.nodes.write", async () => {
  const { client, auditRows } = createMockAdminClient({
    user: { id: "readonly-1" },
    staff: {
      role: "readonly",
      scopes: ["product.nodes.read"],
      is_active: true,
    },
  });
  const handler = createAdminNodesHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_nodes",
    {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        slug: "new-node",
        title: "New Node",
        body_md: "Body.",
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "missing_scope");
  assertEquals(auditRows[0].action, "node_draft.denied");
});
