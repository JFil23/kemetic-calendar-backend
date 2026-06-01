import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authedRequest, createMockAdminClient } from "../_shared/admin_test.ts";
import { createAdminContentPreviewHandler } from "./index.ts";

Deno.test("admin_content_preview generates an opening preview and logs an evaluation", async () => {
  const { client, tables, auditRows } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.test"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [{
        user_id: "user-a",
        top_nodes: [{ slug: "maat", title: "Ma'at", score: 0.9 }],
        top_edges: [],
        tension_pairs: [],
      }],
      journal_badges: [{
        user_id: "user-a",
        title: "Right Speech",
        details: "Named what was true before acting.",
        tags: ["kind:journal"],
        occurred_on: "2026-05-19",
      }],
      journal_entries: [],
      todos: [],
      nutrition_items: [],
      admin_content_evaluations: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "decan_opening",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Paopi - sbꜣ nfr",
        decan_context_key: "3-1",
        day_card: {
          date: "2026-05-19",
          maatPrinciple: "Feel the Ground Hold",
          decanDayAction:
            "Walk slowly through the structures of life and identify what has actually stabilized.",
        },
      }),
    },
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.preview.artifact, "decan_opening");
  assertEquals(payload.preview.target_user_id, "user-a");
  assertEquals(payload.preview.push_preview.kind, "decan_opening");
  assertEquals(payload.preview.source_snapshot.badge_count, 1);
  assertExists(payload.preview.generated_text);
  assertStringIncludes(
    payload.preview.generated_text,
    "Today centers Feel the Ground Hold",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.status,
    "compiled",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiled_package
      .package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiler.surface,
    "opening",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiler.fallback_used,
    false,
  );
  const compiledPackage =
    payload.preview.source_snapshot.guidance.payload.compiled_output_package;
  assertEquals(compiledPackage.package_version, "compiled_output_package_v1");
  assertEquals(
    String(payload.preview.generated_text).replace(/\s+/g, " ").trim(),
    String(compiledPackage.final_text).replace(/\s+/g, " ").trim(),
  );
  assertEquals(payload.preview.push_preview.body, compiledPackage.push_text);
  assertEquals(
    payload.preview.push_preview.render_diagnostics.push_source,
    "compiled_package.push_text",
  );
  assertEquals(
    String(payload.preview.generated_text).includes(
      "journal noted Named what was true before acting",
    ),
    false,
  );
  assertEquals(tables.admin_content_evaluations.length, 1);
  assertEquals(
    auditRows.some((row) => row.action === "content_lab.generate"),
    true,
  );
});

Deno.test("admin_content_preview seasons guidance without reciting activities", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.test"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [{
        user_id: "user-a",
        top_nodes: [{ slug: "renenutet", title: "Renenutet", score: 0.9 }],
        top_edges: [],
        tension_pairs: [],
      }],
      journal_badges: [],
      journal_entries: [],
      todos: [],
      nutrition_items: [{
        id: "nutrition-vitamin-a",
        user_id: "user-a",
        nutrient: "vitamin A",
        source: "carrots",
        purpose: "protect the nutrition thread",
        mode: "decan",
        decan_days: [1],
        days_of_week: [],
        enabled: true,
        created_at: "2026-05-18T12:00:00Z",
      }],
      admin_content_evaluations: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });
  const baseBody = {
    target_user_id: "user-a",
    decan_start: "2026-05-19",
    decan_end: "2026-05-28",
    decan_name: "Hathor - s3h",
    decan_context_key: "3-1",
    day_card: {
      date: "2026-05-19",
      maatPrinciple: "Feel the Ground Hold",
      decanDayAction:
        "Walk slowly through the structures of life and identify what has actually stabilized.",
    },
  };

  const openingResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        ...baseBody,
        artifact: "decan_opening",
      }),
    },
  ));
  const nudgeResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        ...baseBody,
        artifact: "isfet_nudge",
        allow_fallback: true,
      }),
    },
  ));

  assertEquals(openingResponse.status, 200);
  assertEquals(nudgeResponse.status, 200);
  const opening = await openingResponse.json();
  const nudge = await nudgeResponse.json();
  const openingText = String(opening.preview.generated_text).toLowerCase();
  const nudgeText = String(nudge.preview.generated_text).toLowerCase();

  assertStringIncludes(openingText, "sꜣḥ");
  assertStringIncludes(openingText, "feel the ground hold");
  assertEquals(openingText.includes("vitamin a"), false);
  assertEquals(openingText.includes("carrots"), false);
  assertEquals(nudgeText.includes("vitamin a"), false);
  assertEquals(nudgeText.includes("carrots"), false);
  assertStringIncludes(nudgeText, "nutrition check");
  assertEquals(opening.preview.model_version, "controlled-output-v1");
  assertEquals(nudge.preview.model_version, "deterministic");
  assert(!nudgeText.startsWith("a path back to balance is available"));
  assert(opening.preview.generated_text !== nudge.preview.generated_text);
  assertEquals(
    opening.preview.source_snapshot.guidance.memory_brief.evidence_phrases[0],
    "nutrition vitamin A was pending on 2026-05-19 Source: carrots. Purpose: protect the nutrition thread.",
  );
});

