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
  assertStringIncludes(prompt, "visibly honor reflection_seed");
  assertStringIncludes(
    prompt,
    "name entered/approached/opened but not completed or fully placed without motive",
  );
  assertStringIncludes(prompt, "must not contain an imperative sentence");
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
  assertEquals(check.reasons.includes("imperative_sentence_forbidden"), true);

  const repairPrompt = maatFlowReflectionBindingRepairPrompt(
    pattern,
    check.reasons,
  );
  assertStringIncludes(repairPrompt, "MAAT_FLOW_REFLECTION_BINDING_REPAIR");
  assertStringIncludes(repairPrompt, "failed_reasons:");
  assertStringIncludes(repairPrompt, "reflection_tier: partial");
  assertStringIncludes(
    repairPrompt,
    "Do not include any direct command",
  );
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

Deno.test("Ma'at flow reflection binding rejects skipped imperative sentences", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("skipped", "2026-05-19")],
  });
  const check = validateMaatFlowReflectionTextBinding(
    "The sitting was available and set aside; the measure was not opened. Return one act of care inward before the day closes. What remains true when the unopened measure is allowed to be seen without shame?",
    pattern,
  );

  assertEquals(check.ok, false);
  assertEquals(check.reasons.includes("imperative_sentence_forbidden"), true);
  assertEquals(check.reasons.includes("imperative_closing_forbidden"), false);
  assertEquals(
    check.reasons.includes("missing_weighing_skipped_set_aside"),
    false,
  );
});

Deno.test("Ma'at flow reflection binding requires skipped set-aside semantics", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeFor("observed_partly", "2026-05-19"),
      badgeFor("skipped", "2026-05-20"),
    ],
  });
  const weakCheck = validateMaatFlowReflectionTextBinding(
    "The sitting was entered but not completed; care moved inward but did not fully settle. What would restore proportion without turning care into performance?",
    pattern,
  );

  assertEquals(pattern.interpretiveEmphasis.reflectionTier, "skipped_explicit");
  assertEquals(weakCheck.ok, false);
  assertEquals(
    weakCheck.reasons.includes("missing_weighing_skipped_set_aside"),
    true,
  );

  const validCheck = validateMaatFlowReflectionTextBinding(
    "The sitting was available and set aside; the measure was not opened. Hathor's care can remain context around that quieter absence. What remains true when the unopened measure is seen without shame?",
    pattern,
  );
  assertEquals(validCheck, { ok: true, reasons: [] });
});

Deno.test("Ma'at flow reflection binding rejects partial motive diagnosis", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeFor("observed", "2026-05-19"),
      badgeFor("observed_partly", "2026-05-20"),
    ],
  });
  const check = validateMaatFlowReflectionTextBinding(
    "The sitting was entered but not completed; the measure was approached without being fully placed because you were not ready to face it. What would restore proportion without turning care into performance?",
    pattern,
  );

  assertEquals(check.ok, false);
  assertEquals(check.reasons.includes("partial_motive_diagnosis"), true);
  assertEquals(
    check.reasons.includes("missing_weighing_partial_interruption"),
    false,
  );
});

Deno.test("Ma'at flow reflection binding keeps unobserved neutral", () => {
  const pattern = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [],
    scheduledEvents: [{
      flowKey: THE_WEIGHING_FLOW_KEY,
      flowTitle: THE_WEIGHING_FLOW_TITLE,
      eventTitle: "Open the Material Ledger",
      scheduledOn: "2026-05-19",
      clientEventId: "admin-fixture-weighing-unobserved",
    }],
  });
  const check = validateMaatFlowReflectionTextBinding(
    "The Weighing has no completed signal in this decan. The absence can stay neutral while the rest of the pattern is read with care.",
    pattern,
  );

  assertEquals(pattern.interpretiveEmphasis.reflectionTier, "unobserved");
  assertEquals(check, { ok: true, reasons: [] });

  const avoidantCheck = validateMaatFlowReflectionTextBinding(
    "The Weighing has no completed signal in this decan because you avoided the scale.",
    pattern,
  );
  assertEquals(avoidantCheck.ok, false);
  assertEquals(avoidantCheck.reasons.includes("unobserved_not_neutral"), true);
});
