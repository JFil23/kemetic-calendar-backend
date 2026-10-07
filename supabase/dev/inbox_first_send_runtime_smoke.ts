// Local disposable users only; no external notifications.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAuthenticatedSendDmHandler } from "../functions/send_dm_message/index.ts";
const config = Object.fromEntries(
  (await new Response(Deno.stdin.readable).text()).split("\n")
    .flatMap((line) => {
      const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
      return match ? [[match[1], match[2]]] : [];
    }),
);
const url = config.API_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error(
    "This smoke test requires a disposable loopback Supabase URL",
  );
}
assertExists(config.ANON_KEY);
assertExists(config.SERVICE_ROLE_KEY);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, config.SERVICE_ROLE_KEY, options);
const users: {
  id: string;
  token: string;
  client: typeof admin;
}[] = [];
const pushes: unknown[] = [];

const send = createAuthenticatedSendDmHandler({
  supabaseUrl: url,
  apiKey: config.SERVICE_ROLE_KEY,
  fetchImpl: () => Promise.resolve(new Response('{"delivered":true}')),
});
const failures: unknown[] = [];
try {
  for (let i = 0; i < 3; i++) {
    const email = `group-smoke-${crypto.randomUUID()}@example.test`;
    const password = crypto.randomUUID();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    const id = created.data.user!.id;
    const client = createClient(url, config.ANON_KEY, options);
    const user = { id, token: "", client };
    users.push(user);
    const profile = await admin.from("profiles").upsert({
      id,
      display_name: `DM smoke ${i}`,
      allow_incoming_shares: true,
    });
    if (profile.error) throw profile.error;
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    user.token = signedIn.data.session!.access_token;
  }

  const [a, b, outsider] = users;
  const sentIds: string[] = [];
  for (const [sender, recipient] of [[a, b], [b, a]]) {
    const before = await sender.client.from("flows").select("id")
      .eq("user_id", sender.id).eq("notes", "__dm_placeholder__");
    assertEquals(before.error, null);
    assertEquals(before.data?.length, 0);
    const response = await send(
      new Request(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sender.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipientId: recipient.id,
          text: "First message",
        }),
      }),
    );
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    sentIds.push(body.share.id);
    const visible = await recipient.client.from("flow_shares").select("id")
      .eq("id", body.share.id);
    assertEquals(visible.error, null);
    assertEquals(visible.data?.length, 1);
    const flow = await sender.client.from("flows").select("calendar_id")
      .eq("user_id", sender.id).eq("notes", "__dm_placeholder__").single();
    assertEquals(flow.error, null);
    assertExists(flow.data?.calendar_id);
  }
  const [first] = sentIds;
  const replyResponse = await send(
    new Request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${b.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipientId: a.id,
        text: "A reply",
        replyToId: first,
        replyToKind: "flow",
      }),
    }),
  );
  const replyBody = await replyResponse.json();
  assertEquals(replyResponse.status, 200, JSON.stringify(replyBody));
  const replyRow = await a.client.from("flow_shares").select("payload_json").eq(
    "id",
    replyBody.share.id,
  ).single();
  assertEquals(replyRow.data?.payload_json.reply_to.text, "First message");
  const unauthorized = await outsider.client.rpc("inbox_message_action", {
    p_kind: "flow",
    p_id: first,
    p_action: "hide",
  });
  assertExists(unauthorized.error);
  assertExists(
    (await b.client.rpc("inbox_message_action", {
      p_kind: "flow",
      p_id: first,
      p_action: "unsend",
    })).error,
  );
  const hidden = await b.client.rpc("inbox_message_action", {
    p_kind: "flow",
    p_id: first,
    p_action: "hide",
  });
  assertEquals(hidden.error, null);
  assertEquals(hidden.data, true);
  const fresh = createClient(url, config.ANON_KEY, {
    ...options,
    global: { headers: { Authorization: `Bearer ${b.token}` } },
  });
  assertEquals(
    (await fresh.from("flow_shares").select("id").eq("id", first)).data,
    [],
  );
  assertEquals(
    (await a.client.from("flow_shares").select("id").eq("id", first)).data
      ?.length,
    1,
  );
  const unsent = await a.client.rpc("inbox_message_action", {
    p_kind: "flow",
    p_id: first,
    p_action: "unsend",
  });
  assertEquals(unsent.error, null);
  assertEquals(unsent.data, true);
  assertExists(
    (await admin.from("flow_shares").select("deleted_at").eq("id", first)
      .single()).data?.deleted_at,
  );
  console.log(
    "PASS: new senders, real RLS/calendar ownership, verified replies, private hide/fresh client, sender-only unsend, outsider isolation",
  );
} catch (error) {
  failures.push(error);
}
for (const user of users) {
  const result = await admin.auth.admin.deleteUser(user.id);
  if (result.error) failures.push(result.error);
}
if (failures.length) {
  throw new AggregateError(failures, "First-send smoke failed");
}
