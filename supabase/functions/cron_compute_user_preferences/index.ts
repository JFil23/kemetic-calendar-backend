import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type PrefCandidate = { user_id: string };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function fetchCandidates(limit: number): Promise<PrefCandidate[]> {
  const { data, error } = await supabase.rpc("dm_user_pref_candidates", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PrefCandidate[];
}

serve(async (req) => {
  let limit = 200;

  try {
    const body = await req.json();
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(body.limit, 1000);
    }
  } catch (_) {}

  try {
    const candidates = await fetchCandidates(limit);
    let processed = 0;
    const failures: { user_id: string; error: string }[] = [];

    for (const row of candidates) {
      try {
        const { error } = await supabase.rpc("compute_user_preferences_for", {
          p_user_id: row.user_id,
          p_window_days: 90,
        });
        if (error) throw new Error(error.message);
        processed += 1;
      } catch (err) {
        failures.push({ user_id: row.user_id, error: err?.message ?? "unknown error" });
      }
    }

    return new Response(
      JSON.stringify({
        success: failures.length === 0,
        processed,
        failures,
        total_candidates: candidates.length,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("cron_compute_user_preferences error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message ?? "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
