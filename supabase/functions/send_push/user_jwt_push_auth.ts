import {
  authorizeUserJwtDmPush,
  type DmConversationMembersLookup,
  type DmMessageLookup,
  type DmShareLookup,
  type DmShareRow,
} from "./user_jwt_dm_auth.ts";

type AuthorizedUserJwtPushKind =
  | "direct_message"
  | "dm_message_v2"
  | "direct_message_like"
  | "push_test"
  | "flow_share"
  | "event_invite"
  | "calendar_invite"
  | "calendar_invite_response"
  | "calendar_event"
  | "follow"
  | "flow_like"
  | "flow_comment"
  | "flow_comment_reply"
  | "flow_comment_like";

export type ActiveDeviceLookup = (params: {
  requesterUid: string;
  deviceIds: string[];
}) => Promise<string[]>;

export type EventShareRow = {
  id: string;
  event_id: string | null;
  sender_id: string | null;
  recipient_id: string | null;
  channel?: string | null;
  status?: string | null;
  deleted_at?: string | null;
  payload_json?: Record<string, unknown> | null;
  response_status?: string | null;
};

export type SharedCalendarRow = {
  id: string;
  owner_id: string | null;
  is_personal?: boolean | null;
  deleted_at?: string | null;
};

export type SharedCalendarMemberRow = {
  calendar_id: string;
  user_id: string;
  role: string | null;
  status: string | null;
  invited_by?: string | null;
};

export type FlowPostRow = {
  id: string;
  user_id: string | null;
};

export type FlowPostCommentRow = {
  id: string;
  flow_post_id: string | null;
  user_id: string | null;
  parent_comment_id?: string | null;
};

export type UserJwtPushAuthorizationLookups = {
  lookupShare: DmShareLookup;
  lookupDmConversationMembers: DmConversationMembersLookup;
  lookupDmMessage: DmMessageLookup;
  lookupEventShare: (shareId: string) => Promise<EventShareRow | null>;
  lookupSharedCalendar: (
    calendarId: string,
  ) => Promise<SharedCalendarRow | null>;
  lookupSharedCalendarMembers: (params: {
    calendarId: string;
    userIds: string[];
  }) => Promise<SharedCalendarMemberRow[]>;
  lookupFollow: (params: {
    followerId: string;
    followeeId: string;
  }) => Promise<boolean>;
  lookupFlowPost: (flowPostId: string) => Promise<FlowPostRow | null>;
  lookupFlowPostLike: (params: {
    flowPostId: string;
    userId: string;
  }) => Promise<boolean>;
  lookupFlowPostComment: (
    commentId: string,
  ) => Promise<FlowPostCommentRow | null>;
  lookupFlowPostCommentsByBody: (params: {
    flowPostId: string;
    userId: string;
    body: string;
  }) => Promise<FlowPostCommentRow[]>;
  lookupFlowPostCommentLike: (params: {
    commentId: string;
    userId: string;
  }) => Promise<boolean>;
  lookupActiveDeviceIds: ActiveDeviceLookup;
};

export type UserJwtPushAuthorizationResult =
  | { ok: true; kind: AuthorizedUserJwtPushKind }
  | {
    ok: false;
    status: 400 | 403;
    error: string;
    log?: Record<string, unknown>;
  };

function denied(
  status: 400 | 403,
  error: string,
  reason: string,
  log: Record<string, unknown> = {},
): UserJwtPushAuthorizationResult {
  return { ok: false, status, error, log: { reason, ...log } };
}

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

function payloadKind(data: Record<string, unknown> | undefined) {
  return dataString(data, "type") ?? dataString(data, "kind");
}

function matchesKind(data: Record<string, unknown>, expected: string) {
  const type = dataString(data, "type");
  const kind = dataString(data, "kind");
  if (type && type !== expected) return false;
  if (kind && kind !== expected) return false;
  return type === expected || kind === expected;
}

function exactKindFromDmData(data: Record<string, unknown>) {
  const type = dataString(data, "type");
  const notificationType = dataString(
    data,
    "notification_type",
    "notificationType",
  );
  if (type === "dm" || notificationType === "direct_message") {
    return "direct_message";
  }
  if (type === "dm_message_v2" || notificationType === "dm_message_v2") {
    return "dm_message_v2";
  }
  if (
    type === "dm_message_like" || notificationType === "direct_message_like"
  ) {
    return "direct_message_like";
  }
  return "direct_message";
}

