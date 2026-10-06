import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { createFlowShareHandler } from "./index.ts";
import { buildFlowShareSnapshot } from "../_shared/flow_share_snapshot.ts";

const appearance = {
  version: 1,
  image_object_path: "sender/header.jpg",
  accent_argb: 0xff6f93a8,
};
const event = {
  id: "1",
  title: "Practice",
  detail: "Instructions",
  location: "Home",
  all_day: false,
  starts_at: "2026-03-07T17:00:00Z",
  ends_at: "2026-03-07T18:00:00Z",
  action_id: "reflect",
  behavior_payload: { prompt: "Begin" },
};
const flow = {
  id: 42,
  name: "Practice flow",
  color: 0x6f93a8,
  user_id: "sender",
  appearance,
  start_date: "2026-03-06",
  end_date: "2026-03-10",
  rules: [],
};

Deno.test("snapshot preserves image, local times, initial gap and DST calendar days", () => {
  const snapshot = buildFlowShareSnapshot(flow, [event, {
    ...event,
    starts_at: "2026-03-08T16:00:00Z",
    ends_at: "2026-03-09T08:00:00Z",
  }], "America/Los_Angeles");
  assertEquals(snapshot.appearance, appearance);
  assertEquals(snapshot.events.map((e) => e.offset_days), [1, 2]);
  assertEquals(snapshot.events.map((e) => e.start_time), ["09:00", "09:00"]);
  assertEquals(snapshot.events[1].end_time, "01:00");
  assertEquals(snapshot.events[1].end_offset_days, 1);
  assertEquals(snapshot.events[0].behavior_payload, event.behavior_payload);
});

function fixture(
  options: {
    count?: number;
    failOffset?: number;
    owner?: string;
    post?: boolean;
    hidden?: boolean;
    auth?: boolean;
  } = {},
) {
  const writes: Record<string, unknown>[] = [];
  const reads: number[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    const send = (body: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    if (url.pathname.endsWith("/auth/v1/user")) {
      return options.auth === false
        ? send({ message: "Invalid JWT" }, 401)
        : send({ id: "sender" });
    }
    if (url.pathname.endsWith("/profiles")) {
      return send({
        id: "recipient",
        display_name: "Sender",
        timezone: "America/Los_Angeles",
      });
    }
    if (url.pathname.endsWith("/flows")) {
      return send({ ...flow, user_id: options.owner ?? "sender" });
    }
    if (url.pathname.endsWith("/flow_posts")) {
      return send({
        ...flow,
        flow_id: 42,
        is_hidden: options.hidden ?? false,
        ai_metadata: {
          payload: {
            appearance,
            events: [{
              offset_days: 0,
              start_time: "9:00 AM",
              title: "Published practice",
            }],
          },
        },
      });
    }
    if (url.pathname.endsWith("/user_event_filing_items_client")) {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      reads.push(offset);
      if (offset === options.failOffset) {
        return send({ message: "Unavailable" }, 503);
      }
      const count = options.count ?? 1;
      return send(
        Array.from(
          { length: Math.max(0, Math.min(500, count - offset)) },
          (_, i) => ({ ...event, id: String(offset + i) }),
        ),
      );
    }
    if (url.pathname.endsWith("/flow_shares") && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return send({ id: "share-1", status: "sent" });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const client = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetcher, headers: { Authorization: "Bearer token" } },
  });
  const handler = createFlowShareHandler({
    userClientFor: () => client,
    adminClient: client,
    sendPush: async () => {},
  });
  const invoke = () =>
    handler(
      new Request("https://example.test", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...(options.post ? { flow_post_id: "post-1" } : { flow_id: 42 }),
          recipients: [{ type: "user", value: "recipient" }],
        }),
      }),
    );
  return { writes, reads, invoke };
}
Deno.test("send waits for every event page and carries the appearance", async () => {
  const f = fixture({ count: 1001 });
  assertEquals((await f.invoke()).status, 200);
  assertEquals(f.reads, [0, 500, 1000]);
  assertEquals(f.writes.length, 1);
  const payload = f.writes[0].payload_json as {
    events: unknown[];
    appearance: unknown;
  };
  assertEquals(payload.events.length, 1001);
  assertEquals(payload.appearance, appearance);
});
Deno.test("failed later page sends nothing", async () => {
  const f = fixture({ count: 1001, failOffset: 500 });
  assertEquals((await f.invoke()).status, 500);
  assertEquals(f.writes, []);
});
Deno.test("unowned source and invalid auth send nothing", async () => {
  for (const options of [{ owner: "other" }, { auth: false }]) {
    const f = fixture(options);
    assertEquals((await f.invoke()).status, options.auth === false ? 401 : 403);
    assertEquals(f.writes, []);
  }
});
Deno.test("posted flow sends its readable published snapshot without private source reads", async () => {
  const f = fixture({ post: true });
  assertEquals((await f.invoke()).status, 200);
  assertEquals(f.reads, []);
  const payload = f.writes[0].payload_json as {
    flow_post_id: string;
    events: { title: string }[];
    appearance: unknown;
  };
  assertEquals(payload.flow_post_id, "post-1");
  assertEquals(payload.events[0].title, "Published practice");
  assertEquals(payload.appearance, appearance);
});
Deno.test("hidden post cannot be sent", async () => {
  const f = fixture({ post: true, hidden: true });
  assertEquals((await f.invoke()).status, 500);
  assertEquals(f.writes, []);
});
