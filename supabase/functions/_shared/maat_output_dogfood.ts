import type { MaatOutputSurface, MaatSpeechAct } from "./maat_constitution.ts";

export type MaatDogfoodFailureTag =
  | "grounding_failure"
  | "cadence_failure"
  | "moral_posture_failure"
  | "action_clarity_failure"
  | "wrong_delivery_channel"
  | "not_worth_interrupting"
  | "high_worthiness_fast_dismiss"
  | "repair_degraded_cadence"
  | "should_become_eval_case";

export type MaatDogfoodDisposition =
  | "keep"
  | "repair"
  | "archive_only"
  | "never_show"
  | "eval_case";

export type MaatDogfoodReviewSource =
  | "real_usage"
  | "synthetic"
  | "smoke";

export type MaatDogfoodDominantFailure =
  | "grounding"
  | "cadence"
  | "moral_posture"
  | "action_clarity"
  | "worthiness"
  | "delivery_mismatch"
  | "repair_regression";

export type MaatDogfoodAnnotation = {
  outputId: string;
  disposition: MaatDogfoodDisposition;
  failureTags?: MaatDogfoodFailureTag[];
  reviewSource?: MaatDogfoodReviewSource;
  dominantFailure?: MaatDogfoodDominantFailure;
  convertedEvalCaseId?: string;
  notes?: string;
};

export type MaatDogfoodTruthLoopRow = {
  output_id: string;
  source_type: string;
  surface: string;
  speech_act: string | null;
  status: string;
  delivery_channel: string | null;
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
  dismissed_within_seconds: number | null;
  followup_behavior_window: Record<string, boolean> | null;
};

export type MaatDogfoodReviewedOutput = {
  row: MaatDogfoodTruthLoopRow;
  disposition: MaatDogfoodDisposition;
  failureTags: MaatDogfoodFailureTag[];
  notes: string | null;
  reviewSource: MaatDogfoodReviewSource | null;
  dominantFailure: MaatDogfoodDominantFailure | null;
  convertedEvalCaseId: string | null;
  conversionReady: boolean;
  worthiness: number;
  qualityScore: number;
  riskScore: number;
};

export type MaatDogfoodSummary = {
  total: number;
  passed: number;
  failed: number;
  acted: number;
  dismissed: number;
  archiveOnly: number;
  repaired: number;
  highWorthinessFastDismiss: number;
  notWorthInterrupting: number;
  repairDegradedCadence: number;
  evalCandidates: number;
  realReviewedFailures: number;
  evalCasesConverted: number;
  evalDraftConversionRate: number | null;
};

export type MaatDogfoodReport = {
  generatedAt: string;
  days: number;
  summary: MaatDogfoodSummary;
  reviewed: MaatDogfoodReviewedOutput[];
  best: MaatDogfoodReviewedOutput[];
  worst: MaatDogfoodReviewedOutput[];
  evalDrafts: MaatDogfoodEvalDraft[];
};

export type MaatDogfoodEvalDraft = {
  id: string;
  sourceOutputId: string;
  surface: MaatOutputSurface | string;
  expectedSpeechAct: MaatSpeechAct | string | null;
  observedText: string;
  failureTags: MaatDogfoodFailureTag[];
  reviewSource: MaatDogfoodReviewSource | null;
  dominantFailure: MaatDogfoodDominantFailure | null;
  conversionReady: boolean;
  goldNotes: string;
};

type FetchDogfoodRowsArgs = {
  projectUrl: string;
  serviceKey: string;
  days?: number;
  limit?: number;
};

const SELECT_FIELDS = [
  "output_id",
  "source_type",
  "surface",
  "speech_act",
  "status",
  "delivery_channel",
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
  "dismissed_within_seconds",
  "followup_behavior_window",
];

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