Deno.test("admin_content_preview exposes nudge renderer diagnostics and can fail loud", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.test"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [],
      journal_badges: [],
      journal_entries: [],
      todos: [],
      nutrition_items: [{
        id: "nutrition-1",
        user_id: "user-a",
        nutrient: "magnesium",
        source: "supplement",
        purpose: "body support",
        mode: "decan",
        decan_days: [1],
        days_of_week: [],
        enabled: true,
        created_at: "2026-05-18T12:00:00Z",
      }],
      admin_content_evaluations: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const previewResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "isfet_nudge",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
        allow_fallback: true,
      }),
    },
  ));
  assertEquals(previewResponse.status, 200);
  const previewPayload = await previewResponse.json();
  assertEquals(
    previewPayload.preview.push_preview.render_diagnostics.surface,
    "nudge",
  );
  assertEquals(
    previewPayload.preview.push_preview.render_diagnostics.renderer
      .fallback_reason,
    "disabled",
  );

  const loudResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "isfet_nudge",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
        require_llm: true,
      }),
    },
  ));
  assertEquals(loudResponse.status, 502);
  const loudPayload = await loudResponse.json();
  assertEquals(loudPayload.error, "llm_render_required");
  assertEquals(loudPayload.diagnostics.renderer.fallback_reason, "disabled");
});

Deno.test("admin_content_preview require_llm passes only when nudge LLM replaces deterministic text", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.test"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [],
      journal_badges: [],
      journal_entries: [],
      todos: [],
      nutrition_items: [{
        id: "nutrition-1",
        user_id: "user-a",
        nutrient: "magnesium",
        source: "supplement",
        purpose: "body support",
        mode: "decan",
        decan_days: [1],
        days_of_week: [],
        enabled: true,
        created_at: "2026-05-18T12:00:00Z",
      }, {
        id: "nutrition-2",
        user_id: "user-a",
        nutrient: "zinc",
        source: "supplement",
        purpose: "body support",
        mode: "decan",
        decan_days: [1],
        days_of_week: [],
        enabled: true,
        created_at: "2026-05-18T12:00:00Z",
      }],
      admin_content_evaluations: [],
    },
  });
  const llmText =
    "Magnesium and zinc are waiting in the same body-support thread. Choose the source that does the most real work today and close that single mark. A smaller account kept cleanly gives the body more order than a wider list left waiting.";
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
    nudgeLlmOptions: {
      renderer: async ({ userPrompt }) => {
        assertStringIncludes(userPrompt, "TARGET QUALITY EXAMPLE");
        assertStringIncludes(userPrompt, "CONCRETE ACTION");
        return { text: llmText, modelUsed: "mock-claude-nudge" };
      },
    },
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "isfet_nudge",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
        require_llm: true,
      }),
    },
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.preview.generated_text, llmText);
  assertEquals(payload.preview.model_version, "mock-claude-nudge");
  assertEquals(payload.preview.push_preview.render_diagnostics.status, "llm");
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiler.status,
    "compiled",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiled_package
      .package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.push_source,
    "compiled_package.push_text",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.not_quality_proof,
    false,
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.renderer.renderer,
    "anthropic",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.renderer.fallback_reason,
    null,
  );
  assertEquals(
    payload.preview.generated_text.includes("Several support marks"),
    false,
  );
});

