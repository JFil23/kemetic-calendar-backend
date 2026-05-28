import type {
  MaatAxisCode,
  MaatDimensionSnapshot,
} from "../ai_generate_reflection/maat_decision.ts";
import type { MaatAlignmentLens } from "./maat_alignment_lens.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type { CompiledOutputDestination } from "./output_compiler.ts";
import type { MaatUserProfileFact } from "./profile_fact_extractor.ts";
import type { ReflectionCalendarFrame } from "./reflection_calendar.ts";
import type { ReflectionJudgment } from "./reflection_judgment.ts";
import type { ReflectionMoralPortrait } from "./reflection_moral_portrait.ts";
import type { ReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";

export type MaatDestinationType =
  | "none"
  | "node"
  | "flow"
  | "flow_template"
  | "flow_personalized";

export type MaatDestinationSource =
  | "calendar_arc"
  | "maat_lens"
  | "hard_gate"
  | "reflection_judgment"
  | "profile_pattern"
  | "axis"
  | "outcome"
  | "fallback";

export type MaatDestinationResolution = {
  ctaType: MaatDestinationType;
  ctaRef: string | null;
  ctaLabel: string | null;
  destinationType: MaatDestinationType;
  destinationRef: string | null;
  destinationLabel: string | null;
  destinationReason: string;
  reason: string;
  confidence: number;
  score: number | null;
  signals: string[];
  motivation: {
    reason: string;
    confidence: number;
    source: MaatDestinationSource;
    score: number | null;
    signals: string[];
  };
  source: MaatDestinationSource;
  fallback: {
    ctaType: MaatDestinationType;
    ctaRef: string | null;
    ctaLabel: string | null;
  } | null;
};

export type MaatDestinationOutcomeSignal = {
  ctaType: MaatDestinationType;
  ctaRef: string | null;
  outcomeFlag: "winning" | "negative" | "neutral";
  completedWindowCount: number;
  weightedDeltaDoneRate: number | null;
  weightedDeltaSkippedRate?: number | null;
};

export const MAAT_FLOW_TEMPLATES = {
  dawnHouseRite: "dawn-house-rite",
  eveningThresholdRite: "evening-threshold-rite",
  trackTheSky: "track-the-sky",
  theCourse: "the-course",
  theWeighing: "the-weighing",
  theOfferingTable: "the-offering-table",
  theTending: "the-tending",
  theKeptWord: "the-kept-word",
  moonReturn: "the-moon-return",
  theWag: "the-wag",
  decanWatch: "the-decan-watch",
  daysOutsideTheYear: "the-days-outside-the-year",
  theOpenHand: "the-open-hand",
  theDjed: "the-djed",
} as const;

export const ALL_MAAT_FLOW_TEMPLATE_KEYS = Object.values(MAAT_FLOW_TEMPLATES);

const AXIS_NODE_CANDIDATES: Record<MaatAxisCode, string[]> = {
  T: ["maat", "djehuty"],
  M: ["djehuty", "maat"],
  H: ["ka", "sekhmet"],
  V: ["instruction_amenemope", "renenutet"],
  J: ["maat", "instruction_amenemope"],
  S: ["renenutet", "nile"],
  E: ["nile", "renenutet"],
  R: ["instruction_amenemope", "sekhmet"],
  C: ["ptah", "maat"],
};

type Candidate = MaatDestinationResolution & { baseWeight: number };

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function haystack(parts: unknown[]) {
  return parts.map(clean).filter(Boolean).join(" ").toLowerCase();
}

function labelForDestination(type: MaatDestinationType, ref: string | null) {
  if (type === "node") return "Read the guiding node";
  if (type === "flow") return "Open suggested flow";
  if (type === "flow_personalized") return "Create this flow";
  if (type === "flow_template" && ref) return "Open suggested flow";
  if (type === "flow_template") return "Browse Ma'at flows";
  return null;
}

function cleanSignals(signals: string[] | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of signals ?? []) {
    const signal = clean(raw).toLowerCase();
    if (!signal || seen.has(signal)) continue;
    seen.add(signal);
    result.push(signal);
  }
  return result;
}

function destinationMotivation(params: {
  reason: string;
  confidence: number;
  source: MaatDestinationSource;
  score: number | null;
  signals: string[];
}) {
  return {
    reason: params.reason,
    confidence: params.confidence,
    source: params.source,
    score: params.score,
    signals: params.signals,
  };
}