export async function fetchMaatDogfoodRows(
  args: FetchDogfoodRowsArgs,
): Promise<MaatDogfoodTruthLoopRow[]> {
  const days = args.days ?? 7;
  const limit = args.limit ?? 200;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString();
  const query = new URL(
    `${args.projectUrl.replace(/\/+$/, "")}/rest/v1/maat_output_truth_loop`,
  );
  query.searchParams.set("select", SELECT_FIELDS.join(","));
  query.searchParams.set("output_generated_at", `gte.${since}`);
  query.searchParams.set("order", "output_generated_at.desc");
  query.searchParams.set("limit", String(limit));

  const response = await fetch(query, {
    headers: {
      apikey: args.serviceKey,
      authorization: `Bearer ${args.serviceKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Dogfood query failed ${response.status}: ${await response.text()}`,
    );
  }
  return await response.json() as MaatDogfoodTruthLoopRow[];
}

export function reviewMaatDogfoodOutputs(
  rows: MaatDogfoodTruthLoopRow[],
  annotations: MaatDogfoodAnnotation[] = [],
  generatedAt = new Date(),
  days = 7,
): MaatDogfoodReport {
  const byId = new Map(annotations.map((item) => [item.outputId, item]));
  const reviewed = rows.map((row) => reviewRow(row, byId.get(row.output_id)));
  const best = [...reviewed]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 5);
  const worst = [...reviewed]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);
  const evalDrafts = buildMaatDogfoodEvalDrafts(reviewed);

  return {
    generatedAt: generatedAt.toISOString(),
    days,
    summary: summarizeDogfood(reviewed),
    reviewed,
    best,
    worst,
    evalDrafts,
  };
}

