import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

export type AuthenticatedUser = {
  id: string;
};

export type DmConversationType = "direct" | "group";

export type DmProfileRow = {
  id: string;
  allow_incoming_shares?: boolean | null;
  display_name?: string | null;
  handle?: string | null;
};

export type DmBlockRow = {
  blocker_user_id: string;
  blocked_user_id: string;
};

export type DmConversationRow = {
  id: string;
  type: DmConversationType;
  title?: string | null;
  created_by: string;
  created_at?: string | null;
  updated_at?: string | null;
  last_message_at?: string | null;
};

export type DmConversationMemberRow = {
  conversation_id: string;
  user_id: string;
  role?: string | null;
  left_at?: string | null;
  muted_at?: string | null;
  deleted_at?: string | null;
};

export type DmMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body?: string | null;
  kind?: string | null;
  payload_json?: Record<string, unknown> | null;
  client_message_id?: string | null;
  created_at?: string | null;
  deleted_at?: string | null;
};

export type DmConversationPushRequest = {
  userIds: string[];
  notification: {
    title: string;
    body: string;
  };
  data: Record<string, unknown>;
  accessToken: string;
};

export type CreateConversationResult = {
  conversation: DmConversationRow;
  members: DmConversationMemberRow[];
  message?: DmMessageRow | null;
  reused: boolean;
};

export type DmConversationStore = {
  authenticate: (accessToken: string) => Promise<AuthenticatedUser | null>;
  getProfiles: (userIds: string[]) => Promise<DmProfileRow[]>;
  getBlocks: (userIds: string[]) => Promise<DmBlockRow[]>;
  findExactConversation: (
    userIds: string[],
    type: DmConversationType,
  ) => Promise<DmConversationRow | null>;
  createConversation: (params: {
    type: DmConversationType;
    title?: string | null;
    createdBy: string;
    userIds: string[];
  }) => Promise<{
    conversation: DmConversationRow;
    members: DmConversationMemberRow[];
  }>;
  getConversation: (
    conversationId: string,
  ) => Promise<DmConversationRow | null>;
  getConversationMembers: (
    conversationId: string,
  ) => Promise<DmConversationMemberRow[]>;
  insertMessage: (params: {
    conversationId: string;
    senderId: string;
    text: string;
    clientMessageId?: string | null;
  }) => Promise<DmMessageRow>;
  markConversationRead: (params: {
    conversationId: string;
    userId: string;
  }) => Promise<boolean>;
  getSenderLabel: (senderId: string) => Promise<string>;
  sendPush: (request: DmConversationPushRequest) => Promise<unknown>;
};

export class DmConversationHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

export function jsonResponse(
  req: Request,
  body: unknown,
  init?: ResponseInit,
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
      ...(init?.headers ?? {}),
    },
  });
}

export function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => trimString(item))
    .filter((item) => item.length > 0);
}

export async function requireUser(req: Request, store: DmConversationStore) {
  const accessToken = req.headers.get("authorization")?.replace(
    /^Bearer\s+/i,
    "",
  ).trim() ?? "";
  if (!accessToken) return null;

  const user = await store.authenticate(accessToken);
  if (!user?.id) return null;
  return { user, accessToken };
}

