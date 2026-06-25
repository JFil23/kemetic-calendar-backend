// deno-lint-ignore-file no-import-prefix

// Edge Function: admin_content_preview
// Staff-gated Content Lab for previewing and critiquing reflection, opening,
// Ma'at / Isfet nudge, and push-packaging content without sending to users.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  clampText,
  corsHeaders,
  createServiceClient,
  type HandlerDeps,
  insertRow,
  jsonResponse,
  readJsonBody,
  requireAdmin,
  selectRows,
  serializeError,
  serverNotConfiguredResponse,
  toStringArray,
  updateRow,
  writeAudit,
} from "../_shared/admin.ts";
import { getDecanContext } from "../_shared/decan_context.ts";
import {
  computeCurrentAndNextDecanWindows,
  normalizeTimeZone,
} from "../_shared/decan_schedule.ts";
import {
  buildDecanOpeningDraft,
  buildDriftNudgeDraft,
  buildGuidanceShapingFingerprint,
  buildGuidanceSnapshot,
  buildOpeningDecisionMatrix,
  buildStrengthNudgeDraft,
  type DayCardGuidanceInput,
  decanDayIndex,
  decanPeriodKey,
  type GuidanceBadgeRow,
  type GuidanceDraft,
  type GuidanceWindow,
  MAAT_GUIDANCE_POLICY_VERSION,
  type NudgeLlmRenderOptions,
  renderGuidanceDraftWithLlm,
  resolveGatePolicyForMaturity,
  resolveGraphAxisPriors,
  resolveGuidanceMaturity,
} from "../_shared/maat_guidance.ts";
import {
  buildMaatFlowCompletionEvidenceBadges,
  fetchMaatFlowCompletionEvidenceBadges,
  type MaatFlowCompletionRow,
} from "../_shared/guidance_evidence.ts";
import {
  type MaatFlowScheduledEventInput,
  THE_WEIGHING_FLOW_KEY,
  THE_WEIGHING_FLOW_TITLE,
} from "../_shared/maat_flow_response_spectrum.ts";
import { recordMaatRestorationSuggested } from "../_shared/maat_ledger.ts";
import { resolveCompiledPackagePushText } from "../_shared/output_compiler.ts";
import { buildUserMemoryBrief } from "../_shared/user_memory_brief.ts";

type Artifact =
  | "decan_reflection"
  | "decan_opening"
  | "maat_nudge"
  | "isfet_nudge"
  | "push_preview";

type EvaluationRow = {
  id: string;
  artifact: Artifact;
  mode: string;
  status: string;
  actor_user_id?: string | null;
  target_user_id: string;
  window_start?: string | null;
  window_end?: string | null;
  decan_period_key?: string | null;
  generated_text?: string | null;
  push_preview?: Record<string, unknown> | null;
  source_snapshot?: Record<string, unknown> | null;
  model_version?: string | null;
  rating?: number | null;
  feedback_tags?: string[] | null;
  critique_md?: string | null;
  created_at: string;
  updated_at: string;
};

