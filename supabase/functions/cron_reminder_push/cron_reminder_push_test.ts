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
  rpcCalls: Array<{ name: string; body: Row }>;
  pushCalls: FetchCall[];
  pushResponses: Row[];
  timingEvents: Row[];
};

type Handler = (request: Request) => Response | Promise<Response>;

const originalFetch = globalThis.fetch;
let state: TestState = createState();

function createState(overrides: Partial<TestState> = {}): TestState {
  return {
    reminders: [],
    rpcCalls: [],
    pushCalls: [],
    pushResponses: [],
    timingEvents: [],
    ...overrides,
  };
}

function resetState(overrides: Partial<TestState> = {}) {
  state = createState(overrides);
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
    return jsonResponse([]);
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
  const handler: Handler = createCronReminderPushHandler();
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
