import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { DmShareRow } from "./user_jwt_dm_auth.ts";
import {
  authorizeUserJwtPush,
  type EventShareRow,
  type FlowPostCommentRow,
  type FlowPostRow,
  type SharedCalendarMemberRow,
  type SharedCalendarRow,
  type UserJwtPushAuthorizationLookups,
  type UserJwtPushAuthorizationResult,
} from "./user_jwt_push_auth.ts";

type PushAuthResult = Awaited<ReturnType<typeof authorizeUserJwtPush>>;

const validDmData = {
  type: "dm",
  kind: "dm",
  notification_type: "direct_message",
  notification_kind: "direct_message",
  sender_id: "user-a",
  conversation_user_id: "user-a",
  share_id: "share-1",
};

const validDmLikeData = {
  type: "dm_message_like",
  kind: "dm",
  notification_type: "direct_message_like",
  notification_kind: "direct_message_like",
  sender_id: "user-b",
  conversation_user_id: "user-b",
  share_id: "share-1",
};

const validDmMessageV2Data = {
  type: "dm_message_v2",
  kind: "dm",
  notification_type: "dm_message_v2",
  notification_kind: "dm_message_v2",
  sender_id: "user-a",
  conversation_id: "conversation-1",
  message_id: "message-1",
};

const validPushTestData = {
  type: "push_test",
  kind: "push_test",
  delivery_kind: "push_test",
  notification_type: "push_test",
  notification_kind: "push_test",
  delivery_key: "push_test:user-a:device-1:2026-06-10T16:00:00.000Z",
};

function shareRow(overrides: Partial<DmShareRow> = {}): DmShareRow {
  return {
    id: "share-1",
    sender_id: "user-a",
    recipient_id: "user-b",
    channel: "in_app",
    status: "sent",
    deleted_at: null,
    payload_json: { type: "flow_share", name: "Plan" },
    ...overrides,
  };
}

function eventShareRow(
  overrides: Partial<EventShareRow> = {},
): EventShareRow {
  return {
    id: "event-share-1",
    event_id: "event-1",
    sender_id: "user-a",
    recipient_id: "user-b",
    channel: "in_app",
    status: "sent",
    deleted_at: null,
    payload_json: { type: "event_invite", title: "Lunch" },
    response_status: "no_response",
    ...overrides,
  };
}

const calendarRow: SharedCalendarRow = {
  id: "calendar-1",
  owner_id: "user-a",
  is_personal: false,
  deleted_at: null,
};

const calendarMembers: SharedCalendarMemberRow[] = [
  {
    calendar_id: "calendar-1",
    user_id: "user-a",
    role: "owner",
    status: "accepted",
  },
  {
    calendar_id: "calendar-1",
    user_id: "user-b",
    role: "editor",
    status: "pending",
    invited_by: "user-a",
  },
  {
    calendar_id: "calendar-1",
    user_id: "user-c",
    role: "viewer",
    status: "accepted",
    invited_by: "user-a",
  },
];

const flowPost: FlowPostRow = { id: "post-1", user_id: "user-b" };
const flowComment: FlowPostCommentRow = {
  id: "comment-1",
  flow_post_id: "post-1",
  user_id: "user-a",
  parent_comment_id: null,
};
const parentComment: FlowPostCommentRow = {
  id: "comment-parent",
  flow_post_id: "post-1",
  user_id: "user-c",
  parent_comment_id: null,
};
const replyComment: FlowPostCommentRow = {
  id: "comment-reply",
  flow_post_id: "post-1",
  user_id: "user-a",
  parent_comment_id: "comment-parent",
};

