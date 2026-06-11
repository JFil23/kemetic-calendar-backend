// deno-lint-ignore-file no-explicit-any

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createEnsureUserGuidanceHandler } from "./index.ts";

const userId = "00000000-0000-4000-8000-000000000001";

function createMockClient(
  timezone = "America/Los_Angeles",
  options?: {
    user?: { id: string } | null;
    authError?: unknown;
  },
) {
  let authCalls = 0;
  const client = {
    auth: {
      getUser: (_token: string) => {
        authCalls += 1;
        return Promise.resolve({
          data: {
            user: options?.user === undefined ? { id: userId } : options.user,
          },
          error: options?.authError ?? null,
        });
      },
    },
    from: (_table: string) => ({
      select: (_columns = "*") => ({
        eq: (_column: string, _value: unknown) => ({
          maybeSingle: () =>
            Promise.resolve({ data: { timezone }, error: null }),
        }),
      }),
    }),
  };
  return Object.assign(client, { authCalls: () => authCalls });
}

function assertCorsHeaders(response: Response) {
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertStringIncludes(
    response.headers.get("Access-Control-Allow-Methods") ?? "",
    "POST",
  );
  assertStringIncludes(
    response.headers.get("Access-Control-Allow-Methods") ?? "",
    "OPTIONS",
  );
  const allowedHeaders = response.headers.get("Access-Control-Allow-Headers") ??
    "";
  assertStringIncludes(allowedHeaders, "authorization");
  assertStringIncludes(allowedHeaders, "apikey");
  assertStringIncludes(allowedHeaders, "content-type");
}

function authedRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/ensure_user_guidance", {
    method: "POST",
    headers: {
      "Authorization": "Bearer user-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("ensure_user_guidance handles browser preflight without auth", async () => {
  const client = createMockClient();
  const handler = createEnsureUserGuidanceHandler({
    client,
    invokeFunction: async () => ({ status: 200, data: null }),
  });

  const response = await handler(
    new Request("http://localhost/ensure_user_guidance", {
      method: "OPTIONS",
    }),
  );

  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 0);
});

Deno.test("ensure_user_guidance keeps auth required for POST", async () => {
  const client = createMockClient();
  const handler = createEnsureUserGuidanceHandler({
    client,
    invokeFunction: async () => ({ status: 200, data: null }),
  });

  const response = await handler(
    new Request("http://localhost/ensure_user_guidance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "Unauthorized");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 0);
});

Deno.test("ensure_user_guidance returns CORS headers for unsupported methods", async () => {
  const client = createMockClient();
  const handler = createEnsureUserGuidanceHandler({
    client,
    invokeFunction: async () => ({ status: 200, data: null }),
  });

  const response = await handler(
    new Request("http://localhost/ensure_user_guidance", { method: "GET" }),
  );
  const body = await response.json();

  assertEquals(response.status, 405);
  assertEquals(body.error, "Method not allowed");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 0);
});

Deno.test("ensure_user_guidance rejects invalid bearer tokens", async () => {
  const client = createMockClient("America/Los_Angeles", {
    user: null,
    authError: new Error("bad token"),
  });
  const handler = createEnsureUserGuidanceHandler({
    client,
    invokeFunction: async () => ({ status: 200, data: null }),
  });

  const response = await handler(authedRequest());
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "Unauthorized");
  assertCorsHeaders(response);
  assertEquals(client.authCalls(), 1);
});

Deno.test("ensure_user_guidance schedules windows, ensures opening, and evaluates current guidance", async () => {
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const handler = createEnsureUserGuidanceHandler({
    client: createMockClient(),
    now: () => new Date("2026-05-18T12:00:00.000Z"),
    invokeFunction: async ({ name, body }) => {
      calls.push({ name, body });
      return { status: 200, data: { ok: true, name } };
    },
  });

  const res = await handler(authedRequest({
    timezone: "America/Los_Angeles",
    day_card: {
      date: "2026-05-18",
      maatPrinciple: "Measure",
      decanDayAction: "Name one finish condition",
    },
  }));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertCorsHeaders(res);
  assertEquals(body.success, true);
  assertEquals(body.local_date, "2026-05-18");
  assertEquals(body.current_period_key, "2026-05-09:2026-05-18:2-3");
  assertEquals(calls.map((call) => call.name), [
    "schedule_decan_reflection",
    "schedule_decan_reflection",
    "cron_maat_decan_opening",
    "evaluate_maat_guidance",
  ]);
  assertEquals(calls[0].body.decan_start, "2026-05-09");
  assertEquals(calls[1].body.decan_start, "2026-05-19");
  assertEquals(
    (calls[2].body.day_card as Record<string, unknown>).date,
    "2026-05-18",
  );
  assertEquals(calls[3].body.local_date, "2026-05-18");
});

Deno.test("ensure_user_guidance reports partial failure without hiding successful calls", async () => {
  const handler = createEnsureUserGuidanceHandler({
    client: createMockClient(),
    now: () => new Date("2026-05-18T12:00:00.000Z"),
    invokeFunction: async ({ name }) => ({
      status: name === "evaluate_maat_guidance" ? 500 : 200,
      data: { name },
    }),
  });

  const res = await handler(authedRequest());
  const body = await res.json();

  assertEquals(res.status, 502);
  assertCorsHeaders(res);
  assertEquals(body.success, false);
  assertEquals(body.evaluation.name, "evaluate_maat_guidance");
  assertEquals(body.evaluation.ok, false);
  assert(body.reflection_schedule.every((row: any) => row.ok === true));
});
