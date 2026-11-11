export type PlannerFirstStatus =
  | "planner_first_disabled"
  | "dictation_mode"
  | "missing_plan_inputs"
  | "cache_used"
  | "planner_first_used"
  | "planner_first_fallback";

export type PlannerFirstTelemetry = {
  planner_first_enabled: boolean;
  planner_first_eligible: boolean;
  planner_first_attempted: boolean;
  planner_first_used: boolean;
  planner_first_status: PlannerFirstStatus;
  planner_first_error: string | null;
  planner_first_skip_reason: string | null;
};

export function buildPlannerFirstTelemetry(args: {
  enabled: boolean;
  mode: "DICTATION" | "ELABORATION";
  hasPlanInputs: boolean;
  attempted: boolean;
  used: boolean;
  servedFromCache: boolean;
  plannerFirstError?: string | null;
  planSpecError?: string | null;
}): PlannerFirstTelemetry {
  const plannerFirstEnabled = args.enabled;
  const plannerFirstEligible = plannerFirstEnabled &&
    args.mode !== "DICTATION" &&
    args.hasPlanInputs;
  const plannerFirstError = normalizePlannerFirstError(
    args.plannerFirstError ?? args.planSpecError ?? null,
  );

  if (!plannerFirstEnabled) {
    return {
      planner_first_enabled: false,
      planner_first_eligible: false,
      planner_first_attempted: false,
      planner_first_used: false,
      planner_first_status: "planner_first_disabled",
      planner_first_error: null,
      planner_first_skip_reason: "planner_first_disabled",
    };
  }

  if (args.mode === "DICTATION") {
    return {
      planner_first_enabled: true,
      planner_first_eligible: false,
      planner_first_attempted: false,
      planner_first_used: false,
      planner_first_status: "dictation_mode",
      planner_first_error: null,
      planner_first_skip_reason: "dictation_mode",
    };
  }

  if (!args.hasPlanInputs) {
    return {
      planner_first_enabled: true,
      planner_first_eligible: false,
      planner_first_attempted: false,
      planner_first_used: false,
      planner_first_status: "missing_plan_inputs",
      planner_first_error: null,
      planner_first_skip_reason: "missing_plan_inputs",
    };
  }

  if (args.used && args.servedFromCache && !args.attempted) {
    return {
      planner_first_enabled: true,
      planner_first_eligible: true,
      planner_first_attempted: false,
      planner_first_used: true,
      planner_first_status: "cache_used",
      planner_first_error: null,
      planner_first_skip_reason: null,
    };
  }

  if (args.used) {
    return {
      planner_first_enabled: true,
      planner_first_eligible: true,
      planner_first_attempted: args.attempted,
      planner_first_used: true,
      planner_first_status: "planner_first_used",
      planner_first_error: null,
      planner_first_skip_reason: null,
    };
  }

  return {
    planner_first_enabled: true,
    planner_first_eligible: plannerFirstEligible,
    planner_first_attempted: args.attempted,
    planner_first_used: false,
    planner_first_status: "planner_first_fallback",
    planner_first_error: plannerFirstError,
    planner_first_skip_reason: args.attempted
      ? null
      : "planner_first_not_attempted",
  };
}

function normalizePlannerFirstError(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
