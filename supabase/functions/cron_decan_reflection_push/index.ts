// deno-lint-ignore-file no-import-prefix

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { fallbackDecanLabel } from "../_shared/decan_context.ts";
import {
  computePreviousCurrentAndNextDecanWindows,
} from "../_shared/decan_schedule.ts";
import {
  recordMaatDeliveryTimingEvent,
} from "../_shared/maat_delivery_timing.ts";
import {
  compiledOutputPackageFromPayload,
  resolveCompiledPackagePushText,
} from "../_shared/output_compiler.ts";

type ScheduleRow = {
  id: string;
  user_id: string;
  decan_start: string;
  decan_end: string;
  send_at?: string | null;
  decan_name: string | null;
  decan_theme: string | null;
  decan_context_key: string | null;
  attempt_count: number;
  claim_token: string | null;
};

type EligibleUserRow = {
  id: string;
  timezone: string | null;
};

type ExistingScheduleSeedRow = {
  id: string;
  user_id: string;
  decan_start: string;
  status: string;
  send_at: string;
  sent_at: string | null;
};

type ReflectionResult = {
  reflection: string;
  badgeCount: number;
  outputControl: Record<string, unknown> | null;
  compiledOutputPackage: Record<string, unknown> | null;
};

type SendPushResponse = {
  sent: number;
  failed: number;
  stale: number;
  matchedTokens: number;
  delivered: boolean;
  reason?: string;
  failedReasons?: string[];
  pushSource?: string;
  pushBlocked?: boolean;
  pushPackageVersion?: string | null;
  pushCompilerStatus?: string | null;
};

type FunctionInvokeOptions = {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
};

type SupabaseClientLike = {
  // Edge tests inject a lightweight table builder; production passes Supabase.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
  functions: {
    invoke(
      name: string,
      options?: FunctionInvokeOptions,
    ): Promise<{ data: unknown; error: unknown }>;
  };
};

type RuntimeConfig = {
  claimLimit: number;
  claimLeaseSeconds: number;
  maxAttempts: number;
  maxBatches: number;
  maxRuntimeMs: number;
  seedBatchSize: number;
  internalFunctionKey: string;
  cronSecret: string;
};

type ProcessOutcome =
  | "delivered"
  | "no_push_token"
  | "blocked"
  | "failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scheduleDeliveryKey(row: ScheduleRow) {
  return `decan_reflection:${row.id}:${row.decan_start}`;
}