export function firstNodeForAxis(axis: MaatAxisCode) {
  return AXIS_NODE_CANDIDATES[axis][0] ?? "maat";
}

export function noMaatDestination(reason: string): MaatDestinationResolution {
  const confidence = 0;
  const score = null;
  const signals: string[] = [];
  return {
    ctaType: "none",
    ctaRef: null,
    ctaLabel: null,
    destinationType: "none",
    destinationRef: null,
    destinationLabel: null,
    destinationReason: reason,
    reason,
    confidence,
    score,
    signals,
    motivation: destinationMotivation({
      reason,
      confidence,
      source: "fallback",
      score,
      signals,
    }),
    source: "fallback",
    fallback: null,
  };
}

function destination(params: {
  type: MaatDestinationType;
  ref: string | null;
  reason: string;
  source: MaatDestinationSource;
  confidence?: number;
  score?: number | null;
  signals?: string[];
  fallback?: MaatDestinationResolution | null;
}): MaatDestinationResolution {
  const label = labelForDestination(params.type, params.ref);
  const confidence = params.confidence ?? 0.8;
  const score = params.score ?? null;
  const signals = cleanSignals(params.signals);
  const fallback = params.fallback && params.fallback.ctaType !== "none"
    ? {
      ctaType: params.fallback.ctaType,
      ctaRef: params.fallback.ctaRef,
      ctaLabel: params.fallback.ctaLabel,
    }
    : null;
  return {
    ctaType: params.type,
    ctaRef: params.ref,
    ctaLabel: label,
    destinationType: params.type,
    destinationRef: params.ref,
    destinationLabel: label,
    destinationReason: params.reason,
    reason: params.reason,
    confidence,
    score,
    signals,
    motivation: destinationMotivation({
      reason: params.reason,
      confidence,
      source: params.source,
      score,
      signals,
    }),
    source: params.source,
    fallback,
  };
}

function flowTemplate(
  ref: string,
  reason: string,
  source: MaatDestinationSource = "axis",
  confidence = 0.86,
  fallback?: MaatDestinationResolution | null,
  motivation?: { score?: number | null; signals?: string[] },
) {
  return destination({
    type: "flow_template",
    ref,
    reason,
    source,
    confidence,
    fallback,
    score: motivation?.score,
    signals: motivation?.signals,
  });
}

function nodeForAxis(
  axis: MaatAxisCode,
  reason: string,
  confidence = 0.65,
) {
  return destination({
    type: "node",
    ref: firstNodeForAxis(axis),
    reason,
    source: "axis",
    confidence,
    signals: [`axis:${axis}`],
  });
}

function nodeDestination(
  ref: string,
  reason: string,
  source: MaatDestinationSource,
  confidence = 0.72,
  motivation?: { score?: number | null; signals?: string[] },
) {
  return destination({
    type: "node",
    ref,
    reason,
    source,
    confidence,
    score: motivation?.score,
    signals: motivation?.signals,
  });
}

