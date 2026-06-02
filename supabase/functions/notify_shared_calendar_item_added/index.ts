// Edge Function: notify_shared_calendar_item_added
// Server-side fanout for new calendar-visible items added to shared calendars.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

export type SharedCalendarItemType =
  | "flow"
  | "event"
  | "note"
  | "reminder"
  | "task";

type User = { id: string };

type CalendarRow = {
  id: string;
  name: string;
  color?: number | null;
  is_personal: boolean;
  deleted_at?: string | null;
};

type MembershipRow = {
  user_id: string;
  role: string;
  status: string;
};

type ResolvedItem = {
  id: string;
  title?: string | null;
  calendarId: string;
  clientEventId?: string | null;
  flowId?: number | null;
  eventId?: string | null;
  noteId?: string | null;
  reminderId?: string | null;
  taskId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

type NotificationRow = {
  calendar_id: string;
  recipient_id: string;
  actor_id: string;
  kind: "calendar_event";
  title: string;
  body: string;
  payload_json: Record<string, unknown>;
};

type PushResult = {
  sent: number;
  failed: number;
};

export type FanoutStore = {
  authenticate: (accessToken: string) => Promise<User | null>;
  getCalendar: (calendarId: string) => Promise<CalendarRow | null>;
  getActorMembership: (
    calendarId: string,
    actorUserId: string,
  ) => Promise<MembershipRow | null>;
  resolveItem: (
    request: NormalizedFanoutRequest,
  ) => Promise<ResolvedItem | null>;
  createFanoutLog: (record: {
    dedupeKey: string;
    calendarId: string;
    itemType: SharedCalendarItemType;
    itemId: string;
    actorUserId: string;
  }) => Promise<{ created: boolean }>;
  getRecipientUserIds: (
    calendarId: string,
    actorUserId: string,
  ) => Promise<string[]>;
  getActorLabel: (actorUserId: string) => Promise<string | null>;
  insertNotificationRows: (rows: NotificationRow[]) => Promise<number>;
  updateFanoutLog: (
    dedupeKey: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  sendPush: (params: {
    userIds: string[];
    title: string;
    body: string;
    data: Record<string, unknown>;
    accessToken: string;
  }) => Promise<PushResult>;
};

type HandlerDeps = {
  store: FanoutStore;
};

type NormalizedFanoutRequest = {
  calendarId: string;
  itemType: SharedCalendarItemType;
  itemId: string;
  itemTitle?: string | null;
  actorUserId: string;
  flowId?: number | null;
  eventId?: string | null;
  noteId?: string | null;
  reminderId?: string | null;
  taskId?: string | null;
  clientEventId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  kYear?: number | null;
  kMonth?: number | null;
  kDay?: number | null;
};

const allowedItemTypes = new Set<SharedCalendarItemType>([
  "flow",
  "event",
  "note",
  "reminder",
  "task",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
      ...(init?.headers ?? {}),
    },
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed.length === 0 ? null : trimmed;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isUuid(value: string | null | undefined): boolean {
  return !!value &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
      .test(value);
}

function extractToken(req: Request): string {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    "";
}

function normalizeItemType(value: unknown): SharedCalendarItemType | null {
  const normalized = text(value).toLowerCase();
  return allowedItemTypes.has(normalized as SharedCalendarItemType)
    ? normalized as SharedCalendarItemType
    : null;
}

function normalizeRequest(
  raw: Record<string, unknown>,
  actorUserId: string,
): NormalizedFanoutRequest | null {
  const calendarId = optionalText(raw.calendar_id ?? raw.calendarId);
  const itemType = normalizeItemType(raw.item_type ?? raw.itemType);
  const rawItemId = optionalText(raw.item_id ?? raw.itemId);
  const flowId = positiveInt(raw.flow_id ?? raw.flowId);
  const eventId = optionalText(raw.event_id ?? raw.eventId);
  const noteId = optionalText(raw.note_id ?? raw.noteId);
  const reminderId = optionalText(raw.reminder_id ?? raw.reminderId);
  const taskId = optionalText(raw.task_id ?? raw.taskId);
  const itemId = rawItemId ??
    (itemType === "flow" || itemType === "reminder"
      ? flowId?.toString()
      : null) ??
    eventId ??
    noteId ??
    reminderId ??
    taskId;

  if (!calendarId || !itemType || !itemId) return null;

  return {
    calendarId,
    itemType,
    itemId,
    itemTitle: optionalText(raw.item_title ?? raw.itemTitle),
    actorUserId,
    flowId,
    eventId,
    noteId,
    reminderId,
    taskId,
    clientEventId: optionalText(raw.client_event_id ?? raw.clientEventId),
    startDate: optionalText(raw.start_date ?? raw.startDate),
    endDate: optionalText(raw.end_date ?? raw.endDate),
    kYear: positiveInt(raw.k_year ?? raw.kYear),
    kMonth: positiveInt(raw.k_month ?? raw.kMonth),
    kDay: positiveInt(raw.k_day ?? raw.kDay),
  };
}

export function sharedCalendarItemAddedDedupeKey(
  calendarId: string,
  itemType: SharedCalendarItemType,
  itemId: string,
) {
  return `shared_calendar_item_added:${calendarId}:${itemType}:${itemId}`;
}

function titleForItemType(itemType: SharedCalendarItemType) {
  switch (itemType) {
    case "flow":
      return "flow";
    case "event":
      return "event";
    case "note":
      return "note";
    case "reminder":
      return "reminder";
    case "task":
      return "task";
  }
}

export function buildNotificationCopy(params: {
  calendarName: string;
  itemType: SharedCalendarItemType;
  itemTitle?: string | null;
  actorLabel?: string | null;
}) {
  const label = titleForItemType(params.itemType);
  const title = `New ${label} added to ${params.calendarName}`;
  const subject = params.itemType === "note"
    ? "A note"
    : text(params.itemTitle) || `A ${label}`;
  const body = params.actorLabel
    ? `${subject} was added by ${params.actorLabel}.`
    : `${subject} was added to this calendar.`;
  return { title, body };
}

function buildPayload(params: {
  request: NormalizedFanoutRequest;
  calendar: CalendarRow;
  resolvedItem: ResolvedItem;
  actorUserId: string;
}) {
  const { request, calendar, resolvedItem, actorUserId } = params;
  return {
    type: "shared_calendar_item_added",
    kind: "shared_calendar_item_added",
    notification_type: "shared_calendar_item_added",
    notification_kind: "calendar_event",
    item_type: request.itemType,
    calendar_id: calendar.id,
    calendar_name: calendar.name,
    calendar_color: calendar.color ?? null,
    item_id: request.itemId,
    actor_user_id: actorUserId,
    flow_id: request.flowId ?? resolvedItem.flowId ?? null,
    event_id: request.eventId ?? resolvedItem.eventId ?? null,
    note_id: request.noteId ?? resolvedItem.noteId ?? null,
    reminder_id: request.reminderId ?? resolvedItem.reminderId ?? null,
    task_id: request.taskId ?? resolvedItem.taskId ?? null,
    client_event_id: request.clientEventId ?? resolvedItem.clientEventId ??
      null,
    start_date: request.startDate ?? resolvedItem.startDate ?? null,
    end_date: request.endDate ?? resolvedItem.endDate ?? null,
    k_year: request.kYear ?? null,
    k_month: request.kMonth ?? null,
    k_day: request.kDay ?? null,
  };
}

function compactPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter((entry) =>
      entry[1] !== null && entry[1] !== undefined
    ),
  );
}

function hasEditPermission(membership: MembershipRow | null) {
  return membership?.status === "accepted" &&
    (membership.role === "owner" || membership.role === "editor");
}

export function createNotifySharedCalendarItemAddedHandler(
  deps: HandlerDeps,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req.headers.get("origin")),
      });
    }
    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, {
        status: 405,
      });
    }

    const accessToken = extractToken(req);
    if (!accessToken) {
      return jsonResponse(req, { error: "Unauthorized" }, { status: 401 });
    }

    const actor = await deps.store.authenticate(accessToken);
    if (!actor?.id) {
      return jsonResponse(req, { error: "Unauthorized" }, { status: 401 });
    }

    let raw: Record<string, unknown>;
    try {
      raw = await req.json();
    } catch {
      return jsonResponse(req, { error: "Invalid JSON" }, { status: 400 });
    }

    const normalized = normalizeRequest(raw, actor.id);
    if (!normalized) {
      return jsonResponse(
        req,
        { error: "calendar_id, item_type, and item_id are required" },
        { status: 400 },
      );
    }

    try {
      const calendar = await deps.store.getCalendar(normalized.calendarId);
      if (!calendar || calendar.deleted_at) {
        return jsonResponse(req, { error: "Calendar not found" }, {
          status: 404,
        });
      }
      if (calendar.is_personal) {
        return jsonResponse(req, {
          ok: true,
          skipped: "personal_calendar",
          recipient_count: 0,
          notification_count: 0,
          push_sent_count: 0,
          push_failed_count: 0,
        });
      }

      const membership = await deps.store.getActorMembership(
        normalized.calendarId,
        actor.id,
      );
      if (!hasEditPermission(membership)) {
        return jsonResponse(req, { error: "Calendar not editable" }, {
          status: 403,
        });
      }

      const resolvedItem = await deps.store.resolveItem(normalized);
      if (!resolvedItem) {
        return jsonResponse(req, { error: "Item not found" }, { status: 404 });
      }
      if (resolvedItem.calendarId !== normalized.calendarId) {
        return jsonResponse(
          req,
          { error: "Item does not belong to calendar" },
          { status: 409 },
        );
      }

      const dedupeKey = sharedCalendarItemAddedDedupeKey(
        normalized.calendarId,
        normalized.itemType,
        normalized.itemId,
      );
      const logResult = await deps.store.createFanoutLog({
        dedupeKey,
        calendarId: normalized.calendarId,
        itemType: normalized.itemType,
        itemId: normalized.itemId,
        actorUserId: actor.id,
      });
      if (!logResult.created) {
        return jsonResponse(req, {
          ok: true,
          duplicate: true,
          dedupe_key: dedupeKey,
          recipient_count: 0,
          notification_count: 0,
          push_sent_count: 0,
          push_failed_count: 0,
        });
      }

      const recipientIds = await deps.store.getRecipientUserIds(
        normalized.calendarId,
        actor.id,
      );
      const actorLabel = await deps.store.getActorLabel(actor.id);
      const copy = buildNotificationCopy({
        calendarName: calendar.name,
        itemType: normalized.itemType,
        itemTitle: normalized.itemTitle ?? resolvedItem.title,
        actorLabel,
      });
      const payload = compactPayload(
        buildPayload({
          request: normalized,
          calendar,
          resolvedItem,
          actorUserId: actor.id,
        }),
      );

      const notificationRows = recipientIds.map((recipientId) => ({
        calendar_id: normalized.calendarId,
        recipient_id: recipientId,
        actor_id: actor.id,
        kind: "calendar_event" as const,
        title: copy.title,
        body: copy.body,
        payload_json: payload,
      }));
      const notificationCount = await deps.store.insertNotificationRows(
        notificationRows,
      );

      const pushResult = await deps.store.sendPush({
        userIds: recipientIds,
        title: copy.title,
        body: copy.body,
        data: payload,
        accessToken,
      });
      const status = pushResult.failed > 0 ? "push_failed" : "completed";
      await deps.store.updateFanoutLog(dedupeKey, {
        recipient_count: recipientIds.length,
        notification_count: notificationCount,
        push_sent_count: pushResult.sent,
        push_failed_count: pushResult.failed,
        status,
        completed_at: new Date().toISOString(),
        ...(pushResult.failed > 0
          ? { last_error: "one_or_more_pushes_failed" }
          : { last_error: null }),
      });

      return jsonResponse(req, {
        ok: true,
        dedupe_key: dedupeKey,
        recipient_count: recipientIds.length,
        notification_count: notificationCount,
        push_sent_count: pushResult.sent,
        push_failed_count: pushResult.failed,
      });
    } catch (error) {
      console.error("notify_shared_calendar_item_added failed", error);
      return jsonResponse(req, { error: "Fanout failed" }, { status: 500 });
    }
  };
}

