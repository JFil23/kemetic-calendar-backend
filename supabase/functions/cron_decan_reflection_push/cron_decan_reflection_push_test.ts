// deno-lint-ignore-file no-explicit-any no-import-prefix

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createCronDecanReflectionPushHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type FunctionInvokeOptions = { body?: Row };
type PushInvokeBody = Row & {
  notification?: Row;
  data?: Row;
};

const nowIso = "2026-05-19T12:00:00.000Z";
const baseConfig = {
  cronSecret: "cron-secret",
  internalFunctionKey: "internal-key",
  claimLimit: 1,
  claimLeaseSeconds: 900,
  maxAttempts: 3,
  maxBatches: 5,
  maxRuntimeMs: 300_000,
  seedBatchSize: 500,
};

class MockSupabaseQuery {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private rangeBounds: { from: number; to: number } | null = null;
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

  upsert(payload: Row | Row[]) {
    this.op = "upsert";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.rangeBounds = { from, to };
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
    let rows = this.rows().filter((row) =>
      this.filters.every((filter) => filter(row))
    );
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        if (a[column] === b[column]) return 0;
        return (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1);
      });
    }
    if (this.rangeBounds) {
      rows = rows.slice(this.rangeBounds.from, this.rangeBounds.to + 1);
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private execute() {
    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.filter(Boolean).map((row) => ({
        id: row.id ?? this.nextId(),
        created_at: row.created_at ?? nowIso,
        ...row,
      }));
      this.rows().push(...inserted);
      return Promise.resolve({ data: inserted, error: null });
    }

    if (this.op === "update") {
      const matches = this.filteredRows();
      for (const row of matches) Object.assign(row, this.payload);
      return Promise.resolve({ data: matches, error: null });
    }

    if (this.op === "upsert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted: Row[] = [];
      for (const row of rows.filter(Boolean)) {
        const existing = this.rows().find((candidate) =>
          candidate.user_id === row.user_id &&
          candidate.decan_start === row.decan_start
        );
        if (existing) {
          Object.assign(existing, row);
          continue;
        }
        const next = {
          id: row.id ?? this.nextId(),
          created_at: row.created_at ?? nowIso,
          ...row,
        };
        this.rows().push(next);
        inserted.push(next);
      }
      return Promise.resolve({ data: inserted, error: null });
    }

    return Promise.resolve({ data: this.filteredRows(), error: null });
  }
}

function scheduleRow(id: string, userId: string): Row {
  return {
    id,
    user_id: userId,
    decan_start: "2026-05-06",
    decan_end: "2026-05-15",
    send_at: "2026-05-16T03:00:00.000Z",
    status: "pending",
    decan_name: "Peret - Measure",
    decan_theme: "Measure",
    decan_context_key: "2-1",
    attempt_count: 0,
    claimed_at: null,
    claim_token: null,
    sent_at: null,
    last_error: null,
  };
}

function createMockClient(
  tables: Tables,
  options?: {
    rpcError?: unknown;
    pushResults?: SendPushResult[];
    reflectionData?: Row;
  },
) {
  const stats = {
    rpcCalls: 0,
    invoked: [] as string[],
    pushBodies: [] as PushInvokeBody[],
  };

  const client = {
    from: (table: string) => new MockSupabaseQuery(tables, table),
    rpc: (name: string, args: Record<string, unknown>) => {
      stats.rpcCalls += 1;
      if (options?.rpcError) {
        return Promise.resolve({ data: null, error: options.rpcError });
      }
      assertEquals(name, "claim_due_decan_reflection_schedule");
      const limit = Number(args.p_limit ?? 25);
      const pNow = String(args.p_now);
      const claimToken = `claim-${stats.rpcCalls}`;
      const due = (tables.decan_reflection_schedule ?? [])
        .filter((row) => row.status === "pending" && row.send_at <= pNow)
        .sort((a, b) => a.send_at.localeCompare(b.send_at))
        .slice(0, limit);
      for (const row of due) {
        row.status = "claimed";
        row.claimed_at = pNow;
        row.claim_token = claimToken;
      }
      return Promise.resolve({
        data: due.map((row) => ({
          id: row.id,
          user_id: row.user_id,
          decan_start: row.decan_start,
          decan_end: row.decan_end,
          decan_name: row.decan_name,
          decan_theme: row.decan_theme,
          decan_context_key: row.decan_context_key,
          attempt_count: row.attempt_count,
          claim_token: claimToken,
        })),
        error: null,
      });
    },
    functions: {
      invoke: (name: string, invokeOptions?: FunctionInvokeOptions) => {
        stats.invoked.push(name);
        if (name === "ai_generate_reflection") {
          return Promise.resolve({
            data: options?.reflectionData ?? {
              reflection: "A generated decan reflection.",
              badgeCount: 2,
              outputControl: {
                compiledOutputPackage: {
                  package_version: "compiled_output_package_v1",
                  final_text: "A generated decan reflection.",
                  teaser_text: "Compiled reflection teaser.",
                  push_text: "Compiled reflection push.",
                  fallback_used: false,
                  not_quality_proof: false,
                  delivery_recommendation: "push",
                },
              },
            },
            error: null,
          });
        }
        if (name === "send_push") {
          stats.pushBodies.push((invokeOptions?.body ?? {}) as PushInvokeBody);
          return Promise.resolve({
            data: options?.pushResults?.shift() ?? pushDelivered(),
            error: null,
          });
        }
        return Promise.resolve({
          data: null,
          error: new Error(`unexpected invoke ${name}`),
        });
      },
    },
  };

  return { client, stats };
}