function nodeForReflectionLens(
  lens: MaatAlignmentLens,
  reason: string,
  source: MaatDestinationSource,
) {
  const lensNodes: Record<MaatAlignmentLens, string> = {
    truth: "maat",
    witness: "maat",
    measure: "djehuty",
    order: "ptah",
    life_preservation: "renenutet",
    restraint: "sekhmet",
    self_mastery: "sekhmet",
    reciprocity: "instruction_amenemope",
    care: "instruction_amenemope",
    justice: "maat",
    vulnerable_protection: "instruction_amenemope",
    offering_service: "maat",
    harmony: "nile",
    worthiness: "maat",
    becoming: "djehuty",
    continuity: "djehuty",
    repair_isfet: "ptah",
    effective_speech: "instruction_amenemope",
  };
  return nodeDestination(lensNodes[lens] ?? "maat", reason, source, 0.72, {
    signals: [`lens:${lens}`, "node_default"],
  });
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function profileFactHaystack(facts: MaatUserProfileFact[] | null | undefined) {
  return haystack(
    (facts ?? []).flatMap((fact) => [
      fact.fact_type,
      fact.value,
      fact.source,
      fact.stability,
    ]),
  );
}

function reflectionDestinationText(params: {
  judgment?: ReflectionJudgment | null;
  moralPortrait?: ReflectionMoralPortrait | null;
  profileSnapshot?: ReflectionProfileSnapshot | null;
  calendarFrame?: ReflectionCalendarFrame | null;
  profileFacts?: MaatUserProfileFact[] | null;
}) {
  const judgment = params.judgment;
  const portrait = params.moralPortrait;
  const snapshot = params.profileSnapshot;
  const frame = params.calendarFrame;
  return haystack([
    judgment?.primaryMaatQuestion,
    judgment?.selectedMaatLens,
    judgment?.secondaryMaatLens,
    judgment?.centralMoralReading,
    judgment?.alignment,
    judgment?.underalignment,
    judgment?.evidenceAnchor,
    judgment?.userProfileConnection,
    judgment?.deeperDirective,
    judgment?.reflectionThesis,
    judgment?.closingText,
    portrait?.decanCall,
    portrait?.sacredDimension,
    portrait?.relationalDimension,
    portrait?.naturalDimension,
    portrait?.heartSignal,
    portrait?.serudjCall,
    portrait?.portraitStatement,
    portrait?.personBecomingStatement,
    portrait?.serudjDirective,
    snapshot?.dominantMaatLens,
    snapshot?.secondaryMaatLens,
    snapshot?.dominantUserLens,
    snapshot?.userPatternSummary,
    snapshot?.ethicalQuestion,
    snapshot?.alignmentReading,
    snapshot?.underalignmentReading,
    snapshot?.repairDirection,
    snapshot?.calendarFit,
    snapshot?.reflectionInstruction,
    profileFactHaystack(params.profileFacts),
    frame?.monthMeaning,
    frame?.seasonMeaning,
    frame?.decanTheme,
    frame?.decanDescription,
    frame?.arcSummary,
  ]);
}

function evidenceScore(parts: Array<[boolean, number, string]>) {
  let score = 0;
  const reasons: string[] = [];
  for (const [matched, weight, reason] of parts) {
    if (!matched) continue;
    score += weight;
    reasons.push(reason);
  }
  return { score, reasons };
}

function strongCareThread(
  threads: MaatNormalizedObligationThreads | null | undefined,
) {
  const nutrition = threads?.nutrition;
  const threadRows = threads?.threads ?? [];
  return Boolean(
    (nutrition &&
      (nutrition.confidence === "high" ||
        nutrition.same_item_repeated ||
        nutrition.pending_count >= 3 ||
        nutrition.skipped_count >= 2 ||
        nutrition.unique_item_count >= 2)) ||
      threadRows.some((thread) =>
        ["nutrition", "care", "health", "family", "household"].some((domain) =>
          thread.domain?.toLowerCase().includes(domain)
        ) &&
        (thread.confidence === "high" ||
          thread.pending_count >= 2 ||
          thread.same_item_repeated)
      ),
  );
}

function strongAgreementText(text: string) {
  return includesAny(text, [
    /\bagreement\b/,
    /\bpromise\b/,
    /\bkept word\b/,
    /\bword and act\b/,
    /\bword\b.*\bact\b/,
    /\bspeech\b.*\bact\b/,
    /\bvow\b/,
    /\bcommitment\b/,
  ]);
}

function strongWeighingText(text: string) {
  return includesAny(text, [
    /\bweigh\w*\b.*\btruth\b/,
    /\bweigh\w*\b.*\bheart\b/,
    /\bweigh\w*\b.*\brecord\b/,
    /\bjudg\w*\b.*\brecord\b/,
    /\bfalse record\b/,
    /\baccountability\b/,
    /\btruthful account\b/,
  ]);
}

function weighingHintText(text: string) {
  return includesAny(text, [/\bweigh/, /\bjudg/]);
}

function calendarNodeDestination(params: {
  calendarFrame?: ReflectionCalendarFrame | null;
}) {
  const text = haystack([
    params.calendarFrame?.monthMeaning,
    params.calendarFrame?.seasonMeaning,
    params.calendarFrame?.decanTheme,
    params.calendarFrame?.decanDescription,
    params.calendarFrame?.arcSummary,
  ]);
  if (includesAny(text, [/\bwisdom\b/, /\blearn/, /\binstruction\b/])) {
    return nodeDestination(
      "instruction_amenemope",
      "calendar_arc:wisdom_node",
      "calendar_arc",
      0.74,
      { signals: ["calendar_wisdom", "learning_language"] },
    );
  }
  if (includesAny(text, [/\btruth\b/, /\bwitness\b/, /\bmaat\b/])) {
    return nodeDestination(
      "maat",
      "calendar_arc:truth_node",
      "calendar_arc",
      0.72,
      { signals: ["calendar_truth", "truth_language"] },
    );
  }
  if (includesAny(text, [/\border\b/, /\bform\b/, /\bcraft\b/])) {
    return nodeDestination(
      "ptah",
      "calendar_arc:order_node",
      "calendar_arc",
      0.72,
      { signals: ["calendar_order", "order_language"] },
    );
  }
  if (includesAny(text, [/\bcare\b/, /\blife\b/, /\bprovision\b/])) {
    return nodeDestination(
      "renenutet",
      "calendar_arc:provision_node",
      "calendar_arc",
      0.72,
      { signals: ["calendar_provision", "care_language"] },
    );
  }
  if (includesAny(text, [/\bsky\b/, /\bseason\b/, /\briver\b/, /\bcycle\b/])) {
    return nodeDestination(
      "nile",
      "calendar_arc:cycle_node",
      "calendar_arc",
      0.72,
      { signals: ["calendar_cycle", "season_language"] },
    );
  }
  return nodeDestination(
    "maat",
    "calendar_arc:default_node",
    "calendar_arc",
    0.72,
    { signals: ["calendar_default"] },
  );
}

function highAlignmentFlowForReflection(params: {
  lens: MaatAlignmentLens;
  source: MaatDestinationSource;
  text: string;
  nodeFallback: MaatDestinationResolution;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  profileFacts?: MaatUserProfileFact[] | null;
}) {
  const profileText = profileFactHaystack(params.profileFacts);
  const text = `${params.text} ${profileText}`;
  const candidates: Array<{
    ref: string;
    reasonKey: string;
    score: number;
    reasons: string[];
  }> = [];

  const addCandidate = (
    ref: string,
    reasonKey: string,
    scored: { score: number; reasons: string[] },
  ) => {
    candidates.push({ ref, reasonKey, ...scored });
  };

  addCandidate(
    MAAT_FLOW_TEMPLATES.theTending,
    "tending",
    evidenceScore([
      [
        [
          "care",
          "reciprocity",
          "vulnerable_protection",
          "life_preservation",
        ].includes(params.lens),
        3,
        "lens",
      ],
      [strongCareThread(params.normalizedObligationThreads), 3, "care_thread"],
      [
        includesAny(text, [
          /\btend/,
          /\bcare\b/,
          /\bvulnerable\b/,
          /\bbody\b/,
          /\bprovision\b/,
          /\bnutrition\b/,
          /\bself-care\b/,
          /\bboundar/,
        ]),
        2,
        "care_language",
      ],
      [
        includesAny(profileText, [/\bcare_direction\b/, /\bself_provision/]),
        1,
        "profile_care",
      ],
    ]),
  );

  addCandidate(
    MAAT_FLOW_TEMPLATES.theKeptWord,
    "kept_word",
    evidenceScore([
      [
        ["effective_speech", "truth", "witness", "worthiness"].includes(
          params.lens,
        ),
        params.lens === "effective_speech" ? 4 : 2,
        "lens",
      ],
      [strongAgreementText(text), 3, "agreement_language"],
      [
        includesAny(profileText, [/\bcommitment_pattern\b/, /\bagreement\b/]),
        1,
        "profile_commitment",
      ],
    ]),
  );

  addCandidate(
    MAAT_FLOW_TEMPLATES.theDjed,
    "djed",
    evidenceScore([
      [
        ["order", "repair_isfet", "restraint", "self_mastery"].includes(
          params.lens,
        ),
        3,
        "lens",
      ],
      [
        includesAny(text, [
          /\bstabil/,
          /\bfoundation\b/,
          /\bstructure\b/,
          /\border\b/,
          /\brepair\b/,
          /\brais/,
        ]),
        3,
        "structure_language",
      ],
    ]),
  );

  addCandidate(
    MAAT_FLOW_TEMPLATES.theCourse,
    "course",
    evidenceScore([
      [
        ["measure", "becoming", "continuity"].includes(params.lens),
        3,
        "lens",
      ],
      [
        includesAny(text, [
          /\bcourse\b/,
          /\blesson\b/,
          /\bsequence\b/,
          /\bstage\b/,
          /\bmeasure\b/,
          /\bpractice arc\b/,
        ]),
        3,
        "course_language",
      ],
    ]),
  );

  addCandidate(
    MAAT_FLOW_TEMPLATES.theWeighing,
    "weighing",
    evidenceScore([
      [["truth", "witness", "measure"].includes(params.lens), 2, "lens"],
      [strongWeighingText(text), 5, "weighing_language"],
      [
        weighingHintText(text) && !strongWeighingText(text),
        2,
        "weighing_hint",
      ],
    ]),
  );

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 7) return null;

  return flowTemplate(
    best.ref,
    `reflection_alignment:${best.reasonKey}:${best.reasons.join("+")}`,
    params.source,
    Math.min(0.95, 0.72 + best.score / 100),
    params.nodeFallback,
    {
      score: best.score,
      signals: best.reasons.map((reason) =>
        reason === "lens" ? `lens:${params.lens}` : reason
      ),
    },
  );
}

