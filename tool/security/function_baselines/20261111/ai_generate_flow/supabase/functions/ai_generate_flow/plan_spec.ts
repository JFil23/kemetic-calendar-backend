import { sanitizeFlowLocation } from "./generation_hints.ts";
import type {
  FlowFormat,
  RequestedTimeWindow,
  SourceHandlingMode,
} from "./generation_hints.ts";

export type GoalDomain =
  | "learning"
  | "finance"
  | "fitness"
  | "project"
  | "spiritual"
  | "admin"
  | "wellness"
  | "generic";

export type GoalKind = "learning" | "performance";
export type RiskTier = "low" | "medium" | "high";
export type CueType =
  | "clock"
  | "situational"
  | "preceding_event"
  | "place"
  | "social";
export type LearningMode =
  | "spaced_retrieval"
  | "progressive_practice"
  | "feedback"
  | "execution"
  | "review"
  | "reflection";
export type PlannerStrategyKind =
  | "retrieval"
  | "progressive_practice"
  | "automation"
  | "cue_anchored_habit"
  | "project_milestone"
  | "review_loop";
export type FallbackStrictness = "gentle" | "standard" | "strict";

export type PlanGoal = {
  title: string;
  domain: GoalDomain;
  source: "direct" | "source_text" | "mixed";
  goal_type: GoalKind;
  success_definition: string;
  horizon_days: number;
};

export type PlanReadinessProfile = {
  complexity: "low" | "medium" | "high";
  risk_tier: RiskTier;
  schedule_stability: "stable" | "variable";
  stress_load: "low" | "medium" | "high";
  completion_pressure: "low" | "medium" | "high";
  attention_style: "focused" | "scattered" | "unknown";
};

export type PlanStrategy = {
  primary: PlannerStrategyKind;
  supports: string[];
  cue_type: CueType;
  daily_dose: {
    max_actions: number;
    minimum_duration_min: number;
    ramp: "steady" | "conservative" | "progressive";
  };
  fallback_strictness: FallbackStrictness;
  rationale: string[];
};

export type PlanMilestone = {
  milestone_id: string;
  title: string;
  target_day_index: number;
  success_signal: string;
  action_ids: string[];
};

export type ObstaclePlan = {
  if_low_time: string;
  if_distracted: string;
  if_missed: string;
};

export type PlanActionRenderHints = {
  details?: string;
  all_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
};

export type PlanAction = {
  action_id: string;
  title: string;
  definition_of_done: string;
  duration_min: number;
  trigger: string;
  context_anchor: string;
  learning_mode: LearningMode;
  minimum_version: string;
  stretch_version: string;
  obstacle_plan: ObstaclePlan;
  metric_keys: string[];
  evidence_tags: string[];
  risk_tier: RiskTier;
  scheduled_day_index: number;
  render_hints?: PlanActionRenderHints | null;
};

export type PlanMetric = {
  key: string;
  label: string;
  type: "count" | "boolean" | "rating" | "duration_min";
  target: string;
};

export type PlanReviewLoop = {
  cadence: "weekly";
  day_interval: number;
  prompt_questions: string[];
  adjusters: string[];
};

export type PlanSupportLayers = {
  cue_type: CueType;
  environment: string[];
  fallback_strictness: FallbackStrictness;
  accountability: string[];
  downshift_step?: string | null;
};

export type PlanSafetyFlag = {
  code: string;
  severity: "info" | "warning";
  message: string;
};

export type PlanSpecV2 = {
  version: "flowspec_v2";
  goal: PlanGoal;
  readiness_profile: PlanReadinessProfile;
  strategy: PlanStrategy;
  milestones: PlanMilestone[];
  actions: PlanAction[];
  metrics: PlanMetric[];
  review_loop: PlanReviewLoop;
  support_layers: PlanSupportLayers;
  safety_flags: PlanSafetyFlag[];
};

export type PlanBehaviorPayload = {
  action_id: string;
  definition_of_done: string;
  trigger: string;
  context_anchor: string;
  learning_mode: LearningMode;
  minimum_version: string;
  stretch_version: string;
  obstacle_plan: ObstaclePlan;
  metric_keys: string[];
  evidence_tags: string[];
  risk_tier: RiskTier;
};

export type PlanNoteSeed = {
  day_index: number;
  title: string;
  details: string;
  all_day: boolean;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  action_id?: string;
  behavior_payload?: PlanBehaviorPayload | null;
};

export type PlanIntentClassification = {
  domain: GoalDomain;
  source: "direct" | "source_text" | "mixed";
  complexity: "low" | "medium" | "high";
  risk_tier: RiskTier;
  goal_type: GoalKind;
  unstable_schedule: boolean;
  high_stress: boolean;
  scatter_risk: boolean;
};

export type OutcomeVectorLike = {
  completion_ratio?: number | null;
  edit_pressure?: number | null;
};

export type PlanDecisionMatrixV2 = {
  version: "plan_dm_v1";
  strategy_kind: PlannerStrategyKind;
  cue_type: CueType;
  fallback_strictness: FallbackStrictness;
  max_actions_per_day: number;
  minimum_duration_min: number;
  ramp: "steady" | "conservative" | "progressive";
  review_day_interval: number;
  downshift_required: boolean;
  fingerprint: Record<string, unknown>;
};

export type PlanSpecValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  quality_score: number;
  coverage: {
    trigger_coverage: number;
    fallback_coverage: number;
    metric_coverage: number;
    direct_action_ratio: number;
  };
};

