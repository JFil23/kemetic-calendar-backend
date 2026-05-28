import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  inferMaatDeliveryKindFromKey,
  isMaatDeliveryReceiptEventName,
  recordMaatDeliveryReceiptEvent,
} from "../_shared/maat_delivery_receipt.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupabaseClientLike = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error?: unknown;
    }>;
  };
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

function createDefaultClient() {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function trimmedString(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function recordMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createRecordDeliveryReceiptHandler(options?: {
  client?: SupabaseClientLike;
  now?: () => Date;
}) {
  const client = options?.client ?? createDefaultClient();
  const nowFn = options?.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const authHeader = req.headers.get("authorization");
      const token = authHeader?.replace("Bearer ", "").trim();
      if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(token);
      if (userError || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const deliveryKey = trimmedString(
        body.delivery_key ?? body.deliveryKey,
      );
      const receiptEvent = trimmedString(
        body.receipt_event ?? body.receiptEvent ?? body.event,
      );
      if (
        !deliveryKey || !receiptEvent ||
        !isMaatDeliveryReceiptEventName(receiptEvent)
      ) {
        return jsonResponse({ error: "Invalid payload" }, 400);
      }

      const deliveryKind = trimmedString(
        body.delivery_kind ?? body.deliveryKind,
      ) ?? inferMaatDeliveryKindFromKey(deliveryKey);
      const result = await recordMaatDeliveryReceiptEvent(client, {
        deliveryKey,
        deliveryKind,
        userId: user.id,
        deviceId: trimmedString(body.device_id ?? body.deviceId),
        platform: trimmedString(body.platform),
        messageId: trimmedString(body.message_id ?? body.messageId),
        receiptEvent,
        eventAt: trimmedString(body.event_at ?? body.eventAt) ??
          nowFn().toISOString(),
        metadata: {
          source: "record_delivery_receipt",
          ...recordMetadata(body.metadata),
        },
      });

      if (!result.ok) {
        return jsonResponse({ error: result.error ?? "Insert failed" }, 500);
      }
      return jsonResponse({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      console.error("record_delivery_receipt error", error);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createRecordDeliveryReceiptHandler());
}