function ctaCandidate(
  resolution: MaatDestinationResolution,
  baseWeight: number,
): Candidate {
  return { ...resolution, baseWeight };
}

function outcomeSignalForCandidate(
  candidate: Candidate,
  outcomeSignals: MaatDestinationOutcomeSignal[] | undefined,
) {
  return (outcomeSignals ?? []).find((signal) =>
    signal.ctaType === candidate.ctaType &&
    (signal.ctaRef ?? null) === (candidate.ctaRef ?? null)
  ) ?? null;
}

function chooseOutcomeWeightedDestination(
  candidates: Candidate[],
  outcomeSignals?: MaatDestinationOutcomeSignal[],
): MaatDestinationResolution {
  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestSignal: MaatDestinationOutcomeSignal | null = null;

  for (const candidate of candidates) {
    const signal = outcomeSignalForCandidate(candidate, outcomeSignals);
    const delta = signal?.weightedDeltaDoneRate ?? 0;
    const outcomeBoost = signal?.outcomeFlag === "winning"
      ? 35 + Math.round(delta * 100)
      : signal?.outcomeFlag === "negative"
      ? -35 + Math.round(delta * 100)
      : 0;
    const score = candidate.baseWeight + outcomeBoost;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      bestSignal = signal;
    }
  }

  const outcomeReason = bestSignal && bestSignal.outcomeFlag !== "neutral"
    ? `${best.reason}:outcome_${bestSignal.outcomeFlag}`
    : best.reason;
  const source = bestSignal && bestSignal.outcomeFlag !== "neutral"
    ? "outcome"
    : best.source;
  const confidence = Math.min(
    0.99,
    Math.max(0.5, best.confidence + (bestSignal ? 0.06 : 0)),
  );
  const signals = cleanSignals([
    ...best.signals,
    ...(bestSignal && bestSignal.outcomeFlag !== "neutral"
      ? [`outcome:${bestSignal.outcomeFlag}`]
      : []),
  ]);
  return {
    ...best,
    destinationReason: outcomeReason,
    reason: outcomeReason,
    source,
    confidence,
    signals,
    motivation: destinationMotivation({
      reason: outcomeReason,
      confidence,
      source,
      score: best.score,
      signals,
    }),
  };
}