function senderMatchesRequesterIfPresent(
  data: Record<string, unknown>,
  requesterUid: string,
) {
  const senderId = dataString(data, "sender_id", "senderId");
  return !senderId || senderId === requesterUid;
}

function shareIdFromData(data: Record<string, unknown>) {
  return dataString(data, "share_id", "shareId") ??
    dataString(data, "message_share_id", "messageShareId") ??
    dataString(data, "message_id", "messageId");
}

function calendarIdFromData(data: Record<string, unknown>) {
  return dataString(data, "calendar_id", "calendarId");
}

function flowPostIdFromData(data: Record<string, unknown>) {
  return dataString(data, "flow_post_id", "flowPostId");
}

function commentIdFromData(data: Record<string, unknown>) {
  return dataString(data, "comment_id", "commentId") ??
    dataString(data, "flow_comment_id", "flowCommentId");
}

function parentCommentIdFromData(data: Record<string, unknown>) {
  return dataString(data, "parent_comment_id", "parentCommentId");
}

function normalizedStringArray(values?: string[]) {
  return (values ?? []).map((value) => value.trim()).filter((value) =>
    value.length > 0
  );
}

function normalizedStringSet(values?: string[]) {
  return new Set(normalizedStringArray(values));
}

function requireRequester(
  requesterUid: string | null,
): string | UserJwtPushAuthorizationResult {
  if (requesterUid) return requesterUid;
  return denied(403, "Authenticated requester required", "missing_requester");
}

function requireExactRecipients(
  userIds: string[] | undefined,
  expectedUserIds: string[],
  reason = "recipient_mismatch",
) {
  const actual = normalizedStringArray(userIds);
  const expected = normalizedStringArray(expectedUserIds);
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    new Set(expected).size !== expected.length
  ) {
    return denied(403, "Push recipient mismatch", reason, {
      userIdsLength: actual.length,
      expectedUserIdsLength: expected.length,
    });
  }
  const actualSet = new Set(actual);
  for (const userId of expected) {
    if (!actualSet.has(userId)) {
      return denied(403, "Push recipient mismatch", reason, {
        userIds: actual,
        expectedUserIds: expected,
      });
    }
  }
  return null;
}

function hasPushTestCandidateShape(data: Record<string, unknown>) {
  const values = [
    dataString(data, "type"),
    dataString(data, "kind"),
    dataString(data, "notification_type", "notificationType"),
    dataString(data, "notification_kind", "notificationKind"),
    dataString(data, "delivery_kind", "deliveryKind"),
  ];
  const deliveryKey = dataString(data, "delivery_key", "deliveryKey");
  return values.includes("push_test") ||
    deliveryKey?.startsWith("push_test:") === true;
}

function hasExactPushTestShape(data: Record<string, unknown>) {
  const deliveryKind = dataString(data, "delivery_kind", "deliveryKind");
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
  return dataString(data, "type") === "push_test" &&
    dataString(data, "kind") === "push_test" &&
    (deliveryKind == null || deliveryKind === "push_test") &&
    (notificationType == null || notificationType === "push_test") &&
    (notificationKind == null || notificationKind === "push_test");
}

async function authorizeUserJwtPushTest(params: {
  requesterUid: string | null;
  userIds?: string[];
  deviceIds?: string[];
  data: Record<string, unknown>;
  lookupActiveDeviceIds: ActiveDeviceLookup;
}): Promise<UserJwtPushAuthorizationResult> {
  const requesterUid = requireRequester(params.requesterUid);
  if (typeof requesterUid !== "string") return requesterUid;

  if (!hasExactPushTestShape(params.data)) {
    return denied(
      400,
      "Malformed push_test payload",
      "malformed_push_test_payload",
    );
  }

  const recipientError = requireExactRecipients(
    params.userIds,
    [requesterUid],
    "push_test_recipient_mismatch",
  );
  if (recipientError) return recipientError;

  const deliveryKey = dataString(params.data, "delivery_key", "deliveryKey");
  if (!deliveryKey || !deliveryKey.startsWith(`push_test:${requesterUid}:`)) {
    return denied(
      400,
      "Malformed push_test payload",
      "push_test_delivery_key_mismatch",
      {
        deliveryKey,
      },
    );
  }

  if (params.deviceIds !== undefined) {
    const requestedDeviceIds = normalizedStringSet(params.deviceIds);
    if (requestedDeviceIds.size === 0) {
      return denied(
        400,
        "Push test deviceIds malformed",
        "push_test_empty_device_ids",
      );
    }

    const activeDeviceIds = normalizedStringSet(
      await params.lookupActiveDeviceIds({
        requesterUid,
        deviceIds: Array.from(requestedDeviceIds),
      }),
    );
    for (const deviceId of requestedDeviceIds) {
      if (!activeDeviceIds.has(deviceId)) {
        return denied(
          403,
          "Push test device mismatch",
          "push_test_device_mismatch",
          {
            requesterUid,
            deviceId,
          },
        );
      }
    }
  }

  return { ok: true, kind: "push_test" };
}

