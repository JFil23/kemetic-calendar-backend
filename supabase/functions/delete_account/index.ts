// Edge Function: delete_account
// Authenticated self-service account deletion for App Store account-removal flow.
// Requires:
//   SUPABASE_URL
//   SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type DeleteStep = {
  table: string;
  column: string;
  count?: number | null;
  skipped?: boolean;
  error?: string;
};

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
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

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isSchemaMismatch(error: any): boolean {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("could not find the table") ||
    message.includes("could not find the column") ||
    message.includes("does not exist");
}

async function deleteRows(
  table: string,
  column: string,
  userId: string,
): Promise<DeleteStep> {
  const { error, count } = await admin
    .from(table)
    .delete({ count: "exact" })
    .eq(column, userId);

  if (error) {
    if (isSchemaMismatch(error)) {
      return {
        table,
        column,
        skipped: true,
        error: serializeError(error),
      };
    }
    throw new Error(`${table}.${column}: ${serializeError(error)}`);
  }

  return { table, column, count };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders(req.headers.get("origin")),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "method_not_allowed" }, { status: 405 });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse(
      req,
      { error: "server_not_configured" },
      { status: 500 },
    );
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse(req, { error: "auth_required" }, { status: 401 });
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) {
    return jsonResponse(req, { error: "invalid_session" }, { status: 401 });
  }

  const userId = user.id;
  const steps: DeleteStep[] = [];

  try {
    const explicitDeletes: Array<[string, string]> = [
      ["app_events", "user_id"],
      ["flow_generation_cache", "user_id"],
      ["flow_shares", "sender_id"],
      ["flow_shares", "recipient_id"],
      ["event_shares", "sender_id"],
      ["event_shares", "recipient_id"],
      ["shared_calendar_notifications", "actor_id"],
      ["shared_calendar_notifications", "recipient_id"],
      ["shared_calendar_members", "user_id"],
      ["shared_calendars", "owner_id"],
      ["dm_message_likes", "user_id"],
      ["content_reports", "reporter_user_id"],
      ["content_reports", "reported_user_id"],
      ["user_blocks", "blocker_user_id"],
      ["user_blocks", "blocked_user_id"],
      ["flow_post_comment_likes", "user_id"],
      ["flow_post_comments", "user_id"],
      ["flow_post_likes", "user_id"],
      ["insight_posts", "user_id"],
      ["flow_posts", "user_id"],
      ["flow_saves", "user_id"],
      ["user_app_restoration_snapshots", "user_id"],
      ["cycle_adjustment_suggestions", "user_id"],
      ["checklist_items", "user_id"],
      ["todos", "user_id"],
      ["cycle_schedule_rules", "user_id"],
      ["cycle_fields", "user_id"],
      ["reflection_feedback", "user_id"],
      ["reflection_generations", "user_id"],
      ["reflection_profiles", "user_id"],
      ["user_choice_events", "user_id"],
      ["insight_links", "user_id"],
      ["node_insight_entries", "user_id"],
      ["node_user_content", "user_id"],
      ["decan_reflections", "user_id"],
      ["scheduled_notifications", "user_id"],
      ["push_tokens", "user_id"],
      ["push_subscriptions", "user_id"],
      ["reminders", "user_id"],
      ["nutrition_items", "user_id"],
      ["journal_entries", "user_id"],
      ["user_events", "user_id"],
      ["flows", "user_id"],
      ["profiles", "id"],
    ];

    for (const [table, column] of explicitDeletes) {
      steps.push(await deleteRows(table, column, userId));
    }

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(
      userId,
    );
    if (deleteUserError) {
      throw new Error(`auth.users: ${serializeError(deleteUserError)}`);
    }

    return jsonResponse(req, {
      deleted: true,
      userId,
      steps,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "delete_account_failed",
        userId,
        error: serializeError(error),
        steps,
      }),
    );
    return jsonResponse(
      req,
      {
        error: "delete_failed",
        detail: serializeError(error),
        steps,
      },
      { status: 500 },
    );
  }
});
