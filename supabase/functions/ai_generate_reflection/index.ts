import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { getDecanContext } from "../_shared/decan_context.ts";
import { guidanceEvidencePhrasesFromLines } from "../_shared/guidance_evidence.ts";
import {
  buildGuidanceShapingFingerprint,
  type GuidanceGoalProfile,
  type GuidancePersonalBaseline,
  MAAT_GUIDANCE_POLICY_VERSION,
  resolveGatePolicyForMaturity,
  resolveGraphAxisPriors,
  resolveGuidanceMaturity,
} from "../_shared/maat_guidance.ts";
import {
  type ControlledGeneratedTextPlan,
  type ControlledOutputGrade,
  DEFAULT_OUTPUT_BANNED_PHRASES,
  evidenceAnchorsFromMemoryPhrases,
  generatedTextPlanPromptBlock,
  gradeGeneratedTextAgainstPlan,
  OUTPUT_CONTROL_POLICY_VERSION,
  validateGeneratedTextAgainstPlan,
} from "../_shared/output_control.ts";
import {
  MAAT_CONSTITUTION_VERSION,
  MAAT_OUTPUT_FORCE_PRINCIPLE,
  MAAT_OUTPUT_NORTH_STAR,
} from "../_shared/maat_constitution.ts";
import {
  interpretMaatSituation,
  type MaatSituationInterpretation,
} from "../_shared/maat_situation_interpreter.ts";
import type { MaatNormalizedObligationThreads } from "../_shared/maat_obligation_threads.ts";
import {
  buildCompiledOutputPackage,
  buildOutputCompilerTrace,
} from "../_shared/output_compiler.ts";
import {
  compiledDestinationForPackage,
  destinationPayload,
  resolveReflectionDestination,
} from "../_shared/maat_destination_resolver.ts";
import {
  buildReflectionAlignmentMap,
  buildReflectionArcPlan,
  buildReflectionCalendarFrame,
  buildReflectionUserPatternProfile,
  type ReflectionAlignmentMap,
  type ReflectionArcPlan,
  type ReflectionCalendarFrame,
  reflectionCalendarPromptBlock,
  type ReflectionUserPatternProfile,
} from "../_shared/reflection_calendar.ts";
import {
  type MaatReflectionExample,
  selectMaatReflectionExamples,
} from "../_shared/maat_reflection_examples.ts";
import {
  extractMaatUserProfileFacts,
  fetchStoredMaatUserProfileFacts,
  type MaatUserProfileFact,
  mergeMaatUserProfileFacts,
  type ProfileFlowBehaviorStats,
  type ProfileGuidanceOutcomeStats,
  upsertMaatUserProfileFacts,
} from "../_shared/profile_fact_extractor.ts";
import {
  type MaatTranslatedProfileContext,
  profileContextPromptBlock,
  translateMaatProfileContext,
} from "../_shared/profile_context_translator.ts";
import {
  buildReflectionProfileSnapshot,
  type ReflectionProfileSnapshot,
  reflectionProfileSnapshotPromptBlock,
} from "../_shared/reflection_profile_snapshot.ts";
import {
  buildFallbackReflectionMoralPortrait,
  buildReflectionMoralPortraitPrompt,
  parseReflectionMoralPortrait,
  type ReflectionMoralPortrait,
  type ReflectionMoralPortraitInput,
  reflectionMoralPortraitPromptBlock,
} from "../_shared/reflection_moral_portrait.ts";
import {
  buildFallbackReflectionJudgment,
  buildReflectionJudgmentPrompt,
  parseReflectionJudgment,
  type ReflectionJudgment,
  type ReflectionJudgmentInput,
  reflectionJudgmentPromptBlock,
} from "../_shared/reflection_judgment.ts";
import {
  buildReflectionThesisGate,
  type ReflectionThesisGate,
  reflectionThesisGatePromptBlock,
} from "../_shared/reflection_thesis_gate.ts";
import {
  buildFallbackReflectionPlainSacredEdit,
  buildReflectionPlainSacredEditorPrompt,
  parseReflectionPlainSacredEdit,
  type ReflectionPlainSacredEdit,
  type ReflectionPlainSacredEditorInput,
} from "../_shared/reflection_plain_sacred_editor.ts";
import { buildUserMemoryBrief } from "../_shared/user_memory_brief.ts";
import {
  buildMaatDimensionSnapshot as buildMaatDimensionSnapshotFromSignals,
  buildReflectionDecisionMatrix as buildReflectionDecisionMatrixFromSnapshot,
  type MaatAxisCode,
  type MaatDimensionSnapshot,
  type ReflectionDecisionMatrixV1,
  type ReflectionProfileRow,
} from "./maat_decision.ts";

type BadgeRow = {
  title: string | null;
  details: string | null;
  tags?: string[] | null;
  occurred_on: string;
  flow_id?: number | null;
  event_id?: string | null;
};

type JournalEntryRow = {
  id: string;
  greg_date: string;
  body: string | null;
  meta?: Record<string, unknown> | null;
};

type TodoRow = {
  id: string;
  title: string | null;
  notes: string | null;
  due_date: string | null;
  status: string | null;
  completed_at?: string | null;
};

type NutritionItemRow = {
  id: string;
  nutrient: string | null;
  source: string | null;
  purpose: string | null;
  mode: string | null;
  days_of_week: number[] | null;
  decan_days: number[] | null;
  repeat: boolean | null;
  enabled: boolean | null;
  created_at?: string | null;
};

type UserEventRow = {
  id: string;
  client_event_id: string | null;
  title: string | null;
  category: string | null;
  starts_at: string;
  ends_at: string | null;
  flow_local_id: number | null;
  flow_tpl_key: string | null;
  action_id: string | null;
};

type ScheduledNotificationRow = {
  id: number;
  client_event_id: string | null;
  title: string | null;
  notification_type: string | null;
  scheduled_at: string;
  is_active: boolean | null;
};

type UserEventCompletionRow = {
  id: number;
  client_event_id: string | null;
  flow_id: number | null;
  completed_on: string;
  completed_at: string | null;
  source: string | null;
  metadata?: Record<string, unknown> | null;
};

type FlowNameRow = {
  id: number;
  name: string | null;
  active: boolean | null;
  is_hidden: boolean | null;
};

type DecanWindow = {
  name?: string;
  theme?: string | null;
  start: string;
  end: string;
};

type ReflectionPayload = {
  user_id?: string;
  decan_name: string;
  decan_theme?: string | null;
  decan_context_key?: string | null;
  decan_start?: string;
  decan_end?: string;
  past_decans?: DecanWindow[];
  include_history?: boolean; // default true
  v2?: boolean;
  persist?: boolean;
  use_knowledge_graph?: boolean;
  use_decision_matrix?: boolean;
  badges?: InputBadge[]; // optional client-provided badges
  // Legacy fallback fields
  badge_titles?: string[];
  badge_count?: number;
  kemetic_day?: string;
};

type Summary = {
  label: string;
  badgeCount: number;
  tags: string[];
  cadence: string;
  snippets: string[];
};

type InputBadge = {
  title?: string | null;
  details?: string | null;
  tags?: string[] | null;
  event_id?: string | null;
  occurred_on?: string;
  occurred_at?: string | null;
};

type AnthropicMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};
type EvidenceEntry = {
  line: string;
  occurredOn: string;
  occurredAt?: string | null;
  score: number;
  hasDetails: boolean;
};

type Metrics = {
  badgeCount: number;
  daysActive: number;
  evidenceCount: number;
  detailsCoverage: number; // 0-100
  progressMarkersCount: number;
  refinementHits: number;
  arcSignals: boolean;
  clusteredEffort: boolean;
  topTags: string[];
  topThread: string | null;
  earlyTopThread: string | null;
  lateTopThread: string | null;
};

type HistoryMetrics = {
  label: string;
  badgeCount: number;
  daysActive: number;
  progressMarkersCount: number;
  topThread: string | null;
  refinementHits?: number;
  arcSignals?: boolean;
};

type V3Signals = {
  metrics: Metrics;
  anchors: string[];
  dominantVerbs: string[];
  disciplineClusters: string[];
  repetitionScore: number;
  repeatedTitles: string[];
  progression: "theory_to_application" | null;
  diversityScore: number;
};

type PlannerKind = "todo" | "nutrition";
type PlannerState = "done" | "partial" | "skipped" | "pending" | "unknown";
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
  todoExamples: string[];
  nutritionExamples: string[];
  journalExamples: string[];
};

// Use the Supabase-specific envs only; avoid generic keys that may point to a different project.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_HISTORY_WINDOWS = 2;
const PROGRESS_MARKERS = [
  "reps",
  "drill",
  "measure",
  "again",
  "adjust",
  "review",
  "fix",
  "improve",
  "focus",
  "form",
  "timing",
  "consistency",
  "plan",
  "schedule",
  "repeat",
  "refine",
];

const REFINEMENT_TERMS = [
  "adjust",
  "repeat",
  "fix",
  "measure",
  "aim",
  "track",
  "form",
  "balance",
  "control",
  "timer",
  "rounds",
  "makes",
];

const EARLY_RESEARCH_TERMS = ["research", "learn", "read", "study", "sources"];
const LATE_PRACTICE_TERMS = ["review", "practice", "drill", "execute", "apply"];

const DOMINANT_VERBS = [
  "adjust",
  "repeat",
  "measure",
  "practice",
  "review",
  "build",
  "focus",
  "drill",
  "alignment",
  "refine",
  "track",
  "execute",
  "explore",
  "gather",
];

const DISCIPLINE_BUCKETS: Record<string, string[]> = {
  sports: [
    "shoot",
    "puck",
    "footwork",
    "reps",
    "form",
    "cone",
    "drill",
    "laps",
    "rounds",
  ],
  research: [
    "sources",
    "read",
    "debate",
    "methods",
    "argument",
    "study",
    "research",
  ],
  creative: ["brand", "story", "narrative", "design"],
  business: ["supplier", "materials", "sample", "samples"],
};

