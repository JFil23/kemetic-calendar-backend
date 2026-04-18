import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type EventBody = {
  event_type?: string;
  node_id?: string;
  node_slug?: string;
  flow_id?: string;
  journal_entry_id?: string;
  reflection_entry_id?: string;
  metadata?: Record<string, unknown>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

function getSupabase(req: Request): { client: SupabaseClient; accessToken: string | null } {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? null;
  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader ?? "" } },
  });
  return { client, accessToken: token };
}

async function resolveNodeId(client: SupabaseClient, nodeId?: string | null, slug?: string | null) {
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

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  try {
    const body = (await req.json()) as EventBody;
    const { client } = getSupabase(req);

    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    if (!body.event_type || !ALLOWED_EVENTS.has(body.event_type)) {
      return new Response(JSON.stringify({ error: "Invalid event_type" }), { status: 400 });
    }

    const nodeId = await resolveNodeId(client, body.node_id ?? null, body.node_slug ?? null);

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
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("track_choice_event exception", e);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
});
