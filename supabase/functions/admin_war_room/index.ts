// Edge Function: admin_war_room
// Read-only War Room aggregate endpoint for the private admin console.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type AdminUser = {
  id: string;
  email?: string | null;
};

type StaffRow = {
  role: string;
  scopes: string[] | null;
  is_active: boolean;
};

type QueryResult<T> = Promise<{ data: T | null; error: unknown | null }>;

type AdminWarRoomClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: AdminUser | null };
      error: unknown | null;
    }>;
  };
  from: (table: string) => {
    select?: (columns?: string) => unknown;
    insert?: (row: Record<string, unknown>) => Promise<{
      data: unknown | null;
      error: unknown | null;
    }>;
  };
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown | null; error: unknown | null }>;
};

type HandlerDeps = {
  client: AdminWarRoomClient;
  rpcClient?: (token: string) => AdminWarRoomClient;
  environment?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENVIRONMENT = Deno.env.get("HAW_ADMIN_ENV") ??
  Deno.env.get("SUPABASE_ENV") ??
  "unknown";
const REQUIRED_SCOPE = "war_room.read";
const VALID_DAYS = new Set([7, 30, 90]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-request-id",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
      ...(init?.headers ?? {}),
    },
  });
}

function extractToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function parseDays(req: Request) {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("days") ?? "7");
  return VALID_DAYS.has(raw) ? raw : 7;
}

function requestIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
}

function serializeError(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

function hasScope(staff: StaffRow, scope: string) {
  return staff.is_active &&
    (staff.role === "owner" || (staff.scopes ?? []).includes(scope));
}

async function writeAudit(
  req: Request,
  deps: HandlerDeps,
  event: {
    actorUserId?: string | null;
    actorRole?: string | null;
    action: string;
    riskLevel?: "low" | "medium" | "high" | "restricted";
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await deps.client.from("admin_audit_log").insert?.({
      actor_user_id: event.actorUserId ?? null,
      actor_role: event.actorRole ?? null,
      action: event.action,
      resource_type: "war_room",
      resource_id: "dashboard",
      risk_level: event.riskLevel ?? "low",
      metadata: event.metadata ?? {},
      ip: requestIp(req),
      user_agent: req.headers.get("user-agent"),
      request_id: req.headers.get("x-request-id"),
      environment: deps.environment ?? ENVIRONMENT,
    });
  } catch (error) {
    console.error("admin_war_room audit write failed", serializeError(error));
  }
}

async function getStaff(client: AdminWarRoomClient, userId: string) {
  const query = client
    .from("staff_members")
    .select?.("role,scopes,is_active") as {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => QueryResult<StaffRow>;
      };
    };

  return await query.eq("user_id", userId).maybeSingle();
}

export function createAdminWarRoomHandler(deps: HandlerDeps) {
  return async function adminWarRoomHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method !== "GET") {
      return jsonResponse(req, { error: "method_not_allowed" }, {
        status: 405,
      });
    }

    const days = parseDays(req);
    const token = extractToken(req);
    if (!token) {
      await writeAudit(req, deps, {
        action: "war_room.denied",
        riskLevel: "medium",
        metadata: { reason: "missing_token", days },
      });
      return jsonResponse(req, { error: "auth_required" }, { status: 401 });
    }

    const { data: authData, error: authError } = await deps.client.auth.getUser(
      token,
    );
    const user = authData?.user ?? null;

    if (authError || !user) {
      await writeAudit(req, deps, {
        action: "war_room.denied",
        riskLevel: "medium",
        metadata: {
          reason: "invalid_session",
          days,
          auth_error: serializeError(authError),
        },
      });
      return jsonResponse(req, { error: "invalid_session" }, { status: 401 });
    }

    const { data: staff, error: staffError } = await getStaff(
      deps.client,
      user.id,
    );

    if (staffError) {
      await writeAudit(req, deps, {
        actorUserId: user.id,
        action: "war_room.denied",
        riskLevel: "medium",
        metadata: {
          reason: "staff_lookup_failed",
          days,
          staff_error: serializeError(staffError),
        },
      });
      return jsonResponse(req, { error: "staff_lookup_failed" }, {
        status: 500,
      });
    }

    if (!staff) {
      await writeAudit(req, deps, {
        actorUserId: user.id,
        action: "war_room.denied",
        riskLevel: "medium",
        metadata: { reason: "not_staff", days },
      });
      return jsonResponse(req, { error: "staff_required" }, { status: 403 });
    }

    if (!staff.is_active) {
      await writeAudit(req, deps, {
        actorUserId: user.id,
        actorRole: staff.role,
        action: "war_room.denied",
        riskLevel: "medium",
        metadata: { reason: "inactive_staff", days },
      });
      return jsonResponse(req, { error: "staff_inactive" }, { status: 403 });
    }

    if (!hasScope(staff, REQUIRED_SCOPE)) {
      await writeAudit(req, deps, {
        actorUserId: user.id,
        actorRole: staff.role,
        action: "war_room.denied",
        riskLevel: "medium",
        metadata: { reason: "missing_scope", scope: REQUIRED_SCOPE, days },
      });
      return jsonResponse(req, { error: "missing_scope" }, { status: 403 });
    }

    const rpcClient = deps.rpcClient?.(token) ?? deps.client;
    const { data, error } = await rpcClient.rpc("admin_war_room_summary", {
      p_days: days,
    });

    if (error) {
      await writeAudit(req, deps, {
        actorUserId: user.id,
        actorRole: staff.role,
        action: "war_room.failed",
        riskLevel: "medium",
        metadata: {
          reason: "rpc_failed",
          days,
          rpc_error: serializeError(error),
        },
      });
      return jsonResponse(req, { error: "war_room_summary_failed" }, {
        status: 500,
      });
    }

    await writeAudit(req, deps, {
      actorUserId: user.id,
      actorRole: staff.role,
      action: "war_room.view",
      riskLevel: "low",
      metadata: { days },
    });

    return jsonResponse(req, data ?? {});
  };
}

if (import.meta.main) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    serve((req) =>
      req.method === "OPTIONS"
        ? new Response("ok", {
          headers: corsHeaders(req.headers.get("origin")),
        })
        : jsonResponse(req, { error: "server_not_configured" }, {
          status: 500,
        })
    );
  } else {
    const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as AdminWarRoomClient;

    serve(createAdminWarRoomHandler({
      client: serviceClient,
      rpcClient: (token: string) =>
        createClient(SUPABASE_URL, SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        }) as unknown as AdminWarRoomClient,
      environment: ENVIRONMENT,
    }));
  }
}
