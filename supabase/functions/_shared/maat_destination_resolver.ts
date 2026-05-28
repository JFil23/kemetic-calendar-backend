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

export function firstNodeForAxis(axis: MaatAxisCode) {
  return AXIS_NODE_CANDIDATES[axis][0] ?? "maat";
}

export function noMaatDestination(reason: string): MaatDestinationResolution {
  return {
    ctaType: "none",
    ctaRef: null,
    ctaLabel: null,
    destinationType: "none",
    destinationRef: null,
    destinationLabel: null,
    destinationReason: reason,
    reason,
    confidence: 0,
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
  fallback?: MaatDestinationResolution | null;
}): MaatDestinationResolution {
  const label = labelForDestination(params.type, params.ref);
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
    confidence: params.confidence ?? 0.8,
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
) {
  return destination({
    type: "flow_template",
    ref,
    reason,
    source,
    confidence,
    fallback,
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
  });
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
  return {
    ...best,
    destinationReason: outcomeReason,
    reason: outcomeReason,
    source: bestSignal && bestSignal.outcomeFlag !== "neutral"
      ? "outcome"
      : best.source,
    confidence: Math.min(
      0.99,
      Math.max(0.5, best.confidence + (bestSignal ? 0.06 : 0)),
    ),
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
  return {
    ...calendar,
    destinationReason:
      calendar.destinationReason === "calendar_arc:decan_opening"
        ? "decan_boundary:calendar_arc"
        : calendar.destinationReason,
    reason: calendar.destinationReason === "calendar_arc:decan_opening"
      ? "decan_boundary:calendar_arc"
      : calendar.destinationReason,
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
    const selected = destinationForLens(judgmentLens, "reflection_judgment");
    return { ...selected, source: "reflection_judgment" };
  }
  const snapshotLens = params.profileSnapshot?.dominantMaatLens;
  if (snapshotLens) {
    const selected = destinationForLens(snapshotLens, "profile_snapshot");
    return { ...selected, source: "profile_pattern" };
  }
  const calendar = resolveCalendarDestination({
    calendarFrame: params.calendarFrame,
  });
  return { ...calendar, confidence: Math.min(calendar.confidence, 0.76) };
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
      fallback: resolution.fallback,
    },
    destination_type: resolution.destinationType,
    destination_ref: resolution.destinationRef,
    destination_label: resolution.destinationLabel,
    destination_reason: resolution.destinationReason,
    destination_source: resolution.source,
    destination_confidence: resolution.confidence,
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
    fallback: resolution.fallback,
  };
}
