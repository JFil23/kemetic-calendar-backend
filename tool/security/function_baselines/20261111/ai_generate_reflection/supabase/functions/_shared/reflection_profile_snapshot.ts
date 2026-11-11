import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import {
  type MaatAlignmentLens,
  type MaatAlignmentRelationDomain,
  type MaatAlignmentSourceDomain,
  selectMaatAlignmentLens,
} from "./maat_alignment_lens.ts";
import type {
  MaatCaseKey,
  MaatOfferingKind,
} from "./maat_situation_interpreter.ts";
import type {
  MaatUserProfileFact,
  MaatUserProfileFactConfidence,
} from "./profile_fact_extractor.ts";
import type { MaatTranslatedProfileContext } from "./profile_context_translator.ts";
import type {
  ReflectionCalendarFrame,
  ReflectionDomainBalance,
} from "./reflection_calendar.ts";
import type {
  MaatDimensionSnapshot,
  ReflectionProfileRow,
} from "../ai_generate_reflection/maat_decision.ts";

export type ReflectionUserLens =
  | "record_thinning"
  | "routine_anchor_missing"
  | "body_support_recording_gap"
  | "overcommitment"
  | "care_outward_self_thin"
  | "creative_unclosed_work"
  | "technical_sequence_block"
  | "study_without_retention"
  | "low_signal_orientation"
  | "practice_recovery";

export type ReflectionProfileSnapshot = {
  version: "reflection_profile_snapshot_v1";
  userPatternSummary: string;
  stablePatterns: Array<ProfilePatternRef>;
  emergingPatterns: Array<ProfilePatternRef>;
  contradictedPatterns: Array<ProfilePatternRef>;
  dominantUserLens: ReflectionUserLens;
  lensReason: string;
  lensStability: "stable" | "emerging" | "shifting";
  dominantMaatLens: MaatAlignmentLens;
  secondaryMaatLens: MaatAlignmentLens | null;
  maatLensCandidates: MaatAlignmentLens[];
  ethicalQuestion: string;
  alignmentReading: string;
  underalignmentReading: string;
  repairDirection: string;
  sourceDomain: MaatAlignmentSourceDomain;
  relationDomain: MaatAlignmentRelationDomain;
  interpretiveSpecificity: ReflectionInterpretiveSpecificity;
  calendarFit: string;
  bestEvidenceAnchor: ReflectionProfileEvidenceAnchor | null;
  suppressedEvidenceAnchors: ReflectionProfileEvidenceAnchor[];
  profileConfidence: "low" | "medium" | "high";
  reflectionInstruction: string;
  profileFactsUsed: ProfilePatternRef[];
};

export type ReflectionInterpretiveSpecificity = {
  version: "reflection_interpretive_specificity_v1";
  specificIntent: string;
  derivedReading: string;
  maatTranslation: string;
  alignmentDetail: string;
  underalignmentDetail: string;
  chargeFocus: string;
  requiredConcepts: string[];
  avoidGenericSubstitutes: string[];
};

export type ReflectionProfileEvidenceAnchor = {
  id: string;
  domain:
    | "nutrition"
    | "todo"
    | "flow"
    | "note_record"
    | "guidance"
    | "calendar"
    | "profile";
  label: string;
  claim: string;
  role: "illustrate_lens" | "suppressed";
  reason: string;
  rawTerms: string[];
};

export type ProfilePatternRef = {
  fact_type: string;
  value: string;
  confidence: MaatUserProfileFactConfidence;
  stability: string;
  evidence_count: number;
};

type HistoryMetricLike = {
  badgeCount?: number | null;
  daysActive?: number | null;
  progressMarkersCount?: number | null;
  topThread?: string | null;
};

