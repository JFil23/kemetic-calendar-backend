import type {
  MaatAxisCode,
  MaatDimensionSnapshot,
} from "../ai_generate_reflection/maat_decision.ts";

export const MAAT_FLOW_BRIEF_POLICY_VERSION = "maat_flow_brief_v1";

export type MaatFlowBriefIntent = "restore" | "strengthen" | "protect";
export type MaatFlowBriefDurationDays = 7 | 10 | 14 | 30;
export type MaatFlowBriefMode = "drift" | "strength";

export type MaatFlowBriefMaturity = {
  level: "L1" | "L2" | "L3" | "L4" | "L5";
  label?: string;
};

export type MaatFlowBriefGoalProfile = {
  key?: string;
  active?: boolean;
  axes?: MaatAxisCode[];
  nutritionGoal?: boolean;
  careObligations?: boolean;
  measureWeek?: boolean;
};

export type MaatFlowBriefBaseline = {
  snapshotCount?: number;
  medianScore?: number | null;
  nutritionDoneRate?: number | null;
};

export type MaatFlowBriefWindow = {
  start: string;
  end: string;
  decanName?: string | null;
  decanTheme?: string | null;
  decanContextKey?: string | null;
};

export type MaatFlowBrief = {
  briefId: string;
  policyVersion: typeof MAAT_FLOW_BRIEF_POLICY_VERSION;
  intent: MaatFlowBriefIntent;
  durationDays: MaatFlowBriefDurationDays;
  domain: string;
  flowName: string;
  description: string;
  sourceText: string;
  plannerHints: {
    maxActionsPerDay: number;
    minimumDurationMin: number;
    downshiftRequired: boolean;
    cueType: "measure" | "provision" | "rest" | "rhythm" | "care";
  };
  preview: {
    overviewSummary: string;
    sampleDays?: string[];
  };
  fingerprint: Record<string, unknown>;
  fallbackTemplateKey?: string;
};

export type ComposeMaatFlowBriefInput = {
  snapshot: MaatDimensionSnapshot;
  mode: MaatFlowBriefMode;
  window: MaatFlowBriefWindow;
  maturity?: MaatFlowBriefMaturity | null;
  goalProfile?: MaatFlowBriefGoalProfile | null;
  baseline?: MaatFlowBriefBaseline | null;
  triggerReason?: string | null;
  fallbackTemplateKey?: string | null;
};

type MaatFlowBriefRecipe = {
  key: string;
  mode: MaatFlowBriefMode | "any";
  intent: MaatFlowBriefIntent;
  durationDays: MaatFlowBriefDurationDays;
  domain: string;
  fallbackTemplateKey: string;
  cueType: MaatFlowBrief["plannerHints"]["cueType"];
  minimumDurationMin: number;
  downshiftRequired: boolean;
  titleNoun: string;
  sampleDays: string[];
  matches: (input: ComposeMaatFlowBriefInput) => boolean;
};

const REVIEW_ONLY_GATES = new Set([
  "corrupt_judgment",
  "malicious_social_disruption",
]);