Deno.test("admin_content_preview require_llm blocks nudge LLM validation fallback", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.test"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [],
      journal_badges: [],
      journal_entries: [],
      todos: [],
      nutrition_items: [{
        id: "nutrition-1",
        user_id: "user-a",
        nutrient: "magnesium",
        source: "supplement",
        purpose: "body support",
        mode: "decan",
        decan_days: [1],
        days_of_week: [],
        enabled: true,
        created_at: "2026-05-18T12:00:00Z",
      }],
      admin_content_evaluations: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
    nudgeLlmOptions: {
      renderer: async () => ({
        modelUsed: "mock-claude-nudge",
        text:
          "This is not a judgment. Open the suggested flow and complete the support task.",
      }),
    },
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "isfet_nudge",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
        require_llm: true,
      }),
    },
  ));

  assertEquals(response.status, 502);
  const payload = await response.json();
  assertEquals(payload.error, "llm_render_required");
  assertEquals(
    payload.diagnostics.renderer.fallback_reason,
    "llm_validation_failed",
  );
  assertEquals(payload.diagnostics.compiler.status, "fallback");
  assertEquals(payload.diagnostics.not_quality_proof, true);
  assertEquals(payload.diagnostics.delivery_recommendation, "archive_only");
  assert(
    payload.diagnostics.renderer.validation.errors.includes(
      "dignity_language_violation",
    ),
  );
  assert(
    payload.diagnostics.renderer.validation.errors.includes(
      "cta_embedded_in_body",
    ),
  );
});

Deno.test("admin_content_preview exposes reflection renderer diagnostics", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.test"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [],
      journal_badges: [],
      journal_entries: [],
      todos: [],
      nutrition_items: [],
      admin_content_evaluations: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
    reflectionGenerator: async () => ({
      reflection: "Local fallback reflection.",
      modelUsed: "local-generator-v2",
      outputControl: {
        renderer: {
          renderer: "local-generator-v2",
          fallback_reason: "anthropic_error",
          error: "test failure",
        },
        outputCompiler: {
          status: "fallback",
          fallback_quality: true,
          not_quality_proof: true,
        },
        compiledOutputPackage: {
          package_version: "compiled_output_package_v1",
          fallback_used: true,
          not_quality_proof: true,
        },
      },
    }),
  });

  const blockedResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "decan_reflection",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
      }),
    },
  ));
  assertEquals(blockedResponse.status, 502);
  const blockedPayload = await blockedResponse.json();
  assertEquals(blockedPayload.error, "llm_render_required");
  assertEquals(blockedPayload.diagnostics.renderer.error, "test failure");

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "decan_reflection",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
        allow_fallback: true,
      }),
    },
  ));
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(
    payload.preview.push_preview.render_diagnostics.renderer.fallback_reason,
    "anthropic_error",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiler.status,
    "fallback",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiled_package
      .package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.not_quality_proof,
    true,
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.push_source,
    "blocked_fallback",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.push_blocked,
    true,
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.push_block_reason,
    "compiled_package_not_quality_proof",
  );

  const loudResponse = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "decan_reflection",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
        require_llm: true,
      }),
    },
  ));
  assertEquals(loudResponse.status, 502);
  const loudPayload = await loudResponse.json();
  assertEquals(loudPayload.diagnostics.renderer.error, "test failure");
});

