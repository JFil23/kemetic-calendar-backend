import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  computeWindowSendAt,
  normalizeTimeZone,
} from "../_shared/decan_schedule.ts";

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ??
  Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Payload = {
  decan_start?: string;
  decan_end?: string;
  send_at?: string;
  decan_name?: string | null;
  decan_theme?: string | null;
  decan_context_key?: string | null;
  timezone?: string | null;
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

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
    const decanName = body.decan_name?.trim() || null;
    const decanTheme = body.decan_theme?.trim() || null;
    const decanContextKey = body.decan_context_key?.trim() || null;
    const requestedTimeZone = body.timezone?.trim() || null;

    if (
      !decanStart || !decanEnd || isNaN(decanStart.valueOf()) ||
      isNaN(decanEnd.valueOf())
    ) {
      return new Response("Invalid payload", { status: 400 });
    }

    // Basic range checks
    if (decanEnd < decanStart) {
      return new Response("Invalid decan range", { status: 400 });
    }
    const decanSpanDays = Math.round(
      (decanEnd.getTime() - decanStart.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (decanSpanDays !== 9) {
      return new Response("Decan range must be 10 days", { status: 400 });
    }

    const decanStartDate = decanStart.toISOString().slice(0, 10);
    const decanEndDate = decanEnd.toISOString().slice(0, 10);

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      console.error("profile lookup error", profileError);
      return new Response("Profile lookup error", { status: 500 });
    }

    const effectiveTimeZone = normalizeTimeZone(
      requestedTimeZone ?? profileRow?.timezone ?? null,
    );

    const sendAt = new Date(
      computeWindowSendAt(decanEndDate, effectiveTimeZone),
    );
    const now = new Date();
    const tooOld = sendAt < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const tooFar = sendAt > new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (tooOld || tooFar) {
      return new Response("Invalid send_at window", { status: 400 });
    }

    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        timezone: effectiveTimeZone,
        updated_at: now.toISOString(),
      }, { onConflict: "id" });
    if (profileUpdateError) {
      console.error("profile timezone update error", profileUpdateError);
    }

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
      const { error: insertErr } = await supabase.from(
        "decan_reflection_schedule",
      ).insert({
        user_id: user.id,
        decan_start: decanStartDate,
        decan_end: decanEndDate,
        send_at: sendAt.toISOString(),
        decan_name: decanName,
        decan_theme: decanTheme,
        decan_context_key: decanContextKey,
        status: "pending",
      });
      if (insertErr) {
        if (insertErr.code === "23505") {
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        console.error("insert schedule error", insertErr);
        return new Response("Insert error", { status: 500 });
      }
    } else if (existing.status === "pending") {
      const { error: updateErr } = await supabase
        .from("decan_reflection_schedule")
        .update({
          decan_end: decanEndDate,
          send_at: sendAt.toISOString(),
          decan_name: decanName,
          decan_theme: decanTheme,
          decan_context_key: decanContextKey,
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