export function resolveMaatGuidanceDestination(params: {
  snapshot: MaatDimensionSnapshot;
  mode: "drift" | "strength";
  outcomeSignals?: MaatDestinationOutcomeSignal[];
}): MaatDestinationResolution {
  const correctionAxis = params.snapshot.correctionAxes[0] ??
    params.snapshot.leadAxis;
  const axis = params.mode === "drift"
    ? correctionAxis
    : params.snapshot.leadAxis;
  const hardGates = new Set(params.snapshot.hardGates);

  if (params.mode === "drift") {
    if (hardGates.has("vulnerable_deprivation")) {
      return destination({
        type: "node",
        ref: "instruction_amenemope",
        reason: "gate:vulnerable_deprivation",
        source: "hard_gate",
        confidence: 0.95,
      });
    }
    if (hardGates.has("corrupt_judgment")) {
      return destination({
        type: "node",
        ref: "maat",
        reason: "gate:corrupt_judgment",
        source: "hard_gate",
        confidence: 0.95,
      });
    }
    if (hardGates.has("malicious_social_disruption")) {
      return destination({
        type: "node",
        ref: "maat",
        reason: "gate:malicious_social_disruption",
        source: "hard_gate",
        confidence: 0.95,
      });
    }
    if (hardGates.has("life_supporting_flow_disrupted")) {
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theOfferingTable,
        "gate:life_supporting_flow_disrupted",
        "hard_gate",
        0.94,
      );
    }
    if (hardGates.has("excessive_force_or_harm")) {
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.eveningThresholdRite,
        "gate:excessive_force_or_harm",
        "hard_gate",
        0.94,
      );
    }
    if (hardGates.has("knowingly_false_record")) {
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theWeighing,
        "gate:knowingly_false_record",
        "hard_gate",
        0.94,
      );
    }
  }

  const nodeFallback = nodeForAxis(axis, `axis:${axis}:node_fallback`);

  if (axis === "E") {
    return chooseOutcomeWeightedDestination([
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theCourse, "axis:E:temporal"),
        100,
      ),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.trackTheSky, "axis:E:sky"),
        params.mode === "strength" ? 95 : 85,
      ),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.decanWatch, "axis:E:decan_watch"),
        params.mode === "strength" ? 88 : 80,
      ),
      ctaCandidate(nodeFallback, 70),
    ], params.outcomeSignals);
  }
  if (axis === "H" || axis === "R") {
    return chooseOutcomeWeightedDestination([
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.eveningThresholdRite, `axis:${axis}`),
        100,
      ),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theDjed, `axis:${axis}:structural`),
        params.mode === "strength" ? 84 : 82,
      ),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.dawnHouseRite, `axis:${axis}:dawn`),
        76,
      ),
      ctaCandidate(nodeFallback, 70),
    ], params.outcomeSignals);
  }
  if (axis === "M" || (params.mode === "strength" && axis === "T")) {
    return chooseOutcomeWeightedDestination([
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theWeighing, `axis:${axis}`),
        100,
      ),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theCourse, `axis:${axis}:measure`),
        82,
      ),
      ctaCandidate(nodeFallback, 70),
    ], params.outcomeSignals);
  }
  if (axis === "V") {
    return chooseOutcomeWeightedDestination([
      ctaCandidate(flowTemplate(MAAT_FLOW_TEMPLATES.theTending, "axis:V"), 100),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theOpenHand, "axis:V:reciprocity"),
        78,
      ),
      ctaCandidate(nodeFallback, 70),
    ], params.outcomeSignals);
  }
  if (axis === "S") {
    return chooseOutcomeWeightedDestination([
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theOfferingTable, "axis:S"),
        100,
      ),
      ctaCandidate(nodeFallback, 70),
    ], params.outcomeSignals);
  }
  if (axis === "C") {
    return chooseOutcomeWeightedDestination([
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theKeptWord, "axis:C"),
        100,
      ),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theDjed, "axis:C:structural"),
        params.mode === "strength" ? 84 : 82,
      ),
      ctaCandidate(nodeFallback, 70),
    ], params.outcomeSignals);
  }
  if (axis === "J") {
    return chooseOutcomeWeightedDestination([
      ctaCandidate(nodeFallback, 100),
      ctaCandidate(
        flowTemplate(MAAT_FLOW_TEMPLATES.theOpenHand, "axis:J:justice"),
        82,
      ),
    ], params.outcomeSignals);
  }

  return nodeFallback;
}

