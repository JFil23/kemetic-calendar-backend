// deno-lint-ignore-file no-explicit-any

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createTrackChoiceEventHandler } from "./index.ts";

const authenticatedUserId = "00000000-0000-4000-8000-000000000013";
const attackerUserId = "00000000-0000-4000-8000-000000000099";
const reflectionId = "00000000-0000-4000-8000-000000001313";
const nodeId = "00000000-0000-4000-8000-000000001314";

function createMockClient(options?: {
  user?: { id: string } | null;
  authError?: unknown;
  nodeId?: string | null;
  insertError?: { message: string } | null;
}) {
  const authTokens: string[] = [];
  const nodeSlugs: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const client = {
    auth: {
      getUser: (token: string) => {
        authTokens.push(token);
        return Promise.resolve({
          data: {
            user: options?.user === undefined
              ? { id: authenticatedUserId }
              : options.user,
          },
          error: options?.authError ?? null,
        });
      },
    },
    from: (table: string) => {
      if (table === "nodes") {
        return {
          select: (_columns: string) => ({
            eq: (_column: string, slug: string) => {
              nodeSlugs.push(slug);
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: options?.nodeId === null
                      ? null
                      : { id: options?.nodeId ?? nodeId },
                    error: null,
                  }),
              };
            },
          }),
        };
      }
      if (table === "user_choice_events") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return Promise.resolve({ error: options?.insertError ?? null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return Object.assign(client, { authTokens, nodeSlugs, inserts });
}

function request(body: Record<string, unknown>, token = "user-jwt") {
  return new Request("http://localhost/track_choice_event", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function assertCors(response: Response) {
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertStringIncludes(
    response.headers.get("Access-Control-Allow-Methods") ?? "",
    "POST",
  );
  assertStringIncludes(
    response.headers.get("Access-Control-Allow-Methods") ?? "",
    "OPTIONS",
  );
}

Deno.test("track_choice_event handles browser preflight without authentication", async () => {
  const client = createMockClient();
  const response = await createTrackChoiceEventHandler({ client })(
    new Request("http://localhost/track_choice_event", { method: "OPTIONS" }),
  );

  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
  assertCors(response);
  assertEquals(client.authTokens, []);
  assertEquals(client.inserts, []);
});

Deno.test("track_choice_event accepts POST only", async () => {
  const client = createMockClient();
  const response = await createTrackChoiceEventHandler({ client })(
    new Request("http://localhost/track_choice_event", { method: "GET" }),
  );

  assertEquals(response.status, 405);
  assertEquals((await response.json()).error, "Method not allowed");
  assertCors(response);
  assertEquals(client.inserts, []);
});

Deno.test("track_choice_event rejects unauthenticated and invalid-token requests", async () => {
  const missingAuthClient = createMockClient();
  const missingAuthResponse = await createTrackChoiceEventHandler({
    client: missingAuthClient,
  })(
    new Request("http://localhost/track_choice_event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  assertEquals(missingAuthResponse.status, 401);
  assertEquals(missingAuthClient.authTokens, []);

  const invalidAuthClient = createMockClient({
    user: null,
    authError: new Error("invalid token"),
  });
  const invalidAuthResponse = await createTrackChoiceEventHandler({
    client: invalidAuthClient,
  })(request({ event_type: "reflection_opened" }, "invalid-jwt"));
  assertEquals(invalidAuthResponse.status, 401);
  assertEquals(invalidAuthClient.authTokens, ["invalid-jwt"]);
  assertEquals(invalidAuthClient.inserts, []);
});

Deno.test("track_choice_event rejects an invalid event type", async () => {
  const client = createMockClient();
  const response = await createTrackChoiceEventHandler({ client })(
    request({ event_type: "reflection_invented" }),
  );

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "Invalid event_type");
  assertEquals(client.inserts, []);
});

Deno.test("track_choice_event records reflection_opened with the authenticated user", async () => {
  const client = createMockClient();
  const response = await createTrackChoiceEventHandler({ client })(request({
    event_type: "reflection_opened",
    reflection_entry_id: reflectionId,
    metadata: {
      user_id: attackerUserId,
      source_surface: "decan_reflection_detail",
      decan_start: "2026-09-16",
      decan_end: "2026-09-25",
      decan_name: "Cut 13",
    },
  }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true });
  assertEquals(client.authTokens, ["user-jwt"]);
  assertEquals(client.inserts, [{
    user_id: authenticatedUserId,
    event_type: "reflection_opened",
    node_id: null,
    flow_id: null,
    journal_entry_id: null,
    reflection_entry_id: reflectionId,
    metadata: {
      user_id: attackerUserId,
      source_surface: "decan_reflection_detail",
      decan_start: "2026-09-16",
      decan_end: "2026-09-25",
      decan_name: "Cut 13",
    },
  }]);
});

Deno.test("track_choice_event resolves reflection node slugs and preserves metadata", async () => {
  const client = createMockClient();
  const response = await createTrackChoiceEventHandler({ client })(request({
    event_type: "reflection_linked_to_node",
    node_slug: "maat",
    reflection_entry_id: reflectionId,
    metadata: {
      source_surface: "decan_reflection_library_continuation",
      reason: "From this reflection",
    },
  }));

  assertEquals(response.status, 200);
  assertEquals(client.nodeSlugs, ["maat"]);
  assertEquals(client.inserts[0], {
    user_id: authenticatedUserId,
    event_type: "reflection_linked_to_node",
    node_id: nodeId,
    flow_id: null,
    journal_entry_id: null,
    reflection_entry_id: reflectionId,
    metadata: {
      source_surface: "decan_reflection_library_continuation",
      reason: "From this reflection",
    },
  });
});

Deno.test("track_choice_event keeps generic node_link_tapped allowed", async () => {
  const client = createMockClient();
  const response = await createTrackChoiceEventHandler({ client })(request({
    event_type: "node_link_tapped",
    node_slug: "maat",
    reflection_entry_id: reflectionId,
    metadata: { source_surface: "decan_reflection_library_continuation" },
  }));

  assertEquals(response.status, 200);
  assertEquals(client.inserts[0].event_type, "node_link_tapped");
  assertEquals(client.inserts[0].node_id, nodeId);
});
