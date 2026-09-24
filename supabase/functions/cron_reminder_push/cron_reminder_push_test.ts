// deno-lint-ignore-file no-explicit-any no-import-prefix

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createCronReminderPushHandler } from "./index.ts";

type Row = Record<string, any>;
type FetchCall = {
  url: string;
  method: string;
  headers: Headers;
  body: Row;
};

type TestState = {
  reminders: Row[];
  scheduledNotifications: Row[];
  userEvents: Row[];
  flows: Row[];
  rpcCalls: Array<{ name: string; body: Row }>;
  pushCalls: FetchCall[];
  pushResponses: Row[];
  timingEvents: Row[];
};

type Handler = (request: Request) => Response | Promise<Response>;

const originalFetch = globalThis.fetch;
let state: TestState = createState();
let currentNowIso = "2040-01-01T10:00:00.000Z";

function createState(overrides: Partial<TestState> = {}): TestState {
  return {
    reminders: [],
    scheduledNotifications: [],
    userEvents: [],
    flows: [],
    rpcCalls: [],
    pushCalls: [],
    pushResponses: [],
    timingEvents: [],
    ...overrides,
  };
}

function resetState(overrides: Partial<TestState> = {}) {
  state = createState(overrides);
  currentNowIso = "2040-01-01T10:00:00.000Z";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJsonBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Row> {
  const body = init?.body ??
    (input instanceof Request ? await input.clone().text() : "");
  if (!body) return {};
  const text = typeof body === "string"
    ? body
    : await new Response(body as BodyInit).text();
  if (!text.trim()) return {};
  return JSON.parse(text) as Row;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : {});
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return init?.method ?? (input instanceof Request ? input.method : "GET");
}

function parseFilterValues(raw: string) {
  const match = raw.match(/^in\.\((.*)\)$/);
  if (!match) return [];
  if (!match[1].trim()) return [];
  return match[1].split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
}

function matchesPostgrestFilters(row: Row, params: URLSearchParams) {
  for (const [key, value] of params.entries()) {
    if (key === "select") continue;
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.")) {
      if (!parseFilterValues(value).includes(String(row[key]))) return false;
      continue;
    }
  }
  return true;
}

function scheduledLifecycleIsComplete(row: Row) {
  return row.last_error === "no_tokens_for_recipients" &&
    Number(row.no_token_attempt_count) > 0 &&
    row.no_token_first_at != null &&
    row.next_attempt_at != null &&
    row.expires_at != null;
}

function scheduledRow(overrides: Row = {}): Row {
  return {
    id: 401,
    user_id: "00000000-0000-4000-8000-00000000c501",
    client_event_id: "cut5-scheduled",
    title: "Cut 5 scheduled notification",
    body: "Cut 5 body",
    payload: "{}",
    notification_type: "event_start",
    scheduled_at: "2040-01-01T10:00:00.000Z",
    is_active: true,
    attempt_count: 7,
    last_error: null,
    last_attempt_at: null,
    claimed_at: null,
    claim_token: null,
    no_token_attempt_count: 0,
    no_token_first_at: null,
    next_attempt_at: null,
    expires_at: null,
    token_available_at: null,
    updated_at: "2040-01-01T09:00:00.000Z",
    ...overrides,
  };
}

function validScheduledEvent(row: Row): Row {
  return {
    user_id: row.user_id,
    client_event_id: row.client_event_id,
    flow_local_id: null,
  };
}

function noTokenPushResponse(): Row {
  return {
    sent: 0,
    failed: 0,
    stale: 0,
    matchedTokens: 0,
    delivered: false,
    reason: "no_tokens_for_recipients",
    failedReasons: [],
  };
}

