// Disposable local Supabase only. Input: `supabase status -o env` on stdin.
// Exercises the real handlers/store, auth, RLS, persistence and Realtime.
// Push delivery is captured locally; no external messages are sent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSupabaseDmConversationStore } from "../functions/_shared/dm_conversations.ts";
import { createCreateDmConversationHandler } from "../functions/create_dm_conversation/index.ts";
import { createSendDmMessageV2Handler } from "../functions/send_dm_message_v2/index.ts";
import { createMarkDmConversationReadHandler } from "../functions/mark_dm_conversation_read/index.ts";

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
const store = createSupabaseDmConversationStore({
  client: admin,
  supabaseUrl: url,
  fetchImpl: (_input, init) => {
    pushes.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response('{"delivered":true}', { status: 200 }));
  },
});
const create = createCreateDmConversationHandler({ store });
const send = createSendDmMessageV2Handler({ store });
const read = createMarkDmConversationReadHandler({ store });
function request(token: string, body: unknown) {
  return new Request(`${url}/functions/v1/local-smoke`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
async function ok(response: Response) {
  const body = await response.json();
  assertEquals(response.status, 200, JSON.stringify(body));
  return body;
}
async function deadline<T>(promise: Promise<T>, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Realtime timed out: ${stage}`)),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
let conversationId: string | undefined;
const failures: unknown[] = [];
try {
  for (let i = 0; i < 4; i++) {
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
  console.log("Local accounts authenticated");
  const [a, b, c, outsider] = users;
  const created = await ok(
    await create(request(a.token, { participantIds: [b.id, c.id] })),
  );
  conversationId = created.conversation.id;
  assertEquals(created.conversation.type, "group");
  assertEquals(created.members.length, 3);
  const reused = await ok(
    await create(request(a.token, { participantIds: [c.id, b.id] })),
  );
  assertEquals(reused.conversation.id, conversationId);
  assertEquals(reused.reused, true);
  const preflight = await create(
    new Request(url, {
      method: "OPTIONS",
      headers: { origin: "https://kemet-rc.pages.dev" },
    }),
  );
  assertEquals(preflight.status, 204);
  assertEquals(
    preflight.headers.get("Access-Control-Allow-Origin"),
    "https://kemet-rc.pages.dev",
  );
  assertEquals(
    (await create(request("invalid", { participantIds: [b.id, c.id] }))).status,
    401,
  );

  console.log("Create/reuse and auth checks passed");
  await b.client.realtime.setAuth(b.token);
  let received!: (id: string) => void;
  const incoming = new Promise<string>((resolve) => received = resolve);
  // A channel join can finish before its PostgreSQL replication subscription.
  // Wait for the server's explicit system acknowledgement before the one send.
  let postgresReady!: () => void;
  let postgresFailed!: (reason: Error) => void;
  const replicationReady = new Promise<void>((resolve, reject) => {
    postgresReady = resolve;
    postgresFailed = reject;
  });
  const channel = b.client.channel(`dm-smoke-${crypto.randomUUID()}`);
  // realtime-js 2.10.2 dispatches the protocol's system event through on(),
  // but its TypeScript overloads omit it. Keep this narrow adapter test-local.
  const systemEvents = channel as unknown as {
    on(
      event: "system",
      filter: Record<string, never>,
      callback: (payload: {
        extension?: string;
        status?: string;
        message?: string;
      }) => void,
    ): void;
  };
  systemEvents.on("system", {}, (payload) => {
    console.log("Realtime replication:", payload.status, payload.message);
    if (payload.extension !== "postgres_changes") return;
    if (payload.status === "ok") postgresReady();
    if (payload.status === "error") {
      postgresFailed(new Error(String(payload.message)));
    }
  });
  channel
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "dm_messages",
      filter: `conversation_id=eq.${conversationId}`,
    }, (payload) => received(payload.new.id));
  await deadline(
    Promise.all([
      replicationReady,
      new Promise<void>((resolve, reject) => {
        channel.subscribe((status, error) => {
          console.log("Realtime subscription:", status, error?.message ?? "");
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reject(error ?? new Error(status));
          }
        });
      }),
    ]),
    "subscribe and PostgreSQL readiness",
  );
  const payload = {
    conversationId,
    text: "Local group chat smoke",
    clientMessageId: crypto.randomUUID(),
  };
  const sent = await ok(await send(request(a.token, payload)));
  const visible = await b.client.from("dm_conversation_messages_client").select(
    "id",
  ).eq("conversation_id", conversationId);
  assertEquals(visible.error, null);
  assertEquals(visible.data?.length, 1);
  console.log("Sent message is readable by another member");
  assertEquals(await deadline(incoming, "receive message"), sent.message.id);
  const retried = await ok(await send(request(a.token, payload)));
  assertEquals(retried.message.id, sent.message.id);
  assertEquals(pushes.length, 2);
  const messages = await b.client.from("dm_conversation_messages_client")
    .select().eq("conversation_id", conversationId);
  assertEquals(messages.error, null);
  assertEquals(messages.data?.length, 1);
  assertEquals(messages.data?.[0].body, payload.text);
  const reopened = createClient(url, config.ANON_KEY, {
    ...options,
    global: { headers: { Authorization: `Bearer ${c.token}` } },
  });
  const summary = await reopened.from("dm_conversation_summaries").select().eq(
    "conversation_id",
    conversationId,
  ).single();
  assertEquals(summary.error, null);
  assertEquals(summary.data?.unread_count, 1);
  await ok(await read(request(c.token, { conversationId })));
  const afterRead = await reopened.from("dm_conversation_summaries").select()
    .eq("conversation_id", conversationId).single();
  assertEquals(afterRead.error, null);
  assertEquals(afterRead.data?.unread_count, 0);
  const hidden = await outsider.client.from("dm_conversation_messages_client")
    .select().eq("conversation_id", conversationId);
  assertEquals(hidden.error, null);
  assertEquals(hidden.data, []);
  assertEquals((await send(request(outsider.token, payload))).status, 403);
  assertEquals(
    (await read(request(outsider.token, { conversationId }))).status,
    403,
  );
  const reply = await ok(
    await send(
      request(b.token, {
        conversationId,
        text: "Quoted reply",
        replyToId: sent.message.id,
        clientMessageId: crypto.randomUUID(),
      }),
    ),
  );
  assertEquals(reply.message.payload_json.reply_to.text, payload.text);
  assertExists(
    (await b.client.rpc("inbox_message_action", {
      p_kind: "dm",
      p_id: sent.message.id,
      p_action: "unsend",
    })).error,
  );
  assertExists(
    (await outsider.client.rpc("inbox_message_action", {
      p_kind: "dm",
      p_id: sent.message.id,
      p_action: "hide",
    })).error,
  );
  const hide = await b.client.rpc("inbox_message_action", {
    p_kind: "dm",
    p_id: sent.message.id,
    p_action: "hide",
  });
  assertEquals(hide.error, null);
  assertEquals(
    (await b.client.from("dm_conversation_messages_client").select("id").eq(
      "id",
      sent.message.id,
    )).data,
    [],
  );
  assertEquals(
    (await c.client.from("dm_conversation_messages_client").select("id").eq(
      "id",
      sent.message.id,
    )).data?.length,
    1,
  );
  const unsend = await a.client.rpc("inbox_message_action", {
    p_kind: "dm",
    p_id: sent.message.id,
    p_action: "unsend",
  });
  assertEquals(unsend.error, null);
  assertEquals(
    (await c.client.from("dm_conversation_messages_client").select("id").eq(
      "id",
      sent.message.id,
    )).data,
    [],
  );
  console.log(
    "PASS: create/reuse, CORS/auth, send/retry, member realtime, fresh-client persistence, unread/read, outsider isolation",
  );
} catch (error) {
  failures.push(error);
}
{
  for (const user of users) await user.client.removeAllChannels();
  if (conversationId) {
    const result = await admin.from("dm_conversations").delete().eq(
      "id",
      conversationId,
    );
    if (result.error) failures.push(result.error);
  }
  for (const user of users) {
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error) failures.push(result.error);
  }
}

if (failures.length) {
  throw new AggregateError(failures, "Group DM smoke failed");
}
