type CronHealthRow = {
  job_name: string;
  schedule: string | null;
  active: boolean | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: string | null;
  last_success_at: string | null;
  success_count: number;
  failure_count: number;
  seconds_since_success: number | null;
  health_status: string;
};

type DeliveryHealthRow = {
  delivery_kind: string;
  cron_job_name: string;
  picked_count: number;
  sent_count: number;
  skipped_count: number;
  failed_count: number;
  duplicate_guarded_count: number;
  duplicate_sent_key_count: number;
  last_event_at: string | null;
  last_sent_at: string | null;
  max_latency_seconds: number | null;
  avg_latency_seconds: number | null;
  late_count: number;
};

type RecentDeliveryEvent = {
  delivery_key: string;
  delivery_kind: string;
  target_table: string;
  target_id: string;
  scheduled_for: string | null;
  delivered_at: string | null;
  delivery_latency_seconds: number | null;
  sla_seconds: number | null;
  cron_job_name: string;
  delivery_status: string;
  skip_reason: string | null;
  error_code: string | null;
  is_late: boolean;
  created_at: string;
  trigger_reason?: string | null;
  cadence_type?: string | null;
  cadence_mode?: string | null;
  compiler_status?: string | null;
  package_version?: string | null;
  push_source?: string | null;
  push_blocked?: boolean | null;
  push_block_reason?: string | null;
};

type ReceiptHealthRow = {
  delivery_key: string;
  delivery_kind: string;
  sent_at: string | null;
  first_received_at: string | null;
  first_shown_at: string | null;
  first_opened_at: string | null;
  first_dismissed_at: string | null;
  first_acted_at: string | null;
  receipt_event_count: number;
  receipt_latency_seconds: number | null;
  open_latency_seconds: number | null;
  receipt_status: string;
};

type DeliveryAlertRow = {
  alert_key: string;
  severity: string;
  source: string;
  subject: string;
  detail: string;
  created_at: string;
};

type PushReleaseBlockerRow = {
  delivery_kind: string;
  delivery_key: string;
  compiler_status: string | null;
  package_version: string | null;
  push_source: string | null;
  push_blocked: boolean | null;
  push_block_reason: string | null;
  created_at: string;
};

function env(name: string) {
  return Deno.env.get(name)?.trim() || null;
}

function requireEnv(...names: string[]) {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  throw new Error(`Missing env: ${names.join(" or ")}`);
}

