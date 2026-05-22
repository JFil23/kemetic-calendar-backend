import {
  buildMaatDimensionSnapshot,
  buildReflectionDecisionMatrix,
  DEFAULT_MAAT_GATE_POLICY,
  type MaatAxisCode,
  type MaatDimensionSnapshot,
  type MaatGatePolicy,
  type ReflectionDecisionMatrixV1,
  type ReflectionProfileRow,
} from "../ai_generate_reflection/maat_decision.ts";
import { composeMaatFlowBrief, type MaatFlowBrief } from "./maat_flow_brief.ts";
import { joinGuidancePhrases } from "./guidance_evidence.ts";
import type { UserMemoryBrief } from "./user_memory_brief.ts";

export type GuidanceKind = "decan_opening" | "drift_nudge" | "strength_nudge";
export type GuidanceCtaType =
  | "none"
  | "node"
  | "flow"
  | "flow_template"
  | "flow_personalized";

export type GuidanceCtaOutcomeSignal = {
  ctaType: GuidanceCtaType;
  ctaRef: string | null;
  outcomeFlag: "winning" | "negative" | "neutral";
  completedWindowCount: number;
  weightedDeltaDoneRate: number | null;
  weightedDeltaSkippedRate?: number | null;
};

export type GuidanceWindow = {
  start: string;
  end: string;
  decanName: string;
  decanTheme?: string | null;
  decanContextKey?: string | null;
};

export type GuidanceBadgeRow = {
  title: string | null;
  details: string | null;
  tags?: string[] | null;
  occurred_on: string;
  flow_id?: number | null;
  event_id?: string | null;
};

export type DayCardGuidanceInput = {
  date?: string | null;
  maatPrinciple?: string | null;
  cosmicContext?: string | null;
  decanDayTheme?: string | null;
  decanDayAction?: string | null;
  decanDayReflection?: string | null;
};

export type GuidanceDraft = {
  kind: GuidanceKind;
  priority: number;
  teaserText: string;
  bodyText: string;
  payload: Record<string, unknown>;
  ctaType: GuidanceCtaType;
  ctaRef: string | null;
  triggerReason: string;
};

export type SnapshotRowLike = {
  dimensions?: Record<string, number> | null;
  score?: number | null;
  band?: MaatDimensionSnapshot["band"] | null;
  reflection_move?: MaatDimensionSnapshot["reflectionMove"] | null;
  lead_axis?: string | null;
  correction_axes?: string[] | null;
  hard_gates?: string[] | null;
  source?: Record<string, unknown> | null;
  window_start?: string | null;
  window_end?: string | null;
};

export const MAAT_GUIDANCE_POLICY_VERSION = "maat_policy_v3";
export const MAAT_REVIEW_ONLY_HARD_GATES = [
  "corrupt_judgment",
  "malicious_social_disruption",
] as const;

export type GuidanceMaturityLevel = "L1" | "L2" | "L3" | "L4" | "L5";

export type GuidanceMaturity = {
  level: GuidanceMaturityLevel;
  label:
    | "cold_start"
    | "warming"
    | "established"
    | "goal_calibrated"
    | "personal_model";
  confidence: number;
  reasons: string[];
};

export type GuidanceGoalProfile = {
  key:
    | "provision"
    | "care_dependents"
    | "measure"
    | "rest_restraint"
    | "cosmic_rhythm"
    | "default_decan";
  active: boolean;
  axes: MaatAxisCode[];
  nutritionGoal?: boolean;
  careObligations?: boolean;
  measureWeek?: boolean;
  activeFlowIds?: Array<string | number>;
  source?: string[];
};

export type GuidancePersonalBaseline = {
  computedAt?: string | null;
  snapshotCount?: number;
  medianScore?: number | null;
  medianBandRank?: number | null;
  nutritionDoneRate?: number | null;
  axisMedians?: Partial<Record<MaatAxisCode, number>> | null;
};

type PlannerSummary = {
  total: number;
  todoDone: number;
  todoPartial: number;
  todoSkipped: number;
  nutritionDone: number;
  nutritionPartial: number;
  nutritionSkipped: number;
};

const AXIS_LABELS: Record<MaatAxisCode, string> = {
  T: "truth",
  M: "measure",
  H: "life-preserving rhythm",
  V: "care",
  J: "due measure",
  S: "provision",
  E: "seasonal flow",
  R: "restraint",
  C: "cohesion",
};

const AXIS_NEXT_STEP: Record<MaatAxisCode, string> = {
  T: "write one truthful mark with one concrete detail",
  M: "give one task a clear number or finish condition",
  H: "protect the rhythm that keeps effort livable",
  V: "reduce one burden before adding another",
  J: "choose the proportionate next step",
  S: "protect one provision thread",
  E: "restore one life-supporting rhythm",
  R: "downshift force before adding more",
  C: "keep one role or promise coherent",
};

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

const GRAPH_NODE_AXIS_PRIORS: Record<string, MaatAxisCode[]> = {
  maat: ["T", "M", "J"],
  djehuty: ["T", "M"],
  thoth: ["T", "M"],
  renenutet: ["S", "E", "H"],
  ka: ["H", "S"],
  nile: ["S", "E"],
  ptah: ["C", "M"],
  sekhmet: ["R", "H"],
  instruction_amenemope: ["V", "J", "R"],
  amenemope: ["V", "J", "R"],
  isfet: ["M", "J", "R"],
};

