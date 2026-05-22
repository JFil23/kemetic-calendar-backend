import type { AdminClient, StaffRow } from "./admin.ts";

type MockOptions = {
  user?: { id: string; email?: string | null } | null;
  authError?: unknown;
  staff?: StaffRow | null;
  staffError?: unknown;
  tables?: Record<string, Record<string, unknown>[]>;
};

function now() {
  return new Date().toISOString();
}

function withDefaults(row: Record<string, unknown>) {
  return {
    id: row.id ?? crypto.randomUUID(),
    created_at: row.created_at ?? now(),
    updated_at: row.updated_at ?? now(),
    ...row,
  };
}

export function createMockAdminClient(options: MockOptions = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    admin_audit_log: [],
    ...(options.tables ?? {}),
  };

  const client: AdminClient = {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({
          data: { user: options.user ?? null },
          error: options.authError ?? null,
        }),
    },
    from: (table: string) => ({
      select: (_columns?: string) => {
        if (table === "staff_members") {
          return {
            eq: (_column: string, _value: unknown) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: options.staff ?? null,
                  error: options.staffError ?? null,
                }),
            }),
          };
        }

        return Promise.resolve({
          data: [...(tables[table] ?? [])],
          error: null,
        });
      },
      insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(row) ? row : [row];
        const inserted = rows.map(withDefaults);
        tables[table] ??= [];
        tables[table].push(...inserted);

        return {
          select: (_columns?: string) => ({
            single: () =>
              Promise.resolve({
                data: inserted[0],
                error: null,
              }),
            maybeSingle: () =>
              Promise.resolve({
                data: inserted[0],
                error: null,
              }),
          }),
        };
      },
      update: (row: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => ({
          select: (_columns?: string) => ({
            single: () => {
              const rows = tables[table] ?? [];
              const index = rows.findIndex((item) => item[column] === value);
              if (index === -1) {
                return Promise.resolve({ data: null, error: "not_found" });
              }
              rows[index] = {
                ...rows[index],
                ...row,
                updated_at: now(),
              };
              return Promise.resolve({ data: rows[index], error: null });
            },
            maybeSingle: () => {
              const rows = tables[table] ?? [];
              const index = rows.findIndex((item) => item[column] === value);
              if (index === -1) {
                return Promise.resolve({ data: null, error: null });
              }
              rows[index] = {
                ...rows[index],
                ...row,
                updated_at: now(),
              };
              return Promise.resolve({ data: rows[index], error: null });
            },
          }),
        }),
      }),
    }),
  };

  return {
    client,
    tables,
    auditRows: tables.admin_audit_log,
  };
}

export function authedRequest(
  url: string,
  init: RequestInit = {},
  token = "valid-token",
) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
