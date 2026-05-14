import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type SendDmRequest = {
  recipientId?: string;
  text?: string;
};

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ??
  Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_FUNCTION_KEY = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonResponse(
  req: Request,
  body: unknown,
  init?: ResponseInit,
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
      ...(init?.headers ?? {}),
    },
  });
}

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function requireUser(req: Request) {
  const accessToken = req.headers.get("authorization")?.replace(
    /^Bearer\s+/i,
    "",
  ).trim() ?? "";
  if (!accessToken) return null;

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user?.id) return null;
  return { user: data.user, accessToken };
}

async function ensureDmPlaceholderFlow(senderId: string) {
  const { data: existing, error: existingError } = await supabase
    .from("flows")
    .select("id")
    .eq("user_id", senderId)
    .eq("notes", "__dm_placeholder__")
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  const existingId = existing?.id as number | undefined;
  if (existingId != null) return existingId;

  const { data: inserted, error: insertError } = await supabase
    .from("flows")
    .insert({
      user_id: senderId,
      name: "DM Messages",
      color: 0,
      active: false,
      rules: [],
      notes: "__dm_placeholder__",
      ai_metadata: { dm_placeholder: true },
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw insertError ??
      new Error("Failed to create DM placeholder flow");
  }
  return inserted.id as number;
}

async function sendDmPush(
  recipientId: string,
  senderId: string,
  text: string,
  accessToken: string,
  shareId?: string,
) {
  if (!INTERNAL_FUNCTION_KEY && !accessToken) {
    return { delivered: false, reason: "missing_push_auth" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, handle")
    .eq("id", senderId)
    .maybeSingle();

  const displayName = trimString(profile?.display_name);
  const handle = trimString(profile?.handle);
  const senderLabel = displayName || (handle ? `@${handle}` : "Someone");
  const preview = text.length > 120 ? `${text.substring(0, 120)}...` : text;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send_push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(INTERNAL_FUNCTION_KEY
        ? { "x-internal-key": INTERNAL_FUNCTION_KEY }
        : { Authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify({
      userIds: [recipientId],
      notification: {
        title: `New message from ${senderLabel}`,
        body: preview,
      },
      data: {
        type: "dm",
        kind: "dm",
        sender_id: senderId,
        ...(shareId ? { share_id: shareId } : {}),
      },
    }),
  });

  const textBody = await res.text();
  if (!res.ok) {
    throw new Error(`send_push ${res.status}: ${textBody}`);
  }

  return textBody.length ? JSON.parse(textBody) : { delivered: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req.headers.get("origin")),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse(
        req,
        { error: "Missing Supabase configuration" },
        { status: 500 },
      );
    }

    const auth = await requireUser(req);
    if (!auth) {
      return jsonResponse(req, { error: "Unauthorized" }, { status: 401 });
    }
    const { user, accessToken } = auth;

    const body = await req.json() as SendDmRequest;
    const recipientId = trimString(body.recipientId);
    const text = trimString(body.text);

    if (!recipientId || !text) {
      return jsonResponse(
        req,
        { error: "recipientId and text are required" },
        { status: 400 },
      );
    }

    if (recipientId == user.id) {
      return jsonResponse(
        req,
        { error: "Cannot message yourself" },
        { status: 400 },
      );
    }

    const { data: recipient, error: recipientError } = await supabase
      .from("profiles")
      .select("id, allow_incoming_shares")
      .eq("id", recipientId)
      .maybeSingle();

    if (recipientError) throw recipientError;
    if (!recipient?.id) {
      return jsonResponse(req, { error: "Recipient not found" }, {
        status: 404,
      });
    }
    if (recipient.allow_incoming_shares === false) {
      return jsonResponse(
        req,
        { error: "Recipient is not accepting messages right now" },
        { status: 403 },
      );
    }

    const dmFlowId = await ensureDmPlaceholderFlow(user.id);
    const payload = {
      type: "message",
      text,
      name: text,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("flow_shares")
      .insert({
        flow_id: dmFlowId,
        sender_id: user.id,
        recipient_id: recipientId,
        channel: "in_app",
        status: "sent",
        payload_json: payload,
      })
      .select("id, status")
      .single();

    if (insertError || !inserted) {
      throw insertError ?? new Error("Failed to create DM share");
    }

    let push: unknown = null;
    let pushError: string | null = null;
    try {
      push = await sendDmPush(
        recipientId,
        user.id,
        text,
        accessToken,
        inserted.id as string | undefined,
      );
    } catch (error) {
      pushError = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          msg: "send_dm_message push failed",
          sender_id: user.id,
          recipient_id: recipientId,
          error: pushError,
        }),
      );
    }

    return jsonResponse(req, {
      success: true,
      share: inserted,
      push,
      pushError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(req, { error: message }, { status: 500 });
  }
});
