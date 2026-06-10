import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type SendDmRequest = {
  recipientId?: string;
  text?: string;
};

type AuthenticatedUser = {
  id: string;
};

type RecipientRow = {
  id: string;
  allow_incoming_shares?: boolean | null;
};

type InsertedShare = {
  id: string;
  status?: string | null;
};

export type DmPushRequest = {
  userIds: string[];
  notification: {
    title: string;
    body: string;
  };
  data: Record<string, unknown>;
  accessToken: string;
};

export type SendDmMessageStore = {
  authenticate: (accessToken: string) => Promise<AuthenticatedUser | null>;
  getRecipient: (recipientId: string) => Promise<RecipientRow | null>;
  ensureDmPlaceholderFlow: (senderId: string) => Promise<number>;
  insertMessageShare: (params: {
    flowId: number;
    senderId: string;
    recipientId: string;
    text: string;
  }) => Promise<InsertedShare>;
  getSenderLabel: (senderId: string) => Promise<string>;
  sendPush: (request: DmPushRequest) => Promise<unknown>;
};

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

async function requireUser(req: Request, store: SendDmMessageStore) {
  const accessToken = req.headers.get("authorization")?.replace(
    /^Bearer\s+/i,
    "",
  ).trim() ?? "";
  if (!accessToken) return null;

  const user = await store.authenticate(accessToken);
  if (!user?.id) return null;
  return { user, accessToken };
}

async function ensureDmPlaceholderFlow(client: any, senderId: string) {
  const { data: existing, error: existingError } = await client
    .from("flows")
    .select("id")
    .eq("user_id", senderId)
    .eq("notes", "__dm_placeholder__")
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  const existingId = existing?.id as number | undefined;
  if (existingId != null) return existingId;

  const { data: inserted, error: insertError } = await client
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

export function buildDmPushRequest(params: {
  recipientId: string;
  senderId: string;
  senderLabel: string;
  text: string;
  shareId?: string;
  accessToken: string;
}): DmPushRequest {
  const { recipientId, senderId, senderLabel, text, shareId, accessToken } =
    params;
  const preview = text.length > 120 ? `${text.substring(0, 120)}...` : text;

  return {
    userIds: [recipientId],
    notification: {
      title: `New message from ${senderLabel}`,
      body: preview,
    },
    data: {
      type: "dm",
      kind: "dm",
      notification_type: "direct_message",
      notification_kind: "direct_message",
      sender_id: senderId,
      conversation_user_id: senderId,
      ...(shareId ? { share_id: shareId } : {}),
    },
    accessToken,
  };
}

export function createSupabaseDmStore(options: {
  client: any;
  supabaseUrl: string;
  internalFunctionKey?: string;
  fetchImpl?: typeof fetch;
}): SendDmMessageStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const internalFunctionKey = options.internalFunctionKey ?? "";

  return {
    authenticate: async (accessToken: string) => {
      const { data, error } = await options.client.auth.getUser(accessToken);
      if (error || !data.user?.id) return null;
      return { id: data.user.id };
    },
    getRecipient: async (recipientId: string) => {
      const { data, error } = await options.client
        .from("profiles")
        .select("id, allow_incoming_shares")
        .eq("id", recipientId)
        .maybeSingle();

      if (error) throw error;
      return data?.id ? data as RecipientRow : null;
    },
    ensureDmPlaceholderFlow: (senderId: string) =>
      ensureDmPlaceholderFlow(options.client, senderId),
    insertMessageShare: async ({ flowId, senderId, recipientId, text }) => {
      const payload = {
        type: "message",
        text,
        name: text,
      };

      const { data, error } = await options.client
        .from("flow_shares")
        .insert({
          flow_id: flowId,
          sender_id: senderId,
          recipient_id: recipientId,
          channel: "in_app",
          status: "sent",
          payload_json: payload,
        })
        .select("id, status")
        .single();

      if (error || !data) {
        throw error ?? new Error("Failed to create DM share");
      }
      return data as InsertedShare;
    },
    getSenderLabel: async (senderId: string) => {
      const { data: profile } = await options.client
        .from("profiles")
        .select("display_name, handle")
        .eq("id", senderId)
        .maybeSingle();

      const displayName = trimString(profile?.display_name);
      const handle = trimString(profile?.handle);
      return displayName || (handle ? `@${handle}` : "Someone");
    },
    sendPush: async (request: DmPushRequest) => {
      if (!internalFunctionKey && !request.accessToken) {
        return { delivered: false, reason: "missing_push_auth" };
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (internalFunctionKey) {
        headers["x-internal-key"] = internalFunctionKey;
      }
      if (request.accessToken) {
        headers.Authorization = `Bearer ${request.accessToken}`;
      }

      const res = await fetchImpl(
        `${options.supabaseUrl}/functions/v1/send_push`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            userIds: request.userIds,
            notification: request.notification,
            data: request.data,
          }),
        },
      );

      const textBody = await res.text();
      if (!res.ok) {
        throw new Error(`send_push ${res.status}: ${textBody}`);
      }

      return textBody.length ? JSON.parse(textBody) : { delivered: true };
    },
  };
}

export function createSendDmMessageHandler(options: {
  store: SendDmMessageStore;
  serverConfigured?: boolean;
}) {
  const store = options.store;
  const serverConfigured = options.serverConfigured ?? true;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req.headers.get("origin")),
      });
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, {
        status: 405,
      });
    }

    try {
      if (!serverConfigured) {
        return jsonResponse(
          req,
          { error: "Missing Supabase configuration" },
          { status: 500 },
        );
      }

      const auth = await requireUser(req, store);
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

      const recipient = await store.getRecipient(recipientId);
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

      const dmFlowId = await store.ensureDmPlaceholderFlow(user.id);
      const inserted = await store.insertMessageShare({
        flowId: dmFlowId,
        senderId: user.id,
        recipientId,
        text,
      });

      let push: unknown = null;
      let pushError: string | null = null;
      try {
        const senderLabel = await store.getSenderLabel(user.id);
        push = await store.sendPush(
          buildDmPushRequest({
            recipientId,
            senderId: user.id,
            senderLabel,
            text,
            accessToken,
            shareId: inserted.id,
          }),
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
  };
}

if (import.meta.main) {
  const SUPABASE_URL = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const INTERNAL_FUNCTION_KEY = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    serve((req) =>
      req.method === "OPTIONS"
        ? new Response(null, {
          status: 204,
          headers: corsHeaders(req.headers.get("origin")),
        })
        : jsonResponse(req, { error: "Missing Supabase configuration" }, {
          status: 500,
        })
    );
  } else {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    serve(createSendDmMessageHandler({
      store: createSupabaseDmStore({
        client: supabase,
        supabaseUrl: SUPABASE_URL,
        internalFunctionKey: INTERNAL_FUNCTION_KEY,
      }),
    }));
  }
}
