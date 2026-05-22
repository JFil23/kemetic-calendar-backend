// deno-lint-ignore-file no-explicit-any

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createEvaluateMaatGuidanceHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const userId = "00000000-0000-4000-8000-000000000001";
const periodKey = "2026-05-16:2026-05-25:1-1";

class MockSupabaseQuery {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private payload: Row | Row[] | null = null;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  select(_columns = "*") {
    if (!this.op) this.op = "select";
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

  upsert(payload: Row) {
    this.op = "upsert";
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

  gte(column: string, value: unknown) {
    this.filters.push((row) => row[column] >= value);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push((row) => row[column] <= value);
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
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private async execute() {
    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.filter(Boolean).map((row) => ({
        id: row.id ?? this.nextId(),
        created_at: row.created_at ?? "2026-05-18T12:00:00.000Z",
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

    if (this.op === "upsert") {
      const row = this.payload as Row;
      const existing = this.rows().find((candidate) =>
        candidate.user_id === row.user_id &&
        candidate.window_date === row.window_date &&
        candidate.decan_period_key === row.decan_period_key
      );
      if (existing) {
        Object.assign(existing, row);
        return { data: [existing], error: null };
      }
      const inserted = {
        id: row.id ?? this.nextId(),
        created_at: row.created_at ?? "2026-05-18T12:00:00.000Z",
        updated_at: row.updated_at ?? "2026-05-18T12:00:00.000Z",
        ...row,
      };
      this.rows().push(inserted);
      return { data: [inserted], error: null };
    }

    return { data: this.filteredRows(), error: null };
  }
}

function createMockClient(tables: Tables) {
  return {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({ data: { user: { id: userId } }, error: null }),
    },
    from: (table: string) => new MockSupabaseQuery(tables, table),
  };
}

function snapshotRow(overrides: Row = {}) {
  return {
    id: "snapshot-prior",
    user_id: userId,
    window_date: "2026-05-17",
    decan_period_key: periodKey,
    window_start: "2026-05-16",
    window_end: "2026-05-25",
    dimensions: { T: 0, M: 0, H: 0, V: 0, J: 0, S: 0, E: 0, R: 0, C: 0 },
    score: 0,
    band: "mixed",
    reflection_move: "inquire",
    lead_axis: "M",
    correction_axes: [],
    hard_gates: [],
    source: {
      planner_total: 0,
      completed_planner: 0,
      partial_planner: 0,
      skipped_planner: 0,
      details_coverage: 0,
      days_active: 1,
    },
    created_at: "2026-05-17T12:00:00.000Z",
    updated_at: "2026-05-17T12:00:00.000Z",
    ...overrides,
  };
}

Deno.test("evaluate_maat_guidance persists evaluation, expires stale deliveries, and honors drift cap", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "maat", score: 1 }],
      tension_pairs: [],
      maat_score: 1,
      isfet_risk_score: 0,
      last_computed_at: "2026-05-18T00:00:00.000Z",
    }],
    journal_badges: [
      {
        user_id: userId,
        title: "Skipped nutrition: breakfast",
        details: "Provision was missed.",
        tags: ["planner", "kind:nutrition", "state:skipped"],
        occurred_on: "2026-05-16",
      },
      {
        user_id: userId,
        title: "Skipped nutrition: lunch",
        details: "Food and water were not protected.",
        tags: ["planner", "kind:nutrition", "state:skipped"],
        occurred_on: "2026-05-17",
      },
      {
        user_id: userId,
        title: "Skipped nutrition: dinner",
        details: "No food. No water.",
        tags: ["planner", "kind:nutrition", "state:skipped"],
        occurred_on: "2026-05-18",
      },
    ],
    maat_snapshots: [snapshotRow()],
    maat_corrections: [],
    maat_guidance_deliveries: [
      {
        id: "stale-opening",
        user_id: userId,
        kind: "decan_opening",
        decan_period_key: "2026-05-06:2026-05-15:old",
        status: "shown",
        priority: 10,
        created_at: "2026-05-06T12:00:00.000Z",
      },
      {
        id: "opening-current",
        user_id: userId,
        kind: "decan_opening",
        decan_period_key: periodKey,
        status: "shown",
        priority: 10,
        created_at: "2026-05-16T12:00:00.000Z",
      },
      {
        id: "drift-one",
        user_id: userId,
        kind: "drift_nudge",
        decan_period_key: periodKey,
        status: "dismissed",
        priority: 20,
        shown_at: "2026-05-16T12:00:00.000Z",
        created_at: "2026-05-16T12:00:00.000Z",
      },
      {
        id: "drift-two",
        user_id: userId,
        kind: "drift_nudge",
        decan_period_key: periodKey,
        status: "acted",
        priority: 20,
        shown_at: "2026-05-17T12:00:00.000Z",
        created_at: "2026-05-17T12:00:00.000Z",
      },
    ],
    maat_guidance_drift_outcome_flags: [{
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "winning",
      completed_window_count: 6,
      weighted_delta_done_rate: 0.08,
      weighted_delta_skipped_rate: -0.04,
    }],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-18",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.local_date, "2026-05-18");
  assertEquals(body.decan_day_index, 3);
  assertEquals(body.period_key, periodKey);
  assertEquals(body.drift_decision.reason, "cap_reached");
  assertEquals(body.strength_decision.reason, "not_ready");
  assertEquals(body.evaluation.decision.drift.reason, "cap_reached");
  assertEquals(body.created, []);
  assert(body.suppressed.includes("drift:cap_reached"));