Deno.test("admin_content_preview require_llm passes only for Anthropic reflection diagnostics", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.test"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [],
      journal_badges: [],
      journal_entries: [],
      todos: [],
      nutrition_items: [],
      admin_content_evaluations: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
    reflectionGenerator: async () => ({
      reflection:
        "The decan gathered around one honest support thread and one next measure.",
      modelUsed: "claude-reflection",
      outputControl: {
        renderer: {
          renderer: "anthropic",
          model_used: "claude-reflection",
          fallback_reason: null,
        },
        outputCompiler: {
          status: "compiled",
          fallback_used: false,
          not_quality_proof: false,
        },
        compiledOutputPackage: {
          package_version: "compiled_output_package_v1",
          fallback_used: false,
          not_quality_proof: false,
          push_text: "Compiled reflection push.",
        },
        plan: {
          caseKey: "provision.single_open_check",
          selectedOffering: "commit_today",
          offeringRender: {
            exampleId: "provision_single_commit_today",
            diagnosis: "One support mark remains open.",
            concreteAction: "Close one support mark today.",
            exampleReflection: "Example reflection text.",
          },
        },
      },
    }),
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "decan_reflection",
        decan_start: "2026-05-19",
        decan_end: "2026-05-28",
        decan_name: "Hathor - s3h",
        require_llm: true,
      }),
    },
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.preview.model_version, "claude-reflection");
  assertEquals(payload.preview.push_preview.render_diagnostics.status, "llm");
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiler.status,
    "compiled",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.compiled_package
      .package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.push_source,
    "compiled_package.push_text",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.case_key,
    "provision.single_open_check",
  );
  assertEquals(
    payload.preview.push_preview.render_diagnostics.renderer.fallback_reason,
    null,
  );
});

Deno.test("admin_content_preview maps pending nutrition plans to scheduled dates", async () => {
  const nutritionItems = Array.from({ length: 10 }, (_, index) => ({
    id: `nutrition-${index + 1}`,
    user_id: "user-a",
    nutrient: "apple",
    source: "",
    purpose: "",
    mode: "decan",
    decan_days: [index + 1],
    days_of_week: [],
    enabled: true,
    created_at: "2026-05-18T12:00:00Z",
  }));
  nutritionItems.push({
    id: "nutrition-duplicate",
    user_id: "user-a",
    nutrient: "apple",
    source: "",
    purpose: "",
    mode: "decan",
    decan_days: [1],
    days_of_week: [],
    enabled: true,
    created_at: "2026-05-18T12:00:00Z",
  });

  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.read"],
      is_active: true,
    },
    tables: {
      profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
      reflection_profiles: [],
      journal_badges: [],
      journal_entries: [],
      todos: [],
      nutrition_items: nutritionItems,
      admin_content_evaluations: [],
      maat_guidance_deliveries: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=context&target_user_id=user-a&decan_start=2026-05-19&decan_end=2026-05-28&decan_name=Paopi",
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  const lines = payload.evidence.evidence_lines as string[];
  assertEquals(lines.length, 10);
  assertEquals(
    lines[0],
    "2026-05-19 - Nutrition: apple - Planner nutrition entry for 2026-05-19. State: pending. Not checked off yet. - planner, kind:nutrition, state:pending",
  );
  assertEquals(new Set(lines.map((line) => line.slice(0, 10))).size, 10);
  assertEquals(
    lines.filter((line) => line.startsWith("2026-05-19 - ")).length,
    1,
  );
});

Deno.test("admin_content_preview saves critique on a generated evaluation", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.write"],
      is_active: true,
    },
    tables: {
      admin_content_evaluations: [{
        id: "eval-1",
        artifact: "decan_reflection",
        mode: "preview",
        status: "draft",
        target_user_id: "user-a",
        generated_text: "Preview text",
        push_preview: {},
        source_snapshot: {},
        created_at: "2026-05-19T00:00:00Z",
        updated_at: "2026-05-19T00:00:00Z",
      }],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=save_critique",
    {
      method: "POST",
      body: JSON.stringify({
        evaluation_id: "eval-1",
        rating: 2,
        feedback_tags: ["generic", "wrong_user"],
        critique_md: "Needs concrete evidence from this user.",
        status: "needs_work",
      }),
    },
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.evaluation.rating, 2);
  assertEquals(payload.evaluation.status, "needs_work");
  assertEquals(payload.evaluation.feedback_tags, ["generic", "wrong_user"]);
  assertEquals(tables.admin_content_evaluations[0].updated_by, "operator-1");
});