async function authorizeFlowSharePush(params: {
  requesterUid: string | null;
  userIds?: string[];
  data: Record<string, unknown>;
  lookupShare: DmShareLookup;
}): Promise<UserJwtPushAuthorizationResult> {
  const requesterUid = requireRequester(params.requesterUid);
  if (typeof requesterUid !== "string") return requesterUid;

  if (!matchesKind(params.data, "flow_share")) {
    return denied(
      400,
      "Malformed flow_share payload",
      "malformed_flow_share_payload",
    );
  }
  if (!senderMatchesRequesterIfPresent(params.data, requesterUid)) {
    return denied(403, "Flow share push not authorized", "sender_mismatch");
  }
  const shareId = shareIdFromData(params.data);
  if (!shareId) {
    return denied(400, "Flow share push share_id required", "missing_share_id");
  }

  const row = await params.lookupShare(shareId);
  if (!row) {
    return denied(403, "Flow share push not authorized", "share_not_found", {
      shareId,
    });
  }
  if (row.deleted_at || row.channel !== "in_app") {
    return denied(
      403,
      "Flow share push not authorized",
      "not_active_in_app_share",
      {
        shareId,
        channel: row.channel,
        deleted: Boolean(row.deleted_at),
      },
    );
  }
  const rowPayloadKind = payloadKind(row.payload_json ?? undefined);
  if (rowPayloadKind === "message") {
    return denied(
      403,
      "Flow share push not authorized",
      "not_flow_share_row",
      {
        shareId,
        rowPayloadKind,
      },
    );
  }
  if (row.sender_id !== requesterUid || !row.recipient_id) {
    return denied(
      403,
      "Flow share push not authorized",
      "share_sender_mismatch",
      {
        shareId,
        rowSenderId: row.sender_id,
      },
    );
  }
  const recipientError = requireExactRecipients(
    params.userIds,
    [row.recipient_id],
    "recipient_mismatch",
  );
  if (recipientError) return recipientError;

  return { ok: true, kind: "flow_share" };
}

async function authorizeEventInvitePush(params: {
  requesterUid: string | null;
  userIds?: string[];
  data: Record<string, unknown>;
  lookupEventShare: (shareId: string) => Promise<EventShareRow | null>;
}): Promise<UserJwtPushAuthorizationResult> {
  const requesterUid = requireRequester(params.requesterUid);
  if (typeof requesterUid !== "string") return requesterUid;

  if (!matchesKind(params.data, "event_invite")) {
    return denied(
      400,
      "Malformed event_invite payload",
      "malformed_event_invite_payload",
    );
  }
  if (!senderMatchesRequesterIfPresent(params.data, requesterUid)) {
    return denied(403, "Event invite push not authorized", "sender_mismatch");
  }
  const shareId = shareIdFromData(params.data);
  if (!shareId) {
    return denied(
      400,
      "Event invite push share_id required",
      "missing_share_id",
    );
  }

  const row = await params.lookupEventShare(shareId);
  if (!row) {
    return denied(403, "Event invite push not authorized", "share_not_found", {
      shareId,
    });
  }
  if (row.deleted_at || row.channel !== "in_app") {
    return denied(
      403,
      "Event invite push not authorized",
      "not_active_in_app_share",
      {
        shareId,
        channel: row.channel,
        deleted: Boolean(row.deleted_at),
      },
    );
  }
  if (!row.sender_id || !row.recipient_id) {
    return denied(
      403,
      "Event invite push not authorized",
      "missing_share_participant",
      {
        shareId,
      },
    );
  }

  const responseStatus = dataString(
    params.data,
    "response_status",
    "responseStatus",
  );
  if (responseStatus) {
    if (row.recipient_id !== requesterUid) {
      return denied(
        403,
        "Event invite push not authorized",
        "response_actor_mismatch",
        {
          shareId,
        },
      );
    }
    if (row.response_status && row.response_status !== responseStatus) {
      return denied(
        403,
        "Event invite push not authorized",
        "response_status_mismatch",
        {
          shareId,
          responseStatus,
          rowResponseStatus: row.response_status,
        },
      );
    }
    const recipientError = requireExactRecipients(
      params.userIds,
      [row.sender_id],
      "recipient_mismatch",
    );
    if (recipientError) return recipientError;
    return { ok: true, kind: "event_invite" };
  }

  if (row.sender_id !== requesterUid) {
    return denied(
      403,
      "Event invite push not authorized",
      "share_sender_mismatch",
      {
        shareId,
        rowSenderId: row.sender_id,
      },
    );
  }
  const recipientError = requireExactRecipients(
    params.userIds,
    [row.recipient_id],
    "recipient_mismatch",
  );
  if (recipientError) return recipientError;
  return { ok: true, kind: "event_invite" };
}

