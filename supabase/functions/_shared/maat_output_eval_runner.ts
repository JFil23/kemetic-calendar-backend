import {
  type ControlledOutputGrade,
  type ControlledOutputValidation,
  evidenceAnchorsFromMemoryPhrases,
  gradeOutputTextAgainstPolicy,
} from "./output_control.ts";
import {
  MAAT_SURFACE_RUBRIC,
  type MaatSpeechAct,
} from "./maat_constitution.ts";
import type { MaatOutputEvalCase } from "./maat_output_eval_cases.ts";

export type MaatOutputEvalCandidate = {
  text: string;
  teaserText?: string;
  primaryAction?: string | null;
  evidenceAnchors?: string[];
  speechAct?: MaatSpeechAct;
  validation?: ControlledOutputValidation;
};

export type MaatOutputEvalResult = {
  caseId: string;
  surface: MaatOutputEvalCase["surface"];
  expectedSpeechAct: MaatSpeechAct;
  actualSpeechAct: MaatSpeechAct;
  speechActMatches: boolean;
  grade: ControlledOutputGrade;
  passed: boolean;
};

export type MaatOutputEvalSummary = {
  total: number;
  passed: number;
  passRate: number;
  schemaValidityRate: number;
  groundingPassRate: number;
  specificityPassRate: number;
  maatAlignmentPassRate: number;
  speechActFidelityRate: number;
  cadencePassRate: number;
  ceremonialCadencePassRate: number;
  semanticSpecificityPassRate: number;
  languageFreshnessPassRate: number;
  worthinessPassRate: number;
  surfaceFitPassRate: number;
  shameFailures: number;
  inventedEvidenceFailures: number;
};

export const MAAT_OUTPUT_EVAL_GATES = {
  evalPassRate: 0.95,
  schemaValidityRate: 0.95,
  evidenceGroundingRate: 0.9,
  speechActFidelityRate: 0.85,
  cadenceStyleRate: 0.8,
  semanticSpecificityRate: 0.8,
  languageFreshnessRate: 0.8,
  worthinessRate: 0.8,
  shameFailuresMax: 0,
  inventedEvidenceFailuresMax: 0,
} as const;

export type MaatOutputEvalGateFailure = {
  gate: keyof typeof MAAT_OUTPUT_EVAL_GATES;
  expected: number;
  actual: number;
  message: string;
};

export type MaatOutputEvalGateReport = {
  passed: boolean;
  failures: MaatOutputEvalGateFailure[];
  summary: MaatOutputEvalSummary;
};

export function evaluateMaatOutputCandidate(
  evalCase: MaatOutputEvalCase,
  candidate: MaatOutputEvalCandidate,
): MaatOutputEvalResult {
  const rubric = MAAT_SURFACE_RUBRIC[evalCase.surface];
  const actualSpeechAct = candidate.speechAct ?? rubric.speechAct;
  const evidenceAnchors = evidenceAnchorsFromMemoryPhrases(
    candidate.evidenceAnchors ?? evalCase.evidenceAnchors,
    {
      prefix: evalCase.id,
      sourceType: "memory",
      limit: Math.max(
        1,
        candidate.evidenceAnchors?.length ?? evalCase.evidenceAnchors.length,
      ),
      required: true,
    },
  );
  const grade = gradeOutputTextAgainstPolicy({
    surface: evalCase.surface,
    speechAct: actualSpeechAct,
    text: candidate.text,
    teaserText: candidate.teaserText,
    evidenceAnchors,
    primaryAction: candidate.primaryAction,
    validation: candidate.validation,
    maxPrimaryActions: rubric.maxPrimaryActions,
  });
  const speechActMatches = actualSpeechAct === evalCase.expectedSpeechAct;
  return {
    caseId: evalCase.id,
    surface: evalCase.surface,
    expectedSpeechAct: evalCase.expectedSpeechAct,
    actualSpeechAct,
    speechActMatches,
    grade,
    passed: speechActMatches && grade.pass,
  };
}

