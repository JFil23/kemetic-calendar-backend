// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { mergeMaatOutputTelemetry } from "./maat_output_telemetry.ts";

Deno.test("mergeMaatOutputTelemetry records output state and user timing", () => {
  const payload = mergeMaatOutputTelemetry({
    action: "opened",
    nowIso: "2026-05-18T19:00:00.000Z",
    payload: {
      output_control: {
        plan: { speechAct: "correct" },
        validation: { ok: true },
        grade: {
          pass: false,
          repairMode: "cadence_repair",
          deliveryRecommendation: "archive_only",
          failureReasons: ["ceremonial_cadence_below_threshold"],
        },
      },
    },
    delivery: {
      id: "delivery-1",
      kind: "drift_nudge",
      decanPeriodKey: "2026-05-16:2026-05-25:1-1",
      status: "opened",
      createdAt: "2026-05-18T17:50:00.000Z",
      shownAt: "2026-05-18T18:00:00.000Z",
      openedAt: "2026-05-18T19:00:00.000Z",
    },
  });

  const telemetry = payload.output_telemetry as Record<string, unknown>;
  assertEquals(telemetry.version, "maat_output_truth_loop_v1");
  assertEquals(telemetry.surface, "drift_nudge");
  assertEquals(telemetry.speech_act, "correct");
  assertEquals(telemetry.output_validated, true);
  assertEquals(telemetry.output_grade_passed, false);
  assertEquals(telemetry.repair_mode, "cadence_repair");
  assertEquals(telemetry.delivery_channel, "archive_only");
  assertEquals(telemetry.was_interruptive, false);
  assertEquals(
    telemetry.repair_reason,
    "ceremonial_cadence_below_threshold",
  );
  assertEquals(telemetry.user_opened, true);
  assertEquals(telemetry.time_to_open_minutes, 60);
});
