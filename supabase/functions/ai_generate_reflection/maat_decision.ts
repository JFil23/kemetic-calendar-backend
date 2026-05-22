export type MaatAxisCode = "T" | "M" | "H" | "V" | "J" | "S" | "E" | "R" | "C";

export type MaatPlannerSummaryInput = {
  total: number;
  todoDone: number;
  todoPartial: number;
  todoSkipped: number;
  nutritionDone: number;
  nutritionPartial: number;
  nutritionSkipped: number;
};

export type MaatDimensionSnapshotInput = {
  decanName?: string | null;
  decanTheme?: string | null;
  decanContext?: {
    shortName?: string | null;
    displayName?: string | null;
    defaultLabel?: string | null;
    detailDescription?: string | null;
  } | null;
  evidenceTexts: string[];
  badgeCount: number;
  badgesWithDetails: number;
  activeDays: number;
  windowStart: string;
  windowEnd: string;
  plannerSummary: MaatPlannerSummaryInput;
  gatePolicy?: Partial<MaatGatePolicy>;
  axisPriors?: Partial<Record<MaatAxisCode, number>>;
};

export type MaatGatePolicy = {
  g1RegexEnabled: boolean;
  g4StructuralEnabled: boolean;
  g5RegexEnabled: boolean;
  g6MinSkips: number;
  g6RequiresText: boolean;
  g7RegexEnabled: boolean;
  g8RegexEnabled: boolean;
};

export type MaatDimensionSnapshot = {
  version: "maat_dims_v1";
  dimensions: Record<MaatAxisCode, number>;
  score: number;
  band:
    | "maat"
    | "leaning_maat"
    | "mixed"
    | "leaning_isfet"
    | "isfet_patterned";
  reflectionMove: "affirm" | "inquire" | "correct";
  leadAxis: MaatAxisCode;
  correctionAxes: MaatAxisCode[];
  hardGates: string[];
  decanPrimaryAxes: MaatAxisCode[];
  source: {
    planner_total: number;
    completed_planner: number;
    partial_planner: number;
    skipped_planner: number;
    details_coverage: number;
    days_active: number;
    axis_priors?: Partial<Record<MaatAxisCode, number>>;
  };
};

export type ReflectionProfileRow = {
  top_nodes?: Array<{ slug?: string; score?: number | null }> | null;
  top_edges?:
    | Array<{
      source?: string;
      target?: string;
      score?: number | null;
    }>
    | null;
  dominant_patterns?: string[] | null;
  tension_pairs?: string[][] | null;
  maat_score?: number | null;
  isfet_risk_score?: number | null;
  last_computed_at?: string | null;
};

export type ReflectionDecisionMatrixV1 = {
  version: "decan_maat_dm_v1";
  anchorNodes: string[];
  dominantPatterns: string[];
  tensionPairs: string[];
  balanceMode: "reduce_scatter" | "reinforce_structure" | "neutral";
  reflectionMove: MaatDimensionSnapshot["reflectionMove"];
  leadAxis: MaatAxisCode;
  promptBlock: string;
  fingerprint: Record<string, unknown>;
};

const PROGRESS_MARKERS = [
  "reps",
  "drill",
  "measure",
  "again",
  "adjust",
  "review",
  "fix",
  "improve",
  "focus",
  "form",
  "timing",
  "consistency",
  "plan",
  "schedule",
  "repeat",
  "refine",
];

const REFINEMENT_TERMS = [
  "adjust",
  "repeat",
  "fix",
  "measure",
  "aim",
  "track",
  "form",
  "balance",
  "control",
  "timer",
  "rounds",
  "makes",
];

const MAAT_WEIGHTS: Record<MaatAxisCode, number> = {
  T: 15,
  M: 15,
  H: 15,
  V: 12,
  J: 12,
  S: 10,
  E: 8,
  R: 8,
  C: 5,
};

const MAAT_AXIS_LABELS: Record<MaatAxisCode, string> = {
  T: "truth / speech integrity",
  M: "measure / accounting integrity",
  H: "harm reduction / life preservation",
  V: "vulnerable protection",
  J: "justice / due measure",
  S: "stewardship / provision",
  E: "ecological and seasonal flow",
  R: "restraint / self-command",
  C: "cohesion / role fidelity",
};

