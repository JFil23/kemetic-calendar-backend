// deno-lint-ignore-file no-import-prefix -- matches the backend pinned URL import convention.
import {
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fetchGoogleSnapshot,
  ImportError,
  normalize,
  scopes,
} from "./google.ts";
const event = {
  id: "one",
  summary: "Outside event",
  start: { dateTime: "2026-10-01T10:00:00-07:00" },
  end: { dateTime: "2026-10-01T11:00:00-07:00" },
};
Deno.test("calendar import requests only read permissions", () => {
  assertEquals(scopes.every((s) => s.endsWith(".readonly")), true);
});
Deno.test("recurrence identity survives a move and distinguishes occurrences and calendars", async () => {
  const recurring = {
    ...event,
    recurringEventId: "series",
    originalStartTime: event.start,
  };
  const a = await normalize("a", recurring);
  assertEquals(
    a?.key,
    (await normalize("a", {
      ...recurring,
      start: { dateTime: "2026-10-02T10:00:00-07:00" },
    }))?.key,
  );
  assertEquals(
    a?.key,
    (await normalize("a", {
      ...recurring,
      originalStartTime: { dateTime: "2026-10-01T17:00:00Z" },
    }))?.key,
  );
  assertNotEquals(a?.key, (await normalize("b", recurring))?.key);
  assertNotEquals(
    a?.key,
    (await normalize("a", {
      ...recurring,
      originalStartTime: { dateTime: "2026-10-08T10:00:00-07:00" },
    }))?.key,
  );
});
Deno.test("all day dates preserve exclusive end; cancelled events and old exports are excluded", async () => {
  const a = await normalize("a", {
    ...event,
    start: { date: "2026-10-01" },
    end: { date: "2026-10-03" },
  });
  assertEquals(a?.start, "2026-10-01T00:00:00.000Z");
  assertEquals(a?.end, "2026-10-03T00:00:00.000Z");
  assertEquals(await normalize("a", { ...event, status: "cancelled" }), null);
  assertEquals(
    await normalize("a", { ...event, description: "kemet_cid:old" }),
    null,
  );
});
Deno.test("partial calendar failure aborts the entire snapshot", async () => {
  let calls = 0;
  const fetcher = (() =>
    Promise.resolve(
      ++calls === 1
        ? Response.json({ items: [{ id: "a" }, { id: "b" }] })
        : calls === 2
        ? Response.json({ items: [event] })
        : new Response("", { status: 500 }),
    )) as typeof fetch;
  await assertRejects(
    () =>
      fetchGoogleSnapshot(
        "token",
        "2026-01-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        fetcher,
      ),
    ImportError,
    "provider_unavailable",
  );
});
Deno.test("all event pages are read and provider requests never write", async () => {
  let calls = 0;
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    assertEquals(init?.method, undefined);
    calls++;
    assertEquals(new URL(input.toString()).host, "www.googleapis.com");
    return Promise.resolve(
      Response.json(
        calls === 1
          ? { items: [{ id: "a@calendar" }] }
          : calls === 2
          ? { items: [event], nextPageToken: "next" }
          : { items: [{ ...event, id: "two" }] },
      ),
    );
  }) as typeof fetch;
  assertEquals(
    (await fetchGoogleSnapshot(
      "token",
      "2026-01-01T00:00:00Z",
      "2027-01-01T00:00:00Z",
      fetcher,
    )).length,
    2,
  );
  assertEquals(calls, 3);
});

Deno.test("Google quota denial preserves the connection instead of requesting new consent", async () => {
  const fetcher = (() =>
    Promise.resolve(Response.json({
      error: {
        errors: [
          { reason: "rateLimitExceeded" },
        ],
      },
    }, { status: 403 }))) as typeof fetch;
  await assertRejects(
    () => fetchGoogleSnapshot("token", "2026-10-01", "2026-11-01", fetcher),
    ImportError,
    "provider_unavailable",
  );
});
