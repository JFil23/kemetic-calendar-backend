import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function getClient(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  try {
    const client = getClient(req);
    const {
      data: { user },
      error: userErr,
    } = await client.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { data: profile } = await client
      .from("reflection_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const stale =
      !profile?.last_computed_at ||
      (Date.now() - new Date(profile.last_computed_at).getTime()) / (1000 * 60 * 60) > 6;

    let finalProfile = profile;
    if (stale) {
      const rebuildResp = await fetch(new URL("/functions/v1/rebuild_personal_graph", SUPABASE_URL), {
        method: "POST",
        headers: {
          Authorization: req.headers.get("authorization") ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const rebuildJson = await rebuildResp.json();
      if (rebuildResp.ok && rebuildJson.profile) {
        finalProfile = rebuildJson.profile;
      }
    }

    return new Response(JSON.stringify({ profile: finalProfile }), { status: 200 });
  } catch (e) {
    console.error("generate_reflection_profile error", e);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
});
