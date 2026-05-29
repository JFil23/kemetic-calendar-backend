import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  computeCurrentAndNextDecanWindows,
  normalizeTimeZone,
} from "../_shared/decan_schedule.ts";
import {
  type DecanContext,
  getDecanContext,
} from "../_shared/decan_context.ts";
import {
  buildDecanOpeningDraft,
  buildGuidanceSnapshot,
  type DayCardGuidanceInput,
  DECAN_CONTEXT_OPENING_SOURCE,
  DECAN_CONTEXT_OPENING_TRACK,
  decanPeriodKey,
  type GuidanceWindow,
} from "../_shared/maat_guidance.ts";
import {
  deliveryChannelFromPayload,
  mergeMaatOutputTelemetry,
} from "../_shared/maat_output_telemetry.ts";
import {
  recordMaatDeliveryTimingEvent,
} from "../_shared/maat_delivery_timing.ts";
import { resolveCompiledPackagePushText } from "../_shared/output_compiler.ts";

type SupabaseClientLike = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
  from: (table: string) => any;
};

function createDefaultClient(): SupabaseClientLike {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase service role environment");
  }
  return createClient(
    supabaseUrl,
    serviceRoleKey,
  ) as unknown as SupabaseClientLike;
}

type Payload = {
  timezone?: string | null;
  decan_start?: string;
  decan_end?: string;
  decan_name?: string | null;
  decan_theme?: string | null;
  decan_context_key?: string | null;
  day_card?: DayCardGuidanceInput | null;
  limit?: number | string;
  batch_size?: number | string;
  max_runtime_ms?: number | string;
  scheduled_at?: string | null;
};

type OpeningCronResult = {
  user_id: string;
  delivery?: unknown;
  created?: boolean;
  enriched?: boolean;
  refreshed?: boolean;
  push_sent?: boolean;
  push_skipped?: string;
  push_error?: string;
  error?: string;
};

type OpeningPushResult = {
  ok: boolean;
  status?: number;
  data?: unknown;
  sent?: number;
  delivered?: boolean;
  reason?: string | null;
  error?: string | null;
};

type OpeningPushSender = (params: {
  userId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}) => Promise<OpeningPushResult>;

function createDefaultOpeningPushSender(): OpeningPushSender {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL");
  const internalFunctionKey = Deno.env.get("INTERNAL_FUNCTION_KEY");

  return async ({ userId, title, body, data }) => {
    if (!supabaseUrl) {
      return { ok: false, error: "Missing Supabase URL environment" };
    }
    if (!internalFunctionKey) {
      return { ok: false, error: "INTERNAL_FUNCTION_KEY not configured" };
    }

    const res = await fetch(new URL("/functions/v1/send_push", supabaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": internalFunctionKey,
      },
      body: JSON.stringify({
        userIds: [userId],
        notification: { title, body },
        data,
      }),
    });
    const text = await res.text();
    let parsed: unknown = text;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else {
      parsed = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: parsed,
        error: typeof parsed === "string" ? parsed : `send_push ${res.status}`,
      };
    }

    const result = isRecord(parsed) ? parsed : {};
    const sent = typeof result.sent === "number" ? result.sent : 0;
    const delivered = result.delivered === true || sent > 0;
    const reason = typeof result.reason === "string" ? result.reason : null;
    return {
      ok: delivered,
      status: res.status,
      data: parsed,
      sent,
      delivered,
      reason,
      error: delivered ? null : reason ?? "push_not_delivered",
    };
  };
}

function boundedInteger(
  value: number | string | null | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed as number)));
}

function hasDayCardSignal(dayCard?: DayCardGuidanceInput | null) {
  if (!dayCard) return false;
  return Boolean(
    dayCard.date?.trim() ||
      dayCard.maatPrinciple?.trim() ||
      dayCard.decanDayAction?.trim() ||
      dayCard.decanDayTheme?.trim() ||
      dayCard.decanDayReflection?.trim(),
  );
}

function dayOneCardFromContext(
  decanContext: DecanContext | null,
  date: string,
): DayCardGuidanceInput | null {
  const firstCard = decanContext?.dayCards?.[0] ?? null;
  if (!firstCard) return null;
  return {
    date,
    maatPrinciple: firstCard.theme,
    decanDayTheme: firstCard.theme,
    decanDayAction: firstCard.action,
    decanDayReflection: firstCard.reflection,
  };
}

