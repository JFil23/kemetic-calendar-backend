import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

type ReminderRow = {
  id: string;
  user_id: string;
  title: string;
  detail?: string | null;
  alert_at: string;
  channel?: string | null;
  status?: string | null;
};

type ScheduledNotification = {
  id: number;
  user_id: string;
  client_event_id: string;
  title: string;
  body?: string | null;
  payload?: string | null;
  notification_type?: string | null;
  scheduled_at: string;
  claim_token?: string | null;
};

type SendPushResponse = {
  sent: number;
  failed: number;
  stale: number;
  matchedTokens: number;
  delivered: boolean;
  reason?: string;
  failedReasons?: string[];
};

type ScheduledEventRow = {
  user_id: string;
  client_event_id: string;
  flow_local_id?: number | null;
};

type FlowStatusRow = {
  id: number;
  active?: boolean | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL/PROJECT_URL or SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const functionAuthHeader = {
  "x-internal-key": Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "",
};
const SCHEDULED_CLAIM_LIMIT = Math.max(
  1,
  Math.min(parseInt(Deno.env.get("SCHEDULED_CLAIM_LIMIT") ?? "500", 10), 500),
);
const SCHEDULED_CLAIM_LEASE_SECONDS = Math.max(
  30,
  parseInt(Deno.env.get("SCHEDULED_CLAIM_LEASE_SECONDS") ?? "900", 10),
);
const REARMED_PROCESSED_ROW_GRACE_MS = 1000;

console.log(
  JSON.stringify({
    at: new Date().toISOString(),
    msg: "cron_reminder_push bootstrap",
    urlPresent: !!SUPABASE_URL,
    serviceRoleLen: SERVICE_ROLE_KEY.length,
  }),
);

async function invokeSendPush(
  body: Record<string, unknown>,
): Promise<SendPushResponse> {
  if (!functionAuthHeader["x-internal-key"]) {
    throw new Error("INTERNAL_FUNCTION_KEY not configured");
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send_push`, {
    method: "POST",
    headers: {
      ...functionAuthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`send_push ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as SendPushResponse;
  } catch {
    throw new Error(`send_push returned invalid JSON: ${text}`);
  }
}

async function fetchDueReminders(nowIso: string): Promise<ReminderRow[]> {
  const { data, error } = await supabase
    .from("reminders")
    .select("id, user_id, title, detail, alert_at, channel, status")
    .eq("channel", "push_and_in_app")
    .eq("status", "pending")
    .lte("alert_at", nowIso)
    .order("alert_at", { ascending: true })
    .limit(500); // keep each run bounded

  if (error) {
    throw error;
  }
  return (data ?? []) as ReminderRow[];
}

async function claimDueScheduledNotifications(
  nowIso: string,
): Promise<ScheduledNotification[]> {
  const { data, error } = await supabase.rpc(
    "claim_due_scheduled_notifications",
    {
      p_now: nowIso,
      p_limit: SCHEDULED_CLAIM_LIMIT,
      p_lease_seconds: SCHEDULED_CLAIM_LEASE_SECONDS,
    },
  );
  if (error) throw error;
  return (data ?? []) as ScheduledNotification[];
}

function scheduledEventKey(userId: string, clientEventId: string) {
  return `${userId}::${clientEventId}`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function findStaleScheduledNotificationIds(
  rows: ScheduledNotification[],
): Promise<number[]> {
  if (!rows.length) return [];

  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const clientEventIds = Array.from(
    new Set(
      rows.map((row) => row.client_event_id.trim()).filter((id) => id.length),
    ),
  );
  if (!userIds.length || !clientEventIds.length) {
    return rows.map((row) => row.id);
  }

  const eventRows: ScheduledEventRow[] = [];
  for (const batch of chunkArray(clientEventIds, 100)) {
    const { data, error } = await supabase
      .from("user_events")
      .select("user_id, client_event_id, flow_local_id")
      .in("user_id", userIds)
      .in("client_event_id", batch);

    if (error) throw error;
    eventRows.push(...((data ?? []) as ScheduledEventRow[]));
  }

  const eventsByKey = new Map(
    eventRows.map((row) => [
      scheduledEventKey(row.user_id, row.client_event_id),
      row,
    ]),
  );

  const flowIds = Array.from(
    new Set(
      eventRows
        .map((row) => row.flow_local_id)
        .filter((id): id is number =>
          typeof id === "number" && Number.isFinite(id)
        ),
    ),
  );
  const flowIsActive = new Map<number, boolean>();

  for (const batch of chunkArray(flowIds, 100)) {
    const { data, error } = await supabase
      .from("flows")
      .select("id, active")
      .in("id", batch);

    if (error) throw error;
    for (const row of (data ?? []) as FlowStatusRow[]) {
      flowIsActive.set(row.id, row.active === true);
    }
  }

  return rows.filter((row) => {
    const event = eventsByKey.get(
      scheduledEventKey(row.user_id, row.client_event_id),
    );
    if (!event) {
      return true;
    }

    const flowId = event.flow_local_id;
    if (typeof flowId === "number" && Number.isFinite(flowId)) {
      return flowIsActive.get(flowId) !== true;
    }

    return false;
  }).map((row) => row.id);
}

async function findRearmedProcessedScheduledNotificationIds(
  rows: ScheduledNotification[],
): Promise<number[]> {
  if (!rows.length) return [];

  const scheduledAtById = new Map<number, number>();
  for (const row of rows) {
    scheduledAtById.set(row.id, Date.parse(row.scheduled_at));
  }

  const { data, error } = await supabase
    .from("scheduled_notifications")
    .select("id, last_attempt_at")
    .in("id", rows.map((row) => row.id));

  if (error) throw error;

  return ((data ?? []) as Array<
    { id: number; last_attempt_at?: string | null }
  >)
    .filter((row) => {
      const scheduledAtMs = scheduledAtById.get(row.id);
      const lastAttemptAtMs = row.last_attempt_at
        ? Date.parse(row.last_attempt_at)
        : Number.NaN;
      return Number.isFinite(scheduledAtMs) &&
        Number.isFinite(lastAttemptAtMs) &&
        (scheduledAtMs as number) >
          lastAttemptAtMs + REARMED_PROCESSED_ROW_GRACE_MS;
    })
    .map((row) => row.id);
}

function buildNotification(reminder: ReminderRow) {
  const title = sanitizeNotificationText(reminder.title) ?? "Reminder";
  const detail = sanitizeNotificationText(reminder.detail) ?? "";
  const body = detail.length > 0 ? detail : "Tap to open in Kemetic.";
  return { title, body };
}

function buildNotificationFromScheduled(row: ScheduledNotification) {
  const title = sanitizeNotificationText(row.title) ?? "Reminder";
  const body = sanitizeNotificationText(row.body) ?? "Tap to open in Kemetic.";
  return { title, body };
}

function stripMetadataPrefixes(raw: string) {
  let text = raw.trim();
  const colorOrAlertPrefix = /^(?:color=[0-9a-fA-FxX]+;|alert=[-+]?\d+;)/;

  while (text.length) {
    if (text.startsWith("flowLocalId=") || text.startsWith("repeat=")) {
      const semi = text.indexOf(";");
      text = semi >= 0 && semi < text.length - 1
        ? text.slice(semi + 1).trimStart()
        : "";
      continue;
    }

    const match = text.match(colorOrAlertPrefix);
    if (!match) break;
    text = text.slice(match[0].length).trimStart();
  }

  return text.trim();
}

function sanitizeNotificationText(raw?: string | null) {
  if (!raw || !raw.trim().length) return null;

  const cidRegex =
    /^(kemet_cid:)?ky=\d+-km=\d+-kd=\d+\|s=\d+\|t=[^|]+\|f=[^|]+$/i;
  const kept = raw.split(/\r?\n/).map((line) => stripMetadataPrefixes(line))
    .filter((line) => {
      if (!line.length) return false;
      const lowered = line.toLowerCase();
      const collapsed = line.replace(/\s+/g, "");
      if (
        lowered.startsWith("kemet_cid:") ||
        lowered.startsWith("kemetic_cid:") ||
        lowered.startsWith("reminder:")
      ) {
        return false;
      }
      return !cidRegex.test(collapsed);
    });

  if (!kept.length) return null;
  const result = kept.join("\n").trim();
  return result.length ? result : null;
}

async function sendPush(reminder: ReminderRow): Promise<SendPushResponse> {
  const notification = buildNotification(reminder);
  return await invokeSendPush({
    userIds: [reminder.user_id],
    notification,
    data: {
      type: "reminder",
      delivery_key: `reminder:${reminder.id}:${reminder.alert_at}`,
      reminder_id: reminder.id,
      alert_at: reminder.alert_at,
      title: reminder.title ?? "",
    },
  });
}

async function sendPushForScheduled(
  row: ScheduledNotification,
): Promise<SendPushResponse> {
  const notification = buildNotificationFromScheduled(row);
  const payload = safeParseJson(row.payload);
  const notificationType = row.notification_type ?? "event_start";
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      msg: "send_push attempt",
      scheduled_id: row.id,
      user_id: row.user_id,
      client_event_id: row.client_event_id,
      notification_type: notificationType,
      scheduled_at: row.scheduled_at,
    }),
  );

  try {
    const data = await invokeSendPush({
      userIds: [row.user_id],
      notification,
      data: {
        type: "scheduled_notification",
        delivery_key:
          `scheduled_notification:${row.id}:${notificationType}:${row.scheduled_at}`,
        scheduled_id: row.id,
        notification_type: notificationType,
        client_event_id: row.client_event_id,
        scheduled_at: row.scheduled_at,
        payload: payload ??
          (row.payload ? safeParseJson(row.payload) : undefined) ?? {},
      },
    });
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        msg: "send_push success",
        scheduled_id: row.id,
        user_id: row.user_id,
        response: data ?? null,
      }),
    );
    return data;
  } catch (error) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        msg: "send_push failed",
        scheduled_id: row.id,
        user_id: row.user_id,
        error: String(error),
      }),
    );
    throw error;
  }
}

