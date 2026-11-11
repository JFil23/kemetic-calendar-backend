// deno-lint-ignore-file no-import-prefix

// Edge Function: admin_activity
// Staff-gated per-user activity ledger. Returns canonical, privacy-filtered
// telemetry projections only; raw app_events.properties never leave the SQL RPC.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

import {
  type AdminClient,
  corsHeaders,
  createServiceClient,
  type HandlerDeps,
  jsonResponse,
  requireAdmin,
  serializeError,
  serverNotConfiguredResponse,
  writeAudit,
} from "../_shared/admin.ts";

type AdminActivityDeps = HandlerDeps & {
  rpcClient?: (token: string) => AdminClient;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const REQUIRED_SCOPE = "product.users.read";
const VALID_DAYS = new Set([7, 30, 90]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDays(url: URL) {
  const raw = Number(url.searchParams.get("days") ?? "7");
  return VALID_DAYS.has(raw) ? raw : 7;
}

function parseLimit(url: URL) {
  const raw = Number(url.searchParams.get("limit") ?? "100");
  if (!Number.isFinite(raw)) return 100;
  return Math.min(Math.max(Math.trunc(raw), 1), 250);
}

function parseQuery(url: URL) {
  const q = url.searchParams.get("q")?.trim() ?? "";
  return q ? q.slice(0, 120) : undefined;
}

function parseTargetUserId(url: URL) {
  const raw = url.searchParams.get("target_user_id")?.trim() ??
    url.searchParams.get("user_id")?.trim() ?? "";
  return raw || null;
}

function isMissingUser(payload: unknown) {
  return !!payload && typeof payload === "object" &&
    (payload as { error?: unknown }).error === "user_not_found";
}

export function createAdminActivityHandler(deps: AdminActivityDeps) {
  return async function adminActivityHandler(req: Request): Promise<Response> {
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

    const url = new URL(req.url);
    const days = parseDays(url);
    const limit = parseLimit(url);
    const q = parseQuery(url);
    const targetUserId = parseTargetUserId(url);

    const auth = await requireAdmin(req, deps, {
      scope: REQUIRED_SCOPE,
      deniedAction: "activity.denied",
      resourceType: "user_activity",
      resourceId: targetUserId ?? "users",
      metadata: {
        days,
        mode: targetUserId ? "detail" : "list",
        target_user_id: targetUserId ?? undefined,
      },
    });
    if (auth.ok === false) return auth.response;

    if (targetUserId && !UUID_RE.test(targetUserId)) {
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "activity.denied",
        resourceType: "user_activity",
        resourceId: targetUserId,
        riskLevel: "medium",
        metadata: { reason: "invalid_target_user_id", days },
      });
      return jsonResponse(req, { error: "invalid_target_user_id" }, {
        status: 400,
      });
    }

    const rpcClient = deps.rpcClient?.(auth.context.token) ?? deps.client;
    if (!rpcClient.rpc) {
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "activity.failed",
        resourceType: "user_activity",
        resourceId: targetUserId ?? "users",
        riskLevel: "medium",
        metadata: { reason: "rpc_not_supported", days },
      });
      return jsonResponse(req, { error: "rpc_not_supported" }, {
        status: 500,
      });
    }

    const fn = targetUserId
      ? "admin_activity_user_detail"
      : "admin_activity_users";
    const args = targetUserId
      ? { p_target_user_id: targetUserId, p_days: days }
      : { p_days: days, p_limit: limit, p_query: q };

    const { data, error } = await rpcClient.rpc(fn, args);
    if (error) {
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "activity.failed",
        resourceType: "user_activity",
        resourceId: targetUserId ?? "users",
        riskLevel: "medium",
        metadata: {
          reason: "rpc_failed",
          rpc: fn,
          days,
          rpc_error: serializeError(error),
        },
      });
      return jsonResponse(req, { error: "activity_failed" }, { status: 500 });
    }

    if (isMissingUser(data)) {
      await writeAudit(req, deps, {
        actorUserId: auth.context.user.id,
        actorRole: auth.context.staff.role,
        action: "activity.failed",
        resourceType: "user_activity",
        resourceId: targetUserId,
        riskLevel: "low",
        metadata: { reason: "user_not_found", days },
      });
      return jsonResponse(req, { error: "user_not_found" }, { status: 404 });
    }

    await writeAudit(req, deps, {
      actorUserId: auth.context.user.id,
      actorRole: auth.context.staff.role,
      action: targetUserId ? "activity.user_node_opened" : "activity.list",
      resourceType: "user_activity",
      resourceId: targetUserId ?? "users",
      riskLevel: "low",
      metadata: targetUserId
        ? { days, target_user_id: targetUserId }
        : { days, limit, q },
    });

    return jsonResponse(req, data ?? {});
  };
}

if (import.meta.main) {
  const serviceClient = createServiceClient();
  if (!serviceClient || !SUPABASE_URL || !SERVICE_KEY) {
    serve(serverNotConfiguredResponse);
  } else {
    serve(createAdminActivityHandler({
      client: serviceClient,
      rpcClient: (token: string) =>
        createClient(SUPABASE_URL, SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        }) as unknown as AdminClient,
    }));
  }
}
