import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { fallbackDecanLabel } from "../_shared/decan_context.ts";
import {
  computePreviousCurrentAndNextDecanWindows,
} from "../_shared/decan_schedule.ts";

type ScheduleRow = {
  id: string;
  user_id: string;
  decan_start: string;
  decan_end: string;
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

type ReflectionResult = { reflection: string; badgeCount: number };
type SendPushResponse = {
  sent: number;
  failed: number;
  stale: number;
  matchedTokens: number;
  delivered: boolean;
  reason?: string;
  failedReasons?: string[];
};

// Use Supabase-specific envs only; avoid generic keys that may point elsewhere.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_FUNCTION_KEY = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !INTERNAL_FUNCTION_KEY) {
  console.error(
    "Missing SUPABASE_URL or SERVICE_ROLE_KEY or INTERNAL_FUNCTION_KEY",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const DECAN_REFLECTION_CLAIM_LIMIT = Math.max(
  1,
  Math.min(
    parseInt(Deno.env.get("DECAN_REFLECTION_CLAIM_LIMIT") ?? "25", 10),
    250,
  ),
);
const DECAN_REFLECTION_CLAIM_LEASE_SECONDS = Math.max(
  30,
  parseInt(
    Deno.env.get("DECAN_REFLECTION_CLAIM_LEASE_SECONDS") ?? "900",
    10,
  ),
);
const DECAN_REFLECTION_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(Deno.env.get("DECAN_REFLECTION_MAX_ATTEMPTS") ?? "3", 10),
);

async function fetchEligibleUsers(
  from: number,
  to: number,
): Promise<EligibleUserRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, timezone")
    .order("id", { ascending: true })
    .range(from, to);

  if (error) {
    console.error("Eligible user fetch error:", error);
    return [];
  }

  return (data ?? []) as EligibleUserRow[];
}

async function fetchExistingSeedSchedules(
  userIds: string[],
  decanStarts: string[],
): Promise<ExistingScheduleSeedRow[]> {
  if (!userIds.length || !decanStarts.length) return [];

  const { data, error } = await supabase
    .from("decan_reflection_schedule")
    .select("id, user_id, decan_start, status, send_at, sent_at")
    .in("user_id", userIds)
    .in("decan_start", decanStarts);

  if (error) {
    console.error("Existing schedule seed fetch error:", error);
    return [];
  }

  return (data ?? []) as ExistingScheduleSeedRow[];
}

async function updateExistingSeedSchedule(
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("decan_reflection_schedule")
    .update(values)
    .eq("id", id);

  if (error) {
    console.error("Existing schedule update error:", { id, error });
  }
}

