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
import { maatLedgerPayload, type MaatLedgerSummary } from "./maat_ledger.ts";
import {
  interpretMaatSituation,
  type MaatSituationInterpretation,
  maatSituationPayload,
} from "./maat_situation_interpreter.ts";
import {
  buildControlledOutput,
  type ControlledMeaningLayer,
  type ControlledOutputKind,
  type ControlledOutputPlan,
  type ControlledSurfaceConstraints,
  type ControlledSurfaceVariants,
  DEFAULT_OUTPUT_BANNED_PHRASES,
  evidenceAnchorsFromMemoryPhrases,
  gradeOutputTextAgainstPolicy,
  OUTPUT_CONTROL_POLICY_VERSION,
  outputControlPayload,
  outputSurfaceVariantsPayload,
  validateSurfaceVariants,
} from "./output_control.ts";
import {
  MAAT_CONSTITUTION_VERSION,
  MAAT_OUTPUT_FORCE_PRINCIPLE,
  MAAT_OUTPUT_NORTH_STAR,
} from "./maat_constitution.ts";
import type { MaatFlowDecanPatternSynthesis } from "./maat_flow_response_spectrum.ts";
import {
  type DeterministicMaatFlowResponse,
  maatFlowResponseRendererMetadata,
  renderMaatFlowResponse,
} from "./maat_flow_response_renderer.ts";
import {
  buildCompiledOutputPackage,
  buildOutputCompilerTrace,
  type CompiledOutputDestination,
  type CompiledOutputPackage,
  type OutputCompilerTrace,
} from "./output_compiler.ts";
import {
  compiledDestinationForPackage,
  destinationPayload,
  firstNodeForAxis as destinationFirstNodeForAxis,
  MAAT_FLOW_TEMPLATES,
  type MaatDestinationResolution,
  noMaatDestination,
  resolveMaatGuidanceDestination,
  resolveMaatOpeningDestination,
} from "./maat_destination_resolver.ts";
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
  metadata?: Record<string, unknown> | null;
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

export const DECAN_CONTEXT_OPENING_TRACK = "decan_context_opening";
export const DECAN_CONTEXT_OPENING_SOURCE = "calendar_month_decan_day1_context";

export type NudgeLlmRenderer = (params: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ text: string; modelUsed?: string | null }>;

export type NudgeLlmRenderOptions = {
  enabled?: boolean;
  renderer?: NudgeLlmRenderer;
  apiKey?: string | null;
  model?: string | null;
};

export type DayFiveCadenceMode = "maat" | "isfet" | "inquire";

