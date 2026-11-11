export type MaatDeliveryTimingStatus =
  | "picked"
  | "sent"
  | "skipped"
  | "failed"
  | "duplicate_guarded";

export type MaatDeliveryTimingEvent = {
  deliveryKey: string;
  deliveryKind: string;
  targetTable: string;
  targetId: string;
  userId?: string | null;
  scheduledFor?: string | null;
  cronPickedAt?: string | null;
  functionStartedAt?: string | null;
  deliveredAt?: string | null;
  cronJobName: string;
  deliveryAttempt?: number | null;
  deliveryStatus: MaatDeliveryTimingStatus;
  skipReason?: string | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
};

type DeliveryTimingClient = {
  // Supabase insert returns a thenable query builder; tests often provide a
  // simple Promise. Keep this narrow but flexible.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

function errorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export function deliveryLatencySeconds(
  scheduledFor?: string | null,
  deliveredAt?: string | null,
) {
  if (!scheduledFor || !deliveredAt) return null;
  const scheduledMs = Date.parse(scheduledFor);
  const deliveredMs = Date.parse(deliveredAt);
  if (!Number.isFinite(scheduledMs) || !Number.isFinite(deliveredMs)) {
    return null;
  }
  return Math.max(0, Math.round((deliveredMs - scheduledMs) / 1000));
}

export async function recordMaatDeliveryTimingEvent(
  client: DeliveryTimingClient,
  event: MaatDeliveryTimingEvent,
) {
  const row = {
    delivery_key: event.deliveryKey,
    delivery_kind: event.deliveryKind,
    target_table: event.targetTable,
    target_id: event.targetId,
    user_id: event.userId ?? null,
    scheduled_for: event.scheduledFor ?? null,
    cron_picked_at: event.cronPickedAt ?? null,
    function_started_at: event.functionStartedAt ?? null,
    delivered_at: event.deliveredAt ?? null,
    cron_job_name: event.cronJobName,
    delivery_attempt: event.deliveryAttempt ?? 1,
    delivery_status: event.deliveryStatus,
    skip_reason: event.skipReason ?? null,
    error_code: event.errorCode ?? null,
    metadata: event.metadata ?? {},
  };

  try {
    const table = client.from("maat_delivery_timing_events");
    if (typeof table?.insert !== "function") return false;
    const { error } = await table.insert(row);
    if (error) {
      console.error(
        JSON.stringify({
          msg: "maat_delivery_timing_event_insert_failed",
          delivery_key: event.deliveryKey,
          delivery_status: event.deliveryStatus,
          error: errorMessage(error),
        }),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "maat_delivery_timing_event_insert_exception",
        delivery_key: event.deliveryKey,
        delivery_status: event.deliveryStatus,
        error: errorMessage(error),
      }),
    );
    return false;
  }
}
