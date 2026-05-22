import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  computeCurrentAndNextDecanWindows,
  normalizeTimeZone,
} from "../_shared/decan_schedule.ts";
import { getDecanContext } from "../_shared/decan_context.ts";
import {
  buildDecanOpeningDraft,
  buildGuidanceShapingFingerprint,
  buildGuidanceSnapshot,
  buildOpeningDecisionMatrix,
  type DayCardGuidanceInput,
  decanPeriodKey,
  type GuidanceWindow,
  MAAT_GUIDANCE_POLICY_VERSION,
  resolveGatePolicyForMaturity,
  resolveGraphAxisPriors,
  resolveGuidanceMaturity,
} from "../_shared/maat_guidance.ts";
import { buildUserMemoryBrief } from "../_shared/user_memory_brief.ts";
import type { ReflectionProfileRow } from "../ai_generate_reflection/maat_decision.ts";

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
};

type OpeningCronResult = {
  user_id: string;
  delivery?: unknown;
  created?: boolean;
  enriched?: boolean;
  refreshed?: boolean;
  error?: string;
};

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
  const teaser = typeof existing.teaser_text === "string"
    ? existing.teaser_text
    : "";
  const body = typeof existing.body_text === "string" ? existing.body_text : "";

  return ctaType !== "node" ||
    !ctaRef.trim() ||
    !nodeRef.trim() ||
    teaser.includes("Today's card names") ||
    body.includes("Today's card names");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

async function fetchReflectionProfile(
  client: SupabaseClientLike,
  userId: string,
) {
  const { data, error } = await client
    .from("reflection_profiles")
    .select(
      "top_nodes,top_edges,dominant_patterns,tension_pairs,maat_score,isfet_risk_score,last_computed_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("reflection profile fetch error", error);
    return null;
  }
  return data as ReflectionProfileRow | null;
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
  const profile = await fetchReflectionProfile(client, userId);
  const maturity = resolveGuidanceMaturity({
    badgeCount: 0,
    snapshotCount: 0,
    profile,
  });
  const gatePolicy = resolveGatePolicyForMaturity(maturity);
  const axisPriors = resolveGraphAxisPriors({ profile, maturity });
  const emptySnapshot = buildGuidanceSnapshot({
    window,
    decanContext,
    badges: [],
    gatePolicy,
    axisPriors,
  });
  const matrix = buildOpeningDecisionMatrix({
    profile,
    snapshot: emptySnapshot,
  });
  const memoryBrief = buildUserMemoryBrief({
    profile,
    snapshot: emptySnapshot,
    decanContext,
    decanName: window.decanName,
    decanTheme: window.decanTheme,
  });
  const shapingFingerprint = buildGuidanceShapingFingerprint({
    maturity,
    profile,
    gatePolicy,
    axisPriors,
    decisionMatrixFingerprint: matrix?.fingerprint ?? null,
  });
  const draft = buildDecanOpeningDraft({
    window,
    decanContext,
    dayCard: body.day_card ?? null,
    matrix,
    snapshot: emptySnapshot,
    memoryBrief,
  });

  const { data: generation, error: generationError } = await client
    .from("reflection_generations")
    .insert({
      user_id: userId,
      period_type: "decan_opening",
      period_key: periodKey,
      anchor_nodes: matrix?.anchorNodes ?? [],
      source_snapshot: {
        decan_name: window.decanName,
        decan_theme: window.decanTheme ?? null,
        decan_context_key: window.decanContextKey ?? null,
        decan_start: window.start,
        decan_end: window.end,
        day_card: body.day_card ?? null,
        maturity_level: maturity.level,
        maturity_confidence: maturity.confidence,
        gate_policy: shapingFingerprint.gate_policy,
        shaping_fingerprint: shapingFingerprint,
        memory_brief: {
          context_quality: memoryBrief.contextQuality,
          anchor_labels: memoryBrief.anchorLabels,
          tension_labels: memoryBrief.tensionLabels,
        },
      },
      generated_text: draft.bodyText,
      model_version: "local-maat-guidance-v1",
      metadata: {
        policy_version: MAAT_GUIDANCE_POLICY_VERSION,
        kind: draft.kind,
        lead_axis: draft.payload.lead_axis,
        reflection_move: draft.payload.reflection_move,
        hard_gates: draft.payload.hard_gates,
        maturity_level: maturity.level,
        maturity_label: maturity.label,
        maturity_confidence: maturity.confidence,
        gate_policy: shapingFingerprint.gate_policy,
        shaping_fingerprint: shapingFingerprint,
        decision_matrix: matrix?.fingerprint ?? null,
        memory_context_quality: memoryBrief.contextQuality,
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
    const hasDayCard = hasDayCardSignal(body.day_card);
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
      const { data: delivery, error: updateError } = await client
        .from("maat_guidance_deliveries")
        .update({
          priority: draft.priority,
          teaser_text: draft.teaserText,
          body_text: draft.bodyText,
          payload: draft.payload,
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

  const { data: delivery, error: insertError } = await client
    .from("maat_guidance_deliveries")
    .insert({
      user_id: userId,
      kind: draft.kind,
      decan_period_key: periodKey,
      status: "pending",
      priority: draft.priority,
      teaser_text: draft.teaserText,
      body_text: draft.bodyText,
      payload: draft.payload,
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
  now?: () => Date;
}) {
  const client = options?.client ?? createDefaultClient();
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
            results.push({ user_id: profile.id, ...result });
          } catch (err) {
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