export type DayFiveCadenceDecision = {
  create: boolean;
  mode: DayFiveCadenceMode | null;
  kind: Extract<GuidanceKind, "drift_nudge" | "strength_nudge"> | null;
  reason: string;
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

function maatFlowPatternPayload(
  pattern?: MaatFlowDecanPatternSynthesis | null,
) {
  return pattern ? { maat_flow_decan_pattern: pattern } : {};
}

type PlannerSummary = {
  total: number;
  todoDone: number;
  todoPartial: number;
  todoSkipped: number;
  todoPending: number;
  nutritionDone: number;
  nutritionPartial: number;
  nutritionSkipped: number;
  nutritionPending: number;
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
  if (tags.includes("state:pending")) return "pending";
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
    todoPending: 0,
    nutritionDone: 0,
    nutritionPartial: 0,
    nutritionSkipped: 0,
    nutritionPending: 0,
  };

  for (const badge of badges) {
    const kind = plannerKind(badge);
    const state = plannerState(badge);
    if (!kind || !state) continue;
    summary.total += 1;
    if (kind === "todo" && state === "done") summary.todoDone += 1;
    if (kind === "todo" && state === "partial") summary.todoPartial += 1;
    if (kind === "todo" && state === "skipped") summary.todoSkipped += 1;
    if (kind === "todo" && state === "pending") summary.todoPending += 1;
    if (kind === "nutrition" && state === "done") {
      summary.nutritionDone += 1;
    }
    if (kind === "nutrition" && state === "partial") {
      summary.nutritionPartial += 1;
    }
    if (kind === "nutrition" && state === "skipped") {
      summary.nutritionSkipped += 1;
    }
    if (kind === "nutrition" && state === "pending") {
      summary.nutritionPending += 1;
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
      pending_planner: Number(row.source?.pending_planner ?? 0),
      open_obligations: Number(row.source?.open_obligations ?? 0),
      unresolved_obligations: Number(row.source?.unresolved_obligations ?? 0),
      ledger: row.source?.ledger as MaatLedgerSummary | undefined,
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

function guidanceSurfaceConstraints(
  kind: ControlledOutputKind,
): ControlledSurfaceConstraints {
  switch (kind) {
    case "decan_opening":
      return {
        teaserCharsMax: 220,
        pushExcerptCharsMax: 120,
        archivePreviewCharsMax: 160,
        bodySentencesMax: 8,
        bodyParagraphsMax: 5,
        bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      };
    case "drift_nudge":
      return {
        teaserCharsMax: 160,
        pushExcerptCharsMax: 110,
        archivePreviewCharsMax: 150,
        bodySentencesMax: 6,
        bodyParagraphsMax: 4,
        bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      };
    case "strength_nudge":
      return {
        teaserCharsMax: 160,
        pushExcerptCharsMax: 110,
        archivePreviewCharsMax: 150,
        bodySentencesMax: 6,
        bodyParagraphsMax: 4,
        bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      };
  }
}

function memoryAnchorsForOutput(
  memoryBrief: UserMemoryBrief | null | undefined,
  prefix: string,
) {
  const phraseAnchors = evidenceAnchorsFromMemoryPhrases(
    memoryBrief?.evidencePhrases,
    { prefix, sourceType: "memory", limit: 3 },
  );
  if (phraseAnchors.length > 0) return phraseAnchors;
  const anchor = normalizeText(memoryBrief?.anchorLabels[0]);
  if (!anchor) return [];
  return evidenceAnchorsFromMemoryPhrases([`recurring anchor of ${anchor}`], {
    prefix,
    sourceType: "memory",
    limit: 1,
  });
}

function firstMemoryPhrase(memoryBrief: UserMemoryBrief | null | undefined) {
  return normalizeText(memoryBrief?.evidencePhrases?.[0]).toLowerCase();
}

function firstMemoryDomain(memoryBrief: UserMemoryBrief | null | undefined) {
  const phrase = firstMemoryPhrase(memoryBrief);
  if (!phrase) return "";
  if (phrase.includes("nutrition") || phrase.includes("meal")) {
    return "provision";
  }
  if (
    phrase.includes("planner item") ||
    phrase.includes("to-do") ||
    phrase.includes("task")
  ) {
    return "visible work";
  }
  if (phrase.includes("journal")) return "truthful record";
  return "";
}

function personalSeasoning(
  memoryBrief: UserMemoryBrief | null | undefined,
  mode: "opening" | "drift" | "strength",
) {
  const domain = firstMemoryDomain(memoryBrief);
  const hasMemory = domain || (memoryBrief?.anchorLabels.length ?? 0) > 0 ||
    (memoryBrief?.tensionLabels.length ?? 0) > 0;
  if (!hasMemory) return null;
  if (mode === "opening") {
    return "Let this meet the life already in motion. Receive it quietly; make the first mark without performance.";
  }
  if (mode === "drift") {
    return domain
      ? `The ${domain} is already known; give it one clean enforcement.`
      : "The pattern is already known; give it one clean enforcement.";
  }
  return domain
    ? `The ${domain} is worth protecting because it is already becoming a pattern.`
    : "The working pattern is worth protecting before anything new is added.";
}

function evidenceShapedAction(
  fallback: string,
  mode: "drift" | "strength",
  memoryBrief: UserMemoryBrief | null | undefined,
) {
  const phrase = firstMemoryPhrase(memoryBrief);
  if (!phrase) return fallback;

  if (phrase.includes("nutrition") || phrase.includes("meal")) {
    if (mode === "drift") {
      return "complete one nutrition check today";
    }
    return "protect the nutrition rhythm before adding another demand";
  }

  if (
    phrase.includes("planner item") ||
    phrase.includes("to-do") ||
    phrase.includes("task")
  ) {
    if (mode === "drift") {
      return "finish or resize one visible task so the line closes cleanly";
    }
    return "protect the finished-task rhythm before expanding the list";
  }

  if (phrase.includes("journal")) {
    if (mode === "drift") {
      return "turn the honest note into one small return";
    }
    return "protect the truthful note by repeating one visible act";
  }

  return fallback;
}

function ledgerShapedAction(
  snapshot: MaatDimensionSnapshot,
  fallback: string,
  mode: "drift" | "strength",
  memoryBrief: UserMemoryBrief | null | undefined,
) {
  const ledgerAction = normalizeText(
    snapshot.source.ledger?.suggested_restoration?.action,
  );
  if (mode === "drift" && ledgerAction) return ledgerAction;
  return evidenceShapedAction(fallback, mode, memoryBrief);
}

function evidenceDensityForSnapshot(snapshot: MaatDimensionSnapshot) {
  const count = snapshot.source.planner_total + snapshot.source.days_active;
  if (count >= 8 || snapshot.source.details_coverage >= 0.7) return "high";
  if (count >= 3 || snapshot.source.details_coverage >= 0.35) return "medium";
  return "low";
}

function confidenceForSnapshot(snapshot: MaatDimensionSnapshot) {
  if (snapshot.hardGates.length > 0) return "high";
  if (snapshot.source.days_active >= 3 || snapshot.source.planner_total >= 5) {
    return "medium";
  }
  return "low";
}

function ledgerEvidenceLine(snapshot: MaatDimensionSnapshot) {
  const restoration = snapshot.source.ledger?.suggested_restoration;
  if (!restoration) return "";
  if (restoration.field === "provision") {
    return "Provision needs one gentle return.";
  }
  if (restoration.field === "visible_work") {
    return "The work needs one clean edge.";
  }
  if (restoration.field === "truthful_record") {
    return "The record needs one trustworthy point.";
  }
  return restoration.user_facing_evidence;
}

function guidanceMeaning(params: {
  snapshot: MaatDimensionSnapshot;
  axisLabel: string;
  primaryAction: string;
  triggerReason: string;
  mode: "drift" | "strength";
  window: GuidanceWindow;
  situation?: MaatSituationInterpretation | null;
}): ControlledMeaningLayer {
  if (params.situation) {
    const renderContract = params.situation.renderContract;
    return {
      dominantField: params.situation.field,
      humanLabel: params.situation.humanLabel,
      whyThisFieldWon:
        `${params.situation.key} matched the current ledger pattern.`,
      userFacingEvidenceLine: params.situation.userFacingDiagnosis,
      caseKey: params.situation.key,
      maatMeaning: params.situation.maatMeaning,
      userTranslation: params.situation.userTranslation,
      likelyUserCondition: params.situation.likelyUserCondition,
      selectedOffering: params.situation.selectedOffering,
      whyThisOfferingWon: params.situation.whyThisOfferingWon,
      userFacingDiagnosis: renderContract.diagnosis,
      evidenceDensity: params.situation.evidenceDensity,
      confidence: params.situation.confidence,
      rhetoricalFrame: params.mode === "strength"
        ? "witness and protect what is working"
        : "case diagnosis before correction",
      decanOrDayAnchor: params.window.decanTheme ?? params.window.decanName,
      specificAction: renderContract.concreteAction,
      bannedTerms: [
        ...DEFAULT_OUTPUT_BANNED_PHRASES,
        ...params.situation.forbiddenGenericPhrases,
      ],
      baselineDeviation: params.situation.baselineDeviation,
      voiceDirection: params.situation.voiceDirection,
      resolutionCondition: params.situation.resolutionCondition,
      exampleReference: params.situation.exampleReference,
      offeringRender: {
        diagnosis: renderContract.diagnosis,
        concreteAction: renderContract.concreteAction,
        caseConcreteAction: renderContract.caseConcreteAction,
        offeringRationale: renderContract.offeringRationale,
        exampleId: renderContract.exampleId,
        exampleNudge: renderContract.exampleNudge,
        exampleReflection: renderContract.exampleReflection,
        voiceDirection: renderContract.voiceDirection,
        bannedPhrases: renderContract.bannedPhrases,
      },
    };
  }
  const restoration = params.snapshot.source.ledger?.suggested_restoration;
  if (params.triggerReason === "decan_day_5_insufficient_signal") {
    return {
      dominantField: "truthful_record",
      humanLabel: "honest record",
      whyThisFieldWon:
        "The system does not have enough record to weigh a specific pattern.",
      userFacingEvidenceLine: "The record is thin right now.",
      evidenceDensity: "low",
      confidence: "low",
      rhetoricalFrame: "inquire before correcting",
      decanOrDayAnchor: params.window.decanTheme ?? params.window.decanName,
      specificAction:
        "Make one plain mark today so the next guidance has something true to stand on.",
      bannedTerms: DEFAULT_OUTPUT_BANNED_PHRASES,
    };
  }
  const humanLabel = restoration?.human_label ??
    stripAxisJargon(params.axisLabel);
  const evidenceLine = params.mode === "strength"
    ? `The ${humanLabel} is holding.`
    : ledgerEvidenceLine(params.snapshot) ||
      `The ${humanLabel} needs one clear mark.`;
  return {
    dominantField: restoration?.field ?? null,
    humanLabel,
    whyThisFieldWon: restoration
      ? `${restoration.field} carried the clearest unresolved signal.`
      : "The current axis carried the clearest signal.",
    userFacingEvidenceLine: evidenceLine,
    evidenceDensity: evidenceDensityForSnapshot(params.snapshot),
    confidence: confidenceForSnapshot(params.snapshot),
    rhetoricalFrame: params.mode === "strength"
      ? "witness and protect what is working"
      : "small correction without shame",
    decanOrDayAnchor: params.window.decanTheme ?? params.window.decanName,
    specificAction: restoration?.action ?? params.primaryAction,
    bannedTerms: DEFAULT_OUTPUT_BANNED_PHRASES,
  };
}

function stripAxisJargon(label: string) {
  const text = normalizeText(label).toLowerCase();
  if (!text) return "the pattern";
  if (text.includes("truth")) return "honest record";
  if (text.includes("measure")) return "measure";
  if (text.includes("life")) return "body support";
  if (text.includes("vulnerable")) return "care";
  if (text.includes("justice")) return "fair measure";
  if (text.includes("provision")) return "body support";
  if (text.includes("ecological") || text.includes("seasonal")) {
    return "daily rhythm";
  }
  if (text.includes("restraint")) return "restraint";
  if (text.includes("cohesion")) return "cohesion";
  return text;
}

function openingPrimaryAction(
  dayCard: DayCardGuidanceInput | null | undefined,
  fallback: string,
) {
  return normalizeText(dayCard?.decanDayAction) || fallback;
}

function openingEvidenceAnchors(params: {
  decanContext?: { detailDescription?: string | null } | null;
  dayLine?: string | null;
}) {
  const anchors = [];
  const context = sentence(params.decanContext?.detailDescription)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)[0] ?? "";
  if (context) {
    anchors.push({
      id: "decan_context_1",
      sourceType: "decan_context" as const,
      claim: context,
      confidence: 0.9,
      allowedInferenceLevel: "paraphrase" as const,
      required: true,
    });
  }
  const dayLine = sentence(params.dayLine);
  if (dayLine) {
    anchors.push({
      id: "day_card_1",
      sourceType: "day_card" as const,
      claim: dayLine,
      confidence: 0.9,
      allowedInferenceLevel: "paraphrase" as const,
      required: true,
    });
  }
  return anchors;
}

function outputControlPayloadFields(
  output: ReturnType<typeof buildControlledOutput>,
) {
  return {
    output_control_policy_version: OUTPUT_CONTROL_POLICY_VERSION,
    output_control: outputControlPayload(output),
    surface_variants: outputSurfaceVariantsPayload(output.surfaceVariants),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function destinationFromPayload(
  payload: Record<string, unknown>,
): CompiledOutputDestination | null {
  const destination = isRecord(payload.destination)
    ? payload.destination
    : null;
  const type = typeof destination?.type === "string"
    ? destination.type.trim()
    : "";
  const ref = typeof destination?.ref === "string"
    ? destination.ref.trim()
    : "";
  if (!type || !ref || type === "none") return null;
  return {
    type,
    ref,
    label: typeof destination?.label === "string" ? destination.label : null,
    reason: typeof destination?.reason === "string" ? destination.reason : null,
    source: typeof destination?.source === "string" ? destination.source : null,
    confidence: typeof destination?.confidence === "number"
      ? destination.confidence
      : null,
    fallback: isRecord(destination?.fallback) ? destination.fallback : null,
  };
}

function controlledOutputCompilerArtifacts(params: {
  output: ReturnType<typeof buildControlledOutput>;
  surface: "opening";
  renderer: string;
  modelVersion: string;
  ctaType: GuidanceCtaType;
  ctaRef: string | null;
  destination?: CompiledOutputDestination | null;
  ctaLabel?: string | null;
  ctaReason?: string | null;
  ctaSource?: string | null;
}) {
  const outputControl = outputControlPayload(params.output);
  const grade = outputControl.grade && typeof outputControl.grade === "object"
    ? outputControl.grade as Record<string, unknown>
    : null;
  const compiler = buildOutputCompilerTrace({
    surface: params.surface,
    renderer: params.renderer,
    modelVersion: params.modelVersion,
    status: "compiled",
    deliveryRecommendation: "in_app_card",
    caseKey: params.output.plan.meaning?.caseKey ?? null,
    offering: params.output.plan.meaning?.selectedOffering ?? null,
    exampleId: params.output.plan.meaning?.exampleReference?.id ?? null,
    exampleAvailable: Boolean(params.output.plan.meaning?.exampleReference),
    diagnosis: params.output.plan.meaning?.offeringRender?.diagnosis ??
      params.output.plan.meaning?.userFacingDiagnosis ?? null,
    concreteAction: params.output.plan.meaning?.offeringRender
      ?.concreteAction ??
      params.output.plan.meaning?.specificAction ??
      params.output.plan.primaryAction,
    evidenceAnchorCount: params.output.plan.evidenceAnchors.length,
    finalText: params.output.surfaceVariants.bodyText,
    teaserText: params.output.surfaceVariants.teaserText,
    pushText: params.output.surfaceVariants.pushExcerptText,
    validation: params.output.validation as unknown as Record<string, unknown>,
    grade,
  });
  return {
    outputControl,
    compiler,
    package: buildCompiledOutputPackage({
      surface: params.surface,
      finalText: params.output.surfaceVariants.bodyText,
      teaserText: params.output.surfaceVariants.teaserText,
      pushText: params.output.surfaceVariants.pushExcerptText,
      archivePreviewText: params.output.surfaceVariants.archivePreviewText,
      ctaType: params.ctaType,
      ctaRef: params.ctaRef,
      ctaLabel: params.ctaLabel,
      ctaReason: params.ctaReason,
      ctaSource: params.ctaSource,
      destination: params.destination,
      compiler,
    }),
  };
}

function clampText(value: string, maxChars: number) {
  const clean = normalizeText(value);
  if (!Number.isFinite(maxChars) || clean.length <= maxChars) return clean;
  const sliced = clean.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  return `${sliced}…`;
}

function compactBody(value: string) {
  return value
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n\n");
}

function firstSentence(value: string) {
  const clean = normalizeText(value);
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return match?.[1]?.trim() || clean;
}

function allowLlmMaatRuntime() {
  try {
    return normalizeText(Deno.env.get("ALLOW_LLM_MAAT_RUNTIME"))
      .toLowerCase() === "true";
  } catch {
    return false;
  }
}

function payloadOutputControlPlan(
  draft: GuidanceDraft,
): ControlledOutputPlan | null {
  const outputControl = draft.payload.output_control as
    | { plan?: unknown }
    | undefined;
  const plan = outputControl?.plan;
  if (!plan || typeof plan !== "object") return null;
  return plan as ControlledOutputPlan;
}

function nudgeRendererPayload(params: {
  attempted: boolean;
  renderer: "deterministic" | "anthropic" | "deterministic_spectrum";
  modelVersion: string;
  fallbackReason?: string | null;
  error?: string | null;
  validation?: Record<string, unknown> | null;
  grade?: Record<string, unknown> | null;
}) {
  return {
    nudge_renderer_version: "maat_nudge_llm_renderer_v1",
    attempted: params.attempted,
    renderer: params.renderer,
    model_version: params.modelVersion,
    fallback_reason: params.fallbackReason ?? null,
    error: params.error ?? null,
    validation: params.validation ?? null,
    grade: params.grade ?? null,
  };
}

type NudgeRendererPayload = ReturnType<typeof nudgeRendererPayload>;

function nudgeCompilerArtifacts(params: {
  draft: GuidanceDraft;
  renderer: NudgeRendererPayload;
  status?: "compiled" | "fallback";
  finalText?: string | null;
  surfaceVariants?: ControlledSurfaceVariants | null;
  validation?: Record<string, unknown> | null;
  grade?: Record<string, unknown> | null;
  prompt?: { systemPrompt: string; userPrompt: string } | null;
}): { compiler: OutputCompilerTrace; package: CompiledOutputPackage } {
  const plan = payloadOutputControlPlan(params.draft);
  const contract = plan?.meaning?.offeringRender;
  const compiler = buildOutputCompilerTrace({
    surface: "nudge",
    renderer: params.renderer.renderer,
    modelVersion: params.renderer.model_version,
    status: params.status,
    fallbackReason: params.renderer.fallback_reason,
    deliveryRecommendation: "in_app_card",
    caseKey: plan?.meaning?.caseKey ?? null,
    offering: plan?.meaning?.selectedOffering ?? null,
    exampleId: contract?.exampleId ?? plan?.meaning?.exampleReference?.id ??
      null,
    exampleAvailable: Boolean(contract?.exampleNudge),
    diagnosis: contract?.diagnosis ?? plan?.meaning?.userFacingDiagnosis ??
      null,
    concreteAction: contract?.concreteAction ??
      plan?.meaning?.specificAction ?? null,
    evidenceAnchorCount: plan?.evidenceAnchors.length ?? 0,
    finalText: params.finalText ?? params.draft.bodyText,
    teaserText: params.surfaceVariants?.teaserText ?? params.draft.teaserText,
    pushText: params.surfaceVariants?.pushExcerptText ??
      params.draft.teaserText,
    systemPrompt: params.prompt?.systemPrompt,
    userPrompt: params.prompt?.userPrompt,
    validation: params.validation ?? params.renderer.validation ?? null,
    grade: params.grade ?? params.renderer.grade ?? null,
  });
  return {
    compiler,
    package: buildCompiledOutputPackage({
      surface: "nudge",
      finalText: compiler.final_text,
      teaserText: compiler.teaser_text,
      pushText: compiler.push_text,
      archivePreviewText: params.surfaceVariants?.archivePreviewText ?? null,
      ctaType: params.draft.ctaType,
      ctaRef: params.draft.ctaRef,
      ctaLabel: typeof params.draft.payload.cta_label === "string"
        ? params.draft.payload.cta_label
        : null,
      ctaReason: typeof params.draft.payload.cta_reason === "string"
        ? params.draft.payload.cta_reason
        : null,
      ctaSource: typeof params.draft.payload.destination_source === "string"
        ? params.draft.payload.destination_source
        : null,
      destination: destinationFromPayload(params.draft.payload),
      compiler,
    }),
  };
}

const DEFAULT_ANTHROPIC_NUDGE_MODEL = "claude-sonnet-4-20250514";

function annotateNudgeRenderer(
  draft: GuidanceDraft,
  renderer: NudgeRendererPayload,
): GuidanceDraft {
  const compiled = nudgeCompilerArtifacts({ draft, renderer });
  const fallback = compiled.compiler.fallback_used;
  return {
    ...draft,
    ctaType: draft.ctaType,
    ctaRef: draft.ctaRef,
    payload: {
      ...draft.payload,
      ...(fallback
        ? {
          delivery_channel: "archive_only",
          cta_type: draft.ctaType,
          cta_ref: draft.ctaRef,
        }
        : {}),
      nudge_renderer: renderer,
      output_compiler: compiled.compiler,
      compiled_output_package: compiled.package,
    },
  };
}

function deterministicSpectrumSurfaceVariants(
  response: DeterministicMaatFlowResponse,
  constraints: ControlledSurfaceConstraints,
): ControlledSurfaceVariants {
  const bodyText = compactBody(response.body);
  const teaserBase = response.badgeBody || firstSentence(bodyText);
  return {
    teaserText: clampText(teaserBase, constraints.teaserCharsMax),
    bodyText,
    pushExcerptText: clampText(
      firstSentence(response.badgeBody || bodyText),
      constraints.pushExcerptCharsMax,
    ),
    archivePreviewText: clampText(bodyText, constraints.archivePreviewCharsMax),
  };
}

function applyMaatFlowSpectrumNudgeDraft(
  draft: GuidanceDraft,
  response: DeterministicMaatFlowResponse,
): GuidanceDraft {
  const plan = payloadOutputControlPlan(draft);
  const constraints = plan?.surfaceConstraints ??
    guidanceSurfaceConstraints(draft.kind);
  const surfaceVariants = deterministicSpectrumSurfaceVariants(
    response,
    constraints,
  );
  const renderer = nudgeRendererPayload({
    attempted: false,
    renderer: "deterministic_spectrum",
    modelVersion: "deterministic_spectrum",
    validation: {
      ok: true,
      source: response.source,
      used_llm: response.usedLlm,
    },
    grade: {
      pass: true,
      source: response.source,
    },
  });
  const compiled = nudgeCompilerArtifacts({
    draft,
    renderer,
    status: "compiled",
    finalText: surfaceVariants.bodyText,
    surfaceVariants,
    validation: renderer.validation ?? null,
    grade: renderer.grade ?? null,
  });
  return {
    ...draft,
    teaserText: surfaceVariants.teaserText,
    bodyText: surfaceVariants.bodyText,
    payload: {
      ...draft.payload,
      surface_variants: outputSurfaceVariantsPayload(surfaceVariants),
      nudge_renderer: renderer,
      maat_flow_response: response,
      maat_flow_response_renderer: maatFlowResponseRendererMetadata(response),
      output_compiler: compiled.compiler,
      compiled_output_package: compiled.package,
      output_control: {
        ...(isRecord(draft.payload.output_control)
          ? draft.payload.output_control
          : {}),
        spectrum_render: {
          responseKind: response.responseKind,
          source: response.source,
          usedLlm: response.usedLlm,
          confidence: response.confidence,
          selectedTier: response.selectedSeed.tier,
        },
      },
    },
  };
}

function applyMaatFlowSpectrumOpeningDraft(
  draft: GuidanceDraft,
  response: DeterministicMaatFlowResponse,
): GuidanceDraft {
  const constraints = guidanceSurfaceConstraints("decan_opening");
  const surfaceVariants = deterministicSpectrumSurfaceVariants(
    response,
    constraints,
  );
  const compiler = buildOutputCompilerTrace({
    surface: "opening",
    renderer: "deterministic_spectrum",
    modelVersion: "deterministic_spectrum",
    status: "compiled",
    deliveryRecommendation: "in_app_card",
    caseKey: null,
    offering: null,
    exampleAvailable: false,
    diagnosis: null,
    concreteAction: null,
    evidenceAnchorCount: 0,
    finalText: surfaceVariants.bodyText,
    teaserText: surfaceVariants.teaserText,
    pushText: surfaceVariants.pushExcerptText,
    validation: {
      ok: true,
      source: response.source,
      used_llm: response.usedLlm,
    },
    grade: {
      pass: true,
      source: response.source,
    },
  });
  const compiledPackage = buildCompiledOutputPackage({
    surface: "opening",
    finalText: compiler.final_text,
    teaserText: compiler.teaser_text,
    pushText: compiler.push_text,
    archivePreviewText: surfaceVariants.archivePreviewText,
    ctaType: draft.ctaType,
    ctaRef: draft.ctaRef,
    ctaLabel: typeof draft.payload.cta_label === "string"
      ? draft.payload.cta_label
      : null,
    ctaReason: typeof draft.payload.cta_reason === "string"
      ? draft.payload.cta_reason
      : null,
    ctaSource: typeof draft.payload.destination_source === "string"
      ? draft.payload.destination_source
      : null,
    destination: destinationFromPayload(draft.payload),
    compiler,
  });
  return {
    ...draft,
    teaserText: surfaceVariants.teaserText,
    bodyText: surfaceVariants.bodyText,
    payload: {
      ...draft.payload,
      surface_variants: outputSurfaceVariantsPayload(surfaceVariants),
      maat_flow_response: response,
      maat_flow_response_renderer: maatFlowResponseRendererMetadata(response),
      output_compiler: compiler,
      compiled_output_package: compiledPackage,
      output_control: {
        ...(isRecord(draft.payload.output_control)
          ? draft.payload.output_control
          : {}),
        spectrum_render: {
          responseKind: response.responseKind,
          source: response.source,
          usedLlm: response.usedLlm,
          confidence: response.confidence,
          selectedTier: response.selectedSeed.tier,
        },
      },
    },
  };
}

async function defaultAnthropicNudgeRenderer(params: {
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
  model: string;
}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 260,
      temperature: 0.35,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userPrompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${detail}`);
  }
  const data = await res.json();
  return {
    text: String(data?.content?.[0]?.text ?? "").trim(),
    modelUsed: String(data?.model ?? params.model),
  };
}

function nudgePromptForPlan(plan: ControlledOutputPlan) {
  const contract = plan.meaning?.offeringRender;
  if (!contract) return null;
  const evidenceLines = plan.evidenceAnchors
    .map((anchor) => `- ${anchor.claim}`)
    .join("\n") || "- No literal anchor available; stay with the diagnosis.";
  const banned = [
    ...plan.surfaceConstraints.bannedPhrases,
    ...(contract.bannedPhrases ?? []),
  ].filter(Boolean);
  const example = contract.exampleNudge ||
    plan.meaning?.exampleReference?.nudge;
  const systemPrompt =
    "You write one concise Ma'at guidance nudge. Return only the nudge body. No bullets, metadata, labels, or title.";
  const userPrompt =
    `Use this contract exactly, but write natural elevated prose.

SURFACE: ${plan.kind}
CASE: ${plan.meaning?.caseKey ?? contract.exampleId ?? "unknown"}
OFFERING: ${plan.meaning?.selectedOffering ?? "unknown"}
DIAGNOSIS: ${contract.diagnosis}
CONCRETE ACTION: ${contract.concreteAction}
VOICE: ${contract.voiceDirection?.register ?? "practical"}; lead with ${
      contract.voiceDirection?.leadWith ?? "situation"
    }; close with ${contract.voiceDirection?.closeWith ?? "principle"}
SENTENCE BUDGET: 2-4 sentences

EVIDENCE ANCHORS:
${evidenceLines}

BANNED PHRASES:
${banned.join(", ")}

TARGET QUALITY EXAMPLE:
${
      example ??
        "Name the specific situation, explain the mechanism, give one concrete action, and close with a case-specific principle."
    }

Rules:
- Do not copy the example.
- Use the example only for rhythm, specificity, and register.
- Lead with the specific situation using the evidence anchors when they are useful.
- Do not recite all evidence. Interpret it.
- End with a principle specific to this case, not a generic Ma'at phrase.
- Do not imply laziness, weakness, failure, or judgment.
- Do not embed CTA routing language such as "open the suggested flow."
- Keep the nudge compact enough for an in-app card.`;
  return { systemPrompt, userPrompt };
}

function validateLlmNudgeText(plan: ControlledOutputPlan, text: string) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clean = compactBody(text);
  if (!clean) errors.push("missing_llm_nudge_text");
  const lower = clean.toLowerCase();
  const contract = plan.meaning?.offeringRender;
  const banned = [
    ...plan.surfaceConstraints.bannedPhrases,
    ...(contract?.bannedPhrases ?? []),
  ];
  for (const phrase of banned) {
    const normalized = normalizeText(phrase).toLowerCase();
    if (normalized && lower.includes(normalized)) {
      errors.push(`banned_phrase:${normalized}`);
    }
  }
  const sentenceCount = (clean.match(/[.!?](?:\s|$)/g) ?? []).length ||
    (clean ? 1 : 0);
  if (sentenceCount > 4) warnings.push("sentence_count_above_llm_target");
  if (
    /\b(not a judgment|not a verdict|not a scolding|failure|lazy|laziness)\b/i
      .test(clean)
  ) {
    errors.push("dignity_language_violation");
  }
  if (/\bopen the suggested flow\b/i.test(clean)) {
    errors.push("cta_embedded_in_body");
  }
  if (clean.length > 900) warnings.push("body_length_high");
  return { ok: errors.length === 0, errors, warnings };
}

export async function renderGuidanceDraftWithLlm(
  draft: GuidanceDraft,
  options: NudgeLlmRenderOptions = {},
): Promise<GuidanceDraft> {
  if (draft.kind !== "drift_nudge" && draft.kind !== "strength_nudge") {
    return draft;
  }
  const spectrumRenderer = isRecord(draft.payload.maat_flow_response_renderer)
    ? draft.payload.maat_flow_response_renderer
    : null;
  if (spectrumRenderer?.renderer === "deterministic_spectrum") {
    return draft;
  }
  const maatFlowPattern = isRecord(draft.payload.maat_flow_decan_pattern)
    ? draft.payload.maat_flow_decan_pattern
    : null;
  if (
    Array.isArray(maatFlowPattern?.flowSignals) &&
    maatFlowPattern.flowSignals.length > 0 &&
    !allowLlmMaatRuntime()
  ) {
    return annotateNudgeRenderer(
      draft,
      nudgeRendererPayload({
        attempted: false,
        renderer: "deterministic",
        modelVersion: "deterministic",
        fallbackReason: "maat_flow_runtime_llm_guard",
      }),
    );
  }
  if (options.enabled === false) {
    return annotateNudgeRenderer(
      draft,
      nudgeRendererPayload({
        attempted: false,
        renderer: "deterministic",
        modelVersion: "deterministic",
        fallbackReason: "disabled",
      }),
    );
  }

  const plan = payloadOutputControlPlan(draft);
  if (!plan?.meaning?.offeringRender) {
    return annotateNudgeRenderer(
      draft,
      nudgeRendererPayload({
        attempted: false,
        renderer: "deterministic",
        modelVersion: "deterministic",
        fallbackReason: "missing_render_contract",
      }),
    );
  }

  const prompt = nudgePromptForPlan(plan);
  if (!prompt) {
    return annotateNudgeRenderer(
      draft,
      nudgeRendererPayload({
        attempted: false,
        renderer: "deterministic",
        modelVersion: "deterministic",
        fallbackReason: "missing_prompt_contract",
      }),
    );
  }

  const apiKey = options.renderer
    ? options.apiKey
    : options.apiKey ?? Deno.env.get("ANTHROPIC_API_KEY");
  const model = options.renderer
    ? options.model ?? DEFAULT_ANTHROPIC_NUDGE_MODEL
    : options.model ?? Deno.env.get("ANTHROPIC_NUDGE_MODEL") ??
      Deno.env.get("ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_NUDGE_MODEL;
  if (!options.renderer && !apiKey) {
    return annotateNudgeRenderer(
      draft,
      nudgeRendererPayload({
        attempted: false,
        renderer: "deterministic",
        modelVersion: "deterministic",
        fallbackReason: "missing_anthropic_key",
      }),
    );
  }

  try {
    const result = options.renderer
      ? await options.renderer(prompt)
      : await defaultAnthropicNudgeRenderer({
        ...prompt,
        apiKey: apiKey!,
        model,
      });
    const bodyText = compactBody(result.text);
    const llmValidation = validateLlmNudgeText(plan, bodyText);
    if (!llmValidation.ok) {
      return annotateNudgeRenderer(
        draft,
        nudgeRendererPayload({
          attempted: true,
          renderer: "anthropic",
          modelVersion: result.modelUsed ?? model,
          fallbackReason: "llm_validation_failed",
          validation: llmValidation,
        }),
      );
    }

    const surfaceVariants: ControlledSurfaceVariants = {
      teaserText: clampText(
        firstSentence(bodyText),
        plan.surfaceConstraints.teaserCharsMax,
      ),
      bodyText,
      pushExcerptText: clampText(
        firstSentence(bodyText),
        plan.surfaceConstraints.pushExcerptCharsMax,
      ),
      archivePreviewText: clampText(
        bodyText,
        plan.surfaceConstraints.archivePreviewCharsMax,
      ),
    };
    const surfaceValidation = validateSurfaceVariants(plan, surfaceVariants);
    const grade = gradeOutputTextAgainstPolicy({
      surface: plan.kind,
      speechAct: plan.speechAct,
      text: bodyText,
      teaserText: surfaceVariants.teaserText,
      evidenceAnchors: plan.evidenceAnchors,
      primaryAction: plan.meaning?.specificAction ?? plan.primaryAction,
      validation: llmValidation,
    });
    const renderer = nudgeRendererPayload({
      attempted: true,
      renderer: "anthropic",
      modelVersion: result.modelUsed ?? model,
      validation: {
        ...llmValidation,
        surface_validation: surfaceValidation,
      },
      grade,
    });
    const compiled = nudgeCompilerArtifacts({
      draft,
      renderer,
      status: "compiled",
      finalText: bodyText,
      surfaceVariants,
      validation: {
        ...llmValidation,
        surface_validation: surfaceValidation,
      },
      grade,
      prompt,
    });
    return {
      ...draft,
      teaserText: surfaceVariants.teaserText,
      bodyText: surfaceVariants.bodyText,
      payload: {
        ...draft.payload,
        surface_variants: outputSurfaceVariantsPayload(surfaceVariants),
        nudge_renderer: renderer,
        output_compiler: compiled.compiler,
        compiled_output_package: compiled.package,
        output_control: {
          ...(draft.payload.output_control as Record<string, unknown>),
          llm_render: {
            validation: llmValidation,
            surface_validation: surfaceValidation,
            grade,
          },
        },
      },
    };
  } catch (error) {
    return annotateNudgeRenderer(
      draft,
      nudgeRendererPayload({
        attempted: true,
        renderer: "anthropic",
        modelVersion: model,
        fallbackReason: "anthropic_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export function buildDecanOpeningDraft(params: {
  window: GuidanceWindow;
  decanContext?: {
    detailDescription?: string | null;
    monthKey?: string | null;
    monthShort?: string | null;
    decan?: number | null;
    shortName?: string | null;
    displayName?: string | null;
    defaultLabel?: string | null;
  } | null;
  dayCard?: DayCardGuidanceInput | null;
  matrix?: ReflectionDecisionMatrixV1 | null;
  snapshot: MaatDimensionSnapshot;
  memoryBrief?: UserMemoryBrief | null;
  maatFlowPattern?: MaatFlowDecanPatternSynthesis | null;
}): GuidanceDraft {
  const leadAxis = params.snapshot.decanPrimaryAxes[0] ??
    params.snapshot.leadAxis;
  const axisLabel = AXIS_LABELS[leadAxis];
  const dayLine = dayCardLine(params.dayCard);
  const nextStep = openingPrimaryAction(
    params.dayCard,
    AXIS_NEXT_STEP[leadAxis],
  );
  const destination = resolveMaatOpeningDestination({
    leadAxis,
    decanName: params.window.decanName,
    decanTheme: params.window.decanTheme ?? null,
    decanContext: params.decanContext?.detailDescription ?? null,
    dayCard: params.dayCard ?? null,
  });
  const nodeRef = destination.fallback?.ctaRef ??
    destinationFirstNodeForAxis(leadAxis);
  const contextSentence = sentence(params.decanContext?.detailDescription)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)[0] ?? "";
  const output = buildControlledOutput({
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    constitutionVersion: MAAT_CONSTITUTION_VERSION,
    northStar: MAAT_OUTPUT_NORTH_STAR,
    forcePrinciple: MAAT_OUTPUT_FORCE_PRINCIPLE,
    kind: "decan_opening",
    speechAct: "orient",
    intent: "start_decan_with_one_visible_measure",
    moralFrame: "maat_order_made_practical",
    emotionalTemperature: "low",
    userState: "new_decan_boundary",
    leadAxis,
    leadAxisLabel: axisLabel,
    primaryAction: nextStep,
    evidenceAnchors: openingEvidenceAnchors({
      decanContext: params.decanContext,
      dayLine,
    }),
    rhetoricalMoves: [
      "name_the_frame",
      "ground_in_evidence",
      "offer_one_act",
      "close_with_dignity",
    ],
    detailBudget: "medium",
    surfaceConstraints: guidanceSurfaceConstraints("decan_opening"),
    cta: {
      type: destination.ctaType,
      ref: destination.ctaRef,
      reason: destination.reason,
    },
    context: {
      decanName: params.window.decanName,
      decanShortName: params.decanContext?.shortName ?? null,
      decanTheme: params.window.decanTheme ?? null,
      contextSentence: contextSentence || null,
      dayLine: dayLine || null,
      personalSeasoning: null,
      nodeRef,
      triggerReason: "decan_boundary",
    },
  });
  const compiled = controlledOutputCompilerArtifacts({
    output,
    surface: "opening",
    renderer: "controlled_output",
    modelVersion: "controlled-output-v1",
    ctaType: destination.ctaType,
    ctaRef: destination.ctaRef,
    ctaLabel: destination.ctaLabel,
    ctaReason: destination.destinationReason,
    ctaSource: destination.source,
    destination: compiledDestinationForPackage(destination),
  });
  const spectrumOrientation = params.maatFlowPattern
    ? renderMaatFlowResponse(params.maatFlowPattern, "orientation", {
      decanName: params.window.decanName,
      decanTheme: params.window.decanTheme ?? null,
      decanContextKey: params.window.decanContextKey ?? null,
    })
    : null;

  const draft: GuidanceDraft = {
    kind: "decan_opening",
    priority: guidancePriority("decan_opening"),
    teaserText: compiled.package.teaser_text ??
      output.surfaceVariants.teaserText,
    bodyText: compiled.package.final_text,
    payload: {
      lead_axis: leadAxis,
      band: params.snapshot.band,
      reflection_move: params.snapshot.reflectionMove,
      hard_gates: params.snapshot.hardGates,
      decision_matrix_fingerprint: null,
      delivery_track: DECAN_CONTEXT_OPENING_TRACK,
      notification_track: DECAN_CONTEXT_OPENING_TRACK,
      content_source: DECAN_CONTEXT_OPENING_SOURCE,
      profile_personalization_used: false,
      source_scope: "calendar_context_only",
      decan_context_key: params.window.decanContextKey ?? null,
      month_key: params.decanContext?.monthKey ?? null,
      month_short: params.decanContext?.monthShort ?? null,
      decan_number: params.decanContext?.decan ?? null,
      decan_short_name: params.decanContext?.shortName ?? null,
      decan_display_name: params.decanContext?.displayName ?? null,
      decan_label: params.decanContext?.defaultLabel ?? null,
      day_card_date: params.dayCard?.date ?? null,
      node_ref: nodeRef,
      ...destinationPayload(destination),
      memory_context_quality: null,
      memory_anchor_labels: [],
      memory_evidence_phrases: [],
      output_control_policy_version: OUTPUT_CONTROL_POLICY_VERSION,
      output_control: compiled.outputControl,
      surface_variants: outputSurfaceVariantsPayload(output.surfaceVariants),
      output_compiler: compiled.compiler,
      compiled_output_package: compiled.package,
      ...maatFlowPatternPayload(params.maatFlowPattern),
    },
    ctaType: destination.ctaType,
    ctaRef: destination.ctaRef,
    triggerReason: "decan_boundary",
  };
  return spectrumOrientation
    ? applyMaatFlowSpectrumOpeningDraft(draft, spectrumOrientation)
    : draft;
}

type GuidanceCtaResolution = {
  ctaType: GuidanceCtaType;
  ctaRef: string | null;
  reason: string;
  brief?: MaatFlowBrief | null;
};

type GuidanceDestinationResolution = MaatDestinationResolution & {
  brief?: MaatFlowBrief | null;
};

export function resolveGuidanceCta(params: {
  snapshot: MaatDimensionSnapshot;
  mode: "drift" | "strength";
  outcomeSignals?: GuidanceCtaOutcomeSignal[];
}): GuidanceCtaResolution {
  const resolved = resolveMaatGuidanceDestination({
    snapshot: params.snapshot,
    mode: params.mode,
    outcomeSignals: params.outcomeSignals,
  });
  return {
    ctaType: resolved.ctaType,
    ctaRef: resolved.ctaRef,
    reason: resolved.reason,
  };
}

function maybePersonalizeFlowCta(params: {
  cta: MaatDestinationResolution;
  snapshot: MaatDimensionSnapshot;
  mode: "drift" | "strength";
  window: GuidanceWindow;
  triggerReason?: string | null;
  maturity?: GuidanceMaturity | null;
  goalProfile?: GuidanceGoalProfile | null;
  personalBaseline?: GuidancePersonalBaseline | null;
  enablePersonalizedFlow?: boolean;
}): GuidanceDestinationResolution {
  if (!params.enablePersonalizedFlow) return params.cta;
  const correctionAxis = params.snapshot.correctionAxes[0] ??
    params.snapshot.leadAxis;
  const careAxisFallback = params.mode === "drift" &&
      correctionAxis === "V" &&
      params.snapshot.hardGates.length === 0
    ? MAAT_FLOW_TEMPLATES.theTending
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
    ...params.cta,
    ctaType: "flow_personalized",
    ctaRef: brief.briefId,
    ctaLabel: "Create this flow",
    destinationType: "flow_personalized",
    destinationRef: brief.briefId,
    destinationLabel: "Create this flow",
    destinationReason: `${params.cta.reason}:personalized_flow`,
    reason: `${params.cta.reason}:personalized_flow`,
    fallback: {
      ctaType: "flow_template",
      ctaRef: fallbackTemplateKey,
      ctaLabel: "Open suggested flow",
    },
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
  maatFlowPattern?: MaatFlowDecanPatternSynthesis | null;
}): GuidanceDraft {
  const correctionAxis = params.snapshot.correctionAxes[0] ??
    params.snapshot.leadAxis;
  const axisLabel = AXIS_LABELS[correctionAxis];
  const nextStep = ledgerShapedAction(
    params.snapshot,
    AXIS_NEXT_STEP[correctionAxis],
    "drift",
    params.memoryBrief,
  );
  const isDayFiveIsfetCadence = params.triggerReason === "decan_day_5_isfet";
  const situation = interpretMaatSituation({
    snapshot: params.snapshot,
    mode: "drift",
    triggerReason: params.triggerReason,
    evidencePhrases: params.memoryBrief?.evidencePhrases ?? [],
    personalBaseline: params.personalBaseline,
  });
  const concreteNextStep = situation.concreteAction || nextStep;
  const meaning = guidanceMeaning({
    snapshot: params.snapshot,
    axisLabel,
    primaryAction: concreteNextStep,
    triggerReason: params.triggerReason,
    mode: "drift",
    window: params.window,
    situation,
  });
  const cta = maybePersonalizeFlowCta({
    cta: resolveMaatGuidanceDestination({
      snapshot: params.snapshot,
      mode: "drift",
      outcomeSignals: isDayFiveIsfetCadence ? undefined : params.outcomeSignals,
    }),
    snapshot: params.snapshot,
    mode: "drift",
    window: params.window,
    triggerReason: params.triggerReason,
    maturity: params.maturity,
    goalProfile: params.goalProfile,
    personalBaseline: params.personalBaseline,
    enablePersonalizedFlow: isDayFiveIsfetCadence
      ? false
      : params.enablePersonalizedFlow,
  });
  const output = buildControlledOutput({
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    constitutionVersion: MAAT_CONSTITUTION_VERSION,
    northStar: MAAT_OUTPUT_NORTH_STAR,
    forcePrinciple: MAAT_OUTPUT_FORCE_PRINCIPLE,
    kind: "drift_nudge",
    speechAct: "correct",
    intent: "restore_order_without_shame",
    moralFrame: "maat_order_over_scatter",
    emotionalTemperature: "low",
    userState: "good_faith_drift",
    leadAxis: correctionAxis,
    leadAxisLabel: axisLabel,
    primaryAction: concreteNextStep,
    evidenceAnchors: memoryAnchorsForOutput(params.memoryBrief, "drift"),
    rhetoricalMoves: [
      "name_the_pattern",
      "ground_in_evidence",
      "interpret_gently",
      "offer_one_act",
      "close_with_dignity",
    ],
    detailBudget: "brief",
    surfaceConstraints: guidanceSurfaceConstraints("drift_nudge"),
    cta: {
      type: cta.ctaType,
      ref: cta.ctaRef,
      reason: cta.reason,
    },
    meaning,
    context: {
      decanName: params.window.decanName,
      decanTheme: params.window.decanTheme ?? null,
      personalSeasoning: personalSeasoning(params.memoryBrief, "drift"),
      triggerReason: params.triggerReason,
    },
  });

  const spectrumAlignment = params.maatFlowPattern
    ? renderMaatFlowResponse(params.maatFlowPattern, "alignment", {
      decanName: params.window.decanName,
      decanTheme: params.window.decanTheme ?? null,
      decanContextKey: params.window.decanContextKey ?? null,
    })
    : null;
  const draft: GuidanceDraft = {
    kind: "drift_nudge",
    priority: guidancePriority("drift_nudge"),
    teaserText: output.surfaceVariants.teaserText,
    bodyText: output.surfaceVariants.bodyText,
    payload: {
      lead_axis: params.snapshot.leadAxis,
      correction_axis: correctionAxis,
      band: params.snapshot.band,
      reflection_move: params.snapshot.reflectionMove,
      hard_gates: params.snapshot.hardGates,
      decision_matrix_fingerprint: params.decisionMatrixFingerprint ?? null,
      decan_context_key: params.window.decanContextKey ?? null,
      cta_reason: cta.reason,
      ...destinationPayload(cta),
      memory_context_quality: params.memoryBrief?.contextQuality ?? null,
      memory_anchor_labels: params.memoryBrief?.anchorLabels ?? [],
      memory_evidence_phrases: params.memoryBrief?.evidencePhrases ?? [],
      ...maatLedgerPayload(params.snapshot.source.ledger),
      ...maatSituationPayload(situation),
      ...outputControlPayloadFields(output),
      ...maatFlowPatternPayload(params.maatFlowPattern),
      ...flowBriefPayload(
        (cta as MaatDestinationResolution & {
          brief?: MaatFlowBrief | null;
        }).brief,
      ),
    },
    ctaType: cta.ctaType,
    ctaRef: cta.ctaRef,
    triggerReason: params.triggerReason,
  };
  return spectrumAlignment
    ? applyMaatFlowSpectrumNudgeDraft(draft, spectrumAlignment)
    : draft;
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
  triggerReason?: string;
  celebrationOnly?: boolean;
  maatFlowPattern?: MaatFlowDecanPatternSynthesis | null;
}): GuidanceDraft {
  const leadAxis = params.snapshot.leadAxis;
  const axisLabel = AXIS_LABELS[leadAxis];
  const triggerReason = params.triggerReason ?? "sustained_maat_signal";
  const nextStep = evidenceShapedAction(
    AXIS_NEXT_STEP[leadAxis],
    "strength",
    params.memoryBrief,
  );
  const situation = interpretMaatSituation({
    snapshot: params.snapshot,
    mode: "strength",
    triggerReason,
    evidencePhrases: params.memoryBrief?.evidencePhrases ?? [],
    personalBaseline: params.personalBaseline,
  });
  const concreteNextStep = situation.concreteAction || nextStep;
  const meaning = guidanceMeaning({
    snapshot: params.snapshot,
    axisLabel,
    primaryAction: concreteNextStep,
    triggerReason,
    mode: "strength",
    window: params.window,
    situation,
  });
  const cta = params.celebrationOnly
    ? noMaatDestination(triggerReason)
    : maybePersonalizeFlowCta({
      cta: resolveMaatGuidanceDestination({
        snapshot: params.snapshot,
        mode: "strength",
        outcomeSignals: params.outcomeSignals,
      }),
      snapshot: params.snapshot,
      mode: "strength",
      window: params.window,
      triggerReason,
      maturity: params.maturity,
      goalProfile: params.goalProfile,
      personalBaseline: params.personalBaseline,
      enablePersonalizedFlow: params.enablePersonalizedFlow,
    });
  const output = buildControlledOutput({
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    constitutionVersion: MAAT_CONSTITUTION_VERSION,
    northStar: MAAT_OUTPUT_NORTH_STAR,
    forcePrinciple: MAAT_OUTPUT_FORCE_PRINCIPLE,
    kind: "strength_nudge",
    speechAct: "fortify",
    intent: "protect_the_pattern_that_is_working",
    moralFrame: "maat_order_preserved_before_expansion",
    emotionalTemperature: "low",
    userState: "stable_pattern",
    leadAxis,
    leadAxisLabel: axisLabel,
    primaryAction: concreteNextStep,
    evidenceAnchors: memoryAnchorsForOutput(params.memoryBrief, "strength"),
    rhetoricalMoves: [
      "name_the_pattern",
      "ground_in_evidence",
      "protect_strength",
      "offer_one_act",
      "close_with_dignity",
    ],
    detailBudget: "brief",
    surfaceConstraints: guidanceSurfaceConstraints("strength_nudge"),
    cta: {
      type: cta.ctaType,
      ref: cta.ctaRef,
      reason: cta.reason,
    },
    meaning,
    context: {
      decanName: params.window.decanName,
      decanTheme: params.window.decanTheme ?? null,
      personalSeasoning: personalSeasoning(params.memoryBrief, "strength"),
      triggerReason,
    },
  });

  const spectrumAlignment = params.maatFlowPattern
    ? renderMaatFlowResponse(params.maatFlowPattern, "alignment", {
      decanName: params.window.decanName,
      decanTheme: params.window.decanTheme ?? null,
      decanContextKey: params.window.decanContextKey ?? null,
    })
    : null;
  const draft: GuidanceDraft = {
    kind: "strength_nudge",
    priority: guidancePriority("strength_nudge"),
    teaserText: output.surfaceVariants.teaserText,
    bodyText: output.surfaceVariants.bodyText,
    payload: {
      lead_axis: leadAxis,
      band: params.snapshot.band,
      reflection_move: params.snapshot.reflectionMove,
      hard_gates: params.snapshot.hardGates,
      decision_matrix_fingerprint: params.decisionMatrixFingerprint ?? null,
      decan_context_key: params.window.decanContextKey ?? null,
      cta_reason: cta.reason,
      ...destinationPayload(cta),
      memory_context_quality: params.memoryBrief?.contextQuality ?? null,
      memory_anchor_labels: params.memoryBrief?.anchorLabels ?? [],
      memory_evidence_phrases: params.memoryBrief?.evidencePhrases ?? [],
      cadence_type: params.celebrationOnly ? "decan_day_5" : null,
      ...maatLedgerPayload(params.snapshot.source.ledger),
      ...maatSituationPayload(situation),
      ...outputControlPayloadFields(output),
      ...maatFlowPatternPayload(params.maatFlowPattern),
      ...flowBriefPayload(
        (cta as MaatDestinationResolution & {
          brief?: MaatFlowBrief | null;
        }).brief,
      ),
    },
    ctaType: cta.ctaType,
    ctaRef: cta.ctaRef,
    triggerReason,
  };
  return spectrumAlignment
    ? applyMaatFlowSpectrumNudgeDraft(draft, spectrumAlignment)
    : draft;
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
  if (!params.openingHandled || params.decanDayIndex < 5) return false;

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

export function shouldCreateDayFiveCadenceNudge(params: {
  current: MaatDimensionSnapshot;
  decanDayIndex: number;
  driftCount: number;
  strengthCount: number;
  dayFiveDeliveryExists?: boolean;
  openCorrectionExists?: boolean;
}): DayFiveCadenceDecision {
  if (params.decanDayIndex !== 5) {
    return {
      create: false,
      mode: null,
      kind: null,
      reason: "not_day_5",
    };
  }
  if (params.dayFiveDeliveryExists) {
    return {
      create: false,
      mode: null,
      kind: null,
      reason: "already_created",
    };
  }

  const isIsfet = params.openCorrectionExists === true ||
    params.current.hardGates.length > 0 ||
    params.current.reflectionMove === "correct" ||
    BAND_RANK[params.current.band] <= BAND_RANK.leaning_isfet;

  if (isIsfet) {
    if (params.driftCount >= 2) {
      return {
        create: false,
        mode: "isfet",
        kind: "drift_nudge",
        reason: "drift_cap_reached",
      };
    }
    return {
      create: true,
      mode: "isfet",
      kind: "drift_nudge",
      reason: "decan_day_5_isfet",
    };
  }

  if (
    params.current.reflectionMove === "inquire" ||
    params.current.band === "mixed"
  ) {
    return {
      create: true,
      mode: "inquire",
      kind: "drift_nudge",
      reason: "decan_day_5_insufficient_signal",
    };
  }

  if (params.strengthCount >= 1) {
    return {
      create: false,
      mode: "maat",
      kind: "strength_nudge",
      reason: "strength_exists",
    };
  }

  return {
    create: true,
    mode: "maat",
    kind: "strength_nudge",
    reason: "decan_day_5_maat",
  };
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
