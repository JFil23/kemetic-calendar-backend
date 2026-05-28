import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createAdminAuthHandler } from "./index.ts";

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
}) {
  const auditRows: Record<string, unknown>[] = [];

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
  };

  return { client, auditRows };
}

function request(token?: string) {
  return new Request("https://example.test/functions/v1/admin_auth/me", {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

Deno.test("admin_auth returns staff context for active staff", async () => {
  const { client, auditRows } = createMockClient({
    user: { id: "user-1", email: "founder@example.com" },
    staff: {
      role: "owner",
      scopes: ["war_room.read", "settings.staff.read"],
      is_active: true,
    },
  });
  const handler = createAdminAuthHandler({ client, environment: "test" });

  const response = await handler(request("valid-token"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.user.id, "user-1");
  assertEquals(body.user.email, "f******@example.com");
  assertEquals(body.staff.role, "owner");
  assertEquals(body.staff.scopes, ["war_room.read", "settings.staff.read"]);
  assertEquals(auditRows.length, 1);
  assertEquals(auditRows[0].action, "admin_auth.access_granted");
});

Deno.test("admin_auth rejects non-staff users", async () => {
  const { client, auditRows } = createMockClient({
    user: { id: "user-2", email: "person@example.com" },
    staff: null,
  });
  const handler = createAdminAuthHandler({ client, environment: "test" });

  const response = await handler(request("valid-token"));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "staff_required");
  assertEquals(auditRows.length, 1);
  assertEquals(auditRows[0].action, "admin_auth.denied");
  assertEquals(
    (auditRows[0].metadata as { reason: string }).reason,
    "not_staff",
  );
});

Deno.test("admin_auth rejects inactive staff", async () => {
  const { client, auditRows } = createMockClient({
    user: { id: "user-3", email: "operator@example.com" },
    staff: {
      role: "operator",
      scopes: ["war_room.read"],
      is_active: false,
    },
  });
  const handler = createAdminAuthHandler({ client, environment: "test" });

  const response = await handler(request("valid-token"));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "staff_inactive");
  assertEquals(auditRows.length, 1);
  assertEquals(auditRows[0].actor_role, "operator");
  assertEquals(
    (auditRows[0].metadata as { reason: string }).reason,
    "inactive_staff",
  );
});

Deno.test("admin_auth rejects missing token", async () => {
  const { client, auditRows } = createMockClient({
    user: { id: "user-4", email: "founder@example.com" },
    staff: {
      role: "owner",
      scopes: [],
      is_active: true,
    },
  });
  const handler = createAdminAuthHandler({ client, environment: "test" });

  const response = await handler(request());
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "auth_required");
  assertEquals(auditRows.length, 1);
  assertEquals(
    (auditRows[0].metadata as { reason: string }).reason,
    "missing_token",
  );
});