export function summarizeMaatOutputEvalResults(
  results: MaatOutputEvalResult[],
): MaatOutputEvalSummary {
  const total = results.length;
  const rate = (count: number) => total === 0 ? 0 : count / total;
  const schemaValid =
    results.filter((item) => item.grade.signals.validationErrors.length === 0)
      .length;
  const groundingPass =
    results.filter((item) => item.grade.groundingScore >= 4).length;
  const specificityPass =
    results.filter((item) => item.grade.specificityScore >= 4).length;
  const maatAlignmentPass =
    results.filter((item) => item.grade.maatAlignmentScore >= 5).length;
  const cadencePass = results.filter((item) => item.grade.cadenceScore >= 3)
    .length;
  const ceremonialCadencePass =
    results.filter((item) => item.grade.ceremonialCadenceScore >= 3).length;
  const semanticSpecificityPass =
    results.filter((item) => item.grade.semanticSpecificityScore >= 4).length;
  const languageFreshnessPass =
    results.filter((item) => item.grade.languageFreshnessScore >= 4).length;
  const worthinessPass =
    results.filter((item) => item.grade.guidanceWorthinessScore >= 4.2).length;
  const surfaceFitPass =
    results.filter((item) => item.grade.surfaceFitScore >= 4).length;
  const shameFailures =
    results.filter((item) =>
      item.grade.failureReasons.includes("maat_alignment_below_threshold")
    ).length;
  const inventedEvidenceFailures =
    results.filter((item) =>
      item.grade.failureReasons.includes("grounding_below_threshold")
    ).length;

  return {
    total,
    passed: results.filter((item) => item.passed).length,
    passRate: rate(results.filter((item) => item.passed).length),
    schemaValidityRate: rate(schemaValid),
    groundingPassRate: rate(groundingPass),
    specificityPassRate: rate(specificityPass),
    maatAlignmentPassRate: rate(maatAlignmentPass),
    speechActFidelityRate: rate(
      results.filter((item) => item.speechActMatches).length,
    ),
    cadencePassRate: rate(cadencePass),
    ceremonialCadencePassRate: rate(ceremonialCadencePass),
    semanticSpecificityPassRate: rate(semanticSpecificityPass),
    languageFreshnessPassRate: rate(languageFreshnessPass),
    worthinessPassRate: rate(worthinessPass),
    surfaceFitPassRate: rate(surfaceFitPass),
    shameFailures,
    inventedEvidenceFailures,
  };
}

export function checkMaatOutputEvalGates(
  summary: MaatOutputEvalSummary,
): MaatOutputEvalGateReport {
  const failures: MaatOutputEvalGateFailure[] = [];
  const minimum = (
    gate: keyof typeof MAAT_OUTPUT_EVAL_GATES,
    actual: number,
    message: string,
  ) => {
    const expected = MAAT_OUTPUT_EVAL_GATES[gate];
    if (typeof expected === "number" && actual < expected) {
      failures.push({ gate, expected, actual, message });
    }
  };
  const maximum = (
    gate: keyof typeof MAAT_OUTPUT_EVAL_GATES,
    actual: number,
    message: string,
  ) => {
    const expected = MAAT_OUTPUT_EVAL_GATES[gate];
    if (typeof expected === "number" && actual > expected) {
      failures.push({ gate, expected, actual, message });
    }
  };

  minimum("evalPassRate", summary.passRate, "eval pass rate below gate");
  minimum(
    "schemaValidityRate",
    summary.schemaValidityRate,
    "schema validity below gate",
  );
  minimum(
    "evidenceGroundingRate",
    summary.groundingPassRate,
    "evidence grounding below gate",
  );
  minimum(
    "speechActFidelityRate",
    summary.speechActFidelityRate,
    "speech-act fidelity below gate",
  );
  minimum(
    "cadenceStyleRate",
    summary.ceremonialCadencePassRate,
    "ceremonial cadence below gate",
  );
  minimum(
    "semanticSpecificityRate",
    summary.semanticSpecificityPassRate,
    "semantic specificity below gate",
  );
  minimum(
    "languageFreshnessRate",
    summary.languageFreshnessPassRate,
    "language freshness below gate",
  );
  minimum(
    "worthinessRate",
    summary.worthinessPassRate,
    "guidance worthiness below gate",
  );
  maximum(
    "shameFailuresMax",
    summary.shameFailures,
    "shame or moral-posture failures exceeded gate",
  );
  maximum(
    "inventedEvidenceFailuresMax",
    summary.inventedEvidenceFailures,
    "grounding failures exceeded gate",
  );

  return {
    passed: failures.length === 0,
    failures,
    summary,
  };
}
