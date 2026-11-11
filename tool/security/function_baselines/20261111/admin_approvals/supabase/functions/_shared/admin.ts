import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

export type AdminUser = {
  id: string;
  email?: string | null;
};

export type StaffRow = {
  role: string;
  scopes: string[] | null;
  is_active: boolean;
};

export type QueryResult<T> = Promise<{ data: T | null; error: unknown | null }>;

export type AdminClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: AdminUser | null };
      error: unknown | null;
    }>;
  };
  from: (table: string) => {
    select?: (columns?: string) => unknown;
    insert?: (
      row: Record<string, unknown> | Record<string, unknown>[],
    ) => unknown;
    update?: (row: Record<string, unknown>) => unknown;
  };
  rpc?: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown | null; error: unknown | null }>;
};

export type HandlerDeps = {
  client: AdminClient;
  environment?: string;
};

export type AdminContext = {
  token: string;
  user: AdminUser;
  staff: StaffRow;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENVIRONMENT = Deno.env.get("HAW_ADMIN_ENV") ??
  Deno.env.get("SUPABASE_ENV") ??
  "unknown";

export function createServiceClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;

  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as AdminClient;
}

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-request-id",
    "Vary": "Origin",
  };
}

export function jsonResponse(req: Request, body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
      ...(init?.headers ?? {}),
    },
  });
}

export function serverNotConfiguredResponse(req: Request) {
  return req.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders(req.headers.get("origin")) })
    : jsonResponse(req, { error: "server_not_configured" }, { status: 500 });
}

export function extractToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function requestIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
}

export function serializeError(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export function hasScope(staff: StaffRow, scope: string) {
  return staff.is_active &&
    (staff.role === "owner" || (staff.scopes ?? []).includes(scope));
}

export async function writeAudit(
  req: Request,
  deps: HandlerDeps,
  event: {
    actorUserId?: string | null;
    actorRole?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    riskLevel?: "low" | "medium" | "high" | "restricted";
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await insertRow(deps.client, "admin_audit_log", {
      actor_user_id: event.actorUserId ?? null,
      actor_role: event.actorRole ?? null,
      action: event.action,
      resource_type: event.resourceType ?? null,
      resource_id: event.resourceId ?? null,
      risk_level: event.riskLevel ?? "low",
      metadata: event.metadata ?? {},
      ip: requestIp(req),
      user_agent: req.headers.get("user-agent"),
      request_id: req.headers.get("x-request-id"),
      environment: deps.environment ?? ENVIRONMENT,
    });
  } catch (error) {
    console.error("admin audit write failed", serializeError(error));
  }
}

async function getStaff(client: AdminClient, userId: string) {
  const query = client
    .from("staff_members")
    .select?.("role,scopes,is_active") as {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => QueryResult<StaffRow>;
      };
    };

  return await query.eq("user_id", userId).maybeSingle();
}

