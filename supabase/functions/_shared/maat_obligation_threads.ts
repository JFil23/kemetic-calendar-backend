export const MAAT_OBLIGATION_THREADS_VERSION = "maat_obligation_threads_v1";

export type MaatObligationThreadDomain = "nutrition" | "todo";
export type MaatObligationThreadState =
  | "pending"
  | "skipped"
  | "partial"
  | "done"
  | "unknown";
export type MaatObligationThreadConfidence = "low" | "medium" | "high";
export type MaatNutritionThreadProblem =
  | "none"
  | "one_recurring_item_unkept"
  | "several_distinct_items_one_day"
  | "many_overlapping_sources"
  | "completed_but_unlogged"
  | "no_recent_completion"
  | "schedule_too_dense"
  | "recurrence_too_ambitious";

export type MaatNormalizedObligationThread = {
  domain: MaatObligationThreadDomain;
  thread_key: string;
  label: string;
  unique_item_count: number;
  occurrence_count: number;
  pending_count: number;
  skipped_count: number;
  completed_count: number;
  partial_count: number;
  same_item_repeated: boolean;
  same_day_collision: boolean;
  distinct_source_count: number;
  purpose_count: number;
  completion_ratio: number;
  first_seen_at: string | null;
  last_completed_at: string | null;
  last_marked_at: string | null;
  sources: string[];
  purposes: string[];
  dates: string[];
  confidence: MaatObligationThreadConfidence;
};

export type MaatObligationThreadDomainSummary = {
  unique_item_count: number;
  occurrence_count: number;
  pending_count: number;
  skipped_count: number;
  completed_count: number;
  partial_count: number;
  same_item_repeated: boolean;
  same_day_collision: boolean;
  distinct_source_count: number;
  purpose_count: number;
  completion_ratio: number;
  last_completed_at: string | null;
  last_marked_at: string | null;
  dominant_problem: MaatNutritionThreadProblem | "none";
  confidence: MaatObligationThreadConfidence;
};

export type MaatNormalizedObligationThreads = {
  version: typeof MAAT_OBLIGATION_THREADS_VERSION;
  threads: MaatNormalizedObligationThread[];
  nutrition: MaatObligationThreadDomainSummary;
  todo: MaatObligationThreadDomainSummary;
};

type ParsedEvidence = {
  domain: MaatObligationThreadDomain;
  label: string;
  source: string | null;
  purpose: string | null;
  state: MaatObligationThreadState;
  date: string | null;
};

type ThreadDraft = {
  domain: MaatObligationThreadDomain;
  key: string;
  label: string;
  states: MaatObligationThreadState[];
  entries: Array<{ state: MaatObligationThreadState; date: string | null }>;
  dates: Set<string>;
  sources: Set<string>;
  purposes: Set<string>;
};

const EMPTY_DOMAIN_SUMMARY: MaatObligationThreadDomainSummary = {
  unique_item_count: 0,
  occurrence_count: 0,
  pending_count: 0,
  skipped_count: 0,
  completed_count: 0,
  partial_count: 0,
  same_item_repeated: false,
  same_day_collision: false,
  distinct_source_count: 0,
  purpose_count: 0,
  completion_ratio: 0,
  last_completed_at: null,
  last_marked_at: null,
  dominant_problem: "none",
  confidence: "low",
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function compactArray(values: Iterable<string>) {
  return [...values].map(clean).filter(Boolean).sort((a, b) =>
    a.localeCompare(b)
  );
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = clean(match?.[1] ?? "");
    if (value) return value.replace(/[.;:,]+$/g, "").trim();
  }
  return "";
}

function parseState(text: string): MaatObligationThreadState {
  const lower = text.toLowerCase();
  if (/\bstate:\s*done\b|\bstate:done\b|\bcompleted\b|\bdone\b/.test(lower)) {
    return "done";
  }
  if (
    /\bstate:\s*partial\b|\bstate:partial\b|\bstate:\s*in[_ -]?progress\b|\bpartial\b|\bin progress\b/
      .test(lower)
  ) {
    return "partial";
  }
  if (/\bstate:\s*skipped\b|\bstate:skipped\b|\bskipped\b/.test(lower)) {
    return "skipped";
  }
  if (
    /\bstate:\s*pending\b|\bstate:pending\b|\bpending\b|\bunchecked\b|\bnot checked off\b/
      .test(lower)
  ) {
    return "pending";
  }
  return "unknown";
}

