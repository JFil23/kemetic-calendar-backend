// Edge Function: admin_power_user
// Read-only Phase 1 power-user observatory built from existing data only.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  corsHeaders,
  createServiceClient,
  type HandlerDeps,
  jsonResponse,
  requireAdmin,
  serializeError,
  serverNotConfiguredResponse,
  writeAudit,
} from "../_shared/admin.ts";

type Row = Record<string, unknown>;

const VALID_DAYS = new Set([7, 30, 90]);
const DEFAULT_DAYS = 30;
const DEFAULT_QUERY_LIMIT = 5_000;
const HIGH_VOLUME_QUERY_LIMIT = 10_000;
const STATIC_QUERY_LIMIT = 2_000;
const LOAD_TIMEOUT_MS = 8_500;

const LIMITATIONS = [
  "No stable session IDs yet; sessions are inferred from app_open, screen_view, and timestamp proximity.",
  "screen_view paths are route-level only and require dashboard-side surface normalization.",
  "Voluntary versus onboarding-forced behavior is imperfect until mobile events carry explicit source context.",
  "Small tester cohorts are noisy; treat directional changes as prompts for review, not proof.",
  "Emotional relief is inferred from return, save, continue, reflect, and act signals, not directly measured.",
];

const TABLE_COLUMNS: Record<string, string> = {
  profiles:
    "id,email,display_name,handle,timezone,telemetry_enabled,onboarding_completed_at,created_at,updated_at",
  app_events: "id,user_id,event,properties,source,created_at",
  user_choice_events:
    "id,user_id,event_type,node_id,flow_id,journal_entry_id,reflection_entry_id,metadata,created_at",
  nodes: "id,slug,title,glyph,updated_at",
  flows:
    "id,user_id,name,origin_type,origin_flow_id,origin_share_id,origin_generation_id,is_hidden,is_reminder,is_saved,ai_metadata,created_at,updated_at",
  flow_saves: "id,user_id,flow_id,saved_from,saved_at,metadata",
  flow_shares:
    "id,flow_id,sender_id,recipient_id,channel,created_at,viewed_at,imported_at,status,deleted_at",
  event_shares:
    "id,event_id,sender_id,recipient_id,channel,created_at,viewed_at,imported_at,status,response_status,deleted_at",
  user_event_completions:
    "id,user_id,client_event_id,flow_id,completed_on,completed_at,source,metadata",
  journal_entries:
    "id,user_id,greg_date,entry_type,flow_id,category,created_at,updated_at",
  journal_badges:
    "id,user_id,entry_id,badge_id,tags,occurred_on,flow_id,event_id,created_at",
  user_library_node_progress:
    "id,user_id,node_id,progress_percent,last_read_at,completed_at,bookmarked_at,created_at,updated_at",
  node_insight_entries: "id,user_id,node_id,entry_date,created_at,updated_at",
  flow_posts: "id,user_id,flow_id,is_hidden,created_at",
  flow_post_likes: "id,flow_post_id,user_id,created_at",
  flow_post_comments: "id,flow_post_id,user_id,parent_comment_id,created_at",
  shared_practice_rooms:
    "id,calendar_id,source_flow_id,shared_flow_id,created_by,title,flow_key,status,created_at,updated_at",
  shared_practice_entries:
    "id,room_id,user_id,client_event_id,flow_id,completed_on,completion_status,visibility,moderation_status,created_at,updated_at",
  shared_practice_presence:
    "room_id,user_id,client_event_id,opened_on,created_at",
  reading_house_shared_fragments:
    "id,calendar_id,flow_id,client_event_id,event_number,author_id,created_at,updated_at,deleted_at",
  decan_reflections:
    "id,user_id,decan_key,decan_name,decan_start,decan_end,badge_count,created_at",
  maat_guidance_deliveries:
    "id,user_id,kind,decan_period_key,status,priority,cta_type,cta_ref,trigger_reason,shown_at,dismissed_at,opened_at,acted_at,expired_at,created_at,updated_at,payload",
  maat_guidance_evaluations:
    "id,user_id,snapshot_id,decan_period_key,window_date,policy_version,maturity_level,suppressed,created_delivery_ids,created_at",
  admin_content_evaluations:
    "id,artifact,mode,status,actor_user_id,target_user_id,window_start,window_end,decan_period_key,model_version,rating,feedback_tags,created_at,updated_at",
  daily_orientation:
    "user_id,local_date,entry_state,chosen_return,landing_status,evening_reflection_status,status,completed_at,created_at,updated_at",
};

type TableQueryConfig = {
  limit: number;
  dateColumn?: string;
  orderColumn?: string;
  orFilter?: (sinceIso: string) => string;
};

