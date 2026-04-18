import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type Body = {
  source_type: "node_user_text" | "journal_entry" | "reflection_entry";
  source_id?: string;
  source_node_slug?: string;
  source_range_start?: number;
  source_range_end?: number;
  source_selected_text?: string;
  target_type: "node" | "journal_entry" | "reflection_entry";
  target_id?: string;
  target_slug?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function getClient(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  return supabase;
}

async function resolveNodeId(client: SupabaseClient, slug?: string | null) {
  if (!slug) return null;
  const { data, error } = await client.from("nodes").select("id").eq("slug", slug).maybeSingle();
  if (error) {
    console.error("resolveNodeId error", error);
    return null;
  }
  return data?.id ?? null;
}

async function ensureNodeUserContent(
  client: SupabaseClient,
  userId: string,
  nodeId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("node_user_content")
    .select("id")
    .eq("user_id", userId)
    .eq("node_id", nodeId)
    .maybeSingle();
  if (error) {
    console.error("fetch node_user_content", error);
    return null;
  }
  if (data?.id) return data.id;
  const { data: inserted, error: insertErr } = await client
    .from("node_user_content")
    .insert({ user_id: userId, node_id: nodeId, plain_text: "" })
    .select("id")
    .maybeSingle();
  if (insertErr) {
    console.error("insert node_user_content", insertErr);
    return null;
  }
  return inserted?.id ?? null;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  try {
    const body = (await req.json()) as Body;
    const client = getClient(req);
    const {
      data: { user },
      error: userErr,
    } = await client.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    let sourceId = body.source_id ?? null;
    if (body.source_type === "node_user_text") {
      if (!sourceId) {
        const nodeId = await resolveNodeId(client, body.source_node_slug ?? null);
        if (!nodeId) {
          return new Response(JSON.stringify({ error: "Unknown node for source" }), { status: 400 });
        }
        sourceId = await ensureNodeUserContent(client, user.id, nodeId);
      } else {
        // verify ownership
        const { data, error } = await client
          .from("node_user_content")
          .select("id")
          .eq("id", sourceId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (error || !data) {
          return new Response(JSON.stringify({ error: "Source not owned" }), { status: 403 });
        }
      }
    }

    if (!sourceId) {
      return new Response(JSON.stringify({ error: "source_id required" }), { status: 400 });
    }

    let targetId = body.target_id ?? null;
    if (body.target_type === "node") {
      targetId = targetId ?? (await resolveNodeId(client, body.target_slug ?? null));
      if (!targetId) {
        return new Response(JSON.stringify({ error: "target node not found" }), { status: 400 });
      }
    }

    if (!targetId) {
      return new Response(JSON.stringify({ error: "target_id required" }), { status: 400 });
    }

    const { data: inserted, error: insertErr } = await client
      .from("insight_links")
      .insert({
        user_id: user.id,
        source_type: body.source_type,
        source_id: sourceId,
        source_range_start: body.source_range_start ?? null,
        source_range_end: body.source_range_end ?? null,
        source_selected_text: body.source_selected_text ?? null,
        target_type: body.target_type,
        target_id: targetId,
      })
      .select()
      .maybeSingle();
    if (insertErr) {
      console.error("insert insight_link", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 400 });
    }

    return new Response(JSON.stringify({ link: inserted }), { status: 200 });
  } catch (e) {
    console.error("create_insight_link error", e);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
});
