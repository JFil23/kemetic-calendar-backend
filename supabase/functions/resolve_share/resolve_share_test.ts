import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createResolveShareHandler } from "./index.ts";
const id = "00000000-0000-4000-8000-000000000001";
const share = {
  id,
  sender_id: "sender",
  recipient_id: "recipient",
  payload_json: {
    name: "Shared Flow",
    appearance: { version: 1 },
    events: [{ title: "Published event" }],
  },
  suggested_schedule: { start: "2026-11-12" },
};
function setup(
  account: string | null = "recipient",
  row: Record<string, unknown> | null = share,
) {
  let reads = 0;
  const handler = createResolveShareHandler({
    getUser: () => Promise.resolve(account ? { id: account } : null),
    readShare: () => {
      reads++;
      return Promise.resolve(row);
    },
  });
  return { handler, reads: () => reads };
}
function request(body: unknown = { share_id: id }, token = "user-token") {
  return new Request("http://localhost/resolve_share", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
Deno.test("share preview preserves the complete published snapshot for recipient and sender", async () => {
  for (const account of ["recipient", "sender"]) {
    const test = setup(account);
    const result = await test.handler(request());
    assertEquals(result.status, 200);
    const body = await result.json();
    assertEquals(body.flow, share.payload_json);
    assertEquals(body.suggested_schedule, share.suggested_schedule);
    assertEquals(test.reads(), 1);
  }
});
Deno.test("unrelated accounts and copied invite tokens cannot read a share", async () => {
  const test = setup("unrelated");
  assertEquals(
    (await test.handler(request({ share_id: id, token: "copied-token" })))
      .status,
    404,
  );
});
Deno.test("invalid sessions never reach a share read", async () => {
  const test = setup(null);
  assertEquals((await test.handler(request())).status, 401);
  assertEquals(test.reads(), 0);
  assertEquals(
    (await test.handler(
      new Request("http://localhost", { method: "POST", body: "{}" }),
    )).status,
    401,
  );
  assertEquals(test.reads(), 0);
});
Deno.test("deleted, missing and incomplete shares remain unavailable", async () => {
  for (
    const row of [null, { ...share, deleted_at: "2026-11-10" }, {
      ...share,
      payload_json: null,
    }]
  ) {
    assertEquals(
      (await setup("recipient", row).handler(request())).status,
      404,
    );
  }
});
Deno.test("invalid payload and method perform no share read", async () => {
  const test = setup();
  for (
    const body of [{}, null, { share_id: "wrong" }, {
      share_id: id,
      padding: "x".repeat(9000),
    }]
  ) assertEquals((await test.handler(request(body))).status, 400);
  assertEquals(
    (await test.handler(new Request("http://localhost"))).status,
    405,
  );
  assertEquals(test.reads(), 0);
  assertEquals(
    (await test.handler(new Request("http://localhost", { method: "OPTIONS" })))
      .status,
    204,
  );
});
Deno.test("preview failures do not reveal database details", async () => {
  const handler = createResolveShareHandler({
    getUser: () => Promise.resolve({ id: "recipient" }),
    readShare: () => {
      throw new Error("sensitive database error");
    },
  });
  const result = await handler(request());
  assertEquals(result.status, 500);
  assertEquals(await result.json(), { error: "preview_unavailable" });
});
