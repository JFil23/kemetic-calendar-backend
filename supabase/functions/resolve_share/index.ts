import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { publishableKey } from "../_shared/supabase_keys.ts";

type Row = Record<string, unknown>;
type Dependencies = {
  getUser: (token: string) => Promise<{ id: string } | null>;
  readShare: (id: string, token: string) => Promise<Row | null>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const response = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers });

// Preview reads the existing published share snapshot. Import acknowledgement
// stays with the app's existing markImported action; previews perform no writes.
export function createResolveShareHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return response({ error: "method_not_allowed" }, 405);
    }
    const token = request.headers.get("authorization")?.match(
      /^Bearer\s+(.+)$/i,
    )?.[1]?.trim();
    if (!token) return response({ error: "auth_required" }, 401);
    let user: { id: string } | null;
    try {
      user = await deps.getUser(token);
    } catch {
      user = null;
    }
    if (!user) return response({ error: "invalid_session" }, 401);
    let body: { share_id?: unknown };
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 8192) {
        return response({ error: "invalid_payload" }, 400);
      }
      body = JSON.parse(raw);
      if (
        !body || typeof body.share_id !== "string" || !UUID.test(body.share_id)
      ) return response({ error: "invalid_payload" }, 400);
    } catch {
      return response({ error: "invalid_payload" }, 400);
    }
    try {
      const share = await deps.readShare(body.share_id as string, token);
      // RLS protects the read too. Do not let a copied link token replace the
      // verified recipient/sender relationship or rebuild another user's flow.
      if (
        !share || share.deleted_at ||
        (share.recipient_id !== user.id && share.sender_id !== user.id)
      ) return response({ error: "share_unavailable" }, 404);
      const flow = share.payload_json;
      if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
        return response({ error: "share_unavailable" }, 404);
      }
      const safeShare = {
        id: share.id,
        sender_id: share.sender_id,
        recipient_id: share.recipient_id,
        suggested_schedule: share.suggested_schedule,
        imported_at: share.imported_at,
      };
      return response({
        success: true,
        flow,
        share: safeShare,
        sender: share.sender,
        sender_id: share.sender_id,
        suggested_schedule: share.suggested_schedule,
        imported_at: share.imported_at,
      }, 200);
    } catch {
      return response({ error: "preview_unavailable" }, 500);
    }
  };
}

export function createResolveShareDependencies(
  url: string,
  key: string,
): Dependencies {
  const client = (token: string) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer " + token } },
    });
  return {
    getUser: async (token) => {
      const { data, error } = await client(token).auth.getUser(token);
      return !error && data.user ? { id: data.user.id } : null;
    },
    readShare: async (id, token) => {
      const user = client(token);
      const { data, error } = await user.from("flow_shares")
        .select(
          "id,sender_id,recipient_id,payload_json,suggested_schedule,imported_at,deleted_at",
        )
        .eq("id", id).maybeSingle();
      if (error) throw new Error("share_read_failed");
      if (!data) return null;
      const { data: sender } = await user.from("profiles")
        .select("id,handle,display_name,avatar_url").eq("id", data.sender_id)
        .maybeSingle();
      return { ...data, sender: sender ?? undefined };
    },
  };
}
if (import.meta.main) {
  Deno.serve(
    createResolveShareHandler(
      createResolveShareDependencies(
        Deno.env.get("SUPABASE_URL")!,
        publishableKey(),
      ),
    ),
  );
}