const EXPLORATION_WORDS = [
  "explore",
  "research",
  "read",
  "gather",
  "learn",
  "sources",
  "scout",
];
const EXECUTION_WORDS = [
  "execute",
  "practice",
  "apply",
  "review",
  "build",
  "drill",
  "ship",
];

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clampText(value: string, maxChars: number) {
  const clean = normalizeText(value);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function firstSentence(value: string) {
  const clean = normalizeText(value);
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return match?.[1]?.trim() || clean;
}

function parseDateOnly(value: string) {
  // Always interpret as UTC date boundary to avoid TZ drift.
  const parts = value.split("-");
  const year = Number(parts[0] ?? "0");
  const month = Number(parts[1] ?? "1");
  const day = Number(parts[2] ?? "1");
  return new Date(Date.UTC(year, month, day));
}

function daysBetween(start: Date, end: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / msPerDay));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateKeysInRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = parseDateOnly(start);
  const last = parseDateOnly(end);
  while (cursor.getTime() <= last.getTime()) {
    dates.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function dayStartIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

function dayAfterIso(date: string) {
  const next = parseDateOnly(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function isoWeekday(date: string) {
  const day = parseDateOnly(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function decanDayIndex(start: string, date: string) {
  return daysBetween(parseDateOnly(start), parseDateOnly(date)) + 1;
}

function countProgressMarkers(text: string) {
  const lower = text.toLowerCase();
  let total = 0;
  for (const marker of PROGRESS_MARKERS) {
    const regex = new RegExp(`\\b${marker}\\b`, "g");
    total += (lower.match(regex) ?? []).length;
  }
  return total;
}

function countRefinementHits(text: string) {
  const lower = text.toLowerCase();
  let total = 0;
  for (const term of REFINEMENT_TERMS) {
    const regex = new RegExp(`\\b${term}\\b`, "g");
    total += (lower.match(regex) ?? []).length;
  }
  return total;
}

function scoreEvidenceLine(text: string, hasDetails: boolean) {
  const markers = countProgressMarkers(text);
  const lengthScore = Math.min(2, Math.floor(text.length / 60));
  return markers * 3 + lengthScore + (hasDetails ? 1 : 0);
}

function isStructuralTag(tag: string) {
  const lower = normalizeText(tag).toLowerCase();
  return lower === "planner" || lower.startsWith("kind:") ||
    lower.startsWith("state:");
}

function badgeTags(badge: BadgeRow) {
  return (badge.tags ?? [])
    .map((tag) => normalizeText(tag))
    .filter((tag) => tag.length > 0);
}

function contentTags(badge: BadgeRow) {
  return badgeTags(badge).filter((tag) => !isStructuralTag(tag));
}

function plannerKindFromBadge(badge: BadgeRow): PlannerKind | null {
  const tags = badgeTags(badge).map((tag) => tag.toLowerCase());
  if (tags.includes("kind:todo")) return "todo";
  if (tags.includes("kind:nutrition")) return "nutrition";

  const eventId = normalizeText(badge.event_id).toLowerCase();
  if (eventId.startsWith("planner-todo:")) return "todo";
  if (eventId.startsWith("planner-nutrition:")) return "nutrition";

  const title = normalizeText(badge.title).toLowerCase();
  if (title.includes("to-do")) return "todo";
  if (title.includes("nutrition")) return "nutrition";
  return null;
}

function plannerStateFromBadge(badge: BadgeRow): PlannerState {
  const tags = badgeTags(badge).map((tag) => tag.toLowerCase());
  if (tags.includes("state:done")) return "done";
  if (tags.includes("state:partial") || tags.includes("state:in_progress")) {
    return "partial";
  }
  if (tags.includes("state:skipped")) return "skipped";
  if (tags.includes("state:pending")) return "pending";

  const title = normalizeText(badge.title).toLowerCase();
  if (title.startsWith("completed ")) return "done";
  if (title.startsWith("in-progress ") || title.startsWith("partial ")) {
    return "partial";
  }
  if (title.startsWith("skipped ")) return "skipped";
  return "unknown";
}

function plannerLabelFromTitle(
  title: string,
  kind: PlannerKind,
) {
  let cleaned = normalizeText(title);
  const patterns = kind === "todo"
    ? [
      /^completed to-do:\s*/i,
      /^in-progress to-do:\s*/i,
      /^skipped to-do:\s*/i,
      /^to-do:\s*/i,
    ]
    : [
      /^completed nutrition:\s*/i,
      /^partial nutrition:\s*/i,
      /^skipped nutrition:\s*/i,
      /^nutrition:\s*/i,
    ];

  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  return normalizeText(cleaned);
}

function normalizePlannerDetails(details: string) {
  const cleaned = normalizeText(details);
  if (!cleaned.length) return "";

  const pieces = cleaned.split(".").map((part) => normalizeText(part)).filter(
    Boolean,
  );
  const kept: string[] = [];

  for (const piece of pieces) {
    const lower = piece.toLowerCase();
    if (
      lower.startsWith("planner to-do for ") ||
      lower.startsWith("planner nutrition entry for ")
    ) {
      continue;
    }
    if (lower.startsWith("state:")) continue;
    if (lower.startsWith("source:")) {
      kept.push(`source ${normalizeText(piece.slice("source:".length))}`);
      continue;
    }
    if (lower.startsWith("purpose:")) {
      kept.push(`purpose ${normalizeText(piece.slice("purpose:".length))}`);
      continue;
    }
    kept.push(piece);
  }

  return kept.join(". ").trim();
}

function normalizedBadgeTitle(badge: BadgeRow) {
  const rawTitle = normalizeText(badge.title);
  const plannerKind = plannerKindFromBadge(badge);
  if (!plannerKind) return rawTitle;

  const label = plannerLabelFromTitle(rawTitle, plannerKind);
  if (!label.length) return rawTitle;

  const plannerState = plannerStateFromBadge(badge);
  if (plannerKind === "todo") {
    if (plannerState === "done") return `Completed task: ${label}`;
    if (plannerState === "partial") return `In-progress task: ${label}`;
    if (plannerState === "skipped") return `Skipped task: ${label}`;
    return `Task: ${label}`;
  }

  if (plannerState === "done") return `Completed nutrition: ${label}`;
  if (plannerState === "partial") return `Partial nutrition: ${label}`;
  if (plannerState === "skipped") return `Skipped nutrition: ${label}`;
  return `Nutrition: ${label}`;
}

function normalizedBadgeDetails(badge: BadgeRow) {
  const rawDetails = normalizeText(badge.details);
  if (!rawDetails.length) return "";
  if (!plannerKindFromBadge(badge)) return rawDetails;
  return normalizePlannerDetails(rawDetails);
}

function badgeKeywordText(badge: BadgeRow) {
  return `${normalizedBadgeTitle(badge)} ${normalizedBadgeDetails(badge)}`
    .trim();
}

function badgeExampleLabel(badge: BadgeRow) {
  const plannerKind = plannerKindFromBadge(badge);
  if (plannerKind) {
    const label = plannerLabelFromTitle(
      normalizeText(badge.title),
      plannerKind,
    );
    if (label.length) return label;
  }
  return normalizedBadgeTitle(badge);
}

function topExamples(labels: string[]) {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const key = normalizeText(label);
    if (!key.length) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([label]) => label);
}

function joinExamples(labels: string[]) {
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

function reflectionThreadLabel(
  raw: string | null | undefined,
  plannerSummary?: PlannerSummary,
  topTags: string[] = [],
) {
  const value = normalizeText(raw);
  const lower = value.toLowerCase();
  const tagText = topTags.join(" ").toLowerCase();
  const nutritionExamples =
    plannerSummary?.nutritionExamples.map((item) => item.toLowerCase()) ?? [];
  const todoExamples =
    plannerSummary?.todoExamples.map((item) => item.toLowerCase()) ?? [];
  const journalExamples =
    plannerSummary?.journalExamples.map((item) => item.toLowerCase()) ?? [];

  if (
    nutritionExamples.includes(lower) ||
    /\b(nutrition|meal|food|water|hydration|vitamin|supplement|coq|protein|body)\b/
      .test(`${lower} ${tagText}`)
  ) {
    return "body support";
  }
  if (
    todoExamples.includes(lower) ||
    /\b(task|to-do|todo|work|planner|project|finish|build|draft)\b/.test(
      `${lower} ${tagText}`,
    )
  ) {
    return "visible work";
  }
  if (
    journalExamples.includes(lower) ||
    /\b(journal|note|record|truth|question|detail|witness)\b/.test(
      `${lower} ${tagText}`,
    )
  ) {
    return "truthful witness";
  }
  if (!value) return "one thread";
  if (value.length <= 3 || /^[a-z]\d/i.test(value)) return "one thread";
  return value;
}

function reflectionAccountThreads(
  plannerSummary: PlannerSummary,
  topTags: string[] = [],
) {
  const threads: string[] = [];
  if (
    plannerSummary.nutritionDone + plannerSummary.nutritionPartial +
        plannerSummary.nutritionSkipped + plannerSummary.nutritionPending >
      0
  ) {
    threads.push("body support");
  }
  if (
    plannerSummary.todoDone + plannerSummary.todoPartial +
        plannerSummary.todoSkipped + plannerSummary.todoPending >
      0
  ) {
    threads.push("visible work");
  }
  if (
    plannerSummary.journalExamples.length > 0 ||
    topTags.some((tag) =>
      /\b(journal|truth|record|note|reflection|witness)\b/i.test(tag)
    )
  ) {
    threads.push("truthful witness");
  }
  if (
    threads.length === 0 &&
    topTags.some((tag) => /\b(study|learn|read|node|knowledge)\b/i.test(tag))
  ) {
    threads.push("study");
  }
  return [...new Set(threads)].slice(0, 3);
}

function reflectionAccountLine(
  plannerSummary: PlannerSummary,
  topTags: string[] = [],
) {
  const threads = reflectionAccountThreads(plannerSummary, topTags);
  if (threads.length >= 2) {
    return `This decan held ${joinExamples(threads)} in view.`;
  }
  if (threads.length === 1) {
    return `This decan gathered around ${
      threads[0]
    }: what was kept, what stayed open, and what measure is needed next.`;
  }
  return "This decan asks for a whole view: what was tended, what stayed quiet, and what deserves clearer measure.";
}

function reflectionStatePhrase(
  label: string,
  done: number,
  partial: number,
  skipped: number,
  pending: number,
) {
  const open = skipped + pending;
  if (done > 0 && open > 0) {
    return `${label} was partly kept and partly still open`;
  }
  if (done > 0 && partial > 0) {
    return `${label} had completion and unfinished movement`;
  }
  if (done > 0) return `${label} was kept`;
  if (partial > 0 && open > 0) {
    return `${label} moved but still needs a clean close`;
  }
  if (partial > 0) return `${label} was in motion`;
  if (open > 0) return `${label} stayed open`;
  return "";
}

function reflectionWholeAccountSignalLine(
  plannerSummary: PlannerSummary,
  evidenceCount: number,
) {
  const phrases = [
    reflectionStatePhrase(
      "body support",
      plannerSummary.nutritionDone,
      plannerSummary.nutritionPartial,
      plannerSummary.nutritionSkipped,
      plannerSummary.nutritionPending,
    ),
    reflectionStatePhrase(
      "visible work",
      plannerSummary.todoDone,
      plannerSummary.todoPartial,
      plannerSummary.todoSkipped,
      plannerSummary.todoPending,
    ),
  ].filter((phrase) => phrase.length > 0);

  if (plannerSummary.journalExamples.length > 0) {
    phrases.push("what you named gave the day a witness");
  } else if (evidenceCount > plannerSummary.total) {
    phrases.push("the day held more than planner marks");
  }

  if (phrases.length >= 2) {
    return `The shape is mixed: ${joinExamples(phrases)}.`;
  }
  if (phrases.length === 1) {
    return `The clearest shape is this: ${phrases[0]}.`;
  }
  return "The visible signal is still thin, so the reflection should stay honest before it becomes directive.";
}

function reflectionCaseThreadLine(
  situation: MaatSituationInterpretation,
) {
  const diagnosis = situation.renderContract?.diagnosis ??
    situation.userFacingDiagnosis;
  if (situation.selectedOffering === "reduce_and_complete_one") {
    return `One thread inside the larger pattern needs clearer measure: ${diagnosis} The useful correction is a smaller surface, not a harder push.`;
  }
  if (situation.selectedOffering === "merge_records") {
    return `One thread inside the larger pattern needs cleaner measure: ${diagnosis} The day gets clearer when one real act is measured as one act.`;
  }
  if (situation.selectedOffering === "record_what_was_done") {
    return `One thread inside the larger pattern is a witness gap: ${diagnosis} The work is to bring what happened into a truthful form.`;
  }
  if (
    situation.selectedOffering === "release_unrealistic_target" ||
    situation.selectedOffering === "release_without_guilt"
  ) {
    return `One thread inside the larger pattern asks for release: ${diagnosis} Right order may mean setting down what no longer belongs on your active list.`;
  }
  if (situation.selectedOffering === "anchor_one_thing") {
    return `One thread inside the larger pattern needs an anchor: ${diagnosis} One portable anchor is more useful than a full routine that cannot travel.`;
  }
  if (situation.selectedOffering === "write_record") {
    return `One thread inside the larger pattern is truthful witness: ${diagnosis} One concrete detail can help what moved become clear enough to choose from.`;
  }
  if (
    situation.selectedOffering === "set_finish_condition" ||
    situation.selectedOffering === "finish_condition"
  ) {
    return `One thread inside the larger pattern needs a finish line: ${diagnosis} The next act is measure before effort.`;
  }
  return `One thread inside the larger pattern needs a direct answer: ${diagnosis} The next step should answer that case directly.`;
}

function reflectionQuestionLine(
  plannerSummary: PlannerSummary,
  topTags: string[] = [],
) {
  const threads = reflectionAccountThreads(plannerSummary, topTags);
  if (threads.length >= 2) {
    return `What one measure would make ${
      joinExamples(threads)
    } easier to keep together next decan?`;
  }
  if (threads.length === 1) {
    return `What one measure would let ${
      threads[0]
    } become easier to keep next decan?`;
  }
  return "What one mark would make the next decan easier to read truthfully?";
}

function buildPlannerSummary(badges: BadgeRow[]): PlannerSummary {
  const todoLabels: string[] = [];
  const nutritionLabels: string[] = [];
  const journalLabels: string[] = [];
  let todoDone = 0;
  let todoPartial = 0;
  let todoSkipped = 0;
  let todoPending = 0;
  let nutritionDone = 0;
  let nutritionPartial = 0;
  let nutritionSkipped = 0;
  let nutritionPending = 0;

  for (const badge of badges) {
    const plannerKind = plannerKindFromBadge(badge);
    if (!plannerKind) {
      const label = badgeExampleLabel(badge);
      if (label.length) journalLabels.push(label);
      continue;
    }

    const state = plannerStateFromBadge(badge);
    const label = badgeExampleLabel(badge);
    if (plannerKind === "todo") {
      if (state === "done") todoDone++;
      else if (state === "partial") todoPartial++;
      else if (state === "skipped") todoSkipped++;
      else if (state === "pending") todoPending++;
      if (label.length) todoLabels.push(label);
      continue;
    }

    if (state === "done") nutritionDone++;
    else if (state === "partial") nutritionPartial++;
    else if (state === "skipped") nutritionSkipped++;
    else if (state === "pending") nutritionPending++;
    if (label.length) nutritionLabels.push(label);
  }

  return {
    total: todoDone + todoPartial + todoSkipped + todoPending + nutritionDone +
      nutritionPartial +
      nutritionSkipped +
      nutritionPending,
    todoDone,
    todoPartial,
    todoSkipped,
    todoPending,
    nutritionDone,
    nutritionPartial,
    nutritionSkipped,
    nutritionPending,
    todoExamples: topExamples(todoLabels),
    nutritionExamples: topExamples(nutritionLabels),
    journalExamples: topExamples(journalLabels),
  };
}

function buildPlannerSummaryLine(summary: PlannerSummary) {
  if (!summary.total) return "";

  const parts: string[] = [];
  const todoParts: string[] = [];
  const nutritionParts: string[] = [];

  if (summary.todoDone) todoParts.push(`${summary.todoDone} done`);
  if (summary.todoPartial) todoParts.push(`${summary.todoPartial} partial`);
  if (summary.todoSkipped) todoParts.push(`${summary.todoSkipped} skipped`);
  if (summary.todoPending) {
    todoParts.push(`${summary.todoPending} unchecked`);
  }
  if (todoParts.length) {
    parts.push(`to-dos ${todoParts.join(", ")}`);
  }

  if (summary.nutritionDone) {
    nutritionParts.push(`${summary.nutritionDone} done`);
  }
  if (summary.nutritionPartial) {
    nutritionParts.push(`${summary.nutritionPartial} partial`);
  }
  if (summary.nutritionSkipped) {
    nutritionParts.push(`${summary.nutritionSkipped} skipped`);
  }
  if (summary.nutritionPending) {
    nutritionParts.push(`${summary.nutritionPending} unchecked`);
  }
  if (nutritionParts.length) {
    parts.push(`nutrition ${nutritionParts.join(", ")}`);
  }

  const examples: string[] = [];
  if (summary.todoExamples.length) {
    examples.push(`tasks: ${joinExamples(summary.todoExamples)}`);
  }
  if (summary.nutritionExamples.length) {
    examples.push(`nutrition: ${joinExamples(summary.nutritionExamples)}`);
  }

  return `${parts.join("; ")}${
    examples.length ? `. Examples: ${examples.join("; ")}.` : "."
  }`;
}

function buildMaatFallbackNextStep(
  snapshot: MaatDimensionSnapshot | null | undefined,
  fallback: string,
) {
  if (!snapshot) return fallback;
  const situation = reflectionSituation(snapshot);
  if (situation) {
    const action = actionFragment(situation.concreteAction);
    if (snapshot.reflectionMove === "correct") {
      return `Before the next decan opens, ${action}`;
    }
    if (snapshot.reflectionMove === "inquire") {
      return `Before the next decan opens, ${action}`;
    }
    return `Next decan, protect what is working: ${action}`;
  }

  const axisSteps: Record<MaatAxisCode, string> = {
    T: "write one truthful mark with one concrete detail",
    M: "track one number or finish condition",
    H: "protect the rhythm that keeps effort livable",
    V: "reduce one burden before adding another",
    J: "choose the proportionate next step",
    S: "protect one provision thread",
    E: "restore one life-supporting rhythm",
    R: "downshift force before adding more",
    C: "keep one role or promise coherent",
  };
  const action = axisSteps[snapshot.leadAxis];

  if (snapshot.reflectionMove === "correct") {
    return `Next decan, ${action}. Make the correction small enough to keep.`;
  }
  if (snapshot.reflectionMove === "inquire") {
    return `Before the next decan opens, ${action}. Let that mark guide the next step.`;
  }
  return `Next decan, protect what worked: ${action}.`;
}

function actionFragment(value: string) {
  const clean = value.trim().replace(/[.!?]+$/, "");
  if (!clean) return "choose one concrete action";
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

function reflectionSituation(
  snapshot: MaatDimensionSnapshot | null | undefined,
) {
  if (!snapshot) return null;
  return interpretMaatSituation({
    snapshot,
    mode: snapshot.reflectionMove === "affirm" ? "strength" : "drift",
    triggerReason: `decan_reflection:${snapshot.reflectionMove}`,
  });
}

function maatAxisLabel(axis: MaatAxisCode | string | null | undefined) {
  const labels: Record<MaatAxisCode, string> = {
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
  return labels[axis as MaatAxisCode] ?? "Ma'at";
}

function parseWordRange(value: string) {
  const match = value.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return { min: null, max: null };
  return {
    min: Number(match[1]),
    max: Number(match[2]),
  };
}

function buildReflectionOutputPlan(params: {
  targetWordRange: string;
  memoryEvidencePhrases: string[];
  snapshot: MaatDimensionSnapshot;
  calendarFrame?: ReflectionCalendarFrame | null;
  userPatternProfile?: ReflectionUserPatternProfile | null;
  translatedProfileContext?: MaatTranslatedProfileContext | null;
  profileFacts?: MaatUserProfileFact[] | null;
  reflectionProfile?: ReflectionProfileRow | null;
  guidanceOutcomes?: ProfileGuidanceOutcomeStats | null;
  historyMetrics?: HistoryMetrics[] | null;
}): ControlledGeneratedTextPlan {
  const wordRange = parseWordRange(params.targetWordRange);
  const leadAxisLabel = maatAxisLabel(params.snapshot.leadAxis);
  const situation = reflectionSituation(params.snapshot);
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame: params.calendarFrame ?? null,
    snapshot: params.snapshot,
    normalizedObligationThreads:
      params.snapshot.source.ledger?.obligation_threads ?? null,
    translatedProfileContext: params.translatedProfileContext ?? null,
    userPatternProfile: params.userPatternProfile ?? null,
    immediateCaseThread: situation?.renderContract
      ? {
        caseKey: situation.key,
        offering: situation.selectedOffering,
        diagnosis: situation.renderContract.diagnosis,
        concreteAction: situation.renderContract.concreteAction,
      }
      : null,
  });
  const reflectionExamples = selectMaatReflectionExamples({
    caseKey: situation?.key ?? null,
    offering: situation?.selectedOffering ?? null,
    decanName: params.calendarFrame?.decanName ?? null,
    monthName: params.calendarFrame?.monthName ?? null,
    seasonName: params.calendarFrame?.seasonName ?? null,
    userPattern: [
      ...(params.userPatternProfile?.roleSignals ?? []),
      params.userPatternProfile?.routineStyle ?? "",
      params.userPatternProfile?.recordStyle ?? "",
      params.userPatternProfile?.careDirection ?? "",
      params.userPatternProfile?.preferredRegister ?? "",
    ].filter(Boolean),
    evidenceShape: [
      ...alignmentMap.alignedSignals,
      ...alignmentMap.underansweredSignals,
      params.userPatternProfile?.routineStyle ?? "",
      params.userPatternProfile?.recordStyle ?? "",
    ].filter(Boolean),
    limit: 2,
  });
  const arcPlan = buildReflectionArcPlan({
    calendarFrame: params.calendarFrame ?? null,
    alignmentMap,
    userPatternProfile: params.userPatternProfile ?? null,
    translatedProfileContext: params.translatedProfileContext ?? null,
    selectedExamples: reflectionExamples,
  });
  const normalizedThreads = params.snapshot.source.ledger?.obligation_threads ??
    null;
  const recurringNutritionThread = singleRecurringNutritionThread(
    normalizedThreads,
  );
  const preliminaryEvidencePhrases = recurringNutritionThread
    ? [
      [
        `${
          normalizeText(recurringNutritionThread.label) || "body support"
        } support appeared`,
        recurringNutritionThread.sources[0]
          ? `from ${recurringNutritionThread.sources[0]}`
          : "",
        recurringNutritionThread.purposes[0]
          ? `for ${recurringNutritionThread.purposes[0]}`
          : "",
      ].filter(Boolean).join(" "),
    ]
    : params.memoryEvidencePhrases;
  const profileSnapshot = buildReflectionProfileSnapshot({
    profileFacts: params.profileFacts ?? [],
    translatedProfileContext: params.translatedProfileContext ?? null,
    reflectionProfile: params.reflectionProfile ?? null,
    normalizedObligationThreads: normalizedThreads,
    domainBalance: alignmentMap.domainBalance,
    historyMetrics: params.historyMetrics ?? [],
    calendarFrame: params.calendarFrame ?? null,
    evidencePhrases: preliminaryEvidencePhrases,
    maatSnapshot: params.snapshot,
    caseKey: situation?.key ?? null,
    selectedOffering: situation?.selectedOffering ?? null,
  });
  const evidencePhrases = [
    profileSnapshot.bestEvidenceAnchor?.claim,
    ...params.memoryEvidencePhrases,
  ].filter((phrase): phrase is string => Boolean(normalizeText(phrase)));
  const dedupedEvidencePhrases = [
    ...new Set(evidencePhrases.map((phrase) => normalizeText(phrase))),
  ].slice(0, 5);
  const evidenceAnchors = evidenceAnchorsFromMemoryPhrases(
    dedupedEvidencePhrases.length
      ? dedupedEvidencePhrases
      : preliminaryEvidencePhrases,
    {
      prefix: "reflection",
      sourceType: "memory",
      limit: 5,
      required: true,
    },
  );
  return {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    constitutionVersion: MAAT_CONSTITUTION_VERSION,
    northStar: MAAT_OUTPUT_NORTH_STAR,
    forcePrinciple: MAAT_OUTPUT_FORCE_PRINCIPLE,
    kind: "decan_reflection",
    speechAct: "witness",
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_concrete_evidence",
    emotionalTemperature: "medium",
    targetWordRange: params.targetWordRange,
    requiredEvidenceDetailCount: evidenceAnchors.length > 0 ? 1 : 0,
    leadAxis: params.snapshot.leadAxis,
    leadAxisLabel,
    reflectionMove: params.snapshot.reflectionMove,
    closingInstruction: buildMaatFallbackNextStep(
      params.snapshot,
      "Close with one concrete next step.",
    ),
    caseKey: situation?.key ?? null,
    selectedOffering: situation?.selectedOffering ?? null,
    voiceDirection: situation?.voiceDirection ?? null,
    offeringRender: situation?.renderContract
      ? {
        diagnosis: situation.renderContract.diagnosis,
        concreteAction: situation.renderContract.concreteAction,
        caseConcreteAction: situation.renderContract.caseConcreteAction,
        offeringRationale: situation.renderContract.offeringRationale,
        exampleId: null,
        exampleNudge: null,
        exampleReflection: null,
        voiceDirection: situation.renderContract.voiceDirection,
        bannedPhrases: situation.renderContract.bannedPhrases,
      }
      : null,
    exampleReferences: [],
    reflectionExampleReferences: reflectionExamples,
    evidenceAnchors,
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
      instruction:
        "Name at most one concrete evidence detail once, then translate it into the larger pattern. Do not repeat the same nutrition item, source, purpose, task, count, or date; after the anchor, use category language.",
    },
    normalizedObligationThreads:
      params.snapshot.source.ledger?.obligation_threads ?? null,
    reflectionCalendarFrame: params.calendarFrame ?? null,
    reflectionAlignmentMap: alignmentMap,
    reflectionUserPatternProfile: params.userPatternProfile ?? null,
    reflectionProfileSnapshot: profileSnapshot,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: [
      "let_calendar_arc_govern_first_sentence",
      "balance_domains_before_selecting_topic",
      "treat_occurrence_count_as_frequency_not_meaning",
      "use_profile_lens_when_evidence_is_thin",
      "synthesize_whole_decan_account",
      "read_user_record_against_calendar_arc",
      "name_one_alignment_signal",
      "name_one_improvement_direction",
      "anchor_once_in_specific_evidence",
      "interpret_trajectory",
      "keep_gravity_proportionate_to_signal",
      "place_case_key_as_one_thread_not_the_whole_reflection",
      "use_case_thread_once_as_supporting_detail",
      "connect_to_decan_theme",
      arcPlan.closingKind === "question"
        ? "close_with_one_specific_question"
        : "close_with_one_specific_charge",
      "close_with_dignity",
    ],
    surfaceConstraints: {
      wordsMin: wordRange.min,
      wordsMax: wordRange.max,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: [
        "output_control",
        "output control",
        "score",
        "gate",
        "band",
        "matrix",
        "slug",
      ],
    },
  };
}

async function fetchReflectionProfile(
  supabaseClient: any,
  userId: string,
): Promise<ReflectionProfileRow | null> {
  if (!supabaseClient || !userId) {
    return null;
  }
  try {
    const { data, error } = await supabaseClient
      .from("reflection_profiles")
      .select(
        "top_nodes,top_edges,dominant_patterns,tension_pairs,maat_score,isfet_risk_score,last_computed_at",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.log(
        "reflection_profiles fetch error:",
        error.message ?? error,
      );
      return null;
    }
    return (data ?? null) as ReflectionProfileRow | null;
  } catch (err) {
    console.log("reflection_profiles fetch threw:", err?.message ?? err);
    return null;
  }
}

async function fetchMaatSnapshotCount(
  supabaseClient: any,
  userId: string,
  decanPeriodKey: string,
): Promise<number> {
  if (!supabaseClient || !userId || !decanPeriodKey) {
    return 0;
  }
  try {
    const { count, error } = await supabaseClient
      .from("maat_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("decan_period_key", decanPeriodKey);
    if (error) {
      console.log("maat_snapshots count error:", error.message ?? error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.log("maat_snapshots count threw:", err?.message ?? err);
    return 0;
  }
}

async function fetchGuidanceGoalProfile(
  supabaseClient: any,
  userId: string,
): Promise<GuidanceGoalProfile | null> {
  if (!supabaseClient || !userId) return null;
  try {
    const { data: nutritionRows } = await supabaseClient
      .from("nutrition_items")
      .select("id,nutrient,purpose,enabled")
      .eq("user_id", userId)
      .eq("enabled", true)
      .limit(5);
    const { data: flowRows } = await supabaseClient
      .from("flows")
      .select("id,name,notes,active,is_hidden")
      .eq("user_id", userId)
      .eq("active", true)
      .eq("is_hidden", false)
      .limit(10);

    const axes = new Set<GuidanceGoalProfile["axes"][number]>();
    const source: string[] = [];
    const activeFlowIds: Array<string | number> = [];
    let nutritionGoal = (nutritionRows ?? []).length > 0;
    let careObligations = false;
    let measureWeek = false;
    let restRestraint = false;
    let cosmicRhythm = false;

    if (nutritionGoal) {
      source.push("nutrition_items");
      axes.add("S");
      axes.add("E");
      axes.add("H");
    }

    for (const row of flowRows ?? []) {
      activeFlowIds.push(row.id);
      const text = `${row.name ?? ""} ${row.notes ?? ""}`.toLowerCase();
      if (
        /\b(food|water|hydration|hydrate|nutrition|meal|provision)\b/.test(text)
      ) {
        nutritionGoal = true;
        source.push(`flow:${row.id}:provision`);
        axes.add("S");
        axes.add("E");
        axes.add("H");
      }
      if (
        /\b(child|dependent|elder|family|care|caregiving|medicine|support)\b/
          .test(text)
      ) {
        careObligations = true;
        source.push(`flow:${row.id}:care`);
        axes.add("V");
        axes.add("J");
        axes.add("S");
      }
      if (/\b(measure|record|track|timer|reps|count|review)\b/.test(text)) {
        measureWeek = true;
        source.push(`flow:${row.id}:measure`);
        axes.add("M");
        axes.add("T");
      }
      if (/\b(rest|sleep|pacing|restraint|pause|evening)\b/.test(text)) {
        restRestraint = true;
        source.push(`flow:${row.id}:restraint`);
        axes.add("R");
        axes.add("H");
      }
      if (/\b(sky|star|decan|dawn|sunrise|cosmic)\b/.test(text)) {
        cosmicRhythm = true;
        source.push(`flow:${row.id}:cosmic`);
        axes.add("E");
        axes.add("C");
      }
    }

    if (
      !nutritionGoal && !careObligations && !measureWeek && !restRestraint &&
      !cosmicRhythm
    ) {
      return null;
    }

    const key: GuidanceGoalProfile["key"] = nutritionGoal
      ? "provision"
      : careObligations
      ? "care_dependents"
      : measureWeek
      ? "measure"
      : restRestraint
      ? "rest_restraint"
      : cosmicRhythm
      ? "cosmic_rhythm"
      : "default_decan";

    return {
      key,
      active: true,
      axes: [...axes],
      nutritionGoal,
      careObligations,
      measureWeek,
      activeFlowIds,
      source,
    };
  } catch (err) {
    console.log("guidance goal profile fetch threw:", err?.message ?? err);
    return null;
  }
}

async function fetchGuidancePersonalBaseline(
  supabaseClient: any,
  userId: string,
): Promise<GuidancePersonalBaseline | null> {
  if (!supabaseClient || !userId) return null;
  try {
    const { data, error } = await supabaseClient
      .from("maat_user_baselines")
      .select("computed_at,stats")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const stats = data.stats ?? {};
    return {
      computedAt: data.computed_at ?? null,
      snapshotCount: Number(stats.snapshot_count ?? 0),
      medianScore: stats.median_score ?? null,
      medianBandRank: stats.median_band_rank ?? null,
      nutritionDoneRate: stats.nutrition_done_rate ?? null,
      axisMedians: stats.axis_medians ?? null,
    };
  } catch (err) {
    console.log("guidance personal baseline fetch threw:", err?.message ?? err);
    return null;
  }
}

async function fetchProfileGuidanceOutcomeStats(
  supabaseClient: any,
  userId: string,
): Promise<ProfileGuidanceOutcomeStats | null> {
  if (!supabaseClient || !userId) return null;
  const since = new Date();
  since.setDate(since.getDate() - 90);
  try {
    const { data, error } = await supabaseClient
      .from("maat_restoration_attempts")
      .select("status")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .limit(100);
    if (error) {
      console.log(
        "maat_restoration_attempts profile fetch error:",
        error.message ?? error,
      );
      return null;
    }
    const stats: ProfileGuidanceOutcomeStats = {
      opened: 0,
      acted: 0,
      resolved: 0,
      dismissed: 0,
      expired: 0,
    };
    for (const row of data ?? []) {
      const status = normalizeText(row.status).toLowerCase();
      if (status === "opened") stats.opened++;
      if (status === "acted") stats.acted++;
      if (status === "resolved") stats.resolved++;
      if (status === "dismissed") stats.dismissed++;
      if (status === "expired") stats.expired++;
    }
    return stats.opened + stats.acted + stats.resolved + stats.dismissed +
          stats.expired > 0
      ? stats
      : null;
  } catch (err) {
    console.log(
      "maat_restoration_attempts profile fetch threw:",
      err?.message ?? err,
    );
    return null;
  }
}

async function fetchProfileFlowBehaviorStats(
  supabaseClient: any,
  userId: string,
): Promise<ProfileFlowBehaviorStats | null> {
  if (!supabaseClient || !userId) return null;
  try {
    const { data, error } = await supabaseClient
      .from("flow_outcomes")
      .select("events_total,events_completed,edit_count,accepted_as_is")
      .eq("user_id", userId)
      .order("recorded_at", { ascending: false })
      .limit(20);
    if (error) {
      console.log("flow_outcomes profile fetch error:", error.message ?? error);
      return null;
    }
    const rows = data ?? [];
    if (!rows.length) return null;
    const stats: ProfileFlowBehaviorStats = {
      flowCount: 0,
      eventsTotal: 0,
      eventsCompleted: 0,
      editCount: 0,
      acceptedAsIsCount: 0,
    };
    for (const row of rows) {
      stats.flowCount++;
      stats.eventsTotal += Number(row.events_total ?? 0);
      stats.eventsCompleted += Number(row.events_completed ?? 0);
      stats.editCount += Number(row.edit_count ?? 0);
      if (row.accepted_as_is) stats.acceptedAsIsCount++;
    }
    return stats;
  } catch (err) {
    console.log("flow_outcomes profile fetch threw:", err?.message ?? err);
    return null;
  }
}

function resolveThemeAxis(name?: string | null) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes("foreleg") || lower.includes("mswt")) {
    return { primary: "stabilization and form", contrast: "expansion" };
  }
  if (lower.includes("birth of ra") || lower.includes("ra")) {
    return { primary: "ignition and initiative", contrast: "hesitation" };
  }
  if (lower.includes("inundation") || lower.includes("flood")) {
    return { primary: "replenishment", contrast: "overdrive" };
  }
  if (lower.includes("harvest")) {
    return { primary: "consolidation and integration", contrast: "sprawl" };
  }
  return null;
}

function topTags(badges: BadgeRow[]) {
  const counts = new Map<string, number>();
  for (const b of badges) {
    contentTags(b).forEach((tag) => {
      const key = tag.trim();
      if (!key) return;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return "";
  return sorted.slice(0, 8).map(([tag, count]) => `${tag}(${count})`).join(
    ", ",
  );
}

const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "your",
  "into",
  "about",
  "after",
  "before",
  "using",
  "until",
  "over",
  "under",
  "some",
  "more",
  "have",
  "were",
  "been",
  "they",
  "them",
  "when",
  "what",
  "where",
  "which",
  "across",
  "through",
  "while",
  "into",
  "again",
  "around",
  "took",
  "made",
  "make",
  "doing",
  "done",
  "notes",
  "note",
  "still",
  "very",
  "much",
  "then",
  "than",
  "just",
  "also",
  "like",
  "somehow",
]);

function keywordCountsFromBadges(badges: BadgeRow[]) {
  const counts = new Map<string, number>();
  for (const b of badges) {
    const text = badgeKeywordText(b).toLowerCase();
    for (const word of text.split(/[^a-z]+/).filter((w) => w.length >= 4)) {
      if (STOP_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}

function pickTopKey(counts: Map<string, number> | undefined | null) {
  if (!counts || !counts.size) return null;
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    null;
}

function buildEvidenceEntries(badges: BadgeRow[]): EvidenceEntry[] {
  return badges
    .map((b) => {
      const title = normalizedBadgeTitle(b);
      const details = normalizedBadgeDetails(b);
      if (!title && !details) return null;

      const parts: string[] = [];
      const datePart = b.occurred_on;
      if (datePart) parts.push(datePart);
      if (title) parts.push(title);
      if (details) parts.push(details);
      const tags = contentTags(b).length
        ? `tags: ${contentTags(b).join(", ")}`
        : "";
      if (tags) parts.push(tags);
      const line = parts.join(" - ").trim();
      const hasDetails = !!details;
      return {
        line,
        occurredOn: b.occurred_on,
        occurredAt: null,
        score: scoreEvidenceLine(`${title} ${details}`, hasDetails),
        hasDetails,
      } as EvidenceEntry;
    })
    .filter((e): e is EvidenceEntry => !!e);
}

function selectEvidence(entries: EvidenceEntry[], window: DecanWindow) {
  if (!entries.length) return [];

  const start = parseDateOnly(window.start);
  const end = parseDateOnly(window.end);
  const totalDays = daysBetween(start, end) + 1;
  const bucketSpan = Math.max(1, Math.floor(totalDays / 3));

  function bucketIdx(dateStr: string) {
    const date = parseDateOnly(dateStr);
    const offset = daysBetween(start, date);
    return Math.min(2, Math.floor(offset / bucketSpan));
  }

  const buckets: EvidenceEntry[][] = [[], [], []];
  for (const entry of entries) {
    const idx = bucketIdx(entry.occurredOn);
    buckets[idx].push(entry);
  }

  const MAX_EVIDENCE = 10;
  const MIN_EVIDENCE = Math.min(6, entries.length);
  const selected = new Set<EvidenceEntry>();

  function pickFromBucket(list: EvidenceEntry[], limit: number) {
    const sorted = list
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.occurredOn.localeCompare(b.occurredOn);
      });
    let added = 0;
    for (const entry of sorted) {
      if (selected.size >= MAX_EVIDENCE) break;
      selected.add(entry);
      added++;
      if (added >= limit) break;
    }
  }

  pickFromBucket(buckets[0], 2);
  pickFromBucket(buckets[1], 2);
  pickFromBucket(buckets[2], 2);

  if (selected.size < MIN_EVIDENCE) {
    const remaining = entries
      .filter((e) => !selected.has(e))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.occurredOn.localeCompare(b.occurredOn);
      });
    for (const entry of remaining) {
      if (selected.size >= MAX_EVIDENCE) break;
      selected.add(entry);
      if (selected.size >= MIN_EVIDENCE && selected.size >= entries.length) {
        break;
      }
    }
  }

  return Array.from(selected).sort((a, b) => {
    if (a.occurredOn !== b.occurredOn) {
      return a.occurredOn.localeCompare(b.occurredOn);
    }
    return b.score - a.score;
  });
}

function computeMetrics(
  badges: BadgeRow[],
  window: DecanWindow,
  evidenceCount: number,
): Metrics {
  const badgeCount = badges.length;
  const daySet = new Set<string>();
  let badgesWithDetails = 0;
  let progressMarkersCount = 0;
  let refinementHits = 0;

  for (const b of badges) {
    if (b.occurred_on) daySet.add(b.occurred_on);
    if (normalizedBadgeDetails(b)) badgesWithDetails++;
    const text = badgeKeywordText(b);
    progressMarkersCount += countProgressMarkers(text);
    refinementHits += countRefinementHits(text);
  }

  const tagStr = topTags(badges);
  const tagList = tagStr
    ? tagStr.split(",").map((t) => t.replace(/\(\d+\)$/, "").trim()).filter(
      Boolean,
    )
    : [];

  const keywordCounts = keywordCountsFromBadges(badges);
  const topKeyword = pickTopKey(keywordCounts);
  const topThread = tagList.length ? tagList[0] : topKeyword;

  const start = parseDateOnly(window.start);
  const end = parseDateOnly(window.end);
  const midPoint = Math.floor((daysBetween(start, end) + 1) / 2);
  const earlyCounts = new Map<string, number>();
  const lateCounts = new Map<string, number>();
  let earlyResearch = false;
  let latePractice = false;
  let earlyPractice = false;
  let lateResearch = false;

  for (const b of badges) {
    const day = b.occurred_on ? parseDateOnly(b.occurred_on) : start;
    const offset = daysBetween(start, day);
    const targetMap = offset <= midPoint ? earlyCounts : lateCounts;
    const text = badgeKeywordText(b).toLowerCase();
    if (offset <= midPoint) {
      if (EARLY_RESEARCH_TERMS.some((t) => text.includes(t))) {
        earlyResearch = true;
      }
      if (LATE_PRACTICE_TERMS.some((t) => text.includes(t))) {
        earlyPractice = true;
      }
    } else {
      if (LATE_PRACTICE_TERMS.some((t) => text.includes(t))) {
        latePractice = true;
      }
      if (EARLY_RESEARCH_TERMS.some((t) => text.includes(t))) {
        lateResearch = true;
      }
    }
    const tags = contentTags(b);
    if (tags.length) {
      for (const t of tags) {
        const key = normalizeText(t).toLowerCase();
        if (!key) continue;
        targetMap.set(key, (targetMap.get(key) ?? 0) + 1);
      }
    } else {
      const words = badgeKeywordText(b)
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
      for (const w of words) {
        targetMap.set(w, (targetMap.get(w) ?? 0) + 1);
      }
    }
  }

  const earlyTopThread = pickTopKey(earlyCounts);
  const lateTopThread = pickTopKey(lateCounts);

  const detailsCoverage = badgeCount === 0
    ? 0
    : Math.round((badgesWithDetails / badgeCount) * 100);
  const arcSignals = (earlyResearch && latePractice) ||
    (earlyPractice && lateResearch);
  const clusteredEffort = badgeCount >= 5 && daySet.size <= 3;

  return {
    badgeCount,
    daysActive: daySet.size,
    evidenceCount,
    detailsCoverage,
    progressMarkersCount,
    refinementHits,
    arcSignals,
    clusteredEffort,
    topTags: tagList,
    topThread: topThread ?? null,
    earlyTopThread: earlyTopThread ?? null,
    lateTopThread: lateTopThread ?? null,
  };
}

function buildHistoryComparisons(current: Metrics, history: HistoryMetrics[]) {
  const lines: string[] = [];
  for (const h of history) {
    const deltas: string[] = [];
    if (h.badgeCount !== current.badgeCount) {
      deltas.push(`badges ${h.badgeCount} -> ${current.badgeCount}`);
    }
    if (h.daysActive !== current.daysActive) {
      deltas.push(`active days ${h.daysActive} -> ${current.daysActive}`);
    }
    if (h.progressMarkersCount !== current.progressMarkersCount) {
      deltas.push(
        `refinement marks ${h.progressMarkersCount} -> ${current.progressMarkersCount}`,
      );
    }
    if (h.topThread && current.topThread && h.topThread !== current.topThread) {
      deltas.push(`thread shift ${h.topThread} -> ${current.topThread}`);
    }

    if (deltas.length) {
      lines.push(`Compared to ${h.label}: ${deltas.join(", ")}.`);
    }
  }
  return lines;
}

function computeFallbackMetrics(
  evidenceLines: string[],
  badgeCount: number,
  topTags: string[],
): Metrics {
  const combined = evidenceLines.join(" ");
  const progressMarkersCount = countProgressMarkers(combined);
  const refinementHits = countRefinementHits(combined);
  const daysActive = Math.min(
    badgeCount,
    Math.max(1, Math.floor(badgeCount / 2)),
  );
  const clusteredEffort = badgeCount >= 5 && daysActive <= 3;

  return {
    badgeCount,
    daysActive,
    evidenceCount: evidenceLines.length,
    detailsCoverage: 0,
    progressMarkersCount,
    refinementHits,
    arcSignals: false,
    clusteredEffort,
    topTags,
    topThread: topTags[0] ?? null,
    earlyTopThread: null,
    lateTopThread: null,
  };
}

function dominantVerbsFromText(texts: string[]) {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const lower = t.toLowerCase();
    for (const verb of DOMINANT_VERBS) {
      if (lower.includes(verb)) {
        counts.set(verb, (counts.get(verb) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([verb]) => verb);
}

function disciplineClustersFromText(texts: string[]) {
  const counts = new Map<string, number>();
  for (const [bucket, keywords] of Object.entries(DISCIPLINE_BUCKETS)) {
    let total = 0;
    for (const t of texts) {
      const lower = t.toLowerCase();
      if (keywords.some((k) => lower.includes(k))) {
        total++;
      }
    }
    if (total > 0) counts.set(bucket, total);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([, count]) => count > 0)
    .slice(0, 2)
    .map(([bucket]) => bucket);
}

function repetitionScoreFromBadges(
  badges: BadgeRow[],
  window: DecanWindow | undefined,
) {
  if (!badges.length) return { score: 1, repeatedTitles: [], diversity: 0 };
  const map = new Map<string, Set<string>>();
  for (const b of badges) {
    const title = normalizedBadgeTitle(b).toLowerCase();
    if (!title) continue;
    const day = b.occurred_on ?? window?.start ?? "";
    if (!map.has(title)) map.set(title, new Set<string>());
    map.get(title)!.add(day);
  }
  let maxCount = 1;
  const repeated: string[] = [];
  for (const [title, days] of map.entries()) {
    const size = days.size;
    if (size > maxCount) maxCount = size;
    if (size > 1) repeated.push(title);
  }
  return {
    score: maxCount,
    repeatedTitles: repeated.slice(0, 3),
    diversity: map.size,
  };
}

function progressionFromBadges(
  badges: BadgeRow[],
  window: DecanWindow | undefined,
) {
  if (!badges.length || !window) return null;
  const start = parseDateOnly(window.start);
  const end = parseDateOnly(window.end);
  const mid = Math.floor((daysBetween(start, end) + 1) / 2);
  let earlyExploration = 0;
  let lateExploration = 0;
  let earlyExecution = 0;
  let lateExecution = 0;

  for (const b of badges) {
    const text = badgeKeywordText(b).toLowerCase();
    const day = b.occurred_on ? parseDateOnly(b.occurred_on) : start;
    const offset = daysBetween(start, day);
    const isEarly = offset <= mid;
    const hasExploration = EXPLORATION_WORDS.some((w) => text.includes(w));
    const hasExecution = EXECUTION_WORDS.some((w) => text.includes(w));

    if (isEarly) {
      if (hasExploration) earlyExploration++;
      if (hasExecution) earlyExecution++;
    } else {
      if (hasExploration) lateExploration++;
      if (hasExecution) lateExecution++;
    }
  }

  if (earlyExploration > lateExploration && lateExecution > earlyExecution) {
    return "theory_to_application" as const;
  }
  return null;
}

function computeV3Signals(
  badges: BadgeRow[],
  window: DecanWindow | undefined,
  evidenceLines: string[],
  badgeCount: number,
  topTags: string[],
): V3Signals {
  let metrics: Metrics;
  let anchors: string[] = badges.length
    ? extractAnchors(badges)
    : extractAnchorsFromText(evidenceLines);
  const texts: string[] = [];

  if (badges.length && window) {
    metrics = computeMetrics(badges, window, evidenceLines.length);
    for (const b of badges) {
      texts.push(badgeKeywordText(b));
    }
  } else {
    metrics = computeFallbackMetrics(evidenceLines, badgeCount, topTags);
    texts.push(...evidenceLines);
  }

  const dominantVerbs = dominantVerbsFromText(texts);
  const disciplineClusters = disciplineClustersFromText(texts);
  const repetitionData = badges.length
    ? repetitionScoreFromBadges(badges, window)
    : { score: 1, repeatedTitles: [], diversity: texts.length };
  const progression = badges.length
    ? progressionFromBadges(badges, window)
    : null;

  return {
    metrics,
    anchors,
    dominantVerbs,
    disciplineClusters,
    repetitionScore: repetitionData.score,
    repeatedTitles: repetitionData.repeatedTitles,
    progression,
    diversityScore: repetitionData.diversity,
  };
}

function extractAnchors(badges: BadgeRow[]): string[] {
  const numberUnits = [
    "makes",
    "minutes",
    "rounds",
    "sources",
    "laps",
    "reps",
    "hours",
    "pages",
    "miles",
    "km",
    "sets",
  ];
  const drillPhrases = [
    "footwork",
    "puck",
    "cone work",
    "cones",
    "form shooting",
    "follow-through",
    "follow through",
    "drill",
    "drills",
  ];
  const artifactPhrases = [
    "brand story",
    "supplier",
    "samples",
    "materials",
    "sources",
    "credible sources",
  ];

  type AnchorCandidate = {
    phrase: string;
    type: "number" | "drill" | "artifact" | "refine" | "other";
    order: number;
  };
  const candidates: AnchorCandidate[] = [];
  const seen = new Set<string>();

  badges.forEach((b, idx) => {
    const text = badgeKeywordText(b).toLowerCase();
    if (!text.trim()) return;

    // Numbers + units
    const numRegex =
      /(\d+)\s+(makes?|minutes?|rounds?|sources?|laps?|reps?|hours?|pages?|miles?|km|sets?)/g;
    let m: RegExpExecArray | null;
    while ((m = numRegex.exec(text)) !== null) {
      const phrase = `${m[1]} ${m[2]}`.trim();
      const key = `num:${phrase}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ phrase, type: "number", order: idx });
      }
    }

    // Named drills/actions
    for (const phrase of drillPhrases) {
      if (text.includes(phrase)) {
        const key = `drill:${phrase}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({ phrase, type: "drill", order: idx });
        }
        break;
      }
    }

    // Artifacts
    for (const phrase of artifactPhrases) {
      if (text.includes(phrase)) {
        const key = `artifact:${phrase}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({ phrase, type: "artifact", order: idx });
        }
        break;
      }
    }

    // Refinement verbs
    if (countRefinementHits(text) > 0) {
      const key = "refine:adjust-repeat-measure";
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({
          phrase: "adjust / repeat / measure",
          type: "refine",
          order: idx,
        });
      }
    }
  });

  const buckets: Record<string, AnchorCandidate[]> = {
    number: [],
    drill: [],
    artifact: [],
    refine: [],
    other: [],
  };
  for (const c of candidates) {
    (buckets[c.type] ?? buckets.other).push(c);
  }

  const result: string[] = [];
  const pushIf = (list: AnchorCandidate[]) => {
    for (const c of list) {
      if (result.length >= 4) break;
      if (result.includes(c.phrase)) continue;
      result.push(c.phrase);
      break;
    }
  };

  pushIf(buckets.number);
  pushIf(buckets.drill);
  pushIf(buckets.artifact);
  pushIf(buckets.refine);

  if (result.length < 4) {
    const remaining = candidates
      .filter((c) => !result.includes(c.phrase))
      .sort((a, b) => a.order - b.order);
    for (const c of remaining) {
      if (result.length >= 4) break;
      result.push(c.phrase);
    }
  }

  return result.slice(0, 4);
}

function extractAnchorsFromText(texts: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const numberRegex =
    /(\d+\s+(?:makes?|minutes?|rounds?|sources?|laps?|reps?|hours?|pages?|miles?|km|sets?))/gi;
  const verbPhrases = [
    "adjust",
    "repeat",
    "measure",
    "track",
    "focus",
    "drill",
    "form",
    "footwork",
    "debate",
    "sources",
  ];

  texts.forEach((line) => {
    const lower = line.toLowerCase();

    let m: RegExpExecArray | null;
    while ((m = numberRegex.exec(lower)) !== null) {
      const phrase = m[1].trim();
      if (phrase && !seen.has(phrase)) {
        seen.add(phrase);
        candidates.push(phrase);
      }
    }

    for (const verb of verbPhrases) {
      const idx = lower.indexOf(verb);
      if (idx !== -1) {
        const words = lower.split(/\s+/);
        const hitIdx = words.findIndex((w) => w.includes(verb));
        const window = words.slice(
          Math.max(0, hitIdx - 2),
          Math.min(words.length, hitIdx + 4),
        );
        const phrase = window.join(" ").trim();
        if (phrase && !seen.has(phrase)) {
          seen.add(phrase);
          candidates.push(phrase);
        }
      }
    }
  });

  return candidates.slice(0, 6);
}
function sanitizeWindows(windows?: DecanWindow[]) {
  if (!windows || !Array.isArray(windows)) return [];
  return windows
    .filter((w) => w && w.start && w.end)
    .map((w) => ({
      name: w.name,
      theme: w.theme ?? null,
      start: w.start,
      end: w.end,
    }));
}

async function fetchStoredBadgeRows(
  client: any,
  userId: string,
  start: string,
  end: string,
) {
  const { data, error } = await client
    .from("journal_badges")
    .select("title, details, tags, occurred_on, flow_id, event_id")
    .eq("user_id", userId)
    .gte("occurred_on", start)
    .lte("occurred_on", end)
    .order("occurred_on", { ascending: true });

  if (error) throw error;
  return (data ?? []) as BadgeRow[];
}

function coerceStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => entry == null ? "" : String(entry)).filter(
      Boolean,
    );
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (value && typeof value === "object") {
    return Object.values(value).map((entry) =>
      entry == null ? "" : String(entry)
    ).filter(Boolean);
  }
  return [];
}

function extractRawBadgeTokens(text: string) {
  return text.match(/⟦EVENT_BADGE[\s\S]*?⟧/g) ?? [];
}

function parseRawBadgeToken(raw: string) {
  const trimmed = raw.trim();
  const content = trimmed.startsWith("⟦EVENT_BADGE")
    ? trimmed
      .replace(/^⟦EVENT_BADGE/, "")
      .replace(/⟧$/, "")
      .trim()
    : trimmed;
  if (!content) return null;

  const values: Record<string, string> = {};
  const regex = /(\w+)=(?:"((?:\\.|[^"])*)"|([^\s]+))/g;
  for (const match of content.matchAll(regex)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? "";
    values[key] = value.replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }

  const id = values.id ?? values.badgeId;
  const title = values.title;
  if (!id || !title) return null;
  return {
    id,
    eventId: values.eventId ?? null,
    title,
    start: values.start ?? null,
    description: values.description ?? values.desc ?? null,
  };
}

function dateFromMaybeIso(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return dateKey(parsed);
}

function badgeFromJournalToken(
  token: ReturnType<typeof parseRawBadgeToken>,
  fallbackDate: string,
): BadgeRow | null {
  if (!token) return null;
  return {
    title: token.title,
    details: token.description ?? null,
    tags: ["journal"],
    occurred_on: dateFromMaybeIso(token.start, fallbackDate),
    flow_id: null,
    event_id: token.eventId ?? token.id,
  };
}

function rawBadgeTokensFromJournalEntry(row: JournalEntryRow) {
  const tokens: string[] = [];
  const body = (row.body ?? "").trim();

  tokens.push(...coerceStringList(row.meta?.badges));

  if (body.startsWith("{") && body.includes('"version"')) {
    try {
      const doc = JSON.parse(body) as Record<string, unknown>;
      const docMeta = doc.meta && typeof doc.meta === "object"
        ? doc.meta as Record<string, unknown>
        : null;
      tokens.push(...coerceStringList(docMeta?.badges));

      if (!tokens.length && Array.isArray(doc.blocks)) {
        for (const block of doc.blocks) {
          if (!block || typeof block !== "object") continue;
          const ops = (block as { ops?: unknown }).ops;
          if (!Array.isArray(ops)) continue;
          for (const op of ops) {
            const insert = op && typeof op === "object"
              ? (op as { insert?: unknown }).insert
              : null;
            if (typeof insert === "string") {
              tokens.push(...extractRawBadgeTokens(insert));
            }
          }
        }
      }
      return tokens;
    } catch (_err) {
      // Fall through to legacy plain-text scan below.
    }
  }

  if (body.length) tokens.push(...extractRawBadgeTokens(body));
  return tokens;
}

async function fetchJournalEntryBadges(
  client: any,
  userId: string,
  start: string,
  end: string,
) {
  const { data, error } = await client
    .from("journal_entries")
    .select("id, greg_date, body, meta")
    .eq("user_id", userId)
    .gte("greg_date", start)
    .lte("greg_date", end)
    .order("greg_date", { ascending: true });

  if (error) throw error;

  const badges: BadgeRow[] = [];
  for (const row of (data ?? []) as JournalEntryRow[]) {
    for (const rawToken of rawBadgeTokensFromJournalEntry(row)) {
      const badge = badgeFromJournalToken(
        parseRawBadgeToken(rawToken),
        row.greg_date,
      );
      if (badge) badges.push(badge);
    }
  }
  return badges;
}

function plannerStateFromTodoStatus(status: string | null): PlannerState {
  switch (normalizeText(status).toLowerCase()) {
    case "done":
      return "done";
    case "partial":
    case "in_progress":
      return "partial";
    case "skipped":
    case "archived":
      return "skipped";
    case "pending":
    default:
      return "pending";
  }
}

function plannerTagsFor(kind: PlannerKind, state: PlannerState) {
  return ["planner", `kind:${kind}`, `state:${state}`];
}

function todoEvidenceTitle(title: string, state: PlannerState) {
  const label = normalizeText(title) || "Task";
  if (state === "done") return `Completed to-do: ${label}`;
  if (state === "partial") return `In-progress to-do: ${label}`;
  if (state === "skipped") return `Skipped to-do: ${label}`;
  return `To-do: ${label}`;
}

function todoEvidenceDetails(todo: TodoRow, state: PlannerState) {
  const parts = [
    `Planner to-do for ${todo.due_date}.`,
    `State: ${state}.`,
  ];
  const notes = normalizeText(todo.notes);
  if (notes) parts.push(notes);
  if (state === "pending") {
    parts.push("Not checked off by decan end.");
  }
  return parts.join(" ");
}

async function fetchTodoEvidence(
  client: any,
  userId: string,
  start: string,
  end: string,
) {
  const { data, error } = await client
    .from("todos")
    .select("id, title, notes, due_date, status, completed_at")
    .eq("user_id", userId)
    .gte("due_date", start)
    .lte("due_date", end)
    .order("due_date", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as TodoRow[])
    .filter((todo) => !!todo.due_date)
    .map((todo) => {
      const state = plannerStateFromTodoStatus(todo.status);
      return {
        title: todoEvidenceTitle(todo.title ?? "", state),
        details: todoEvidenceDetails(todo, state),
        tags: plannerTagsFor("todo", state),
        occurred_on: todo.due_date!,
        flow_id: null,
        event_id: `planner-todo:${todo.due_date}:${todo.id}`,
      };
    });
}

function nutritionLabel(item: NutritionItemRow) {
  return normalizeText(item.nutrient) || normalizeText(item.source) ||
    "Nutrition";
}

function nutritionOccursOnDate(
  item: NutritionItemRow,
  date: string,
  start: string,
) {
  if (item.enabled === false) return false;
  const mode = normalizeText(item.mode).toLowerCase();
  if (mode === "weekday") {
    const days = item.days_of_week ?? [];
    return days.includes(isoWeekday(date));
  }
  if (mode === "decan") {
    const days = item.decan_days ?? [];
    return days.includes(decanDayIndex(start, date));
  }
  return false;
}

function nutritionPendingDetails(item: NutritionItemRow, date: string) {
  const parts = [
    `Planner nutrition entry for ${date}.`,
    "State: pending.",
    "Not checked off by decan end.",
  ];
  const source = normalizeText(item.source);
  const purpose = normalizeText(item.purpose);
  if (source) parts.push(`Source: ${source}.`);
  if (purpose) parts.push(`Purpose: ${purpose}.`);
  return parts.join(" ");
}

function nutritionCreatedOnOrBefore(item: NutritionItemRow, date: string) {
  if (!item.created_at) return true;
  const createdOn = dateFromMaybeIso(item.created_at, date);
  return date >= createdOn;
}

async function fetchPendingNutritionEvidence(
  client: any,
  userId: string,
  start: string,
  end: string,
  existingEventIds: Set<string>,
) {
  const { data, error } = await client
    .from("nutrition_items")
    .select(
      "id, nutrient, source, purpose, mode, days_of_week, decan_days, repeat, enabled, created_at",
    )
    .eq("user_id", userId)
    .eq("enabled", true);

  if (error) throw error;

  const dates = dateKeysInRange(start, end);
  const badges: BadgeRow[] = [];
  for (const item of (data ?? []) as NutritionItemRow[]) {
    for (const date of dates) {
      if (!nutritionCreatedOnOrBefore(item, date)) continue;
      if (!nutritionOccursOnDate(item, date, start)) continue;
      const eventId = `planner-nutrition:${date}:${item.id}`;
      if (existingEventIds.has(eventId)) continue;
      badges.push({
        title: `Nutrition: ${nutritionLabel(item)}`,
        details: nutritionPendingDetails(item, date),
        tags: plannerTagsFor("nutrition", "pending"),
        occurred_on: date,
        flow_id: null,
        event_id: eventId,
      });
    }
  }
  return badges;
}

function privateOrDisallowedEvidenceTitle(value: string | null | undefined) {
  const lower = normalizeText(value).toLowerCase();
  return /\b(direct message|dm\b|private message|chat message)\b/.test(lower);
}

function calendarEventTags(row: UserEventRow) {
  const title = normalizeText(row.title).toLowerCase();
  const tags = ["calendar"];
  const category = normalizeText(row.category);
  if (category) tags.push(`category:${category}`);
  if (/\b(journal|write|record|reflection)\b/.test(title)) {
    tags.push("journal", "record");
  }
  if (/\b(family|salon|care|home|house)\b/.test(title)) {
    tags.push("care", "social");
  }
  if (row.flow_local_id || row.flow_tpl_key || row.action_id) {
    tags.push("flow", "planned");
  }
  return [...new Set(tags)];
}

function calendarEvidenceTitle(row: UserEventRow) {
  const title = normalizeText(row.title) || "calendar event";
  const lower = title.toLowerCase();
  if (/\b(journal|write|record|reflection)\b/.test(lower)) {
    return `Calendar rhythm: ${title}`;
  }
  if (row.flow_local_id || row.flow_tpl_key || row.action_id) {
    return `Calendar flow: ${title}`;
  }
  return `Calendar event: ${title}`;
}

function calendarEvidenceDetails(row: UserEventRow) {
  const parts = [
    `Calendar item scheduled on ${dateFromMaybeIso(row.starts_at, "")}.`,
  ];
  const category = normalizeText(row.category);
  if (category) parts.push(`Category: ${category}.`);
  if (row.flow_local_id || row.flow_tpl_key || row.action_id) {
    parts.push("Part of a flow or day-card practice.");
  }
  return parts.join(" ");
}

async function fetchCalendarEventEvidence(
  client: any,
  userId: string,
  start: string,
  end: string,
) {
  const { data, error } = await client
    .from("user_events")
    .select(
      "id, client_event_id, title, category, starts_at, ends_at, flow_local_id, flow_tpl_key, action_id",
    )
    .eq("user_id", userId)
    .gte("starts_at", dayStartIso(start))
    .lt("starts_at", dayAfterIso(end))
    .order("starts_at", { ascending: true })
    .limit(80);

  if (error) throw error;

  return ((data ?? []) as UserEventRow[])
    .filter((row) => !privateOrDisallowedEvidenceTitle(row.title))
    .map((row) => ({
      title: calendarEvidenceTitle(row),
      details: calendarEvidenceDetails(row),
      tags: calendarEventTags(row),
      occurred_on: dateFromMaybeIso(row.starts_at, start),
      flow_id: null,
      event_id: row.client_event_id ?? `calendar-event:${row.id}`,
    }));
}

function reminderEvidenceTags(row: ScheduledNotificationRow) {
  const title = normalizeText(row.title).toLowerCase();
  const tags = ["reminder"];
  const type = normalizeText(row.notification_type);
  if (type) tags.push(`notification:${type}`);
  if (/\b(journal|write|record|reflection)\b/.test(title)) {
    tags.push("journal", "record");
  }
  if (
    /\b(flow|step|practice|maat|ma'at)\b/.test(title) || type === "flow_step"
  ) {
    tags.push("flow", "practice");
  }
  return [...new Set(tags)];
}

async function fetchScheduledReminderEvidence(
  client: any,
  userId: string,
  start: string,
  end: string,
) {
  const { data, error } = await client
    .from("scheduled_notifications")
    .select(
      "id, client_event_id, title, notification_type, scheduled_at, is_active",
    )
    .eq("user_id", userId)
    .gte("scheduled_at", dayStartIso(start))
    .lt("scheduled_at", dayAfterIso(end))
    .order("scheduled_at", { ascending: true })
    .limit(80);

  if (error) throw error;

  return ((data ?? []) as ScheduledNotificationRow[])
    .filter((row) => !privateOrDisallowedEvidenceTitle(row.title))
    .map((row) => {
      const title = normalizeText(row.title) || "scheduled reminder";
      return {
        title: `Reminder: ${title}`,
        details: `Reminder scheduled on ${
          dateFromMaybeIso(row.scheduled_at, start)
        }. Type: ${normalizeText(row.notification_type) || "reminder"}.`,
        tags: reminderEvidenceTags(row),
        occurred_on: dateFromMaybeIso(row.scheduled_at, start),
        flow_id: null,
        event_id: row.client_event_id
          ? `reminder:${row.client_event_id}:${row.id}`
          : `reminder:${row.id}`,
      };
    });
}

function completionTitle(
  completion: UserEventCompletionRow,
  eventByClientId: Map<string, UserEventRow>,
  flowById: Map<number, FlowNameRow>,
) {
  const event = completion.client_event_id
    ? eventByClientId.get(completion.client_event_id)
    : null;
  const eventTitle = normalizeText(event?.title);
  if (eventTitle && !privateOrDisallowedEvidenceTitle(eventTitle)) {
    return eventTitle;
  }
  const flow = completion.flow_id ? flowById.get(completion.flow_id) : null;
  const flowName = normalizeText(flow?.name);
  if (flowName && !privateOrDisallowedEvidenceTitle(flowName)) {
    return flowName;
  }
  return "Ma'at flow step";
}

async function fetchFlowCompletionEvidence(
  client: any,
  userId: string,
  start: string,
  end: string,
) {
  const { data, error } = await client
    .from("user_event_completions")
    .select(
      "id, client_event_id, flow_id, completed_on, completed_at, source, metadata",
    )
    .eq("user_id", userId)
    .gte("completed_on", start)
    .lte("completed_on", end)
    .order("completed_on", { ascending: true })
    .limit(80);

  if (error) throw error;

  const completions = (data ?? []) as UserEventCompletionRow[];
  if (!completions.length) return [] as BadgeRow[];

  const clientIds = [
    ...new Set(
      completions.map((row) => normalizeText(row.client_event_id)).filter(
        Boolean,
      ),
    ),
  ];
  const flowIds = [
    ...new Set(
      completions.map((row) => row.flow_id).filter((
        id,
      ): id is number => typeof id === "number"),
    ),
  ];

  const eventByClientId = new Map<string, UserEventRow>();
  if (clientIds.length) {
    const { data: events, error: eventsError } = await client
      .from("user_events")
      .select(
        "id, client_event_id, title, category, starts_at, ends_at, flow_local_id, flow_tpl_key, action_id",
      )
      .eq("user_id", userId)
      .in("client_event_id", clientIds)
      .limit(100);
    if (eventsError) throw eventsError;
    for (const event of (events ?? []) as UserEventRow[]) {
      const clientId = normalizeText(event.client_event_id);
      if (clientId) eventByClientId.set(clientId, event);
    }
  }

  const flowById = new Map<number, FlowNameRow>();
  if (flowIds.length) {
    const { data: flows, error: flowsError } = await client
      .from("flows")
      .select("id, name, active, is_hidden")
      .eq("user_id", userId)
      .in("id", flowIds)
      .limit(100);
    if (flowsError) throw flowsError;
    for (const flow of (flows ?? []) as FlowNameRow[]) {
      flowById.set(flow.id, flow);
    }
  }

  return completions.map((completion) => {
    const title = completionTitle(completion, eventByClientId, flowById);
    return {
      title: `Observed flow: ${title}`,
      details:
        `Flow or day-card practice marked observed on ${completion.completed_on}.`,
      tags: ["flow", "observed", "practice", "state:done"],
      occurred_on: completion.completed_on,
      flow_id: completion.flow_id ?? null,
      event_id: completion.client_event_id
        ? `flow-completion:${completion.client_event_id}`
        : `flow-completion:${completion.id}`,
    };
  });
}

function dedupeBadges(badges: BadgeRow[]) {
  const seen = new Set<string>();
  const deduped: BadgeRow[] = [];
  for (const badge of badges) {
    const eventId = normalizeText(badge.event_id);
    const key = eventId.length
      ? `event:${eventId}`
      : `${badge.occurred_on}:${normalizeText(badge.title).toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(badge);
  }
  return deduped.sort((a, b) =>
    a.occurred_on.localeCompare(b.occurred_on) ||
    normalizeText(a.title).localeCompare(normalizeText(b.title))
  );
}

async function fetchBadges(
  client: any,
  userId: string,
  start: string,
  end: string,
) {
  const storedBadges = await fetchStoredBadgeRows(client, userId, start, end);

  const [
    journalBadges,
    todoBadges,
    calendarBadges,
    reminderBadges,
    flowCompletionBadges,
  ] = await Promise.all([
    fetchJournalEntryBadges(client, userId, start, end).catch((error) => {
      console.error("Journal entry badge fetch error:", error);
      return [] as BadgeRow[];
    }),
    fetchTodoEvidence(client, userId, start, end).catch((error) => {
      console.error("Todo evidence fetch error:", error);
      return [] as BadgeRow[];
    }),
    fetchCalendarEventEvidence(client, userId, start, end).catch((error) => {
      console.error("Calendar event evidence fetch error:", error);
      return [] as BadgeRow[];
    }),
    fetchScheduledReminderEvidence(client, userId, start, end).catch(
      (error) => {
        console.error("Reminder evidence fetch error:", error);
        return [] as BadgeRow[];
      },
    ),
    fetchFlowCompletionEvidence(client, userId, start, end).catch((error) => {
      console.error("Flow completion evidence fetch error:", error);
      return [] as BadgeRow[];
    }),
  ]);

  const mergedBeforeNutrition = dedupeBadges([
    ...journalBadges,
    ...todoBadges,
    ...calendarBadges,
    ...reminderBadges,
    ...flowCompletionBadges,
    ...storedBadges,
  ]);
  const existingEventIds = new Set(
    mergedBeforeNutrition
      .map((badge) => normalizeText(badge.event_id))
      .filter(Boolean),
  );
  const pendingNutritionBadges = await fetchPendingNutritionEvidence(
    client,
    userId,
    start,
    end,
    existingEventIds,
  ).catch((error) => {
    console.error("Nutrition evidence fetch error:", error);
    return [] as BadgeRow[];
  });

  return dedupeBadges([...mergedBeforeNutrition, ...pendingNutritionBadges]);
}

async function fetchHistoricalWindows(
  client: any,
  userId: string,
  currentStart: string,
  requested?: DecanWindow[],
): Promise<DecanWindow[]> {
  const sanitized = sanitizeWindows(requested);
  if (sanitized.length) return sanitized.slice(0, MAX_HISTORY_WINDOWS);

  const { data, error } = await client
    .from("decan_reflection_schedule")
    .select("decan_start, decan_end")
    .eq("user_id", userId)
    .lt("decan_end", currentStart)
    .order("decan_start", { ascending: false })
    .limit(MAX_HISTORY_WINDOWS);

  if (error) {
    console.error("History lookup error:", error);
    return [];
  }

  return (data ?? []).map((
    row: { decan_start: string; decan_end: string },
    idx: number,
  ) => ({
    name: `Past decan ${idx + 1}`,
    start: row.decan_start,
    end: row.decan_end,
  }));
}

function buildSummary(
  badges: BadgeRow[],
  window: DecanWindow,
  label: string,
): Summary {
  if (!badges.length) {
    return {
      label,
      badgeCount: 0,
      tags: [],
      cadence: "none",
      snippets: [],
    };
  }

  const tagSummary = topTags(badges);
  const firstDate = badges[0]?.occurred_on ?? window.start;
  const lastDate = badges[badges.length - 1]?.occurred_on ?? window.end;

  const snippets = badges
    .slice(0, 4)
    .map((b) => {
      const title = normalizedBadgeTitle(b);
      const details = normalizedBadgeDetails(b);
      const base = title || details
        ? `${title}${title && details ? " - " : ""}${details}`
        : "";
      return base.trim().slice(0, 140);
    })
    .filter((s) => s.length > 0);

  return {
    label,
    badgeCount: badges.length,
    tags: tagSummary
      ? tagSummary.split(", ").map((t) => t.trim()).filter(Boolean)
      : [],
    cadence: `${firstDate} -> ${lastDate}`,
    snippets,
  };
}

function buildEvidenceLines(badges: BadgeRow[]) {
  return badges
    .map((b) => {
      const title = normalizedBadgeTitle(b);
      const details = normalizedBadgeDetails(b);
      if (!title && !details) return null; // skip if no usable content

      const parts: string[] = [];
      parts.push(b.occurred_on);
      if (title) parts.push(title);
      if (details) parts.push(details);
      const tags = contentTags(b).length
        ? `tags: ${contentTags(b).join(", ")}`
        : "";
      if (tags) parts.push(tags);
      const line = parts.join(" - ").trim();
      return line.length ? line : null;
    })
    .filter((l): l is string => !!l);
}

function singleRecurringNutritionThread(
  threads: MaatNormalizedObligationThreads | null | undefined,
) {
  const nutrition = threads?.nutrition;
  if (
    !nutrition ||
    nutrition.unique_item_count !== 1 ||
    !nutrition.same_item_repeated ||
    nutrition.pending_count + nutrition.skipped_count < 3
  ) {
    return null;
  }
  return threads?.threads.find((thread) =>
    thread.domain === "nutrition" &&
    thread.same_item_repeated &&
    thread.pending_count + thread.skipped_count >= 3
  ) ?? null;
}

function buildReflectionPlannerPromptSummary(
  badges: BadgeRow[],
  threads?: MaatNormalizedObligationThreads | null,
) {
  const recurringNutrition = singleRecurringNutritionThread(threads);
  if (recurringNutrition) {
    const label = normalizeText(recurringNutrition.label);
    const source = recurringNutrition.sources[0]
      ? ` from ${recurringNutrition.sources[0]}`
      : "";
    const purpose = recurringNutrition.purposes[0]
      ? ` for ${recurringNutrition.purposes[0]}`
      : "";
    const named = label ? ` (${label}${source}${purpose})` : "";
    return `nutrition: one recurring body-care promise${named} remained unchecked through the decan; treat this as one repeated obligation, not several supports or exact day/count evidence`;
  }
  return buildPlannerSummaryLine(buildPlannerSummary(badges));
}

function isNutritionEvidenceBadge(badge: BadgeRow) {
  const tags = contentTags(badge);
  return tags.includes("kind:nutrition") ||
    normalizeText(badge.title).toLowerCase().startsWith("nutrition:");
}

function reflectionEvidenceLinePriority(line: string) {
  const lower = line.toLowerCase();
  if (/\bobserved flow|flow or day-card|state:done\b/.test(lower)) return 0;
  if (/\bfamily salon\b/.test(lower)) return 1;
  if (
    /\bjournal\b/.test(lower) && /\b(reminder|calendar rhythm)\b/.test(lower)
  ) {
    return 2;
  }
  if (/\bcalendar event|calendar flow|calendar rhythm\b/.test(lower)) return 3;
  if (/\breminder\b/.test(lower)) return 4;
  if (/\bjournal\b/.test(lower)) return 5;
  if (/\bto-do|task|visible work\b/.test(lower)) return 6;
  return 9;
}

function reflectionMiddleSpecificityLines(
  badges: BadgeRow[],
  limit = 6,
) {
  const lines = buildEvidenceLines(
    badges.filter((badge) => !isNutritionEvidenceBadge(badge)),
  );
  return lines
    .sort((a, b) =>
      reflectionEvidenceLinePriority(a) - reflectionEvidenceLinePriority(b) ||
      a.localeCompare(b)
    )
    .slice(0, limit);
}

function buildReflectionPromptEvidenceLines(
  badges: BadgeRow[],
  threads?: MaatNormalizedObligationThreads | null,
) {
  const recurringNutrition = singleRecurringNutritionThread(threads);
  if (recurringNutrition) {
    const label = normalizeText(recurringNutrition.label) ||
      "nutrition support";
    const source = recurringNutrition.sources[0]
      ? ` Source: ${recurringNutrition.sources[0]}.`
      : "";
    const purpose = recurringNutrition.purposes[0]
      ? ` Purpose: ${recurringNutrition.purposes[0]}.`
      : "";
    const start = recurringNutrition.first_seen_at;
    const end = recurringNutrition.last_marked_at;
    const period = start && end ? `${start} to ${end}` : "this decan";
    return [
      `${period} - Recurring nutrition support: ${label}.${source}${purpose} Status: unchecked through the decan. Normalization: one obligation thread repeated across the period; do not describe as several supports or count/day evidence.`,
      ...reflectionMiddleSpecificityLines(badges, 7),
    ];
  }
  return buildEvidenceLines(badges).slice(0, 14);
}

function sanitizeRecurringThreadReflectionLanguage(
  text: string,
  threads?: MaatNormalizedObligationThreads | null,
) {
  if (!singleRecurringNutritionThread(threads)) return text;
  return text
    .replace(/\ball\s+ten\s+days\b/gi, "through the decan")
    .replace(/\bevery\s+single\s+day\b/gi, "through the period")
    .replace(/\bevery\s+day\b/gi, "through the period")
    .replace(
      /\bdaily\s+(check|checks|mark|marks|entry|entries|support|thread|practice|promise|commitment)\b/gi,
      "the $1",
    )
    .replace(/\bdaily\b/gi, "repeated");
}

function evidenceExamplePhrases(evidenceLines: string[], limit = 3) {
  return guidanceEvidencePhrasesFromLines(evidenceLines, limit);
}

function buildEvidenceLinesLegacy(titles: string[]) {
  return titles
    .map((t) => normalizeText(t))
    .filter((t) => t.length)
    .map((t) => `badge: ${t}`);
}

function buildAnthropicPrompt(
  payload: ReflectionPayload,
  badges: BadgeRow[],
  badgeLines: string[],
  topTags: string[],
  historySummaries: Summary[],
  decisionMatrix?: ReflectionDecisionMatrixV1 | null,
  options?: {
    memoryBriefMarkdown?: string | null;
    calendarPromptBlock?: string | null;
    profileSnapshotPromptBlock?: string | null;
    moralPortraitPromptBlock?: string | null;
    reflectionJudgmentPromptBlock?: string | null;
    reflectionThesisGatePromptBlock?: string | null;
    profileContextPromptBlock?: string | null;
    outputControlPromptBlock?: string | null;
    plannerSummaryLineOverride?: string | null;
    targetWordRange?: string;
  },
) {
  const header =
    `SCOPE: This reflection is for ONE DECAN ONLY (about 10 days within the month), not the full month. All evidence below is from this decan only. Reflect only on this period.

Decan: ${payload.decan_name}
Theme: ${payload.decan_theme ?? ""}
Decan window (exact date range): ${payload.decan_start ?? ""} to ${
      payload.decan_end ?? ""
    }`;

  const plannerSummaryLine = normalizeText(
    options?.plannerSummaryLineOverride,
  ) || buildPlannerSummaryLine(buildPlannerSummary(badges));
  const tagsLine = topTags.length
    ? `Top tags: ${topTags.join(", ")}`
    : "Top tags: none";
  const plannerBlock = plannerSummaryLine.length
    ? `PLANNER EVIDENCE (to-dos and nutrition, including checked, partial, skipped, and unchecked items): ${plannerSummaryLine}`
    : "PLANNER EVIDENCE: none";
  const evidenceBlock = badgeLines.length
    ? `BADGE EVIDENCE (journal badges plus planner item states; available evidence only. Follow REFLECTION_PROFILE_SNAPSHOT for what governs, what illustrates, and what is suppressed; do not invent):
${badgeLines.join("\n")}`
    : "BADGE EVIDENCE: none";

  const historyBlock = historySummaries.length
    ? `PAST DECANS (each is a different 10-day decan, not a full month):
${
      historySummaries
        .map(
          (h) =>
            `- ${h.label} (${h.cadence})${
              h.tags.length ? ` | Tags: ${h.tags.join(", ")}` : ""
            }. What they marked: ${
              h.snippets.length ? h.snippets.join(" | ") : "—"
            }`,
        )
        .join("\n")
    }`
    : "PAST DECANS: none";
  const decisionMatrixBlock = decisionMatrix?.promptBlock ?? "";
  const memoryBlock = options?.memoryBriefMarkdown?.trim() ?? "";
  const calendarBlock = options?.calendarPromptBlock?.trim() ?? "";
  const profileSnapshotBlock = options?.profileSnapshotPromptBlock?.trim() ??
    "";
  const moralPortraitBlock = options?.moralPortraitPromptBlock?.trim() ?? "";
  const reflectionJudgmentBlock =
    options?.reflectionJudgmentPromptBlock?.trim() ?? "";
  const reflectionThesisGateBlock =
    options?.reflectionThesisGatePromptBlock?.trim() ?? "";
  const profileContextBlock = options?.profileContextPromptBlock?.trim() ?? "";
  const outputControlBlock = options?.outputControlPromptBlock?.trim() ?? "";
  const targetWordRange = options?.targetWordRange ?? "90-140";

  const instructions =
    `Write a reflection in ${targetWordRange} words. This is a hard word range, not a suggestion. Use 3 short paragraphs and no more than 7 sentences. Reflect only on this decan. This is not a longer nudge: the calendar/decan/day-card arc governs the spiritual frame, REFLECTION_MORAL_PORTRAIT governs the witness of who the user is becoming, REFLECTION_JUDGMENT governs the moral thesis, REFLECTION_THESIS_GATE decides what evidence may be visible, REFLECTION_PROFILE_SNAPSHOT contains the Ma'at alignment lens and personal lens, and evidence illustrates only when the gate allows it. The opening sentence must name the current decan using the canonical spoken decan name from REFLECTION_CALENDAR_FRAME, then fuse the calendar's demand with a living portrait of the user before any item, missed mark, task, or case diagnosis. Begin from REFLECTION_MORAL_PORTRAIT.personBecomingStatement and REFLECTION_MORAL_PORTRAIT.portraitStatement and render from REFLECTION_THESIS_GATE.finalReflectionThesis when supplied; otherwise render from REFLECTION_JUDGMENT.reflectionThesis. The thesis is the topic, the Ma'at lens is the moral frame, and the user lens only translates it into this user's pattern. The directive must arise from REFLECTION_MORAL_PORTRAIT.serudjDirective as serudj/restoration, not as a request for better app evidence. Respect REFLECTION_MORAL_PORTRAIT.forbiddenFramings, REFLECTION_JUDGMENT.falseReadingToAvoid, and REFLECTION_THESIS_GATE.forbiddenSurfaceFocus. If REFLECTION_THESIS_GATE.evidenceVisibility is background_support or diagnostics_only, do not name the evidence item/source, do not make the anchor subject, and keep it in diagnostics only. If evidenceVisibility is visible_anchor, use the EVIDENCE ANCHOR once as proof, not as the story. Use the INTERPRETIVE SPECIFICITY BRIDGE only to support the judgment; do not replace the thesis with generic phrases like proper place, account heavier, recording home, or simple rhythm. Obey SUPPRESSED EVIDENCE explicitly: suppressed evidence must not lead, repeat, or become the reflection topic. Address the user directly with you/your. The person is the protagonist. Record/account/mark/evidence may not become the subject or goal; use record or mark at most once if truly necessary. Do not use "the account" or the word "account" in user-facing prose; say your day, your practice, what you kept, or what you can carry. Do not expose the scaffold: never write "Where you answered", "Where restoration is still needed", "The alignment is", "The underalignment is", "The improvement direction is", or any direct label-like rendering of hidden fields. Let the portrait reveal both alignment and restoration without category labels. Use USER_PROFILE_CONTEXT to personalize the interpretation, but never print profile labels, fact keys, source names, or raw user data. Treat journal badges and planner item states (checked, partial, skipped, and unchecked to-dos/nutrition) as real evidence. If normalized obligation threads are supplied, treat them as authoritative: unique_item_count is the number of obligations and occurrence_count is repetition. One recurring item across the period is one thread, not several supports. For a single recurring thread, do not contrast against several/multiple supports and do not mention exact occurrence counts, "daily," "every day," or "all ten days"; if the gate hides evidence, do not mention the thread at all. Use specificity with restraint: name one concrete user detail only when REFLECTION_THESIS_GATE permits visible_anchor, then translate it into plain language from the selected Ma'at dimension: truth, witness, measure, order, care, reciprocity, justice, restraint, becoming, continuity, or repair. If the thesis gate hides the selected anchor, still use 1-2 non-suppressed middle details from BADGE EVIDENCE or USER_PROFILE_CONTEXT when available, especially observed flows, calendar events, reminders, visible work, or journal badges; do not quote journal text and do not dump raw inputs. If you use a Ma'at term, explain it in ordinary words in the same sentence, such as right size, clear place, truthful form, steady care, or follow-through. Avoid coded phrases: written witness, act and account, embodied order, underalignment, life accomplished, dependent on inference, account cannot prove, and the account. Hard ban system-serving phrases: next reflection, less guesswork, enough detail, record cannot show, what may already have occurred, truth asks for enough detail, improvement direction, record tells the truth, record can match, mark of care, complete today so your record, written record drift apart. Do not keep repeating item names, sources, purposes, counts, or dates, even in hypotheticals. Every sentence should do at least two jobs: fuse decan frame with portrait, turn evidence into meaning, or let the directive arise naturally from who the user is becoming. Do not list several corrective options; end with exactly one question or exactly one charge according to REFLECTION_JUDGMENT.closingKind and REFLECTION_JUDGMENT.closingText. Prefer weight-bearing closings such as "What would it mean to...", "What would restore...", "What are you willing to return to...", or "What must be made whole..."; avoid "what would it look like" unless the judgment explicitly requires a gentle exploratory close. Do not make an ordinary nutrition support sound more serious than it is; calibrate gravity to routine practice unless the evidence shows real harm or clinical urgency. Do not use defensive "not failure / not judgment / not crisis" phrasing. Do not generalize (e.g. avoid "across a range of disciplines" unless the evidence shows it). Note trajectory and connect to the theme; end with the single closing move required by the judgment. Non-judgmental, warm tone. Goal: they feel morally oriented toward Ma'at, not coached on habits. No bullets, no metadata. If a memory brief, calendar frame, moral portrait, reflection judgment, thesis gate, user profile snapshot, user profile context, output-control plan, or hidden decision matrix is supplied, use it only to choose tone, continuity, evidence visibility, structure, and one closing move; never mention scores, gates, bands, slugs, matrix language, profile fact labels, or output-control fields.`;

  return `${instructions}

${header}
${tagsLine}
${memoryBlock ? `${memoryBlock}\n` : ""}
${calendarBlock ? `${calendarBlock}\n` : ""}
${profileSnapshotBlock ? `${profileSnapshotBlock}\n` : ""}
${moralPortraitBlock ? `${moralPortraitBlock}\n` : ""}
${reflectionJudgmentBlock ? `${reflectionJudgmentBlock}\n` : ""}
${reflectionThesisGateBlock ? `${reflectionThesisGateBlock}\n` : ""}
${profileContextBlock ? `${profileContextBlock}\n` : ""}
${outputControlBlock ? `${outputControlBlock}\n` : ""}
${plannerBlock}
${evidenceBlock}
${historyBlock}${decisionMatrixBlock ? `\n${decisionMatrixBlock}` : ""}`;
}

const DEFAULT_ANTHROPIC_REFLECTION_MODEL = "claude-sonnet-4-20250514";

async function callAnthropic(messages: AnthropicMessage[]) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const model = Deno.env.get("ANTHROPIC_REFLECTION_MODEL") ??
    Deno.env.get("ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_REFLECTION_MODEL;
  if (!apiKey) throw new Error("MISSING_ANTHROPIC_KEY");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 420,
      temperature: 0.35,
      system: messages.find((m) => m.role === "system")?.content ?? "",
      messages: messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text ?? "";
  return { text: content.trim(), modelUsed: data?.model ?? model };
}

async function generateReflectionJudgment(
  input: ReflectionJudgmentInput,
) {
  const res = await callAnthropic([
    {
      role: "system",
      content:
        "You produce structured JSON for a private Ma'at reflection judgment. Return JSON only, with no prose wrapper, no markdown, and no explanation.",
    },
    {
      role: "user",
      content: buildReflectionJudgmentPrompt(input),
    },
  ]);
  const judgment = parseReflectionJudgment(res.text);
  if (!judgment) {
    throw new Error("REFLECTION_JUDGMENT_PARSE_FAILED");
  }
  return { judgment, modelUsed: res.modelUsed };
}

async function generateReflectionMoralPortrait(
  input: ReflectionMoralPortraitInput,
) {
  const res = await callAnthropic([
    {
      role: "system",
      content:
        "You produce structured JSON for a private Ma'at moral portrait. Return JSON only, with no prose wrapper, no markdown, and no explanation.",
    },
    {
      role: "user",
      content: buildReflectionMoralPortraitPrompt(input),
    },
  ]);
  const moralPortrait = parseReflectionMoralPortrait(res.text);
  if (!moralPortrait) {
    throw new Error("REFLECTION_MORAL_PORTRAIT_PARSE_FAILED");
  }
  return { moralPortrait, modelUsed: res.modelUsed };
}

async function generateReflectionPlainSacredEdit(
  input: ReflectionPlainSacredEditorInput,
) {
  const res = await callAnthropic([
    {
      role: "system",
      content:
        "You are a final Plain Sacred Editor for a Ma'at reflection. Return JSON only, with no prose wrapper, no markdown, and no explanation.",
    },
    {
      role: "user",
      content: buildReflectionPlainSacredEditorPrompt(input),
    },
  ]);
  const edit = parseReflectionPlainSacredEdit(res.text);
  if (!edit) {
    throw new Error("REFLECTION_PLAIN_SACRED_EDITOR_PARSE_FAILED");
  }
  return { edit, modelUsed: res.modelUsed };
}

async function repairReflectionOutput(params: {
  plan: ControlledGeneratedTextPlan;
  text: string;
  validation: ReturnType<typeof validateGeneratedTextAgainstPlan>;
  grade: ControlledOutputGrade;
}) {
  const maxWords = params.plan.surfaceConstraints.wordsMax;
  const systemPrompt =
    "You repair one decan reflection. Preserve true evidence, begin from the moral portrait, remove unsupported and system-serving claims, keep one closing action, and return only the repaired reflection text.";
  const userPrompt = `${generatedTextPlanPromptBlock(params.plan)}

REPAIR_INSTRUCTION:
${params.grade.repairInstruction ?? "Repair against the output contract."}

REPAIR_MODE:
${params.grade.repairMode}

VALIDATION:
${JSON.stringify(params.validation, null, 2)}

GRADE:
${JSON.stringify(params.grade, null, 2)}

HARD_REPAIR_REQUIREMENTS:
- Stay ${
    typeof maxWords === "number"
      ? `at or below ${maxWords} words`
      : "inside the target word range"
  }.
- Serve reflectionJudgment.reflectionThesis when present; do not repair back into the falseReadingToAvoid.
- Serve reflectionMoralPortrait.personBecomingStatement and reflectionMoralPortrait.portraitStatement before directive language. The repair should feel like witness and restoration, not a request for better app evidence.
- The person is the protagonist. Record/account/mark/evidence may not become the subject or goal; use record or mark at most once if truly necessary.
- The final question must arise from reflectionMoralPortrait.serudjDirective and ask for human restoration, not record maintenance.
- Do not expose the hidden scaffold: remove phrases like "Where you answered", "Where restoration is still needed", "The alignment is", "The underalignment is", and "The improvement direction is".
- Let the portrait carry the movement instead of sorting the user into alignment/restoration buckets.
- If reflectionThesisGate.evidenceVisibility is background_support or diagnostics_only, keep the selected evidence in diagnostics only: do not name the item/source, do not make the evidence anchor the subject, and obey forbiddenSurfaceFocus.
- If reflectionThesisGate.evidenceVisibility is visible_anchor, mention one concrete evidence detail at most once, then move to Ma'at synthesis.
- Use exactly 3 short paragraphs and 5 or 6 sentences total.
- Do not repair into a longer nudge. Interpret the user's decan through the month/decan/day-card arc, and start with the canonical spoken decan name plus calendar demand before user evidence.
- Include alignment and restoration by implication through a continuous portrait; do not label them as categories.
- Do not repeat the same nutrition item, source, purpose, task, count, or date.
- If normalized threads show one recurring item, call it one recurring thread, not several supports, and do not recommend consolidation.
- If normalized threads show one recurring item, do not contrast it against several/multiple supports and do not mention exact occurrence counts; use "through the decan" or "across the period" instead.
- Add 1-2 concrete but non-invasive middle details from allowed evidence when available, especially observed flows, calendar events, reminders, visible work, or journal badges. Do not quote journal text and do not dump raw inputs.
- Address the user directly with you/your. Do not use "account" in user-facing prose; use your day, your practice, what you kept, or what you can carry.
- Do not use system-serving phrases: next reflection, less guesswork, enough detail, record cannot show, what may already have occurred, truth asks for enough detail, improvement direction.
- Do not use record tells the truth, record can match, mark of care, complete today so your record, or written record drift apart.
- Avoid hedged closings like "what would it look like"; prefer a direct question about meaning, restoration, return, willingness, or becoming.
- Do not list action options. Follow reflectionArcPlan.closingKind: exactly one question or exactly one charge, never both.
- Do not use defensive "not failure / not judgment / not crisis" phrasing.
- Keep routine support signals proportionate; do not inflate them into proof, crisis, or high-stakes consequence.

ORIGINAL_REFLECTION:
${params.text}

Return the repaired reflection only. No bullets, no metadata, no explanation.`;
  return await callAnthropic([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
}

function shouldUseReflectionRepair(
  originalValidation: ReturnType<typeof validateGeneratedTextAgainstPlan>,
  originalGrade: ControlledOutputGrade,
  repairedValidation: ReturnType<typeof validateGeneratedTextAgainstPlan>,
  repairedGrade: ControlledOutputGrade,
) {
  if (repairedValidation.errors.length > 0) return false;
  if (
    hasThreadFidelityWarnings(repairedValidation) &&
    !hasThreadFidelityWarnings(originalValidation)
  ) {
    return false;
  }
  if (repairedGrade.surfaceFitScore < originalGrade.surfaceFitScore) {
    return false;
  }
  if (
    !originalGrade.failureReasons.includes("surface_fit_below_threshold") &&
    repairedGrade.failureReasons.includes("surface_fit_below_threshold")
  ) {
    return false;
  }
  if (repairedGrade.pass) return true;
  if (originalValidation.errors.length > 0 && repairedValidation.ok) {
    return true;
  }
  return gradeTotal(repairedGrade) > gradeTotal(originalGrade) &&
    repairedGrade.failureReasons.length <= originalGrade.failureReasons.length;
}

function hasThreadFidelityWarnings(
  validation: ReturnType<typeof validateGeneratedTextAgainstPlan>,
) {
  return validation.warnings.some((warning) =>
    warning.startsWith("thread_count_mismatch:") ||
    warning.startsWith("thread_count_overexposed:") ||
    warning.startsWith("offering_fit_mismatch:")
  );
}

function hasPlainSacredEditorWarnings(
  validation: ReturnType<typeof validateGeneratedTextAgainstPlan>,
) {
  return validation.warnings.some((warning) =>
    [
      "rubric_leakage_failure",
      "portrait_continuity_failure",
      "poignancy_failure",
      "abstraction_stack_failure",
      "muddled_progression_failure",
      "unclear_directive_failure",
      "overwritten_spiritual_language_failure",
      "record_protagonist_failure",
      "reflection_account_language_failure",
    ].includes(warning)
  );
}

function gradeTotal(grade: ControlledOutputGrade) {
  return grade.groundingScore +
    grade.specificityScore +
    grade.maatAlignmentScore +
    grade.cadenceScore +
    grade.ceremonialCadenceScore +
    grade.actionClarityScore +
    grade.surfaceFitScore;
}

function outputGradeDelta(
  before: ControlledOutputGrade,
  after: ControlledOutputGrade,
) {
  return {
    grounding_score: after.groundingScore - before.groundingScore,
    specificity_score: after.specificityScore - before.specificityScore,
    maat_alignment_score: after.maatAlignmentScore -
      before.maatAlignmentScore,
    cadence_score: after.cadenceScore - before.cadenceScore,
    ceremonial_cadence_score: after.ceremonialCadenceScore -
      before.ceremonialCadenceScore,
    action_clarity_score: after.actionClarityScore -
      before.actionClarityScore,
    surface_fit_score: after.surfaceFitScore - before.surfaceFitScore,
    guidance_worthiness_score: after.guidanceWorthinessScore -
      before.guidanceWorthinessScore,
    total_score: gradeTotal(after) - gradeTotal(before),
  };
}

function reflectionCompilerPayload(params: {
  plan: ControlledGeneratedTextPlan;
  renderer: Record<string, unknown>;
  modelUsed: string;
  text: string;
  teaserText?: string | null;
  validation: Record<string, unknown>;
  grade: ControlledOutputGrade;
  repair: Record<string, unknown> | null;
}) {
  const rendererName = normalizeText(params.renderer.renderer as string | null);
  const fallbackReason = normalizeText(
    params.renderer.fallback_reason as string | null,
  );
  return buildOutputCompilerTrace({
    surface: "reflection",
    renderer: rendererName || "unknown",
    modelVersion: params.modelUsed,
    fallbackReason: fallbackReason || null,
    caseKey: params.plan.caseKey ?? null,
    offering: params.plan.selectedOffering ?? null,
    exampleIds: [
      ...(params.plan.exampleReferences ?? []).map((example) => example.id),
      ...(params.plan.reflectionExampleReferences ?? []).map((example) =>
        example.id
      ),
    ],
    exampleAvailable: (params.plan.exampleReferences ?? []).length > 0 ||
      (params.plan.reflectionExampleReferences ?? []).length > 0,
    diagnosis: params.plan.offeringRender?.diagnosis ?? null,
    concreteAction: params.plan.offeringRender?.concreteAction ?? null,
    evidenceAnchorCount: params.plan.evidenceAnchors.length,
    finalText: params.text,
    teaserText: params.teaserText ?? null,
    validation: params.validation,
    grade: params.grade,
    repairHistory: params.repair ? [params.repair] : [],
  });
}

function buildPlannerFocusedReflection(
  payload: ReflectionPayload,
  badgeCount: number,
  evidenceCount: number,
  evidenceLines: string[],
  topTags: string[],
  plannerSummary: PlannerSummary,
  branch: "decan" | "legacy",
  maatSnapshot?: MaatDimensionSnapshot | null,
) {
  const situation = reflectionSituation(maatSnapshot);
  const partialPlannerCount = plannerSummary.todoPartial +
    plannerSummary.nutritionPartial;
  const completedPlannerCount = plannerSummary.todoDone +
    plannerSummary.nutritionDone;
  const skippedPlannerCount = plannerSummary.todoSkipped +
    plannerSummary.nutritionSkipped;
  const pendingPlannerCount = plannerSummary.todoPending +
    plannerSummary.nutritionPending;
  const themeName = payload.decan_name ?? payload.decan_theme ?? "this decan";
  const axis = resolveThemeAxis(themeName);
  const shortTheme = themeName.split("—")[0].split("-")[0].trim();
  const blockA = reflectionAccountLine(plannerSummary, topTags);
  const blockB = reflectionWholeAccountSignalLine(
    plannerSummary,
    evidenceLines.length,
  );
  const blockCase = situation ? reflectionCaseThreadLine(situation) : "";

  let blockC = "";
  if (axis) {
    if (axis.primary.includes("stabilization")) {
      blockC = `${shortTheme}: form before speed, alignment before expansion.`;
    } else if (axis.primary.includes("ignition")) {
      blockC = `${shortTheme}: initiative mattered more than hesitation.`;
    } else if (axis.primary.includes("replenishment")) {
      blockC = `${shortTheme}: replenishment mattered more than overdrive.`;
    } else if (axis.primary.includes("consolidation")) {
      blockC = `${shortTheme}: consolidation mattered more than sprawl.`;
    } else {
      blockC = `${shortTheme}: more ${axis.primary} than ${axis.contrast}.`;
    }
  } else if (completedPlannerCount > 0) {
    blockC =
      "Progress came from keeping practical promises, not from adding more variety.";
  } else {
    blockC =
      "Even partial follow-through can clarify what is ready to stay and what needs a simpler shape.";
  }

  let blockD = "";
  if (partialPlannerCount > 0) {
    blockD =
      "Next decan, keep the same practical thread and finish one small piece before adding another.";
  } else if (skippedPlannerCount > 0) {
    blockD =
      "Next decan, choose the smallest restoration that can survive a difficult day.";
  } else if (pendingPlannerCount > 0) {
    blockD = "Next decan, narrow the promise until it can be kept once.";
  } else {
    blockD =
      "Next decan, protect the rhythm long enough for it to become ordinary.";
  }
  blockD = buildMaatFallbackNextStep(maatSnapshot, blockD);

  const question = reflectionQuestionLine(plannerSummary, topTags);

  const reflectionParts = [blockA, blockB, blockCase, blockC, blockD, question];

  return {
    reflection: reflectionParts.filter(Boolean).join("\n\n"),
    modelUsed: branch === "decan" ? "local-generator-v2" : "local-legacy-v2",
    badgeCount,
    evidenceCount,
    topTags,
    branch,
  };
}

function buildV2Reflection(
  payload: ReflectionPayload,
  badgeCount: number,
  evidenceLines: string[],
  topTags: string[],
  branch: "decan" | "legacy",
  options?: {
    badges?: BadgeRow[];
    window?: DecanWindow;
    history?: HistoryMetrics[];
    maatSnapshot?: MaatDimensionSnapshot | null;
  },
) {
  const evidenceCount = evidenceLines.length;
  const badges = options?.badges ?? [];
  const plannerSummary = buildPlannerSummary(badges);
  const situation = reflectionSituation(options?.maatSnapshot);

  if (badgeCount === 0) {
    return {
      reflection: buildMaatFallbackNextStep(
        options?.maatSnapshot,
        "No badges landed this decan. Mark one small action tomorrow so what moved has a truthful place to stand.",
      ),
      modelUsed: branch === "decan" ? "local-generator-v2" : "local-legacy-v2",
      badgeCount,
      evidenceCount,
      topTags,
      branch,
    };
  }

  if (
    plannerSummary.total >= Math.max(3, Math.ceil(badgeCount * 0.75)) &&
    evidenceCount < 5
  ) {
    return buildPlannerFocusedReflection(
      payload,
      badgeCount,
      evidenceCount,
      evidenceLines,
      topTags,
      plannerSummary,
      branch,
      options?.maatSnapshot,
    );
  }

  if (evidenceCount < 2) {
    return {
      reflection: buildMaatFallbackNextStep(
        options?.maatSnapshot,
        "Badges exist but details are thin. Name one thing that moved next decan so the trajectory can stand in truth.",
      ),
      modelUsed: branch === "decan" ? "local-generator-v2" : "local-legacy-v2",
      badgeCount,
      evidenceCount,
      topTags,
      branch,
    };
  }

  const window = options?.window;
  const signals = computeV3Signals(
    badges,
    window,
    evidenceLines,
    badgeCount,
    topTags,
  );
  const windowDays = window
    ? daysBetween(parseDateOnly(window.start), parseDateOnly(window.end)) + 1
    : Math.max(signals.metrics.daysActive, 1);
  const evidenceExamples = evidenceExamplePhrases(evidenceLines, 3);
  const anchorList = signals.anchors.slice(
    0,
    Math.max(3, Math.min(4, signals.anchors.length)),
  );
  const displayAnchors = anchorList.length ? anchorList : evidenceExamples;
  const anchorText = displayAnchors.length === 1
    ? displayAnchors[0]
    : displayAnchors.length === 2
    ? `${displayAnchors[0]} and ${displayAnchors[1]}`
    : displayAnchors.length >= 3
    ? `${displayAnchors[0]}, ${displayAnchors[1]}, and ${displayAnchors[2]}`
    : "";

  const thinDetails = signals.metrics.detailsCoverage < 30;
  const scattered = signals.diversityScore >= 5 && !signals.metrics.topThread;
  const highConsistency =
    signals.metrics.daysActive >= Math.max(2, Math.floor(windowDays * 0.6));
  const highRefinement = signals.metrics.refinementHits >= 3 ||
    signals.metrics.progressMarkersCount >= 3 || signals.repetitionScore >= 2;
  const clusteredEffort = signals.metrics.clusteredEffort;
  const theoryToApplication = signals.progression === "theory_to_application";
  const intentionalExecution = signals.metrics.detailsCoverage >= 60 &&
    !scattered;
  const explorationPhase = scattered ||
    signals.dominantVerbs.includes("explore") ||
    signals.disciplineClusters.length >= 2;
  const mainAnchor = signals.metrics.topThread ?? signals.repeatedTitles[0] ??
    displayAnchors[0] ?? "one thread";
  const threadLabel = reflectionThreadLabel(
    mainAnchor,
    plannerSummary,
    signals.metrics.topTags,
  );

  let trajectoryLabel:
    | "theory_to_application"
    | "refinement"
    | "intentional_execution"
    | "exploration"
    | "clustered"
    | "steady";
  if (theoryToApplication) {
    trajectoryLabel = "theory_to_application";
  } else if (highRefinement) {
    trajectoryLabel = "refinement";
  } else if (intentionalExecution) {
    trajectoryLabel = "intentional_execution";
  } else if (explorationPhase) {
    trajectoryLabel = "exploration";
  } else if (clusteredEffort) {
    trajectoryLabel = "clustered";
  } else {
    trajectoryLabel = "steady";
  }

  // Block A: pattern + anchors
  let blockA = "";
  switch (trajectoryLabel) {
    case "theory_to_application":
      blockA =
        "The movement changed shape this decan: gathering became practice. Your record asks what should become steadier now that the ideas have touched action.";
      break;
    case "refinement":
      blockA =
        `You kept circling ${threadLabel}. Read that as a request for cleaner shape, not more volume.`;
      break;
    case "intentional_execution":
      blockA =
        "Intentional execution showed up. The work gathered around making the record more reliable, not merely busier.";
      break;
    case "exploration":
      blockA =
        `The decan opened several doors. Carry one thread forward with measure and let the others wait their season.`;
      break;
    case "clustered":
      blockA =
        `Effort came in concentrated bursts. Give that force a simpler vessel so it can repeat.`;
      break;
    default:
      blockA =
        "Attention had a clear shape. The record shows what was kept, what stayed open, and where measure belongs next.";
      break;
  }
  if (!anchorText) {
    blockA +=
      " Add one concrete number or phrase next decan so the record has something trustworthy to hold.";
  }

  const axis = resolveThemeAxis(payload.decan_name ?? payload.decan_theme);
  let blockB = "";
  const themeName = payload.decan_name ?? payload.decan_theme ?? "this decan";
  if (axis) {
    const shortTheme = themeName.split("—")[0].split("-")[0].trim();
    if (axis.primary.includes("stabilization")) {
      blockB = `${shortTheme}: form before speed, alignment over expansion.`;
    } else if (axis.primary.includes("ignition")) {
      blockB = `${shortTheme}: ignition and initiative over hesitation.`;
    } else if (axis.primary.includes("replenishment")) {
      blockB = `${shortTheme}: replenishment over overdrive.`;
    } else if (axis.primary.includes("consolidation")) {
      blockB = `${shortTheme}: consolidation and integration over sprawl.`;
    } else {
      blockB = `${shortTheme}: more ${axis.primary} than ${axis.contrast}.`;
    }
  } else {
    blockB = highConsistency
      ? "The strongest signal was a practice willing to return."
      : "Let order come through one repeated measure.";
  }

  // Block C: growth + intent
  let blockC = "";
  if (theoryToApplication) {
    blockC = `You moved from exploration into tightening${
      threadLabel ? ` around ${threadLabel}` : ""
    }. Quiet, durable growth.`;
  } else if (
    highRefinement && signals.metrics.detailsCoverage >= 50 &&
    signals.diversityScore <= 3
  ) {
    blockC =
      `The return matters because it shows where leverage is beginning to form.`;
  } else if (intentionalExecution) {
    blockC =
      "Precision beat volume this decan. That's a durable kind of progress.";
  } else if (explorationPhase) {
    blockC =
      "Exploration set the table; naming one thread will let growth land.";
  } else {
    blockC = "Pattern is solid; repetition is already carrying you forward.";
  }

  // Block D: direction
  let blockD = "";
  if (thinDetails) {
    blockD =
      "Next decan, write two badges with clear titles and one sentence each. Include one number and one quality cue so movement is trackable.";
  } else if (scattered && signals.metrics.topThread) {
    blockD =
      `Choose ${signals.metrics.topThread} as the anchor for 10 days. Track one number and one cue each time; drop the rest temporarily.`;
  } else if (scattered) {
    blockD =
      `Choose the thread that appeared most - ${mainAnchor} - and run it for 10 days. Track one number and one cue; pause the rest.`;
  } else if (clusteredEffort) {
    blockD =
      "Keep the deep bursts but schedule three touch points. Each time, log one number and one cue so the pattern holds.";
  } else if (highRefinement || theoryToApplication) {
    blockD =
      `Stay with one daily measure for ${threadLabel}. Keep it small enough to repeat and honest enough to learn from.`;
  } else {
    blockD =
      `Choose one discipline and deepen it daily. Let consistency do the heavy lifting before adding more.`;
  }
  blockD = buildMaatFallbackNextStep(options?.maatSnapshot, blockD);

  const reflectionParts = [
    reflectionAccountLine(plannerSummary, signals.metrics.topTags),
    blockA.trim(),
    reflectionWholeAccountSignalLine(
      plannerSummary,
      evidenceExamples.length,
    ),
    situation ? reflectionCaseThreadLine(situation) : "",
    blockB.trim(),
    blockC.trim(),
    blockD.trim(),
    reflectionQuestionLine(plannerSummary, signals.metrics.topTags).trim(),
  ];

  return {
    reflection: reflectionParts.filter((p) => p.trim().length).join("\n\n"),
    modelUsed: branch === "decan" ? "local-generator-v2" : "local-legacy-v2",
    badgeCount,
    evidenceCount,
    topTags: signals.metrics.topTags,
    branch,
  };
}

function buildReflection(
  payload: ReflectionPayload,
  current: Summary,
  history: Summary[],
) {
  const sentences: string[] = [];
  sentences.push(`badge_count: ${current.badgeCount} - ${payload.decan_name}`);

  const theme = payload.decan_theme ? `Theme: ${payload.decan_theme}.` : "";
  const cadence = current.cadence !== "none"
    ? `This window moved from ${current.cadence}, holding ${current.badgeCount} marks.`
    : "No badges were recorded in this window.";

  const tags = current.tags.length
    ? `Tags that surfaced: ${current.tags.join(", ")}.`
    : "No tags were captured, so evidence rests on titles and notes alone.";

  const evidence = current.snippets.length
    ? `You noted: ${current.snippets.join(" | ")}.`
    : "Badges were recorded without details to paraphrase.";

  let historyLine = "";
  if (history.length) {
    const parts = history.map((h) => {
      const shift = h.tags.length ? `tags: ${h.tags.join(", ")}` : "tags: none";
      return `${h.label} (${h.badgeCount} badges, ${shift})`;
    });
    historyLine = `Compared to recent decans, shifts appear in ${
      parts.join(" | ")
    }.`;
  }

  const invitation =
    "Carry forward what felt most honest this decan; let the next window deepen one thread you marked, and rest one space that stayed quiet.";

  sentences.push(theme);
  sentences.push(cadence);
  sentences.push(tags);
  sentences.push(evidence);
  if (historyLine) sentences.push(historyLine);
  sentences.push(invitation);

  return sentences.filter((s) => s.trim().length).join(" ");
}

function buildLegacyReflection(payload: ReflectionPayload) {
  const titles = (payload.badge_titles ?? []).filter((t) =>
    t && t.trim().length
  ).map((t) => t.trim());
  const count = payload.badge_count ?? titles.length;
  const sentences: string[] = [];
  sentences.push(`badge_count: ${count} - ${payload.decan_name}`);

  if (payload.decan_theme) {
    sentences.push(`Theme: ${payload.decan_theme}.`);
  }

  if (titles.length) {
    sentences.push(`You marked: ${titles.join(", ")}.`);
  } else {
    sentences.push("Badges were noted without titles to paraphrase.");
  }

  const day = payload.kemetic_day ? `on ${payload.kemetic_day}` : "this decan";
  sentences.push(
    `Across ${day}, your marks show where attention gathered and where quiet remained.`,
  );
  sentences.push(
    "Carry forward what rang true; let one space stay quiet if it needs to, and deepen one thread you named.",
  );

  return sentences.filter((s) => s.trim().length).join(" ");
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = (await req.json()) as ReflectionPayload;
    const hasDecanWindow =
      !!(payload.user_id && payload.decan_start && payload.decan_end);
    const useV2 = payload.v2 !== false;

    if (hasDecanWindow) {
      const includeHistory = payload.include_history !== false;
      const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

      // Current decan evidence: merge client-provided journal badges with
      // server-only planner evidence so app and cron paths stay aligned.
      const currentWindow: DecanWindow = {
        name: payload.decan_name,
        theme: payload.decan_theme ?? null,
        start: payload.decan_start!,
        end: payload.decan_end!,
      };
      const decanPeriodKey = [
        currentWindow.start,
        currentWindow.end,
        payload.decan_context_key ?? payload.decan_name,
      ].join(":");
      const useKnowledgeGraph = payload.use_knowledge_graph === true ||
        payload.use_decision_matrix === true;
      const useDecisionMatrix = payload.use_decision_matrix === true;

      const serverBadges = await fetchBadges(
        client,
        payload.user_id!,
        currentWindow.start,
        currentWindow.end,
      );
      let clientBadges: BadgeRow[] = [];
      if (payload.badges?.length) {
        clientBadges = payload.badges.map((b) => ({
          title: b.title ?? null,
          details: b.details ?? null,
          tags: b.tags ?? null,
          occurred_on: b.occurred_on ?? currentWindow.start,
          flow_id: null,
          event_id: b.event_id ?? null,
        }));
      }
      const currentBadges = dedupeBadges([...clientBadges, ...serverBadges]);
      const evidenceLines = buildEvidenceLines(currentBadges);
      const tagStr = topTags(currentBadges);
      const topTagList = tagStr
        ? tagStr.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      const plannerSummary = buildPlannerSummary(currentBadges);
      const decanContext = getDecanContext(payload.decan_context_key);
      const reflectionCalendarFrame = buildReflectionCalendarFrame({
        decanContext,
        decanName: payload.decan_name,
        decanTheme: payload.decan_theme ?? null,
      });
      const currentMetrics = computeMetrics(
        currentBadges,
        currentWindow,
        evidenceLines.length,
      );
      const reflectionProfile = await fetchReflectionProfile(
        client,
        payload.user_id!,
      );
      const snapshotCount = Math.max(
        currentMetrics.daysActive,
        await fetchMaatSnapshotCount(client, payload.user_id!, decanPeriodKey),
      );
      const goalProfile = await fetchGuidanceGoalProfile(
        client,
        payload.user_id!,
      );
      const personalBaseline = await fetchGuidancePersonalBaseline(
        client,
        payload.user_id!,
      );
      const guidanceMaturity = resolveGuidanceMaturity({
        badgeCount: currentBadges.length,
        snapshotCount,
        profile: reflectionProfile,
        goalProfile,
        personalBaseline,
      });
      const gatePolicy = resolveGatePolicyForMaturity(
        guidanceMaturity,
        goalProfile,
      );
      const axisPriors = resolveGraphAxisPriors({
        profile: reflectionProfile,
        maturity: guidanceMaturity,
      });
      const maatSnapshot = buildMaatDimensionSnapshotFromSignals({
        decanName: payload.decan_name,
        decanTheme: payload.decan_theme ?? null,
        decanContext,
        evidenceTexts: currentBadges.map((badge) => badgeKeywordText(badge)),
        badgeCount: currentBadges.length,
        badgesWithDetails: currentBadges.filter((badge) =>
          normalizedBadgeDetails(badge).length > 0
        ).length,
        activeDays: currentMetrics.daysActive,
        windowStart: currentWindow.start,
        windowEnd: currentWindow.end,
        plannerSummary,
        gatePolicy,
        axisPriors,
      });
      const decisionMatrix = buildReflectionDecisionMatrixFromSnapshot(
        useKnowledgeGraph ? reflectionProfile : null,
        maatSnapshot,
        {
          useKnowledgeGraph,
          useDecisionMatrix,
        },
      );
      const normalizedThreadsForReflection =
        maatSnapshot.source.ledger?.obligation_threads ?? null;
      const reflectionPromptEvidenceLines = buildReflectionPromptEvidenceLines(
        currentBadges,
        normalizedThreadsForReflection,
      );
      const plannerSummaryLineForBrief = buildReflectionPlannerPromptSummary(
        currentBadges,
        normalizedThreadsForReflection,
      );
      // Optional history (recent decans) with metrics for comparison and
      // profile-fact stability. These summaries are still compact; raw prior
      // evidence is not poured into the reflection prompt.
      const historyMetrics: HistoryMetrics[] = [];
      const historySummaries: Summary[] = [];
      if (includeHistory) {
        const historyWindows = await fetchHistoricalWindows(
          client,
          payload.user_id!,
          currentWindow.start,
          payload.past_decans,
        );
        for (const window of historyWindows) {
          try {
            const historyBadges = await fetchBadges(
              client,
              payload.user_id!,
              window.start,
              window.end,
            );
            const histEvidence = buildEvidenceLines(historyBadges);
            const histMetrics = computeMetrics(
              historyBadges,
              window,
              histEvidence.length,
            );
            historyMetrics.push({
              label: window.name ?? `Decan ${window.start} -> ${window.end}`,
              badgeCount: histMetrics.badgeCount,
              daysActive: histMetrics.daysActive,
              progressMarkersCount: histMetrics.progressMarkersCount,
              topThread: histMetrics.topThread,
            });
            historySummaries.push(
              buildSummary(
                historyBadges,
                window,
                window.name ?? `Decan ${window.start} -> ${window.end}`,
              ),
            );
          } catch (err) {
            console.error("History fetch error:", err);
          }
        }
      }
      const [
        guidanceOutcomeStats,
        flowBehaviorStats,
        storedProfileFacts,
      ] = await Promise.all([
        fetchProfileGuidanceOutcomeStats(client, payload.user_id!),
        fetchProfileFlowBehaviorStats(client, payload.user_id!),
        fetchStoredMaatUserProfileFacts(client, payload.user_id!),
      ]);
      const extractedProfileFacts = extractMaatUserProfileFacts({
        userId: payload.user_id!,
        badges: currentBadges,
        historyMetrics,
        normalizedObligationThreads: normalizedThreadsForReflection,
        reflectionProfile: useKnowledgeGraph ? reflectionProfile : null,
        guidanceOutcomes: guidanceOutcomeStats,
        flowBehavior: flowBehaviorStats,
      });
      const mergedProfileFacts = mergeMaatUserProfileFacts(
        storedProfileFacts,
        extractedProfileFacts,
      );
      await upsertMaatUserProfileFacts(
        client,
        payload.user_id!,
        mergedProfileFacts.filter((fact) =>
          extractedProfileFacts.some((extracted) =>
            extracted.fact_type === fact.fact_type &&
            extracted.value === fact.value
          )
        ),
      );
      const translatedProfileContext = translateMaatProfileContext(
        mergedProfileFacts,
        { maxPhrases: 4 },
      );
      const translatedProfileContextBlock = profileContextPromptBlock(
        translatedProfileContext,
      );
      const memoryBrief = buildUserMemoryBrief({
        profile: useKnowledgeGraph ? reflectionProfile : null,
        badges: currentBadges,
        evidencePhrases: evidenceExamplePhrases(
          reflectionPromptEvidenceLines,
          4,
        ),
        plannerSummaryLine: plannerSummaryLineForBrief,
        snapshot: maatSnapshot,
        decanContext,
        decanName: payload.decan_name,
        decanTheme: payload.decan_theme,
      });
      const targetWordRange = evidenceLines.length >= 6 ||
          currentBadges.length >= 8 ||
          (maatSnapshot.source.details_coverage ?? 0) >= 0.35
        ? "155-215"
        : "125-180";
      const reflectionUserPatternProfile = buildReflectionUserPatternProfile({
        maturity: guidanceMaturity,
        profile: useKnowledgeGraph ? reflectionProfile : null,
        normalizedObligationThreads: normalizedThreadsForReflection,
        evidenceTexts: currentBadges.map((badge) => badgeKeywordText(badge)),
        activeDays: currentMetrics.daysActive,
      });
      let reflectionOutputPlan = buildReflectionOutputPlan({
        targetWordRange,
        memoryEvidencePhrases: memoryBrief.evidencePhrases,
        snapshot: maatSnapshot,
        calendarFrame: reflectionCalendarFrame,
        userPatternProfile: reflectionUserPatternProfile,
        translatedProfileContext,
        profileFacts: mergedProfileFacts,
        reflectionProfile: useKnowledgeGraph ? reflectionProfile : null,
        guidanceOutcomes: guidanceOutcomeStats,
        historyMetrics,
      });
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      let reflectionText = "";
      let modelUsed = "local-generator-v2";
      const rendererDiagnostics: Record<string, unknown> = {
        renderer_version: "reflection_renderer_diagnostics_v1",
        anthropic_available: Boolean(apiKey),
        anthropic_attempted: false,
        moral_portrait_attempted: false,
        moral_portrait_source: "deterministic",
        moral_portrait_model_used: null,
        moral_portrait_error: null,
        judgment_attempted: false,
        judgment_source: "deterministic",
        judgment_model_used: null,
        judgment_error: null,
        plain_sacred_editor_attempted: false,
        plain_sacred_editor_applied: false,
        plain_sacred_editor_source: null,
        plain_sacred_editor_model_used: null,
        plain_sacred_editor_error: null,
        plain_sacred_editor_removed_abstractions: [],
        plain_sacred_editor_warnings: [],
        renderer: "local-generator-v2",
        fallback_reason: apiKey ? null : "missing_anthropic_key",
        error: null,
      };
      const moralPortraitInput: ReflectionMoralPortraitInput = {
        calendarFrame: reflectionCalendarFrame,
        profileSnapshot: reflectionOutputPlan.reflectionProfileSnapshot,
        translatedProfileContext,
        normalizedObligationThreads: normalizedThreadsForReflection,
        alignmentMap: reflectionOutputPlan.reflectionAlignmentMap ?? null,
        arcPlan: reflectionOutputPlan.reflectionArcPlan ?? null,
        recentOutcomes: guidanceOutcomeStats,
      };
      let reflectionMoralPortrait: ReflectionMoralPortrait =
        buildFallbackReflectionMoralPortrait(moralPortraitInput);
      if (apiKey) {
        rendererDiagnostics.moral_portrait_attempted = true;
        try {
          const portraitResult = await generateReflectionMoralPortrait(
            moralPortraitInput,
          );
          reflectionMoralPortrait = portraitResult.moralPortrait;
          rendererDiagnostics.moral_portrait_source =
            reflectionMoralPortrait.source;
          rendererDiagnostics.moral_portrait_model_used =
            portraitResult.modelUsed;
        } catch (portraitErr) {
          rendererDiagnostics.moral_portrait_error =
            portraitErr instanceof Error
              ? portraitErr.message
              : String(portraitErr);
          console.error(
            "Anthropic reflection moral portrait error, using deterministic portrait:",
            portraitErr,
          );
        }
      }
      const judgmentInput: ReflectionJudgmentInput = {
        calendarFrame: reflectionCalendarFrame,
        moralPortrait: reflectionMoralPortrait,
        profileSnapshot: reflectionOutputPlan.reflectionProfileSnapshot,
        translatedProfileContext,
        normalizedObligationThreads: normalizedThreadsForReflection,
        alignmentMap: reflectionOutputPlan.reflectionAlignmentMap ?? null,
        arcPlan: reflectionOutputPlan.reflectionArcPlan ?? null,
        recentOutcomes: guidanceOutcomeStats,
      };
      let reflectionJudgment: ReflectionJudgment =
        buildFallbackReflectionJudgment(judgmentInput);
      if (apiKey) {
        rendererDiagnostics.judgment_attempted = true;
        try {
          const judgmentResult = await generateReflectionJudgment(
            judgmentInput,
          );
          reflectionJudgment = judgmentResult.judgment;
          rendererDiagnostics.judgment_source = reflectionJudgment.source;
          rendererDiagnostics.judgment_model_used = judgmentResult.modelUsed;
        } catch (judgmentErr) {
          rendererDiagnostics.judgment_error = judgmentErr instanceof Error
            ? judgmentErr.message
            : String(judgmentErr);
          console.error(
            "Anthropic reflection judgment error, using deterministic judgment:",
            judgmentErr,
          );
        }
      }
      const reflectionThesisGate: ReflectionThesisGate =
        buildReflectionThesisGate({
          judgment: reflectionJudgment,
          selectedEvidenceAnchor:
            reflectionOutputPlan.reflectionProfileSnapshot?.bestEvidenceAnchor
              ?.claim ?? reflectionJudgment.evidenceAnchor,
          normalizedObligationThreads: normalizedThreadsForReflection,
          profileSnapshot: reflectionOutputPlan.reflectionProfileSnapshot,
          calendarFrame: reflectionCalendarFrame,
        });
      const evidenceVisible =
        reflectionThesisGate.evidenceVisibility === "visible_anchor";
      reflectionOutputPlan = {
        ...reflectionOutputPlan,
        reflectionMoralPortrait,
        reflectionJudgment,
        reflectionThesisGate,
        requiredEvidenceDetailCount: evidenceVisible
          ? reflectionOutputPlan.requiredEvidenceDetailCount
          : 0,
        evidenceUsePolicy: {
          ...reflectionOutputPlan.evidenceUsePolicy,
          instruction: evidenceVisible
            ? reflectionOutputPlan.evidenceUsePolicy?.instruction
            : "The selected evidence is background support for the judgment. Keep the item/source out of the reflection body and render the moral thesis instead.",
        },
        closingInstruction: reflectionJudgment.closingText,
        rhetoricalMoves: [
          ...reflectionOutputPlan.rhetoricalMoves,
          "serve_reflection_moral_portrait",
          "render_reflection_judgment_thesis",
          "apply_reflection_thesis_gate",
        ],
      };
      const reflectionCalendarBlock = reflectionCalendarPromptBlock({
        calendarFrame: reflectionCalendarFrame,
        alignmentMap: reflectionOutputPlan.reflectionAlignmentMap ?? null,
        userPatternProfile: reflectionUserPatternProfile,
        arcPlan: reflectionOutputPlan.reflectionArcPlan ?? null,
      });
      const reflectionProfileSnapshotBlock =
        reflectionProfileSnapshotPromptBlock(
          reflectionOutputPlan.reflectionProfileSnapshot,
        );
      const reflectionMoralPortraitBlock = reflectionMoralPortraitPromptBlock(
        reflectionMoralPortrait,
      );
      const reflectionJudgmentBlock = reflectionJudgmentPromptBlock(
        reflectionJudgment,
      );
      const reflectionThesisGateBlock = reflectionThesisGatePromptBlock(
        reflectionThesisGate,
      );
      const outputControlPromptBlock = generatedTextPlanPromptBlock(
        reflectionOutputPlan,
      );
      const shapingFingerprint = buildGuidanceShapingFingerprint({
        maturity: guidanceMaturity,
        profile: reflectionProfile,
        gatePolicy,
        axisPriors,
        goalProfile,
        personalBaseline,
        decisionMatrixFingerprint: decisionMatrix?.fingerprint ?? null,
      });

      if (apiKey) {
        rendererDiagnostics.anthropic_attempted = true;
        try {
          const systemPrompt =
            `You write decan reflections (one 10-day period). Use only the evidence provided. Target ${targetWordRange} words; this is a hard limit. Use 3 short paragraphs and no more than 7 sentences. This is not a longer nudge: the calendar/decan/day-card arc governs the spiritual frame, REFLECTION_MORAL_PORTRAIT governs the witness of who the user is becoming, REFLECTION_JUDGMENT governs the moral thesis, REFLECTION_THESIS_GATE decides whether evidence may be visible, REFLECTION_PROFILE_SNAPSHOT contains the Ma'at alignment lens and personal lens, and the case thread is one detail inside that judgment. The first sentence must name the current decan using the canonical spoken decan name from REFLECTION_CALENDAR_FRAME, then fuse the calendar demand with a living portrait of the user before any item, missed mark, task, or case diagnosis. Begin from REFLECTION_MORAL_PORTRAIT.personBecomingStatement and REFLECTION_MORAL_PORTRAIT.portraitStatement and write from REFLECTION_THESIS_GATE.finalReflectionThesis when supplied; otherwise write from REFLECTION_JUDGMENT.reflectionThesis. The selected evidence anchor is proof only when REFLECTION_THESIS_GATE.evidenceVisibility is visible_anchor. If evidenceVisibility is background_support or diagnostics_only, keep the evidence in diagnostics; do not name the item/source, do not make it the subject, and obey forbiddenSurfaceFocus. Respect REFLECTION_MORAL_PORTRAIT.forbiddenFramings and REFLECTION_JUDGMENT.falseReadingToAvoid. Address the user directly with you/your. The person is the protagonist. Record/account/mark/evidence may not become the subject or goal; use record or mark at most once if truly necessary. Do not use "the account" or the word "account" in user-facing prose; say your day, your practice, what you kept, or what you can carry. Do not expose the scaffold: never write "Where you answered", "Where restoration is still needed", "The alignment is", "The underalignment is", "The improvement direction is", or any direct label-like rendering of hidden fields. Let the portrait reveal both alignment and restoration without category labels. Use USER_PROFILE_CONTEXT to personalize interpretation, but never print profile labels, fact keys, source names, or raw user data. Treat journal badges and planner item states (checked, partial, skipped, and unchecked to-dos/nutrition) as equally valid evidence. If normalized obligation threads are supplied, treat them as authoritative: unique_item_count is the number of obligations and occurrence_count is repetition. One recurring item across the period is one thread, not several supports. For a single recurring thread, do not contrast against several/multiple supports and do not mention exact occurrence counts, "daily," "every day," or "all ten days"; if the thesis gate hides evidence, do not mention the thread at all. Use one concrete detail only when the thesis gate permits visible_anchor, then move to Ma'at synthesis in plain language. If the thesis gate hides the selected anchor, still use 1-2 non-suppressed middle details from BADGE EVIDENCE or USER_PROFILE_CONTEXT when available, especially observed flows, calendar events, reminders, visible work, or journal badges; do not quote journal text and do not dump raw inputs. If you use a Ma'at term, explain it in ordinary words in the same sentence, such as right size, clear place, truthful form, steady care, or follow-through. Avoid coded phrases: written witness, act and account, embodied order, underalignment, life accomplished, dependent on inference, account cannot prove, and the account. Hard ban system-serving phrases: next reflection, less guesswork, enough detail, record cannot show, what may already have occurred, truth asks for enough detail, improvement direction, record tells the truth, record can match, mark of care, complete today so your record, written record drift apart. Do not repeat the same activity, nutrition item, source, purpose, count, or date. Every sentence should do at least two jobs: fuse decan frame with portrait, turn evidence into meaning, or let the directive arise naturally from who the user is becoming. Do not list action options. Follow REFLECTION_JUDGMENT: end with exactly one question or exactly one charge, never both. Prefer weight-bearing closings such as "What would it mean to...", "What would restore...", "What are you willing to return to...", or "What must be made whole..."; avoid "what would it look like" unless the judgment explicitly requires a gentle exploratory close. Keep gravity proportionate: ordinary nutrition support should remain routine unless evidence shows real harm or clinical urgency. Do not use defensive "not failure / not judgment / not crisis" phrasing. No unsupported generalities; if you mention an activity, it must appear in the evidence and be permitted by the thesis gate. Non-judgmental, warm tone. Aim for: morally oriented toward Ma'at, not coached on habits. No bullets, no metadata, no generic advice. If hidden Ma'at/Isfet guardrails, output-control plan, moral portrait, reflection judgment, thesis gate, user profile snapshot, user profile context, calendar frame, or memory brief are present, use them only for tone, evidence visibility, structure, and closing strategy; never expose scores, gates, labels, slugs, matrix language, profile fact labels, or output-control fields.`;
          const userPrompt = buildAnthropicPrompt(
            payload,
            currentBadges,
            reflectionPromptEvidenceLines,
            topTagList,
            historySummaries,
            decisionMatrix,
            {
              memoryBriefMarkdown: memoryBrief.markdown,
              calendarPromptBlock: reflectionCalendarBlock,
              profileSnapshotPromptBlock: reflectionProfileSnapshotBlock,
              moralPortraitPromptBlock: reflectionMoralPortraitBlock,
              reflectionJudgmentPromptBlock: reflectionJudgmentBlock,
              reflectionThesisGatePromptBlock: reflectionThesisGateBlock,
              profileContextPromptBlock: translatedProfileContextBlock,
              outputControlPromptBlock,
              plannerSummaryLineOverride: plannerSummaryLineForBrief,
              targetWordRange,
            },
          );
          const res = await callAnthropic([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ]);
          if (res.text && res.text.trim().length) {
            reflectionText = sanitizeRecurringThreadReflectionLanguage(
              res.text.trim(),
              normalizedThreadsForReflection,
            );
            modelUsed = res.modelUsed ?? modelUsed;
            rendererDiagnostics.renderer = "anthropic";
            rendererDiagnostics.model_used = modelUsed;
            rendererDiagnostics.fallback_reason = null;
          }
        } catch (llmErr) {
          rendererDiagnostics.fallback_reason = "anthropic_error";
          rendererDiagnostics.error = llmErr instanceof Error
            ? llmErr.message
            : String(llmErr);
          console.error(
            "Anthropic reflection error, falling back to deterministic v2:",
            llmErr,
          );
        }
      }

      if (!reflectionText) {
        const v2 = buildV2Reflection(
          payload,
          currentBadges.length,
          evidenceLines,
          topTagList,
          "decan",
          {
            badges: currentBadges,
            window: currentWindow,
            history: historyMetrics,
            maatSnapshot,
          },
        );
        reflectionText = v2.reflection.trim();
        modelUsed = v2.modelUsed;
        rendererDiagnostics.renderer = modelUsed;
        rendererDiagnostics.model_used = modelUsed;
        if (!rendererDiagnostics.fallback_reason) {
          rendererDiagnostics.fallback_reason = "empty_anthropic_text";
        }
      }

      let reflectionPlainSacredEdit: ReflectionPlainSacredEdit | null = null;
      const plainSacredEditorInput: ReflectionPlainSacredEditorInput = {
        renderedReflection: reflectionText,
        moralPortrait: reflectionMoralPortrait,
        judgment: reflectionJudgment,
        thesisGate: reflectionThesisGate,
        profileSnapshot: reflectionOutputPlan.reflectionProfileSnapshot,
        calendarFrame: reflectionCalendarFrame,
        targetWordRange,
      };
      if (apiKey && reflectionText) {
        rendererDiagnostics.plain_sacred_editor_attempted = true;
        try {
          const editorResult = await generateReflectionPlainSacredEdit(
            plainSacredEditorInput,
          );
          reflectionPlainSacredEdit = editorResult.edit;
          const editedText = sanitizeRecurringThreadReflectionLanguage(
            editorResult.edit.editedReflectionText,
            normalizedThreadsForReflection,
          );
          const editedValidation = validateGeneratedTextAgainstPlan(
            reflectionOutputPlan,
            editedText,
          );
          if (hasPlainSacredEditorWarnings(editedValidation)) {
            const fallbackEdit = buildFallbackReflectionPlainSacredEdit({
              ...plainSacredEditorInput,
              renderedReflection: editedText,
            });
            reflectionPlainSacredEdit = fallbackEdit;
            reflectionText = sanitizeRecurringThreadReflectionLanguage(
              fallbackEdit.editedReflectionText,
              normalizedThreadsForReflection,
            );
            rendererDiagnostics.plain_sacred_editor_source =
              "deterministic_after_editor_validation";
            rendererDiagnostics.plain_sacred_editor_warnings =
              editedValidation.warnings;
            rendererDiagnostics.plain_sacred_editor_removed_abstractions =
              fallbackEdit.removedAbstractions;
          } else {
            reflectionText = editedText;
            rendererDiagnostics.plain_sacred_editor_source =
              editorResult.edit.source;
            rendererDiagnostics.plain_sacred_editor_warnings =
              editorResult.edit.editorWarnings;
            rendererDiagnostics.plain_sacred_editor_removed_abstractions =
              editorResult.edit.removedAbstractions;
          }
          modelUsed = editorResult.modelUsed ?? modelUsed;
          rendererDiagnostics.plain_sacred_editor_applied = true;
          rendererDiagnostics.plain_sacred_editor_model_used =
            editorResult.modelUsed;
        } catch (editorErr) {
          rendererDiagnostics.plain_sacred_editor_error =
            editorErr instanceof Error ? editorErr.message : String(editorErr);
          console.error(
            "Anthropic plain sacred editor error, continuing with rendered reflection:",
            editorErr,
          );
        }
      } else if (reflectionText) {
        reflectionPlainSacredEdit = buildFallbackReflectionPlainSacredEdit(
          plainSacredEditorInput,
        );
        reflectionText = sanitizeRecurringThreadReflectionLanguage(
          reflectionPlainSacredEdit.editedReflectionText,
          normalizedThreadsForReflection,
        );
        rendererDiagnostics.plain_sacred_editor_applied = true;
        rendererDiagnostics.plain_sacred_editor_source =
          reflectionPlainSacredEdit.source;
        rendererDiagnostics.plain_sacred_editor_removed_abstractions =
          reflectionPlainSacredEdit.removedAbstractions;
        rendererDiagnostics.plain_sacred_editor_warnings =
          reflectionPlainSacredEdit.editorWarnings;
      }

      let reflectionOutputValidation = validateGeneratedTextAgainstPlan(
        reflectionOutputPlan,
        reflectionText,
      );
      let reflectionOutputGrade = gradeGeneratedTextAgainstPlan(
        reflectionOutputPlan,
        reflectionText,
        reflectionOutputValidation,
      );
      let reflectionOutputRepair: Record<string, unknown> | null = null;
      if (
        apiKey && !reflectionOutputGrade.pass &&
        reflectionOutputGrade.repairInstruction
      ) {
        try {
          const repairResult = await repairReflectionOutput({
            plan: reflectionOutputPlan,
            text: reflectionText,
            validation: reflectionOutputValidation,
            grade: reflectionOutputGrade,
          });
          const repairedText = sanitizeRecurringThreadReflectionLanguage(
            repairResult.text.trim(),
            normalizedThreadsForReflection,
          );
          if (repairedText.length > 0) {
            const repairedValidation = validateGeneratedTextAgainstPlan(
              reflectionOutputPlan,
              repairedText,
            );
            const repairedGrade = gradeGeneratedTextAgainstPlan(
              reflectionOutputPlan,
              repairedText,
              repairedValidation,
            );
            const applied = shouldUseReflectionRepair(
              reflectionOutputValidation,
              reflectionOutputGrade,
              repairedValidation,
              repairedGrade,
            );
            reflectionOutputRepair = {
              attempted: true,
              applied,
              model_used: repairResult.modelUsed,
              repair_mode: reflectionOutputGrade.repairMode,
              repair_reason: reflectionOutputGrade.failureReasons[0] ?? null,
              repair_instruction: reflectionOutputGrade.repairInstruction,
              original_failure_reasons: reflectionOutputGrade.failureReasons,
              repaired_failure_reasons: repairedGrade.failureReasons,
              pre_repair_grade: reflectionOutputGrade,
              post_repair_grade: repairedGrade,
              pre_repair_text: reflectionText,
              post_repair_text: repairedText,
              grade_delta: outputGradeDelta(
                reflectionOutputGrade,
                repairedGrade,
              ),
            };
            if (applied) {
              reflectionText = repairedText;
              modelUsed = repairResult.modelUsed ?? modelUsed;
              reflectionOutputValidation = repairedValidation;
              reflectionOutputGrade = repairedGrade;
            }
          }
        } catch (repairErr) {
          reflectionOutputRepair = {
            attempted: true,
            applied: false,
            error: repairErr?.message ?? String(repairErr),
            repair_mode: reflectionOutputGrade.repairMode,
            repair_reason: reflectionOutputGrade.failureReasons[0] ?? null,
            repair_instruction: reflectionOutputGrade.repairInstruction,
            original_failure_reasons: reflectionOutputGrade.failureReasons,
            pre_repair_grade: reflectionOutputGrade,
          };
          console.error("Reflection output repair error:", repairErr);
        }
      }

      const reflectionTeaserText = clampText(
        firstSentence(reflectionText),
        160,
      );
      const reflectionPushText = clampText(firstSentence(reflectionText), 110);
      const reflectionOutputCompiler = reflectionCompilerPayload({
        plan: reflectionOutputPlan,
        renderer: rendererDiagnostics,
        modelUsed,
        text: reflectionText,
        teaserText: reflectionTeaserText,
        validation: reflectionOutputValidation,
        grade: reflectionOutputGrade,
        repair: reflectionOutputRepair,
      });
      const reflectionDestination = resolveReflectionDestination({
        judgment: reflectionJudgment,
        moralPortrait: reflectionMoralPortrait,
        profileSnapshot: reflectionOutputPlan.reflectionProfileSnapshot,
        calendarFrame: reflectionCalendarFrame,
        profileFacts: mergedProfileFacts,
        normalizedObligationThreads: normalizedThreadsForReflection,
      });
      const reflectionOutputPackage = buildCompiledOutputPackage({
        surface: "reflection",
        finalText: reflectionText,
        teaserText: reflectionTeaserText,
        pushText: reflectionPushText,
        archivePreviewText: clampText(reflectionText, 220),
        ctaType: reflectionDestination.ctaType,
        ctaRef: reflectionDestination.ctaRef,
        ctaLabel: reflectionDestination.ctaLabel,
        ctaReason: reflectionDestination.destinationReason,
        ctaSource: reflectionDestination.source,
        destination: compiledDestinationForPackage(reflectionDestination),
        compiler: reflectionOutputCompiler,
      });
      const profileFactsForDiagnostics = mergedProfileFacts.slice(0, 12).map(
        (fact) => ({
          fact_type: fact.fact_type,
          value: fact.value,
          confidence: fact.confidence,
          stability: fact.stability,
          evidence_count: fact.evidence_count,
          source: fact.source,
        }),
      );

      let reflectionId: string | null = null;
      let reflectionGenerationId: string | null = null;

      if (payload.persist) {
        try {
          const { data: insertData, error: insertErr } = await client
            .from("decan_reflections")
            .upsert({
              user_id: payload.user_id!,
              decan_name: payload.decan_name,
              decan_theme: payload.decan_theme ?? null,
              decan_start: payload.decan_start!,
              decan_end: payload.decan_end!,
              badge_count: currentBadges.length,
              reflection_text: reflectionText,
            }, {
              onConflict: "user_id,decan_start",
            })
            .select("id")
            .single();
          if (!insertErr) {
            reflectionId = insertData?.id ?? null;
          } else {
            console.error("Persist reflection error:", insertErr);
          }
        } catch (persistErr) {
          console.error("Persist reflection exception:", persistErr);
        }

        try {
          const { data: generationData, error: generationErr } = await client
            .from("reflection_generations")
            .insert({
              user_id: payload.user_id!,
              period_type: "decan",
              period_key: decanPeriodKey,
              anchor_nodes: decisionMatrix?.anchorNodes ?? [],
              source_snapshot: {
                decan_name: payload.decan_name,
                decan_theme: payload.decan_theme ?? null,
                decan_context_key: payload.decan_context_key ?? null,
                decan_start: currentWindow.start,
                decan_end: currentWindow.end,
                badge_count: currentBadges.length,
                evidence_count: evidenceLines.length,
                top_tags: topTagList,
                planner_summary: plannerSummary,
                history_windows: historySummaries.length,
                decan_reflection_id: reflectionId,
                maturity_level: guidanceMaturity.level,
                maturity_confidence: guidanceMaturity.confidence,
                gate_policy: shapingFingerprint.gate_policy,
                shaping_fingerprint: shapingFingerprint,
                memory_brief: {
                  context_quality: memoryBrief.contextQuality,
                  anchor_labels: memoryBrief.anchorLabels,
                  tension_labels: memoryBrief.tensionLabels,
                  evidence_phrases: memoryBrief.evidencePhrases,
                },
                output_control: {
                  policy_version: reflectionOutputPlan.policyVersion,
                  constitution_version:
                    reflectionOutputPlan.constitutionVersion ??
                      MAAT_CONSTITUTION_VERSION,
                  north_star: reflectionOutputPlan.northStar ??
                    MAAT_OUTPUT_NORTH_STAR,
                  force_principle: reflectionOutputPlan.forcePrinciple ??
                    MAAT_OUTPUT_FORCE_PRINCIPLE,
                  plan: reflectionOutputPlan,
                  validation: reflectionOutputValidation,
                  grade: reflectionOutputGrade,
                  repair: reflectionOutputRepair,
                  renderer: rendererDiagnostics,
                  reflection_moral_portrait: reflectionMoralPortrait,
                  reflection_judgment: reflectionJudgment,
                  reflection_thesis_gate: reflectionThesisGate,
                  reflection_destination: destinationPayload(
                    reflectionDestination,
                  ).destination,
                  profile_snapshot:
                    reflectionOutputPlan.reflectionProfileSnapshot,
                  profile_context: translatedProfileContext,
                  profile_facts: profileFactsForDiagnostics,
                  output_compiler: reflectionOutputCompiler,
                  compiled_output_package: reflectionOutputPackage,
                },
              },
              generated_text: reflectionText,
              model_version: modelUsed,
              metadata: {
                policy_version: "decan_maat_dm_v1",
                guidance_policy_version: MAAT_GUIDANCE_POLICY_VERSION,
                use_knowledge_graph: useKnowledgeGraph,
                use_decision_matrix: useDecisionMatrix,
                maturity_level: guidanceMaturity.level,
                maturity_label: guidanceMaturity.label,
                maturity_confidence: guidanceMaturity.confidence,
                gate_policy: shapingFingerprint.gate_policy,
                shaping_fingerprint: shapingFingerprint,
                maat_dimensions: maatSnapshot.dimensions,
                maat_dimension_score: maatSnapshot.score,
                maat_dimension_band: maatSnapshot.band,
                reflection_move: maatSnapshot.reflectionMove,
                lead_axis: maatSnapshot.leadAxis,
                correction_axes: maatSnapshot.correctionAxes,
                hard_gates: maatSnapshot.hardGates,
                dimension_source: maatSnapshot.source,
                decision_matrix: decisionMatrix?.fingerprint ?? null,
                memory_context_quality: memoryBrief.contextQuality,
                output_control: {
                  policy_version: reflectionOutputPlan.policyVersion,
                  constitution_version:
                    reflectionOutputPlan.constitutionVersion ??
                      MAAT_CONSTITUTION_VERSION,
                  north_star: reflectionOutputPlan.northStar ??
                    MAAT_OUTPUT_NORTH_STAR,
                  force_principle: reflectionOutputPlan.forcePrinciple ??
                    MAAT_OUTPUT_FORCE_PRINCIPLE,
                  plan: reflectionOutputPlan,
                  validation: reflectionOutputValidation,
                  grade: reflectionOutputGrade,
                  repair: reflectionOutputRepair,
                  renderer: rendererDiagnostics,
                  reflection_moral_portrait: reflectionMoralPortrait,
                  reflection_judgment: reflectionJudgment,
                  reflection_thesis_gate: reflectionThesisGate,
                  reflection_destination: destinationPayload(
                    reflectionDestination,
                  ).destination,
                  profile_snapshot:
                    reflectionOutputPlan.reflectionProfileSnapshot,
                  profile_context: translatedProfileContext,
                  profile_facts: profileFactsForDiagnostics,
                  output_compiler: reflectionOutputCompiler,
                  compiled_output_package: reflectionOutputPackage,
                },
              },
            })
            .select("id")
            .single();
          if (!generationErr) {
            reflectionGenerationId = generationData?.id ?? null;
          } else {
            console.error(
              "Persist reflection generation error:",
              generationErr,
            );
          }
        } catch (generationPersistErr) {
          console.error(
            "Persist reflection generation exception:",
            generationPersistErr,
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          reflection: reflectionText,
          modelUsed,
          tokensIn: 0,
          tokensOut: 0,
          badgeCount: currentBadges.length,
          evidenceCount: evidenceLines.length,
          topTags: topTagList,
          branch: "decan",
          reflection_id: reflectionId,
          reflection_generation_id: reflectionGenerationId,
          knowledgeGraphUsed: useKnowledgeGraph && !!reflectionProfile,
          decisionMatrixUsed: useDecisionMatrix && !!decisionMatrix,
          outputControl: {
            policyVersion: reflectionOutputPlan.policyVersion,
            constitutionVersion: reflectionOutputPlan.constitutionVersion ??
              MAAT_CONSTITUTION_VERSION,
            northStar: reflectionOutputPlan.northStar ??
              MAAT_OUTPUT_NORTH_STAR,
            forcePrinciple: reflectionOutputPlan.forcePrinciple ??
              MAAT_OUTPUT_FORCE_PRINCIPLE,
            validation: reflectionOutputValidation,
            grade: reflectionOutputGrade,
            repair: reflectionOutputRepair,
            renderer: rendererDiagnostics,
            reflectionMoralPortrait,
            reflectionJudgment,
            reflectionThesisGate,
            profileSnapshot: reflectionOutputPlan.reflectionProfileSnapshot,
            profileContext: translatedProfileContext,
            profileFacts: profileFactsForDiagnostics,
            outputCompiler: reflectionOutputCompiler,
            compiledOutputPackage: reflectionOutputPackage,
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Legacy fallback: no decan window provided; rely on badge_titles payload
    if (useV2) {
      const titles = (payload.badge_titles ?? []).filter((t) =>
        t && t.trim().length
      ).map((t) => t.trim());
      const evidenceLines = buildEvidenceLinesLegacy(titles);
      const badgeCount = payload.badge_count ?? titles.length;
      const v2 = buildV2Reflection(
        payload,
        badgeCount,
        evidenceLines,
        [],
        "legacy",
      );
      return new Response(
        JSON.stringify({
          success: true,
          reflection: v2.reflection.trim(),
          modelUsed: v2.modelUsed,
          tokensIn: 0,
          tokensOut: 0,
          badgeCount: v2.badgeCount,
          evidenceCount: v2.evidenceCount,
          topTags: v2.topTags,
          branch: v2.branch,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } else {
      const legacyReflection = buildLegacyReflection(payload);
      return new Response(
        JSON.stringify({
          success: true,
          reflection: legacyReflection.trim(),
          modelUsed: "local-legacy",
          tokensIn: 0,
          tokensOut: 0,
          badgeCount: payload.badge_count ??
            (payload.badge_titles?.length ?? 0),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
  } catch (error) {
    console.error("Reflection generation error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message ?? "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
