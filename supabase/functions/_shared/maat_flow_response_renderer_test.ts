// deno-lint-ignore-file no-import-prefix

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildMaatFlowCompletionEvidenceBadges } from "./guidance_evidence.ts";
import {
  type MaatFlowDecanPatternSynthesis,
  type MaatResponseKind,
  synthesizeMaatFlowDecanPattern,
  THE_WEIGHING_FLOW_KEY,
  THE_WEIGHING_FLOW_TITLE,
} from "./maat_flow_response_spectrum.ts";
import {
  renderMaatFlowResponse,
  resolveMaatFlowRuntimeRenderMode,
} from "./maat_flow_response_renderer.ts";
import { validateMaatFlowReflectionTextBinding } from "./maat_flow_reflection_prompt.ts";

const decan = {
  decanId: "2026-05-16:2026-05-25:1-1",
  decanStart: "2026-05-16",
  decanEnd: "2026-05-25",
  decanName: "Hathor - s3h",
};

function completion(status: string, completedOn = "2026-05-18") {
  return {
    id: 1,
    client_event_id: `weighing-${status}-${completedOn}`,
    flow_id: 42,
    completed_on: completedOn,
    completed_at: `${completedOn}T17:00:00.000Z`,
    source: "client",
    metadata: {
      status,
      flow_key: THE_WEIGHING_FLOW_KEY,
      flow_title: THE_WEIGHING_FLOW_TITLE,
      event_title: "Open the Material Ledger",
      completed_on: completedOn,
      completed_at: `${completedOn}T17:00:00.000Z`,
    },
  };
}

function badgeFor(status: string, completedOn = "2026-05-18") {
  return buildMaatFlowCompletionEvidenceBadges({
    completions: [completion(status, completedOn)],
  })[0];
}

function patternForFixture(fixture: string): MaatFlowDecanPatternSynthesis {
  switch (fixture) {
    case "observed":
      return synthesizeMaatFlowDecanPattern({
        ...decan,
        completionEvidence: [badgeFor("observed")],
      });
    case "partial":
      return synthesizeMaatFlowDecanPattern({
        ...decan,
        completionEvidence: [badgeFor("observed_partly")],
      });
    case "skipped_explicit":
      return synthesizeMaatFlowDecanPattern({
        ...decan,
        completionEvidence: [badgeFor("skipped")],
      });
    case "unobserved":
      return synthesizeMaatFlowDecanPattern({
        ...decan,
        scheduledEvents: [{
          flowKey: THE_WEIGHING_FLOW_KEY,
          flowTitle: THE_WEIGHING_FLOW_TITLE,
          eventTitle: "Open the Material Ledger",
          scheduledOn: "2026-05-18",
          clientEventId: "weighing-unobserved-2026-05-18",
        }],
      });
    case "observed_plus_partial":
      return synthesizeMaatFlowDecanPattern({
        ...decan,
        completionEvidence: [
          badgeFor("observed", "2026-05-18"),
          badgeFor("observed_partly", "2026-05-19"),
        ],
      });
    case "partial_plus_skipped":
      return synthesizeMaatFlowDecanPattern({
        ...decan,
        completionEvidence: [
          badgeFor("observed_partly", "2026-05-18"),
          badgeFor("skipped", "2026-05-19"),
        ],
      });
    default:
      throw new Error(`Unknown fixture ${fixture}`);
  }
}

function renderFixture(fixture: string, kind: MaatResponseKind = "reflection") {
  const response = renderMaatFlowResponse(
    patternForFixture(fixture),
    kind,
    { decanName: decan.decanName },
  );
  assertExists(response);
  return response;
}

function assertNoReflectionImperative(text: string) {
  assertEquals(
    /\b(Return|Complete|Sit|Write|Name|Choose|Open)\b/.test(text),
    false,
  );
}

function occurrenceCount(text: string, phrase: string) {
  return text.match(new RegExp(phrase, "g"))?.length ?? 0;
}

function assertDoNotSayAbsent(pattern: MaatFlowDecanPatternSynthesis) {
  for (
    const kind of [
      "reflection",
      "orientation",
      "alignment",
    ] as MaatResponseKind[]
  ) {
    const response = renderMaatFlowResponse(pattern, kind);
    assertExists(response);
    const lower = response.body.toLowerCase();
    for (const phrase of response.selectedSeed.doNotSay) {
      const normalized = phrase.toLowerCase().replace(/\s+/g, " ").trim();
      assertEquals(
        normalized.length > 0 && lower.includes(normalized),
        false,
        `${kind} output included doNotSay phrase: ${phrase}`,
      );
    }
  }
}

