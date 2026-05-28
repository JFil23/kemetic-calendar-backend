import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  computeCurrentAndNextDecanWindows,
  normalizeTimeZone,
} from "../_shared/decan_schedule.ts";
import {
  decanPeriodKey,
  type GuidanceWindow,
} from "../_shared/maat_guidance.ts";

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ??
  Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function guidanceWindowFromCurrent(
  timezone: string,
): GuidanceWindow | null {
  const current = computeCurrentAndNextDecanWindows(new Date(), timezone)[0];
  if (!current) return null;
  return {
    start: current.start,
    end: current.end,
    decanName: current.decanName,
    decanTheme: current.decanTheme,
    decanContextKey: current.decanContextKey,
  };
}

async function expireStaleDeliveries(userId: string, currentPeriodKey: string) {
  const now = new Date().toISOString();
  const { error } = await client
    .from("maat_guidance_deliveries")
    .update({ status: "expired", expired_at: now })
    .eq("user_id", userId)
    .in("status", ["pending", "shown"])
    .neq("decan_period_key", currentPeriodKey);
  if (error) {
    console.error("stale delivery expiry error", error);
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser(token);
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as {
      delivery_id?: string;
    };
    const requestedId = body.delivery_id?.trim();

    if (requestedId) {
      const { data, error } = await client
        .from("maat_guidance_deliveries")
        .select("*")
        .eq("user_id", user.id)
        .eq("id", requestedId)
        .maybeSingle();
      if (error) {
        console.error("delivery lookup error", error);
        return jsonResponse({ error: "Fetch error" }, 500);
      }
      return jsonResponse({ delivery: data ?? null });
    }

    const { data: profileRow } = await client
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timezone = normalizeTimeZone(profileRow?.timezone ?? null);
    const window = guidanceWindowFromCurrent(timezone);
    if (!window) {
      return jsonResponse({ delivery: null });
    }
    const periodKey = decanPeriodKey(window);
    await expireStaleDeliveries(user.id, periodKey);

    const { data, error } = await client
      .from("maat_guidance_deliveries")
      .select("*")
      .eq("user_id", user.id)
      .eq("decan_period_key", periodKey)
      .in("status", ["pending", "shown"])
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) {
      console.error("eligible delivery fetch error", error);
      return jsonResponse({ error: "Fetch error" }, 500);
    }

    return jsonResponse({ delivery: data?.[0] ?? null });
  } catch (err) {
    console.error("fetch_maat_guidance_pending error", err);
    return jsonResponse({ error: "Server error" }, 500);
  }
});