const MAAT_AXIS_COPY: Record<MaatAxisCode, string> = {
  T: "make one mark truthful and specific",
  M: "add one number or finish condition",
  H: "protect the rhythm that keeps effort livable",
  V: "reduce one burden before adding another",
  J: "choose the proportionate next step",
  S: "protect one provision thread",
  E: "restore one life-supporting rhythm",
  R: "downshift force before adding more",
  C: "keep one role or promise coherent",
};

const ALL_MAAT_AXES: MaatAxisCode[] = [
  "T",
  "M",
  "H",
  "V",
  "J",
  "S",
  "E",
  "R",
  "C",
];

export const DEFAULT_MAAT_GATE_POLICY: MaatGatePolicy = {
  g1RegexEnabled: true,
  g4StructuralEnabled: true,
  g5RegexEnabled: true,
  g6MinSkips: 2,
  g6RequiresText: true,
  g7RegexEnabled: true,
  g8RegexEnabled: true,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function toNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDateOnly(value: string) {
  const parts = value.split("-");
  const year = Number(parts[0] ?? "0");
  const month = Number(parts[1] ?? "1");
  const day = Number(parts[2] ?? "1");
  return new Date(Date.UTC(year, month, day));
}

function daysBetween(start: Date, end: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / msPerDay));
}

function countTermsByWord(text: string, terms: string[]) {
  let total = 0;
  for (const term of terms) {
    const regex = new RegExp(`\\b${term}\\b`, "g");
    total += (text.match(regex) ?? []).length;
  }
  return total;
}

function uniqueAxes(axes: MaatAxisCode[]) {
  const seen = new Set<MaatAxisCode>();
  const result: MaatAxisCode[] = [];
  for (const axis of axes) {
    if (seen.has(axis)) continue;
    seen.add(axis);
    result.push(axis);
  }
  return result;
}

function addAxesForTerms(
  text: string,
  terms: string[],
  axes: MaatAxisCode[],
  out: MaatAxisCode[],
) {
  if (terms.some((term) => text.includes(term))) {
    out.push(...axes);
  }
}

export function resolveDecanPrimaryAxes(
  input: Pick<
    MaatDimensionSnapshotInput,
    "decanName" | "decanTheme" | "decanContext"
  >,
): MaatAxisCode[] {
  const text = [
    input.decanName,
    input.decanTheme,
    input.decanContext?.shortName,
    input.decanContext?.displayName,
    input.decanContext?.defaultLabel,
    input.decanContext?.detailDescription,
  ]
    .filter((part): part is string => !!part)
    .join(" ")
    .toLowerCase();
  const axes: MaatAxisCode[] = [];

  addAxesForTerms(
    text,
    [
      "truth",
      "measure",
      "measured",
      "measurement",
      "record",
      "records",
      "accounts",
      "checking",
      "scribe",
      "thoth",
      "djehuty",
      "calibration",
      "observation",
    ],
    ["T", "M"],
    axes,
  );
  addAxesForTerms(
    text,
    [
      "care",
      "nourish",
      "nourishment",
      "offering",
      "exchange",
      "distribution",
      "service",
      "household",
      "community",
      "burden",
      "supporting life",
    ],
    ["V", "J", "S"],
    axes,
  );
  addAxesForTerms(
    text,
    [
      "strength",
      "power",
      "force",
      "restraint",
      "excess",
      "overdrive",
      "pacing",
      "pace",
      "rest",
      "exhaust",
      "control",
    ],
    ["R", "H"],
    axes,
  );
  addAxesForTerms(
    text,
    [
      "nile",
      "water",
      "inundation",
      "growth",
      "harvest",
      "supply",
      "food",
      "nutrition",
      "pasture",
      "agricultural",
    ],
    ["S", "E"],
    axes,
  );
  addAxesForTerms(
    text,
    [
      "consolidation",
      "stability",
      "stable",
      "continuity",
      "alignment",
      "coherence",
      "integration",
      "repair",
      "remembrance",
      "rhythm",
    ],
    ["C", "M"],
    axes,
  );

  return uniqueAxes(axes).slice(0, 3);
}