Deno.test("Weighing observed reflection renders without LLM", () => {
  const response = renderFixture("observed");

  assertEquals(response.responseKind, "reflection");
  assertEquals(response.source, "deterministic_spectrum");
  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "observed");
  assertEquals(response.badgeTitle, "Reflection");
  assertEquals(response.body, "The account was made plain.");
  assertEquals(response.badgeBody, "The account was made plain.");
  assertEquals(response.detailBody, "The account was made plain.");
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing observed medium reflection uses V4 solo tension", () => {
  const response = renderMaatFlowResponse(
    synthesizeMaatFlowDecanPattern({
      ...decan,
      completionEvidence: [
        badgeFor("observed", "2026-05-18"),
        badgeFor("observed", "2026-05-19"),
      ],
    }),
    "reflection",
  );
  assertExists(response);

  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "observed");
  assertEquals(
    response.centralTension,
    "The account was made plain. What was named can now be carried without decoration.",
  );
  assertEquals(response.badgeBody, "The account was made plain.");
  assertEquals(response.selectedSeed.semanticFamily, "account_completed");
  assertEquals(response.centralTensionSemanticFamily, "account_completed");
  assertEquals(
    response.detailBody,
    "The account was made plain. What was named can now be carried without decoration.",
  );
  assertEquals(response.body, response.centralTension);
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing partial reflection renders without LLM and names interruption", () => {
  const response = renderFixture("partial");

  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "partial");
  assertEquals(
    response.body,
    "The account was opened, but not completed. What remains unnamed should stay simple enough to return to.",
  );
  assertEquals(
    response.badgeBody,
    "The account was opened, but not completed.",
  );
  assertEquals(
    response.detailBody,
    "The account was opened, but not completed. What remains unnamed should stay simple enough to return to.",
  );
  assertEquals(response.centralTension, undefined);
  assertEquals(
    response.selectedSeed.semanticFamily,
    "account_opened_incomplete",
  );
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing skipped reflection renders without LLM and names set-aside account", () => {
  const response = renderFixture("skipped_explicit");

  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "skipped_explicit");
  assertEquals(
    response.body,
    "The sitting was set aside. What was set aside still needs a plain account.",
  );
  assertEquals(
    response.detailBody,
    "The sitting was set aside. What was set aside still needs a plain account.",
  );
  assertEquals(response.centralTension, undefined);
  assertEquals(response.badgeBody, "The sitting was set aside.");
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing unobserved reflection renders without LLM and stays neutral", () => {
  const response = renderFixture("unobserved");

  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "unobserved");
  assertEquals(
    response.body,
    "No record was made here. Absence is not a verdict.",
  );
  assertEquals(
    response.badgeBody,
    "No record was made here. Absence is not a verdict.",
  );
  assertEquals(
    /\b(avoid|refus|shame|failure|failed|lazy|dishonest|urgent)\b/i.test(
      response.body,
    ),
    false,
  );
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing observed plus partial suppresses same-family seed append", () => {
  const response = renderFixture("observed_plus_partial");

  assertEquals(response.confidence, "medium");
  assertEquals(
    response.centralTension,
    "The account was opened, but not all of it was named. What remains unfinished does not disappear — it waits in the same condition it was left.",
  );
  assertEquals(
    response.selectedSeed.semanticFamily,
    "account_opened_incomplete",
  );
  assertEquals(
    response.centralTensionSemanticFamily,
    "account_opened_incomplete",
  );
  assertEquals(
    response.badgeBody,
    "The account was opened, but not completed.",
  );
  assertEquals(
    response.detailBody,
    "The account was opened, but not all of it was named. What remains unfinished does not disappear — it waits in the same condition it was left.",
  );
  assertEquals(response.body, response.detailBody);
  assertEquals(
    occurrenceCount(response.detailBody ?? "", "account was opened"),
    1,
  );
  assertEquals(
    response.detailBody?.includes(
      "The account was opened, but not completed. What remains unnamed",
    ),
    false,
  );
  assertEquals(response.selectedSeed.tier, "partial");
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing partial plus skipped suppresses repeated set-aside seed", () => {
  const response = renderFixture("partial_plus_skipped");

  assertEquals(response.confidence, "medium");
  assertEquals(response.selectedSeed.tier, "skipped_explicit");
  assertEquals(
    response.body,
    "The sitting was set aside and the account was not opened. What is not named does not resolve on its own. The account can still be reopened with one plain statement of what the period contained.",
  );
  assertEquals(response.detailBody, response.body);
  assertEquals(response.centralTensionSemanticFamily, "sitting_set_aside");
  assertEquals(response.selectedSeed.semanticFamily, "sitting_set_aside");
  assertEquals(occurrenceCount(response.detailBody ?? "", "set aside"), 1);
  assertEquals(
    response.detailBody?.includes("What was set aside still needs"),
    false,
  );
  assertEquals(response.badgeBody, "The sitting was set aside.");
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing reflection composes different semantic families", () => {
  const basePattern = patternForFixture("observed");
  const response = renderMaatFlowResponse(
    {
      ...basePattern,
      centralTension:
        "What is known but not carried in conduct remains unweighed.",
      centralTensionSemanticFamily: "accountability_embodiment",
      centralTensionCompositionRole: "decan_pattern",
      confidence: "medium",
    },
    "reflection",
  );
  assertExists(response);

  assertEquals(response.selectedSeed.semanticFamily, "account_completed");
  assertEquals(
    response.centralTensionSemanticFamily,
    "accountability_embodiment",
  );
  assertEquals(
    response.detailBody,
    "What is known but not carried in conduct remains unweighed. The account was made plain.",
  );
  assertEquals(response.badgeBody, "The account was made plain.");
});

