// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CalendarError,
  CredentialCipher,
  Deadline,
  GoogleCalendar,
  hash,
  type Json,
  projectEvent,
  requestedWindow,
  SCOPES,
  type Source,
} from "./domain.ts";
import {
  type CalendarConfig,
  type CalendarStore,
  createExternalCalendarHandler,
} from "./index.ts";
const cipher = new CredentialCipher(btoa("k".repeat(32)));
const laneConfig = {
  clientId: "fixture-client",
  clientSecret: "fixture-secret",
  callback: "https://backend.test/functions/v1/external_calendar/callback",
  origin: "https://kemet-rc.pages.dev",
};
const config: CalendarConfig = {
  lanes: { staging: laneConfig },
  cipher,
  workerSecret: "fixture-worker-secret",
};
const source: Source = {
  id: "10000000-0000-4000-8000-000000000001",
  provider_calendar_id: "fixture@example.test",
  label: "Fixture",
  color: null,
};
const event = {
  id: "series_20261002",
  recurringEventId: "series",
  originalStartTime: { dateTime: "2026-10-02T09:00:00-07:00" },
  summary: "Appointment",
  start: { dateTime: "2026-10-02T10:00:00-07:00" },
  end: { dateTime: "2026-10-02T11:00:00-07:00" },
};
const window = {
  start: "2026-10-01T00:00:00Z",
  end: "2026-11-01T00:00:00Z",
  time_zone: "America/Los_Angeles",
};
function request(body: Json, headers: Record<string, string> = {}) {
  return new Request("https://backend.test/functions/v1/external_calendar", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-session",
      "Content-Type": "application/json",
      Origin: laneConfig.origin,
      ...headers,
    },
    body: JSON.stringify({ lane: "staging", ...body }),
  });
}
function fetchResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
async function fixture(
  options: {
    fetcher?: typeof fetch;
    failAction?: string;
    expired?: boolean;
    deadlineMs?: number;
  } = {},
) {
  const calls: { action: string; user: string | null; payload: Json }[] = [];
  const credentials = await cipher.seal({
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_at: options.expired ? 0 : Date.now() + 3600000,
  }, "user-one:staging");
  const store: CalendarStore = {
    authenticate(token) {
      return Promise.resolve(token === "test-session" ? "user-one" : null);
    },
    call(action, user, _lane, payload) {
      calls.push({ action, user, payload });
      if (action === options.failAction) {
        return Promise.reject({ message: "sync_busy" });
      }
      if (action === "claim") {
        return Promise.resolve({
          id: "connection-one",
          user_id: "user-one",
          lane: "staging",
          provider_subject: "google-sub-one",
          generation: 7,
          lease_token: "test-lease",
          credentials,
          sources: [source],
        });
      }
      if (action === "status") {
        return Promise.resolve({
          connection: {
            id: "connection-one",
            provider: "google",
            status: "connected",
            revision: 7,
            account_label: "Fixture",
            automatic: true,
            last_synced_at: null,
            error_code: null,
          },
          sources: [],
          syncing: false,
          retry_at: null,
        });
      }
      if (action === "apply") return Promise.resolve({ changed: 1 });
      if (action === "due") return Promise.resolve([]);
      return Promise.resolve({});
    },
  };
  const fetcher = options.fetcher ??
    ((input) =>
      Promise.resolve(
        String(input).includes("userinfo")
          ? fetchResponse({ sub: "google-sub-one" })
          : fetchResponse({ items: [event] }),
      )) as typeof fetch;
  return {
    handler: createExternalCalendarHandler({
      store,
      config,
      google: new GoogleCalendar(fetcher),
      deadlineMs: options.deadlineMs,
    }),
    store,
    calls,
    credentials,
  };
}
Deno.test("credential envelopes authenticate account and lane and never reveal tokens", async () => {
  const sealed = await cipher.seal(
    { refresh_token: "secret-value" },
    "owner:staging",
  );
  assert(!JSON.stringify(sealed).includes("secret-value"));
  assertEquals(await cipher.open(sealed, "owner:staging"), {
    refresh_token: "secret-value",
  });
  await assertRejects(
    () => cipher.open(sealed, "other:staging"),
    CalendarError,
    "credentials_unavailable",
  );
  await assertRejects(
    () => cipher.open(sealed, "owner:production"),
    CalendarError,
    "credentials_unavailable",
  );
});
Deno.test("deadline cancels a never completing request and expired deadline starts no work", async () => {
  const d = new Deadline(12);
  let aborted = false;
  await assertRejects(
    () =>
      d.run((signal) => {
        signal.addEventListener("abort", () => aborted = true);
        return new Promise(() => {});
      }),
    CalendarError,
    "timeout",
  );
  assert(aborted);
  let started = false;
  await assertRejects(
    () =>
      d.run(() => {
        started = true;
        return Promise.resolve();
      }),
    CalendarError,
    "timeout",
  );
  assertEquals(started, false);
});
Deno.test("date-only exclusive end and stable recurring original identity survive mapping", () => {
  const a = projectEvent({
    id: "all-day",
    start: { date: "2026-11-01" },
    end: { date: "2026-11-03" },
  })!;
  assertEquals([a.start_date, a.end_date, a.all_day], [
    "2026-11-01",
    "2026-11-03",
    true,
  ]);
  const r = projectEvent(event)!;
  assertEquals(r.recurrence_id, "series:2026-10-02T09:00:00-07:00");
  assertEquals(r.starts_at, "2026-10-02T17:00:00.000Z");
  assertEquals(projectEvent({ status: "cancelled" }), null);
});
Deno.test("invalid provider events fail the whole snapshot rather than deleting missing rows", () => {
  let failed = false;
  try {
    projectEvent({
      id: "bad",
      start: { date: "2026-02-31" },
      end: { date: "2026-03-03" },
    });
  } catch (e) {
    failed = e instanceof CalendarError;
  }
  assert(failed);
});
Deno.test("calendar list follows empty pages and explicitly includes hidden calendars", async () => {
  const seen: string[] = [];
  const google = new GoogleCalendar(
    ((input) => {
      const url = String(input);
      seen.push(url);
      return Promise.resolve(fetchResponse(
        seen.length === 1 ? { items: [], nextPageToken: "page-two" } : {
          items: [{
            id: "hidden",
            summary: "Hidden source",
            backgroundColor: "#123abc",
          }],
        },
      ));
    }) as typeof fetch,
  );
  const result = await google.sources("token", new Deadline());
  assertEquals(result.length, 1);
  assertEquals(seen.length, 2);
  assert(seen.every((url) => url.includes("showHidden=true")));
  assert(seen[1].includes("pageToken=page-two"));
});
Deno.test("event snapshots finish every page and never request write or incremental APIs", async () => {
  const seen: { url: string; method: string }[] = [];
  const google = new GoogleCalendar(
    ((input, init) => {
      seen.push({ url: String(input), method: init?.method ?? "GET" });
      return Promise.resolve(fetchResponse(
        seen.length === 1
          ? { items: [], nextPageToken: "page-two" }
          : { items: [event] },
      ));
    }) as typeof fetch,
  );
  const result = await google.snapshot(
    "token",
    [source],
    window,
    new Deadline(),
  );
  assertEquals(result[0].events.length, 1);
  assertEquals(seen.length, 2);
  assert(
    seen.every((x) =>
      x.method === "GET" && !x.url.includes("syncToken") &&
      x.url.includes("singleEvents=true")
    ),
  );
});
Deno.test("looping page tokens fail with a bounded error", async () => {
  const google = new GoogleCalendar(
    (() =>
      Promise.resolve(
        fetchResponse({ items: [], nextPageToken: "same" }),
      )) as typeof fetch,
  );
  await assertRejects(
    () => google.snapshot("token", [source], window, new Deadline()),
    CalendarError,
    "provider_page_limit",
  );
});
Deno.test("OAuth requests exactly readonly calendar scopes, offline access and PKCE", async () => {
  const google = new GoogleCalendar();
  const url = new URL(
    google.authorizationUrl(
      laneConfig,
      "staging.state",
      await hash("verifier"),
    ),
  );
  assertEquals(url.searchParams.get("scope"), SCOPES.join(" "));
  assertEquals(url.searchParams.get("access_type"), "offline");
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assert(
    !url.searchParams.get("scope")!.split(" ").includes(
      "https://www.googleapis.com/auth/calendar",
    ),
  );
});
Deno.test("refresh token rotation retains old refresh token when Google does not resend it", async () => {
  const google = new GoogleCalendar(
    (() =>
      Promise.resolve(
        fetchResponse({ access_token: "new-access", expires_in: 3600 }),
      )) as typeof fetch,
  );
  const result = await google.refresh(laneConfig, {
    access_token: "old-access",
    refresh_token: "old-refresh",
    expires_at: 0,
  }, new Deadline());
  assertEquals(result.refresh_token, "old-refresh");
  assertEquals(result.access_token, "new-access");
});
Deno.test("invalid grant demands reconnect while rate limits remain retryable", async () => {
  const invalid = new GoogleCalendar(
    (() =>
      Promise.resolve(
        fetchResponse({ error: "invalid_grant" }, 400),
      )) as typeof fetch,
  );
  await assertRejects(
    () =>
      invalid.refresh(laneConfig, {
        access_token: "a",
        refresh_token: "r",
        expires_at: 0,
      }, new Deadline()),
    CalendarError,
    "reconnect_required",
  );
  const limited = new GoogleCalendar(
    (() =>
      Promise.resolve(
        fetchResponse(
          { error: { errors: [{ reason: "rateLimitExceeded" }] } },
          403,
        ),
      )) as typeof fetch,
  );
  await assertRejects(
    () => limited.sources("a", new Deadline()),
    CalendarError,
    "rate_limited",
  );
});
Deno.test("unauthenticated request and lane-origin mismatch perform no service mutations", async () => {
  const f = await fixture();
  assertEquals(
    (await f.handler(
      request({ action: "connect" }, { Authorization: "Bearer wrong" }),
    )).status,
    401,
  );
  assertEquals(f.calls.length, 0);
  assertEquals(
    (await f.handler(request({ action: "connect", lane: "production" })))
      .status,
    403,
  );
  assertEquals(f.calls.length, 0);
});
Deno.test("unconfigured lane still returns visible unavailable status to its correct origin", async () => {
  const f = await fixture();
  const handler = createExternalCalendarHandler({
    store: f.store,
    config: { lanes: {}, cipher: null, workerSecret: "" },
  });
  const result = await handler(request({ action: "status" }));
  assertEquals(result.status, 200);
  assertEquals((await result.json()).available, false);
});
Deno.test("successful refresh commits only after all pages and validates immutable Google identity", async () => {
  const f = await fixture();
  const response = await f.handler(request({ action: "refresh", ...window }));
  assertEquals(response.status, 200);
  assertEquals(f.calls.map((x) => x.action), ["claim", "apply", "status"]);
  assertEquals(f.calls[1].payload.generation, 7);
  assertEquals((f.calls[1].payload.sources as Json[])[0].id, source.id);
});
Deno.test("second-page failure preserves old data and releases bounded lease with error", async () => {
  let pages = 0;
  const f = await fixture({
    fetcher: ((input) => {
      if (String(input).includes("userinfo")) {
        return Promise.resolve(fetchResponse({ sub: "google-sub-one" }));
      }
      pages++;
      return Promise.resolve(
        pages === 1
          ? fetchResponse({ items: [event], nextPageToken: "two" })
          : fetchResponse({ error: "provider" }, 503),
      );
    }) as typeof fetch,
  });
  const response = await f.handler(request({ action: "refresh", ...window }));
  assertEquals(response.status, 502);
  assertEquals(f.calls.map((x) => x.action), ["claim", "fail"]);
  assertEquals(f.calls[1].payload.error_code, "provider_unavailable");
});
Deno.test("identity mismatch never applies another Google account data", async () => {
  const f = await fixture({
    fetcher: (() =>
      Promise.resolve(
        fetchResponse({ sub: "another-google-account" }),
      )) as typeof fetch,
  });
  const response = await f.handler(request({ action: "refresh", ...window }));
  assertEquals(response.status, 409);
  assertEquals(f.calls.map((x) => x.action), ["claim", "fail"]);
});
Deno.test("offline-first failure can retry on a later request without permanent busy state", async () => {
  let fail = true;
  const f = await fixture({
    fetcher: ((input) => {
      if (fail) return Promise.reject(new TypeError("offline"));
      return Promise.resolve(
        String(input).includes("userinfo")
          ? fetchResponse({ sub: "google-sub-one" })
          : fetchResponse({ items: [event] }),
      );
    }) as typeof fetch,
  });
  assertEquals(
    (await f.handler(request({ action: "refresh", ...window }))).status,
    503,
  );
  fail = false;
  assertEquals(
    (await f.handler(request({ action: "refresh", ...window }))).status,
    200,
  );
  assertEquals(f.calls.filter((x) => x.action === "apply").length, 1);
});
Deno.test("timeout terminates import and late provider result cannot apply", async () => {
  let complete: (value: Response) => void = () => {};
  const f = await fixture({
    deadlineMs: 20,
    fetcher: ((_input) =>
      new Promise((resolve) =>
        complete = resolve
      )) as typeof fetch,
  });
  const response = await f.handler(request({ action: "refresh", ...window }));
  assertEquals(response.status, 504);
  complete(fetchResponse({ sub: "google-sub-one" }));
  await new Promise((resolve) => setTimeout(resolve, 1));
  assertEquals(f.calls.map((x) => x.action), ["claim", "fail"]);
});
Deno.test("disconnect is lane-local and forwards acknowledged revision without provider revocation", async () => {
  let fetched = false;
  const f = await fixture({
    fetcher: (() => {
      fetched = true;
      return Promise.resolve(fetchResponse({}));
    }) as typeof fetch,
  });
  assertEquals(
    (await f.handler(request({ action: "disconnect", expected_revision: 4 })))
      .status,
    200,
  );
  assertEquals(f.calls[0].payload.expected_revision, 4);
  assertEquals(fetched, false);
});
Deno.test("native snapshot enters only separate action boundary with JWT-derived user", async () => {
  const f = await fixture();
  const response = await f.handler(
    request({
      action: "device_snapshot",
      user_id: "spoofed-user",
      provider: "google",
      device_id: "device-owner-000001",
      expected_revision: 3,
      sources: [],
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(f.calls[0].action, "device_snapshot");
  assertEquals(f.calls[0].user, "user-one");
});
Deno.test("worker cannot run with user JWT or absent dedicated secret", async () => {
  const f = await fixture();
  const response = await f.handler(
    new Request("https://backend.test/functions/v1/external_calendar/worker", {
      method: "POST",
      headers: { Authorization: "Bearer test-session" },
      body: "{}",
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(f.calls.length, 0);
});
Deno.test("worker is bounded and uses due-only accounts while retaining retry path", async () => {
  const f = await fixture();
  const response = await f.handler(
    new Request("https://backend.test/functions/v1/external_calendar/worker", {
      method: "POST",
      headers: { "x-external-calendar-secret": config.workerSecret },
      body: "{}",
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(f.calls.map((x) => x.action), ["due", "housekeeping"]);
});
Deno.test("visible-window range validation excludes malformed, reversed, and oversized requests", () => {
  assertEquals(
    requestedWindow({}, new Date("2026-10-02T00:00:00Z")).time_zone,
    "UTC",
  );
  for (
    const value of [
      { start: "bad", end: window.end },
      { start: window.end, end: window.start },
      { start: "2020-01-01", end: "2030-01-01" },
      { time_zone: "Not/AZone" },
    ]
  ) {
    let rejected = false;
    try {
      requestedWindow(value);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
Deno.test("OAuth callback is one-use, account-bound, and returns no provider code or token", async () => {
  const f = await fixture();
  let pending: Json | null = null;
  const base = f.store.call;
  f.store.call = (action, user, lane, payload, signal) => {
    if (action === "create_oauth") {
      pending = payload;
      return Promise.resolve({});
    }
    if (action === "consume_oauth") {
      if (!pending || payload.state_hash !== pending.state_hash) {
        return Promise.reject({ message: "invalid_oauth_state" });
      }
      const result = {
        user_id: "user-one",
        lane: "staging",
        envelope: pending.envelope,
        expected_connection: null,
        expected_generation: null,
      };
      pending = null;
      return Promise.resolve(result);
    }
    return base(action, user, lane, payload, signal);
  };
  const google = new GoogleCalendar(
    ((input) =>
      Promise.resolve(
        String(input).includes("/token")
          ? fetchResponse({
            access_token: "private-access",
            refresh_token: "private-refresh",
            expires_in: 3600,
            scope: SCOPES.join(" "),
          })
          : fetchResponse({
            sub: "immutable-google-sub",
            email: "fixture@example.test",
          }),
      )) as typeof fetch,
  );
  const handler = createExternalCalendarHandler({
    store: f.store,
    config,
    google,
  });
  const connect = await handler(request({ action: "connect" }));
  const auth = new URL((await connect.json()).authorization_url);
  assert(pending);
  assert(!JSON.stringify(pending).includes("code_verifier"));
  const callback = new Request(
    laneConfig.callback + "?state=" + auth.searchParams.get("state") +
      "&code=private-code",
  );
  const success = await handler(callback);
  assertEquals(success.status, 302);
  assertEquals(
    success.headers.get("Location"),
    laneConfig.origin + "/#/settings?external_calendar=connected",
  );
  assert(!success.headers.get("Location")!.includes("private"));
  assertEquals(f.calls.filter((c) => c.action === "connect").length, 1);
  assertEquals(f.calls.find((c) => c.action === "connect")!.user, "user-one");
  const replay = await handler(callback);
  assertEquals(
    replay.headers.get("Location"),
    laneConfig.origin + "/#/settings?external_calendar=reconnect_required",
  );
  assertEquals(f.calls.filter((c) => c.action === "connect").length, 1);
});
Deno.test("OAuth denied consent does not exchange or attach credentials", async () => {
  const f = await fixture();
  const base = f.store.call;
  const deniedEnvelope = await cipher.seal(
    { verifier: "fixture" },
    "user-one:staging",
  );
  f.store.call = (action, user, lane, payload, signal) =>
    action === "consume_oauth"
      ? Promise.resolve({ user_id: "user-one", envelope: deniedEnvelope })
      : base(action, user, lane, payload, signal);
  let fetches = 0;
  const handler = createExternalCalendarHandler({
    store: f.store,
    config,
    google: new GoogleCalendar(
      (() => {
        fetches++;
        return Promise.resolve(fetchResponse({}));
      }) as typeof fetch,
    ),
  });
  const result = await handler(
    new Request(
      laneConfig.callback + "?state=staging.fixture&error=access_denied",
    ),
  );
  assertEquals(
    result.headers.get("Location"),
    laneConfig.origin + "/#/settings?external_calendar=denied",
  );
  assertEquals(fetches, 0);
  assertEquals(f.calls.length, 0);
});
Deno.test("expired access rotates encrypted credentials before import, preserving identity", async () => {
  const f = await fixture({
    expired: true,
    fetcher: ((input) =>
      Promise.resolve(
        String(input).includes("/token")
          ? fetchResponse({ access_token: "fresh", expires_in: 3600 })
          : String(input).includes("userinfo")
          ? fetchResponse({ sub: "google-sub-one" })
          : fetchResponse({ items: [event] }),
      )) as typeof fetch,
  });
  assertEquals(
    (await f.handler(request({ action: "refresh", ...window }))).status,
    200,
  );
  assertEquals(f.calls.map((x) => x.action), [
    "claim",
    "rotate_credentials",
    "apply",
    "status",
  ]);
  const stored = f.calls[1].payload.credentials as Json;
  assert(!JSON.stringify(stored).includes("test-refresh"));
  assertEquals(
    (await cipher.open<{ refresh_token: string }>(stored, "user-one:staging"))
      .refresh_token,
    "test-refresh",
  );
});
Deno.test("worker interleaves configured lanes and never exceeds two imports concurrently", async () => {
  const calls: string[] = [];
  let active = 0, peak = 0;
  const envelopes = {
    staging: await cipher.seal({
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3600000,
    }, "owner:staging"),
    production: await cipher.seal({
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3600000,
    }, "owner:production"),
  };
  const store: CalendarStore = {
    authenticate: () => Promise.resolve(null),
    call(action, _user, lane) {
      if (action === "due") {
        return Promise.resolve(
          Array.from({ length: 5 }, () => ({ user_id: "owner", lane })),
        );
      }
      if (action === "claim") {
        calls.push(lane);
        return Promise.resolve({
          id: "id",
          user_id: "owner",
          lane,
          provider_subject: "sub",
          generation: 1,
          lease_token: "lease",
          credentials: envelopes[lane],
          sources: [],
        });
      }
      if (action === "apply") return Promise.resolve({ changed: 0 });
      return Promise.resolve({});
    },
  };
  const google = new GoogleCalendar(
    (async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return fetchResponse({ sub: "sub" });
    }) as typeof fetch,
  );
  const handler = createExternalCalendarHandler({
    store,
    google,
    config: {
      ...config,
      lanes: {
        staging: laneConfig,
        production: { ...laneConfig, origin: "https://kemet.pages.dev" },
      },
    },
  });
  const result = await handler(
    new Request("https://backend.test/functions/v1/external_calendar/worker", {
      method: "POST",
      headers: { "x-external-calendar-secret": config.workerSecret },
      body: "{}",
    }),
  );
  assertEquals(result.status, 200);
  assertEquals((await result.json()).completed, 10);
  assertEquals(peak, 2);
  assertEquals(calls.slice(0, 2), ["staging", "production"]);
});
Deno.test("native OAuth return is state-bound to fixed app scheme and rejects arbitrary URLs", async () => {
  const f = await fixture();
  let pending: Json = {};
  const base = f.store.call;
  f.store.call = (action, user, lane, payload, signal) => {
    if (action === "create_oauth") {
      pending = payload;
      return Promise.resolve({});
    }
    if (action === "consume_oauth") {
      return Promise.resolve({
        user_id: "user-one",
        envelope: pending.envelope,
        expected_connection: null,
        expected_generation: null,
      });
    }
    return base(action, user, lane, payload, signal);
  };
  const handler = createExternalCalendarHandler({
    store: f.store,
    config,
    google: new GoogleCalendar(
      ((input) =>
        Promise.resolve(
          String(input).includes("/token")
            ? fetchResponse({
              access_token: "a",
              refresh_token: "r",
              expires_in: 3600,
              scope: SCOPES.join(" "),
            })
            : fetchResponse({ sub: "google-sub-one" }),
        )) as typeof fetch,
    ),
  });
  assertEquals(
    (await handler(
      request({ action: "connect", return_target: "https://malicious.test" }),
    )).status,
    400,
  );
  const connect = await handler(
    request({ action: "connect", return_target: "native" }),
  );
  const url = new URL((await connect.json()).authorization_url);
  const callback = await handler(
    new Request(
      laneConfig.callback + "?state=" + url.searchParams.get("state") +
        "&code=private-code&return_target=https://malicious.test",
    ),
  );
  assertEquals(
    callback.headers.get("Location"),
    "maat://calendar-import?lane=staging&result=connected",
  );
  assertEquals(callback.headers.get("Cache-Control"), "no-store");
});
Deno.test("oversized provider response is cancelled before JSON parsing or projection writes", async () => {
  let cancelled = false;
  const google = new GoogleCalendar(
    (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      )) as typeof fetch,
  );
  await assertRejects(
    () => google.sources("token", new Deadline()),
    CalendarError,
    "provider_response_limit",
  );
  assert(cancelled);
});
Deno.test("oversized event fields are rejected rather than silently truncated", () => {
  let rejected = false;
  try {
    projectEvent({ ...event, description: "a".repeat(20001) });
  } catch (e) {
    rejected = e instanceof CalendarError &&
      e.code === "provider_response_limit";
  }
  assert(rejected);
});
