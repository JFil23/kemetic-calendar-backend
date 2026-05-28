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
  buildFallbackReflectionMoralPortrait,
  buildReflectionMoralPortraitPrompt,
  parseReflectionMoralPortrait,
  reflectionMoralPortraitPromptBlock,
} from "./reflection_moral_portrait.ts";

Deno.test("reflection moral portrait witnesses becoming before evidence repair", () => {
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

  const portrait = buildFallbackReflectionMoralPortrait({
    calendarFrame,
    profileSnapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });

  assertStringIncludes(portrait.decanCall, "Hathor");
  assertStringIncludes(portrait.sacredDimension, "intention");
  assertStringIncludes(portrait.naturalDimension, "body");
  assertStringIncludes(portrait.serudjCall, "Restore");
  assertStringIncludes(portrait.portraitStatement, "care");
  assertStringIncludes(portrait.personBecomingStatement, "becoming");
  assertStringIncludes(portrait.serudjDirective, "Restore");
  assert(portrait.forbiddenFramings.includes("next reflection"));
  assertEquals(portrait.portraitStatement.includes("less guesswork"), false);
  assertEquals(
    /\brecord|account|mark|evidence\b/i.test(portrait.serudjDirective),
    false,
  );
});

Deno.test("reflection moral portrait parser accepts structured JSON only", () => {
  const portrait = parseReflectionMoralPortrait(`{
    "decanCall": "Hathor's first decan sꜣḥ called for stability regained.",
    "sacredDimension": "Your inner life is turning toward truth instead of pressure.",
    "relationalDimension": "Your care needs a form that does not become heavier than the day.",
    "naturalDimension": "The body and season ask for a rhythm that can be carried.",
    "heartSignal": "Your heart is moving before it has fully named what moved.",
    "serudjCall": "Restore one thing by raising it into form.",
    "geruMaaOrientation": "Composure means choosing from truth.",
    "portraitStatement": "You are building faster than you are naming what moved.",
    "personBecomingStatement": "You are becoming someone who can choose from truth instead of pressure.",
    "serudjDirective": "Return inward long enough to name what moved for yourself.",
    "forbiddenFramings": ["next reflection", "less guesswork"]
  }`);

  assert(portrait);
  assertEquals(portrait.source, "anthropic");
  assertStringIncludes(portrait.portraitStatement, "building");
  assertStringIncludes(portrait.serudjDirective, "Return inward");
});

Deno.test("reflection moral portrait prompt forbids system-serving framings", () => {
  const prompt = buildReflectionMoralPortraitPrompt({});
  assertStringIncludes(prompt, "ideal theme");
  assertStringIncludes(prompt, "serudj");
  assertStringIncludes(prompt, "next reflection");
  assertStringIncludes(prompt, "Do not serve the app's evidence problem");

  const block = reflectionMoralPortraitPromptBlock(
    buildFallbackReflectionMoralPortrait({}),
  );
  assertStringIncludes(block, "Portrait statement");
  assertStringIncludes(block, "Person becoming statement");
  assertStringIncludes(block, "Serudj directive");
  assertStringIncludes(block, "Forbidden framings");
});
