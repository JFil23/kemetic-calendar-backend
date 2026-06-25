import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDmPushRequest,
  createSendDmMessageHandler,
  createSupabaseDmStore,
  type DmPushRequest,
  type SendDmMessageStore,
} from "./index.ts";
import { authorizeUserJwtDmPush } from "../send_push/user_jwt_dm_auth.ts";

function parseJsonRecord(value: unknown): Record<string, unknown> {
  const decoded: unknown = JSON.parse(String(value));
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new TypeError("Expected JSON object");
  }
  return decoded as Record<string, unknown>;
}

function dmRequest(body: Record<string, unknown>, token = "sender-token") {
  return new Request("https://example.test/functions/v1/send_dm_message", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createStore(options?: {
  authUserId?: string | null;
  recipientAccepts?: boolean;
  pushResult?: unknown;
}) {
  const insertedShares: Array<Record<string, unknown>> = [];
  const pushCalls: DmPushRequest[] = [];

  const store: SendDmMessageStore = {
    authenticate: () =>
      Promise.resolve(
        options?.authUserId === null
          ? null
          : { id: options?.authUserId ?? "user-a" },
      ),
    getRecipient: (recipientId) =>
      Promise.resolve({
        id: recipientId,
        allow_incoming_shares: options?.recipientAccepts ?? true,
      }),
    ensureDmPlaceholderFlow: () => Promise.resolve(42),
    insertMessageShare: (params) => {
      insertedShares.push(params);
      return Promise.resolve({ id: "share-1", status: "sent" });
    },
    getSenderLabel: () => Promise.resolve("User A"),
    sendPush: (request) => {
      pushCalls.push(request);
      return Promise.resolve(
        options?.pushResult ?? {
          sent: 1,
          failed: 0,
          stale: 0,
          matchedTokens: 1,
          delivered: true,
        },
      );
    },
  };

  return { store, insertedShares, pushCalls };
}

Deno.test("send_dm_message inserts a DM and sends recipient push payload", async () => {
  const { store, insertedShares, pushCalls } = createStore();
  const handler = createSendDmMessageHandler({ store });

  const response = await handler(
    dmRequest({ recipientId: "user-b", text: "hi" }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.share.id, "share-1");
  assertEquals(insertedShares.length, 1);
  assertEquals(insertedShares[0].senderId, "user-a");
  assertEquals(insertedShares[0].recipientId, "user-b");
  assertEquals(insertedShares[0].text, "hi");

  assertEquals(pushCalls.length, 1);
  assertEquals(pushCalls[0].userIds, ["user-b"]);
  assertEquals(pushCalls[0].notification.title, "New message from User A");
  assertEquals(pushCalls[0].notification.body, "hi");
  assertEquals(pushCalls[0].data.type, "dm");
  assertEquals(pushCalls[0].data.kind, "dm");
  assertEquals(pushCalls[0].data.notification_type, "direct_message");
  assertEquals(pushCalls[0].data.notification_kind, "direct_message");
  assertEquals(pushCalls[0].data.sender_id, "user-a");
  assertEquals(pushCalls[0].data.conversation_user_id, "user-a");
  assertEquals(pushCalls[0].data.share_id, "share-1");
  assertEquals(body.push.delivered, true);
  assertEquals(body.pushError, null);
});

Deno.test("send_dm_message does not push to the sender", async () => {
  const { store, pushCalls } = createStore();
  const handler = createSendDmMessageHandler({ store });

  const response = await handler(
    dmRequest({ recipientId: "user-a", text: "note to self" }),
  );
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "Cannot message yourself");
  assertEquals(pushCalls.length, 0);
});

Deno.test("send_dm_message handles no active push tokens without failing the DM insert", async () => {
  const { store, insertedShares, pushCalls } = createStore({
    pushResult: {
      sent: 0,
      failed: 0,
      stale: 0,
      matchedTokens: 0,
      delivered: false,
      reason: "no_tokens_for_recipients",
      failedReasons: [],
    },
  });
  const handler = createSendDmMessageHandler({ store });

  const response = await handler(
    dmRequest({ recipientId: "user-b", text: "what are you doing right now?" }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(insertedShares.length, 1);
  assertEquals(pushCalls.length, 1);
  assertEquals(body.push.delivered, false);
  assertEquals(body.push.reason, "no_tokens_for_recipients");
  assertEquals(body.pushError, null);
});

Deno.test("send_dm_message keeps DM success when send_push reports an invalid token failure", async () => {
  const { store, insertedShares, pushCalls } = createStore({
    pushResult: {
      sent: 0,
      failed: 1,
      stale: 1,
      matchedTokens: 1,
      delivered: false,
      reason: "404:NOT_FOUND/UNREGISTERED",
      failedReasons: ["404:NOT_FOUND/UNREGISTERED"],
    },
  });
  const handler = createSendDmMessageHandler({ store });

  const response = await handler(
    dmRequest({ recipientId: "user-b", text: "invalid token path" }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(insertedShares.length, 1);
  assertEquals(pushCalls.length, 1);
  assertEquals(body.push.delivered, false);
  assertEquals(body.push.failed, 1);
  assertEquals(body.push.stale, 1);
  assertEquals(body.pushError, null);
});

Deno.test("buildDmPushRequest carries the DM thread route identifiers", () => {
  const push = buildDmPushRequest({
    recipientId: "user-b",
    senderId: "user-a",
    senderLabel: "User A",
    text: "hello",
    shareId: "share-1",
    accessToken: "sender-token",
  });

  assertEquals(push.userIds, ["user-b"]);
  assertEquals(push.data.kind, "dm");
  assertEquals(push.data.sender_id, "user-a");
  assertEquals(push.data.conversation_user_id, "user-a");
  assertEquals(push.data.share_id, "share-1");
});

Deno.test("send_dm_message push payload passes user-JWT DM authorization guard", async () => {
  const push = buildDmPushRequest({
    recipientId: "user-b",
    senderId: "user-a",
    senderLabel: "User A",
    text: "hello",
    shareId: "share-1",
    accessToken: "sender-token",
  });

  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: push.userIds,
    data: push.data,
    lookupShare: () =>
      Promise.resolve({
        id: "share-1",
        sender_id: "user-a",
        recipient_id: "user-b",
        channel: "in_app",
        status: "sent",
        deleted_at: null,
        payload_json: { type: "message", text: "hello", name: "hello" },
      }),
  });

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.applies, true);
  }
});

Deno.test("default DM push store sends user JWT with internal key for send_push fallback auth", async () => {
  const capturedRequest: {
    headers?: Headers;
    body?: Record<string, unknown>;
  } = {};
  const store = createSupabaseDmStore({
    client: {} as unknown,
    supabaseUrl: "https://project.supabase.co",
    internalFunctionKey: "internal-secret",
    fetchImpl: async (_input, init) => {
      capturedRequest.headers = new Headers(init?.headers);
      capturedRequest.body = parseJsonRecord(init?.body);
      return new Response(JSON.stringify({ sent: 1, delivered: true }), {
        status: 200,
      });
    },
  });

  await store.sendPush(
    buildDmPushRequest({
      recipientId: "user-b",
      senderId: "user-a",
      senderLabel: "User A",
      text: "hi",
      shareId: "share-1",
      accessToken: "sender-token",
    }),
  );

  const { headers, body } = capturedRequest;
  assertExists(headers);
  assertExists(body);
  assertEquals(headers.get("x-internal-key"), "internal-secret");
  assertEquals(headers.get("authorization"), "Bearer sender-token");
  assertEquals(body.userIds, ["user-b"]);
});
