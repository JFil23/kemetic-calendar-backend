import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createAdminWarRoomHandler } from "./index.ts";

type StaffRow = {
  role: string;
  scopes: string[];
  is_active: boolean;
};

function createMockClient(options: {
  user?: { id: string; email?: string | null } | null;
  authError?: unknown;
  staff?: StaffRow | null;
  staffError?: unknown;
  rpcError?: unknown;
  rpcData?: unknown;
}) {
  const auditRows: Record<string, unknown>[] = [];
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];

  const client = {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({
          data: { user: options.user ?? null },
          error: options.authError ?? null,
        }),
    },
    from: (table: string) => {
      if (table === "admin_audit_log") {
        return {
          insert: (row: Record<string, unknown>) => {
            auditRows.push(row);
            return Promise.resolve({ data: row, error: null });
          },
        };
      }

      if (table === "staff_members") {
        return {
          select: (_columns?: string) => ({
            eq: (_column: string, _value: unknown) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: options.staff ?? null,
                  error: options.staffError ?? null,
                }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: options.rpcData ?? { period_days: args?.p_days ?? 7 },
        error: options.rpcError ?? null,
      });
    },
  };

  return { client, auditRows, rpcCalls };
}

function request(token?: string, days = 7) {
  return new Request(
    `https://example.test/functions/v1/admin_war_room?days=${days}`,
    {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
  );
}

Deno.test("admin_war_room returns summary for active staff with war_room.read", async () => {
  const { client, auditRows, rpcCalls } = createMockClient({
    user: { id: "user-1", email: "founder@example.com" },
    staff: {
      role: "operator",
      scopes: ["war_room.read"],
      is_active: true,
    },
    rpcData: { period_days: 30, users: { active_period: 12 } },
  });
  const handler = createAdminWarRoomHandler({ client, environment: "test" });

  const response = await handler(request("valid-token", 30));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.period_days, 30);
  assertEquals(body.users.active_period, 12);
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, "admin_war_room_summary");
  assertEquals(rpcCalls[0].args, { p_days: 30 });
  assertEquals(auditRows.at(-1)?.action, "war_room.view");
});

Deno.test("admin_war_room allows owner without explicit scope", async () => {
  const { client, rpcCalls } = createMockClient({
    user: { id: "owner-1", email: "founder@example.com" },
    staff: {
      role: "owner",
      scopes: [],
      is_active: true,
    },
  });
  const handler = createAdminWarRoomHandler({ client, environment: "test" });

  const response = await handler(request("valid-token"));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls.length, 1);
});

Deno.test("admin_war_room rejects non-staff users", async () => {
  const { client, auditRows, rpcCalls } = createMockClient({
    user: { id: "user-2", email: "person@example.com" },
    staff: null,
  });
  const handler = createAdminWarRoomHandler({ client, environment: "test" });

  const response = await handler(request("valid-token"));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "staff_required");
  assertEquals(rpcCalls.length, 0);
  assertEquals(auditRows[0].action, "war_room.denied");
  assertEquals(
    (auditRows[0].metadata as { reason: string }).reason,
    "not_staff",
  );
});

Deno.test("admin_war_room rejects inactive staff", async () => {
  const { client, auditRows, rpcCalls } = createMockClient({
    user: { id: "user-3", email: "operator@example.com" },
    staff: {
      role: "operator",
      scopes: ["war_room.read"],
      is_active: false,
    },
  });
  const handler = createAdminWarRoomHandler({ client, environment: "test" });

  const response = await handler(request("valid-token"));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "staff_inactive");
  assertEquals(rpcCalls.length, 0);
  assertEquals(auditRows[0].actor_role, "operator");
});

Deno.test("admin_war_room rejects staff missing war_room.read", async () => {
  const { client, auditRows, rpcCalls } = createMockClient({
    user: { id: "user-4", email: "support@example.com" },
    staff: {
      role: "support",
      scopes: ["product.users.support"],
      is_active: true,
    },
  });
  const handler = createAdminWarRoomHandler({ client, environment: "test" });

  const response = await handler(request("valid-token"));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "missing_scope");
  assertEquals(rpcCalls.length, 0);
  assertEquals(
    (auditRows[0].metadata as { reason: string }).reason,
    "missing_scope",
  );
});

Deno.test("admin_war_room rejects missing token", async () => {
  const { client, auditRows, rpcCalls } = createMockClient({
    user: { id: "user-5", email: "founder@example.com" },
    staff: {
      role: "owner",
      scopes: [],
      is_active: true,
    },
  });
  const handler = createAdminWarRoomHandler({ client, environment: "test" });

  const response = await handler(request());
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "auth_required");
  assertEquals(rpcCalls.length, 0);
  assertEquals(
    (auditRows[0].metadata as { reason: string }).reason,
    "missing_token",
  );
});
