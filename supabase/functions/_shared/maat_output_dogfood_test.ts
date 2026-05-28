// deno-lint-ignore-file no-import-prefix

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  formatMaatDogfoodReport,
  type MaatDogfoodTruthLoopRow,
  parseMaatDogfoodAnnotations,
  reviewMaatDogfoodOutputs,
} from "./maat_output_dogfood.ts";

function row(
  overrides: Partial<MaatDogfoodTruthLoopRow>,
): MaatDogfoodTruthLoopRow {
  return {
    output_id: "output-1",
    source_type: "guidance",
    surface: "drift_nudge",
    speech_act: "correct",
    status: "shown",
    delivery_channel: "in_app_card",
    body_text:
      "The record names the drift without condemning it. Restore one anchor and let order return through that act.",
    output_generated_at: "2026-05-23T09:00:00.000Z",
    grade: {
      pass: true,
      groundingScore: 5,
      specificityScore: 5,
      maatAlignmentScore: 5,
      ceremonialCadenceScore: 5,
      actionClarityScore: 5,
      failureReasons: [],
    },
    grade_passed: true,
    guidance_worthiness_score: 4.7,
    delivery_recommendation: "in_app_card",
    repair_attempted: false,
    was_repaired: false,
    repair_mode: null,
    repair_reason: null,
    repair_grade_delta: null,
    user_opened: true,
    user_acted: false,
    dismissed: false,
    was_interruptive: false,
    dismissed_within_seconds: null,
    followup_behavior_window: null,
    ...overrides,
  };
}

Deno.test("dogfood review flags high-worthiness fast dismisses as repair and eval candidates", () => {
  const report = reviewMaatDogfoodOutputs(
    [
      row({
        output_id: "fast-dismiss",
        dismissed: true,
        dismissed_within_seconds: 4,
        was_interruptive: true,
        guidance_worthiness_score: 4.6,
      }),
    ],
    [],
    new Date("2026-05-23T10:00:00.000Z"),
  );

  const reviewed = report.reviewed[0];
  assertEquals(reviewed.disposition, "repair");
  assert(reviewed.failureTags.includes("high_worthiness_fast_dismiss"));
  assert(reviewed.failureTags.includes("should_become_eval_case"));
  assertEquals(report.summary.highWorthinessFastDismiss, 1);
  assertEquals(report.summary.evalCandidates, 1);
  assertEquals(report.evalDrafts[0].sourceOutputId, "fast-dismiss");
});

Deno.test("dogfood review routes low-worthiness interruptions to archive-only", () => {
  const report = reviewMaatDogfoodOutputs(
    [
      row({
        output_id: "weak-push",
        delivery_channel: "push",
        delivery_recommendation: "archive_only",
        guidance_worthiness_score: 3.4,
        was_interruptive: true,
      }),
    ],
    [],
    new Date("2026-05-23T10:00:00.000Z"),
  );

  const reviewed = report.reviewed[0];
  assertEquals(reviewed.disposition, "archive_only");
  assert(reviewed.failureTags.includes("not_worth_interrupting"));
  assert(reviewed.failureTags.includes("wrong_delivery_channel"));
  assertEquals(report.summary.notWorthInterrupting, 1);
});

Deno.test("dogfood review catches repairs that degrade ceremonial cadence", () => {
  const report = reviewMaatDogfoodOutputs(
    [
      row({
        output_id: "flat-repair",
        was_repaired: true,
        repair_attempted: true,
        repair_mode: "grounding_repair",
        repair_grade_delta: {
          grounding_score: 1,
          ceremonial_cadence_score: -1,
        },
      }),
    ],
    [],
    new Date("2026-05-23T10:00:00.000Z"),
  );

  const reviewed = report.reviewed[0];
  assertEquals(reviewed.disposition, "repair");
  assert(reviewed.failureTags.includes("repair_degraded_cadence"));
  assert(reviewed.failureTags.includes("cadence_failure"));
  assertEquals(report.summary.repairDegradedCadence, 1);
});

Deno.test("dogfood annotations can force eval-case disposition with reviewer notes", () => {
  const annotations = parseMaatDogfoodAnnotations(JSON.stringify({
    annotations: [
      {
        outputId: "manual-failure",
        disposition: "eval_case",
        failureTags: ["moral_posture_failure", "should_become_eval_case"],
        reviewSource: "real_usage",
        dominantFailure: "moral_posture",
        notes: "Too eager to correct before witnessing the actual state.",
      },
    ],
  }));
  const report = reviewMaatDogfoodOutputs(
    [
      row({ output_id: "manual-failure" }),
    ],
    annotations,
    new Date("2026-05-23T10:00:00.000Z"),
  );

  assertEquals(report.reviewed[0].disposition, "eval_case");
  assertEquals(report.reviewed[0].reviewSource, "real_usage");
  assertEquals(report.reviewed[0].dominantFailure, "moral_posture");
  assertEquals(report.reviewed[0].conversionReady, true);
  assert(report.reviewed[0].failureTags.includes("moral_posture_failure"));
  assertEquals(report.evalDrafts[0].goldNotes, annotations[0].notes);
  assertEquals(report.evalDrafts[0].reviewSource, "real_usage");
  assertEquals(report.evalDrafts[0].dominantFailure, "moral_posture");
  assertEquals(report.evalDrafts[0].conversionReady, true);

  const markdown = formatMaatDogfoodReport(report);
  assert(markdown.includes("## Summary"));
  assert(markdown.includes("manual-failure"));
  assert(markdown.includes("Too eager to correct"));
  assert(markdown.includes("eval_draft_conversion_rate: 0.00"));
});

Deno.test("dogfood review tracks real failure eval conversion rate without counting smoke rows", () => {
  const annotations = parseMaatDogfoodAnnotations(JSON.stringify({
    annotations: [
      {
        outputId: "real-unconverted",
        disposition: "eval_case",
        reviewSource: "real_usage",
        dominantFailure: "cadence",
        failureTags: ["cadence_failure", "should_become_eval_case"],
        notes: "Real output flattened the voice after repair.",
      },
      {
        outputId: "real-converted",
        disposition: "eval_case",
        reviewSource: "real_usage",
        dominantFailure: "worthiness",
        failureTags: [
          "high_worthiness_fast_dismiss",
          "should_become_eval_case",
        ],
        convertedEvalCaseId: "real_dogfood_fast_dismiss_20260523",
        notes: "Committed as a permanent fast-dismiss regression case.",
      },
      {
        outputId: "smoke-failure",
        disposition: "eval_case",
        reviewSource: "smoke",
        failureTags: ["cadence_failure", "should_become_eval_case"],
      },
    ],
  }));
  const report = reviewMaatDogfoodOutputs(
    [
      row({ output_id: "real-unconverted" }),
      row({ output_id: "real-converted" }),
      row({ output_id: "smoke-failure" }),
    ],
    annotations,
    new Date("2026-05-23T10:00:00.000Z"),
  );

  assertEquals(report.summary.realReviewedFailures, 2);
  assertEquals(report.summary.evalCasesConverted, 1);
  assertEquals(report.summary.evalDraftConversionRate, 0.5);
  assert(
    report.evalDrafts.some((draft) =>
      draft.sourceOutputId === "real-unconverted" && draft.conversionReady
    ),
  );
  assert(
    !report.evalDrafts.some((draft) =>
      draft.sourceOutputId === "real-converted"
    ),
  );
  assert(
    report.evalDrafts.some((draft) =>
      draft.sourceOutputId === "smoke-failure" && !draft.conversionReady
    ),
  );
});
