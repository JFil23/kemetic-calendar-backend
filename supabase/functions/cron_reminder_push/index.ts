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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL/PROJECT_URL or SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const functionAuthHeader = {
  "x-internal-key": Deno.env.get("INTERNAL_FUNCTION_KEY") ?? "",
};
console.log(
  JSON.stringify({
    at: new Date().toISOString(),
    msg: "cron_reminder_push bootstrap",
    urlPresent: !!SUPABASE_URL,
    serviceRoleLen: SERVICE_ROLE_KEY.length,
  }),
);

async function invokeSendPush(body: Record<string, unknown>): Promise<SendPushResponse> {
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

async function fetchDueScheduledNotifications(nowIso: string): Promise<ScheduledNotification[]> {
  const { data, error } = await supabase
    .from("scheduled_notifications")
    .select("id, user_id, client_event_id, title, body, payload, notification_type, scheduled_at")
    .eq("is_active", true)
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(500); // keep each run bounded

  if (error) throw error;
  return (data ?? []) as ScheduledNotification[];
}

function buildNotification(reminder: ReminderRow) {
  const title = reminder.title?.trim() || "Reminder";
  const detail = reminder.detail?.trim() ?? "";
  const body = detail.length > 0 ? detail : "Tap to view your reminder.";
  return { title, body };
}

function buildNotificationFromScheduled(row: ScheduledNotification) {
  const title = row.title?.trim() || "Reminder";
  const body = (row.body ?? "").trim();
  return { title, body: body.length ? body : undefined };
}

async function sendPush(reminder: ReminderRow): Promise<SendPushResponse> {
  const notification = buildNotification(reminder);
  return await invokeSendPush({
    userIds: [reminder.user_id],
    notification,
    data: {
      type: "reminder",
      reminder_id: reminder.id,
      alert_at: reminder.alert_at,
      title: reminder.title ?? "",
    },
  });
}

async function sendPushForScheduled(row: ScheduledNotification): Promise<SendPushResponse> {
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
        notification_type: notificationType,
        client_event_id: row.client_event_id,
        scheduled_at: row.scheduled_at,
        payload: payload ?? (row.payload ? safeParseJson(row.payload) : undefined) ?? {},
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

async function markScheduledInactive(ids: number[]) {
  if (!ids.length) return;
  const { error } = await supabase
    .from("scheduled_notifications")
    .update({
      is_active: false,
      attempt_count: 0,
      last_error: null,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (error) {
    console.error("Failed to mark scheduled_notifications inactive:", error);
  }
}

async function markScheduledFailure(id: number, message: string, nowIso: string) {
  try {
    const { data, error } = await supabase
      .from("scheduled_notifications")
      .select("attempt_count, is_active")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    const attempts = (data?.attempt_count ?? 0) + 1;
    const deactivate = attempts >= 3;

    const { error: upsertError } = await supabase
      .from("scheduled_notifications")
      .update({
        attempt_count: attempts,
        last_error: message,
        last_attempt_at: nowIso,
        is_active: deactivate ? false : data?.is_active ?? true,
        updated_at: nowIso,
      })
      .eq("id", id);

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
  const graceMinutes = parseInt(Deno.env.get("NO_TOKEN_GRACE_MINUTES") ?? "1440", 10);
  const graceMs = Math.max(graceMinutes, 0) * 60 * 1000;
  const scheduledAtMs = Date.parse(row.scheduled_at);
  const nowMs = Date.parse(nowIso);
  const deactivate =
    Number.isFinite(scheduledAtMs) && Number.isFinite(nowMs)
      ? nowMs - scheduledAtMs > graceMs
      : false;

  try {
    const { error } = await supabase
      .from("scheduled_notifications")
      .update({
        last_error: message,
        last_attempt_at: nowIso,
        is_active: deactivate ? false : true,
        updated_at: nowIso,
      })
      .eq("id", row.id);

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
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

serve(async () => {
  const start = Date.now();
  try {
    const nowIso = new Date().toISOString();
    const due = await fetchDueReminders(nowIso);
    const dueScheduled = await fetchDueScheduledNotifications(nowIso);

    if (!due.length && !dueScheduled.length) {
      return new Response(
        JSON.stringify({ processed: 0, sent: 0, failed: 0, durationMs: Date.now() - start }),
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
    for (const row of dueScheduled) {
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
            `${reason}${result.failedReasons?.length ? `: ${result.failedReasons.join(", ")}` : ""}`,
            nowIso,
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
        await markScheduledFailure(row.id, String(e), nowIso);
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
    await markScheduledInactive(sentScheduledIds);

    return new Response(
      JSON.stringify({
        processed: due.length + dueScheduled.length,
        sent: sentIds.length + sentScheduledIds.length,
        failed,
        sentScheduledIds,
        failedDetails,
        durationMs: Date.now() - start,
      }),
      { status: failed > 0 ? 207 : 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("cron_reminder_push error", e);
    return new Response(
      JSON.stringify({ error: e?.message ?? String(e), durationMs: Date.now() - start }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
