import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminAgentRunHandler } from "./index.ts";

const researchDefinition = {
  id: "agent-1",
  slug: "research",
  name: "Research",
  status: "manual",
  default_model: "echo-stub",
  required_scopes: ["ops.run", "archive.write"],
  risk_level: "low",
  description: "Draft research.",
  tools_allowed: [],
  tools_blocked: [],
  created_at: "2026-05-18T00:00:00Z",
  updated_at: "2026-05-18T00:00:00Z",
};

const copyDefinition = {
  ...researchDefinition,
  id: "agent-2",
  slug: "copy",
  name: "Copy",
  required_scopes: ["ops.run", "archive.write"],
};

const socialDefinition = {
  ...researchDefinition,
  id: "agent-3",
  slug: "social",
  name: "Social",
  required_scopes: ["ops.run", "archive.write"],
};

const suggestDefinition = {
  ...researchDefinition,
  id: "agent-4",
  slug: "suggest_updates",
  name: "Suggest Updates",
  required_scopes: ["ops.run", "war_room.read"],
};

const productQaDefinition = {
  ...researchDefinition,
  id: "agent-5",
  slug: "product_qa",
  name: "Product QA",
  required_scopes: ["ops.run"],
};

const chiefDefinition = {
  ...researchDefinition,
  id: "agent-6",
  slug: "chief_operator",
  name: "Chief Operator",
  required_scopes: ["ops.run", "war_room.read"],
};

const researchPlaybook = {
  id: "playbook-1",
  slug: "research-v1",
  agent_slug: "research",
  version: 1,
  name: "Research v1",
  system_prompt_md: "Return research JSON.",
  tools_allowed: [],
  output_schema: {},
  requires_approval: false,
  is_active: true,
  created_at: "2026-05-18T00:00:00Z",
  updated_at: "2026-05-18T00:00:00Z",
};

const copyPlaybook = {
  ...researchPlaybook,
  id: "playbook-2",
  slug: "copy-v1",
  agent_slug: "copy",
  name: "Copy v1",
  system_prompt_md: "Return copy JSON.",
};

const socialPlaybook = {
  ...researchPlaybook,
  id: "playbook-3",
  slug: "social-draft-only-v1",
  agent_slug: "social",
  name: "Social v1",
  system_prompt_md: "Return social JSON.",
};

const suggestPlaybook = {
  ...researchPlaybook,
  id: "playbook-4",
  slug: "suggest-updates-v1",
  agent_slug: "suggest_updates",
  name: "Suggest Updates v1",
  system_prompt_md: "Return suggestions JSON.",
};

const codexPlaybook = {
  ...researchPlaybook,
  id: "playbook-5",
  slug: "codex-task-v1",
  agent_slug: "product_qa",
  name: "Codex Task v1",
  system_prompt_md: "Return codex task JSON.",
};

const chiefPlaybook = {
  ...researchPlaybook,
  id: "playbook-6",
  slug: "chief-operator-v1",
  agent_slug: "chief_operator",
  name: "Chief v1",
  system_prompt_md: "Return chief report JSON.",
};

Deno.test("admin_agent_run echo creates job, run, archive, ledger, and audit rows", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [socialDefinition],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
    },
  });
  const handler = createAdminAgentRunHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "social",
        mode: "echo",
        input: { message: "Echo this." },
        estimated_cost_usd: 0.0001,
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(tables.ops_jobs.length, 1);
  assertEquals(tables.ops_runs.length, 1);
  assertEquals(tables.ops_runs[0].status, "completed");
  assertEquals(tables.haw_archive_entries.length, 1);
  assertEquals(tables.haw_treasury_ledger.length, 1);
  assertEquals(body.archive_entry.title, "Echo test: Social");
  assertEquals(auditRows.at(-1)?.action, "agent_run.completed");
});

Deno.test("admin_agent_run research writes cited archive brief with mock LLM", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [researchDefinition],
      haw_armory_playbooks: [researchPlaybook],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
    },
  });
  const handler = createAdminAgentRunHandler({
    client,
    environment: "test",
    llm: () =>
      Promise.resolve({
        provider: "mock",
        modelUsed: "mock-research",
        tokensIn: 100,
        tokensOut: 120,
        content: JSON.stringify({
          title: "Kemet Trend Brief",
          summary: "A concise cited research summary.",
          key_findings: ["Interest is strongest when claims are sourced."],
          sources: [{
            title: "Example source",
            url: "https://example.com/source",
            note: "Fixture citation",
          }],
          implications: ["Archive the lesson for future copy."],
          risks: ["Fixture data is not market proof."],
          recommended_next_action: "Turn this into a copy brief.",
        }),
      }),
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "research",
        input: {
          topic: "Kemetic wellness trend",
          scope: "kemet_trends",
          depth: "quick",
          urls: ["https://example.com/source"],
          use_war_room_context: false,
        },
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(body.archive_entry.namespace, "research");
  assertEquals(
    String(tables.haw_archive_entries[0].content_md).includes("## Sources"),
    true,
  );
  assertEquals(tables.haw_treasury_ledger[0].provider, "mock");
  assertEquals(auditRows.at(-1)?.action, "agent_run.completed");
});