type MaatSnapshotRow = {
  id: string;
  user_id: string;
  window_date?: string | null;
  decan_period_key?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  score?: number | null;
  band?: string | null;
  reflection_move?: string | null;
  lead_axis?: string | null;
  correction_axes?: string[] | null;
  hard_gates?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DeliveryRow = {
  id: string;
  user_id: string;
  kind: string;
  decan_period_key: string;
  status: string;
  priority?: number | null;
  teaser_text?: string | null;
  body_text?: string | null;
  payload?: Record<string, unknown> | null;
  cta_type?: string | null;
  cta_ref?: string | null;
  trigger_reason?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type ReflectionGenerator = (input: Record<string, unknown>) => Promise<{
  reflection: string;
  modelUsed?: string | null;
  badgeCount?: number | null;
  evidenceCount?: number | null;
  topTags?: string[] | null;
  branch?: string | null;
  outputControl?: Record<string, unknown> | null;
}>;

type ContentLabDeps = HandlerDeps & {
  reflectionGenerator?: ReflectionGenerator;
  nudgeLlmOptions?: NudgeLlmRenderOptions;
};

const ACTIVE_GUIDANCE_STATUSES = new Set(["pending", "shown", "opened"]);

type MaatFlowFixture =
  | "observed_only"
  | "partial_only"
  | "skipped_only"
  | "skipped_explicit_only"
  | "unobserved_only"
  | "observed_plus_partial"
  | "partial_plus_skipped";

const MAAT_FLOW_FIXTURES = new Set<MaatFlowFixture>([
  "observed_only",
  "partial_only",
  "skipped_only",
  "skipped_explicit_only",
  "unobserved_only",
  "observed_plus_partial",
  "partial_plus_skipped",
]);

type NutritionItemRow = Record<string, unknown> & {
  id?: string | null;
  user_id?: string | null;
  nutrient?: string | null;
  source?: string | null;
  purpose?: string | null;
  mode?: string | null;
  days_of_week?: number[] | null;
  decan_days?: number[] | null;
  enabled?: boolean | null;
  created_at?: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const ARTIFACTS = new Set<Artifact>([
  "decan_reflection",
  "decan_opening",
  "maat_nudge",
  "isfet_nudge",
  "push_preview",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseArtifact(value: unknown): Artifact {
  const artifact = normalizeText(value) as Artifact;
  return ARTIFACTS.has(artifact) ? artifact : "decan_reflection";
}

function parseMaatFlowFixture(value: unknown): MaatFlowFixture | null {
  const fixture = normalizeText(value) as MaatFlowFixture;
  return MAAT_FLOW_FIXTURES.has(fixture) ? fixture : null;
}

function dateOnly(value: unknown) {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function inWindow(value: unknown, start: string, end: string) {
  const date = dateOnly(value);
  return !!date && date >= start && date <= end;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function addDays(value: string, days: number) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateForTimeZone(timeZone: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type === "literal") continue;
    parts[part.type] = part.value;
  }
  if (!parts.year || !parts.month || !parts.day) {
    return now.toISOString().slice(0, 10);
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function clampDateToWindow(date: string, window: GuidanceWindow) {
  if (date < window.start) return window.start;
  if (date > window.end) return window.end;
  return date;
}

function dateKeysInRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = parseDateOnly(start);
  const last = parseDateOnly(end);
  while (cursor.getTime() <= last.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isoWeekday(date: string) {
  const day = parseDateOnly(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function dateFromMaybeIso(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

function safeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function safeSelect<T>(
  client: HandlerDeps["client"],
  table: string,
  columns = "*",
): Promise<T[]> {
  const { data, error } = await selectRows<T>(client, table, columns);
  if (error) {
    console.error(
      `admin content select ${table} failed`,
      serializeError(error),
    );
    return [];
  }
  return data ?? [];
}

async function profileForUser(client: HandlerDeps["client"], userId: string) {
  const rows = await safeSelect<Record<string, unknown>>(
    client,
    "profiles",
    "id,display_name,handle,email,timezone,onboarding_completed_at,created_at",
  );
  return rows.find((row) => row.id === userId) ?? null;
}

async function reflectionProfileForUser(
  client: HandlerDeps["client"],
  userId: string,
) {
  const rows = await safeSelect<Record<string, unknown>>(
    client,
    "reflection_profiles",
    "user_id,top_nodes,top_edges,dominant_patterns,tension_pairs,maat_score,isfet_risk_score,last_computed_at",
  );
  return rows.find((row) => row.user_id === userId) ?? null;
}

function bodySnippet(body: unknown) {
  return clampText(
    normalizeText(body).replace(/⟦EVENT_BADGE[\s\S]*?⟧/g, " "),
    220,
  );
}

function badgeFromRow(row: Record<string, unknown>): GuidanceBadgeRow {
  return {
    title: normalizeText(row.title) || null,
    details: normalizeText(row.details) || null,
    tags: safeTags(row.tags),
    occurred_on: dateOnly(row.occurred_on) || dateOnly(row.greg_date),
    flow_id: typeof row.flow_id === "number" ? row.flow_id : null,
    event_id: normalizeText(row.event_id) || null,
    metadata: isRecord(row.metadata) ? row.metadata : null,
  };
}

function todoState(row: Record<string, unknown>) {
  const raw = normalizeText(row.status ?? row.state).toLowerCase();
  if (raw.includes("done") || raw.includes("complete")) return "done";
  if (raw.includes("partial") || raw.includes("progress")) return "partial";
  if (raw.includes("skip")) return "skipped";
  return "pending";
}

function plannerTagsFor(kind: "todo" | "nutrition", state: string) {
  return ["planner", `kind:${kind}`, `state:${state}`];
}

function numberArray(value: unknown) {
  return Array.isArray(value)
    ? value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item))
    : [];
}

function nutritionLabel(row: NutritionItemRow) {
  return normalizeText(row.nutrient) || normalizeText(row.source) ||
    "Nutrition";
}

function nutritionCreatedOnOrBefore(row: NutritionItemRow, date: string) {
  const createdOn = dateFromMaybeIso(row.created_at, date);
  return date >= createdOn;
}

function nutritionOccursOnDate(
  row: NutritionItemRow,
  date: string,
  window: GuidanceWindow,
) {
  if (row.enabled === false) return false;
  const mode = normalizeText(row.mode).toLowerCase();
  if (mode === "weekday") {
    return numberArray(row.days_of_week).includes(isoWeekday(date));
  }
  if (mode === "decan") {
    return numberArray(row.decan_days).includes(
      decanDayIndex(window.start, date),
    );
  }
  return false;
}

function nutritionPendingDetails(row: NutritionItemRow, date: string) {
  const parts = [
    `Planner nutrition entry for ${date}.`,
    "State: pending.",
    "Not checked off yet.",
  ];
  const source = normalizeText(row.source);
  const purpose = normalizeText(row.purpose);
  if (source) parts.push(`Source: ${source}.`);
  if (purpose) parts.push(`Purpose: ${purpose}.`);
  return parts.join(" ");
}

function pendingNutritionBadges(
  rows: NutritionItemRow[],
  userId: string,
  window: GuidanceWindow,
  existingEventIds: Set<string>,
) {
  const badges: GuidanceBadgeRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.user_id !== userId || row.enabled === false) continue;
    for (const date of dateKeysInRange(window.start, window.end)) {
      if (!nutritionCreatedOnOrBefore(row, date)) continue;
      if (!nutritionOccursOnDate(row, date, window)) continue;
      const rowId = normalizeText(row.id);
      const eventId = rowId ? `planner-nutrition:${date}:${rowId}` : "";
      if (eventId && existingEventIds.has(eventId)) continue;
      const title = `Nutrition: ${nutritionLabel(row)}`;
      const details = nutritionPendingDetails(row, date);
      const semanticKey = [
        date,
        title.toLowerCase(),
        details.toLowerCase(),
      ].join("|");
      if (seen.has(semanticKey)) continue;
      seen.add(semanticKey);
      badges.push({
        title,
        details,
        tags: plannerTagsFor("nutrition", "pending"),
        occurred_on: date,
        flow_id: null,
        event_id: eventId || `admin-nutrition:${semanticKey}`,
      });
    }
  }
  return badges;
}

function dedupeBadges(badges: GuidanceBadgeRow[]) {
  const seen = new Set<string>();
  const out: GuidanceBadgeRow[] = [];
  for (const badge of badges) {
    const eventId = normalizeText(badge.event_id);
    const key = eventId ||
      `${badge.occurred_on}:${normalizeText(badge.title).toLowerCase()}`;
    if (!badge.occurred_on || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(badge);
  }
  return out.sort((a, b) =>
    a.occurred_on.localeCompare(b.occurred_on) ||
    normalizeText(a.title).localeCompare(normalizeText(b.title))
  );
}

async function collectEvidence(
  client: HandlerDeps["client"],
  userId: string,
  window: GuidanceWindow,
) {
  const [
    storedRows,
    journalRows,
    todoRows,
    nutritionRows,
    flowCompletionBadges,
  ] = await Promise.all([
    safeSelect<Record<string, unknown>>(
      client,
      "journal_badges",
      "user_id,title,details,tags,occurred_on,flow_id,event_id,metadata",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "journal_entries",
      "id,user_id,greg_date,body,meta,flow_id",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "todos",
      "id,user_id,title,notes,due_date,status,state,completed_at",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "nutrition_items",
      "id,user_id,nutrient,source,purpose,mode,days_of_week,decan_days,repeat,enabled,created_at",
    ),
    fetchMaatFlowCompletionEvidenceBadges({
      client,
      userId,
      start: window.start,
      end: window.end,
    }).catch((error) => {
      const message = normalizeText(
        error instanceof Error ? error.message : String(error),
      );
      if (!message.includes("is not a function")) {
        console.error(
          "admin content flow completion evidence failed",
          serializeError(error),
        );
      }
      return [] as GuidanceBadgeRow[];
    }),
  ]);

  const badges: GuidanceBadgeRow[] = [...flowCompletionBadges];

  for (const row of storedRows) {
    if (
      row.user_id !== userId ||
      !inWindow(row.occurred_on, window.start, window.end)
    ) {
      continue;
    }
    badges.push(badgeFromRow(row));
  }

  for (const row of journalRows) {
    if (
      row.user_id !== userId ||
      !inWindow(row.greg_date, window.start, window.end)
    ) {
      continue;
    }
    const snippet = bodySnippet(row.body);
    if (!snippet) continue;
    badges.push({
      title: "Journal entry",
      details: snippet,
      tags: ["kind:journal"],
      occurred_on: dateOnly(row.greg_date),
      flow_id: typeof row.flow_id === "number" ? row.flow_id : null,
      event_id: `journal-entry:${row.id}`,
    });
  }

  for (const row of todoRows) {
    const dueDate = dateOnly(row.due_date);
    if (
      row.user_id !== userId || !inWindow(dueDate, window.start, window.end)
    ) {
      continue;
    }
    const state = todoState(row);
    badges.push({
      title: `${state === "pending" ? "Unchecked" : state} to-do: ${
        normalizeText(row.title) || "Untitled"
      }`,
      details: normalizeText(row.notes) || null,
      tags: ["kind:todo", `state:${state}`],
      occurred_on: dueDate,
      flow_id: null,
      event_id: `admin-todo:${row.id}`,
    });
  }

  const existingEventIds = new Set(
    badges.map((badge) => normalizeText(badge.event_id)).filter(Boolean),
  );
  badges.push(
    ...pendingNutritionBadges(
      nutritionRows as NutritionItemRow[],
      userId,
      window,
      existingEventIds,
    ),
  );

  return dedupeBadges(badges);
}

function weighingFixtureCompletion(params: {
  id: number;
  status: "observed" | "observed_partly" | "skipped";
  completedOn: string;
}): MaatFlowCompletionRow {
  return {
    id: params.id,
    client_event_id: `admin-fixture-weighing-${params.id}`,
    flow_id: 42,
    completed_on: params.completedOn,
    completed_at: `${params.completedOn}T17:00:00.000Z`,
    source: "admin_preview_fixture",
    metadata: {
      source: "admin_preview_fixture",
      admin_preview_fixture: true,
      status: params.status,
      flow_key: THE_WEIGHING_FLOW_KEY,
      flow_title: THE_WEIGHING_FLOW_TITLE,
      event_title: "Open the Material Ledger",
      completed_on: params.completedOn,
    },
  };
}

function maatFlowFixtureBadges(
  fixture: MaatFlowFixture | null,
  window: GuidanceWindow,
): GuidanceBadgeRow[] {
  if (!fixture || fixture === "unobserved_only") return [];
  const dayOne = window.start;
  const dayTwo = addDays(window.start, 1);
  const completions: MaatFlowCompletionRow[] = [];
  if (fixture === "observed_only") {
    completions.push(weighingFixtureCompletion({
      id: 1,
      status: "observed",
      completedOn: dayOne,
    }));
  } else if (fixture === "partial_only") {
    completions.push(weighingFixtureCompletion({
      id: 1,
      status: "observed_partly",
      completedOn: dayOne,
    }));
  } else if (
    fixture === "skipped_only" || fixture === "skipped_explicit_only"
  ) {
    completions.push(weighingFixtureCompletion({
      id: 1,
      status: "skipped",
      completedOn: dayOne,
    }));
  } else if (fixture === "observed_plus_partial") {
    completions.push(
      weighingFixtureCompletion({
        id: 1,
        status: "observed",
        completedOn: dayOne,
      }),
      weighingFixtureCompletion({
        id: 2,
        status: "observed_partly",
        completedOn: dayTwo,
      }),
    );
  } else if (fixture === "partial_plus_skipped") {
    completions.push(
      weighingFixtureCompletion({
        id: 1,
        status: "observed_partly",
        completedOn: dayOne,
      }),
      weighingFixtureCompletion({
        id: 2,
        status: "skipped",
        completedOn: dayTwo,
      }),
    );
  }

  return buildMaatFlowCompletionEvidenceBadges({ completions });
}

function maatFlowFixtureScheduledEvents(
  fixture: MaatFlowFixture | null,
  window: GuidanceWindow,
): MaatFlowScheduledEventInput[] {
  if (fixture !== "unobserved_only") return [];
  return [{
    flowKey: THE_WEIGHING_FLOW_KEY,
    flowTitle: THE_WEIGHING_FLOW_TITLE,
    eventTitle: "Open the Material Ledger",
    scheduledOn: window.start,
    startsAt: `${window.start}T17:00:00.000Z`,
    clientEventId: "admin-fixture-weighing-unobserved",
    behaviorPayload: {
      flow_key: THE_WEIGHING_FLOW_KEY,
    },
  }];
}

function flowBadgeMetadata(badges: GuidanceBadgeRow[]) {
  return badges
    .map((badge) => badge.metadata)
    .filter(isRecord)
    .filter((metadata) =>
      normalizeText(metadata.flow_key) || normalizeText(metadata.canonical_tier)
    );
}

function evidenceLines(badges: GuidanceBadgeRow[], limit = 16) {
  return badges.slice(0, limit).map((badge) =>
    [
      badge.occurred_on,
      normalizeText(badge.title),
      normalizeText(badge.details),
      (badge.tags ?? []).join(", "),
    ].filter(Boolean).join(" - ")
  );
}

function tagValue(tags: string[] | null | undefined, prefix: string) {
  return (tags ?? [])
    .map((tag) => normalizeText(tag))
    .find((tag) => tag.toLowerCase().startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function conciseDetail(value: string) {
  return normalizeText(value)
    .replace(/\bPlanner nutrition entry for \d{4}-\d{2}-\d{2}\.\s*/gi, "")
    .replace(/\bState:\s*pending\.\s*/gi, "")
    .replace(/\bNot checked off yet\.\s*/gi, "")
    .replace(/\bSource:\s*\.\s*/gi, "")
    .replace(/\bPurpose:\s*\.\s*/gi, "")
    .trim();
}

function previewEvidencePhrases(badges: GuidanceBadgeRow[], limit = 4) {
  const seen = new Set<string>();
  const phrases: string[] = [];

  for (const badge of badges) {
    const title = normalizeText(badge.title);
    const details = conciseDetail(badge.details ?? "");
    const tags = badge.tags ?? [];
    const kind = tagValue(tags, "kind:").toLowerCase();
    const state = tagValue(tags, "state:").toLowerCase();
    const date = normalizeText(badge.occurred_on);
    let phrase = "";

    if (kind === "nutrition") {
      const label = title.replace(/^nutrition:\s*/i, "").trim() ||
        "nutrition";
      phrase = [
        `nutrition ${label}`,
        state ? `was ${state}` : "",
        date ? `on ${date}` : "",
        details,
      ].filter(Boolean).join(" ");
    } else if (kind === "todo") {
      const label =
        title.replace(/^(unchecked|done|partial|skipped)\s+to-do:\s*/i, "")
          .trim() || "planner item";
      phrase = [
        `planner item ${label}`,
        state ? `was ${state}` : "",
        date ? `on ${date}` : "",
        details,
      ].filter(Boolean).join(" ");
    } else if (kind === "journal") {
      phrase = details ? `journal noted ${details}` : title;
    } else {
      phrase = [title, details].filter(Boolean).join(": ");
    }

    phrase = clampText(normalizeText(phrase), 140);
    const key = phrase.toLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
    if (phrases.length >= limit) break;
  }

  return phrases;
}

function topNodes(profile: Record<string, unknown> | null) {
  const nodes = Array.isArray(profile?.top_nodes) ? profile.top_nodes : [];
  return nodes.slice(0, 8).filter(isRecord).map((node) => ({
    slug: normalizeText(node.slug) || null,
    title: normalizeText(node.title ?? node.slug) || null,
    score: typeof node.score === "number" ? node.score : null,
  }));
}

function asDateMs(value: unknown) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : 0;
}

function latestSnapshotFor(
  snapshots: MaatSnapshotRow[],
  userId: string,
  periodKey?: string,
) {
  const userRows = snapshots
    .filter((row) => row.user_id === userId)
    .sort((a, b) =>
      asDateMs(b.window_date ?? b.created_at) -
      asDateMs(a.window_date ?? a.created_at)
    );
  return userRows.find((row) => row.decan_period_key === periodKey) ??
    userRows[0] ?? null;
}

function snapshotSummary(row: MaatSnapshotRow | null) {
  if (!row) {
    return {
      band: "unknown",
      score: null,
      reflection_move: "unknown",
      lead_axis: null,
      correction_axes: [],
      hard_gates: [],
      decan_period_key: null,
      window_date: null,
      updated_at: null,
    };
  }
  return {
    band: row.band ?? "unknown",
    score: row.score ?? null,
    reflection_move: row.reflection_move ?? "unknown",
    lead_axis: row.lead_axis ?? null,
    correction_axes: row.correction_axes ?? [],
    hard_gates: row.hard_gates ?? [],
    decan_period_key: row.decan_period_key ?? null,
    window_date: row.window_date ?? null,
    updated_at: row.updated_at ?? row.created_at ?? null,
  };
}

function recommendedNudge(snapshot: ReturnType<typeof snapshotSummary>) {
  const band = normalizeText(snapshot.band).toLowerCase();
  const move = normalizeText(snapshot.reflection_move).toLowerCase();
  const hasGates = (snapshot.hard_gates ?? []).length > 0;
  if (
    hasGates || move === "correct" || band.includes("isfet") ||
    band === "mixed"
  ) {
    return "isfet_nudge" as Artifact;
  }
  return "maat_nudge" as Artifact;
}

function countWindowEvidenceFromRows(params: {
  userId: string;
  window: GuidanceWindow;
  storedRows: Record<string, unknown>[];
  journalRows: Record<string, unknown>[];
  todoRows: Record<string, unknown>[];
  nutritionRows: Record<string, unknown>[];
}) {
  const { userId, window } = params;
  let count = 0;
  count += params.storedRows.filter((row) =>
    row.user_id === userId &&
    inWindow(row.occurred_on, window.start, window.end)
  ).length;
  count += params.journalRows.filter((row) =>
    row.user_id === userId &&
    inWindow(row.greg_date, window.start, window.end)
  ).length;
  count +=
    params.todoRows.filter((row) =>
      row.user_id === userId && inWindow(row.due_date, window.start, window.end)
    ).length;
  count +=
    params.nutritionRows.filter((row) =>
      row.user_id === userId && row.enabled !== false &&
      (!dateOnly(String(row.created_at ?? "").slice(0, 10)) ||
        dateOnly(String(row.created_at ?? "").slice(0, 10)) <= window.end)
    ).length;
  return count;
}

async function nodeActivity(
  client: HandlerDeps["client"],
  userId: string,
) {
  const [entryRows, nodeRows] = await Promise.all([
    safeSelect<Record<string, unknown>>(
      client,
      "node_insight_entries",
      "id,user_id,node_id,body_text,entry_date,created_at",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "nodes",
      "id,slug,title,glyph",
    ),
  ]);
  const nodesById = new Map(nodeRows.map((row) => [row.id, row]));
  return entryRows
    .filter((row) => row.user_id === userId)
    .sort((a, b) =>
      Date.parse(String(b.created_at ?? "")) -
      Date.parse(String(a.created_at ?? ""))
    )
    .slice(0, 10)
    .map((row) => {
      const node = nodesById.get(row.node_id);
      return {
        id: row.id,
        node_slug: normalizeText(node?.slug) || null,
        node_title: normalizeText(node?.title) || null,
        node_glyph: normalizeText(node?.glyph) || null,
        entry_date: row.entry_date ?? null,
        snippet: clampText(normalizeText(row.body_text), 180),
        created_at: row.created_at ?? null,
      };
    });
}

async function recentRows(
  client: HandlerDeps["client"],
  userId: string,
) {
  const [reflections, deliveries, evaluations] = await Promise.all([
    safeSelect<Record<string, unknown>>(
      client,
      "decan_reflections",
      "id,user_id,decan_name,decan_start,decan_end,badge_count,reflection_text,created_at",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "maat_guidance_deliveries",
      "id,user_id,kind,decan_period_key,status,teaser_text,body_text,cta_type,cta_ref,created_at,updated_at",
    ),
    safeSelect<EvaluationRow>(
      client,
      "admin_content_evaluations",
      "id,artifact,mode,status,actor_user_id,target_user_id,window_start,window_end,decan_period_key,generated_text,push_preview,source_snapshot,model_version,rating,feedback_tags,critique_md,created_at,updated_at",
    ),
  ]);

  return {
    reflections: reflections
      .filter((row) => row.user_id === userId)
      .sort((a, b) =>
        Date.parse(String(b.created_at ?? "")) -
        Date.parse(String(a.created_at ?? ""))
      )
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        decan_name: row.decan_name,
        decan_start: row.decan_start,
        decan_end: row.decan_end,
        badge_count: row.badge_count,
        preview: clampText(row.reflection_text, 260),
        created_at: row.created_at,
      })),
    deliveries: deliveries
      .filter((row) => row.user_id === userId)
      .sort((a, b) =>
        Date.parse(String(b.created_at ?? "")) -
        Date.parse(String(a.created_at ?? ""))
      )
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        decan_period_key: row.decan_period_key,
        teaser_text: row.teaser_text,
        body_text: row.body_text,
        cta_type: row.cta_type,
        cta_ref: row.cta_ref,
        created_at: row.created_at,
      })),
    evaluations: evaluations
      .filter((row) => row.target_user_id === userId)
      .sort((a, b) =>
        Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "")
      )
      .slice(0, 12)
      .map(safeEvaluation),
  };
}

async function listUsersPayload(
  client: HandlerDeps["client"],
  body: Record<string, unknown>,
) {
  const limitRaw = Number(body.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(200, Math.round(limitRaw)))
    : 80;
  const query = normalizeText(body.q).toLowerCase();
  const bandFilter = normalizeText(body.band).toLowerCase();
  const mode = normalizeText(body.mode).toLowerCase();

  const [
    profiles,
    reflectionProfiles,
    snapshots,
    deliveries,
    evaluations,
    storedRows,
    journalRows,
    todoRows,
    nutritionRows,
  ] = await Promise.all([
    safeSelect<Record<string, unknown>>(
      client,
      "profiles",
      "id,display_name,handle,email,timezone,onboarding_completed_at,created_at",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "reflection_profiles",
      "user_id,top_nodes,top_edges,dominant_patterns,tension_pairs,maat_score,isfet_risk_score,last_computed_at",
    ),
    safeSelect<MaatSnapshotRow>(
      client,
      "maat_snapshots",
      "id,user_id,window_date,decan_period_key,window_start,window_end,score,band,reflection_move,lead_axis,correction_axes,hard_gates,created_at,updated_at",
    ),
    safeSelect<DeliveryRow>(
      client,
      "maat_guidance_deliveries",
      "id,user_id,kind,decan_period_key,status,priority,teaser_text,body_text,payload,cta_type,cta_ref,trigger_reason,created_at,updated_at",
    ),
    safeSelect<EvaluationRow>(
      client,
      "admin_content_evaluations",
      "id,artifact,mode,status,actor_user_id,target_user_id,window_start,window_end,decan_period_key,generated_text,push_preview,source_snapshot,model_version,rating,feedback_tags,critique_md,created_at,updated_at",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "journal_badges",
      "user_id,title,details,tags,occurred_on,flow_id,event_id",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "journal_entries",
      "id,user_id,greg_date,body,meta,flow_id",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "todos",
      "id,user_id,title,notes,due_date,status,state,completed_at",
    ),
    safeSelect<Record<string, unknown>>(
      client,
      "nutrition_items",
      "id,user_id,nutrient,source,purpose,enabled,created_at",
    ),
  ]);

  const reflectionByUser = new Map(
    reflectionProfiles.map((row) => [String(row.user_id), row]),
  );
  const evaluationsByUser = new Map<string, EvaluationRow[]>();
  for (const row of evaluations) {
    const id = row.target_user_id;
    if (!id) continue;
    evaluationsByUser.set(id, [...(evaluationsByUser.get(id) ?? []), row]);
  }

  const users = profiles
    .map((profile) => {
      const userId = String(profile.id ?? "");
      const timezone = normalizeTimeZone(profile.timezone as string | null);
      const current =
        computeCurrentAndNextDecanWindows(new Date(), timezone)[0];
      const window = current ?? {
        start: new Date().toISOString().slice(0, 10),
        end: addDays(new Date().toISOString().slice(0, 10), 9),
        decanName: "Current decan",
        decanTheme: null,
        decanContextKey: null,
      };
      const periodKey = decanPeriodKey(window);
      const reflectionProfile = reflectionByUser.get(userId) ?? null;
      const latestSnapshot = snapshotSummary(
        latestSnapshotFor(snapshots, userId, periodKey),
      );
      const pendingDeliveries = deliveries.filter((row) =>
        row.user_id === userId &&
        ["pending", "shown"].includes(row.status ?? "") &&
        row.decan_period_key === periodKey
      );
      const userEvaluations = (evaluationsByUser.get(userId) ?? [])
        .sort((a, b) => asDateMs(b.created_at) - asDateMs(a.created_at));
      const badgeCount = countWindowEvidenceFromRows({
        userId,
        window,
        storedRows,
        journalRows,
        todoRows,
        nutritionRows,
      });
      const displayName = normalizeText(
        profile.display_name ?? profile.handle ?? profile.email,
      ) || `User ${userId.slice(0, 8)}`;
      return {
        id: userId,
        display_name: displayName,
        handle: normalizeText(profile.handle ?? profile.email) || null,
        timezone,
        created_at: profile.created_at ?? null,
        onboarding_completed: !!profile.onboarding_completed_at,
        decan_label: window.decanName,
        decan_period_key: periodKey,
        window,
        maat: latestSnapshot,
        recommended_nudge: recommendedNudge(latestSnapshot),
        top_nodes: topNodes(reflectionProfile),
        badge_count_this_decan: badgeCount,
        has_pending_delivery: pendingDeliveries.length > 0,
        pending_delivery_count: pendingDeliveries.length,
        needs_review: userEvaluations.some((row) =>
          row.status === "needs_work" ||
          (row.feedback_tags ?? []).includes("needs_work") ||
          (row.feedback_tags ?? []).includes("generic")
        ),
        latest_evaluation: userEvaluations[0]
          ? safeEvaluation(userEvaluations[0])
          : null,
        last_active_at: [
          ...storedRows.filter((row) => row.user_id === userId).map((row) =>
            row.occurred_on
          ),
          ...journalRows.filter((row) => row.user_id === userId).map((row) =>
            row.greg_date
          ),
          ...todoRows.filter((row) => row.user_id === userId).map((row) =>
            row.completed_at ?? row.due_date
          ),
        ].filter(Boolean).sort().at(-1) ?? null,
      };
    })
    .filter((user) => {
      if (!user.id) return false;
      if (
        query &&
        ![
          user.display_name,
          user.handle ?? "",
          user.id,
          user.decan_label,
          ...(user.top_nodes ?? []).map((node) =>
            `${node.title ?? ""} ${node.slug ?? ""}`
          ),
        ].join(" ").toLowerCase().includes(query)
      ) {
        return false;
      }
      if (
        bandFilter && normalizeText(user.maat.band).toLowerCase() !== bandFilter
      ) {
        return false;
      }
      if (mode === "needs_review" && !user.needs_review) return false;
      if (mode === "active" && user.badge_count_this_decan <= 0) return false;
      return true;
    })
    .sort((a, b) =>
      Number(b.needs_review) - Number(a.needs_review) ||
      b.badge_count_this_decan - a.badge_count_this_decan ||
      asDateMs(b.last_active_at) - asDateMs(a.last_active_at) ||
      a.display_name.localeCompare(b.display_name)
    )
    .slice(0, limit);

  return {
    users,
    generated_at: new Date().toISOString(),
    filters: { q: query, band: bandFilter, mode, limit },
  };
}

async function resolveWindow(
  client: HandlerDeps["client"],
  userId: string,
  input: Record<string, unknown>,
): Promise<
  { window: GuidanceWindow; profile: Record<string, unknown> | null }
> {
  const profile = await profileForUser(client, userId);
  const timezone = normalizeTimeZone(profile?.timezone as string | null);
  const start = dateOnly(input.decan_start ?? input.window_start);
  const end = dateOnly(input.decan_end ?? input.window_end);
  if (start && end) {
    return {
      profile,
      window: {
        start,
        end,
        decanName: normalizeText(input.decan_name) || `Decan ${start}`,
        decanTheme: normalizeText(input.decan_theme) || null,
        decanContextKey: normalizeText(input.decan_context_key) || null,
      },
    };
  }

  const current = computeCurrentAndNextDecanWindows(new Date(), timezone)[0];
  if (current) return { profile, window: current };

  const fallbackStart = new Date().toISOString().slice(0, 10);
  return {
    profile,
    window: {
      start: fallbackStart,
      end: addDays(fallbackStart, 9),
      decanName: `Decan ${fallbackStart}`,
      decanTheme: null,
      decanContextKey: null,
    },
  };
}

function sourceSnapshot(params: {
  window: GuidanceWindow;
  periodKey: string;
  badges: GuidanceBadgeRow[];
  profile: Record<string, unknown> | null;
  evidence: string[];
  guidance?: Record<string, unknown>;
}) {
  return {
    policy_version: MAAT_GUIDANCE_POLICY_VERSION,
    decan_period_key: params.periodKey,
    decan_name: params.window.decanName,
    decan_theme: params.window.decanTheme ?? null,
    decan_context_key: params.window.decanContextKey ?? null,
    window_start: params.window.start,
    window_end: params.window.end,
    badge_count: params.badges.length,
    evidence_count: params.evidence.length,
    evidence_lines: params.evidence,
    top_nodes: topNodes(params.profile),
    guidance: params.guidance ?? null,
  };
}

function pushPreviewFor(params: {
  artifact: Artifact;
  text: string;
  ctaType?: string | null;
  ctaRef?: string | null;
}) {
  const body = clampText(params.text, 150);
  if (params.artifact === "decan_reflection") {
    return {
      kind: "decan_reflection",
      title: "Your decan reflection is ready",
      body,
      deeplink: "/reflections/preview",
    };
  }
  if (params.artifact === "decan_opening") {
    return {
      kind: "decan_opening",
      title: "Decan Opening",
      body,
      deeplink: "/maat-guidance/preview",
    };
  }
  if (params.artifact === "isfet_nudge") {
    return {
      kind: "maat_guidance",
      title: "Ma'at Grounding",
      body,
      deeplink: "/maat-guidance/preview",
      cta_type: params.ctaType ?? null,
      cta_ref: params.ctaRef ?? null,
    };
  }
  return {
    kind: "maat_guidance",
    title: "Ma'at guidance",
    body,
    deeplink: "/maat-guidance/preview",
    cta_type: params.ctaType ?? null,
    cta_ref: params.ctaRef ?? null,
  };
}

function rendererStatus(renderer: Record<string, unknown> | null | undefined) {
  if (!renderer) return "unknown";
  const engine = normalizeText(renderer.renderer);
  const fallbackReason = normalizeText(renderer.fallback_reason);
  if (engine === "anthropic" && !fallbackReason) return "llm";
  if (fallbackReason) return "fallback";
  if (engine) return engine;
  return "unknown";
}

function nudgeRenderDiagnostics(draft: GuidanceDraft) {
  const renderer = isRecord(draft.payload.nudge_renderer)
    ? draft.payload.nudge_renderer
    : null;
  const compiler = isRecord(draft.payload.output_compiler)
    ? draft.payload.output_compiler
    : null;
  const compiledPackage = isRecord(draft.payload.compiled_output_package)
    ? draft.payload.compiled_output_package
    : null;
  const outputControl = isRecord(draft.payload.output_control)
    ? draft.payload.output_control
    : null;
  const plan = isRecord(outputControl?.plan) ? outputControl.plan : null;
  const meaning = isRecord(plan?.meaning) ? plan.meaning : null;
  const contract = isRecord(meaning?.offeringRender)
    ? meaning.offeringRender
    : null;
  const exampleReference = isRecord(meaning?.exampleReference)
    ? meaning.exampleReference
    : null;
  const pushResolution = resolveCompiledPackagePushText({
    payload: draft.payload,
    legacyTeaserText: draft.teaserText,
    legacyBodyText: draft.bodyText,
  });

  const compilerStatus = normalizeText(compiler?.status);
  const rendererEngine = normalizeText(renderer?.renderer);
  return {
    surface: "nudge",
    status: compilerStatus === "compiled"
      ? rendererEngine === "anthropic" ? "llm" : rendererEngine || "compiled"
      : compilerStatus === "fallback"
      ? "fallback"
      : rendererStatus(renderer),
    renderer,
    compiler,
    compiled_package: compiledPackage,
    fallback_quality: compiler?.fallback_quality === true,
    not_quality_proof: compiler?.not_quality_proof === true,
    delivery_recommendation: normalizeText(compiler?.delivery_recommendation) ||
      null,
    push_source: pushResolution.source,
    push_blocked: pushResolution.blocked,
    push_block_reason: pushResolution.reason,
    case_key: normalizeText(meaning?.caseKey) ||
      normalizeText(contract?.caseKey) || null,
    offering: normalizeText(meaning?.selectedOffering) ||
      normalizeText(contract?.offering) || null,
    example_id: normalizeText(contract?.exampleId) ||
      normalizeText(exampleReference?.id) || null,
    example_available: Boolean(contract?.exampleNudge),
    diagnosis: normalizeText(contract?.diagnosis) ||
      normalizeText(meaning?.userFacingDiagnosis) || null,
    concrete_action: normalizeText(contract?.concreteAction) ||
      normalizeText(meaning?.specificAction) || null,
  };
}

function packageRenderDiagnostics(draft: GuidanceDraft, surface: string) {
  const compiledPackage = isRecord(draft.payload.compiled_output_package)
    ? draft.payload.compiled_output_package
    : null;
  const compiler = isRecord(draft.payload.output_compiler)
    ? draft.payload.output_compiler
    : isRecord(compiledPackage?.compiler)
    ? compiledPackage.compiler
    : null;
  const compilerStatus = normalizeText(compiler?.status);
  return {
    surface,
    status: compilerStatus === "compiled"
      ? "compiled"
      : compilerStatus === "fallback"
      ? "fallback"
      : "unknown",
    renderer: compiler
      ? {
        renderer: compiler.renderer ?? null,
        model_used: compiler.model_version ?? null,
        fallback_reason: compiler.fallback_reason ?? null,
      }
      : null,
    compiler,
    compiled_package: compiledPackage,
    fallback_quality: compiler?.fallback_quality === true,
    not_quality_proof: compiler?.not_quality_proof === true,
    delivery_recommendation: normalizeText(compiler?.delivery_recommendation) ||
      null,
    case_key: normalizeText(compiler?.case_key) || null,
    offering: normalizeText(compiler?.offering) || null,
    example_id: normalizeText(compiler?.example_id) || null,
    example_available: compiler?.example_available === true,
    diagnosis: normalizeText(compiler?.diagnosis) || null,
    concrete_action: normalizeText(compiler?.concrete_action) || null,
    push_source: resolveCompiledPackagePushText({
      payload: draft.payload,
      legacyTeaserText: draft.teaserText,
      legacyBodyText: draft.bodyText,
    }).source,
  };
}

function reflectionRenderDiagnostics(params: {
  modelUsed?: string | null;
  outputControl?: Record<string, unknown> | null;
}) {
  const outputControl = isRecord(params.outputControl)
    ? params.outputControl
    : null;
  const renderer = isRecord(outputControl?.renderer)
    ? outputControl.renderer
    : {
      renderer: normalizeText(params.modelUsed) || "unknown",
      model_used: params.modelUsed ?? null,
      fallback_reason: normalizeText(params.modelUsed).startsWith("local-")
        ? "local_reflection_renderer"
        : null,
    };
  const plan = isRecord(outputControl?.plan) ? outputControl.plan : null;
  const compiler = isRecord(outputControl?.outputCompiler)
    ? outputControl.outputCompiler
    : isRecord(outputControl?.output_compiler)
    ? outputControl.output_compiler
    : null;
  const compiledPackage = isRecord(outputControl?.compiledOutputPackage)
    ? outputControl.compiledOutputPackage
    : isRecord(outputControl?.compiled_output_package)
    ? outputControl.compiled_output_package
    : null;
  const offeringRender = isRecord(plan?.offeringRender)
    ? plan.offeringRender
    : null;
  const maatFlowPattern = isRecord(outputControl?.maatFlowDecanPattern)
    ? outputControl.maatFlowDecanPattern
    : isRecord(outputControl?.maat_flow_decan_pattern)
    ? outputControl.maat_flow_decan_pattern
    : null;
  const interpretiveEmphasis = isRecord(maatFlowPattern?.interpretiveEmphasis)
    ? maatFlowPattern.interpretiveEmphasis
    : null;
  const compilerStatus = normalizeText(compiler?.status);
  const rendererEngine = normalizeText(renderer?.renderer);
  const pushResolution = resolveCompiledPackagePushText({
    payload: outputControl,
  });

  return {
    surface: "reflection",
    status: compilerStatus === "compiled"
      ? rendererEngine === "anthropic" ? "llm" : rendererEngine || "compiled"
      : compilerStatus === "fallback"
      ? "fallback"
      : rendererStatus(renderer),
    renderer,
    compiler,
    compiled_package: compiledPackage,
    fallback_quality: compiler?.fallback_quality === true,
    not_quality_proof: compiler?.not_quality_proof === true,
    case_key: normalizeText(plan?.caseKey) || null,
    offering: normalizeText(plan?.selectedOffering) || null,
    example_id: normalizeText(offeringRender?.exampleId) || null,
    example_available: Boolean(offeringRender?.exampleReflection),
    diagnosis: normalizeText(offeringRender?.diagnosis) || null,
    concrete_action: normalizeText(offeringRender?.concreteAction) || null,
    maat_flow_dominant_tier: normalizeText(maatFlowPattern?.dominantTier) ||
      null,
    maat_flow_reflection_tier: normalizeText(
      interpretiveEmphasis?.reflectionTier,
    ) || null,
    maat_flow_template_id: normalizeText(
      maatFlowPattern?.selectedTensionTemplateId,
    ) || null,
    push_source: pushResolution.source,
    push_blocked: pushResolution.blocked,
    push_block_reason: pushResolution.reason,
  };
}

function withRenderDiagnostics<T extends Record<string, unknown>>(
  value: T,
  diagnostics: Record<string, unknown> | null | undefined,
) {
  return diagnostics
    ? {
      ...value,
      render_diagnostics: diagnostics,
    }
    : value;
}

function llmRequiredFailure(
  artifact: Artifact,
  diagnostics: Record<string, unknown> | null | undefined,
) {
  if (!diagnostics) {
    return {
      error: "llm_render_required",
      detail: "No renderer diagnostics were produced for this preview.",
      artifact,
      diagnostics: null,
    };
  }
  if (diagnostics.status === "llm") return null;
  const renderer = isRecord(diagnostics.renderer) ? diagnostics.renderer : null;
  const fallbackReason = normalizeText(renderer?.fallback_reason) ||
    normalizeText(diagnostics.status) || "unknown";
  return {
    error: "llm_render_required",
    detail:
      `Admin preview requires an Anthropic render, but this preview fell back before delivery. Fallback reason: ${fallbackReason}.`,
    artifact,
    diagnostics,
  };
}

function draftToPreview(draft: GuidanceDraft, artifact: Artifact) {
  const compiledPackage = isRecord(draft.payload.compiled_output_package)
    ? draft.payload.compiled_output_package
    : null;
  const packageFinalText = normalizeText(compiledPackage?.final_text);
  const packageTeaserText = normalizeText(compiledPackage?.teaser_text);
  const bodyText = packageFinalText || draft.bodyText;
  const teaserText = packageTeaserText || draft.teaserText;
  const pushResolution = resolveCompiledPackagePushText({
    payload: draft.payload,
    legacyTeaserText: teaserText,
    legacyBodyText: bodyText,
  });
  const pushText = pushResolution.text || "";
  const packageModel = normalizeText(compiledPackage?.render_model);
  const renderer = draft.payload.nudge_renderer as
    | {
      model_version?: string | null;
      renderer?: string | null;
      fallback_reason?: string | null;
    }
    | undefined;
  const modelVersion = renderer?.renderer === "anthropic" &&
      !renderer?.fallback_reason
    ? renderer.model_version ?? packageModel ?? "maat-guidance-draft-v3"
    : packageModel
    ? packageModel
    : "maat-guidance-draft-v3";
  const diagnostics = draft.kind === "drift_nudge" ||
      draft.kind === "strength_nudge"
    ? nudgeRenderDiagnostics(draft)
    : draft.kind === "decan_opening"
    ? packageRenderDiagnostics(draft, "opening")
    : null;
  const pushDiagnostics = diagnostics
    ? {
      ...diagnostics,
      push_source: pushResolution.source,
      push_blocked: pushResolution.blocked,
      push_block_reason: pushResolution.reason,
    }
    : null;
  return {
    text: bodyText,
    modelVersion,
    diagnostics,
    push: withRenderDiagnostics(
      pushPreviewFor({
        artifact,
        text: pushText,
        ctaType: draft.ctaType,
        ctaRef: draft.ctaRef,
      }),
      pushDiagnostics,
    ),
    guidance: {
      kind: draft.kind,
      priority: draft.priority,
      payload: draft.payload,
      cta_type: draft.ctaType,
      cta_ref: draft.ctaRef,
      trigger_reason: draft.triggerReason,
    },
  };
}

async function defaultReflectionGenerator(
  input: Record<string, unknown>,
): Promise<{
  reflection: string;
  modelUsed?: string | null;
  badgeCount?: number | null;
  evidenceCount?: number | null;
  topTags?: string[] | null;
  branch?: string | null;
  outputControl?: Record<string, unknown> | null;
}> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("reflection_generator_not_configured");
  }
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/ai_generate_reflection`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `ai_generate_reflection:${response.status}:${
        normalizeText(payload.error) || "request_failed"
      }`,
    );
  }
  return payload;
}

function fallbackReflection(
  window: GuidanceWindow,
  badges: GuidanceBadgeRow[],
) {
  const examples = evidenceLines(badges, 3)
    .map((line) => line.split(" - ").slice(1, 3).join(": "))
    .filter(Boolean);
  if (!examples.length) {
    return `This decan closed with little recorded evidence. ${window.decanName} can still become useful if the next cycle starts with one small mark, one checked item, and one honest note about what resisted structure.`;
  }
  return `This decan left specific evidence: ${
    examples.join("; ")
  }. ${window.decanName} asks that those marks become more than memory. Keep the next move concrete: protect one rhythm that worked, simplify one item that stayed unchecked, and record the result while it is still fresh.`;
}

async function generatePreview(
  req: Request,
  deps: ContentLabDeps,
  body: Record<string, unknown>,
  actorUserId: string,
) {
  const targetUserId = clampText(body.target_user_id, 80);
  if (!targetUserId) {
    return jsonResponse(req, { error: "target_user_id_required" }, {
      status: 400,
    });
  }

  const artifact = parseArtifact(body.artifact);
  const { window, profile } = await resolveWindow(
    deps.client,
    targetUserId,
    body,
  );
  const periodKey = decanPeriodKey(window);
  const maatFlowFixture = parseMaatFlowFixture(body.maat_flow_fixture);
  const fixtureBadges = maatFlowFixtureBadges(maatFlowFixture, window);
  const fixtureScheduledEvents = maatFlowFixtureScheduledEvents(
    maatFlowFixture,
    window,
  );
  const badges = dedupeBadges([
    ...(await collectEvidence(deps.client, targetUserId, window)),
    ...fixtureBadges,
  ]);
  const evidence = evidenceLines(badges);
  const decanContext = getDecanContext(window.decanContextKey);
  const explicitlyRequireLlm = body.require_llm === true ||
    normalizeText(body.require_llm).toLowerCase() === "true";
  const requireLlm = explicitlyRequireLlm;
  const nudgeLlmOptions: NudgeLlmRenderOptions = explicitlyRequireLlm
    ? deps.nudgeLlmOptions ??
      (deps.environment === "test" ? { enabled: false } : {})
    : { enabled: false };
  const reflectionProfile = await reflectionProfileForUser(
    deps.client,
    targetUserId,
  );

  const maturity = resolveGuidanceMaturity({
    badgeCount: badges.length,
    snapshotCount: Math.max(
      1,
      new Set(badges.map((badge) => badge.occurred_on)).size,
    ),
    profile: reflectionProfile as never,
  });
  const gatePolicy = resolveGatePolicyForMaturity(maturity);
  const axisPriors = resolveGraphAxisPriors({
    profile: reflectionProfile as never,
    maturity,
  });
  const snapshot = buildGuidanceSnapshot({
    window,
    decanContext,
    badges,
    gatePolicy,
    axisPriors,
  });
  const matrix = buildOpeningDecisionMatrix({
    profile: reflectionProfile as never,
    snapshot,
  });
  const shapingFingerprint = buildGuidanceShapingFingerprint({
    maturity,
    profile: reflectionProfile as never,
    gatePolicy,
    axisPriors,
    decisionMatrixFingerprint: matrix?.fingerprint ?? null,
  });
  const memoryBrief = buildUserMemoryBrief({
    profile: reflectionProfile as never,
    badges,
    evidencePhrases: previewEvidencePhrases(badges),
    snapshot,
    decanContext,
    decanName: window.decanName,
    decanTheme: window.decanTheme,
    maxEvidencePhrases: 4,
  });

  let text = "";
  let modelVersion = "content-lab-preview";
  let push: Record<string, unknown> = {};
  let guidance: Record<string, unknown> | undefined;
  let reflectionMeta: Record<string, unknown> | undefined;
  let renderDiagnostics: Record<string, unknown> | null = null;

  if (artifact === "decan_reflection" || artifact === "push_preview") {
    try {
      const result =
        await (deps.reflectionGenerator ?? defaultReflectionGenerator)({
          user_id: targetUserId,
          decan_name: window.decanName,
          decan_theme: window.decanTheme ?? null,
          decan_context_key: window.decanContextKey ?? null,
          decan_start: window.start,
          decan_end: window.end,
          include_history: true,
          v2: true,
          persist: false,
          use_knowledge_graph: true,
          use_decision_matrix: true,
          badges: fixtureBadges.length ? fixtureBadges : undefined,
          scheduled_maat_flow_events: fixtureScheduledEvents.length
            ? fixtureScheduledEvents
            : undefined,
          admin_preview: maatFlowFixture || explicitlyRequireLlm
            ? {
              maat_flow_fixture: maatFlowFixture || null,
              maat_flow_fixture_mode: maatFlowFixture ? "isolated" : null,
              maat_flow_evidence_mode: maatFlowFixture ? "fixture_only" : null,
              llm_polish: explicitlyRequireLlm,
              allow_llm_maat_runtime: explicitlyRequireLlm,
            }
            : undefined,
        });
      text = normalizeText(result.reflection) ||
        fallbackReflection(window, badges);
      modelVersion = result.modelUsed ?? "ai_generate_reflection";
      const outputControl = isRecord(result.outputControl)
        ? result.outputControl
        : null;
      const maatFlowDecanPattern = isRecord(
          outputControl?.maatFlowDecanPattern,
        )
        ? outputControl.maatFlowDecanPattern
        : isRecord(outputControl?.maat_flow_decan_pattern)
        ? outputControl.maat_flow_decan_pattern
        : null;
      const maatFlowDoNotSay = Array.isArray(outputControl?.maatFlowDoNotSay)
        ? outputControl.maatFlowDoNotSay
        : Array.isArray(outputControl?.maat_flow_do_not_say)
        ? outputControl.maat_flow_do_not_say
        : [];
      const maatFlowEvidenceMetadata = Array.isArray(
          outputControl?.maatFlowEvidenceMetadata,
        )
        ? outputControl.maatFlowEvidenceMetadata
        : Array.isArray(outputControl?.maat_flow_evidence_metadata)
        ? outputControl.maat_flow_evidence_metadata
        : flowBadgeMetadata(badges);
      renderDiagnostics = reflectionRenderDiagnostics({
        modelUsed: result.modelUsed,
        outputControl,
      });
      const llmFailure = requireLlm
        ? llmRequiredFailure(artifact, renderDiagnostics)
        : null;
      if (llmFailure) {
        return jsonResponse(req, llmFailure, { status: 502 });
      }
      reflectionMeta = {
        badge_count: result.badgeCount ?? badges.length,
        evidence_count: result.evidenceCount ?? evidence.length,
        top_tags: result.topTags ?? [],
        branch: result.branch ?? null,
        render_diagnostics: renderDiagnostics,
        output_control: outputControl,
        maat_flow_decan_pattern: maatFlowDecanPattern,
        maat_flow_do_not_say: maatFlowDoNotSay,
        maat_flow_evidence_metadata: maatFlowEvidenceMetadata,
        admin_preview_fixture: maatFlowFixture
          ? {
            maat_flow_fixture: maatFlowFixture,
            fixture_mode: "isolated",
            evidence_mode: "fixture_only",
            fixture_badge_count: fixtureBadges.length,
            scheduled_event_count: fixtureScheduledEvents.length,
          }
          : null,
      };
    } catch (error) {
      text = fallbackReflection(window, badges);
      modelVersion = "content-lab-fallback";
      renderDiagnostics = reflectionRenderDiagnostics({
        modelUsed: modelVersion,
        outputControl: null,
      });
      renderDiagnostics = {
        ...renderDiagnostics,
        renderer: {
          ...((renderDiagnostics.renderer as Record<string, unknown>) ?? {}),
          fallback_reason: "reflection_generator_error",
          error: serializeError(error),
        },
      };
      const llmFailure = requireLlm
        ? llmRequiredFailure(artifact, renderDiagnostics)
        : null;
      if (llmFailure) {
        return jsonResponse(req, llmFailure, { status: 502 });
      }
      reflectionMeta = {
        error: serializeError(error),
        fallback: true,
        render_diagnostics: renderDiagnostics,
      };
    }
    push = withRenderDiagnostics(
      pushPreviewFor({ artifact: "decan_reflection", text }),
      renderDiagnostics,
    );
  }

  if (artifact === "decan_opening") {
    const requestedDayCard = isRecord(body.day_card)
      ? body.day_card as DayCardGuidanceInput
      : null;
    const profileTimeZone = normalizeTimeZone(
      profile?.timezone as string | null,
    );
    const localDate = clampDateToWindow(
      localDateForTimeZone(profileTimeZone),
      window,
    );
    const dayIndex = decanDayIndex(window.start, localDate);
    const contextDay = decanContext?.decan
      ? (decanContext.decan - 1) * 10 + dayIndex
      : dayIndex;
    const contextDayCard = decanContext?.dayCards.find((card) =>
      card.day === contextDay
    );
    const dayCard = requestedDayCard ?? (contextDayCard
      ? {
        date: localDate,
        maatPrinciple: contextDayCard.theme,
        decanDayAction: contextDayCard.action,
      }
      : null);
    const preview = draftToPreview(
      buildDecanOpeningDraft({
        window,
        decanContext,
        dayCard,
        matrix,
        snapshot,
        memoryBrief,
      }),
      artifact,
    );
    text = preview.text;
    modelVersion = preview.modelVersion;
    push = preview.push;
    guidance = preview.guidance;
  }

  if (artifact === "isfet_nudge") {
    const draft = await renderGuidanceDraftWithLlm(
      buildDriftNudgeDraft({
        snapshot,
        triggerReason: snapshot.hardGates.length
          ? "hard_gate"
          : "admin_preview",
        decisionMatrixFingerprint: matrix?.fingerprint ?? null,
        window,
        maturity,
        memoryBrief,
      }),
      nudgeLlmOptions,
    );
    const preview = draftToPreview(
      draft,
      artifact,
    );
    renderDiagnostics = preview.diagnostics;
    const llmFailure = requireLlm
      ? llmRequiredFailure(artifact, renderDiagnostics)
      : null;
    if (llmFailure) {
      return jsonResponse(req, llmFailure, { status: 502 });
    }
    text = preview.text;
    modelVersion = preview.modelVersion;
    push = preview.push;
    guidance = preview.guidance;
  }

  if (artifact === "maat_nudge") {
    const draft = await renderGuidanceDraftWithLlm(
      buildStrengthNudgeDraft({
        snapshot,
        window,
        decisionMatrixFingerprint: matrix?.fingerprint ?? null,
        maturity,
        memoryBrief,
        triggerReason: "decan_day_5_maat",
        celebrationOnly: true,
      }),
      nudgeLlmOptions,
    );
    const preview = draftToPreview(
      draft,
      artifact,
    );
    renderDiagnostics = preview.diagnostics;
    const llmFailure = requireLlm
      ? llmRequiredFailure(artifact, renderDiagnostics)
      : null;
    if (llmFailure) {
      return jsonResponse(req, llmFailure, { status: 502 });
    }
    text = preview.text;
    modelVersion = preview.modelVersion;
    push = preview.push;
    guidance = preview.guidance;
  }

  const snapshotPayload = sourceSnapshot({
    window,
    periodKey,
    badges,
    profile: reflectionProfile,
    evidence,
    guidance: {
      ...guidance,
      maturity,
      shaping_fingerprint: shapingFingerprint,
      reflection: reflectionMeta ?? null,
      maat_flow_decan_pattern: isRecord(
          reflectionMeta?.maat_flow_decan_pattern,
        )
        ? reflectionMeta?.maat_flow_decan_pattern
        : null,
      maat_flow_do_not_say: Array.isArray(
          reflectionMeta?.maat_flow_do_not_say,
        )
        ? reflectionMeta?.maat_flow_do_not_say
        : [],
      maat_flow_evidence_metadata: Array.isArray(
          reflectionMeta?.maat_flow_evidence_metadata,
        )
        ? reflectionMeta?.maat_flow_evidence_metadata
        : flowBadgeMetadata(badges),
      admin_preview_fixture: reflectionMeta?.admin_preview_fixture ?? null,
      render_diagnostics: renderDiagnostics,
      memory_brief: {
        context_quality: memoryBrief.contextQuality,
        anchor_labels: memoryBrief.anchorLabels,
        tension_labels: memoryBrief.tensionLabels,
        evidence_phrases: memoryBrief.evidencePhrases,
      },
    },
  });

  const { data: evaluation, error } = await insertRow<EvaluationRow>(
    deps.client,
    "admin_content_evaluations",
    {
      artifact,
      mode: "preview",
      status: "draft",
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      window_start: window.start,
      window_end: window.end,
      decan_period_key: periodKey,
      generated_text: text,
      push_preview: push,
      source_snapshot: snapshotPayload,
      model_version: modelVersion,
    },
  );

  if (error) {
    return jsonResponse(req, {
      error: "content_evaluation_insert_failed",
      detail: serializeError(error),
    }, { status: 500 });
  }

  return jsonResponse(req, {
    preview: safeEvaluation(
      evaluation ?? {
        id: crypto.randomUUID(),
        artifact,
        mode: "preview",
        status: "draft",
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        window_start: window.start,
        window_end: window.end,
        decan_period_key: periodKey,
        generated_text: text,
        push_preview: push,
        source_snapshot: snapshotPayload,
        model_version: modelVersion,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ),
    context: {
      profile,
      window,
      evidence: snapshotPayload,
      top_nodes: topNodes(reflectionProfile),
    },
  });
}

function safeEvaluation(row: EvaluationRow) {
  return {
    id: row.id,
    artifact: row.artifact,
    mode: row.mode,
    status: row.status,
    target_user_id: row.target_user_id,
    window_start: row.window_start ?? null,
    window_end: row.window_end ?? null,
    decan_period_key: row.decan_period_key ?? null,
    generated_text: row.generated_text ?? "",
    push_preview: row.push_preview ?? {},
    source_snapshot: row.source_snapshot ?? {},
    model_version: row.model_version ?? null,
    rating: row.rating ?? null,
    feedback_tags: row.feedback_tags ?? [],
    critique_md: row.critique_md ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function buildContextPayload(
  client: HandlerDeps["client"],
  targetUserId: string,
  body: Record<string, unknown>,
) {
  const { window, profile } = await resolveWindow(client, targetUserId, body);
  const periodKey = decanPeriodKey(window);
  const [reflectionProfile, badges, nodes, recent] = await Promise.all([
    reflectionProfileForUser(client, targetUserId),
    collectEvidence(client, targetUserId, window),
    nodeActivity(client, targetUserId),
    recentRows(client, targetUserId),
  ]);
  const snapshots = await safeSelect<MaatSnapshotRow>(
    client,
    "maat_snapshots",
    "id,user_id,window_date,decan_period_key,window_start,window_end,score,band,reflection_move,lead_axis,correction_axes,hard_gates,created_at,updated_at",
  );
  const evidence = evidenceLines(badges);
  const latestSnapshot = snapshotSummary(
    latestSnapshotFor(snapshots, targetUserId, periodKey),
  );
  return {
    profile,
    window,
    decan_period_key: periodKey,
    maat: latestSnapshot,
    recommended_nudge: recommendedNudge(latestSnapshot),
    top_nodes: topNodes(reflectionProfile),
    node_activity: nodes,
    evidence: sourceSnapshot({
      window,
      periodKey,
      badges,
      profile: reflectionProfile,
      evidence,
    }),
    recent,
  };
}

async function saveCritique(
  req: Request,
  deps: ContentLabDeps,
  body: Record<string, unknown>,
  actorUserId: string,
) {
  const evaluationId = clampText(body.evaluation_id ?? body.id, 80);
  if (!evaluationId) {
    return jsonResponse(req, { error: "evaluation_id_required" }, {
      status: 400,
    });
  }
  const ratingRaw = Number(body.rating);
  const rating = Number.isFinite(ratingRaw)
    ? Math.max(1, Math.min(5, Math.round(ratingRaw)))
    : null;
  const status = normalizeText(body.status) || "reviewed";
  const critique = clampText(body.critique_md, 12000);
  const feedbackTags = toStringArray(body.feedback_tags, 24);

  const { data, error } = await updateRow<EvaluationRow>(
    deps.client,
    "admin_content_evaluations",
    evaluationId,
    {
      rating,
      feedback_tags: feedbackTags,
      critique_md: critique || null,
      status,
      updated_by: actorUserId,
    },
  );
  if (error) {
    return jsonResponse(req, {
      error: "content_evaluation_update_failed",
      detail: serializeError(error),
    }, { status: 500 });
  }
  if (!data) {
    return jsonResponse(req, { error: "content_evaluation_not_found" }, {
      status: 404,
    });
  }
  return jsonResponse(req, { evaluation: data ? safeEvaluation(data) : null });
}

function splitGeneratedText(text: string) {
  const parts = text
    .split(/\n\s*\n/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const teaser = parts[0] ?? normalizeText(text);
  const body = parts.join("\n\n") || teaser;
  return {
    teaser: clampText(teaser, 500),
    body: clampText(body, 4000),
  };
}

function guidanceFromEvaluation(row: EvaluationRow) {
  const snapshot = isRecord(row.source_snapshot) ? row.source_snapshot : {};
  const guidance = isRecord(snapshot.guidance) ? snapshot.guidance : {};
  return guidance;
}

async function deliverNudge(
  req: Request,
  deps: ContentLabDeps,
  body: Record<string, unknown>,
  actorUserId: string,
) {
  const evaluationId = clampText(body.evaluation_id ?? body.id, 80);
  if (!evaluationId) {
    return jsonResponse(req, { error: "evaluation_id_required" }, {
      status: 400,
    });
  }
  const rows = await safeSelect<EvaluationRow>(
    deps.client,
    "admin_content_evaluations",
    "id,artifact,mode,status,actor_user_id,target_user_id,window_start,window_end,decan_period_key,generated_text,push_preview,source_snapshot,model_version,rating,feedback_tags,critique_md,created_at,updated_at",
  );
  const evaluation = rows.find((row) => row.id === evaluationId);
  if (!evaluation) {
    return jsonResponse(req, { error: "content_evaluation_not_found" }, {
      status: 404,
    });
  }
  if (
    evaluation.artifact !== "isfet_nudge" &&
    evaluation.artifact !== "maat_nudge"
  ) {
    return jsonResponse(req, { error: "only_nudges_can_be_delivered" }, {
      status: 400,
    });
  }

  const guidance = guidanceFromEvaluation(evaluation);
  const kind = normalizeText(guidance.kind) ||
    (evaluation.artifact === "isfet_nudge" ? "drift_nudge" : "strength_nudge");
  if (kind !== "drift_nudge" && kind !== "strength_nudge") {
    return jsonResponse(req, { error: "invalid_nudge_kind" }, {
      status: 400,
    });
  }
  const periodKey = normalizeText(evaluation.decan_period_key);
  if (!periodKey) {
    return jsonResponse(req, { error: "decan_period_key_required" }, {
      status: 400,
    });
  }

  const existingRows = await safeSelect<DeliveryRow>(
    deps.client,
    "maat_guidance_deliveries",
    "id,user_id,kind,decan_period_key,status,priority,teaser_text,body_text,payload,cta_type,cta_ref,trigger_reason,created_at,updated_at",
  );
  const existing = existingRows.find((row) =>
    row.user_id === evaluation.target_user_id &&
    row.kind === kind &&
    row.decan_period_key === periodKey &&
    ACTIVE_GUIDANCE_STATUSES.has(row.status)
  );
  if (existing) {
    return jsonResponse(req, {
      error: "active_nudge_already_exists",
      delivery: existing,
    }, { status: 409 });
  }

  const text = splitGeneratedText(evaluation.generated_text ?? "");
  const payload = isRecord(guidance.payload) ? guidance.payload : {};
  const { data, error } = await insertRow<DeliveryRow>(
    deps.client,
    "maat_guidance_deliveries",
    {
      user_id: evaluation.target_user_id,
      kind,
      decan_period_key: periodKey,
      status: "pending",
      priority: Number(guidance.priority ?? 100),
      teaser_text: text.teaser,
      body_text: text.body,
      payload: {
        ...payload,
        admin_content_evaluation_id: evaluation.id,
        delivered_by_admin_user_id: actorUserId,
        delivered_from_admin: true,
      },
      cta_type: normalizeText(guidance.cta_type) || "none",
      cta_ref: normalizeText(guidance.cta_ref) || null,
      trigger_reason: normalizeText(guidance.trigger_reason) ||
        "admin_content_lab",
    },
  );
  if (error) {
    const detail = serializeError(error) ?? String(error);
    const errorCode = isRecord(error) && typeof error.code === "string"
      ? error.code
      : "";
    const lowered = detail.toLowerCase();
    if (
      errorCode === "23505" ||
      errorCode === "23514" ||
      lowered.includes("active drift_nudge cap") ||
      lowered.includes("duplicate key")
    ) {
      return jsonResponse(req, {
        error: "active_nudge_already_exists",
        detail,
      }, { status: 409 });
    }
    return jsonResponse(req, {
      error: "nudge_delivery_failed",
      detail,
    }, { status: 500 });
  }
  if (data?.id) {
    await recordMaatRestorationSuggested({
      client: deps.client,
      userId: evaluation.target_user_id,
      decanPeriodKey: periodKey,
      deliveryId: String(data.id),
      deliveryKind: kind,
      ctaType: normalizeText(guidance.cta_type) || "none",
      ctaRef: normalizeText(guidance.cta_ref) || null,
      triggerReason: normalizeText(guidance.trigger_reason) ||
        "admin_content_lab",
      payload: {
        ...payload,
        admin_content_evaluation_id: evaluation.id,
        delivered_by_admin_user_id: actorUserId,
        delivered_from_admin: true,
      },
    });
  }

  return jsonResponse(req, {
    delivery: data,
    evaluation: safeEvaluation(evaluation),
  });
}

export function createAdminContentPreviewHandler(deps: ContentLabDeps) {
  return async function adminContentPreviewHandler(
    req: Request,
  ): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "context";
    const isRead = req.method === "GET" &&
      (action === "context" || action === "evaluations" ||
        action === "list_users");
    const scope = isRead
      ? "product.content.read"
      : action === "save_critique" || action === "deliver_nudge"
      ? "product.content.write"
      : "product.content.test";

    const auth = await requireAdmin(req, deps, {
      scope,
      deniedAction: "content_lab.denied",
      resourceType: "admin_content_evaluation",
      metadata: { action },
    });
    if (auth.ok === false) return auth.response;

    const body = req.method === "GET"
      ? Object.fromEntries(url.searchParams.entries())
      : await readJsonBody(req) as Record<string, unknown> | null;
    const input = isRecord(body) ? body : {};

    try {
      if (req.method === "GET" && action === "list_users") {
        const payload = await listUsersPayload(deps.client, input);
        await writeAudit(req, deps, {
          actorUserId: auth.context.user.id,
          actorRole: auth.context.staff.role,
          action: "content_lab.list_users",
          resourceType: "profile",
          riskLevel: "medium",
          metadata: {
            count: payload.users.length,
            filters: payload.filters,
          },
        });
        return jsonResponse(req, payload);
      }

      if (req.method === "GET" && action === "context") {
        const targetUserId = clampText(input.target_user_id, 80);
        if (!targetUserId) {
          return jsonResponse(req, { error: "target_user_id_required" }, {
            status: 400,
          });
        }
        const context = await buildContextPayload(
          deps.client,
          targetUserId,
          input,
        );
        await writeAudit(req, deps, {
          actorUserId: auth.context.user.id,
          actorRole: auth.context.staff.role,
          action: "content_lab.context",
          resourceType: "profile",
          resourceId: targetUserId,
          riskLevel: "medium",
          metadata: {
            evidence_count: context.evidence.evidence_count,
            decan_period_key: context.decan_period_key,
          },
        });
        return jsonResponse(req, context);
      }

      if (req.method === "GET" && action === "evaluations") {
        const targetUserId = clampText(input.target_user_id, 80);
        const rows = await safeSelect<EvaluationRow>(
          deps.client,
          "admin_content_evaluations",
          "id,artifact,mode,status,actor_user_id,target_user_id,window_start,window_end,decan_period_key,generated_text,push_preview,source_snapshot,model_version,rating,feedback_tags,critique_md,created_at,updated_at",
        );
        const evaluations = rows
          .filter((row) => !targetUserId || row.target_user_id === targetUserId)
          .sort((a, b) =>
            Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "")
          )
          .slice(0, 50)
          .map(safeEvaluation);
        return jsonResponse(req, { evaluations });
      }

      if (req.method === "POST" && action === "generate") {
        const response = await generatePreview(
          req,
          deps,
          input,
          auth.context.user.id,
        );
        await writeAudit(req, deps, {
          actorUserId: auth.context.user.id,
          actorRole: auth.context.staff.role,
          action: "content_lab.generate",
          resourceType: "profile",
          resourceId: clampText(input.target_user_id, 80),
          riskLevel: "medium",
          metadata: {
            artifact: parseArtifact(input.artifact),
            mode: "preview",
          },
        });
        return response;
      }

      if (req.method === "POST" && action === "save_critique") {
        const response = await saveCritique(
          req,
          deps,
          input,
          auth.context.user.id,
        );
        await writeAudit(req, deps, {
          actorUserId: auth.context.user.id,
          actorRole: auth.context.staff.role,
          action: "content_lab.critique",
          resourceType: "admin_content_evaluation",
          resourceId: clampText(input.evaluation_id ?? input.id, 80),
          riskLevel: "medium",
          metadata: {
            rating: Number(input.rating) || null,
            tags: toStringArray(input.feedback_tags, 24),
          },
        });
        return response;
      }

      if (req.method === "POST" && action === "deliver_nudge") {
        const response = await deliverNudge(
          req,
          deps,
          input,
          auth.context.user.id,
        );
        await writeAudit(req, deps, {
          actorUserId: auth.context.user.id,
          actorRole: auth.context.staff.role,
          action: "content_lab.deliver_nudge",
          resourceType: "admin_content_evaluation",
          resourceId: clampText(input.evaluation_id ?? input.id, 80),
          riskLevel: "high",
          metadata: {
            target_user_id: clampText(input.target_user_id, 80) || null,
          },
        });
        return response;
      }

      return jsonResponse(req, { error: "method_or_action_not_allowed" }, {
        status: 405,
      });
    } catch (error) {
      console.error("admin_content_preview error", error);
      return jsonResponse(req, {
        error: "content_lab_failed",
        detail: serializeError(error),
      }, { status: 500 });
    }
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  serve(
    client
      ? createAdminContentPreviewHandler({ client })
      : serverNotConfiguredResponse,
  );
}