  const stale = tables.maat_guidance_deliveries.find((row) =>
    row.id === "stale-opening"
  );
  assertEquals(stale?.status, "expired");
  assert(stale?.expired_at);

  const savedSnapshot = tables.maat_snapshots.find((row) =>
    row.window_date === "2026-05-18"
  );
  assert(savedSnapshot);
  assertEquals(savedSnapshot.band, "isfet_patterned");
  assertEquals(savedSnapshot.hard_gates, ["life_supporting_flow_disrupted"]);
  assertEquals(savedSnapshot.source.decision.drift.reason, "cap_reached");
  assertEquals(savedSnapshot.source.decision.cta_outcome_signals.length, 1);

  assertEquals(tables.maat_guidance_evaluations.length, 1);
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.gate_policy.g6_min_skips,
    2,
  );
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.cta_outcome_signals[0].ctaRef,
    "djehuty",
  );
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.cta_outcome_source,
    "global",
  );
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.personalized_flow_enabled,
    false,
  );

  assertEquals(tables.maat_corrections.length, 1);
  assertEquals(tables.maat_corrections[0].hard_gates, [
    "life_supporting_flow_disrupted",
  ]);
  assertEquals(
    tables.user_choice_events[0].event_type,
    "maat_correction_opened",
  );

  assertEquals(tables.maat_band_transitions.length, 1);
  assertEquals(tables.maat_band_transitions[0].from_band, "mixed");
  assertEquals(tables.maat_band_transitions[0].to_band, "isfet_patterned");

  const currentDrifts = tables.maat_guidance_deliveries.filter((row) =>
    row.decan_period_key === periodKey && row.kind === "drift_nudge"
  );
  assertEquals(currentDrifts.length, 2);
});

