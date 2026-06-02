import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildNotificationCopy,
  createNotifySharedCalendarItemAddedHandler,
  type FanoutStore,
  sharedCalendarItemAddedDedupeKey,
} from "./index.ts";

function request(body: Record<string, unknown>) {
  return new Request(
    "https://example.test/functions/v1/notify_shared_calendar_item_added",
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function createStore(options?: {
  personalCalendar?: boolean;
  duplicate?: boolean;
  recipients?: string[];
  pushFailed?: number;
  membership?: { user_id: string; role: string; status: string } | null;
  resolvedCalendarId?: string;
}) {
  const notificationRows: Array<Record<string, unknown>> = [];
  const pushCalls: Array<Record<string, unknown>> = [];
  const fanoutUpdates: Array<Record<string, unknown>> = [];
  const createdDedupeKeys = new Set<string>();
  const recipients = options?.recipients ?? [
    "actor-user",
    "active-member",
    "removed-member",
  ];

  const store: FanoutStore = {
    authenticate: (_accessToken: string) =>
      Promise.resolve({ id: "actor-user" }),
    getCalendar: (calendarId: string) =>
      Promise.resolve({
        id: calendarId,
        name: "Phillips'",
        color: 123,
        is_personal: options?.personalCalendar ?? false,
      }),
    getActorMembership: () =>
      Promise.resolve(
        options?.membership ?? {
          user_id: "actor-user",
          role: "editor",
          status: "accepted",
        },
      ),
    resolveItem: (input) =>
      Promise.resolve({
        id: input.itemId,
        title: input.itemTitle ?? "Lunch at Rubirosa",
        calendarId: options?.resolvedCalendarId ?? input.calendarId,
        clientEventId: input.clientEventId ?? "cid-lunch",
        flowId: input.flowId ?? null,
        eventId: input.eventId ?? input.itemId,
        startDate: input.startDate ?? "2026-06-04",
        endDate: input.endDate ?? null,
      }),
    createFanoutLog: (record) => {
      if (options?.duplicate || createdDedupeKeys.has(record.dedupeKey)) {
        return Promise.resolve({ created: false });
      }
      createdDedupeKeys.add(record.dedupeKey);
      return Promise.resolve({ created: true });
    },
    getRecipientUserIds: (_calendarId: string, actorUserId: string) =>
      Promise.resolve(
        recipients.filter((userId) =>
          userId !== actorUserId && userId !== "removed-member"
        ),
      ),
    getActorLabel: () => Promise.resolve("Jarale"),
    insertNotificationRows: (rows) => {
      notificationRows.push(...rows);
      return Promise.resolve(rows.length);
    },
    updateFanoutLog: (_dedupeKey, patch) => {
      fanoutUpdates.push(patch);
      return Promise.resolve();
    },
    sendPush: (params) => {
      pushCalls.push(params);
      return Promise.resolve({
        sent: params.userIds.length - (options?.pushFailed ?? 0),
        failed: options?.pushFailed ?? 0,
      });
    },
  };

  return { store, notificationRows, pushCalls, fanoutUpdates };
}

Deno.test("private calendar add does not notify", async () => {
  const { store, notificationRows, pushCalls } = createStore({
    personalCalendar: true,
  });
  const handler = createNotifySharedCalendarItemAddedHandler({ store });

  const response = await handler(
    request({
      calendar_id: "personal-calendar",
      item_type: "event",
      item_id: "event-1",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.skipped, "personal_calendar");
  assertEquals(notificationRows.length, 0);
  assertEquals(pushCalls.length, 0);
});

Deno.test("shared calendar manual event add notifies active members and excludes creator", async () => {
  const { store, notificationRows, pushCalls } = createStore();
  const handler = createNotifySharedCalendarItemAddedHandler({ store });

  const response = await handler(
    request({
      calendar_id: "shared-calendar",
      item_type: "event",
      item_id: "event-1",
      item_title: "Lunch at Rubirosa",
      event_id: "event-1",
      client_event_id: "cid-lunch",
      k_year: 6266,
      k_month: 11,
      k_day: 29,
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.recipient_count, 1);
  assertEquals(notificationRows.length, 1);
  assertEquals(notificationRows[0].recipient_id, "active-member");
  assertEquals(notificationRows[0].title, "New event added to Phillips'");
  assertEquals(
    notificationRows[0].body,
    "Lunch at Rubirosa was added by Jarale.",
  );
  assertEquals(pushCalls.length, 1);
  assertEquals(pushCalls[0].userIds, ["active-member"]);

  const payload = notificationRows[0].payload_json as Record<string, unknown>;
  assertEquals(payload.notification_type, "shared_calendar_item_added");
  assertEquals(payload.item_type, "event");
  assertEquals(payload.calendar_id, "shared-calendar");
  assertEquals(payload.item_id, "event-1");
  assertEquals(payload.event_id, "event-1");
  assertEquals(payload.client_event_id, "cid-lunch");
  assertEquals(payload.actor_user_id, "actor-user");
  assertEquals(payload.k_year, 6266);
});

Deno.test("shared calendar flow add sends flow payload", async () => {
  const { store, notificationRows } = createStore();
  const handler = createNotifySharedCalendarItemAddedHandler({ store });

  const response = await handler(
    request({
      calendar_id: "shared-calendar",
      item_type: "flow",
      item_id: "42",
      item_title: "NYC Itinerary",
      flow_id: 42,
      start_date: "2026-06-04",
      end_date: "2026-06-07",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.recipient_count, 1);
  assertEquals(notificationRows[0].title, "New flow added to Phillips'");
  assertEquals(
    notificationRows[0].body,
    "NYC Itinerary was added by Jarale.",
  );
  const payload = notificationRows[0].payload_json as Record<string, unknown>;
  assertEquals(payload.item_type, "flow");
  assertEquals(payload.flow_id, 42);
  assertEquals(payload.start_date, "2026-06-04");
  assertEquals(payload.end_date, "2026-06-07");
});

Deno.test("duplicate save does not duplicate fanout", async () => {
  const { store, notificationRows, pushCalls } = createStore({
    duplicate: true,
  });
  const handler = createNotifySharedCalendarItemAddedHandler({ store });

  const response = await handler(
    request({
      calendar_id: "shared-calendar",
      item_type: "note",
      item_id: "note-1",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.duplicate, true);
  assertEquals(notificationRows.length, 0);
  assertEquals(pushCalls.length, 0);
});

Deno.test("fanout logs push failure without rolling back notification rows", async () => {
  const { store, notificationRows, fanoutUpdates } = createStore({
    pushFailed: 1,
  });
  const handler = createNotifySharedCalendarItemAddedHandler({ store });

  const response = await handler(
    request({
      calendar_id: "shared-calendar",
      item_type: "task",
      item_id: "task-1",
      item_title: "Pack bags",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.push_failed_count, 1);
  assertEquals(notificationRows.length, 1);
  assertExists(fanoutUpdates.at(-1));
  assertEquals(fanoutUpdates.at(-1)?.status, "push_failed");
});

Deno.test("copy falls back when actor name is unavailable", () => {
  assertEquals(
    buildNotificationCopy({
      calendarName: "Phillips'",
      itemType: "note",
      actorLabel: null,
    }),
    {
      title: "New note added to Phillips'",
      body: "A note was added to this calendar.",
    },
  );
});

Deno.test("dedupe key uses calendar item type and item id", () => {
  assertEquals(
    sharedCalendarItemAddedDedupeKey("cal-1", "flow", "42"),
    "shared_calendar_item_added:cal-1:flow:42",
  );
});
