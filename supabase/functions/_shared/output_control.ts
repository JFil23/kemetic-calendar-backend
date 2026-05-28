import {
  MAAT_CONSTITUTION_VERSION,
  MAAT_OUTPUT_FORCE_PRINCIPLE,
  MAAT_OUTPUT_NORTH_STAR,
  MAAT_SURFACE_RUBRIC,
  maatConstitutionPromptBlock,
  type MaatOutputSurface,
  type MaatSpeechAct,
} from "./maat_constitution.ts";
import {
  maatExamplePromptBlock,
  type MaatOutputExample,
} from "./maat_output_examples.ts";
import {
  type MaatReflectionExample,
  maatReflectionExamplePromptBlock,
} from "./maat_reflection_examples.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type {
  ReflectionAlignmentMap,
  ReflectionArcPlan,
  ReflectionCalendarFrame,
  ReflectionUserPatternProfile,
} from "./reflection_calendar.ts";
import type { ReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";
import type { ReflectionJudgment } from "./reflection_judgment.ts";
import type { ReflectionThesisGate } from "./reflection_thesis_gate.ts";
import type { ReflectionMoralPortrait } from "./reflection_moral_portrait.ts";

export const OUTPUT_CONTROL_POLICY_VERSION = "output_control_v1";

export type ControlledOutputKind =
  | "decan_opening"
  | "drift_nudge"
  | "strength_nudge";

export type ControlledSpeechAct =
  | "orient"
  | "correct"
  | "fortify"
  | "witness"
  | "charge";

export type ControlledRhetoricalMove =
  | "name_the_frame"
  | "name_the_pattern"
  | "ground_in_evidence"
  | "interpret_gently"
  | "offer_one_act"
  | "protect_strength"
  | "close_with_dignity";

export type ControlledDetailBudget = "brief" | "medium" | "rich";

export type ControlledVoiceDirection = {
  register: "sacred" | "practical" | "relational" | "witnessing";
  temperatureHint: "warm" | "direct" | "gentle" | "grounding";
  leadWith: "situation" | "pattern" | "meaning" | "question";
  closeWith: "principle" | "question" | "permission" | "invitation";
  sentenceBudget: number;
};

export type ControlledEvidenceAnchor = {
  id: string;
  sourceType:
    | "memory"
    | "planner"
    | "journal"
    | "badge"
    | "snapshot"
    | "day_card"
    | "decan_context";
  claim: string;
  confidence: number;
  allowedInferenceLevel: "quote" | "paraphrase" | "interpret";
  required?: boolean;
};

export type ControlledSurfaceConstraints = {
  teaserCharsMax: number;
  pushExcerptCharsMax: number;
  archivePreviewCharsMax: number;
  bodySentencesMax?: number;
  bodyParagraphsMax?: number;
  bannedPhrases: string[];
};

export type ControlledCta = {
  type: string;
  ref: string | null;
  reason: string;
};

export type ControlledMeaningLayer = {
  dominantField?: string | null;
  humanLabel: string;
  whyThisFieldWon?: string | null;
  userFacingEvidenceLine: string;
  caseKey?: string | null;
  maatMeaning?: string | null;
  userTranslation?: string | null;
  likelyUserCondition?: string | null;
  selectedOffering?: string | null;
  whyThisOfferingWon?: string | null;
  userFacingDiagnosis?: string | null;
  evidenceDensity: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  rhetoricalFrame: string;
  decanOrDayAnchor?: string | null;
  specificAction: string;
  bannedTerms?: string[];
  baselineDeviation?: string | null;
  voiceDirection?: ControlledVoiceDirection | null;
  resolutionCondition?: string | null;
  exampleReference?: MaatOutputExample | null;
  offeringRender?: {
    diagnosis?: string | null;
    concreteAction?: string | null;
    caseConcreteAction?: string | null;
    offeringRationale?: string | null;
    exampleId?: string | null;
    exampleNudge?: string | null;
    exampleReflection?: string | null;
    close?: string | null;
    voiceDirection?: ControlledVoiceDirection | null;
    bannedPhrases?: string[];
  } | null;
};

export type ControlledOutputPlan = {
  policyVersion: string;
  constitutionVersion?: string;
  northStar?: string;
  forcePrinciple?: string;
  kind: ControlledOutputKind;
  speechAct: ControlledSpeechAct;
  intent: string;
  moralFrame: string;
  emotionalTemperature: "low" | "medium" | "high";
  userState: string;
  leadAxis: string;
  leadAxisLabel: string;
  primaryAction: string;
  evidenceAnchors: ControlledEvidenceAnchor[];
  rhetoricalMoves: ControlledRhetoricalMove[];
  detailBudget: ControlledDetailBudget;
  surfaceConstraints: ControlledSurfaceConstraints;
  cta: ControlledCta;
  meaning?: ControlledMeaningLayer;
  context: {
    decanName?: string | null;
    decanTheme?: string | null;
    contextSentence?: string | null;
    dayLine?: string | null;
    personalSeasoning?: string | null;
    nodeRef?: string | null;
    triggerReason?: string | null;
  };
};

export type ControlledContextCard = {
  rows: Array<{ label: string; value: string }>;
};

export type ControlledSurfaceVariants = {
  teaserText: string;
  bodyText: string;
  pushExcerptText: string;
  archivePreviewText: string;
  contextCard?: ControlledContextCard;
};

export type ControlledOutputValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type ControlledOutputResult = {
  plan: ControlledOutputPlan;
  surfaceVariants: ControlledSurfaceVariants;
  validation: ControlledOutputValidation;
};

export type ControlledGeneratedTextPlan = {
  policyVersion: string;
  constitutionVersion?: string;
  northStar?: string;
  forcePrinciple?: string;
  kind: "decan_reflection";
  speechAct: "witness" | "interpret" | "charge";
  intent: string;
  moralFrame: string;
  emotionalTemperature: "low" | "medium" | "high";
  targetWordRange: string;
  requiredEvidenceDetailCount: number;
  leadAxis?: string | null;
  leadAxisLabel?: string | null;
  reflectionMove?: string | null;
  closingInstruction: string;
  caseKey?: string | null;
  selectedOffering?: string | null;
  voiceDirection?: ControlledMeaningLayer["voiceDirection"];
  offeringRender?: ControlledMeaningLayer["offeringRender"];
  exampleReferences?: MaatOutputExample[];
  reflectionExampleReferences?: MaatReflectionExample[];
  evidenceAnchors: ControlledEvidenceAnchor[];
  evidenceUsePolicy?: {
    maxNamedEvidenceMentions?: number;
    proportionateGravity?: boolean;
    instruction?: string;
  };
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  reflectionCalendarFrame?: ReflectionCalendarFrame | null;
  reflectionAlignmentMap?: ReflectionAlignmentMap | null;
  reflectionUserPatternProfile?: ReflectionUserPatternProfile | null;
  reflectionProfileSnapshot?: ReflectionProfileSnapshot | null;
  reflectionMoralPortrait?: ReflectionMoralPortrait | null;
  reflectionJudgment?: ReflectionJudgment | null;
  reflectionThesisGate?: ReflectionThesisGate | null;
  reflectionArcPlan?: ReflectionArcPlan | null;
  rhetoricalMoves: string[];
  surfaceConstraints: {
    wordsMin?: number | null;
    wordsMax?: number | null;
    sentencesMax?: number | null;
    bannedPhrases: string[];
    hiddenTerms: string[];
  };
};

export type ControlledOutputGrade = {
  graderVersion: string;
  constitutionVersion: string;
  groundingScore: 1 | 2 | 3 | 4 | 5;
  specificityScore: 1 | 2 | 3 | 4 | 5;
  maatAlignmentScore: 1 | 2 | 3 | 4 | 5;
  cadenceScore: 1 | 2 | 3 | 4 | 5;
  ceremonialCadenceScore: 1 | 2 | 3 | 4 | 5;
  actionClarityScore: 1 | 2 | 3 | 4 | 5;
  semanticSpecificityScore: 1 | 2 | 3 | 4 | 5;
  languageFreshnessScore: 1 | 2 | 3 | 4 | 5;
  surfaceFitScore: 1 | 2 | 3 | 4 | 5;
  calendarGovernsScore?: 1 | 2 | 3 | 4 | 5;
  alignmentBalanceScore?: 1 | 2 | 3 | 4 | 5;
  caseSubordinationScore?: 1 | 2 | 3 | 4 | 5;
  singleAnchorScore?: 1 | 2 | 3 | 4 | 5;
  lessonSpecificityScore?: 1 | 2 | 3 | 4 | 5;
  closingIntegrityScore?: 1 | 2 | 3 | 4 | 5;
  exampleShapeMatchScore?: 1 | 2 | 3 | 4 | 5;
  profileLensGovernsScore?: 1 | 2 | 3 | 4 | 5;
  evidenceAnchorSubordinationScore?: 1 | 2 | 3 | 4 | 5;
  lensFidelityScore?: 1 | 2 | 3 | 4 | 5;
  maatLensGovernsScore?: 1 | 2 | 3 | 4 | 5;
  ethicalSpecificityScore?: 1 | 2 | 3 | 4 | 5;
  habitSubordinationScore?: 1 | 2 | 3 | 4 | 5;
  lensEvidenceFitScore?: 1 | 2 | 3 | 4 | 5;
  repairDirectionFitScore?: 1 | 2 | 3 | 4 | 5;
  interpretiveSpecificityScore?: 1 | 2 | 3 | 4 | 5;
  moralThesisScore?: 1 | 2 | 3 | 4 | 5;
  falseReadingAvoidedScore?: 1 | 2 | 3 | 4 | 5;
  maatQuestionSpecificityScore?: 1 | 2 | 3 | 4 | 5;
  directiveDepthScore?: 1 | 2 | 3 | 4 | 5;
  habitMechanicsSuppressedScore?: 1 | 2 | 3 | 4 | 5;
  evidenceAnchorDominanceScore?: 1 | 2 | 3 | 4 | 5;
  nutritionVisibleTopicScore?: 1 | 2 | 3 | 4 | 5;
  habitQuestionScore?: 1 | 2 | 3 | 4 | 5;
  maatDirectiveScore?: 1 | 2 | 3 | 4 | 5;
  moralPortraitPresentScore?: 1 | 2 | 3 | 4 | 5;
  portraitBeforeDirectiveScore?: 1 | 2 | 3 | 4 | 5;
  serudjOrientationScore?: 1 | 2 | 3 | 4 | 5;
  worthinessDomainBalanceScore?: 1 | 2 | 3 | 4 | 5;
  breathToNoseScore?: 1 | 2 | 3 | 4 | 5;
  personAsProtagonistScore?: 1 | 2 | 3 | 4 | 5;
  recordProtagonistScore?: 1 | 2 | 3 | 4 | 5;
  serudjDirectiveFitScore?: 1 | 2 | 3 | 4 | 5;
  portraitDirectiveContinuityScore?: 1 | 2 | 3 | 4 | 5;
  portraitContinuityScore?: 1 | 2 | 3 | 4 | 5;
  poignancyScore?: 1 | 2 | 3 | 4 | 5;
  oneIdeaAtATimeScore?: 1 | 2 | 3 | 4 | 5;
  readabilityScore?: 1 | 2 | 3 | 4 | 5;
  guidanceWorthinessScore: number;
  deliveryRecommendation: ControlledDeliveryChannel;
  pass: boolean;
  failureReasons: string[];
  repairMode: ControlledOutputRepairMode;
  repairInstruction: string | null;
  signals: {
    evidenceAnchorCount: number;
    matchedEvidenceAnchorCount: number;
    sentenceCount: number;
    paragraphCount: number;
    primaryActionCount: number;
    ceremonialSignals: string[];
    validationErrors: string[];
    validationWarnings: string[];
  };
};

export type ControlledOutputRepairMode =
  | "none"
  | "evidence_repair"
  | "cadence_repair"
  | "moral_posture_repair"
  | "surface_fit_repair";

export type ControlledDeliveryChannel =
  | "push"
  | "in_app_card"
  | "archive_only";

export type ControlledOutputGradeInput = {
  surface: MaatOutputSurface;
  speechAct: MaatSpeechAct;
  text: string;
  teaserText?: string;
  evidenceAnchors: ControlledEvidenceAnchor[];
  primaryAction?: string | null;
  validation?: ControlledOutputValidation;
  maxPrimaryActions?: number;
};

export const DEFAULT_OUTPUT_BANNED_PHRASES = [
  "you are failing",
  "you always",
  "you never",
  "you are isfet",
  "your decan is isfet",
  "path back to balance",
  "the line has loosened",
  "failure to carry",
  "corrective act:",
  "not a verdict",
  "not a judgment",
  "not a judgement",
  "not a scolding",
  "do not force a judgment",
  "does not need",
  "no drama",
  "tend to provision",
  "tend to visible work",
  "tend to truthful record",
  "open the suggested flow",
  "one small question",
  "still unmarked",
  "several nutrition checks",
  "body-support checks were missed",
  "mark what happened",
  "provision check",
  "record it plainly",
  "record plainly",
  "recording the return plainly",
  "restore ma'at",
  "right measure makes",
  "in ma'at terms",
  "not failure",
  "not a failure",
  "not as failure",
  "not crisis",
  "not as crisis",
  "the gap isn't in the living but in the witnessing",
  "the gap is not in the living but in the witnessing",
  "the gap wasn't in the living but in the witnessing",
  "the gap was not in the living but in the witnessing",
  "the user may",
  "the user needs",
  "align your energy",
];

export function buildControlledOutput(
  plan: ControlledOutputPlan,
): ControlledOutputResult {
  const planValidation = validateOutputPlan(plan);
  const surfaceVariants = renderControlledOutput(plan);
  const surfaceValidation = validateSurfaceVariants(plan, surfaceVariants);
  const errors = [...planValidation.errors, ...surfaceValidation.errors];
  const warnings = [...planValidation.warnings, ...surfaceValidation.warnings];
  return {
    plan,
    surfaceVariants,
    validation: {
      ok: errors.length === 0,
      errors,
      warnings,
    },
  };
}

export function outputSurfaceVariantsPayload(
  variants: ControlledSurfaceVariants,
): Record<string, unknown> {
  return {
    teaser_text: variants.teaserText,
    body_text: variants.bodyText,
    push_excerpt_text: variants.pushExcerptText,
    archive_preview_text: variants.archivePreviewText,
    context_card: variants.contextCard ?? null,
  };
}

export function outputControlPayload(
  output: ControlledOutputResult,
): Record<string, unknown> {
  const grade = gradeControlledOutput(output);
  return {
    policy_version: output.plan.policyVersion,
    constitution_version: output.plan.constitutionVersion ??
      MAAT_CONSTITUTION_VERSION,
    north_star: output.plan.northStar ?? MAAT_OUTPUT_NORTH_STAR,
    force_principle: output.plan.forcePrinciple ??
      MAAT_OUTPUT_FORCE_PRINCIPLE,
    plan: output.plan,
    validation: output.validation,
    grade,
  };
}

export function generatedTextPlanPromptBlock(
  plan: ControlledGeneratedTextPlan,
): string {
  return `${maatConstitutionPromptBlock()}

OUTPUT_CONTROL_PLAN (hidden writing contract; do not print this JSON):
${JSON.stringify(plan, null, 2)}${
    maatExamplePromptBlock(plan.exampleReferences)
  }${maatReflectionExamplePromptBlock(plan.reflectionExampleReferences)}

OUTPUT_CONTROL_RULES:
- Treat speech_act, intent, moral_frame, rhetorical_moves, and closing_instruction as binding.
- Name only evidence that appears in the supplied evidence blocks or evidence_anchors.
- Use the evidence anchors as candidate details, not as a checklist to print mechanically.
- Use one concrete detail as an anchor only when reflectionThesisGate permits visible_anchor, then translate it into pattern and meaning; do not repeatedly name-drop the same activity, source, purpose, or count.
- When normalizedObligationThreads is present, treat unique_item_count as the number of obligations and occurrence_count as repetitions. Never describe one recurring thread as several supports.
- Calibrate gravity to the evidence. Routine support records call for proportionate language about measure and rhythm, not crisis language or inflated proof language.
- For decan_reflection, synthesize the whole decan first; the case key/offering is one interpretive thread, not the whole reflection.
- For decan_reflection, use reflectionCalendarFrame and reflectionAlignmentMap as the deeper synthesis layer. The reflection must interpret the user's evidence inside the month/decan/day-card arc while letting alignment and restoration appear through portrait, not labels.
- For decan_reflection, reflectionArcPlan is the binding hierarchy: calendar/decan demand first, aligned signal second, underanswered signal third, Ma'at lesson fourth, then exactly one closing question or one closing charge.
- For decan_reflection, the Ma'at alignment lens inside reflectionProfileSnapshot governs the moral interpretation. The behavioral user lens only translates that moral lens into this user's pattern.
- For decan_reflection, do not expose the scaffold. Do not write visible buckets like "where you answered", "where restoration is still needed", "the alignment is", or "the improvement direction is". Let the continuous portrait reveal both alignment and restoration without category labels.
- For decan_reflection, reflectionProfileSnapshot provides the personal translation layer. Use dominantUserLens after the Ma'at lens; the evidence anchor illustrates the lens and is not the story.
- For decan_reflection, reflectionMoralPortrait is the primary witness layer. Begin from who the user is becoming in this decan, then let any directive arise from reflectionMoralPortrait.serudjDirective as restoration (serudj). Do not turn the portrait into an evidence-quality request.
- For decan_reflection, the person is the protagonist. Record/account/mark/evidence may appear only as background and must not become the subject or goal of the reflection.
- For decan_reflection, reflectionJudgment is the binding interpretive decision when present. Render from reflectionJudgment.reflectionThesis and falseReadingToAvoid before using profileSnapshot details.
- For decan_reflection, reflectionThesisGate decides whether evidence may be visible. If evidenceVisibility is background_support or diagnostics_only, keep the evidence anchor in diagnostics only, obey forbiddenSurfaceFocus, and render the moral thesis instead.
- For decan_reflection, obey reflectionProfileSnapshot.suppressedEvidenceAnchors. Suppressed evidence may support the reading once, but it must not lead, repeat, or become the reflection topic.
- For decan_reflection, use reflectionAlignmentMap.domainBalance to choose meaning. Occurrence count is frequency, not importance; repeated daily nutrition rows are one recurring body-care promise unless normalized threads say otherwise.
- For decan_reflection with thin evidence, lead from calendar arc plus translated profile context. Use one evidence anchor as a sign, not as the topic.
- For decan_reflection, write for a thoughtful non-specialist and address the user directly with you/your. Ma'at terms are allowed only when the sentence also gives their plain meaning. Prefer plain words like right size, clear place, truthful form, steady care, and follow-through over coded phrases like written witness, act and account, embodied order, underalignment, or inference. Do not use "the account" or "account" in user-facing reflection prose; say your day, your practice, or what you kept.
- For decan_reflection, never serve the app's evidence problem. Do not say "next reflection", "less guesswork", "enough detail", "record cannot show", "what may already have occurred", "truth asks for enough detail", or "improvement direction".
- For decan_reflection, do not use "record tells the truth", "record can match", "mark of care", "complete today so your record", or "written record drift apart". The final question must ask for human restoration, not record maintenance.
- For decan_reflection, every sentence should do at least two jobs: fuse decan frame with portrait, turn evidence into meaning, or let the directive arise naturally from who the user is becoming. The final question should ask about meaning, restoration, return, willingness, or becoming; avoid hedged closings like "what would it look like".
- For decan_reflection, prefer the Plain Sacred Editor shape: paragraph 1 calendar call + central theme; paragraph 2 personal meaning + Ma'at alignment in ordinary language; paragraph 3 one concrete directive + emotional resolution. Make one idea meaningful at a time.
- For decan_reflection, the middle must earn trust with 1-2 concrete but non-invasive details from allowed evidence or translated profile context, especially calendar events, reminders, observed flows, visible work, or journal badges. Do not quote journal text. Do not dump inputs. Use the detail to show what you know about this user's pattern and what they need next.
- For decan_reflection, never open with the user's missed item, task, pending state, or case diagnosis when a calendar arc is present.
- For decan_reflection, the opening sentence must name the current decan using reflectionCalendarFrame.ceremonialDecanName when present.
- For decan_reflection, the selected offering shapes only the closing move; it must not turn the reflection into a longer nudge.
- For decan_reflection, mention no more than one concrete evidence anchor, mention it once, and mention none when reflectionThesisGate hides evidence.
- If offeringRender is present, treat its diagnosis and concreteAction as the specific thread; do not replace the whole reflection with a fleshed-out nudge.
- Treat nudge examples and reflection examples as separate families. Reflection examples model calendar-arc synthesis; nudge examples model immediate case restoration.
- Treat example outputs as voice and structure references only; do not copy details that are not present in the supplied evidence.
- Do not mention output control, scores, gates, bands, matrices, slugs, or internal labels.`;
}

export function validateGeneratedTextAgainstPlan(
  plan: ControlledGeneratedTextPlan,
  text: string,
): ControlledOutputValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clean = cleanPhrase(text);
  if (!clean) errors.push("missing_generated_text");
  const lower = clean.toLowerCase();
  for (const phrase of plan.surfaceConstraints.bannedPhrases) {
    const banned = cleanPhrase(phrase).toLowerCase();
    if (banned && lower.includes(banned)) {
      errors.push(`banned_phrase:${banned}`);
    }
  }
  for (const term of plan.surfaceConstraints.hiddenTerms) {
    const hidden = cleanPhrase(term).toLowerCase();
    if (hidden && lower.includes(hidden)) {
      warnings.push(`hidden_term_visible:${hidden}`);
    }
  }
  const words = wordCount(clean);
  const min = plan.surfaceConstraints.wordsMin;
  const max = plan.surfaceConstraints.wordsMax;
  if (typeof min === "number" && words < min) {
    warnings.push(`word_count_below_target:${words}`);
  }
  if (typeof max === "number" && words > max) {
    warnings.push(`word_count_above_target:${words}`);
  }
  const sentenceMax = plan.surfaceConstraints.sentencesMax;
  const generatedSentenceCount = sentenceCount(clean);
  if (
    typeof sentenceMax === "number" && sentenceMax > 0 &&
    generatedSentenceCount > sentenceMax
  ) {
    warnings.push(`sentence_count_above_target:${generatedSentenceCount}`);
  }
  const literalAnchorCount = plan.evidenceAnchors.filter((anchor) => {
    const claim = cleanPhrase(anchor.claim);
    return claim && anchorAppears(claim, clean);
  }).length;
  if (
    plan.evidenceAnchors.length > 0 &&
    literalAnchorCount === 0 &&
    plan.requiredEvidenceDetailCount > 0 &&
    visibleEvidenceRequired(plan)
  ) {
    warnings.push("no_evidence_anchor_literal_match");
  }
  const maxNamedEvidenceMentions =
    plan.evidenceUsePolicy?.maxNamedEvidenceMentions ?? 1;
  for (const term of specificEvidenceTerms(plan.evidenceAnchors)) {
    const count = countPhraseOccurrences(lower, term);
    if (count > maxNamedEvidenceMentions) {
      warnings.push(`evidence_detail_overused:${term}:${count}`);
    }
  }
  if (
    plan.evidenceUsePolicy?.proportionateGravity !== false &&
    hasInflatedRoutineGravity(lower)
  ) {
    warnings.push("gravity_overstated_for_routine_signal");
  }
  if (confusesSingleRecurringNutritionThread(plan, lower)) {
    warnings.push(
      "thread_count_mismatch:single_recurring_nutrition_as_many_supports",
    );
  }
  if (overexposesSingleRecurringNutritionCount(plan, lower)) {
    warnings.push(
      "thread_count_overexposed:single_recurring_nutrition_occurrences",
    );
  }
  if (recommendsConsolidationForRecurringThread(plan, lower)) {
    warnings.push(
      "offering_fit_mismatch:recurring_nutrition_thread_as_consolidation",
    );
  }
  if (reflectionCalendarArcMissing(plan, lower)) {
    warnings.push("reflection_calendar_arc_missing");
  }
  if (reflectionAlignmentMissing(plan, lower)) {
    warnings.push("reflection_alignment_missing");
  }
  if (reflectionImprovementMissing(plan, lower)) {
    warnings.push("reflection_improvement_missing");
  }
  if (reflectionCaseOverdominant(plan, lower)) {
    warnings.push("reflection_case_overdominant");
  }
  if (reflectionCalendarNotGoverning(plan, clean)) {
    warnings.push("reflection_calendar_not_governing");
  }
  if (reflectionDecanNameMissing(plan, clean)) {
    warnings.push("reflection_decan_name_missing");
  }
  if (reflectionClosingIntegrityFailed(plan, clean)) {
    warnings.push("reflection_closing_integrity_failed");
  }
  if (reflectionLessonMissing(plan, lower)) {
    warnings.push("reflection_lesson_missing");
  }
  if (nutritionDensityOverweightFailure(plan, lower)) {
    warnings.push("nutrition_density_overweight_failure");
  }
  if (evidenceDensityTopicDominanceFailure(plan, clean)) {
    warnings.push("evidence_density_topic_dominance_failure");
  }
  if (thinEvidenceOverclaimFailure(plan, lower)) {
    warnings.push("thin_evidence_overclaim_failure");
  }
  if (missingProfileLensFailure(plan, lower)) {
    warnings.push("missing_profile_lens_failure");
  }
  if (profileLensMissingFailure(plan, lower)) {
    warnings.push("profile_lens_missing_failure");
  }
  if (suppressedEvidenceLeakFailure(plan, clean)) {
    warnings.push("suppressed_evidence_leak_failure");
  }
  if (nutritionAsTopicWhenDemotedFailure(plan, clean)) {
    warnings.push("nutrition_as_topic_when_demoted_failure");
  }
  if (maatLensMissingFailure(plan, lower)) {
    warnings.push("missing_maat_lens_failure");
  }
  if (habitTopicDominanceFailure(plan, clean)) {
    warnings.push("habit_topic_dominance_failure");
  }
  if (genericAlignmentLanguageFailure(plan, lower)) {
    warnings.push("generic_alignment_language_failure");
  }
  if (lensEvidenceMismatchFailure(plan, lower)) {
    warnings.push("lens_evidence_mismatch_failure");
  }
  if (repairDirectionFitFailure(plan, lower)) {
    warnings.push("repair_direction_fit_failure");
  }
  if (interpretiveSpecificityMissingFailure(plan, lower)) {
    warnings.push("interpretive_specificity_missing");
  }
  if (genericInterpretiveSubstituteFailure(plan, lower)) {
    warnings.push("generic_interpretive_substitute_failure");
  }
  if (reflectionMoralThesisMissingFailure(plan, lower)) {
    warnings.push("reflection_moral_thesis_missing");
  }
  if (reflectionFalseReadingNotAvoidedFailure(plan, clean)) {
    warnings.push("reflection_false_reading_not_avoided");
  }
  if (reflectionMaatQuestionSpecificityFailure(plan, lower)) {
    warnings.push("reflection_maat_question_specificity_low");
  }
  if (reflectionDirectiveDepthFailure(plan, lower)) {
    warnings.push("reflection_directive_depth_low");
  }
  if (reflectionHabitMechanicsUnsuppressedFailure(plan, clean)) {
    warnings.push("reflection_habit_mechanics_unsuppressed");
  }
  if (evidenceAnchorDominanceFailure(plan, clean)) {
    warnings.push("evidence_anchor_dominance_failure");
  }
  if (nutritionVisibleTopicFailure(plan, clean)) {
    warnings.push("nutrition_visible_topic_failure");
  }
  if (habitQuestionFailure(plan, clean)) {
    warnings.push("habit_question_failure");
  }
  if (missingMaatDirectiveFailure(plan, lower)) {
    warnings.push("missing_maat_directive_failure");
  }
  if (reflectionPlainLanguageFailure(plan, clean)) {
    warnings.push("reflection_plain_language_failure");
  }
  if (reflectionAccountLanguageFailure(plan, clean)) {
    warnings.push("reflection_account_language_failure");
  }
  if (reflectionDirectAddressMissing(plan, clean)) {
    warnings.push("reflection_direct_address_missing");
  }
  if (reflectionMoralPortraitMissing(plan)) {
    warnings.push("reflection_moral_portrait_missing");
  }
  if (portraitBeforeDirectiveFailure(plan, clean)) {
    warnings.push("portrait_before_directive_failure");
  }
  if (serudjOrientationMissing(plan, lower)) {
    warnings.push("serudj_orientation_missing");
  }
  if (worthinessDomainBalanceMissing(plan, lower)) {
    warnings.push("worthiness_domain_balance_missing");
  }
  if (systemNeedLeakFailure(plan, lower)) {
    warnings.push("system_need_leak_failure");
  }
  if (breathToNoseFailure(plan, lower)) {
    warnings.push("breath_to_nose_failure");
  }
  if (personAsProtagonistFailure(plan, clean)) {
    warnings.push("person_as_protagonist_failure");
  }
  if (recordProtagonistFailure(plan, clean)) {
    warnings.push("record_protagonist_failure");
  }
  if (serudjDirectiveFitFailure(plan, lower)) {
    warnings.push("serudj_directive_fit_failure");
  }
  if (portraitDirectiveContinuityFailure(plan, clean)) {
    warnings.push("portrait_directive_continuity_failure");
  }
  if (rubricLeakageFailure(plan, clean)) {
    warnings.push("rubric_leakage_failure");
  }
  if (portraitContinuityFailure(plan, text)) {
    warnings.push("portrait_continuity_failure");
  }
  if (poignancyFailure(plan, text)) {
    warnings.push("poignancy_failure");
  }
  if (abstractionStackFailure(plan, text)) {
    warnings.push("abstraction_stack_failure");
  }
  if (muddledProgressionFailure(plan, text)) {
    warnings.push("muddled_progression_failure");
  }
  if (unclearDirectiveFailure(plan, text)) {
    warnings.push("unclear_directive_failure");
  }
  if (overwrittenSpiritualLanguageFailure(plan, text)) {
    warnings.push("overwritten_spiritual_language_failure");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function gradeControlledOutput(
  output: ControlledOutputResult,
): ControlledOutputGrade {
  return gradeTextAgainstControl({
    surface: output.plan.kind,
    speechAct: output.plan.speechAct,
    text: output.surfaceVariants.bodyText,
    teaserText: output.surfaceVariants.teaserText,
    evidenceAnchors: output.plan.evidenceAnchors,
    primaryAction: output.plan.meaning?.specificAction ??
      output.plan.primaryAction,
    validation: output.validation,
    maxPrimaryActions: MAAT_SURFACE_RUBRIC[output.plan.kind].maxPrimaryActions,
  });
}

export function gradeGeneratedTextAgainstPlan(
  plan: ControlledGeneratedTextPlan,
  text: string,
  validation = validateGeneratedTextAgainstPlan(plan, text),
): ControlledOutputGrade {
  const speechAct = plan.speechAct === "interpret" ? "witness" : plan.speechAct;
  const evidenceAnchors = visibleEvidenceRequired(plan)
    ? plan.evidenceAnchors
    : plan.evidenceAnchors.map((anchor) => ({ ...anchor, required: false }));
  return gradeTextAgainstControl({
    surface: "decan_reflection",
    speechAct,
    text,
    evidenceAnchors,
    primaryAction: plan.closingInstruction,
    validation,
    maxPrimaryActions: MAAT_SURFACE_RUBRIC.decan_reflection.maxPrimaryActions,
  });
}

export function gradeOutputTextAgainstPolicy(
  args: ControlledOutputGradeInput,
): ControlledOutputGrade {
  return gradeTextAgainstControl({
    surface: args.surface,
    speechAct: args.speechAct,
    text: args.text,
    teaserText: args.teaserText,
    evidenceAnchors: args.evidenceAnchors,
    primaryAction: args.primaryAction,
    validation: args.validation ?? { ok: true, errors: [], warnings: [] },
    maxPrimaryActions: args.maxPrimaryActions ??
      MAAT_SURFACE_RUBRIC[args.surface].maxPrimaryActions,
  });
}

export function evidenceAnchorsFromMemoryPhrases(
  phrases: string[] | undefined,
  params?: {
    prefix?: string;
    sourceType?: ControlledEvidenceAnchor["sourceType"];
    limit?: number;
    required?: boolean;
  },
): ControlledEvidenceAnchor[] {
  const limit = Math.max(0, params?.limit ?? 3);
  const prefix = params?.prefix ?? "memory";
  const sourceType = params?.sourceType ?? "memory";
  const seen = new Set<string>();
  const anchors: ControlledEvidenceAnchor[] = [];
  for (const phrase of phrases ?? []) {
    const claim = cleanPhrase(phrase);
    if (!claim) continue;
    const dedupeKey = claim.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    anchors.push({
      id: `${prefix}_${anchors.length + 1}`,
      sourceType,
      claim,
      confidence: 0.75,
      allowedInferenceLevel: "paraphrase",
      required: params?.required ?? false,
    });
    if (anchors.length >= limit) break;
  }
  return anchors;
}

export function validateOutputPlan(
  plan: ControlledOutputPlan,
): ControlledOutputValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (plan.policyVersion !== OUTPUT_CONTROL_POLICY_VERSION) {
    warnings.push("plan_policy_version_mismatch");
  }
  if (
    plan.constitutionVersion &&
    plan.constitutionVersion !== MAAT_CONSTITUTION_VERSION
  ) {
    warnings.push("plan_constitution_version_mismatch");
  }
  if (!cleanPhrase(plan.intent)) errors.push("missing_intent");
  if (!cleanPhrase(plan.moralFrame)) errors.push("missing_moral_frame");
  if (!cleanPhrase(plan.leadAxis)) errors.push("missing_lead_axis");
  if (!cleanPhrase(plan.leadAxisLabel)) errors.push("missing_lead_axis_label");
  if (!cleanPhrase(plan.primaryAction)) errors.push("missing_primary_action");
  if (plan.kind !== "decan_opening") {
    if (!cleanPhrase(plan.meaning?.humanLabel)) {
      errors.push("missing_human_label");
    }
    if (!cleanPhrase(plan.meaning?.userFacingEvidenceLine)) {
      errors.push("missing_user_facing_evidence_line");
    }
    if (!cleanPhrase(plan.meaning?.specificAction)) {
      errors.push("missing_specific_action");
    }
    if (cleanPhrase(plan.meaning?.caseKey)) {
      if (!cleanPhrase(plan.meaning?.userFacingDiagnosis)) {
        errors.push("missing_case_diagnosis");
      }
      if (!cleanPhrase(plan.meaning?.selectedOffering)) {
        errors.push("missing_selected_offering");
      }
      if (!cleanPhrase(plan.meaning?.whyThisOfferingWon)) {
        warnings.push("missing_offering_rationale");
      }
    }
  }
  if (plan.rhetoricalMoves.length === 0) {
    errors.push("missing_rhetorical_moves");
  }
  if (!Number.isFinite(plan.surfaceConstraints.teaserCharsMax)) {
    errors.push("missing_teaser_limit");
  }

  const ids = new Set<string>();
  for (const anchor of plan.evidenceAnchors) {
    const id = cleanPhrase(anchor.id);
    const claim = cleanPhrase(anchor.claim);
    if (!id) errors.push("evidence_anchor_missing_id");
    if (!claim) errors.push("evidence_anchor_missing_claim");
    if (id && ids.has(id)) errors.push(`duplicate_evidence_anchor:${id}`);
    ids.add(id);
    if (anchor.confidence < 0 || anchor.confidence > 1) {
      warnings.push(`evidence_anchor_confidence_out_of_range:${id}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateSurfaceVariants(
  plan: ControlledOutputPlan,
  variants: ControlledSurfaceVariants,
): ControlledOutputValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const constraints = plan.surfaceConstraints;
  if (!cleanPhrase(variants.teaserText)) errors.push("missing_teaser_text");
  if (!cleanPhrase(variants.bodyText)) errors.push("missing_body_text");
  if (variants.teaserText.length > constraints.teaserCharsMax) {
    errors.push("teaser_text_over_limit");
  }
  if (variants.pushExcerptText.length > constraints.pushExcerptCharsMax) {
    errors.push("push_excerpt_over_limit");
  }
  if (variants.archivePreviewText.length > constraints.archivePreviewCharsMax) {
    errors.push("archive_preview_over_limit");
  }
  if (
    constraints.bodyParagraphsMax &&
    paragraphCount(variants.bodyText) > constraints.bodyParagraphsMax
  ) {
    warnings.push("body_paragraph_count_over_target");
  }
  if (
    constraints.bodySentencesMax &&
    sentenceCount(variants.bodyText) > constraints.bodySentencesMax
  ) {
    warnings.push("body_sentence_count_over_target");
  }

  const allText = [
    variants.teaserText,
    variants.bodyText,
    variants.pushExcerptText,
    variants.archivePreviewText,
  ].join("\n").toLowerCase();
  for (const phrase of constraints.bannedPhrases) {
    const banned = cleanPhrase(phrase).toLowerCase();
    if (banned && allText.includes(banned)) {
      errors.push(`banned_phrase:${banned}`);
    }
  }

  if (cleanPhrase(plan.meaning?.caseKey)) {
    const body = cleanPhrase(variants.bodyText).toLowerCase();
    const diagnosis = cleanPhrase(plan.meaning?.userFacingDiagnosis)
      .toLowerCase();
    const action = cleanPhrase(plan.meaning?.specificAction).toLowerCase();
    if (diagnosis && !body.includes(diagnosis)) {
      errors.push("case_diagnosis_missing_from_body");
    }
    if (action && !body.includes(action)) {
      errors.push("case_action_missing_from_body");
    }
    if (
      /^(provision|visible work|truth|rhythm|restraint|care|speech|order|attention|study|craft)\s+(is|begins|returns|keeps|becomes|steadies|needs)\b/
        .test(body)
    ) {
      errors.push("abstract_field_aphorism_lead");
    }
  }

  for (const anchor of plan.evidenceAnchors.filter((item) => item.required)) {
    const claim = cleanPhrase(anchor.claim).toLowerCase();
    if (claim && !allText.includes(claim.toLowerCase())) {
      warnings.push(`required_anchor_not_literal:${anchor.id}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function renderControlledOutput(
  plan: ControlledOutputPlan,
): ControlledSurfaceVariants {
  const teaserText = renderTeaser(plan);
  const bodyText = renderBody(plan);
  const pushExcerptText = trimToLimit(
    teaserText,
    plan.surfaceConstraints.pushExcerptCharsMax,
  );
  const archivePreviewText = trimToLimit(
    compactText(bodyText),
    plan.surfaceConstraints.archivePreviewCharsMax,
  );
  const contextCard = renderContextCard(plan);
  return {
    teaserText,
    bodyText,
    pushExcerptText,
    archivePreviewText,
    ...(contextCard ? { contextCard } : {}),
  };
}

function renderTeaser(plan: ControlledOutputPlan): string {
  const action = stripTerminalPunctuation(plan.primaryAction);
  const openingFrame = stripTerminalPunctuation(plan.context.contextSentence) ||
    (plan.context.decanName
      ? `${plan.context.decanName} opens`
      : "This decan opens");
  const meaning = meaningLayer(plan);
  const raw = plan.kind === "decan_opening"
    ? `${openingFrame}: ${action}.`
    : plan.kind === "drift_nudge"
    ? driftTeaser(meaning)
    : sentence(`Good. ${capitalize(meaning.humanLabel)} is holding`);
  return trimToLimit(raw, plan.surfaceConstraints.teaserCharsMax);
}

function renderBody(plan: ControlledOutputPlan): string {
  switch (plan.kind) {
    case "decan_opening":
      return renderOpeningBody(plan);
    case "drift_nudge":
      return renderDriftBody(plan);
    case "strength_nudge":
      return renderStrengthBody(plan);
  }
}

function renderOpeningBody(plan: ControlledOutputPlan): string {
  const opening = plan.context.decanName
    ? `${plan.context.decanName} opens the threshold.`
    : "This decan opens the threshold.";
  return paragraphs([
    opening,
    sentence(plan.context.contextSentence) ||
    "The work is to make order visible through one concrete practice.",
    sentence(plan.context.dayLine),
    sentence(plan.context.personalSeasoning),
    `Ruling instruction: ${
      stripTerminalPunctuation(plan.primaryAction)
    }. Keep the mark small, truthful, and visible enough to carry through the day.`,
  ]);
}

function renderDriftBody(plan: ControlledOutputPlan): string {
  const meaning = meaningLayer(plan);
  if (meaning.caseKey) {
    return renderCaseDriftBody(meaning);
  }
  if (plan.context.triggerReason === "decan_day_5_insufficient_signal") {
    return paragraphs([
      "The record is still young; give it one trustworthy point.",
      "Choose one plain detail from today and write it before the day closes.",
      "That mark becomes the ground for the next guidance.",
    ]);
  }
  return paragraphs([
    driftFrame(meaning),
    actionInstruction(meaning),
  ]);
}

function renderStrengthBody(plan: ControlledOutputPlan): string {
  const meaning = meaningLayer(plan);
  if (meaning.caseKey) {
    return renderCaseStrengthBody(meaning, plan.context.personalSeasoning);
  }
  return paragraphs([
    strengthFrame(meaning),
    sentence(plan.context.personalSeasoning) ||
    "Keep the rhythm that is already carrying you.",
    strengthInstruction(meaning),
  ]);
}

function meaningLayer(plan: ControlledOutputPlan): ControlledMeaningLayer {
  const field = guidanceField(plan);
  const humanLabel = cleanPhrase(plan.meaning?.humanLabel) || field;
  const specificAction = cleanPhrase(plan.meaning?.specificAction) ||
    cleanPhrase(plan.primaryAction) ||
    "make one plain mark today";
  return {
    dominantField: plan.meaning?.dominantField ?? null,
    humanLabel,
    whyThisFieldWon: plan.meaning?.whyThisFieldWon ?? null,
    userFacingEvidenceLine: cleanPhrase(plan.meaning?.userFacingEvidenceLine) ||
      `The ${humanLabel} needs one clear mark.`,
    caseKey: plan.meaning?.caseKey ?? null,
    maatMeaning: plan.meaning?.maatMeaning ?? null,
    userTranslation: plan.meaning?.userTranslation ?? null,
    likelyUserCondition: plan.meaning?.likelyUserCondition ?? null,
    selectedOffering: plan.meaning?.selectedOffering ?? null,
    whyThisOfferingWon: plan.meaning?.whyThisOfferingWon ?? null,
    userFacingDiagnosis: plan.meaning?.userFacingDiagnosis ?? null,
    evidenceDensity: plan.meaning?.evidenceDensity ?? "low",
    confidence: plan.meaning?.confidence ?? "low",
    rhetoricalFrame: cleanPhrase(plan.meaning?.rhetoricalFrame) ||
      "small correction without shame",
    decanOrDayAnchor: plan.meaning?.decanOrDayAnchor ?? null,
    specificAction,
    bannedTerms: plan.meaning?.bannedTerms ?? [],
    baselineDeviation: plan.meaning?.baselineDeviation ?? null,
    voiceDirection: plan.meaning?.voiceDirection ?? null,
    resolutionCondition: plan.meaning?.resolutionCondition ?? null,
    exampleReference: plan.meaning?.exampleReference ?? null,
    offeringRender: plan.meaning?.offeringRender ?? null,
  };
}

function renderCaseDriftBody(meaning: ControlledMeaningLayer): string {
  const contract = meaning.offeringRender;
  const voice = contract?.voiceDirection ?? meaning.voiceDirection;
  const diagnosis = sentence(
    contract?.diagnosis || meaning.userFacingDiagnosis ||
      meaning.userFacingEvidenceLine,
  );
  const action = sentence(contract?.concreteAction || meaning.specificAction);
  const close = sentence(contract?.close) || offeringClose(meaning);
  const register = voice?.register ?? "practical";
  if (register === "witnessing") {
    return paragraphs([diagnosis, action, close]);
  }
  return paragraphs([diagnosis, action, close]);
}

function renderCaseStrengthBody(
  meaning: ControlledMeaningLayer,
  personalSeasoning: string | null | undefined,
): string {
  const contract = meaning.offeringRender;
  const diagnosis = sentence(
    contract?.diagnosis || meaning.userFacingDiagnosis ||
      meaning.userFacingEvidenceLine,
  );
  const action = sentence(contract?.concreteAction || meaning.specificAction);
  return paragraphs([
    `Good. ${diagnosis}`,
    sentence(personalSeasoning),
    action,
  ]);
}

function offeringClose(meaning: ControlledMeaningLayer): string {
  const offering = cleanPhrase(meaning.selectedOffering).toLowerCase();
  if (offering === "focus_reminder") {
    return "The record remembers the rhythm even when one period goes quiet.";
  }
  if (offering === "reduce_and_complete_one") {
    return "A shorter list you keep is more truthful than a longer list that stays open.";
  }
  if (offering === "reduce_obligations") {
    return "Reduction is the correction before more effort.";
  }
  if (offering === "consolidate_sources") {
    return "One real support mark is stronger than several open ones.";
  }
  if (offering === "merge_records") {
    return "The account gets cleaner when the row matches the real act.";
  }
  if (offering === "honor_batch") {
    return "A rhythm that works in batches should be measured as a batch.";
  }
  if (offering === "revisit_and_refit") {
    return "The list should fit the body now, not the pressure that first built it.";
  }
  if (offering === "record_what_was_done") {
    return "Let the account match the act.";
  }
  if (offering === "open_support_flow") {
    return "Use structure where direct force has become too costly.";
  }
  if (offering === "release_unrealistic_target") {
    return "Release is how the account stops carrying what is not real today.";
  }
  if (offering === "release_without_guilt") {
    return "The record will recover; the body needs what it needs first.";
  }
  if (offering === "prune") {
    return "Remove before adding; the account strengthens when it gets smaller and truer.";
  }
  if (offering === "reschedule") {
    return "Fix the window before asking for more force.";
  }
  if (offering === "restart_streak") {
    return "Momentum returns through one mark that starts the count again.";
  }
  if (offering === "triage_by_consequence") {
    return "Sort by consequence before sorting by convenience.";
  }
  if (offering === "anchor_one_thing") {
    return "One portable anchor is worth more than a full routine that cannot travel.";
  }
  if (offering === "habit_stack") {
    return "The practice needs an entry point, not another demand.";
  }
  if (offering === "refresh") {
    return "Consistency does not require monotony.";
  }
  if (offering === "stabilize_floor") {
    return "The floor matters more than the ceiling.";
  }
  if (offering === "separate_accounts") {
    return "A clear account protects everyone it is trying to serve.";
  }
  if (offering === "set_finish_condition" || offering === "finish_condition") {
    return "A clear edge lets the work close without widening the burden.";
  }
  if (offering === "write_record") {
    return "Truth gives the next guidance ground to stand on.";
  }
  if (offering === "orient") {
    return "One real mark is enough for the account to begin.";
  }
  if (offering === "inquire") {
    return "When the record is unclear, the first act is witness.";
  }
  if (offering === "witness") {
    return "Witness comes before correction.";
  }
  if (offering === "fortify") {
    return "Protect the condition that made this possible.";
  }
  if (offering === "protect_rhythm") {
    return "Protection is the right action when the pattern is already working.";
  }
  return "One kept act is enough for today.";
}

function actionInstruction(meaning: ControlledMeaningLayer): string {
  const field = cleanPhrase(meaning.dominantField).toLowerCase();
  const action = stripTerminalPunctuation(meaning.specificAction);
  if (field === "provision") {
    return "Complete one nutrition check before the day widens; choose the planned item, close the mark, and let the body re-enter order.";
  }
  if (field === "visible_work") {
    return "Choose one open task, name the finish condition, and close that single loop before widening the list.";
  }
  if (field === "truthful_record") {
    return "Write one honest detail from the day; make the record clean enough to stand on tomorrow.";
  }
  if (field === "release") {
    return "Reduce one burden to its rightful size, or release it cleanly before the day closes.";
  }
  return sentence(capitalize(action));
}

function driftTeaser(meaning: ControlledMeaningLayer): string {
  if (meaning.caseKey) {
    return sentence(
      meaning.offeringRender?.diagnosis || meaning.userFacingDiagnosis ||
        meaning.userFacingEvidenceLine,
    );
  }
  const field = cleanPhrase(meaning.dominantField).toLowerCase();
  if (field === "provision") return "Provision needs one gentle return.";
  if (field === "visible_work") return "The work needs one clean edge.";
  if (field === "truthful_record") {
    return "The record needs one trustworthy point.";
  }
  if (field === "release") {
    return "Right measure may mean releasing one burden.";
  }
  return sentence(meaning.userFacingEvidenceLine);
}

function driftFrame(meaning: ControlledMeaningLayer): string {
  const field = cleanPhrase(meaning.dominantField).toLowerCase();
  if (field === "provision") {
    return "Provision steadies the body so the day can stand.";
  }
  if (field === "visible_work") {
    return "Visible work needs one clean edge.";
  }
  if (field === "truthful_record") {
    return "Truth becomes useful through one point that can be trusted.";
  }
  if (field === "rhythm") {
    return "Rhythm returns through one repeated act kept in measure.";
  }
  if (field === "restraint") {
    return "Restraint keeps power inside right measure.";
  }
  if (field === "care") {
    return "Care stays orderly when one body-care promise is made visible and kept.";
  }
  if (field === "speech") {
    return "Speech returns to Ma'at when one word is made direct and clean.";
  }
  if (field === "order") {
    return "Order begins when one obligation receives its rightful sequence.";
  }
  if (field === "release") {
    return "Right measure restores order by setting down what has outgrown its place.";
  }
  if (field === "attention") {
    return "Attention steadies when one boundary is chosen before the day widens.";
  }
  if (field === "study") {
    return "Study becomes useful through one retained mark that can be carried forward.";
  }
  if (field === "craft") {
    return "Craft strengthens when one piece is finished before the next is opened.";
  }
  return sentence(meaning.userFacingEvidenceLine);
}

function strengthFrame(meaning: ControlledMeaningLayer): string {
  const label = cleanPhrase(meaning.humanLabel).toLowerCase();
  if (label.includes("body") || label.includes("provision")) {
    return "Good. Provision is holding.";
  }
  if (label.includes("work") || label.includes("craft")) {
    return "Good. The work has a clean shape.";
  }
  if (label.includes("record") || label.includes("truth")) {
    return "Good. The record has something trustworthy in it.";
  }
  return `Good. ${capitalize(meaning.humanLabel)} is holding.`;
}

function strengthInstruction(meaning: ControlledMeaningLayer): string {
  const field = cleanPhrase(meaning.dominantField).toLowerCase();
  if (field === "provision") {
    return "Protect that support line quietly; keep new weight off what is already working.";
  }
  if (field === "visible_work") {
    return "Protect the finish condition before widening the list.";
  }
  if (field === "truthful_record") {
    return "Keep the record clean enough to stand on tomorrow.";
  }
  return actionInstruction(meaning);
}

function axisField(plan: ControlledOutputPlan): string {
  return stripTerminalPunctuation(plan.leadAxisLabel).toLowerCase() ||
    "Ma'at";
}

function guidanceField(plan: ControlledOutputPlan): string {
  const humanLabel = cleanPhrase(plan.meaning?.humanLabel);
  if (humanLabel) return humanLabel.toLowerCase();
  const action = cleanPhrase(plan.primaryAction).toLowerCase();
  const seasoning = cleanPhrase(plan.context.personalSeasoning).toLowerCase();
  const haystack = `${action} ${seasoning}`;
  if (
    /\b(nutrition|meal|provision|food|water)\b/.test(haystack)
  ) {
    return "provision";
  }
  if (
    /\b(task|to-do|todo|visible work|finished-task|planner|list)\b/.test(
      haystack,
    )
  ) {
    return "visible work";
  }
  if (/\b(journal|truthful record|honest note|record)\b/.test(haystack)) {
    return "truthful record";
  }
  return axisField(plan);
}

function asGerundPhrase(value: string): string {
  const text = stripTerminalPunctuation(value).toLowerCase();
  if (!text) return "taking one visible step";
  if (text.startsWith("finish or resize ")) {
    return text.replace(/^finish or resize\b/, "finishing or resizing");
  }
  const replacements: Record<string, string> = {
    add: "adding",
    choose: "choosing",
    close: "closing",
    complete: "completing",
    downshift: "downshifting",
    engage: "engaging",
    enhance: "enhancing",
    finish: "finishing",
    give: "giving",
    keep: "keeping",
    name: "naming",
    protect: "protecting",
    record: "recording",
    reduce: "reducing",
    restore: "restoring",
    set: "setting",
    strengthen: "strengthening",
    tend: "tending",
    turn: "turning",
    write: "writing",
  };
  return text
    .replace(/^[a-z]+/, (verb) => replacements[verb] ?? verb)
    .replace(
      /\b(and|or) (add|choose|close|complete|downshift|engage|enhance|finish|give|keep|name|protect|record|reduce|restore|set|strengthen|tend|turn|write)\b/g,
      (_, joiner: string, verb: string) =>
        `${joiner} ${replacements[verb] ?? verb}`,
    );
}

function renderContextCard(
  plan: ControlledOutputPlan,
): ControlledContextCard | null {
  if (plan.kind !== "decan_opening") return null;
  const rows: Array<{ label: string; value: string }> = [];
  const dayLine = sentence(plan.context.dayLine);
  if (dayLine) {
    rows.push({ label: "Today", value: dayLine });
  }
  rows.push({
    label: "Journey signal",
    value:
      `This opening is tracking ${plan.leadAxisLabel.toLowerCase()} in the current pattern. Move forward through one step that can be seen, recorded, and repeated.`,
  });
  rows.push({
    label: "Next act",
    value: sentence(plan.primaryAction),
  });
  return rows.length ? { rows } : null;
}

function paragraphs(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => sentence(part))
    .filter(Boolean)
    .join("\n\n");
}

function cleanPhrase(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compactText(value: string): string {
  return cleanPhrase(value.replace(/\n+/g, " "));
}

function sentence(value: string | null | undefined): string {
  const text = cleanPhrase(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function capitalize(value: string): string {
  const text = cleanPhrase(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stripTerminalPunctuation(value: string): string {
  return cleanPhrase(value).replace(/[.!?]+$/g, "");
}

function trimToLimit(value: string, maxChars: number): string {
  const text = compactText(value);
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, Math.max(0, maxChars - 1));
  const boundary = slice.lastIndexOf(" ");
  const trimmed = (boundary > 40 ? slice.slice(0, boundary) : slice).trim();
  return sentence(stripTerminalPunctuation(trimmed));
}

function paragraphCount(value: string): number {
  return value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
    .length;
}

function sentenceCount(value: string): number {
  return (value.match(/[.!?](?:\s|$)/g) ?? []).length;
}

function wordCount(value: string): number {
  return cleanPhrase(value).split(/\s+/).filter(Boolean).length;
}

type GradeTextArgs = {
  surface: MaatOutputSurface;
  speechAct: MaatSpeechAct;
  text: string;
  teaserText?: string;
  evidenceAnchors: ControlledEvidenceAnchor[];
  primaryAction?: string | null;
  validation: ControlledOutputValidation;
  maxPrimaryActions: number;
};

function gradeTextAgainstControl(args: GradeTextArgs): ControlledOutputGrade {
  const body = cleanPhrase(args.text);
  const combined = compactText(`${args.teaserText ?? ""} ${args.text}`);
  const sentences = splitSentences(body);
  const visibleEvidenceAnchors = args.evidenceAnchors.filter((anchor) =>
    anchor.required || anchor.sourceType !== "memory" ||
    anchor.allowedInferenceLevel === "quote"
  );
  const matchedEvidenceAnchorCount =
    visibleEvidenceAnchors.filter((anchor) =>
      anchorAppears(anchor.claim, combined)
    ).length;
  const primaryActionCount = countPrimaryActions(body, args.primaryAction);
  const validationErrors = [...args.validation.errors];
  const validationWarnings = [...args.validation.warnings];

  let groundingScore: 1 | 2 | 3 | 4 | 5 = 4;
  if (visibleEvidenceAnchors.length > 0) {
    const ratio = matchedEvidenceAnchorCount / visibleEvidenceAnchors.length;
    groundingScore = ratio >= 0.67
      ? 5
      : ratio > 0
      ? 4
      : validationWarnings.includes("no_evidence_anchor_literal_match")
      ? 3
      : 2;
  }

  let specificityScore: 1 | 2 | 3 | 4 | 5 = 4;
  if (!body) {
    specificityScore = 1;
  } else if (hasGenericCliche(body) && matchedEvidenceAnchorCount === 0) {
    specificityScore = 2;
  } else if (matchedEvidenceAnchorCount > 0 || primaryActionCount > 0) {
    specificityScore = 5;
  } else if (hasGenericCliche(body)) {
    specificityScore = 3;
  }

  let maatAlignmentScore: 1 | 2 | 3 | 4 | 5 = 5;
  if (validationErrors.some((item) => item.startsWith("banned_phrase:"))) {
    maatAlignmentScore = 2;
  } else if (hasShameLanguage(body)) {
    maatAlignmentScore = 2;
  } else if (
    validationWarnings.includes("missing_maat_lens_failure") ||
    validationWarnings.includes("habit_topic_dominance_failure") ||
    validationWarnings.includes("generic_alignment_language_failure") ||
    validationWarnings.includes("lens_evidence_mismatch_failure") ||
    validationWarnings.includes("interpretive_specificity_missing") ||
    validationWarnings.includes("generic_interpretive_substitute_failure") ||
    validationWarnings.includes("reflection_moral_thesis_missing") ||
    validationWarnings.includes("reflection_false_reading_not_avoided") ||
    validationWarnings.includes("reflection_maat_question_specificity_low") ||
    validationWarnings.includes("reflection_directive_depth_low") ||
    validationWarnings.includes("reflection_habit_mechanics_unsuppressed") ||
    validationWarnings.includes("evidence_anchor_dominance_failure") ||
    validationWarnings.includes("nutrition_visible_topic_failure") ||
    validationWarnings.includes("habit_question_failure") ||
    validationWarnings.includes("missing_maat_directive_failure") ||
    validationWarnings.includes("reflection_plain_language_failure") ||
    validationWarnings.includes("reflection_account_language_failure") ||
    validationWarnings.includes("reflection_direct_address_missing") ||
    validationWarnings.includes("reflection_moral_portrait_missing") ||
    validationWarnings.includes("portrait_before_directive_failure") ||
    validationWarnings.includes("serudj_orientation_missing") ||
    validationWarnings.includes("worthiness_domain_balance_missing") ||
    validationWarnings.includes("system_need_leak_failure") ||
    validationWarnings.includes("breath_to_nose_failure") ||
    validationWarnings.includes("person_as_protagonist_failure") ||
    validationWarnings.includes("record_protagonist_failure") ||
    validationWarnings.includes("serudj_directive_fit_failure") ||
    validationWarnings.includes("portrait_directive_continuity_failure") ||
    validationWarnings.includes("rubric_leakage_failure") ||
    validationWarnings.includes("portrait_continuity_failure") ||
    validationWarnings.includes("poignancy_failure") ||
    validationWarnings.includes("abstraction_stack_failure") ||
    validationWarnings.includes("muddled_progression_failure") ||
    validationWarnings.includes("unclear_directive_failure") ||
    validationWarnings.includes("overwritten_spiritual_language_failure")
  ) {
    maatAlignmentScore = 3;
  } else if (mentionsUnsupportedCertainty(body)) {
    maatAlignmentScore = 4;
  }

  let cadenceScore: 1 | 2 | 3 | 4 | 5 = 4;
  if (!body) {
    cadenceScore = 1;
  } else if (sentences.length === 0 || sentences.length > 9) {
    cadenceScore = 2;
  } else if (hasFlatSentenceStarts(sentences)) {
    cadenceScore = 3;
  } else if (sentences.length >= 3 && sentences.length <= 7) {
    cadenceScore = 5;
  }

  const ceremonialSignals = ceremonialCadenceSignals(body, sentences);
  const ceremonialCadenceScore = scoreCeremonialCadence(
    body,
    ceremonialSignals,
  );

  const hardSurfaceWarning = validationWarnings.some((item) =>
    item.startsWith("word_count_above_target:") ||
    item.startsWith("sentence_count_above_target:") ||
    item.startsWith("evidence_detail_overused:") ||
    item === "gravity_overstated_for_routine_signal" ||
    item.startsWith("thread_count_mismatch:") ||
    item.startsWith("thread_count_overexposed:") ||
    item.startsWith("offering_fit_mismatch:") ||
    item === "reflection_calendar_arc_missing" ||
    item === "reflection_alignment_missing" ||
    item === "reflection_improvement_missing" ||
    item === "reflection_case_overdominant" ||
    item === "reflection_calendar_not_governing" ||
    item === "reflection_decan_name_missing" ||
    item === "reflection_closing_integrity_failed" ||
    item === "reflection_lesson_missing" ||
    item === "nutrition_density_overweight_failure" ||
    item === "evidence_density_topic_dominance_failure" ||
    item === "thin_evidence_overclaim_failure" ||
    item === "missing_profile_lens_failure" ||
    item === "profile_lens_missing_failure" ||
    item === "suppressed_evidence_leak_failure" ||
    item === "nutrition_as_topic_when_demoted_failure" ||
    item === "missing_maat_lens_failure" ||
    item === "habit_topic_dominance_failure" ||
    item === "generic_alignment_language_failure" ||
    item === "lens_evidence_mismatch_failure" ||
    item === "repair_direction_fit_failure" ||
    item === "interpretive_specificity_missing" ||
    item === "generic_interpretive_substitute_failure" ||
    item === "reflection_moral_thesis_missing" ||
    item === "reflection_false_reading_not_avoided" ||
    item === "reflection_maat_question_specificity_low" ||
    item === "reflection_directive_depth_low" ||
    item === "reflection_habit_mechanics_unsuppressed" ||
    item === "evidence_anchor_dominance_failure" ||
    item === "nutrition_visible_topic_failure" ||
    item === "habit_question_failure" ||
    item === "missing_maat_directive_failure" ||
    item === "reflection_plain_language_failure" ||
    item === "reflection_account_language_failure" ||
    item === "reflection_direct_address_missing" ||
    item === "reflection_moral_portrait_missing" ||
    item === "portrait_before_directive_failure" ||
    item === "serudj_orientation_missing" ||
    item === "worthiness_domain_balance_missing" ||
    item === "system_need_leak_failure" ||
    item === "breath_to_nose_failure" ||
    item === "person_as_protagonist_failure" ||
    item === "record_protagonist_failure" ||
    item === "serudj_directive_fit_failure" ||
    item === "portrait_directive_continuity_failure" ||
    item === "rubric_leakage_failure" ||
    item === "portrait_continuity_failure" ||
    item === "poignancy_failure" ||
    item === "abstraction_stack_failure" ||
    item === "muddled_progression_failure" ||
    item === "unclear_directive_failure" ||
    item === "overwritten_spiritual_language_failure"
  );
  let surfaceFitScore: 1 | 2 | 3 | 4 | 5 = 5;
  if (validationErrors.length > 0) {
    surfaceFitScore = 1;
  } else if (hardSurfaceWarning) {
    surfaceFitScore = 3;
  } else if (primaryActionCount > args.maxPrimaryActions) {
    surfaceFitScore = 3;
  } else if (validationWarnings.length > 0) {
    surfaceFitScore = 4;
  }
  let actionClarityScore = scoreActionClarity(
    body,
    args.primaryAction,
    primaryActionCount,
    args.maxPrimaryActions,
  );
  let semanticSpecificityScore = scoreSemanticSpecificity(
    body,
    args.primaryAction,
    matchedEvidenceAnchorCount,
  );
  if (args.surface === "decan_reflection") {
    const reflectionShapeClean = !validationWarnings.some((warning) =>
      warning === "reflection_calendar_arc_missing" ||
      warning === "reflection_alignment_missing" ||
      warning === "reflection_improvement_missing" ||
      warning === "reflection_case_overdominant" ||
      warning === "reflection_calendar_not_governing" ||
      warning === "reflection_decan_name_missing" ||
      warning === "reflection_closing_integrity_failed" ||
      warning === "reflection_lesson_missing" ||
      warning === "nutrition_density_overweight_failure" ||
      warning === "evidence_density_topic_dominance_failure" ||
      warning === "thin_evidence_overclaim_failure" ||
      warning === "missing_profile_lens_failure" ||
      warning === "profile_lens_missing_failure" ||
      warning === "suppressed_evidence_leak_failure" ||
      warning === "nutrition_as_topic_when_demoted_failure" ||
      warning === "missing_maat_lens_failure" ||
      warning === "habit_topic_dominance_failure" ||
      warning === "generic_alignment_language_failure" ||
      warning === "lens_evidence_mismatch_failure" ||
      warning === "repair_direction_fit_failure" ||
      warning === "interpretive_specificity_missing" ||
      warning === "generic_interpretive_substitute_failure" ||
      warning === "reflection_moral_thesis_missing" ||
      warning === "reflection_false_reading_not_avoided" ||
      warning === "reflection_maat_question_specificity_low" ||
      warning === "reflection_directive_depth_low" ||
      warning === "reflection_habit_mechanics_unsuppressed" ||
      warning === "evidence_anchor_dominance_failure" ||
      warning === "nutrition_visible_topic_failure" ||
      warning === "habit_question_failure" ||
      warning === "missing_maat_directive_failure" ||
      warning === "reflection_plain_language_failure" ||
      warning === "reflection_account_language_failure" ||
      warning === "reflection_direct_address_missing" ||
      warning === "reflection_moral_portrait_missing" ||
      warning === "portrait_before_directive_failure" ||
      warning === "serudj_orientation_missing" ||
      warning === "worthiness_domain_balance_missing" ||
      warning === "system_need_leak_failure" ||
      warning === "breath_to_nose_failure" ||
      warning === "person_as_protagonist_failure" ||
      warning === "record_protagonist_failure" ||
      warning === "serudj_directive_fit_failure" ||
      warning === "portrait_directive_continuity_failure" ||
      warning === "rubric_leakage_failure" ||
      warning === "portrait_continuity_failure" ||
      warning === "poignancy_failure" ||
      warning === "abstraction_stack_failure" ||
      warning === "muddled_progression_failure" ||
      warning === "unclear_directive_failure" ||
      warning === "overwritten_spiritual_language_failure"
    );
    if (reflectionShapeClean && /\?$/.test(body)) {
      actionClarityScore = Math.max(actionClarityScore, 5) as
        | 1
        | 2
        | 3
        | 4
        | 5;
    } else if (reflectionShapeClean) {
      actionClarityScore = Math.max(actionClarityScore, 4) as
        | 1
        | 2
        | 3
        | 4
        | 5;
    }
    if (
      reflectionShapeClean &&
      (matchedEvidenceAnchorCount > 0 ||
        !validationWarnings.includes("no_evidence_anchor_literal_match")) &&
      hasConcreteReflectionMatter(body)
    ) {
      semanticSpecificityScore = Math.max(semanticSpecificityScore, 4) as
        | 1
        | 2
        | 3
        | 4
        | 5;
    }
  }
  const evidenceDetailOverused = validationWarnings.some((item) =>
    item.startsWith("evidence_detail_overused:")
  );
  const gravityOverstated = validationWarnings.includes(
    "gravity_overstated_for_routine_signal",
  );
  let languageFreshnessScore = scoreLanguageFreshness(body);
  if (evidenceDetailOverused || gravityOverstated) {
    languageFreshnessScore = Math.min(languageFreshnessScore, 3) as
      | 1
      | 2
      | 3
      | 4
      | 5;
  }
  const guidanceWorthinessScore = computeGuidanceWorthinessScore({
    groundingScore,
    specificityScore,
    maatAlignmentScore,
    ceremonialCadenceScore,
    actionClarityScore,
    semanticSpecificityScore,
    languageFreshnessScore,
  });
  const deliveryRecommendation = recommendDeliveryChannel(
    guidanceWorthinessScore,
  );
  const reflectionScores = reflectionSpecificScores(validationWarnings);

  const failureReasons: string[] = [];
  if (groundingScore < 4) failureReasons.push("grounding_below_threshold");
  if (specificityScore < 4) failureReasons.push("specificity_below_threshold");
  if (maatAlignmentScore < 5) {
    failureReasons.push("maat_alignment_below_threshold");
  }
  if (cadenceScore < 3) failureReasons.push("cadence_below_threshold");
  if (ceremonialCadenceScore < 3) {
    failureReasons.push("ceremonial_cadence_below_threshold");
  }
  if (semanticSpecificityScore < 4) {
    failureReasons.push("semantic_specificity_below_threshold");
  }
  if (languageFreshnessScore < 4) {
    failureReasons.push("language_freshness_below_threshold");
  }
  if (surfaceFitScore < 4) failureReasons.push("surface_fit_below_threshold");
  if (primaryActionCount > args.maxPrimaryActions) {
    failureReasons.push("too_many_primary_actions");
  }
  if (guidanceWorthinessScore < 4.2) {
    failureReasons.push("worthiness_below_interrupt_threshold");
  }
  const repairMode = repairModeForFailure(failureReasons);

  return {
    graderVersion: "maat_output_grader_v1",
    constitutionVersion: MAAT_CONSTITUTION_VERSION,
    groundingScore,
    specificityScore,
    maatAlignmentScore,
    cadenceScore,
    ceremonialCadenceScore,
    actionClarityScore,
    semanticSpecificityScore,
    languageFreshnessScore,
    surfaceFitScore,
    ...reflectionScores,
    guidanceWorthinessScore,
    deliveryRecommendation,
    pass: failureReasons.length === 0,
    failureReasons,
    repairMode,
    repairInstruction: repairInstructionForFailure(
      args.surface,
      args.speechAct,
      failureReasons,
      repairMode,
    ),
    signals: {
      evidenceAnchorCount: args.evidenceAnchors.length,
      matchedEvidenceAnchorCount,
      sentenceCount: sentences.length,
      paragraphCount: paragraphCount(body),
      primaryActionCount,
      ceremonialSignals,
      validationErrors,
      validationWarnings,
    },
  };
}

function reflectionSpecificScores(
  validationWarnings: string[],
): Pick<
  ControlledOutputGrade,
  | "calendarGovernsScore"
  | "alignmentBalanceScore"
  | "caseSubordinationScore"
  | "singleAnchorScore"
  | "lessonSpecificityScore"
  | "closingIntegrityScore"
  | "exampleShapeMatchScore"
  | "profileLensGovernsScore"
  | "evidenceAnchorSubordinationScore"
  | "lensFidelityScore"
  | "maatLensGovernsScore"
  | "ethicalSpecificityScore"
  | "habitSubordinationScore"
  | "lensEvidenceFitScore"
  | "repairDirectionFitScore"
  | "interpretiveSpecificityScore"
  | "moralThesisScore"
  | "falseReadingAvoidedScore"
  | "maatQuestionSpecificityScore"
  | "directiveDepthScore"
  | "habitMechanicsSuppressedScore"
  | "evidenceAnchorDominanceScore"
  | "nutritionVisibleTopicScore"
  | "habitQuestionScore"
  | "maatDirectiveScore"
  | "moralPortraitPresentScore"
  | "portraitBeforeDirectiveScore"
  | "serudjOrientationScore"
  | "worthinessDomainBalanceScore"
  | "breathToNoseScore"
  | "personAsProtagonistScore"
  | "recordProtagonistScore"
  | "serudjDirectiveFitScore"
  | "portraitDirectiveContinuityScore"
  | "portraitContinuityScore"
  | "poignancyScore"
  | "oneIdeaAtATimeScore"
  | "readabilityScore"
> {
  const has = (warning: string) => validationWarnings.includes(warning);
  const hasPrefix = (prefix: string) =>
    validationWarnings.some((warning) => warning.startsWith(prefix));
  const calendarGovernsScore: 1 | 2 | 3 | 4 | 5 =
    has("reflection_calendar_not_governing")
      ? 1
      : has("reflection_decan_name_missing")
      ? 2
      : has("reflection_calendar_arc_missing")
      ? 2
      : 5;
  const alignmentBalanceScore: 1 | 2 | 3 | 4 | 5 =
    has("missing_profile_lens_failure") ||
      has("thin_evidence_overclaim_failure")
      ? 2
      : has("reflection_alignment_missing") &&
          has("reflection_improvement_missing")
      ? 1
      : has("reflection_alignment_missing") ||
          has("reflection_improvement_missing")
      ? 3
      : 5;
  const caseSubordinationScore: 1 | 2 | 3 | 4 | 5 =
    has("nutrition_density_overweight_failure") ||
      has("evidence_density_topic_dominance_failure") ||
      has("nutrition_as_topic_when_demoted_failure") ||
      has("reflection_case_overdominant") ||
      has("reflection_calendar_not_governing")
      ? 2
      : 5;
  const singleAnchorScore: 1 | 2 | 3 | 4 | 5 =
    hasPrefix("evidence_detail_overused:") ||
      hasPrefix("thread_count_overexposed:") ||
      has("suppressed_evidence_leak_failure")
      ? 2
      : 5;
  const lessonSpecificityScore: 1 | 2 | 3 | 4 | 5 =
    has("reflection_lesson_missing") ? 2 : 5;
  const closingIntegrityScore: 1 | 2 | 3 | 4 | 5 =
    has("reflection_closing_integrity_failed") ? 1 : 5;
  const profileLensGovernsScore: 1 | 2 | 3 | 4 | 5 =
    has("profile_lens_missing_failure") ||
      has("nutrition_as_topic_when_demoted_failure")
      ? 2
      : has("missing_profile_lens_failure")
      ? 3
      : 5;
  const evidenceAnchorSubordinationScore: 1 | 2 | 3 | 4 | 5 =
    has("suppressed_evidence_leak_failure") ||
      has("nutrition_as_topic_when_demoted_failure")
      ? 2
      : has("evidence_density_topic_dominance_failure")
      ? 3
      : 5;
  const lensFidelityScore: 1 | 2 | 3 | 4 | 5 =
    has("profile_lens_missing_failure") ||
      has("nutrition_as_topic_when_demoted_failure")
      ? 2
      : 5;
  const maatLensGovernsScore: 1 | 2 | 3 | 4 | 5 =
    has("missing_maat_lens_failure") ||
      has("generic_alignment_language_failure")
      ? 2
      : has("lens_evidence_mismatch_failure")
      ? 3
      : 5;
  const ethicalSpecificityScore: 1 | 2 | 3 | 4 | 5 =
    has("missing_maat_lens_failure") ||
      has("generic_alignment_language_failure")
      ? 2
      : 5;
  const habitSubordinationScore: 1 | 2 | 3 | 4 | 5 =
    has("habit_topic_dominance_failure") ||
      has("nutrition_as_topic_when_demoted_failure")
      ? 2
      : 5;
  const lensEvidenceFitScore: 1 | 2 | 3 | 4 | 5 =
    has("lens_evidence_mismatch_failure") ? 2 : 5;
  const repairDirectionFitScore: 1 | 2 | 3 | 4 | 5 =
    has("repair_direction_fit_failure") ? 3 : 5;
  const interpretiveSpecificityScore: 1 | 2 | 3 | 4 | 5 =
    has("generic_interpretive_substitute_failure")
      ? 2
      : has("interpretive_specificity_missing")
      ? 3
      : 5;
  const moralThesisScore: 1 | 2 | 3 | 4 | 5 = has(
      "reflection_moral_thesis_missing",
    )
    ? 2
    : 5;
  const falseReadingAvoidedScore: 1 | 2 | 3 | 4 | 5 = has(
      "reflection_false_reading_not_avoided",
    )
    ? 2
    : 5;
  const maatQuestionSpecificityScore: 1 | 2 | 3 | 4 | 5 = has(
      "reflection_maat_question_specificity_low",
    )
    ? 2
    : 5;
  const directiveDepthScore: 1 | 2 | 3 | 4 | 5 = has(
      "reflection_directive_depth_low",
    )
    ? 3
    : 5;
  const habitMechanicsSuppressedScore: 1 | 2 | 3 | 4 | 5 = has(
      "reflection_habit_mechanics_unsuppressed",
    )
    ? 2
    : 5;
  const evidenceAnchorDominanceScore: 1 | 2 | 3 | 4 | 5 = has(
      "evidence_anchor_dominance_failure",
    )
    ? 2
    : 5;
  const nutritionVisibleTopicScore: 1 | 2 | 3 | 4 | 5 = has(
      "nutrition_visible_topic_failure",
    )
    ? 2
    : 5;
  const habitQuestionScore: 1 | 2 | 3 | 4 | 5 = has("habit_question_failure")
    ? 2
    : 5;
  const maatDirectiveScore: 1 | 2 | 3 | 4 | 5 = has(
      "missing_maat_directive_failure",
    )
    ? 2
    : 5;
  const moralPortraitPresentScore: 1 | 2 | 3 | 4 | 5 = has(
      "reflection_moral_portrait_missing",
    )
    ? 2
    : 5;
  const portraitBeforeDirectiveScore: 1 | 2 | 3 | 4 | 5 = has(
      "portrait_before_directive_failure",
    )
    ? 2
    : 5;
  const serudjOrientationScore: 1 | 2 | 3 | 4 | 5 = has(
      "serudj_orientation_missing",
    )
    ? 2
    : 5;
  const worthinessDomainBalanceScore: 1 | 2 | 3 | 4 | 5 = has(
      "worthiness_domain_balance_missing",
    )
    ? 3
    : 5;
  const breathToNoseScore: 1 | 2 | 3 | 4 | 5 = has(
      "breath_to_nose_failure",
    ) || has("system_need_leak_failure")
    ? 2
    : 5;
  const personAsProtagonistScore: 1 | 2 | 3 | 4 | 5 = has(
      "person_as_protagonist_failure",
    )
    ? 2
    : 5;
  const recordProtagonistScore: 1 | 2 | 3 | 4 | 5 = has(
      "record_protagonist_failure",
    )
    ? 2
    : 5;
  const serudjDirectiveFitScore: 1 | 2 | 3 | 4 | 5 = has(
      "serudj_directive_fit_failure",
    )
    ? 2
    : 5;
  const portraitDirectiveContinuityScore: 1 | 2 | 3 | 4 | 5 = has(
      "portrait_directive_continuity_failure",
    )
    ? 2
    : 5;
  const portraitContinuityScore: 1 | 2 | 3 | 4 | 5 =
    has("rubric_leakage_failure") || has("portrait_continuity_failure") ? 2 : 5;
  const poignancyScore: 1 | 2 | 3 | 4 | 5 = has("poignancy_failure") ? 3 : 5;
  const oneIdeaAtATimeScore: 1 | 2 | 3 | 4 | 5 = has(
      "abstraction_stack_failure",
    )
    ? 2
    : has("overwritten_spiritual_language_failure")
    ? 3
    : 5;
  const readabilityScore: 1 | 2 | 3 | 4 | 5 =
    has("muddled_progression_failure") || has("unclear_directive_failure")
      ? 2
      : has("overwritten_spiritual_language_failure")
      ? 3
      : 5;
  const exampleShapeMatchScore: 1 | 2 | 3 | 4 | 5 = [
      calendarGovernsScore,
      alignmentBalanceScore,
      caseSubordinationScore,
      singleAnchorScore,
      lessonSpecificityScore,
      closingIntegrityScore,
      profileLensGovernsScore,
      evidenceAnchorSubordinationScore,
      lensFidelityScore,
      maatLensGovernsScore,
      ethicalSpecificityScore,
      habitSubordinationScore,
      lensEvidenceFitScore,
      repairDirectionFitScore,
      interpretiveSpecificityScore,
      moralThesisScore,
      falseReadingAvoidedScore,
      maatQuestionSpecificityScore,
      directiveDepthScore,
      habitMechanicsSuppressedScore,
      evidenceAnchorDominanceScore,
      nutritionVisibleTopicScore,
      habitQuestionScore,
      maatDirectiveScore,
      moralPortraitPresentScore,
      portraitBeforeDirectiveScore,
      serudjOrientationScore,
      worthinessDomainBalanceScore,
      breathToNoseScore,
      personAsProtagonistScore,
      recordProtagonistScore,
      serudjDirectiveFitScore,
      portraitDirectiveContinuityScore,
      portraitContinuityScore,
      poignancyScore,
      oneIdeaAtATimeScore,
      readabilityScore,
    ].some((score) => score < 4)
    ? 3
    : 5;
  return {
    calendarGovernsScore,
    alignmentBalanceScore,
    caseSubordinationScore,
    singleAnchorScore,
    lessonSpecificityScore,
    closingIntegrityScore,
    exampleShapeMatchScore,
    profileLensGovernsScore,
    evidenceAnchorSubordinationScore,
    lensFidelityScore,
    maatLensGovernsScore,
    ethicalSpecificityScore,
    habitSubordinationScore,
    lensEvidenceFitScore,
    repairDirectionFitScore,
    interpretiveSpecificityScore,
    moralThesisScore,
    falseReadingAvoidedScore,
    maatQuestionSpecificityScore,
    directiveDepthScore,
    habitMechanicsSuppressedScore,
    evidenceAnchorDominanceScore,
    nutritionVisibleTopicScore,
    habitQuestionScore,
    maatDirectiveScore,
    moralPortraitPresentScore,
    portraitBeforeDirectiveScore,
    serudjOrientationScore,
    worthinessDomainBalanceScore,
    breathToNoseScore,
    personAsProtagonistScore,
    recordProtagonistScore,
    serudjDirectiveFitScore,
    portraitDirectiveContinuityScore,
    portraitContinuityScore,
    poignancyScore,
    oneIdeaAtATimeScore,
    readabilityScore,
  };
}

function splitSentences(value: string): string[] {
  return cleanPhrase(value)
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function anchorAppears(claim: string, text: string): boolean {
  const cleanClaim = cleanPhrase(claim).toLowerCase();
  const cleanText = cleanPhrase(text).toLowerCase();
  if (!cleanClaim || !cleanText) return false;
  if (cleanText.includes(cleanClaim)) return true;
  const words = meaningfulWords(cleanClaim);
  if (words.length === 0) return false;
  const matches = words.filter((word) => cleanText.includes(word)).length;
  return matches >= Math.min(2, words.length);
}

function specificEvidenceTerms(
  anchors: ControlledEvidenceAnchor[],
): string[] {
  const terms = new Set<string>();
  for (const anchor of anchors) {
    const claim = cleanPhrase(anchor.claim).toLowerCase();
    if (!claim) continue;
    addMatchedTerm(terms, claim, /\bnutrition\s+(.+?)\s+was\b/i);
    addMatchedTerm(terms, claim, /\bplanner item\s+(.+?)\s+was\b/i);
    addMatchedTerm(terms, claim, /\bto-do\s+(.+?)\s+was\b/i);
    addMatchedTerm(terms, claim, /\bsource:\s*([^.;,]+)/i);
    addMatchedTerm(terms, claim, /\bpurpose:\s*([^.;]+)/i);
  }
  return [...terms].filter(isSpecificEvidenceTerm);
}

function addMatchedTerm(
  terms: Set<string>,
  claim: string,
  pattern: RegExp,
) {
  const match = claim.match(pattern);
  const term = cleanEvidenceTerm(match?.[1] ?? "");
  if (term) terms.add(term);
}

function cleanEvidenceTerm(value: string): string {
  return cleanPhrase(value)
    .toLowerCase()
    .replace(/\bon\s+\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\btags?:.*$/g, "")
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSpecificEvidenceTerm(value: string): boolean {
  const text = cleanEvidenceTerm(value);
  if (text.length < 3) return false;
  if (/^\d+$/.test(text)) return false;
  const generic = new Set([
    "nutrition",
    "planner",
    "pending",
    "source",
    "purpose",
    "support",
    "body support",
    "record",
    "journal",
    "task",
    "todo",
  ]);
  return !generic.has(text);
}

function countPhraseOccurrences(text: string, phrase: string): number {
  const normalizedPhrase = cleanEvidenceTerm(phrase);
  if (!normalizedPhrase) return 0;
  const pluralSuffix = /^[\p{L}\p{N}/-]+$/u.test(normalizedPhrase) &&
      !normalizedPhrase.endsWith("s")
    ? "s?"
    : "";
  const pattern = new RegExp(
    `\\b${
      escapeRegExp(normalizedPhrase).replace(/\s+/g, "\\s+")
    }${pluralSuffix}\\b`,
    "gi",
  );
  return text.match(pattern)?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasInflatedRoutineGravity(value: string): boolean {
  const text = cleanPhrase(value).toLowerCase();
  const routineSignal =
    /\b(nutrition|vitamin|supplement|meal|source|apple|support mark|support marks)\b/
      .test(text);
  if (!routineSignal) return false;
  return [
    "daily proof",
    "turns daily intention into daily proof",
    "serious consequence",
    "health consequence",
    "exposed",
    "crisis",
    "grave",
    "urgent",
  ].some((phrase) => text.includes(phrase));
}

function hasSingleRecurringNutritionThread(plan: ControlledGeneratedTextPlan) {
  const nutrition = plan.normalizedObligationThreads?.nutrition;
  if (!nutrition) return false;
  return nutrition.unique_item_count === 1 &&
    nutrition.same_item_repeated &&
    nutrition.pending_count + nutrition.skipped_count >= 3;
}

function confusesSingleRecurringNutritionThread(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (!hasSingleRecurringNutritionThread(plan)) return false;
  return /\b(?:several|multiple|many|three|four|five|six|seven|eight|nine|ten)\s+(?:nutrition\s+)?supports?\b/
    .test(lowerText) ||
    /\bseveral\s+support\s+marks\b/.test(lowerText) ||
    /\bseveral\s+nutrition\s+marks\b/.test(lowerText) ||
    /\btrying\s+to\s+cover\s+the\s+same\s+ground\b/.test(lowerText);
}

function recommendsConsolidationForRecurringThread(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (!hasSingleRecurringNutritionThread(plan)) return false;
  const offering = cleanPhrase(plan.selectedOffering).toLowerCase();
  return offering === "consolidate_sources" || offering === "merge_records" ||
    /\b(consolidat|merge|one source that covers|same ground)\b/.test(
      lowerText,
    );
}

function overexposesSingleRecurringNutritionCount(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (!hasSingleRecurringNutritionThread(plan)) return false;
  const occurrenceCount =
    plan.normalizedObligationThreads?.nutrition.occurrence_count ?? 0;
  if (occurrenceCount < 5) return false;
  const countWords: Record<number, string> = {
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
  };
  const countWord = countWords[occurrenceCount];
  const exactCountPattern = new RegExp(
    `\\b(?:${occurrenceCount}${
      countWord ? `|${countWord}` : ""
    })\\s+(?:open\\s+)?(?:marks?|days?|entries|occurrences)\\b`,
  );
  return exactCountPattern.test(lowerText) ||
    /\b(?:all\s+)?ten\s+days\b/.test(lowerText) ||
    /\bevery\s+day\b/.test(lowerText) ||
    /\bdaily\b/.test(lowerText);
}

function calendarArcTerms(
  frame: ReflectionCalendarFrame | null | undefined,
) {
  if (!frame) return [];
  const genericArcTerms = new Set([
    "decan",
    "month",
    "season",
    "moves",
    "through",
    "asked",
    "period",
    "record",
    "user",
    "evidence",
  ]);
  return [
    frame.monthName,
    frame.monthTransliteration,
    frame.seasonName,
    frame.decanName,
    frame.decanShortName,
    frame.decanOrdinal,
    frame.ceremonialDecanName,
    frame.decanTheme,
    ...frame.dayCards.map((card) => card.theme),
    ...meaningfulWords(frame.arcSummary)
      .filter((word) => word.length >= 6)
      .filter((word) => !genericArcTerms.has(word.toLowerCase()))
      .slice(0, 8),
  ].map((item) => cleanPhrase(item).toLowerCase()).filter(Boolean);
}

function textHasAnyTerm(lowerText: string, terms: string[]) {
  return terms.some((term) => {
    if (!term) return false;
    if (term.includes(" ")) return lowerText.includes(term);
    return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(lowerText);
  });
}

function reflectionCalendarArcMissing(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionCalendarFrame) {
    return false;
  }
  if (
    /\b(decan|month|season|calendar|day-card|day card|arc|asked|carried|theme)\b/
      .test(lowerText) && textHasAnyTerm(
        lowerText,
        calendarArcTerms(plan.reflectionCalendarFrame),
      )
  ) {
    return false;
  }
  return !textHasAnyTerm(
    lowerText,
    calendarArcTerms(plan.reflectionCalendarFrame),
  );
}

function signalTerms(signals: string[]) {
  return signals.flatMap((signal) =>
    meaningfulWords(signal).filter((word) => word.length >= 5)
  );
}

function reflectionAlignmentMissing(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const signals = plan.reflectionAlignmentMap?.alignedSignals ?? [];
  if (!signals.length) return false;
  return !(
    /\b(align|alignment|answered|held|present|visible|carried|kept|strength)\b/
      .test(lowerText) ||
    textHasAnyTerm(lowerText, signalTerms(signals))
  );
}

function reflectionImprovementMissing(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const signals = plan.reflectionAlignmentMap?.underansweredSignals ?? [];
  if (!signals.length) return false;
  return !(
    /\b(improve|improvement|underanswered|under-answer|weaken|needs?|next|charge|correct|correction|easier|reduce|attach|record|structure)\b/
      .test(lowerText) ||
    textHasAnyTerm(lowerText, signalTerms(signals))
  );
}

function reflectionCaseOverdominant(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (
    plan.kind !== "decan_reflection" || !plan.reflectionAlignmentMap ||
    !plan.caseKey
  ) {
    return false;
  }
  const caseWords = [
    ...meaningfulWords(plan.offeringRender?.diagnosis ?? ""),
    ...meaningfulWords(plan.offeringRender?.concreteAction ?? ""),
  ].filter((word) => word.length >= 6);
  const caseHits =
    caseWords.filter((word) =>
      new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(lowerText)
    ).length;
  return caseHits >= 4 && reflectionCalendarArcMissing(plan, lowerText);
}

function firstGeneratedSentence(value: string) {
  return splitSentences(value)[0] ?? cleanPhrase(value);
}

function reflectionCaseTerms(plan: ControlledGeneratedTextPlan) {
  const caseKeyTerms = cleanPhrase(plan.caseKey)
    .split(/[._\s-]+/)
    .filter((term) => term.length >= 5);
  return [
    ...specificEvidenceTerms(plan.evidenceAnchors),
    ...meaningfulWords(plan.offeringRender?.diagnosis ?? ""),
    ...meaningfulWords(plan.offeringRender?.concreteAction ?? ""),
    ...caseKeyTerms,
    "nutrition",
    "support",
    "vitamin",
    "task",
    "planner",
    "journal",
    "recording",
  ].filter((term, index, list) => term && list.indexOf(term) === index);
}

function reflectionCalendarNotGoverning(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionCalendarFrame) {
    return false;
  }
  const first = firstGeneratedSentence(text).toLowerCase();
  if (!first) return false;
  const hasCalendar =
    /\b(hathor|djehuty|thoth|akhet|peret|shemu|calendar|arc|asked|asks|call|called|season's|month's|decan's)\b/
      .test(first) ||
    textHasAnyTerm(first, calendarArcTerms(plan.reflectionCalendarFrame));
  if (hasCalendar) return false;
  return textHasAnyTerm(first, reflectionCaseTerms(plan));
}

function normalizeCalendarName(value: string | null | undefined) {
  return cleanPhrase(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[ꜣꜥȝ]/g, "a")
    .replace(/[ḥḫẖ]/g, "h")
    .replace(/[ḏḍ]/g, "d")
    .replace(/[š]/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reflectionDecanNameMissing(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  const frame = plan.reflectionCalendarFrame;
  if (plan.kind !== "decan_reflection" || !frame?.ceremonialDecanName) {
    return false;
  }
  const first = normalizeCalendarName(firstGeneratedSentence(text));
  if (!first) return false;
  const ceremonial = normalizeCalendarName(frame.ceremonialDecanName);
  if (ceremonial && first.includes(ceremonial)) return false;
  const month = normalizeCalendarName(frame.monthName);
  const ordinal = normalizeCalendarName(frame.decanOrdinal);
  const short = normalizeCalendarName(frame.decanShortName);
  const hasMonth = month ? first.includes(month) : true;
  const hasOrdinal = ordinal ? first.includes(ordinal) : true;
  const hasShort = short ? first.includes(short) : true;
  return !(hasMonth && hasOrdinal && hasShort);
}

function reflectionClosingIntegrityFailed(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionArcPlan) {
    return false;
  }
  const sentences = splitSentences(text);
  if (!sentences.length) return false;
  const questionCount = (text.match(/\?/g) ?? []).length;
  const last = sentences.at(-1) ?? "";
  if (plan.reflectionArcPlan.closingKind === "question") {
    return !last.includes("?") || questionCount !== 1;
  }
  if (plan.reflectionArcPlan.closingKind === "charge") {
    return questionCount > 0 || last.includes("?");
  }
  return false;
}

function reflectionLessonMissing(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionArcPlan) {
    return false;
  }
  return !(
    /\b(ma'at|maat|lesson|asks?|requires?|means?|becomes?|measure|order|account|season|decan)\b/
      .test(lowerText) &&
    textHasAnyTerm(
      lowerText,
      meaningfulWords(plan.reflectionArcPlan.maatLesson).filter((word) =>
        word.length >= 5
      ),
    )
  );
}

function reflectionEvidenceDensity(
  plan: ControlledGeneratedTextPlan,
) {
  return plan.reflectionArcPlan?.evidenceDensity ??
    plan.reflectionAlignmentMap?.evidenceDensity ?? null;
}

function thinReflectionEvidence(
  plan: ControlledGeneratedTextPlan,
) {
  return reflectionEvidenceDensity(plan) === "thin";
}

function nutritionTopicMentions(lowerText: string) {
  return [
    "nutrition",
    "body support",
    "body-support",
    "support thread",
    "vitamin",
    "supplement",
    "apple",
    "strong bones",
    "meal",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lowerText, term), 0);
}

function nutritionDensityOverweightFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (
    plan.kind !== "decan_reflection" || !thinReflectionEvidence(plan) ||
    !hasSingleRecurringNutritionThread(plan)
  ) {
    return false;
  }
  return nutritionTopicMentions(lowerText) > 3;
}

function profileLensTerms(plan: ControlledGeneratedTextPlan) {
  const phrases = plan.reflectionArcPlan?.profileContextPhrases ?? [];
  const factRefs = plan.reflectionArcPlan?.profileContextRefs ?? [];
  return [
    ...phrases.flatMap((phrase) =>
      meaningfulWords(phrase).filter((word) =>
        word.length >= 6 &&
        ![
          "reflection",
          "should",
          "rather",
          "through",
          "current",
          "decan",
          "record",
          "account",
          "evidence",
        ].includes(word.toLowerCase())
      )
    ),
    ...factRefs.flatMap((ref) => ref.value.split(/[_\s-]+/)).filter((word) =>
      word.length >= 5
    ),
  ].map((term) => cleanPhrase(term).toLowerCase()).filter(Boolean);
}

function textHasProfileLens(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const terms = profileLensTerms(plan);
  if (!terms.length) return true;
  return textHasAnyTerm(lowerText, terms) ||
    /\b(batch|cluster|surface|detail|scope|interruption|creative|technical|caretak|transition|load|flow|irregular|re-enter|continuity)\b/
      .test(lowerText);
}

function evidenceDensityTopicDominanceFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !thinReflectionEvidence(plan)) {
    return false;
  }
  const firstTwo = splitSentences(text).slice(0, 2).join(" ").toLowerCase();
  if (!firstTwo) return false;
  const calendarPresent = !reflectionCalendarArcMissing(plan, firstTwo);
  const profilePresent = textHasProfileLens(plan, firstTwo);
  return nutritionTopicMentions(firstTwo) >= 2 &&
    !(calendarPresent && profilePresent);
}

function thinEvidenceOverclaimFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (plan.kind !== "decan_reflection" || !thinReflectionEvidence(plan)) {
    return false;
  }
  return /\b(the\s+record\s+shows|the\s+record\s+proves|proof|proved|clear\s+thread|strongest\s+signal|across\s+all|everywhere|never\s+found|all\s+ten\s+days)\b/
    .test(lowerText);
}

function missingProfileLensFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (
    plan.kind !== "decan_reflection" ||
    !plan.reflectionArcPlan?.profileLensRequired
  ) {
    return false;
  }
  return !textHasProfileLens(plan, lowerText);
}

function lensExpectedTerms(plan: ControlledGeneratedTextPlan) {
  const lens = plan.reflectionProfileSnapshot?.dominantUserLens;
  const termsByLens: Record<string, string[]> = {
    record_thinning: [
      "record",
      "written",
      "witness",
      "detail",
      "account",
      "mark",
    ],
    routine_anchor_missing: [
      "anchor",
      "entry point",
      "rhythm",
      "return",
      "routine",
      "moment",
    ],
    body_support_recording_gap: [
      "body care",
      "promise",
      "record",
      "mark",
      "body support",
    ],
    overcommitment: ["open", "load", "fewer", "release", "scope", "account"],
    care_outward_self_thin: ["care", "outward", "own", "keeper", "belongs"],
    creative_unclosed_work: ["creative", "work", "close", "witness", "piece"],
    technical_sequence_block: [
      "sequence",
      "prerequisite",
      "build",
      "finish",
      "block",
    ],
    study_without_retention: ["study", "knowledge", "retain", "usable"],
    low_signal_orientation: ["record", "thin", "mark", "question", "orient"],
    practice_recovery: ["return", "recover", "structure", "protect", "rhythm"],
  };
  return lens ? termsByLens[lens] ?? [] : [];
}

function profileLensMissingFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  const terms = [
    ...lensExpectedTerms(plan),
    ...meaningfulWords(snapshot.lensReason).filter((word) => word.length >= 6),
  ].map((term) => term.toLowerCase());
  if (!terms.length) return false;
  return !textHasAnyTerm(lowerText, [...new Set(terms)]);
}

function suppressedRawTerms(plan: ControlledGeneratedTextPlan) {
  return (plan.reflectionProfileSnapshot?.suppressedEvidenceAnchors ?? [])
    .flatMap((anchor) =>
      anchor.rawTerms.map((term) => cleanEvidenceTerm(term)).filter((term) =>
        term.length >= 4 &&
        !["body support", "nutrition", "support"].includes(term)
      )
    );
}

function suppressedEvidenceLeakFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  const terms = suppressedRawTerms(plan);
  if (!terms.length) return false;
  const lowerText = text.toLowerCase();
  const first = firstGeneratedSentence(text).toLowerCase();
  return terms.some((term) =>
    countPhraseOccurrences(lowerText, term) > 1 ||
    countPhraseOccurrences(first, term) > 0
  );
}

function nutritionAsTopicWhenDemotedFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  const nutritionSuppressed = snapshot.suppressedEvidenceAnchors.some((
    anchor,
  ) => anchor.domain === "nutrition");
  if (!nutritionSuppressed) return false;
  const firstTwo = splitSentences(text).slice(0, 2).join(" ").toLowerCase();
  if (!firstTwo) return false;
  return nutritionTopicMentions(firstTwo) >= 2 ||
    /\b(vitamin|supplement|nutrition|body[- ]support)\b/.test(
      firstGeneratedSentence(text).toLowerCase(),
    );
}

function maatLensTerms(plan: ControlledGeneratedTextPlan) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (!snapshot) return [];
  return [
    snapshot.dominantMaatLens,
    snapshot.secondaryMaatLens ?? "",
    snapshot.ethicalQuestion,
    snapshot.alignmentReading,
    snapshot.underalignmentReading,
    snapshot.repairDirection,
  ].flatMap((item) =>
    meaningfulWords(item).filter((word) =>
      word.length >= 5 &&
      ![
        "about",
        "account",
        "actually",
        "become",
        "being",
        "carry",
        "decan",
        "evidence",
        "habit",
        "practice",
        "support",
        "thread",
        "where",
        "which",
        "without",
      ].includes(word.toLowerCase())
    )
  ).map((term) => cleanPhrase(term).toLowerCase()).filter(Boolean);
}

function maatLensMissingFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  const terms = maatLensTerms(plan);
  if (!terms.length) return true;
  return !textHasAnyTerm(lowerText, [...new Set(terms)]);
}