function memberByUserId(rows: SharedCalendarMemberRow[], userId: string) {
  return rows.find((row) => row.user_id === userId) ?? null;
}

async function authorizeSharedCalendarPush(params: {
  requesterUid: string | null;
  userIds?: string[];
  data: Record<string, unknown>;
  kind: "calendar_invite" | "calendar_invite_response" | "calendar_event";
  lookupSharedCalendar: (
    calendarId: string,
  ) => Promise<SharedCalendarRow | null>;
  lookupSharedCalendarMembers: (params: {
    calendarId: string;
    userIds: string[];
  }) => Promise<SharedCalendarMemberRow[]>;
}): Promise<UserJwtPushAuthorizationResult> {
  const requesterUid = requireRequester(params.requesterUid);
  if (typeof requesterUid !== "string") return requesterUid;

  if (!matchesKind(params.data, params.kind)) {
    return denied(
      400,
      "Malformed shared calendar payload",
      "malformed_shared_calendar_payload",
    );
  }
  if (!senderMatchesRequesterIfPresent(params.data, requesterUid)) {
    return denied(
      403,
      "Shared calendar push not authorized",
      "sender_mismatch",
    );
  }
  const calendarId = calendarIdFromData(params.data);
  if (!calendarId) {
    return denied(
      400,
      "Shared calendar push calendar_id required",
      "missing_calendar_id",
    );
  }

  const recipients = normalizedStringArray(params.userIds);
  if (!recipients.length || new Set(recipients).size !== recipients.length) {
    return denied(403, "Push recipient mismatch", "recipient_mismatch", {
      userIdsLength: recipients.length,
    });
  }

  const calendar = await params.lookupSharedCalendar(calendarId);
  if (!calendar || calendar.deleted_at || calendar.is_personal) {
    return denied(
      403,
      "Shared calendar push not authorized",
      "calendar_not_found",
      {
        calendarId,
      },
    );
  }

  const memberRows = await params.lookupSharedCalendarMembers({
    calendarId,
    userIds: Array.from(new Set([requesterUid, ...recipients])),
  });
  const requesterMember = memberByUserId(memberRows, requesterUid);

  if (params.kind === "calendar_invite") {
    if (recipients.length !== 1) {
      return denied(403, "Push recipient mismatch", "recipient_count_mismatch");
    }
    if (
      !requesterMember ||
      requesterMember.status !== "accepted" ||
      requesterMember.role !== "owner" ||
      calendar.owner_id !== requesterUid
    ) {
      return denied(
        403,
        "Shared calendar push not authorized",
        "calendar_not_invitable",
        {
          calendarId,
        },
      );
    }
    const inviteeId = recipients.at(0);
    if (!inviteeId) {
      return denied(403, "Push recipient mismatch", "recipient_count_mismatch");
    }
    const inviteeMember = memberByUserId(memberRows, inviteeId);
    if (
      !inviteeMember ||
      inviteeMember.status !== "pending" ||
      inviteeMember.invited_by !== requesterUid
    ) {
      return denied(
        403,
        "Shared calendar push not authorized",
        "invite_row_mismatch",
        {
          calendarId,
          recipientId: inviteeId,
        },
      );
    }
    return { ok: true, kind: "calendar_invite" };
  }

  if (params.kind === "calendar_invite_response") {
    if (recipients.length !== 1) {
      return denied(403, "Push recipient mismatch", "recipient_count_mismatch");
    }
    const inviterId = recipients.at(0);
    if (!inviterId) {
      return denied(403, "Push recipient mismatch", "recipient_count_mismatch");
    }
    const responderMember = requesterMember;
    const inviteStatus = dataString(
      params.data,
      "invite_status",
      "inviteStatus",
    );
    if (
      !responderMember ||
      responderMember.invited_by !== inviterId ||
      !["accepted", "declined"].includes(responderMember.status ?? "")
    ) {
      return denied(
        403,
        "Shared calendar push not authorized",
        "invite_response_row_mismatch",
        {
          calendarId,
        },
      );
    }
    if (inviteStatus && responderMember.status !== inviteStatus) {
      return denied(
        403,
        "Shared calendar push not authorized",
        "invite_status_mismatch",
        {
          calendarId,
          inviteStatus,
          rowStatus: responderMember.status,
        },
      );
    }
    return { ok: true, kind: "calendar_invite_response" };
  }

  if (
    !requesterMember ||
    requesterMember.status !== "accepted" ||
    !["owner", "editor"].includes(requesterMember.role ?? "")
  ) {
    return denied(
      403,
      "Shared calendar push not authorized",
      "calendar_not_editable",
      {
        calendarId,
      },
    );
  }
  if (recipients.includes(requesterUid)) {
    return denied(403, "Push recipient mismatch", "recipient_includes_actor", {
      calendarId,
    });
  }
  for (const recipientId of recipients) {
    const member = memberByUserId(memberRows, recipientId);
    if (!member || member.status !== "accepted") {
      return denied(
        403,
        "Shared calendar push not authorized",
        "recipient_not_member",
        {
          calendarId,
          recipientId,
        },
      );
    }
  }
  return { ok: true, kind: "calendar_event" };
}

