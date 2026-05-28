// deno-lint-ignore-file no-import-prefix

import {
  assert,
  assertEquals,
  assertGreaterOrEqual,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { MAAT_OUTPUT_EVAL_CASES } from "./maat_output_eval_cases.ts";
import {
  checkMaatOutputEvalGates,
  evaluateMaatOutputCandidate,
  summarizeMaatOutputEvalResults,
} from "./maat_output_eval_runner.ts";

Deno.test("Ma'at output eval gates pass high-worthiness grounded output", () => {
  const evalCase = MAAT_OUTPUT_EVAL_CASES.find((item) =>
    item.id === "drift_missed_focus_blocks"
  );
  assert(evalCase);

  const result = evaluateMaatOutputCandidate(evalCase, {
    text:
      "Two planned focus blocks were missed, and the journal called the week scattered. One task. Give one task a clear finish condition, then close it. One clean mark is enough for today.",
    primaryAction: "give one task a clear finish condition",
  });
  const summary = summarizeMaatOutputEvalResults([result]);
  const gateReport = checkMaatOutputEvalGates(summary);

  assertGreaterOrEqual(result.grade.guidanceWorthinessScore, 4.2);
  assertEquals(result.grade.deliveryRecommendation, "in_app_card");
  assertEquals(summary.schemaValidityRate, 1);
  assertEquals(summary.speechActFidelityRate, 1);
  assertEquals(summary.worthinessPassRate, 1);
  assertEquals(gateReport.passed, true);
  assertEquals(gateReport.failures, []);
});

Deno.test("Ma'at output eval gates fail low-worthiness generic output and route archive-only", () => {
  const evalCase = MAAT_OUTPUT_EVAL_CASES.find((item) =>
    item.id === "drift_missed_focus_blocks"
  );
  assert(evalCase);

  const result = evaluateMaatOutputCandidate(evalCase, {
    text: "Stay positive. You have got this.",
    primaryAction: "give one task a clear finish condition",
  });
  const summary = summarizeMaatOutputEvalResults([result]);
  const gateReport = checkMaatOutputEvalGates(summary);

  assertEquals(result.passed, false);
  assertEquals(result.grade.deliveryRecommendation, "archive_only");
  assert(
    result.grade.failureReasons.includes(
      "worthiness_below_interrupt_threshold",
    ),
  );
  assertEquals(summary.worthinessPassRate, 0);
  assertEquals(gateReport.passed, false);
  assert(
    gateReport.failures.some((failure) => failure.gate === "worthinessRate"),
  );
  assert(
    gateReport.failures.some((failure) =>
      failure.gate === "inventedEvidenceFailuresMax"
    ),
  );
});