function firstTwoSentencesLower(text: string) {
  return splitSentences(text).slice(0, 2).join(" ").toLowerCase();
}

function habitMechanicMentions(lowerText: string) {
  return [
    "habit",
    "tracking",
    "track",
    "logging",
    "log",
    "recording rhythm",
    "check",
    "check off",
    "complete",
    "task",
    "routine",
    "planner",
    "nutrition",
    "vitamin",
    "supplement",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lowerText, term), 0);
}

function habitTopicDominanceFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  const firstTwo = firstTwoSentencesLower(text);
  if (!firstTwo) return false;
  const lensTerms = maatLensTerms(plan);
  const maatPresent = textHasAnyTerm(firstTwo, [...new Set(lensTerms)]) ||
    /\btruth|witness|measure|proportion|order|rightful|life[- ]preserv|care|reciprocity|justice|restraint|self[- ]mastery|worthiness|becoming|continuity|repair|ma'at\b/
      .test(firstTwo);
  return habitMechanicMentions(firstTwo) >= 3 && !maatPresent;
}

function genericAlignmentLanguageFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  const saysAlignment = /\balign(?:ed|ment)?\b/.test(lowerText);
  if (!saysAlignment) return false;
  const concreteTerms = [
    snapshot.dominantMaatLens,
    snapshot.secondaryMaatLens ?? "",
    snapshot.ethicalQuestion,
  ].flatMap(meaningfulWords).filter((word) => word.length >= 5);
  return !textHasAnyTerm(lowerText, concreteTerms);
}

function lensEvidenceMismatchFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  if (!habitTopicDominanceFailure(plan, lowerText)) return false;
  return maatLensMissingFailure(plan, lowerText);
}

function repairDirectionFitFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const snapshot = plan.reflectionProfileSnapshot;
  if (plan.kind !== "decan_reflection" || !snapshot) return false;
  const repairTerms = meaningfulWords(snapshot.repairDirection).filter((word) =>
    word.length >= 5 &&
    !["account", "practice", "support", "without"].includes(
      word.toLowerCase(),
    )
  );
  if (!repairTerms.length) return false;
  return !textHasAnyTerm(lowerText, repairTerms);
}

function interpretiveSpecificityMissingFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const bridge = plan.reflectionProfileSnapshot?.interpretiveSpecificity;
  if (plan.kind !== "decan_reflection" || !bridge) return false;
  const required = bridge.requiredConcepts.flatMap(meaningfulWords).filter((
    word,
  ) =>
    word.length >= 5 &&
    !["measure", "account", "support", "thread"].includes(word.toLowerCase())
  );
  const derived = [
    bridge.specificIntent,
    bridge.derivedReading,
    bridge.maatTranslation,
  ].flatMap(meaningfulWords).filter((word) =>
    word.length >= 6 &&
    ![
      "account",
      "because",
      "concern",
      "without",
      "pattern",
      "support",
      "thread",
    ].includes(word.toLowerCase())
  );
  const matchedRequired =
    [...new Set(required)].filter((term) =>
      lowerText.includes(term.toLowerCase())
    ).length;
  const matchedDerived =
    [...new Set(derived)].filter((term) =>
      lowerText.includes(term.toLowerCase())
    ).length;
  return matchedRequired < 1 || matchedDerived < 1;
}

function genericInterpretiveSubstituteFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const bridge = plan.reflectionProfileSnapshot?.interpretiveSpecificity;
  if (plan.kind !== "decan_reflection" || !bridge) return false;
  return bridge.avoidGenericSubstitutes.some((term) => {
    const cleanTerm = cleanPhrase(term).toLowerCase();
    return cleanTerm.length > 0 && lowerText.includes(cleanTerm);
  });
}

function judgmentTerms(value: string): string[] {
  return meaningfulWords(value).filter((word) =>
    word.length >= 5 &&
    ![
      "about",
      "account",
      "another",
      "asking",
      "become",
      "being",
      "care",
      "decan",
      "evidence",
      "habit",
      "intention",
      "ma'at",
      "maat",
      "question",
      "support",
      "thread",
      "where",
      "which",
      "without",
    ].includes(word.toLowerCase())
  );
}

function matchedTermCount(lowerText: string, terms: string[]) {
  return [...new Set(terms)].filter((term) =>
    lowerText.includes(term.toLowerCase())
  ).length;
}

function reflectionMoralThesisMissingFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const judgment = plan.reflectionJudgment;
  if (plan.kind !== "decan_reflection" || !judgment) return false;
  const thesisTerms = judgmentTerms(judgment.reflectionThesis);
  const readingTerms = judgmentTerms(judgment.centralMoralReading);
  const matches = matchedTermCount(lowerText, [
    ...thesisTerms,
    ...readingTerms,
    judgment.selectedMaatLens.replaceAll("_", " "),
  ]);
  return matches < 2;
}