async function mockFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = requestMethod(input, init).toUpperCase();
  const headers = requestHeaders(input, init);
  const body = await readJsonBody(input, init);

  if (url.pathname.endsWith("/functions/v1/send_push")) {
    state.pushCalls.push({ url: url.toString(), method, headers, body });
    const next = state.pushResponses.shift() ?? {
      sent: 1,
      failed: 0,
      stale: 0,
      matchedTokens: 1,
      delivered: true,
      failedReasons: [],
    };
    return jsonResponse(next);
  }

  if (url.pathname.endsWith("/rest/v1/rpc/claim_due_reminders")) {
    state.rpcCalls.push({ name: "claim_due_reminders", body });
    const nowMs = Date.parse(String(body.p_now));
    const limit = typeof body.p_limit === "number" ? body.p_limit : 500;
    const due = state.reminders
      .filter((row) =>
        row.status === "pending" &&
        Date.parse(String(row.alert_at)) <= nowMs
      )
      .slice(0, limit);
    for (const row of due) row.status = "claimed";
    return jsonResponse(due);
  }

  if (
    url.pathname.endsWith("/rest/v1/rpc/claim_due_scheduled_notifications")
  ) {
    state.rpcCalls.push({
      name: "claim_due_scheduled_notifications",
      body,
    });
    const nowMs = Date.parse(String(body.p_now));
    const leaseMs = Number(body.p_lease_seconds ?? 900) * 1000;
    const limit = Number(body.p_limit ?? 500);
    const claimToken = `cut5-claim-${state.rpcCalls.length}`;
    const due = state.scheduledNotifications
      .filter((row) => {
        if (row.is_active !== true) return false;
        if (Date.parse(String(row.scheduled_at)) > nowMs) return false;
        if (
          row.claimed_at != null &&
          Date.parse(String(row.claimed_at)) >= nowMs - leaseMs
        ) return false;
        if (!scheduledLifecycleIsComplete(row)) return true;
        if (Date.parse(String(row.next_attempt_at)) > nowMs) return false;
        const expiresAtMs = Date.parse(String(row.expires_at));
        if (nowMs < expiresAtMs) return true;
        return row.token_available_at != null &&
          Date.parse(String(row.token_available_at)) < expiresAtMs &&
          nowMs <= expiresAtMs + 2 * 60 * 1000;
      })
      .sort((a, b) =>
        Date.parse(String(a.scheduled_at)) -
          Date.parse(String(b.scheduled_at)) || Number(a.id) - Number(b.id)
      )
      .slice(0, Math.max(1, Math.min(limit, 500)));
    for (const row of due) {
      row.claimed_at = body.p_now;
      row.claim_token = claimToken;
      row.updated_at = body.p_now;
    }
    return jsonResponse(due.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      client_event_id: row.client_event_id,
      title: row.title,
      body: row.body,
      payload: row.payload,
      notification_type: row.notification_type,
      scheduled_at: row.scheduled_at,
      claim_token: row.claim_token,
    })));
  }

  if (url.pathname.endsWith("/rest/v1/maat_delivery_timing_events")) {
    assertEquals(method, "POST");
    state.timingEvents.push(body);
    return jsonResponse([body], 201);
  }

  if (url.pathname.endsWith("/rest/v1/reminders")) {
    assertEquals(method, "PATCH");
    for (const row of state.reminders) {
      if (matchesPostgrestFilters(row, url.searchParams)) {
        Object.assign(row, body);
      }
    }
    return jsonResponse([]);
  }

  if (url.pathname.endsWith("/rest/v1/scheduled_notifications")) {
    const matching = state.scheduledNotifications.filter((row) =>
      matchesPostgrestFilters(row, url.searchParams)
    );
    if (method === "GET") {
      const wantsObject = headers.get("accept")?.includes(
        "application/vnd.pgrst.object",
      );
      return jsonResponse(wantsObject ? matching[0] ?? null : matching);
    }
    if (method === "PATCH") {
      for (const row of matching) Object.assign(row, body);
      return jsonResponse([]);
    }
  }

  if (url.pathname.endsWith("/rest/v1/user_events")) {
    assertEquals(method, "GET");
    return jsonResponse(
      state.userEvents.filter((row) =>
        matchesPostgrestFilters(row, url.searchParams)
      ),
    );
  }

  if (url.pathname.endsWith("/rest/v1/flows")) {
    assertEquals(method, "GET");
    return jsonResponse(
      state.flows.filter((row) =>
        matchesPostgrestFilters(row, url.searchParams)
      ),
    );
  }

  return jsonResponse({ error: `Unhandled fetch ${method} ${url}` }, 500);
}

function reminderRow(
  id: string,
  userId: string,
  alertAt: string,
  status = "pending",
): Row {
  return {
    id,
    user_id: userId,
    title: `Reminder ${id}`,
    detail: `Detail ${id}`,
    alert_at: alertAt,
    status,
  };
}

