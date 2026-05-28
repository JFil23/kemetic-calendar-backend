// deno-lint-ignore-file no-explicit-any

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createRecordDeliveryReceiptHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const userId = "00000000-0000-4000-8000-000000000001";

class MockSupabaseQuery {
  private payload: Row | Row[] | null = null;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  insert(payload: Row | Row[]) {
    this.payload = payload;
    return this;
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

  private execute() {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted = rows.filter(Boolean).map((row) => ({ ...row }));
    this.rows().push(...inserted);
    return Promise.resolve({ data: inserted, error: null });
  }
}

function createMockClient(tables: Tables, authed = true) {
  return {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({
          data: { user: authed ? { id: userId } : null },
          error: authed ? null : new Error("bad token"),
        }),
    },
    from: (table: string) => new MockSupabaseQuery(tables, table),
  };
}

Deno.test("record_delivery_receipt records an authenticated receipt event", async () => {
  const tables: Tables = {};
  const handler = createRecordDeliveryReceiptHandler({
    client: createMockClient(tables),
    now: () => new Date("2026-05-23T12:00:00.000Z"),
  });

  const response = await handler(
    new Request("http://localhost/record_delivery_receipt", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        delivery_key: "reminder:abc:2026-05-23T11:59:00.000Z",
        receipt_event: "opened",
        device_id: "device-1",
        platform: "ios",
        message_id: "message-1",
        metadata: { route: "tap" },
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.ok, true);
  assertEquals(tables.maat_delivery_receipt_events.length, 1);
  assertEquals(
    tables.maat_delivery_receipt_events[0].delivery_key,
    "reminder:abc:2026-05-23T11:59:00.000Z",
  );
  assertEquals(
    tables.maat_delivery_receipt_events[0].delivery_kind,
    "reminder",
  );
  assertEquals(tables.maat_delivery_receipt_events[0].receipt_event, "opened");
  assertEquals(tables.maat_delivery_receipt_events[0].user_id, userId);
  assertEquals(
    tables.maat_delivery_receipt_events[0].metadata.source,
    "record_delivery_receipt",
  );
});

Deno.test("record_delivery_receipt rejects invalid receipt events", async () => {
  const handler = createRecordDeliveryReceiptHandler({
    client: createMockClient({}),
  });

  const response = await handler(
    new Request("http://localhost/record_delivery_receipt", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        delivery_key: "reminder:abc",
        receipt_event: "invented",
      }),
    }),
  );
  const body = await response.text();

  assertEquals(response.status, 400);
  assertStringIncludes(body, "Invalid payload");
});

Deno.test("record_delivery_receipt handles browser preflight", async () => {
  const handler = createRecordDeliveryReceiptHandler({
    client: createMockClient({}),
  });

  const response = await handler(
    new Request("http://localhost/record_delivery_receipt", {
      method: "OPTIONS",
    }),
  );

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});