async function authorizeFollowPush(params: {
  requesterUid: string | null;
  userIds?: string[];
  data: Record<string, unknown>;
  lookupFollow: (params: {
    followerId: string;
    followeeId: string;
  }) => Promise<boolean>;
}): Promise<UserJwtPushAuthorizationResult> {
  const requesterUid = requireRequester(params.requesterUid);
  if (typeof requesterUid !== "string") return requesterUid;

  if (!matchesKind(params.data, "follow")) {
    return denied(400, "Malformed follow payload", "malformed_follow_payload");
  }
  if (!senderMatchesRequesterIfPresent(params.data, requesterUid)) {
    return denied(403, "Follow push not authorized", "sender_mismatch");
  }
  const recipients = normalizedStringArray(params.userIds);
  const recipientError = recipients.length === 1
    ? null
    : denied(403, "Push recipient mismatch", "recipient_count_mismatch");
  if (recipientError) return recipientError;
  const followeeId = recipients.at(0);
  if (!followeeId) {
    return denied(403, "Push recipient mismatch", "recipient_count_mismatch");
  }
  if (
    !await params.lookupFollow({ followerId: requesterUid, followeeId })
  ) {
    return denied(403, "Follow push not authorized", "follow_row_not_found", {
      followeeId,
    });
  }
  return { ok: true, kind: "follow" };
}

