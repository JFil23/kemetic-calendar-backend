import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

import {
  corsHeaders,
  createDmConversation,
  defaultSupabaseStoreFromEnv,
  DmConversationHttpError,
  type DmConversationStore,
  jsonResponse,
  requireUser,
  stringArray,
  trimString,
} from "../_shared/dm_conversations.ts";

type CreateDmConversationRequest = {
  participantIds?: string[];
  initialText?: string;
  clientMessageId?: string;
  title?: string;
};

export function createCreateDmConversationHandler(options: {
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

      const body = await req.json() as CreateDmConversationRequest;
      const result = await createDmConversation({
        creatorId: auth.user.id,
        participantIds: stringArray(body.participantIds),
        title: trimString(body.title) || null,
        initialText: trimString(body.initialText) || null,
        clientMessageId: trimString(body.clientMessageId) || null,
        store,
        accessToken: auth.accessToken,
      });

      return jsonResponse(req, { success: true, ...result });
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
    serve(createCreateDmConversationHandler({ store: env.store }));
  }
}