Deno.test("admin_content_preview lists graph-informed user cards", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.read"],
      is_active: true,
    },
    tables: {
      profiles: [{
        id: "user-a",
        display_name: "Auset",
        timezone: "America/Los_Angeles",
      }],
      reflection_profiles: [{
        user_id: "user-a",
        top_nodes: [{ slug: "maat", title: "Ma'at", score: 0.91 }],
      }],
      maat_snapshots: [{
        id: "snap-1",
        user_id: "user-a",
        window_date: "2026-05-19",
        decan_period_key: "2026-05-19:2026-05-28:3-1",
        band: "leaning_isfet",
        score: -2,
        reflection_move: "correct",
        lead_axis: "truth",
        correction_axes: ["truth"],
        hard_gates: ["journal_absent"],
      }],
      maat_guidance_deliveries: [],
      admin_content_evaluations: [],
      journal_badges: [{
        user_id: "user-a",
        title: "Right Speech",
        occurred_on: "2026-05-19",
      }],
      journal_entries: [],
      todos: [],
      nutrition_items: [],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=list_users",
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.users.length, 1);
  assertEquals(payload.users[0].display_name, "Auset");
  assertEquals(payload.users[0].top_nodes[0].slug, "maat");
  assertEquals(payload.users[0].recommended_nudge, "isfet_nudge");
});

Deno.test("admin_content_preview delivers a reviewed nudge to the user", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.write"],
      is_active: true,
    },
    tables: {
      maat_guidance_deliveries: [],
      admin_content_evaluations: [{
        id: "eval-nudge",
        artifact: "isfet_nudge",
        mode: "preview",
        status: "reviewed",
        target_user_id: "user-a",
        decan_period_key: "2026-05-19:2026-05-28:3-1",
        generated_text:
          "The record is asking for one clean mark.\n\nBegin small.",
        push_preview: {},
        source_snapshot: {
          guidance: {
            kind: "drift_nudge",
            priority: 20,
            payload: { lead_axis: "truth" },
            cta_type: "node",
            cta_ref: "maat",
            trigger_reason: "admin_preview",
          },
        },
        created_at: "2026-05-19T00:00:00Z",
        updated_at: "2026-05-19T00:00:00Z",
      }],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=deliver_nudge",
    {
      method: "POST",
      body: JSON.stringify({ evaluation_id: "eval-nudge" }),
    },
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.delivery.kind, "drift_nudge");
  assertEquals(tables.maat_guidance_deliveries.length, 1);
  assertEquals(tables.maat_guidance_deliveries[0].status, "pending");
  assertStringIncludes(
    String(tables.maat_guidance_deliveries[0].body_text),
    "The record is asking for one clean mark.",
  );
  assertStringIncludes(
    String(tables.maat_guidance_deliveries[0].body_text),
    "Begin small.",
  );
  const deliveryPayload = tables.maat_guidance_deliveries[0].payload as Record<
    string,
    unknown
  >;
  assertEquals(
    deliveryPayload.admin_content_evaluation_id,
    "eval-nudge",
  );
});

