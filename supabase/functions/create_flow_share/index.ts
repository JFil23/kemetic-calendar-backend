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

    // Use service role client to bypass RLS for reading sender's events
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { flow_id, recipients, suggested_schedule } = await req.json();

    if (!flow_id || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Fetch the flow
    const { data: flow, error: flowError } = await supabaseUser
      .from("flows")
      .select("id, name, color, notes, rules, user_id")
      .eq("id", flow_id)
      .single();

    if (flowError || !flow) {
      return new Response(JSON.stringify({ error: "Flow not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (flow.user_id !== user_id) {
      return new Response(JSON.stringify({ error: "Not authorized to share this flow" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. ✅ Fetch sender's events for this flow (using admin client to bypass RLS)
    const { data: events, error: eventsError } = await supabaseAdmin
      .from("user_events")
      .select("title, detail, location, all_day, starts_at, ends_at")
      .eq("flow_local_id", flow_id)
      .order("starts_at", { ascending: true });

    if (eventsError) {
      console.error("Error fetching events:", eventsError);
      // Continue without events - fallback to rules-based
    }

    // 3. ✅ Build event snapshots with offset_days
    const eventSnapshots: any[] = [];
    let firstStartsAt: Date | null = null;

    if (events && events.length > 0) {
      firstStartsAt = new Date(events[0].starts_at);

      for (const ev of events) {
        const start = new Date(ev.starts_at);
        const offsetDays = Math.round(
          (start.getTime() - firstStartsAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        const snapshot: any = {
          offset_days: offsetDays,
          title: ev.title || flow.name,
          detail: ev.detail || null,
          location: ev.location || null,
          all_day: ev.all_day || false,
        };

        if (!ev.all_day) {
          snapshot.start_time = start.toISOString().slice(11, 16); // "HH:MM"
          if (ev.ends_at) {
            const end = new Date(ev.ends_at);
            snapshot.end_time = end.toISOString().slice(11, 16);
          }
        }

        eventSnapshots.push(snapshot);
      }
    }

    // 4. ✅ Build payload_json with flow data + events
    const payloadJson = {
      name: flow.name,
      color: flow.color,
      notes: flow.notes || null,
      rules: flow.rules || [],
      events: eventSnapshots, // ✅ Include event snapshots
    };

    // 5. Create shares for each recipient with error handling
    const shares: any[] = [];
    const errors: Array<{ recipient: unknown; error: string }> = [];

    for (const recipient of recipients ?? []) {
      try {
        if (recipient.type === "user") {
          // 1️⃣ Try to resolve by userId (preferred)
          let profile = null;
          let profileError = null;

          const byId = await supabaseAdmin
            .from("profiles")
            .select("id, email")
            .eq("id", recipient.value)
            .maybeSingle();

          profile = byId.data;
          profileError = byId.error;

          // 2️⃣ If not found AND no error, fallback to treating value as handle
          if (!profile && !profileError) {
            const byHandle = await supabaseAdmin
              .from("profiles")
              .select("id, email")
              .eq("handle", recipient.value)
              .maybeSingle();

            profile = byHandle.data;
            profileError = byHandle.error;
          }

          if (profileError || !profile || !profile.id) {
            console.error("create_flow_share: failed to resolve user recipient", {
              value: recipient.value,
              profileError,
            });
            errors.push({
              recipient: recipient.value,
              error: "USER_NOT_FOUND",
            });
            continue;
          }

          const recipientId = profile.id as string;
          const recipientEmail = (profile.email ?? null) as string | null;

          const { data: inserted, error: insertError } = await supabaseUser
            .from("flow_shares")
            .insert({
              flow_id: flow_id,
              sender_id: user_id,
              recipient_id: recipientId,
              // recipient_email removed - not in schema cache
              channel: "in_app",
              suggested_schedule: suggested_schedule || null,
              payload_json: payloadJson,
              status: "sent",
            })
            .select("id, status")
            .single();

          if (insertError || !inserted) {
            console.error("create_flow_share: insert error", insertError);
            errors.push({
              recipient: recipient.value,
              error: "INSERT_FAILED",
            });
            continue;
          }

          shares.push(inserted);
          continue;
        }

        if (recipient.type === "email") {
          const email = String(recipient.value);
          const { data: inserted, error: insertError } = await supabaseUser
            .from("flow_shares")
            .insert({
              flow_id: flow_id,
              sender_id: user_id,
              recipient_id: null,
              // recipient_email removed - email-only shares not supported in current inbox views
              channel: "email",
              suggested_schedule: suggested_schedule || null,
              payload_json: payloadJson,
              status: "sent",
            })
            .select("id, status")
            .single();

          if (insertError || !inserted) {
            console.error("create_flow_share: email insert error", insertError);
            errors.push({
              recipient: email,
              error: "INSERT_FAILED",
            });
            continue;
          }

          shares.push(inserted);
          continue;
        }

        // Unknown recipient type
        errors.push({
          recipient: recipient?.value ?? null,
          error: "UNKNOWN_RECIPIENT_TYPE",
        });
      } catch (err) {
        console.error("create_flow_share: unexpected error for recipient", {
          recipient,
          err,
        });
        errors.push({
          recipient: recipient?.value ?? null,
          error: "UNEXPECTED_ERROR",
        });
        continue;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        shares,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