function averageOrNull(
  values: Array<number | null | undefined>,
): number | null {
  const filtered = values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function truncateInline(input: string, maxLen: number): string {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = safeTrim(value);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeTimeString(value: unknown): string | null {
  const trimmed = safeTrim(value);
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  const [hourRaw, minuteRaw] = trimmed.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function toBoolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = safeTrim(value).toLowerCase();
  if (["1", "true", "t", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "f", "no", "n"].includes(normalized)) return false;
  return null;
}

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "action";
}

function timeToMinutes(value?: string | null): number | null {
  const raw = safeTrim(value);
  if (!raw || !/^\d{2}:\d{2}$/.test(raw)) return null;
  const [hours, minutes] = raw.split(":").map(Number);
  if (
    !Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 ||
    hours > 23 || minutes < 0 || minutes > 59
  ) {
    return null;
  }
  return (hours * 60) + minutes;
}

function extractSentences(input: string): string[] {
  return input
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractStepLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function inferGoalDomain(
  description: string,
  sourceText: string | undefined,
  flowFormat: FlowFormat,
): GoalDomain {
  const corpus = `${description}\n${sourceText ?? ""}`.toLowerCase();
  if (flowFormat === "FINANCE_PLAN") return "finance";
  if (flowFormat === "PROJECT_PLAN") return "project";
  if (flowFormat === "MEAL_PLAN") return "wellness";
  if (
    /(study|learn|learning|practice|exam|course|class|recall|remember|flashcard|quiz|vocabulary|language|symbol|symbols|medu\s+neter)/i
      .test(corpus)
  ) {
    return "learning";
  }
  if (
    /(fitness|workout|gym|lift|run|training|athletic|mobility|conditioning)/i
      .test(corpus)
  ) {
    return "fitness";
  }
  if (
    /(pray|prayer|meditation|spiritual|ritual|altar|journaling|reflection)/i
      .test(corpus)
  ) {
    return "spiritual";
  }
  if (
    /(admin|paperwork|email|inbox|renewal|filing|document|application)/i.test(
      corpus,
    )
  ) {
    return "admin";
  }
  return "generic";
}

function inferRiskTier(
  description: string,
  sourceText: string | undefined,
  domain: GoalDomain,
): RiskTier {
  const corpus = `${description}\n${sourceText ?? ""}`.toLowerCase();
  if (
    /(panic|suicid|self-harm|injury|injured|medication|mania|trauma)/i.test(
      corpus,
    )
  ) {
    return "high";
  }
  if (
    domain === "finance" ||
    /(loan|debt|mortgage|invest|investment|blood pressure|pain|marathon)/i
      .test(corpus)
  ) {
    return "medium";
  }
  return "low";
}

export function classifyIntent(args: {
  description: string;
  sourceText?: string;
  flowFormat: FlowFormat;
  dateRangeDays: number;
  sourceHandling: SourceHandlingMode;
}): PlanIntentClassification {
  const { description, sourceText, flowFormat, dateRangeDays, sourceHandling } =
    args;
  const corpus = `${description}\n${sourceText ?? ""}`;
  const domain = inferGoalDomain(description, sourceText, flowFormat);
  const risk_tier = inferRiskTier(description, sourceText, domain);
  const goal_type: GoalKind = domain === "learning"
    ? "learning"
    : "performance";
  const unstable_schedule =
    /(shift|variable|irregular|unpredictable|when i can|whenever|not sure when)/i
      .test(corpus);
  const high_stress =
    /(stressed|stress|overwhelm|burnout|anxious|exhausted|low energy)/i.test(
      corpus,
    );
  const scatter_risk =
    /(scatter|scattered|too much|overload|adhd|distract|distracted|avoidance)/i
      .test(corpus) || dateRangeDays > 30;
  const complexity = flowFormat === "PROJECT_PLAN" || flowFormat === "SYNTHESIS"
    ? "high"
    : sourceHandling === "PRESERVE_STRUCTURE" || dateRangeDays > 21
    ? "medium"
    : "low";
  const source = safeTrim(sourceText).length > 0
    ? (description.trim().length > 0 ? "mixed" : "source_text")
    : "direct";

  return {
    domain,
    source,
    complexity,
    risk_tier,
    goal_type,
    unstable_schedule,
    high_stress,
    scatter_risk,
  };
}

export function buildDecisionMatrix(args: {
  classification: PlanIntentClassification;
  requestedTimeWindow?: RequestedTimeWindow | null;
  outcomeVectors?: OutcomeVectorLike[];
  dateRangeDays: number;
}): PlanDecisionMatrixV2 {
  const {
    classification,
    requestedTimeWindow,
    outcomeVectors = [],
    dateRangeDays,
  } = args;

  const avgCompletion = averageOrNull(
    outcomeVectors.map((item) => item.completion_ratio),
  );
  const avgEditPressure = averageOrNull(
    outcomeVectors.map((item) => item.edit_pressure),
  );

  let strategy_kind: PlannerStrategyKind = "cue_anchored_habit";
  if (classification.domain === "learning") strategy_kind = "retrieval";
  else if (classification.domain === "fitness") {
    strategy_kind = "progressive_practice";
  } else if (classification.domain === "finance") {
    strategy_kind = "automation";
  } else if (classification.domain === "project") {
    strategy_kind = "project_milestone";
  } else if (classification.domain === "spiritual") {
    strategy_kind = "review_loop";
  }

  const cue_type: CueType = classification.unstable_schedule
    ? "situational"
    : requestedTimeWindow
    ? "clock"
    : "preceding_event";

  const lowAdherence = avgCompletion != null && avgCompletion < 0.55;
  const highEditPressure = avgEditPressure != null && avgEditPressure >= 0.35;
  const downshift_required = classification.high_stress ||
    lowAdherence ||
    highEditPressure;
  const max_actions_per_day = lowAdherence || classification.scatter_risk
    ? 1
    : classification.complexity === "high"
    ? 2
    : 3;
  const minimum_duration_min = classification.high_stress
    ? 10
    : lowAdherence
    ? 12
    : classification.domain === "fitness"
    ? 20
    : 15;
  const fallback_strictness: FallbackStrictness = classification.risk_tier ===
      "high"
    ? "gentle"
    : classification.domain === "finance" || classification.domain === "fitness"
    ? "standard"
    : "strict";
  const ramp = classification.domain === "fitness" || dateRangeDays > 21
    ? "progressive"
    : downshift_required
    ? "conservative"
    : "steady";

  return {
    version: "plan_dm_v1",
    strategy_kind,
    cue_type,
    fallback_strictness,
    max_actions_per_day,
    minimum_duration_min,
    ramp,
    review_day_interval: Math.min(7, Math.max(3, dateRangeDays)),
    downshift_required,
    fingerprint: {
      v: "plan_dm_v1",
      domain: classification.domain,
      goal_type: classification.goal_type,
      cue_type,
      strategy_kind,
      max_actions_per_day,
      minimum_duration_min,
      fallback_strictness,
      ramp,
    },
  };
}

function defaultContextAnchor(domain: GoalDomain): string {
  switch (domain) {
    case "finance":
      return "open your budget/docs workspace";
    case "fitness":
      return "training space ready";
    case "learning":
      return "study materials open";
    case "project":
      return "project workspace and current deliverable visible";
    case "spiritual":
      return "quiet place with your practice cue visible";
    case "admin":
      return "desk clear and the required document open";
    case "wellness":
      return "kitchen or prep space ready";
    default:
      return "the place where this task normally happens";
  }
}

function defaultDefinitionOfDone(note: PlanNoteSeed): string {
  const stepLines = extractStepLines(note.details);
  if (stepLines.length > 0) {
    const joined = stepLines.slice(0, 2).join(" + ");
    return truncateInline(
      `Finish ${joined} and leave one concrete result.`,
      140,
    );
  }
  const sentences = extractSentences(note.details);
  if (sentences.length > 0) {
    return truncateInline(sentences[0], 140);
  }
  return truncateInline(
    `Complete "${note.title}" and leave one concrete result, decision, or check.`,
    140,
  );
}

function defaultMinimumVersion(
  note: PlanNoteSeed,
  minimumDurationMin: number,
): string {
  const stepLines = extractStepLines(note.details);
  if (stepLines.length > 0) {
    return truncateInline(
      `Do a ${minimumDurationMin}-minute minimum version: ${stepLines[0]}.`,
      120,
    );
  }
  return truncateInline(
    `Do the first useful step of "${note.title}" for ${minimumDurationMin} minutes.`,
    120,
  );
}

function defaultStretchVersion(note: PlanNoteSeed): string {
  return truncateInline(
    `Complete the full block for "${note.title}" and add one extra refinement or verification pass.`,
    140,
  );
}

function inferLearningMode(
  note: PlanNoteSeed,
  domain: GoalDomain,
  strategyKind: PlannerStrategyKind,
): LearningMode {
  const corpus = `${note.title}\n${note.details}`;
  if (/(review|recap|reflect|journal)/i.test(corpus)) return "review";
  if (domain === "spiritual") return "reflection";
  if (strategyKind === "retrieval") return "spaced_retrieval";
  if (strategyKind === "progressive_practice") return "progressive_practice";
  if (/(feedback|check|quiz|test)/i.test(corpus)) return "feedback";
  return "execution";
}

function inferTrigger(
  note: PlanNoteSeed,
  cueType: CueType,
): string {
  if (safeTrim(note.start_time) && safeTrim(note.end_time)) {
    return `Start at ${note.start_time} and protect the block until ${note.end_time}.`;
  }
  if (safeTrim(note.start_time)) {
    return `Start at ${note.start_time}.`;
  }
  switch (cueType) {
    case "situational":
      return "Start after the first stable opening in your day.";
    case "preceding_event":
      return "Start right after the event that naturally precedes this work.";
    case "place":
      return "Start when you arrive at the place where this work usually happens.";
    case "social":
      return "Start when the accountability touchpoint begins.";
    default:
      return "Start at the planned time cue for this block.";
  }
}

function inferDurationMin(
  note: PlanNoteSeed,
  fallbackDurationMin: number,
): number {
  const start = timeToMinutes(note.start_time);
  const end = timeToMinutes(note.end_time);
  if (start != null && end != null && end > start) return end - start;
  if (note.all_day) return Math.max(10, fallbackDurationMin);
  return fallbackDurationMin;
}

function detailAlreadyCovers(
  lines: string[],
  label: string | null,
  value: string,
): boolean {
  const normalizedValue = normalizeDetailForComparison(value);
  if (!normalizedValue) return true;
  return lines.some((line) => {
    const normalizedLine = normalizeDetailForComparison(line);
    if (!normalizedLine) return false;
    if (normalizedLine === normalizedValue) return true;
    return label === null &&
      (
        normalizedLine.includes(normalizedValue) ||
        normalizedValue.includes(normalizedLine)
      );
  });
}

function normalizeDetailForComparison(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function lowerFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function upperFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function removeTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/, "");
}

function makePlainPlannerText(value?: string | null): string {
  let text = safeTrim(value);
  if (!text) return "";

  text = text
    .replace(
      /^Do the first useful step of "([^"]+)" for (\d+) minutes\.?$/i,
      "spend $2 minutes on the first concrete step",
    )
    .replace(
      /^Complete the full block for "([^"]+)" and add one extra refinement or verification pass\.?$/i,
      "finish the full block, then add one quick check or refinement",
    )
    .replace(
      /^Do the minimum version at the next workable opening and keep the next scheduled block (?:intact|unchanged)\.?$/i,
      "do the small version at the next opening and leave the next block alone",
    )
    .replace(
      /^Start at (\d{2}:\d{2}) and protect the block until (\d{2}:\d{2})\.?$/i,
      "Start at $1 and keep the block clear until $2.",
    );

  return sentence(text);
}

