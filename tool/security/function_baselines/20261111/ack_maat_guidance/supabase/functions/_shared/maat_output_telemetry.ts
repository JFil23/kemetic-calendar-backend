export const MAAT_OUTPUT_TELEMETRY_VERSION = "maat_output_truth_loop_v1";

export type MaatGuidanceTelemetryAction =
  | "generated"
  | "shown"
  | "opened"
  | "dismissed"
  | "acted"
  | "expired";

export type MaatGuidanceTelemetryDelivery = {
  id: string;
  kind: string;
  decanPeriodKey: string;
  status: string;
  createdAt?: string | null;
  shownAt?: string | null;
  openedAt?: string | null;
  dismissedAt?: string | null;
  actedAt?: string | null;
  expiredAt?: string | null;
};

export type MaatGuidanceDeliveryChannel =
  | "push"
  | "in_app_card"
  | "archive_only";

export type MaatGuidanceTelemetryEventMetadata = {
  deliveryChannel?: MaatGuidanceDeliveryChannel | null;
  userSessionState?: "active" | "inactive" | "returning" | null;
  localHourShown?: number | null;
  wasInterruptive?: boolean | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else {
      current = asRecord(current)[segment];
    }
  }
  return current;
}

function nestedRecord(
  value: Record<string, unknown>,
  path: string[],
): Record<string, unknown> {
  return asRecord(nestedValue(value, path));
}

function nestedString(
  value: Record<string, unknown>,
  path: string[],
): string | null {
  const current = nestedValue(value, path);
  return typeof current === "string" && current.trim().length
    ? current.trim()
    : null;
}

function nestedBoolean(
  value: Record<string, unknown>,
  path: string[],
): boolean | null {
  const current = nestedValue(value, path);
  return typeof current === "boolean" ? current : null;
}

function nestedNumber(
  value: Record<string, unknown>,
  path: string[],
): number | null {
  const current = nestedValue(value, path);
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function minutesBetween(
  later: string | null | undefined,
  earlier: string | null | undefined,
): number | null {
  const laterMs = parseTime(later);
  const earlierMs = parseTime(earlier);
  if (laterMs === null || earlierMs === null || laterMs < earlierMs) {
    return null;
  }
  return Math.round(((laterMs - earlierMs) / 60000) * 100) / 100;
}

function secondsBetween(
  later: string | null | undefined,
  earlier: string | null | undefined,
): number | null {
  const laterMs = parseTime(later);
  const earlierMs = parseTime(earlier);
  if (laterMs === null || earlierMs === null || laterMs < earlierMs) {
    return null;
  }
  return Math.round(((laterMs - earlierMs) / 1000) * 100) / 100;
}

function truthyTimestamp(value: string | null | undefined): boolean {
  return parseTime(value) !== null;
}

export function deliveryChannelFromPayload(
  payload: Record<string, unknown> | null | undefined,
): MaatGuidanceDeliveryChannel {
  const safePayload = asRecord(payload);
  const telemetry = asRecord(safePayload.output_telemetry);
  const outputControl = asRecord(safePayload.output_control);
  const grade = nestedRecord(outputControl, ["grade"]);
  const channel = typeof safePayload.delivery_channel === "string"
    ? safePayload.delivery_channel
    : nestedString(telemetry, ["delivery_channel"]) ??
      nestedString(grade, ["deliveryRecommendation"]);
  return channel === "push" || channel === "archive_only"
    ? channel
    : "in_app_card";
}

export function mergeMaatOutputTelemetry(params: {
  payload: Record<string, unknown> | null | undefined;
  delivery: MaatGuidanceTelemetryDelivery;
  action: MaatGuidanceTelemetryAction;
  nowIso: string;
  eventMetadata?: MaatGuidanceTelemetryEventMetadata | null;
}) {
  const payload = { ...asRecord(params.payload) };
  const previous = asRecord(payload.output_telemetry);
  const outputControl = asRecord(payload.output_control);
  const validation = nestedRecord(outputControl, ["validation"]);
  const grade = nestedRecord(outputControl, ["grade"]);
  const repair = nestedRecord(outputControl, ["repair"]);
  const plan = nestedRecord(outputControl, ["plan"]);

  const shownAt = params.delivery.shownAt;
  const openedAt = params.delivery.openedAt;
  const actedAt = params.delivery.actedAt;
  const dismissedAt = params.delivery.dismissedAt;
  const expiredAt = params.delivery.expiredAt;
  const firstVisibleAt = shownAt ?? openedAt ?? actedAt ?? dismissedAt ??
    params.delivery.createdAt ?? params.nowIso;

  const repairAttempted = nestedBoolean(repair, ["attempted"]) ?? false;
  const repairApplied = nestedBoolean(repair, ["applied"]) ?? false;
  const repairMode = nestedString(repair, ["repair_mode"]) ??
    nestedString(grade, ["repairMode"]) ?? "none";
  const repairReason = nestedString(repair, ["repair_reason"]) ??
    nestedString(grade, ["failureReasons", "0"]);
  const deliveryChannel = params.eventMetadata?.deliveryChannel ??
    deliveryChannelFromPayload(payload);
  const localHourShown = params.eventMetadata?.localHourShown ??
    nestedNumber(previous, ["local_hour_shown"]);
  const userSessionState = params.eventMetadata?.userSessionState ??
    nestedString(previous, ["user_session_state"]);
  const wasInterruptive = params.eventMetadata?.wasInterruptive ??
    deliveryChannel !== "archive_only";
  const dismissedWithinSeconds = secondsBetween(dismissedAt, firstVisibleAt);

  payload.delivery_channel = deliveryChannel;

  payload.output_telemetry = {
    ...previous,
    version: MAAT_OUTPUT_TELEMETRY_VERSION,
    delivery_id: params.delivery.id,
    surface: params.delivery.kind,
    speech_act: nestedString(plan, ["speechAct"]) ??
      nestedString(plan, ["speech_act"]),
    decan_period_key: params.delivery.decanPeriodKey,
    output_generated: true,
    output_validated: nestedBoolean(validation, ["ok"]),
    output_graded: Object.keys(grade).length > 0,
    output_grade_passed: nestedBoolean(grade, ["pass"]),
    grade,
    was_repaired: repairApplied,
    repair_attempted: repairAttempted,
    repair_mode: repairMode,
    repair_reason: repairReason,
    repair,
    delivery_channel: deliveryChannel,
    was_interruptive: wasInterruptive,
    local_hour_shown: localHourShown,
    user_session_state: userSessionState,
    dismissed_within_seconds: dismissedWithinSeconds,
    user_saw_output: truthyTimestamp(shownAt) || truthyTimestamp(openedAt) ||
      truthyTimestamp(actedAt) || truthyTimestamp(dismissedAt),
    user_opened: truthyTimestamp(openedAt) || truthyTimestamp(actedAt),
    user_acted: truthyTimestamp(actedAt),
    dismissed: truthyTimestamp(dismissedAt),
    expired: truthyTimestamp(expiredAt),
    time_to_open_minutes: minutesBetween(openedAt, firstVisibleAt),
    time_to_act_minutes: minutesBetween(actedAt, firstVisibleAt),
    last_action: params.action,
    last_action_at: params.nowIso,
    followup_behavior_window: previous.followup_behavior_window ?? null,
  };

  return payload;
}