function parseEvidenceLine(line: string): ParsedEvidence | null {
  const text = clean(line);
  const lower = text.toLowerCase();
  const domain: MaatObligationThreadDomain | null =
    /\bkind:nutrition\b|\bnutrition:|\bplanner nutrition\b/.test(lower)
      ? "nutrition"
      : /\bkind:todo\b|\bkind:to-do\b|\bto-do:|\btodo:|\bplanner to-do\b|\bplanner todo\b/
          .test(lower)
      ? "todo"
      : null;
  if (!domain) return null;

  const label = firstMatch(
    text,
    domain === "nutrition"
      ? [
        /\bNutrition:\s*(.+?)(?=\s+Planner\b|\s+State:|\s+kind:|\s+state:|$)/i,
        /\bnutrition\s+(.+?)\s+was\b/i,
      ]
      : [
        /\bTo-do:\s*(.+?)(?=\s+Planner\b|\s+State:|\s+kind:|\s+state:|$)/i,
        /\bTodo:\s*(.+?)(?=\s+Planner\b|\s+State:|\s+kind:|\s+state:|$)/i,
        /\bplanner item\s+(.+?)\s+was\b/i,
      ],
  ) || (domain === "nutrition" ? "nutrition" : "task");

  const source = domain === "nutrition"
    ? firstMatch(text, [/\bSource:\s*([^.;]+)/i])
    : null;
  const purpose = firstMatch(text, [/\bPurpose:\s*([^.;]+)/i]);
  const date = firstMatch(text, [
    /\bfor\s+(\d{4}-\d{2}-\d{2})\b/i,
    /\bon\s+(\d{4}-\d{2}-\d{2})\b/i,
    /\b(\d{4}-\d{2}-\d{2})\b/,
  ]);

  return {
    domain,
    label: clean(label),
    source: source || null,
    purpose: purpose || null,
    state: parseState(text),
    date: date || null,
  };
}

function threadKey(parsed: ParsedEvidence) {
  const sourcePart = parsed.domain === "nutrition" && parsed.source
    ? `:${normalizeKey(parsed.source)}`
    : "";
  return `${parsed.domain}:${normalizeKey(parsed.label)}${sourcePart}`;
}

function countState(
  states: MaatObligationThreadState[],
  state: MaatObligationThreadState,
) {
  return states.filter((item) => item === state).length;
}

function latestDate(dates: string[]) {
  return dates.length ? dates.slice().sort().at(-1) ?? null : null;
}

function confidenceFor(draft: ThreadDraft): MaatObligationThreadConfidence {
  const hasState = draft.states.some((state) => state !== "unknown");
  if (draft.label && hasState && draft.dates.size > 0) return "high";
  if (draft.label && hasState) return "medium";
  return "low";
}

function buildThread(
  draft: ThreadDraft,
  collisionDates: Set<string>,
): MaatNormalizedObligationThread {
  const dates = compactArray(draft.dates);
  const sources = compactArray(draft.sources);
  const purposes = compactArray(draft.purposes);
  const completed = countState(draft.states, "done");
  const pending = countState(draft.states, "pending");
  const skipped = countState(draft.states, "skipped");
  const partial = countState(draft.states, "partial");
  const known = completed + pending + skipped + partial;
  const completionRatio = known ? completed / known : 0;
  const sameDayCollision = dates.some((date) => collisionDates.has(date));
  return {
    domain: draft.domain,
    thread_key: draft.key,
    label: draft.label,
    unique_item_count: 1,
    occurrence_count: draft.states.length,
    pending_count: pending,
    skipped_count: skipped,
    completed_count: completed,
    partial_count: partial,
    same_item_repeated: draft.states.length > 1,
    same_day_collision: sameDayCollision,
    distinct_source_count: sources.length,
    purpose_count: purposes.length,
    completion_ratio: round(completionRatio),
    first_seen_at: dates[0] ?? null,
    last_completed_at: latestDate(
      draft.entries
        .filter((entry) => entry.state === "done")
        .map((entry) => entry.date ?? "")
        .filter(Boolean),
    ),
    last_marked_at: latestDate(dates),
    sources,
    purposes,
    dates,
    confidence: confidenceFor(draft),
  };
}

