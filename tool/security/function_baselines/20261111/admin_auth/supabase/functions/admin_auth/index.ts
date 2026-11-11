// Edge Function: admin_auth
// Staff gate for the private ḥꜣw Admin / Operator Console.

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

type AdminAuthClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: AdminUser | null };
      error: unknown | null;
    }>;
  };
  from: (table: string) => {
    select?: (columns?: string) => unknown;
    eq?: (column: string, value: unknown) => unknown;
    maybeSingle?: () => QueryResult<StaffRow>;
    insert?: (row: Record<string, unknown>) => Promise<{
      data: unknown | null;
      error: unknown | null;
    }>;
  };
};

type HandlerDeps = {
  client: AdminAuthClient;
  environment?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENVIRONMENT = Deno.env.get("HAW_ADMIN_ENV") ??
  Deno.env.get("SUPABASE_ENV") ??
  "unknown";

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

function requestIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
}

function maskEmail(email?: string | null) {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

function serializeError(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
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
      resource_type: "admin_auth",
      resource_id: "me",
      risk_level: event.riskLevel ?? "low",
      metadata: event.metadata ?? {},
      ip: requestIp(req),
      user_agent: req.headers.get("user-agent"),
      request_id: req.headers.get("x-request-id"),
      environment: deps.environment ?? ENVIRONMENT,
    });
  } catch (error) {
    console.error("admin_auth audit write failed", serializeError(error));
  }
}

async function getStaff(client: AdminAuthClient, userId: string) {
  const query = client
    .from("staff_members")
    .select?.("role,scopes,is_active") as {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => QueryResult<StaffRow>;
      };
    };

  return await query.eq("user_id", userId).maybeSingle();
}

export function createAdminAuthHandler(deps: HandlerDeps) {
  return async function adminAuthHandler(req: Request): Promise<Response> {
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

    const token = extractToken(req);
    if (!token) {
      await writeAudit(req, deps, {
        action: "admin_auth.denied",
        riskLevel: "medium",
        metadata: { reason: "missing_token" },
      });
      return jsonResponse(req, { error: "auth_required" }, { status: 401 });
    }

    const { data: authData, error: authError } = await deps.client.auth.getUser(
      token,
    );
    const user = authData?.user ?? null;

    if (authError || !user) {
      await writeAudit(req, deps, {
        action: "admin_auth.denied",
        riskLevel: "medium",
        metadata: {
          reason: "invalid_session",
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
        action: "admin_auth.denied",
        riskLevel: "medium",
        metadata: {
          reason: "staff_lookup_failed",
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
        action: "admin_auth.denied",
        riskLevel: "medium",
        metadata: { reason: "not_staff" },
      });
      return jsonResponse(req, { error: "staff_required" }, { status: 403 });
    }

    if (!staff.is_active) {
      await writeAudit(req, deps, {
        actorUserId: user.id,
        actorRole: staff.role,
        action: "admin_auth.denied",
        riskLevel: "medium",
        metadata: { reason: "inactive_staff" },
      });
      return jsonResponse(req, { error: "staff_inactive" }, { status: 403 });
    }

    await writeAudit(req, deps, {
      actorUserId: user.id,
      actorRole: staff.role,
      action: "admin_auth.access_granted",
      riskLevel: "low",
      metadata: { endpoint: "/me" },
    });

    return jsonResponse(req, {
      user: {
        id: user.id,
        email: maskEmail(user.email),
      },
      staff: {
        role: staff.role,
        scopes: staff.scopes ?? [],
      },
    });
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
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as AdminAuthClient;

    serve(createAdminAuthHandler({
      client: adminClient,
      environment: ENVIRONMENT,
    }));
  }
}
