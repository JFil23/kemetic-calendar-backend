// deno-lint-ignore-file no-import-prefix -- backend pinned URL convention.
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";
import { digest, scopes } from "./google.ts";

Deno.test("Google authorization is separate, state-bound, single-use and stores encrypted credentials", async () => {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "CALENDAR_IMPORT_ENCRYPTION_KEY",
  ];
  const previous = names.map((name) => Deno.env.get(name));
  const values = [
    "https://backend.example.test",
    "service-test-key",
    "public-test-key",
    "calendar-client",
    "calendar-secret",
    btoa("12345678901234567890123456789012"),
  ];
  names.forEach((name, i) => Deno.env.set(name, values[i]));
  const originalFetch = globalThis.fetch;
  let storedState: Record<string, string> | null = null;
  let savedCredentials = "";
  let consumed = false;
  let applied = false;
  let generation = "generation";
  const fakeFetch = (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: "owner",
        aud: "authenticated",
        email: "owner@example.test",
      });
    }
    if (url.pathname.endsWith("/rpc/calendar_import_control")) {
      return Response.json({
        id: "connection",
        generation,
        refresh_id: "refresh",
        connected: true,
        enabled: true,
      });
    }
    if (url.pathname.endsWith("/calendar_import_connections")) {
      if (init?.method === "PATCH") {
        if (body.generation) generation = body.generation;
        if (body.credentials) {
          savedCredentials = body.credentials;
          assertEquals(body.pending_initial_import, true);
          assertEquals(body.last_import_at, null);
          assertEquals(body.enabled, false);
        }
        return url.searchParams.has("select")
          ? Response.json([{ id: "connection" }])
          : new Response(null, { status: 204 });
      }
      return Response.json({ credentials: savedCredentials });
    }
    if (url.pathname.endsWith("/calendar_import_oauth_states")) {
      if (init?.method === "POST") {
        storedState = body;
        return new Response(null, { status: 201 });
      }
      if (url.searchParams.has("select")) {
        if (
          consumed || !storedState ||
          url.searchParams.get("state_hash") !==
            `eq.${storedState.state_hash}`
        ) return Response.json(null);
        consumed = true;
        return Response.json(storedState);
      }
      return new Response(null, { status: 204 });
    }
    if (url.host === "oauth2.googleapis.com") {
      assertEquals(init?.method, "POST");
      const form = init?.body as URLSearchParams;
      assertEquals(
        form.get("redirect_uri"),
        "https://backend.example.test/functions/v1/calendar_import",
      );
      return Response.json({
        access_token: "outside-access-token",
        refresh_token: "outside-refresh-token",
        expires_in: 3600,
        scope: scopes.join(" "),
      });
    }
    if (url.host === "www.googleapis.com") {
      return new Response("", { status: 500 });
    }
    if (url.pathname.endsWith("/rpc/calendar_import_apply")) {
      applied = true;
      return Response.json({ changed: 0 });
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  globalThis.fetch = (input, init) => Promise.resolve(fakeFetch(input, init));
  try {
    const headers = {
      Authorization: "Bearer haw-session",
      "Content-Type": "application/json",
      Origin: "https://kemet-rc.pages.dev",
    };
    const connect = await handler(
      new Request("https://backend.example.test/functions/v1/calendar_import", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "connect" }),
      }),
    );
    assertEquals(connect.status, 200);
    const url = new URL((await connect.json()).url);
    assertEquals(url.host, "accounts.google.com");
    assertEquals(url.searchParams.get("scope"), scopes.join(" "));
    assertEquals(url.searchParams.get("access_type"), "offline");
    const state = url.searchParams.get("state")!;
    assertNotEquals(storedState!.state_hash, state);
    assertEquals(storedState!.state_hash, await digest(state));
    const callback = await handler(
      new Request(
        `https://backend.example.test/functions/v1/calendar_import?state=${state}&code=one-time-code`,
      ),
    );
    assertEquals(callback.status, 303);
    assertEquals(
      callback.headers.get("location"),
      "https://kemet-rc.pages.dev/#/settings?calendar_import=connected",
    );
    assert(savedCredentials.length > 20);
    assert(!savedCredentials.includes("outside-refresh-token"));
    assertEquals(
      (await handler(
        new Request(
          `https://backend.example.test/functions/v1/calendar_import?state=${state}&code=one-time-code`,
        ),
      )).status,
      400,
    );
    const failed = await handler(
      new Request("https://backend.example.test/functions/v1/calendar_import", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "import",
          start: "2026-10-01",
          end: "2026-11-01",
          interactive: true,
        }),
      }),
    );
    assertEquals(failed.status, 503);
    assertEquals(applied, false);
    const rejected = await handler(
      new Request("https://backend.example.test/functions/v1/calendar_import", {
        method: "POST",
        headers: { ...headers, Origin: "https://unrelated.example" },
        body: "{}",
      }),
    );
    assertEquals(rejected.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) =>
      previous[i] === undefined
        ? Deno.env.delete(name)
        : Deno.env.set(name, previous[i]!)
    );
  }
});
