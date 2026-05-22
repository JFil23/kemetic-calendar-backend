import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import {
  computeCurrentAndNextDecanWindows,
  type DecanScheduleWindow,
  normalizeTimeZone,
} from "../_shared/decan_schedule.ts";
import {
  type DayCardGuidanceInput,
  decanPeriodKey,
  type GuidanceWindow,
} from "../_shared/maat_guidance.ts";

type SupabaseClientLike = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error?: unknown;
    }>;
  };
  from(table: string): any;
};

type EnsurePayload = {
  timezone?: string | null;
  day_card?: DayCardGuidanceInput | null;
};

type InvokeParams = {
  name: string;
  token: string;
  body: Record<string, unknown>;
};

type InvokeResult = {
  status: number;
  data: unknown;
};

type FunctionInvoker = (params: InvokeParams) => Promise<InvokeResult>;

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

function createDefaultInvoker(): FunctionInvoker {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("Missing Supabase URL environment");

  return async ({ name, token, body }) => {
    const res = await fetch(new URL(`/functions/v1/${name}`, supabaseUrl), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = text;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = null;
    }
    return { status: res.status, data };
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function localDateForTimezone(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function asGuidanceWindow(window: DecanScheduleWindow): GuidanceWindow {
  return {
    start: window.start,
    end: window.end,
    decanName: window.decanName,
    decanTheme: window.decanTheme,
    decanContextKey: window.decanContextKey,
  };
}

function windowPayload(window: DecanScheduleWindow, timezone: string) {
  return {
    decan_start: window.start,
    decan_end: window.end,
    decan_name: window.decanName,
    decan_theme: window.decanTheme,
    decan_context_key: window.decanContextKey,
    timezone,
  };
}

function isActiveWindow(window: DecanScheduleWindow, localDate: string) {
  return window.start <= localDate && localDate <= window.end;
}

function hasDayCardSignal(dayCard?: DayCardGuidanceInput | null) {
  if (!dayCard) return false;
  return Boolean(
    dayCard.date?.trim() ||
      dayCard.maatPrinciple?.trim() ||
      dayCard.cosmicContext?.trim() ||
      dayCard.decanDayTheme?.trim() ||
      dayCard.decanDayAction?.trim() ||
      dayCard.decanDayReflection?.trim(),
  );
}

async function invokeGuidanceFunction(
  invoker: FunctionInvoker,
  params: InvokeParams,
) {
  try {
    const res = await invoker(params);
    return {
      name: params.name,
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      data: res.data,
    };
  } catch (error) {
    return {
      name: params.name,
      ok: false,
      status: 0,
      data: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function createEnsureUserGuidanceHandler(options?: {
  client?: SupabaseClientLike;
  invokeFunction?: FunctionInvoker;
  now?: () => Date;
}) {
  const client = options?.client ?? createDefaultClient();
  const invokeFunction = options?.invokeFunction ?? createDefaultInvoker();
  const nowFn = options?.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
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

      const body = await req.json().catch(() => ({})) as EnsurePayload;
      const { data: profileRow, error: profileError } = await client
        .from("profiles")
        .select("timezone")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) {
        console.error(
          "ensure_user_guidance profile lookup error",
          profileError,
        );
      }

      const timezone = normalizeTimeZone(
        body.timezone ?? profileRow?.timezone ?? null,
      );
      const now = nowFn();
      const localDate = localDateForTimezone(now, timezone);
      const windows = computeCurrentAndNextDecanWindows(now, timezone);
      const currentWindow = windows.find((window) =>
        isActiveWindow(window, localDate)
      ) ?? null;

      const scheduleResults = [];
      for (const window of windows) {
        scheduleResults.push(
          await invokeGuidanceFunction(invokeFunction, {
            name: "schedule_decan_reflection",
            token,
            body: windowPayload(window, timezone),
          }),
        );
      }

      let openingResult = null;
      let evaluationResult = null;
      if (currentWindow) {
        const currentPayload = windowPayload(currentWindow, timezone);
        openingResult = await invokeGuidanceFunction(invokeFunction, {
          name: "cron_maat_decan_opening",
          token,
          body: {
            ...currentPayload,
            ...(hasDayCardSignal(body.day_card)
              ? { day_card: body.day_card }
              : {}),
          },
        });
        evaluationResult = await invokeGuidanceFunction(invokeFunction, {
          name: "evaluate_maat_guidance",
          token,
          body: {
            ...currentPayload,
            local_date: localDate,
          },
        });
      }

      const results = [
        ...scheduleResults,
        ...(openingResult ? [openingResult] : []),
        ...(evaluationResult ? [evaluationResult] : []),
      ];
      const success = results.every((result) => result.ok);
      const currentPeriodKey = currentWindow
        ? decanPeriodKey(asGuidanceWindow(currentWindow))
        : null;

      return jsonResponse({
        success,
        timezone,
        local_date: localDate,
        current_period_key: currentPeriodKey,
        scheduled_windows: windows.map((window) => ({
          decan_start: window.start,
          decan_end: window.end,
          decan_context_key: window.decanContextKey,
        })),
        reflection_schedule: scheduleResults,
        opening: openingResult,
        evaluation: evaluationResult,
      }, success ? 200 : 502);
    } catch (err) {
      console.error("ensure_user_guidance error", err);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createEnsureUserGuidanceHandler());
}