function falseReadingTopicTerms(value: string) {
  const lower = value.toLowerCase();
  const terms: string[] = [];
  if (/\bnutrition|vitamin|supplement|body[- ]support\b/.test(lower)) {
    terms.push("nutrition", "vitamin", "supplement", "body support");
  }
  if (/\blog|logging|recording|tracking|track|check\b/.test(lower)) {
    terms.push("logging", "recording rhythm", "tracking", "track", "check");
  }
  if (/\bproductivity|task|todo|to-do|completion\b/.test(lower)) {
    terms.push("productivity", "task", "todo", "completion");
  }
  return terms;
}

function reflectionFalseReadingNotAvoidedFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  const judgment = plan.reflectionJudgment;
  if (plan.kind !== "decan_reflection" || !judgment) return false;
  const firstTwo = firstTwoSentencesLower(text);
  const terms = falseReadingTopicTerms(judgment.falseReadingToAvoid);
  if (!terms.length) return false;
  const termCount = terms.reduce(
    (sum, term) => sum + countPhraseOccurrences(firstTwo, term),
    0,
  );
  const thesisPresent = !reflectionMoralThesisMissingFailure(
    plan,
    text.toLowerCase(),
  );
  return termCount >= 2 && !thesisPresent;
}

function reflectionMaatQuestionSpecificityFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const judgment = plan.reflectionJudgment;
  if (plan.kind !== "decan_reflection" || !judgment) return false;
  const questionTerms = judgmentTerms(judgment.primaryMaatQuestion);
  const lensTerm = judgment.selectedMaatLens.replaceAll("_", " ");
  return matchedTermCount(lowerText, [...questionTerms, lensTerm]) < 1;
}

function reflectionDirectiveDepthFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const judgment = plan.reflectionJudgment;
  if (plan.kind !== "decan_reflection" || !judgment) return false;
  const directiveTerms = judgmentTerms(judgment.deeperDirective);
  if (!directiveTerms.length) return false;
  const shallowMechanics =
    /\b(log|logging|tracking|track|recording rhythm|check off|complete the check|habit)\b/
      .test(lowerText);
  const hasDirective = matchedTermCount(lowerText, directiveTerms) >= 1 ||
    /\btruthful|measure|rightful|keepable|release|order|witness|repair\b/.test(
      lowerText,
    );
  return shallowMechanics && !hasDirective;
}

function reflectionHabitMechanicsUnsuppressedFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  const judgment = plan.reflectionJudgment;
  if (plan.kind !== "decan_reflection" || !judgment) return false;
  const lower = text.toLowerCase();
  const falseReading = judgment.falseReadingToAvoid.toLowerCase();
  if (
    !/\bhabit|logging|nutrition|productivity|tracking|check\b/.test(
      falseReading,
    )
  ) {
    return false;
  }
  const mechanics = habitMechanicMentions(firstTwoSentencesLower(text));
  const thesisPresent = !reflectionMoralThesisMissingFailure(plan, lower);
  return mechanics >= 3 && !thesisPresent;
}