Deno.test("evaluate_maat_guidance creates drift delivery when cap allows", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "maat", score: 1 }],
      tension_pairs: [],
      maat_score: 1,
      isfet_risk_score: 0,
      last_computed_at: "2026-05-18T00:00:00.000Z",
    }],
    journal_badges: [
      {
        user_id: userId,
        title: "Skipped nutrition: lunch",
        details: "Food and water were not protected.",
        tags: ["planner", "kind:nutrition", "state:skipped"],
        occurred_on: "2026-05-17",
      },
      {
        user_id: userId,
        title: "Skipped nutrition: dinner",
        details: "No food. No water.",
        tags: ["planner", "kind:nutrition", "state:skipped"],
        occurred_on: "2026-05-18",
      },
    ],
    maat_snapshots: [snapshotRow()],
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags: [{
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "winning",
      completed_window_count: 6,
      weighted_delta_done_rate: 0.08,
      weighted_delta_skipped_rate: -0.04,
    }],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-18",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.drift.reason, "hard_gate");
  assertEquals(body.created.length, 1);
  assertEquals(body.created[0].kind, "drift_nudge");
  assertEquals(body.created[0].cta_type, "flow_template");
  assertEquals(body.created[0].cta_ref, "dawn-house-rite");
  assertEquals(body.evaluation.decision.personalized_flow_enabled, false);
  assertEquals(body.created[0].trigger_reason, "hard_gate");

  assertEquals(tables.maat_guidance_deliveries.length, 2);
  const drift = tables.maat_guidance_deliveries.find((row) =>
    row.kind === "drift_nudge"
  );
  assert(drift);
  assertEquals(drift.status, "pending");
  assertEquals(drift.cta_type, "flow_template");
  assertEquals(drift.cta_ref, "dawn-house-rite");
  assertEquals((tables.maat_flow_briefs ?? []).length, 0);

  assertEquals(
    tables.maat_guidance_evaluations[0].created_delivery_ids,
    [drift.id],
  );
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.cta_outcome_signals[0].ctaRef,
    "djehuty",
  );
  assertEquals(tables.maat_corrections.length, 1);
  assertEquals(
    tables.user_choice_events[0].event_type,
    "maat_correction_opened",
  );
});

Deno.test("evaluate_maat_guidance routes G4 vulnerable deprivation to Amenemope", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "instruction_amenemope", score: 1 }],
      tension_pairs: [],
      maat_score: 0.5,
      isfet_risk_score: 0.1,
      last_computed_at: "2026-05-18T00:00:00.000Z",
    }],
    journal_badges: [
      {
        user_id: userId,
        title: "Skipped care task: child medicine",
        details: "The dependent was left without support.",
        tags: ["planner", "kind:todo", "state:skipped"],
        occurred_on: "2026-05-17",
      },
      {
        user_id: userId,
        title: "Missed family care task: elder meal",
        details: "No food was prepared.",
        tags: ["planner", "kind:todo", "state:skipped"],
        occurred_on: "2026-05-18",
      },
    ],
    maat_snapshots: [snapshotRow()],
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags: [],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-18",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Amenemope - care",
        decan_theme: "care",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.hard_gates, [
    "vulnerable_deprivation",
  ]);
  assertEquals(body.created.length, 1);
  assertEquals(body.created[0].cta_type, "node");
  assertEquals(body.created[0].cta_ref, "instruction_amenemope");
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.gate_policy
      .g4_structural_enabled,
    true,
  );
});

Deno.test("evaluate_maat_guidance holds L3 corrupt judgment for review", async () => {
  const priorSnapshots = Array.from({ length: 9 }, (_, index) =>
    snapshotRow({
      id: `snapshot-prior-${index + 1}`,
      window_date: `2026-05-${String(9 + index).padStart(2, "0")}`,
    }));
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "maat", score: 1 }],
      tension_pairs: [],
      maat_score: 0.2,
      isfet_risk_score: 0.2,
      last_computed_at: "2026-05-18T00:00:00.000Z",
    }],
    journal_badges: [{
      user_id: userId,
      title: "Court record",
      details: "I accepted a bribe and twisted the court judgment.",
      tags: ["journal"],
      occurred_on: "2026-05-18",
    }],
    maat_snapshots: priorSnapshots,
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags: [{
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "winning",
      completed_window_count: 8,
      weighted_delta_done_rate: 0.08,
      weighted_delta_skipped_rate: -0.04,
    }],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-18",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Maat - judgment",
        decan_theme: "judgment",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.maturity.level, "L3");
  assertEquals(body.evaluation.decision.hard_gates, ["corrupt_judgment"]);
  assertEquals(body.evaluation.decision.drift.reason, "review_only_gate");
  assertEquals(body.created.length, 0);
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.gate_policy.g5_regex_enabled,
    true,
  );
  assertEquals(tables.maat_corrections.length, 1);
  assertEquals(tables.maat_corrections[0].payload.review_only, true);
});

