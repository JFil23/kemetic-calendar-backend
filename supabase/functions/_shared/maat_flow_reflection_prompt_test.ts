// deno-lint-ignore-file no-import-prefix

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildMaatFlowCompletionEvidenceBadges } from "./guidance_evidence.ts";
import {
  synthesizeMaatFlowDecanPattern,
  THE_WEIGHING_FLOW_KEY,
  THE_WEIGHING_FLOW_TITLE,
} from "./maat_flow_response_spectrum.ts";
import { maatFlowPatternPromptBlock } from "./maat_flow_reflection_prompt.ts";
import {
  maatFlowReflectionBindingRepairPrompt,
  validateMaatFlowReflectionTextBinding,
} from "./maat_flow_reflection_prompt.ts";

const decan = {
  decanId: "2026-05-19:2026-05-28:Hathor - s3h",
  decanStart: "2026-05-19",
  decanEnd: "2026-05-28",
};

function badgeFor(status: string, completedOn: string) {
  return buildMaatFlowCompletionEvidenceBadges({
    completions: [{
      id: completedOn.endsWith("19") ? 1 : 2,
      client_event_id: `admin-fixture-weighing-${status}-${completedOn}`,
      flow_id: 42,
      completed_on: completedOn,
      completed_at: `${completedOn}T17:00:00.000Z`,
      source: "admin_preview_fixture",
      metadata: {
        source: "admin_preview_fixture",
        admin_preview_fixture: true,
        status,
        flow_key: THE_WEIGHING_FLOW_KEY,
        flow_title: THE_WEIGHING_FLOW_TITLE,
        event_title: "Open the Material Ledger",
        completed_on: completedOn,
      },
    }],
  })[0];
}

Deno.test("Ma'at flow reflection prompt binds Weighing partial semantics", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeFor("observed", "2026-05-19"),
      badgeFor("observed_partly", "2026-05-20"),
    ],
  });
  const prompt = maatFlowPatternPromptBlock(pattern);

  assertStringIncludes(
    prompt,
    "MAAT_FLOW_DECAN_PATTERN (hidden authored synthesis input)",
  );
  assertStringIncludes(prompt, "reflection_tier: partial");
  assertStringIncludes(
    prompt,
    "authored_central_tension: The scale was approached and the account opened, but not all of it reached the scale.",
  );
  assertStringIncludes(
    prompt,
    "reflection_seed: The sitting was entered but not completed. The scale was approached; the full account was not placed.",
  );
  assertStringIncludes(prompt, "do_not_say:");
  assertStringIncludes(prompt, "you didn't finish");
  assertStringIncludes(prompt, "imperatives_allowed=false");
  assertStringIncludes(prompt, "required_reflection_contract:");
  assertStringIncludes(
    prompt,
    "the sitting or measure was entered/approached but was not completed or not fully placed",
  );
  assertStringIncludes(prompt, "conflict_priority:");
  assertStringIncludes(prompt, "required_surface_order:");
  assertStringIncludes(prompt, "explicitly honor reflection_seed");
  assertStringIncludes(
    prompt,
    "name interruption or incompletion without motive",
  );
  assertStringIncludes(prompt, "do not end with a direct command");
});

Deno.test("Ma'at flow reflection prompt is absent without flow signals", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [],
    scheduledEvents: [],
  });

  assertEquals(maatFlowPatternPromptBlock(pattern), "");
});

Deno.test("Ma'at flow reflection binding detects ignored partial seed and imperative close", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeFor("observed", "2026-05-19"),
      badgeFor("observed_partly", "2026-05-20"),
    ],
  });
  const check = validateMaatFlowReflectionTextBinding(
    "Care flows outward while your own maintenance waits without a clear place. Complete one act of care for your own body today.",
    pattern,
  );

  assertEquals(check.ok, false);
  assertEquals(
    check.reasons.includes("missing_weighing_partial_interruption"),
    true,
  );
  assertEquals(check.reasons.includes("imperative_closing_forbidden"), true);

  const repairPrompt = maatFlowReflectionBindingRepairPrompt(
    pattern,
    check.reasons,
  );
  assertStringIncludes(repairPrompt, "MAAT_FLOW_REFLECTION_BINDING_REPAIR");
  assertStringIncludes(repairPrompt, "failed_reasons:");
  assertStringIncludes(repairPrompt, "reflection_tier: partial");
  assertStringIncludes(repairPrompt, "Do not end with a direct command");
});

Deno.test("Ma'at flow reflection binding accepts partial interruption without imperative", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeFor("observed", "2026-05-19"),
      badgeFor("observed_partly", "2026-05-20"),
    ],
  });
  const check = validateMaatFlowReflectionTextBinding(
    "The sitting was entered but not completed; the measure was approached without being fully placed. What would restore proportion without turning care into performance?",
    pattern,
  );

  assertEquals(check, { ok: true, reasons: [] });
});
