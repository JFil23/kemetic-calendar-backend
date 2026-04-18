import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type ScheduleRow = {
  id: string;
  user_id: string;
  decan_start: string;
  decan_end: string;
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
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_FUNCTION_KEY = Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !INTERNAL_FUNCTION_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY or INTERNAL_FUNCTION_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function claimDueSchedules(): Promise<ScheduleRow[]> {
  const { data, error } = await supabase
    .from("decan_reflection_schedule")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .select("id, user_id, decan_start, decan_end");

  if (error) {
    console.error("Claim error:", error);
    return [];
  }
  return (data ?? []) as ScheduleRow[];
}

async function generateReflection(user_id: string, decan_name: string, decan_theme: string | null, decan_start: string, decan_end: string): Promise<ReflectionResult> {
  // Call internal edge function to keep single prompt logic
  const { data, error } = await supabase.functions.invoke("ai_generate_reflection", {
    body: {
      user_id,
      decan_name,
      decan_theme,
      decan_start,
      decan_end,
    },
  });
  if (error) throw error;
  return {
    reflection: data?.reflection ?? "",
    badgeCount: data?.badgeCount ?? 0,
  };
}

async function storeReflection(userId: string, decanName: string, decanTheme: string | null, decanStart: string, decanEnd: string, badgeCount: number, reflection: string) {
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

async function markSent(id: string) {
  const { error } = await supabase
    .from("decan_reflection_schedule")
    .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
    .eq("id", id);
  if (error) throw error;
}

async function markFailed(id: string, message: string) {
  const { error } = await supabase
    .from("decan_reflection_schedule")
    .update({ status: "failed", last_error: message })
    .eq("id", id);
  if (error) console.error("Failed to mark failed:", error);
}

serve(async () => {
  try {
    const claimed = await claimDueSchedules();
    if (!claimed.length) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    let processed = 0;
    for (const row of claimed) {
      try {
        const decanName = `Decan starting ${row.decan_start}`;
        const decanTheme = null;
        const { reflection, badgeCount } = await generateReflection(row.user_id, decanName, decanTheme, row.decan_start, row.decan_end);

        const reflectionId = await storeReflection(row.user_id, decanName, decanTheme, row.decan_start, row.decan_end, badgeCount, reflection);
        const pushResult = await sendPush(row.user_id, reflectionId, decanName, reflection);
        if (pushResult.sent <= 0) {
          throw new Error(
            pushResult.reason ??
              (pushResult.failedReasons?.length
                ? pushResult.failedReasons.join(", ")
                : "push_not_delivered"),
          );
        }
        await markSent(row.id);
        processed += 1;
      } catch (err) {
        console.error("Process error for schedule", row.id, err);
        await markFailed(row.id, err?.message ?? "Unknown error");
      }
    }

    return new Response(JSON.stringify({ success: true, processed }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Cron error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message ?? "Unknown error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