async function authorizeFlowSocialPush(params: {
  requesterUid: string | null;
  userIds?: string[];
  data: Record<string, unknown>;
  notificationBody?: string | null;
  kind:
    | "flow_like"
    | "flow_comment"
    | "flow_comment_reply"
    | "flow_comment_like";
  lookupFlowPost: (flowPostId: string) => Promise<FlowPostRow | null>;
  lookupFlowPostLike: (params: {
    flowPostId: string;
    userId: string;
  }) => Promise<boolean>;
  lookupFlowPostComment: (
    commentId: string,
  ) => Promise<FlowPostCommentRow | null>;
  lookupFlowPostCommentsByBody: (params: {
    flowPostId: string;
    userId: string;
    body: string;
  }) => Promise<FlowPostCommentRow[]>;
  lookupFlowPostCommentLike: (params: {
    commentId: string;
    userId: string;
  }) => Promise<boolean>;
}): Promise<UserJwtPushAuthorizationResult> {
  const requesterUid = requireRequester(params.requesterUid);
  if (typeof requesterUid !== "string") return requesterUid;

  if (!matchesKind(params.data, params.kind)) {
    return denied(
      400,
      "Malformed flow social payload",
      "malformed_flow_social_payload",
    );
  }
  const flowPostId = flowPostIdFromData(params.data);
  if (!flowPostId) {
    return denied(
      400,
      "Flow social push flow_post_id required",
      "missing_flow_post_id",
    );
  }

  const post = await params.lookupFlowPost(flowPostId);
  if (!post || !post.user_id) {
    return denied(
      403,
      "Flow social push not authorized",
      "flow_post_not_found",
      {
        flowPostId,
      },
    );
  }

  if (params.kind === "flow_like") {
    if (
      !await params.lookupFlowPostLike({ flowPostId, userId: requesterUid })
    ) {
      return denied(
        403,
        "Flow social push not authorized",
        "flow_like_row_not_found",
        {
          flowPostId,
        },
      );
    }
    const recipientError = requireExactRecipients(
      params.userIds,
      [post.user_id],
      "recipient_mismatch",
    );
    if (recipientError) return recipientError;
    return { ok: true, kind: "flow_like" };
  }

  const commentId = commentIdFromData(params.data);
  let comment: FlowPostCommentRow | null = null;
  if (commentId) {
    comment = await params.lookupFlowPostComment(commentId);
  } else {
    const oldClientRecipient = normalizedStringArray(params.userIds)[0];
    const body = typeof params.notificationBody === "string"
      ? params.notificationBody.trim()
      : "";
    if (!body || !oldClientRecipient) {
      return denied(
        400,
        "Flow social push comment_id required",
        "missing_comment_id",
      );
    }
    const candidateUserId = params.kind === "flow_comment_like"
      ? oldClientRecipient
      : requesterUid;
    const candidates = await params.lookupFlowPostCommentsByBody({
      flowPostId,
      userId: candidateUserId,
      body,
    });
    if (candidates.length !== 1) {
      return denied(
        403,
        "Flow social push not authorized",
        "ambiguous_comment_row",
        {
          flowPostId,
          candidateCount: candidates.length,
        },
      );
    }
    comment = candidates[0];
  }
  if (
    !comment ||
    (comment.user_id !== requesterUid && params.kind !== "flow_comment_like") ||
    comment.flow_post_id !== flowPostId
  ) {
    return denied(
      403,
      "Flow social push not authorized",
      "comment_row_mismatch",
      {
        commentId,
        flowPostId,
      },
    );
  }

  if (params.kind === "flow_comment") {
    const recipientError = requireExactRecipients(
      params.userIds,
      [post.user_id],
      "recipient_mismatch",
    );
    if (recipientError) return recipientError;
    return { ok: true, kind: "flow_comment" };
  }

  if (params.kind === "flow_comment_reply") {
    const parentCommentId = parentCommentIdFromData(params.data) ??
      comment.parent_comment_id;
    if (!parentCommentId || parentCommentId !== comment.parent_comment_id) {
      return denied(
        403,
        "Flow social push not authorized",
        "parent_comment_mismatch",
        {
          commentId,
          parentCommentId,
        },
      );
    }
    const parentComment = await params.lookupFlowPostComment(parentCommentId);
    if (
      !parentComment || !parentComment.user_id ||
      parentComment.flow_post_id !== flowPostId
    ) {
      return denied(
        403,
        "Flow social push not authorized",
        "parent_comment_not_found",
        {
          parentCommentId,
        },
      );
    }
    const recipientError = requireExactRecipients(
      params.userIds,
      [parentComment.user_id],
      "recipient_mismatch",
    );
    if (recipientError) return recipientError;
    return { ok: true, kind: "flow_comment_reply" };
  }

  const commentUserId = comment.user_id;
  if (!commentUserId) {
    return denied(
      403,
      "Flow social push not authorized",
      "comment_author_missing",
      {
        commentId: comment.id,
      },
    );
  }
  if (commentUserId === requesterUid) {
    return denied(
      403,
      "Flow social push not authorized",
      "recipient_includes_actor",
      {
        commentId: comment.id,
      },
    );
  }
  if (
    !await params.lookupFlowPostCommentLike({
      commentId: comment.id,
      userId: requesterUid,
    })
  ) {
    return denied(
      403,
      "Flow social push not authorized",
      "comment_like_row_not_found",
      {
        commentId: comment.id,
      },
    );
  }
  const recipientError = requireExactRecipients(
    params.userIds,
    [commentUserId],
    "recipient_mismatch",
  );
  if (recipientError) return recipientError;
  return { ok: true, kind: "flow_comment_like" };
}