const BAND_RANK: Record<MaatDimensionSnapshot["band"], number> = {
  isfet_patterned: 0,
  leaning_isfet: 1,
  mixed: 2,
  leaning_maat: 3,
  maat: 4,
};

function profileHasGraph(profile: ReflectionProfileRow | null) {
  return !!(
    (profile?.top_nodes?.length ?? 0) > 0 ||
    (profile?.top_edges?.length ?? 0) > 0 ||
    (profile?.tension_pairs?.length ?? 0) > 0
  );
}

export function resolveGuidanceMaturity(params: {
  badgeCount: number;
  snapshotCount: number;
  profile: ReflectionProfileRow | null;
  goalProfile?: GuidanceGoalProfile | null;
  personalBaseline?: GuidancePersonalBaseline | null;
}): GuidanceMaturity {
  const hasGraph = profileHasGraph(params.profile);
  const goalActive = params.goalProfile?.active === true;
  const hasBaseline = !!params.personalBaseline &&
    (params.personalBaseline.snapshotCount ?? 0) >= 10;
  const reasons = [
    `badges:${params.badgeCount}`,
    `snapshots:${params.snapshotCount}`,
    hasGraph ? "graph:present" : "graph:empty",
    goalActive ? `goal:${params.goalProfile?.key ?? "active"}` : "goal:empty",
    hasBaseline ? "baseline:present" : "baseline:empty",
  ];

  if (hasBaseline && params.snapshotCount >= 10) {
    return {
      level: "L5",
      label: "personal_model",
      confidence: 1,
      reasons,
    };
  }

  if (goalActive && params.snapshotCount >= 3) {
    return {
      level: "L4",
      label: "goal_calibrated",
      confidence: 1,
      reasons,
    };
  }

  if (params.snapshotCount >= 10 || (params.badgeCount >= 10 && hasGraph)) {
    return {
      level: "L3",
      label: "established",
      confidence: 1,
      reasons,
    };
  }

  if (params.snapshotCount >= 3 || params.badgeCount >= 10 || hasGraph) {
    return {
      level: "L2",
      label: "warming",
      confidence: 0.7,
      reasons,
    };
  }

  return {
    level: "L1",
    label: "cold_start",
    confidence: 0.5,
    reasons,
  };
}

export function resolveGatePolicyForMaturity(
  maturity: GuidanceMaturity,
  goalProfile?: GuidanceGoalProfile | null,
): MaatGatePolicy {
  switch (maturity.level) {
    case "L1":
      return {
        g1RegexEnabled: false,
        g4StructuralEnabled: false,
        g5RegexEnabled: false,
        g6MinSkips: 3,
        g6RequiresText: false,
        g7RegexEnabled: false,
        g8RegexEnabled: false,
      };
    case "L2":
      return {
        ...DEFAULT_MAAT_GATE_POLICY,
        g4StructuralEnabled: true,
        g5RegexEnabled: false,
        g8RegexEnabled: false,
        g6MinSkips: 2,
        g6RequiresText: true,
      };
    case "L3":
      return DEFAULT_MAAT_GATE_POLICY;
    case "L4":
    case "L5":
      if (goalProfile?.nutritionGoal) {
        return {
          ...DEFAULT_MAAT_GATE_POLICY,
          g6MinSkips: 1,
          g6RequiresText: true,
        };
      }
      return DEFAULT_MAAT_GATE_POLICY;
  }
}

export function resolveGraphAxisPriors(params: {
  profile: ReflectionProfileRow | null;
  maturity: GuidanceMaturity;
}): Partial<Record<MaatAxisCode, number>> {
  const boost = params.maturity.level === "L3" ||
      params.maturity.level === "L4" || params.maturity.level === "L5"
    ? 0.12
    : params.maturity.level === "L2"
    ? 0.08
    : 0;
  if (boost === 0 || !profileHasGraph(params.profile)) {
    return {};
  }

  const raw: Record<MaatAxisCode, number> = {
    T: 0,
    M: 0,
    H: 0,
    V: 0,
    J: 0,
    S: 0,
    E: 0,
    R: 0,
    C: 0,
  };
  const add = (axis: MaatAxisCode, amount: number) => {
    raw[axis] += amount;
  };

  for (const node of (params.profile?.top_nodes ?? []).slice(0, 4)) {
    const slug = node.slug?.trim().toLowerCase();
    if (!slug) continue;
    const axes = GRAPH_NODE_AXIS_PRIORS[slug] ?? [];
    const score = typeof node.score === "number" && Number.isFinite(node.score)
      ? Math.max(0.4, Math.min(1, node.score))
      : 0.7;
    for (const axis of axes) add(axis, score);
  }

  for (const pair of (params.profile?.tension_pairs ?? []).slice(0, 3)) {
    const text = pair.join(" ").toLowerCase();
    if (text.includes("maat") && text.includes("isfet")) {
      add("M", 0.5);
      add("J", 0.5);
      add("R", 0.5);
    }
  }

  return Object.fromEntries(
    Object.entries(raw)
      .map(([axis, amount]) =>
        [
          axis,
          Math.round(Math.min(0.18, amount * boost) * 1000) / 1000,
        ] as const
      )
      .filter(([, amount]) => amount > 0),
  ) as Partial<Record<MaatAxisCode, number>>;
}