function makeLookups(
  overrides: Partial<UserJwtPushAuthorizationLookups> = {},
): UserJwtPushAuthorizationLookups {
  const comments = new Map(
    [flowComment, parentComment, replyComment].map((comment) => [
      comment.id,
      comment,
    ]),
  );
  const defaults: UserJwtPushAuthorizationLookups = {
    lookupShare: (shareId) =>
      Promise.resolve(shareId === "share-1" ? shareRow() : null),
    lookupDmConversationMembers: (conversationId) =>
      Promise.resolve(
        conversationId === "conversation-1"
          ? [
            {
              conversation_id: "conversation-1",
              user_id: "user-a",
            },
            {
              conversation_id: "conversation-1",
              user_id: "user-b",
            },
            {
              conversation_id: "conversation-1",
              user_id: "user-c",
            },
          ]
          : [],
      ),
    lookupDmMessage: (messageId) =>
      Promise.resolve(
        messageId === "message-1"
          ? {
            id: "message-1",
            conversation_id: "conversation-1",
            sender_id: "user-a",
            deleted_at: null,
          }
          : null,
      ),
    lookupEventShare: (shareId) =>
      Promise.resolve(
        shareId === "event-share-1" ? eventShareRow() : null,
      ),
    lookupSharedCalendar: (calendarId) =>
      Promise.resolve(calendarId === "calendar-1" ? calendarRow : null),
    lookupSharedCalendarMembers: ({ calendarId, userIds }) =>
      Promise.resolve(
        calendarMembers.filter((member) =>
          member.calendar_id === calendarId && userIds.includes(member.user_id)
        ),
      ),
    lookupFollow: ({ followerId, followeeId }) =>
      Promise.resolve(followerId === "user-a" && followeeId === "user-b"),
    lookupFlowPost: (flowPostId) =>
      Promise.resolve(flowPostId === "post-1" ? flowPost : null),
    lookupFlowPostLike: ({ flowPostId, userId }) =>
      Promise.resolve(flowPostId === "post-1" && userId === "user-a"),
    lookupFlowPostComment: (commentId) =>
      Promise.resolve(comments.get(commentId) ?? null),
    lookupFlowPostCommentsByBody: ({ flowPostId, userId, body }) =>
      Promise.resolve(
        Array.from(comments.values()).filter((comment) =>
          comment.flow_post_id === flowPostId &&
          comment.user_id === userId &&
          (
            comment.id === "comment-parent"
              ? body === "Parent body"
              : comment.id === "comment-reply"
              ? body === "Reply body"
              : body === "Comment body"
          )
        ),
      ),
    lookupFlowPostCommentLike: ({ commentId, userId }) =>
      Promise.resolve(commentId === "comment-parent" && userId === "user-a"),
    lookupActiveDeviceIds: ({ requesterUid, deviceIds }) =>
      Promise.resolve(
        requesterUid === "user-a"
          ? deviceIds.filter((deviceId) => deviceId === "device-1")
          : [],
      ),
  };
  return { ...defaults, ...overrides };
}

function assertAllowed(
  result: PushAuthResult,
  kind: Extract<UserJwtPushAuthorizationResult, { ok: true }>["kind"],
) {
  assertEquals(result.ok, true);
  assert(result.ok);
  assertEquals(result.kind, kind);
}

function assertDenied(
  result: PushAuthResult,
  status: 400 | 403,
  reason: string,
) {
  assertEquals(result.ok, false);
  if (result.ok) {
    throw new Error("expected user-JWT push authorization failure");
  }
  const denied = result as Extract<PushAuthResult, { ok: false }>;
  assertEquals(denied.status, status);
  assertEquals(denied.log?.reason, reason);
}

function assertLogOmitsPrivateValues(
  result: PushAuthResult,
  privateValues: string[],
) {
  assertEquals(result.ok, false);
  if (result.ok) {
    throw new Error("expected denied result");
  }
  const denied = result as Extract<PushAuthResult, { ok: false }>;
  const logJson = JSON.stringify(denied.log ?? {});
  for (const value of privateValues) {
    assertEquals(logJson.includes(value), false);
  }
}

Deno.test("user-JWT unknown push without sender_id is rejected", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "unknown_push",
      share_id: "share-1",
    },
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "unsupported_user_jwt_push_type");
});

Deno.test("user-JWT generic push with matching sender_id is rejected", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "shared_calendar_item_added",
      kind: "shared_calendar_item_added",
      sender_id: "user-a",
      calendar_id: "calendar-1",
    },
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "unsupported_user_jwt_push_type");
});

Deno.test("valid user-JWT DM push still succeeds", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: validDmData,
    lookups: makeLookups({
      lookupShare: (shareId) =>
        Promise.resolve(
          shareId === "share-1"
            ? shareRow({ payload_json: { type: "message", text: "hi" } })
            : null,
        ),
    }),
  });

  assertAllowed(result, "direct_message");
});

Deno.test("valid user-JWT DM-like push still succeeds", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-b",
    userIds: ["user-a"],
    data: validDmLikeData,
    lookups: makeLookups({
      lookupShare: (shareId) =>
        Promise.resolve(
          shareId === "share-1"
            ? shareRow({ payload_json: { type: "message", text: "hi" } })
            : null,
        ),
    }),
  });

  assertAllowed(result, "direct_message_like");
});

