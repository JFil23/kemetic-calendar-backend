// Local-only round trip. No real contacts or push notifications.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createFlowShareHandler } from "../functions/create_flow_share/index.ts";
const config = Object.fromEntries(
  (await new Response(Deno.stdin.readable).text()).split("\n").flatMap(
    (line) => {
      const m = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
      return m ? [[m[1], m[2]]] : [];
    },
  ),
);
const url = config.API_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("Requires disposable loopback Supabase");
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, config.SERVICE_ROLE_KEY, options);
const users: { id: string; token: string; client: typeof admin }[] = [];
const failures: unknown[] = [];
function checked<T>(result: { data: T; error: unknown }) {
  if (result.error) throw result.error;
  return result.data;
}
try {
  for (let i = 0; i < 2; i++) {
    const email = `flow-smoke-${crypto.randomUUID()}@example.test`;
    const password = crypto.randomUUID();
    const created = await checked(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    const id = created.user!.id;
    const client = createClient(url, config.ANON_KEY, options);
    const user = { id, token: "", client };
    users.push(user);
    await checked(
      await admin.from("profiles").upsert({
        id,
        timezone: "America/Los_Angeles",
        display_name: "Flow smoke",
        allow_incoming_shares: true,
        is_discoverable: true,
      }),
    );
    const signed = await checked(
      await client.auth.signInWithPassword({ email, password }),
    );
    user.token = signed.session!.access_token;
  }
  const [sender, recipient] = users;
  const calendarId = crypto.randomUUID();
  await checked(
    await admin.from("shared_calendars").insert({
      id: calendarId,
      owner_id: sender.id,
      name: "Flow smoke calendar",
    }),
  );
  await checked(
    await admin.from("shared_calendar_members").insert({
      calendar_id: calendarId,
      user_id: sender.id,
      role: "owner",
      status: "accepted",
    }),
  );

  const appearance = {
    version: 1,
    image_object_path: `${sender.id}/header.jpg`,
    accent_argb: 0xff6f93a8,
  };
  const flow = await checked(
    await sender.client.from("flows").insert({
      user_id: sender.id,
      calendar_id: calendarId,
      name: "Flow share runtime",
      color: 0x6f93a8,
      active: true,
      start_date: "2026-10-06",
      end_date: "2026-10-08",
      rules: [],
      appearance,
    }).select().single(),
  );
  await checked(
    await sender.client.from("user_events").insert({
      user_id: sender.id,
      calendar_id: calendarId,
      client_event_id: crypto.randomUUID(),
      flow_local_id: flow.id,
      title: "A complete practice",
      starts_at: "2026-10-07T16:00:00Z",
      ends_at: "2026-10-07T17:00:00Z",
      all_day: false,
      action_id: "reflect",
      behavior_payload: { prompt: "Preserved" },
    }),
  );
  const handler = createFlowShareHandler({
    userClientFor: (authHeader) =>
      createClient(url, config.ANON_KEY, {
        ...options,
        global: { headers: { Authorization: authHeader } },
      }),
    adminClient: admin,
    sendPush: async () => {},
  });
  const send = async (
    source: Record<string, unknown>,
    from = sender,
    to = recipient,
  ) => {
    const response = await handler(
      new Request(`${url}/functions/v1/local-smoke`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${from.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...source,
          recipients: [{ type: "user", value: to.id }],
        }),
      }),
    );
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.errors, undefined);
    assertExists(body.shares[0]?.id);
    const row = await checked(
      await to.client.from("flow_shares").select().eq(
        "id",
        body.shares[0].id,
      ).single(),
    );
    assertEquals(row.payload_json.appearance, appearance);
    return row;
  };
  const direct = await send({ flow_id: flow.id });
  assertEquals(direct.payload_json.events.length, 1);
  assertEquals(direct.payload_json.events[0].start_time, "09:00");
  assertEquals(direct.payload_json.events[0].offset_days, 1);
  const persistedEvent = await checked(
    await sender.client.from("user_event_filing_items_client")
      .select("action_id,behavior_payload").eq("filed_flow_id", flow.id)
      .single(),
  );
  assertEquals(
    direct.payload_json.events[0].behavior_payload,
    persistedEvent.behavior_payload,
  );
  assertEquals(
    direct.payload_json.events[0].behavior_payload.prompt,
    "Preserved",
  );
  assertEquals(
    direct.payload_json.events[0].action_id,
    persistedEvent.action_id,
  );
  const post = await checked(
    await sender.client.from("flow_posts").insert({
      user_id: sender.id,
      flow_id: flow.id,
      name: "Posted flow snapshot",
      color: 0x6f93a8,
      rules: [],
      ai_metadata: {
        payload: { ...direct.payload_json, name: "Posted flow snapshot" },
      },
    }).select().single(),
  );
  const posted = await send({ flow_post_id: post.id });
  assertEquals(posted.payload_json.name, "Posted flow snapshot");
  assertEquals(posted.payload_json.events, direct.payload_json.events);
  const forwarded = await send({ flow_post_id: post.id }, recipient, sender);
  assertEquals(forwarded.sender_id, recipient.id);
  assertEquals(forwarded.payload_json.events, posted.payload_json.events);

  // Save uses the existing inactive/unsaved lifecycle until event and reference
  // writes finish. A hidden row is deleted and would reject these event writes.
  const recipientCalendar = crypto.randomUUID();
  checked(
    await admin.from("shared_calendars").insert({
      id: recipientCalendar,
      owner_id: recipient.id,
      name: "Saved template smoke",
    }),
  );
  checked(
    await admin.from("shared_calendar_members").insert({
      calendar_id: recipientCalendar,
      user_id: recipient.id,
      role: "owner",
      status: "accepted",
    }),
  );
  const saved = checked(
    await recipient.client.from("flows").insert({
      user_id: recipient.id,
      calendar_id: recipientCalendar,
      name: posted.payload_json.name,
      color: posted.payload_json.color,
      rules: [],
      active: false,
      is_saved: false,
      is_hidden: false,
      origin_type: "profile_import",
      origin_flow_id: flow.id,
    }).select().single(),
  );
  checked(
    await recipient.client.from("user_events").insert({
      user_id: recipient.id,
      calendar_id: recipientCalendar,
      client_event_id:
        `flow-smoke-save-${crypto.randomUUID()}|flow=${saved.id}`,
      flow_local_id: saved.id,
      title: "Saved practice",
      starts_at: "2026-10-07T16:00:00Z",
      ends_at: "2026-10-07T17:00:00Z",
      all_day: false,
      action_id: persistedEvent.action_id,
      behavior_payload: persistedEvent.behavior_payload,
    }),
  );
  checked(
    await recipient.client.from("flow_saves").upsert({
      user_id: recipient.id,
      flow_id: saved.id,
      saved_from: "profile",
      metadata: { flow_post_id: post.id },
    }, { onConflict: "user_id,flow_id" }),
  );
  const lookup = () =>
    recipient.client.from("flow_saves")
      .select("flow_id,saved_at,flows!inner(is_hidden,is_saved)")
      .eq("flows.is_hidden", false).eq("flows.is_saved", true)
      .eq("user_id", recipient.id).eq("metadata->>flow_post_id", post.id);
  assertEquals(checked(await lookup()), []);
  checked(
    await recipient.client.from("flows").update({ is_saved: true })
      .eq("id", saved.id).eq("user_id", recipient.id).select("id").single(),
  );
  assertEquals(checked(await lookup()).map((row) => row.flow_id), [saved.id]);
  const savedEvent = checked(
    await recipient.client
      .from("user_event_filing_items_client").select(
        "action_id,behavior_payload",
      )
      .eq("filed_flow_id", saved.id).single(),
  );
  assertEquals(savedEvent.action_id, persistedEvent.action_id);
  assertEquals(savedEvent.behavior_payload.prompt, "Preserved");
  console.log(
    "PASS: authenticated source read, complete local schedule, appearance trigger, share persistence, recipient RLS read, posted snapshot send/forward, dormant Save event writes and acknowledged saved lookup",
  );
} catch (error) {
  failures.push(error);
}
for (const user of users) {
  // Archive event deletions while their temporary owner still exists.
  const deletedEvents = await admin.from("user_events").delete().eq(
    "user_id",
    user.id,
  );
  if (deletedEvents.error) failures.push(deletedEvents.error);
  const result = await admin.auth.admin.deleteUser(user.id);
  if (result.error) failures.push(result.error);
}
if (failures.length) {
  throw new AggregateError(failures, "Flow sharing runtime failed");
}