const RECIPES: MaatFlowBriefRecipe[] = [
  {
    key: "restore-provision-g6",
    mode: "drift",
    intent: "restore",
    durationDays: 10,
    domain: "health / provision",
    fallbackTemplateKey: "dawn-house-rite",
    cueType: "provision",
    minimumDurationMin: 8,
    downshiftRequired: true,
    titleNoun: "provision",
    sampleDays: [
      "Mark one plain provision act before adding effort.",
      "Record food, water, or rest honestly and keep it small.",
      "End with a visible reset for tomorrow's first support.",
    ],
    matches: (input) =>
      input.mode === "drift" &&
      input.snapshot.hardGates.includes("life_supporting_flow_disrupted"),
  },
  {
    key: "restore-measure-axis",
    mode: "drift",
    intent: "restore",
    durationDays: 7,
    domain: "measure",
    fallbackTemplateKey: "dawn-house-rite",
    cueType: "measure",
    minimumDurationMin: 6,
    downshiftRequired: false,
    titleNoun: "measure",
    sampleDays: [
      "Choose one number, limit, or finish condition.",
      "Keep the record short enough to repeat.",
      "Review what changed before choosing the next mark.",
    ],
    matches: (input) =>
      input.mode === "drift" && leadCorrectionAxis(input) === "M",
  },
  {
    key: "restore-provision-axis",
    mode: "drift",
    intent: "restore",
    durationDays: 10,
    domain: "provision",
    fallbackTemplateKey: "dawn-house-rite",
    cueType: "provision",
    minimumDurationMin: 8,
    downshiftRequired: true,
    titleNoun: "provision",
    sampleDays: [
      "Protect one supply line before expanding the day.",
      "Make the smallest repeatable preparation visible.",
      "Close by noting what was sustained.",
    ],
    matches: (input) =>
      input.mode === "drift" && leadCorrectionAxis(input) === "S",
  },
  {
    key: "restore-care-axis",
    mode: "drift",
    intent: "protect",
    durationDays: 7,
    domain: "care",
    fallbackTemplateKey: "dawn-house-rite",
    cueType: "care",
    minimumDurationMin: 8,
    downshiftRequired: true,
    titleNoun: "care",
    sampleDays: [
      "Name one person, dependency, or promise that needs steadiness.",
      "Choose a care action small enough to complete without strain.",
      "Close by making tomorrow's support visible.",
    ],
    matches: (input) =>
      input.mode === "drift" && leadCorrectionAxis(input) === "V",
  },
  {
    key: "restore-restraint-axis",
    mode: "drift",
    intent: "restore",
    durationDays: 7,
    domain: "rest",
    fallbackTemplateKey: "evening-threshold-rite",
    cueType: "rest",
    minimumDurationMin: 10,
    downshiftRequired: true,
    titleNoun: "restraint",
    sampleDays: [
      "Name what can stop before it becomes excess.",
      "Set one boundary around effort, speech, or strain.",
      "Close with a repair cue rather than another demand.",
    ],
    matches: (input) => {
      const axis = leadCorrectionAxis(input);
      return input.mode === "drift" && (axis === "R" || axis === "H");
    },
  },
  {
    key: "restore-rhythm-axis",
    mode: "drift",
    intent: "restore",
    durationDays: 10,
    domain: "rhythm",
    fallbackTemplateKey: "track-the-sky",
    cueType: "rhythm",
    minimumDurationMin: 6,
    downshiftRequired: false,
    titleNoun: "rhythm",
    sampleDays: [
      "Observe one timing cue before changing the plan.",
      "Let the day keep one repeated point of return.",
      "Record what arrived on time and what needs space.",
    ],
    matches: (input) =>
      input.mode === "drift" && leadCorrectionAxis(input) === "E",
  },
  {
    key: "strengthen-rhythm-axis",
    mode: "strength",
    intent: "strengthen",
    durationDays: 14,
    domain: "rhythm",
    fallbackTemplateKey: "track-the-sky",
    cueType: "rhythm",
    minimumDurationMin: 6,
    downshiftRequired: false,
    titleNoun: "rhythm",
    sampleDays: [
      "Keep the observation simple enough to survive busy days.",
      "Notice one pattern without trying to force it.",
      "Let repetition make the timing dependable.",
    ],
    matches: (input) =>
      input.mode === "strength" && input.snapshot.leadAxis === "E",
  },
  {
    key: "strengthen-measure-axis",
    mode: "strength",
    intent: "strengthen",
    durationDays: 7,
    domain: "measure",
    fallbackTemplateKey: "dawn-house-rite",
    cueType: "measure",
    minimumDurationMin: 6,
    downshiftRequired: false,
    titleNoun: "measure",
    sampleDays: [
      "Keep one record clean and repeatable.",
      "Use the same measure before adding another.",
      "Review the pattern without turning it into pressure.",
    ],
    matches: (input) => {
      const axis = input.snapshot.leadAxis;
      return input.mode === "strength" && (axis === "M" || axis === "T");
    },
  },
  {
    key: "strengthen-restraint-axis",
    mode: "strength",
    intent: "strengthen",
    durationDays: 7,
    domain: "rest",
    fallbackTemplateKey: "evening-threshold-rite",
    cueType: "rest",
    minimumDurationMin: 10,
    downshiftRequired: true,
    titleNoun: "restraint",
    sampleDays: [
      "Repeat the boundary that has already started working.",
      "Keep the day from growing past its useful shape.",
      "End with one clear close rather than a new demand.",
    ],
    matches: (input) => {
      const axis = input.snapshot.leadAxis;
      return input.mode === "strength" && (axis === "R" || axis === "H");
    },
  },
];