function dedupeUserIds(userIds: string[]) {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const userId of userIds) {
    const normalized = userId.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

export function previewText(text: string) {
  return text.length > 120 ? `${text.substring(0, 120)}...` : text;
}

export function buildDmMessageV2PushRequest(params: {
  conversation: DmConversationRow;
  recipients: string[];
  senderId: string;
  senderLabel: string;
  text: string;
  messageId: string;
  accessToken: string;
}): DmConversationPushRequest {
  const title = params.conversation.type === "group"
    ? `New group message from ${params.senderLabel}`
    : `New message from ${params.senderLabel}`;

  return {
    userIds: params.recipients,
    notification: {
      title,
      body: previewText(params.text),
    },
    data: {
      type: "dm_message_v2",
      kind: "dm",
      notification_type: "dm_message_v2",
      notification_kind: "dm_message_v2",
      sender_id: params.senderId,
      conversation_id: params.conversation.id,
      message_id: params.messageId,
    },
    accessToken: params.accessToken,
  };
}

function activeMemberUserIds(members: DmConversationMemberRow[]) {
  return members
    .filter((member) => !member.left_at && !member.deleted_at)
    .map((member) => member.user_id.trim())
    .filter((userId) => userId.length > 0);
}

function validateConversationMembership(params: {
  conversation: DmConversationRow | null;
  members: DmConversationMemberRow[];
  senderId: string;
}) {
  if (!params.conversation?.id) {
    throw new DmConversationHttpError("Conversation not found", 404);
  }

  const activeUsers = new Set(activeMemberUserIds(params.members));
  if (!activeUsers.has(params.senderId)) {
    throw new DmConversationHttpError("Conversation is not available", 403);
  }
}

async function validateConversationParticipants(params: {
  creatorId: string;
  participantIds: string[];
  store: DmConversationStore;
}) {
  const recipientIds = dedupeUserIds(params.participantIds);
  if (recipientIds.length === 0) {
    throw new DmConversationHttpError("Select at least one person", 400);
  }
  if (recipientIds.length !== params.participantIds.length) {
    throw new DmConversationHttpError(
      "Duplicate participants are not allowed",
      400,
    );
  }
  if (recipientIds.includes(params.creatorId)) {
    throw new DmConversationHttpError(
      "Do not include yourself as a recipient",
      400,
    );
  }

  const allUserIds = [params.creatorId, ...recipientIds];
  if (allUserIds.length > 6) {
    throw new DmConversationHttpError(
      "Group chats are limited to 6 people",
      400,
    );
  }

  const profiles = await params.store.getProfiles(allUserIds);
  const profilesById = new Map(
    profiles.map((profile) => [profile.id, profile]),
  );
  for (const userId of allUserIds) {
    if (!profilesById.has(userId)) {
      throw new DmConversationHttpError("Participant not found", 404);
    }
  }

  for (const userId of recipientIds) {
    if (profilesById.get(userId)?.allow_incoming_shares === false) {
      throw new DmConversationHttpError(
        "One or more people are not accepting messages right now",
        403,
      );
    }
  }

  const participantSet = new Set(allUserIds);
  const blocks = await params.store.getBlocks(allUserIds);
  const conflictingBlock = blocks.find((block) =>
    participantSet.has(block.blocker_user_id) &&
    participantSet.has(block.blocked_user_id)
  );
  if (conflictingBlock) {
    throw new DmConversationHttpError(
      "This group cannot be created with the selected people",
      403,
    );
  }

  return {
    recipientIds,
    allUserIds,
    type: allUserIds.length === 2 ? "direct" as const : "group" as const,
  };
}

export async function createDmConversation(params: {
  creatorId: string;
  participantIds: string[];
  title?: string | null;
  initialText?: string | null;
  clientMessageId?: string | null;
  store: DmConversationStore;
  accessToken: string;
}): Promise<CreateConversationResult> {
  const validation = await validateConversationParticipants({
    creatorId: params.creatorId,
    participantIds: params.participantIds,
    store: params.store,
  });

  const initialText = trimString(params.initialText);
  const existing = await params.store.findExactConversation(
    validation.allUserIds,
    validation.type,
  );
  const created = existing
    ? {
      conversation: existing,
      members: await params.store.getConversationMembers(existing.id),
    }
    : await params.store.createConversation({
      type: validation.type,
      title: trimString(params.title) || null,
      createdBy: params.creatorId,
      userIds: validation.allUserIds,
    });

  let message: DmMessageRow | null = null;
  if (initialText) {
    message = await params.store.insertMessage({
      conversationId: created.conversation.id,
      senderId: params.creatorId,
      text: initialText,
      clientMessageId: trimString(params.clientMessageId) || null,
    });

    const pushRecipients = created.members
      .filter((member) =>
        member.user_id !== params.creatorId &&
        !member.left_at &&
        !member.deleted_at &&
        !member.muted_at
      )
      .map((member) => member.user_id);
    if (pushRecipients.length) {
      const senderLabel = await params.store.getSenderLabel(params.creatorId);
      await params.store.sendPush(
        buildDmMessageV2PushRequest({
          conversation: created.conversation,
          recipients: pushRecipients,
          senderId: params.creatorId,
          senderLabel,
          text: initialText,
          messageId: message.id,
          accessToken: params.accessToken,
        }),
      );
    }
  }

  return {
    conversation: created.conversation,
    members: created.members,
    message,
    reused: existing != null,
  };
}

export async function sendDmMessageV2(params: {
  senderId: string;
  conversationId: string;
  text: string;
  clientMessageId?: string | null;
  store: DmConversationStore;
  accessToken: string;
}) {
  const conversationId = trimString(params.conversationId);
  const text = trimString(params.text);
  if (!conversationId || !text) {
    throw new DmConversationHttpError(
      "conversationId and text are required",
      400,
    );
  }

  const [conversation, members] = await Promise.all([
    params.store.getConversation(conversationId),
    params.store.getConversationMembers(conversationId),
  ]);
  validateConversationMembership({
    conversation,
    members,
    senderId: params.senderId,
  });

  const message = await params.store.insertMessage({
    conversationId,
    senderId: params.senderId,
    text,
    clientMessageId: trimString(params.clientMessageId) || null,
  });

  const pushRecipients = members
    .filter((member) =>
      member.user_id !== params.senderId &&
      !member.left_at &&
      !member.deleted_at &&
      !member.muted_at
    )
    .map((member) => member.user_id);

  let push: unknown = null;
  let pushError: string | null = null;
  if (pushRecipients.length && conversation) {
    try {
      const senderLabel = await params.store.getSenderLabel(params.senderId);
      push = await params.store.sendPush(
        buildDmMessageV2PushRequest({
          conversation,
          recipients: pushRecipients,
          senderId: params.senderId,
          senderLabel,
          text,
          messageId: message.id,
          accessToken: params.accessToken,
        }),
      );
    } catch (error) {
      pushError = error instanceof Error ? error.message : String(error);
    }
  }

  return { message, push, pushError };
}

export async function markDmConversationRead(params: {
  userId: string;
  conversationId: string;
  store: DmConversationStore;
}) {
  const conversationId = trimString(params.conversationId);
  if (!conversationId) {
    throw new DmConversationHttpError("conversationId is required", 400);
  }

  const [conversation, members] = await Promise.all([
    params.store.getConversation(conversationId),
    params.store.getConversationMembers(conversationId),
  ]);
  validateConversationMembership({
    conversation,
    members,
    senderId: params.userId,
  });

  return await params.store.markConversationRead({
    conversationId,
    userId: params.userId,
  });
}

export function createSupabaseDmConversationStore(options: {
  client: any;
  supabaseUrl: string;
  internalFunctionKey?: string;
  fetchImpl?: typeof fetch;
}): DmConversationStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const internalFunctionKey = options.internalFunctionKey ?? "";

  async function activeMemberRows(conversationIds: string[]) {
    if (!conversationIds.length) return [];
    const { data, error } = await options.client
      .from("dm_conversation_members")
      .select("conversation_id, user_id, role, left_at, muted_at, deleted_at")
      .in("conversation_id", conversationIds);
    if (error) throw error;
    return (data ?? []) as DmConversationMemberRow[];
  }

  return {
    authenticate: async (accessToken: string) => {
      const { data, error } = await options.client.auth.getUser(accessToken);
      if (error || !data.user?.id) return null;
      return { id: data.user.id };
    },
    getProfiles: async (userIds: string[]) => {
      const ids = dedupeUserIds(userIds);
      if (!ids.length) return [];
      const { data, error } = await options.client
        .from("profiles")
        .select("id, allow_incoming_shares, display_name, handle")
        .in("id", ids);
      if (error) throw error;
      return (data ?? []) as DmProfileRow[];
    },
    getBlocks: async (userIds: string[]) => {
      const ids = dedupeUserIds(userIds);
      if (!ids.length) return [];
      const { data, error } = await options.client
        .from("user_blocks")
        .select("blocker_user_id, blocked_user_id")
        .in("blocker_user_id", ids)
        .in("blocked_user_id", ids);
      if (error) throw error;
      return (data ?? []) as DmBlockRow[];
    },
    findExactConversation: async (userIds, type) => {
      const ids = dedupeUserIds(userIds);
      const { data: memberRows, error: memberError } = await options.client
        .from("dm_conversation_members")
        .select("conversation_id, user_id, role, left_at, muted_at, deleted_at")
        .in("user_id", ids)
        .is("left_at", null)
        .is("deleted_at", null);
      if (memberError) throw memberError;

      const rows = (memberRows ?? []) as DmConversationMemberRow[];
      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(
          row.conversation_id,
          (counts.get(row.conversation_id) ?? 0) + 1,
        );
      }
      const candidates = Array.from(counts.entries())
        .filter(([, count]) => count === ids.length)
        .map(([conversationId]) => conversationId);
      if (!candidates.length) return null;

      const [members, conversationsResponse] = await Promise.all([
        activeMemberRows(candidates),
        options.client
          .from("dm_conversations")
          .select(
            "id, type, title, created_by, created_at, updated_at, last_message_at",
          )
          .in("id", candidates)
          .eq("type", type)
          .is("deleted_at", null),
      ]);
      if (conversationsResponse.error) throw conversationsResponse.error;

      const requested = new Set(ids);
      const conversations =
        (conversationsResponse.data ?? []) as DmConversationRow[];
      for (const conversation of conversations) {
        const activeMembers = members.filter((member) =>
          member.conversation_id === conversation.id &&
          !member.left_at &&
          !member.deleted_at
        );
        if (activeMembers.length !== requested.size) continue;
        if (activeMembers.every((member) => requested.has(member.user_id))) {
          return conversation;
        }
      }
      return null;
    },
    createConversation: async ({ type, title, createdBy, userIds }) => {
      const { data: conversation, error: conversationError } = await options
        .client
        .from("dm_conversations")
        .insert({
          type,
          title,
          created_by: createdBy,
        })
        .select(
          "id, type, title, created_by, created_at, updated_at, last_message_at",
        )
        .single();
      if (conversationError || !conversation) {
        throw conversationError ?? new Error("Failed to create conversation");
      }

      const memberPayloads = userIds.map((userId) => ({
        conversation_id: conversation.id,
        user_id: userId,
        role: userId === createdBy ? "owner" : "member",
        last_read_at: userId === createdBy ? new Date().toISOString() : null,
      }));
      const { data: members, error: membersError } = await options.client
        .from("dm_conversation_members")
        .insert(memberPayloads)
        .select(
          "conversation_id, user_id, role, left_at, muted_at, deleted_at",
        );
      if (membersError) throw membersError;

      return {
        conversation: conversation as DmConversationRow,
        members: (members ?? []) as DmConversationMemberRow[],
      };
    },
    getConversation: async (conversationId) => {
      const { data, error } = await options.client
        .from("dm_conversations")
        .select(
          "id, type, title, created_by, created_at, updated_at, last_message_at",
        )
        .eq("id", conversationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data as DmConversationRow | null;
    },
    getConversationMembers: async (conversationId) => {
      const { data, error } = await options.client
        .from("dm_conversation_members")
        .select("conversation_id, user_id, role, left_at, muted_at, deleted_at")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      return (data ?? []) as DmConversationMemberRow[];
    },
    insertMessage: async (
      { conversationId, senderId, text, clientMessageId },
    ) => {
      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: senderId,
        body: text,
        kind: "text",
      };
      if (clientMessageId) payload.client_message_id = clientMessageId;

      const { data, error } = await options.client
        .from("dm_messages")
        .insert(payload)
        .select(
          "id, conversation_id, sender_id, body, kind, payload_json, client_message_id, created_at, deleted_at",
        )
        .single();
      if (error || !data) {
        if (clientMessageId && error?.code === "23505") {
          const { data: existing, error: existingError } = await options.client
            .from("dm_messages")
            .select(
              "id, conversation_id, sender_id, body, kind, payload_json, client_message_id, created_at, deleted_at",
            )
            .eq("conversation_id", conversationId)
            .eq("sender_id", senderId)
            .eq("client_message_id", clientMessageId)
            .maybeSingle();
          if (existingError) throw existingError;
          if (existing) return existing as DmMessageRow;
        }
        throw error ?? new Error("Failed to create message");
      }

      const createdAt = data.created_at ?? new Date().toISOString();
      await Promise.all([
        options.client
          .from("dm_conversations")
          .update({
            last_message_at: createdAt,
            updated_at: createdAt,
          })
          .eq("id", conversationId),
        options.client
          .from("dm_conversation_members")
          .update({ last_read_at: createdAt })
          .eq("conversation_id", conversationId)
          .eq("user_id", senderId),
      ]);

      return data as DmMessageRow;
    },
    markConversationRead: async ({ conversationId, userId }) => {
      const { data, error } = await options.client
        .from("dm_conversation_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .is("left_at", null)
        .is("deleted_at", null)
        .select("conversation_id")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    getSenderLabel: async (senderId) => {
      const { data: profile } = await options.client
        .from("profiles")
        .select("display_name, handle")
        .eq("id", senderId)
        .maybeSingle();

      const displayName = trimString(profile?.display_name);
      const handle = trimString(profile?.handle);
      return displayName || (handle ? `@${handle}` : "Someone");
    },
    sendPush: async (request) => {
      if (!internalFunctionKey && !request.accessToken) {
        return { delivered: false, reason: "missing_push_auth" };
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (internalFunctionKey) {
        headers["x-internal-key"] = internalFunctionKey;
      }
      if (request.accessToken) {
        headers.Authorization = `Bearer ${request.accessToken}`;
      }

      const res = await fetchImpl(
        `${options.supabaseUrl}/functions/v1/send_push`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            userIds: request.userIds,
            notification: request.notification,
            data: request.data,
          }),
        },
      );

      const textBody = await res.text();
      if (!res.ok) {
        throw new Error(`send_push ${res.status}: ${textBody}`);
      }

      return textBody.length ? JSON.parse(textBody) : { delivered: true };
    },
  };
}

export function defaultSupabaseStoreFromEnv() {
  const SUPABASE_URL = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const INTERNAL_FUNCTION_KEY = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return {
      configured: false,
      supabaseUrl: SUPABASE_URL,
      store: null,
    };
  }

  return {
    configured: true,
    supabaseUrl: SUPABASE_URL,
    store: createSupabaseDmConversationStore({
      client: createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
      supabaseUrl: SUPABASE_URL,
      internalFunctionKey: INTERNAL_FUNCTION_KEY,
    }),
  };
}
