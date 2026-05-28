type TruthLoopRow = {
  output_id: string;
  source_type: string;
  surface: string;
  speech_act: string | null;
  status: string;
  trigger_reason: string | null;
  cta_type: string | null;
  cta_ref: string | null;
  delivery_channel: string | null;
  teaser_text: string | null;
  body_text: string | null;
  output_generated_at: string;
  grade: Record<string, unknown> | null;
  grade_passed: boolean;
  guidance_worthiness_score: number | null;
  delivery_recommendation: string | null;
  repair_attempted: boolean;
  was_repaired: boolean;
  repair_mode: string | null;
  repair_reason: string | null;
  repair_grade_delta: Record<string, unknown> | null;
  user_opened: boolean;
  user_acted: boolean;
  dismissed: boolean;
  was_interruptive: boolean | null;
  local_hour_shown: number | null;
  user_session_state: string | null;
  dismissed_within_seconds: number | null;
  time_to_open_minutes: number | null;
  followup_behavior_window: Record<string, boolean> | null;
  output_control: Record<string, unknown> | null;
  cadence_type?: string | null;
  cadence_mode?: string | null;
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

function flag(row: TruthLoopRow) {
  if (!row.grade_passed) return "FAILED";
  if (row.repair_attempted) return row.was_repaired ? "REPAIRED" : "REPAIR";
  if (row.dismissed) return "DISMISSED";
  if (row.user_acted) return "ACTED";
  return "SEEN";
}

function summarize(row: TruthLoopRow) {
  const followup = row.followup_behavior_window ?? {};
  const followupText = Object.entries(followup)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .join(", ") || "no follow-up signal";
  const repair = row.output_control?.repair &&
      typeof row.output_control.repair === "object"
    ? row.output_control.repair as Record<string, unknown>
    : {};
  const beforeText = typeof repair.pre_repair_text === "string"
    ? repair.pre_repair_text
    : null;
  const afterText = typeof repair.post_repair_text === "string"
    ? repair.post_repair_text
    : row.body_text;
  const header = [
    `[${flag(row)}] ${row.surface}/${row.speech_act ?? "unknown"}`,
    `id=${row.output_id}`,
    `source=${row.source_type}`,
    `status=${row.status}`,
    row.delivery_channel ? `channel=${row.delivery_channel}` : null,
    row.cadence_type || row.cadence_mode
      ? `cadence=${row.cadence_type ?? "unknown"}:${
        row.cadence_mode ?? "unknown"
      }`
      : null,
    row.trigger_reason ? `trigger=${row.trigger_reason}` : null,
    row.guidance_worthiness_score === null
      ? null
      : `worthiness=${row.guidance_worthiness_score}`,
    row.repair_mode ? `repair=${row.repair_mode}` : null,
    row.repair_reason ? `reason=${row.repair_reason}` : null,
    `opened=${row.user_opened}`,
    `acted=${row.user_acted}`,
    `interruptive=${row.was_interruptive ?? "unknown"}`,
    row.time_to_open_minutes === null
      ? null
      : `open_min=${row.time_to_open_minutes}`,
    row.dismissed_within_seconds === null
      ? null
      : `dismiss_sec=${row.dismissed_within_seconds}`,
    `followup=${followupText}`,
  ].filter(Boolean).join(" | ");
  const gradeDelta = row.repair_grade_delta
    ? `\nGRADE DELTA:\n${JSON.stringify(row.repair_grade_delta, null, 2)}`
    : "";
  const before = beforeText ? `\nBEFORE:\n${trimReportText(beforeText)}` : "";
  const after = afterText ? `\nAFTER:\n${trimReportText(afterText)}` : "";
  return `${header}${before}${after}${gradeDelta}`;
}

function trimReportText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 700 ? text : `${text.slice(0, 697)}...`;
}

async function main() {
  const projectUrl = requireEnv("SUPABASE_URL", "PROJECT_URL").replace(
    /\/+$/,
    "",
  );
  const serviceKey = requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
  );
  const limit = Number(env("MAAT_OUTPUT_REVIEW_LIMIT") ?? "50");
  const query = new URL(
    `${projectUrl}/rest/v1/maat_output_truth_loop`,
  );
  query.searchParams.set(
    "select",
    [
      "output_id",
      "source_type",
      "surface",
      "speech_act",
      "status",
      "trigger_reason",
      "cta_type",
      "cta_ref",
      "delivery_channel",
      "teaser_text",
      "body_text",
      "output_generated_at",
      "grade",
      "grade_passed",
      "guidance_worthiness_score",
      "delivery_recommendation",
      "repair_attempted",
      "was_repaired",
      "repair_mode",
      "repair_reason",
      "repair_grade_delta",
      "user_opened",
      "user_acted",
      "dismissed",
      "was_interruptive",
      "local_hour_shown",
      "user_session_state",
      "dismissed_within_seconds",
      "time_to_open_minutes",
      "followup_behavior_window",
      "output_control",
      "cadence_type",
      "cadence_mode",
    ].join(","),
  );
  query.searchParams.set(
    "or",
    "(grade_passed.eq.false,repair_attempted.eq.true,dismissed.eq.true,user_acted.eq.true)",
  );
  query.searchParams.set("order", "output_generated_at.desc");
  query.searchParams.set("limit", String(Number.isFinite(limit) ? limit : 50));

  const response = await fetch(query, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Review query failed ${response.status}: ${await response.text()}`,
    );
  }

  const rows = await response.json() as TruthLoopRow[];
  console.log(`Ma'at output review (${rows.length} rows)`);
  for (const row of rows) console.log(`\n${summarize(row)}`);
}

if (import.meta.main) {
  await main();
}
