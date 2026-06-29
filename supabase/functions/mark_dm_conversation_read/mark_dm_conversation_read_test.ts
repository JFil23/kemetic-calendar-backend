import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type DmBlockRow,
  type DmConversationMemberRow,
  type DmConversationRow,
  type DmConversationStore,
  type DmMessageRow,
  type DmProfileRow,
} from "../_shared/dm_conversations.ts";
import { createMarkDmConversationReadHandler } from "./index.ts";

function authedRequest(body: Record<string, unknown>) {
  return new Request(
    "https://example.test/functions/v1/mark_dm_conversation_read",
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
  requesterId?: string;
  members?: DmConversationMemberRow[];
}) {
  const markReadCalls: Array<{ conversationId: string; userId: string }> = [];
  const conversation: DmConversationRow = {
    id: "conversation-1",
    type: "group",
    title: null,
    created_by: "user-a",
    created_at: "2026-06-29T12:00:00Z",
    updated_at: "2026-06-29T12:00:00Z",
  };
  const members: DmConversationMemberRow[] = options?.members ?? [
    { conversation_id: "conversation-1", user_id: "user-a", role: "owner" },
    { conversation_id: "conversation-1", user_id: "user-b", role: "member" },
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
    insertMessage: () => Promise.resolve({} as DmMessageRow),
    markConversationRead: ({ conversationId, userId }) => {
      markReadCalls.push({ conversationId, userId });
      return Promise.resolve(true);
    },
    getSenderLabel: () => Promise.resolve("User A"),
    sendPush: () => Promise.resolve({ delivered: true }),
  };

  return { store, markReadCalls };
}

Deno.test("mark_dm_conversation_read updates the active member read cursor", async () => {
  const { store, markReadCalls } = createStore();
  const response = await createMarkDmConversationReadHandler({ store })(
    authedRequest({ conversationId: "conversation-1" }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(markReadCalls, [
    { conversationId: "conversation-1", userId: "user-a" },
  ]);
});

Deno.test("mark_dm_conversation_read rejects users outside the conversation", async () => {
  const { store, markReadCalls } = createStore({ requesterId: "user-x" });
  const response = await createMarkDmConversationReadHandler({ store })(
    authedRequest({ conversationId: "conversation-1" }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Conversation is not available");
  assertEquals(markReadCalls.length, 0);
});

Deno.test("mark_dm_conversation_read rejects users who left the conversation", async () => {
  const { store, markReadCalls } = createStore({
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
  const response = await createMarkDmConversationReadHandler({ store })(
    authedRequest({ conversationId: "conversation-1" }),
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Conversation is not available");
  assertEquals(markReadCalls.length, 0);
});
