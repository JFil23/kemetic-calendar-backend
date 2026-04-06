import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type OutcomeCandidate = { flow_id: number };

// Use Supabase-specific envs only; avoid generic keys that may point elsewhere.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function fetchCandidates(limit: number): Promise<OutcomeCandidate[]> {
  const { data, error } = await supabase.rpc("flow_outcome_candidates", { p_limit: limit });
  if (error) {
    throw error;
  }
  return (data ?? []) as OutcomeCandidate[];
}

async function computeOutcome(flowId: number): Promise<void> {
  const { error } = await supabase.rpc("compute_flow_outcome", { p_flow_id: flowId });
  if (error) {
    throw error;
  }
}

serve(async (req) => {
  let limit = 500;
  try {
    const body = await req.json();
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(body.limit, 2000);
    }
  } catch (_) {
    // ignore; allow GET/no-body
  }

  try {
    const candidates = await fetchCandidates(limit);
    let processed = 0;
    const failures: { flow_id: number; error: string }[] = [];

    for (const row of candidates) {
      try {
        await computeOutcome(row.flow_id);
        processed += 1;
      } catch (err) {
        failures.push({ flow_id: row.flow_id, error: err?.message ?? "unknown error" });
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
    console.error("cron_compute_flow_outcomes error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message ?? "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