function summarizeDomain(
  domain: MaatObligationThreadDomain,
  threads: MaatNormalizedObligationThread[],
): MaatObligationThreadDomainSummary {
  const domainThreads = threads.filter((thread) => thread.domain === domain);
  if (!domainThreads.length) return { ...EMPTY_DOMAIN_SUMMARY };
  const occurrenceCount = domainThreads.reduce(
    (sum, thread) => sum + thread.occurrence_count,
    0,
  );
  const pendingCount = domainThreads.reduce(
    (sum, thread) => sum + thread.pending_count,
    0,
  );
  const skippedCount = domainThreads.reduce(
    (sum, thread) => sum + thread.skipped_count,
    0,
  );
  const completedCount = domainThreads.reduce(
    (sum, thread) => sum + thread.completed_count,
    0,
  );
  const partialCount = domainThreads.reduce(
    (sum, thread) => sum + thread.partial_count,
    0,
  );
  const sources = new Set(domainThreads.flatMap((thread) => thread.sources));
  const purposes = new Set(domainThreads.flatMap((thread) => thread.purposes));
  const known = pendingCount + skippedCount + completedCount + partialCount;
  const uniqueItemCount = domainThreads.length;
  const repeatedThreads = domainThreads.filter((thread) =>
    thread.same_item_repeated && thread.pending_count + thread.skipped_count > 0
  );
  const sameDayCollision = domainThreads.some((thread) =>
    thread.same_day_collision
  );
  const confidence: MaatObligationThreadConfidence = domainThreads.some((
      thread,
    ) => thread.confidence === "high"
    )
    ? "high"
    : domainThreads.some((thread) => thread.confidence === "medium")
    ? "medium"
    : "low";
  return {
    unique_item_count: uniqueItemCount,
    occurrence_count: occurrenceCount,
    pending_count: pendingCount,
    skipped_count: skippedCount,
    completed_count: completedCount,
    partial_count: partialCount,
    same_item_repeated: repeatedThreads.length > 0,
    same_day_collision: sameDayCollision,
    distinct_source_count: sources.size,
    purpose_count: purposes.size,
    completion_ratio: round(known ? completedCount / known : 0),
    last_completed_at: latestDate(
      domainThreads.map((thread) => thread.last_completed_at ?? "").filter(
        Boolean,
      ),
    ),
    last_marked_at: latestDate(
      domainThreads.map((thread) => thread.last_marked_at ?? "").filter(
        Boolean,
      ),
    ),
    dominant_problem: domain === "nutrition"
      ? nutritionProblem(domainThreads)
      : "none",
    confidence,
  };
}

function nutritionProblem(
  threads: MaatNormalizedObligationThread[],
): MaatNutritionThreadProblem {
  const openThreads = threads.filter((thread) =>
    thread.pending_count + thread.skipped_count > 0
  );
  const uniqueOpen = openThreads.length;
  const openOccurrences = openThreads.reduce(
    (sum, thread) => sum + thread.pending_count + thread.skipped_count,
    0,
  );
  const repeatedOpen = openThreads.find((thread) =>
    thread.same_item_repeated &&
    thread.pending_count + thread.skipped_count >= 3
  );
  const sameDayCollision = openThreads.some((thread) =>
    thread.same_day_collision
  );
  const completedAndOpen = threads.some((thread) =>
    thread.completed_count > 0 &&
    thread.pending_count + thread.skipped_count > 0
  );
  const overlapping = uniqueOpen >= 2 &&
    threads.some((thread) =>
      thread.sources.length > 0 ||
      /\b(vitamin|supplement|coq|magnesium|zinc|b12|iron|protein)\b/i
        .test(thread.label)
    );

  if (completedAndOpen) return "completed_but_unlogged";
  if (repeatedOpen && uniqueOpen === 1) {
    return openOccurrences >= 7
      ? "recurrence_too_ambitious"
      : "one_recurring_item_unkept";
  }
  if (sameDayCollision && uniqueOpen >= 3) {
    return "several_distinct_items_one_day";
  }
  if (overlapping && uniqueOpen >= 3) return "many_overlapping_sources";
  if (openOccurrences >= 7) return "schedule_too_dense";
  if (
    uniqueOpen >= 1 && threads.every((thread) => thread.completed_count === 0)
  ) {
    return "no_recent_completion";
  }
  return "none";
}

export function buildNormalizedObligationThreads(
  evidenceTexts: string[],
): MaatNormalizedObligationThreads {
  const drafts = new Map<string, ThreadDraft>();
  const parsedRows = evidenceTexts.map(parseEvidenceLine).filter((
    row,
  ): row is ParsedEvidence => !!row);
  const dateDomainKeys = new Map<string, Set<string>>();

  for (const parsed of parsedRows) {
    const key = threadKey(parsed);
    const draft = drafts.get(key) ?? {
      domain: parsed.domain,
      key,
      label: parsed.label,
      states: [],
      entries: [],
      dates: new Set<string>(),
      sources: new Set<string>(),
      purposes: new Set<string>(),
    };
    draft.states.push(parsed.state);
    draft.entries.push({ state: parsed.state, date: parsed.date });
    if (parsed.date) draft.dates.add(parsed.date);
    if (parsed.source) draft.sources.add(parsed.source);
    if (parsed.purpose) draft.purposes.add(parsed.purpose);
    drafts.set(key, draft);
    if (parsed.date) {
      const dateKey = `${parsed.domain}:${parsed.date}`;
      const keys = dateDomainKeys.get(dateKey) ?? new Set<string>();
      keys.add(key);
      dateDomainKeys.set(dateKey, keys);
    }
  }

  const collisionDates = new Set<string>();
  for (const [dateKey, keys] of dateDomainKeys.entries()) {
    if (keys.size <= 1) continue;
    const [, date] = dateKey.split(":");
    if (date) collisionDates.add(date);
  }
  const threads = [...drafts.values()].map((draft) =>
    buildThread(draft, collisionDates)
  );
  return {
    version: MAAT_OBLIGATION_THREADS_VERSION,
    threads,
    nutrition: summarizeDomain("nutrition", threads),
    todo: summarizeDomain("todo", threads),
  };
}
