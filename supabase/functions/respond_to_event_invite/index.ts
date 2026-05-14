import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type ResponseStatus = "accepted" | "declined" | "maybe";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isResponseStatus(value: string): value is ResponseStatus {
  return value === "accepted" || value === "declined" || value === "maybe";
}

function responseLabel(status: ResponseStatus) {
  switch (status) {
    case "accepted":
      return "Yes";
    case "declined":
      return "No";
    case "maybe":
      return "Maybe";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: userData, error: userError } = await supabaseUser.auth
      .getUser(token);
    const userId = userData.user?.id ?? null;

    if (userError || !userId) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const body = await req.json();
    const shareId = trimString(body?.share_id);
    const responseStatus = trimString(body?.response_status).toLowerCase();
    if (!shareId || !isResponseStatus(responseStatus)) {
      return jsonResponse(
        { error: "share_id and a valid response_status are required" },
        400,
      );
    }

    const { data: existing, error: existingError } = await supabaseUser
      .from("event_shares")
      .select(
        "id, sender_id, recipient_id, response_status, responded_at, viewed_at, payload_json",
      )
      .eq("id", shareId)
      .eq("recipient_id", userId)
      .maybeSingle();

    if (existingError) {
      return jsonResponse({ error: "Could not load invite" }, 500);
    }
    if (!existing) {
      return jsonResponse({ error: "Invite not found" }, 404);
    }

    const alreadyResponded =
      trimString(existing.response_status).toLowerCase() ===
        responseStatus &&
      !!existing.responded_at;

    let updated = existing;
    if (!(alreadyResponded && existing.viewed_at)) {
      const now = new Date().toISOString();
      const patch: Record<string, string> = { viewed_at: now };
      if (!alreadyResponded) {
        patch.response_status = responseStatus;
        patch.responded_at = now;
      }

      const { data: writeRow, error: writeError } = await supabaseUser
        .from("event_shares")
        .update(patch)
        .eq("id", shareId)
        .eq("recipient_id", userId)
        .select(
          "id, sender_id, recipient_id, response_status, responded_at, viewed_at, payload_json",
        )
        .single();

      if (writeError || !writeRow) {
        return jsonResponse({ error: "Could not save RSVP" }, 500);
      }
      updated = writeRow;
    }

    let notified = false;
    const organizerId = trimString(updated.sender_id);
    if (!alreadyResponded && organizerId && organizerId !== userId) {
      const { data: responderProfile } = await supabaseAdmin
        .from("profiles")
        .select("display_name, handle")
        .eq("id", userId)
        .maybeSingle();

      const displayName = trimString(responderProfile?.display_name);
      const handle = trimString(responderProfile?.handle);
      const responderLabel = displayName ||
        (handle ? `@${handle}` : "Someone");
      const payload = updated.payload_json &&
          typeof updated.payload_json === "object"
        ? updated.payload_json as Record<string, unknown>
        : null;
      const eventTitle = trimString(payload?.title) ||
        trimString(payload?.name);

      try {
        const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/send_push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            userIds: [organizerId],
            notification: {
              title: `RSVP update from ${responderLabel}`,
              body: eventTitle
                ? `${responseLabel(responseStatus)} for ${eventTitle}`
                : `${responseLabel(responseStatus)} to your event invite`,
            },
            data: {
              type: "event_invite",
              kind: "event_invite",
              sender_id: userId,
              share_id: shareId,
              response_status: responseStatus,
            },
          }),
        });
        notified = pushRes.ok;
      } catch (_) {
        notified = false;
      }
    }

    return jsonResponse({
      share: updated,
      changed: !alreadyResponded,
      notified,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