function calendarFlowFromText(text: string): MaatDestinationResolution | null {
  if (/\bmoon|lunar|whole eye|empty eye\b/i.test(text)) {
    return flowTemplate(
      MAAT_FLOW_TEMPLATES.moonReturn,
      "calendar_arc:moon_return",
      "calendar_arc",
      0.9,
    );
  }
  if (/\bwag|ancestor|remembrance|memory\b/i.test(text)) {
    return flowTemplate(
      MAAT_FLOW_TEMPLATES.theWag,
      "calendar_arc:wag",
      "calendar_arc",
      0.9,
    );
  }
  if (/\bdays outside|heriu|epagomenal|year boundary\b/i.test(text)) {
    return flowTemplate(
      MAAT_FLOW_TEMPLATES.daysOutsideTheYear,
      "calendar_arc:days_outside_the_year",
      "calendar_arc",
      0.9,
    );
  }
  if (/\bdecan\b/i.test(text)) {
    return flowTemplate(
      MAAT_FLOW_TEMPLATES.decanWatch,
      "calendar_arc:decan_watch",
      "calendar_arc",
      0.88,
    );
  }
  if (/\bsky|star|horizon|calendar|season\b/i.test(text)) {
    return flowTemplate(
      MAAT_FLOW_TEMPLATES.trackTheSky,
      "calendar_arc:sky_watch",
      "calendar_arc",
      0.86,
    );
  }
  if (/\bdawn|morning|day opening\b/i.test(text)) {
    return flowTemplate(
      MAAT_FLOW_TEMPLATES.dawnHouseRite,
      "calendar_arc:dawn",
      "calendar_arc",
      0.84,
    );
  }
  if (/\bopen hand|generosity|give|offering\b/i.test(text)) {
    return flowTemplate(
      MAAT_FLOW_TEMPLATES.theOpenHand,
      "calendar_arc:open_hand",
      "calendar_arc",
      0.84,
    );
  }
  return null;
}

