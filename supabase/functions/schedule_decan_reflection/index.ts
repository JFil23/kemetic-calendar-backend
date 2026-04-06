import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Payload = {
  decan_start?: string;
  decan_end?: string;
  send_at?: string;
};

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Get the user context from the JWT
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = (await req.json()) as Payload;
    const decanStart = body.decan_start ? new Date(body.decan_start) : null;
    const decanEnd = body.decan_end ? new Date(body.decan_end) : null;
    const sendAt = body.send_at ? new Date(body.send_at) : null;

    if (!decanStart || !decanEnd || !sendAt || isNaN(decanStart.valueOf()) || isNaN(decanEnd.valueOf()) || isNaN(sendAt.valueOf())) {
      return new Response("Invalid payload", { status: 400 });
    }

    // Basic range checks
    if (decanEnd < decanStart) {
      return new Response("Invalid decan range", { status: 400 });
    }
    const decanSpanDays = Math.round((decanEnd.getTime() - decanStart.getTime()) / (1000 * 60 * 60 * 24));
    if (decanSpanDays !== 9) {
      return new Response("Decan range must be 10 days", { status: 400 });
    }

    const now = new Date();
    const tooOld = sendAt < new Date(now.getTime() - 5 * 60 * 1000);
    const tooFar = sendAt > new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (tooOld || tooFar) {
      return new Response("Invalid send_at window", { status: 400 });
    }

    // Optional: ensure send_at falls on Day 10 (local date derived from decan_start, tolerance = 24h UTC slice)
    const day10StartDateStr = new Date(decanStart.getTime() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const day10StartUtc = new Date(`${day10StartDateStr}T00:00:00.000Z`).getTime();
    const day10EndUtc = new Date(`${day10StartDateStr}T23:59:59.999Z`).getTime();
    const sendAtMs = sendAt.getTime();
    if (sendAtMs < day10StartUtc || sendAtMs > day10EndUtc) {
      return new Response("send_at must fall on decan day 10", { status: 400 });
    }

    const decanStartDate = decanStart.toISOString().slice(0, 10);
    const decanEndDate = decanEnd.toISOString().slice(0, 10);

    // Upsert: insert if missing, update send_at/decan_end only when pending
    const { data: existing, error: fetchErr } = await supabase
      .from("decan_reflection_schedule")
      .select("id, status, send_at")
      .eq("user_id", user.id)
      .eq("decan_start", decanStartDate)
      .maybeSingle();
    if (fetchErr) {
      console.error("fetch schedule error", fetchErr);
      return new Response("Fetch error", { status: 500 });
    }

    if (!existing) {
      const { error: insertErr } = await supabase.from("decan_reflection_schedule").insert({
        user_id: user.id,
        decan_start: decanStartDate,
        decan_end: decanEndDate,
        send_at: sendAt.toISOString(),
        status: "pending",
      });
      if (insertErr) {
        console.error("insert schedule error", insertErr);
        return new Response("Insert error", { status: 500 });
      }
    } else if (existing.status === "pending") {
      const { error: updateErr } = await supabase
        .from("decan_reflection_schedule")
        .update({
          decan_end: decanEndDate,
          send_at: sendAt.toISOString(),
        })
        .eq("id", existing.id);
      if (updateErr) {
        console.error("update schedule error", updateErr);
        return new Response("Update error", { status: 500 });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("schedule_decan_reflection error", err);
    return new Response("Server error", { status: 500 });
  }
});