Deno.test("admin_content_preview allows delivery after a prior acted nudge", async () => {
  const { client, tables } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.write"],
      is_active: true,
    },
    tables: {
      admin_content_evaluations: [{
        id: "eval-nudge",
        artifact: "isfet_nudge",
        mode: "preview",
        status: "draft",
        actor_user_id: "operator-1",
        target_user_id: "user-a",
        window_start: "2026-05-19",
        window_end: "2026-05-28",
        decan_period_key: "2026-05-19:2026-05-28:3-1",
        generated_text:
          "Provision needs one gentle return.\n\nComplete one nutrition check today; let that small provision steady the day.",
        push_preview: null,
        source_snapshot: {
          guidance: {
            kind: "drift_nudge",
            priority: 20,
            payload: { lead_axis: "measure" },
            cta_type: "flow_template",
            cta_ref: "dawn-house-rite",
            trigger_reason: "admin_preview",
          },
        },
        created_at: "2026-05-19T00:00:00Z",
        updated_at: "2026-05-19T00:00:00Z",
      }],
      maat_guidance_deliveries: [{
        id: "prior-acted",
        user_id: "user-a",
        kind: "drift_nudge",
        decan_period_key: "2026-05-19:2026-05-28:3-1",
        status: "acted",
        priority: 20,
        teaser_text: "Prior handled nudge",
        body_text: "Prior handled nudge",
        payload: {},
        cta_type: "flow_template",
        cta_ref: "dawn-house-rite",
        trigger_reason: "admin_preview",
        created_at: "2026-05-20T00:00:00Z",
        updated_at: "2026-05-20T00:00:00Z",
      }],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=deliver_nudge",
    {
      method: "POST",
      body: JSON.stringify({ evaluation_id: "eval-nudge" }),
    },
  ));

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.delivery.kind, "drift_nudge");
  assertEquals(payload.delivery.status, "pending");
  assertEquals(tables.maat_guidance_deliveries.length, 2);
});

Deno.test("admin_content_preview blocks delivery when an active nudge exists", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.content.write"],
      is_active: true,
    },
    tables: {
      admin_content_evaluations: [{
        id: "eval-nudge",
        artifact: "isfet_nudge",
        mode: "preview",
        status: "draft",
        actor_user_id: "operator-1",
        target_user_id: "user-a",
        window_start: "2026-05-19",
        window_end: "2026-05-28",
        decan_period_key: "2026-05-19:2026-05-28:3-1",
        generated_text:
          "Provision needs one gentle return.\n\nComplete one nutrition check today; let that small provision steady the day.",
        push_preview: null,
        source_snapshot: {
          guidance: {
            kind: "drift_nudge",
            priority: 20,
            payload: { lead_axis: "measure" },
            cta_type: "flow_template",
            cta_ref: "dawn-house-rite",
            trigger_reason: "admin_preview",
          },
        },
        created_at: "2026-05-19T00:00:00Z",
        updated_at: "2026-05-19T00:00:00Z",
      }],
      maat_guidance_deliveries: [{
        id: "prior-opened",
        user_id: "user-a",
        kind: "drift_nudge",
        decan_period_key: "2026-05-19:2026-05-28:3-1",
        status: "opened",
        priority: 20,
        teaser_text: "Active nudge",
        body_text: "Active nudge",
        payload: {},
        cta_type: "flow_template",
        cta_ref: "dawn-house-rite",
        trigger_reason: "admin_preview",
        created_at: "2026-05-20T00:00:00Z",
        updated_at: "2026-05-20T00:00:00Z",
      }],
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=deliver_nudge",
    {
      method: "POST",
      body: JSON.stringify({ evaluation_id: "eval-nudge" }),
    },
  ));

  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload.error, "active_nudge_already_exists");
});

Deno.test("admin_content_preview rejects generation without content scope", async () => {
  const { client } = createMockAdminClient({
    user: { id: "operator-1" },
    staff: {
      role: "operator",
      scopes: ["product.maat.read"],
      is_active: true,
    },
  });
  const handler = createAdminContentPreviewHandler({
    client,
    environment: "test",
  });

  const response = await handler(authedRequest(
    "https://example.test/functions/v1/admin_content_preview?action=generate",
    {
      method: "POST",
      body: JSON.stringify({
        target_user_id: "user-a",
        artifact: "decan_opening",
      }),
    },
  ));

  assertEquals(response.status, 403);
});
