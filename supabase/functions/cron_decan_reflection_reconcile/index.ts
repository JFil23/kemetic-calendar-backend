// deno-lint-ignore-file no-import-prefix

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { listActiveMaatUserIds } from "../_shared/maat_active_users.ts";
import {
  reconcileDecanReflectionSchedules,
} from "../_shared/decan_reflection_reconcile.ts";

type ClientLike = {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDefaultClient(): ClientLike {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Missing Supabase service credentials");
  return createClient(url, key) as unknown as ClientLike;
}

export function createCronDecanReflectionReconcileHandler(options?: {
  client?: ClientLike;
  cronSecret?: string;
  now?: () => Date;
  listActiveUserIds?: (now: Date) => Promise<string[]>;
}) {
  const client = options?.client ?? createDefaultClient();
  const cronSecret = options?.cronSecret ??
    Deno.env.get("DECAN_REFLECTION_CRON_SECRET") ??
    Deno.env.get("CRON_SECRET") ?? "";
  const nowFn = options?.now ?? (() => new Date());
  const listUsers = options?.listActiveUserIds ??
    ((now: Date) => listActiveMaatUserIds(client, now));

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    }
    if (!cronSecret) {
      return jsonResponse({
        success: false,
        error: "DECAN_REFLECTION_CRON_SECRET not configured",
      }, 500);
    }
    if (req.headers.get("x-cron-secret") !== cronSecret) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    try {
      const now = nowFn();
      const activeUserIds = await listUsers(now);
      const schedules = await reconcileDecanReflectionSchedules(client, {
        now,
        activeUserIds,
      });
      const { data: scheduler, error } = await client.rpc(
        "reconcile_decan_reflection_scheduler",
      );
      if (error) {
        throw new Error(
          `Scheduler reconciliation failed: ${errorMessage(error)}`,
        );
      }
      return jsonResponse({ success: true, schedules, scheduler });
    } catch (error) {
      console.error("Reflection scheduler reconciliation error", error);
      return jsonResponse({ success: false, error: errorMessage(error) }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createCronDecanReflectionReconcileHandler());
}