function weightedPlannerRatio(done: number, partial: number, skipped: number) {
  const total = done + partial + skipped;
  if (!total) return 0;
  return clamp((done + 0.35 * partial - skipped) / total, -1, 1);
}

function countTermHits(text: string, terms: string[]) {
  let total = 0;
  for (const term of terms) {
    if (text.includes(term)) total++;
  }
  return total;
}

function hasStudyOrQuoteContext(text: string, keywordPattern: string) {
  const regex = new RegExp(
    `\\b(?:text|source|book|article|quote|quoted|study|studying|character|story|scene|novel|fiction|fictional|script|draft|writing|roleplay|role-playing|d&d|amenemope|ptahhotep)\\b.{0,80}\\b(?:${keywordPattern})\\b`,
  );
  return regex.test(text);
}

function containsFalseRecordAdmission(text: string) {
  const keywordPattern =
    "lied about|false record|false report|falsified|cheated";
  if (hasStudyOrQuoteContext(text, keywordPattern)) return false;
  return new RegExp(
    "\\b(?:i|we)\\s+(?:lied about|made a false record|made a false report|falsified|cheated)\\b|\\b(?:false record|false report)\\b",
  ).test(text);
}

function containsCorruptJudgmentAdmission(text: string) {
  const keywordPattern =
    "bribe|bribed|false witness|rigged|protected theft|twisted judgment|unjust punishment|punished unjustly";
  if (hasStudyOrQuoteContext(text, keywordPattern)) return false;
  return new RegExp(
    "\\b(?:i|we)\\s+(?:took|accepted|gave|paid)\\s+(?:a\\s+)?bribe\\b|" +
      "\\b(?:i|we)\\s+(?:bore|gave|made)\\s+false witness\\b|" +
      "\\b(?:i|we)\\s+(?:rigged|twisted)\\s+(?:the\\s+)?(?:case|judgment|judgement|verdict|court)\\b|" +
      "\\b(?:i|we)\\s+protected\\s+(?:the\\s+)?theft\\b|" +
      "\\b(?:i|we)\\s+punished\\s+(?:him|her|them|someone|a person)\\s+unjustly\\b",
  ).test(text);
}

function containsMaliciousSocialAdmission(text: string) {
  const keywordPattern =
    "incited|sabotaged|betrayed trust|spread a rumor|spread a rumour|turned people against|organized harassment|stirred up conflict";
  if (hasStudyOrQuoteContext(text, keywordPattern)) return false;
  return new RegExp(
    "\\b(?:i|we)\\s+(?:incited|stirred up)\\s+(?:a\\s+)?(?:conflict|fight|division|harassment)\\b|" +
      "\\b(?:i|we)\\s+(?:spread|started)\\s+(?:a\\s+)?(?:rumor|rumour)\\s+(?:to\\s+)?(?:harm|hurt|divide|damage)\\b|" +
      "\\b(?:i|we)\\s+(?:sabotaged|undermined)\\s+(?:the\\s+)?(?:group|team|community|household|family|circle)\\b|" +
      "\\b(?:i|we)\\s+betrayed\\s+(?:their\\s+|the\\s+)?trust\\b|" +
      "\\b(?:i|we)\\s+turned\\s+(?:people|them|the\\s+group|the\\s+team|the\\s+community)\\s+against\\s+(?:each\\s+other|one\\s+another|them|him|her|the\\s+group|the\\s+team|the\\s+community|the\\s+family)\\b|" +
      "\\b(?:i|we)\\s+organized\\s+harassment\\b",
  ).test(text);
}

function containsVulnerableDeprivationContext(text: string) {
  return /\b(child|children|dependent|elder|widow|orphan|family|care|caregiving|medicine|medication|debt|poor debtor|hungry|thirsty)\b/
    .test(text) &&
    /\b(neglect(?:ed)?|ignored|skipped|missed|withheld|left without|no food|no water|hungry|thirsty|medicine|medication)\b/
      .test(text);
}

