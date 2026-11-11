// deno-lint-ignore-file no-import-prefix

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  type MaatGuidanceDeliveryChannel,
  type MaatGuidanceTelemetryEventMetadata,
  mergeMaatOutputTelemetry,
} from "../_shared/maat_output_telemetry.ts";
import { recordMaatDeliveryReceiptEvent } from "../_shared/maat_delivery_receipt.ts";
import { recordMaatRestorationOutcome } from "../_shared/maat_ledger.ts";

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

type SupabaseClientLike = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error?: unknown;
    }>;
  };
  // Edge tests inject a lightweight table builder; production passes Supabase.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

const ACTIONS = new Set(["shown", "dismissed", "opened", "acted", "expired"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function telemetryMetadataFromBody(
  metadata: Record<string, unknown> | undefined,
): MaatGuidanceTelemetryEventMetadata {
  const deliveryChannel = metadata?.delivery_channel;
  const userSessionState = metadata?.user_session_state;
  const localHour = metadata?.local_hour_shown ?? metadata?.local_hour;
  const wasInterruptive = metadata?.was_interruptive;
  return {
    deliveryChannel:
      deliveryChannel === "push" || deliveryChannel === "in_app_card" ||
        deliveryChannel === "archive_only"
        ? deliveryChannel as MaatGuidanceDeliveryChannel
        : null,
    userSessionState:
      userSessionState === "active" || userSessionState === "inactive" ||
        userSessionState === "returning"
        ? userSessionState
        : null,
    localHourShown: typeof localHour === "number" &&
        Number.isFinite(localHour)
      ? Math.max(0, Math.min(23, Math.trunc(localHour)))
      : null,
    wasInterruptive: typeof wasInterruptive === "boolean"
      ? wasInterruptive
      : null,
  };
}

async function logMaatChoiceEvent(params: {
  client: SupabaseClientLike;
  userId: string;
  eventType: string;
  metadata: Record<string, unknown>;
}) {
  const { error } = await params.client.from("user_choice_events").insert({
    user_id: params.userId,
    event_type: params.eventType,
    metadata: {
      source: "maat_guidance",
      ...params.metadata,
    },
  });
  if (error) {
    console.error(`maat event insert error:${params.eventType}`, error);
  }
}

export function createAckMaatGuidanceHandler(options?: {
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
      const token = authHeader?.replace("Bearer ", "");
      if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(token);
      if (userError || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const body = await req.json().catch(() => ({})) as {
        delivery_id?: string;
        action?: string;
        metadata?: Record<string, unknown>;
      };
      const deliveryId = body.delivery_id?.trim();
      const action = body.action?.trim();
      if (!deliveryId || !action || !ACTIONS.has(action)) {
        return jsonResponse({ error: "Invalid payload" }, 400);
      }

      const { data: existing, error: fetchError } = await client
        .from("maat_guidance_deliveries")
        .select(
          "id,status,user_id,kind,decan_period_key,cta_type,cta_ref,payload,created_at,shown_at,opened_at,dismissed_at,acted_at,expired_at",
        )
        .eq("id", deliveryId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (fetchError) {
        console.error("ack fetch error", fetchError);
        return jsonResponse({ error: "Fetch error" }, 500);
      }
      if (!existing) return jsonResponse({ error: "Not found" }, 404);

      const now = nowFn().toISOString();
      const update: Record<string, unknown> = {};

      if (action === "shown") {
        update.shown_at = existing.shown_at ?? now;
        if (existing.status === "pending") update.status = "shown";
      } else if (action === "dismissed") {
        update.status = "dismissed";
        update.dismissed_at = now;
      } else if (action === "opened") {
        update.status = "opened";
        update.opened_at = now;
        if (!existing.shown_at) update.shown_at = now;
      } else if (action === "acted") {
        update.status = "acted";
        update.acted_at = now;
        if (!existing.opened_at) update.opened_at = now;
        if (!existing.shown_at) update.shown_at = now;
      } else if (action === "expired") {
        update.status = "expired";
        update.expired_at = now;
      }

      update.payload = mergeMaatOutputTelemetry({
        payload: existing.payload,
        action: action as
          | "shown"
          | "dismissed"
          | "opened"
          | "acted"
          | "expired",
        nowIso: now,
        delivery: {
          id: existing.id,
          kind: existing.kind,
          decanPeriodKey: existing.decan_period_key,
          status: String(update.status ?? existing.status),
          createdAt: existing.created_at ?? null,
          shownAt: typeof update.shown_at === "string"
            ? update.shown_at
            : existing.shown_at ?? null,
          openedAt: typeof update.opened_at === "string"
            ? update.opened_at
            : existing.opened_at ?? null,
          dismissedAt: typeof update.dismissed_at === "string"
            ? update.dismissed_at
            : existing.dismissed_at ?? null,
          actedAt: typeof update.acted_at === "string"
            ? update.acted_at
            : existing.acted_at ?? null,
          expiredAt: typeof update.expired_at === "string"
            ? update.expired_at
            : existing.expired_at ?? null,
        },
        eventMetadata: telemetryMetadataFromBody(body.metadata),
      });

      const { data, error: updateError } = await client
        .from("maat_guidance_deliveries")
        .update(update)
        .eq("id", deliveryId)
        .eq("user_id", user.id)
        .select()
        .single();
      if (updateError) {
        console.error("ack update error", updateError);
        return jsonResponse({ error: "Update error" }, 500);
      }

      await recordMaatDeliveryReceiptEvent(client, {
        deliveryKey: `maat_guidance:${deliveryId}`,
        deliveryKind: String(existing.kind ?? "maat_guidance"),
        userId: user.id,
        receiptEvent: action as
          | "shown"
          | "dismissed"
          | "opened"
          | "acted"
          | "expired",
        eventAt: now,
        metadata: {
          source: "ack_maat_guidance",
          status: String(update.status ?? existing.status),
          decan_period_key: existing.decan_period_key ?? null,
          ...(body.metadata && typeof body.metadata === "object"
            ? body.metadata
            : {}),
        },
      });
      await recordMaatRestorationOutcome({
        client,
        userId: user.id,
        deliveryId,
        action: action as
          | "shown"
          | "dismissed"
          | "opened"
          | "acted"
          | "expired",
        metadata: body.metadata && typeof body.metadata === "object"
          ? body.metadata
          : null,
        nowIso: now,
      });

      if (action === "dismissed" && existing.kind === "drift_nudge") {
        const { data: dismissedCorrections, error: correctionDismissError } =
          await client
            .from("maat_corrections")
            .update({ status: "dismissed", dismissed_at: now })
            .eq("user_id", user.id)
            .eq("decan_period_key", existing.decan_period_key)
            .eq("status", "open")
            .select("id");
        if (correctionDismissError) {
          console.error(
            "maat correction dismiss error",
            correctionDismissError,
          );
        } else {
          for (const correction of dismissedCorrections ?? []) {
            await logMaatChoiceEvent({
              client,
              userId: user.id,
              eventType: "maat_correction_dismissed",
              metadata: {
                correction_id: correction.id,
                delivery_id: deliveryId,
                decan_period_key: existing.decan_period_key,
                completion_source: "drift_dismissed",
              },
            });
          }
        }
      }

      if (action === "acted") {
        const metadata = {
          source: "maat_guidance",
          delivery_id: deliveryId,
          cta_type: existing.cta_type,
          cta_ref: existing.cta_ref,
          ...(body.metadata && typeof body.metadata === "object"
            ? body.metadata
            : {}),
        };
        await client.from("user_choice_events").insert({
          user_id: user.id,
          event_type: "suggestion_accepted",
          metadata,
        });
        if (
          existing.cta_type === "flow_personalized" &&
          body.metadata &&
          typeof body.metadata === "object"
        ) {
          const updateBrief: Record<string, unknown> = {
            generated_at: now,
          };
          if (typeof body.metadata.generation_id === "string") {
            updateBrief.generation_id = body.metadata.generation_id;
          }
          if (typeof body.metadata.flow_id === "number") {
            updateBrief.flow_id = body.metadata.flow_id;
          }
          const { error: briefUpdateError } = await client
            .from("maat_flow_briefs")
            .update(updateBrief)
            .eq("user_id", user.id)
            .eq("delivery_id", deliveryId);
          if (briefUpdateError) {
            console.error(
              "maat flow brief acted update error",
              briefUpdateError,
            );
          }
        }
        if (existing.kind === "drift_nudge") {
          const { data: completedCorrections, error: correctionUpdateError } =
            await client
              .from("maat_corrections")
              .update({
                status: "completed",
                completed_at: now,
              })
              .eq("user_id", user.id)
              .eq("decan_period_key", existing.decan_period_key)
              .eq("status", "open")
              .select("id");
          if (correctionUpdateError) {
            console.error(
              "maat correction completion error",
              correctionUpdateError,
            );
          } else {
            for (const correction of completedCorrections ?? []) {
              await logMaatChoiceEvent({
                client,
                userId: user.id,
                eventType: "maat_correction_completed",
                metadata: {
                  correction_id: correction.id,
                  delivery_id: deliveryId,
                  decan_period_key: existing.decan_period_key,
                  completion_source: "drift_cta_acted",
                },
              });
            }
          }
        }
      }

      return jsonResponse({ delivery: data });
    } catch (err) {
      console.error("ack_maat_guidance error", err);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createAckMaatGuidanceHandler());
}