async function markSent(reminderIds: string[]) {
  if (!reminderIds.length) return;
  const { error } = await supabase
    .from("reminders")
    .update({
      status: "sent_push",
      updated_at: new Date().toISOString(),
    })
    .in("id", reminderIds);
  if (error) {
    console.error("Failed to mark reminders sent:", error);
  }
}

async function markScheduledInactive(
  ids: number[],
  claimToken: string,
  nowIso: string,
) {
  if (!ids.length || !claimToken.trim().length) return;
  const { error } = await supabase
    .from("scheduled_notifications")
    .update({
      is_active: false,
      attempt_count: 0,
      last_error: null,
      last_attempt_at: nowIso,
      claimed_at: null,
      claim_token: null,
      updated_at: nowIso,
    })
    .eq("claim_token", claimToken)
    .in("id", ids);
  if (error) {
    console.error("Failed to mark scheduled_notifications inactive:", error);
  }
}

async function markScheduledFailure(
  id: number,
  message: string,
  nowIso: string,
  claimToken: string,
) {
  try {
    const { data, error } = await supabase
      .from("scheduled_notifications")
      .select("attempt_count, is_active")
      .eq("id", id)
      .eq("claim_token", claimToken)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      console.warn(
        JSON.stringify({
          at: nowIso,
          msg: "scheduled_claim_lost_before_failure_update",
          scheduled_id: id,
        }),
      );
      return;
    }
    const attempts = (data?.attempt_count ?? 0) + 1;
    const deactivate = attempts >= 3;

    const { error: upsertError } = await supabase
      .from("scheduled_notifications")
      .update({
        attempt_count: attempts,
        last_error: message,
        last_attempt_at: nowIso,
        is_active: deactivate ? false : data?.is_active ?? true,
        claimed_at: null,
        claim_token: null,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("claim_token", claimToken);

    if (upsertError) throw upsertError;

    console.log(
      JSON.stringify({
        at: nowIso,
        msg: "scheduled_attempt_updated",
        scheduled_id: id,
        attempt_count: attempts,
        deactivated: deactivate,
      }),
    );
  } catch (err) {
    console.error("Failed to record scheduled failure:", err);
  }
}

async function markScheduledUndeliverable(
  row: ScheduledNotification,
  message: string,
  nowIso: string,
) {
  const graceMinutes = parseInt(
    Deno.env.get("NO_TOKEN_GRACE_MINUTES") ?? "1440",
    10,
  );
  const graceMs = Math.max(graceMinutes, 0) * 60 * 1000;
  const scheduledAtMs = Date.parse(row.scheduled_at);
  const nowMs = Date.parse(nowIso);
  const deactivate = Number.isFinite(scheduledAtMs) && Number.isFinite(nowMs)
    ? nowMs - scheduledAtMs > graceMs
    : false;

  try {
    const { error } = await supabase
      .from("scheduled_notifications")
      .update({
        last_error: message,
        last_attempt_at: nowIso,
        is_active: deactivate ? false : true,
        claimed_at: null,
        claim_token: null,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("claim_token", row.claim_token ?? "");

    if (error) throw error;

    console.log(
      JSON.stringify({
        at: nowIso,
        msg: "scheduled_undeliverable",
        scheduled_id: row.id,
        deactivate,
        graceMinutes,
      }),
    );
  } catch (err) {
    console.error("Failed to record scheduled undeliverable state:", err);
  }
}

function safeParseJson(raw?: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

serve(async () => {
  const start = Date.now();
  try {
    const nowIso = new Date().toISOString();
    const due = await fetchDueReminders(nowIso);
    const dueScheduled = await claimDueScheduledNotifications(nowIso);
    const scheduledClaimToken = dueScheduled[0]?.claim_token?.trim() ?? "";
    if (dueScheduled.length && scheduledClaimToken.length) {
      console.log(
        JSON.stringify({
          at: nowIso,
          msg: "claimed_due_scheduled_notifications",
          count: dueScheduled.length,
          claim_token: scheduledClaimToken,
          lease_seconds: SCHEDULED_CLAIM_LEASE_SECONDS,
        }),
      );
    }
    const staleScheduledIds = await findStaleScheduledNotificationIds(
      dueScheduled,
    );
    const rearmedProcessedScheduledIds =
      await findRearmedProcessedScheduledNotificationIds(dueScheduled);
    const staleScheduledIdSet = new Set([
      ...staleScheduledIds,
      ...rearmedProcessedScheduledIds,
    ]);

    if (staleScheduledIdSet.size) {
      await markScheduledInactive(
        Array.from(staleScheduledIdSet),
        scheduledClaimToken,
        nowIso,
      );
    }

    if (staleScheduledIds.length) {
      console.log(
        JSON.stringify({
          at: nowIso,
          msg: "retired_stale_scheduled_notifications",
          count: staleScheduledIds.length,
          scheduled_ids: staleScheduledIds,
        }),
      );
    }

    if (rearmedProcessedScheduledIds.length) {
      console.log(
        JSON.stringify({
          at: nowIso,
          msg: "retired_rearmed_processed_scheduled_notifications",
          count: rearmedProcessedScheduledIds.length,
          scheduled_ids: rearmedProcessedScheduledIds,
        }),
      );
    }

    const eligibleDueScheduled = dueScheduled.filter((row) =>
      !staleScheduledIdSet.has(row.id)
    );

    if (!due.length && !eligibleDueScheduled.length) {
      return new Response(
        JSON.stringify({
          processed: staleScheduledIdSet.size,
          sent: 0,
          failed: 0,
          retiredStaleScheduledIds: staleScheduledIds,
          retiredRearmedProcessedScheduledIds: rearmedProcessedScheduledIds,
          durationMs: Date.now() - start,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const sentIds: string[] = [];
    let failed = 0;
    const failedDetails: Array<Record<string, unknown>> = [];

    for (const reminder of due) {
      try {
        const result = await sendPush(reminder);
        if (result.sent > 0) {
          sentIds.push(reminder.id);
        } else {
          failed += 1;
          failedDetails.push({
            kind: "reminder",
            reminder_id: reminder.id,
            user_id: reminder.user_id,
            error: result.reason ?? "push_not_delivered",
            matched_tokens: result.matchedTokens,
            failed_reasons: result.failedReasons ?? [],
          });
          console.error(
            JSON.stringify({
              at: new Date().toISOString(),
              msg: "reminder push not delivered",
              reminder_id: reminder.id,
              user_id: reminder.user_id,
              reason: result.reason ?? null,
              matched_tokens: result.matchedTokens,
            }),
          );
        }
      } catch (e) {
        failed += 1;
        failedDetails.push({
          kind: "reminder",
          reminder_id: reminder.id,
          user_id: reminder.user_id,
          error: String(e),
        });
        console.error(
          JSON.stringify({
            at: new Date().toISOString(),
            msg: "reminder push failed",
            reminder_id: reminder.id,
            user_id: reminder.user_id,
            error: String(e),
          }),
        );
      }
    }

    const sentScheduledIds: number[] = [];
    for (const row of eligibleDueScheduled) {
      try {
        console.log(
          JSON.stringify({
            msg: "CRON sending scheduled notification",
            scheduled_id: row.id,
            user_id: row.user_id,
            scheduled_at: row.scheduled_at,
            client_event_id: row.client_event_id,
            notification_type: row.notification_type ?? "event_start",
          }),
        );
        const result = await sendPushForScheduled(row);
        if (result.sent > 0) {
          sentScheduledIds.push(row.id);
          continue;
        }

        failed += 1;
        const nowIso = new Date().toISOString();
        const reason = result.reason ?? "push_not_delivered";
        if (reason === "no_tokens_for_recipients") {
          await markScheduledUndeliverable(row, reason, nowIso);
        } else {
          await markScheduledFailure(
            row.id,
            `${reason}${
              result.failedReasons?.length
                ? `: ${result.failedReasons.join(", ")}`
                : ""
            }`,
            nowIso,
            row.claim_token ?? scheduledClaimToken,
          );
        }
        failedDetails.push({
          kind: "scheduled",
          scheduled_id: row.id,
          user_id: row.user_id,
          notification_type: row.notification_type ?? "event_start",
          error: reason,
          matched_tokens: result.matchedTokens,
          failed_reasons: result.failedReasons ?? [],
        });
        console.error(
          JSON.stringify({
            at: nowIso,
            msg: "scheduled_notification push not delivered",
            scheduled_id: row.id,
            user_id: row.user_id,
            reason,
            matched_tokens: result.matchedTokens,
          }),
        );
      } catch (e) {
        failed += 1;
        const nowIso = new Date().toISOString();
        await markScheduledFailure(
          row.id,
          String(e),
          nowIso,
          row.claim_token ?? scheduledClaimToken,
        );
        failedDetails.push({
          kind: "scheduled",
          scheduled_id: row.id,
          user_id: row.user_id,
          notification_type: row.notification_type ?? "event_start",
          error: String(e),
        });
        console.error(
          JSON.stringify({
            at: new Date().toISOString(),
            msg: "scheduled_notification push failed",
            scheduled_id: row.id,
            user_id: row.user_id,
            error: String(e),
          }),
        );
      }
    }

    await markSent(sentIds);
    await markScheduledInactive(
      sentScheduledIds,
      scheduledClaimToken,
      new Date().toISOString(),
    );

    return new Response(
      JSON.stringify({
        processed: due.length + eligibleDueScheduled.length +
          staleScheduledIdSet.size,
        sent: sentIds.length + sentScheduledIds.length,
        failed,
        sentScheduledIds,
        retiredStaleScheduledIds: staleScheduledIds,
        retiredRearmedProcessedScheduledIds: rearmedProcessedScheduledIds,
        failedDetails,
        durationMs: Date.now() - start,
      }),
      {
        status: failed > 0 ? 207 : 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("cron_reminder_push error", e);
    return new Response(
      JSON.stringify({
        error: e?.message ?? String(e),
        durationMs: Date.now() - start,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