function resolveOpeningDayCard(params: {
  requested?: DayCardGuidanceInput | null;
  decanContext: DecanContext | null;
  decanStart: string;
}): DayCardGuidanceInput | null {
  return hasDayCardSignal(params.requested)
    ? params.requested!
    : dayOneCardFromContext(params.decanContext, params.decanStart);
}

function existingOpeningCanBeUpdated(existing: Record<string, unknown>) {
  const status = typeof existing.status === "string" ? existing.status : "";
  return status === "pending" || status === "shown" || status === "opened";
}

function existingOpeningHasDayCard(existing: Record<string, unknown>) {
  const payload = existing.payload && typeof existing.payload === "object"
    ? existing.payload as Record<string, unknown>
    : {};
  return Boolean(payload.day_card_date);
}

function existingOpeningNeedsRefresh(existing: Record<string, unknown>) {
  if (!existingOpeningCanBeUpdated(existing)) return false;

  const payload = existing.payload && typeof existing.payload === "object"
    ? existing.payload as Record<string, unknown>
    : {};
  const ctaType = typeof existing.cta_type === "string"
    ? existing.cta_type
    : "";
  const ctaRef = typeof existing.cta_ref === "string" ? existing.cta_ref : "";
  const nodeRef = typeof payload.node_ref === "string" ? payload.node_ref : "";
  const outputControl = payload.output_control &&
      typeof payload.output_control === "object"
    ? payload.output_control as Record<string, unknown>
    : null;
  const compiledPackage = payload.compiled_output_package &&
      typeof payload.compiled_output_package === "object"
    ? payload.compiled_output_package as Record<string, unknown>
    : null;
  const deliveryTrack = typeof payload.delivery_track === "string"
    ? payload.delivery_track
    : typeof payload.notification_track === "string"
    ? payload.notification_track
    : "";
  const contentSource = typeof payload.content_source === "string"
    ? payload.content_source
    : "";
  const teaser = typeof existing.teaser_text === "string"
    ? existing.teaser_text
    : "";
  const body = typeof existing.body_text === "string" ? existing.body_text : "";

  const destination = compiledPackage?.destination &&
      typeof compiledPackage.destination === "object" &&
      !Array.isArray(compiledPackage.destination)
    ? compiledPackage.destination as Record<string, unknown>
    : null;

  return ctaType !== "flow_template" ||
    !ctaRef.trim() ||
    !nodeRef.trim() ||
    typeof destination?.ref !== "string" ||
    !destination.ref.trim() ||
    deliveryTrack !== DECAN_CONTEXT_OPENING_TRACK ||
    contentSource !== DECAN_CONTEXT_OPENING_SOURCE ||
    payload.profile_personalization_used !== false ||
    !outputControl ||
    compiledPackage?.package_version !== "compiled_output_package_v1" ||
    teaser.includes("Today's card names") ||
    body.includes("Today's card names");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function timestampString(value: unknown) {
  const text = cleanString(value);
  return text ? text : null;
}

function boundedAttemptCount(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function openingPushErrorMessage(result: OpeningPushResult) {
  if (result.error) return cleanString(result.error) || "push_not_delivered";
  if (result.reason) return cleanString(result.reason) || "push_not_delivered";
  const data = isRecord(result.data) ? result.data : null;
  const error = data && isRecord(data.error) ? data.error : data?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (isRecord(error) && typeof error.message === "string") {
    return error.message.trim() || "push_not_delivered";
  }
  return "push_not_delivered";
}

function openingPushPayload(delivery: Record<string, unknown>) {
  return isRecord(delivery.payload) ? delivery.payload : {};
}

function openingCompiledPackage(payload: Record<string, unknown>) {
  const compiled = payload.compiled_output_package;
  return isRecord(compiled) ? compiled : null;
}

function openingCtaValue(
  delivery: Record<string, unknown>,
  compiledPackage: Record<string, unknown> | null,
  field: "type" | "ref",
) {
  const deliveryField = field === "type" ? "cta_type" : "cta_ref";
  const fromDelivery = cleanString(delivery[deliveryField]);
  if (fromDelivery) return fromDelivery;
  const cta = compiledPackage && isRecord(compiledPackage.cta)
    ? compiledPackage.cta
    : null;
  return cleanString(cta?.[field]);
}

async function updateOpeningPushState(params: {
  client: SupabaseClientLike;
  userId: string;
  deliveryId: string;
  values: Record<string, unknown>;
}) {
  const { data, error } = await params.client
    .from("maat_guidance_deliveries")
    .update(params.values)
    .eq("id", params.deliveryId)
    .eq("user_id", params.userId)
    .select()
    .single();
  if (error) {
    console.error("opening push state update error", error);
    return null;
  }
  return isRecord(data) ? data : null;
}

async function sendOpeningPushIfEligible(params: {
  client: SupabaseClientLike;
  sendPush: OpeningPushSender;
  userId: string;
  delivery: unknown;
  now: Date;
}): Promise<Partial<OpeningCronResult> & { delivery?: unknown }> {
  if (!isRecord(params.delivery)) {
    return { push_skipped: "missing_delivery" };
  }

  const delivery = params.delivery;
  const deliveryId = cleanString(delivery.id);
  if (!deliveryId) return { push_skipped: "missing_delivery_id" };
  if (timestampString(delivery.push_sent_at)) {
    return { push_skipped: "already_sent" };
  }
  const status = cleanString(delivery.status);
  if (status === "archive_only") {
    return { push_skipped: "archive_only" };
  }
  if (
    status === "dismissed" || status === "opened" || status === "acted" ||
    status === "expired"
  ) {
    return { push_skipped: `status_${status}` };
  }

  const attemptCount = boundedAttemptCount(delivery.push_attempt_count);
  if (attemptCount >= 3) {
    return { push_skipped: "attempt_limit" };
  }

  const payload = openingPushPayload(delivery);
  const compiledPackage = openingCompiledPackage(payload);
  const pushResolution = resolveCompiledPackagePushText({
    payload,
    legacyTeaserText: delivery.teaser_text,
    legacyBodyText: delivery.body_text,
  });
  const nowIso = params.now.toISOString();
  const nextAttemptCount = attemptCount + 1;

  if (pushResolution.blocked) {
    const pushError = pushResolution.reason ?? pushResolution.source;
    const updated = await updateOpeningPushState({
      client: params.client,
      userId: params.userId,
      deliveryId,
      values: {
        push_error: pushError,
        push_attempt_count: nextAttemptCount,
        push_last_attempt_at: nowIso,
      },
    });
    return {
      delivery: updated ?? delivery,
      push_error: pushError,
    };
  }

  const ctaKind = openingCtaValue(delivery, compiledPackage, "type");
  const ctaId = openingCtaValue(delivery, compiledPackage, "ref");
  const destination = compiledPackage && isRecord(compiledPackage.destination)
    ? compiledPackage.destination
    : isRecord(payload.destination)
    ? payload.destination
    : null;
  const deepLink = `/maat-guidance/${encodeURIComponent(deliveryId)}`;
  const body = pushResolution.text ||
    cleanString(delivery.teaser_text) ||
    "Open today's Ma'at guidance.";
  let result: OpeningPushResult;
  try {
    result = await params.sendPush({
      userId: params.userId,
      title: "A new decan opens",
      body,
      data: {
        kind: "maat_guidance",
        guidance_id: deliveryId,
        delivery_id: deliveryId,
        guidance_kind: DECAN_CONTEXT_OPENING_TRACK,
        deep_link: deepLink,
        link: deepLink,
        url: deepLink,
        delivery_key: `maat_guidance:${deliveryId}`,
        delivery_kind: "decan_opening",
        cta_kind: ctaKind || null,
        cta_id: ctaId || null,
        cta_type: ctaKind || null,
        cta_ref: ctaId || null,
        ...(destination ? { destination } : {}),
        ...(compiledPackage
          ? { compiled_output_package: compiledPackage }
          : {}),
      },
    });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (result.ok) {
    const updated = await updateOpeningPushState({
      client: params.client,
      userId: params.userId,
      deliveryId,
      values: {
        push_sent_at: nowIso,
        push_error: null,
        push_attempt_count: nextAttemptCount,
        push_last_attempt_at: nowIso,
      },
    });
    return {
      delivery: updated ?? delivery,
      push_sent: true,
    };
  }

  const pushError = openingPushErrorMessage(result);
  const updated = await updateOpeningPushState({
    client: params.client,
    userId: params.userId,
    deliveryId,
    values: {
      push_error: pushError,
      push_attempt_count: nextAttemptCount,
      push_last_attempt_at: nowIso,
    },
  });
  return {
    delivery: updated ?? delivery,
    push_error: pushError,
  };
}

async function recordOpeningDeliveryOutcome(params: {
  client: SupabaseClientLike;
  userId: string;
  result: OpeningCronResult;
  scheduledFor: string;
  functionStartedAt: string;
  deliveredAt: string;
}) {
  if (!isRecord(params.result.delivery)) return;
  const delivery = params.result.delivery;
  const deliveryId = typeof delivery.id === "string" ? delivery.id : "";
  if (!deliveryId) return;
  const status = delivery.status === "archive_only" ? "skipped" : "sent";
  const deliveryPayload = isRecord(delivery.payload) ? delivery.payload : {};
  const pushResolution = resolveCompiledPackagePushText({
    payload: deliveryPayload,
  });
  const notificationTrack =
    typeof deliveryPayload.notification_track === "string"
      ? deliveryPayload.notification_track
      : typeof deliveryPayload.delivery_track === "string"
      ? deliveryPayload.delivery_track
      : DECAN_CONTEXT_OPENING_TRACK;
  const baseEvent = {
    deliveryKey: `maat_guidance:${deliveryId}`,
    deliveryKind: "decan_opening",
    targetTable: "maat_guidance_deliveries",
    targetId: deliveryId,
    userId: params.userId,
    scheduledFor: params.scheduledFor,
    functionStartedAt: params.functionStartedAt,
    cronJobName: "maat_guidance_decan_opening_hourly",
    deliveryAttempt: 1,
    metadata: {
      created: params.result.created === true,
      enriched: params.result.enriched === true,
      refreshed: params.result.refreshed === true,
      os_push_sent: params.result.push_sent === true,
      os_push_skipped: params.result.push_skipped ?? null,
      os_push_error: params.result.push_error ?? null,
      notification_track: notificationTrack,
      delivery_track: notificationTrack,
      content_source: typeof deliveryPayload.content_source === "string"
        ? deliveryPayload.content_source
        : DECAN_CONTEXT_OPENING_SOURCE,
      profile_personalization_used:
        deliveryPayload.profile_personalization_used === true ? true : false,
      decan_period_key: typeof delivery.decan_period_key === "string"
        ? delivery.decan_period_key
        : null,
      push_source: pushResolution.source,
      push_blocked: pushResolution.blocked,
      push_block_reason: pushResolution.reason,
      package_version: pushResolution.packageVersion,
      compiler_status: pushResolution.compilerStatus,
    },
  };
  await recordMaatDeliveryTimingEvent(params.client, {
    ...baseEvent,
    cronPickedAt: params.functionStartedAt,
    deliveryStatus: "picked",
  });
  await recordMaatDeliveryTimingEvent(params.client, {
    ...baseEvent,
    deliveredAt: params.deliveredAt,
    deliveryStatus: status,
    skipReason: status === "skipped" ? "archive_only" : null,
  });
}

function payloadWindow(
  body: Payload,
  timezone: string,
  now = new Date(),
): GuidanceWindow | null {
  const start = body.decan_start?.trim();
  const end = body.decan_end?.trim();
  if (start && end) {
    return {
      start,
      end,
      decanName: body.decan_name?.trim() || `Decan ${start}`,
      decanTheme: body.decan_theme?.trim() || null,
      decanContextKey: body.decan_context_key?.trim() || null,
    };
  }

  const current = computeCurrentAndNextDecanWindows(now, timezone)[0];
  if (!current) return null;
  return {
    start: current.start,
    end: current.end,
    decanName: current.decanName,
    decanTheme: current.decanTheme,
    decanContextKey: current.decanContextKey,
  };
}

async function expireStaleDeliveries(
  client: SupabaseClientLike,
  userId: string,
  currentPeriodKey: string,
  now: Date,
) {
  const nowIso = now.toISOString();
  const { error } = await client
    .from("maat_guidance_deliveries")
    .update({ status: "expired", expired_at: nowIso })
    .eq("user_id", userId)
    .in("status", ["pending", "shown"])
    .neq("decan_period_key", currentPeriodKey);
  if (error) {
    console.error("opening stale delivery expiry error", error);
  }
}

async function buildAndPersistOpeningDraft(params: {
  client: SupabaseClientLike;
  userId: string;
  body: Payload;
  window: GuidanceWindow;
  periodKey: string;
}) {
  const { client, userId, body, window, periodKey } = params;
  const decanContext = getDecanContext(window.decanContextKey);
  const emptySnapshot = buildGuidanceSnapshot({
    window,
    decanContext,
    badges: [],
  });
  const dayCard = resolveOpeningDayCard({
    requested: body.day_card ?? null,
    decanContext,
    decanStart: window.start,
  });
  const draft = buildDecanOpeningDraft({
    window,
    decanContext,
    dayCard,
    snapshot: emptySnapshot,
  });

  const { data: generation, error: generationError } = await client
    .from("reflection_generations")
    .insert({
      user_id: userId,
      period_type: "decan_opening",
      period_key: periodKey,
      anchor_nodes: [],
      source_snapshot: {
        notification_track: DECAN_CONTEXT_OPENING_TRACK,
        delivery_track: DECAN_CONTEXT_OPENING_TRACK,
        content_source: DECAN_CONTEXT_OPENING_SOURCE,
        source_scope: "calendar_context_only",
        profile_personalization_used: false,
        decan_name: window.decanName,
        decan_theme: window.decanTheme ?? null,
        decan_context_key: window.decanContextKey ?? null,
        month_key: decanContext?.monthKey ?? null,
        month_short: decanContext?.monthShort ?? null,
        decan_number: decanContext?.decan ?? null,
        decan_short_name: decanContext?.shortName ?? null,
        decan_display_name: decanContext?.displayName ?? null,
        decan_label: decanContext?.defaultLabel ?? null,
        decan_start: window.start,
        decan_end: window.end,
        day_card: dayCard,
      },
      generated_text: draft.bodyText,
      model_version: "local-maat-guidance-v1",
      metadata: {
        notification_track: DECAN_CONTEXT_OPENING_TRACK,
        delivery_track: DECAN_CONTEXT_OPENING_TRACK,
        content_source: DECAN_CONTEXT_OPENING_SOURCE,
        source_scope: "calendar_context_only",
        profile_personalization_used: false,
        kind: draft.kind,
        lead_axis: draft.payload.lead_axis,
        reflection_move: draft.payload.reflection_move,
        hard_gates: draft.payload.hard_gates,
        day_card_source: hasDayCardSignal(body.day_card)
          ? "request"
          : dayCard
          ? "decan_context_day1"
          : "none",
        output_control: draft.payload.output_control ?? null,
        surface_variants: draft.payload.surface_variants ?? null,
      },
    })
    .select("id")
    .single();
  if (generationError) {
    console.error("opening generation insert error", generationError);
    throw new Error("Generation persist error");
  }

  return { draft, generationId: generation.id as string };
}

async function ensureOpeningForUser(params: {
  client: SupabaseClientLike;
  userId: string;
  body: Payload;
  timezone: string;
  now: Date;
}) {
  const { client, userId, body, timezone, now } = params;
  const window = payloadWindow(body, timezone, now);
  if (!window) {
    throw new Error("No active canonical decan");
  }

  const periodKey = decanPeriodKey(window);
  await expireStaleDeliveries(client, userId, periodKey, now);

  const { data: existing, error: existingError } = await client
    .from("maat_guidance_deliveries")
    .select("*")
    .eq("user_id", userId)
    .eq("decan_period_key", periodKey)
    .eq("kind", "decan_opening")
    .maybeSingle();
  if (existingError) {
    console.error("opening existing lookup error", existingError);
    throw new Error("Lookup error");
  }

  if (existing) {
    const existingRecord = existing as Record<string, unknown>;
    const decanContext = getDecanContext(window.decanContextKey);
    const resolvedDayCard = resolveOpeningDayCard({
      requested: body.day_card ?? null,
      decanContext,
      decanStart: window.start,
    });
    const hasDayCard = hasDayCardSignal(resolvedDayCard);
    const needsRefresh = existingOpeningNeedsRefresh(existingRecord);
    const shouldEnrich = hasDayCard &&
      existingOpeningCanBeUpdated(existingRecord) &&
      (!existingOpeningHasDayCard(existingRecord) ||
        needsRefresh);
    const shouldRefresh = !hasDayCard &&
      !existingOpeningHasDayCard(existingRecord) &&
      needsRefresh;

    if (shouldEnrich || shouldRefresh) {
      const { draft, generationId } = await buildAndPersistOpeningDraft({
        client,
        userId,
        body,
        window,
        periodKey,
      });
      const refreshedPayload = mergeMaatOutputTelemetry({
        payload: draft.payload,
        action: "generated",
        nowIso: now.toISOString(),
        delivery: {
          id: String(existing.id ?? ""),
          kind: draft.kind,
          decanPeriodKey: periodKey,
          status: String(existingRecord.status ?? "pending"),
          createdAt: typeof existingRecord.created_at === "string"
            ? existingRecord.created_at
            : null,
          shownAt: typeof existingRecord.shown_at === "string"
            ? existingRecord.shown_at
            : null,
          openedAt: typeof existingRecord.opened_at === "string"
            ? existingRecord.opened_at
            : null,
          dismissedAt: typeof existingRecord.dismissed_at === "string"
            ? existingRecord.dismissed_at
            : null,
          actedAt: typeof existingRecord.acted_at === "string"
            ? existingRecord.acted_at
            : null,
          expiredAt: typeof existingRecord.expired_at === "string"
            ? existingRecord.expired_at
            : null,
        },
      });
      const currentStatus = typeof existingRecord.status === "string"
        ? existingRecord.status
        : "pending";
      const refreshedStatus = currentStatus === "pending" &&
          deliveryChannelFromPayload(refreshedPayload) === "archive_only"
        ? "archive_only"
        : currentStatus;
      const { data: delivery, error: updateError } = await client
        .from("maat_guidance_deliveries")
        .update({
          status: refreshedStatus,
          priority: draft.priority,
          teaser_text: draft.teaserText,
          body_text: draft.bodyText,
          payload: refreshedPayload,
          cta_type: draft.ctaType,
          cta_ref: draft.ctaRef,
          generation_id: generationId,
          trigger_reason: draft.triggerReason,
        })
        .eq("id", existing.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (updateError) {
        console.error("opening delivery update error", updateError);
        throw new Error("Delivery update error");
      }
      return {
        delivery,
        created: false,
        enriched: shouldEnrich,
        refreshed: shouldRefresh,
      };
    }
    return {
      delivery: existing,
      created: false,
      enriched: false,
      refreshed: false,
    };
  }

  const { draft, generationId } = await buildAndPersistOpeningDraft({
    client,
    userId,
    body,
    window,
    periodKey,
  });
  const payload = mergeMaatOutputTelemetry({
    payload: draft.payload,
    action: "generated",
    nowIso: now.toISOString(),
    delivery: {
      id: "",
      kind: draft.kind,
      decanPeriodKey: periodKey,
      status: "pending",
      createdAt: null,
    },
  });
  const deliveryStatus = deliveryChannelFromPayload(payload) === "archive_only"
    ? "archive_only"
    : "pending";

  const { data: delivery, error: insertError } = await client
    .from("maat_guidance_deliveries")
    .insert({
      user_id: userId,
      kind: draft.kind,
      decan_period_key: periodKey,
      status: deliveryStatus,
      priority: draft.priority,
      teaser_text: draft.teaserText,
      body_text: draft.bodyText,
      payload,
      cta_type: draft.ctaType,
      cta_ref: draft.ctaRef,
      generation_id: generationId,
      trigger_reason: draft.triggerReason,
    })
    .select()
    .single();
  if (insertError) {
    console.error("opening delivery insert error", insertError);
    throw new Error("Delivery persist error");
  }

  return { delivery, created: true, enriched: false, refreshed: false };
}

export function createCronMaatDecanOpeningHandler(options?: {
  client?: SupabaseClientLike;
  sendPush?: OpeningPushSender;
  now?: () => Date;
}) {
  const client = options?.client ?? createDefaultClient();
  const sendPush = options?.sendPush ?? createDefaultOpeningPushSender();
  const nowFn = options?.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const now = nowFn();
      const body = await req.json().catch(() => ({})) as Payload;
      const authHeader = req.headers.get("authorization");
      const token = authHeader?.replace("Bearer ", "");

      if (token) {
        const {
          data: { user },
          error: userError,
        } = await client.auth.getUser(token);
        if (userError || !user) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }

        const { data: profileRow } = await client
          .from("profiles")
          .select("timezone")
          .eq("id", user.id)
          .maybeSingle();
        const timezone = normalizeTimeZone(
          body.timezone ?? profileRow?.timezone ?? null,
        );
        const result = await ensureOpeningForUser({
          client,
          userId: user.id,
          body,
          timezone,
          now,
        });
        return jsonResponse(result);
      }

      const cronSecret = Deno.env.get("MAAT_CRON_SECRET") ??
        Deno.env.get("CRON_SECRET");
      const providedSecret = req.headers.get("x-cron-secret");
      if (!cronSecret || providedSecret !== cronSecret) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const maxProfiles = boundedInteger(
        body.limit ?? Deno.env.get("MAAT_OPENING_PROFILE_LIMIT"),
        5000,
        1,
        20000,
      );
      const batchSize = boundedInteger(
        body.batch_size ?? Deno.env.get("MAAT_OPENING_BATCH_SIZE"),
        500,
        1,
        1000,
      );
      const maxRuntimeMs = boundedInteger(
        body.max_runtime_ms ?? Deno.env.get("MAAT_OPENING_MAX_RUNTIME_MS"),
        45000,
        1000,
        120000,
      );

      const results: OpeningCronResult[] = [];
      const startedAt = Date.now();
      const functionStartedAt = new Date(startedAt).toISOString();
      const scheduledFor = typeof body.scheduled_at === "string" &&
          body.scheduled_at.trim()
        ? body.scheduled_at.trim()
        : now.toISOString();
      let offset = 0;
      let batches = 0;
      let drained = false;
      let exhaustedRuntime = false;

      while (results.length < maxProfiles) {
        if (Date.now() - startedAt >= maxRuntimeMs) {
          exhaustedRuntime = true;
          break;
        }

        const remaining = maxProfiles - results.length;
        const pageSize = Math.min(batchSize, remaining);
        const { data: profileRows, error: profileError } = await client
          .from("profiles")
          .select("id,timezone")
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (profileError) {
          console.error("opening cron profiles lookup error", profileError);
          return jsonResponse({ error: "Profile lookup error" }, 500);
        }

        const rows = profileRows ?? [];
        if (!rows.length) {
          drained = true;
          break;
        }

        batches += 1;
        for (const profile of rows) {
          const timezone = normalizeTimeZone(body.timezone ?? profile.timezone);
          try {
            const result = await ensureOpeningForUser({
              client,
              userId: profile.id,
              body,
              timezone,
              now,
            });
            const pushOutcome = await sendOpeningPushIfEligible({
              client,
              sendPush,
              userId: profile.id,
              delivery: result.delivery,
              now,
            });
            const cronResult = {
              user_id: profile.id,
              ...result,
              ...pushOutcome,
            };
            if (
              cronResult.created === true || cronResult.enriched === true ||
              cronResult.refreshed === true ||
              cronResult.push_sent === true ||
              typeof cronResult.push_error === "string"
            ) {
              await recordOpeningDeliveryOutcome({
                client,
                userId: profile.id,
                result: cronResult,
                scheduledFor,
                functionStartedAt,
                deliveredAt: new Date().toISOString(),
              });
            }
            results.push(cronResult);
          } catch (err) {
            await recordMaatDeliveryTimingEvent(client, {
              deliveryKey: `decan_opening:${profile.id}:${scheduledFor}`,
              deliveryKind: "decan_opening",
              targetTable: "profiles",
              targetId: profile.id,
              userId: profile.id,
              scheduledFor,
              functionStartedAt,
              deliveredAt: new Date().toISOString(),
              cronJobName: "maat_guidance_decan_opening_hourly",
              deliveryAttempt: 1,
              deliveryStatus: "failed",
              errorCode: "opening_exception",
              metadata: {
                notification_track: DECAN_CONTEXT_OPENING_TRACK,
                delivery_track: DECAN_CONTEXT_OPENING_TRACK,
                content_source: DECAN_CONTEXT_OPENING_SOURCE,
                timezone,
                error: err instanceof Error ? err.message : String(err),
              },
            });
            results.push({
              user_id: profile.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        offset += rows.length;
        if (rows.length < pageSize) {
          drained = true;
          break;
        }
      }

      return jsonResponse({
        processed: results.length,
        created: results.filter((row) => row.created === true).length,
        enriched: results.filter((row) => row.enriched === true).length,
        refreshed: results.filter((row) => row.refreshed === true).length,
        push_sent: results.filter((row) => row.push_sent === true).length,
        push_failed: results.filter((row) => row.push_error).length,
        push_skipped: results.filter((row) => row.push_skipped).length,
        failed: results.filter((row) => row.error).length,
        batches,
        drained,
        exhausted_runtime: exhaustedRuntime,
        exhausted_limit: results.length >= maxProfiles && !drained,
        results,
      });
    } catch (err) {
      console.error("cron_maat_decan_opening error", err);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createCronMaatDecanOpeningHandler());
}
