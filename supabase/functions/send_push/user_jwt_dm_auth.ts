export type DmShareRow = {
  id: string;
  sender_id: string | null;
  recipient_id: string | null;
  channel?: string | null;
  status?: string | null;
  deleted_at?: string | null;
  payload_json?: Record<string, unknown> | null;
};

export type DmConversationMemberRow = {
  conversation_id: string;
  user_id: string;
  left_at?: string | null;
  deleted_at?: string | null;
};

export type DmMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  deleted_at?: string | null;
};

export type UserJwtDmPushAuthorizationResult =
  | { ok: true; applies: boolean }
  | {
    ok: false;
    status: 400 | 403;
    error: string;
    log?: Record<string, unknown>;
  };

export type DmShareLookup = (shareId: string) => Promise<DmShareRow | null>;
export type DmConversationMembersLookup = (
  conversationId: string,
) => Promise<DmConversationMemberRow[]>;
export type DmMessageLookup = (
  messageId: string,
) => Promise<DmMessageRow | null>;

function firstString(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function dataString(
  data: Record<string, unknown> | undefined,
  snakeKey: string,
  camelKey?: string,
) {
  if (!data) return null;
  return firstString(data[snakeKey]) ??
    (camelKey ? firstString(data[camelKey]) : null);
}

function hasDirectMessageCandidateShape(data: Record<string, unknown>) {
  const type = dataString(data, "type");
  const kind = dataString(data, "kind");
  const notificationType = dataString(
    data,
    "notification_type",
    "notificationType",
  );
  const notificationKind = dataString(
    data,
    "notification_kind",
    "notificationKind",
  );

  return type === "dm" ||
    type === "dm_message_v2" ||
    type === "dm_message_like" ||
    kind === "dm" ||
    notificationType === "dm_message_v2" ||
    notificationType === "direct_message" ||
    notificationType === "direct_message_like" ||
    notificationKind === "dm_message_v2" ||
    notificationKind === "direct_message_like" ||
    notificationKind === "direct_message";
}

function hasExactDirectMessageShape(data: Record<string, unknown>) {
  return dataString(data, "type") === "dm" &&
    dataString(data, "kind") === "dm" &&
    dataString(data, "notification_type", "notificationType") ===
      "direct_message" &&
    dataString(data, "notification_kind", "notificationKind") ===
      "direct_message";
}

function hasExactDirectMessageLikeShape(data: Record<string, unknown>) {
  return dataString(data, "type") === "dm_message_like" &&
    dataString(data, "kind") === "dm" &&
    dataString(data, "notification_type", "notificationType") ===
      "direct_message_like" &&
    dataString(data, "notification_kind", "notificationKind") ===
      "direct_message_like";
}

function hasExactDmMessageV2Shape(data: Record<string, unknown>) {
  return dataString(data, "type") === "dm_message_v2" &&
    dataString(data, "kind") === "dm" &&
    dataString(data, "notification_type", "notificationType") ===
      "dm_message_v2" &&
    dataString(data, "notification_kind", "notificationKind") ===
      "dm_message_v2";
}

function shareIdFromData(data: Record<string, unknown>) {
  return dataString(data, "share_id", "shareId") ??
    dataString(data, "message_share_id", "messageShareId") ??
    dataString(data, "message_id", "messageId");
}

function flowSharePayloadKind(row: DmShareRow) {
  return firstString(row.payload_json?.type) ??
    firstString(row.payload_json?.kind);
}

export async function authorizeUserJwtDmPush(params: {
  requesterUid: string | null;
  userIds?: string[];
  data?: Record<string, unknown>;
  lookupShare: DmShareLookup;
  lookupConversationMembers?: DmConversationMembersLookup;
  lookupMessage?: DmMessageLookup;
}): Promise<UserJwtDmPushAuthorizationResult> {
  const data = params.data;
  if (!data || !hasDirectMessageCandidateShape(data)) {
    return { ok: true, applies: false };
  }

  if (!params.requesterUid) {
    return {
      ok: false,
      status: 403,
      error: "DM push requires authenticated requester",
      log: { reason: "missing_requester" },
    };
  }

  const isDirectMessage = hasExactDirectMessageShape(data);
  const isDirectMessageLike = hasExactDirectMessageLikeShape(data);
  const isDmMessageV2 = hasExactDmMessageV2Shape(data);
  if (!isDirectMessage && !isDirectMessageLike && !isDmMessageV2) {
    return {
      ok: false,
      status: 400,
      error: "Malformed DM push payload",
      log: { reason: "malformed_dm_payload" },
    };
  }

  const senderId = dataString(data, "sender_id", "senderId");
  if (!senderId) {
    return {
      ok: false,
      status: 400,
      error: "DM push sender_id required",
      log: { reason: "missing_sender_id" },
    };
  }
  if (senderId !== params.requesterUid) {
    return {
      ok: false,
      status: 403,
      error: "DM push not authorized",
      log: { reason: "sender_mismatch" },
    };
  }

  if (isDmMessageV2) {
    const conversationId = dataString(
      data,
      "conversation_id",
      "conversationId",
    );
    if (!conversationId) {
      return {
        ok: false,
        status: 400,
        error: "DM conversation_id required",
        log: { reason: "missing_conversation_id" },
      };
    }

    if (!params.lookupConversationMembers) {
      return {
        ok: false,
        status: 403,
        error: "DM push not authorized",
        log: { reason: "missing_dm_v2_member_lookup" },
      };
    }

    const userIds = (params.userIds ?? []).map((userId) => userId.trim())
      .filter((userId) => userId.length > 0);
    if (
      userIds.length === 0 ||
      new Set(userIds).size !== userIds.length ||
      userIds.includes(params.requesterUid)
    ) {
      return {
        ok: false,
        status: 403,
        error: "DM push recipient mismatch",
        log: {
          reason: "recipient_mismatch",
          userIdsLength: userIds.length,
        },
      };
    }

    const members = await params.lookupConversationMembers(conversationId);
    const activeUserIds = new Set(
      members
        .filter((member) => !member.left_at && !member.deleted_at)
        .map((member) => member.user_id),
    );
    if (!activeUserIds.has(params.requesterUid)) {
      return {
        ok: false,
        status: 403,
        error: "DM push not authorized",
        log: { reason: "sender_not_conversation_member" },
      };
    }
    for (const userId of userIds) {
      if (!activeUserIds.has(userId)) {
        return {
          ok: false,
          status: 403,
          error: "DM push recipient mismatch",
          log: { reason: "recipient_not_conversation_member" },
        };
      }
    }

    const messageId = dataString(data, "message_id", "messageId");
    if (messageId && params.lookupMessage) {
      const message = await params.lookupMessage(messageId);
      if (
        !message ||
        message.deleted_at ||
        message.conversation_id !== conversationId ||
        message.sender_id !== params.requesterUid
      ) {
        return {
          ok: false,
          status: 403,
          error: "DM push not authorized",
          log: { reason: "message_mismatch" },
        };
      }
    }

    return { ok: true, applies: true };
  }

  const conversationUserId = dataString(
    data,
    "conversation_user_id",
    "conversationUserId",
  );
  if (conversationUserId !== params.requesterUid) {
    return {
      ok: false,
      status: 400,
      error: "Malformed DM push payload",
      log: {
        reason: "conversation_user_mismatch",
        conversationUserId,
      },
    };
  }

  const shareId = shareIdFromData(data);
  if (!shareId) {
    return {
      ok: false,
      status: 400,
      error: "DM push share_id required",
      log: { reason: "missing_share_id" },
    };
  }

  const userIds = params.userIds ?? [];
  if (userIds.length !== 1) {
    return {
      ok: false,
      status: 403,
      error: "DM push recipient mismatch",
      log: {
        reason: "recipient_count_mismatch",
        userIdsLength: userIds.length,
      },
    };
  }

  const row = await params.lookupShare(shareId);
  if (!row) {
    return {
      ok: false,
      status: 403,
      error: "DM push not authorized",
      log: { reason: "share_not_found", shareId },
    };
  }

  const recipientId = userIds[0]?.trim();
  if (!recipientId) {
    return {
      ok: false,
      status: 403,
      error: "DM push recipient mismatch",
      log: {
        reason: "recipient_mismatch",
        shareId,
      },
    };
  }

  if (row.deleted_at) {
    return {
      ok: false,
      status: 403,
      error: "DM push not authorized",
      log: { reason: "share_deleted", shareId },
    };
  }

  const payloadKind = flowSharePayloadKind(row);
  if (row.channel !== "in_app" || payloadKind !== "message") {
    return {
      ok: false,
      status: 403,
      error: "DM push not authorized",
      log: {
        reason: "not_dm_message_share",
        shareId,
        channel: row.channel,
        payloadKind,
      },
    };
  }

  if (isDirectMessage) {
    if (row.recipient_id !== recipientId) {
      return {
        ok: false,
        status: 403,
        error: "DM push recipient mismatch",
        log: {
          reason: "recipient_mismatch",
          shareId,
          recipientId,
          rowRecipientId: row.recipient_id,
        },
      };
    }

    if (row.sender_id !== params.requesterUid) {
      return {
        ok: false,
        status: 403,
        error: "DM push not authorized",
        log: {
          reason: "share_sender_mismatch",
          shareId,
          rowSenderId: row.sender_id,
        },
      };
    }
  }

  if (isDirectMessageLike) {
    if (
      row.recipient_id !== params.requesterUid || row.sender_id !== recipientId
    ) {
      return {
        ok: false,
        status: 403,
        error: "DM push recipient mismatch",
        log: {
          reason: "like_participant_mismatch",
          shareId,
          requesterUid: params.requesterUid,
          recipientId,
          rowSenderId: row.sender_id,
          rowRecipientId: row.recipient_id,
        },
      };
    }
  }

  return { ok: true, applies: true };
}