Deno.test("orientation and alignment use selected seeds with lower-third badge metadata", () => {
  const pattern = patternForFixture("observed_plus_partial");
  const orientation = renderMaatFlowResponse(pattern, "orientation");
  const alignment = renderMaatFlowResponse(pattern, "alignment");
  assertExists(orientation);
  assertExists(alignment);

  assertEquals(orientation.usedLlm, false);
  assertEquals(orientation.body, orientation.selectedSeed.seed);
  assertEquals(
    orientation.body,
    "Keep the record plain before drawing meaning from it.",
  );
  assertEquals(orientation.badgeTitle, "Orientation");
  assertEquals(orientation.selectedSeed.badgeRole, "opening_orientation");
  assertEquals(orientation.selectedSeed.preferredSurface, "lower_third_badge");
  assertEquals(orientation.selectedSeed.constraints.actionRequired, false);
  assertEquals(/\b(write|sit|name)\b/i.test(orientation.body), false);

  assertEquals(alignment.usedLlm, false);
  assertEquals(alignment.body, alignment.selectedSeed.seed);
  assertEquals(
    alignment.body,
    "Name the part that remains unfinished, without explaining it.",
  );
  assertEquals(alignment.badgeTitle, "Alignment");
  assertEquals(alignment.selectedSeed.badgeRole, "mid_decan_alignment");
  assertEquals(alignment.selectedSeed.preferredSurface, "lower_third_badge");
  assertEquals(alignment.selectedSeed.constraints.actionRequired, true);
  assertEquals(/\b(write|sit|name)\b/i.test(alignment.body), true);
});

Deno.test("deterministic renderer excludes selected doNotSay phrases", () => {
  for (
    const fixture of [
      "observed",
      "partial",
      "skipped_explicit",
      "unobserved",
      "observed_plus_partial",
      "partial_plus_skipped",
    ]
  ) {
    assertDoNotSayAbsent(patternForFixture(fixture));
  }
});

Deno.test("deterministic reflection outputs pass Ma'at binding validation", () => {
  for (
    const fixture of [
      "observed",
      "partial",
      "skipped_explicit",
      "unobserved",
      "observed_plus_partial",
      "partial_plus_skipped",
    ]
  ) {
    const pattern = patternForFixture(fixture);
    const response = renderMaatFlowResponse(pattern, "reflection");
    assertExists(response);
    const check = validateMaatFlowReflectionTextBinding(response.body, pattern);
    assertEquals(
      check.reasons.includes("imperative_sentence_forbidden"),
      false,
      `${fixture} should not trigger imperative_sentence_forbidden`,
    );
    assertEquals(check.ok, true, `${fixture}: ${check.reasons.join(", ")}`);
  }
});

Deno.test("Ma'at runtime render mode requires server flag and explicit admin opt-in for LLM", () => {
  assertEquals(
    resolveMaatFlowRuntimeRenderMode({
      hasMaatFlowSpectrumResponse: true,
      allowLlmMaatRuntime: false,
      explicitAdminLlmRequested: true,
    }),
    {
      allowLlmForMaatFlowResponse: false,
      useDeterministicMaatFlowRenderer: true,
    },
  );
  assertEquals(
    resolveMaatFlowRuntimeRenderMode({
      hasMaatFlowSpectrumResponse: true,
      allowLlmMaatRuntime: true,
      explicitAdminLlmRequested: false,
    }),
    {
      allowLlmForMaatFlowResponse: false,
      useDeterministicMaatFlowRenderer: true,
    },
  );
  assertEquals(
    resolveMaatFlowRuntimeRenderMode({
      hasMaatFlowSpectrumResponse: true,
      allowLlmMaatRuntime: true,
      explicitAdminLlmRequested: true,
    }),
    {
      allowLlmForMaatFlowResponse: true,
      useDeterministicMaatFlowRenderer: false,
    },
  );
});