function cronRequest() {
  return new Request("http://localhost/cron_reminder_push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": "cron-secret",
    },
    body: "{}",
  });
}

async function callCron() {
  const handler: Handler = createCronReminderPushHandler({
    now: () => new Date(currentNowIso),
  });
  (globalThis as any).fetch = mockFetch;
  try {
    return await handler(cronRequest());
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
}

Deno.env.set("SUPABASE_URL", "http://supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
Deno.env.set("INTERNAL_FUNCTION_KEY", "internal-key");
Deno.env.set("REMINDER_CRON_SECRET", "cron-secret");

Deno.test("cron_reminder_push claims due reminders once and sends owner-only internal-key push", async () => {
  resetState({
    reminders: [
      reminderRow(
        "due-1",
        "user-owner",
        "2026-06-10T10:00:00.000Z",
      ),
      reminderRow(
        "future-1",
        "future-user",
        "2999-01-01T00:00:00.000Z",
      ),
      reminderRow(
        "claimed-1",
        "claimed-user",
        "2026-06-10T10:00:00.000Z",
        "claimed",
      ),
      reminderRow(
        "sent-1",
        "sent-user",
        "2026-06-10T10:00:00.000Z",
        "sent_push",
      ),
    ],
    pushResponses: [{
      sent: 1,
      failed: 0,
      stale: 0,
      matchedTokens: 1,
      delivered: true,
      failedReasons: [],
    }],
  });

  const response = await callCron();
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(body.sent, 1);
  assertEquals(body.failed, 0);
  assertEquals(state.rpcCalls.map((call) => call.name), [
    "claim_due_reminders",
    "claim_due_scheduled_notifications",
  ]);

  assertEquals(state.pushCalls.length, 1);
  const push = state.pushCalls[0];
  assertEquals(push.method, "POST");
  assertEquals(push.headers.get("x-internal-key"), "internal-key");
  assertEquals(push.body.userIds, ["user-owner"]);
  assertEquals(push.body.data.type, "reminder");
  assertEquals(
    push.body.data.delivery_key,
    "reminder:due-1:2026-06-10T10:00:00.000Z",
  );
  assertEquals(push.body.data.reminder_id, "due-1");
  assertEquals(push.body.data.alert_at, "2026-06-10T10:00:00.000Z");
  assertEquals(push.body.data.title, "Reminder due-1");

  assertEquals(state.reminders[0].status, "sent_push");
  assertEquals(state.reminders[1].status, "pending");
  assertEquals(state.reminders[2].status, "claimed");
  assertEquals(state.reminders[3].status, "sent_push");
  assertEquals(
    state.timingEvents.map((event) => event.delivery_status),
    ["picked", "sent"],
  );

  const second = await callCron();
  const secondBody = await second.json();
  assertEquals(second.status, 200);
  assertEquals(secondBody.processed, 0);
  assertEquals(secondBody.sent, 0);
  assertEquals(state.pushCalls.length, 1);
});

Deno.test("cron_reminder_push releases failed token attempts without marking sent", async () => {
  resetState({
    reminders: [
      reminderRow(
        "due-invalid-token",
        "user-owner",
        "2026-06-10T10:00:00.000Z",
      ),
    ],
    pushResponses: [{
      sent: 0,
      failed: 1,
      stale: 1,
      matchedTokens: 1,
      delivered: false,
      reason: "404:NOT_FOUND/UNREGISTERED",
      failedReasons: ["404:NOT_FOUND/UNREGISTERED"],
    }],
  });

  const response = await callCron();
  const body = await response.json();

  assertEquals(response.status, 207);
  assertEquals(body.processed, 1);
  assertEquals(body.sent, 0);
  assertEquals(body.failed, 1);
  assertEquals(body.failedDetails, [{
    kind: "reminder",
    reminder_id: "due-invalid-token",
    user_id: "user-owner",
    error: "404:NOT_FOUND/UNREGISTERED",
    matched_tokens: 1,
    failed_reasons: ["404:NOT_FOUND/UNREGISTERED"],
  }]);

  assertEquals(state.pushCalls.length, 1);
  assertEquals(state.pushCalls[0].body.userIds, ["user-owner"]);
  assertEquals(
    state.pushCalls[0].body.data.delivery_key,
    "reminder:due-invalid-token:2026-06-10T10:00:00.000Z",
  );
  assertEquals(state.reminders[0].status, "pending");
  assertEquals(
    state.timingEvents.map((event) => event.delivery_status),
    ["picked", "failed"],
  );
  assertEquals(
    state.timingEvents[1].error_code,
    "404:NOT_FOUND/UNREGISTERED",
  );
});

Deno.test("cron_reminder_push advances no-token retries on fixed scheduled_at checkpoints without minute churn", async () => {
  const scheduled = scheduledRow();
  resetState({
    scheduledNotifications: [scheduled],
    userEvents: [validScheduledEvent(scheduled)],
    pushResponses: Array.from({ length: 6 }, noTokenPushResponse),
  });

  const first = await callCron();
  assertEquals(first.status, 207);
  assertEquals(scheduled.no_token_attempt_count, 1);
  assertEquals(scheduled.no_token_first_at, "2040-01-01T10:00:00.000Z");
  assertEquals(scheduled.next_attempt_at, "2040-01-01T10:15:00.000Z");
  assertEquals(scheduled.expires_at, "2040-01-02T10:00:00.000Z");
  assertEquals(scheduled.token_available_at, null);
  assertEquals(scheduled.attempt_count, 7);
  assertEquals(scheduled.is_active, true);
  assertEquals(scheduled.claimed_at, null);
  assertEquals(scheduled.claim_token, null);
  assertEquals(state.pushCalls.length, 1);
  assertEquals(
    state.timingEvents.map((event) => event.delivery_status),
    ["picked", "skipped"],
  );
  assertEquals(
    state.timingEvents[1].metadata.next_attempt_at,
    "2040-01-01T10:15:00.000Z",
  );

  currentNowIso = "2040-01-01T10:01:00.000Z";
  const between = await callCron();
  assertEquals(between.status, 200);
  assertEquals((await between.json()).processed, 0);
  assertEquals(state.pushCalls.length, 1);
  assertEquals(state.timingEvents.length, 2);

  const checkpoints = [
    ["2040-01-01T10:15:00.000Z", "2040-01-01T11:00:00.000Z", 2],
    ["2040-01-01T11:00:00.000Z", "2040-01-01T16:00:00.000Z", 3],
    ["2040-01-01T16:00:00.000Z", "2040-01-01T22:00:00.000Z", 4],
    ["2040-01-01T22:00:00.000Z", "2040-01-02T09:00:00.000Z", 5],
  ] as const;
  for (const [at, nextAt, count] of checkpoints) {
    currentNowIso = at;
    const response = await callCron();
    assertEquals(response.status, 207);
    assertEquals(scheduled.no_token_attempt_count, count);
    assertEquals(scheduled.next_attempt_at, nextAt);
    assertEquals(scheduled.no_token_first_at, "2040-01-01T10:00:00.000Z");
    assertEquals(scheduled.expires_at, "2040-01-02T10:00:00.000Z");
    assertEquals(scheduled.attempt_count, 7);
    assertEquals(scheduled.is_active, true);
  }

  currentNowIso = "2040-01-02T09:00:00.000Z";
  const exhausted = await callCron();
  assertEquals(exhausted.status, 207);
  assertEquals(scheduled.no_token_attempt_count, 6);
  assertEquals(scheduled.next_attempt_at, null);
  assertEquals(scheduled.no_token_first_at, "2040-01-01T10:00:00.000Z");
  assertEquals(scheduled.expires_at, "2040-01-02T10:00:00.000Z");
  assertEquals(scheduled.attempt_count, 7);
  assertEquals(scheduled.is_active, false);
  assertEquals(scheduled.claimed_at, null);
  assertEquals(scheduled.claim_token, null);
  assertEquals(state.pushCalls.length, 6);
  assertEquals(
    state.timingEvents.map((event) => event.delivery_status),
    Array.from({ length: 6 }, () => ["picked", "skipped"]).flat(),
  );
});

Deno.test("cron_reminder_push honors token wake success once and clears stale lifecycle state", async () => {
  const scheduled = scheduledRow();
  resetState({
    scheduledNotifications: [scheduled],
    userEvents: [validScheduledEvent(scheduled)],
    pushResponses: [
      noTokenPushResponse(),
      {
        sent: 1,
        failed: 0,
        stale: 0,
        matchedTokens: 1,
        delivered: true,
        failedReasons: [],
      },
    ],
  });

  await callCron();
  scheduled.token_available_at = "2040-01-01T10:05:00.000Z";
  scheduled.next_attempt_at = "2040-01-01T10:05:00.000Z";
  currentNowIso = "2040-01-01T10:05:00.000Z";

  const delivered = await callCron();
  const deliveredBody = await delivered.json();
  assertEquals(delivered.status, 200);
  assertEquals(deliveredBody.sent, 1);
  assertEquals(state.pushCalls.length, 2);
  assertEquals(scheduled.is_active, false);
  assertEquals(scheduled.no_token_attempt_count, 0);
  assertEquals(scheduled.no_token_first_at, null);
  assertEquals(scheduled.next_attempt_at, null);
  assertEquals(scheduled.expires_at, null);
  assertEquals(scheduled.token_available_at, null);
  assertEquals(
    state.timingEvents.map((event) => event.delivery_status),
    ["picked", "skipped", "picked", "sent"],
  );

  const repeated = await callCron();
  assertEquals((await repeated.json()).processed, 0);
  assertEquals(state.pushCalls.length, 2);
});

Deno.test("cron_reminder_push token wake no-token result continues the original lifecycle", async () => {
  const scheduled = scheduledRow();
  resetState({
    scheduledNotifications: [scheduled],
    userEvents: [validScheduledEvent(scheduled)],
    pushResponses: [noTokenPushResponse(), noTokenPushResponse()],
  });

  await callCron();
  const firstAt = scheduled.no_token_first_at;
  const expiresAt = scheduled.expires_at;
  scheduled.token_available_at = "2040-01-01T10:05:00.000Z";
  scheduled.next_attempt_at = "2040-01-01T10:05:00.000Z";
  currentNowIso = "2040-01-01T10:05:00.000Z";
  await callCron();

  assertEquals(scheduled.no_token_attempt_count, 2);
  assertEquals(scheduled.no_token_first_at, firstAt);
  assertEquals(scheduled.expires_at, expiresAt);
  assertEquals(scheduled.next_attempt_at, "2040-01-01T10:15:00.000Z");
  assertEquals(scheduled.token_available_at, "2040-01-01T10:05:00.000Z");
  assertEquals(scheduled.attempt_count, 7);
});

Deno.test("cron_reminder_push allows only the pre-expiry token catch-up and retires another no-token result", async () => {
  const catchup = scheduledRow({
    no_token_attempt_count: 5,
    no_token_first_at: "2040-01-01T10:00:00.000Z",
    next_attempt_at: "2040-01-02T09:59:00.000Z",
    expires_at: "2040-01-02T10:00:00.000Z",
    token_available_at: "2040-01-02T09:59:00.000Z",
    last_error: "no_tokens_for_recipients",
    last_attempt_at: "2040-01-02T09:00:00.000Z",
  });
  resetState({
    scheduledNotifications: [catchup],
    userEvents: [validScheduledEvent(catchup)],
    pushResponses: [noTokenPushResponse()],
  });
  currentNowIso = "2040-01-02T10:01:00.000Z";

  const response = await callCron();
  assertEquals(response.status, 207);
  assertEquals(state.pushCalls.length, 1);
  assertEquals(catchup.no_token_attempt_count, 6);
  assertEquals(catchup.next_attempt_at, null);
  assertEquals(catchup.no_token_first_at, "2040-01-01T10:00:00.000Z");
  assertEquals(catchup.expires_at, "2040-01-02T10:00:00.000Z");
  assertEquals(catchup.is_active, false);

  const lateToken = scheduledRow({
    id: 402,
    client_event_id: "cut5-post-expiry-token",
    no_token_attempt_count: 5,
    no_token_first_at: "2040-01-01T10:00:00.000Z",
    next_attempt_at: "2040-01-02T10:00:30.000Z",
    expires_at: "2040-01-02T10:00:00.000Z",
    token_available_at: "2040-01-02T10:00:30.000Z",
    last_error: "no_tokens_for_recipients",
  });
  resetState({
    scheduledNotifications: [lateToken],
    userEvents: [validScheduledEvent(lateToken)],
  });
  currentNowIso = "2040-01-02T10:01:00.000Z";
  const blocked = await callCron();
  assertEquals(blocked.status, 200);
  assertEquals((await blocked.json()).processed, 0);
  assertEquals(state.pushCalls.length, 0);
  assertEquals(state.timingEvents.length, 0);
});

Deno.test("cron_reminder_push keeps transient, compiled-package, and stale paths independent", async () => {
  const transient = scheduledRow({
    id: 410,
    client_event_id: "cut5-transient",
    attempt_count: 0,
  });
  resetState({
    scheduledNotifications: [transient],
    userEvents: [validScheduledEvent(transient)],
    pushResponses: [{
      sent: 0,
      failed: 1,
      stale: 0,
      matchedTokens: 1,
      delivered: false,
      reason: "transient_push_failure",
      failedReasons: ["timeout"],
    }],
  });
  await callCron();
  assertEquals(transient.attempt_count, 1);
  assertEquals(transient.no_token_attempt_count, 0);
  assertEquals(transient.no_token_first_at, null);
  assertEquals(transient.next_attempt_at, null);
  assertEquals(transient.expires_at, null);
  assertEquals(transient.is_active, true);
  assertEquals(state.timingEvents[1].delivery_status, "failed");

  const compiled = scheduledRow({ id: 411, client_event_id: "cut5-compiled" });
  resetState({
    scheduledNotifications: [compiled],
    userEvents: [validScheduledEvent(compiled)],
    pushResponses: [{
      sent: 0,
      failed: 0,
      stale: 0,
      matchedTokens: 0,
      delivered: false,
      reason: "compiled_package_not_quality_proof",
      failedReasons: [],
    }],
  });
  await callCron();
  assertEquals(compiled.is_active, false);
  assertEquals(compiled.no_token_attempt_count, 0);
  assertEquals(state.timingEvents[1].delivery_status, "skipped");

  const stale = scheduledRow({ id: 412, client_event_id: "cut5-stale" });
  resetState({ scheduledNotifications: [stale] });
  const staleResponse = await callCron();
  const staleBody = await staleResponse.json();
  assertEquals(staleBody.retiredStaleScheduledIds, [412]);
  assertEquals(stale.is_active, false);
  assertEquals(state.pushCalls.length, 0);
  assertEquals(
    state.timingEvents.map((event) => event.delivery_status),
    ["picked", "skipped"],
  );
  assertEquals(state.timingEvents[1].skip_reason, "stale_event_or_flow");
});

Deno.test("cron_reminder_push resets stale no-token state for a genuinely re-armed occurrence", async () => {
  const rearmed = scheduledRow({
    id: 420,
    client_event_id: "cut5-rearmed",
    last_error: null,
    last_attempt_at: "2040-01-01T09:00:00.000Z",
    no_token_attempt_count: 5,
    no_token_first_at: "2039-12-31T09:00:00.000Z",
    next_attempt_at: "2039-12-31T10:00:00.000Z",
    expires_at: "2040-01-01T09:00:00.000Z",
    token_available_at: "2040-01-01T08:59:00.000Z",
  });
  resetState({
    scheduledNotifications: [rearmed],
    userEvents: [validScheduledEvent(rearmed)],
    pushResponses: [noTokenPushResponse()],
  });

  const response = await callCron();
  const body = await response.json();
  assertEquals(response.status, 207);
  assertEquals(body.retiredRearmedProcessedScheduledIds, []);
  assertEquals(body.resetRearmedProcessedScheduledIds, [420]);
  assertEquals(state.pushCalls.length, 1);
  assertEquals(rearmed.no_token_attempt_count, 1);
  assertEquals(rearmed.no_token_first_at, "2040-01-01T10:00:00.000Z");
  assertEquals(rearmed.next_attempt_at, "2040-01-01T10:15:00.000Z");
  assertEquals(rearmed.expires_at, "2040-01-02T10:00:00.000Z");
  assertEquals(rearmed.token_available_at, null);
  assertEquals(rearmed.attempt_count, 7);
  assertEquals(rearmed.is_active, true);
});
