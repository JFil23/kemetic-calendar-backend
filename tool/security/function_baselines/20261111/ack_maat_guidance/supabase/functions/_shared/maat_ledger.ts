import type {
  MaatAxisCode,
  MaatPlannerSummaryInput,
} from "../ai_generate_reflection/maat_decision.ts";
import {
  buildNormalizedObligationThreads,
  type MaatNormalizedObligationThreads,
} from "./maat_obligation_threads.ts";

export const MAAT_LEDGER_VERSION = "maat_ledger_v1";

export type MaatResolutionConfidence =
  | "exact_source_match"
  | "same_kind_same_day"
  | "same_axis_same_decan"
  | "fallback_axis_match";

export function isResolutionClosing(
  confidence: MaatResolutionConfidence | null | undefined,
) {
  return confidence === "exact_source_match" ||
    confidence === "same_kind_same_day" ||
    confidence === "same_axis_same_decan";
}

export type MaatLedgerAxis =
  | "truth"
  | "measure"
  | "life_preservation"
  | "vulnerable_protection"
  | "justice"
  | "stewardship"
  | "ecological_flow"
  | "restraint"
  | "cohesion";

export type IsfetPattern =
  | "falsehood"
  | "distorted_measure"
  | "harm"
  | "exploitation"
  | "corrupt_judgment"
  | "excess"
  | "blocked_flow"
  | "broken_obligation"
  | "fragmentation"
  | "neglect";

export type MaatLedgerField =
  | "provision"
  | "visible_work"
  | "truthful_record"
  | "rhythm"
  | "restraint"
  | "care"
  | "speech"
  | "order"
  | "release"
  | "attention"
  | "study"
  | "craft";

export type MaatLedgerRestoration = {
  field: MaatLedgerField;
  human_label: string;
  isfet_leak: string;
  maat_restoration: string;
  user_facing_evidence: string;
  axis_codes: MaatAxisCode[];
  isfet_patterns: IsfetPattern[];
  action: string;
  direction:
    | "enhance"
    | "strengthen"
    | "engage"
    | "tend"
    | "restore"
    | "release"
    | "reduce";
  cta_hint: "flow" | "planner" | "journal" | "none";
};

export type MaatLedgerStalledRestoration = {
  field: MaatLedgerField;
  action: string;
  direction: "reduce" | "release";
  age_hours: number | null;
  acted_count: number;
  resolved_count: number;
  repeat_leak_count: number;
  source_obligation_id: string | null;
};

export type MaatLedgerSummary = {
  version: typeof MAAT_LEDGER_VERSION;
  open_obligations: number;
  partial_obligations: number;
  resolved_obligations: number;
  broken_obligations: number;
  unresolved_obligations: number;
  dominant_leak: {
    field: MaatLedgerField;
    open: number;
    broken: number;
    score: number;
  } | null;
  suggested_restoration: MaatLedgerRestoration | null;
  stalled_restoration: MaatLedgerStalledRestoration | null;
  axis_deltas: Partial<Record<MaatAxisCode, number>>;
  isfet_patterns: Partial<Record<IsfetPattern, number>>;
  source_counts: {
    todo_pending: number;
    todo_skipped: number;
    todo_partial: number;
    todo_done: number;
    nutrition_pending: number;
    nutrition_skipped: number;
    nutrition_partial: number;
    nutrition_done: number;
  };
  obligation_threads: MaatNormalizedObligationThreads;
};

