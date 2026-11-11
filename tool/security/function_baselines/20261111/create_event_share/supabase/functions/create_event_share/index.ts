import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

async function buildSourceFlowPayload(
  supabaseAdmin: any,
  supabaseUser: any,
  sourceFlowId: number | null,
) {
  if (sourceFlowId == null) {
    return null;
  }

  const { data: flowData, error: flowError } = await supabaseAdmin
    .from("flows")
    .select(
      "id, name, color, notes, rules, start_date, end_date, is_hidden, is_reminder, reminder_uuid, origin_flow_id, root_flow_id",
    )
    .eq("id", sourceFlowId)
    .maybeSingle();

  const flowRow = flowData as Record<string, unknown> | null;
  if (flowError || !flowRow) {
    console.error("create_event_share: failed to load source flow", {
      sourceFlowId,
      flowError,
    });
    return null;
  }

  const { data: flowEventsData, error: flowEventsError } = await supabaseUser
    .from("user_event_filing_items_client")
    .select(
      "client_event_id, title, detail, location, all_day, starts_at, ends_at, category, action_id, behavior_payload",
    )
    .eq("filed_flow_id", sourceFlowId)
    .order("starts_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (flowEventsError) {
    console.error("create_event_share: failed to load source flow events", {
      sourceFlowId,
      flowEventsError,
    });
  }

  const flowEvents = (flowEventsData ?? []) as Array<Record<string, unknown>>;
  const events = flowEvents
    .filter((row) => row["category"] !== "tombstone")
    .map((row) => ({
      source_client_event_id: row["client_event_id"] ?? null,
      title: row["title"] ?? flowRow["name"],
      detail: row["detail"] ?? null,
      location: row["location"] ?? null,
      all_day: row["all_day"] ?? false,
      starts_at: row["starts_at"],
      ends_at: row["ends_at"] ?? null,
      category: row["category"] ?? null,
      action_id: row["action_id"] ?? null,
      behavior_payload: row["behavior_payload"] &&
          typeof row["behavior_payload"] === "object" &&
          !Array.isArray(row["behavior_payload"])
        ? row["behavior_payload"]
        : null,
    }));

  return {
    flow_id: flowRow["id"],
    name: flowRow["name"],
    color: flowRow["color"],
    notes: flowRow["notes"] ?? null,
    rules: flowRow["rules"] ?? [],
    start_date: flowRow["start_date"] ?? null,
    end_date: flowRow["end_date"] ?? null,
    is_hidden: flowRow["is_hidden"] ?? false,
    is_reminder: flowRow["is_reminder"] ?? false,
    reminder_uuid: flowRow["reminder_uuid"] ?? null,
    origin_flow_id: flowRow["origin_flow_id"] ?? null,
    root_flow_id: flowRow["root_flow_id"] ?? null,
    events,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: userData, error: userError } = await supabaseUser.auth
      .getUser(
        token,
      );
    const user_id = userData.user?.id ?? null;

    if (userError || !user_id) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { event_id, recipients, payload_json } = await req.json();

    if (
      !event_id || !recipients || !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 1. Verify ownership: event must belong to caller
    const { data: eventRow, error: eventErr } = await supabaseUser
      .from("user_event_filing_items_client")
      .select(
        "id, user_id, title, detail, location, starts_at, ends_at, all_day, flow_local_id, filed_flow_id, category",
      )
      .eq("id", event_id)
      .single();

    if (eventErr || !eventRow) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (eventRow.user_id !== user_id) {
      return new Response(
        JSON.stringify({ error: "Not authorized to share this event" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, handle")
      .eq("id", user_id)
      .maybeSingle();
    const senderLabel = senderProfile?.display_name?.trim() ||
      (senderProfile?.handle ? `@${senderProfile.handle}` : "Someone");
    const sourceFlowPayload = await buildSourceFlowPayload(
      supabaseAdmin,
      supabaseUser,
      asPositiveInt(eventRow.flow_local_id) ??
        asPositiveInt(eventRow.filed_flow_id),
    );

    const eventPayload = {
      ...(payload_json ?? {}),
      event_id,
      title: eventRow.title,
      detail: eventRow.detail,
      location: eventRow.location,
      starts_at: eventRow.starts_at,
      ends_at: eventRow.ends_at,
      all_day: eventRow.all_day,
      category: eventRow.category,
      ...(sourceFlowPayload != null ? { source_flow: sourceFlowPayload } : {}),
    };

    const shares: any[] = [];
    const errors: Array<{ recipient: unknown; error: string }> = [];
    const normalizedRecipients: Array<{ type: string; value: string }> = [];
    const seenRecipients = new Set<string>();

    for (const rawRecipient of recipients ?? []) {
      const type = typeof rawRecipient?.type === "string"
        ? rawRecipient.type
        : "";
      const value = typeof rawRecipient?.value === "string"
        ? rawRecipient.value.trim()
        : "";
      if (!type || !value) {
        errors.push({
          recipient: rawRecipient?.value ?? null,
          error: "INVALID_RECIPIENT",
        });
        continue;
      }
      const key = `${type}:${value}`;
      if (seenRecipients.has(key)) continue;
      seenRecipients.add(key);
      normalizedRecipients.push({ type, value });
    }

    for (const recipient of normalizedRecipients) {
      try {
        if (recipient.type !== "user") {
          errors.push({
            recipient,
            error: "IN_APP_USER_REQUIRED",
          });
          continue;
        }

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("id", recipient.value)
          .maybeSingle();

        if (profileError || !profile?.id) {
          errors.push({ recipient, error: "USER_NOT_FOUND" });
          continue;
        }

        if (profile.id === user_id) {
          errors.push({
            recipient,
            error: "CANNOT_INVITE_SELF",
          });
          continue;
        }

        const { data: existingRows, error: existingError } = await supabaseUser
          .from("event_shares")
          .select("id")
          .eq("event_id", event_id)
          .eq("sender_id", user_id)
          .eq("recipient_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (existingError) {
          errors.push({ recipient, error: "LOOKUP_FAILED" });
          continue;
        }

        const existingId = existingRows?.[0]?.id as string | undefined;
        const insertPatch = {
          channel: "in_app",
          payload_json: eventPayload,
          status: "sent",
          viewed_at: null,
          imported_at: null,
          deleted_at: null,
          response_status: "no_response",
          responded_at: null,
        };
        const updatePatch = {
          channel: "in_app",
          payload_json: eventPayload,
          status: "sent",
          deleted_at: null,
        };

        if (existingId) {
          const { data: updated, error: updateError } = await supabaseUser
            .from("event_shares")
            .update(updatePatch)
            .eq("id", existingId)
            .select("id, status, response_status")
            .single();

          if (updateError || !updated) {
            errors.push({ recipient, error: "UPDATE_FAILED" });
            continue;
          }

          shares.push({ ...updated, recipient, recipient_id: profile.id });
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/send_push`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
              },
              body: JSON.stringify({
                userIds: [profile.id],
                notification: {
                  title: `Event invite from ${senderLabel}`,
                  body: eventRow.title ||
                    "Open Kemetic Calendar to view the invite.",
                },
                data: {
                  type: "event_invite",
                  kind: "event_invite",
                  sender_id: user_id,
                  share_id: updated.id,
                },
              }),
            });
          } catch (_) {
            // Best-effort only. Invite creation should still succeed without push.
          }
          continue;
        }

        const { data: inserted, error: insertError } = await supabaseUser
          .from("event_shares")
          .insert({
            event_id,
            sender_id: user_id,
            recipient_id: profile.id,
            ...insertPatch,
          })
          .select("id, status, response_status")
          .single();

        if (insertError || !inserted) {
          errors.push({ recipient, error: "INSERT_FAILED" });
          continue;
        }

        shares.push({ ...inserted, recipient, recipient_id: profile.id });
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send_push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
            body: JSON.stringify({
              userIds: [profile.id],
              notification: {
                title: `Event invite from ${senderLabel}`,
                body: eventRow.title ||
                  "Open Kemetic Calendar to view the invite.",
              },
              data: {
                type: "event_invite",
                kind: "event_invite",
                sender_id: user_id,
                share_id: inserted.id,
              },
            }),
          });
        } catch (_) {
          // Best-effort only. Invite creation should still succeed without push.
        }
        continue;
      } catch (err) {
        errors.push({
          recipient,
          error: "EXCEPTION",
        });
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
