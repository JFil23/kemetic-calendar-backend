import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type { ReflectionCalendarFrame } from "./reflection_calendar.ts";
import type { ReflectionJudgment } from "./reflection_judgment.ts";
import type { ReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";

export type ReflectionEvidenceVisibility =
  | "visible_anchor"
  | "background_support"
  | "diagnostics_only";

export type ReflectionThesisGate = {
  version: "reflection_thesis_gate_v1";
  finalReflectionThesis: string;
  visibleTopic: string;
  evidenceVisibility: ReflectionEvidenceVisibility;
  evidenceUseReason: string;
  userMeaning: string;
  maatDirective: string;
  forbiddenSurfaceFocus: string[];
};

export type ReflectionThesisGateInput = {
  judgment: ReflectionJudgment;
  selectedEvidenceAnchor?: string | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  profileSnapshot?: ReflectionProfileSnapshot | null;
  calendarFrame?: ReflectionCalendarFrame | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function hasSingleRecurringNutritionThread(
  threads?: MaatNormalizedObligationThreads | null,
) {
  const nutrition = threads?.nutrition;
  return Boolean(
    nutrition &&
      nutrition.unique_item_count === 1 &&
      nutrition.same_item_repeated,
  );
}

function nutritionThreadText(threads?: MaatNormalizedObligationThreads | null) {
  return (threads?.threads ?? [])
    .filter((thread) => thread.domain === "nutrition")
    .flatMap((thread) => [
      thread.label,
      ...thread.sources,
      ...thread.purposes,
    ])
    .join(" ")
    .toLowerCase();
}

function hasClinicalNutritionSignal(
  threads?: MaatNormalizedObligationThreads | null,
) {
  return /\b(medication|medicine|insulin|blood sugar|glucose|prescribed|doctor|clinical|hydration target|medical)\b/
    .test(nutritionThreadText(threads));
}

function hasOtherDomainSignal(
  threads?: MaatNormalizedObligationThreads | null,
) {
  return (threads?.todo.unique_item_count ?? 0) > 0 ||
    (threads?.threads ?? []).some((thread) => thread.domain !== "nutrition");
}

function nutritionAnchorIsLoud(
  input: ReflectionThesisGateInput,
) {
  const anchor = clean(
    input.selectedEvidenceAnchor || input.judgment.evidenceAnchor,
  )
    .toLowerCase();
  return /\b(nutrition|vitamin|supplement|body[- ]care|body[- ]support|support thread|confirmed mark)\b/
    .test(anchor) || hasSingleRecurringNutritionThread(
      input.normalizedObligationThreads,
    );
}

function defaultForbiddenFocus(input: ReflectionThesisGateInput) {
  const forbidden = [
    "nutrition",
    "vitamin",
    "supplement",
    "body-care promise",
    "body care promise",
    "body-support thread",
    "body support thread",
    "support thread",
    "confirmed mark",
    "confirmed place",
    "recording rhythm",
    "logging",
    "tracking",
    "check",
  ];
  const threadText = nutritionThreadText(input.normalizedObligationThreads);
  if (threadText.includes("apple")) forbidden.push("apple");
  if (threadText.includes("strong bones")) forbidden.push("strong bones");
  return [...new Set(forbidden)];
}

export function buildReflectionThesisGate(
  input: ReflectionThesisGateInput,
): ReflectionThesisGate {
  const singleRecurringNutrition = hasSingleRecurringNutritionThread(
    input.normalizedObligationThreads,
  );
  const clinicalNutrition = hasClinicalNutritionSignal(
    input.normalizedObligationThreads,
  );
  const otherDomainSignal = hasOtherDomainSignal(
    input.normalizedObligationThreads,
  );
  const loudNutrition = nutritionAnchorIsLoud(input);
  const backgroundNutrition = singleRecurringNutrition && !clinicalNutrition &&
    !otherDomainSignal;
  const visibility: ReflectionEvidenceVisibility = backgroundNutrition
    ? "background_support"
    : clinicalNutrition || !loudNutrition
    ? "visible_anchor"
    : "background_support";
  const finalReflectionThesis = clean(input.judgment.reflectionThesis) ||
    "Ma'at is asking for the visible record to serve the deeper moral question.";
  const visibleTopic = visibility === "visible_anchor"
    ? clean(input.judgment.evidenceAnchor) || "one concrete sign"
    : input.judgment.selectedMaatLens === "truth" ||
        input.judgment.selectedMaatLens === "witness"
    ? "honest record"
    : input.judgment.selectedMaatLens === "life_preservation"
    ? "keepable care"
    : "right-sized care";
  const userMeaning = backgroundNutrition
    ? "The evidence suggests intention seeking structure; the reflection should speak to the user's relation to Ma'at, not to the repeated item."
    : input.judgment.userProfileConnection;
  const maatDirective = backgroundNutrition
    ? "Make the care simple enough to keep, or release it from the active list until it can be carried honestly."
    : input.judgment.deeperDirective;
  return {
    version: "reflection_thesis_gate_v1",
    finalReflectionThesis,
    visibleTopic,
    evidenceVisibility: visibility,
    evidenceUseReason: backgroundNutrition
      ? "Single recurring nutrition evidence is structurally loud, so it should support the judgment from the background instead of becoming the visible topic."
      : visibility === "visible_anchor"
      ? "The selected evidence deepens the moral reading enough to be visible."
      : "The selected evidence supports the thesis but should not lead the body copy.",
    userMeaning,
    maatDirective,
    forbiddenSurfaceFocus: visibility === "visible_anchor"
      ? []
      : defaultForbiddenFocus(input),
  };
}

export function reflectionThesisGatePromptBlock(
  gate: ReflectionThesisGate | null | undefined,
) {
  if (!gate) return "";
  return [
    "REFLECTION_THESIS_GATE (controls what may be visible in the body; do not print this heading or labels):",
    `Final reflection thesis: ${gate.finalReflectionThesis}`,
    `Visible topic: ${gate.visibleTopic}`,
    `Evidence visibility: ${gate.evidenceVisibility}`,
    `Evidence use reason: ${gate.evidenceUseReason}`,
    `User meaning: ${gate.userMeaning}`,
    `Ma'at directive: ${gate.maatDirective}`,
    gate.forbiddenSurfaceFocus.length
      ? `Forbidden surface focus: ${gate.forbiddenSurfaceFocus.join(", ")}`
      : "Forbidden surface focus: none",
    "Hard rule: if evidence visibility is background_support or diagnostics_only, do not name the item/source or make the evidence anchor the subject of the reflection. Keep the user-facing language plain.",
  ].join("\n");
}