async function seedMissingSchedules(now = new Date()) {
  const batchSize = 500;
  let from = 0;

  while (true) {
    const users = await fetchEligibleUsers(from, from + batchSize - 1);
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
      const { error } = await supabase
        .from("decan_reflection_schedule")
        .upsert(inserts, {
          onConflict: "user_id,decan_start",
          ignoreDuplicates: true,
        });

      if (error) {
        console.error("Schedule seed error:", error);
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
          await updateExistingSeedSchedule(existing.id, desiredFields);
          continue;
        }

        const shouldMakeGood = index === 0 &&
          (existing.status === "sent" || existing.status === "failed") &&
          new Date(existing.send_at).getTime() <
            new Date(window.sendAt).getTime() &&
          now.getTime() >= new Date(window.sendAt).getTime() &&
          (!existing.sent_at ||
            new Date(existing.sent_at).getTime() <
              new Date(window.sendAt).getTime());

        if (shouldMakeGood) {
          await updateExistingSeedSchedule(existing.id, {
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

    if (users.length < batchSize) break;
    from += batchSize;
  }
}

async function claimDueSchedules(): Promise<ScheduleRow[]> {
  const { data, error } = await supabase.rpc(
    "claim_due_decan_reflection_schedule",
    {
      p_now: new Date().toISOString(),
      p_limit: DECAN_REFLECTION_CLAIM_LIMIT,
      p_lease_seconds: DECAN_REFLECTION_CLAIM_LEASE_SECONDS,
    },
  );
  if (error) {
    console.error("Claim error:", error);
    return [];
  }
  return (data ?? []) as ScheduleRow[];
}

async function generateReflection(
  user_id: string,
  decan_name: string,
  decan_theme: string | null,
  decan_context_key: string | null,
  decan_start: string,
  decan_end: string,
): Promise<ReflectionResult> {
  // Call internal edge function to keep single prompt logic
  const { data, error } = await supabase.functions.invoke(
    "ai_generate_reflection",
    {
      body: {
        user_id,
        decan_name,
        decan_theme,
        decan_context_key,
        decan_start,
        decan_end,
      },
    },
  );
  if (error) throw error;
  return {
    reflection: data?.reflection ?? "",
    badgeCount: data?.badgeCount ?? 0,
  };
}

async function findExistingReflectionId(
  userId: string,
  decanStart: string,
  decanEnd: string,
) {
  const { data, error } = await supabase
    .from("decan_reflections")
    .select("id")
    .eq("user_id", userId)
    .eq("decan_start", decanStart)
    .eq("decan_end", decanEnd)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Existing reflection lookup error:", error);
    return null;
  }
  return data?.id as string | null;
}

async function storeReflection(
  userId: string,
  decanName: string,
  decanTheme: string | null,
  decanStart: string,
  decanEnd: string,
  badgeCount: number,
  reflection: string,
) {
  const existingId = await findExistingReflectionId(
    userId,
    decanStart,
    decanEnd,
  );
  if (existingId) return existingId;

  const { data, error } = await supabase
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
  if (error) throw error;
  return data?.id as string;
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
  userId: string,
  reflectionId: string,
  decanName: string,
  reflection: string,
): Promise<SendPushResponse> {
  if (!INTERNAL_FUNCTION_KEY) {
    throw new Error("INTERNAL_FUNCTION_KEY not configured");
  }
  const title = "Your decan reflection is ready";
  const body = buildExcerpt(reflection) || decanName;
  const { data, error } = await supabase.functions.invoke("send_push", {
    body: {
      userIds: [userId],
      notification: { title, body },
      data: {
        kind: "decan_reflection",
        delivery_key: `decan_reflection:${reflectionId}`,
        reflectionId,
      },
    },
    headers: {
      "x-internal-key": INTERNAL_FUNCTION_KEY,
    },
  });
  if (error) throw error;
  return data as SendPushResponse;
}

async function markSent(row: ScheduleRow) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("decan_reflection_schedule")
    .update({
      status: "sent",
      sent_at: nowIso,
      last_error: null,
      last_attempt_at: nowIso,
      attempt_count: 0,
      claimed_at: null,
      claim_token: null,
    })
    .eq("id", row.id)
    .eq("claim_token", row.claim_token ?? "");
  if (error) throw error;
}

async function markFailed(row: ScheduleRow, message: string) {
  const attempts = (row.attempt_count ?? 0) + 1;
  const nowIso = new Date().toISOString();
  const nextStatus = attempts >= DECAN_REFLECTION_MAX_ATTEMPTS
    ? "failed"
    : "pending";
  const { error } = await supabase
    .from("decan_reflection_schedule")
    .update({
      status: nextStatus,
      last_error: message,
      attempt_count: attempts,
      last_attempt_at: nowIso,
      claimed_at: null,
      claim_token: null,
    })
    .eq("id", row.id)
    .eq("claim_token", row.claim_token ?? "");
  if (error) console.error("Failed to mark failed:", error);
}

serve(async () => {
  try {
    await seedMissingSchedules();

    const claimed = await claimDueSchedules();
    if (!claimed.length) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(JSON.stringify({
      at: new Date().toISOString(),
      msg: "claimed_decan_reflection_rows",
      count: claimed.length,
      limit: DECAN_REFLECTION_CLAIM_LIMIT,
    }));

    let processed = 0;
    for (const row of claimed) {
      try {
        const decanName = row.decan_name?.trim() ||
          fallbackDecanLabel(row.decan_context_key) ||
          `Decan starting ${row.decan_start}`;
        const decanTheme = row.decan_theme?.trim() || null;
        const { reflection, badgeCount } = await generateReflection(
          row.user_id,
          decanName,
          decanTheme,
          row.decan_context_key,
          row.decan_start,
          row.decan_end,
        );

        const reflectionId = await storeReflection(
          row.user_id,
          decanName,
          decanTheme,
          row.decan_start,
          row.decan_end,
          badgeCount,
          reflection,
        );
        const pushResult = await sendPush(
          row.user_id,
          reflectionId,
          decanName,
          reflection,
        );
        if (pushResult.sent <= 0) {
          if (pushResult.reason === "no_tokens_for_recipients") {
            await markSent(row);
            processed += 1;
            continue;
          }
          throw new Error(
            pushResult.reason ??
              (pushResult.failedReasons?.length
                ? pushResult.failedReasons.join(", ")
                : "push_not_delivered"),
          );
        }
        await markSent(row);
        processed += 1;
      } catch (err) {
        console.error("Process error for schedule", row.id, err);
        await markFailed(row, err?.message ?? "Unknown error");
      }
    }

    return new Response(JSON.stringify({ success: true, processed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cron error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message ?? "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
