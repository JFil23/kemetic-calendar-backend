// deno-lint-ignore-file no-import-prefix

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  MAAT_CONSTITUTION_VERSION,
  MAAT_OUTPUT_CONSTITUTION,
  MAAT_OUTPUT_FORCE_PRINCIPLE,
  MAAT_OUTPUT_NORTH_STAR,
  MAAT_SOURCE_ANCHORS,
  MAAT_SURFACE_RUBRIC,
  maatConstitutionPromptBlock,
  type MaatOutputSurface,
} from "./maat_constitution.ts";
import { MAAT_OUTPUT_EVAL_CASES } from "./maat_output_eval_cases.ts";
import {
  evaluateMaatOutputCandidate,
  summarizeMaatOutputEvalResults,
} from "./maat_output_eval_runner.ts";

Deno.test("Ma'at constitution exposes north star, force, and source anchors", () => {
  assert(MAAT_OUTPUT_NORTH_STAR.includes("durable order"));
  assert(MAAT_OUTPUT_FORCE_PRINCIPLE.includes("precision"));
  assert(MAAT_OUTPUT_CONSTITUTION.includes("Never invent evidence."));
  assert(
    MAAT_SOURCE_ANCHORS.some((anchor) => anchor.key === "effective_speech"),
  );
  assert(
    MAAT_SOURCE_ANCHORS.some((anchor) =>
      anchor.key === "imperishable_orientation"
    ),
  );

  const promptBlock = maatConstitutionPromptBlock();
  assert(promptBlock.includes(MAAT_CONSTITUTION_VERSION));
  assert(promptBlock.includes("North star:"));
  assert(promptBlock.includes("Force principle:"));
});

Deno.test("Ma'at eval seed set covers every output surface", () => {
  assertEquals(MAAT_OUTPUT_EVAL_CASES.length, 100);
  assertEquals(
    MAAT_OUTPUT_EVAL_CASES.filter((item) => item.category === "gold").length,
    30,
  );
  assertEquals(
    MAAT_OUTPUT_EVAL_CASES.filter((item) => item.category === "adversarial")
      .length,
    30,
  );
  assertEquals(
    MAAT_OUTPUT_EVAL_CASES.filter((item) => item.category === "generated")
      .length,
    20,
  );
  assertEquals(
    MAAT_OUTPUT_EVAL_CASES.filter((item) => item.category === "emotional_edge")
      .length,
    20,
  );

  const surfaces: MaatOutputSurface[] = [
    "decan_opening",
    "drift_nudge",
    "strength_nudge",
    "decan_reflection",
  ];
  for (const surface of surfaces) {
    assert(
      MAAT_OUTPUT_EVAL_CASES.some((evalCase) => evalCase.surface === surface),
      `missing eval case for ${surface}`,
    );
  }

  for (const evalCase of MAAT_OUTPUT_EVAL_CASES) {
    const rubric = MAAT_SURFACE_RUBRIC[evalCase.surface];
    assertEquals(evalCase.expectedSpeechAct, rubric.speechAct);
    assertEquals(evalCase.requiredMoves, rubric.requiredMoves);
    assertEquals(evalCase.bannedFailures, rubric.bannedFailures);
    assert(evalCase.goldNotes.length > 0);
  }
});

Deno.test("Ma'at eval runner grades candidate output against a case", () => {
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

  assertEquals(result.passed, true);
  assertEquals(summary.total, 1);
  assertEquals(summary.passRate, 1);
  assertEquals(summary.ceremonialCadencePassRate, 1);
  assertEquals(summary.shameFailures, 0);
});
