import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  computeCurrentAndNextDecanWindows,
  normalizeTimeZone,
} from "../_shared/decan_schedule.ts";
import { getDecanContext } from "../_shared/decan_context.ts";
import {
  buildDriftNudgeDraft,
  buildGuidanceShapingFingerprint,
  buildGuidanceSnapshot,
  buildOpeningDecisionMatrix,
  buildStrengthNudgeDraft,
  decanDayIndex,
  decanPeriodKey,
  type GuidanceBadgeRow,
  type GuidanceCtaOutcomeSignal,
  type GuidanceDraft,
  type GuidanceGoalProfile,
  type GuidancePersonalBaseline,
  type GuidanceWindow,
  MAAT_GUIDANCE_POLICY_VERSION,
  MAAT_REVIEW_ONLY_HARD_GATES,
  resolveGatePolicyForMaturity,
  resolveGraphAxisPriors,
  resolveGuidanceMaturity,
  shouldCompleteOpenCorrection,
  shouldCreateDriftNudge,
  shouldCreateStrengthNudge,
  snapshotFromRow,
} from "../_shared/maat_guidance.ts";
import { buildUserMemoryBrief } from "../_shared/user_memory_brief.ts";
import type { ReflectionProfileRow } from "../ai_generate_reflection/maat_decision.ts";

function createDefaultClient() {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

type SupabaseClientLike = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error?: unknown;
    }>;
  };
  // Edge tests inject a lightweight table builder; production passes Supabase.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

type Payload = {
  user_id?: string | null;
  timezone?: string | null;
  local_date?: string | null;
  decan_start?: string;
  decan_end?: string;
  decan_name?: string | null;
  decan_theme?: string | null;
  decan_context_key?: string | null;
};

type PersonalizedFlowFlag =
  | boolean
  | ((args: { userId: string }) => boolean | Promise<boolean>);

type CtaOutcomeCohortCandidate = {
  type: string;
  key: string;
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
};

