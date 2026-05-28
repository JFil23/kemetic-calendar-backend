import {
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatMaatDeliveryReview } from "./maat_delivery_review.ts";

Deno.test("formatMaatDeliveryReview surfaces cron and delivery timing risk", () => {
  const report = formatMaatDeliveryReview({
    generatedAt: "2026-05-23T05:00:00.000Z",
    cronRows: [{
      job_name: "cron_reminder_push_1m",
      schedule: "* * * * *",
      active: true,
      last_started_at: "2026-05-23T04:59:00.000Z",
      last_finished_at: "2026-05-23T04:59:01.000Z",
      last_status: "succeeded",
      last_success_at: "2026-05-23T04:59:01.000Z",
      success_count: 10,
      failure_count: 0,
      seconds_since_success: 59,
      health_status: "healthy",
    }],
    deliveryRows: [{
      delivery_kind: "reminder",
      cron_job_name: "cron_reminder_push_1m",
      picked_count: 2,
      sent_count: 1,
      skipped_count: 0,
      failed_count: 1,
      duplicate_guarded_count: 0,
      duplicate_sent_key_count: 0,
      last_event_at: "2026-05-23T04:59:01.000Z",
      last_sent_at: "2026-05-23T04:59:01.000Z",
      max_latency_seconds: 42,
      avg_latency_seconds: 42,
      late_count: 0,
    }],
    recentRows: [{
      delivery_key: "reminder:abc:2026-05-23T04:58:20.000Z",
      delivery_kind: "reminder",
      target_table: "reminders",
      target_id: "abc",
      scheduled_for: "2026-05-23T04:58:20.000Z",
      delivered_at: "2026-05-23T04:59:01.000Z",
      delivery_latency_seconds: 41,
      sla_seconds: 90,
      cron_job_name: "cron_reminder_push_1m",
      delivery_status: "sent",
      skip_reason: null,
      error_code: null,
      is_late: false,
      created_at: "2026-05-23T04:59:01.000Z",
      trigger_reason: "decan_day_5_maat",
      cadence_type: "decan_day_5",
      cadence_mode: "maat",
      compiler_status: "compiled",
      package_version: "compiled_output_package_v1",
      push_source: "compiled_package.push_text",
      push_blocked: false,
      push_block_reason: null,
    }],
    receiptRows: [{
      delivery_key: "reminder:abc:2026-05-23T04:58:20.000Z",
      delivery_kind: "reminder",
      sent_at: "2026-05-23T04:59:01.000Z",
      first_received_at: "2026-05-23T04:59:10.000Z",
      first_shown_at: null,
      first_opened_at: "2026-05-23T05:00:00.000Z",
      first_dismissed_at: null,
      first_acted_at: null,
      receipt_event_count: 2,
      receipt_latency_seconds: 9,
      open_latency_seconds: 59,
      receipt_status: "opened",
    }],
    alertRows: [{
      alert_key: "timing:cron_reminder_push_1m:reminder",
      severity: "critical",
      source: "delivery_timing",
      subject: "cron_reminder_push_1m/reminder",
      detail: "failed=1; late=0; duplicate_sent=0; max_latency=42",
      created_at: "2026-05-23T05:00:00.000Z",
    }],
    pushReleaseBlockerRows: [{
      delivery_kind: "strength_nudge",
      delivery_key: "maat_guidance:bad",
      compiler_status: "compiled",
      package_version: "compiled_output_package_v1",
      push_source: "legacy_body_excerpt",
      push_blocked: false,
      push_block_reason: null,
      created_at: "2026-05-23T05:00:00.000Z",
    }],
  });

  assertStringIncludes(report, "JOB: cron_reminder_push_1m");
  assertStringIncludes(report, "PICKED/SENT/SKIPPED/FAILED: 2/1/0/1");
  assertStringIncludes(report, "STATUS: attention");
  assertStringIncludes(report, "SENT | reminder");
  assertStringIncludes(report, "cadence=decan_day_5:maat");
  assertStringIncludes(report, "trigger=decan_day_5_maat");
  assertStringIncludes(report, "package=compiled_output_package_v1");
  assertStringIncludes(report, "push=compiled_package.push_text");
  assertStringIncludes(report, "latency=41s");
  assertStringIncludes(report, "## Push Release Gate");
  assertStringIncludes(report, "BLOCKER | strength_nudge");
  assertStringIncludes(report, "push=legacy_body_excerpt");
  assertStringIncludes(report, "## Receipt Health");
  assertStringIncludes(report, "STATUS: opened");
  assertStringIncludes(report, "RECEIPT LATENCY: 9s");
  assertStringIncludes(report, "## Alerts");
  assertStringIncludes(report, "CRITICAL | delivery_timing");
});

Deno.test("formatMaatDeliveryReview reports a clean push release gate", () => {
  const report = formatMaatDeliveryReview({
    generatedAt: "2026-05-23T05:00:00.000Z",
    cronRows: [],
    deliveryRows: [],
    recentRows: [],
    pushReleaseBlockerRows: [],
  });

  assertStringIncludes(report, "## Push Release Gate");
  assertStringIncludes(report, "No push release blockers.");
});