export async function authorizeUserJwtPush(params: {
  requesterUid: string | null;
  userIds?: string[];
  deviceIds?: string[];
  data?: Record<string, unknown>;
  notificationBody?: string | null;
  lookups: UserJwtPushAuthorizationLookups;
}): Promise<UserJwtPushAuthorizationResult> {
  const dmPushAuth = await authorizeUserJwtDmPush({
    requesterUid: params.requesterUid,
    userIds: params.userIds,
    data: params.data,
    lookupShare: params.lookups.lookupShare,
    lookupConversationMembers: params.lookups.lookupDmConversationMembers,
    lookupMessage: params.lookups.lookupDmMessage,
  });
  if (dmPushAuth.ok === false) {
    return {
      ok: false,
      status: dmPushAuth.status,
      error: dmPushAuth.error,
      log: dmPushAuth.log,
    };
  }
  if (dmPushAuth.applies) {
    return {
      ok: true,
      kind: exactKindFromDmData(params.data ?? {}),
    };
  }

  const data = params.data;
  if (data && hasPushTestCandidateShape(data)) {
    return await authorizeUserJwtPushTest({
      requesterUid: params.requesterUid,
      userIds: params.userIds,
      deviceIds: params.deviceIds,
      data,
      lookupActiveDeviceIds: params.lookups.lookupActiveDeviceIds,
    });
  }
  if (!data) {
    return denied(
      403,
      "Unsupported user-JWT push type",
      "unsupported_user_jwt_push_type",
    );
  }

  const kind = payloadKind(data);
  switch (kind) {
    case "flow_share":
      return await authorizeFlowSharePush({
        requesterUid: params.requesterUid,
        userIds: params.userIds,
        data,
        lookupShare: params.lookups.lookupShare,
      });
    case "event_invite":
      return await authorizeEventInvitePush({
        requesterUid: params.requesterUid,
        userIds: params.userIds,
        data,
        lookupEventShare: params.lookups.lookupEventShare,
      });
    case "calendar_invite":
    case "calendar_invite_response":
    case "calendar_event":
      return await authorizeSharedCalendarPush({
        requesterUid: params.requesterUid,
        userIds: params.userIds,
        data,
        kind,
        lookupSharedCalendar: params.lookups.lookupSharedCalendar,
        lookupSharedCalendarMembers: params.lookups.lookupSharedCalendarMembers,
      });
    case "follow":
      return await authorizeFollowPush({
        requesterUid: params.requesterUid,
        userIds: params.userIds,
        data,
        lookupFollow: params.lookups.lookupFollow,
      });
    case "flow_like":
    case "flow_comment":
    case "flow_comment_reply":
    case "flow_comment_like":
      return await authorizeFlowSocialPush({
        requesterUid: params.requesterUid,
        userIds: params.userIds,
        data,
        notificationBody: params.notificationBody,
        kind,
        lookupFlowPost: params.lookups.lookupFlowPost,
        lookupFlowPostLike: params.lookups.lookupFlowPostLike,
        lookupFlowPostComment: params.lookups.lookupFlowPostComment,
        lookupFlowPostCommentsByBody:
          params.lookups.lookupFlowPostCommentsByBody,
        lookupFlowPostCommentLike: params.lookups.lookupFlowPostCommentLike,
      });
    default:
      return denied(
        403,
        "Unsupported user-JWT push type",
        "unsupported_user_jwt_push_type",
        {
          type: dataString(data, "type"),
          kind: dataString(data, "kind"),
          notificationType: dataString(
            data,
            "notification_type",
            "notificationType",
          ),
          notificationKind: dataString(
            data,
            "notification_kind",
            "notificationKind",
          ),
        },
      );
  }
}