Deno.test("valid user-JWT group DM push succeeds for active members", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b", "user-c"],
    data: validDmMessageV2Data,
    lookups: makeLookups(),
  });

  assertAllowed(result, "dm_message_v2");
});

Deno.test("user-JWT group DM push rejects non-member recipients", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b", "user-x"],
    data: validDmMessageV2Data,
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "recipient_not_conversation_member");
  assertLogOmitsPrivateValues(result, ["conversation-1", "user-b", "user-x"]);
});

Deno.test("user-JWT group DM push rejects mismatched messages without private log identifiers", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b", "user-c"],
    data: validDmMessageV2Data,
    lookups: makeLookups({
      lookupDmMessage: () =>
        Promise.resolve({
          id: "message-1",
          conversation_id: "conversation-2",
          sender_id: "user-a",
          deleted_at: null,
        }),
    }),
  });

  assertDenied(result, 403, "message_mismatch");
  assertLogOmitsPrivateValues(result, [
    "conversation-1",
    "conversation-2",
    "message-1",
    "user-a",
  ]);
});

Deno.test("invalid user-JWT DM forged sender still fails", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: { ...validDmData, sender_id: "user-c" },
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "sender_mismatch");
});

Deno.test("valid user-JWT self-test push to requester active device succeeds", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-a"],
    deviceIds: ["device-1"],
    data: validPushTestData,
    lookups: makeLookups(),
  });

  assertAllowed(result, "push_test");
});

Deno.test("user-JWT self-test push to another user is rejected", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    deviceIds: ["device-1"],
    data: validPushTestData,
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "push_test_recipient_mismatch");
});

Deno.test("user-JWT self-test push to inactive device is rejected", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-a"],
    deviceIds: ["device-2"],
    data: validPushTestData,
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "push_test_device_mismatch");
});

Deno.test("valid user-JWT flow_share push is row-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "flow_share",
      kind: "flow_share",
      sender_id: "user-a",
      share_id: "share-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_share");
});

Deno.test("flow_share push rejects extra recipients", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b", "user-c"],
    data: {
      type: "flow_share",
      kind: "flow_share",
      sender_id: "user-a",
      share_id: "share-1",
    },
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "recipient_mismatch");
});

Deno.test("flow_share push rejects DM message rows", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "flow_share",
      kind: "flow_share",
      sender_id: "user-a",
      share_id: "share-1",
    },
    lookups: makeLookups({
      lookupShare: (shareId) =>
        Promise.resolve(
          shareId === "share-1"
            ? shareRow({ payload_json: { type: "message", text: "hi" } })
            : null,
        ),
    }),
  });

  assertDenied(result, 403, "not_flow_share_row");
});

Deno.test("valid user-JWT event_invite push is row-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "event_invite",
      kind: "event_invite",
      sender_id: "user-a",
      share_id: "event-share-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "event_invite");
});

Deno.test("valid user-JWT event RSVP push is row-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-b",
    userIds: ["user-a"],
    data: {
      type: "event_invite",
      kind: "event_invite",
      sender_id: "user-b",
      share_id: "event-share-1",
      response_status: "accepted",
    },
    lookups: makeLookups({
      lookupEventShare: (shareId) =>
        Promise.resolve(
          shareId === "event-share-1"
            ? eventShareRow({ response_status: "accepted" })
            : null,
        ),
    }),
  });

  assertAllowed(result, "event_invite");
});

Deno.test("event_invite push rejects requester that is not row actor", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-c",
    userIds: ["user-b"],
    data: {
      type: "event_invite",
      kind: "event_invite",
      sender_id: "user-c",
      share_id: "event-share-1",
    },
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "share_sender_mismatch");
});

Deno.test("valid user-JWT calendar_invite push is membership-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "calendar_invite",
      kind: "calendar_invite",
      sender_id: "user-a",
      calendar_id: "calendar-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "calendar_invite");
});

Deno.test("valid user-JWT calendar_invite_response push is membership-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-b",
    userIds: ["user-a"],
    data: {
      type: "calendar_invite_response",
      kind: "calendar_invite_response",
      sender_id: "user-b",
      calendar_id: "calendar-1",
      invite_status: "accepted",
    },
    lookups: makeLookups({
      lookupSharedCalendarMembers: ({ calendarId, userIds }) =>
        Promise.resolve(
          calendarMembers.map((member) =>
            member.user_id === "user-b"
              ? { ...member, status: "accepted", invited_by: "user-a" }
              : member
          ).filter((member) =>
            member.calendar_id === calendarId &&
            userIds.includes(member.user_id)
          ),
        ),
    }),
  });

  assertAllowed(result, "calendar_invite_response");
});