export function resolveCalendarDestination(params: {
  calendarFrame?: ReflectionCalendarFrame | null;
  decanName?: string | null;
  decanTheme?: string | null;
  decanContext?: string | null;
  dayCard?: {
    maatPrinciple?: string | null;
    cosmicContext?: string | null;
    decanDayTheme?: string | null;
    decanDayAction?: string | null;
    decanDayReflection?: string | null;
  } | null;
}): MaatDestinationResolution {
  const frame = params.calendarFrame;
  const text = haystack([
    params.decanName,
    params.decanTheme,
    params.decanContext,
    params.dayCard?.maatPrinciple,
    params.dayCard?.cosmicContext,
    params.dayCard?.decanDayTheme,
    params.dayCard?.decanDayAction,
    params.dayCard?.decanDayReflection,
    frame?.monthName,
    frame?.monthTransliteration,
    frame?.monthMeaning,
    frame?.seasonName,
    frame?.seasonMeaning,
    frame?.decanName,
    frame?.decanTheme,
    frame?.decanDescription,
    frame?.arcSummary,
  ]);
  return calendarFlowFromText(text) ??
    flowTemplate(
      MAAT_FLOW_TEMPLATES.decanWatch,
      "calendar_arc:decan_opening",
      "calendar_arc",
      0.78,
    );
}

export function resolveMaatOpeningDestination(params: {
  leadAxis: MaatAxisCode;
  decanName?: string | null;
  decanTheme?: string | null;
  decanContext?: string | null;
  dayCard?: {
    maatPrinciple?: string | null;
    cosmicContext?: string | null;
    decanDayTheme?: string | null;
    decanDayAction?: string | null;
    decanDayReflection?: string | null;
  } | null;
}): MaatDestinationResolution {
  const fallback = nodeForAxis(params.leadAxis, "decan_boundary:node_fallback");
  const calendar = resolveCalendarDestination(params);
  const reason = calendar.destinationReason === "calendar_arc:decan_opening"
    ? "decan_boundary:calendar_arc"
    : calendar.destinationReason;
  return {
    ...calendar,
    destinationReason: reason,
    reason,
    motivation: destinationMotivation({
      reason,
      confidence: calendar.confidence,
      source: calendar.source,
      score: calendar.score,
      signals: calendar.signals,
    }),
    fallback: {
      ctaType: fallback.ctaType,
      ctaRef: fallback.ctaRef,
      ctaLabel: fallback.ctaLabel,
    },
  };
}

function destinationForLens(
  lens: MaatAlignmentLens,
  reasonPrefix: string,
): MaatDestinationResolution {
  switch (lens) {
    case "truth":
    case "witness":
    case "worthiness":
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theWeighing,
        `${reasonPrefix}:${lens}`,
        "maat_lens",
        0.9,
        destination({
          type: "node",
          ref: "maat",
          reason: `${reasonPrefix}:${lens}:node_fallback`,
          source: "maat_lens",
          confidence: 0.62,
        }),
      );
    case "measure":
    case "becoming":
    case "continuity":
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theCourse,
        `${reasonPrefix}:${lens}`,
        "maat_lens",
        0.88,
        destination({
          type: "node",
          ref: "djehuty",
          reason: `${reasonPrefix}:${lens}:node_fallback`,
          source: "maat_lens",
          confidence: 0.62,
        }),
      );
    case "order":
    case "repair_isfet":
    case "restraint":
    case "self_mastery":
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theDjed,
        `${reasonPrefix}:${lens}`,
        "maat_lens",
        0.88,
        destination({
          type: "node",
          ref: "ptah",
          reason: `${reasonPrefix}:${lens}:node_fallback`,
          source: "maat_lens",
          confidence: 0.62,
        }),
      );
    case "life_preservation":
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theOfferingTable,
        `${reasonPrefix}:${lens}`,
        "maat_lens",
        0.88,
        destination({
          type: "node",
          ref: "renenutet",
          reason: `${reasonPrefix}:${lens}:node_fallback`,
          source: "maat_lens",
          confidence: 0.62,
        }),
      );
    case "care":
    case "reciprocity":
    case "vulnerable_protection":
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theTending,
        `${reasonPrefix}:${lens}`,
        "maat_lens",
        0.9,
        destination({
          type: "node",
          ref: "instruction_amenemope",
          reason: `${reasonPrefix}:${lens}:node_fallback`,
          source: "maat_lens",
          confidence: 0.62,
        }),
      );
    case "effective_speech":
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theKeptWord,
        `${reasonPrefix}:${lens}`,
        "maat_lens",
        0.9,
      );
    case "justice":
    case "offering_service":
    case "harmony":
      return flowTemplate(
        MAAT_FLOW_TEMPLATES.theOpenHand,
        `${reasonPrefix}:${lens}`,
        "maat_lens",
        0.86,
        destination({
          type: "node",
          ref: "maat",
          reason: `${reasonPrefix}:${lens}:node_fallback`,
          source: "maat_lens",
          confidence: 0.62,
        }),
      );
  }
}

