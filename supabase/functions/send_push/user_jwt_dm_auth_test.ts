import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { authorizeUserJwtDmPush, type DmShareRow } from "./user_jwt_dm_auth.ts";

type DmAuthResult = Awaited<ReturnType<typeof authorizeUserJwtDmPush>>;

const validDmData = {
  type: "dm",
  kind: "dm",
  notification_type: "direct_message",
  notification_kind: "direct_message",
  sender_id: "user-a",
  conversation_user_id: "user-a",
  share_id: "share-1",
};

function dmShare(overrides: Partial<DmShareRow> = {}): DmShareRow {
  return {
    id: "share-1",
    sender_id: "user-a",
    recipient_id: "user-b",
    channel: "in_app",
    status: "sent",
    deleted_at: null,
    payload_json: { type: "message", text: "hi", name: "hi" },
    ...overrides,
  };
}

function lookupShare(
  row: DmShareRow | null = dmShare(),
  calls: string[] = [],
) {
  return (shareId: string) => {
    calls.push(shareId);
    return Promise.resolve(row && row.id === shareId ? row : null);
  };
}

function assertDenied(
  result: DmAuthResult,
  status: 400 | 403,
  reason: string,
) {
  assertEquals(result.ok, false);
  if (result.ok) {
    throw new Error("expected DM push authorization failure");
  }
  const denied = result as Extract<DmAuthResult, { ok: false }>;
  assertEquals(denied.status, status);
  assertEquals(denied.log?.reason, reason);
}

Deno.test("valid user-JWT DM push succeeds for the flow_shares recipient", async () => {
  const calls: string[] = [];

  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: validDmData,
    lookupShare: lookupShare(dmShare(), calls),
  });

  assertEquals(result.ok, true);
  assert(result.ok);
  assertEquals(result.applies, true);
  assertEquals(calls, ["share-1"]);
});

Deno.test("user-JWT DM push rejects unrelated extra recipients", async () => {
  const calls: string[] = [];

  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b", "user-c"],
    data: validDmData,
    lookupShare: lookupShare(dmShare(), calls),
  });

  assertDenied(result, 403, "recipient_count_mismatch");
  assertEquals(calls, []);
});

Deno.test("user-JWT DM push rejects when requester is not the message sender", async () => {
  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: validDmData,
    lookupShare: lookupShare(dmShare({ sender_id: "user-c" })),
  });

  assertDenied(result, 403, "share_sender_mismatch");
});

Deno.test("user-JWT DM push rejects when row recipient does not match userIds", async () => {
  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: validDmData,
    lookupShare: lookupShare(dmShare({ recipient_id: "user-c" })),
  });

  assertDenied(result, 403, "recipient_mismatch");
});

Deno.test("user-JWT DM push rejects deleted message rows", async () => {
  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: validDmData,
    lookupShare: lookupShare(dmShare({ deleted_at: "2026-06-10T12:00:00Z" })),
  });

  assertDenied(result, 403, "share_deleted");
});

Deno.test("user-JWT DM push rejects non-message flow_shares rows", async () => {
  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: validDmData,
    lookupShare: lookupShare(
      dmShare({ payload_json: { type: "flow_share", name: "Plan" } }),
    ),
  });

  assertDenied(result, 403, "not_dm_message_share");
});

Deno.test("user-JWT DM push rejects when share_id is missing", async () => {
  const calls: string[] = [];
  const { share_id: _shareId, ...dataWithoutShareId } = validDmData;

  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: dataWithoutShareId,
    lookupShare: lookupShare(dmShare(), calls),
  });

  assertDenied(result, 400, "missing_share_id");
  assertEquals(calls, []);
});

Deno.test("user-JWT DM push rejects when share_id is unknown", async () => {
  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: { ...validDmData, share_id: "missing-share" },
    lookupShare: lookupShare(dmShare()),
  });

  assertDenied(result, 403, "share_not_found");
});

Deno.test("user-JWT DM push rejects when sender_id does not match requester", async () => {
  const calls: string[] = [];

  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: { ...validDmData, sender_id: "user-c" },
    lookupShare: lookupShare(dmShare(), calls),
  });

  assertDenied(result, 403, "sender_mismatch");
  assertEquals(calls, []);
});

Deno.test("user-JWT DM push rejects malformed DM payload shapes", async () => {
  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: { ...validDmData, notification_kind: "calendar_invite" },
    lookupShare: lookupShare(dmShare()),
  });

  assertDenied(result, 400, "malformed_dm_payload");
});

Deno.test("valid user-JWT direct-message-like push succeeds for message recipient liking sender's message", async () => {
  const calls: string[] = [];

  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-b",
    userIds: ["user-a"],
    data: {
      type: "dm_message_like",
      kind: "dm",
      notification_type: "direct_message_like",
      notification_kind: "direct_message_like",
      sender_id: "user-b",
      conversation_user_id: "user-b",
      share_id: "share-1",
    },
    lookupShare: lookupShare(dmShare(), calls),
  });

  assertEquals(result.ok, true);
  assert(result.ok);
  assertEquals(result.applies, true);
  assertEquals(calls, ["share-1"]);
});

Deno.test("user-JWT direct-message-like push rejects mismatched participants", async () => {
  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-c",
    userIds: ["user-a"],
    data: {
      type: "dm_message_like",
      kind: "dm",
      notification_type: "direct_message_like",
      notification_kind: "direct_message_like",
      sender_id: "user-c",
      conversation_user_id: "user-c",
      share_id: "share-1",
    },
    lookupShare: lookupShare(dmShare()),
  });

  assertDenied(result, 403, "like_participant_mismatch");
});

Deno.test("non-DM payloads are outside the DM-specific helper scope", async () => {
  const calls: string[] = [];

  const result = await authorizeUserJwtDmPush({
    requesterUid: "user-a",
    userIds: ["user-b"],
    data: {
      type: "flow_share",
      kind: "flow_share",
      sender_id: "user-a",
      share_id: "share-1",
    },
    lookupShare: lookupShare(dmShare(), calls),
  });

  assertEquals(result.ok, true);
  assert(result.ok);
  assertEquals(result.applies, false);
  assertEquals(calls, []);
});