export function formatMaatDogfoodReport(report: MaatDogfoodReport) {
  const lines = [
    `# Ma'at Output Dogfood`,
    "",
    `Generated: ${report.generatedAt}`,
    `Window: ${report.days} day${report.days === 1 ? "" : "s"}`,
    "",
    `## Summary`,
    `- total: ${report.summary.total}`,
    `- passed: ${report.summary.passed}`,
    `- failed: ${report.summary.failed}`,
    `- acted: ${report.summary.acted}`,
    `- dismissed: ${report.summary.dismissed}`,
    `- archive_only: ${report.summary.archiveOnly}`,
    `- repaired: ${report.summary.repaired}`,
    `- high_worthiness_fast_dismiss: ${report.summary.highWorthinessFastDismiss}`,
    `- not_worth_interrupting: ${report.summary.notWorthInterrupting}`,
    `- repair_degraded_cadence: ${report.summary.repairDegradedCadence}`,
    `- eval_candidates: ${report.summary.evalCandidates}`,
    `- real_reviewed_failures: ${report.summary.realReviewedFailures}`,
    `- eval_cases_converted: ${report.summary.evalCasesConverted}`,
    `- eval_draft_conversion_rate: ${
      report.summary.evalDraftConversionRate === null
        ? "n/a"
        : report.summary.evalDraftConversionRate.toFixed(2)
    }`,
    "",
    `## Best 5`,
    ...report.best.map(formatReviewedLine),
    "",
    `## Worst 5`,
    ...report.worst.map(formatReviewedLine),
    "",
    `## Eval Drafts`,
    ...report.evalDrafts.map((draft) =>
      [
        `- ${draft.id}: ${draft.surface}/${
          draft.expectedSpeechAct ?? "unknown"
        }`,
        `  tags: ${draft.failureTags.join(", ")}`,
        `  review_source: ${draft.reviewSource ?? "unreviewed"}`,
        `  dominant_failure: ${draft.dominantFailure ?? "unspecified"}`,
        `  conversion_ready: ${draft.conversionReady}`,
        `  notes: ${draft.goldNotes}`,
      ].join("\n")
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function parseMaatDogfoodAnnotations(
  text: string,
): MaatDogfoodAnnotation[] {
  const parsed = JSON.parse(text) as unknown;
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.annotations)
    ? parsed.annotations
    : [];
  return raw
    .map(normalizeAnnotation)
    .filter((item): item is MaatDogfoodAnnotation => item !== null);
}

function reviewRow(
  row: MaatDogfoodTruthLoopRow,
  annotation?: MaatDogfoodAnnotation,
): MaatDogfoodReviewedOutput {
  const automaticTags = automaticFailureTags(row);
  const manualTags = annotation?.failureTags ?? [];
  const failureTags = uniqueTags([...automaticTags, ...manualTags]);
  const worthiness = row.guidance_worthiness_score ?? gradeNumber(
    row.grade,
    "guidanceWorthinessScore",
    0,
  );
  const reviewSource = annotation?.reviewSource ?? null;
  const dominantFailure = annotation?.dominantFailure ??
    inferDominantFailure(failureTags);
  const convertedEvalCaseId = annotation?.convertedEvalCaseId?.trim() || null;
  const disposition = annotation?.disposition ?? automaticDisposition(
    row,
    failureTags,
  );
  const conversionReady = reviewSource === "real_usage" &&
    disposition === "eval_case" &&
    convertedEvalCaseId === null;
  return {
    row,
    disposition,
    failureTags,
    notes: annotation?.notes ?? null,
    reviewSource,
    dominantFailure,
    convertedEvalCaseId,
    conversionReady,
    worthiness,
    qualityScore: qualityScore(row, worthiness),
    riskScore: riskScore(row, worthiness, failureTags),
  };
}

function summarizeDogfood(
  reviewed: MaatDogfoodReviewedOutput[],
): MaatDogfoodSummary {
  const realReviewedFailures =
    reviewed.filter((item) =>
      item.reviewSource === "real_usage" && shouldDraftEvalCase(item)
    ).length;
  const evalCasesConverted =
    reviewed.filter((item) =>
      item.reviewSource === "real_usage" &&
      shouldDraftEvalCase(item) &&
      item.convertedEvalCaseId !== null
    ).length;
  return {
    total: reviewed.length,
    passed: reviewed.filter((item) => item.row.grade_passed).length,
    failed: reviewed.filter((item) => !item.row.grade_passed).length,
    acted: reviewed.filter((item) => item.row.user_acted).length,
    dismissed: reviewed.filter((item) => item.row.dismissed).length,
    archiveOnly: reviewed.filter((item) =>
      item.row.status === "archive_only" ||
      item.row.delivery_channel === "archive_only"
    ).length,
    repaired: reviewed.filter((item) => item.row.was_repaired).length,
    highWorthinessFastDismiss:
      reviewed.filter((item) =>
        item.failureTags.includes("high_worthiness_fast_dismiss")
      ).length,
    notWorthInterrupting:
      reviewed.filter((item) =>
        item.failureTags.includes("not_worth_interrupting")
      ).length,
    repairDegradedCadence:
      reviewed.filter((item) =>
        item.failureTags.includes("repair_degraded_cadence")
      ).length,
    evalCandidates: reviewed.filter(shouldDraftEvalCase).length,
    realReviewedFailures,
    evalCasesConverted,
    evalDraftConversionRate: realReviewedFailures === 0
      ? null
      : evalCasesConverted / realReviewedFailures,
  };
}

function buildMaatDogfoodEvalDrafts(
  reviewed: MaatDogfoodReviewedOutput[],
): MaatDogfoodEvalDraft[] {
  return reviewed
    .filter(shouldDraftEvalCase)
    .filter((item) => item.convertedEvalCaseId === null)
    .slice(0, 25)
    .map((item) => ({
      id: `dogfood_${safeId(item.row.surface)}_${safeId(item.row.output_id)}`,
      sourceOutputId: item.row.output_id,
      surface: item.row.surface,
      expectedSpeechAct: item.row.speech_act,
      observedText: item.row.body_text ?? "",
      failureTags: item.failureTags,
      reviewSource: item.reviewSource,
      dominantFailure: item.dominantFailure,
      conversionReady: item.conversionReady,
      goldNotes: item.notes ??
        `Dogfood failure: ${item.failureTags.join(", ")}.`,
    }));
}

function automaticFailureTags(
  row: MaatDogfoodTruthLoopRow,
): MaatDogfoodFailureTag[] {
  const tags: MaatDogfoodFailureTag[] = [];
  const failures = failureReasons(row.grade);
  if (failures.includes("grounding_below_threshold")) {
    tags.push("grounding_failure");
  }
  if (
    failures.includes("cadence_below_threshold") ||
    failures.includes("ceremonial_cadence_below_threshold")
  ) {
    tags.push("cadence_failure");
  }
  if (failures.includes("maat_alignment_below_threshold")) {
    tags.push("moral_posture_failure");
  }
  if (
    failures.includes("specificity_below_threshold") ||
    gradeNumber(row.grade, "actionClarityScore", 5) < 4
  ) {
    tags.push("action_clarity_failure");
  }

  const worthiness = row.guidance_worthiness_score ?? gradeNumber(
    row.grade,
    "guidanceWorthinessScore",
    0,
  );
  if ((row.was_interruptive ?? false) && worthiness < 4.2) {
    tags.push("not_worth_interrupting", "wrong_delivery_channel");
  }
  if (
    row.delivery_recommendation &&
    row.delivery_channel &&
    row.delivery_recommendation !== row.delivery_channel
  ) {
    tags.push("wrong_delivery_channel");
  }
  if (
    row.dismissed &&
    (row.dismissed_within_seconds ?? Number.POSITIVE_INFINITY) <= 5 &&
    worthiness >= 4.2
  ) {
    tags.push("high_worthiness_fast_dismiss");
  }
  if (
    gradeDeltaNumber(row.repair_grade_delta, "ceremonial_cadence_score") < 0
  ) {
    tags.push("repair_degraded_cadence", "cadence_failure");
  }
  if (!row.grade_passed || tags.length > 0) {
    tags.push("should_become_eval_case");
  }
  return uniqueTags(tags);
}

function automaticDisposition(
  row: MaatDogfoodTruthLoopRow,
  tags: MaatDogfoodFailureTag[],
): MaatDogfoodDisposition {
  if (
    row.status === "archive_only" ||
    row.delivery_channel === "archive_only" ||
    tags.includes("not_worth_interrupting")
  ) {
    return "archive_only";
  }
  if (
    !row.grade_passed ||
    tags.includes("high_worthiness_fast_dismiss") ||
    tags.includes("repair_degraded_cadence")
  ) {
    return "repair";
  }
  return "keep";
}

function qualityScore(row: MaatDogfoodTruthLoopRow, worthiness: number) {
  let score = worthiness;
  if (row.grade_passed) score += 2;
  if (row.user_acted) score += 2;
  if (row.user_opened) score += 1;
  if (row.was_repaired) score += 0.5;
  if (row.dismissed) score -= 2;
  if (row.delivery_channel === "archive_only") score -= 1;
  return score;
}

function riskScore(
  row: MaatDogfoodTruthLoopRow,
  worthiness: number,
  tags: MaatDogfoodFailureTag[],
) {
  let score = 0;
  if (!row.grade_passed) score += 4;
  if (row.dismissed) score += 1;
  if (
    row.dismissed_within_seconds !== null && row.dismissed_within_seconds <= 5
  ) {
    score += 3;
  }
  if ((row.was_interruptive ?? false) && worthiness < 4.2) score += 4;
  if (tags.includes("repair_degraded_cadence")) score += 3;
  if (tags.includes("wrong_delivery_channel")) score += 2;
  if (tags.includes("moral_posture_failure")) score += 5;
  if (tags.includes("grounding_failure")) score += 4;
  if (tags.includes("cadence_failure")) score += 2;
  return score;
}

function shouldDraftEvalCase(item: MaatDogfoodReviewedOutput) {
  return item.disposition === "eval_case" ||
    item.failureTags.includes("should_become_eval_case");
}

function inferDominantFailure(
  tags: MaatDogfoodFailureTag[],
): MaatDogfoodDominantFailure | null {
  if (tags.includes("grounding_failure")) return "grounding";
  if (tags.includes("moral_posture_failure")) return "moral_posture";
  if (tags.includes("repair_degraded_cadence")) return "repair_regression";
  if (tags.includes("not_worth_interrupting")) return "worthiness";
  if (tags.includes("wrong_delivery_channel")) return "delivery_mismatch";
  if (tags.includes("action_clarity_failure")) return "action_clarity";
  if (tags.includes("cadence_failure")) return "cadence";
  if (tags.includes("high_worthiness_fast_dismiss")) return "worthiness";
  return null;
}

function formatReviewedLine(item: MaatDogfoodReviewedOutput) {
  const text = trimReportText(item.row.body_text ?? "");
  const tags = item.failureTags.length ? item.failureTags.join(", ") : "none";
  return [
    `- ${item.row.surface}/${item.row.speech_act ?? "unknown"} ` +
    `id=${item.row.output_id} status=${item.row.status} ` +
    `channel=${item.row.delivery_channel ?? "unknown"} ` +
    `worthiness=${item.worthiness} disposition=${item.disposition}`,
    `  tags: ${tags}`,
    `  review_source: ${item.reviewSource ?? "unreviewed"}`,
    item.dominantFailure ? `  dominant_failure: ${item.dominantFailure}` : null,
    item.convertedEvalCaseId
      ? `  converted_eval_case: ${item.convertedEvalCaseId}`
      : null,
    text ? `  text: ${text}` : null,
  ].filter(Boolean).join("\n");
}

function failureReasons(grade: Record<string, unknown> | null) {
  const value = grade?.failureReasons;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function gradeNumber(
  grade: Record<string, unknown> | null,
  key: string,
  fallback: number,
) {
  const value = grade?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function gradeDeltaNumber(
  delta: Record<string, unknown> | null,
  key: string,
) {
  const value = delta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function uniqueTags(tags: MaatDogfoodFailureTag[]) {
  return [...new Set(tags)];
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_+|_+$/g,
    "",
  );
}

function trimReportText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`;
}

function normalizeAnnotation(value: unknown): MaatDogfoodAnnotation | null {
  if (!isRecord(value) || typeof value.outputId !== "string") return null;
  if (!isDisposition(value.disposition)) return null;
  const failureTags = Array.isArray(value.failureTags)
    ? value.failureTags.filter(isFailureTag)
    : undefined;
  return {
    outputId: value.outputId,
    disposition: value.disposition,
    failureTags,
    reviewSource: isReviewSource(value.reviewSource)
      ? value.reviewSource
      : undefined,
    dominantFailure: isDominantFailure(value.dominantFailure)
      ? value.dominantFailure
      : undefined,
    convertedEvalCaseId: typeof value.convertedEvalCaseId === "string"
      ? value.convertedEvalCaseId
      : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDisposition(value: unknown): value is MaatDogfoodDisposition {
  return value === "keep" ||
    value === "repair" ||
    value === "archive_only" ||
    value === "never_show" ||
    value === "eval_case";
}

function isFailureTag(value: unknown): value is MaatDogfoodFailureTag {
  return value === "grounding_failure" ||
    value === "cadence_failure" ||
    value === "moral_posture_failure" ||
    value === "action_clarity_failure" ||
    value === "wrong_delivery_channel" ||
    value === "not_worth_interrupting" ||
    value === "high_worthiness_fast_dismiss" ||
    value === "repair_degraded_cadence" ||
    value === "should_become_eval_case";
}

function isReviewSource(value: unknown): value is MaatDogfoodReviewSource {
  return value === "real_usage" ||
    value === "synthetic" ||
    value === "smoke";
}

function isDominantFailure(
  value: unknown,
): value is MaatDogfoodDominantFailure {
  return value === "grounding" ||
    value === "cadence" ||
    value === "moral_posture" ||
    value === "action_clarity" ||
    value === "worthiness" ||
    value === "delivery_mismatch" ||
    value === "repair_regression";
}

async function main() {
  const projectUrl = requireEnv("SUPABASE_URL", "PROJECT_URL");
  const serviceKey = requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
  );
  const days = Number(env("MAAT_OUTPUT_DOGFOOD_DAYS") ?? "7");
  const limit = Number(env("MAAT_OUTPUT_DOGFOOD_LIMIT") ?? "200");
  const annotationPath = env("MAAT_OUTPUT_DOGFOOD_ANNOTATIONS");
  const outputDir = env("MAAT_OUTPUT_DOGFOOD_OUTPUT_DIR");
  const annotations = annotationPath
    ? parseMaatDogfoodAnnotations(await Deno.readTextFile(annotationPath))
    : [];
  const rows = await fetchMaatDogfoodRows({
    projectUrl,
    serviceKey,
    days: Number.isFinite(days) ? days : 7,
    limit: Number.isFinite(limit) ? limit : 200,
  });
  const report = reviewMaatDogfoodOutputs(
    rows,
    annotations,
    new Date(),
    Number.isFinite(days) ? days : 7,
  );
  const markdown = formatMaatDogfoodReport(report);
  if (outputDir) {
    await Deno.mkdir(outputDir, { recursive: true });
    const stamp = report.generatedAt.slice(0, 10);
    await Deno.writeTextFile(
      `${outputDir}/maat-output-dogfood-${stamp}.md`,
      markdown,
    );
    await Deno.writeTextFile(
      `${outputDir}/maat-output-eval-drafts-${stamp}.json`,
      `${JSON.stringify(report.evalDrafts, null, 2)}\n`,
    );
  }
  console.log(markdown);
}

if (import.meta.main) {
  await main();
}
