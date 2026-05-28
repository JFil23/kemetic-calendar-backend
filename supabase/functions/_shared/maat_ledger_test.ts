// deno-lint-ignore-file no-explicit-any no-import-prefix

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  applyMaatLedgerHealthGuardrails,
  buildPlannerMaatLedger,
  isResolutionClosing,
  maatLedgerPayload,
  recordMaatRestorationOutcome,
  recordMaatRestorationSuggested,
} from "./maat_ledger.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class MockQuery {
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

  maybeSingle() {
    return Promise.resolve(this.execute()).then((result) => ({
      ...result,
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
    }));
  }

  single() {
    return this.maybeSingle();
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
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

  private execute() {
    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.filter(Boolean).map((row) => ({
        id: row.id ?? this.nextId(),
        created_at: row.created_at ?? "2026-05-23T12:00:00.000Z",
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

function client(tables: Tables) {
  return {
    from: (table: string) => new MockQuery(tables, table),
  };
}

Deno.test("Ma'at resolution confidence policy closes only traceable matches", () => {
  assertEquals(isResolutionClosing("exact_source_match"), true);
  assertEquals(isResolutionClosing("same_kind_same_day"), true);
  assertEquals(isResolutionClosing("same_axis_same_decan"), true);
  assertEquals(isResolutionClosing("fallback_axis_match"), false);
  assertEquals(isResolutionClosing(null), false);
  assertEquals(isResolutionClosing(undefined), false);
});

Deno.test("Ma'at ledger stores suggested restoration and tracks action outcome", async () => {
  const tables: Tables = {};
  const ledger = buildPlannerMaatLedger({
    total: 3,
    todoDone: 0,
    todoPartial: 0,
    todoSkipped: 0,
    todoPending: 1,
    nutritionDone: 0,
    nutritionPartial: 0,
    nutritionSkipped: 0,
    nutritionPending: 2,
  });

  await recordMaatRestorationSuggested({
    client: client(tables),
    userId: "user-1",
    decanPeriodKey: "2026-05-16:2026-05-25:1-1",
    deliveryId: "delivery-1",
    deliveryKind: "drift_nudge",
    ctaType: "flow_personalized",
    ctaRef: "brief-1",
    triggerReason: "decan_day_5_isfet",
    payload: maatLedgerPayload(ledger),
    nowIso: "2026-05-23T12:00:00.000Z",
  });

  assertEquals(tables.maat_obligations.length, 1);
  assertEquals(tables.maat_obligations[0].field, "visible_work");
  assertEquals(tables.maat_obligations[0].status, "open");
  assertEquals(tables.maat_obligations[0].open_count, 1);
  assertEquals(
    tables.maat_obligations[0].suggested_restoration.action,
    "complete one to-do with a clear finish condition",
  );

  assertEquals(tables.maat_restoration_attempts.length, 1);
  assertEquals(tables.maat_restoration_attempts[0].status, "suggested");
  assertEquals(tables.maat_restoration_attempts[0].field, "visible_work");
  assertEquals(
    tables.maat_restoration_attempts[0].action_text,
    "complete one to-do with a clear finish condition",
  );

  await recordMaatRestorationOutcome({
    client: client(tables),
    userId: "user-1",
    deliveryId: "delivery-1",
    action: "opened",
    nowIso: "2026-05-23T12:05:00.000Z",
  });
  assertEquals(tables.maat_restoration_attempts[0].status, "opened");
  assertEquals(
    tables.maat_restoration_attempts[0].opened_at,
    "2026-05-23T12:05:00.000Z",
  );
  assertEquals(tables.maat_obligations[0].status, "open");

  await recordMaatRestorationOutcome({
    client: client(tables),
    userId: "user-1",
    deliveryId: "delivery-1",
    action: "acted",
    metadata: { flow_id: 42 },
    nowIso: "2026-05-23T12:08:00.000Z",
  });
  assertEquals(tables.maat_restoration_attempts[0].status, "acted");
  assertEquals(tables.maat_restoration_attempts[0].metadata.flow_id, 42);
  assertEquals(tables.maat_obligations[0].status, "acted");
  assertEquals(
    tables.maat_obligations[0].acted_at,
    "2026-05-23T12:08:00.000Z",
  );
});

Deno.test("Ma'at ledger reduces scope when acted restorations stay unresolved", () => {
  const ledger = buildPlannerMaatLedger({
    total: 3,
    todoDone: 0,
    todoPartial: 0,
    todoSkipped: 0,
    todoPending: 2,
    nutritionDone: 0,
    nutritionPartial: 0,
    nutritionSkipped: 0,
    nutritionPending: 1,
  });

  const guarded = applyMaatLedgerHealthGuardrails(
    ledger,
    [{
      obligation_id: "obligation-1",
      field: "visible_work",
      needs_scope_reduction: true,
      obligation_acted_at: "2026-05-22T08:00:00.000Z",
      acted_count: 2,
      resolved_count: 0,
      repeat_leak_count: 3,
    }],
    new Date("2026-05-23T12:00:00.000Z"),
  );

  assertEquals(guarded.suggested_restoration?.field, "visible_work");
  assertEquals(guarded.suggested_restoration?.direction, "reduce");
  assertEquals(
    guarded.suggested_restoration?.action,
    "tend to visible work by finishing one small part, or release the task that no longer belongs today",
  );
  assertEquals(guarded.stalled_restoration?.repeat_leak_count, 3);
  assertEquals(guarded.stalled_restoration?.age_hours, 28);
  assertEquals(
    guarded.stalled_restoration?.source_obligation_id,
    "obligation-1",
  );
});

Deno.test("Ma'at ledger does not reopen resolved or released restorations", async () => {
  const tables: Tables = {};
  const ledger = buildPlannerMaatLedger({
    total: 1,
    todoDone: 0,
    todoPartial: 0,
    todoSkipped: 0,
    todoPending: 1,
    nutritionDone: 0,
    nutritionPartial: 0,
    nutritionSkipped: 0,
    nutritionPending: 0,
  });

  await recordMaatRestorationSuggested({
    client: client(tables),
    userId: "user-1",
    decanPeriodKey: "2026-05-16:2026-05-25:1-1",
    deliveryId: "delivery-1",
    deliveryKind: "drift_nudge",
    ctaType: "flow_template",
    ctaRef: "dawn-house-rite",
    triggerReason: "first",
    payload: maatLedgerPayload(ledger),
    nowIso: "2026-05-23T12:00:00.000Z",
  });

  tables.maat_obligations[0].status = "released";
  tables.maat_obligations[0].released_at = "2026-05-23T12:10:00.000Z";

  const releasedResult = await recordMaatRestorationSuggested({
    client: client(tables),
    userId: "user-1",
    decanPeriodKey: "2026-05-16:2026-05-25:1-1",
    deliveryId: "delivery-2",
    deliveryKind: "drift_nudge",
    ctaType: "flow_template",
    ctaRef: "dawn-house-rite",
    triggerReason: "repeat",
    payload: maatLedgerPayload(ledger),
    nowIso: "2026-05-23T12:20:00.000Z",
  });

  assertEquals(releasedResult?.attempt, null);
  assertEquals(tables.maat_obligations[0].status, "released");
  assertEquals(tables.maat_restoration_attempts.length, 1);

  tables.maat_obligations[0].status = "resolved";
  tables.maat_obligations[0].resolved_at = "2026-05-23T12:30:00.000Z";

  const resolvedResult = await recordMaatRestorationSuggested({
    client: client(tables),
    userId: "user-1",
    decanPeriodKey: "2026-05-16:2026-05-25:1-1",
    deliveryId: "delivery-3",
    deliveryKind: "drift_nudge",
    ctaType: "flow_template",
    ctaRef: "dawn-house-rite",
    triggerReason: "repeat",
    payload: maatLedgerPayload(ledger),
    nowIso: "2026-05-23T12:40:00.000Z",
  });

  assertEquals(resolvedResult?.attempt, null);
  assertEquals(tables.maat_obligations[0].status, "resolved");
  assertEquals(tables.maat_restoration_attempts.length, 1);
});
