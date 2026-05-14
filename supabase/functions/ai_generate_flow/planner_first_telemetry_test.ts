import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildPlannerFirstTelemetry } from "./planner_first_telemetry.ts";

Deno.test("buildPlannerFirstTelemetry marks disabled planner-first mode", () => {
  const telemetry = buildPlannerFirstTelemetry({
    enabled: false,
    mode: "ELABORATION",
    hasPlanInputs: true,
    attempted: false,
    used: false,
    servedFromCache: false,
  });

  assertEquals(telemetry.planner_first_enabled, false);
  assertEquals(telemetry.planner_first_status, "planner_first_disabled");
  assertEquals(
    telemetry.planner_first_skip_reason,
    "planner_first_disabled",
  );
});

Deno.test("buildPlannerFirstTelemetry marks cached planner-first usage", () => {
  const telemetry = buildPlannerFirstTelemetry({
    enabled: true,
    mode: "ELABORATION",
    hasPlanInputs: true,
    attempted: false,
    used: true,
    servedFromCache: true,
    plannerFirstError: null,
  });

  assertEquals(telemetry.planner_first_used, true);
  assertEquals(telemetry.planner_first_attempted, false);
  assertEquals(telemetry.planner_first_status, "cache_used");
  assertEquals(telemetry.planner_first_error, null);
  assertEquals(telemetry.planner_first_skip_reason, null);
});

Deno.test(
  "buildPlannerFirstTelemetry preserves planner-first fallback reason",
  () => {
    const telemetry = buildPlannerFirstTelemetry({
      enabled: true,
      mode: "ELABORATION",
      hasPlanInputs: true,
      attempted: true,
      used: false,
      servedFromCache: false,
      plannerFirstError: "planner_first_parse_error",
    });

    assertEquals(telemetry.planner_first_used, false);
    assertEquals(telemetry.planner_first_attempted, true);
    assertEquals(telemetry.planner_first_status, "planner_first_fallback");
    assertEquals(telemetry.planner_first_error, "planner_first_parse_error");
    assertEquals(telemetry.planner_first_skip_reason, null);
  },
);

Deno.test("buildPlannerFirstTelemetry marks dictation as skipped", () => {
  const telemetry = buildPlannerFirstTelemetry({
    enabled: true,
    mode: "DICTATION",
    hasPlanInputs: true,
    attempted: false,
    used: false,
    servedFromCache: false,
  });

  assertEquals(telemetry.planner_first_eligible, false);
  assertEquals(telemetry.planner_first_status, "dictation_mode");
  assertEquals(telemetry.planner_first_skip_reason, "dictation_mode");
  assertEquals(telemetry.planner_first_error, null);
});
