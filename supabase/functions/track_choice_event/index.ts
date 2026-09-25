import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type EventBody = {
  event_type?: string;
  node_id?: string;
  node_slug?: string;
  flow_id?: string;
  journal_entry_id?: string;
  reflection_entry_id?: string;
  metadata?: Record<string, unknown>;
};

type User = { id: string };

type TrackChoiceEventClient = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: User | null };
      error?: unknown;
    }>;
  };
  from(table: string): any;
};

const ALLOWED_EVENTS = new Set([
  "node_opened",
  "node_link_tapped",
  "node_insight_saved",
  "journal_linked_to_node",
  "reflection_linked_to_node",
  "node_linked_to_journal",
  "node_linked_to_reflection",
  "flow_completed",
  "flow_skipped",
  "reflection_opened",
  "reflection_saved",
  "reflection_rated",
  // Cycle / checklist / suggestions
  "cycle_field_saved",
  "checklist_completed",
  "checklist_partial",
  "checklist_skipped",
  "todo_created",
  "todo_completed",
  "suggestion_accepted",
  "suggestion_dismissed",
  "suggestion_snoozed",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function createDefaultClient(): TrackChoiceEventClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase service role environment");
  }
  return createClient(
    supabaseUrl,
    serviceRoleKey,
  ) as unknown as TrackChoiceEventClient;
}

async function resolveNodeId(
  client: TrackChoiceEventClient,
  nodeId?: string | null,
  slug?: string | null,
) {
  if (nodeId) return nodeId;
  if (!slug) return null;
  const { data, error } = await client
    .from("nodes")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("resolveNodeId error", error);
    return null;
  }
  return data?.id ?? null;
}

export function createTrackChoiceEventHandler(options?: {
  client?: TrackChoiceEventClient;
}) {
  const client = options?.client ?? createDefaultClient();

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const authHeader = req.headers.get("authorization");
      const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(token);
      if (userError || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const body = (await req.json()) as EventBody;
      if (!body.event_type || !ALLOWED_EVENTS.has(body.event_type)) {
        return jsonResponse({ error: "Invalid event_type" }, 400);
      }

      const nodeId = await resolveNodeId(
        client,
        body.node_id ?? null,
        body.node_slug ?? null,
      );

      const { error } = await client.from("user_choice_events").insert({
        user_id: user.id,
        event_type: body.event_type,
        node_id: nodeId,
        flow_id: body.flow_id ?? null,
        journal_entry_id: body.journal_entry_id ?? null,
        reflection_entry_id: body.reflection_entry_id ?? null,
        metadata: body.metadata ?? {},
      });
      if (error) {
        console.error("insert error", error);
        return jsonResponse({ error: error.message }, 400);
      }
      return jsonResponse({ ok: true });
    } catch (e) {
      console.error("track_choice_event exception", e);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createTrackChoiceEventHandler());
}