Deno.test("evaluate_maat_guidance holds L3 malicious social disruption for review", async () => {
  const priorSnapshots = Array.from({ length: 9 }, (_, index) =>
    snapshotRow({
      id: `snapshot-g8-${index + 1}`,
      window_date: `2026-05-${String(9 + index).padStart(2, "0")}`,
    }));
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "maat", score: 1 }],
      tension_pairs: [],
      maat_score: 0.2,
      isfet_risk_score: 0.2,
      last_computed_at: "2026-05-18T00:00:00.000Z",
    }],
    journal_badges: [{
      user_id: userId,
      title: "Cohesion record",
      details:
        "I spread a rumor to harm the team and turned people against each other.",
      tags: ["journal"],
      occurred_on: "2026-05-18",
    }],
    maat_snapshots: priorSnapshots,
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags: [{
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "winning",
      completed_window_count: 8,
      weighted_delta_done_rate: 0.08,
      weighted_delta_skipped_rate: -0.04,
    }],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-18",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Maat - cohesion",
        decan_theme: "cohesion",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.maturity.level, "L3");
  assertEquals(body.evaluation.decision.hard_gates, [
    "malicious_social_disruption",
  ]);
  assertEquals(body.evaluation.decision.drift.reason, "review_only_gate");
  assertEquals(body.created.length, 0);
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.gate_policy.g8_regex_enabled,
    true,
  );
  assertEquals(tables.maat_corrections.length, 1);
  assertEquals(tables.maat_corrections[0].payload.review_only, true);
});

Deno.test("evaluate_maat_guidance falls back to cohort outcome signals before global", async () => {
  const strongSnapshot = {
    band: "maat",
    score: 65,
    reflection_move: "affirm",
    lead_axis: "M",
    correction_axes: [],
    hard_gates: [],
  };
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [],
      maat_score: 1,
      isfet_risk_score: 0,
      last_computed_at: "2026-05-19T00:00:00.000Z",
    }],
    journal_badges: [
      {
        user_id: userId,
        title: "Completed to-do: review",
        details: "Measured 30 minutes and recorded 4 notes.",
        tags: ["planner", "kind:todo", "state:done"],
        occurred_on: "2026-05-19",
      },
      {
        user_id: userId,
        title: "Completed nutrition: water",
        details: "Food and water protected.",
        tags: ["planner", "kind:nutrition", "state:done"],
        occurred_on: "2026-05-19",
      },
      {
        user_id: userId,
        title: "Completed to-do: care",
        details: "Helped family and reduced one burden.",
        tags: ["planner", "kind:todo", "state:done"],
        occurred_on: "2026-05-19",
      },
    ],
    maat_snapshots: [
      snapshotRow({
        id: "snapshot-cohort-1",
        window_date: "2026-05-18",
        ...strongSnapshot,
      }),
      snapshotRow({
        id: "snapshot-cohort-2",
        window_date: "2026-05-17",
        ...strongSnapshot,
      }),
    ],
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags_cohort: [{
      cohort_type: "maturity_level",
      cohort_key: "L2",
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "negative",
      completed_window_count: 8,
      weighted_delta_done_rate: -0.08,
      weighted_delta_skipped_rate: 0.03,
    }],
    maat_guidance_drift_outcome_flags: [{
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "winning",
      completed_window_count: 8,
      weighted_delta_done_rate: 0.08,
      weighted_delta_skipped_rate: -0.04,
    }],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-19T19:00:00.000Z"),
    personalizedFlowEnabled: true,
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-19",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.maturity.level, "L2");
  assertEquals(body.evaluation.decision.cta_outcome_source, "cohort");
  assertEquals(body.created[0].kind, "strength_nudge");
  assertEquals(body.created[0].cta_type, "flow_personalized");
  assertEquals(
    body.created[0].payload.fallback_template_key,
    "dawn-house-rite",
  );
});

