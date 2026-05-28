import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { getDecanContext } from "./decan_context.ts";
import { buildNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import { buildReflectionCalendarFrame } from "./reflection_calendar.ts";
import { buildFallbackReflectionJudgment } from "./reflection_judgment.ts";
import { buildReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";
import {
  buildReflectionThesisGate,
  reflectionThesisGatePromptBlock,
} from "./reflection_thesis_gate.ts";

Deno.test("reflection thesis gate keeps single recurring nutrition as background support", () => {
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
  const profileSnapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const judgment = buildFallbackReflectionJudgment({
    calendarFrame,
    profileSnapshot,
    normalizedObligationThreads,
  });
  const gate = buildReflectionThesisGate({
    judgment,
    selectedEvidenceAnchor: profileSnapshot.bestEvidenceAnchor?.claim,
    normalizedObligationThreads,
    profileSnapshot,
    calendarFrame,
  });

  assertEquals(gate.evidenceVisibility, "background_support");
  assertEquals(gate.visibleTopic, "right-sized care");
  assert(gate.forbiddenSurfaceFocus.includes("vitamin"));
  assert(gate.forbiddenSurfaceFocus.includes("apple"));
  assert(gate.maatDirective.includes("Make the care simple enough to keep"));

  const promptBlock = reflectionThesisGatePromptBlock(gate);
  assert(promptBlock.includes("Evidence visibility: background_support"));
  assert(promptBlock.includes("do not name the item/source"));
});

Deno.test("reflection thesis gate allows clinically relevant nutrition anchor to remain visible", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: medication with food Planner nutrition entry for 2026-05-19. State: pending. Source: prescribed medicine. Purpose: clinical timing. kind:nutrition state:pending",
    "Nutrition: medication with food Planner nutrition entry for 2026-05-20. State: pending. Source: prescribed medicine. Purpose: clinical timing. kind:nutrition state:pending",
    "Nutrition: medication with food Planner nutrition entry for 2026-05-21. State: pending. Source: prescribed medicine. Purpose: clinical timing. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const profileSnapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const judgment = buildFallbackReflectionJudgment({
    calendarFrame,
    profileSnapshot,
    normalizedObligationThreads,
  });
  const gate = buildReflectionThesisGate({
    judgment,
    selectedEvidenceAnchor: profileSnapshot.bestEvidenceAnchor?.claim,
    normalizedObligationThreads,
    profileSnapshot,
    calendarFrame,
  });

  assertEquals(gate.evidenceVisibility, "visible_anchor");
  assertEquals(gate.forbiddenSurfaceFocus, []);
  assert(gate.evidenceUseReason.includes("deepens the moral reading"));
});
