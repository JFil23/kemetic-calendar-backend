// deno-lint-ignore-file no-explicit-any

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createCronMaatDecanOpeningHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const userId = "00000000-0000-4000-8000-000000000001";
const periodKey = "2026-05-16:2026-05-25:1-1";

class MockSupabaseQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private payload: Row | Row[] | null = null;
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

  limit(count: number) {
    return this.range(0, count - 1);
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

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
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
    const rows = this.rows().filter((row) =>
      this.filters.every((filter) => filter(row))
    );
    if (this.orderColumn) {
      rows.sort((a, b) => {
        const left = a[this.orderColumn!];
        const right = b[this.orderColumn!];
        if (left === right) return 0;
        const comparison = left > right ? 1 : -1;
        return this.orderAscending ? comparison : -comparison;
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      return rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    return rows;
  }

  private async execute() {
    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.filter(Boolean).map((row) => ({
        id: row.id ?? this.nextId(),
        created_at: row.created_at ?? "2026-05-16T12:00:00.000Z",
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

function createMockClient(tables: Tables) {
  return {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({ data: { user: { id: userId } }, error: null }),
    },
    from: (table: string) => new MockSupabaseQuery(tables, table),
  };
}

async function withCronSecret<T>(run: () => Promise<T>) {
  const previousSecret = Deno.env.get("MAAT_CRON_SECRET");
  Deno.env.set("MAAT_CRON_SECRET", "test-secret");
  try {
    return await run();
  } finally {
    if (previousSecret == null) {
      Deno.env.delete("MAAT_CRON_SECRET");
    } else {
      Deno.env.set("MAAT_CRON_SECRET", previousSecret);
    }
  }
}

function cronRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/cron_maat_decan_opening", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": "test-secret",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("cron_maat_decan_opening creates one opening and expires stale rows", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "maat", score: 1 }],
      tension_pairs: [],
      last_computed_at: "2026-05-16T00:00:00.000Z",
    }],
    reflection_generations: [],
    maat_guidance_deliveries: [{
      id: "stale-opening",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: "2026-05-06:2026-05-15:old",
      status: "shown",
      priority: 10,
      created_at: "2026-05-06T12:00:00.000Z",
    }],
  };

  const handler = createCronMaatDecanOpeningHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-16T18:00:00.000Z"),
  });

  const response = await handler(
    new Request("http://localhost/cron_maat_decan_opening", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
        day_card: {
          date: "2026-05-16",
          maatPrinciple: "Record honestly",
          decanDayAction: "Write one true mark",
        },
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.created, true);
  assertEquals(body.delivery.kind, "decan_opening");
  assertEquals(body.delivery.decan_period_key, periodKey);
  assertEquals(body.delivery.status, "pending");
  assertEquals(body.delivery.cta_type, "flow_template");
  assertEquals(body.delivery.cta_ref, "the-decan-watch");
  assertEquals(
    body.delivery.payload.compiled_output_package.package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    body.delivery.payload.compiled_output_package.final_text,
    body.delivery.body_text,
  );
  assertEquals(
    body.delivery.payload.compiled_output_package.destination.ref,
    "the-decan-watch",
  );
  assertEquals(body.delivery.payload.output_compiler.surface, "opening");
  assertEquals(body.delivery.payload.output_compiler.status, "compiled");
  assertEquals(
    body.delivery.payload.notification_track,
    "decan_context_opening",
  );
  assertEquals(
    body.delivery.payload.content_source,
    "calendar_month_decan_day1_context",
  );
  assertEquals(body.delivery.payload.profile_personalization_used, false);
  assertEquals(body.delivery.payload.month_short, "Thoth");
  assertEquals(body.delivery.payload.decan_short_name, "tpy-ꜥ sbꜣw");

  const stale = tables.maat_guidance_deliveries.find((row) =>
    row.id === "stale-opening"
  );
  assertEquals(stale?.status, "expired");
  assertEquals(stale?.expired_at, "2026-05-16T18:00:00.000Z");

  assertEquals(tables.reflection_generations.length, 1);
  assertEquals(
    tables.reflection_generations[0].metadata.notification_track,
    "decan_context_opening",
  );
  assertEquals(
    tables.reflection_generations[0].source_snapshot
      .profile_personalization_used,
    false,
  );
  assertEquals(
    tables.reflection_generations[0].source_snapshot.source_scope,
    "calendar_context_only",
  );
  assertEquals(
    tables.reflection_generations[0].source_snapshot.month_short,
    "Thoth",
  );
});