export type MaatLedgerStoreClient = {
  // Edge tests inject small builders; production passes Supabase.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

export type MaatRestorationSuggestedInput = {
  client: MaatLedgerStoreClient;
  userId: string;
  decanPeriodKey: string;
  deliveryId: string;
  deliveryKind: string;
  ctaType?: string | null;
  ctaRef?: string | null;
  triggerReason?: string | null;
  payload: Record<string, unknown>;
  nowIso?: string;
};

export type MaatRestorationOutcomeInput = {
  client: MaatLedgerStoreClient;
  userId: string;
  deliveryId: string;
  action: "shown" | "dismissed" | "opened" | "acted" | "expired";
  metadata?: Record<string, unknown> | null;
  nowIso?: string;
};

type QueryResult<T> = Promise<{ data: T | null; error: unknown | null }>;
type Row = Record<string, unknown>;

type FieldScore = {
  field: MaatLedgerField;
  score: number;
  open: number;
  broken: number;
  confidence: "low" | "medium" | "high";
  reason: string;
};

type MaatLedgerBuildContext = {
  evidenceTexts?: string[];
  decanTheme?: string | null;
  recentFields?: MaatLedgerField[];
};

function n(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function fieldRestoration(
  field: MaatLedgerField,
): MaatLedgerRestoration {
  if (field === "provision") {
    return {
      field,
      human_label: "body support",
      isfet_leak: "a body-support thread is still open",
      maat_restoration: "mark one food, water, rest, or nutrition support",
      user_facing_evidence: "One body-support thread is still open.",
      axis_codes: ["S", "H", "E"],
      isfet_patterns: ["blocked_flow", "neglect"],
      action: "complete one nutrition check today",
      direction: "tend",
      cta_hint: "flow",
    };
  }
  if (field === "visible_work") {
    return {
      field,
      human_label: "visible work",
      isfet_leak: "a concrete task is still open",
      maat_restoration: "close one task with a finish condition",
      user_facing_evidence: "One visible task is still open.",
      axis_codes: ["M", "C", "S"],
      isfet_patterns: ["broken_obligation", "blocked_flow"],
      action: "complete one to-do with a clear finish condition",
      direction: "engage",
      cta_hint: "planner",
    };
  }
  const restorations: Record<MaatLedgerField, MaatLedgerRestoration> = {
    provision: fieldRestoration("provision"),
    visible_work: fieldRestoration("visible_work"),
    truthful_record: {
      field: "truthful_record",
      human_label: "honest record",
      isfet_leak: "the record is too thin to weigh",
      maat_restoration: "write one true detail the day cannot erase",
      user_facing_evidence: "The record needs one concrete detail.",
      axis_codes: ["T", "M"],
      isfet_patterns: ["falsehood", "distorted_measure"],
      action: "write one honest mark with one real detail",
      direction: "strengthen",
      cta_hint: "journal",
    },
    rhythm: {
      field: "rhythm",
      human_label: "daily rhythm",
      isfet_leak: "the day is losing its repeated anchor",
      maat_restoration: "return to one repeated act at the same time",
      user_facing_evidence: "One repeated anchor has gone thin.",
      axis_codes: ["E", "C", "M"],
      isfet_patterns: ["blocked_flow", "fragmentation"],
      action: "return to one repeated act at the same time",
      direction: "restore",
      cta_hint: "planner",
    },
    restraint: {
      field: "restraint",
      human_label: "restraint",
      isfet_leak: "force is running past useful measure",
      maat_restoration: "downshift one demand before adding more",
      user_facing_evidence: "The current pressure needs a smaller measure.",
      axis_codes: ["R", "H", "M"],
      isfet_patterns: ["excess", "harm"],
      action: "downshift one demand before adding more",
      direction: "reduce",
      cta_hint: "planner",
    },
    care: {
      field: "care",
      human_label: "care",
      isfet_leak: "a support thread needs attention",
      maat_restoration: "complete one care action small enough to keep",
      user_facing_evidence: "One care thread needs attention.",
      axis_codes: ["V", "H", "C"],
      isfet_patterns: ["neglect", "broken_obligation"],
      action: "complete one care action small enough to keep",
      direction: "tend",
      cta_hint: "planner",
    },
    speech: {
      field: "speech",
      human_label: "speech",
      isfet_leak: "a word, promise, or message is unresolved",
      maat_restoration: "make one word direct and clean",
      user_facing_evidence: "One word or promise is still unresolved.",
      axis_codes: ["T", "C", "J"],
      isfet_patterns: ["falsehood", "fragmentation"],
      action: "make one word direct and clean",
      direction: "strengthen",
      cta_hint: "journal",
    },
    order: {
      field: "order",
      human_label: "order",
      isfet_leak: "the next step is hidden by clutter or sequence",
      maat_restoration: "put one thing in its proper place",
      user_facing_evidence: "One part of the day needs clearer order.",
      axis_codes: ["M", "C", "S"],
      isfet_patterns: ["blocked_flow", "fragmentation"],
      action: "put one thing in its proper place",
      direction: "restore",
      cta_hint: "planner",
    },
    release: {
      field: "release",
      human_label: "right release",
      isfet_leak: "too much is being carried past its measure",
      maat_restoration: "release or reduce one obligation that no longer fits",
      user_facing_evidence:
        "One obligation may need to be reduced or released.",
      axis_codes: ["R", "M", "J"],
      isfet_patterns: ["excess", "broken_obligation"],
      action: "release or reduce one obligation that no longer fits",
      direction: "release",
      cta_hint: "planner",
    },
    attention: {
      field: "attention",
      human_label: "attention",
      isfet_leak: "attention is split before the first mark is made",
      maat_restoration: "choose one focus and give it a visible boundary",
      user_facing_evidence: "Attention is asking for one clear boundary.",
      axis_codes: ["M", "R", "C"],
      isfet_patterns: ["fragmentation", "blocked_flow"],
      action: "choose one focus and give it a visible boundary",
      direction: "engage",
      cta_hint: "planner",
    },
    study: {
      field: "study",
      human_label: "study",
      isfet_leak: "learning needs one retained mark",
      maat_restoration: "keep one study note that can be used again",
      user_facing_evidence: "One study thread needs a retained mark.",
      axis_codes: ["T", "M", "C"],
      isfet_patterns: ["blocked_flow", "fragmentation"],
      action: "keep one study note that can be used again",
      direction: "strengthen",
      cta_hint: "journal",
    },
    craft: {
      field: "craft",
      human_label: "craft",
      isfet_leak: "building is scattering before one piece is finished",
      maat_restoration: "finish one small piece of the work",
      user_facing_evidence: "One piece of the work needs a clean finish.",
      axis_codes: ["M", "C", "S"],
      isfet_patterns: ["blocked_flow", "fragmentation"],
      action: "finish one small piece of the work",
      direction: "engage",
      cta_hint: "planner",
    },
  };
  return restorations[field];
}

const ALL_LEDGER_FIELDS: MaatLedgerField[] = [
  "provision",
  "visible_work",
  "truthful_record",
  "rhythm",
  "restraint",
  "care",
  "speech",
  "order",
  "release",
  "attention",
  "study",
  "craft",
];

function isMaatLedgerField(value: unknown): value is MaatLedgerField {
  return typeof value === "string" &&
    (ALL_LEDGER_FIELDS as string[]).includes(value);
}

function evidenceTextForScoring(evidenceTexts: string[]) {
  return evidenceTexts.join(" ").toLowerCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termHits(text: string, terms: string[]) {
  return terms.reduce((count, term) => {
    const pattern = new RegExp(
      `\\b${escapeRegex(term).replace(/\\s+/g, "\\s+")}\\b`,
      "i",
    );
    return count + (pattern.test(text) ? 1 : 0);
  }, 0);
}

function addSemanticScore(
  scores: FieldScore[],
  text: string,
  field: MaatLedgerField,
  terms: string[],
  reason: string,
) {
  const hits = termHits(text, terms);
  if (hits === 0) return;
  scores.push({
    field,
    score: Math.min(1.5, hits * 0.45),
    open: 1,
    broken: 0,
    confidence: hits >= 3 ? "medium" : "low",
    reason,
  });
}

function buildFieldScores(params: {
  todoPending: number;
  todoSkipped: number;
  nutritionPending: number;
  nutritionSkipped: number;
  evidenceTexts: string[];
}): FieldScore[] {
  const scores: FieldScore[] = [];

  const provisionOpenThread = params.nutritionPending > 0 ? 1 : 0;
  const provisionBrokenThread = Math.min(params.nutritionSkipped, 3);
  const provisionScore = provisionOpenThread * 0.75 +
    provisionBrokenThread * 1.5;
  if (provisionScore > 0) {
    scores.push({
      field: "provision",
      score: provisionScore,
      open: params.nutritionPending,
      broken: params.nutritionSkipped,
      confidence: params.nutritionSkipped > 0 ? "high" : "medium",
      reason: params.nutritionPending > 1
        ? "nutrition_pending_compressed"
        : "nutrition_unresolved",
    });
  }

  const visibleWorkScore = params.todoPending * 0.75 +
    params.todoSkipped * 1.5;
  if (visibleWorkScore > 0) {
    scores.push({
      field: "visible_work",
      score: visibleWorkScore,
      open: params.todoPending,
      broken: params.todoSkipped,
      confidence: params.todoSkipped > 0 ? "high" : "medium",
      reason: "todo_unresolved",
    });
  }

  const text = evidenceTextForScoring(params.evidenceTexts);
  addSemanticScore(scores, text, "truthful_record", [
    "journal",
    "note",
    "record",
    "truth",
    "honest",
    "witness",
    "detail",
  ], "record_signal");
  addSemanticScore(scores, text, "rhythm", [
    "routine",
    "rhythm",
    "daily",
    "repeat",
    "schedule",
    "timing",
    "late",
    "missed",
    "consistency",
  ], "rhythm_signal");
  addSemanticScore(scores, text, "restraint", [
    "overwork",
    "burnout",
    "exhausted",
    "no sleep",
    "too much",
    "overreach",
    "force",
    "impulse",
    "limit",
    "pause",
  ], "restraint_signal");
  addSemanticScore(scores, text, "care", [
    "family",
    "dependent",
    "elder",
    "child",
    "care",
    "support",
    "medicine",
    "burden",
  ], "care_signal");
  addSemanticScore(scores, text, "speech", [
    "promise",
    "message",
    "conversation",
    "apology",
    "silence",
    "reply",
    "call",
    "word",
    "said",
  ], "speech_signal");
  addSemanticScore(scores, text, "order", [
    "clutter",
    "organize",
    "sequence",
    "environment",
    "room",
    "desk",
    "files",
    "sort",
  ], "order_signal");
  addSemanticScore(scores, text, "release", [
    "too many",
    "overloaded",
    "cancel",
    "delete",
    "archive",
    "release",
    "no longer possible",
    "reduce scope",
  ], "release_signal");
  addSemanticScore(scores, text, "attention", [
    "focus",
    "distracted",
    "scattered",
    "attention",
    "scroll",
    "phone",
    "fragmented",
  ], "attention_signal");
  addSemanticScore(scores, text, "study", [
    "study",
    "read",
    "reading",
    "learn",
    "lesson",
    "practice",
    "notes",
  ], "study_signal");
  addSemanticScore(scores, text, "craft", [
    "build",
    "write",
    "draft",
    "project",
    "creative",
    "make",
    "repair",
    "refine",
  ], "craft_signal");

  return scores;
}

const THEME_FIELD_HINTS: Array<[RegExp, MaatLedgerField]> = [
  [/\b(food|water|nutrition|provision|support|body|health)\b/, "provision"],
  [/\b(work|task|labor|build|make|completion)\b/, "visible_work"],
  [/\b(truth|record|speech|witness|measure)\b/, "truthful_record"],
  [/\b(rhythm|time|season|course|return|daily)\b/, "rhythm"],
  [/\b(restraint|force|rest|limit|downshift)\b/, "restraint"],
  [/\b(care|family|dependent|protect|vulnerable)\b/, "care"],
  [/\b(word|promise|speech|message)\b/, "speech"],
  [/\b(order|sequence|house|place|structure)\b/, "order"],
  [/\b(release|end|close|reduce)\b/, "release"],
  [/\b(attention|focus|presence)\b/, "attention"],
  [/\b(study|knowledge|learn|read)\b/, "study"],
  [/\b(craft|refine|create|building)\b/, "craft"],
];

function themeField(theme: string | null | undefined): MaatLedgerField | null {
  const text = (theme ?? "").toLowerCase();
  for (const [pattern, field] of THEME_FIELD_HINTS) {
    if (pattern.test(text)) return field;
  }
  return null;
}

function chooseDominantFieldScore(
  scores: FieldScore[],
  context: MaatLedgerBuildContext,
): FieldScore | null {
  const meaningful = scores.filter((score) => score.score > 0);
  if (!meaningful.length) return null;
  const theme = themeField(context.decanTheme);
  const recentFields = context.recentFields ?? [];
  return meaningful.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
    if (theme) {
      const aTheme = a.field === theme ? 1 : 0;
      const bTheme = b.field === theme ? 1 : 0;
      if (aTheme !== bTheme) return bTheme - aTheme;
    }
    const aRecent = recentFields.includes(a.field) ? 1 : 0;
    const bRecent = recentFields.includes(b.field) ? 1 : 0;
    if (aRecent !== bRecent) return aRecent - bRecent;
    if (a.field === "provision" && b.field !== "provision") return 1;
    if (b.field === "provision" && a.field !== "provision") return -1;
    return ALL_LEDGER_FIELDS.indexOf(a.field) - ALL_LEDGER_FIELDS.indexOf(
      b.field,
    );
  })[0];
}

export function buildPlannerMaatLedger(
  planner: MaatPlannerSummaryInput,
  context: MaatLedgerBuildContext = {},
): MaatLedgerSummary {
  const todoDone = n(planner.todoDone);
  const todoPartial = n(planner.todoPartial);
  const todoSkipped = n(planner.todoSkipped);
  const todoPending = n(planner.todoPending);
  const nutritionDone = n(planner.nutritionDone);
  const nutritionPartial = n(planner.nutritionPartial);
  const nutritionSkipped = n(planner.nutritionSkipped);
  const nutritionPending = n(planner.nutritionPending);
  const obligationThreads = buildNormalizedObligationThreads(
    context.evidenceTexts ?? [],
  );

  const openObligations = todoPending + nutritionPending;
  const partialObligations = todoPartial + nutritionPartial;
  const resolvedObligations = todoDone + nutritionDone;
  const brokenObligations = todoSkipped + nutritionSkipped;
  const unresolvedObligations = openObligations + brokenObligations;

  const scores = buildFieldScores({
    todoPending,
    todoSkipped,
    nutritionPending,
    nutritionSkipped,
    evidenceTexts: context.evidenceTexts ?? [],
  });
  const dominant = chooseDominantFieldScore(scores, context);
  const dominantField = dominant?.field ?? null;
  const dominantLeak = dominantField
    ? {
      field: dominantField,
      open: dominant?.open ?? 0,
      broken: dominant?.broken ?? 0,
      score: round(dominant?.score ?? 0),
    }
    : null;

  const axisDeltas: Partial<Record<MaatAxisCode, number>> = {
    M: round(
      todoDone * 0.25 + todoPartial * 0.1 - todoPending * 0.18 -
        todoSkipped * 0.45,
    ),
    H: round(
      nutritionDone * 0.35 + nutritionPartial * 0.14 - nutritionPending * 0.22 -
        nutritionSkipped * 0.55,
    ),
    S: round(
      nutritionDone * 0.4 + nutritionPartial * 0.16 - nutritionPending * 0.26 -
        nutritionSkipped * 0.6,
    ),
    E: round(
      nutritionDone * 0.22 + nutritionPartial * 0.09 - nutritionPending * 0.16 -
        nutritionSkipped * 0.35,
    ),
    C: round(
      todoDone * 0.22 + todoPartial * 0.08 - todoPending * 0.16 -
        todoSkipped * 0.38,
    ),
  };
  const isfetPatterns: Partial<Record<IsfetPattern, number>> = {};
  if (unresolvedObligations > 0) {
    isfetPatterns.blocked_flow = round(
      openObligations * 0.75 + brokenObligations * 1.5,
    );
  }
  if (todoPending + todoSkipped > 0) {
    isfetPatterns.broken_obligation = round(
      todoPending * 0.75 + todoSkipped * 1.5,
    );
  }
  if (nutritionPending + nutritionSkipped > 0) {
    isfetPatterns.neglect = round(
      nutritionPending * 0.5 + nutritionSkipped * 1.2,
    );
  }

  return {
    version: MAAT_LEDGER_VERSION,
    open_obligations: openObligations,
    partial_obligations: partialObligations,
    resolved_obligations: resolvedObligations,
    broken_obligations: brokenObligations,
    unresolved_obligations: unresolvedObligations,
    dominant_leak: dominantLeak,
    suggested_restoration: dominantField
      ? fieldRestoration(dominantField)
      : null,
    stalled_restoration: null,
    axis_deltas: axisDeltas,
    isfet_patterns: isfetPatterns,
    source_counts: {
      todo_pending: todoPending,
      todo_skipped: todoSkipped,
      todo_partial: todoPartial,
      todo_done: todoDone,
      nutrition_pending: nutritionPending,
      nutrition_skipped: nutritionSkipped,
      nutrition_partial: nutritionPartial,
      nutrition_done: nutritionDone,
    },
    obligation_threads: obligationThreads,
  };
}

export function maatLedgerPayload(
  ledger: MaatLedgerSummary | null | undefined,
) {
  if (!ledger) return {};
  return {
    maat_ledger: {
      version: ledger.version,
      open_obligations: ledger.open_obligations,
      partial_obligations: ledger.partial_obligations,
      resolved_obligations: ledger.resolved_obligations,
      broken_obligations: ledger.broken_obligations,
      unresolved_obligations: ledger.unresolved_obligations,
      dominant_leak: ledger.dominant_leak,
      suggested_restoration: ledger.suggested_restoration,
      stalled_restoration: ledger.stalled_restoration,
      axis_deltas: ledger.axis_deltas,
      isfet_patterns: ledger.isfet_patterns,
      source_counts: ledger.source_counts,
    },
  };
}

function asMaatLedgerField(value: unknown): MaatLedgerField | null {
  return isMaatLedgerField(value) ? value : null;
}

function stalledAction(field: MaatLedgerField) {
  if (field === "provision") {
    return "tend to provision by completing one nutrition check, or release the check that no longer belongs today";
  }
  if (field === "visible_work") {
    return "tend to visible work by finishing one small part, or release the task that no longer belongs today";
  }
  return "strengthen the truthful record with one concrete mark, or release the record that cannot be made honestly today";
}

export function applyMaatLedgerHealthGuardrails(
  ledger: MaatLedgerSummary,
  rows: Array<Record<string, unknown>> | null | undefined,
  now: Date = new Date(),
): MaatLedgerSummary {
  const stalled = (rows ?? [])
    .filter((row) => row?.needs_scope_reduction === true)
    .map((row) => {
      const field = asMaatLedgerField(row.field);
      if (!field) return null;
      const actedAt = stringValue(row.obligation_acted_at);
      const actedMs = actedAt ? Date.parse(actedAt) : NaN;
      return {
        row,
        field,
        ageHours: Number.isFinite(actedMs)
          ? Math.max(0, round((now.getTime() - actedMs) / 36e5))
          : null,
        repeatLeakCount: numberValue(row.repeat_leak_count),
        actedCount: numberValue(row.acted_count),
        resolvedCount: numberValue(row.resolved_count),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) =>
      b.repeatLeakCount - a.repeatLeakCount ||
      (b.ageHours ?? 0) - (a.ageHours ?? 0)
    )[0];

  if (!stalled || !ledger.suggested_restoration) return ledger;

  const action = stalledAction(stalled.field);
  return {
    ...ledger,
    suggested_restoration: {
      ...ledger.suggested_restoration,
      field: stalled.field,
      action,
      direction: "reduce",
      cta_hint: stalled.field === "truthful_record" ? "journal" : "planner",
    },
    stalled_restoration: {
      field: stalled.field,
      action,
      direction: "reduce",
      age_hours: stalled.ageHours,
      acted_count: stalled.actedCount,
      resolved_count: stalled.resolvedCount,
      repeat_leak_count: stalled.repeatLeakCount,
      source_obligation_id: stringValue(stalled.row.obligation_id) || null,
    },
  };
}

function isRecord(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasThen(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function ledgerFromPayload(payload: Record<string, unknown>) {
  const ledger = isRecord(payload.maat_ledger)
    ? payload.maat_ledger
    : isRecord(payload.ledger)
    ? payload.ledger
    : null;
  if (!ledger) return null;
  const restoration = isRecord(ledger.suggested_restoration)
    ? ledger.suggested_restoration
    : null;
  if (!restoration) return null;
  const field = stringValue(restoration.field) as MaatLedgerField;
  const situation = isRecord(payload.maat_situation)
    ? payload.maat_situation
    : null;
  const situationAction = stringValue(situation?.concrete_action);
  const action = situationAction || stringValue(restoration.action);
  if (!field || !action) return null;
  return {
    version: stringValue(ledger.version) || MAAT_LEDGER_VERSION,
    openObligations: numberValue(ledger.open_obligations),
    unresolvedObligations: numberValue(ledger.unresolved_obligations),
    dominantLeak: isRecord(ledger.dominant_leak) ? ledger.dominant_leak : null,
    restoration: {
      field,
      action,
      direction: stringValue(restoration.direction) || "tend",
      ctaHint: stringValue(restoration.cta_hint) || "none",
      axisCodes: stringArray(restoration.axis_codes),
      isfetPatterns: stringArray(restoration.isfet_patterns),
    },
    situation,
    sourceCounts: isRecord(ledger.source_counts) ? ledger.source_counts : {},
    isfetPatterns: isRecord(ledger.isfet_patterns) ? ledger.isfet_patterns : {},
  };
}

async function selectOne(
  client: MaatLedgerStoreClient,
  table: string,
  filters: Record<string, unknown>,
): QueryResult<Row> {
  const selected = client.from(table).select?.("*");
  if (!selected) return { data: null, error: "select_not_supported" };
  let query = selected;
  let canFilterInQuery = true;
  for (const [column, value] of Object.entries(filters)) {
    if (typeof query?.eq !== "function") {
      canFilterInQuery = false;
      break;
    }
    query = query.eq(column, value);
  }
  if (canFilterInQuery && typeof query?.maybeSingle === "function") {
    return await query.maybeSingle();
  }
  if (canFilterInQuery && typeof query?.single === "function") {
    return await query.single();
  }
  const result = hasThen(selected)
    ? await selected as { data?: Row[] | null; error?: unknown | null }
    : { data: null, error: "select_not_awaitable" };
  if (result.error) return { data: null, error: result.error };
  const row =
    (result.data ?? []).find((candidate) =>
      Object.entries(filters).every(([column, value]) =>
        candidate[column] === value
      )
    ) ?? null;
  return { data: row, error: null };
}

async function insertOne(
  client: MaatLedgerStoreClient,
  table: string,
  row: Row,
): QueryResult<Row> {
  const inserted = client.from(table).insert?.(row);
  if (!inserted) return { data: null, error: "insert_not_supported" };
  const selected = inserted.select?.("*");
  if (selected?.maybeSingle) return await selected.maybeSingle();
  if (selected?.single) return await selected.single();
  if (hasThen(inserted)) {
    const result = await inserted as {
      data?: Row[] | Row | null;
      error?: unknown | null;
    };
    const data = Array.isArray(result.data)
      ? result.data[0] ?? null
      : result.data ?? null;
    return { data, error: result.error ?? null };
  }
  return { data: null, error: null };
}

async function updateById(
  client: MaatLedgerStoreClient,
  table: string,
  id: unknown,
  row: Row,
): QueryResult<Row> {
  const updated = client.from(table).update?.(row);
  if (!updated) return { data: null, error: "update_not_supported" };
  const eq = updated.eq?.("id", id);
  const selected = eq?.select?.("*");
  if (selected?.maybeSingle) return await selected.maybeSingle();
  if (selected?.single) return await selected.single();
  if (hasThen(eq)) {
    const result = await eq as {
      data?: Row[] | Row | null;
      error?: unknown | null;
    };
    const data = Array.isArray(result.data)
      ? result.data[0] ?? null
      : result.data ?? null;
    return { data, error: result.error ?? null };
  }
  return { data: null, error: null };
}

function mergeMetadata(base: unknown, patch: Row) {
  return {
    ...(isRecord(base) ? base : {}),
    ...patch,
  };
}

function logLedgerStoreError(context: string, error: unknown) {
  if (!error) return;
  const message = isRecord(error)
    ? `${stringValue(error.code)} ${stringValue(error.message)}`.trim()
    : String(error);
  if (message.includes("42P01") || message.includes("does not exist")) {
    console.warn(`maat ledger store skipped:${context}`, error);
    return;
  }
  console.error(`maat ledger store error:${context}`, error);
}

export async function recordMaatRestorationSuggested(
  params: MaatRestorationSuggestedInput,
) {
  const ledger = ledgerFromPayload(params.payload);
  if (!ledger) return null;

  const nowIso = params.nowIso ?? new Date().toISOString();
  const obligationKey = `${params.decanPeriodKey}:${ledger.restoration.field}`;
  const attemptKey = `delivery:${params.deliveryId}`;
  const obligationMetadata = {
    ledger_version: ledger.version,
    dominant_leak: ledger.dominantLeak,
    source_counts: ledger.sourceCounts,
    isfet_patterns: ledger.isfetPatterns,
    suggested_restoration: ledger.restoration,
    situation: ledger.situation,
    last_trigger_reason: params.triggerReason ?? null,
    last_delivery_id: params.deliveryId,
  };

  const existingObligation = await selectOne(
    params.client,
    "maat_obligations",
    {
      user_id: params.userId,
      obligation_key: obligationKey,
    },
  );
  if (existingObligation.error) {
    logLedgerStoreError("select_obligation", existingObligation.error);
    return null;
  }
  const existingStatus = stringValue(existingObligation.data?.status);
  if (existingStatus === "resolved" || existingStatus === "released") {
    return { obligation: existingObligation.data, attempt: null };
  }

  const obligationRow = {
    user_id: params.userId,
    decan_period_key: params.decanPeriodKey,
    obligation_key: obligationKey,
    source_type: "maat_snapshot_ledger",
    source_id: params.decanPeriodKey,
    field: ledger.restoration.field,
    status: "open",
    axis_codes: ledger.restoration.axisCodes,
    isfet_patterns: ledger.restoration.isfetPatterns,
    open_count: ledger.dominantLeak?.open ?? ledger.openObligations,
    broken_count: ledger.dominantLeak?.broken ?? 0,
    leak_score: ledger.dominantLeak?.score ?? ledger.unresolvedObligations,
    weight: ledger.dominantLeak?.score ?? ledger.unresolvedObligations,
    suggested_restoration: ledger.restoration,
    last_delivery_id: params.deliveryId,
    opened_at: existingObligation.data?.opened_at ?? nowIso,
    metadata: mergeMetadata(
      existingObligation.data?.metadata,
      obligationMetadata,
    ),
    updated_at: nowIso,
  };

  const obligationResult = existingObligation.data
    ? await updateById(
      params.client,
      "maat_obligations",
      existingObligation.data.id,
      obligationRow,
    )
    : await insertOne(params.client, "maat_obligations", {
      id: crypto.randomUUID(),
      ...obligationRow,
      created_at: nowIso,
    });
  if (obligationResult.error) {
    logLedgerStoreError("persist_obligation", obligationResult.error);
    return null;
  }

  const obligationId = obligationResult.data?.id ??
    existingObligation.data?.id ??
    null;
  const existingAttempt = await selectOne(
    params.client,
    "maat_restoration_attempts",
    {
      user_id: params.userId,
      attempt_key: attemptKey,
    },
  );
  if (existingAttempt.error) {
    logLedgerStoreError("select_attempt", existingAttempt.error);
    return { obligation: obligationResult.data, attempt: null };
  }

  const attemptRow = {
    user_id: params.userId,
    obligation_id: obligationId,
    delivery_id: params.deliveryId,
    delivery_kind: params.deliveryKind,
    decan_period_key: params.decanPeriodKey,
    attempt_key: attemptKey,
    field: ledger.restoration.field,
    action_text: ledger.restoration.action,
    direction: ledger.restoration.direction,
    cta_type: params.ctaType ?? null,
    cta_ref: params.ctaRef ?? null,
    trigger_reason: params.triggerReason ?? null,
    status: existingAttempt.data?.status ?? "suggested",
    suggested_at: existingAttempt.data?.suggested_at ?? nowIso,
    metadata: mergeMetadata(existingAttempt.data?.metadata, {
      ledger_version: ledger.version,
      dominant_leak: ledger.dominantLeak,
      suggested_restoration: ledger.restoration,
      situation: ledger.situation,
      delivery_channel: params.payload.delivery_channel ?? null,
      output_grade: isRecord(params.payload.output_control)
        ? (params.payload.output_control as Row).grade ?? null
        : null,
    }),
    updated_at: nowIso,
  };
  const attemptResult = existingAttempt.data
    ? await updateById(
      params.client,
      "maat_restoration_attempts",
      existingAttempt.data.id,
      attemptRow,
    )
    : await insertOne(params.client, "maat_restoration_attempts", {
      id: crypto.randomUUID(),
      ...attemptRow,
      created_at: nowIso,
    });
  if (attemptResult.error) {
    logLedgerStoreError("persist_attempt", attemptResult.error);
  }
  return {
    obligation: obligationResult.data,
    attempt: attemptResult.data,
  };
}

export async function recordMaatRestorationOutcome(
  params: MaatRestorationOutcomeInput,
) {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const existingAttempt = await selectOne(
    params.client,
    "maat_restoration_attempts",
    {
      user_id: params.userId,
      delivery_id: params.deliveryId,
    },
  );
  if (existingAttempt.error) {
    logLedgerStoreError("select_outcome_attempt", existingAttempt.error);
    return null;
  }
  if (!existingAttempt.data) return null;

  const timestampColumn = `${params.action}_at`;
  const nextStatus = params.action;
  const attemptResult = await updateById(
    params.client,
    "maat_restoration_attempts",
    existingAttempt.data.id,
    {
      status: nextStatus,
      [timestampColumn]: existingAttempt.data[timestampColumn] ?? nowIso,
      metadata: mergeMetadata(existingAttempt.data.metadata, {
        last_ack_action: params.action,
        last_ack_at: nowIso,
        ...(params.metadata ?? {}),
      }),
      updated_at: nowIso,
    },
  );
  if (attemptResult.error) {
    logLedgerStoreError("update_outcome_attempt", attemptResult.error);
    return null;
  }

  if (params.action === "acted" && existingAttempt.data.obligation_id) {
    const existingObligation = await selectOne(
      params.client,
      "maat_obligations",
      { id: existingAttempt.data.obligation_id },
    );
    if (!existingObligation.error && existingObligation.data) {
      const obligationResult = await updateById(
        params.client,
        "maat_obligations",
        existingAttempt.data.obligation_id,
        {
          status: "acted",
          acted_at: existingObligation.data.acted_at ?? nowIso,
          metadata: mergeMetadata(existingObligation.data.metadata, {
            last_attempt_status: "acted",
            acted_delivery_id: params.deliveryId,
          }),
          updated_at: nowIso,
        },
      );
      if (obligationResult.error) {
        logLedgerStoreError(
          "update_outcome_obligation",
          obligationResult.error,
        );
      }
    } else if (existingObligation.error) {
      logLedgerStoreError(
        "select_outcome_obligation",
        existingObligation.error,
      );
    }
  }

  return attemptResult.data;
}