export async function requireAdmin(
  req: Request,
  deps: HandlerDeps,
  options: {
    scope: string;
    deniedAction: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; response: Response }
> {
  const token = extractToken(req);
  if (!token) {
    await writeAudit(req, deps, {
      action: options.deniedAction,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      riskLevel: "medium",
      metadata: { reason: "missing_token", ...(options.metadata ?? {}) },
    });
    return {
      ok: false,
      response: jsonResponse(req, { error: "auth_required" }, { status: 401 }),
    };
  }

  const { data: authData, error: authError } = await deps.client.auth.getUser(
    token,
  );
  const user = authData?.user ?? null;

  if (authError || !user) {
    await writeAudit(req, deps, {
      action: options.deniedAction,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      riskLevel: "medium",
      metadata: {
        reason: "invalid_session",
        auth_error: serializeError(authError),
        ...(options.metadata ?? {}),
      },
    });
    return {
      ok: false,
      response: jsonResponse(req, { error: "invalid_session" }, {
        status: 401,
      }),
    };
  }

  const { data: staff, error: staffError } = await getStaff(
    deps.client,
    user.id,
  );

  if (staffError) {
    await writeAudit(req, deps, {
      actorUserId: user.id,
      action: options.deniedAction,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      riskLevel: "medium",
      metadata: {
        reason: "staff_lookup_failed",
        staff_error: serializeError(staffError),
        ...(options.metadata ?? {}),
      },
    });
    return {
      ok: false,
      response: jsonResponse(req, { error: "staff_lookup_failed" }, {
        status: 500,
      }),
    };
  }

  if (!staff) {
    await writeAudit(req, deps, {
      actorUserId: user.id,
      action: options.deniedAction,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      riskLevel: "medium",
      metadata: { reason: "not_staff", ...(options.metadata ?? {}) },
    });
    return {
      ok: false,
      response: jsonResponse(req, { error: "staff_required" }, { status: 403 }),
    };
  }

  if (!staff.is_active) {
    await writeAudit(req, deps, {
      actorUserId: user.id,
      actorRole: staff.role,
      action: options.deniedAction,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      riskLevel: "medium",
      metadata: { reason: "inactive_staff", ...(options.metadata ?? {}) },
    });
    return {
      ok: false,
      response: jsonResponse(req, { error: "staff_inactive" }, { status: 403 }),
    };
  }

  if (!hasScope(staff, options.scope)) {
    await writeAudit(req, deps, {
      actorUserId: user.id,
      actorRole: staff.role,
      action: options.deniedAction,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      riskLevel: "medium",
      metadata: {
        reason: "missing_scope",
        scope: options.scope,
        ...(options.metadata ?? {}),
      },
    });
    return {
      ok: false,
      response: jsonResponse(req, { error: "missing_scope" }, { status: 403 }),
    };
  }

  return { ok: true, context: { token, user, staff } };
}

export async function readJsonBody(req: Request) {
  try {
    return await req.json();
  } catch (_error) {
    return null;
  }
}

function hasThen(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as PromiseLike<unknown>).then === "function";
}

export async function selectRows<T>(
  client: AdminClient,
  table: string,
  columns = "*",
): QueryResult<T[]> {
  const selected = client.from(table).select?.(columns);
  if (!selected) return { data: null, error: "select_not_supported" };
  const result = hasThen(selected) ? await selected : await selected;
  return result as { data: T[] | null; error: unknown | null };
}

export async function insertRow<T>(
  client: AdminClient,
  table: string,
  row: Record<string, unknown>,
): QueryResult<T> {
  const inserted = client.from(table).insert?.(row);
  if (!inserted) return { data: null, error: "insert_not_supported" };

  const chain = inserted as {
    select?: (columns?: string) => {
      single?: () => QueryResult<T>;
      maybeSingle?: () => QueryResult<T>;
    };
  };
  const selected = chain.select?.("*");
  if (selected?.maybeSingle) return await selected.maybeSingle();
  if (selected?.single) return await selected.single();

  if (hasThen(inserted)) {
    return await inserted as { data: T | null; error: unknown | null };
  }
  return { data: null, error: null };
}

export async function updateRow<T>(
  client: AdminClient,
  table: string,
  id: string,
  row: Record<string, unknown>,
): QueryResult<T> {
  const updated = client.from(table).update?.(row);
  if (!updated) return { data: null, error: "update_not_supported" };

  const chain = updated as {
    eq?: (column: string, value: unknown) => {
      select?: (columns?: string) => {
        single?: () => QueryResult<T>;
        maybeSingle?: () => QueryResult<T>;
      };
    };
  };
  const eqResult = chain.eq?.("id", id);
  const selected = eqResult?.select?.("*");
  if (selected?.maybeSingle) return await selected.maybeSingle();
  if (selected?.single) return await selected.single();

  if (hasThen(updated)) {
    return await updated as { data: T | null; error: unknown | null };
  }
  return { data: null, error: null };
}

export function clampText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function toStringArray(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}