export function resolveReflectionDestination(params: {
  judgment?: ReflectionJudgment | null;
  moralPortrait?: ReflectionMoralPortrait | null;
  profileSnapshot?: ReflectionProfileSnapshot | null;
  calendarFrame?: ReflectionCalendarFrame | null;
  profileFacts?: MaatUserProfileFact[] | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
}): MaatDestinationResolution {
  const judgmentLens = params.judgment?.selectedMaatLens;
  if (judgmentLens) {
    const nodeFallback = nodeForReflectionLens(
      judgmentLens,
      `reflection_alignment:${judgmentLens}:node_default`,
      "reflection_judgment",
    );
    const flow = highAlignmentFlowForReflection({
      lens: judgmentLens,
      source: "reflection_judgment",
      text: reflectionDestinationText(params),
      nodeFallback,
      normalizedObligationThreads: params.normalizedObligationThreads,
      profileFacts: params.profileFacts,
    });
    return flow ?? nodeFallback;
  }
  const snapshotLens = params.profileSnapshot?.dominantMaatLens;
  if (snapshotLens) {
    const nodeFallback = nodeForReflectionLens(
      snapshotLens,
      `profile_pattern:${snapshotLens}:node_default`,
      "profile_pattern",
    );
    const flow = highAlignmentFlowForReflection({
      lens: snapshotLens,
      source: "profile_pattern",
      text: reflectionDestinationText(params),
      nodeFallback,
      normalizedObligationThreads: params.normalizedObligationThreads,
      profileFacts: params.profileFacts,
    });
    return flow ?? nodeFallback;
  }
  return calendarNodeDestination({ calendarFrame: params.calendarFrame });
}

export function destinationPayload(
  resolution: MaatDestinationResolution,
): Record<string, unknown> {
  return {
    destination: {
      type: resolution.destinationType,
      ref: resolution.destinationRef,
      label: resolution.destinationLabel,
      reason: resolution.destinationReason,
      source: resolution.source,
      confidence: resolution.confidence,
      score: resolution.score,
      signals: resolution.signals,
      motivation: resolution.motivation,
      fallback: resolution.fallback,
    },
    destination_type: resolution.destinationType,
    destination_ref: resolution.destinationRef,
    destination_label: resolution.destinationLabel,
    destination_reason: resolution.destinationReason,
    destination_source: resolution.source,
    destination_confidence: resolution.confidence,
    destination_score: resolution.score,
    destination_signals: resolution.signals,
    destination_motivation: resolution.motivation,
    cta_type: resolution.ctaType,
    cta_ref: resolution.ctaRef,
    cta_label: resolution.ctaLabel,
  };
}

export function compiledDestinationForPackage(
  resolution: MaatDestinationResolution,
): CompiledOutputDestination | null {
  if (resolution.destinationType === "none" || !resolution.destinationRef) {
    return null;
  }
  return {
    type: resolution.destinationType,
    ref: resolution.destinationRef,
    label: resolution.destinationLabel,
    reason: resolution.destinationReason,
    source: resolution.source,
    confidence: resolution.confidence,
    score: resolution.score,
    signals: resolution.signals,
    motivation: resolution.motivation,
    fallback: resolution.fallback,
  };
}