function createSupabaseFanoutStore(options: {
  client: any;
  supabaseUrl: string;
  internalFunctionKey: string;
  fetchImpl?: typeof fetch;
}): FanoutStore {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function maybeSingle(table: string, build: (query: any) => any) {
    const { data, error } = await build(options.client.from(table))
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async function resolveUserEvent(
    request: NormalizedFanoutRequest,
    id: string,
  ): Promise<ResolvedItem | null> {
    const row = await maybeSingle("user_events", (query) =>
      query
        .select(
          "id, calendar_id, title, client_event_id, starts_at, ends_at, flow_local_id",
        )
        .eq("id", id));
    if (!row) return null;
    return {
      id: String(row.id),
      title: row.title,
      calendarId: String(row.calendar_id),
      clientEventId: row.client_event_id ?? null,
      flowId: typeof row.flow_local_id === "number" ? row.flow_local_id : null,
      eventId: request.itemType === "event" ? String(row.id) : null,
      noteId: request.itemType === "note" ? String(row.id) : null,
      taskId: request.itemType === "task" ? String(row.id) : null,
      startDate: row.starts_at ?? null,
      endDate: row.ends_at ?? null,
    };
  }

  async function resolveFlow(
    request: NormalizedFanoutRequest,
    id: string,
  ): Promise<ResolvedItem | null> {
    const row = await maybeSingle("flows", (query) =>
      query
        .select("id, calendar_id, name, start_date, end_date, is_reminder")
        .eq("id", id));
    if (!row) return null;
    if (request.itemType === "reminder" && row.is_reminder !== true) {
      return null;
    }
    return {
      id: String(row.id),
      title: row.name,
      calendarId: String(row.calendar_id),
      flowId: Number(row.id),
      reminderId: request.itemType === "reminder" ? request.reminderId : null,
      startDate: row.start_date ?? null,
      endDate: row.end_date ?? null,
    };
  }

  async function resolveReminder(
    request: NormalizedFanoutRequest,
  ): Promise<ResolvedItem | null> {
    const flowId = request.flowId ?? positiveInt(request.itemId);
    if (flowId != null) {
      return await resolveFlow(
        { ...request, itemType: "reminder" },
        String(flowId),
      );
    }
    if (!isUuid(request.itemId)) return null;
    const reminder = await maybeSingle("reminders", (query) =>
      query
        .select("id, title, event_id, flow_event_id")
        .eq("id", request.itemId));
    if (!reminder) return null;
    const eventId = reminder.event_id ?? reminder.flow_event_id;
    if (!eventId) return null;
    const event = await resolveUserEvent(request, String(eventId));
    if (!event) return null;
    return {
      ...event,
      id: String(reminder.id),
      title: reminder.title ?? event.title,
      reminderId: String(reminder.id),
      eventId: event.eventId ?? String(eventId),
    };
  }

  return {
    authenticate: async (accessToken: string) => {
      const { data, error } = await options.client.auth.getUser(accessToken);
      if (error || !data?.user?.id) return null;
      return { id: data.user.id };
    },
    getCalendar: async (calendarId: string) => {
      return await maybeSingle("shared_calendars", (query) =>
        query
          .select("id, name, color, is_personal, deleted_at")
          .eq("id", calendarId)) as CalendarRow | null;
    },
    getActorMembership: async (calendarId: string, actorUserId: string) => {
      return await maybeSingle("shared_calendar_members", (query) =>
        query
          .select("user_id, role, status")
          .eq("calendar_id", calendarId)
          .eq("user_id", actorUserId)) as MembershipRow | null;
    },
    resolveItem: async (request: NormalizedFanoutRequest) => {
      switch (request.itemType) {
        case "flow":
          return await resolveFlow(request, request.itemId);
        case "event":
        case "note":
        case "task":
          return await resolveUserEvent(request, request.itemId);
        case "reminder":
          return await resolveReminder(request);
      }
    },
    createFanoutLog: async (record) => {
      const { error } = await options.client
        .from("shared_calendar_item_added_fanout")
        .insert({
          dedupe_key: record.dedupeKey,
          calendar_id: record.calendarId,
          item_type: record.itemType,
          item_id: record.itemId,
          actor_user_id: record.actorUserId,
        });
      if (!error) return { created: true };
      if (error.code === "23505") return { created: false };
      throw error;
    },
    getRecipientUserIds: async (calendarId: string, actorUserId: string) => {
      const { data, error } = await options.client
        .from("shared_calendar_members")
        .select("user_id, status")
        .eq("calendar_id", calendarId)
        .eq("status", "accepted");
      if (error) throw error;
      return (data ?? [])
        .map((row: Record<string, unknown>) => text(row.user_id))
        .filter((userId: string) => userId && userId !== actorUserId);
    },
    getActorLabel: async (actorUserId: string) => {
      const row = await maybeSingle("profiles", (query) =>
        query
          .select("display_name, handle")
          .eq("id", actorUserId));
      const displayName = optionalText(row?.display_name);
      const handle = optionalText(row?.handle);
      return displayName ?? (handle ? `@${handle}` : null);
    },
    insertNotificationRows: async (rows: NotificationRow[]) => {
      if (!rows.length) return 0;
      const { error } = await options.client
        .from("shared_calendar_notifications")
        .insert(rows);
      if (error) throw error;
      return rows.length;
    },
    updateFanoutLog: async (
      dedupeKey: string,
      patch: Record<string, unknown>,
    ) => {
      const { error } = await options.client
        .from("shared_calendar_item_added_fanout")
        .update(patch)
        .eq("dedupe_key", dedupeKey);
      if (error) throw error;
    },
    sendPush: async (params) => {
      if (!params.userIds.length) return { sent: 0, failed: 0 };
      const sent = { count: 0 };
      const failed = { count: 0 };
      const batchSize = options.internalFunctionKey ? 400 : 5;
      for (let i = 0; i < params.userIds.length; i += batchSize) {
        const batch = params.userIds.slice(i, i + batchSize);
        try {
          const res = await fetchImpl(
            `${options.supabaseUrl}/functions/v1/send_push`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(options.internalFunctionKey
                  ? { "x-internal-key": options.internalFunctionKey }
                  : { Authorization: `Bearer ${params.accessToken}` }),
              },
              body: JSON.stringify({
                userIds: batch,
                notification: {
                  title: params.title,
                  body: params.body,
                },
                data: params.data,
              }),
            },
          );
          if (!res.ok) {
            failed.count += batch.length;
            console.error("shared calendar item push failed", {
              status: res.status,
              body: await res.text(),
            });
            continue;
          }
          const parsed = await res.json().catch(() => null);
          sent.count += typeof parsed?.sent === "number"
            ? parsed.sent
            : batch.length;
          failed.count += typeof parsed?.failed === "number"
            ? parsed.failed
            : 0;
        } catch (error) {
          failed.count += batch.length;
          console.error("shared calendar item push exception", error);
        }
      }
      return { sent: sent.count, failed: failed.count };
    },
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalFunctionKey = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    serve((req) =>
      req.method === "OPTIONS"
        ? new Response(null, {
          status: 204,
          headers: corsHeaders(req.headers.get("origin")),
        })
        : jsonResponse(req, { error: "server_not_configured" }, {
          status: 500,
        })
    );
  } else {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    serve(createNotifySharedCalendarItemAddedHandler({
      store: createSupabaseFanoutStore({
        client,
        supabaseUrl,
        internalFunctionKey,
      }),
    }));
  }
}
