// deno-lint-ignore-file no-explicit-any

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createGetDeliveryReceiptStatusHandler } from "./index.ts";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const userId = "00000000-0000-4000-8000-000000000001";

class MockSupabaseQuery {
  private filters: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  select(_columns = "*") {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  maybeSingle() {
    const rows = this.tables[this.table] ?? [];
    const match = rows.find((row) =>
      this.filters.every((filter) => filter(row))
    );
    return Promise.resolve({ data: match ?? null, error: null });
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

Deno.test("get_delivery_receipt_status returns a user's receipt health row", async () => {
  const tables: Tables = {
    maat_delivery_receipt_health: [{
      delivery_key: "push_test:user:device:time",
      user_id: userId,
      delivery_kind: "push_test",
      receipt_status: "opened",
      receipt_event_count: 2,
      receipt_latency_seconds: 4,
      open_latency_seconds: 19,
    }],
  };
  const handler = createGetDeliveryReceiptStatusHandler({
    client: createMockClient(tables),
  });

  const response = await handler(
    new Request("http://localhost/get_delivery_receipt_status", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        delivery_key: "push_test:user:device:time",
      }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.status, "found");
  assertEquals(body.receipt.receipt_status, "opened");
  assertEquals(body.receipt.open_latency_seconds, 19);
});

Deno.test("get_delivery_receipt_status does not expose another user's row", async () => {
  const tables: Tables = {
    maat_delivery_receipt_health: [{
      delivery_key: "push_test:other",
      user_id: "00000000-0000-4000-8000-000000000002",
      receipt_status: "opened",
    }],
  };
  const handler = createGetDeliveryReceiptStatusHandler({
    client: createMockClient(tables),
  });

  const response = await handler(
    new Request("http://localhost/get_delivery_receipt_status", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ delivery_key: "push_test:other" }),
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.status, "missing");
  assertEquals(body.receipt, null);
});

Deno.test("get_delivery_receipt_status rejects missing delivery keys", async () => {
  const handler = createGetDeliveryReceiptStatusHandler({
    client: createMockClient({}),
  });

  const response = await handler(
    new Request("http://localhost/get_delivery_receipt_status", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
  );
  const body = await response.text();

  assertEquals(response.status, 400);
  assertStringIncludes(body, "Invalid payload");
});