Deno.test("cron_maat_decan_opening sends one push for a new opening", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_generations: [],
    maat_guidance_deliveries: [],
    maat_delivery_timing_events: [],
  };
  const pushCalls: Array<Record<string, any>> = [];

  await withCronSecret(async () => {
    const handler = createCronMaatDecanOpeningHandler({
      client: createMockClient(tables),
      now: () => new Date("2026-05-16T18:00:00.000Z"),
      sendPush: async (params) => {
        pushCalls.push(params);
        return { ok: true, sent: 1, delivered: true };
      },
    });

    const response = await handler(
      cronRequest({
        limit: 1,
        batch_size: 1,
        timezone: "America/Los_Angeles",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.created, 1);
    assertEquals(body.push_sent, 1);
    assertEquals(pushCalls.length, 1);
    const delivery = tables.maat_guidance_deliveries[0];
    assertEquals(delivery.push_sent_at, "2026-05-16T18:00:00.000Z");
    assertEquals(delivery.push_error, null);
    assertEquals(delivery.push_attempt_count, 1);
    assertEquals(pushCalls[0].userId, userId);
    assertEquals(pushCalls[0].title, "A new decan opens");
    assertEquals(pushCalls[0].data.kind, "maat_guidance");
    assertEquals(pushCalls[0].data.guidance_id, delivery.id);
    assertEquals(pushCalls[0].data.delivery_id, delivery.id);
    assertEquals(pushCalls[0].data.guidance_kind, "decan_context_opening");
    assertEquals(
      pushCalls[0].data.deep_link,
      `/maat-guidance/${delivery.id}`,
    );
    assertEquals(
      pushCalls[0].data.link,
      `/maat-guidance/${delivery.id}`,
    );
    assertEquals(pushCalls[0].data.cta_kind, "flow_template");
    assertEquals(pushCalls[0].data.cta_id, "the-decan-watch");
    assertEquals(
      pushCalls[0].data.delivery_key,
      `maat_guidance:${delivery.id}`,
    );
  });
});

Deno.test("cron_maat_decan_opening does not resend when push_sent_at is set", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_generations: [],
    maat_guidance_deliveries: [{
      id: "opening",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "pending",
      priority: 10,
      teaser_text: "Begin with measure.",
      body_text: "Begin with measure.",
      payload: {
        compiled_output_package: {
          package_version: "compiled_output_package_v1",
          final_text: "Begin with measure.",
          push_text: "Begin with measure.",
          delivery_recommendation: "in_app_card",
        },
      },
      cta_type: "flow_template",
      cta_ref: "the-decan-watch",
      push_sent_at: "2026-05-16T17:00:00.000Z",
      push_attempt_count: 1,
      created_at: "2026-05-16T12:00:00.000Z",
    }],
  };
  let pushCount = 0;

  await withCronSecret(async () => {
    const handler = createCronMaatDecanOpeningHandler({
      client: createMockClient(tables),
      now: () => new Date("2026-05-16T18:00:00.000Z"),
      sendPush: async () => {
        pushCount += 1;
        return { ok: true, sent: 1, delivered: true };
      },
    });

    const response = await handler(
      cronRequest({
        limit: 1,
        timezone: "America/Los_Angeles",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(pushCount, 0);
    assertEquals(body.push_sent, 0);
    assertEquals(body.push_skipped, 1);
    assertEquals(tables.maat_guidance_deliveries[0].push_attempt_count, 1);
  });
});

Deno.test("cron_maat_decan_opening records failed push attempts", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_generations: [],
    maat_guidance_deliveries: [],
  };

  await withCronSecret(async () => {
    const handler = createCronMaatDecanOpeningHandler({
      client: createMockClient(tables),
      now: () => new Date("2026-05-16T18:00:00.000Z"),
      sendPush: async () => ({
        ok: false,
        delivered: false,
        error: "fcm_unavailable",
      }),
    });

    const response = await handler(
      cronRequest({
        limit: 1,
        timezone: "America/Los_Angeles",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
      }),
    );
    const body = await response.json();
    const delivery = tables.maat_guidance_deliveries[0];

    assertEquals(response.status, 200);
    assertEquals(body.push_sent, 0);
    assertEquals(body.push_failed, 1);
    assertEquals(delivery.push_sent_at, undefined);
    assertEquals(delivery.push_error, "fcm_unavailable");
    assertEquals(delivery.push_attempt_count, 1);
    assertEquals(delivery.push_last_attempt_at, "2026-05-16T18:00:00.000Z");
  });
});

