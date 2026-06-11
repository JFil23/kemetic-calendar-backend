// deno-lint-ignore-file no-explicit-any

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createAckMaatGuidanceHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const userId = "00000000-0000-4000-8000-000000000001";
const periodKey = "2026-05-16:2026-05-25:1-1";

class MockSupabaseQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private payload: Row | Row[] | null = null;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  select(_columns = "*") {
    return this;
  }

  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  single() {
    return this.execute().then((result) => ({
      ...result,
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
    }));
  }

  maybeSingle() {
    return this.single();
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private rows() {
    this.tables[this.table] ??= [];
    return this.tables[this.table];
  }

  private nextId() {
    return `${this.table}-${this.rows().length + 1}`;
  }

  private filteredRows() {
    return this.rows().filter((row) =>
      this.filters.every((filter) => filter(row))
    );
  }

  private async execute() {
    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.filter(Boolean).map((row) => ({
        id: row.id ?? this.nextId(),
        created_at: row.created_at ?? "2026-05-18T19:00:00.000Z",
        ...row,
      }));
      this.rows().push(...inserted);
      return { data: inserted, error: null };
    }

    if (this.op === "update") {
      const matches = this.filteredRows();
      for (const row of matches) Object.assign(row, this.payload);
      return { data: matches, error: null };
    }

    return { data: this.filteredRows(), error: null };
  }
}

function createMockClient(
  tables: Tables,
  options?: {
    user?: { id: string } | null;
    authError?: unknown;
  },
) {
  let authCalls = 0;
  const client = {
    auth: {
      getUser: (_token: string) => {
        authCalls += 1;
        return Promise.resolve({
          data: {
            user: options?.user === undefined ? { id: userId } : options.user,
          },
          error: options?.authError ?? null,
        });
      },
    },
    from: (table: string) => new MockSupabaseQuery(tables, table),
  };
  return Object.assign(client, { authCalls: () => authCalls });
}

function assertCorsHeaders(response: Response) {
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertStringIncludes(
    response.headers.get("Access-Control-Allow-Methods") ?? "",
    "POST",
  );
  assertStringIncludes(
    response.headers.get("Access-Control-Allow-Methods") ?? "",
    "OPTIONS",
  );
  const allowedHeaders = response.headers.get("Access-Control-Allow-Headers") ??
    "";
  assertStringIncludes(allowedHeaders, "authorization");
  assertStringIncludes(allowedHeaders, "apikey");
  assertStringIncludes(allowedHeaders, "content-type");
}