Deno.test("admin_agent_run copy writes A/B/C variants with mock LLM", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [copyDefinition],
      haw_armory_playbooks: [copyPlaybook],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
    },
  });
  const handler = createAdminAgentRunHandler({
    client,
    environment: "test",
    llm: () =>
      Promise.resolve({
        provider: "mock",
        modelUsed: "mock-copy",
        tokensIn: 80,
        tokensOut: 90,
        content: JSON.stringify({
          title: "Onboarding Copy Variants",
          variant_a: "Start with one clear ritual.",
          variant_b: "Open a calmer daily path.",
          variant_c: "Choose the next useful step.",
          recommended_choice: "A",
          notes: "A is clearest.",
        }),
      }),
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "copy",
        input: {
          surface: "onboarding",
          brief: "Explain first-run value.",
          tone: "calm and direct",
          length_limit: 120,
        },
      }),
    },
  ));

  assertEquals(response.status, 201);
  assertEquals(tables.haw_archive_entries[0].namespace, "copy");
  assertEquals(
    String(tables.haw_archive_entries[0].content_md).includes("## Variant C"),
    true,
  );
});

Deno.test("admin_agent_run social writes draft-only archive output with mock LLM", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [socialDefinition],
      haw_armory_playbooks: [socialPlaybook],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
    },
  });
  let llmCalls = 0;
  const handler = createAdminAgentRunHandler({
    client,
    environment: "test",
    llm: () => {
      llmCalls += 1;
      return Promise.resolve({
        provider: "mock",
        modelUsed: "mock-social",
        tokensIn: 60,
        tokensOut: 75,
        content: JSON.stringify({
          title: "Social Batch",
          drafts: [{
            hook: "A quiet ritual changes the morning.",
            caption_or_script: "Draft script only.",
            shot_list: ["Open app", "Show flow"],
            hashtags: ["#wellness", "#ritual"],
            posting_notes: "Post manually after review.",
          }],
        }),
      });
    },
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "social",
        input: {
          platform: "tiktok",
          topic: "Morning ritual",
          hook: "Start small",
          tone: "grounded",
          batch_size: 1,
        },
      }),
    },
  ));

  assertEquals(response.status, 201);
  assertEquals(llmCalls, 1);
  assertEquals(tables.haw_archive_entries[0].namespace, "social");
  assertEquals(
    String(tables.haw_archive_entries[0].content_md).includes("Not posted"),
    true,
  );
});

Deno.test("admin_agent_run suggest_updates creates suggestion rows from War Room data", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [suggestDefinition],
      haw_armory_playbooks: [suggestPlaybook],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
    },
  });
  const handler = createAdminAgentRunHandler({
    client,
    environment: "test",
    warRoomSummary: () =>
      Promise.resolve({
        period_days: 7,
        users: { active_period: 42 },
        nodes: { top: [] },
      }),
    llm: () =>
      Promise.resolve({
        provider: "mock",
        modelUsed: "mock-suggest",
        tokensIn: 110,
        tokensOut: 130,
        content: JSON.stringify({
          title: "Suggested Updates",
          summary: "Aggregate signals suggest an onboarding copy test.",
          suggestions: [{
            title: "Tighten first-session copy",
            category: "copy_change",
            priority: "high",
            evidence: "Activation panel shows first-node gap.",
            recommended_action: "Draft a clearer first-node prompt.",
            expected_impact: "Improve activation.",
            related_metric: "first_node_opened_period",
          }],
        }),
      }),
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "suggest_updates",
        input: { lookback_days: 7, focus: "onboarding" },
      }),
    },
  ));

  assertEquals(response.status, 201);
  assertEquals(tables.suggestions.length, 1);
  assertEquals(tables.suggestions[0].category, "copy_change");
  assertEquals(tables.haw_archive_entries[0].namespace, "suggestions");
});