Deno.test("evaluate_maat_guidance prefers goal-profile cohort before maturity cohort", async () => {
  const strongSnapshot = {
    band: "maat",
    score: 65,
    reflection_move: "affirm",
    lead_axis: "M",
    correction_axes: [],
    hard_gates: [],
  };
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [],
      maat_score: 1,
      isfet_risk_score: 0,
      last_computed_at: "2026-05-19T00:00:00.000Z",
    }],
    nutrition_items: [{
      id: "nutrition-goal-1",
      user_id: userId,
      nutrient: "water",
      purpose: "hydration",
      enabled: true,
    }],
    flows: [],
    journal_badges: [
      {
        user_id: userId,
        title: "Completed to-do: review",
        details: "Measured 30 minutes and recorded 4 notes.",
        tags: ["planner", "kind:todo", "state:done"],
        occurred_on: "2026-05-19",
      },
      {
        user_id: userId,
        title: "Completed nutrition: water",
        details: "Food and water protected.",
        tags: ["planner", "kind:nutrition", "state:done"],
        occurred_on: "2026-05-19",
      },
      {
        user_id: userId,
        title: "Completed to-do: care",
        details: "Helped family and reduced one burden.",
        tags: ["planner", "kind:todo", "state:done"],
        occurred_on: "2026-05-19",
      },
    ],
    maat_snapshots: [
      snapshotRow({
        id: "snapshot-goal-cohort-1",
        window_date: "2026-05-18",
        ...strongSnapshot,
      }),
      snapshotRow({
        id: "snapshot-goal-cohort-2",
        window_date: "2026-05-17",
        ...strongSnapshot,
      }),
    ],
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags_cohort: [{
      cohort_type: "goal_profile",
      cohort_key: "provision",
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "negative",
      completed_window_count: 8,
      weighted_delta_done_rate: -0.08,
      weighted_delta_skipped_rate: 0.03,
    }, {
      cohort_type: "maturity_level",
      cohort_key: "L4",
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "winning",
      completed_window_count: 8,
      weighted_delta_done_rate: 0.08,
      weighted_delta_skipped_rate: -0.04,
    }],
    maat_guidance_drift_outcome_flags: [],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-19T19:00:00.000Z"),
    personalizedFlowEnabled: true,
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-19",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Renenutet - provision",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.maturity.level, "L4");
  assertEquals(body.evaluation.decision.cta_outcome_source, "cohort");
  assertEquals(body.evaluation.decision.cta_outcome_cohort, {
    type: "goal_profile",
    key: "provision",
  });
  assertEquals(body.created[0].kind, "strength_nudge");
  assertEquals(body.created[0].cta_type, "flow_personalized");
  assertEquals(
    body.created[0].payload.fallback_template_key,
    "dawn-house-rite",
  );
});

Deno.test("evaluate_maat_guidance creates strength delivery after sustained strong snapshots", async () => {
  const strongSnapshot = {
    band: "maat",
    score: 65,
    reflection_move: "affirm",
    lead_axis: "M",
    correction_axes: [],
    hard_gates: [],
  };
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [],
      maat_score: 1,
      isfet_risk_score: 0,
      last_computed_at: "2026-05-19T00:00:00.000Z",
    }],
    journal_badges: [
      {
        user_id: userId,
        title: "Completed to-do: review",
        details: "Measured 30 minutes and recorded 4 notes.",
        tags: ["planner", "kind:todo", "state:done"],
        occurred_on: "2026-05-19",
      },
      {
        user_id: userId,
        title: "Completed nutrition: water",
        details: "Food and water protected.",
        tags: ["planner", "kind:nutrition", "state:done"],
        occurred_on: "2026-05-19",
      },
      {
        user_id: userId,
        title: "Completed to-do: care",
        details: "Helped family and reduced one burden.",
        tags: ["planner", "kind:todo", "state:done"],
        occurred_on: "2026-05-19",
      },
    ],
    maat_snapshots: [
      snapshotRow({
        id: "snapshot-strong-1",
        window_date: "2026-05-18",
        ...strongSnapshot,
      }),
      snapshotRow({
        id: "snapshot-strong-2",
        window_date: "2026-05-17",
        ...strongSnapshot,
      }),
    ],
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags: [{
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "winning",
      completed_window_count: 8,
      weighted_delta_done_rate: 0.08,
      weighted_delta_skipped_rate: -0.04,
    }],
    maat_guidance_drift_outcome_flags_user: [{
      user_id: userId,
      cta_type: "node",
      cta_ref: "djehuty",
      outcome_flag: "negative",
      completed_window_count: 6,
      weighted_delta_done_rate: -0.07,
      weighted_delta_skipped_rate: 0.04,
    }],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-19T19:00:00.000Z"),
    personalizedFlowEnabled: true,
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-19",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.strength.create, true);
  assertEquals(body.created.length, 1);
  assertEquals(body.created[0].kind, "strength_nudge");
  assertEquals(body.created[0].cta_type, "flow_personalized");
  assertEquals(
    body.created[0].payload.fallback_template_key,
    "dawn-house-rite",
  );
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.cta_outcome_signals[0].ctaRef,
    "djehuty",
  );
  assertEquals(
    tables.maat_guidance_evaluations[0].decision.cta_outcome_source,
    "user",
  );
});