function ackRequest(body: Record<string, unknown>, token = "test-token") {
  return new Request("http://localhost/ack_maat_guidance", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("ack_maat_guidance handles browser preflight without auth", async () => {
  const client = createMockClient({});
  const handler = createAckMaatGuidanceHandler({ client });

  const response = await handler(
    new Request("http://localhost/ack_maat_guidance", { method: "OPTIONS" }),
  );

  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 0);
});

Deno.test("ack_maat_guidance keeps auth required for POST", async () => {
  const client = createMockClient({});
  const handler = createAckMaatGuidanceHandler({ client });

  const response = await handler(
    new Request("http://localhost/ack_maat_guidance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "Unauthorized");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 0);
});

Deno.test("ack_maat_guidance returns CORS headers for unsupported methods", async () => {
  const client = createMockClient({});
  const handler = createAckMaatGuidanceHandler({ client });

  const response = await handler(
    new Request("http://localhost/ack_maat_guidance", { method: "GET" }),
  );
  const body = await response.json();

  assertEquals(response.status, 405);
  assertEquals(body.error, "Method not allowed");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 0);
});

Deno.test("ack_maat_guidance rejects invalid bearer tokens", async () => {
  const client = createMockClient({}, {
    user: null,
    authError: new Error("bad token"),
  });
  const handler = createAckMaatGuidanceHandler({ client });

  const response = await handler(
    ackRequest({ delivery_id: "d1", action: "shown" }),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "Unauthorized");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 1);
});

Deno.test("ack_maat_guidance marks opening guidance shown", async () => {
  const tables: Tables = {
    maat_guidance_deliveries: [{
      id: "delivery-opening-shown",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "pending",
      cta_type: "flow_template",
      cta_ref: "the-weighing",
      payload: {},
      created_at: "2026-05-18T17:45:00.000Z",
      shown_at: null,
      opened_at: null,
      dismissed_at: null,
    }],
    maat_delivery_receipt_events: [],
  };
  const handler = createAckMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });

  const response = await handler(ackRequest({
    delivery_id: "delivery-opening-shown",
    action: "shown",
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertCorsHeaders(response);
  assertEquals(body.delivery.status, "shown");
  assertEquals(body.delivery.shown_at, "2026-05-18T19:00:00.000Z");
  assertEquals(body.delivery.opened_at, null);
  assertEquals(body.delivery.dismissed_at, null);
  assertEquals(body.delivery.payload.output_telemetry.user_saw_output, true);
  assertEquals(body.delivery.payload.output_telemetry.user_opened, false);
  assertEquals(body.delivery.payload.output_telemetry.dismissed, false);
  assertEquals(tables.maat_delivery_receipt_events[0].receipt_event, "shown");
});

Deno.test("ack_maat_guidance marks opening guidance opened", async () => {
  const tables: Tables = {
    maat_guidance_deliveries: [{
      id: "delivery-opening-opened",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "pending",
      cta_type: "flow_template",
      cta_ref: "the-weighing",
      payload: {},
      created_at: "2026-05-18T17:45:00.000Z",
      shown_at: null,
      opened_at: null,
      dismissed_at: null,
    }],
    maat_delivery_receipt_events: [],
  };
  const handler = createAckMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:05:00.000Z"),
  });

  const response = await handler(ackRequest({
    delivery_id: "delivery-opening-opened",
    action: "opened",
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertCorsHeaders(response);
  assertEquals(body.delivery.status, "opened");
  assertEquals(body.delivery.shown_at, "2026-05-18T19:05:00.000Z");
  assertEquals(body.delivery.opened_at, "2026-05-18T19:05:00.000Z");
  assertEquals(body.delivery.dismissed_at, null);
  assertEquals(body.delivery.payload.output_telemetry.user_saw_output, true);
  assertEquals(body.delivery.payload.output_telemetry.user_opened, true);
  assertEquals(body.delivery.payload.output_telemetry.dismissed, false);
  assertEquals(tables.maat_delivery_receipt_events[0].receipt_event, "opened");
});

Deno.test("ack_maat_guidance marks opening guidance dismissed", async () => {
  const tables: Tables = {
    maat_guidance_deliveries: [{
      id: "delivery-opening-dismissed",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      cta_type: "flow_template",
      cta_ref: "the-weighing",
      payload: {},
      created_at: "2026-05-18T17:45:00.000Z",
      shown_at: "2026-05-18T19:00:00.000Z",
      opened_at: null,
      dismissed_at: null,
    }],
    maat_delivery_receipt_events: [],
  };
  const handler = createAckMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:10:00.000Z"),
  });

  const response = await handler(ackRequest({
    delivery_id: "delivery-opening-dismissed",
    action: "dismissed",
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertCorsHeaders(response);
  assertEquals(body.delivery.status, "dismissed");
  assertEquals(body.delivery.shown_at, "2026-05-18T19:00:00.000Z");
  assertEquals(body.delivery.opened_at, null);
  assertEquals(body.delivery.dismissed_at, "2026-05-18T19:10:00.000Z");
  assertEquals(body.delivery.payload.output_telemetry.user_saw_output, true);
  assertEquals(body.delivery.payload.output_telemetry.user_opened, false);
  assertEquals(body.delivery.payload.output_telemetry.dismissed, true);
  assertEquals(
    tables.maat_delivery_receipt_events[0].receipt_event,
    "dismissed",
  );
});

Deno.test("ack_maat_guidance acted records suggestion and completes drift correction", async () => {
  const tables: Tables = {
    maat_guidance_deliveries: [{
      id: "delivery-drift-1",
      user_id: userId,
      kind: "drift_nudge",
      decan_period_key: periodKey,
      status: "shown",
      cta_type: "flow_template",
      cta_ref: "dawn-house-rite",
      payload: {
        output_control: {
          plan: { speechAct: "correct" },
          validation: { ok: true },
          grade: { pass: true, repairMode: "none" },
        },
      },
      created_at: "2026-05-18T17:45:00.000Z",
      shown_at: "2026-05-18T18:00:00.000Z",
      opened_at: null,
    }],
    maat_corrections: [{
      id: "correction-1",
      user_id: userId,
      decan_period_key: periodKey,
      status: "open",
      hard_gates: ["life_supporting_flow_disrupted"],
    }],
    maat_obligations: [{
      id: "obligation-1",
      user_id: userId,
      decan_period_key: periodKey,
      obligation_key: `${periodKey}:provision`,
      field: "provision",
      status: "open",
      metadata: {},
    }],
    maat_restoration_attempts: [{
      id: "attempt-1",
      user_id: userId,
      obligation_id: "obligation-1",
      delivery_id: "delivery-drift-1",
      delivery_kind: "drift_nudge",
      decan_period_key: periodKey,
      attempt_key: "delivery:delivery-drift-1",
      field: "provision",
      action_text: "complete one nutrition check today",
      direction: "tend",
      status: "suggested",
      suggested_at: "2026-05-18T17:45:00.000Z",
      metadata: {},
    }],
    user_choice_events: [],
    maat_delivery_receipt_events: [],
  };
  const handler = createAckMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });

  const response = await handler(
    new Request("http://localhost/ack_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        delivery_id: "delivery-drift-1",
        action: "acted",
        metadata: {
          delivery_channel: "in_app_card",
          local_hour_shown: 20,
          user_session_state: "returning",
          was_interruptive: true,
        },
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertCorsHeaders(response);
  assertEquals(body.delivery.status, "acted");
  assertEquals(body.delivery.acted_at, "2026-05-18T19:00:00.000Z");
  assertEquals(body.delivery.opened_at, "2026-05-18T19:00:00.000Z");
  assertEquals(body.delivery.shown_at, "2026-05-18T18:00:00.000Z");
  assertEquals(
    body.delivery.payload.output_telemetry.version,
    "maat_output_truth_loop_v1",
  );
  assertEquals(body.delivery.payload.output_telemetry.speech_act, "correct");
  assertEquals(body.delivery.payload.output_telemetry.user_acted, true);
  assertEquals(body.delivery.payload.output_telemetry.time_to_act_minutes, 60);
  assertEquals(
    body.delivery.payload.output_telemetry.delivery_channel,
    "in_app_card",
  );
  assertEquals(body.delivery.payload.output_telemetry.local_hour_shown, 20);
  assertEquals(
    body.delivery.payload.output_telemetry.user_session_state,
    "returning",
  );
  assertEquals(body.delivery.payload.output_telemetry.was_interruptive, true);

  assertEquals(tables.maat_corrections[0].status, "completed");
  assertEquals(
    tables.maat_corrections[0].completed_at,
    "2026-05-18T19:00:00.000Z",
  );

  const accepted = tables.user_choice_events.find((row) =>
    row.event_type === "suggestion_accepted"
  );
  assert(accepted);
  assertEquals(accepted.metadata.delivery_id, "delivery-drift-1");
  assertEquals(accepted.metadata.cta_type, "flow_template");
  assertEquals(accepted.metadata.cta_ref, "dawn-house-rite");

  assertEquals(tables.maat_delivery_receipt_events.length, 1);
  assertEquals(
    tables.maat_delivery_receipt_events[0].delivery_key,
    "maat_guidance:delivery-drift-1",
  );
  assertEquals(
    tables.maat_delivery_receipt_events[0].delivery_kind,
    "drift_nudge",
  );
  assertEquals(tables.maat_delivery_receipt_events[0].receipt_event, "acted");
  assertEquals(tables.maat_delivery_receipt_events[0].user_id, userId);
  assertEquals(
    tables.maat_delivery_receipt_events[0].metadata.source,
    "ack_maat_guidance",
  );
  assertEquals(tables.maat_restoration_attempts[0].status, "acted");
  assertEquals(
    tables.maat_restoration_attempts[0].acted_at,
    "2026-05-18T19:00:00.000Z",
  );
  assertEquals(tables.maat_obligations[0].status, "acted");
  assertEquals(
    tables.maat_obligations[0].acted_at,
    "2026-05-18T19:00:00.000Z",
  );

  const completed = tables.user_choice_events.find((row) =>
    row.event_type === "maat_correction_completed"
  );
  assert(completed);
  assertEquals(completed.metadata.correction_id, "correction-1");
  assertEquals(completed.metadata.delivery_id, "delivery-drift-1");
  assertEquals(completed.metadata.completion_source, "drift_cta_acted");
});

Deno.test("ack_maat_guidance dismissed drift dismisses open correction", async () => {
  const tables: Tables = {
    maat_guidance_deliveries: [{
      id: "delivery-drift-2",
      user_id: userId,
      kind: "drift_nudge",
      decan_period_key: periodKey,
      status: "shown",
      cta_type: "node",
      cta_ref: "instruction_amenemope",
      payload: {},
      created_at: "2026-05-18T17:45:00.000Z",
      shown_at: "2026-05-18T18:00:00.000Z",
      dismissed_at: null,
    }],
    maat_corrections: [{
      id: "correction-2",
      user_id: userId,
      decan_period_key: periodKey,
      status: "open",
      hard_gates: ["vulnerable_deprivation"],
    }],
    user_choice_events: [],
  };
  const handler = createAckMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:30:00.000Z"),
  });

  const response = await handler(
    new Request("http://localhost/ack_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        delivery_id: "delivery-drift-2",
        action: "dismissed",
        metadata: {
          delivery_channel: "push",
          local_hour_shown: 19,
          user_session_state: "inactive",
        },
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertCorsHeaders(response);
  assertEquals(body.delivery.status, "dismissed");
  assertEquals(body.delivery.dismissed_at, "2026-05-18T19:30:00.000Z");
  assertEquals(body.delivery.payload.output_telemetry.dismissed, true);
  assertEquals(body.delivery.payload.output_telemetry.user_saw_output, true);
  assertEquals(body.delivery.payload.output_telemetry.delivery_channel, "push");
  assertEquals(body.delivery.payload.output_telemetry.local_hour_shown, 19);
  assertEquals(
    body.delivery.payload.output_telemetry.user_session_state,
    "inactive",
  );

  assertEquals(tables.maat_corrections[0].status, "dismissed");
  assertEquals(
    tables.maat_corrections[0].dismissed_at,
    "2026-05-18T19:30:00.000Z",
  );

  const dismissed = tables.user_choice_events.find((row) =>
    row.event_type === "maat_correction_dismissed"
  );
  assert(dismissed);
  assertEquals(dismissed.metadata.correction_id, "correction-2");
  assertEquals(dismissed.metadata.delivery_id, "delivery-drift-2");
  assertEquals(dismissed.metadata.completion_source, "drift_dismissed");
});