Deno.test("cron_maat_decan_opening enriches generic pending opening with day card", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [],
    reflection_generations: [],
    maat_guidance_deliveries: [{
      id: "opening",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "pending",
      priority: 10,
      teaser_text: "This decan asks for truth to become practical.",
      body_text: "This decan opens through Thoth - measure.",
      payload: {
        lead_axis: "M",
        day_card_date: null,
      },
      cta_type: "none",
      cta_ref: null,
      generation_id: "generic-generation",
      trigger_reason: "decan_boundary",
      created_at: "2026-05-16T12:00:00.000Z",
    }],
  };

  const handler = createCronMaatDecanOpeningHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-16T18:00:00.000Z"),
  });

  const response = await handler(
    new Request("http://localhost/cron_maat_decan_opening", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
        day_card: {
          date: "2026-05-16",
          maatPrinciple: "Record honestly",
          decanDayAction: "Write one true mark",
        },
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.created, false);
  assertEquals(body.enriched, true);
  assertEquals(body.delivery.id, "opening");
  assertEquals(tables.maat_guidance_deliveries.length, 1);
  assertEquals(tables.reflection_generations.length, 1);
  assertEquals(
    tables.reflection_generations[0].source_snapshot.day_card.maatPrinciple,
    "Record honestly",
  );

  const opening = tables.maat_guidance_deliveries[0];
  assertEquals(opening.payload.day_card_date, "2026-05-16");
  assertEquals(opening.generation_id, "reflection_generations-1");
  assert(opening.body_text.includes("Write one true mark"));
  assert(opening.payload.output_control);
  assertEquals(opening.payload.notification_track, "decan_context_opening");
  assertEquals(
    opening.payload.content_source,
    "calendar_month_decan_day1_context",
  );
  assertEquals(opening.payload.profile_personalization_used, false);
  assertEquals(
    opening.payload.compiled_output_package.package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    opening.payload.compiled_output_package.final_text,
    opening.body_text,
  );
  assertEquals(opening.payload.output_compiler.status, "compiled");
  assertEquals(
    opening.payload.output_control_policy_version,
    "output_control_v1",
  );
  assert(opening.payload.surface_variants?.context_card?.rows?.length > 0);
});

Deno.test("cron_maat_decan_opening refreshes stale generic pending opening shape", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "maat", score: 1 }],
      tension_pairs: [],
      last_computed_at: "2026-05-16T00:00:00.000Z",
    }],
    reflection_generations: [],
    maat_guidance_deliveries: [{
      id: "opening",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "pending",
      priority: 10,
      teaser_text: "This decan asks for truth to become practical.",
      body_text: "This decan opens through Thoth - measure.",
      payload: {
        lead_axis: "M",
        day_card_date: null,
        node_ref: "maat",
        output_control: {},
      },
      cta_type: "node",
      cta_ref: "maat",
      generation_id: "generic-generation",
      trigger_reason: "decan_boundary",
      created_at: "2026-05-16T12:00:00.000Z",
    }],
  };

  const handler = createCronMaatDecanOpeningHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-16T18:00:00.000Z"),
  });

  const response = await handler(
    new Request("http://localhost/cron_maat_decan_opening", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
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
  assertEquals(body.created, false);
  assertEquals(body.enriched, true);
  assertEquals(body.refreshed, false);
  assertEquals(body.delivery.id, "opening");
  assertEquals(tables.maat_guidance_deliveries.length, 1);
  assertEquals(tables.reflection_generations.length, 1);

  const opening = tables.maat_guidance_deliveries[0];
  assertEquals(opening.cta_type, "flow_template");
  assertEquals(opening.cta_ref, "the-decan-watch");
  assertEquals(opening.payload.node_ref, "maat");
  assertEquals(opening.payload.day_card_date, "2026-05-16");
  assertEquals(opening.payload.notification_track, "decan_context_opening");
  assertEquals(
    opening.payload.compiled_output_package.package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    opening.payload.compiled_output_package.final_text,
    opening.body_text,
  );
  assertEquals(
    opening.payload.compiled_output_package.destination.ref,
    "the-decan-watch",
  );
  assertEquals(opening.payload.output_compiler.surface, "opening");
  assert(opening.body_text.includes("Speak your intention"));
});