Deno.test("admin_agent_run product_qa creates codex task and archive spec", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [productQaDefinition],
      haw_armory_playbooks: [codexPlaybook],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
    },
  });
  const handler = createAdminAgentRunHandler({
    client,
    environment: "test",
    llm: () =>
      Promise.resolve({
        provider: "mock",
        modelUsed: "mock-qa",
        tokensIn: 90,
        tokensOut: 160,
        content: JSON.stringify({
          title: "Fix War Room Empty State",
          summary: "Improve empty state copy.",
          context: "Dashboard section is unclear.",
          repro_observed: "Open War Room with no data.",
          expected_behavior: "Explain why no rows are visible.",
          likely_files: [
            "admin/src/features/war-room/WarRoomDashboardPage.tsx",
          ],
          suggested_approach: "Update empty-state messaging.",
          acceptance_criteria: ["Empty state explains minimum bucket size."],
          security_privacy: "No user-level data is exposed.",
          out_of_scope: ["New metrics"],
          codex_prompt: "Implement the War Room empty-state copy change.",
        }),
      }),
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "product_qa",
        input: { report: "War Room empty state needs detail." },
      }),
    },
  ));

  assertEquals(response.status, 201);
  assertEquals(tables.codex_tasks.length, 1);
  assertEquals(tables.codex_tasks[0].status, "draft");
  assertEquals(
    String(tables.haw_archive_entries[0].content_md).includes(
      "Copy-paste Codex prompt",
    ),
    true,
  );
});

Deno.test("admin_agent_run chief_operator creates weekly-style report sections", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [chiefDefinition],
      haw_armory_playbooks: [chiefPlaybook],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
      haw_approval_requests: [{
        id: "approval-1",
        kind: "create_codex_task",
        status: "pending",
        risk_level: "low",
        summary: "Approve task",
        created_at: "2026-05-18T00:00:00Z",
      }],
      suggestions: [],
      ops_runs: [],
    },
  });
  const handler = createAdminAgentRunHandler({
    client,
    environment: "test",
    warRoomSummary: () =>
      Promise.resolve({
        period_days: 7,
        users: { active_period: 12 },
      }),
    llm: () =>
      Promise.resolve({
        provider: "mock",
        modelUsed: "mock-chief",
        tokensIn: 120,
        tokensOut: 150,
        content: JSON.stringify({
          title: "Weekly Chief Report",
          wins: ["War Room is live."],
          risks: ["Approval backlog needs review."],
          what_changed: ["Research and Copy shipped."],
          top_metrics: ["12 active users"],
          needs_approval: ["Approve task"],
          top_3_actions: ["Review approvals", "Run social draft", "Pick task"],
          what_to_ignore: ["Premature CMS work"],
          recommended_codex_task: "Improve dashboard empty states.",
        }),
      }),
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "chief_operator",
        input: { lookback_days: 7 },
      }),
    },
  ));

  assertEquals(response.status, 201);
  assertEquals(tables.haw_archive_entries[0].namespace, "chief_report");
  assertEquals(
    String(tables.haw_archive_entries[0].content_md).includes(
      "## Top 3 actions",
    ),
    true,
  );
});

Deno.test("admin_agent_run blocks runs over active treasury budget", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "owner-1" },
    staff: { role: "owner", scopes: [], is_active: true },
    tables: {
      ops_agent_definitions: [researchDefinition],
      haw_treasury_budgets: [
        {
          id: "budget-1",
          scope: "global",
          agent_slug: null,
          period: "daily",
          limit_usd: 0,
          is_active: true,
          created_at: "2026-05-18T00:00:00Z",
          updated_at: "2026-05-18T00:00:00Z",
        },
      ],
      haw_treasury_ledger: [],
    },
  });
  const handler = createAdminAgentRunHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "research",
        input: { message: "Should not run." },
        estimated_cost_usd: 0.0001,
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 402);
  assertEquals(body.error, "budget_exceeded");
  assertEquals(tables.ops_jobs?.length ?? 0, 0);
  assertEquals(auditRows.at(-1)?.action, "agent_run.budget_blocked");
});

Deno.test("admin_agent_run rejects non-staff users", async () => {
  const { client } = createMockAdminClient({
    user: { id: "user-2" },
    staff: null,
    tables: {
      ops_agent_definitions: [researchDefinition],
    },
  });
  const handler = createAdminAgentRunHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "research",
        input: {
          topic: "Test",
          scope: "technical",
          depth: "quick",
        },
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "staff_required");
});

Deno.test("admin_agent_run rejects staff missing agent required scope", async () => {
  const { client } = createMockAdminClient({
    user: { id: "user-3" },
    staff: { role: "operator", scopes: ["ops.run"], is_active: true },
    tables: {
      ops_agent_definitions: [researchDefinition],
      haw_armory_playbooks: [researchPlaybook],
      haw_treasury_budgets: [],
      haw_treasury_ledger: [],
    },
  });
  const handler = createAdminAgentRunHandler({ client, environment: "test" });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_agent_run",
    {
      method: "POST",
      body: JSON.stringify({
        agent_slug: "research",
        input: {
          topic: "Test",
          scope: "technical",
          depth: "quick",
        },
      }),
    },
  ));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "missing_agent_scope");
});