async function fetchRestRows<T>(
  projectUrl: string,
  serviceKey: string,
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const query = new URL(`${projectUrl.replace(/\/+$/, "")}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    query.searchParams.set(key, value);
  }
  const response = await fetch(query, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `${path} query failed ${response.status}: ${await response.text()}`,
    );
  }
  return await response.json() as T[];
}

function formatSeconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatCronRow(row: CronHealthRow) {
  return [
    `JOB: ${row.job_name}`,
    `SCHEDULE: ${row.schedule ?? "unknown"}`,
    `ACTIVE: ${row.active ?? "unknown"}`,
    `LAST STATUS: ${row.last_status ?? "none"}`,
    `LAST SUCCESS: ${row.last_success_at ?? "none"}`,
    `AGE: ${formatSeconds(row.seconds_since_success)}`,
    `FAILURES: ${row.failure_count}`,
    `STATUS: ${row.health_status}`,
  ].join("\n");
}

function formatDeliveryRow(row: DeliveryHealthRow) {
  const status = row.failed_count > 0 || row.late_count > 0 ||
      row.duplicate_sent_key_count > 0
    ? "attention"
    : "healthy";
  return [
    `DELIVERY: ${row.delivery_kind}`,
    `JOB: ${row.cron_job_name}`,
    `PICKED/SENT/SKIPPED/FAILED: ${row.picked_count}/${row.sent_count}/${row.skipped_count}/${row.failed_count}`,
    `LAST SENT: ${row.last_sent_at ?? "none"}`,
    `MAX LATENCY: ${formatSeconds(row.max_latency_seconds)}`,
    `AVG LATENCY: ${formatSeconds(row.avg_latency_seconds)}`,
    `LATE: ${row.late_count}`,
    `DUPLICATE SENT KEYS: ${row.duplicate_sent_key_count}`,
    `STATUS: ${status}`,
  ].join("\n");
}

function formatRecentEvent(row: RecentDeliveryEvent) {
  const bits = [
    row.delivery_status.toUpperCase(),
    row.delivery_kind,
    row.delivery_key,
    row.cadence_type || row.cadence_mode
      ? `cadence=${row.cadence_type ?? "unknown"}:${
        row.cadence_mode ?? "unknown"
      }`
      : null,
    row.trigger_reason ? `trigger=${row.trigger_reason}` : null,
    `latency=${formatSeconds(row.delivery_latency_seconds)}`,
    `sla=${formatSeconds(row.sla_seconds)}`,
    row.is_late ? "late=true" : null,
    row.package_version ? `package=${row.package_version}` : null,
    row.compiler_status ? `compiler=${row.compiler_status}` : null,
    row.push_source ? `push=${row.push_source}` : null,
    row.push_blocked ? "push_blocked=true" : null,
    row.push_block_reason ? `push_reason=${row.push_block_reason}` : null,
    row.skip_reason ? `skip=${row.skip_reason}` : null,
    row.error_code ? `error=${row.error_code}` : null,
  ].filter(Boolean);
  return bits.join(" | ");
}

function formatReceiptRow(row: ReceiptHealthRow) {
  return [
    `RECEIPT: ${row.delivery_kind}`,
    `KEY: ${row.delivery_key}`,
    `STATUS: ${row.receipt_status}`,
    `EVENTS: ${row.receipt_event_count}`,
    `SENT: ${row.sent_at ?? "none"}`,
    `RECEIVED/SHOWN/OPENED: ${
      row.first_received_at ?? row.first_shown_at ?? "none"
    } / ${row.first_shown_at ?? "none"} / ${row.first_opened_at ?? "none"}`,
    `ACTION: acted=${row.first_acted_at ?? "none"} dismissed=${
      row.first_dismissed_at ?? "none"
    }`,
    `RECEIPT LATENCY: ${formatSeconds(row.receipt_latency_seconds)}`,
    `OPEN LATENCY: ${formatSeconds(row.open_latency_seconds)}`,
  ].join("\n");
}

function formatAlertRow(row: DeliveryAlertRow) {
  return [
    row.severity.toUpperCase(),
    row.source,
    row.subject,
    row.detail,
  ].join(" | ");
}

function formatPushReleaseBlockerRow(row: PushReleaseBlockerRow) {
  return [
    "BLOCKER",
    row.delivery_kind,
    row.delivery_key,
    `compiler=${row.compiler_status ?? "unknown"}`,
    `package=${row.package_version ?? "unknown"}`,
    `push=${row.push_source ?? "unknown"}`,
    `blocked=${row.push_blocked === true}`,
    row.push_block_reason ? `reason=${row.push_block_reason}` : null,
  ].filter(Boolean).join(" | ");
}

export function formatMaatDeliveryReview(args: {
  generatedAt: string;
  cronRows: CronHealthRow[];
  deliveryRows: DeliveryHealthRow[];
  recentRows: RecentDeliveryEvent[];
  receiptRows?: ReceiptHealthRow[];
  alertRows?: DeliveryAlertRow[];
  pushReleaseBlockerRows?: PushReleaseBlockerRow[];
}) {
  const receiptRows = args.receiptRows ?? [];
  const alertRows = args.alertRows ?? [];
  const pushReleaseBlockerRows = args.pushReleaseBlockerRows ?? [];
  return [
    "# Ma'at Delivery Review",
    "",
    `Generated: ${args.generatedAt}`,
    "",
    "## Cron Health",
    args.cronRows.length
      ? args.cronRows.map(formatCronRow).join("\n\n")
      : "No tracked cron rows.",
    "",
    "## Delivery Timing",
    args.deliveryRows.length
      ? args.deliveryRows.map(formatDeliveryRow).join("\n\n")
      : "No delivery timing events yet.",
    "",
    "## Recent Events",
    args.recentRows.length
      ? args.recentRows.map(formatRecentEvent).join("\n")
      : "No recent events.",
    "",
    "## Push Release Gate",
    pushReleaseBlockerRows.length
      ? pushReleaseBlockerRows.map(formatPushReleaseBlockerRow).join("\n")
      : "No push release blockers.",
    "",
    "## Receipt Health",
    receiptRows.length
      ? receiptRows.map(formatReceiptRow).join("\n\n")
      : "No receipt health rows yet.",
    "",
    "## Alerts",
    alertRows.length ? alertRows.map(formatAlertRow).join("\n") : "No alerts.",
  ].join("\n");
}

async function main() {
  const projectUrl = requireEnv("SUPABASE_URL", "PROJECT_URL");
  const serviceKey = requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
  );
  const limit = Number(env("MAAT_DELIVERY_REVIEW_LIMIT") ?? "25");

  const [
    cronRows,
    deliveryRows,
    recentRows,
    receiptRows,
    alertRows,
    pushReleaseBlockerRows,
  ] = await Promise.all([
    fetchRestRows<CronHealthRow>(
      projectUrl,
      serviceKey,
      "maat_delivery_cron_health",
      { select: "*", order: "job_name.asc" },
    ),
    fetchRestRows<DeliveryHealthRow>(
      projectUrl,
      serviceKey,
      "maat_delivery_timing_health",
      { select: "*", order: "cron_job_name.asc,delivery_kind.asc" },
    ),
    fetchRestRows<RecentDeliveryEvent>(
      projectUrl,
      serviceKey,
      "maat_delivery_recent_events",
      {
        select:
          "delivery_key,delivery_kind,target_table,target_id,scheduled_for,delivered_at,delivery_latency_seconds,sla_seconds,cron_job_name,delivery_status,skip_reason,error_code,is_late,created_at,trigger_reason,cadence_type,cadence_mode,compiler_status,package_version,push_source,push_blocked,push_block_reason",
        order: "created_at.desc",
        limit: String(Number.isFinite(limit) ? limit : 25),
      },
    ),
    fetchRestRows<ReceiptHealthRow>(
      projectUrl,
      serviceKey,
      "maat_delivery_receipt_health",
      {
        select:
          "delivery_key,delivery_kind,sent_at,first_received_at,first_shown_at,first_opened_at,first_dismissed_at,first_acted_at,receipt_event_count,receipt_latency_seconds,open_latency_seconds,receipt_status",
        order: "sent_at.desc",
        limit: String(Number.isFinite(limit) ? limit : 25),
      },
    ),
    fetchRestRows<DeliveryAlertRow>(
      projectUrl,
      serviceKey,
      "maat_delivery_alerts",
      {
        select: "alert_key,severity,source,subject,detail,created_at",
        order: "severity.desc,created_at.desc",
        limit: String(Number.isFinite(limit) ? limit : 25),
      },
    ),
    fetchRestRows<PushReleaseBlockerRow>(
      projectUrl,
      serviceKey,
      "maat_delivery_push_release_blockers",
      {
        select:
          "delivery_kind,delivery_key,compiler_status,package_version,push_source,push_blocked,push_block_reason,created_at",
        order: "created_at.desc",
        limit: String(Number.isFinite(limit) ? limit : 25),
      },
    ),
  ]);

  console.log(
    formatMaatDeliveryReview({
      generatedAt: new Date().toISOString(),
      cronRows,
      deliveryRows,
      recentRows,
      receiptRows,
      alertRows,
      pushReleaseBlockerRows,
    }),
  );
}

if (import.meta.main) {
  await main();
}