Deno.test("valid user-JWT calendar_event push is member-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-c"],
    data: {
      type: "calendar_event",
      kind: "calendar_event",
      sender_id: "user-a",
      calendar_id: "calendar-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "calendar_event");
});

Deno.test("calendar_event push rejects non-member recipients", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-z"],
    data: {
      type: "calendar_event",
      kind: "calendar_event",
      sender_id: "user-a",
      calendar_id: "calendar-1",
    },
    lookups: makeLookups(),
  });

  assertDenied(result, 403, "recipient_not_member");
});

Deno.test("valid user-JWT follow push is follow-row-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "follow",
      kind: "follow",
      sender_id: "user-a",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "follow");
});

Deno.test("valid user-JWT flow_like push is like-row-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "flow_like",
      flow_post_id: "post-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_like");
});

Deno.test("valid user-JWT flow_comment push is comment-row-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "flow_comment",
      flow_post_id: "post-1",
      comment_id: "comment-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_comment");
});

Deno.test("old-client flow_comment push is row-backed by unique comment body", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    notificationBody: "Comment body",
    data: {
      type: "flow_comment",
      flow_post_id: "post-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_comment");
});

Deno.test("old-client flow_comment push rejects ambiguous body matches", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    notificationBody: "same",
    data: {
      type: "flow_comment",
      flow_post_id: "post-1",
    },
    lookups: makeLookups({
      lookupFlowPostCommentsByBody: () =>
        Promise.resolve([
          flowComment,
          { ...flowComment, id: "comment-duplicate" },
        ]),
    }),
  });

  assertDenied(result, 403, "ambiguous_comment_row");
});

Deno.test("valid user-JWT flow_comment_reply push is parent-comment-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-c"],
    data: {
      type: "flow_comment_reply",
      flow_post_id: "post-1",
      comment_id: "comment-reply",
      parent_comment_id: "comment-parent",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_comment_reply");
});

Deno.test("old-client flow_comment_reply push is row-backed by unique reply body", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-c"],
    notificationBody: "Reply body",
    data: {
      type: "flow_comment_reply",
      flow_post_id: "post-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_comment_reply");
});

Deno.test("flow_comment_reply rejects a parent comment from another post", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-c"],
    data: {
      type: "flow_comment_reply",
      flow_post_id: "post-1",
      comment_id: "comment-reply",
      parent_comment_id: "comment-parent",
    },
    lookups: makeLookups({
      lookupFlowPostComment: (commentId) => {
        if (commentId === "comment-reply") {
          return Promise.resolve(replyComment);
        }
        if (commentId === "comment-parent") {
          return Promise.resolve({
            ...parentComment,
            flow_post_id: "other-post",
          });
        }
        return Promise.resolve(null);
      },
    }),
  });

  assertDenied(result, 403, "parent_comment_not_found");
});

Deno.test("valid user-JWT flow_comment_like push is comment-like-row-backed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-c"],
    data: {
      type: "flow_comment_like",
      flow_post_id: "post-1",
      comment_id: "comment-parent",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_comment_like");
});

Deno.test("old-client flow_comment_like push is row-backed by unique liked comment body", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-c"],
    notificationBody: "Parent body",
    data: {
      type: "flow_comment_like",
      flow_post_id: "post-1",
    },
    lookups: makeLookups(),
  });

  assertAllowed(result, "flow_comment_like");
});

Deno.test("old-client flow_comment_like rejects ambiguous liked comment body", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-c"],
    notificationBody: "same",
    data: {
      type: "flow_comment_like",
      flow_post_id: "post-1",
    },
    lookups: makeLookups({
      lookupFlowPostCommentsByBody: () =>
        Promise.resolve([
          parentComment,
          { ...parentComment, id: "comment-parent-duplicate" },
        ]),
    }),
  });

  assertDenied(result, 403, "ambiguous_comment_row");
});

Deno.test("flow_comment push without comment_id fails closed", async () => {
  const result = await authorizeUserJwtPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "flow_comment",
      flow_post_id: "post-1",
    },
    lookups: makeLookups(),
  });

  assertDenied(result, 400, "missing_comment_id");
});