export function composeMaatFlowBrief(
  input: ComposeMaatFlowBriefInput,
): MaatFlowBrief | null {
  if (input.maturity?.level === "L1") return null;
  if (
    input.mode === "drift" &&
    input.snapshot.hardGates.some((gate) => REVIEW_ONLY_GATES.has(gate))
  ) {
    return null;
  }

  const requestedFallback = input.fallbackTemplateKey?.trim() || null;
  const recipe = RECIPES.find((candidate) =>
    candidate.matches(input) &&
    (!requestedFallback || candidate.fallbackTemplateKey === requestedFallback)
  );
  if (!recipe) return null;

  const axis = input.mode === "drift"
    ? leadCorrectionAxis(input)
    : input.snapshot.leadAxis;
  const briefId = [
    "mfb_v1",
    input.mode,
    recipe.intent,
    recipe.domain.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
      .toLowerCase(),
    axis,
  ].join("_");
  const decanPhrase = input.window.decanTheme?.trim() ||
    input.window.decanName?.trim() ||
    "this cycle";
  const goalKey = input.goalProfile?.active ? input.goalProfile.key : null;
  const flowName = flowNameFor(recipe, input);
  const overviewSummary =
    `${recipe.durationDays} days to ${recipe.intent} ${recipe.titleNoun} through small, visible actions. The flow keeps the next step concrete and avoids turning guidance into pressure.`;
  const fingerprint = {
    policy_version: MAAT_FLOW_BRIEF_POLICY_VERSION,
    recipe_key: recipe.key,
    mode: input.mode,
    intent: recipe.intent,
    domain: recipe.domain,
    lead_axis: input.snapshot.leadAxis,
    correction_axes: input.snapshot.correctionAxes,
    hard_gates: input.snapshot.hardGates,
    maturity_level: input.maturity?.level ?? null,
    goal_profile_key: goalKey,
    fallback_template_key: recipe.fallbackTemplateKey,
    trigger_reason: input.triggerReason ?? null,
  };
  const briefJson = {
    brief_id: briefId,
    policy_version: MAAT_FLOW_BRIEF_POLICY_VERSION,
    intent: recipe.intent,
    duration_days: recipe.durationDays,
    domain: recipe.domain,
    decan: decanPhrase,
    lead_axis: input.snapshot.leadAxis,
    correction_axes: input.snapshot.correctionAxes,
    planner_hints: {
      max_actions_per_day: 2,
      minimum_duration_min: recipe.minimumDurationMin,
      downshift_required: recipe.downshiftRequired,
      cue_type: recipe.cueType,
    },
    forbidden_terms: [
      "isfet",
      "hard gate",
      "score",
      "band",
      "corrupt_judgment",
      "malicious_social_disruption",
      "vulnerable_deprivation",
      "life_supporting_flow_disrupted",
    ],
  };

  return {
    briefId,
    policyVersion: MAAT_FLOW_BRIEF_POLICY_VERSION,
    intent: recipe.intent,
    durationDays: recipe.durationDays,
    domain: recipe.domain,
    flowName,
    description:
      `Create a ${recipe.durationDays}-day ${recipe.intent} flow for ${recipe.titleNoun}. Keep it practical, calm, and non-judgmental. Use no more than two actions per day, and make each action observable without naming internal scores, bands, gates, or isfet.`,
    sourceText: [
      "MAAT_FLOW_BRIEF v1",
      "```json",
      JSON.stringify(briefJson, null, 2),
      "```",
    ].join("\n"),
    plannerHints: {
      maxActionsPerDay: 2,
      minimumDurationMin: recipe.minimumDurationMin,
      downshiftRequired: recipe.downshiftRequired,
      cueType: recipe.cueType,
    },
    preview: {
      overviewSummary,
      sampleDays: recipe.sampleDays,
    },
    fingerprint,
    fallbackTemplateKey: recipe.fallbackTemplateKey,
  };
}

function leadCorrectionAxis(input: ComposeMaatFlowBriefInput): MaatAxisCode {
  return input.snapshot.correctionAxes[0] ?? input.snapshot.leadAxis;
}

function flowNameFor(
  recipe: MaatFlowBriefRecipe,
  input: ComposeMaatFlowBriefInput,
) {
  const noun = recipe.titleNoun[0].toUpperCase() + recipe.titleNoun.slice(1);
  const mode = recipe.intent === "strengthen" ? "Deepening" : "Restoration";
  const windowName = input.window.decanName?.split("-")[0]?.trim();
  return windowName ? `${noun} ${mode}: ${windowName}` : `${noun} ${mode}`;
}
