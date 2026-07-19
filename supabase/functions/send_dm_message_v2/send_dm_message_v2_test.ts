import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type DmBlockRow,
  type DmConversationMemberRow,
  type DmConversationPushRequest,
  type DmConversationRow,
  type DmConversationStore,
  type DmMessageRow,
  type DmProfileRow,
} from "../_shared/dm_conversations.ts";
import { createSendDmMessageV2Handler } from "./index.ts";

function authedRequest(body: Record<string, unknown>) {
  return new Request("https://example.test/functions/v1/send_dm_message_v2", {
    method: "POST",
    headers: {
      authorization: "Bearer sender-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createStore(options?: {
  requesterId?: string;
  members?: DmConversationMemberRow[];
}) {
  const pushCalls: DmConversationPushRequest[] = [];
  const messages: DmMessageRow[] = [];
  const conversation: DmConversationRow = {
    id: "conversation-1",
    type: "group",
    title: null,
    created_by: "user-a",
    created_at: "2026-06-29T12:00:00Z",
    updated_at: "2026-06-29T12:00:00Z",
  };
  const members = options?.members ?? [
    { conversation_id: "conversation-1", user_id: "user-a", role: "owner" },
    { conversation_id: "conversation-1", user_id: "user-b", role: "member" },
    {
      conversation_id: "conversation-1",
      user_id: "user-c",
      role: "member",
      muted_at: "2026-06-29T12:00:00Z",
    },
  ];

  const store: DmConversationStore = {
    authenticate: () =>
      Promise.resolve({ id: options?.requesterId ?? "user-a" }),
    getProfiles: () => Promise.resolve([] as DmProfileRow[]),
    getBlocks: () => Promise.resolve([] as DmBlockRow[]),
    findExactConversation: () => Promise.resolve(null),
    createConversation: () => {
      throw new Error("not used");
    },
    getConversation: (conversationId) =>
      Promise.resolve(conversationId === conversation.id ? conversation : null),
    getConversationMembers: (conversationId) =>
      Promise.resolve(
        members.filter((member) => member.conversation_id === conversationId),
      ),
    insertMessage: ({ conversationId, senderId, text, clientMessageId }) => {
      const message: DmMessageRow = {
        id: "message-1",
        conversation_id: conversationId,
        sender_id: senderId,
        body: text,
        kind: "text",
        client_message_id: clientMessageId,
        created_at: "2026-06-29T12:01:00Z",
      };
      messages.push(message);
      return Promise.resolve(message);
    },
    markConversationRead: () => Promise.resolve(true),
    getSenderLabel: () => Promise.resolve("User A"),
    sendPush: (request) => {
      pushCalls.push(request);
      return Promise.resolve({ delivered: true });
    },
  };

  return { store, pushCalls, messages };
}

Deno.test("send_dm_message_v2 inserts a group message and pushes active recipients", async () => {
  const { store, pushCalls, messages } = createStore();
  const response = await createSendDmMessageV2Handler({ store })(
    authedRequest({
      conversationId: "conversation-1",
      text: "hello group",
      clientMessageId: "client-1",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(messages.length, 1);
  assertEquals(messages[0].body, "hello group");
  assertEquals(pushCalls.length, 1);
  assertEquals(pushCalls[0].userIds, ["user-b"]);
  assertEquals(pushCalls[0].data.type, "dm_message_v2");
  assertEquals(pushCalls[0].data.conversation_id, "conversation-1");
  assertEquals(pushCalls[0].data.conversation_user_id, undefined);
  assertEquals(pushCalls[0].data.message_id, "message-1");
});

Deno.test("send_dm_message_v2 rejects senders outside the conversation", async () => {
  const { store, messages, pushCalls } = createStore({ requesterId: "user-x" });
  const response = await createSendDmMessageV2Handler({ store })(
    authedRequest({
      conversationId: "conversation-1",
      text: "not a member",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Conversation is not available");
  assertEquals(messages.length, 0);
  assertEquals(pushCalls.length, 0);
});

Deno.test("send_dm_message_v2 rejects senders who left the conversation", async () => {
  const { store, messages, pushCalls } = createStore({
    members: [
      {
        conversation_id: "conversation-1",
        user_id: "user-a",
        role: "owner",
        left_at: "2026-06-29T12:02:00Z",
      },
      { conversation_id: "conversation-1", user_id: "user-b", role: "member" },
    ],
  });
  const response = await createSendDmMessageV2Handler({ store })(
    authedRequest({
      conversationId: "conversation-1",
      text: "after leaving",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Conversation is not available");
  assertEquals(messages.length, 0);
  assertEquals(pushCalls.length, 0);
});