export function buildGuidanceShapingFingerprint(params: {
  maturity: GuidanceMaturity;
  profile: ReflectionProfileRow | null;
  gatePolicy?: MaatGatePolicy;
  axisPriors?: Partial<Record<MaatAxisCode, number>>;
  goalProfile?: GuidanceGoalProfile | null;
  personalBaseline?: GuidancePersonalBaseline | null;
  decisionMatrixFingerprint?: Record<string, unknown> | null;
}) {
  const gatePolicy = params.gatePolicy ??
    resolveGatePolicyForMaturity(params.maturity);
  const topNodes = (params.profile?.top_nodes ?? [])
    .map((node) => node.slug?.trim())
    .filter((slug): slug is string => !!slug)
    .slice(0, 4);
  const tensionPairs = (params.profile?.tension_pairs ?? [])
    .map((pair) => pair.filter(Boolean).join(" vs "))
    .filter(Boolean)
    .slice(0, 3);

  return {
    policy_version: MAAT_GUIDANCE_POLICY_VERSION,
    maturity_level: params.maturity.level,
    maturity_label: params.maturity.label,
    confidence: params.maturity.confidence,
    maturity_reasons: params.maturity.reasons,
    goal_profile: params.goalProfile ?? null,
    personal_baseline: params.personalBaseline
      ? {
        snapshot_count: params.personalBaseline.snapshotCount ?? null,
        median_score: params.personalBaseline.medianScore ?? null,
        median_band_rank: params.personalBaseline.medianBandRank ?? null,
        nutrition_done_rate: params.personalBaseline.nutritionDoneRate ?? null,
        computed_at: params.personalBaseline.computedAt ?? null,
      }
      : null,
    implemented_hard_gates: [
      "knowingly_false_record",
      "vulnerable_deprivation",
      "corrupt_judgment",
      "life_supporting_flow_disrupted",
      "excessive_force_or_harm",
      "malicious_social_disruption",
    ],
    axis_only_concepts: [
      "distorted_measure",
    ],
    gate_policy: {
      g1_regex_enabled: gatePolicy.g1RegexEnabled,
      g4_structural_enabled: gatePolicy.g4StructuralEnabled,
      g5_regex_enabled: gatePolicy.g5RegexEnabled,
      g6_min_skips: gatePolicy.g6MinSkips,
      g6_requires_text: gatePolicy.g6RequiresText,
      g7_regex_enabled: gatePolicy.g7RegexEnabled,
      g8_regex_enabled: gatePolicy.g8RegexEnabled,
    },
    graph: {
      top_nodes: topNodes,
      tension_pairs: tensionPairs,
      axis_priors: params.axisPriors ?? resolveGraphAxisPriors({
        profile: params.profile,
        maturity: params.maturity,
      }),
      last_computed_at: params.profile?.last_computed_at ?? null,
    },
    decision_matrix: params.decisionMatrixFingerprint ?? null,
  };
}

export function guidancePriority(kind: GuidanceKind) {
  switch (kind) {
    case "decan_opening":
      return 10;
    case "drift_nudge":
      return 20;
    case "strength_nudge":
      return 30;
  }
}

