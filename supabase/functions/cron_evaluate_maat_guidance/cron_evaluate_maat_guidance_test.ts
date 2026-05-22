// deno-lint-ignore-file no-explicit-any

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createCronEvaluateMaatGuidanceHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class MockSupabaseQuery {
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private orderColumn: string | null = null;
  private orderAscending = true;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  select(_columns = "*") {
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
