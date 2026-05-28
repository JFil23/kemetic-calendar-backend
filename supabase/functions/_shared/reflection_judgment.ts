import type { MaatAlignmentLens } from "./maat_alignment_lens.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type { MaatTranslatedProfileContext } from "./profile_context_translator.ts";
import type {
  ReflectionAlignmentMap,
  ReflectionArcPlan,
  ReflectionCalendarFrame,
} from "./reflection_calendar.ts";
import type { ReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";
import type { ReflectionMoralPortrait } from "./reflection_moral_portrait.ts";

export type ReflectionJudgmentClosingKind = "question" | "charge";

export type ReflectionJudgment = {
  version: "reflection_judgment_v1";
  source: "anthropic" | "deterministic";
  primaryMaatQuestion: string;
  selectedMaatLens: MaatAlignmentLens;
  secondaryMaatLens: MaatAlignmentLens | null;
  falseReadingToAvoid: string;
  centralMoralReading: string;
  alignment: string;
  underalignment: string;
  evidenceAnchor: string;
  userProfileConnection: string;
  deeperDirective: string;
  reflectionThesis: string;
  closingKind: ReflectionJudgmentClosingKind;
  closingText: string;
};

export type ReflectionJudgmentInput = {
  calendarFrame?: ReflectionCalendarFrame | null;
  moralPortrait?: ReflectionMoralPortrait | null;
  profileSnapshot?: ReflectionProfileSnapshot | null;
  translatedProfileContext?: MaatTranslatedProfileContext | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  alignmentMap?: ReflectionAlignmentMap | null;
  arcPlan?: ReflectionArcPlan | null;
  recentOutcomes?: unknown | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function selectedLens(
  value: string | null | undefined,
): MaatAlignmentLens {
  const allowed: MaatAlignmentLens[] = [
    "truth",
    "witness",
    "measure",
    "order",
    "life_preservation",
    "restraint",
    "self_mastery",
    "reciprocity",
    "care",
    "justice",
    "vulnerable_protection",
    "offering_service",
    "harmony",
    "worthiness",
    "becoming",
    "continuity",
    "repair_isfet",
    "effective_speech",
  ];
  return allowed.includes(value as MaatAlignmentLens)
    ? value as MaatAlignmentLens
    : "measure";
}

function closingKind(value: string | null | undefined) {
  return value === "charge" ? "charge" as const : "question" as const;
}

function hasSingleRecurringNutritionThread(
  input: ReflectionJudgmentInput,
) {
  const nutrition = input.normalizedObligationThreads?.nutrition;
  return Boolean(
    nutrition &&
      nutrition.unique_item_count === 1 &&
      nutrition.same_item_repeated,
  );
}

function fallbackThesis(input: ReflectionJudgmentInput) {
  const becoming = clean(input.moralPortrait?.personBecomingStatement);
  if (becoming) return becoming;
  const portrait = clean(input.moralPortrait?.portraitStatement);
  if (portrait) return portrait;
  const lens = input.profileSnapshot?.dominantMaatLens ?? "measure";
  if (hasSingleRecurringNutritionThread(input)) {
    if (lens === "truth" || lens === "witness") {
      return "Ma'at is asking whether real care can take a truthful form, so the next step comes from what is actual rather than pressure.";
    }
    if (lens === "life_preservation") {
      return "Ma'at is asking whether care for life can become simple enough to keep.";
    }
    return "Ma'at is asking whether this care has the right size and a clear place in the day.";
  }
  if (lens === "order") {
    return "Ma'at is asking whether the open list can be put in order before more force is added.";
  }
  if (lens === "truth" || lens === "witness") {
    return "Ma'at is asking whether what moved can be named plainly enough for the next step to be chosen from truth.";
  }
  return `Ma'at is asking how ${
    lens.replaceAll("_", " ")
  } becomes a concrete repair, not an abstract ideal.`;
}

function fallbackDirective(input: ReflectionJudgmentInput) {
  const serudjDirective = clean(input.moralPortrait?.serudjDirective);
  if (serudjDirective) return serudjDirective;
  const portraitDirective = clean(input.moralPortrait?.serudjCall);
  if (portraitDirective) return portraitDirective;
  const snapshot = input.profileSnapshot;
  if (hasSingleRecurringNutritionThread(input)) {
    return "Give the care one clear place in the day, or release it until it can be kept honestly.";
  }
  return snapshot?.repairDirection ||
    "Choose the one repair that makes the record more honest and keepable.";
}

export function buildFallbackReflectionJudgment(
  input: ReflectionJudgmentInput,
): ReflectionJudgment {
  const snapshot = input.profileSnapshot;
  const portrait = input.moralPortrait;
  const lens = selectedLens(snapshot?.dominantMaatLens);
  const thesis = fallbackThesis(input);
  const directive = fallbackDirective(input);
  const recurringNutrition = hasSingleRecurringNutritionThread(input);
  return {
    version: "reflection_judgment_v1",
    source: "deterministic",
    primaryMaatQuestion: snapshot?.ethicalQuestion ||
      "What dimension of Ma'at is being cultivated by this decan?",
    selectedMaatLens: lens,
    secondaryMaatLens: snapshot?.secondaryMaatLens ?? null,
    falseReadingToAvoid: recurringNutrition
      ? "Do not make this reflection about nutrition compliance, logging mechanics, or the repeated item itself."
      : "Do not reduce the reflection to habit coaching or surface completion.",
    centralMoralReading: clean(portrait?.personBecomingStatement) ||
      clean(portrait?.portraitStatement) ||
      (recurringNutrition
        ? "The user is carrying care as intention before it has become simple enough to keep."
        : snapshot?.interpretiveSpecificity.derivedReading ||
          snapshot?.lensReason ||
          "The decan reveals a Ma'at question underneath the visible behavior."),
    alignment: clean(portrait?.heartSignal) ||
      snapshot?.interpretiveSpecificity.alignmentDetail ||
      snapshot?.alignmentReading ||
      "The record answered where you returned instead of abandoning the thread.",
    underalignment: clean(portrait?.serudjDirective) ||
      clean(portrait?.serudjCall) ||
      snapshot?.interpretiveSpecificity.underalignmentDetail ||
      snapshot?.underalignmentReading ||
      "The weak point is where the record does not yet show the act clearly.",
    evidenceAnchor: snapshot?.bestEvidenceAnchor?.claim ||
      "one concrete mark from the decan",
    userProfileConnection: snapshot?.lensReason ||
      snapshot?.userPatternSummary ||
      "The user profile is still emerging, so the reading should stay proportionate.",
    deeperDirective: directive,
    reflectionThesis: thesis,
    closingKind: closingKind(input.arcPlan?.closingKind),
    closingText: recurringNutrition
      ? "What care are you willing to make truly keepable?"
      : input.arcPlan?.closingText ||
        "What moved this decan that deserves to be named for your own next step?",
  };
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

export function parseReflectionJudgment(
  raw: string,
): ReflectionJudgment | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const required = [
    "primaryMaatQuestion",
    "selectedMaatLens",
    "falseReadingToAvoid",
    "centralMoralReading",
    "alignment",
    "underalignment",
    "evidenceAnchor",
    "userProfileConnection",
    "deeperDirective",
    "reflectionThesis",
    "closingKind",
    "closingText",
  ];
  if (
    required.some((key) =>
      typeof parsed[key] !== "string" ||
      clean(parsed[key] as string).length === 0
    )
  ) {
    return null;
  }
  return {
    version: "reflection_judgment_v1",
    source: "anthropic",
    primaryMaatQuestion: clean(parsed.primaryMaatQuestion as string),
    selectedMaatLens: selectedLens(parsed.selectedMaatLens as string),
    secondaryMaatLens: typeof parsed.secondaryMaatLens === "string" &&
        clean(parsed.secondaryMaatLens).length
      ? selectedLens(parsed.secondaryMaatLens)
      : null,
    falseReadingToAvoid: clean(parsed.falseReadingToAvoid as string),
    centralMoralReading: clean(parsed.centralMoralReading as string),
    alignment: clean(parsed.alignment as string),
    underalignment: clean(parsed.underalignment as string),
    evidenceAnchor: clean(parsed.evidenceAnchor as string),
    userProfileConnection: clean(parsed.userProfileConnection as string),
    deeperDirective: clean(parsed.deeperDirective as string),
    reflectionThesis: clean(parsed.reflectionThesis as string),
    closingKind: closingKind(parsed.closingKind as string),
    closingText: clean(parsed.closingText as string),
  };
}

export function reflectionJudgmentPromptBlock(
  judgment: ReflectionJudgment | null | undefined,
) {
  if (!judgment) return "";
  return [
    "REFLECTION_JUDGMENT (governs the final reflection; do not print this heading or labels):",
    `Primary Ma'at question: ${judgment.primaryMaatQuestion}`,
    `Selected Ma'at lens: ${judgment.selectedMaatLens}`,
    `Secondary Ma'at lens: ${judgment.secondaryMaatLens ?? "none"}`,
    `False reading to avoid: ${judgment.falseReadingToAvoid}`,
    `Central moral reading: ${judgment.centralMoralReading}`,
    `Where the user answered: ${judgment.alignment}`,
    `Where restoration is needed: ${judgment.underalignment}`,
    `Evidence anchor: ${judgment.evidenceAnchor}`,
    `User profile connection: ${judgment.userProfileConnection}`,
    `Deeper directive: ${judgment.deeperDirective}`,
    `Reflection thesis: ${judgment.reflectionThesis}`,
    `Closing kind: ${judgment.closingKind}`,
    `Closing text: ${judgment.closingText}`,
    "Hard rule: the final reflection must serve the reflection thesis. The evidence anchor proves the thesis; it is not the topic.",
  ].join("\n");
}

export function buildReflectionJudgmentPrompt(
  input: ReflectionJudgmentInput,
) {
  const compact = {
    calendarFrame: input.calendarFrame
      ? {
        ceremonialDecanName: input.calendarFrame.ceremonialDecanName,
        monthName: input.calendarFrame.monthName,
        seasonName: input.calendarFrame.seasonName,
        decanTheme: input.calendarFrame.decanTheme,
        arcSummary: input.calendarFrame.arcSummary,
      }
      : null,
    moralPortrait: input.moralPortrait
      ? {
        decanCall: input.moralPortrait.decanCall,
        sacredDimension: input.moralPortrait.sacredDimension,
        relationalDimension: input.moralPortrait.relationalDimension,
        naturalDimension: input.moralPortrait.naturalDimension,
        heartSignal: input.moralPortrait.heartSignal,
        serudjCall: input.moralPortrait.serudjCall,
        geruMaaOrientation: input.moralPortrait.geruMaaOrientation,
        portraitStatement: input.moralPortrait.portraitStatement,
        personBecomingStatement: input.moralPortrait.personBecomingStatement,
        serudjDirective: input.moralPortrait.serudjDirective,
        forbiddenFramings: input.moralPortrait.forbiddenFramings,
      }
      : null,
    profileSnapshot: input.profileSnapshot
      ? {
        dominantUserLens: input.profileSnapshot.dominantUserLens,
        dominantMaatLens: input.profileSnapshot.dominantMaatLens,
        secondaryMaatLens: input.profileSnapshot.secondaryMaatLens,
        maatLensCandidates: input.profileSnapshot.maatLensCandidates,
        ethicalQuestion: input.profileSnapshot.ethicalQuestion,
        alignmentReading: input.profileSnapshot.alignmentReading,
        underalignmentReading: input.profileSnapshot.underalignmentReading,
        repairDirection: input.profileSnapshot.repairDirection,
        interpretiveSpecificity: input.profileSnapshot.interpretiveSpecificity,
        bestEvidenceAnchor: input.profileSnapshot.bestEvidenceAnchor,
        suppressedEvidenceAnchors:
          input.profileSnapshot.suppressedEvidenceAnchors,
        profileConfidence: input.profileSnapshot.profileConfidence,
        lensReason: input.profileSnapshot.lensReason,
      }
      : null,
    profileContext: input.translatedProfileContext?.phrases ?? [],
    domainBalance: input.alignmentMap?.domainBalance ?? null,
    evidenceDensity: input.arcPlan?.evidenceDensity ??
      input.alignmentMap?.evidenceDensity ?? null,
    normalizedObligationThreads: input.normalizedObligationThreads,
    recentOutcomes: input.recentOutcomes ?? null,
  };
  return `You are making the private interpretive judgment for a Ma'at decan reflection. Return JSON only. Do not write the reflection.

The deterministic layers prepare evidence, calendar, user profile, and lens candidates. Your task is to decide the moral reading before public prose is written.

Rules:
- Do not choose the densest evidence.
- Choose the deepest Ma'at question.
- Habits are evidence, not the topic.
- Reject shallow readings explicitly.
- Keep the user aligned with Ma'at, not merely corrected behaviorally.
- If MORAL_PORTRAIT is present, serve personBecomingStatement and portraitStatement before making any directive. The directive must arise from serudjDirective as restoration, not from the app's need for better records.
- Produce a thesis that can govern the final reflection.
- Keep gravity proportionate to the evidence.
- Use plain-language judgment fields. Avoid coded phrases such as "written witness", "act and account", "embodied order", "underalignment", "life accomplished", "dependent on inference", and "the account". Do not use system-serving phrases such as "next reflection", "less guesswork", "enough detail", "record cannot show", or "truth asks for enough detail". Do not make record/account/mark/evidence the protagonist. If you use a Ma'at term like measure or witness, pair it with ordinary language such as right size, clear place, truthful form, or care you can keep. Address the user directly with you/your.

Return exactly this JSON shape:
{
  "primaryMaatQuestion": "string",
  "selectedMaatLens": "truth | witness | measure | order | life_preservation | restraint | self_mastery | reciprocity | care | justice | vulnerable_protection | offering_service | harmony | worthiness | becoming | continuity | repair_isfet | effective_speech",
  "secondaryMaatLens": "string or null",
  "falseReadingToAvoid": "string",
  "centralMoralReading": "string",
  "alignment": "string",
  "underalignment": "string",
  "evidenceAnchor": "string",
  "userProfileConnection": "string",
  "deeperDirective": "string",
  "reflectionThesis": "string",
  "closingKind": "question | charge",
  "closingText": "string"
}

PRIVATE_INPUT:
${JSON.stringify(compact, null, 2)}`;
}