async function recordScheduleDeliveryEvent(
  client: SupabaseClientLike,
  row: ScheduleRow,
  params: {
    status: "picked" | "sent" | "failed" | "skipped";
    functionStartedAt: string;
    deliveredAt?: string | null;
    errorCode?: string | null;
    skipReason?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await recordMaatDeliveryTimingEvent(client, {
    deliveryKey: scheduleDeliveryKey(row),
    deliveryKind: "decan_reflection",
    targetTable: "decan_reflection_schedule",
    targetId: row.id,
    userId: row.user_id,
    scheduledFor: row.send_at ?? null,
    cronPickedAt: params.status === "picked" ? params.functionStartedAt : null,
    functionStartedAt: params.functionStartedAt,
    deliveredAt: params.deliveredAt ?? null,
    cronJobName: "decan_reflection_push_5m",
    deliveryAttempt: (row.attempt_count ?? 0) + 1,
    deliveryStatus: params.status,
    skipReason: params.skipReason ?? null,
    errorCode: params.errorCode ?? null,
    metadata: {
      decan_start: row.decan_start,
      decan_end: row.decan_end,
      decan_context_key: row.decan_context_key,
      ...(params.metadata ?? {}),
    },
  });
}

function readIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = parseInt(Deno.env.get(name) ?? `${fallback}`, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function createDefaultClient(): SupabaseClientLike {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ??
    Deno.env.get("PROJECT_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/PROJECT_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY",
    );
  }
  return createClient(
    supabaseUrl,
    serviceRoleKey,
  ) as unknown as SupabaseClientLike;
}

function createDefaultConfig(): RuntimeConfig {
  return {
    claimLimit: readIntEnv("DECAN_REFLECTION_CLAIM_LIMIT", 25, 1, 250),
    claimLeaseSeconds: readIntEnv(
      "DECAN_REFLECTION_CLAIM_LEASE_SECONDS",
      900,
      30,
      7200,
    ),
    maxAttempts: readIntEnv("DECAN_REFLECTION_MAX_ATTEMPTS", 3, 1, 25),
    maxBatches: readIntEnv("DECAN_REFLECTION_MAX_BATCHES", 20, 1, 200),
    maxRuntimeMs: readIntEnv(
      "DECAN_REFLECTION_MAX_RUNTIME_MS",
      45_000,
      5_000,
      300_000,
    ),
    seedBatchSize: readIntEnv("DECAN_REFLECTION_SEED_BATCH_SIZE", 500, 1, 1000),
    internalFunctionKey: Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "",
    cronSecret: Deno.env.get("DECAN_REFLECTION_CRON_SECRET") ??
      Deno.env.get("CRON_SECRET") ?? "",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchEligibleUsers(
  client: SupabaseClientLike,
  from: number,
  to: number,
): Promise<EligibleUserRow[]> {
  const { data, error } = await client
    .from("profiles")
    .select("id, timezone")
    .order("id", { ascending: true })
    .range(from, to);

  if (error) {
    throw new Error(`Eligible user fetch error: ${errorMessage(error)}`);
  }

  return (data ?? []) as EligibleUserRow[];
}

async function fetchExistingSeedSchedules(
  client: SupabaseClientLike,
  userIds: string[],
  decanStarts: string[],
): Promise<ExistingScheduleSeedRow[]> {
  if (!userIds.length || !decanStarts.length) return [];

  const { data, error } = await client
    .from("decan_reflection_schedule")
    .select("id, user_id, decan_start, status, send_at, sent_at")
    .in("user_id", userIds)
    .in("decan_start", decanStarts);

  if (error) {
    throw new Error(
      `Existing schedule seed fetch error: ${errorMessage(error)}`,
    );
  }

  return (data ?? []) as ExistingScheduleSeedRow[];
}

async function updateExistingSeedSchedule(
  client: SupabaseClientLike,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await client
    .from("decan_reflection_schedule")
    .update(values)
    .eq("id", id);

  if (error) {
    throw new Error(`Existing schedule update error: ${errorMessage(error)}`);
  }
}

async function seedMissingSchedules(
  client: SupabaseClientLike,
  config: RuntimeConfig,
  now: Date,
) {
  let from = 0;

  while (true) {
    const users = await fetchEligibleUsers(
      client,
      from,
      from + config.seedBatchSize - 1,
    );
    if (!users.length) break;

    const userWindows = users.map((user) => ({
      userId: user.id,
      windows: computePreviousCurrentAndNextDecanWindows(now, user.timezone),
    }));

    const rows = userWindows.flatMap(({ userId, windows }) =>
      windows.map((window) => ({
        user_id: userId,
        decan_start: window.start,
        decan_end: window.end,
        send_at: window.sendAt,
        decan_name: window.decanName,
        decan_theme: window.decanTheme,
        decan_context_key: window.decanContextKey,
        status: "pending",
      }))
    );

    const existingRows = await fetchExistingSeedSchedules(
      client,
      users.map((user) => user.id),
      Array.from(new Set(rows.map((row) => row.decan_start))),
    );
    const existingByKey = new Map(
      existingRows.map((row) => [`${row.user_id}::${row.decan_start}`, row]),
    );

    const inserts = rows.filter((row) =>
      !existingByKey.has(`${row.user_id}::${row.decan_start}`)
    );

    if (inserts.length) {
      const { error } = await client
        .from("decan_reflection_schedule")
        .upsert(inserts, {
          onConflict: "user_id,decan_start",
          ignoreDuplicates: true,
        });

      if (error) {
        throw new Error(`Schedule seed error: ${errorMessage(error)}`);
      }
    }

    for (const { userId, windows } of userWindows) {
      for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index];
        const existing = existingByKey.get(`${userId}::${window.start}`);
        if (!existing) continue;

        const desiredFields = {
          decan_end: window.end,
          send_at: window.sendAt,
          decan_name: window.decanName,
          decan_theme: window.decanTheme,
          decan_context_key: window.decanContextKey,
        };

        if (
          existing.status === "pending" && existing.send_at !== window.sendAt
        ) {
          await updateExistingSeedSchedule(client, existing.id, desiredFields);
          continue;
        }

        const shouldMakeGood = index === 0 &&
          ["sent", "failed", "no_push_token"].includes(existing.status) &&
          new Date(existing.send_at).getTime() <
            new Date(window.sendAt).getTime() &&
          now.getTime() >= new Date(window.sendAt).getTime() &&
          (!existing.sent_at ||
            new Date(existing.sent_at).getTime() <
              new Date(window.sendAt).getTime());

        if (shouldMakeGood) {
          await updateExistingSeedSchedule(client, existing.id, {
            ...desiredFields,
            status: "pending",
            claimed_at: null,
            claim_token: null,
            sent_at: null,
            last_error: null,
            attempt_count: 0,
            last_attempt_at: null,
          });
        }
      }
    }

    if (users.length < config.seedBatchSize) break;
    from += config.seedBatchSize;
  }
}

async function claimDueSchedules(
  client: SupabaseClientLike,
  config: RuntimeConfig,
  now: Date,
): Promise<ScheduleRow[]> {
  const { data, error } = await client.rpc(
    "claim_due_decan_reflection_schedule",
    {
      p_now: now.toISOString(),
      p_limit: config.claimLimit,
      p_lease_seconds: config.claimLeaseSeconds,
    },
  );
  if (error) {
    throw new Error(`Claim error: ${errorMessage(error)}`);
  }
  const rows = (data ?? []) as ScheduleRow[];
  if (!rows.length) return rows;

  const { data: scheduleRows, error: scheduleError } = await client
    .from("decan_reflection_schedule")
    .select("id, send_at")
    .in("id", rows.map((row) => row.id));
  if (scheduleError) {
    throw new Error(
      `Claim send_at lookup error: ${errorMessage(scheduleError)}`,
    );
  }
  const sendAtById = new Map(
    ((scheduleRows ?? []) as Array<{ id: string; send_at?: string | null }>)
      .map((row) => [row.id, row.send_at ?? null]),
  );
  return rows.map((row) => ({
    ...row,
    send_at: sendAtById.get(row.id) ?? row.send_at ?? null,
  }));
}

async function generateReflection(
  client: SupabaseClientLike,
  user_id: string,
  decan_name: string,
  decan_theme: string | null,
  decan_context_key: string | null,
  decan_start: string,
  decan_end: string,
): Promise<ReflectionResult> {
  const { data, error } = await client.functions.invoke(
    "ai_generate_reflection",
    {
      body: {
        user_id,
        decan_name,
        decan_theme,
        decan_context_key,
        decan_start,
        decan_end,
        include_history: true,
        v2: true,
        persist: true,
        use_knowledge_graph: true,
        use_decision_matrix: true,
      },
    },
  );
  if (error) throw error;
  const body = (data ?? {}) as {
    reflection?: string;
    badgeCount?: number;
    outputControl?: Record<string, unknown> | null;
  };
  const outputControl = isRecord(body.outputControl)
    ? body.outputControl
    : null;
  return {
    reflection: body.reflection ?? "",
    badgeCount: body.badgeCount ?? 0,
    outputControl,
    compiledOutputPackage: compiledOutputPackageFromPayload(outputControl),
  };
}

async function findExistingReflectionId(
  client: SupabaseClientLike,
  userId: string,
  decanStart: string,
  decanEnd: string,
) {
  const { data, error } = await client
    .from("decan_reflections")
    .select("id")
    .eq("user_id", userId)
    .eq("decan_start", decanStart)
    .eq("decan_end", decanEnd)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Existing reflection lookup error: ${errorMessage(error)}`);
  }
  return (data as { id?: string } | null)?.id ?? null;
}

async function storeReflection(
  client: SupabaseClientLike,
  userId: string,
  decanName: string,
  decanTheme: string | null,
  decanStart: string,
  decanEnd: string,
  badgeCount: number,
  reflection: string,
) {
  const existingId = await findExistingReflectionId(
    client,
    userId,
    decanStart,
    decanEnd,
  );
  if (existingId) return existingId;

  const { data, error } = await client
    .from("decan_reflections")
    .insert({
      user_id: userId,
      decan_name: decanName,
      decan_theme: decanTheme,
      decan_start: decanStart,
      decan_end: decanEnd,
      badge_count: badgeCount,
      reflection_text: reflection,
    })
    .select("id")
    .single();
  if (!error) {
    const insertedId = (data as { id?: string } | null)?.id;
    if (insertedId) return insertedId;
    throw new Error("Reflection persist returned no id");
  }

  const message = errorMessage(error);
  if (message.includes("duplicate") || message.includes("23505")) {
    const racedId = await findExistingReflectionId(
      client,
      userId,
      decanStart,
      decanEnd,
    );
    if (racedId) return racedId;
  }
  throw new Error(`Reflection persist error: ${message}`);
}

function buildExcerpt(reflection: string, maxChars = 120) {
  const clean = reflection.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  const slice = clean.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace > 50 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trim()}…`;
}

async function sendPush(
  client: SupabaseClientLike,
  config: RuntimeConfig,
  userId: string,
  reflectionId: string,
  decanName: string,
  reflection: string,
  compiledOutputPackage: Record<string, unknown> | null,
): Promise<SendPushResponse> {
  if (!config.internalFunctionKey) {
    throw new Error("INTERNAL_FUNCTION_KEY not configured");
  }
  const title = "Your decan reflection is ready";
  const pushResolution = resolveCompiledPackagePushText({
    compiledPackage: compiledOutputPackage,
    legacyBodyText: reflection,
  });
  if (pushResolution.blocked) {
    return {
      sent: 0,
      failed: 0,
      stale: 0,
      matchedTokens: 0,
      delivered: false,
      reason: pushResolution.reason ?? pushResolution.source,
      failedReasons: [],
      pushSource: pushResolution.source,
      pushBlocked: true,
      pushPackageVersion: pushResolution.packageVersion,
      pushCompilerStatus: pushResolution.compilerStatus,
    };
  }
  const body = pushResolution.text || buildExcerpt(reflection) || decanName;
  const ctaType = typeof compiledOutputPackage?.cta_type === "string"
    ? compiledOutputPackage.cta_type
    : null;
  const ctaRef = typeof compiledOutputPackage?.cta_ref === "string"
    ? compiledOutputPackage.cta_ref
    : null;
  const destination = compiledOutputPackage?.destination &&
      typeof compiledOutputPackage.destination === "object" &&
      !Array.isArray(compiledOutputPackage.destination)
    ? compiledOutputPackage.destination as Record<string, unknown>
    : null;
  const { data, error } = await client.functions.invoke("send_push", {
    body: {
      userIds: [userId],
      notification: { title, body },
      data: {
        kind: "decan_reflection",
        delivery_key: `decan_reflection:${reflectionId}`,
        reflectionId,
        push_source: pushResolution.source,
        ...(ctaType ? { cta_type: ctaType } : {}),
        ...(ctaRef ? { cta_ref: ctaRef } : {}),
        ...(destination ? { destination } : {}),
        ...(compiledOutputPackage
          ? { compiled_output_package: compiledOutputPackage }
          : {}),
      },
    },
    headers: {
      "x-internal-key": config.internalFunctionKey,
    },
  });
  if (error) throw error;
  return data as SendPushResponse;
}

async function updateClaimedSchedule(
  client: SupabaseClientLike,
  row: ScheduleRow,
  values: Record<string, unknown>,
) {
  const { error } = await client
    .from("decan_reflection_schedule")
    .update(values)
    .eq("id", row.id)
    .eq("claim_token", row.claim_token ?? "");
  if (error) throw error;
}

async function markSent(
  client: SupabaseClientLike,
  row: ScheduleRow,
  now: Date,
) {
  const nowIso = now.toISOString();
  await updateClaimedSchedule(client, row, {
    status: "sent",
    sent_at: nowIso,
    last_error: null,
    last_attempt_at: nowIso,
    attempt_count: 0,
    claimed_at: null,
    claim_token: null,
  });
}

async function markNoPushToken(
  client: SupabaseClientLike,
  row: ScheduleRow,
  now: Date,
) {
  await updateClaimedSchedule(client, row, {
    status: "no_push_token",
    sent_at: null,
    last_error: "no_tokens_for_recipients",
    last_attempt_at: now.toISOString(),
    claimed_at: null,
    claim_token: null,
  });
}

async function markPushBlocked(
  client: SupabaseClientLike,
  row: ScheduleRow,
  message: string,
  now: Date,
) {
  await updateClaimedSchedule(client, row, {
    status: "skipped",
    sent_at: null,
    last_error: message,
    last_attempt_at: now.toISOString(),
    claimed_at: null,
    claim_token: null,
  });
}

async function markFailed(
  client: SupabaseClientLike,
  config: RuntimeConfig,
  row: ScheduleRow,
  message: string,
  now: Date,
) {
  const attempts = (row.attempt_count ?? 0) + 1;
  const nextStatus = attempts >= config.maxAttempts ? "failed" : "pending";
  try {
    await updateClaimedSchedule(client, row, {
      status: nextStatus,
      last_error: message,
      attempt_count: attempts,
      last_attempt_at: now.toISOString(),
      claimed_at: null,
      claim_token: null,
    });
  } catch (error) {
    console.error("Failed to mark failed:", error);
  }
}

async function processScheduleRow(
  client: SupabaseClientLike,
  config: RuntimeConfig,
  row: ScheduleRow,
  now: Date,
  functionStartedAt: string,
): Promise<ProcessOutcome> {
  try {
    const decanName = row.decan_name?.trim() ||
      fallbackDecanLabel(row.decan_context_key) ||
      `Decan starting ${row.decan_start}`;
    const decanTheme = row.decan_theme?.trim() || null;
    const { reflection, badgeCount, compiledOutputPackage } =
      await generateReflection(
        client,
        row.user_id,
        decanName,
        decanTheme,
        row.decan_context_key,
        row.decan_start,
        row.decan_end,
      );

    const reflectionId = await storeReflection(
      client,
      row.user_id,
      decanName,
      decanTheme,
      row.decan_start,
      row.decan_end,
      badgeCount,
      reflection,
    );
    const pushResult = await sendPush(
      client,
      config,
      row.user_id,
      reflectionId,
      decanName,
      reflection,
      compiledOutputPackage,
    );
    if (pushResult.sent <= 0) {
      if (
        pushResult.reason === "compiled_package_not_quality_proof" ||
        pushResult.reason === "compiled_package_missing_push_text"
      ) {
        await markPushBlocked(client, row, pushResult.reason, now);
        await recordScheduleDeliveryEvent(client, row, {
          status: "skipped",
          functionStartedAt,
          deliveredAt: now.toISOString(),
          skipReason: pushResult.reason,
          metadata: {
            reflection_id: reflectionId,
            push_source: pushResult.pushSource ?? null,
            push_blocked: true,
            package_version: pushResult.pushPackageVersion ?? null,
            compiler_status: pushResult.pushCompilerStatus ?? null,
          },
        });
        return "blocked";
      }
      if (pushResult.reason === "no_tokens_for_recipients") {
        await markNoPushToken(client, row, now);
        await recordScheduleDeliveryEvent(client, row, {
          status: "skipped",
          functionStartedAt,
          deliveredAt: now.toISOString(),
          skipReason: "no_tokens_for_recipients",
          metadata: {
            reflection_id: reflectionId,
            push_source: pushResult.pushSource ?? null,
            package_version: pushResult.pushPackageVersion ?? null,
            compiler_status: pushResult.pushCompilerStatus ?? null,
          },
        });
        return "no_push_token";
      }
      throw new Error(
        pushResult.reason ??
          (pushResult.failedReasons?.length
            ? pushResult.failedReasons.join(", ")
            : "push_not_delivered"),
      );
    }
    await markSent(client, row, now);
    await recordScheduleDeliveryEvent(client, row, {
      status: "sent",
      functionStartedAt,
      deliveredAt: now.toISOString(),
      metadata: {
        reflection_id: reflectionId,
        push_source: pushResult.pushSource ?? null,
        package_version: pushResult.pushPackageVersion ?? null,
        compiler_status: pushResult.pushCompilerStatus ?? null,
      },
    });
    return "delivered";
  } catch (error) {
    console.error("Process error for schedule", row.id, error);
    await markFailed(client, config, row, errorMessage(error), now);
    await recordScheduleDeliveryEvent(client, row, {
      status: "failed",
      functionStartedAt,
      deliveredAt: now.toISOString(),
      errorCode: "process_failed",
      metadata: { error: errorMessage(error) },
    });
    return "failed";
  }
}

export function createCronDecanReflectionPushHandler(options?: {
  client?: SupabaseClientLike;
  config?: Partial<RuntimeConfig>;
  now?: () => Date;
}) {
  const client = options?.client ?? createDefaultClient();
  const config: RuntimeConfig = {
    ...createDefaultConfig(),
    ...(options?.config ?? {}),
  };
  const nowFn = options?.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    }

    try {
      if (!config.cronSecret) {
        return jsonResponse({
          success: false,
          error: "DECAN_REFLECTION_CRON_SECRET not configured",
        }, 500);
      }
      if (req.headers.get("x-cron-secret") !== config.cronSecret) {
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }
      if (!config.internalFunctionKey) {
        return jsonResponse({
          success: false,
          error: "INTERNAL_FUNCTION_KEY not configured",
        }, 500);
      }

      const startedAtMs = Date.now();
      const functionStartedAt = new Date(startedAtMs).toISOString();
      await seedMissingSchedules(client, config, nowFn());

      const totals = {
        success: true,
        processed: 0,
        claimed: 0,
        delivered: 0,
        no_push_token: 0,
        failed: 0,
        blocked: 0,
        batches: 0,
        drained: false,
        exhausted_runtime: false,
        exhausted_batches: false,
      };

      for (let batch = 0; batch < config.maxBatches; batch += 1) {
        if (Date.now() - startedAtMs >= config.maxRuntimeMs) {
          totals.exhausted_runtime = true;
          break;
        }

        const claimed = await claimDueSchedules(client, config, nowFn());
        if (!claimed.length) {
          totals.drained = true;
          break;
        }

        totals.batches += 1;
        totals.claimed += claimed.length;
        await Promise.all(
          claimed.map((row) =>
            recordScheduleDeliveryEvent(client, row, {
              status: "picked",
              functionStartedAt,
              metadata: { batch: totals.batches },
            })
          ),
        );
        console.log(JSON.stringify({
          at: nowFn().toISOString(),
          msg: "claimed_decan_reflection_rows",
          count: claimed.length,
          limit: config.claimLimit,
          batch: totals.batches,
        }));

        for (const row of claimed) {
          const outcome = await processScheduleRow(
            client,
            config,
            row,
            nowFn(),
            functionStartedAt,
          );
          totals.processed += 1;
          if (outcome === "delivered") totals.delivered += 1;
          if (outcome === "no_push_token") totals.no_push_token += 1;
          if (outcome === "blocked") totals.blocked += 1;
          if (outcome === "failed") totals.failed += 1;
        }
      }

      if (!totals.drained && !totals.exhausted_runtime) {
        totals.exhausted_batches = true;
      }

      return jsonResponse(totals);
    } catch (error) {
      console.error("Cron error:", error);
      return jsonResponse({
        success: false,
        error: errorMessage(error),
      }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createCronDecanReflectionPushHandler());
}