function isCareTaskText(text: string) {
  return /\b(child|children|dependent|elder|widow|orphan|family|care|caregiving|medicine|medication|debt|meal|food|water|support|burden)\b/
    .test(text);
}

function dimensionsFallback(a: number, b: number) {
  if (a === 0) return b;
  if (b === 0) return a;
  return (a + b) / 2;
}

function normalizedAxisPriors(
  axisPriors: Partial<Record<MaatAxisCode, number>> | undefined,
) {
  const entries = ALL_MAAT_AXES
    .map((axis) => {
      const value = toNumber(axisPriors?.[axis]) ?? 0;
      return [axis, roundTo(clamp(value, -0.25, 0.25), 3)] as const;
    })
    .filter(([, value]) => value !== 0);
  return Object.fromEntries(entries) as Partial<Record<MaatAxisCode, number>>;
}

export function buildMaatDimensionSnapshot(
  input: MaatDimensionSnapshotInput,
): MaatDimensionSnapshot {
  const gatePolicy: MaatGatePolicy = {
    ...DEFAULT_MAAT_GATE_POLICY,
    ...(input.gatePolicy ?? {}),
  };
  const plannerSummary = input.plannerSummary;
  const completedPlanner = plannerSummary.todoDone +
    plannerSummary.nutritionDone;
  const partialPlanner = plannerSummary.todoPartial +
    plannerSummary.nutritionPartial;
  const skippedPlanner = plannerSummary.todoSkipped +
    plannerSummary.nutritionSkipped;
  const plannerRatio = weightedPlannerRatio(
    completedPlanner,
    partialPlanner,
    skippedPlanner,
  );
  const todoRatio = weightedPlannerRatio(
    plannerSummary.todoDone,
    plannerSummary.todoPartial,
    plannerSummary.todoSkipped,
  );
  const nutritionRatio = weightedPlannerRatio(
    plannerSummary.nutritionDone,
    plannerSummary.nutritionPartial,
    plannerSummary.nutritionSkipped,
  );
  const detailsCoverage = input.badgeCount
    ? input.badgesWithDetails / input.badgeCount
    : 0;
  const evidenceText = input.evidenceTexts.join(" ").toLowerCase();
  const careTaskTexts = input.evidenceTexts
    .map((text) => text.toLowerCase())
    .filter(isCareTaskText);
  const skippedCareTasks =
    careTaskTexts.filter((text) =>
      /\b(skipped|missed|ignored|neglect(?:ed)?|left without|withheld)\b/.test(
        text,
      )
    ).length;
  const completedCareTasks =
    careTaskTexts.filter((text) =>
      /\b(completed|done|helped|supported|fed|gave|protected|reduced|paid|prepared)\b/
        .test(text) &&
      !/\b(no food|no water|left without|withheld|neglect(?:ed)?|ignored|missed|skipped)\b/
        .test(text)
    ).length;
  const progressHits = countTermsByWord(evidenceText, PROGRESS_MARKERS);
  const refinementHits = countTermsByWord(evidenceText, REFINEMENT_TERMS);
  const measureHits = countTermHits(evidenceText, [
    "measure",
    "measured",
    "track",
    "tracked",
    "number",
    "count",
    "record",
    "review",
    "timer",
    "reps",
    "minutes",
    "rounds",
    "sets",
  ]);
  const provisionHits = countTermHits(evidenceText, [
    "food",
    "meal",
    "nutrition",
    "water",
    "hydrate",
    "sleep",
    "rest",
    "household",
    "care",
    "support",
  ]);
  const restraintHits = countTermHits(evidenceText, [
    "reduce",
    "reduced",
    "pause",
    "paused",
    "rest",
    "rested",
    "adjust",
    "adjusted",
    "less",
    "simplify",
    "limit",
  ]);
  const overreachHits = countTermHits(evidenceText, [
    "overwork",
    "burnout",
    "burned out",
    "exhausted",
    "punish myself",
    "punished myself",
    "no sleep",
    "crash",
  ]);
  const careHits = countTermHits(evidenceText, [
    "child",
    "children",
    "family",
    "dependent",
    "care",
    "helped",
    "support",
    "debt",
    "burden",
  ]);

  const hardGates: string[] = [];
  if (
    gatePolicy.g7RegexEnabled &&
    /\b(punish(?:ed)? myself|self[- ]punish|cruel|hurt myself|harm(?:ed)? myself)\b/
      .test(evidenceText)
  ) {
    hardGates.push("excessive_force_or_harm");
  }
  const g6TextMatched =
    /\b(no food|skip(?:ped)? meals?|dehydrat(?:ed|ion)|not eating|no water)\b/
      .test(evidenceText);
  if (
    plannerSummary.nutritionSkipped >= gatePolicy.g6MinSkips &&
    plannerSummary.nutritionDone === 0 &&
    (!gatePolicy.g6RequiresText || g6TextMatched)
  ) {
    hardGates.push("life_supporting_flow_disrupted");
  }
  if (gatePolicy.g1RegexEnabled && containsFalseRecordAdmission(evidenceText)) {
    hardGates.push("knowingly_false_record");
  }
  if (
    gatePolicy.g5RegexEnabled &&
    containsCorruptJudgmentAdmission(evidenceText)
  ) {
    hardGates.push("corrupt_judgment");
  }
  if (
    gatePolicy.g8RegexEnabled &&
    containsMaliciousSocialAdmission(evidenceText)
  ) {
    hardGates.push("malicious_social_disruption");
  }
  if (
    gatePolicy.g4StructuralEnabled &&
    skippedCareTasks >= 2 &&
    completedCareTasks === 0 &&
    containsVulnerableDeprivationContext(evidenceText)
  ) {
    hardGates.push("vulnerable_deprivation");
  }

  const daysActiveRatio = input.activeDays
    ? clamp(
      input.activeDays / Math.max(
        1,
        daysBetween(
          parseDateOnly(input.windowStart),
          parseDateOnly(input.windowEnd),
        ) + 1,
      ),
      0,
      1,
    )
    : 0;
  const skippedRatio = plannerSummary.total
    ? skippedPlanner / plannerSummary.total
    : 0;

  const dimensions: Record<MaatAxisCode, number> = {
    T: clamp(
      (input.badgeCount ? 0.1 : 0) + (detailsCoverage - 0.45) * 0.9 +
        Math.min(0.25, measureHits * 0.05),
      -1,
      1,
    ),
    M: clamp(
      plannerRatio * 0.65 + Math.min(0.25, measureHits * 0.05) +
        Math.min(0.15, refinementHits * 0.04) +
        Math.min(0.1, progressHits * 0.02),
      -1,
      1,
    ),
    H: clamp(
      nutritionRatio * 0.45 + Math.min(0.25, provisionHits * 0.04) -
        Math.min(0.8, overreachHits * 0.35) - skippedRatio * 0.15,
      -1,
      1,
    ),
    V: clamp(
      Math.min(0.35, careHits * 0.08) - Math.min(0.35, skippedRatio * 0.2),
      -1,
      1,
    ),
    J: clamp(
      (plannerRatio + dimensionsFallback(todoRatio, nutritionRatio)) * 0.25 +
        Math.min(0.2, refinementHits * 0.04),
      -1,
      1,
    ),
    S: clamp(
      todoRatio * 0.25 + nutritionRatio * 0.45 +
        Math.min(0.3, provisionHits * 0.05),
      -1,
      1,
    ),
    E: clamp(
      nutritionRatio * 0.25 + Math.min(0.35, provisionHits * 0.04),
      -1,
      1,
    ),
    R: clamp(
      Math.min(0.35, restraintHits * 0.08) +
        Math.min(0.2, refinementHits * 0.04) -
        Math.min(0.85, overreachHits * 0.4) - skippedRatio * 0.1,
      -1,
      1,
    ),
    C: clamp(
      daysActiveRatio * 0.55 + plannerRatio * 0.25 - skippedRatio * 0.15,
      -1,
      1,
    ),
  };
  const axisPriors = normalizedAxisPriors(input.axisPriors);
  for (const axis of ALL_MAAT_AXES) {
    const prior = axisPriors[axis] ?? 0;
    if (prior !== 0) {
      dimensions[axis] = clamp(dimensions[axis] + prior, -1, 1);
    }
  }

  const score = Math.round(
    ALL_MAAT_AXES.reduce(
      (sum, axis) => sum + dimensions[axis] * MAAT_WEIGHTS[axis],
      0,
    ),
  );
  const band: MaatDimensionSnapshot["band"] = hardGates.length
    ? "isfet_patterned"
    : score >= 60
    ? "maat"
    : score >= 25
    ? "leaning_maat"
    : score > -25
    ? "mixed"
    : score > -60
    ? "leaning_isfet"
    : "isfet_patterned";
  const reflectionMove: MaatDimensionSnapshot["reflectionMove"] =
    hardGates.length || score <= -25
      ? "correct"
      : score < 25
      ? "inquire"
      : "affirm";
  const decanPrimaryAxes = resolveDecanPrimaryAxes(input);
  const candidateAxes = decanPrimaryAxes.length
    ? decanPrimaryAxes
    : ALL_MAAT_AXES;
  const sortedForMove = candidateAxes.slice().sort((a, b) => {
    return reflectionMove === "affirm"
      ? dimensions[b] - dimensions[a]
      : dimensions[a] - dimensions[b];
  });
  let leadAxis = sortedForMove[0] ?? "M";
  if (reflectionMove !== "affirm") {
    const overallWeakest = ALL_MAAT_AXES.slice().sort((a, b) =>
      dimensions[a] - dimensions[b]
    )[0];
    if (
      overallWeakest && dimensions[overallWeakest] < dimensions[leadAxis] - 0.2
    ) {
      leadAxis = overallWeakest;
    }
  }
  const correctionAxes = ALL_MAAT_AXES
    .filter((axis) => dimensions[axis] < -0.2)
    .sort((a, b) => dimensions[a] - dimensions[b])
    .slice(0, 3);

  return {
    version: "maat_dims_v1",
    dimensions: Object.fromEntries(
      ALL_MAAT_AXES.map((axis) => [axis, roundTo(dimensions[axis], 3)]),
    ) as Record<MaatAxisCode, number>,
    score,
    band,
    reflectionMove,
    leadAxis,
    correctionAxes: correctionAxes.length ? correctionAxes : [leadAxis],
    hardGates,
    decanPrimaryAxes,
    source: {
      planner_total: plannerSummary.total,
      completed_planner: completedPlanner,
      partial_planner: partialPlanner,
      skipped_planner: skippedPlanner,
      details_coverage: roundTo(detailsCoverage, 3),
      days_active: input.activeDays,
      axis_priors: axisPriors,
    },
  };
}

