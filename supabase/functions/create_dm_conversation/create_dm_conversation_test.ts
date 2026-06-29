import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type DmBlockRow,
  type DmConversationMemberRow,
  type DmConversationPushRequest,
  type DmConversationRow,
  type DmConversationStore,
  type DmMessageRow,
} from "../_shared/dm_conversations.ts";
import { createCreateDmConversationHandler } from "./index.ts";

function authedRequest(body: Record<string, unknown>) {
  return new Request(
    "https://example.test/functions/v1/create_dm_conversation",
    {
      method: "POST",
      headers: {
        authorization: "Bearer sender-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function createStore(options?: {
  blocks?: DmBlockRow[];
  existingConversationId?: string | null;
  allowIncomingByUserId?: Record<string, boolean>;
  missingProfileIds?: string[];
}) {
  const pushCalls: DmConversationPushRequest[] = [];
  const conversations = new Map<string, DmConversationRow>([
    [
      "conversation-1",
      {
        id: "conversation-1",
        type: "group" as const,
        title: null,
        created_by: "user-a",
        created_at: "2026-06-29T12:00:00Z",
        updated_at: "2026-06-29T12:00:00Z",
      },
    ],
  ]);
  const members: DmConversationMemberRow[] = [
    { conversation_id: "conversation-1", user_id: "user-a", role: "owner" },
    { conversation_id: "conversation-1", user_id: "user-b", role: "member" },
    { conversation_id: "conversation-1", user_id: "user-c", role: "member" },
  ];
  const messages: DmMessageRow[] = [];

  const store: DmConversationStore = {
    authenticate: () => Promise.resolve({ id: "user-a" }),
    getProfiles: (userIds) =>
      Promise.resolve(
        userIds
          .filter((id) => !(options?.missingProfileIds ?? []).includes(id))
          .map((id) => ({
            id,
            allow_incoming_shares: options?.allowIncomingByUserId?.[id] ?? true,
            display_name: id === "user-a" ? "User A" : id,
          })),
      ),
    getBlocks: () => Promise.resolve(options?.blocks ?? []),
    findExactConversation: () =>
      Promise.resolve(
        options?.existingConversationId
          ? conversations.get(options.existingConversationId) ?? null
          : null,
      ),
    createConversation: ({ userIds, type, title, createdBy }) => {
      const conversation = {
        id: "conversation-1",
        type,
        title,
        created_by: createdBy,
        created_at: "2026-06-29T12:00:00Z",
        updated_at: "2026-06-29T12:00:00Z",
      };
      conversations.set(conversation.id, conversation);
      return Promise.resolve({
        conversation,
        members: userIds.map((userId) => ({
          conversation_id: conversation.id,
          user_id: userId,
          role: userId === createdBy ? "owner" : "member",
        })),
      });
    },
    getConversation: (conversationId) =>
      Promise.resolve(conversations.get(conversationId) ?? null),
    getConversationMembers: (conversationId) =>
      Promise.resolve(
        members.filter((member) => member.conversation_id === conversationId),
      ),
    insertMessage: ({ conversationId, senderId, text, clientMessageId }) => {
      const message = {
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

Deno.test("create_dm_conversation creates a group with selected participants", async () => {
  const { store } = createStore();
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-b", "user-c"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.conversation.id, "conversation-1");
  assertEquals(body.conversation.type, "group");
  assertEquals(
    body.members.map((member: { user_id: string }) => member.user_id),
    [
      "user-a",
      "user-b",
      "user-c",
    ],
  );
});

Deno.test("create_dm_conversation rejects blocked participant pairs", async () => {
  const { store } = createStore({
    blocks: [{ blocker_user_id: "user-c", blocked_user_id: "user-b" }],
  });
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-b", "user-c"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(
    body.error,
    "This group cannot be created with the selected people",
  );
});

Deno.test("create_dm_conversation rejects when creator blocked a selected user", async () => {
  const { store } = createStore({
    blocks: [{ blocker_user_id: "user-a", blocked_user_id: "user-b" }],
  });
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-b", "user-c"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(
    body.error,
    "This group cannot be created with the selected people",
  );
});

Deno.test("create_dm_conversation rejects when selected user blocked creator", async () => {
  const { store } = createStore({
    blocks: [{ blocker_user_id: "user-b", blocked_user_id: "user-a" }],
  });
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-b", "user-c"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(
    body.error,
    "This group cannot be created with the selected people",
  );
});

Deno.test("create_dm_conversation rejects selected users not accepting messages", async () => {
  const { store } = createStore({
    allowIncomingByUserId: { "user-c": false },
  });
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-b", "user-c"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(
    body.error,
    "One or more people are not accepting messages right now",
  );
});

Deno.test("create_dm_conversation rejects duplicate participant IDs", async () => {
  const { store } = createStore();
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-b", "user-b"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "Duplicate participants are not allowed");
});

Deno.test("create_dm_conversation rejects creator included as participant", async () => {
  const { store } = createStore();
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-a", "user-b"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "Do not include yourself as a recipient");
});

Deno.test("create_dm_conversation rejects invalid selected users", async () => {
  const { store } = createStore({
    missingProfileIds: ["user-z"],
  });
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({ participantIds: ["user-b", "user-z"] }),
  );
  const body = await response.json();

  assertEquals(response.status, 404);
  assertEquals(body.error, "Participant not found");
});

Deno.test("create_dm_conversation rejects groups over the maximum size", async () => {
  const { store } = createStore();
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({
      participantIds: [
        "user-b",
        "user-c",
        "user-d",
        "user-e",
        "user-f",
        "user-g",
      ],
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "Group chats are limited to 6 people");
});

Deno.test("create_dm_conversation sends v2 push when initial text is supplied", async () => {
  const { store, pushCalls, messages } = createStore();
  const response = await createCreateDmConversationHandler({ store })(
    authedRequest({
      participantIds: ["user-b", "user-c"],
      initialText: "hello group",
      clientMessageId: "client-1",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(messages.length, 1);
  assertExists(body.message);
  assertEquals(pushCalls.length, 1);
  assertEquals(pushCalls[0].userIds, ["user-b", "user-c"]);
  assertEquals(pushCalls[0].data.type, "dm_message_v2");
  assertEquals(pushCalls[0].data.conversation_id, "conversation-1");
  assertEquals(pushCalls[0].data.conversation_user_id, undefined);
  assertEquals(pushCalls[0].data.message_id, "message-1");
});
