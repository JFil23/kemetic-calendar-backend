import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

import {
  corsHeaders,
  defaultSupabaseStoreFromEnv,
  DmConversationHttpError,
  type DmConversationStore,
  jsonResponse,
  markDmConversationRead,
  requireUser,
  trimString,
} from "../_shared/dm_conversations.ts";

type MarkDmConversationReadRequest = {
  conversationId?: string;
};

export function createMarkDmConversationReadHandler(options: {
  store: DmConversationStore;
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

      const body = await req.json() as MarkDmConversationReadRequest;
      const success = await markDmConversationRead({
        userId: auth.user.id,
        conversationId: trimString(body.conversationId),
        store,
      });

      return jsonResponse(req, { success });
    } catch (error) {
      if (error instanceof DmConversationHttpError) {
        return jsonResponse(req, { error: error.message }, {
          status: error.status,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse(req, { error: message }, { status: 500 });
    }
  };
}

if (import.meta.main) {
  const env = defaultSupabaseStoreFromEnv();
  if (!env.configured || !env.store) {
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
    serve(createMarkDmConversationReadHandler({ store: env.store }));
  }
}
