#!/usr/bin/env -S deno run --allow-read=mobile/env/dev.json --allow-write=/tmp --allow-run=supabase --allow-net

type SmokeUser = {
  id: string;
  email: string;
  password: string;
  token: string;
};

const envPath = "mobile/env/dev.json";
const env = JSON.parse(await Deno.readTextFile(envPath)) as {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

const supabaseUrl = (env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const anonKey = (env.SUPABASE_ANON_KEY ?? "").trim();

if (!supabaseUrl || !anonKey) {
  throw new Error(`Missing SUPABASE_URL or SUPABASE_ANON_KEY in ${envPath}`);
}

const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const localDate = "2026-06-26";
const questionId = `commons-remote-smoke-${suffix}`;
const questionText = "What did remote practice make visible?";
const flowBase = 880000000 + Math.floor(Math.random() * 100000);

const ids = {
  privateCalendar: crypto.randomUUID(),
  publicCalendar: crypto.randomUUID(),
  unlistedCalendar: crypto.randomUUID(),
  privateRoom: crypto.randomUUID(),
  publicRoom: crypto.randomUUID(),
  unlistedRoom: crypto.randomUUID(),
  privateEvent: crypto.randomUUID(),
  publicPrivateEvent: crypto.randomUUID(),
  publicSharedEvent: crypto.randomUUID(),
  publicEvent: crypto.randomUUID(),
  journalEntry: crypto.randomUUID(),
};

const ownerFlowId = flowBase + 1;
const publicFlowId = flowBase + 2;
const unlistedFlowId = flowBase + 3;

const clientIds = {
  private: `commons-remote-private-${suffix}`,
  publicPrivate: `commons-remote-public-private-${suffix}`,
  publicShared: `commons-remote-public-shared-${suffix}`,
  public: `commons-remote-public-${suffix}`,
};

const ownerPrivateBody = `SMOKE_REMOTE_PRIVATE_ENTRY_${suffix}`;
const publicRoomPrivateBody =
  `SMOKE_REMOTE_PUBLIC_ROOM_PRIVATE_ENTRY_${suffix}`;
const publicRoomSharedBody = `SMOKE_REMOTE_SHARED_ENTRY_${suffix}`;
const privateJournalBody = `SMOKE_REMOTE_PRIVATE_JOURNAL_${suffix}`;

const createdUsers: SmokeUser[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuidList(values: string[]): string {
  return values.map((value) => `${sqlString(value)}::uuid`).join(", ");
}

function jsonObject(value: unknown): Record<string, unknown> {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected JSON object",
  );
  return value as Record<string, unknown>;
}

function jsonArray(value: unknown): Record<string, unknown>[] {
  assert(Array.isArray(value), "Expected JSON array");
  return value.map(jsonObject);
}

async function runLinkedSql(sql: string, label: string): Promise<void> {
  const tempPath = await Deno.makeTempFile({
    prefix: "commons_remote_dev_",
    suffix: ".sql",
    dir: "/tmp",
  });
  try {
    await Deno.writeTextFile(tempPath, sql);
    const command = new Deno.Command("supabase", {
      args: [
        "db",
        "query",
        "--linked",
        "--file",
        tempPath,
        "--output",
        "table",
      ],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    if (!output.success) {
      throw new Error(
        `${label} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
  } finally {
    await Deno.remove(tempPath).catch(() => {});
  }
}

async function authFetch(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text.trim().length > 0) json = JSON.parse(text);
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${text}`);
  }
  return jsonObject(json);
}

async function createUser(
  kind: "owner" | "requester" | "denied",
): Promise<SmokeUser> {
  const email = `commons-${kind}-${suffix}@example.com`;
  const password = `CommonsSmoke!${suffix}Aa1`;
  const signup = await authFetch("/auth/v1/signup", { email, password });
  let token = (signup.session as Record<string, unknown> | null)?.access_token;
  const user = signup.user as Record<string, unknown> | null;
  let id = user?.id as string | undefined;

  if (!token || !id) {
    const signin = await authFetch("/auth/v1/token?grant_type=password", {
      email,
      password,
    });
    token = (signin.access_token as string | undefined) ?? token;
    id = ((signin.user as Record<string, unknown> | null)?.id as
      | string
      | undefined) ?? id;
  }

  assert(
    typeof token === "string" && token.length > 0,
    `No session token for ${email}`,
  );
  assert(typeof id === "string" && id.length > 0, `No user id for ${email}`);

  const created = { id, email, password, token };
  createdUsers.push(created);
  return created;
}

async function restFetch(
  path: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
    prefer?: string;
    ok?: number[];
  } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: anonKey,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  if (options.prefer != null) {
    headers.Prefer = options.prefer;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const okStatuses = options.ok ?? [200, 201, 204];
  if (!okStatuses.includes(response.status)) {
    throw new Error(`${path} failed ${response.status}: ${text}`);
  }
  if (text.trim().length === 0) return null;
  return JSON.parse(text) as unknown;
}

async function rpc(
  name: string,
  token: string,
  params: Record<string, unknown>,
  ok: number[] = [200],
): Promise<unknown> {
  return await restFetch(`rpc/${name}`, token, {
    method: "POST",
    body: params,
    ok,
  });
}

async function cleanup(): Promise<void> {
  const userIds = createdUsers.map((user) => user.id);
  if (userIds.length === 0) return;

  const cleanupSql = `
begin;

delete from public.content_reports
where reporter_user_id in (${sqlUuidList(userIds)})
   or reported_user_id in (${sqlUuidList(userIds)});

delete from public.user_blocks
where blocker_user_id in (${sqlUuidList(userIds)})
   or blocked_user_id in (${sqlUuidList(userIds)});

delete from public.shared_practice_join_requests
where requester_id in (${sqlUuidList(userIds)})
   or room_id in (
    ${sqlString(ids.privateRoom)}::uuid,
    ${sqlString(ids.publicRoom)}::uuid,
    ${sqlString(ids.unlistedRoom)}::uuid
   );

delete from public.commons_question_answers
where user_id in (${sqlUuidList(userIds)})
   or question_id = ${sqlString(questionId)};

delete from public.shared_practice_entries
where user_id in (${sqlUuidList(userIds)})
   or room_id in (
    ${sqlString(ids.privateRoom)}::uuid,
    ${sqlString(ids.publicRoom)}::uuid,
    ${sqlString(ids.unlistedRoom)}::uuid
   );

delete from public.user_event_completions
where user_id in (${sqlUuidList(userIds)})
   or client_event_id in (
    ${sqlString(clientIds.private)},
    ${sqlString(clientIds.publicPrivate)},
    ${sqlString(clientIds.publicShared)},
    ${sqlString(clientIds.public)}
   );

delete from public.user_events
where user_id in (${sqlUuidList(userIds)})
   or client_event_id in (
    ${sqlString(clientIds.private)},
    ${sqlString(clientIds.publicPrivate)},
    ${sqlString(clientIds.publicShared)},
    ${sqlString(clientIds.public)}
   );

delete from public.shared_practice_rooms
where id in (
  ${sqlString(ids.privateRoom)}::uuid,
  ${sqlString(ids.publicRoom)}::uuid,
  ${sqlString(ids.unlistedRoom)}::uuid
);

delete from public.flows
where id in (${ownerFlowId}, ${publicFlowId}, ${unlistedFlowId});

delete from public.shared_calendar_members
where user_id in (${sqlUuidList(userIds)})
   or calendar_id in (
    ${sqlString(ids.privateCalendar)}::uuid,
    ${sqlString(ids.publicCalendar)}::uuid,
    ${sqlString(ids.unlistedCalendar)}::uuid
   );

delete from public.shared_calendars
where id in (
  ${sqlString(ids.privateCalendar)}::uuid,
  ${sqlString(ids.publicCalendar)}::uuid,
  ${sqlString(ids.unlistedCalendar)}::uuid
);

delete from public.journal_entries
where user_id in (${sqlUuidList(userIds)})
   or id = ${sqlString(ids.journalEntry)}::uuid;

delete from public.profiles
where id in (${sqlUuidList(userIds)});

delete from auth.users
where id in (${sqlUuidList(userIds)});

commit;
`;

  await runLinkedSql(cleanupSql, "cleanup");
}

function containsRoom(
  home: Record<string, unknown>,
  key: string,
  roomId: string,
): boolean {
  return jsonArray(home[key]).some((room) => room.id === roomId);
}

try {
  const owner = await createUser("owner");
  const requester = await createUser("requester");
  const denied = await createUser("denied");

  const seedSql = `
begin;

insert into public.profiles (
  id,
  email,
  handle,
  display_name,
  is_discoverable
) values
(
  ${sqlString(owner.id)}::uuid,
  ${sqlString(owner.email)},
  ${sqlString(`commonsown${suffix.slice(-8)}`)},
  'Commons Remote Owner',
  true
),
(
  ${sqlString(requester.id)}::uuid,
  ${sqlString(requester.email)},
  ${sqlString(`commonsreq${suffix.slice(-8)}`)},
  'Commons Remote Requester',
  true
),
(
  ${sqlString(denied.id)}::uuid,
  ${sqlString(denied.email)},
  ${sqlString(`commonsden${suffix.slice(-8)}`)},
  'Commons Remote Denied',
  true
) on conflict (id) do update
  set email = excluded.email,
      handle = excluded.handle,
      display_name = excluded.display_name,
      is_discoverable = excluded.is_discoverable;

insert into public.shared_calendars (
  id,
  owner_id,
  name,
  color,
  icon,
  is_personal
) values
(
  ${sqlString(ids.privateCalendar)}::uuid,
  ${sqlString(owner.id)}::uuid,
  'Remote Private Calendar',
  5099745,
  'calendar',
  false
),
(
  ${sqlString(ids.publicCalendar)}::uuid,
  ${sqlString(owner.id)}::uuid,
  'Remote Public Calendar',
  5099745,
  'calendar',
  false
),
(
  ${sqlString(ids.unlistedCalendar)}::uuid,
  ${sqlString(owner.id)}::uuid,
  'Remote Unlisted Calendar',
  5099745,
  'calendar',
  false
);

insert into public.shared_calendar_members (
  calendar_id,
  user_id,
  role,
  status,
  invited_by,
  responded_at
) values
(
  ${sqlString(ids.privateCalendar)}::uuid,
  ${sqlString(owner.id)}::uuid,
  'owner',
  'accepted',
  ${sqlString(owner.id)}::uuid,
  now()
),
(
  ${sqlString(ids.publicCalendar)}::uuid,
  ${sqlString(owner.id)}::uuid,
  'owner',
  'accepted',
  ${sqlString(owner.id)}::uuid,
  now()
),
(
  ${sqlString(ids.unlistedCalendar)}::uuid,
  ${sqlString(owner.id)}::uuid,
  'owner',
  'accepted',
  ${sqlString(owner.id)}::uuid,
  now()
);

insert into public.flows (
  id,
  user_id,
  name,
  color,
  active,
  start_date,
  rules,
  is_hidden,
  is_reminder,
  calendar_id
) values
(
  ${ownerFlowId},
  ${sqlString(owner.id)}::uuid,
  'Remote Private Smoke Flow',
  5099745,
  true,
  date ${sqlString(localDate)},
  '[]'::jsonb,
  false,
  false,
  ${sqlString(ids.privateCalendar)}::uuid
),
(
  ${publicFlowId},
  ${sqlString(owner.id)}::uuid,
  'Remote Public Smoke Flow',
  5099745,
  true,
  date ${sqlString(localDate)},
  '[]'::jsonb,
  false,
  false,
  ${sqlString(ids.publicCalendar)}::uuid
),
(
  ${unlistedFlowId},
  ${sqlString(owner.id)}::uuid,
  'Remote Unlisted Smoke Flow',
  5099745,
  true,
  date ${sqlString(localDate)},
  '[]'::jsonb,
  false,
  false,
  ${sqlString(ids.unlistedCalendar)}::uuid
);

insert into public.shared_practice_rooms (
  id,
  calendar_id,
  source_flow_id,
  shared_flow_id,
  created_by,
  title,
  flow_key,
  start_date,
  status,
  description,
  visibility,
  join_policy
) values
(
  ${sqlString(ids.privateRoom)}::uuid,
  ${sqlString(ids.privateCalendar)}::uuid,
  ${ownerFlowId},
  ${ownerFlowId},
  ${sqlString(owner.id)}::uuid,
  'Remote Private Smoke Room',
  'remote-private-smoke',
  date ${sqlString(localDate)},
  'active',
  'Private room body must stay private.',
  'private',
  'closed'
),
(
  ${sqlString(ids.publicRoom)}::uuid,
  ${sqlString(ids.publicCalendar)}::uuid,
  ${publicFlowId},
  ${publicFlowId},
  ${sqlString(owner.id)}::uuid,
  'Remote Public Smoke Room',
  'remote-public-smoke',
  date ${sqlString(localDate)},
  'active',
  'Public room can receive join requests.',
  'public',
  'owner_approval'
),
(
  ${sqlString(ids.unlistedRoom)}::uuid,
  ${sqlString(ids.unlistedCalendar)}::uuid,
  ${unlistedFlowId},
  ${unlistedFlowId},
  ${sqlString(owner.id)}::uuid,
  'Remote Unlisted Smoke Room',
  'remote-unlisted-smoke',
  date ${sqlString(localDate)},
  'active',
  'Unlisted room must not appear in public discovery.',
  'unlisted',
  'closed'
);

insert into public.user_events (
  id,
  user_id,
  client_event_id,
  title,
  starts_at,
  ends_at,
  flow_local_id,
  calendar_id,
  behavior_payload
) values
(
  ${sqlString(ids.privateEvent)}::uuid,
  ${sqlString(owner.id)}::uuid,
  ${sqlString(clientIds.private)},
  'Remote Private Smoke Flow',
  timestamptz '2026-06-26 09:00:00+00',
  timestamptz '2026-06-26 09:30:00+00',
  ${ownerFlowId},
  ${sqlString(ids.privateCalendar)}::uuid,
  jsonb_build_object('shared_practice_room_id', ${sqlString(ids.privateRoom)})
),
(
  ${sqlString(ids.publicPrivateEvent)}::uuid,
  ${sqlString(owner.id)}::uuid,
  ${sqlString(clientIds.publicPrivate)},
  'Remote Public Flow Private Entry',
  timestamptz '2026-06-26 10:00:00+00',
  timestamptz '2026-06-26 10:30:00+00',
  ${publicFlowId},
  ${sqlString(ids.publicCalendar)}::uuid,
  jsonb_build_object('shared_practice_room_id', ${sqlString(ids.publicRoom)})
),
(
  ${sqlString(ids.publicSharedEvent)}::uuid,
  ${sqlString(owner.id)}::uuid,
  ${sqlString(clientIds.publicShared)},
  'Remote Public Flow Shared Entry',
  timestamptz '2026-06-26 11:00:00+00',
  timestamptz '2026-06-26 11:30:00+00',
  ${publicFlowId},
  ${sqlString(ids.publicCalendar)}::uuid,
  jsonb_build_object('shared_practice_room_id', ${sqlString(ids.publicRoom)})
),
(
  ${sqlString(ids.publicEvent)}::uuid,
  ${sqlString(owner.id)}::uuid,
  ${sqlString(clientIds.public)},
  'Remote Public Flow Public Entry',
  timestamptz '2026-06-26 12:00:00+00',
  timestamptz '2026-06-26 12:30:00+00',
  ${publicFlowId},
  ${sqlString(ids.publicCalendar)}::uuid,
  jsonb_build_object('shared_practice_room_id', ${sqlString(ids.publicRoom)})
);

insert into public.journal_entries (
  id,
  user_id,
  greg_date,
  body,
  meta,
  created_at,
  updated_at
) values (
  ${sqlString(ids.journalEntry)}::uuid,
  ${sqlString(owner.id)}::uuid,
  date ${sqlString(localDate)},
  ${sqlString(privateJournalBody)},
  '{}'::jsonb,
  now(),
  now()
);

commit;
`;

  await runLinkedSql(seedSql, "seed");

  await rpc("upsert_shared_practice_entry", owner.token, {
    p_room_id: ids.privateRoom,
    p_client_event_id: clientIds.private,
    p_flow_id: ownerFlowId,
    p_completed_on: localDate,
    p_completion_status: "observed",
    p_body_text: ownerPrivateBody,
    p_visibility: "private",
  });
  await rpc("upsert_shared_practice_entry", owner.token, {
    p_room_id: ids.publicRoom,
    p_client_event_id: clientIds.publicPrivate,
    p_flow_id: publicFlowId,
    p_completed_on: localDate,
    p_completion_status: "observed",
    p_body_text: publicRoomPrivateBody,
    p_visibility: "private",
  });
  await rpc("upsert_shared_practice_entry", owner.token, {
    p_room_id: ids.publicRoom,
    p_client_event_id: clientIds.publicShared,
    p_flow_id: publicFlowId,
    p_completed_on: localDate,
    p_completion_status: "observed",
    p_body_text: publicRoomSharedBody,
    p_visibility: "shared_with_calendar",
  });
  await rpc("upsert_shared_practice_entry", owner.token, {
    p_room_id: ids.publicRoom,
    p_client_event_id: clientIds.public,
    p_flow_id: publicFlowId,
    p_completed_on: localDate,
    p_completion_status: "observed",
    p_body_text: "Remote public entry may appear.",
    p_visibility: "public",
  });

  const ownerAnswerBody = "Remote owner answer visible until blocked.";
  const requesterAnswerBody = "Remote requester answer before edit.";
  const requesterEditedBody = "Remote requester answer after edit.";

  const ownerAnswer = jsonObject(
    await rpc("answer_commons_question", owner.token, {
      p_question_id: questionId,
      p_question_text: questionText,
      p_body: ownerAnswerBody,
    }),
  );

  const requesterHome = jsonObject(
    await rpc("get_commons_home", requester.token, {
      p_local_date: localDate,
      p_question_id: questionId,
      p_question_text: questionText,
      p_limit: 12,
    }),
  );

  assert(
    !containsRoom(requesterHome, "my_shared_practices", ids.privateRoom) &&
      !containsRoom(requesterHome, "public_shared_practices", ids.privateRoom),
    "Requester should not see private room in Commons",
  );
  assert(
    containsRoom(requesterHome, "public_shared_practices", ids.publicRoom),
    "Requester should see public room in Commons",
  );
  assert(
    !containsRoom(requesterHome, "public_shared_practices", ids.unlistedRoom),
    "Requester should not see unlisted room in public Commons discovery",
  );
  assert(
    jsonObject(requesterHome.rhythm).active_users_today === 1,
    "Public rhythm should count one public shared-practice user",
  );
  assert(
    jsonObject(requesterHome.rhythm).flows_kept_today === 1,
    "Public rhythm should count one public shared-practice entry",
  );
  assert(
    JSON.stringify(requesterHome).includes(ownerPrivateBody) === false &&
      JSON.stringify(requesterHome).includes(publicRoomPrivateBody) === false &&
      JSON.stringify(requesterHome).includes(publicRoomSharedBody) === false &&
      JSON.stringify(requesterHome).includes(privateJournalBody) === false,
    "Commons home leaked private entry or journal body",
  );

  const firstRequest = jsonObject(
    await rpc("request_join_shared_practice", requester.token, {
      p_room_id: ids.publicRoom,
      p_message: "Please let me practice.",
    }),
  );
  const duplicateRequest = jsonObject(
    await rpc("request_join_shared_practice", requester.token, {
      p_room_id: ids.publicRoom,
      p_message: "Still requesting.",
    }),
  );
  assert(
    firstRequest.status === "pending",
    "First join request should be pending",
  );
  assert(
    duplicateRequest.status === "pending",
    "Duplicate join request should remain pending",
  );
  assert(
    firstRequest.id === duplicateRequest.id,
    "Duplicate pending join request should be idempotent",
  );

  const approved = jsonObject(
    await rpc("respond_to_join_request", owner.token, {
      p_request_id: firstRequest.id,
      p_decision: "approved",
    }),
  );
  assert(approved.status === "approved", "Owner should approve requester");

  const joinedRoom = jsonObject(
    await rpc("get_shared_practice_room", requester.token, {
      p_room_id: ids.publicRoom,
      p_local_date: localDate,
    }),
  );
  assert(
    joinedRoom.viewer_is_member === true,
    "Approved requester should see joined state",
  );

  const deniedRequest = jsonObject(
    await rpc("request_join_shared_practice", denied.token, {
      p_room_id: ids.publicRoom,
      p_message: "Maybe not.",
    }),
  );
  const deniedResponse = jsonObject(
    await rpc("respond_to_join_request", owner.token, {
      p_request_id: deniedRequest.id,
      p_decision: "denied",
    }),
  );
  assert(
    deniedResponse.status === "denied",
    "Owner should deny second requester",
  );

  const deniedRoom = jsonObject(
    await rpc("get_shared_practice_room", denied.token, {
      p_room_id: ids.publicRoom,
      p_local_date: localDate,
    }),
  );
  assert(
    deniedRoom.viewer_is_member === false,
    "Denied requester should not see joined state",
  );

  const requesterAnswer = jsonObject(
    await rpc("answer_commons_question", requester.token, {
      p_question_id: questionId,
      p_question_text: questionText,
      p_body: requesterAnswerBody,
    }),
  );
  const requesterEdited = jsonObject(
    await rpc("answer_commons_question", requester.token, {
      p_question_id: questionId,
      p_question_text: questionText,
      p_body: requesterEditedBody,
    }),
  );
  assert(
    requesterEdited.id === requesterAnswer.id,
    "Question answer edit should upsert same answer",
  );
  assert(
    requesterEdited.body_text === requesterEditedBody,
    "Question answer edit should save body",
  );

  await rpc("delete_commons_answer", requester.token, {
    p_answer_id: requesterAnswer.id,
  }, [200, 204]);

  const afterDeleteHome = jsonObject(
    await rpc("get_commons_home", requester.token, {
      p_local_date: localDate,
      p_question_id: questionId,
      p_question_text: questionText,
      p_limit: 12,
    }),
  );
  assert(
    JSON.stringify(afterDeleteHome).includes(requesterEditedBody) === false,
    "Deleted Commons answer should not appear",
  );

  await restFetch("content_reports", denied.token, {
    method: "POST",
    prefer: "return=minimal",
    body: {
      reporter_user_id: denied.id,
      content_type: "shared_practice_room",
      content_id: ids.publicRoom,
      reported_user_id: owner.id,
      reason: "privacy_smoke",
      details: "Remote smoke report for shared practice room.",
    },
    ok: [201],
  });
  await restFetch("content_reports", denied.token, {
    method: "POST",
    prefer: "return=minimal",
    body: {
      reporter_user_id: denied.id,
      content_type: "commons_question_answer",
      content_id: ownerAnswer.id,
      reported_user_id: owner.id,
      reason: "privacy_smoke",
      details: "Remote smoke report for Commons answer.",
    },
    ok: [201],
  });
  await restFetch("user_blocks", denied.token, {
    method: "POST",
    prefer: "return=minimal",
    body: {
      blocker_user_id: denied.id,
      blocked_user_id: owner.id,
    },
    ok: [201],
  });

  const blockedHome = jsonObject(
    await rpc("get_commons_home", denied.token, {
      p_local_date: localDate,
      p_question_id: questionId,
      p_question_text: questionText,
      p_limit: 12,
    }),
  );
  assert(
    !containsRoom(blockedHome, "public_shared_practices", ids.publicRoom),
    "Blocked owner public room should not appear in Commons discovery",
  );
  assert(
    JSON.stringify(blockedHome).includes(ownerAnswerBody) === false,
    "Blocked owner answer should not appear in Commons question answers",
  );
  assert(
    jsonObject(blockedHome.rhythm).active_users_today === 0,
    "Blocked owner public activity should not contribute to viewer rhythm",
  );

  console.log(JSON.stringify({
    ok: true,
    users: createdUsers.length,
    publicRoom: ids.publicRoom,
    questionId,
  }));
} finally {
  await cleanup();
}