export function decanPeriodKey(window: GuidanceWindow) {
  return [
    window.start,
    window.end,
    window.decanContextKey ?? window.decanName,
  ].join(":");
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function contentTags(row: GuidanceBadgeRow) {
  return (row.tags ?? [])
    .map((tag) => normalizeText(tag).toLowerCase())
    .filter(Boolean);
}

function badgeText(row: GuidanceBadgeRow) {
  const parts = [
    normalizeText(row.title),
    normalizeText(row.details),
    contentTags(row).join(" "),
  ].filter(Boolean);
  return parts.join(" ");
}

function plannerKind(row: GuidanceBadgeRow) {
  const tags = contentTags(row);
  if (tags.includes("kind:todo")) return "todo";
  if (tags.includes("kind:nutrition")) return "nutrition";
  const eventId = row.event_id ?? "";
  if (eventId.startsWith("planner-todo:")) return "todo";
  if (eventId.startsWith("planner-nutrition:")) return "nutrition";
  return null;
}

function plannerState(row: GuidanceBadgeRow) {
  const tags = contentTags(row);
  if (tags.includes("state:done")) return "done";
  if (tags.includes("state:partial") || tags.includes("state:in_progress")) {
    return "partial";
  }
  if (tags.includes("state:skipped")) return "skipped";
  return null;
}

export function buildPlannerSummaryFromBadges(
  badges: GuidanceBadgeRow[],
): PlannerSummary {
  const summary: PlannerSummary = {
    total: 0,
    todoDone: 0,
    todoPartial: 0,
    todoSkipped: 0,
    nutritionDone: 0,
    nutritionPartial: 0,
    nutritionSkipped: 0,
  };

  for (const badge of badges) {
    const kind = plannerKind(badge);
    const state = plannerState(badge);
    if (!kind || !state) continue;
    summary.total += 1;
    if (kind === "todo" && state === "done") summary.todoDone += 1;
    if (kind === "todo" && state === "partial") summary.todoPartial += 1;
    if (kind === "todo" && state === "skipped") summary.todoSkipped += 1;
    if (kind === "nutrition" && state === "done") {
      summary.nutritionDone += 1;
    }
    if (kind === "nutrition" && state === "partial") {
      summary.nutritionPartial += 1;
    }
    if (kind === "nutrition" && state === "skipped") {
      summary.nutritionSkipped += 1;
    }
  }

  return summary;
}

function countActiveDays(badges: GuidanceBadgeRow[]) {
  return new Set(badges.map((badge) => badge.occurred_on).filter(Boolean)).size;
}

export function buildGuidanceSnapshot(params: {
  window: GuidanceWindow;
  decanContext?: {
    shortName?: string | null;
    displayName?: string | null;
    defaultLabel?: string | null;
    detailDescription?: string | null;
  } | null;
  badges: GuidanceBadgeRow[];
  gatePolicy?: MaatGatePolicy;
  axisPriors?: Partial<Record<MaatAxisCode, number>>;
}) {
  const badgesWithDetails =
    params.badges.filter((badge) => normalizeText(badge.details).length > 0)
      .length;

  return buildMaatDimensionSnapshot({
    decanName: params.window.decanName,
    decanTheme: params.window.decanTheme ?? null,
    decanContext: params.decanContext ?? null,
    evidenceTexts: params.badges.map(badgeText),
    badgeCount: params.badges.length,
    badgesWithDetails,
    activeDays: countActiveDays(params.badges),
    windowStart: params.window.start,
    windowEnd: params.window.end,
    plannerSummary: buildPlannerSummaryFromBadges(params.badges),
    gatePolicy: params.gatePolicy,
    axisPriors: params.axisPriors,
  });
}

export function buildOpeningDecisionMatrix(params: {
  profile: ReflectionProfileRow | null;
  snapshot: MaatDimensionSnapshot;
}) {
  return buildReflectionDecisionMatrix(params.profile, params.snapshot, {
    useKnowledgeGraph: true,
    useDecisionMatrix: true,
  });
}

function axisFromRaw(raw: string | null | undefined): MaatAxisCode {
  const upper = (raw ?? "").trim().toUpperCase();
  if (
    upper === "T" || upper === "M" || upper === "H" || upper === "V" ||
    upper === "J" || upper === "S" || upper === "E" || upper === "R" ||
    upper === "C"
  ) {
    return upper;
  }
  return "M";
}

export function snapshotFromRow(
  row: SnapshotRowLike | null,
): MaatDimensionSnapshot | null {
  if (!row?.band || !row.reflection_move) return null;
  const leadAxis = axisFromRaw(row.lead_axis);
  return {
    version: "maat_dims_v1",
    dimensions: {
      T: Number(row.dimensions?.T ?? 0),
      M: Number(row.dimensions?.M ?? 0),
      H: Number(row.dimensions?.H ?? 0),
      V: Number(row.dimensions?.V ?? 0),
      J: Number(row.dimensions?.J ?? 0),
      S: Number(row.dimensions?.S ?? 0),
      E: Number(row.dimensions?.E ?? 0),
      R: Number(row.dimensions?.R ?? 0),
      C: Number(row.dimensions?.C ?? 0),
    },
    score: Number(row.score ?? 0),
    band: row.band,
    reflectionMove: row.reflection_move,
    leadAxis,
    correctionAxes: (row.correction_axes ?? []).map(axisFromRaw),
    hardGates: row.hard_gates ?? [],
    decanPrimaryAxes: [],
    source: {
      planner_total: Number(row.source?.planner_total ?? 0),
      completed_planner: Number(row.source?.completed_planner ?? 0),
      partial_planner: Number(row.source?.partial_planner ?? 0),
      skipped_planner: Number(row.source?.skipped_planner ?? 0),
      details_coverage: Number(row.source?.details_coverage ?? 0),
      days_active: Number(row.source?.days_active ?? 0),
    },
  };
}

function sentence(value: string | null | undefined) {
  const text = normalizeText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function dayCardLine(dayCard?: DayCardGuidanceInput | null) {
  if (!dayCard) return "";
  const parts = [
    dayCard.maatPrinciple
      ? `Today centers ${normalizeText(dayCard.maatPrinciple)}`
      : "",
    dayCard.decanDayAction
      ? `your move is ${normalizeText(dayCard.decanDayAction)}`
      : "",
  ].filter(Boolean);
  return parts.length ? sentence(parts.join("; ")) : "";
}

function memoryEvidenceLine(
  memoryBrief?: UserMemoryBrief | null,
  mode: "opening" | "drift" | "strength" = "opening",
) {
  if (!memoryBrief) return "";
  const evidence = memoryBrief.evidencePhrases.slice(0, 2);
  if (evidence.length) {
    if (mode === "strength") {
      return sentence(
        `Keep faith with what is already visible in ${
          joinGuidancePhrases(evidence)
        }`,
      );
    }
    if (mode === "drift") {
      return sentence(
        `Use one concrete mark already in the record, ${
          joinGuidancePhrases(evidence)
        }, as the place to restore measure`,
      );
    }
    return sentence(
      `Recent marks such as ${
        joinGuidancePhrases(evidence)
      } can anchor the first step`,
    );
  }
  const anchor = memoryBrief.anchorLabels[0];
  if (anchor) {
    return sentence(
      `Let the recurring anchor of ${anchor} shape the first step`,
    );
  }
  return "";
}

export function buildDecanOpeningDraft(params: {
  window: GuidanceWindow;
  decanContext?: { detailDescription?: string | null } | null;
  dayCard?: DayCardGuidanceInput | null;
  matrix?: ReflectionDecisionMatrixV1 | null;
  snapshot: MaatDimensionSnapshot;
  memoryBrief?: UserMemoryBrief | null;
}): GuidanceDraft {
  const leadAxis = params.matrix?.leadAxis ?? params.snapshot.leadAxis;
  const axisLabel = AXIS_LABELS[leadAxis];
  const nextStep = AXIS_NEXT_STEP[leadAxis];
  const nodeRef = firstNodeForAxis(leadAxis);
  const contextSentence = sentence(params.decanContext?.detailDescription)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)[0] ?? "";
  const dayLine = dayCardLine(params.dayCard);
  const memoryLine = memoryEvidenceLine(params.memoryBrief, "opening");

  const teaserText = [
    `This decan asks for ${axisLabel} to become practical.`,
    `Begin with one measured act: ${nextStep}.`,
    dayLine || "Let the rhythm of this cycle turn attention into structure.",
  ].filter(Boolean).join(" ");

  const bodyText = [
    `This decan opens through ${params.window.decanName}.`,
    contextSentence ||
    "Its work is to make order visible through one concrete practice.",
    dayLine,
    memoryLine,
    `The useful move now is simple: ${nextStep}. Keep it small enough to repeat, clear enough to record, and quiet enough to preserve the rest of the pattern.`,
  ].filter(Boolean).join("\n\n");

  return {
    kind: "decan_opening",
    priority: guidancePriority("decan_opening"),
    teaserText,
    bodyText,
    payload: {
      lead_axis: leadAxis,
      band: params.snapshot.band,
      reflection_move: params.snapshot.reflectionMove,
      hard_gates: params.snapshot.hardGates,
      decision_matrix_fingerprint: params.matrix?.fingerprint ?? null,
      decan_context_key: params.window.decanContextKey ?? null,
      day_card_date: params.dayCard?.date ?? null,
      node_ref: nodeRef,
      memory_context_quality: params.memoryBrief?.contextQuality ?? null,
      memory_anchor_labels: params.memoryBrief?.anchorLabels ?? [],
      memory_evidence_phrases: params.memoryBrief?.evidencePhrases ?? [],
    },
    ctaType: "node",
    ctaRef: nodeRef,
    triggerReason: "decan_boundary",
  };
}

function firstNodeForAxis(axis: MaatAxisCode) {
  return AXIS_NODE_CANDIDATES[axis][0] ?? "maat";
}

type GuidanceCtaResolution = {
  ctaType: GuidanceCtaType;
  ctaRef: string | null;
  reason: string;
  brief?: MaatFlowBrief | null;
};

type GuidanceCtaCandidate = GuidanceCtaResolution & {
  baseWeight: number;
};

const FLOW_TEMPLATES = {
  dawnHouseRite: "dawn-house-rite",
  eveningThresholdRite: "evening-threshold-rite",
  trackTheSky: "track-the-sky",
} as const;

function flowTemplate(ref: string, reason: string): GuidanceCtaResolution {
  return { ctaType: "flow_template", ctaRef: ref, reason };
}

function nodeForAxis(
  axis: MaatAxisCode,
  reason: string,
): GuidanceCtaResolution {
  return { ctaType: "node", ctaRef: firstNodeForAxis(axis), reason };
}

function ctaCandidate(
  resolution: GuidanceCtaResolution,
  baseWeight: number,
): GuidanceCtaCandidate {
  return { ...resolution, baseWeight };
}

function outcomeSignalForCandidate(
  candidate: GuidanceCtaCandidate,
  outcomeSignals: GuidanceCtaOutcomeSignal[] | undefined,
) {
  return (outcomeSignals ?? []).find((signal) =>
    signal.ctaType === candidate.ctaType &&
    (signal.ctaRef ?? null) === (candidate.ctaRef ?? null)
  ) ?? null;
}

function chooseOutcomeWeightedCta(
  candidates: GuidanceCtaCandidate[],
  outcomeSignals?: GuidanceCtaOutcomeSignal[],
): GuidanceCtaResolution {
  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestSignal: GuidanceCtaOutcomeSignal | null = null;

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

  return {
    ctaType: best.ctaType,
    ctaRef: best.ctaRef,
    reason: bestSignal && bestSignal.outcomeFlag !== "neutral"
      ? `${best.reason}:outcome_${bestSignal.outcomeFlag}`
      : best.reason,
  };
}

export function resolveGuidanceCta(params: {
  snapshot: MaatDimensionSnapshot;
  mode: "drift" | "strength";
  outcomeSignals?: GuidanceCtaOutcomeSignal[];
}): GuidanceCtaResolution {
  const correctionAxis = params.snapshot.correctionAxes[0] ??
    params.snapshot.leadAxis;
  const axis = params.mode === "drift"
    ? correctionAxis
    : params.snapshot.leadAxis;
  const hardGates = new Set(params.snapshot.hardGates);

  if (params.mode === "drift") {
    if (hardGates.has("vulnerable_deprivation")) {
      return {
        ctaType: "node",
        ctaRef: "instruction_amenemope",
        reason: "gate:vulnerable_deprivation",
      };
    }
    if (hardGates.has("corrupt_judgment")) {
      return {
        ctaType: "node",
        ctaRef: "maat",
        reason: "gate:corrupt_judgment",
      };
    }
    if (hardGates.has("malicious_social_disruption")) {
      return {
        ctaType: "node",
        ctaRef: "maat",
        reason: "gate:malicious_social_disruption",
      };
    }
    if (hardGates.has("life_supporting_flow_disrupted")) {
      return flowTemplate(
        FLOW_TEMPLATES.dawnHouseRite,
        "gate:life_supporting_flow_disrupted",
      );
    }
    if (hardGates.has("excessive_force_or_harm")) {
      return flowTemplate(
        FLOW_TEMPLATES.eveningThresholdRite,
        "gate:excessive_force_or_harm",
      );
    }
    if (hardGates.has("knowingly_false_record")) {
      return flowTemplate(
        FLOW_TEMPLATES.dawnHouseRite,
        "gate:knowingly_false_record",
      );
    }
    if (axis === "E") {
      return chooseOutcomeWeightedCta([
        ctaCandidate(flowTemplate(FLOW_TEMPLATES.trackTheSky, "axis:E"), 100),
        ctaCandidate(nodeForAxis(axis, "axis:E:node_fallback"), 70),
      ], params.outcomeSignals);
    }
    if (axis === "H" || axis === "R") {
      return chooseOutcomeWeightedCta([
        ctaCandidate(
          flowTemplate(FLOW_TEMPLATES.eveningThresholdRite, `axis:${axis}`),
          100,
        ),
        ctaCandidate(nodeForAxis(axis, `axis:${axis}:node_fallback`), 70),
      ], params.outcomeSignals);
    }
    if (axis === "M" || axis === "S" || axis === "C") {
      return chooseOutcomeWeightedCta([
        ctaCandidate(
          flowTemplate(FLOW_TEMPLATES.dawnHouseRite, `axis:${axis}`),
          100,
        ),
        ctaCandidate(nodeForAxis(axis, `axis:${axis}:node_fallback`), 70),
      ], params.outcomeSignals);
    }
  }

  if (params.mode === "strength") {
    if (axis === "E") {
      return chooseOutcomeWeightedCta([
        ctaCandidate(flowTemplate(FLOW_TEMPLATES.trackTheSky, "axis:E"), 100),
        ctaCandidate(nodeForAxis(axis, "axis:E:node_fallback"), 70),
      ], params.outcomeSignals);
    }
    if (axis === "H" || axis === "R") {
      return chooseOutcomeWeightedCta([
        ctaCandidate(
          flowTemplate(FLOW_TEMPLATES.eveningThresholdRite, `axis:${axis}`),
          100,
        ),
        ctaCandidate(nodeForAxis(axis, `axis:${axis}:node_fallback`), 70),
      ], params.outcomeSignals);
    }
    if (axis === "M" || axis === "T" || axis === "C") {
      return chooseOutcomeWeightedCta([
        ctaCandidate(
          flowTemplate(FLOW_TEMPLATES.dawnHouseRite, `axis:${axis}`),
          100,
        ),
        ctaCandidate(nodeForAxis(axis, `axis:${axis}:node_fallback`), 70),
      ], params.outcomeSignals);
    }
  }

  return nodeForAxis(axis, `axis:${axis}:node_fallback`);
}

function maybePersonalizeFlowCta(params: {
  cta: GuidanceCtaResolution;
  snapshot: MaatDimensionSnapshot;
  mode: "drift" | "strength";
  window: GuidanceWindow;
  triggerReason?: string | null;
  maturity?: GuidanceMaturity | null;
  goalProfile?: GuidanceGoalProfile | null;
  personalBaseline?: GuidancePersonalBaseline | null;
  enablePersonalizedFlow?: boolean;
}): GuidanceCtaResolution {
  if (!params.enablePersonalizedFlow) return params.cta;
  const correctionAxis = params.snapshot.correctionAxes[0] ??
    params.snapshot.leadAxis;
  const careAxisFallback = params.mode === "drift" &&
      correctionAxis === "V" &&
      params.snapshot.hardGates.length === 0
    ? FLOW_TEMPLATES.dawnHouseRite
    : null;
  const fallbackTemplateKey = params.cta.ctaType === "flow_template"
    ? params.cta.ctaRef
    : careAxisFallback;
  if (!fallbackTemplateKey) {
    return params.cta;
  }
  const brief = composeMaatFlowBrief({
    snapshot: params.snapshot,
    mode: params.mode,
    window: params.window,
    maturity: params.maturity,
    goalProfile: params.goalProfile,
    baseline: params.personalBaseline,
    triggerReason: params.triggerReason,
    fallbackTemplateKey,
  });
  if (!brief) return params.cta;
  return {
    ctaType: "flow_personalized",
    ctaRef: brief.briefId,
    reason: `${params.cta.reason}:personalized_flow`,
    brief,
  };
}

function flowBriefPayload(brief?: MaatFlowBrief | null) {
  if (!brief) return {};
  return {
    brief_id: brief.briefId,
    brief_policy_version: brief.policyVersion,
    preview_summary: brief.preview.overviewSummary,
    sample_days: brief.preview.sampleDays ?? [],
    fallback_template_key: brief.fallbackTemplateKey ?? null,
    flow_brief: brief,
  };
}

export function buildDriftNudgeDraft(params: {
  snapshot: MaatDimensionSnapshot;
  triggerReason: string;
  decisionMatrixFingerprint?: Record<string, unknown> | null;
  window: GuidanceWindow;
  outcomeSignals?: GuidanceCtaOutcomeSignal[];
  maturity?: GuidanceMaturity | null;
  goalProfile?: GuidanceGoalProfile | null;
  personalBaseline?: GuidancePersonalBaseline | null;
  enablePersonalizedFlow?: boolean;
  memoryBrief?: UserMemoryBrief | null;
}): GuidanceDraft {
  const correctionAxis = params.snapshot.correctionAxes[0] ??
    params.snapshot.leadAxis;
  const axisLabel = AXIS_LABELS[correctionAxis];
  const nextStep = AXIS_NEXT_STEP[correctionAxis];
  const cta = maybePersonalizeFlowCta({
    cta: resolveGuidanceCta({
      snapshot: params.snapshot,
      mode: "drift",
      outcomeSignals: params.outcomeSignals,
    }),
    snapshot: params.snapshot,
    mode: "drift",
    window: params.window,
    triggerReason: params.triggerReason,
    maturity: params.maturity,
    goalProfile: params.goalProfile,
    personalBaseline: params.personalBaseline,
    enablePersonalizedFlow: params.enablePersonalizedFlow,
  });
  const teaserText =
    `A path back to balance is available. Begin with one measured act of ${axisLabel}: ${nextStep}.`;
  const bodyText = [
    "The pattern does not need a verdict; it needs a next step.",
    memoryEvidenceLine(params.memoryBrief, "drift"),
    `Start with ${axisLabel}. ${sentence(nextStep)}`,
    "Keep the action small, visible, and restorable. One honest correction is enough for today.",
  ].filter(Boolean).join("\n\n");

  return {
    kind: "drift_nudge",
    priority: guidancePriority("drift_nudge"),
    teaserText,
    bodyText,
    payload: {
      lead_axis: params.snapshot.leadAxis,
      correction_axis: correctionAxis,
      band: params.snapshot.band,
      reflection_move: params.snapshot.reflectionMove,
      hard_gates: params.snapshot.hardGates,
      decision_matrix_fingerprint: params.decisionMatrixFingerprint ?? null,
      decan_context_key: params.window.decanContextKey ?? null,
      cta_reason: cta.reason,
      memory_context_quality: params.memoryBrief?.contextQuality ?? null,
      memory_anchor_labels: params.memoryBrief?.anchorLabels ?? [],
      memory_evidence_phrases: params.memoryBrief?.evidencePhrases ?? [],
      ...flowBriefPayload(cta.brief),
    },
    ctaType: cta.ctaType,
    ctaRef: cta.ctaRef,
    triggerReason: params.triggerReason,
  };
}

export function buildStrengthNudgeDraft(params: {
  snapshot: MaatDimensionSnapshot;
  window: GuidanceWindow;
  decisionMatrixFingerprint?: Record<string, unknown> | null;
  outcomeSignals?: GuidanceCtaOutcomeSignal[];
  maturity?: GuidanceMaturity | null;
  goalProfile?: GuidanceGoalProfile | null;
  personalBaseline?: GuidancePersonalBaseline | null;
  enablePersonalizedFlow?: boolean;
  memoryBrief?: UserMemoryBrief | null;
}): GuidanceDraft {
  const leadAxis = params.snapshot.leadAxis;
  const axisLabel = AXIS_LABELS[leadAxis];
  const nextStep = AXIS_NEXT_STEP[leadAxis];
  const cta = maybePersonalizeFlowCta({
    cta: resolveGuidanceCta({
      snapshot: params.snapshot,
      mode: "strength",
      outcomeSignals: params.outcomeSignals,
    }),
    snapshot: params.snapshot,
    mode: "strength",
    window: params.window,
    triggerReason: "sustained_maat_signal",
    maturity: params.maturity,
    goalProfile: params.goalProfile,
    personalBaseline: params.personalBaseline,
    enablePersonalizedFlow: params.enablePersonalizedFlow,
  });
  const teaserText =
    `Your rhythm is holding. Deepen the pattern through ${axisLabel}: ${nextStep}.`;
  const bodyText = [
    "The useful work now is preservation, not expansion.",
    memoryEvidenceLine(params.memoryBrief, "strength"),
    `Stay with the strength already visible in ${axisLabel}. ${
      sentence(nextStep)
    }`,
    "Let repetition make the pattern dependable before adding another demand.",
  ].filter(Boolean).join("\n\n");

  return {
    kind: "strength_nudge",
    priority: guidancePriority("strength_nudge"),
    teaserText,
    bodyText,
    payload: {
      lead_axis: leadAxis,
      band: params.snapshot.band,
      reflection_move: params.snapshot.reflectionMove,
      hard_gates: params.snapshot.hardGates,
      decision_matrix_fingerprint: params.decisionMatrixFingerprint ?? null,
      decan_context_key: params.window.decanContextKey ?? null,
      cta_reason: cta.reason,
      memory_context_quality: params.memoryBrief?.contextQuality ?? null,
      memory_anchor_labels: params.memoryBrief?.anchorLabels ?? [],
      memory_evidence_phrases: params.memoryBrief?.evidencePhrases ?? [],
      ...flowBriefPayload(cta.brief),
    },
    ctaType: cta.ctaType,
    ctaRef: cta.ctaRef,
    triggerReason: "sustained_maat_signal",
  };
}

export function shouldCreateDriftNudge(params: {
  current: MaatDimensionSnapshot;
  previous: MaatDimensionSnapshot[];
  driftCount: number;
  activeDriftExists?: boolean;
  confidence?: number;
  minimumConfidence?: number;
  lastDriftAt?: Date | null;
  openingHandled: boolean;
  decanDayIndex: number;
  now: Date;
  personalBaselineBandRank?: number | null;
  personalBaselineDropThreshold?: number;
  reviewOnlyHardGates?: string[];
}) {
  if (params.driftCount >= 2) return { create: false, reason: "cap_reached" };
  if (params.activeDriftExists) {
    return { create: false, reason: "active_drift_exists" };
  }
  if (!params.openingHandled && params.decanDayIndex <= 1) {
    return { create: false, reason: "opening_first" };
  }
  if (params.lastDriftAt) {
    const ms = params.now.getTime() - params.lastDriftAt.getTime();
    if (ms < 48 * 60 * 60 * 1000) {
      return { create: false, reason: "cooldown" };
    }
  }
  const structuralLifeSupportGate = params.current.hardGates.includes(
    "life_supporting_flow_disrupted",
  );
  if (
    params.confidence !== undefined &&
    params.confidence < (params.minimumConfidence ?? 0.7) &&
    !structuralLifeSupportGate
  ) {
    return { create: false, reason: "low_confidence" };
  }
  if (params.current.hardGates.length > 0) {
    const reviewOnlyHardGates = new Set(params.reviewOnlyHardGates ?? []);
    const onlyReviewGates = params.current.hardGates.every((gate) =>
      reviewOnlyHardGates.has(gate)
    );
    if (onlyReviewGates && reviewOnlyHardGates.size > 0) {
      const persisted = params.previous.slice(0, 1).some((snapshot) =>
        snapshot.hardGates.some((gate) => reviewOnlyHardGates.has(gate))
      );
      if (!persisted) {
        return { create: false, reason: "review_only_gate" };
      }
    }
    return { create: true, reason: "hard_gate" };
  }
  if (params.personalBaselineBandRank !== undefined) {
    const baselineRank = params.personalBaselineBandRank;
    const threshold = params.personalBaselineDropThreshold ?? 1;
    const currentRank = BAND_RANK[params.current.band];
    if (
      baselineRank !== null &&
      Number.isFinite(baselineRank) &&
      currentRank <= baselineRank - threshold &&
      currentRank <= BAND_RANK.mixed
    ) {
      return { create: true, reason: "personal_baseline_drop" };
    }
  }
  if (params.current.reflectionMove === "correct") {
    const previousCorrect = params.previous
      .slice(0, 1)
      .some((snapshot) => snapshot.reflectionMove === "correct");
    return previousCorrect
      ? { create: true, reason: "correction_persisted" }
      : { create: false, reason: "wait_for_hysteresis" };
  }

  const prior = params.previous[0];
  if (!prior) return { create: false, reason: "no_prior_snapshot" };
  const worsened = BAND_RANK[params.current.band] < BAND_RANK[prior.band];
  const nowWeak = BAND_RANK[params.current.band] <= BAND_RANK.mixed;
  const priorWeak = BAND_RANK[prior.band] <= BAND_RANK.mixed;
  if (worsened && (nowWeak || priorWeak)) {
    return { create: true, reason: "band_worsened" };
  }
  if (nowWeak && priorWeak) {
    return { create: true, reason: "weak_band_persisted" };
  }

  return { create: false, reason: "stable" };
}

export function shouldCreateStrengthNudge(params: {
  snapshots: MaatDimensionSnapshot[];
  strengthCount: number;
  driftCount: number;
  openCorrectionExists?: boolean;
  decanDayIndex: number;
  openingHandled: boolean;
}) {
  if (params.strengthCount >= 1) return false;
  if (params.driftCount >= 2) return false;
  if (params.openCorrectionExists) return false;
  if (!params.openingHandled || params.decanDayIndex < 4) return false;

  const recent = params.snapshots.slice(0, 5);
  const strongCount =
    recent.filter((snapshot) =>
      snapshot.band === "maat" || snapshot.band === "leaning_maat"
    ).length;
  const hardGateInLast3 = recent.slice(0, 3).some((snapshot) =>
    snapshot.hardGates.length > 0
  );

  return strongCount >= 3 && !hardGateInLast3;
}

export function shouldCompleteOpenCorrection(params: {
  snapshots: MaatDimensionSnapshot[];
  minimumRecoveredSnapshots?: number;
}) {
  const minimum = Math.max(1, params.minimumRecoveredSnapshots ?? 2);
  const recent = params.snapshots.slice(0, minimum);
  if (recent.length < minimum) return false;

  return recent.every((snapshot) =>
    (snapshot.band === "maat" || snapshot.band === "leaning_maat") &&
    snapshot.hardGates.length === 0 &&
    snapshot.reflectionMove !== "correct"
  );
}

export function decanDayIndex(windowStart: string, localDate: string) {
  const start = Date.parse(`${windowStart}T00:00:00Z`);
  const current = Date.parse(`${localDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(current)) return 1;
  return Math.max(1, Math.floor((current - start) / 86400000) + 1);
}