const TABLE_QUERY: Record<string, TableQueryConfig> = {
  profiles: { limit: DEFAULT_QUERY_LIMIT, orderColumn: "updated_at" },
  app_events: {
    limit: HIGH_VOLUME_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  user_choice_events: {
    limit: HIGH_VOLUME_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  nodes: { limit: STATIC_QUERY_LIMIT, orderColumn: "updated_at" },
  flows: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  flow_saves: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "saved_at",
    orderColumn: "saved_at",
  },
  flow_shares: {
    limit: DEFAULT_QUERY_LIMIT,
    orderColumn: "created_at",
    orFilter: (sinceIso) =>
      `created_at.gte.${sinceIso},viewed_at.gte.${sinceIso},imported_at.gte.${sinceIso}`,
  },
  event_shares: {
    limit: DEFAULT_QUERY_LIMIT,
    orderColumn: "created_at",
    orFilter: (sinceIso) =>
      `created_at.gte.${sinceIso},viewed_at.gte.${sinceIso},imported_at.gte.${sinceIso}`,
  },
  user_event_completions: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "completed_at",
    orderColumn: "completed_at",
  },
  journal_entries: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  journal_badges: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  user_library_node_progress: {
    limit: DEFAULT_QUERY_LIMIT,
    orderColumn: "updated_at",
    orFilter: (sinceIso) =>
      `last_read_at.gte.${sinceIso},bookmarked_at.gte.${sinceIso},completed_at.gte.${sinceIso},updated_at.gte.${sinceIso}`,
  },
  node_insight_entries: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  flow_posts: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  flow_post_likes: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  flow_post_comments: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  shared_practice_rooms: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  shared_practice_entries: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  shared_practice_presence: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  reading_house_shared_fragments: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  decan_reflections: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  maat_guidance_deliveries: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  maat_guidance_evaluations: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  admin_content_evaluations: {
    limit: DEFAULT_QUERY_LIMIT,
    dateColumn: "created_at",
    orderColumn: "created_at",
  },
  daily_orientation: {
    limit: DEFAULT_QUERY_LIMIT,
    orderColumn: "updated_at",
    orFilter: (sinceIso) =>
      `completed_at.gte.${sinceIso},created_at.gte.${sinceIso},updated_at.gte.${sinceIso}`,
  },
};

function parseDays(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("days") ?? DEFAULT_DAYS);
  return VALID_DAYS.has(raw) ? raw : DEFAULT_DAYS;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Row {
  return isRecord(value) ? value : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function timestampMs(value: unknown) {
  const raw = text(value);
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function dateKey(value: unknown) {
  const ms = timestampMs(value);
  return ms ? isoDate(new Date(ms)) : "";
}

function inRange(row: Row, sinceMs: number, key = "created_at") {
  const ms = timestampMs(row[key]);
  return ms >= sinceMs;
}

function compactId(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  return raw.length > 12 ? `${raw.slice(0, 8)}...${raw.slice(-4)}` : raw;
}

function uniqueCount(values: Iterable<unknown>) {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (normalized) set.add(normalized);
  }
  return set.size;
}

function countRows(rows: Row[], sinceMs: number, key = "created_at") {
  return rows.filter((row) => inRange(row, sinceMs, key)).length;
}

function countUsers(rows: Row[], sinceMs: number, key = "created_at") {
  return uniqueCount(
    rows
      .filter((row) => inRange(row, sinceMs, key))
      .map((row) => row.user_id),
  );
}

function routeFromEvent(row: Row) {
  const props = record(row.properties);
  return text(props.route) || text(props.screen) || text(props.path) || "/";
}

function surfaceFromRoute(routeValue: unknown) {
  const route = text(routeValue).toLowerCase();
  if (!route || route === "/") return "Day View";
  if (route.includes("maat-guidance") || route.includes("reflection")) {
    return "Reflections / Guidance";
  }
  if (route.includes("library") || route.includes("node")) return "Library";
  if (route.includes("commons") || route.includes("shared-practice")) {
    return "Commons / Shared Practice";
  }
  if (route.includes("flow")) return "Flows";
  if (route.includes("calendar")) return "Calendar";
  if (route.includes("journal")) return "Journal";
  if (route.includes("profile") || route.includes("glyph")) {
    return "Profile / Glyph";
  }
  if (
    route.includes("inbox") || route.includes("share") || route.includes("dm")
  ) {
    return "Inbox / Sharing";
  }
  if (
    route.includes("rhythm") || route.includes("today") || route.includes("day")
  ) {
    return "Day View";
  }
  if (route.includes("settings")) return "Settings";
  return "Other";
}

function surfaceFromChoice(eventType: unknown) {
  const event = text(eventType);
  if (event.startsWith("node_")) return "Library";
  if (event.startsWith("reflection_") || event.startsWith("maat_correction_")) {
    return "Reflections / Guidance";
  }
  if (event.startsWith("flow_")) return "Flows";
  if (event.startsWith("checklist_") || event.startsWith("todo_")) {
    return "Day View";
  }
  if (event.startsWith("suggestion_")) return "Reflections / Guidance";
  if (event === "cycle_field_saved") return "Rhythm";
  return "Other";
}

function groupIncrement(
  groups: Map<string, Row>,
  key: string,
  patch: Row = {},
) {
  const row = groups.get(key) ?? { key, count: 0, users: new Set<string>() };
  row.count = numberValue(row.count) + 1;
  for (const [patchKey, patchValue] of Object.entries(patch)) {
    if (patchValue !== undefined && patchValue !== null && patchValue !== "") {
      row[patchKey] = patchValue;
    }
  }
  groups.set(key, row);
  return row;
}

function groupRows(groups: Map<string, Row>, limit = 12) {
  return [...groups.values()]
    .map((row) => {
      const users = row.users instanceof Set ? row.users.size : row.users;
      const cleaned: Row = { ...row, users };
      delete cleaned.key;
      return cleaned;
    })
    .sort((a, b) => numberValue(b.count) - numberValue(a.count))
    .slice(0, limit);
}

type QueryLike = PromiseLike<{ data: Row[] | null; error: unknown | null }> & {
  gte?: (column: string, value: string) => QueryLike;
  limit?: (count: number) => QueryLike;
  or?: (filters: string) => QueryLike;
  order?: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) => QueryLike;
};

class PowerUserTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PowerUserTimeoutError";
  }
}

function isTimeoutError(error: unknown) {
  return error instanceof PowerUserTimeoutError ||
    (error instanceof Error && error.name === "PowerUserTimeoutError");
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new PowerUserTimeoutError(
          `${label} exceeded ${Math.round(ms / 1000)}s.`,
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function safeSelect(
  client: HandlerDeps["client"],
  table: string,
  sinceIso: string,
) {
  const selected = client.from(table).select?.(TABLE_COLUMNS[table] ?? "*");
  if (!selected) return [];
  const config = TABLE_QUERY[table] ?? { limit: DEFAULT_QUERY_LIMIT };
  let query = selected as QueryLike;

  if (config.orFilter && typeof query.or === "function") {
    query = query.or(config.orFilter(sinceIso));
  } else if (config.dateColumn && typeof query.gte === "function") {
    query = query.gte(config.dateColumn, sinceIso);
  }
  if (config.orderColumn && typeof query.order === "function") {
    query = query.order(config.orderColumn, {
      ascending: false,
      nullsFirst: false,
    });
  }
  if (typeof query.limit === "function") {
    query = query.limit(config.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.warn(
      `admin_power_user ${table} select skipped`,
      serializeError(error),
    );
    return [];
  }
  return data ?? [];
}

async function loadData(client: HandlerDeps["client"], sinceIso: string) {
  const entries = await Promise.all(
    Object.keys(TABLE_COLUMNS).map(async (table) =>
      [table, await safeSelect(client, table, sinceIso)] as const
    ),
  );
  return Object.fromEntries(entries) as Record<string, Row[]>;
}

function makeProfileMaps(profiles: Row[]) {
  const byId = new Map<string, Row>();
  const telemetryEnabled = new Set<string>();
  for (const profile of profiles) {
    const id = text(profile.id);
    if (!id) continue;
    byId.set(id, profile);
    if (profile.telemetry_enabled !== false) telemetryEnabled.add(id);
  }
  return { byId, telemetryEnabled };
}

function filterTelemetry(rows: Row[], enabledUsers: Set<string>) {
  return rows.filter((row) => {
    const userId = text(row.user_id);
    return userId && enabledUsers.has(userId);
  });
}

function dailyActiveUsers(appEvents: Row[], sinceMs: number) {
  const byUser = new Map<string, Set<string>>();
  for (const row of appEvents) {
    if (!inRange(row, sinceMs)) continue;
    const userId = text(row.user_id);
    const day = dateKey(row.created_at);
    if (!userId || !day) continue;
    const days = byUser.get(userId) ?? new Set<string>();
    days.add(day);
    byUser.set(userId, days);
  }
  return byUser;
}

function postOnboardingReturns(
  profiles: Row[],
  appEvents: Row[],
  sinceMs: number,
) {
  const profileById = new Map(profiles.map((row) => [text(row.id), row]));
  const returned = new Set<string>();
  const active = new Set<string>();
  for (const row of appEvents) {
    if (!inRange(row, sinceMs)) continue;
    const userId = text(row.user_id);
    const profile = profileById.get(userId);
    const completedAt = timestampMs(profile?.onboarding_completed_at);
    const eventAt = timestampMs(row.created_at);
    if (!userId || !completedAt || !eventAt || eventAt <= completedAt) continue;
    active.add(userId);
    if (dateKey(row.created_at) > isoDate(new Date(completedAt))) {
      returned.add(userId);
    }
  }
  return { active: active.size, returned: returned.size };
}

function flowKey(row: Row) {
  const meta = record(row.ai_metadata);
  return text(meta.flow_key) || text(meta.template_key) ||
    (text(row.origin_type) === "template" ? "template_flow" : "");
}

function flowLabel(row: Row | undefined, id: unknown) {
  const key = row ? flowKey(row) : "";
  if (key) return key;
  return `private-flow-${text(id) || "unknown"}`;
}

function nodeLabel(
  nodesById: Map<string, Row>,
  nodeId: unknown,
  fallback?: unknown,
) {
  const rawId = text(nodeId);
  const node = nodesById.get(rawId);
  return text(node?.title) || text(node?.slug) || text(fallback) || rawId ||
    "unknown-node";
}

function buildExploration(params: {
  appEvents: Row[];
  choiceEvents: Row[];
  sinceMs: number;
}) {
  const screenViews = params.appEvents.filter((row) =>
    inRange(row, params.sinceMs) && text(row.event) === "screen_view"
  );
  const surfaceGroups = new Map<string, Row>();
  const userRoutes = new Map<string, Row[]>();

  for (const row of screenViews) {
    const userId = text(row.user_id);
    const route = routeFromEvent(row);
    const surface = surfaceFromRoute(route);
    const group = groupIncrement(surfaceGroups, surface, {
      surface,
      route_examples: [],
    });
    (group.users as Set<string>).add(userId);
    const examples = array(group.route_examples) as string[];
    if (route && !examples.includes(route) && examples.length < 4) {
      group.route_examples = [...examples, route];
    }
    if (userId) {
      userRoutes.set(userId, [...(userRoutes.get(userId) ?? []), row]);
    }
  }

  const transitionGroups = new Map<string, Row>();
  for (const [userId, rows] of userRoutes.entries()) {
    const ordered = rows.sort((a, b) =>
      timestampMs(a.created_at) - timestampMs(b.created_at)
    );
    for (let i = 1; i < ordered.length; i += 1) {
      const from = surfaceFromRoute(routeFromEvent(ordered[i - 1]));
      const to = surfaceFromRoute(routeFromEvent(ordered[i]));
      if (from === to) continue;
      const group = groupIncrement(transitionGroups, `${from}->${to}`, {
        from_surface: from,
        to_surface: to,
      });
      (group.users as Set<string>).add(userId);
    }
  }

  const choiceSurfaceGroups = new Map<string, Row>();
  for (
    const row of params.choiceEvents.filter((item) =>
      inRange(item, params.sinceMs)
    )
  ) {
    const userId = text(row.user_id);
    const surface = surfaceFromChoice(row.event_type);
    const group = groupIncrement(choiceSurfaceGroups, surface, { surface });
    (group.users as Set<string>).add(userId);
  }

  return {
    screen_views: screenViews.length,
    screen_view_users: uniqueCount(screenViews.map((row) => row.user_id)),
    route_level_only: true,
    surfaces: groupRows(surfaceGroups),
    choice_surfaces: groupRows(choiceSurfaceGroups),
    transitions: groupRows(transitionGroups, 10),
  };
}

function buildContentPerformance(data: Record<string, Row[]>, sinceMs: number) {
  const nodesById = new Map<string, Row>();
  for (const node of data.nodes) {
    const id = text(node.id);
    if (id) nodesById.set(id, node);
  }
  const nodeGroups = new Map<string, Row>();

  for (
    const row of data.user_choice_events.filter((item) =>
      inRange(item, sinceMs) && text(item.event_type).startsWith("node_")
    )
  ) {
    const label = nodeLabel(
      nodesById,
      row.node_id,
      record(row.metadata).node_slug,
    );
    const group = groupIncrement(nodeGroups, label, {
      label,
      node_id: compactId(row.node_id),
    });
    group.node_events = numberValue(group.node_events) + 1;
    (group.users as Set<string>).add(text(row.user_id));
  }

  for (
    const row of data.node_insight_entries.filter((item) =>
      inRange(item, sinceMs)
    )
  ) {
    const label = nodeLabel(nodesById, row.node_id);
    const group = groupIncrement(nodeGroups, label, {
      label,
      node_id: compactId(row.node_id),
    });
    group.insights = numberValue(group.insights) + 1;
    (group.users as Set<string>).add(text(row.user_id));
  }

  for (const row of data.user_library_node_progress) {
    const nodeId = text(row.node_id);
    if (!nodeId) continue;
    const touched = [
      ["reads", row.last_read_at],
      ["bookmarks", row.bookmarked_at],
      ["completions", row.completed_at],
    ] as const;
    for (const [field, at] of touched) {
      if (timestampMs(at) < sinceMs) continue;
      const label = nodeLabel(nodesById, nodeId);
      const group = groupIncrement(nodeGroups, label, {
        label,
        node_id: compactId(nodeId),
      });
      group[field] = numberValue(group[field]) + 1;
      (group.users as Set<string>).add(text(row.user_id));
    }
  }

  const flowsById = new Map(data.flows.map((flow) => [String(flow.id), flow]));
  const flowGroups = new Map<string, Row>();
  const addFlow = (flowId: unknown, field: string, userId: unknown) => {
    const id = text(flowId);
    const flow = flowsById.get(id);
    const label = flowLabel(flow, id);
    const group = groupIncrement(flowGroups, label, {
      label,
      flow_id: compactId(id),
    });
    group[field] = numberValue(group[field]) + 1;
    (group.users as Set<string>).add(text(userId));
  };

  for (
    const row of data.user_event_completions.filter((item) =>
      inRange(item, sinceMs, "completed_at")
    )
  ) addFlow(row.flow_id, "completions", row.user_id);
  for (
    const row of data.flow_saves.filter((item) =>
      inRange(item, sinceMs, "saved_at")
    )
  ) addFlow(row.flow_id, "saves", row.user_id);
  for (
    const row of data.flow_shares.filter((item) =>
      inRange(item, sinceMs) && !item.deleted_at
    )
  ) addFlow(row.flow_id, "shares", row.sender_id);
  for (
    const row of data.flow_posts.filter((item) =>
      inRange(item, sinceMs) && item.is_hidden !== true
    )
  ) addFlow(row.flow_id, "commons_posts", row.user_id);

  return {
    nodes: groupRows(nodeGroups, 15),
    flows: groupRows(flowGroups, 15),
    commons: {
      flow_posts: countRows(data.flow_posts, sinceMs),
      flow_post_likes: countRows(data.flow_post_likes, sinceMs),
      flow_post_comments: countRows(data.flow_post_comments, sinceMs),
      shared_practice_rooms: countRows(data.shared_practice_rooms, sinceMs),
      shared_practice_entries: countRows(data.shared_practice_entries, sinceMs),
      shared_practice_presence: countRows(
        data.shared_practice_presence,
        sinceMs,
      ),
      reading_house_fragments: countRows(
        data.reading_house_shared_fragments.filter((row) => !row.deleted_at),
        sinceMs,
      ),
    },
  };
}

function buildGuidanceSummary(data: Record<string, Row[]>, sinceMs: number) {
  const deliveryRows = data.maat_guidance_deliveries.filter((row) =>
    inRange(row, sinceMs)
  );
  const byStatus = new Map<string, Row>();
  const byKind = new Map<string, Row>();
  for (const row of deliveryRows) {
    const status = text(row.status) || "unknown";
    const kind = text(row.kind) || "unknown";
    (groupIncrement(byStatus, status, { status }).users as Set<string>).add(
      text(row.user_id),
    );
    (groupIncrement(byKind, kind, { kind }).users as Set<string>).add(
      text(row.user_id),
    );
  }

  const contentRows = data.admin_content_evaluations.filter((row) =>
    inRange(row, sinceMs)
  );
  const ratings = contentRows
    .map((row) => Number(row.rating))
    .filter((value) => Number.isFinite(value));

  return {
    deliveries_total: deliveryRows.length,
    delivered_users: uniqueCount(deliveryRows.map((row) => row.user_id)),
    shown: deliveryRows.filter((row) => !!row.shown_at).length,
    opened: deliveryRows.filter((row) => !!row.opened_at).length,
    acted: deliveryRows.filter((row) => !!row.acted_at).length,
    dismissed: deliveryRows.filter((row) => !!row.dismissed_at).length,
    expired: deliveryRows.filter((row) => !!row.expired_at).length,
    by_status: groupRows(byStatus),
    by_kind: groupRows(byKind),
    guidance_evaluations: countRows(data.maat_guidance_evaluations, sinceMs),
    content_previews: contentRows.length,
    content_critiques:
      contentRows.filter((row) => row.status && row.status !== "draft").length,
    average_content_rating: ratings.length
      ? Number(
        (ratings.reduce((sum, value) => sum + value, 0) / ratings.length)
          .toFixed(2),
      )
      : null,
    decan_reflections_generated: countRows(data.decan_reflections, sinceMs),
  };
}

function buildStickiness(
  data: Record<string, Row[]>,
  appEvents: Row[],
  choiceEvents: Row[],
  sinceMs: number,
) {
  return {
    flow_saves: countRows(data.flow_saves, sinceMs, "saved_at"),
    flow_save_users: countUsers(data.flow_saves, sinceMs, "saved_at"),
    flow_import_events:
      appEvents.filter((row) =>
        inRange(row, sinceMs) && text(row.event) === "flow_imported"
      ).length,
    flow_imported_shares:
      data.flow_shares.filter((row) => timestampMs(row.imported_at) >= sinceMs)
        .length,
    event_imported_shares:
      data.event_shares.filter((row) => timestampMs(row.imported_at) >= sinceMs)
        .length,
    flow_shares_created: countRows(data.flow_shares, sinceMs),
    event_shares_created: countRows(data.event_shares, sinceMs),
    flow_completions: countRows(
      data.user_event_completions,
      sinceMs,
      "completed_at",
    ),
    flow_completed_choice_events:
      choiceEvents.filter((row) =>
        inRange(row, sinceMs) && text(row.event_type) === "flow_completed"
      ).length,
    flow_skipped_choice_events:
      choiceEvents.filter((row) =>
        inRange(row, sinceMs) && text(row.event_type) === "flow_skipped"
      ).length,
    journal_entries: countRows(data.journal_entries, sinceMs),
    journal_badges: countRows(data.journal_badges, sinceMs),
    reflection_saves:
      choiceEvents.filter((row) =>
        inRange(row, sinceMs) && text(row.event_type) === "reflection_saved"
      ).length,
    decan_reflections: countRows(data.decan_reflections, sinceMs),
    library_bookmarks:
      data.user_library_node_progress.filter((row) =>
        timestampMs(row.bookmarked_at) >= sinceMs
      ).length,
    library_completions:
      data.user_library_node_progress.filter((row) =>
        timestampMs(row.completed_at) >= sinceMs
      ).length,
    day_orientation_completed:
      data.daily_orientation.filter((row) =>
        timestampMs(row.completed_at) >= sinceMs
      ).length,
    commons_posts: countRows(data.flow_posts, sinceMs),
    commons_comments: countRows(data.flow_post_comments, sinceMs),
    commons_likes: countRows(data.flow_post_likes, sinceMs),
    shared_practice_entries: countRows(data.shared_practice_entries, sinceMs),
  };
}

function buildHook(
  data: Record<string, Row[]>,
  appEvents: Row[],
  sinceMs: number,
) {
  const activeDays = dailyActiveUsers(appEvents, sinceMs);
  const multiDayUsers = [...activeDays.entries()].filter(([, days]) =>
    days.size >= 2
  );
  const appOpenRows = appEvents.filter((row) =>
    inRange(row, sinceMs) && text(row.event) === "app_open"
  );
  const postOnboarding = postOnboardingReturns(
    data.profiles,
    appEvents,
    sinceMs,
  );
  const onboardingCompleted = data.profiles.filter((row) =>
    timestampMs(row.onboarding_completed_at) >= sinceMs
  );

  return {
    active_users: activeDays.size,
    active_days_total: [...activeDays.values()].reduce(
      (sum, days) => sum + days.size,
      0,
    ),
    returning_users_approx: multiDayUsers.length,
    app_opens: appOpenRows.length,
    app_open_users: uniqueCount(appOpenRows.map((row) => row.user_id)),
    onboarding_completed: onboardingCompleted.length,
    post_onboarding_active_users: postOnboarding.active,
    post_onboarding_return_users_approx: postOnboarding.returned,
    first_flow_started:
      data.flows.filter((row) =>
        inRange(row, sinceMs) && row.is_hidden !== true &&
        row.is_reminder !== true
      ).length,
    first_node_or_library_action_users: uniqueCount(
      data.user_choice_events
        .filter((row) =>
          inRange(row, sinceMs) &&
          ["node_opened", "node_link_tapped", "node_insight_saved"].includes(
            text(row.event_type),
          )
        )
        .map((row) => row.user_id),
    ),
  };
}

function buildTimeline(
  data: Record<string, Row[]>,
  userId: string,
  sinceMs: number,
) {
  if (!userId) return null;
  const items: Row[] = [];

  const pushItem = (
    at: unknown,
    type: string,
    surface: string,
    detail: Row = {},
  ) => {
    const ms = timestampMs(at);
    if (!ms || ms < sinceMs) return;
    items.push({
      at: new Date(ms).toISOString(),
      type,
      surface,
      ...detail,
    });
  };

  for (
    const row of data.app_events.filter((item) => text(item.user_id) === userId)
  ) {
    const event = text(row.event);
    const route = event === "screen_view" ? routeFromEvent(row) : "";
    pushItem(
      row.created_at,
      event || "app_event",
      route ? surfaceFromRoute(route) : "App",
      {
        route: route || undefined,
        source: text(row.source) || undefined,
      },
    );
  }

  for (
    const row of data.user_choice_events.filter((item) =>
      text(item.user_id) === userId
    )
  ) {
    const eventType = text(row.event_type);
    pushItem(
      row.created_at,
      eventType || "choice_event",
      surfaceFromChoice(eventType),
      {
        node_id: compactId(row.node_id),
        flow_id: compactId(row.flow_id),
        reflection_id: compactId(row.reflection_entry_id),
      },
    );
  }

  for (
    const row of data.flows.filter((item) => text(item.user_id) === userId)
  ) {
    pushItem(row.created_at, "flow_created", "Flows", {
      flow_id: compactId(row.id),
      flow_key: flowKey(row) || undefined,
      origin_type: text(row.origin_type) || "manual",
    });
  }
  for (
    const row of data.flow_saves.filter((item) => text(item.user_id) === userId)
  ) {
    pushItem(row.saved_at, "flow_saved", "Flows", {
      flow_id: compactId(row.flow_id),
      saved_from: text(row.saved_from) || undefined,
    });
  }
  for (
    const row of data.user_event_completions.filter((item) =>
      text(item.user_id) === userId
    )
  ) {
    pushItem(row.completed_at, "event_completed", "Day View", {
      flow_id: compactId(row.flow_id),
      completed_on: text(row.completed_on),
    });
  }
  for (
    const row of data.journal_entries.filter((item) =>
      text(item.user_id) === userId
    )
  ) {
    pushItem(row.created_at, "journal_entry_created", "Journal", {
      greg_date: text(row.greg_date),
      entry_type: text(row.entry_type),
      category: text(row.category) || undefined,
    });
  }
  for (
    const row of data.user_library_node_progress.filter((item) =>
      text(item.user_id) === userId
    )
  ) {
    pushItem(
      row.last_read_at ?? row.updated_at,
      "library_progress",
      "Library",
      {
        node_id: text(row.node_id),
        progress_percent: numberValue(row.progress_percent),
        bookmarked: !!row.bookmarked_at,
        completed: !!row.completed_at,
      },
    );
  }
  for (
    const row of data.shared_practice_entries.filter((item) =>
      text(item.user_id) === userId
    )
  ) {
    pushItem(
      row.created_at,
      "shared_practice_entry",
      "Commons / Shared Practice",
      {
        completion_status: text(row.completion_status),
        visibility: text(row.visibility),
      },
    );
  }
  for (
    const row of data.maat_guidance_deliveries.filter((item) =>
      text(item.user_id) === userId
    )
  ) {
    pushItem(
      row.created_at,
      "guidance_delivery_created",
      "Reflections / Guidance",
      {
        kind: text(row.kind),
        status: text(row.status),
        cta_type: text(row.cta_type),
        cta_ref: text(row.cta_ref),
      },
    );
    for (
      const [event, key] of [
        ["guidance_shown", "shown_at"],
        ["guidance_opened", "opened_at"],
        ["guidance_acted", "acted_at"],
        ["guidance_dismissed", "dismissed_at"],
      ] as const
    ) {
      pushItem(row[key], event, "Reflections / Guidance", {
        kind: text(row.kind),
        delivery_id: compactId(row.id),
      });
    }
  }
  for (
    const row of data.admin_content_evaluations.filter((item) =>
      text(item.target_user_id) === userId
    )
  ) {
    pushItem(row.created_at, "content_evaluation", "Reflections / Guidance", {
      artifact: text(row.artifact),
      status: text(row.status),
      rating: row.rating ?? null,
    });
  }

  const ordered = items
    .sort((a, b) => timestampMs(b.at) - timestampMs(a.at))
    .slice(0, 120);
  const profile = data.profiles.find((row) => text(row.id) === userId);
  return {
    user: profile
      ? {
        id: userId,
        display_name: text(profile.display_name) || text(profile.handle) ||
          `User ${userId.slice(0, 8)}`,
        timezone: text(profile.timezone) || "UTC",
        onboarding_completed_at: profile.onboarding_completed_at ?? null,
        telemetry_enabled: profile.telemetry_enabled !== false,
      }
      : { id: userId, display_name: `User ${userId.slice(0, 8)}` },
    timeline: ordered,
    summary: {
      item_count: ordered.length,
      surfaces: uniqueCount(ordered.map((item) => item.surface)),
      app_events:
        ordered.filter((item) =>
          String(item.type).includes("app") || item.type === "screen_view"
        ).length,
      sticky_events:
        ordered.filter((item) =>
          String(item.type).includes("saved") ||
          String(item.type).includes("completed") ||
          String(item.type).includes("journal") ||
          String(item.type).includes("practice") ||
          String(item.type).includes("acted")
        ).length,
    },
  };
}

function buildPayload(data: Record<string, Row[]>, days: number, userId = "") {
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - days * 24 * 60 * 60 * 1000);
  const sinceMs = since.getTime();
  const { telemetryEnabled } = makeProfileMaps(data.profiles);
  const appEvents = filterTelemetry(data.app_events, telemetryEnabled);
  const choiceEvents = filterTelemetry(
    data.user_choice_events,
    telemetryEnabled,
  );
  const hook = buildHook(data, appEvents, sinceMs);
  const exploration = buildExploration({ appEvents, choiceEvents, sinceMs });
  const stickiness = buildStickiness(data, appEvents, choiceEvents, sinceMs);
  const guidance = buildGuidanceSummary(data, sinceMs);
  const contentPerformance = buildContentPerformance(data, sinceMs);

  return {
    period_days: days,
    generated_at: generatedAt.toISOString(),
    period_start: since.toISOString(),
    limitations: LIMITATIONS,
    overview: {
      active_users: hook.active_users,
      returning_users_approx: hook.returning_users_approx,
      onboarding_completed: hook.onboarding_completed,
      explored_surface_count: exploration.surfaces.length,
      sticky_action_count: stickiness.flow_saves +
        stickiness.flow_completions +
        stickiness.journal_entries +
        stickiness.library_bookmarks +
        stickiness.shared_practice_entries +
        guidance.acted,
      guidance_acted: guidance.acted,
      content_previews: guidance.content_previews,
    },
    hook,
    exploration,
    stickiness,
    reflections_guidance: guidance,
    content_performance: contentPerformance,
    user_drilldown: buildTimeline(data, userId, sinceMs),
  };
}

export function createAdminPowerUserHandler(deps: HandlerDeps) {
  return async function adminPowerUserHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }
    if (req.method !== "GET") {
      return jsonResponse(req, { error: "method_not_allowed" }, {
        status: 405,
      });
    }

    const url = new URL(req.url);
    const days = parseDays(req);
    const userId = text(url.searchParams.get("user_id"));
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString();
    const startedAt = Date.now();
    const auth = await requireAdmin(req, deps, {
      scope: "war_room.read",
      deniedAction: "power_user.denied",
      resourceType: "power_user_dashboard",
      resourceId: userId || "aggregate",
      metadata: { days, drilldown: !!userId },
    });
    if (auth.ok === false) return auth.response;

    try {
      const data = await withTimeout(
        loadData(deps.client, sinceIso),
        LOAD_TIMEOUT_MS,
        "admin_power_user data load",
      );
      const payload = buildPayload(data, days, userId);
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: userId ? "power_user.drilldown.view" : "power_user.view",
        resourceType: "power_user_dashboard",
        resourceId: userId || "aggregate",
        riskLevel: userId ? "medium" : "low",
        metadata: {
          days,
          active_users: payload.overview.active_users,
          timeline_items: payload.user_drilldown?.summary?.item_count ?? 0,
          duration_ms: Date.now() - startedAt,
        },
      });
      return jsonResponse(req, payload);
    } catch (error) {
      const timeout = isTimeoutError(error);
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: timeout ? "power_user.timeout" : "power_user.failed",
        resourceType: "power_user_dashboard",
        resourceId: userId || "aggregate",
        riskLevel: "medium",
        metadata: {
          days,
          error: serializeError(error),
          duration_ms: Date.now() - startedAt,
        },
      });
      return jsonResponse(req, {
        error: timeout
          ? "power_user_dashboard_timeout"
          : "power_user_dashboard_failed",
        detail: serializeError(error),
      }, { status: timeout ? 504 : 500 });
    }
  };
}

if (import.meta.main) {
  const client = createServiceClient();
  if (!client) {
    serve(serverNotConfiguredResponse);
  } else {
    serve(createAdminPowerUserHandler({ client }));
  }
}
