// deno-lint-ignore-file no-import-prefix

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
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
  assertStringIncludes(
    response.body,
    "The record was brought to the scale without alteration.",
  );
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing partial reflection renders without LLM and names interruption", () => {
  const response = renderFixture("partial");

  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "partial");
  assertStringIncludes(response.body, "entered but not completed");
  assertStringIncludes(response.body, "the full account was not placed");
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing skipped reflection renders without LLM and names set-aside account", () => {
  const response = renderFixture("skipped_explicit");

  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "skipped_explicit");
  assertStringIncludes(response.body, "available and set aside");
  assertStringIncludes(response.body, "account being opened");
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing unobserved reflection renders without LLM and stays neutral", () => {
  const response = renderFixture("unobserved");

  assertEquals(response.usedLlm, false);
  assertEquals(response.selectedSeed.tier, "unobserved");
  assertStringIncludes(response.body, "No record exists for this sitting.");
  assertStringIncludes(response.body, "nothing to weigh");
  assertEquals(
    /\b(avoid|refus|shame|failure|failed|lazy|dishonest|urgent)\b/i.test(
      response.body,
    ),
    false,
  );
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing observed plus partial reflection uses central tension and partial seed", () => {
  const response = renderFixture("observed_plus_partial");

  assertEquals(response.confidence, "medium");
  assertEquals(
    response.centralTension,
    "The scale was approached and the account opened, but not all of it reached the scale.",
  );
  assertStringIncludes(
    response.body,
    "The scale was approached and the account opened, but not all of it reached the scale.",
  );
  assertStringIncludes(
    response.body,
    "The sitting was entered but not completed. The scale was approached; the full account was not placed.",
  );
  assertEquals(response.selectedSeed.tier, "partial");
  assertNoReflectionImperative(response.body);
});

Deno.test("Weighing partial plus skipped reflection uses skipped set-aside semantics", () => {
  const response = renderFixture("partial_plus_skipped");

  assertEquals(response.confidence, "medium");
  assertEquals(response.selectedSeed.tier, "skipped_explicit");
  assertStringIncludes(response.body, "The sitting was available.");
  assertStringIncludes(response.body, "The account was not opened.");
  assertStringIncludes(response.body, "available and set aside");
  assertNoReflectionImperative(response.body);
});

Deno.test("orientation and alignment use selected seeds with lower-third badge metadata", () => {
  const pattern = patternForFixture("observed_plus_partial");
  const orientation = renderMaatFlowResponse(pattern, "orientation");
  const alignment = renderMaatFlowResponse(pattern, "alignment");
  assertExists(orientation);
  assertExists(alignment);

  assertEquals(orientation.usedLlm, false);
  assertEquals(orientation.body, orientation.selectedSeed.seed);
  assertEquals(orientation.badgeTitle, "Orientation");
  assertEquals(orientation.selectedSeed.badgeRole, "opening_orientation");
  assertEquals(orientation.selectedSeed.preferredSurface, "lower_third_badge");
  assertEquals(orientation.selectedSeed.constraints.actionRequired, false);

  assertEquals(alignment.usedLlm, false);
  assertEquals(alignment.body, alignment.selectedSeed.seed);
  assertEquals(alignment.badgeTitle, "Alignment");
  assertEquals(alignment.selectedSeed.badgeRole, "mid_decan_alignment");
  assertEquals(alignment.selectedSeed.preferredSurface, "lower_third_badge");
  assertEquals(alignment.selectedSeed.constraints.actionRequired, true);
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