Deno.test("cron_maat_decan_opening can re-enrich opened stale opening when day card returns", async () => {
  const tables: Tables = {
    profiles: [{ id: userId, timezone: "America/Los_Angeles" }],
    reflection_profiles: [{
      user_id: userId,
      top_nodes: [{ slug: "maat", score: 1 }],
      tension_pairs: [],
      last_computed_at: "2026-05-16T00:00:00.000Z",
    }],
    reflection_generations: [],
    maat_guidance_deliveries: [{
      id: "opening",
      user_id: userId,
      kind: "decan_opening",
      decan_period_key: periodKey,
      status: "opened",
      priority: 10,
      teaser_text:
        "This decan asks for truth to become practical. Today's card names Record honestly; its action is Write one true mark.",
      body_text:
        "Today's card names Record honestly; its action is Write one true mark.",
      payload: {
        lead_axis: "M",
        day_card_date: "2026-05-16",
      },
      cta_type: "none",
      cta_ref: null,
      generation_id: "generic-generation",
      trigger_reason: "decan_boundary",
      created_at: "2026-05-16T12:00:00.000Z",
    }],
  };

  const handler = createCronMaatDecanOpeningHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-16T18:00:00.000Z"),
  });

  const response = await handler(
    new Request("http://localhost/cron_maat_decan_opening", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        decan_start: "2026-05-16",
        decan_end: "2026-05-25",
        decan_name: "Thoth - measure",
        decan_theme: "measure",
        decan_context_key: "1-1",
        day_card: {
          date: "2026-05-16",
          maatPrinciple: "Record honestly",
          decanDayAction: "Write one true mark",
        },
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.created, false);
  assertEquals(body.enriched, true);
  assertEquals(body.refreshed, false);

  const opening = tables.maat_guidance_deliveries[0];
  assertEquals(opening.status, "opened");
  assertEquals(opening.cta_type, "flow_template");
  assertEquals(opening.cta_ref, "the-decan-watch");
  assert(opening.body_text.includes("Today centers Record honestly"));
  assert(opening.payload.surface_variants?.context_card?.rows?.length > 0);
  assertEquals(opening.payload.notification_track, "decan_context_opening");
  assertEquals(
    opening.payload.compiled_output_package.package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    opening.payload.compiled_output_package.final_text,
    opening.body_text,
  );
  assert(!opening.teaser_text.includes("Today's card names"));
});

Deno.test("cron_maat_decan_opening pages through cron profile batches", async () => {
  const ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];
  const tables: Tables = {
    profiles: ids.map((id) => ({ id, timezone: "America/Los_Angeles" })),
    reflection_profiles: [],
    reflection_generations: [],
    maat_guidance_deliveries: [],
    maat_delivery_timing_events: [],
  };

  await withCronSecret(async () => {
    const handler = createCronMaatDecanOpeningHandler({
      client: createMockClient(tables),
      now: () => new Date("2026-05-16T18:00:00.000Z"),
      sendPush: async () => ({ ok: true, sent: 1, delivered: true }),
    });

    const response = await handler(
      new Request("http://localhost/cron_maat_decan_opening", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cron-secret": "test-secret",
        },
        body: JSON.stringify({
          limit: 3,
          batch_size: 2,
          timezone: "America/Los_Angeles",
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
    assertEquals(body.processed, 3);
    assertEquals(body.created, 3);
    assertEquals(body.failed, 0);
    assertEquals(body.batches, 2);
    assertEquals(body.drained, false);
    assertEquals(body.exhausted_limit, true);
    assertEquals(tables.maat_guidance_deliveries.length, 3);
    const sent = tables.maat_delivery_timing_events.find((row) =>
      row.delivery_status === "sent"
    );
    assertEquals(sent?.metadata.notification_track, "decan_context_opening");
    assertEquals(sent?.metadata.profile_personalization_used, false);
    assertEquals(sent?.metadata.push_source, "compiled_package.push_text");
    assertEquals(sent?.metadata.push_blocked, false);
    for (const delivery of tables.maat_guidance_deliveries) {
      assertEquals(
        delivery.payload.notification_track,
        "decan_context_opening",
      );
      assertEquals(delivery.payload.profile_personalization_used, false);
      assertEquals(delivery.push_sent_at, "2026-05-16T18:00:00.000Z");
    }
  });
});