Deno.test("evaluate_maat_guidance promotes nutrition goals to L4 tuned G6 policy", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "renenutet", score: 1 }],
      tension_pairs: [],
      maat_score: 0.4,
      isfet_risk_score: 0.1,
      last_computed_at: "2026-05-18T00:00:00.000Z",
    }],
    nutrition_items: [{
      id: "nutrition-goal-1",
      user_id: userId,
      nutrient: "water",
      purpose: "hydration",
      enabled: true,
    }],
    flows: [],
    journal_badges: [{
      user_id: userId,
      title: "Skipped nutrition: water",
      details: "No water protected today.",
      tags: ["planner", "kind:nutrition", "state:skipped"],
      occurred_on: "2026-05-18",
    }],
    maat_snapshots: [
      snapshotRow({ id: "snapshot-prior-1", window_date: "2026-05-17" }),
      snapshotRow({ id: "snapshot-prior-2", window_date: "2026-05-16" }),
    ],
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags: [],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
    personalizedFlowEnabled: true,
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-18",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Renenutet - provision",
        decan_theme: "provision",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.maturity.level, "L4");
  assertEquals(body.evaluation.decision.gate_policy.g6_min_skips, 1);
  assertEquals(body.evaluation.decision.goal_profile.key, "provision");
  assertEquals(body.evaluation.decision.hard_gates, [
    "life_supporting_flow_disrupted",
  ]);
  assertEquals(body.created[0].cta_type, "flow_personalized");
  assertEquals(
    body.created[0].payload.fallback_template_key,
    "dawn-house-rite",
  );
});

Deno.test("evaluate_maat_guidance promotes long history to L5 personal baseline drift", async () => {
  const priorSnapshots = Array.from({ length: 10 }, (_, index) =>
    snapshotRow({
      id: `snapshot-personal-${index + 1}`,
      window_date: `2026-05-${String(8 + index).padStart(2, "0")}`,
      band: "maat",
      score: 70,
      reflection_move: "affirm",
      lead_axis: "M",
      source: {
        planner_total: 2,
        completed_planner: 2,
        partial_planner: 0,
        skipped_planner: 0,
        details_coverage: 1,
        days_active: 1,
      },
    }));
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [],
      maat_score: 1,
      isfet_risk_score: 0,
      last_computed_at: "2026-05-18T00:00:00.000Z",
    }],
    nutrition_items: [],
    flows: [],
    journal_badges: [],
    maat_snapshots: priorSnapshots,
    maat_user_baselines: [],
    maat_corrections: [],
    maat_guidance_deliveries: [{
      id: "opening-current",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "shown",
      priority: 10,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
    maat_guidance_drift_outcome_flags: [],
    maat_guidance_evaluations: [],
    maat_band_transitions: [],
    user_choice_events: [],
  };

  const handler = createEvaluateMaatGuidanceHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-18T19:00:00.000Z"),
  });
  const response = await handler(
    new Request("http://localhost/evaluate_maat_guidance", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        local_date: "2026-05-18",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Djehuty - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.evaluation.decision.maturity.level, "L5");
  assertEquals(
    body.evaluation.decision.drift.reason,
    "personal_baseline_drop",
  );
  assertEquals(tables.maat_user_baselines.length, 1);
  assertEquals(tables.maat_user_baselines[0].stats.snapshot_count, 10);
  assertEquals(body.created[0].kind, "drift_nudge");
});