type BuildReflectionProfileSnapshotParams = {
  profileFacts?: MaatUserProfileFact[] | null;
  translatedProfileContext?: MaatTranslatedProfileContext | null;
  reflectionProfile?: ReflectionProfileRow | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  domainBalance?: ReflectionDomainBalance | null;
  historyMetrics?: HistoryMetricLike[] | null;
  calendarFrame?: ReflectionCalendarFrame | null;
  evidencePhrases?: string[] | null;
  maatSnapshot?: MaatDimensionSnapshot | null;
  caseKey?: MaatCaseKey | null;
  selectedOffering?: MaatOfferingKind | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function factKey(type: string, value: string) {
  return `${type}:${value}`;
}

function confidenceRank(value: MaatUserProfileFactConfidence | undefined) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function toPatternRef(fact: MaatUserProfileFact): ProfilePatternRef {
  return {
    fact_type: fact.fact_type,
    value: fact.value,
    confidence: fact.confidence,
    stability: fact.stability,
    evidence_count: fact.evidence_count,
  };
}

function hasFact(
  facts: MaatUserProfileFact[],
  type: string,
  values: string[],
) {
  return facts.find((fact) =>
    fact.fact_type === type && values.includes(fact.value) &&
    fact.stability !== "contradicted"
  ) ?? null;
}

function profileText(profile?: ReflectionProfileRow | null) {
  return [
    ...(profile?.top_nodes ?? []).map((node) => node.slug ?? ""),
    ...(profile?.dominant_patterns ?? []),
    ...(profile?.tension_pairs ?? []).flat(),
  ].join(" ").toLowerCase();
}

function nutritionAnchor(
  threads?: MaatNormalizedObligationThreads | null,
): ReflectionProfileEvidenceAnchor | null {
  const nutrition = threads?.nutrition;
  if (!nutrition || nutrition.unique_item_count <= 0) return null;
  const thread = threads?.threads.find((item) => item.domain === "nutrition");
  const rawTerms = [
    "nutrition",
    "body support",
    thread?.label,
    ...(thread?.sources ?? []),
    ...(thread?.purposes ?? []),
  ].map(clean).filter(Boolean);
  const recurring = nutrition.unique_item_count === 1 &&
    nutrition.same_item_repeated;
  return {
    id: "nutrition_thread",
    domain: "nutrition",
    label: recurring ? "one recurring care reminder" : "body-care evidence",
    claim: recurring
      ? "one care reminder kept returning without being marked complete"
      : "body-care evidence was present in the decan record",
    role: "illustrate_lens",
    reason: recurring
      ? "illustrates whether steady intention has a simple place in the day"
      : "illustrates body care when that is the selected lens",
    rawTerms: [...new Set(rawTerms)],
  };
}

function firstUseful(values: string[] | undefined) {
  return (values ?? []).map(clean).find((value) => value.length > 0) ?? "";
}

function humanizePurpose(value: string) {
  const lower = value.toLowerCase();
  if (/\bstrong\s+bones?\b/.test(lower)) return "strength and durability";
  if (/\bhydrat/.test(lower)) return "steady hydration";
  if (/\benergy\b/.test(lower)) return "sustained energy";
  if (/\bfocus\b/.test(lower)) return "clearer attention";
  return value;
}

function recurringNutritionSpecificity(
  threads: MaatNormalizedObligationThreads,
  dominantLens: MaatAlignmentLens,
): ReflectionInterpretiveSpecificity | null {
  const thread = threads.threads.find((item) =>
    item.domain === "nutrition" && item.same_item_repeated
  );
  if (!thread) return null;
  const purpose = firstUseful(thread.purposes);
  const source = firstUseful(thread.sources);
  const specificIntent = purpose
    ? `the named intention was ${humanizePurpose(purpose)}`
    : source
    ? `the same source kept carrying the body-care promise`
    : "one body-care promise kept returning with the same aim";
  return {
    version: "reflection_interpretive_specificity_v1",
    specificIntent,
    derivedReading:
      `${specificIntent}; the intention is steady, but the setup has not made it easy to follow through.`,
    maatTranslation: dominantLens === "truth"
      ? "truth asks for the record to match the care that actually matters"
      : dominantLens === "life_preservation"
      ? "life-preservation is present as intention, while measure asks whether the care is simple enough to keep"
      : "measure asks whether this care is the right size and has a clear place in the day",
    alignmentDetail:
      "the alignment is steady concern for the body, not novelty or volume",
    underalignmentDetail:
      "the weak point is the lack of a simple moment where the care is done and marked",
    chargeFocus:
      "ask what ordinary moment could carry this care without adding pressure",
    requiredConcepts: [
      "steady concern",
      "clear place",
      "right size",
    ],
    avoidGenericSubstitutes: [
      "recording home",
      "proper place",
      "account heavier",
      "simple rhythm",
      "support thread",
      "act and account",
      "witnessed action",
    ],
  };
}

function todoSpecificity(
  threads: MaatNormalizedObligationThreads,
): ReflectionInterpretiveSpecificity | null {
  const todo = threads.todo;
  if (todo.unique_item_count <= 0) return null;
  return {
    version: "reflection_interpretive_specificity_v1",
    specificIntent: todo.unique_item_count >= 3
      ? "several open work endings competed for the same measure"
      : "one visible work thread asked for a clean finish",
    derivedReading:
      "the pattern is not lack of motion; it is unfinished shape asking to be put in sequence",
    maatTranslation:
      "order is the active Ma'at question because visible work needs right placement before more force",
    alignmentDetail:
      "the alignment is where work became concrete enough to be named",
    underalignmentDetail:
      "the weak point is where the finish condition stayed outside the record",
    chargeFocus: "ask which open ending has the clearest rightful finish",
    requiredConcepts: ["open ending", "sequence", "finish", "order"],
    avoidGenericSubstitutes: [
      "get organized",
      "finish tasks",
      "productivity",
      "checklist",
    ],
  };
}

function profileSpecificity(
  lens: ReflectionUserLens,
  maatLens: MaatAlignmentLens,
  reason: string,
): ReflectionInterpretiveSpecificity {
  const isRecord = lens === "record_thinning";
  const isOvercommitment = lens === "overcommitment";
  return {
    version: "reflection_interpretive_specificity_v1",
    specificIntent: isRecord
      ? "the user's movement may be larger than what has been named"
      : isOvercommitment
      ? "the active list gathers more openings than it can close"
      : reason,
    derivedReading: isRecord
      ? "the meaningful pattern is not absence; it is activity that needs one clear mark"
      : isOvercommitment
      ? "the meaningful pattern is not weak effort; it is a plan asking to become smaller before it expands"
      : reason,
    maatTranslation: maatLens === "truth" || maatLens === "witness"
      ? "truth asks the user to name what moved so the next step can be chosen from reality rather than pressure"
      : "measure asks whether the plan matches what can truly be kept",
    alignmentDetail:
      "the alignment is returning to the record instead of abandoning it",
    underalignmentDetail:
      "the weak point is where movement has not yet been raised into a form the user can stand on",
    chargeFocus:
      "ask what moved that deserves to be named for the user's own next step",
    requiredConcepts: ["clear mark", "truth", "right size"],
    avoidGenericSubstitutes: [
      "record stayed thin",
      "concrete detail",
      "next guidance",
      "foundation to build on",
    ],
  };
}

function buildInterpretiveSpecificity(params: {
  threads?: MaatNormalizedObligationThreads | null;
  userLens: ReflectionUserLens;
  maatLens: MaatAlignmentLens;
  lensReason: string;
}): ReflectionInterpretiveSpecificity {
  if (params.threads) {
    const recurring = recurringNutritionSpecificity(
      params.threads,
      params.maatLens,
    );
    if (
      recurring &&
      (params.userLens === "body_support_recording_gap" ||
        params.maatLens === "measure" ||
        params.maatLens === "life_preservation")
    ) {
      return recurring;
    }
    const todo = todoSpecificity(params.threads);
    if (todo && params.userLens === "overcommitment") return todo;
  }
  return profileSpecificity(
    params.userLens,
    params.maatLens,
    params.lensReason,
  );
}

function todoAnchor(
  threads?: MaatNormalizedObligationThreads | null,
): ReflectionProfileEvidenceAnchor | null {
  const todo = threads?.todo;
  if (!todo || todo.unique_item_count <= 0) return null;
  return {
    id: "todo_thread",
    domain: "todo",
    label: "visible work thread",
    claim: todo.unique_item_count >= 3
      ? "visible work carried several open endings"
      : "visible work gave the decan one concrete measure",
    role: "illustrate_lens",
    reason: "illustrates work structure without listing tasks",
    rawTerms: ["todo", "to-do", "task", "planner", "visible work"],
  };
}

function profileAnchor(
  snapshotLens: ReflectionUserLens,
  reason: string,
): ReflectionProfileEvidenceAnchor {
  return {
    id: "profile_pattern",
    domain: "profile",
    label: snapshotLens.replaceAll("_", " "),
    claim: reason,
    role: "illustrate_lens",
    reason:
      "profile pattern governs the reflection when concrete evidence is thin",
    rawTerms: [],
  };
}

function calendarFitFor(
  lens: ReflectionUserLens,
  frame?: ReflectionCalendarFrame | null,
) {
  const decan = frame?.ceremonialDecanName || "this decan";
  const theme = frame?.decanTheme || frame?.monthMeaning ||
    "the period's demand";
  const lensFit: Record<ReflectionUserLens, string> = {
    record_thinning:
      `${decan} asks ${theme} to become visible enough for the record to stand on later.`,
    routine_anchor_missing:
      `${decan} asks ${theme} to find a stable entry point in the day.`,
    body_support_recording_gap:
      `${decan} asks embodied care to become a keepable rhythm, not a heavier promise.`,
    overcommitment:
      `${decan} asks stability through proportion: fewer open promises, more keepable measure.`,
    care_outward_self_thin:
      `${decan} asks care to restore the house without leaving the keeper outside it.`,
    creative_unclosed_work:
      `${decan} asks creative movement to find one clean witness or close.`,
    technical_sequence_block:
      `${decan} asks sequence and prerequisites to become visible before more effort is added.`,
    study_without_retention:
      `${decan} asks knowledge to become usable, not merely encountered.`,
    low_signal_orientation:
      `${decan} asks for one trustworthy mark before the system claims more than it knows.`,
    practice_recovery:
      `${decan} asks the returning rhythm to be protected before it is expanded.`,
  };
  return lensFit[lens];
}

function lensFromSignals(params: {
  facts: MaatUserProfileFact[];
  profile?: ReflectionProfileRow | null;
  threads?: MaatNormalizedObligationThreads | null;
  history?: HistoryMetricLike[] | null;
}): { lens: ReflectionUserLens; reason: string; fact?: MaatUserProfileFact } {
  const facts = params.facts;
  const sparse = hasFact(facts, "practice_trajectory", [
    "sparse_across_decans",
  ]);
  const surface = hasFact(facts, "record_style", ["surface_logger"]);
  if (surface || sparse) {
    return {
      lens: "record_thinning",
      reason:
        "the durable pattern is activity or intention with a thinner written record",
      fact: surface ?? sparse ?? undefined,
    };
  }

  const accumulator = hasFact(facts, "commitment_pattern", [
    "accumulator",
    "many_open_loops",
  ]);
  if (accumulator) {
    return {
      lens: "overcommitment",
      reason:
        "the durable pattern is an active list that gathers more open loops than it can close",
      fact: accumulator,
    };
  }

  const care = hasFact(facts, "care_direction", [
    "other_directed_care_visible",
    "mixed_self_and_other_care",
  ]);
  if (care) {
    return {
      lens: "care_outward_self_thin",
      reason:
        "care is visible, but the profile needs to distinguish what belongs to the user from what is carried outward",
      fact: care,
    };
  }

  const work = hasFact(facts, "work_domain", [
    "technical_builder",
    "creative_worker",
    "academic_or_student",
  ]);
  if (work?.value === "technical_builder") {
    return {
      lens: "technical_sequence_block",
      reason:
        "visible work appears build-oriented, where sequence and finish conditions matter more than broad effort",
      fact: work,
    };
  }
  if (work?.value === "creative_worker") {
    return {
      lens: "creative_unclosed_work",
      reason:
        "creative work may move before the record knows how to close or witness it",
      fact: work,
    };
  }
  if (work?.value === "academic_or_student") {
    return {
      lens: "study_without_retention",
      reason:
        "study needs a sign of retention or application before your record can call it complete",
      fact: work,
    };
  }

  const recovery = hasFact(facts, "practice_trajectory", [
    "flow_structure_works",
    "self_revising_practice",
  ]) ?? hasFact(facts, "guidance_response", ["restoration_responsive"]);
  if (recovery) {
    return {
      lens: "practice_recovery",
      reason: "your record shows structure can work when it is shaped to you",
      fact: recovery,
    };
  }

  const routine = hasFact(facts, "routine_style", [
    "irregular_engagement",
    "reminder_anchored",
    "batch_worker",
  ]);
  if (routine) {
    return {
      lens: "routine_anchor_missing",
      reason:
        "the personal pattern is about finding an entry point that fits the user's actual rhythm",
      fact: routine,
    };
  }

  const nutrition = params.threads?.nutrition;
  if (
    nutrition?.unique_item_count === 1 && nutrition.same_item_repeated &&
    nutrition.pending_count + nutrition.skipped_count >= 3
  ) {
    const fact = hasFact(facts, "commitment_pattern", [
      "recurring_obligation_unkept",
    ]) ?? hasFact(facts, "routine_style", ["single_recurring_support_thread"]);
    return {
      lens: "body_support_recording_gap",
      reason:
        "one recurring support appears as a recording and rhythm question, not as many separate obligations",
      fact: fact ?? undefined,
    };
  }

  const activeHistory = params.history ?? [];
  if (
    activeHistory.length > 0 &&
    activeHistory.some((item) => Number(item.daysActive ?? 0) <= 1)
  ) {
    return {
      lens: "low_signal_orientation",
      reason:
        "the record is still too thin for confident correction, so the reflection should orient rather than diagnose",
    };
  }

  const graph = profileText(params.profile);
  if (/\bdjehuty|seshat|maat\b/.test(graph)) {
    return {
      lens: "record_thinning",
      reason:
        "the graph leans toward measure and record, so the reflection should ask what can be witnessed cleanly",
    };
  }

  return {
    lens: "low_signal_orientation",
    reason:
      "the profile does not yet have a stronger stable pattern than the calendar itself",
  };
}

function confidenceForFacts(facts: MaatUserProfileFact[]) {
  if (facts.some((fact) => fact.confidence === "high")) return "high";
  if (facts.some((fact) => fact.confidence === "medium")) return "medium";
  return "low";
}

function lensStabilityFor(
  fact: MaatUserProfileFact | undefined,
  confidence: "low" | "medium" | "high",
) {
  if (fact?.stability === "shifting" || fact?.stability === "contradicted") {
    return "shifting" as const;
  }
  if (fact?.stability === "stable" || confidence === "high") {
    return "stable" as const;
  }
  return "emerging" as const;
}

function userPatternSummary(lens: ReflectionUserLens, confidence: string) {
  const label = lens.replaceAll("_", " ");
  return confidence === "low"
    ? `The profile lens is ${label}, but it should be held as a question because your record is still sparse.`
    : `The profile lens is ${label}; the reflection should speak from that pattern before selecting evidence.`;
}

export function buildReflectionProfileSnapshot(
  params: BuildReflectionProfileSnapshotParams,
): ReflectionProfileSnapshot {
  const facts = (params.profileFacts ?? [])
    .filter((fact) => fact.stability !== "contradicted")
    .slice()
    .sort((a, b) =>
      confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
      b.evidence_count - a.evidence_count ||
      factKey(a.fact_type, a.value).localeCompare(factKey(b.fact_type, b.value))
    );
  const stablePatterns = facts.filter((fact) =>
    fact.confidence === "high" || fact.stability === "stable"
  ).map(toPatternRef).slice(0, 6);
  const emergingPatterns = facts.filter((fact) =>
    fact.confidence !== "high" && fact.stability !== "stable"
  ).map(toPatternRef).slice(0, 6);
  const contradictedPatterns = (params.profileFacts ?? []).filter((fact) =>
    fact.stability === "contradicted"
  ).map(toPatternRef).slice(0, 4);
  const profileConfidence = confidenceForFacts(facts);
  const lensDecision = lensFromSignals({
    facts,
    profile: params.reflectionProfile,
    threads: params.normalizedObligationThreads,
    history: params.historyMetrics,
  });
  const maatLens = selectMaatAlignmentLens({
    calendarFrame: params.calendarFrame ?? null,
    maatSnapshot: params.maatSnapshot ?? null,
    normalizedObligationThreads: params.normalizedObligationThreads ?? null,
    profileFacts: facts,
    dominantUserLens: lensDecision.lens,
    caseKey: params.caseKey ?? null,
    selectedOffering: params.selectedOffering ?? null,
  });
  const lensStability = lensStabilityFor(
    lensDecision.fact,
    profileConfidence,
  );
  const interpretiveSpecificity = buildInterpretiveSpecificity({
    threads: params.normalizedObligationThreads ?? null,
    userLens: lensDecision.lens,
    maatLens: maatLens.dominantMaatLens,
    lensReason: lensDecision.reason,
  });
  const nutrition = nutritionAnchor(params.normalizedObligationThreads);
  const todo = todoAnchor(params.normalizedObligationThreads);
  const profile = profileAnchor(lensDecision.lens, lensDecision.reason);
  const anchor = lensDecision.lens === "overcommitment" && todo
    ? todo
    : lensDecision.lens === "body_support_recording_gap" && nutrition
    ? {
      ...nutrition,
      rawTerms: ["nutrition", "vitamin", "apple", "strong bones"],
    }
    : lensDecision.lens === "record_thinning"
    ? profile
    : todo ?? nutrition ?? profile;

  const suppressed: ReflectionProfileEvidenceAnchor[] = [];
  if (nutrition && lensDecision.lens !== "body_support_recording_gap") {
    suppressed.push({
      ...nutrition,
      role: "suppressed",
      reason:
        "nutrition is present but is not the selected profile lens; do not lead with it or make it the topic",
    });
  }
  if (todo && lensDecision.lens !== "overcommitment") {
    suppressed.push({
      ...todo,
      role: "suppressed",
      reason:
        "visible work is available evidence, but it is not the governing lens",
    });
  }

  const profileFactsUsed = [
    ...(lensDecision.fact ? [toPatternRef(lensDecision.fact)] : []),
    ...facts.slice(0, 4).map(toPatternRef),
  ].filter((item, index, list) =>
    list.findIndex((other) =>
      other.fact_type === item.fact_type && other.value === item.value
    ) === index
  );

  const reflectionInstruction = [
    `Write from the Ma'at alignment lens first: ${maatLens.dominantMaatLens}.`,
    maatLens.secondaryMaatLens
      ? `Let ${maatLens.secondaryMaatLens} support the reading without replacing the primary lens.`
      : "",
    `The ethical question is: ${maatLens.ethicalQuestion}`,
    `Where the record answered: ${maatLens.alignmentReading}`,
    `Where the record still needs repair: ${maatLens.underalignmentReading}`,
    `Repair direction: ${maatLens.repairDirection}`,
    `Specific reading to use: ${interpretiveSpecificity.derivedReading}`,
    `Ma'at translation of that reading: ${interpretiveSpecificity.maatTranslation}`,
    `Specific alignment detail in plain language: ${interpretiveSpecificity.alignmentDetail}`,
    `Specific repair detail in plain language: ${interpretiveSpecificity.underalignmentDetail}`,
    `Write from the dominant user lens: ${lensDecision.lens}.`,
    `The Ma'at lens is the topic; the user lens translates it; the evidence anchor is proof, not the story.`,
    `Use the best evidence anchor once: ${
      anchor?.claim ?? "one trustworthy mark from the decan"
    }.`,
    suppressed.length
      ? `Suppressed evidence must not lead or become the topic: ${
        suppressed.map((item) => item.label).join("; ")
      }.`
      : "",
    lensStability === "emerging"
      ? "Because the lens is emerging, phrase the reflection as a careful reading rather than a settled verdict."
      : "",
    profileConfidence === "low"
      ? "Because profile confidence is low, bias the closing toward one honest question."
      : "",
  ].filter(Boolean).join(" ");

  return {
    version: "reflection_profile_snapshot_v1",
    userPatternSummary: userPatternSummary(
      lensDecision.lens,
      profileConfidence,
    ),
    stablePatterns,
    emergingPatterns,
    contradictedPatterns,
    dominantUserLens: lensDecision.lens,
    lensReason: lensDecision.reason,
    lensStability,
    dominantMaatLens: maatLens.dominantMaatLens,
    secondaryMaatLens: maatLens.secondaryMaatLens,
    maatLensCandidates: maatLens.candidateLenses,
    ethicalQuestion: maatLens.ethicalQuestion,
    alignmentReading: maatLens.alignmentReading,
    underalignmentReading: maatLens.underalignmentReading,
    repairDirection: maatLens.repairDirection,
    sourceDomain: maatLens.sourceDomain,
    relationDomain: maatLens.relationDomain,
    interpretiveSpecificity,
    calendarFit: calendarFitFor(lensDecision.lens, params.calendarFrame),
    bestEvidenceAnchor: anchor,
    suppressedEvidenceAnchors: suppressed,
    profileConfidence,
    reflectionInstruction,
    profileFactsUsed,
  };
}

export function reflectionProfileSnapshotPromptBlock(
  snapshot: ReflectionProfileSnapshot | null | undefined,
) {
  if (!snapshot) return "";
  return [
    "REFLECTION_PROFILE_SNAPSHOT (governs the personal lens; do not print this heading or labels):",
    `Dominant user lens: ${snapshot.dominantUserLens}`,
    `Lens reason: ${snapshot.lensReason}`,
    `Lens stability: ${snapshot.lensStability}`,
    `Profile confidence: ${snapshot.profileConfidence}`,
    `Dominant Ma'at alignment lens: ${snapshot.dominantMaatLens}`,
    `Secondary Ma'at alignment lens: ${snapshot.secondaryMaatLens ?? "none"}`,
    `Ma'at lens candidates: ${snapshot.maatLensCandidates.join(", ")}`,
    `Ma'at source domain: ${snapshot.sourceDomain}`,
    `Ma'at relation domain: ${snapshot.relationDomain}`,
    `Ethical question: ${snapshot.ethicalQuestion}`,
    `Where the record answered: ${snapshot.alignmentReading}`,
    `Where the record still needs repair: ${snapshot.underalignmentReading}`,
    `Repair direction: ${snapshot.repairDirection}`,
    "INTERPRETIVE SPECIFICITY BRIDGE (use this to be specific without regurgitating user inputs):",
    `Specific intent: ${snapshot.interpretiveSpecificity.specificIntent}`,
    `Derived reading: ${snapshot.interpretiveSpecificity.derivedReading}`,
    `Ma'at translation: ${snapshot.interpretiveSpecificity.maatTranslation}`,
    `Specific alignment detail in plain language: ${snapshot.interpretiveSpecificity.alignmentDetail}`,
    `Specific repair detail in plain language: ${snapshot.interpretiveSpecificity.underalignmentDetail}`,
    `Charge focus: ${snapshot.interpretiveSpecificity.chargeFocus}`,
    `Required concepts: ${
      snapshot.interpretiveSpecificity.requiredConcepts.join(", ")
    }`,
    `Avoid generic substitutes: ${
      snapshot.interpretiveSpecificity.avoidGenericSubstitutes.join(", ")
    }`,
    `Calendar fit: ${snapshot.calendarFit}`,
    `User pattern summary: ${snapshot.userPatternSummary}`,
    snapshot.profileFactsUsed.length
      ? `Profile facts used: ${
        snapshot.profileFactsUsed.map((fact) =>
          `${fact.fact_type}:${fact.value} (${fact.confidence}/${fact.stability})`
        ).join("; ")
      }`
      : "Profile facts used: none.",
    snapshot.bestEvidenceAnchor
      ? `EVIDENCE ANCHOR (use once only, to illustrate the lens): ${snapshot.bestEvidenceAnchor.claim}. Reason: ${snapshot.bestEvidenceAnchor.reason}.`
      : "EVIDENCE ANCHOR: none selected.",
    snapshot.suppressedEvidenceAnchors.length
      ? [
        "SUPPRESSED EVIDENCE (do not use as the reflection topic):",
        ...snapshot.suppressedEvidenceAnchors.map((anchor) =>
          `- ${anchor.label}: ${anchor.reason}. Raw terms to avoid as openers/repeated topic: ${
            anchor.rawTerms.join(", ") || "none"
          }`
        ),
      ].join("\n")
      : "SUPPRESSED EVIDENCE: none.",
    `Reflection instruction: ${snapshot.reflectionInstruction}`,
    "Hard hierarchy: calendar arc governs the spiritual frame; Ma'at alignment lens governs moral interpretation; user profile translates that lens personally; evidence illustrates only once.",
    "Do not make habit mechanics, nutrition, task completion, or logging the moral topic. Translate the habit into the selected Ma'at dimension.",
    "Plain-language rule: the user-facing reflection must translate internal Ma'at language and speak directly to the user. Prefer right size, clear place, truthful form, steady care, follow-through, you, and your record. Do not fill the middle with coded phrases such as written witness, act and account, embodied order, underalignment, inference, the account, proper place, account heavier, recording home, simple rhythm, less guesswork, or next reflection.",
  ].join("\n");
}