function visibleEvidenceRequired(plan: ControlledGeneratedTextPlan) {
  const visibility = plan.reflectionThesisGate?.evidenceVisibility;
  return visibility !== "background_support" &&
    visibility !== "diagnostics_only";
}

function thesisGateHidesEvidence(plan: ControlledGeneratedTextPlan) {
  return plan.kind === "decan_reflection" && !visibleEvidenceRequired(plan);
}

function thesisGateForbiddenTerms(plan: ControlledGeneratedTextPlan) {
  return (plan.reflectionThesisGate?.forbiddenSurfaceFocus ?? [])
    .map((term) => cleanEvidenceTerm(term))
    .filter((term) => term.length >= 4);
}

function evidenceAnchorDominanceFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (!thesisGateHidesEvidence(plan)) return false;
  const terms = thesisGateForbiddenTerms(plan);
  if (!terms.length) return false;
  const lower = text.toLowerCase();
  const firstTwo = firstTwoSentencesLower(text);
  const totalMentions = terms.reduce(
    (sum, term) => sum + countPhraseOccurrences(lower, term),
    0,
  );
  const earlyMentions = terms.reduce(
    (sum, term) => sum + countPhraseOccurrences(firstTwo, term),
    0,
  );
  return earlyMentions >= 1 || totalMentions >= 2;
}

function nutritionVisibleTopicFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (!thesisGateHidesEvidence(plan)) return false;
  const first = firstGeneratedSentence(text).toLowerCase();
  const firstTwo = firstTwoSentencesLower(text);
  const forbidden =
    /\b(vitamin|supplement|nutrition|body[- ]care promise|body[- ]support thread|confirmed mark|confirmed place|support thread)\b/;
  return forbidden.test(first) ||
    nutritionTopicMentions(firstTwo) >= 2 ||
    thesisGateForbiddenTerms(plan).some((term) =>
      countPhraseOccurrences(firstTwo, term) > 0
    );
}

function finalQuestion(text: string) {
  return splitSentences(text).filter((sentence) => sentence.includes("?")).at(
    -1,
  ) ?? "";
}

function habitQuestionFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  const question = finalQuestion(text).toLowerCase();
  if (!question) return false;
  const habitMechanics =
    /\b(log|logging|track|tracking|recording rhythm|check|check off|record this|record it|mark this|mark it|where .*record|where .*log|where .*check)\b/
      .test(question);
  const maatDirective =
    /\bma'at|maat|measure|truth|truthful|witness|keepable|care|rightful|rightly|order|release|repair|proportion|worthy|worthiness\b/
      .test(question);
  return habitMechanics && !maatDirective;
}

function missingMaatDirectiveFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const gate = plan.reflectionThesisGate;
  if (plan.kind !== "decan_reflection" || !gate) return false;
  const directiveTerms = judgmentTerms(gate.maatDirective);
  const directivePresent = matchedTermCount(lowerText, directiveTerms) >= 1 ||
    /\btruthful|measure|rightful|keepable|release|order|witness|repair|proportion\b/
      .test(lowerText);
  return !directivePresent;
}

function codedReflectionLanguageHits(value: string): string[] {
  const text = cleanPhrase(value).toLowerCase();
  const patterns: Array<[string, RegExp]> = [
    ["written witness", /\bwritten witness\b/],
    ["witnessed action", /\bwitnessed action\b/],
    ["witnessed later", /\bwitnessed later\b/],
    ["act and account", /\bact and (?:the )?account\b/],
    ["life accomplished", /\blife accomplished\b/],
    ["life may already know", /\blife may already know\b/],
    [
      "account cannot prove",
      /\baccount (?:cannot|can't|can not) (?:yet )?prove\b/,
    ],
    ["dependent on inference", /\bdependent on inference\b/],
    ["embodied order", /\bembodied order\b/],
    ["made visible", /\bmade visible\b/],
    ["confirmed and witnessed", /\bconfirmed and witnessed\b/],
    ["inhabitable order", /\binhabitable order\b/],
    ["truth forward", /\btruth forward\b/],
    ["lived account", /\blived account\b/],
    ["account language", /\baccount\b/],
    ["underalignment", /\bunderalignment\b/],
    ["alignment shows", /\balignment shows\b/],
    ["alignment is visible", /\balignment is visible\b/],
    ["measure was made visible", /\bmeasure was made visible\b/],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

function reflectionPlainLanguageFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  const hits = codedReflectionLanguageHits(text);
  if (hits.length >= 2) return true;
  const lower = cleanPhrase(text).toLowerCase();
  const abstractTermCount = [
    "account",
    "witness",
    "witnessed",
    "witnessing",
    "measure",
    "alignment",
    "underalignment",
    "embodied",
    "inference",
    "confirmed",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lower, term), 0);
  const plainTranslationPresent =
    /\b(right size|right-sized|clear place|honest record|plain record|something to stand on|easy to keep|follow through|follow-through|what happened|what was done|steady care|care you can keep|truthful form|name what moved)\b/
      .test(lower);
  return abstractTermCount >= 7 && !plainTranslationPresent;
}

function reflectionAccountLanguageFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  return /\baccount\b/i.test(text);
}

function reflectionDirectAddressMissing(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  return !/\b(you|your|you're|you've|you'll|yourself)\b/i.test(text);
}

function reflectionMoralPortraitMissing(plan: ControlledGeneratedTextPlan) {
  if (plan.kind !== "decan_reflection") return false;
  return Boolean(
    (plan.reflectionJudgment || plan.reflectionThesisGate) &&
      !plan.reflectionMoralPortrait,
  );
}

function portraitStatementTerms(plan: ControlledGeneratedTextPlan) {
  const portrait = plan.reflectionMoralPortrait;
  if (!portrait) return [];
  return [
    portrait.portraitStatement,
    portrait.heartSignal,
    portrait.serudjCall,
    portrait.geruMaaOrientation,
  ].flatMap((value) =>
    meaningfulWords(value).filter((word) =>
      word.length >= 6 &&
      ![
        "account",
        "asking",
        "become",
        "decan",
        "evidence",
        "record",
        "reflection",
        "support",
        "through",
      ].includes(word.toLowerCase())
    )
  );
}

function portraitBeforeDirectiveFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  const firstTwo = firstTwoSentencesLower(text);
  if (!firstTwo) return false;
  const terms = portraitStatementTerms(plan);
  const portraitPresent = matchedTermCount(firstTwo, terms) >= 1 ||
    /\b(you (?:are|have been|build|move|carry|return|seek)|your (?:heart|work|care|life|practice)|what moved|becoming|restore|restoration|whole)\b/
      .test(firstTwo);
  if (!portraitPresent) return true;
  const first = firstGeneratedSentence(text).toLowerCase();
  return /\b(make|write|record|mark|choose|complete|fix|log|track)\b/.test(
    first,
  ) && !/\b(you|your|heart|becoming|restore|care|truth|ma'at|maat)\b/.test(
    first,
  );
}

function serudjOrientationMissing(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  return !/\b(restore|restoration|repair|raise|raised|return|replenish|make whole|whole|set right|made better|name what moved|bring .* form|become .* form|truthful form)\b/
    .test(lowerText);
}

function worthinessDomainBalanceMissing(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  const sacred =
    /\b(heart|inner|sacred|truth|ma'at|maat|becoming|orientation|pressure|spirit|divine)\b/
      .test(lowerText);
  const relational =
    /\b(others|family|care|service|promise|obligation|community|work|creative|give|given|relationship)\b/
      .test(lowerText);
  const natural =
    /\b(body|food|water|rhythm|season|earth|life|created|day|time|place)\b/
      .test(lowerText);
  return [sacred, relational, natural].filter(Boolean).length < 2;
}

function systemNeedLeakFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  return [
    /\bnext reflection\b/,
    /\bless guesswork\b/,
    /\benough detail\b/,
    /\brecord (?:cannot|can't|can not) show\b/,
    /\bwhat may already have occurred\b/,
    /\btruth asks for enough detail\b/,
    /\bimprovement direction\b/,
    /\bnext guidance\b/,
    /\bwrite for the next reflection\b/,
  ].some((pattern) => pattern.test(lowerText));
}

function breathToNoseFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  if (systemNeedLeakFailure(plan, lowerText)) return true;
  const burdenCount = [
    "must",
    "should",
    "need to",
    "have to",
    "required",
    "prove",
    "perform",
    "compliance",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lowerText, term), 0);
  const agencyPresent =
    /\b(can|could|willing|choose|restore|name|carry|become|truth|whole|free|life|breath|make .* keepable)\b/
      .test(lowerText);
  return burdenCount >= 2 && !agencyPresent;
}

function recordMaintenanceTerms(lowerText: string) {
  return [
    "record",
    "records",
    "account",
    "accounts",
    "mark",
    "marks",
    "evidence",
    "complete",
    "completion",
    "log",
    "logging",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lowerText, term), 0);
}

function personRestorationTerms(lowerText: string) {
  return [
    "you",
    "your",
    "yourself",
    "heart",
    "care",
    "inward",
    "outward",
    "restore",
    "restoration",
    "proportion",
    "self-return",
    "whole",
    "becoming",
    "what you give",
    "what you keep",
    "truth",
    "pressure",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lowerText, term), 0);
}

function personAsProtagonistFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  const firstTwo = firstTwoSentencesLower(text);
  if (!firstTwo) return false;
  const personScore = personRestorationTerms(firstTwo);
  const recordScore = recordMaintenanceTerms(firstTwo);
  const personLanguage =
    /\b(you|your|yourself|heart|care|life|work|becoming|tend|give|keep|return inward|restore)\b/
      .test(firstTwo);
  return !personLanguage || recordScore > personScore;
}

function recordProtagonistFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  const lower = text.toLowerCase();
  if (
    /\b(record tells the truth|record can match|mark of care|complete today so your record|written record drift(?:ed|s)? apart|acts? and (?:your )?written record drift|mark one act|one clear mark|clear mark|confirmed mark|remains unmarked|still unmarked)\b/
      .test(lower)
  ) {
    return true;
  }
  const recordCount = countPhraseOccurrences(lower, "record");
  const markCount = countPhraseOccurrences(lower, "mark");
  const accountCount = countPhraseOccurrences(lower, "account");
  if (accountCount > 0) return true;
  if (recordCount + markCount > 1) return true;
  const question = finalQuestion(text).toLowerCase();
  return /\b(record|mark|log|complete|check)\b/.test(question) &&
    !/\b(yourself|inward|outward|restore|proportion|care|heart|what you give|what you keep|whole)\b/
      .test(question);
}

function serudjDirectiveFitFailure(
  plan: ControlledGeneratedTextPlan,
  lowerText: string,
) {
  const directive = cleanPhrase(plan.reflectionMoralPortrait?.serudjDirective);
  if (plan.kind !== "decan_reflection" || !directive) return false;
  const directiveTerms = meaningfulWords(directive).filter((word) =>
    word.length >= 6 &&
    ![
      "account",
      "asking",
      "evidence",
      "record",
      "reflection",
      "serudj",
    ].includes(word.toLowerCase())
  );
  return matchedTermCount(lowerText, directiveTerms) < 1 &&
    !/\b(restore|restoration|proportion|inward|outward|self-return|whole|truthful form|right size|care you can keep)\b/
      .test(lowerText);
}

function portraitDirectiveContinuityFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  const portrait = plan.reflectionMoralPortrait;
  if (plan.kind !== "decan_reflection" || !portrait) return false;
  const last = splitSentences(text).at(-1)?.toLowerCase() ?? "";
  if (!last) return false;
  if (recordProtagonistFailure(plan, last)) return true;
  const continuityTerms = [
    ...meaningfulWords(portrait.personBecomingStatement),
    ...meaningfulWords(portrait.serudjDirective),
  ].filter((word) =>
    word.length >= 6 &&
    ![
      "account",
      "evidence",
      "record",
      "reflection",
      "serudj",
    ].includes(word.toLowerCase())
  );
  return matchedTermCount(last, continuityTerms) < 1 &&
    !/\b(restore|proportion|inward|outward|care|heart|whole|truth|pressure|becoming|what you give|what you keep)\b/
      .test(last);
}

function rubricLeakageFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  const lower = cleanPhrase(text).toLowerCase();
  return [
    /\bwhere you answered\b/,
    /\bwhere you aligned\b/,
    /\bwhere alignment\b/,
    /\bwhere restoration is still needed\b/,
    /\bwhere restoration is needed\b/,
    /\bthe alignment is\b/,
    /\balignment is visible\b/,
    /\bthe underalignment is\b/,
    /\bthe improvement direction is\b/,
    /\baligned signal\b/,
    /\bunderanswered signal\b/,
    /\brestoration direction\b/,
    /\bone alignment signal\b/,
    /\bone restoration direction\b/,
  ].some((pattern) => pattern.test(lower));
}

function portraitContinuityFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  if (rubricLeakageFailure(plan, text)) return true;
  const sentences = splitSentences(text);
  const labelLikeSentences =
    sentences.filter((sentence) =>
      /^(where|alignment|restoration|gap|improvement|directive|evidence)\b/i
        .test(sentence.trim())
    ).length;
  if (labelLikeSentences > 0) return true;
  const firstTwo = firstTwoSentencesLower(text);
  const fusesCalendarAndPerson =
    /\b(decan|hathor|sꜣḥ|s3h|season)\b/.test(firstTwo) &&
    /\b(you|your|yourself|heart|care|work|becoming|tend|restore|return)\b/
      .test(firstTwo);
  return !fusesCalendarAndPerson &&
    !/\b(you are someone|you already know|your heart|your care|you tend)\b/
      .test(firstTwo);
}

function poignancyFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  const question = finalQuestion(text).toLowerCase();
  if (!question) return false;
  if (/\bwhat would it look like\b/.test(question)) return true;
  if (
    /\b(record|mark|log|complete|check|evidence)\b/.test(question) &&
    !/\b(restore|restoration|meaning|mean|whole|tend|yourself|inward|outward|return|willing|care)\b/
      .test(question)
  ) {
    return true;
  }
  const weightBearing =
    /\b(what would it mean|what would restore|what are you willing|what must be made whole|what would return|what act of care|what care|what in you|what would it take)\b/
      .test(question) ||
    /\b(restore|restoration|whole|willing|meaning|mean|tend yourself|return inward|same presence|those you love)\b/
      .test(question);
  return !weightBearing;
}

const reflectionAbstractTerms = [
  "sacred",
  "weight",
  "integration",
  "trustworthy",
  "witness",
  "witnessing",
  "outer",
  "inner",
  "knowing",
  "order",
  "embodied",
  "alignment",
  "underalignment",
  "measure",
  "truth",
  "becoming",
  "continuity",
  "restoration",
  "sanctuary",
  "discipline",
  "completion",
  "intention",
  "proportion",
];

const stackedAbstractPhrases = [
  /\bsacred weight\b/,
  /\btrustworthy witness\b/,
  /\bouter action\b/,
  /\bintegration into (?:the )?order\b/,
  /\bconfirmed place\b/,
  /\bembodied order\b/,
  /\bwritten witness\b/,
  /\bact and account\b/,
  /\blife accomplished\b/,
  /\bmeasure was made visible\b/,
  /\bhonest witness\b/,
  /\bsimple, honest witness\b/,
  /\bconfirmed mark\b/,
  /\bclear mark\b/,
  /\bone clear mark\b/,
  /\bstill unmarked\b/,
  /\bremains unmarked\b/,
  /\brestore the house\b/,
  /\brestore the sanctuary\b/,
];

function abstractionStackFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  const lower = cleanPhrase(text).toLowerCase();
  const stackedHits =
    stackedAbstractPhrases.filter((pattern) => pattern.test(lower)).length;
  if (stackedHits >= 1) return true;
  const overloadedSentence = splitSentences(text).some((sentence) => {
    const s = sentence.toLowerCase();
    const termCount = reflectionAbstractTerms.reduce(
      (sum, term) => sum + countPhraseOccurrences(s, term),
      0,
    );
    const hasConcrete =
      /\b(today|body|care|work|vitamin|meal|family|flow|journal|reminder|day|earth|choose|complete|tend)\b/
        .test(s);
    return termCount >= 5 || (termCount >= 4 && !hasConcrete);
  });
  return overloadedSentence;
}

function muddledProgressionFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(
    Boolean,
  );
  if (paragraphs.length < 3) return true;
  const first = paragraphs[0].toLowerCase();
  const last = paragraphs.at(-1)?.toLowerCase() ?? "";
  const startsWithCalendar = /\b(hathor|decan|sꜣḥ|s3h|season|calendar)\b/.test(
    first,
  );
  const endsWithDirective =
    /\b(today|choose|complete|tend|restore|return|what would|what are you willing|what must|let that act|give)\b/
      .test(last);
  return !startsWithCalendar || !endsWithDirective;
}

function unclearDirectiveFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection" || !plan.reflectionMoralPortrait) {
    return false;
  }
  const last = splitSentences(text).at(-1)?.toLowerCase() ?? "";
  if (!last) return true;
  const concreteVerb =
    /\b(choose|complete|tend|return|restore|give|name|release|make|carry|let)\b/
      .test(last);
  const humanObject =
    /\b(care|yourself|body|work|truth|action|day|foundation|inward|outward|what you give|what you keep|inner knowing|daily actions)\b/
      .test(last);
  return !(concreteVerb && humanObject);
}

function overwrittenSpiritualLanguageFailure(
  plan: ControlledGeneratedTextPlan,
  text: string,
) {
  if (plan.kind !== "decan_reflection") return false;
  const lower = cleanPhrase(text).toLowerCase();
  const spiritualTermCount = [
    "sacred",
    "ma'at",
    "maat",
    "serudj",
    "worthiness",
    "divine",
    "sanctuary",
    "truth",
    "witness",
    "measure",
    "order",
    "alignment",
    "restoration",
    "becoming",
    "continuity",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lower, term), 0);
  const concreteTermCount = [
    "body",
    "care",
    "work",
    "today",
    "day",
    "earth",
    "choose",
    "complete",
    "tend",
    "family",
    "flow",
    "journal",
    "reminder",
    "vitamin",
    "action",
  ].reduce((sum, term) => sum + countPhraseOccurrences(lower, term), 0);
  return spiritualTermCount >= 10 && concreteTermCount < 5;
}

function meaningfulWords(value: string): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with",
    "your",
  ]);
  return cleanPhrase(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stopWords.has(word))
    .slice(0, 8);
}

function countPrimaryActions(
  value: string,
  primaryAction: string | null | undefined,
): number {
  const text = cleanPhrase(value).toLowerCase();
  if (!text) return 0;
  const action = cleanPhrase(primaryAction).toLowerCase();
  if (action && text.includes(action)) return 1;
  const gerundAction = asGerundPhrase(action);
  if (gerundAction && text.includes(gerundAction)) return 1;
  const commandPatterns = [
    /\bbegin with\b/g,
    /\bstay with\b/g,
    /\brestore one\b/g,
    /\brestoring one\b/g,
    /\bprotect one\b/g,
    /\bprotecting one\b/g,
    /\bwrite one\b/g,
    /\bwriting one\b/g,
    /\bchoose one\b/g,
    /\bchoose the one\b/g,
    /\bchoosing one\b/g,
    /\btrack (?:that|one|the) single\b/g,
    /\bgive the day one\b/g,
    /\bcomplete one\b/g,
    /\bcompleting one\b/g,
    /\bfinish one\b/g,
    /\bfinish or resize one\b/g,
    /\bgive one\b/g,
    /\bgiving one\b/g,
    /\bname one\b/g,
    /\bnaming one\b/g,
    /\bset one\b/g,
    /\bsetting one\b/g,
    /\btend to\b/g,
    /\bstrengthen\b/g,
    /\bclose with one\b/g,
  ];
  return commandPatterns.reduce(
    (count, pattern) => count + (text.match(pattern) ?? []).length,
    0,
  );
}

function hasGenericCliche(value: string): boolean {
  const text = cleanPhrase(value).toLowerCase();
  return [
    "stay positive",
    "keep going",
    "you got this",
    "believe in yourself",
    "find your balance",
    "trust the process",
    "everything happens for a reason",
  ].some((phrase) => text.includes(phrase));
}

function hasRandomMysticism(value: string): boolean {
  const text = cleanPhrase(value).toLowerCase();
  return [
    "cosmic energy",
    "divine download",
    "good vibes",
    "high vibration",
    "manifest your",
    "the universe has a plan",
    "your aura",
  ].some((phrase) => text.includes(phrase));
}

function hasShameLanguage(value: string): boolean {
  const text = cleanPhrase(value).toLowerCase();
  return [
    "you are failing",
    "you failed",
    "lazy",
    "weak",
    "you always",
    "you never",
    "your fault",
    "you are isfet",
  ].some((phrase) => text.includes(phrase));
}

function mentionsUnsupportedCertainty(value: string): boolean {
  const text = cleanPhrase(value).toLowerCase();
  return [
    "the app knows",
    "this proves",
    "you clearly",
    "without question",
  ].some((phrase) => text.includes(phrase));
}

function hasFlatSentenceStarts(sentences: string[]): boolean {
  if (sentences.length < 4) return false;
  const starts = sentences
    .map((sentenceText) =>
      cleanPhrase(sentenceText).split(/\s+/).slice(0, 2).join(" ")
        .toLowerCase()
    )
    .filter(Boolean);
  const counts = starts.reduce((acc, item) => {
    acc.set(item, (acc.get(item) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
  return Math.max(...counts.values()) >= Math.ceil(sentences.length * 0.6);
}

function ceremonialCadenceSignals(
  value: string,
  sentences: string[],
): string[] {
  const text = cleanPhrase(value).toLowerCase();
  const signals: string[] = [];
  if (
    /\b(line|record|measure|anchor|threshold|rhythm|pattern|return|order|visible|restorable|preserve|protect)\b/
      .test(text)
  ) {
    signals.push("concrete_image");
  }
  if (
    /\b(but|not|rather than|before|after|begin|restore|protect|preserve|return|close|tend|strengthen|engage|enhance)\b/
      .test(text)
  ) {
    signals.push("moral_movement");
  }
  if (/\bone\b/.test(text)) signals.push("single_charge");
  if (!hasFlatSentenceStarts(sentences) && sentences.length >= 3) {
    signals.push("varied_sequence");
  }
  if (hasGenericCliche(value)) signals.push("wellness_cliche");
  if (hasRandomMysticism(value)) signals.push("random_mysticism");
  return signals;
}

function scoreCeremonialCadence(
  value: string,
  signals: string[],
): 1 | 2 | 3 | 4 | 5 {
  if (!cleanPhrase(value)) return 1;
  if (signals.includes("random_mysticism")) return 1;
  if (signals.includes("wellness_cliche")) return 2;
  const strongSignals = [
    "concrete_image",
    "moral_movement",
    "single_charge",
    "varied_sequence",
  ].filter((signal) => signals.includes(signal)).length;
  if (strongSignals >= 4) return 5;
  if (strongSignals >= 2) return 4;
  if (strongSignals === 1) return 3;
  return 2;
}

function scoreActionClarity(
  value: string,
  primaryAction: string | null | undefined,
  primaryActionCount: number,
  maxPrimaryActions: number,
): 1 | 2 | 3 | 4 | 5 {
  if (!cleanPhrase(value)) return 1;
  if (primaryActionCount === 0) return 2;
  if (primaryActionCount > maxPrimaryActions) return 2;
  const action = cleanPhrase(primaryAction).toLowerCase();
  const text = cleanPhrase(value).toLowerCase();
  if (action && text.includes(action)) return 5;
  const gerundAction = asGerundPhrase(action);
  if (gerundAction && text.includes(gerundAction)) return 5;
  return 4;
}

function scoreSemanticSpecificity(
  value: string,
  primaryAction: string | null | undefined,
  matchedEvidenceAnchorCount: number,
): 1 | 2 | 3 | 4 | 5 {
  const text = cleanPhrase(value).toLowerCase();
  if (!text) return 1;
  const hasConcreteMatter =
    /\b(nutrition|meal|water|task|to-do|todo|mark|detail|message|care|focus|study|piece|burden|thread|edge|measure|provision|support|trustworthy|rhythm|finish condition)\b/
      .test(text);
  const hasSmallNumber = /\bone\b|\b1\b/.test(text);
  const action = cleanPhrase(primaryAction).toLowerCase();
  const hasAction = action
    ? text.includes(action) || countPrimaryActions(
          text,
          primaryAction,
        ) > 0
    : countPrimaryActions(text, primaryAction) > 0;
  if (matchedEvidenceAnchorCount > 0 && hasConcreteMatter && hasAction) {
    return 5;
  }
  if (hasConcreteMatter && hasSmallNumber && hasAction) return 4;
  if (hasConcreteMatter && hasAction) return 3;
  return 2;
}

function hasConcreteReflectionMatter(value: string) {
  return /\b(nutrition|meal|body|support|task|work|journal|record|mark|care|study|practice|thread|rhythm|source|detail|finish|decan|season|month)\b/i
    .test(value);
}

function scoreLanguageFreshness(value: string): 1 | 2 | 3 | 4 | 5 {
  const text = cleanPhrase(value).toLowerCase();
  if (!text) return 1;
  const stockPhrases = [
    "tend to provision",
    "tend to visible work",
    "record it plainly",
    "record plainly",
    "one small question",
    "open the suggested flow",
    "not a verdict",
    "not a judgment",
    "not a judgement",
    "not a scolding",
    "do not force a judgment",
    "does not need",
    "no drama",
    "still unmarked",
    "several nutrition checks",
    "body-support checks were missed",
    "mark what happened",
    "path back to balance",
    "line has loosened",
    "restore ma'at",
    "align your energy",
  ];
  if (stockPhrases.some((phrase) => text.includes(phrase))) return 2;
  if (codedReflectionLanguageHits(text).length >= 2) return 2;
  if (hasGenericCliche(text) || hasRandomMysticism(text)) return 2;
  const starts = splitSentences(text).map((sentence) =>
    sentence.split(/\s+/)[0] ?? ""
  );
  const uniqueStarts = new Set(starts);
  if (starts.length >= 3 && uniqueStarts.size <= 1) return 3;
  return 5;
}

function computeGuidanceWorthinessScore(params: {
  groundingScore: number;
  specificityScore: number;
  maatAlignmentScore: number;
  ceremonialCadenceScore: number;
  actionClarityScore: number;
  semanticSpecificityScore: number;
  languageFreshnessScore: number;
}) {
  const score = params.groundingScore * 0.18 +
    params.specificityScore * 0.14 +
    params.maatAlignmentScore * 0.22 +
    params.ceremonialCadenceScore * 0.16 +
    params.actionClarityScore * 0.1 +
    params.semanticSpecificityScore * 0.12 +
    params.languageFreshnessScore * 0.08;
  return Math.round(score * 100) / 100;
}

function recommendDeliveryChannel(
  guidanceWorthinessScore: number,
): ControlledDeliveryChannel {
  return guidanceWorthinessScore < 4.2 ? "archive_only" : "in_app_card";
}

function repairModeForFailure(
  failureReasons: string[],
): ControlledOutputRepairMode {
  if (failureReasons.length === 0) return "none";
  if (failureReasons.includes("maat_alignment_below_threshold")) {
    return "moral_posture_repair";
  }
  if (failureReasons.includes("grounding_below_threshold")) {
    return "evidence_repair";
  }
  if (
    failureReasons.includes("cadence_below_threshold") ||
    failureReasons.includes("ceremonial_cadence_below_threshold") ||
    failureReasons.includes("specificity_below_threshold") ||
    failureReasons.includes("semantic_specificity_below_threshold") ||
    failureReasons.includes("language_freshness_below_threshold")
  ) {
    return "cadence_repair";
  }
  return "surface_fit_repair";
}

function repairInstructionForFailure(
  surface: MaatOutputSurface,
  speechAct: MaatSpeechAct,
  failureReasons: string[],
  repairMode: ControlledOutputRepairMode,
): string | null {
  if (failureReasons.length === 0) return null;
  const rubric = MAAT_SURFACE_RUBRIC[surface];
  const instructions: string[] = [];
  if (failureReasons.includes("grounding_below_threshold")) {
    instructions.push("add one concrete evidence-backed reference");
  }
  if (failureReasons.includes("specificity_below_threshold")) {
    instructions.push("replace generic encouragement with a specific pattern");
  }
  if (failureReasons.includes("maat_alignment_below_threshold")) {
    instructions.push(
      "restore the moral portrait first: name who the user is becoming, frame the repair as serudj/restoration, remove system-serving evidence language, and then serve the selected Ma'at lens without habit-coaching language",
    );
  }
  if (failureReasons.includes("cadence_below_threshold")) {
    instructions.push("vary sentence openings and keep the sequence ordered");
  }
  if (failureReasons.includes("ceremonial_cadence_below_threshold")) {
    instructions.push(
      "restore ceremonial force with concrete image, moral movement, and no wellness cliche",
    );
  }
  if (failureReasons.includes("language_freshness_below_threshold")) {
    instructions.push(
      "use concrete evidence once, then translate it into plain language instead of repeating the same activity or coded Ma'at phrasing",
    );
  }
  if (failureReasons.includes("surface_fit_below_threshold")) {
    instructions.push(
      "honor normalized thread counts: do not turn one recurring obligation into several supports or recommend consolidation unless distinct sources are actually present",
    );
  }
  if (
    surface === "decan_reflection" &&
    (failureReasons.includes("surface_fit_below_threshold") ||
      failureReasons.includes("specificity_below_threshold"))
  ) {
    instructions.push(
      "for reflections, interpret the user through the moral portrait and month/decan/day-card arc, include both one alignment and one restoration, address the user directly with you/your, and translate Ma'at terms into ordinary user-facing language",
    );
  }
  if (
    failureReasons.includes("surface_fit_below_threshold") ||
    failureReasons.includes("too_many_primary_actions") ||
    failureReasons.includes("worthiness_below_interrupt_threshold")
  ) {
    instructions.push(
      `fit the ${surface} contract and keep one primary action`,
    );
  }
  return [
    `Repair as a ${speechAct} act.`,
    `Repair mode: ${repairMode}.`,
    `Required moves: ${rubric.requiredMoves.join(", ")}.`,
    ...instructions,
  ].join(" ");
}