function plainList(items: string[]): string {
  const cleaned = items
    .map((item) => lowerFirst(removeTerminalPunctuation(item)))
    .filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] ?? "";
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${
    cleaned[cleaned.length - 1]
  }`;
}

function isGenericContextAnchor(value?: string | null): boolean {
  const normalized = normalizeDetailForComparison(value ?? "");
  return !normalized ||
    normalized === "the place where this task normally happens" ||
    /\b(?:morning|afternoon|evening)?\s*(?:study|practice|reflection|review)\s+session\b/i
      .test(normalized);
}

function renderContextSentence(value?: string | null): string {
  const context = removeTerminalPunctuation(safeTrim(value));
  if (!context || isGenericContextAnchor(context)) return "";
  if (/^(after|before|when|once)\b/i.test(context)) {
    return `Use ${lowerFirst(context)} as the anchor.`;
  }
  if (
    /^(study materials|desk|workspace|training space|practice space)\b/i.test(
      context,
    )
  ) {
    return `Have ${lowerFirst(context)}.`;
  }
  if (/\bready$/i.test(context)) return `Have ${lowerFirst(context)}.`;
  return `Keep ${lowerFirst(context)} nearby.`;
}

function isGenericMinimum(value: string): boolean {
  return /first (?:concrete|useful) step|minimum version|small version/i.test(
    value,
  );
}

function renderMinimumSentence(action: PlanAction): string {
  const raw = makePlainPlannerText(action.minimum_version);
  if (!raw) return "";
  if (isGenericMinimum(raw)) {
    const minutes = raw.match(/\b(\d{1,3}) minutes?\b/i)?.[1];
    if (
      action.learning_mode === "spaced_retrieval" ||
      action.learning_mode === "feedback"
    ) {
      return `If time is tight, practice a smaller set${
        minutes ? ` for ${minutes} minutes` : ""
      }.`;
    }
    return `If time is tight, do a smaller version${
      minutes ? ` for ${minutes} minutes` : ""
    }.`;
  }
  return `If time is tight, ${lowerFirst(raw)}`;
}

function renderStretchSentence(action: PlanAction): string {
  const raw = makePlainPlannerText(action.stretch_version);
  if (!raw) return "";
  if (/finish the full block|extra refinement|verification pass/i.test(raw)) {
    if (
      action.learning_mode === "spaced_retrieval" ||
      action.learning_mode === "feedback"
    ) {
      return "If you have extra room, add one quick self-check or correction.";
    }
    return "If you have extra room, add one quick check or refinement.";
  }
  return `If you have extra room, ${lowerFirst(raw)}`;
}

function renderMissedSentence(action: PlanAction): string {
  const raw = makePlainPlannerText(action.obstacle_plan.if_missed);
  if (!raw) return "";
  if (/next opening|next workable opening|leave the next/i.test(raw)) {
    return "If you miss it, do the smaller version later and leave the next session alone.";
  }
  return `If you miss it, ${lowerFirst(raw)}`;
}

function stripVisibleSchemaLabel(value: string): string {
  return value.trim().replace(
    /^(?:Do|Cue|Context|Minimum|Stretch|If missed|Track):\s*/i,
    "",
  );
}

function isLearningAction(
  action: PlanAction,
  planSpec?: Partial<Pick<PlanSpecV2, "goal">> | null,
  leadDetail?: string | null,
): boolean {
  if (planSpec?.goal?.domain === "learning") return true;
  const tags = action.evidence_tags.join(" ");
  const corpus = `${action.title}\n${action.definition_of_done}\n${tags}\n${
    leadDetail ?? ""
  }`;
  return action.learning_mode === "spaced_retrieval" ||
    action.learning_mode === "feedback" ||
    /\b(learning|retrieval|recall|quiz|flashcard|chapter|lesson|study|textbook|teach[- ]?back|symbol|medu neter|concept)\b/i
      .test(corpus);
}

function looksLikePassiveLearningDetail(value: string): boolean {
  return /\b(start by reviewing|begin with a focused overview|focused overview|key principles|key concepts|key symbols|read chapters?|take notes|dedicate the last|aim to|rehearse the main ideas|if you find .*challenging|adjust your focus)\b/i
    .test(value);
}

function cleanLearningFocus(value: string): string {
  return removeTerminalPunctuation(value)
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function extractLearningFocus(
  action: PlanAction,
  leadDetail?: string | null,
): string {
  const lead = safeTrim(leadDetail);
  const chapter = lead.match(
    /\bchapters?\s+\d+(?:\s*[-–]\s*\d+)?(?:\s+of\s+(?:your\s+)?(?:textbook|book|source|notes))?/i,
  )?.[0];
  const section = lead.match(
    /\bsections?\s+\d+(?:\s*[-–]\s*\d+)?(?:\s+of\s+(?:your\s+)?(?:textbook|book|source|notes))?/i,
  )?.[0];
  const focus = lead.match(/\bfocusing on ([^.!?]+)/i)?.[1];
  const summary = lead.match(/\bsummary of ([^.!?]+)/i)?.[1];
  const source = chapter ?? section;
  if (source && focus) {
    return cleanLearningFocus(`${source}, especially ${focus}`);
  }
  if (source) return cleanLearningFocus(source);
  if (summary) return cleanLearningFocus(summary);

  const medu = lead.match(/\bMedu Neter[^.!?]*(?:concepts|symbols)?/i)?.[0];
  if (medu) return cleanLearningFocus(medu);

  const reviewTitle = action.title.match(
    /^(?:evening\s+)?(?:review|reflection|recap)\s+(?:(?:of|on)\s+)?(.+)$/i,
  )?.[1];
  if (reviewTitle) return cleanLearningFocus(reviewTitle);

  const title = cleanLearningFocus(action.title)
    .replace(/^(?:practice|review|study|recall)\s+/i, "")
    .replace(/\s+practice$/i, "")
    .replace(/\s+problems?$/i, "")
    .trim();
  return title || "the material";
}

function conceptForSentence(value: string): string {
  const cleaned = cleanLearningFocus(value);
  if (!cleaned) return "the material";
  if (/^(?:the\s+)?key concepts?$/i.test(cleaned)) {
    return "the concept you practiced today";
  }
  if (/\bMedu Neter\b/.test(cleaned) || /\b[A-Z]{2,}\b/.test(cleaned)) {
    return lowerFirst(cleaned);
  }
  if (/^[A-Z][a-z]+(?:[- ][A-Z][a-z]+)+$/.test(cleaned)) {
    return cleaned.toLowerCase();
  }
  return lowerFirst(cleaned);
}

function learningFocusPrefix(focus: string): string {
  const plain = cleanLearningFocus(focus);
  if (!plain) return "Use the material";
  if (
    /^(chapter|chapters|section|sections|lesson|lessons|unit|units|page|pages|the|your)\b/i
      .test(plain)
  ) {
    return `Use ${plain}`;
  }
  return `Use this block for ${conceptForSentence(plain)}`;
}

function learningOutputLine(
  action: PlanAction,
  leadDetail?: string | null,
): string {
  const corpus = `${action.title}\n${action.definition_of_done}\n${
    leadDetail ?? ""
  }`;
  if (/\b(symbol|flashcard|glyph|medu neter)\b/i.test(corpus)) {
    return "Leave behind a corrected symbol list, one meaning you can say plainly, and one symbol to repeat tomorrow.";
  }
  if (/\b(problem|exercise|equation|proof|calculation)\b/i.test(corpus)) {
    return "Leave behind one worked example, one checked mistake, and one question to revisit.";
  }
  if (/\bchapter|textbook|principle|concept|theory|mechanics\b/i.test(corpus)) {
    return "Leave behind one plain-language teach-back, one example or analogy, and one question to revisit.";
  }
  return "Leave behind one teach-back, one checked example or correction, and one question to revisit.";
}

function renderActiveLearningLead(
  action: PlanAction,
  leadDetail?: string | null,
): string[] {
  const corpus = `${action.title}\n${action.definition_of_done}\n${
    leadDetail ?? ""
  }`;
  const focus = extractLearningFocus(action, leadDetail);
  if (/\b(symbol|flashcard|glyph|medu neter)\b/i.test(corpus)) {
    return [
      `${
        learningFocusPrefix(focus)
      } in small groups. Look once, hide the reference, write the symbols from memory, then check the meanings against the source.`,
      learningOutputLine(action, leadDetail),
    ];
  }
  return [
    `${
      learningFocusPrefix(focus)
    }, but make the work active: read or review one small piece, close the source, and explain it from memory before writing notes.`,
    learningOutputLine(action, leadDetail),
  ];
}

function renderLearningMinimumSentence(
  action: PlanAction,
  leadDetail?: string | null,
): string {
  const corpus = `${action.title}\n${action.definition_of_done}\n${
    leadDetail ?? ""
  }`;
  if (/\b(symbol|flashcard|glyph|medu neter)\b/i.test(corpus)) {
    return "On a tight day, recall one small symbol group and correct it immediately.";
  }
  if (/\b(problem|exercise|equation|proof|calculation)\b/i.test(corpus)) {
    return "On a tight day, work one example from memory, check it, and mark the first place you got stuck.";
  }
  return "On a tight day, pick one small section and write a five-sentence teach-back from memory.";
}

function renderLearningMissedSentence(action: PlanAction): string {
  const raw = makePlainPlannerText(action.obstacle_plan.if_missed);
  if (
    /later today|next opening|next workable opening|leave the next/i.test(raw)
  ) {
    return "If this gets missed, do the short version later and keep the next session unchanged.";
  }
  return raw ? `If this gets missed, ${lowerFirst(raw)}` : "";
}

function isLearningReviewAction(
  action: PlanAction,
  leadDetail?: string | null,
): boolean {
  const titleAndCue = `${action.title}\n${action.trigger}`;
  const lead = leadDetail ?? "";
  const explicitReview =
    /\b(evening|reflection|recap|close the loop)\b/i.test(titleAndCue) ||
    /\b(close the loop|reflect on what you learned|summary of|evening review)\b/i
      .test(lead);
  if (explicitReview) return true;
  if (
    action.learning_mode !== "review" &&
    !/^(review|recap|summary)\b/i.test(action.title)
  ) {
    return false;
  }
  return /^(review|recap|summary)\b/i.test(action.title) &&
    !/\b(practice|solve|drill|problem|chapter|session)\b/i.test(action.title);
}

function cleanLearningLeadDetail(value: string): string {
  const sentences = extractSentences(value)
    .map((item) =>
      item
        .replace(/^At\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)?(?:,|\s+)/i, "")
        .replace(/\bdive into\b/i, "work on")
        .replace(/\s+to solidify your understanding\b/i, "")
        .replace(
          /\bfocusing on clarity and understanding\b/i,
          "so the explanation is teachable",
        )
        .trim()
    )
    .map((item) => upperFirst(item))
    .filter((item) =>
      item &&
      !/\b(aim to|focus on understanding(?: the concepts)? deeply|reflect on your understanding|this will help reinforce your understanding|if time is short|if time runs out|if you run out of time|if you find .*challenging|adjust your focus)\b/i
        .test(item)
    );
  return sentences.slice(0, 3).join(" ");
}

function hasConcreteLearningPractice(value: string): boolean {
  return /\b(solve|work|attempt|write|recall|explain|quiz|self[- ]?check|drill|translate|draw|apply|correct)\b/i
    .test(value);
}

function renderLearningReviewDetails(
  action: PlanAction,
  leadDetail?: string | null,
): string {
  const focus = extractLearningFocus(action, leadDetail);
  const lines: string[] = [];
  pushPlainDetailLine(
    lines,
    `Close the loop from memory: write the clearest short explanation of ${
      conceptForSentence(focus)
    } you can without opening the source.`,
  );
  pushPlainDetailLine(
    lines,
    "Then add one line for what still feels fuzzy and the first question to start with tomorrow.",
  );
  const trigger = makePlainPlannerText(action.trigger);
  if (trigger) pushPlainDetailLine(lines, trigger);
  pushPlainDetailLine(
    lines,
    "On a tight night, write three bullets: one idea remembered, one confusion, and one next step.",
  );
  return lines.join("\n");
}

function renderLearningTrackSentence(
  action: PlanAction,
  metricLabels: string[],
): string {
  const corpus = `${action.title}\n${action.definition_of_done}\n${
    metricLabels.join(" ")
  }\n${action.metric_keys.join(" ")}\n${action.learning_mode}`;
  if (/\b(symbol|flashcard|glyph|medu neter)\b/i.test(corpus)) {
    return "Count corrected recalls, not time spent looking at the answer.";
  }
  if (
    /\bretrieval|recall|chapter|textbook|concept|principle|teach[- ]?back\b/i
      .test(corpus)
  ) {
    return "Count closed-book recalls, not pages read.";
  }
  return "Use the finished output as the score.";
}

function renderLearningActionDetails(
  action: PlanAction,
  metricLabels: string[],
  leadDetail?: string | null,
): string {
  if (isLearningReviewAction(action, leadDetail)) {
    return renderLearningReviewDetails(action, leadDetail);
  }

  const lead = safeTrim(leadDetail);
  const cleanedLead = cleanLearningLeadDetail(lead);
  const lines: string[] = [];

  if (
    cleanedLead &&
    (!looksLikePassiveLearningDetail(lead) || hasConcreteLearningPractice(lead))
  ) {
    pushPlainDetailLine(lines, cleanedLead);
    pushPlainDetailLine(lines, learningOutputLine(action, lead));
  } else {
    for (const line of renderActiveLearningLead(action, lead)) {
      pushPlainDetailLine(lines, line);
    }
  }

  if (lines.length === 0) {
    for (
      const line of renderActiveLearningLead(action, action.definition_of_done)
    ) {
      pushPlainDetailLine(lines, line);
    }
  }

  const trigger = makePlainPlannerText(action.trigger);
  const context = renderContextSentence(action.context_anchor);
  pushPlainDetailLine(lines, [trigger, context].filter(Boolean).join(" "));
  pushPlainDetailLine(lines, renderLearningMinimumSentence(action, lead));
  pushPlainDetailLine(lines, renderLearningMissedSentence(action));
  pushPlainDetailLine(lines, renderLearningTrackSentence(action, metricLabels));

  return lines.join("\n");
}

function pushPlainDetailLine(lines: string[], value?: string | null): void {
  const trimmed = safeTrim(value);
  if (!trimmed || detailAlreadyCovers(lines, null, trimmed)) return;
  for (
    const line of trimmed.split(/\n+/).map((item) =>
      sentence(stripVisibleSchemaLabel(item))
    )
  ) {
    if (line && !detailAlreadyCovers(lines, null, line)) {
      lines.push(line);
    }
  }
}

function renderActionDetails(
  action: PlanAction,
  planSpec?: Partial<Pick<PlanSpecV2, "metrics" | "goal">> | null,
  leadDetail?: string | null,
): string {
  const metricLabels = (planSpec?.metrics ?? [])
    .filter((metric) => action.metric_keys.includes(metric.key))
    .map((metric) => metric.label)
    .filter(Boolean);
  const trackLine = metricLabels.length > 0
    ? metricLabels.join(", ")
    : action.metric_keys.join(", ");

  if (isLearningAction(action, planSpec, leadDetail)) {
    return renderLearningActionDetails(action, metricLabels, leadDetail);
  }

  const lines: string[] = [];
  pushPlainDetailLine(lines, leadDetail);

  if (!safeTrim(leadDetail)) {
    pushPlainDetailLine(lines, makePlainPlannerText(action.definition_of_done));
  }

  const trigger = makePlainPlannerText(action.trigger);
  const context = renderContextSentence(action.context_anchor);
  pushPlainDetailLine(lines, [trigger, context].filter(Boolean).join(" "));

  pushPlainDetailLine(lines, renderMinimumSentence(action));
  const stretchSentence = renderStretchSentence(action);
  if (
    stretchSentence &&
    !/add one quick (?:self-check or correction|check or refinement)/i.test(
      stretchSentence,
    )
  ) {
    pushPlainDetailLine(lines, stretchSentence);
  }
  pushPlainDetailLine(lines, renderMissedSentence(action));

  if (trackLine) {
    pushPlainDetailLine(
      lines,
      `Keep score with ${plainList(trackLine.split(","))}.`,
    );
  }
  return lines.join("\n");
}

function inferRenderHints(
  action: PlanAction,
  note?: PlanNoteSeed | null,
  planSpec?: Partial<Pick<PlanSpecV2, "metrics" | "goal">> | null,
): PlanActionRenderHints {
  const existing = action.render_hints ?? {};
  const allDay = toBoolOrNull(existing.all_day) ??
    (note?.all_day === true ? true : false);
  return {
    details: renderActionDetails(
      action,
      planSpec,
      safeTrim(existing.details) || safeTrim(note?.details),
    ),
    all_day: allDay,
    start_time: allDay ? null : (
      normalizeTimeString(existing.start_time) ??
        normalizeTimeString(note?.start_time)
    ),
    end_time: allDay ? null : (
      normalizeTimeString(existing.end_time) ??
        normalizeTimeString(note?.end_time)
    ),
    location: sanitizeFlowLocation(
      safeTrim(existing.location) || safeTrim(note?.location) || null,
    ),
  };
}

function buildSeedNoteFromAction(
  action: PlanAction,
  planSpec?: Partial<Pick<PlanSpecV2, "metrics" | "goal">> | null,
): PlanNoteSeed {
  const renderHints = inferRenderHints(action, null, planSpec);
  return {
    day_index: action.scheduled_day_index,
    title: action.title,
    details: safeTrim(renderHints.details) ||
      renderActionDetails(action, planSpec),
    all_day: renderHints.all_day === true,
    start_time: renderHints.all_day === true ? null : renderHints.start_time,
    end_time: renderHints.all_day === true ? null : renderHints.end_time,
    location: renderHints.location ?? null,
  };
}

function inferEvidenceTags(
  note: PlanNoteSeed,
  domain: GoalDomain,
): string[] {
  const corpus = `${note.title} ${note.details}`.toLowerCase();
  const tags = [
    domain,
    "direct_action",
  ];
  if (/(review|reflect|recap|journal)/i.test(corpus)) tags.push("review");
  if (/(practice|train|rehearse|workout|lift|run)/i.test(corpus)) {
    tags.push("practice");
  }
  if (/(budget|compare|document|application|numbers|invoice)/i.test(corpus)) {
    tags.push("documents");
  }
  if (/(quiz|recall|flashcard|explain|teach back)/i.test(corpus)) {
    tags.push("retrieval");
  }
  return uniqStrings(tags).slice(0, 5);
}

function buildObstaclePlan(
  note: PlanNoteSeed,
  minDuration: number,
): ObstaclePlan {
  return {
    if_low_time: defaultMinimumVersion(note, minDuration),
    if_distracted: `Reset the workspace, pick one next step, and work for ${
      Math.max(5, Math.min(minDuration, 10))
    } focused minutes.`,
    if_missed:
      `Do the minimum version at the next workable opening and keep the next scheduled block unchanged.`,
  };
}

function defaultMetricsForDomain(domain: GoalDomain): PlanMetric[] {
  const metrics: PlanMetric[] = [
    {
      key: "actions_completed",
      label: "Actions completed",
      type: "count",
      target: "Hit the planned action on most scheduled days.",
    },
    {
      key: "fallback_used",
      label: "Fallback used",
      type: "count",
      target: "Use the minimum version when needed instead of skipping.",
    },
    {
      key: "review_completed",
      label: "Weekly review completed",
      type: "boolean",
      target: "Complete the weekly review every cycle.",
    },
  ];

  switch (domain) {
    case "learning":
      metrics.push({
        key: "retrieval_reps",
        label: "Retrieval reps",
        type: "count",
        target: "Recall key material from memory several times each week.",
      });
      break;
    case "finance":
      metrics.push({
        key: "decisions_closed",
        label: "Decisions closed",
        type: "count",
        target: "Finish concrete money decisions, not just reading.",
      });
      break;
    case "fitness":
      metrics.push({
        key: "minutes_trained",
        label: "Minutes trained",
        type: "duration_min",
        target: "Accumulate steady training time without overloading.",
      });
      break;
    case "project":
      metrics.push({
        key: "deliverables_advanced",
        label: "Deliverables advanced",
        type: "count",
        target: "Move a real artifact or deliverable forward each cycle.",
      });
      break;
    case "spiritual":
      metrics.push({
        key: "practice_sessions",
        label: "Practice sessions",
        type: "count",
        target: "Keep the cue-anchored practice alive across the week.",
      });
      break;
    default:
      metrics.push({
        key: "minutes_invested",
        label: "Minutes invested",
        type: "duration_min",
        target: "Invest steady time in the plan each week.",
      });
      break;
  }

  return metrics;
}

function safetyFlagsForDomain(
  domain: GoalDomain,
  riskTier: RiskTier,
): PlanSafetyFlag[] {
  const flags: PlanSafetyFlag[] = [];
  if (domain === "finance") {
    flags.push({
      code: "finance_verify",
      severity: "warning",
      message:
        "Verify rates, terms, balances, and obligations before committing.",
    });
  }
  if (domain === "fitness" && riskTier !== "low") {
    flags.push({
      code: "fitness_conservative",
      severity: "warning",
      message:
        "Keep progression conservative and adjust for pain, fatigue, or recovery signals.",
    });
  }
  if (riskTier === "high") {
    flags.push({
      code: "high_risk_request",
      severity: "warning",
      message:
        "Use conservative defaults and escalate to qualified support where needed.",
    });
  }
  if (flags.length === 0) {
    flags.push({
      code: "general_review",
      severity: "info",
      message:
        "Use weekly review to reduce overload before adding more volume.",
    });
  }
  return flags;
}

export function generatePlanSpec(args: {
  description: string;
  flowName?: string;
  sourceText?: string;
  flowFormat: FlowFormat;
  dateRangeDays: number;
  notes: PlanNoteSeed[];
  classification: PlanIntentClassification;
  decisionMatrix: PlanDecisionMatrixV2;
}): PlanSpecV2 {
  const {
    description,
    flowName,
    dateRangeDays,
    notes,
    classification,
    decisionMatrix,
  } = args;

  const goalTitle = safeTrim(flowName) ||
    truncateInline(
      description.split(/\r?\n/).find((line) => line.trim()) || "Planned Flow",
      72,
    );
  const metrics = defaultMetricsForDomain(classification.domain);
  const primaryMetricKey = metrics[0]?.key ?? "actions_completed";
  const domainMetricKey = metrics[3]?.key ?? metrics[metrics.length - 1]?.key ??
    primaryMetricKey;

  const actions: PlanAction[] = notes.map((note, index) => {
    const actionId = `a${
      String(index + 1).padStart(3, "0")
    }_d${note.day_index}_${slugify(note.title)}`;
    const duration_min = inferDurationMin(
      note,
      decisionMatrix.minimum_duration_min,
    );
    return {
      action_id: actionId,
      title: truncateInline(note.title || `Action ${index + 1}`, 80),
      definition_of_done: defaultDefinitionOfDone(note),
      duration_min,
      trigger: inferTrigger(note, decisionMatrix.cue_type),
      context_anchor: safeTrim(note.location) ||
        defaultContextAnchor(classification.domain),
      learning_mode: inferLearningMode(
        note,
        classification.domain,
        decisionMatrix.strategy_kind,
      ),
      minimum_version: defaultMinimumVersion(
        note,
        Math.min(duration_min, decisionMatrix.minimum_duration_min),
      ),
      stretch_version: defaultStretchVersion(note),
      obstacle_plan: buildObstaclePlan(
        note,
        Math.min(duration_min, decisionMatrix.minimum_duration_min),
      ),
      metric_keys: uniqStrings([
        primaryMetricKey,
        domainMetricKey,
        `action_completed:${actionId}`,
      ]),
      evidence_tags: inferEvidenceTags(note, classification.domain),
      risk_tier: classification.risk_tier,
      scheduled_day_index: note.day_index,
      render_hints: {
        details: safeTrim(note.details) || undefined,
        all_day: note.all_day,
        start_time: note.all_day ? null : normalizeTimeString(note.start_time),
        end_time: note.all_day ? null : normalizeTimeString(note.end_time),
        location: safeTrim(note.location) || undefined,
      },
    };
  });

  const chunkSize = Math.max(1, Math.min(7, dateRangeDays));
  const milestones: PlanMilestone[] = [];
  for (
    let start = 0, idx = 0;
    start < actions.length;
    start += chunkSize, idx++
  ) {
    const group = actions.slice(start, start + chunkSize);
    if (group.length === 0) continue;
    const endDay = group[group.length - 1].scheduled_day_index;
    milestones.push({
      milestone_id: `m${String(idx + 1).padStart(2, "0")}`,
      title: group.length > 1
        ? `Days ${group[0].scheduled_day_index + 1}-${endDay + 1}`
        : `Day ${group[0].scheduled_day_index + 1}`,
      target_day_index: endDay,
      success_signal:
        `Complete most planned actions in this block and finish the weekly review.`,
      action_ids: group.map((action) => action.action_id),
    });
  }

  const strategySupports = uniqStrings([
    decisionMatrix.strategy_kind === "retrieval" ? "spaced retrieval" : "",
    decisionMatrix.strategy_kind === "progressive_practice"
      ? "progressive overload"
      : "",
    decisionMatrix.strategy_kind === "automation" ? "decision rules" : "",
    decisionMatrix.cue_type === "situational"
      ? "situational cues over rigid clock times"
      : "stable time cue",
    decisionMatrix.downshift_required ? "downshift before hard work" : "",
  ]);

  return {
    version: "flowspec_v2",
    goal: {
      title: titleCase(goalTitle),
      domain: classification.domain,
      source: classification.source,
      goal_type: classification.goal_type,
      success_definition:
        "Complete the next concrete action consistently enough that progress compounds week over week.",
      horizon_days: dateRangeDays,
    },
    readiness_profile: {
      complexity: classification.complexity,
      risk_tier: classification.risk_tier,
      schedule_stability: classification.unstable_schedule
        ? "variable"
        : "stable",
      stress_load: classification.high_stress ? "high" : "medium",
      completion_pressure: decisionMatrix.max_actions_per_day <= 1
        ? "high"
        : "medium",
      attention_style: classification.scatter_risk ? "scattered" : "focused",
    },
    strategy: {
      primary: decisionMatrix.strategy_kind,
      supports: strategySupports,
      cue_type: decisionMatrix.cue_type,
      daily_dose: {
        max_actions: decisionMatrix.max_actions_per_day,
        minimum_duration_min: decisionMatrix.minimum_duration_min,
        ramp: decisionMatrix.ramp,
      },
      fallback_strictness: decisionMatrix.fallback_strictness,
      rationale: uniqStrings([
        classification.domain === "learning"
          ? "Prioritize recall, practice, and feedback over passive review."
          : "",
        classification.unstable_schedule
          ? "Prefer situational triggers because rigid clock times are less reliable here."
          : "",
        classification.high_stress
          ? "Keep the minimum version short so missed days do not cascade."
          : "",
      ]),
    },
    milestones,
    actions,
    metrics,
    review_loop: {
      cadence: "weekly",
      day_interval: decisionMatrix.review_day_interval,
      prompt_questions: [
        "What got done?",
        "What got skipped?",
        "Why did it slip?",
        "What should change next week?",
      ],
      adjusters: [
        "reduce dose",
        "shift cue",
        "change timing",
        "add fallback",
        "increase challenge when adherence is stable",
      ],
    },
    support_layers: {
      cue_type: decisionMatrix.cue_type,
      environment: uniqStrings(actions.map((action) => action.context_anchor))
        .slice(
          0,
          4,
        ),
      fallback_strictness: decisionMatrix.fallback_strictness,
      accountability: classification.domain === "finance" ||
          classification.domain === "project"
        ? ["weekly checkpoint with documents or deliverables visible"]
        : [],
      downshift_step: decisionMatrix.downshift_required
        ? "Take a 2-minute reset, choose the minimum version, then start."
        : null,
    },
    safety_flags: safetyFlagsForDomain(
      classification.domain,
      classification.risk_tier,
    ),
  };
}

export function repairPlanSpec(
  planSpec: PlanSpecV2,
  notes: PlanNoteSeed[],
): PlanSpecV2 {
  const repairedActions = planSpec.actions.map((action, index) => {
    const note = notes[index] ?? notes.find((item) =>
      item.day_index === action.scheduled_day_index
    ) ?? notes[0] ?? {
      day_index: action.scheduled_day_index,
      title: action.title || `Action ${index + 1}`,
      details: action.definition_of_done || "",
      all_day: false,
    };
    const durationMin = clampInt(
      action.duration_min || inferDurationMin(note, 10),
      5,
      240,
    );
    return {
      ...action,
      title: safeTrim(action.title) || note?.title || `Action ${index + 1}`,
      definition_of_done: safeTrim(action.definition_of_done) ||
        defaultDefinitionOfDone(note),
      duration_min: durationMin,
      trigger: safeTrim(action.trigger) ||
        inferTrigger(note, planSpec.strategy.cue_type),
      context_anchor: safeTrim(action.context_anchor) ||
        safeTrim(note?.location) ||
        defaultContextAnchor(planSpec.goal.domain),
      minimum_version: safeTrim(action.minimum_version) ||
        defaultMinimumVersion(note, Math.min(durationMin, 15)),
      stretch_version: safeTrim(action.stretch_version) ||
        defaultStretchVersion(note),
      obstacle_plan: {
        if_low_time: safeTrim(action.obstacle_plan?.if_low_time) ||
          defaultMinimumVersion(note, Math.min(durationMin, 15)),
        if_distracted: safeTrim(action.obstacle_plan?.if_distracted) ||
          `Reset the workspace, pick one step, and work for 5 focused minutes.`,
        if_missed: safeTrim(action.obstacle_plan?.if_missed) ||
          `Do the minimum version at the next workable opening and keep the next scheduled block intact.`,
      },
      metric_keys: uniqStrings(action.metric_keys ?? []).length > 0
        ? uniqStrings(action.metric_keys ?? [])
        : ["actions_completed", `action_completed:${action.action_id}`],
      evidence_tags: uniqStrings(action.evidence_tags ?? []).length > 0
        ? uniqStrings(action.evidence_tags ?? [])
        : inferEvidenceTags(note, planSpec.goal.domain),
      render_hints: inferRenderHints(action, note, planSpec),
    };
  });

  return {
    ...planSpec,
    actions: repairedActions,
    milestones: planSpec.milestones.length > 0 ? planSpec.milestones : [{
      milestone_id: "m01",
      title: "Week 1",
      target_day_index: repairedActions[repairedActions.length - 1]
        ?.scheduled_day_index ?? 0,
      success_signal: "Complete the scheduled actions and finish the review.",
      action_ids: repairedActions.map((action) => action.action_id),
    }],
  };
}

export function validatePlanSpec(
  planSpec: PlanSpecV2 | null | undefined,
  noteCount: number,
  dateRangeDays?: number,
): PlanSpecValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!planSpec) {
    return {
      ok: false,
      errors: ["plan_spec missing"],
      warnings,
      quality_score: 0,
      coverage: {
        trigger_coverage: 0,
        fallback_coverage: 0,
        metric_coverage: 0,
        direct_action_ratio: 0,
      },
    };
  }

  if (planSpec.version !== "flowspec_v2") {
    errors.push("plan_spec.version must be flowspec_v2");
  }
  if (!safeTrim(planSpec.goal?.title)) errors.push("goal.title missing");
  if (!Array.isArray(planSpec.actions) || planSpec.actions.length === 0) {
    errors.push("actions must be non-empty");
  }
  if (!Array.isArray(planSpec.metrics) || planSpec.metrics.length === 0) {
    errors.push("metrics must be non-empty");
  }

  let triggerCount = 0;
  let fallbackCount = 0;
  let metricCount = 0;
  let directActionCount = 0;
  const coveredDays = new Set<number>();

  for (const [index, action] of (planSpec.actions ?? []).entries()) {
    if (!safeTrim(action.title)) errors.push(`actions[${index}].title missing`);
    if (!safeTrim(action.definition_of_done)) {
      errors.push(`actions[${index}].definition_of_done missing`);
    }
    if (!safeTrim(action.trigger)) {
      errors.push(`actions[${index}].trigger missing`);
    } else {
      triggerCount += 1;
    }
    if (
      safeTrim(action.minimum_version) &&
      safeTrim(action.obstacle_plan?.if_missed)
    ) {
      fallbackCount += 1;
    } else {
      errors.push(`actions[${index}] missing fallback coverage`);
    }
    if (Array.isArray(action.metric_keys) && action.metric_keys.length > 0) {
      metricCount += 1;
    } else {
      errors.push(`actions[${index}].metric_keys missing`);
    }
    if (!/^(review|practice|session|work)$/i.test(safeTrim(action.title))) {
      directActionCount += 1;
    } else {
      warnings.push(`actions[${index}] title too vague: ${action.title}`);
    }
    if (
      Number.isInteger(action.scheduled_day_index) &&
      action.scheduled_day_index >= 0
    ) {
      coveredDays.add(action.scheduled_day_index);
    } else {
      errors.push(`actions[${index}].scheduled_day_index missing`);
    }
  }

  if (
    typeof dateRangeDays === "number" &&
    Number.isFinite(dateRangeDays) &&
    dateRangeDays > 0
  ) {
    for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
      if (!coveredDays.has(dayIndex)) {
        errors.push(`missing action coverage for day_index ${dayIndex}`);
      }
    }
  }

  const totalActions = Math.max(1, planSpec.actions?.length ?? 0);
  const coverage = {
    trigger_coverage: triggerCount / totalActions,
    fallback_coverage: fallbackCount / totalActions,
    metric_coverage: metricCount / totalActions,
    direct_action_ratio: directActionCount /
      Math.max(1, noteCount || totalActions),
  };
  const quality_score = Math.round(
    ((coverage.trigger_coverage * 0.25) +
      (coverage.fallback_coverage * 0.25) +
      (coverage.metric_coverage * 0.25) +
      (Math.min(coverage.direct_action_ratio, 1) * 0.25)) * 100,
  );

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    quality_score,
    coverage,
  };
}

export function renderNotesFromPlanSpec(args: {
  notes?: PlanNoteSeed[] | null;
  planSpec: PlanSpecV2;
  preserveDetails?: boolean;
}): PlanNoteSeed[] {
  const { notes = [], planSpec, preserveDetails = false } = args;
  const byDay = new Map<number, PlanAction[]>();
  for (const action of planSpec.actions) {
    const existing = byDay.get(action.scheduled_day_index) ?? [];
    existing.push(action);
    byDay.set(action.scheduled_day_index, existing);
  }

  if (!Array.isArray(notes) || notes.length === 0) {
    return [...planSpec.actions]
      .sort((left, right) =>
        left.scheduled_day_index - right.scheduled_day_index ||
        left.action_id.localeCompare(right.action_id)
      )
      .map((action) => {
        const renderHints = inferRenderHints(action, null, planSpec);
        const behavior_payload: PlanBehaviorPayload = {
          action_id: action.action_id,
          definition_of_done: action.definition_of_done,
          trigger: action.trigger,
          context_anchor: action.context_anchor,
          learning_mode: action.learning_mode,
          minimum_version: action.minimum_version,
          stretch_version: action.stretch_version,
          obstacle_plan: action.obstacle_plan,
          metric_keys: action.metric_keys,
          evidence_tags: action.evidence_tags,
          risk_tier: action.risk_tier,
        };
        return {
          day_index: action.scheduled_day_index,
          title: action.title,
          details: renderActionDetails(action, planSpec, renderHints.details),
          all_day: renderHints.all_day === true,
          start_time: renderHints.all_day === true
            ? null
            : renderHints.start_time,
          end_time: renderHints.all_day === true ? null : renderHints.end_time,
          location: renderHints.location ?? null,
          action_id: action.action_id,
          behavior_payload,
        };
      });
  }

  return notes.map((note) => {
    const candidates = byDay.get(note.day_index) ?? [];
    const normalizedTitle = safeTrim(note.title).toLowerCase();
    const exactIndex = candidates.findIndex((action) =>
      safeTrim(action.title).toLowerCase() === normalizedTitle
    );
    const action = exactIndex >= 0
      ? candidates.splice(exactIndex, 1)[0]
      : candidates.shift();
    if (!action) return note;

    const behavior_payload: PlanBehaviorPayload = {
      action_id: action.action_id,
      definition_of_done: action.definition_of_done,
      trigger: action.trigger,
      context_anchor: action.context_anchor,
      learning_mode: action.learning_mode,
      minimum_version: action.minimum_version,
      stretch_version: action.stretch_version,
      obstacle_plan: action.obstacle_plan,
      metric_keys: action.metric_keys,
      evidence_tags: action.evidence_tags,
      risk_tier: action.risk_tier,
    };

    return {
      ...note,
      title: action.title,
      details: preserveDetails && safeTrim(note.details)
        ? note.details
        : renderActionDetails(
          action,
          planSpec,
          safeTrim(note.details) || safeTrim(action.render_hints?.details),
        ),
      location: sanitizeFlowLocation(
        safeTrim(note.location) ||
          safeTrim(action.render_hints?.location) ||
          note.location ||
          null,
      ),
      action_id: action.action_id,
      behavior_payload,
    };
  });
}

export function coercePlanSpec(args: {
  raw: unknown;
  fallbackFlowName: string;
  classification: PlanIntentClassification;
  decisionMatrix: PlanDecisionMatrixV2;
  dateRangeDays: number;
}): PlanSpecV2 {
  const {
    raw,
    fallbackFlowName,
    classification,
    decisionMatrix,
    dateRangeDays,
  } = args;
  const value = asRecord(raw);
  const rawGoal = asRecord(value?.goal);
  const rawReadiness = asRecord(value?.readiness_profile);
  const rawStrategy = asRecord(value?.strategy);
  const rawReviewLoop = asRecord(value?.review_loop);
  const rawSupportLayers = asRecord(value?.support_layers);

  const fallbackSeed = generatePlanSpec({
    description: fallbackFlowName,
    flowName: fallbackFlowName,
    flowFormat: classification.domain === "finance"
      ? "FINANCE_PLAN"
      : classification.domain === "project"
      ? "PROJECT_PLAN"
      : classification.domain === "learning"
      ? "SYNTHESIS"
      : classification.domain === "fitness"
      ? "REGIMEN"
      : "STANDARD",
    dateRangeDays,
    notes: Array.from({ length: Math.max(1, dateRangeDays) }, (_, index) => ({
      day_index: index,
      title: `Day ${index + 1} action`,
      details: "Define the next concrete action.",
      all_day: false,
      start_time: null,
      end_time: null,
      location: null,
    })),
    classification,
    decisionMatrix,
  });

  const actions = asList(value?.actions).map((item, index) => {
    const rawAction = asRecord(item);
    const fallbackAction = fallbackSeed.actions[
      Math.min(
        index,
        fallbackSeed.actions.length - 1,
      )
    ];
    const rawObstacle = asRecord(rawAction?.obstacle_plan);
    const rawRenderHints = asRecord(rawAction?.render_hints);
    const dayIndex = clampInt(
      Number(
        rawAction?.scheduled_day_index ?? fallbackAction.scheduled_day_index,
      ),
      0,
      Math.max(0, dateRangeDays - 1),
    );
    const title = safeTrim(rawAction?.title) || fallbackAction.title;
    const actionId = safeTrim(rawAction?.action_id) ||
      `a${String(index + 1).padStart(3, "0")}_d${dayIndex}_${slugify(title)}`;
    const metricKeys = uniqStrings(
      asList(rawAction?.metric_keys).map((value) =>
        safeTrim(value)
      ) as string[],
    );
    const evidenceTags = uniqStrings(
      asList(rawAction?.evidence_tags).map((value) =>
        safeTrim(value)
      ) as string[],
    );
    return {
      action_id: actionId,
      title,
      definition_of_done: safeTrim(rawAction?.definition_of_done) ||
        fallbackAction.definition_of_done,
      duration_min: clampInt(
        Number(rawAction?.duration_min ?? fallbackAction.duration_min),
        5,
        240,
      ),
      trigger: safeTrim(rawAction?.trigger) || fallbackAction.trigger,
      context_anchor: safeTrim(rawAction?.context_anchor) ||
        fallbackAction.context_anchor,
      learning_mode: (safeTrim(rawAction?.learning_mode) as LearningMode) ||
        fallbackAction.learning_mode,
      minimum_version: safeTrim(rawAction?.minimum_version) ||
        fallbackAction.minimum_version,
      stretch_version: safeTrim(rawAction?.stretch_version) ||
        fallbackAction.stretch_version,
      obstacle_plan: {
        if_low_time: safeTrim(rawObstacle?.if_low_time) ||
          fallbackAction.obstacle_plan.if_low_time,
        if_distracted: safeTrim(rawObstacle?.if_distracted) ||
          fallbackAction.obstacle_plan.if_distracted,
        if_missed: safeTrim(rawObstacle?.if_missed) ||
          fallbackAction.obstacle_plan.if_missed,
      },
      metric_keys: metricKeys.length > 0
        ? metricKeys
        : fallbackAction.metric_keys,
      evidence_tags: evidenceTags.length > 0
        ? evidenceTags
        : fallbackAction.evidence_tags,
      risk_tier: (safeTrim(rawAction?.risk_tier) as RiskTier) ||
        fallbackAction.risk_tier,
      scheduled_day_index: dayIndex,
      render_hints: {
        details: safeTrim(rawRenderHints?.details) || undefined,
        all_day: toBoolOrNull(rawRenderHints?.all_day) ??
          fallbackAction.render_hints?.all_day ??
          false,
        start_time: normalizeTimeString(rawRenderHints?.start_time) ??
          fallbackAction.render_hints?.start_time ??
          null,
        end_time: normalizeTimeString(rawRenderHints?.end_time) ??
          fallbackAction.render_hints?.end_time ??
          null,
        location: sanitizeFlowLocation(
          safeTrim(rawRenderHints?.location) ||
            fallbackAction.render_hints?.location ||
            undefined,
        ) ?? undefined,
      },
    } satisfies PlanAction;
  });

  const seededActions = actions.length > 0 ? actions : fallbackSeed.actions;
  const metrics = asList(value?.metrics)
    .map((item) => {
      const rawMetric = asRecord(item);
      return {
        key: safeTrim(rawMetric?.key),
        label: safeTrim(rawMetric?.label),
        type: (safeTrim(rawMetric?.type) as PlanMetric["type"]) || "count",
        target: safeTrim(rawMetric?.target),
      };
    })
    .filter((metric) => metric.key && metric.label && metric.target);
  const promptQuestions = uniqStrings(
    asList(rawReviewLoop?.prompt_questions).map((value) =>
      safeTrim(value)
    ) as string[],
  );
  const adjusters = uniqStrings(
    asList(rawReviewLoop?.adjusters).map((value) =>
      safeTrim(value)
    ) as string[],
  );
  const supportEnvironment = uniqStrings(
    asList(rawSupportLayers?.environment).map((value) =>
      safeTrim(value)
    ) as string[],
  );
  const safetyFlags = asList(value?.safety_flags)
    .map((item) => {
      const rawFlag = asRecord(item);
      return {
        code: safeTrim(rawFlag?.code),
        severity: (safeTrim(rawFlag?.severity) as PlanSafetyFlag["severity"]) ||
          "info",
        message: safeTrim(rawFlag?.message),
      };
    })
    .filter((flag) => flag.code && flag.message);

  const syntheticNotes = seededActions.map((action) =>
    buildSeedNoteFromAction(action, {
      metrics: metrics.length > 0 ? metrics : fallbackSeed.metrics,
    })
  );

  const coerced: PlanSpecV2 = {
    version: "flowspec_v2",
    goal: {
      title: safeTrim(rawGoal?.title) || fallbackFlowName ||
        fallbackSeed.goal.title,
      domain: (safeTrim(rawGoal?.domain) as GoalDomain) ||
        classification.domain,
      source: (safeTrim(rawGoal?.source) as PlanGoal["source"]) ||
        classification.source,
      goal_type: (safeTrim(rawGoal?.goal_type) as GoalKind) ||
        classification.goal_type,
      success_definition: safeTrim(rawGoal?.success_definition) ||
        fallbackSeed.goal.success_definition,
      horizon_days: clampInt(
        Number(rawGoal?.horizon_days ?? dateRangeDays),
        1,
        Math.max(1, dateRangeDays),
      ),
    },
    readiness_profile: {
      complexity: (safeTrim(
        rawReadiness?.complexity,
      ) as PlanReadinessProfile["complexity"]) ||
        classification.complexity,
      risk_tier: (safeTrim(rawReadiness?.risk_tier) as RiskTier) ||
        classification.risk_tier,
      schedule_stability: (safeTrim(
        rawReadiness?.schedule_stability,
      ) as PlanReadinessProfile["schedule_stability"]) ||
        (classification.unstable_schedule ? "variable" : "stable"),
      stress_load: (safeTrim(
        rawReadiness?.stress_load,
      ) as PlanReadinessProfile["stress_load"]) ||
        (classification.high_stress ? "high" : "medium"),
      completion_pressure: (safeTrim(
        rawReadiness?.completion_pressure,
      ) as PlanReadinessProfile["completion_pressure"]) ||
        (decisionMatrix.max_actions_per_day <= 1 ? "high" : "medium"),
      attention_style: (safeTrim(
        rawReadiness?.attention_style,
      ) as PlanReadinessProfile["attention_style"]) ||
        (classification.scatter_risk ? "scattered" : "focused"),
    },
    strategy: {
      primary: (safeTrim(rawStrategy?.primary) as PlannerStrategyKind) ||
        decisionMatrix.strategy_kind,
      supports: uniqStrings(
        asList(rawStrategy?.supports).map((value) =>
          safeTrim(value)
        ) as string[],
      ),
      cue_type: (safeTrim(rawStrategy?.cue_type) as CueType) ||
        decisionMatrix.cue_type,
      daily_dose: {
        max_actions: clampInt(
          Number(
            asRecord(rawStrategy?.daily_dose)?.max_actions ??
              decisionMatrix.max_actions_per_day,
          ),
          1,
          6,
        ),
        minimum_duration_min: clampInt(
          Number(
            asRecord(rawStrategy?.daily_dose)?.minimum_duration_min ??
              decisionMatrix.minimum_duration_min,
          ),
          5,
          120,
        ),
        ramp: (safeTrim(
          asRecord(rawStrategy?.daily_dose)?.ramp,
        ) as PlanStrategy["daily_dose"]["ramp"]) ||
          decisionMatrix.ramp,
      },
      fallback_strictness:
        (safeTrim(rawStrategy?.fallback_strictness) as FallbackStrictness) ||
        decisionMatrix.fallback_strictness,
      rationale: uniqStrings(
        asList(rawStrategy?.rationale).map((value) =>
          safeTrim(value)
        ) as string[],
      ),
    },
    milestones: asList(value?.milestones).map((item, index) => {
      const rawMilestone = asRecord(item);
      return {
        milestone_id: safeTrim(rawMilestone?.milestone_id) ||
          `m${String(index + 1).padStart(2, "0")}`,
        title: safeTrim(rawMilestone?.title) || `Milestone ${index + 1}`,
        target_day_index: clampInt(
          Number(rawMilestone?.target_day_index ?? index),
          0,
          Math.max(0, dateRangeDays - 1),
        ),
        success_signal: safeTrim(rawMilestone?.success_signal) ||
          "Complete the actions in this block and review the result.",
        action_ids: uniqStrings(
          asList(rawMilestone?.action_ids).map((value) =>
            safeTrim(value)
          ) as string[],
        ),
      };
    }),
    actions: seededActions,
    metrics: metrics.length > 0 ? metrics : fallbackSeed.metrics,
    review_loop: {
      cadence: "weekly",
      day_interval: clampInt(
        Number(
          rawReviewLoop?.day_interval ?? decisionMatrix.review_day_interval,
        ),
        3,
        14,
      ),
      prompt_questions: promptQuestions.length > 0
        ? promptQuestions
        : fallbackSeed.review_loop.prompt_questions,
      adjusters: adjusters.length > 0
        ? adjusters
        : fallbackSeed.review_loop.adjusters,
    },
    support_layers: {
      cue_type: (safeTrim(rawSupportLayers?.cue_type) as CueType) ||
        decisionMatrix.cue_type,
      environment: supportEnvironment.length > 0
        ? supportEnvironment
        : fallbackSeed.support_layers.environment,
      fallback_strictness: (safeTrim(
        rawSupportLayers?.fallback_strictness,
      ) as FallbackStrictness) ||
        decisionMatrix.fallback_strictness,
      accountability: uniqStrings(
        asList(rawSupportLayers?.accountability).map((value) =>
          safeTrim(value)
        ) as string[],
      ),
      downshift_step: safeTrim(rawSupportLayers?.downshift_step) ||
        fallbackSeed.support_layers.downshift_step ||
        null,
    },
    safety_flags: safetyFlags.length > 0
      ? safetyFlags
      : fallbackSeed.safety_flags,
  };

  return repairPlanSpec(coerced, syntheticNotes);
}

export function fingerprintPlanSpec(
  planSpec: PlanSpecV2,
): Record<string, unknown> {
  return {
    version: planSpec.version,
    goal_domain: planSpec.goal.domain,
    goal_type: planSpec.goal.goal_type,
    actions: planSpec.actions.length,
    metrics: planSpec.metrics.length,
    cue_type: planSpec.strategy.cue_type,
    strategy: planSpec.strategy.primary,
    review_interval: planSpec.review_loop.day_interval,
  };
}