type SendPushResult = {
  sent: number;
  failed: number;
  stale: number;
  matchedTokens: number;
  delivered: boolean;
  reason?: string;
  failedReasons?: string[];
};

function pushDelivered(): SendPushResult {
  return {
    sent: 1,
    failed: 0,
    stale: 0,
    matchedTokens: 1,
    delivered: true,
  };
}

function noPushToken(): SendPushResult {
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

function cronRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/cron_decan_reflection_push", {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "test" }),
  });
}

Deno.test("cron_decan_reflection_push drains due batches and keeps no-token rows out of sent", async () => {
  const tables: Tables = {
    profiles: [],
    decan_reflection_schedule: [
      scheduleRow("schedule-1", "user-1"),
      scheduleRow("schedule-2", "user-2"),
    ],
    decan_reflections: [],
  };
  const { client, stats } = createMockClient(tables, {
    pushResults: [pushDelivered(), noPushToken()],
  });
  const handler = createCronDecanReflectionPushHandler({
    client,
    config: baseConfig,
    now: () => new Date(nowIso),
  });

  const response = await handler(
    cronRequest({ "x-cron-secret": "cron-secret" }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.processed, 2);
  assertEquals(body.claimed, 2);
  assertEquals(body.delivered, 1);
  assertEquals(body.no_push_token, 1);
  assertEquals(body.failed, 0);
  assertEquals(body.batches, 2);
  assertEquals(body.drained, true);

  assertEquals(tables.decan_reflection_schedule[0].status, "sent");
  assert(tables.decan_reflection_schedule[0].sent_at);
  assertEquals(tables.decan_reflection_schedule[1].status, "no_push_token");
  assertEquals(tables.decan_reflection_schedule[1].sent_at, null);
  assertEquals(
    tables.decan_reflection_schedule[1].last_error,
    "no_tokens_for_recipients",
  );
  assertEquals(tables.decan_reflections.length, 2);
  for (const push of stats.pushBodies) {
    const reflectionId = push.data?.reflectionId;
    const userId = Array.isArray(push.userIds) ? push.userIds[0] : null;
    assert(
      tables.decan_reflections.some((row) =>
        row.id === reflectionId && row.user_id === userId
      ),
    );
  }
  assertEquals(
    stats.pushBodies[0].notification.body,
    "Compiled reflection push.",
  );
  assertEquals(
    stats.pushBodies[0].data.push_source,
    "compiled_package.push_text",
  );
  assertEquals(
    stats.pushBodies[0].data.compiled_output_package.package_version,
    "compiled_output_package_v1",
  );
});

Deno.test("cron_decan_reflection_push blocks fallback-quality compiled push text", async () => {
  const tables: Tables = {
    profiles: [],
    decan_reflection_schedule: [scheduleRow("schedule-1", "user-1")],
    decan_reflections: [],
    maat_delivery_timing_events: [],
  };
  const { client, stats } = createMockClient(tables, {
    reflectionData: {
      reflection: "Fallback reflection text.",
      badgeCount: 2,
      outputControl: {
        compiledOutputPackage: {
          package_version: "compiled_output_package_v1",
          final_text: "Fallback reflection text.",
          push_text: "This must not push.",
          fallback_used: true,
          not_quality_proof: true,
          delivery_recommendation: "archive_only",
        },
      },
    },
  });
  const handler = createCronDecanReflectionPushHandler({
    client,
    config: baseConfig,
    now: () => new Date(nowIso),
  });

  const response = await handler(
    cronRequest({ "x-cron-secret": "cron-secret" }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(body.delivered, 0);
  assertEquals(body.blocked, 1);
  assertEquals(tables.decan_reflection_schedule[0].status, "skipped");
  assertEquals(
    tables.decan_reflection_schedule[0].last_error,
    "compiled_package_not_quality_proof",
  );
  assertEquals(stats.invoked, ["ai_generate_reflection"]);
  const skipped = tables.maat_delivery_timing_events.find((row) =>
    row.delivery_status === "skipped"
  );
  assertEquals(skipped?.skip_reason, "compiled_package_not_quality_proof");
  assertEquals(skipped?.metadata.push_source, "blocked_fallback");
});

Deno.test("cron_decan_reflection_push rejects calls without the cron secret before claiming rows", async () => {
  const tables: Tables = {
    profiles: [],
    decan_reflection_schedule: [scheduleRow("schedule-1", "user-1")],
    decan_reflections: [],
  };
  const { client, stats } = createMockClient(tables);
  const handler = createCronDecanReflectionPushHandler({
    client,
    config: baseConfig,
    now: () => new Date(nowIso),
  });

  const response = await handler(cronRequest());
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.success, false);
  assertEquals(stats.rpcCalls, 0);
  assertEquals(tables.decan_reflection_schedule[0].status, "pending");
});

Deno.test("cron_decan_reflection_push returns a failing cron result on claim errors", async () => {
  const tables: Tables = {
    profiles: [],
    decan_reflection_schedule: [scheduleRow("schedule-1", "user-1")],
    decan_reflections: [],
  };
  const { client } = createMockClient(tables, {
    rpcError: new Error("rpc unavailable"),
  });
  const handler = createCronDecanReflectionPushHandler({
    client,
    config: baseConfig,
    now: () => new Date(nowIso),
  });

  const response = await handler(
    cronRequest({ "x-cron-secret": "cron-secret" }),
  );
  const body = await response.json();

  assertEquals(response.status, 500);
  assertEquals(body.success, false);
  assert(String(body.error).includes("Claim error"));
  assertEquals(tables.decan_reflection_schedule[0].status, "pending");
});
