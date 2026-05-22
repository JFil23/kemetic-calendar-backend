import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { normalizeTimeZone } from "../_shared/decan_schedule.ts";

type SupabaseClientLike = {
  from(table: string): any;
};

type Payload = {
  limit?: number | string;
  batch_size?: number | string;
  max_runtime_ms?: number | string;
  local_hour?: number | string;
  force?: boolean;
  timezone?: string | null;
};

type ProfileRow = {
  id: string;
  timezone?: string | null;
};

type EvaluateUserParams = {
  userId: string;
  timezone: string;
  cronSecret: string;
};

type EvaluateUser = (params: EvaluateUserParams) => Promise<{
  status: number;
  data: unknown;
}>;

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

function createDefaultEvaluateUser(): EvaluateUser {
  const supabaseUrl = Deno.env.get("PROJECT_URL") ??
    Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("Missing Supabase URL environment");

  return async ({ userId, timezone, cronSecret }) => {
    const res = await fetch(
      new URL("/functions/v1/evaluate_maat_guidance", supabaseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({
          source: "cron_evaluate_maat_guidance",
          user_id: userId,
          timezone,
        }),
      },
    );
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

function localHourForTimezone(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const hour = formatter.formatToParts(now).find((part) => part.type === "hour")
    ?.value;
  return Number(hour ?? "0");
}

export function createCronEvaluateMaatGuidanceHandler(options?: {
  client?: SupabaseClientLike;
  evaluateUser?: EvaluateUser;
  now?: () => Date;
}) {
  const client = options?.client ?? createDefaultClient();
  const evaluateUser = options?.evaluateUser ?? createDefaultEvaluateUser();
  const nowFn = options?.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const cronSecret = Deno.env.get("MAAT_CRON_SECRET") ??
      Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    if (!cronSecret || providedSecret !== cronSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const startedAt = Date.now();
    const requestId = crypto.randomUUID();

    try {
      const body = await req.json().catch(() => ({})) as Payload;
      const maxProfiles = boundedInteger(body.limit, 5000, 1, 20000);
      const batchSize = boundedInteger(body.batch_size, 500, 1, 1000);
      const maxRuntimeMs = boundedInteger(
        body.max_runtime_ms,
        45000,
        1000,
        120000,
      );
      const targetLocalHour = boundedInteger(body.local_hour, 0, 0, 23);
      const force = body.force === true;
      const now = nowFn();

      const results = [];
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
          console.error("cron evaluate profiles lookup error", profileError);
          return jsonResponse({ error: "Profile lookup error" }, 500);
        }

        const rows = (profileRows ?? []) as ProfileRow[];
        if (!rows.length) {
          drained = true;
          break;
        }

        batches += 1;
        for (const profile of rows) {
          const timezone = normalizeTimeZone(body.timezone ?? profile.timezone);
          const localHour = localHourForTimezone(now, timezone);
          if (!force && localHour !== targetLocalHour) {
            results.push({
              user_id: profile.id,
              timezone,
              local_hour: localHour,
              skipped: true,
              reason: "outside_local_hour",
            });
            continue;
          }

          try {
            const result = await evaluateUser({
              userId: profile.id,
              timezone,
              cronSecret,
            });
            results.push({
              user_id: profile.id,
              timezone,
              local_hour: localHour,
              ok: result.status >= 200 && result.status < 300,
              status: result.status,
              data: result.data,
            });
          } catch (err) {
            results.push({
              user_id: profile.id,
              timezone,
              local_hour: localHour,
              ok: false,
              status: 0,
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

      const evaluated = results.filter((row) => row.ok === true).length;
      const failed = results.filter((row) => row.ok === false).length;
      const skipped = results.filter((row) => row.skipped === true).length;
      return jsonResponse({
        request_id: requestId,
        processed: results.length,
        evaluated,
        skipped,
        failed,
        batches,
        drained,
        exhausted_runtime: exhaustedRuntime,
        exhausted_limit: results.length >= maxProfiles && !drained,
        duration_ms: Date.now() - startedAt,
        results,
      }, failed ? 207 : 200);
    } catch (err) {
      console.error("cron_evaluate_maat_guidance error", err);
      return jsonResponse({
        request_id: requestId,
        error: "Server error",
        duration_ms: Date.now() - startedAt,
      }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createCronEvaluateMaatGuidanceHandler());
}