export function buildReflectionDecisionMatrix(
  profile: ReflectionProfileRow | null,
  snapshot: MaatDimensionSnapshot,
  options: { useKnowledgeGraph: boolean; useDecisionMatrix: boolean },
): ReflectionDecisionMatrixV1 | null {
  if (!options.useKnowledgeGraph && !options.useDecisionMatrix) {
    return null;
  }

  const anchorNodes = (profile?.top_nodes ?? [])
    .map((node) => node.slug?.trim())
    .filter((slug): slug is string => !!slug)
    .slice(0, 4);
  const dominantPatterns = (profile?.dominant_patterns ?? [])
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .slice(0, 4);
  const tensionPairs = (profile?.tension_pairs ?? [])
    .map((pair) => pair.filter(Boolean).join(" vs "))
    .filter(Boolean)
    .slice(0, 3);
  const maatScore = toNumber(profile?.maat_score);
  const isfetScore = toNumber(profile?.isfet_risk_score);
  const balanceMode: ReflectionDecisionMatrixV1["balanceMode"] =
    snapshot.reflectionMove === "correct"
      ? "reduce_scatter"
      : maatScore !== null && isfetScore !== null
      ? (isfetScore > maatScore ? "reduce_scatter" : "reinforce_structure")
      : isfetScore !== null && isfetScore > 0
      ? "reduce_scatter"
      : maatScore !== null && maatScore > 0
      ? "reinforce_structure"
      : snapshot.reflectionMove === "affirm"
      ? "reinforce_structure"
      : "neutral";

  const lines = [
    "DECAN_REFLECTION_DECISION_MATRIX (hidden Ma'at/Isfet guardrails; use as copy steering only, never as a visible score or verdict):",
    "- Treat the model as an audit for restoration: witness concrete evidence, name one pattern, then offer one proportionate next step.",
  ];
  if (options.useKnowledgeGraph && anchorNodes.length > 0) {
    lines.push(
      `- Knowledge graph anchors to respect when compatible with the evidence: ${
        anchorNodes.join(", ")
      }. Use plain concepts, not raw slugs.`,
    );
  }
  if (options.useKnowledgeGraph && dominantPatterns.length > 0) {
    lines.push(
      `- Continue these live patterns through practical language rather than explanation: ${
        dominantPatterns.join(", ")
      }.`,
    );
  }
  if (options.useKnowledgeGraph && tensionPairs.length > 0) {
    lines.push(
      `- If these tensions fit the evidence, resolve them through structure, reduction, or protection of one thread: ${
        tensionPairs.join(", ")
      }.`,
    );
  }

  if (options.useDecisionMatrix) {
    const leadLabel = MAAT_AXIS_LABELS[snapshot.leadAxis];
    const nextStepCopy = MAAT_AXIS_COPY[snapshot.leadAxis];
    lines.push(
      `- Internal reflection move: ${snapshot.reflectionMove}; lead axis: ${leadLabel}. Closing next step should help the user ${nextStepCopy}.`,
    );
    if (snapshot.reflectionMove === "affirm") {
      lines.push(
        "- Closing strategy: affirm the right-order already visible, then deepen one strength without adding bulk.",
      );
    } else if (snapshot.reflectionMove === "inquire") {
      lines.push(
        "- Closing strategy: ask one honest, concrete question or invite one measurable mark; keep it curious, not corrective.",
      );
    } else {
      lines.push(
        "- Closing strategy: name drift gently as measure/provision/restraint needing repair; prefer downshifting, restitution, or finishing one smaller promise.",
      );
    }
    if (balanceMode === "reduce_scatter") {
      lines.push(
        "- Balance mode: reduce scatter. Prefer fewer commitments, explicit finish conditions, restraint, and recovery before expansion.",
      );
    } else if (balanceMode === "reinforce_structure") {
      lines.push(
        "- Balance mode: reinforce structure. Let the next step preserve a rhythm or repeat what is already working.",
      );
    }
    if (anchorNodes.includes("djehuty") && snapshot.dimensions.M < 0.2) {
      lines.push(
        "- Djehuty/measure cue: if the evidence supports it, close with one number, one measure, or one finish condition.",
      );
    }
    if (
      anchorNodes.includes("instruction_amenemope") ||
      anchorNodes.includes("renenutet")
    ) {
      lines.push(
        "- Provision cue: if there is strain, frame the next step as reducing the burden or protecting nourishment rather than trying harder.",
      );
    }
    if (tensionPairs.some((pair) => pair.includes("maat vs isfet"))) {
      lines.push(
        "- Ma'at/Isfet tension cue: translate tension into one thread to protect and one thread to pause.",
      );
    }
  }

  lines.push(
    "- Never call the user or their decan Isfet. Do not mention gates, hard gates, scores, bands, slugs, or decision-matrix language.",
  );

  return {
    version: "decan_maat_dm_v1",
    anchorNodes,
    dominantPatterns,
    tensionPairs,
    balanceMode,
    reflectionMove: snapshot.reflectionMove,
    leadAxis: snapshot.leadAxis,
    promptBlock: lines.join("\n"),
    fingerprint: {
      version: "decan_maat_dm_v1",
      anchor_nodes: anchorNodes,
      dominant_patterns: dominantPatterns,
      tension_pairs: tensionPairs,
      balance_mode: balanceMode,
      reflection_move: snapshot.reflectionMove,
      lead_axis: snapshot.leadAxis,
      correction_axes: snapshot.correctionAxes,
      hard_gates: snapshot.hardGates,
      maat_dimension_score: snapshot.score,
      maat_dimension_band: snapshot.band,
      dimensions: snapshot.dimensions,
      maat_score: maatScore,
      isfet_risk_score: isfetScore,
    },
  };
}
