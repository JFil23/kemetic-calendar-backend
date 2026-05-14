import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type BadgeRow = {
  title: string | null;
  details: string | null;
  tags?: string[] | null;
  occurred_on: string;
  flow_id?: number | null;
  event_id?: string | null;
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
  nutritionDone: number;
  nutritionPartial: number;
  nutritionSkipped: number;
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

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function buildPlannerSummary(badges: BadgeRow[]): PlannerSummary {
  const todoLabels: string[] = [];
  const nutritionLabels: string[] = [];
  const journalLabels: string[] = [];
  let todoDone = 0;
  let todoPartial = 0;
  let todoSkipped = 0;
  let nutritionDone = 0;
  let nutritionPartial = 0;
  let nutritionSkipped = 0;

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
      if (label.length) todoLabels.push(label);
      continue;
    }

    if (state === "done") nutritionDone++;
    else if (state === "partial") nutritionPartial++;
    else if (state === "skipped") nutritionSkipped++;
    if (label.length) nutritionLabels.push(label);
  }

  return {
    total: todoDone + todoPartial + todoSkipped + nutritionDone +
      nutritionPartial +
      nutritionSkipped,
    todoDone,
    todoPartial,
    todoSkipped,
    nutritionDone,
    nutritionPartial,
    nutritionSkipped,
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

async function fetchBadges(
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
) {
  const header =
    `SCOPE: This reflection is for ONE DECAN ONLY (about 10 days within the month), not the full month. All evidence below is from this decan only. Reflect only on this period.

Decan: ${payload.decan_name}
Theme: ${payload.decan_theme ?? ""}
Decan window (exact date range): ${payload.decan_start ?? ""} to ${
      payload.decan_end ?? ""
    }`;

  const plannerSummaryLine = buildPlannerSummaryLine(
    buildPlannerSummary(badges),
  );
  const tagsLine = topTags.length
    ? `Top tags: ${topTags.join(", ")}`
    : "Top tags: none";
  const plannerBlock = plannerSummaryLine.length
    ? `PLANNER COMPLETIONS (checked-off to-dos and nutrition count as real evidence): ${plannerSummaryLine}`
    : "PLANNER COMPLETIONS: none";
  const evidenceBlock = badgeLines.length
    ? `BADGE EVIDENCE (journal badges plus checked-off planner items; use all of it; do not invent):
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

  const instructions =
    `Write a reflection in 80-120 words. Be concise. Reflect only on this decan. Treat journal badges, checked-off to-dos, and checked-off nutrition as equally valid evidence. Weave in 2-3 specific details from the evidence above (their phrases, numbers, task names, or nutrition names) so the user feels recognized. Do not generalize (e.g. avoid "across a range of disciplines" unless the evidence shows it). Note trajectory and connect to the theme; end with one clear next step grounded in what they did. Non-judgmental, warm tone. Goal: they feel seen and inspired. No bullets, no metadata. If history is present, cite progress only when the evidence supports it.`;

  return `${instructions}

${header}
${tagsLine}
${plannerBlock}
${evidenceBlock}
${historyBlock}`;
}

async function callAnthropic(messages: AnthropicMessage[]) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-3-haiku-20240307";
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
      max_tokens: 300,
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

function buildPlannerFocusedReflection(
  payload: ReflectionPayload,
  badgeCount: number,
  evidenceCount: number,
  topTags: string[],
  plannerSummary: PlannerSummary,
  branch: "decan" | "legacy",
) {
  const completedPlannerCount = plannerSummary.todoDone +
    plannerSummary.nutritionDone;
  const partialPlannerCount = plannerSummary.todoPartial +
    plannerSummary.nutritionPartial;
  const skippedPlannerCount = plannerSummary.todoSkipped +
    plannerSummary.nutritionSkipped;
  const themeName = payload.decan_name ?? payload.decan_theme ?? "this decan";
  const axis = resolveThemeAxis(themeName);
  const shortTheme = themeName.split("—")[0].split("-")[0].trim();

  let blockA = "";
  if (completedPlannerCount > 0) {
    const completedParts: string[] = [];
    if (plannerSummary.todoDone) {
      completedParts.push(
        `${plannerSummary.todoDone} completed ${
          pluralize(plannerSummary.todoDone, "to-do")
        }`,
      );
    }
    if (plannerSummary.nutritionDone) {
      completedParts.push(
        `${plannerSummary.nutritionDone} completed nutrition ${
          pluralize(plannerSummary.nutritionDone, "item")
        }`,
      );
    }
    blockA = `Follow-through had a visible shape this decan. You logged ${
      completedParts.join(" and ")
    }.`;
  } else if (partialPlannerCount > 0) {
    blockA =
      `The planner itself became evidence this decan. You kept ${partialPlannerCount} ${
        pluralize(partialPlannerCount, "planner mark")
      } in motion, even when they stayed partial.`;
  } else {
    blockA =
      `This decan showed its shape through what you tracked and what you had to set down. Even skipped marks told the truth about the rhythm.`;
  }

  const examples: string[] = [];
  if (plannerSummary.todoExamples.length) {
    examples.push(
      `Tasks like ${
        joinExamples(plannerSummary.todoExamples)
      } moved from intention into record.`,
    );
  }
  if (plannerSummary.nutritionExamples.length) {
    examples.push(
      `Nutrition stayed in the pattern through ${
        joinExamples(plannerSummary.nutritionExamples)
      }.`,
    );
  }
  if (plannerSummary.journalExamples.length) {
    examples.push(
      `Your journal still pointed toward ${
        joinExamples(plannerSummary.journalExamples)
      }.`,
    );
  }
  const blockB = examples.length
    ? examples.join(" ")
    : "The marks were simple, but they still made the decan legible.";

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
      "Next decan, keep the same practical thread and finish one partial mark before adding another.";
  } else if (skippedPlannerCount > 0) {
    blockD =
      "Next decan, protect one task and one nutrition check-in that are small enough to survive the days that usually slip.";
  } else {
    blockD =
      "Next decan, protect one task and one nutrition check-in long enough for them to feel automatic.";
  }

  const question = "Which practical rhythm deserves protection next decan?";

  return {
    reflection: [blockA, blockB, blockC, blockD, question].filter(Boolean)
      .join("\n\n"),
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
  },
) {
  const evidenceCount = evidenceLines.length;
  const badges = options?.badges ?? [];
  const plannerSummary = buildPlannerSummary(badges);

  if (badgeCount === 0) {
    return {
      reflection:
        `No badges landed this decan. Mark one small action tomorrow so the next reflection has something real to read.`,
      modelUsed: branch === "decan" ? "local-generator-v2" : "local-legacy-v2",
      badgeCount,
      evidenceCount,
      topTags,
      branch,
    };
  }

  if (
    plannerSummary.total >= Math.max(2, Math.ceil(badgeCount / 2))
  ) {
    return buildPlannerFocusedReflection(
      payload,
      badgeCount,
      evidenceCount,
      topTags,
      plannerSummary,
      branch,
    );
  }

  if (evidenceCount < 2) {
    return {
      reflection:
        `Badges exist but details are thin. Capture at least two badges next decan with clear titles and short notes so the trajectory is measurable.`,
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
  const anchorList = signals.anchors.slice(
    0,
    Math.max(3, Math.min(4, signals.anchors.length)),
  );
  const anchorText = anchorList.length === 1
    ? anchorList[0]
    : anchorList.length === 2
    ? `${anchorList[0]} and ${anchorList[1]}`
    : anchorList.length >= 3
    ? `${anchorList[0]}, ${anchorList[1]}, and ${anchorList[2]}`
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
    anchorList[0] ?? "one thread";

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
        `You moved from gathering to doing - exploration turned into execution${
          anchorText ? ` inside ${anchorText}` : ""
        }. You stopped chasing expansion and started tightening fundamentals.`;
      break;
    case "refinement":
      blockA = `You didn't chase variety this decan; you chased refinement${
        anchorText ? ` through ${anchorText}` : ""
      }. Not expansion - tightening fundamentals.`;
      break;
    case "intentional_execution":
      blockA = `Intentional execution showed up - details stayed sharp${
        anchorText ? ` in ${anchorText}` : ""
      }.`;
      break;
    case "exploration":
      blockA = `You sampled multiple threads${
        anchorText ? ` (${anchorText})` : ""
      }. Exploration is fine; name one thread to carry forward.`;
      break;
    case "clustered":
      blockA = `Effort came in deep bursts - few active days, many marks${
        anchorText ? `, grounded in ${anchorText}` : ""
      }.`;
      break;
    default:
      blockA = `Attention had a clear shape${
        anchorText ? ` - ${anchorText}` : ""
      }.`;
      break;
  }
  if (!anchorText) {
    blockA +=
      " Add one concrete number or phrase next decan so we can name what you are building.";
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
      ? "Order came from steadiness, not variety."
      : "Let order do the work more than variety.";
  }

  // Block C: growth + intent
  let blockC = "";
  if (theoryToApplication) {
    blockC = `You moved from exploration into tightening${
      anchorText ? ` on ${anchorText}` : ""
    }. Quiet, durable growth.`;
  } else if (
    highRefinement && signals.metrics.detailsCoverage >= 50 &&
    signals.diversityScore <= 3
  ) {
    blockC =
      `You kept returning to ${mainAnchor}, adjusting instead of adding more. You are building leverage, not activity.`;
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
      `Stay with one drill or discipline daily - ${mainAnchor}. Track one number (minutes/makes/rounds) and one cue (balance/control/clarity).`;
  } else {
    blockD =
      `Choose one discipline and deepen it daily - ${mainAnchor}. Track one number and one cue; let consistency do the heavy lifting.`;
  }

  const question =
    `What will you protect next decan so ${mainAnchor} keeps tightening?`;

  const reflectionParts = [
    blockA.trim(),
    blockB.trim(),
    blockC.trim(),
    blockD.trim(),
    question.trim(),
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

      // Current decan evidence: prefer client-provided badges if present
      const currentWindow: DecanWindow = {
        name: payload.decan_name,
        theme: payload.decan_theme ?? null,
        start: payload.decan_start!,
        end: payload.decan_end!,
      };

      let currentBadges: BadgeRow[] = [];
      if (payload.badges?.length) {
        currentBadges = payload.badges.map((b) => ({
          title: b.title ?? null,
          details: b.details ?? null,
          tags: b.tags ?? null,
          occurred_on: b.occurred_on ?? currentWindow.start,
          flow_id: null,
          event_id: b.event_id ?? null,
        }));
      } else {
        currentBadges = await fetchBadges(
          client,
          payload.user_id!,
          currentWindow.start,
          currentWindow.end,
        );
      }
      const evidenceLines = buildEvidenceLines(currentBadges);
      const tagStr = topTags(currentBadges);
      const topTagList = tagStr
        ? tagStr.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      // Optional history (recent decans) with metrics for comparison
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

      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      let reflectionText = "";
      let modelUsed = "local-generator-v2";

      if (apiKey) {
        try {
          const systemPrompt =
            "You write short decan reflections (one 10-day period). Be concise (80-120 words). Use only the badge evidence. Treat journal badges, checked-off to-dos, and checked-off nutrition as equally valid evidence. Weave in 2-3 concrete details from the evidence (their words, numbers, task names, nutrition names, or drill names) so the user feels seen. No generalities—if you mention an activity, it must appear in the evidence. Note trajectory and theme; one clear next step grounded in what they did. Non-judgmental, warm tone. Aim for: seen and inspired. No bullets, no metadata, no generic advice.";
          const userPrompt = buildAnthropicPrompt(
            payload,
            currentBadges,
            evidenceLines,
            topTagList,
            historySummaries,
          );
          const res = await callAnthropic([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ]);
          if (res.text && res.text.trim().length) {
            reflectionText = res.text.trim();
            modelUsed = res.modelUsed ?? modelUsed;
          }
        } catch (llmErr) {
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
          },
        );
        reflectionText = v2.reflection.trim();
        modelUsed = v2.modelUsed;
      }

      let reflectionId: string | null = null;

      if (payload.persist) {
        try {
          const { data: insertData, error: insertErr } = await client
            .from("decan_reflections")
            .insert({
              user_id: payload.user_id!,
              decan_name: payload.decan_name,
              decan_theme: payload.decan_theme ?? null,
              decan_start: payload.decan_start!,
              decan_end: payload.decan_end!,
              badge_count: currentBadges.length,
              reflection_text: reflectionText,
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
