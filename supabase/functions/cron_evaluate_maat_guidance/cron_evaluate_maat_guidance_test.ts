// deno-lint-ignore-file no-explicit-any

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createCronEvaluateMaatGuidanceHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class MockSupabaseQuery {
  private op: "select" | "insert" = "select";
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private orderColumn: string | null = null;
  private orderAscending = true;
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

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    if (this.op === "insert") {
      this.tables[this.table] ??= [];
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.filter(Boolean).map((row) => ({
        id: row.id ?? `${this.table}-${this.tables[this.table].length + 1}`,
        created_at: row.created_at ?? "2026-05-18T12:00:00.000Z",
        ...row,
      }));
      this.tables[this.table].push(...inserted);
      return { data: inserted, error: null };
    }

    let rows = [...(this.tables[this.table] ?? [])];
    if (this.orderColumn) {
      rows = rows.sort((a, b) => {
        const left = a[this.orderColumn!];
        const right = b[this.orderColumn!];
        if (left === right) return 0;
        const comparison = left > right ? 1 : -1;
        return this.orderAscending ? comparison : -comparison;
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    return { data: rows, error: null };
  }
}

function createMockClient(tables: Tables) {
  return {
    from: (table: string) => new MockSupabaseQuery(tables, table),
  };
}

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/cron_evaluate_maat_guidance", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": "test-secret",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("cron_evaluate_maat_guidance evaluates matching local-hour users", async () => {
  const previousSecret = Deno.env.get("MAAT_CRON_SECRET");
  Deno.env.set("MAAT_CRON_SECRET", "test-secret");
  const calls: Array<{ userId: string; timezone: string }> = [];
  try {
    const handler = createCronEvaluateMaatGuidanceHandler({
      client: createMockClient({
        profiles: [
          { id: "user-a", timezone: "America/Los_Angeles" },
          { id: "user-b", timezone: "America/New_York" },
        ],
      }),
      now: () => new Date("2026-05-18T07:10:00.000Z"),
      evaluateUser: async ({ userId, timezone }) => {
        calls.push({ userId, timezone });
        return { status: 200, data: { evaluation: { id: `eval-${userId}` } } };
      },
    });

    const res = await handler(request({ local_hour: 0 }));
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body.processed, 2);
    assertEquals(body.evaluated, 1);
    assertEquals(body.skipped, 1);
    assertEquals(calls, [{
      userId: "user-a",
      timezone: "America/Los_Angeles",
    }]);
  } finally {
    if (previousSecret === undefined) {
      Deno.env.delete("MAAT_CRON_SECRET");
    } else {
      Deno.env.set("MAAT_CRON_SECRET", previousSecret);
    }
  }
});

Deno.test("cron_evaluate_maat_guidance records day-five cadence timing metadata", async () => {
  const previousSecret = Deno.env.get("MAAT_CRON_SECRET");
  Deno.env.set("MAAT_CRON_SECRET", "test-secret");
  const tables: Tables = {
    profiles: [{ id: "user-a", timezone: "America/Los_Angeles" }],
    maat_delivery_timing_events: [],
  };
  try {
    const handler = createCronEvaluateMaatGuidanceHandler({
      client: createMockClient(tables),
      now: () => new Date("2026-05-20T07:05:00.000Z"),
      evaluateUser: async () => ({
        status: 200,
        data: {
          created: [{
            id: "delivery-day-five",
            user_id: "user-a",
            kind: "strength_nudge",
            status: "pending",
            decan_period_key: "2026-05-16:2026-05-25:1-1",
            trigger_reason: "decan_day_5_maat",
            payload: {
              cadence_type: "decan_day_5",
              cadence_mode: "maat",
              compiled_output_package: {
                package_version: "compiled_output_package_v1",
                final_text: "Compiled day-five strength nudge.",
                teaser_text: "Compiled day-five strength nudge.",
                push_text: "Compiled day-five push.",
                fallback_used: false,
                not_quality_proof: false,
                delivery_recommendation: "push",
              },
            },
          }],
        },
      }),
    });

    const res = await handler(request({
      local_hour: 0,
      scheduled_at: "2026-05-20T07:05:00.000Z",
    }));
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body.evaluated, 1);
    assertEquals(tables.maat_delivery_timing_events.length, 2);
    const sent = tables.maat_delivery_timing_events.find((row) =>
      row.delivery_status === "sent"
    );
    assertEquals(sent?.delivery_key, "maat_guidance:delivery-day-five");
    assertEquals(sent?.delivery_kind, "strength_nudge");
    assertEquals(sent?.metadata.trigger_reason, "decan_day_5_maat");
    assertEquals(sent?.metadata.cadence_type, "decan_day_5");
    assertEquals(sent?.metadata.cadence_mode, "maat");
    assertEquals(sent?.metadata.push_source, "compiled_package.push_text");
    assertEquals(sent?.metadata.push_blocked, false);
  } finally {
    if (previousSecret === undefined) {
      Deno.env.delete("MAAT_CRON_SECRET");
    } else {
      Deno.env.set("MAAT_CRON_SECRET", previousSecret);
    }
  }
});

Deno.test("cron_evaluate_maat_guidance force evaluates all users and reports failures", async () => {
  const previousSecret = Deno.env.get("MAAT_CRON_SECRET");
  Deno.env.set("MAAT_CRON_SECRET", "test-secret");
  try {
    const handler = createCronEvaluateMaatGuidanceHandler({
      client: createMockClient({
        profiles: [
          { id: "user-a", timezone: "America/Los_Angeles" },
          { id: "user-b", timezone: "America/New_York" },
        ],
      }),
      now: () => new Date("2026-05-18T12:00:00.000Z"),
      evaluateUser: async ({ userId }) => ({
        status: userId === "user-b" ? 500 : 200,
        data: { userId },
      }),
    });

    const res = await handler(request({ force: true }));
    const body = await res.json();

    assertEquals(res.status, 207);
    assertEquals(body.evaluated, 1);
    assertEquals(body.failed, 1);
    assertEquals(body.skipped, 0);
  } finally {
    if (previousSecret === undefined) {
      Deno.env.delete("MAAT_CRON_SECRET");
    } else {
      Deno.env.set("MAAT_CRON_SECRET", previousSecret);
    }
  }
});