type NutritionItemRow = {
  id: string;
  nutrient: string | null;
  source: string | null;
  purpose: string | null;
  mode: string | null;
  days_of_week: number[] | null;
  decan_days: number[] | null;
  enabled: boolean | null;
  created_at?: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeEnv(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch (_) {
    return null;
  }
}

function truthyFlag(value: string | null) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

async function resolvePersonalizedFlowEnabled(
  userId: string,
  override?: PersonalizedFlowFlag,
) {
  if (typeof override === "boolean") return override;
  if (typeof override === "function") {
    return await override({ userId });
  }
  if (truthyFlag(safeEnv("MAAT_PERSONALIZED_FLOW_ENABLED"))) return true;
  const betaIds = (safeEnv("MAAT_PERSONALIZED_FLOW_BETA_USER_IDS") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return betaIds.includes(userId);
}

function localDateForTimezone(now: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateOnly(value: string) {
  const parts = value.split("-");
  const year = Number(parts[0] ?? "0");
  const month = Number(parts[1] ?? "1");
  const day = Number(parts[2] ?? "1");
  return new Date(Date.UTC(year, month - 1, day));
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

function isoWeekday(date: string) {
  const day = parseDateOnly(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function timezoneRegion(timeZone: string) {
  const region = timeZone.split("/")[0]?.trim();
  return region || "unknown";
}

function ctaOutcomeCohortCandidates(params: {
  maturityLevel: string;
  goalProfile: GuidanceGoalProfile | null;
  timezone: string;
}): CtaOutcomeCohortCandidate[] {
  const candidates: CtaOutcomeCohortCandidate[] = [];
  if (params.goalProfile?.active && params.goalProfile.key) {
    candidates.push({ type: "goal_profile", key: params.goalProfile.key });
  }
  candidates.push({ type: "maturity_level", key: params.maturityLevel });
  candidates.push({
    type: "timezone_region",
    key: timezoneRegion(params.timezone),
  });

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const id = `${candidate.type}:${candidate.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function payloadWindow(body: Payload, timezone: string): GuidanceWindow | null {
  const start = body.decan_start?.trim();
  const end = body.decan_end?.trim();
  if (start && end) {
    return {
      start,
      end,
      decanName: body.decan_name?.trim() || `Decan ${start}`,
      decanTheme: body.decan_theme?.trim() || null,
      decanContextKey: body.decan_context_key?.trim() || null,
    };
  }

  const current = computeCurrentAndNextDecanWindows(new Date(), timezone)[0];
  if (!current) return null;
  return {
    start: current.start,
    end: current.end,
    decanName: current.decanName,
    decanTheme: current.decanTheme,
    decanContextKey: current.decanContextKey,
  };
}

async function fetchStoredBadgeRows(
  client: SupabaseClientLike,
  userId: string,
  window: GuidanceWindow,
) {
  const { data, error } = await client
    .from("journal_badges")
    .select("title,details,tags,occurred_on,flow_id,event_id")
    .eq("user_id", userId)
    .gte("occurred_on", window.start)
    .lte("occurred_on", window.end)
    .order("occurred_on", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GuidanceBadgeRow[];
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

function badgeFromJournalToken(
  token: ReturnType<typeof parseRawBadgeToken>,
  fallbackDate: string,
): GuidanceBadgeRow | null {
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

async function fetchJournalEntryBadges(
  client: SupabaseClientLike,
  userId: string,
  window: GuidanceWindow,
) {
  const { data, error } = await client
    .from("journal_entries")
    .select("id, greg_date, body, meta")
    .eq("user_id", userId)
    .gte("greg_date", window.start)
    .lte("greg_date", window.end)
    .order("greg_date", { ascending: true });
  if (error) throw error;

  const badges: GuidanceBadgeRow[] = [];
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

function plannerStateFromTodoStatus(status: string | null) {
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

function plannerTagsFor(kind: "todo" | "nutrition", state: string) {
  return ["planner", `kind:${kind}`, `state:${state}`];
}

function todoEvidenceTitle(title: string, state: string) {
  const label = normalizeText(title) || "Task";
  if (state === "done") return `Completed to-do: ${label}`;
  if (state === "partial") return `In-progress to-do: ${label}`;
  if (state === "skipped") return `Skipped to-do: ${label}`;
  return `To-do: ${label}`;
}

function todoEvidenceDetails(todo: TodoRow, state: string) {
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
  client: SupabaseClientLike,
  userId: string,
  window: GuidanceWindow,
) {
  const { data, error } = await client
    .from("todos")
    .select("id, title, notes, due_date, status")
    .eq("user_id", userId)
    .gte("due_date", window.start)
    .lte("due_date", window.end)
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

function nutritionCreatedOnOrBefore(item: NutritionItemRow, date: string) {
  if (!item.created_at) return true;
  const createdOn = dateFromMaybeIso(item.created_at, date);
  return date >= createdOn;
}

function nutritionOccursOnDate(
  item: NutritionItemRow,
  date: string,
  window: GuidanceWindow,
) {
  if (item.enabled === false) return false;
  const mode = normalizeText(item.mode).toLowerCase();
  if (mode === "weekday") {
    return (item.days_of_week ?? []).includes(isoWeekday(date));
  }
  if (mode === "decan") {
    return (item.decan_days ?? []).includes(decanDayIndex(window.start, date));
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

async function fetchPendingNutritionEvidence(
  client: SupabaseClientLike,
  userId: string,
  window: GuidanceWindow,
  existingEventIds: Set<string>,
) {
  const { data, error } = await client
    .from("nutrition_items")
    .select(
      "id, nutrient, source, purpose, mode, days_of_week, decan_days, enabled, created_at",
    )
    .eq("user_id", userId)
    .eq("enabled", true);
  if (error) throw error;

  const badges: GuidanceBadgeRow[] = [];
  for (const item of (data ?? []) as NutritionItemRow[]) {
    for (const date of dateKeysInRange(window.start, window.end)) {
      if (!nutritionCreatedOnOrBefore(item, date)) continue;
      if (!nutritionOccursOnDate(item, date, window)) continue;
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

function dedupeBadges(badges: GuidanceBadgeRow[]) {
  const seen = new Set<string>();
  const deduped: GuidanceBadgeRow[] = [];
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
  client: SupabaseClientLike,
  userId: string,
  window: GuidanceWindow,
) {
  const storedBadges = await fetchStoredBadgeRows(client, userId, window);
  const journalBadges = await fetchJournalEntryBadges(
    client,
    userId,
    window,
  ).catch((error) => {
    console.error("maat journal entry badge fetch error", error);
    return [] as GuidanceBadgeRow[];
  });
  const todoBadges = await fetchTodoEvidence(client, userId, window).catch(
    (error) => {
      console.error("maat todo evidence fetch error", error);
      return [] as GuidanceBadgeRow[];
    },
  );

  const mergedBeforeNutrition = dedupeBadges([
    ...journalBadges,
    ...todoBadges,
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
    window,
    existingEventIds,
  ).catch((error) => {
    console.error("maat nutrition evidence fetch error", error);
    return [] as GuidanceBadgeRow[];
  });

  return dedupeBadges([...mergedBeforeNutrition, ...pendingNutritionBadges]);
}

async function fetchReflectionProfile(
  client: SupabaseClientLike,
  userId: string,
) {
  const { data, error } = await client
    .from("reflection_profiles")
    .select(
      "top_nodes,top_edges,dominant_patterns,tension_pairs,maat_score,isfet_risk_score,last_computed_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("reflection profile fetch error", error);
    return null;
  }
  return data as ReflectionProfileRow | null;
}

async function fetchGoalProfile(
  client: SupabaseClientLike,
  userId: string,
): Promise<GuidanceGoalProfile | null> {
  const { data: nutritionRows, error: nutritionError } = await client
    .from("nutrition_items")
    .select("id,nutrient,purpose,enabled")
    .eq("user_id", userId)
    .eq("enabled", true)
    .limit(5);
  if (nutritionError) {
    console.error("maat nutrition goal fetch error", nutritionError);
  }

  const { data: flowRows, error: flowError } = await client
    .from("flows")
    .select("id,name,notes,active,is_hidden")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("is_hidden", false)
    .limit(10);
  if (flowError) {
    console.error("maat flow goal fetch error", flowError);
  }

  const source: string[] = [];
  const axes = new Set<GuidanceGoalProfile["axes"][number]>();
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
}

const EVALUATE_BAND_RANK: Record<string, number> = {
  isfet_patterned: 0,
  leaning_isfet: 1,
  mixed: 2,
  leaning_maat: 3,
  maat: 4,
};

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function refreshPersonalBaseline(
  client: SupabaseClientLike,
  userId: string,
  now: Date,
): Promise<GuidancePersonalBaseline | null> {
  const { data: rows, error } = await client
    .from("maat_snapshots")
    .select("window_date,score,band,dimensions,source")
    .eq("user_id", userId)
    .order("window_date", { ascending: false })
    .limit(90);
  if (error) {
    console.error("maat baseline snapshot fetch error", error);
    return null;
  }

  const snapshots = rows ?? [];
  if (snapshots.length < 10) return null;

  const axisMedians: Record<string, number | null> = {};
  for (const axis of ["T", "M", "H", "V", "J", "S", "E", "R", "C"]) {
    axisMedians[axis] = median(
      snapshots.map((row) => Number(row.dimensions?.[axis])).filter(
        Number.isFinite,
      ),
    );
  }
  const nutritionDoneValues = snapshots
    .map((row) => {
      const source = row.source ?? {};
      const done = Number(source.completed_planner ?? 0);
      const total = Number(source.planner_total ?? 0);
      return total > 0 ? done / total : null;
    })
    .filter((value): value is number => value !== null);

  const baseline: GuidancePersonalBaseline = {
    computedAt: now.toISOString(),
    snapshotCount: snapshots.length,
    medianScore: median(snapshots.map((row) => Number(row.score))),
    medianBandRank: median(
      snapshots
        .map((row) => EVALUATE_BAND_RANK[String(row.band)])
        .filter(Number.isFinite),
    ),
    nutritionDoneRate: median(nutritionDoneValues),
    axisMedians: axisMedians as GuidancePersonalBaseline["axisMedians"],
  };

  const { error: upsertError } = await client
    .from("maat_user_baselines")
    .upsert({
      user_id: userId,
      computed_at: baseline.computedAt,
      stats: {
        snapshot_count: baseline.snapshotCount,
        median_score: baseline.medianScore,
        median_band_rank: baseline.medianBandRank,
        nutrition_done_rate: baseline.nutritionDoneRate,
        axis_medians: baseline.axisMedians,
      },
      updated_at: baseline.computedAt,
    }, { onConflict: "user_id" });
  if (upsertError) {
    console.error("maat baseline upsert error", upsertError);
  }

  return baseline;
}

async function createDelivery(params: {
  client: SupabaseClientLike;
  userId: string;
  periodKey: string;
  draft: GuidanceDraft;
  generationId?: string | null;
}) {
  const { data, error } = await params.client
    .from("maat_guidance_deliveries")
    .insert({
      user_id: params.userId,
      kind: params.draft.kind,
      decan_period_key: params.periodKey,
      status: "pending",
      priority: params.draft.priority,
      teaser_text: params.draft.teaserText,
      body_text: params.draft.bodyText,
      payload: params.draft.payload,
      cta_type: params.draft.ctaType,
      cta_ref: params.draft.ctaRef,
      generation_id: params.generationId ?? null,
      trigger_reason: params.draft.triggerReason,
    })
    .select()
    .single();
  if (error) {
    const message = `${error.code ?? ""} ${error.message ?? ""}`;
    if (message.includes("duplicate") || error.code === "23505") {
      return null;
    }
    if (message.includes("cap reached") || error.code === "23514") {
      return null;
    }
    throw error;
  }
  const payload = params.draft.payload as Record<string, unknown>;
  const flowBrief = payload.flow_brief;
  const briefId = typeof payload.brief_id === "string"
    ? payload.brief_id
    : null;
  if (data && briefId && flowBrief && typeof flowBrief === "object") {
    const { error: briefError } = await params.client
      .from("maat_flow_briefs")
      .upsert({
        user_id: params.userId,
        decan_period_key: params.periodKey,
        delivery_id: (data as { id?: string }).id ?? null,
        brief_id: briefId,
        policy_version: typeof payload.brief_policy_version === "string"
          ? payload.brief_policy_version
          : "maat_flow_brief_v1",
        brief: flowBrief,
        fingerprint: (flowBrief as { fingerprint?: Record<string, unknown> })
          .fingerprint ?? {},
        fallback_template_key: typeof payload.fallback_template_key === "string"
          ? payload.fallback_template_key
          : null,
      });
    if (briefError) {
      console.error("maat flow brief upsert error", briefError);
    }
  }
  return data;
}

async function logMaatChoiceEvent(params: {
  client: SupabaseClientLike;
  userId: string;
  eventType: string;
  metadata: Record<string, unknown>;
}) {
  const { error } = await params.client.from("user_choice_events").insert({
    user_id: params.userId,
    event_type: params.eventType,
    metadata: {
      source: "maat_guidance",
      ...params.metadata,
    },
  });
  if (error) {
    console.error(`maat event insert error:${params.eventType}`, error);
  }
}

async function expireStaleDeliveries(
  client: SupabaseClientLike,
  userId: string,
  currentPeriodKey: string,
) {
  const now = new Date().toISOString();
  const { error } = await client
    .from("maat_guidance_deliveries")
    .update({ status: "expired", expired_at: now })
    .eq("user_id", userId)
    .in("status", ["pending", "shown"])
    .neq("decan_period_key", currentPeriodKey);
  if (error) {
    console.error("evaluate stale delivery expiry error", error);
  }
}

async function fetchCtaOutcomeSignals(
  client: SupabaseClientLike,
  userId: string,
  cohortCandidates: CtaOutcomeCohortCandidate[] = [],
): Promise<{
  source: "user" | "cohort" | "global" | "none";
  cohort: CtaOutcomeCohortCandidate | null;
  signals: GuidanceCtaOutcomeSignal[];
}> {
  const mapRows = (rows: any[] | null | undefined) =>
    (rows ?? []).map((row) => ({
      ctaType: row.cta_type as GuidanceCtaOutcomeSignal["ctaType"],
      ctaRef: row.cta_ref ?? null,
      outcomeFlag: row
        .outcome_flag as GuidanceCtaOutcomeSignal["outcomeFlag"],
      completedWindowCount: Number(row.completed_window_count ?? 0),
      weightedDeltaDoneRate: row.weighted_delta_done_rate === null ||
          row.weighted_delta_done_rate === undefined
        ? null
        : Number(row.weighted_delta_done_rate),
      weightedDeltaSkippedRate: row.weighted_delta_skipped_rate === null ||
          row.weighted_delta_skipped_rate === undefined
        ? null
        : Number(row.weighted_delta_skipped_rate),
    }));

  const { data: userData, error: userError } = await client
    .from("maat_guidance_drift_outcome_flags_user")
    .select(
      "cta_type,cta_ref,outcome_flag,completed_window_count,weighted_delta_done_rate,weighted_delta_skipped_rate",
    )
    .eq("user_id", userId)
    .in("outcome_flag", ["winning", "negative"]);
  if (userError) {
    console.error("maat user outcome flags fetch error", userError);
  }
  const userSignals = userError ? [] : mapRows(userData);
  if (userSignals.length > 0) {
    return { source: "user", cohort: null, signals: userSignals };
  }

  for (const cohort of cohortCandidates) {
    const { data: cohortData, error: cohortError } = await client
      .from("maat_guidance_drift_outcome_flags_cohort")
      .select(
        "cta_type,cta_ref,outcome_flag,completed_window_count,weighted_delta_done_rate,weighted_delta_skipped_rate",
      )
      .eq("cohort_type", cohort.type)
      .eq("cohort_key", cohort.key)
      .in("outcome_flag", ["winning", "negative"]);
    if (cohortError) {
      console.error("maat cohort outcome flags fetch error", cohortError);
      continue;
    }
    const cohortSignals = mapRows(cohortData);
    if (cohortSignals.length > 0) {
      return { source: "cohort", cohort, signals: cohortSignals };
    }
  }

  const { data, error } = await client
    .from("maat_guidance_drift_outcome_flags")
    .select(
      "cta_type,cta_ref,outcome_flag,completed_window_count,weighted_delta_done_rate,weighted_delta_skipped_rate",
    )
    .in("outcome_flag", ["winning", "negative"]);
  if (error) {
    console.error("maat outcome flags fetch error", error);
    return { source: "none", cohort: null, signals: [] };
  }

  const globalSignals = mapRows(data);
  return {
    source: globalSignals.length > 0 ? "global" : "none",
    cohort: null,
    signals: globalSignals,
  };
}

export function createEvaluateMaatGuidanceHandler(options?: {
  client?: SupabaseClientLike;
  now?: () => Date;
  personalizedFlowEnabled?: PersonalizedFlowFlag;
}) {
  const client = options?.client ?? createDefaultClient();
  const nowFn = options?.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const body = await req.json().catch(() => ({})) as Payload;
      const authHeader = req.headers.get("authorization");
      const token = authHeader?.replace("Bearer ", "");
      let user: { id: string } | null = null;
      if (token) {
        const {
          data: { user: authedUser },
          error: userError,
        } = await client.auth.getUser(token);
        if (userError || !authedUser) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        user = authedUser;
      } else {
        const cronSecret = Deno.env.get("MAAT_CRON_SECRET") ??
          Deno.env.get("CRON_SECRET");
        const providedSecret = req.headers.get("x-cron-secret");
        if (!cronSecret || providedSecret !== cronSecret) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        const cronUserId = body.user_id?.trim();
        if (!cronUserId) {
          return jsonResponse({ error: "user_id_required" }, 400);
        }
        user = { id: cronUserId };
      }
      const personalizedFlowEnabled = await resolvePersonalizedFlowEnabled(
        user.id,
        options?.personalizedFlowEnabled,
      );

      const { data: profileRow } = await client
        .from("profiles")
        .select("timezone")
        .eq("id", user.id)
        .maybeSingle();
      const timezone = normalizeTimeZone(
        body.timezone ?? profileRow?.timezone ?? null,
      );
      const now = nowFn();
      const localDate = body.local_date?.trim() || localDateForTimezone(
        now,
        timezone,
      );
      const window = payloadWindow(body, timezone);
      if (!window) {
        return jsonResponse({ error: "No active canonical decan" }, 400);
      }

      const periodKey = decanPeriodKey(window);
      await expireStaleDeliveries(client, user.id, periodKey);

      const badges = await fetchBadges(client, user.id, window);
      const decanContext = getDecanContext(window.decanContextKey);
      const profile = await fetchReflectionProfile(client, user.id);
      const { data: snapshotRows } = await client
        .from("maat_snapshots")
        .select("*")
        .eq("user_id", user.id)
        .eq("decan_period_key", periodKey)
        .order("window_date", { ascending: false })
        .limit(11);
      const priorSnapshotRows = (snapshotRows ?? [])
        .filter((row) => row.window_date !== localDate);
      const goalProfile = await fetchGoalProfile(client, user.id);
      const personalBaseline = await refreshPersonalBaseline(
        client,
        user.id,
        now,
      );
      const maturity = resolveGuidanceMaturity({
        badgeCount: badges.length,
        snapshotCount: priorSnapshotRows.length + 1,
        profile,
        goalProfile,
        personalBaseline,
      });
      const gatePolicy = resolveGatePolicyForMaturity(maturity, goalProfile);
      const axisPriors = resolveGraphAxisPriors({ profile, maturity });
      const snapshot = buildGuidanceSnapshot({
        window,
        decanContext,
        badges,
        gatePolicy,
        axisPriors,
      });
      const memoryBrief = buildUserMemoryBrief({
        profile,
        badges,
        snapshot,
        decanContext,
        decanName: window.decanName,
        decanTheme: window.decanTheme,
      });
      const matrix = buildOpeningDecisionMatrix({ profile, snapshot });
      const shapingFingerprint = buildGuidanceShapingFingerprint({
        maturity,
        profile,
        gatePolicy,
        axisPriors,
        goalProfile,
        personalBaseline,
        decisionMatrixFingerprint: matrix?.fingerprint ?? null,
      });

      const { data: savedSnapshot, error: snapshotError } = await client
        .from("maat_snapshots")
        .upsert({
          user_id: user.id,
          window_date: localDate,
          decan_period_key: periodKey,
          window_start: window.start,
          window_end: window.end,
          dimensions: snapshot.dimensions,
          score: snapshot.score,
          band: snapshot.band,
          reflection_move: snapshot.reflectionMove,
          lead_axis: snapshot.leadAxis,
          correction_axes: snapshot.correctionAxes,
          hard_gates: snapshot.hardGates,
          source: snapshot.source,
        }, { onConflict: "user_id,window_date,decan_period_key" })
        .select()
        .single();
      if (snapshotError) {
        console.error("maat snapshot upsert error", snapshotError);
        return jsonResponse({ error: "Snapshot persist error" }, 500);
      }

      const { data: openCorrectionRows, error: openCorrectionError } =
        await client
          .from("maat_corrections")
          .select("id,status,created_at")
          .eq("user_id", user.id)
          .eq("decan_period_key", periodKey)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(1);
      if (openCorrectionError) {
        console.error("maat correction fetch error", openCorrectionError);
      }

      let openCorrection = openCorrectionRows?.[0] ?? null;
      const correctionPayload = {
        band: snapshot.band,
        reflection_move: snapshot.reflectionMove,
        correction_axes: snapshot.correctionAxes,
        review_only: snapshot.hardGates.length > 0 &&
          snapshot.hardGates.every((gate) =>
            (MAAT_REVIEW_ONLY_HARD_GATES as readonly string[]).includes(gate)
          ),
      };
      const correctionSignal = snapshot.reflectionMove === "correct" ||
        snapshot.hardGates.length > 0;
      if (correctionSignal) {
        if (openCorrection) {
          const { error: updateCorrectionError } = await client
            .from("maat_corrections")
            .update({
              snapshot_id: savedSnapshot.id,
              lead_axis: snapshot.leadAxis,
              hard_gates: snapshot.hardGates,
              payload: correctionPayload,
            })
            .eq("id", openCorrection.id)
            .eq("user_id", user.id);
          if (updateCorrectionError) {
            console.error(
              "maat correction update error",
              updateCorrectionError,
            );
          }
        } else {
          const { data: insertedCorrection, error: insertCorrectionError } =
            await client
              .from("maat_corrections")
              .insert({
                user_id: user.id,
                decan_period_key: periodKey,
                snapshot_id: savedSnapshot.id,
                lead_axis: snapshot.leadAxis,
                hard_gates: snapshot.hardGates,
                payload: correctionPayload,
              })
              .select("id,status,created_at")
              .maybeSingle();
          if (insertCorrectionError) {
            console.error(
              "maat correction insert error",
              insertCorrectionError,
            );
            const { data: refetchedCorrection } = await client
              .from("maat_corrections")
              .select("id,status,created_at")
              .eq("user_id", user.id)
              .eq("decan_period_key", periodKey)
              .eq("status", "open")
              .order("created_at", { ascending: false })
              .limit(1);
            openCorrection = refetchedCorrection?.[0] ?? openCorrection;
          } else {
            openCorrection = insertedCorrection ?? openCorrection;
            if (insertedCorrection?.id) {
              await logMaatChoiceEvent({
                client,
                userId: user.id,
                eventType: "maat_correction_opened",
                metadata: {
                  correction_id: insertedCorrection.id,
                  decan_period_key: periodKey,
                  snapshot_id: savedSnapshot.id,
                  hard_gates: snapshot.hardGates,
                  lead_axis: snapshot.leadAxis,
                },
              });
            }
          }
        }
      }
      let openCorrectionExists = !!openCorrection;

      const { data: deliveryRows } = await client
        .from("maat_guidance_deliveries")
        .select("kind,status,shown_at,created_at")
        .eq("user_id", user.id)
        .eq("decan_period_key", periodKey)
        .order("created_at", { ascending: false });
      const deliveries = deliveryRows ?? [];
      const driftCount = deliveries.filter((row) =>
        row.kind === "drift_nudge"
      ).length;
      const strengthCount = deliveries.filter((row) =>
        row.kind === "strength_nudge"
      ).length;
      const activeDriftExists = deliveries.some((row) =>
        row.kind === "drift_nudge" &&
        (row.status === "pending" || row.status === "shown")
      );
      const opening = deliveries.find((row) => row.kind === "decan_opening");
      const openingHandled = !!opening &&
        ["shown", "dismissed", "opened", "acted", "expired"].includes(
          opening.status,
        );
      const lastDriftAtRaw = deliveries.find((row) =>
        row.kind === "drift_nudge" && row.shown_at
      )?.shown_at;
      const lastDriftAt = lastDriftAtRaw ? new Date(lastDriftAtRaw) : null;

      const snapshots = [
        snapshot,
        ...(priorSnapshotRows
          .map(snapshotFromRow)
          .filter((row): row is typeof snapshot => !!row)),
      ];
      const priorSnapshotRow = priorSnapshotRows[0] ?? null;
      const dayIndex = decanDayIndex(window.start, localDate);
      const outcomeCohortCandidates = ctaOutcomeCohortCandidates({
        maturityLevel: maturity.level,
        goalProfile,
        timezone,
      });
      const ctaOutcomeSignalResult = await fetchCtaOutcomeSignals(
        client,
        user.id,
        outcomeCohortCandidates,
      );
      const ctaOutcomeSignals = ctaOutcomeSignalResult.signals;
      const created: unknown[] = [];
      const suppressed: string[] = [];

      if (
        openCorrectionExists &&
        openCorrection?.id &&
        shouldCompleteOpenCorrection({ snapshots })
      ) {
        const { error: completeCorrectionError } = await client
          .from("maat_corrections")
          .update({
            status: "completed",
            completed_at: now.toISOString(),
          })
          .eq("id", openCorrection.id)
          .eq("user_id", user.id)
          .eq("status", "open");
        if (completeCorrectionError) {
          console.error(
            "maat correction recovery completion error",
            completeCorrectionError,
          );
        } else {
          openCorrectionExists = false;
          suppressed.push("correction:recovered");
          await logMaatChoiceEvent({
            client,
            userId: user.id,
            eventType: "maat_correction_recovered",
            metadata: {
              correction_id: openCorrection.id,
              decan_period_key: periodKey,
              snapshot_id: savedSnapshot.id,
              band: snapshot.band,
              reflection_move: snapshot.reflectionMove,
            },
          });
        }
      }

      const driftDecision = shouldCreateDriftNudge({
        current: snapshot,
        previous: snapshots.slice(1),
        driftCount,
        activeDriftExists,
        confidence: maturity.confidence,
        lastDriftAt,
        openingHandled,
        decanDayIndex: dayIndex,
        now,
        personalBaselineBandRank: maturity.level === "L5"
          ? personalBaseline?.medianBandRank ?? null
          : null,
        reviewOnlyHardGates: [...MAAT_REVIEW_ONLY_HARD_GATES],
      });

      if (driftDecision.create) {
        const draft = buildDriftNudgeDraft({
          snapshot,
          triggerReason: driftDecision.reason,
          decisionMatrixFingerprint: matrix?.fingerprint ?? null,
          window,
          outcomeSignals: ctaOutcomeSignals,
          maturity,
          goalProfile,
          personalBaseline,
          enablePersonalizedFlow: personalizedFlowEnabled,
          memoryBrief,
        });
        const delivery = await createDelivery({
          client,
          userId: user.id,
          periodKey,
          draft,
        });
        if (delivery) created.push(delivery);
      } else {
        suppressed.push(`drift:${driftDecision.reason}`);
      }

      const strengthReady = shouldCreateStrengthNudge({
        snapshots,
        strengthCount,
        driftCount,
        openCorrectionExists,
        decanDayIndex: dayIndex,
        openingHandled,
      });

      if (strengthReady) {
        const draft = buildStrengthNudgeDraft({
          snapshot,
          window,
          decisionMatrixFingerprint: matrix?.fingerprint ?? null,
          outcomeSignals: ctaOutcomeSignals,
          maturity,
          goalProfile,
          personalBaseline,
          enablePersonalizedFlow: personalizedFlowEnabled,
          memoryBrief,
        });
        const delivery = await createDelivery({
          client,
          userId: user.id,
          periodKey,
          draft,
        });
        if (delivery) created.push(delivery);
      } else {
        suppressed.push("strength:not_ready");
      }

      const createdDeliveryIds = created
        .map((row) => (row as { id?: string | null })?.id ?? null)
        .filter((id): id is string => !!id);
      const strengthDecision = {
        create: strengthReady,
        reason: strengthReady ? "sustained_maat_signal" : "not_ready",
      };
      const decision = {
        hard_gates: snapshot.hardGates,
        band: snapshot.band,
        score: snapshot.score,
        reflection_move: snapshot.reflectionMove,
        lead_axis: snapshot.leadAxis,
        correction_axes: snapshot.correctionAxes,
        drift: driftDecision,
        maturity: {
          level: maturity.level,
          label: maturity.label,
          confidence: maturity.confidence,
        },
        goal_profile: goalProfile,
        personal_baseline: personalBaseline,
        gate_policy: {
          g1_regex_enabled: gatePolicy.g1RegexEnabled,
          g4_structural_enabled: gatePolicy.g4StructuralEnabled,
          g5_regex_enabled: gatePolicy.g5RegexEnabled,
          g6_min_skips: gatePolicy.g6MinSkips,
          g6_requires_text: gatePolicy.g6RequiresText,
          g7_regex_enabled: gatePolicy.g7RegexEnabled,
          g8_regex_enabled: gatePolicy.g8RegexEnabled,
        },
        axis_priors: axisPriors,
        cta_outcome_signals: ctaOutcomeSignals,
        cta_outcome_source: ctaOutcomeSignalResult.source,
        cta_outcome_cohort: ctaOutcomeSignalResult.cohort,
        cta_outcome_cohort_candidates: outcomeCohortCandidates,
        personalized_flow_enabled: personalizedFlowEnabled,
        memory_brief: {
          context_quality: memoryBrief.contextQuality,
          anchor_labels: memoryBrief.anchorLabels,
          tension_labels: memoryBrief.tensionLabels,
          evidence_phrases: memoryBrief.evidencePhrases,
        },
        strength: strengthDecision,
        correction: {
          open_before_strength: openCorrectionExists,
          recovered: suppressed.includes("correction:recovered"),
        },
        created_delivery_ids: createdDeliveryIds,
      };
      const evaluationSource = {
        ...snapshot.source,
        policy_version: MAAT_GUIDANCE_POLICY_VERSION,
        maturity_level: maturity.level,
        maturity_label: maturity.label,
        shaping_fingerprint: shapingFingerprint,
        decision,
      };

      const { data: evaluation, error: evaluationError } = await client
        .from("maat_guidance_evaluations")
        .insert({
          user_id: user.id,
          snapshot_id: savedSnapshot.id,
          decan_period_key: periodKey,
          window_date: localDate,
          policy_version: MAAT_GUIDANCE_POLICY_VERSION,
          maturity_level: maturity.level,
          shaping_fingerprint: shapingFingerprint,
          decision,
          suppressed,
          created_delivery_ids: createdDeliveryIds,
        })
        .select("id")
        .maybeSingle();
      if (evaluationError) {
        console.error("maat evaluation insert error", evaluationError);
      }

      const { data: updatedSnapshot, error: sourceUpdateError } = await client
        .from("maat_snapshots")
        .update({ source: evaluationSource })
        .eq("id", savedSnapshot.id)
        .eq("user_id", user.id)
        .select()
        .maybeSingle();
      if (sourceUpdateError) {
        console.error("maat snapshot source update error", sourceUpdateError);
      }

      if (priorSnapshotRow?.band && priorSnapshotRow.band !== snapshot.band) {
        const { error: transitionError } = await client
          .from("maat_band_transitions")
          .insert({
            user_id: user.id,
            evaluation_id: evaluation?.id ?? null,
            snapshot_id: savedSnapshot.id,
            decan_period_key: periodKey,
            from_window_date: priorSnapshotRow.window_date,
            to_window_date: localDate,
            from_band: priorSnapshotRow.band,
            to_band: snapshot.band,
          });
        if (transitionError && transitionError.code !== "23505") {
          console.error("maat band transition insert error", transitionError);
        }
      }

      return jsonResponse({
        local_date: localDate,
        decan_day_index: dayIndex,
        period_key: periodKey,
        snapshot: updatedSnapshot ??
          { ...savedSnapshot, source: evaluationSource },
        created,
        suppressed,
        drift_decision: driftDecision,
        strength_decision: strengthDecision,
        evaluation: {
          id: evaluation?.id ?? null,
          maturity_level: maturity.level,
          policy_version: MAAT_GUIDANCE_POLICY_VERSION,
          decision,
        },
      });
    } catch (err) {
      console.error("evaluate_maat_guidance error", err);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createEvaluateMaatGuidanceHandler());
}
