import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { getDecanContext } from "./decan_context.ts";
import { buildNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import {
  buildReflectionAlignmentMap,
  buildReflectionArcPlan,
  buildReflectionCalendarFrame,
} from "./reflection_calendar.ts";
import { buildReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";
import {
  buildFallbackReflectionJudgment,
  buildReflectionJudgmentPrompt,
  parseReflectionJudgment,
  reflectionJudgmentPromptBlock,
} from "./reflection_judgment.ts";
import { buildFallbackReflectionMoralPortrait } from "./reflection_moral_portrait.ts";

Deno.test("reflection judgment turns recurring nutrition into truthful measure thesis", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
  });
  const arcPlan = buildReflectionArcPlan({ calendarFrame, alignmentMap });
  const profileSnapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const moralPortrait = buildFallbackReflectionMoralPortrait({
    calendarFrame,
    profileSnapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const judgment = buildFallbackReflectionJudgment({
    calendarFrame,
    moralPortrait,
    profileSnapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });

  assertEquals(judgment.selectedMaatLens, "measure");
  assertStringIncludes(judgment.reflectionThesis, "becoming");
  assertStringIncludes(judgment.reflectionThesis, "care");
  assertStringIncludes(judgment.falseReadingToAvoid, "nutrition compliance");
  assertStringIncludes(judgment.deeperDirective, "Restore");
  assertEquals(
    judgment.closingText,
    "What care are you willing to make truly keepable?",
  );
});

Deno.test("reflection judgment parser accepts structured JSON only", () => {
  const judgment = parseReflectionJudgment(`{
    "primaryMaatQuestion": "Is the obligation sized and placed so it can be kept?",
    "selectedMaatLens": "measure",
    "secondaryMaatLens": "truth",
    "falseReadingToAvoid": "Do not make this about productivity.",
    "centralMoralReading": "The account is asking for proportion before expansion.",
    "alignment": "The work was named clearly.",
    "underalignment": "The open endings outgrew the period.",
    "evidenceAnchor": "visible work carried several open endings",
    "userProfileConnection": "The profile suggests accumulation before closure.",
    "deeperDirective": "Release one open loop before adding another.",
    "reflectionThesis": "Ma'at is asking for right measure before more work is added.",
    "closingKind": "question",
    "closingText": "What open loop would restore the most order if released?"
  }`);

  assert(judgment);
  assertEquals(judgment.selectedMaatLens, "measure");
  assertEquals(judgment.secondaryMaatLens, "truth");
  assertEquals(judgment.source, "anthropic");
});

Deno.test("reflection judgment prompt requires false reading and thesis", () => {
  const prompt = buildReflectionJudgmentPrompt({});
  assertStringIncludes(prompt, "Do not choose the densest evidence");
  assertStringIncludes(prompt, "MORAL_PORTRAIT");
  assertStringIncludes(prompt, "falseReadingToAvoid");
  assertStringIncludes(prompt, "reflectionThesis");

  const block = reflectionJudgmentPromptBlock(
    buildFallbackReflectionJudgment({}),
  );
  assertStringIncludes(block, "Reflection thesis");
  assertStringIncludes(block, "False reading to avoid");
});
