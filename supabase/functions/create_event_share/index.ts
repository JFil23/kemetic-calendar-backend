import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { jwtDecode } from "https://esm.sh/jwt-decode@4.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const claims: any = jwtDecode(token);
    const user_id = claims?.sub ?? null;

    if (!user_id) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { event_id, recipients, channel = "in_app", payload_json } = await req.json();

    if (!event_id || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Verify ownership: event must belong to caller
    const { data: eventRow, error: eventErr } = await supabaseUser
      .from("user_events")
      .select("id, user_id, title, detail, starts_at, ends_at, all_day")
      .eq("id", event_id)
      .single();

    if (eventErr || !eventRow) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (eventRow.user_id !== user_id) {
      return new Response(JSON.stringify({ error: "Not authorized to share this event" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const shares: any[] = [];
    const errors: Array<{ recipient: unknown; error: string }> = [];

    for (const recipient of recipients ?? []) {
      try {
        if (recipient.type === "user") {
          // Resolve recipient
          const { data: profile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("id", recipient.value)
            .maybeSingle();

          if (profileError || !profile?.id) {
            errors.push({ recipient: recipient.value, error: "USER_NOT_FOUND" });
            continue;
          }

          const { data: inserted, error: insertError } = await supabaseUser
            .from("event_shares")
            .insert({
              event_id,
              sender_id: user_id,
              recipient_id: profile.id,
              channel,
              payload_json: payload_json ?? null,
              status: "sent",
            })
            .select("id, status")
            .single();

          if (insertError || !inserted) {
            errors.push({ recipient: recipient.value, error: "INSERT_FAILED" });
            continue;
          }

          shares.push(inserted);
          continue;
        }

        if (recipient.type === "email") {
          const email = String(recipient.value);
          const { data: inserted, error: insertError } = await supabaseUser
            .from("event_shares")
            .insert({
              event_id,
              sender_id: user_id,
              recipient_id: null,
              channel: "email",
              payload_json: payload_json ?? null,
              status: "sent",
            })
            .select("id, status")
            .single();

          if (insertError || !inserted) {
            errors.push({ recipient: email, error: "INSERT_FAILED" });
            continue;
          }

          shares.push(inserted);
          continue;
        }

        errors.push({ recipient: recipient?.value ?? null, error: "UNKNOWN_RECIPIENT_TYPE" });
      } catch (err) {
        errors.push({ recipient: recipient?.value ?? null, error: "EXCEPTION" });
      }
    }

    return new Response(
      JSON.stringify({ shares, errors }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
