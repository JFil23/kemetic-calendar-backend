// deno-lint-ignore-file no-explicit-any

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { computeCurrentAndNextDecanWindows } from "../_shared/decan_schedule.ts";
import { decanPeriodKey } from "../_shared/maat_guidance.ts";
import { createFetchMaatGuidancePendingHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-06-10T12:00:00.000Z");
const nowIso = now.toISOString();

function currentPeriodKey() {
  const current = computeCurrentAndNextDecanWindows(
    now,
    "America/Los_Angeles",
  )[0];
  return decanPeriodKey({
    start: current.start,
    end: current.end,
    decanName: current.decanName,
    decanTheme: current.decanTheme,
    decanContextKey: current.decanContextKey,
  });
}

class MockSupabaseQuery {
  private op: "select" | "update" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private sorts: Array<{ column: string; ascending: boolean }> = [];
  private maxRows: number | null = null;
  private payload: Row | null = null;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  select(_columns = "*") {
    this.op = "select";
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

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.sorts.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.maxRows = count;
    return this;
  }

  maybeSingle() {
    return this.execute().then((result) => ({
      ...result,
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
    }));
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

  private filteredRows() {
    return this.rows().filter((row) =>
      this.filters.every((filter) => filter(row))
    );
  }

  private sortedRows(rows: Row[]) {
    return [...rows].sort((left, right) => {
      for (const sort of this.sorts) {
        const leftValue = left[sort.column];
        const rightValue = right[sort.column];
        if (leftValue === rightValue) continue;
        const direction = leftValue < rightValue ? -1 : 1;
        return sort.ascending ? direction : -direction;
      }
      return 0;
    });
  }

  private async execute() {
    const matches = this.filteredRows();

    if (this.op === "update") {
      for (const row of matches) Object.assign(row, this.payload);
      return { data: matches, error: null };
    }

    const sorted = this.sortedRows(matches);
    const limited = this.maxRows == null
      ? sorted
      : sorted.slice(0, this.maxRows);
    return { data: limited, error: null };
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
  return {
    client,
    authCalls: () => authCalls,
  };
}

function pendingRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/fetch_maat_guidance_pending", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("fetch_maat_guidance_pending handles browser preflight without auth", async () => {
  const mock = createMockClient({});
  const handler = createFetchMaatGuidancePendingHandler({
    client: mock.client,
    now: () => now,
  });

  const response = await handler(
    new Request("http://localhost/fetch_maat_guidance_pending", {
      method: "OPTIONS",
    }),
  );

  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
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
  assertEquals(mock.authCalls(), 0);
});

Deno.test("fetch_maat_guidance_pending keeps auth required for POST", async () => {
  const mock = createMockClient({});
  const handler = createFetchMaatGuidancePendingHandler({
    client: mock.client,
    now: () => now,
  });

  const response = await handler(
    new Request("http://localhost/fetch_maat_guidance_pending", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "Unauthorized");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(mock.authCalls(), 0);
});

Deno.test("fetch_maat_guidance_pending rejects invalid bearer tokens", async () => {
  const mock = createMockClient({}, {
    user: null,
    authError: new Error("bad token"),
  });
  const handler = createFetchMaatGuidancePendingHandler({
    client: mock.client,
    now: () => now,
  });

  const response = await handler(pendingRequest());
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "Unauthorized");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(mock.authCalls(), 1);
});

Deno.test("fetch_maat_guidance_pending fetches requested delivery for the authenticated user", async () => {
  const tables: Tables = {
    maat_guidance_deliveries: [
      { id: "delivery-1", user_id: userId, status: "shown" },
      { id: "delivery-1", user_id: otherUserId, status: "shown" },
    ],
  };
  const mock = createMockClient(tables);
  const handler = createFetchMaatGuidancePendingHandler({
    client: mock.client,
    now: () => now,
  });

  const response = await handler(pendingRequest({ delivery_id: "delivery-1" }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(body.delivery.id, "delivery-1");
  assertEquals(body.delivery.user_id, userId);
});

Deno.test("fetch_maat_guidance_pending returns current pending guidance and expires stale rows", async () => {
  const periodKey = currentPeriodKey();
  const stalePeriodKey = "2026-05-29:2026-06-07:2-3";
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    maat_guidance_deliveries: [
      {
        id: "later-current",
        user_id: userId,
        decan_period_key: periodKey,
        status: "pending",
        priority: 20,
        created_at: "2026-06-10T08:00:00.000Z",
      },
      {
        id: "first-current",
        user_id: userId,
        decan_period_key: periodKey,
        status: "shown",
        priority: 10,
        created_at: "2026-06-10T09:00:00.000Z",
      },
      {
        id: "dismissed-current",
        user_id: userId,
        decan_period_key: periodKey,
        status: "dismissed",
        priority: 1,
        created_at: "2026-06-10T07:00:00.000Z",
      },
      {
        id: "stale-pending",
        user_id: userId,
        decan_period_key: stalePeriodKey,
        status: "pending",
        priority: 1,
        created_at: "2026-05-30T08:00:00.000Z",
      },
      {
        id: "other-user-current",
        user_id: otherUserId,
        decan_period_key: periodKey,
        status: "pending",
        priority: 1,
        created_at: "2026-06-10T07:00:00.000Z",
      },
    ],
  };
  const mock = createMockClient(tables);
  const handler = createFetchMaatGuidancePendingHandler({
    client: mock.client,
    now: () => now,
  });

  const response = await handler(pendingRequest());
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(body.delivery.id, "first-current");
  assertEquals(tables.maat_guidance_deliveries[3].status, "expired");
  assertEquals(tables.maat_guidance_deliveries[3].expired_at, nowIso);
  assertEquals(tables.maat_guidance_deliveries[4].status, "pending");
});

Deno.test("fetch_maat_guidance_pending returns CORS headers for unsupported methods", async () => {
  const mock = createMockClient({});
  const handler = createFetchMaatGuidancePendingHandler({
    client: mock.client,
    now: () => now,
  });

  const response = await handler(
    new Request("http://localhost/fetch_maat_guidance_pending", {
      method: "GET",
    }),
  );

  assertEquals(response.status, 405);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(mock.authCalls(), 0);
});
