// deno-lint-ignore-file no-import-prefix

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildControlledOutput,
  DEFAULT_OUTPUT_BANNED_PHRASES,
  evidenceAnchorsFromMemoryPhrases,
  generatedTextPlanPromptBlock,
  gradeControlledOutput,
  gradeGeneratedTextAgainstPlan,
  OUTPUT_CONTROL_POLICY_VERSION,
  outputControlPayload,
  outputSurfaceVariantsPayload,
  validateGeneratedTextAgainstPlan,
} from "./output_control.ts";
import { MAAT_CONSTITUTION_VERSION } from "./maat_constitution.ts";
import { buildNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import { getDecanContext } from "./decan_context.ts";
import {
  buildReflectionAlignmentMap,
  buildReflectionArcPlan,
  buildReflectionCalendarFrame,
  buildReflectionDomainBalance,
  buildReflectionUserPatternProfile,
} from "./reflection_calendar.ts";
import { buildReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";
import { selectMaatReflectionExamples } from "./maat_reflection_examples.ts";
import { buildFallbackReflectionJudgment } from "./reflection_judgment.ts";
import { buildReflectionThesisGate } from "./reflection_thesis_gate.ts";
import { buildFallbackReflectionMoralPortrait } from "./reflection_moral_portrait.ts";

Deno.test("buildControlledOutput renders and validates a grounded drift nudge", () => {
  const output = buildControlledOutput({
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "drift_nudge",
    speechAct: "correct",
    intent: "restore_order_without_shame",
    moralFrame: "maat_order_over_scatter",
    emotionalTemperature: "low",
    userState: "good_faith_drift",
    leadAxis: "M",
    leadAxisLabel: "measure",
    primaryAction: "give one task a clear finish condition",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "two planned blocks were missed",
      "the week felt scattered",
    ], { prefix: "drift", limit: 2 }),
    rhetoricalMoves: [
      "name_the_pattern",
      "ground_in_evidence",
      "interpret_gently",
      "offer_one_act",
      "close_with_dignity",
    ],
    detailBudget: "brief",
    surfaceConstraints: {
      teaserCharsMax: 160,
      pushExcerptCharsMax: 110,
      archivePreviewCharsMax: 150,
      bodySentencesMax: 6,
      bodyParagraphsMax: 4,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
    },
    cta: {
      type: "flow_template",
      ref: "dawn-house-rite",
      reason: "axis:M",
    },
    meaning: {
      dominantField: "visible_work",
      humanLabel: "visible work",
      whyThisFieldWon: "two task anchors are unresolved",
      userFacingEvidenceLine: "One visible task is still open.",
      evidenceDensity: "medium",
      confidence: "medium",
      rhetoricalFrame: "small correction without shame",
      decanOrDayAnchor: "Thoth - measure",
      specificAction: "give one task a clear finish condition",
      bannedTerms: DEFAULT_OUTPUT_BANNED_PHRASES,
    },
    context: {
      decanName: "Thoth - measure",
      triggerReason: "band_worsened",
    },
  });

  assertEquals(output.validation.ok, true);
  assertEquals(
    output.surfaceVariants.bodyText.includes("two planned blocks"),
    false,
  );
  assertEquals(
    output.surfaceVariants.bodyText.includes("the week felt scattered"),
    false,
  );
  assert(output.surfaceVariants.bodyText.includes("one clean edge"));
  assertEquals(output.surfaceVariants.bodyText.includes("Tend to"), false);
  assertEquals(
    output.surfaceVariants.bodyText.includes("failure"),
    false,
  );
  assertEquals(
    output.surfaceVariants.bodyText.includes("Corrective act"),
    false,
  );
  assert(output.surfaceVariants.teaserText.length <= 160);
  const payload = outputSurfaceVariantsPayload(output.surfaceVariants);
  assertEquals(payload.teaser_text, output.surfaceVariants.teaserText);
  assertEquals(payload.context_card, null);
  const controlPayload = outputControlPayload(output);
  const grade = gradeControlledOutput(output);
  assertEquals(controlPayload.constitution_version, MAAT_CONSTITUTION_VERSION);
  assertEquals(grade.pass, true);
  assertEquals((controlPayload.grade as { pass: boolean }).pass, true);
});

Deno.test("buildControlledOutput creates server-owned opening context rows", () => {
  const output = buildControlledOutput({
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_opening",
    speechAct: "orient",
    intent: "start_decan_with_one_visible_measure",
    moralFrame: "maat_order_made_practical",
    emotionalTemperature: "low",
    userState: "new_decan_boundary",
    leadAxis: "T",
    leadAxisLabel: "truth",
    primaryAction: "write one truthful mark",
    evidenceAnchors: [],
    rhetoricalMoves: [
      "name_the_frame",
      "ground_in_evidence",
      "offer_one_act",
      "close_with_dignity",
    ],
    detailBudget: "medium",
    surfaceConstraints: {
      teaserCharsMax: 220,
      pushExcerptCharsMax: 120,
      archivePreviewCharsMax: 160,
      bodySentencesMax: 8,
      bodyParagraphsMax: 5,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
    },
    cta: {
      type: "node",
      ref: "maat",
      reason: "decan_boundary",
    },
    context: {
      decanName: "Hathor",
      dayLine:
        "Today centers Record honestly; your move is Write one true mark.",
      nodeRef: "maat",
    },
  });

  assertEquals(output.validation.ok, true);
  assertEquals(output.surfaceVariants.contextCard?.rows.length, 3);
  assertEquals(output.surfaceVariants.contextCard?.rows[0].label, "Today");
});

Deno.test("generated text plans produce prompt contracts and validation", () => {
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "witness_the_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_concrete_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "90-140",
    requiredEvidenceDetailCount: 1,
    leadAxis: "T",
    leadAxisLabel: "truth",
    reflectionMove: "inquire",
    closingInstruction: "Close with one concrete next step.",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "finished the study block",
    ], { prefix: "reflection", required: true }),
    rhetoricalMoves: [
      "witness_specific_evidence",
      "interpret_trajectory",
      "name_one_next_step",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 40,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };

  const promptBlock = generatedTextPlanPromptBlock(plan);
  assert(promptBlock.includes("OUTPUT_CONTROL_PLAN"));
  assertStringIncludes(promptBlock, "synthesize the whole decan first");
  assertStringIncludes(
    promptBlock,
    "case key/offering is one interpretive thread",
  );
  assertStringIncludes(
    promptBlock,
    "Use one concrete detail as an anchor",
  );
  const text =
    "The record is clear: you finished the study block. That anchor gives the next step a real measure. Close by protecting one concrete return.";
  const validation = validateGeneratedTextAgainstPlan(
    plan,
    text,
  );
  const grade = gradeGeneratedTextAgainstPlan(
    plan,
    text,
    validation,
  );
  assertEquals(validation.ok, true);
  assertEquals(validation.errors, []);
  assertEquals(grade.pass, true);
  assertEquals(grade.ceremonialCadenceScore, 5);
});

Deno.test("generated text grader rejects shame and generic copy", () => {
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "witness_the_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_concrete_evidence",
    emotionalTemperature: "low" as const,
    targetWordRange: "90-140",
    requiredEvidenceDetailCount: 1,
    closingInstruction: "Close with one concrete next step.",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "two planned blocks were missed",
    ], { prefix: "reflection", required: true }),
    rhetoricalMoves: [
      "witness_specific_evidence",
      "interpret_trajectory",
      "name_one_next_step",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 40,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const text = "You are failing. Stay positive and find your balance.";
  const validation = validateGeneratedTextAgainstPlan(plan, text);
  const grade = gradeGeneratedTextAgainstPlan(plan, text, validation);

  assertEquals(validation.ok, false);
  assertEquals(grade.pass, false);
  assert(grade.failureReasons.includes("maat_alignment_below_threshold"));
  assertEquals(grade.repairMode, "moral_posture_repair");
  assert(grade.repairInstruction?.includes("Repair as a witness act"));
});

Deno.test("generated text grader rejects repeated evidence recital", () => {
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_concrete_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "90-140",
    requiredEvidenceDetailCount: 1,
    closingInstruction: "Close with one concrete next step.",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "nutrition vitamin A was pending on 2026-05-19 Source: apple. Purpose: strong bones.",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 2,
      proportionateGravity: true,
    },
    rhetoricalMoves: [
      "anchor_once_in_specific_evidence",
      "interpret_trajectory",
      "keep_gravity_proportionate_to_signal",
      "name_one_next_step",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 120,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const text =
    "Vitamin A opened the reflection. Vitamin A appeared again as daily proof. The vitamin A thread became more serious than the record can support. The next step is one proportionate mark.";
  const validation = validateGeneratedTextAgainstPlan(plan, text);
  const grade = gradeGeneratedTextAgainstPlan(plan, text, validation);

  assert(
    validation.warnings.some((warning) =>
      warning.startsWith("evidence_detail_overused:vitamin a:")
    ),
  );
  assert(
    validation.warnings.includes("gravity_overstated_for_routine_signal"),
  );
  assertEquals(grade.pass, false);
  assert(grade.failureReasons.includes("language_freshness_below_threshold"));
  assert(
    grade.repairInstruction?.includes(
      "use concrete evidence once, then translate it into plain language",
    ),
  );
});

Deno.test("generated text grader rejects recurring nutrition thread as several supports", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 10 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(16 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_concrete_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-110",
    requiredEvidenceDetailCount: 1,
    closingInstruction:
      "Make the check easier to keep: reduce the recurrence, attach it to one meal, or mark it immediately after use.",
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "nutrition vitamin A was pending on 2026-05-19 Source: apple. Purpose: strong bones.",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    normalizedObligationThreads,
    rhetoricalMoves: [
      "anchor_once_in_specific_evidence",
      "interpret_trajectory",
      "keep_gravity_proportionate_to_signal",
      "name_one_next_step",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 140,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const text =
    "The vitamin A support from apple sources stayed unchecked across all ten days of this decan. Several nutrition supports are trying to cover the same ground without proof they work as one practice. Before the next decan opens, choose the one source that covers the most real ground today and track that single support.";
  const validation = validateGeneratedTextAgainstPlan(plan, text);
  const grade = gradeGeneratedTextAgainstPlan(plan, text, validation);

  assert(
    validation.warnings.includes(
      "thread_count_mismatch:single_recurring_nutrition_as_many_supports",
    ),
  );
  assert(
    validation.warnings.includes(
      "thread_count_overexposed:single_recurring_nutrition_occurrences",
    ),
  );
  assert(
    validation.warnings.includes(
      "offering_fit_mismatch:recurring_nutrition_thread_as_consolidation",
    ),
  );
  assertEquals(grade.pass, false);
  assert(grade.failureReasons.includes("surface_fit_below_threshold"));
});

Deno.test("reflection calendar frame preserves the full decan arc", () => {
  const frame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });

  assertEquals(frame?.monthName, "Hathor");
  assertEquals(frame?.seasonName, "Akhet");
  assertEquals(frame?.ceremonialDecanName, "Hathor's first decan sꜣḥ");
  assertEquals(frame?.dayCards.length, 10);
  assertStringIncludes(frame?.arcSummary ?? "", "Feel the Ground Hold");
  assertStringIncludes(frame?.arcSummary ?? "", "Confirm Continuity");
});

Deno.test("reflection grader rejects a longer nudge without calendar alignment", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 10 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(16 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const reflectionAlignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    immediateCaseThread: {
      caseKey: "provision.repeated_open_checks",
      offering: "reschedule",
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-120",
    requiredEvidenceDetailCount: 1,
    closingInstruction: "make the check easier to keep",
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "vitamin A support appeared",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap,
    offeringRender: {
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
    rhetoricalMoves: [
      "read_user_record_against_calendar_arc",
      "name_one_alignment_signal",
      "name_one_improvement_direction",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 140,
      sentencesMax: 5,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const text =
    "One nutrition thread repeated through the decan without finding a reliable recording rhythm. The vitamin A support appeared across the period but stayed unchecked. Before the next decan opens, make the check easier to keep.";
  const validation = validateGeneratedTextAgainstPlan(plan, text);
  const grade = gradeGeneratedTextAgainstPlan(plan, text, validation);

  assert(validation.warnings.includes("reflection_calendar_arc_missing"));
  assert(validation.warnings.includes("reflection_alignment_missing"));
  assertEquals(grade.pass, false);
  assert(grade.failureReasons.includes("surface_fit_below_threshold"));
});

Deno.test("reflection grader accepts calendar arc plus alignment and improvement", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const reflectionAlignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    immediateCaseThread: {
      caseKey: "provision.repeated_open_checks",
      offering: "reschedule",
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: "make the check easier to keep",
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "vitamin A support appeared",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap,
    offeringRender: {
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
    rhetoricalMoves: [
      "read_user_record_against_calendar_arc",
      "name_one_alignment_signal",
      "name_one_improvement_direction",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 5,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const text =
    "Hathor's first decan sꜣḥ asked for stability regained: step back onto the earth and let care return to a form your day can hold. Your record answered through steady concern; the vitamin A support appeared once, and the improvement is giving that care one clear place and a right size. Ma'at is not asking for more items here, only an honest record that is easy to keep. Before the next decan opens, make the check simpler to carry.";
  const validation = validateGeneratedTextAgainstPlan(plan, text);
  const grade = gradeGeneratedTextAgainstPlan(plan, text, validation);

  assertEquals(
    validation.warnings.filter((warning) => warning.startsWith("reflection_")),
    [],
  );
  assertEquals(grade.pass, true);
});

Deno.test("reflection arc plan rejects case-first longer nudge shape", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 6 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(18 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const profile = buildReflectionUserPatternProfile({
    normalizedObligationThreads,
    evidenceTexts: ["vitamin A from apple for strong bones"],
    activeDays: 2,
  });
  const reflectionAlignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    immediateCaseThread: {
      caseKey: "provision.repeated_open_checks",
      offering: "reschedule",
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
  });
  const examples = selectMaatReflectionExamples({
    caseKey: "provision.repeated_open_checks",
    offering: "reschedule",
    decanName: calendarFrame?.decanName,
    monthName: calendarFrame?.monthName,
    userPattern: [profile.routineStyle, profile.recordStyle],
    evidenceShape: reflectionAlignmentMap.underansweredSignals,
  });
  const arcPlan = buildReflectionArcPlan({
    calendarFrame,
    alignmentMap: reflectionAlignmentMap,
    userPatternProfile: profile,
    selectedExamples: examples,
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: arcPlan.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "vitamin A support appeared",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap,
    reflectionUserPatternProfile: profile,
    reflectionArcPlan: arcPlan,
    reflectionExampleReferences: examples,
    offeringRender: {
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
    rhetoricalMoves: [
      "let_calendar_arc_govern_first_sentence",
      "name_one_alignment_signal",
      "name_one_improvement_direction",
      "close_with_one_specific_question",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const badText =
    "Vitamin A stayed open through the decan without finding a reliable recording rhythm. The useful correction is structural rather than motivational. Before the next decan opens, make the check easier to keep.";
  const validation = validateGeneratedTextAgainstPlan(plan, badText);
  const grade = gradeGeneratedTextAgainstPlan(plan, badText, validation);

  assert(validation.warnings.includes("reflection_calendar_not_governing"));
  assert(validation.warnings.includes("reflection_closing_integrity_failed"));
  assertEquals(grade.calendarGovernsScore, 1);
  assertEquals(grade.closingIntegrityScore, 1);
  assertEquals(grade.pass, false);
});

Deno.test("reflection arc plan rejects repeated evidence anchors and mixed closing", () => {
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const reflectionAlignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    immediateCaseThread: {
      caseKey: "provision.repeated_open_checks",
      offering: "reschedule",
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
  });
  const arcPlan = buildReflectionArcPlan({
    calendarFrame,
    alignmentMap: reflectionAlignmentMap,
    selectedExamples: [{
      id: "reflection-calendar-arc-001",
      closingMove: "question",
    }],
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: arcPlan.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "Source: apple. Purpose: strong bones.",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap,
    reflectionArcPlan: arcPlan,
    offeringRender: {
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
    rhetoricalMoves: [
      "let_calendar_arc_govern_first_sentence",
      "anchor_once_in_specific_evidence",
      "close_with_one_specific_question",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const badText =
    "Hathor's decan asked for stable return and embodied order. The apple support for strong bones showed intention, but apple and strong bones kept returning as the whole meaning. Ma'at asks for a record that can hold the care without making it heavy. What moment could carry the mark? Attach it to one meal before the next decan.";
  const validation = validateGeneratedTextAgainstPlan(plan, badText);
  const grade = gradeGeneratedTextAgainstPlan(plan, badText, validation);

  assert(
    validation.warnings.some((warning) =>
      warning.startsWith("evidence_detail_overused:")
    ),
  );
  assert(validation.warnings.includes("reflection_closing_integrity_failed"));
  assertEquals(grade.singleAnchorScore, 2);
  assertEquals(grade.pass, false);
});

Deno.test("reflection arc plan accepts calendar governed example shape", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const reflectionAlignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    immediateCaseThread: {
      caseKey: "provision.repeated_open_checks",
      offering: "reschedule",
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
  });
  const arcPlan = buildReflectionArcPlan({
    calendarFrame,
    alignmentMap: reflectionAlignmentMap,
    selectedExamples: [{
      id: "reflection-calendar-arc-001",
      closingMove: "question",
    }],
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: arcPlan.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "vitamin A support appeared",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap,
    reflectionArcPlan: arcPlan,
    offeringRender: {
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
    rhetoricalMoves: [
      "let_calendar_arc_govern_first_sentence",
      "name_one_alignment_signal",
      "name_one_improvement_direction",
      "close_with_one_specific_question",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const genericDecanText =
    "Hathor's decan asked for return: stable ground recovered and care came back into the day. Vitamin A appeared once as a sign that the concern was named and present. What still needs repair is the shape around it: one clear place, one honest mark, and a promise small enough to keep. What existing moment in the day could carry this care without adding pressure?";
  const genericValidation = validateGeneratedTextAgainstPlan(
    plan,
    genericDecanText,
  );
  assert(genericValidation.warnings.includes("reflection_decan_name_missing"));

  const goodText =
    "Hathor's first decan sꜣḥ asked for return: stable ground recovered and care came back into your day. Vitamin A appeared once as a sign that the concern was named and present. What still needs repair is the shape around it: one clear place, one honest mark, and a promise small enough to keep. What existing moment in your day could carry this care without adding pressure?";
  const validation = validateGeneratedTextAgainstPlan(plan, goodText);
  const grade = gradeGeneratedTextAgainstPlan(plan, goodText, validation);

  assertEquals(
    validation.warnings.filter((warning) => warning.startsWith("reflection_")),
    [],
  );
  assertEquals(grade.calendarGovernsScore, 5);
  assertEquals(grade.alignmentBalanceScore, 5);
  assertEquals(grade.caseSubordinationScore, 5);
  assertEquals(grade.closingIntegrityScore, 5);
  assertEquals(grade.pass, true);
});

Deno.test("reflection domain balance caps repeated nutrition occurrences as frequency", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 10 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(16 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const translatedProfileContext = {
    version: "maat_profile_context_v1" as const,
    phrases: [
      "The written record often stays thinner than the practice itself; distinguish doing from witnessing instead of assuming absence.",
    ],
    factRefs: [{
      fact_type: "record_style",
      value: "surface_logger",
      confidence: "high" as const,
      stability: "stable",
    }],
    omittedLowConfidenceCount: 0,
  };
  const balance = buildReflectionDomainBalance({
    calendarFrame,
    normalizedObligationThreads,
    translatedProfileContext,
  });
  const nutrition = balance.domainSignals.find((signal) =>
    signal.domain === "nutrition"
  );

  assertEquals(nutrition?.occurrenceCount, 10);
  assert(nutrition?.meaningWeight && nutrition.meaningWeight < 2);
  assertEquals(balance.evidenceDensity, "balanced");
  assertEquals(balance.primaryDomain, "calendar_day_card");
});

Deno.test("thin reflection evidence makes calendar and profile govern over nutrition rows", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 10 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(16 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const reflectionAlignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    immediateCaseThread: {
      caseKey: "provision.repeated_open_checks",
      offering: "reschedule",
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
  });
  const arcPlan = buildReflectionArcPlan({
    calendarFrame,
    alignmentMap: reflectionAlignmentMap,
  });

  assertEquals(reflectionAlignmentMap.evidenceDensity, "thin");
  assertStringIncludes(
    reflectionAlignmentMap.underansweredSignals[0],
    "calendar arc should lead",
  );
  assertEquals(arcPlan.caseThreadRole, "supporting_signal");
  assertStringIncludes(
    arcPlan.prohibitedFocus.join("; "),
    "do not let nutrition row density choose the reflection topic",
  );
});

Deno.test("reflection grader rejects thin-evidence nutrition dominance and missing profile lens", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 10 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(16 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const translatedProfileContext = {
    version: "maat_profile_context_v1" as const,
    phrases: [
      "Engagement appears irregular, so the next measure should be easy to re-enter rather than built around perfect continuity.",
    ],
    factRefs: [{
      fact_type: "routine_style",
      value: "irregular_engagement",
      confidence: "high" as const,
      stability: "stable",
    }],
    omittedLowConfidenceCount: 0,
  };
  const reflectionAlignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    translatedProfileContext,
    immediateCaseThread: {
      caseKey: "provision.repeated_open_checks",
      offering: "reschedule",
      diagnosis:
        "One recurring support keeps returning without a usable recording rhythm.",
      concreteAction: "make the check easier to keep",
    },
  });
  const arcPlan = buildReflectionArcPlan({
    calendarFrame,
    alignmentMap: reflectionAlignmentMap,
    translatedProfileContext,
    selectedExamples: [{
      id: "reflection-calendar-arc-001",
      closingMove: "question",
    }],
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: arcPlan.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      "vitamin A support appeared",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: [
      "let_calendar_arc_govern_first_sentence",
      "balance_domains_before_selecting_topic",
      "use_profile_lens_when_evidence_is_thin",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const badText =
    "Hathor's first decan sꜣḥ asked for stability regained. Vitamin A appeared every day as the strongest signal, and the nutrition support thread never found completion. The body-support support needs a recording rhythm around vitamin A before the next decan. What moment could carry the mark?";
  const validation = validateGeneratedTextAgainstPlan(plan, badText);
  const grade = gradeGeneratedTextAgainstPlan(plan, badText, validation);

  assert(
    validation.warnings.includes("nutrition_density_overweight_failure"),
  );
  assert(
    validation.warnings.includes("thin_evidence_overclaim_failure"),
  );
  assert(validation.warnings.includes("missing_profile_lens_failure"));
  assertEquals(grade.caseSubordinationScore, 2);
  assertEquals(grade.pass, false);
});

Deno.test("same decan and case shift interpretation when profile facts differ", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 3 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(19 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const recordContext = {
    version: "maat_profile_context_v1" as const,
    phrases: [
      "The written record often stays thinner than the practice itself; distinguish doing from witnessing instead of assuming absence.",
    ],
    factRefs: [{
      fact_type: "record_style",
      value: "surface_logger",
      confidence: "high" as const,
      stability: "stable",
    }],
    omittedLowConfidenceCount: 0,
  };
  const guidanceContext = {
    version: "maat_profile_context_v1" as const,
    phrases: [
      "This user appears sensitive to interruption; a question or invitation is safer than a command.",
    ],
    factRefs: [{
      fact_type: "guidance_response",
      value: "interruption_averse",
      confidence: "high" as const,
      stability: "stable",
    }],
    omittedLowConfidenceCount: 0,
  };
  const recordMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    translatedProfileContext: recordContext,
  });
  const guidanceMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    translatedProfileContext: guidanceContext,
  });

  assertEquals(recordMap.domainBalance.primaryDomain, "calendar_day_card");
  assert(
    recordMap.domainBalance.domainSignals.some((signal) =>
      signal.domain === "note_record"
    ),
  );
  assert(
    guidanceMap.domainBalance.domainSignals.some((signal) =>
      signal.domain === "guidance"
    ),
  );
  assert(
    recordMap.underansweredSignals.join(" ") !==
      guidanceMap.underansweredSignals.join(" "),
  );
});

Deno.test("reflection profile snapshot makes profile lens govern before nutrition evidence", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 10 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(16 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const profileFacts = [{
    version: "maat_user_profile_facts_v1" as const,
    fact_type: "record_style" as const,
    value: "surface_logger",
    source: "test",
    confidence: "high" as const,
    evidence_count: 5,
    first_seen: "2026-05-01T00:00:00.000Z",
    last_seen: "2026-05-24T00:00:00.000Z",
    stability: "stable" as const,
    counterevidence: null,
    metadata: {},
  }];
  const translatedProfileContext = {
    version: "maat_profile_context_v1" as const,
    phrases: [
      "The written record often stays thinner than the practice itself; distinguish doing from witnessing instead of assuming absence.",
    ],
    factRefs: [{
      fact_type: "record_style",
      value: "surface_logger",
      confidence: "high" as const,
      stability: "stable",
    }],
    omittedLowConfidenceCount: 0,
  };
  const balance = buildReflectionDomainBalance({
    calendarFrame,
    normalizedObligationThreads,
    translatedProfileContext,
  });
  const snapshot = buildReflectionProfileSnapshot({
    profileFacts,
    translatedProfileContext,
    normalizedObligationThreads,
    domainBalance: balance,
    calendarFrame,
  });

  assertEquals(snapshot.dominantUserLens, "record_thinning");
  assertEquals(snapshot.bestEvidenceAnchor?.domain, "profile");
  assert(
    snapshot.suppressedEvidenceAnchors.some((anchor) =>
      anchor.domain === "nutrition"
    ),
  );
  assertStringIncludes(
    snapshot.reflectionInstruction,
    "The Ma'at lens is the topic",
  );
});

Deno.test("reflection grader hard-fails demoted nutrition becoming the topic", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads(
    Array.from(
      { length: 10 },
      (_, index) =>
        `Nutrition: vitamin A Planner nutrition entry for 2026-05-${
          String(16 + index).padStart(2, "0")
        }. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending`,
    ),
  );
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const profileFacts = [{
    version: "maat_user_profile_facts_v1" as const,
    fact_type: "record_style" as const,
    value: "surface_logger",
    source: "test",
    confidence: "high" as const,
    evidence_count: 5,
    first_seen: "2026-05-01T00:00:00.000Z",
    last_seen: "2026-05-24T00:00:00.000Z",
    stability: "stable" as const,
    counterevidence: null,
    metadata: {},
  }];
  const translatedProfileContext = {
    version: "maat_profile_context_v1" as const,
    phrases: [
      "The written record often stays thinner than the practice itself; distinguish doing from witnessing instead of assuming absence.",
    ],
    factRefs: [{
      fact_type: "record_style",
      value: "surface_logger",
      confidence: "high" as const,
      stability: "stable",
    }],
    omittedLowConfidenceCount: 0,
  };
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
    translatedProfileContext,
  });
  const arcPlan = buildReflectionArcPlan({
    calendarFrame,
    alignmentMap,
    translatedProfileContext,
  });
  const snapshot = buildReflectionProfileSnapshot({
    profileFacts,
    translatedProfileContext,
    normalizedObligationThreads,
    domainBalance: alignmentMap.domainBalance,
    calendarFrame,
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_profile_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: arcPlan.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      snapshot.bestEvidenceAnchor?.claim ?? "one profile pattern",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
    },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap: alignmentMap,
    reflectionProfileSnapshot: snapshot,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: [
      "let_calendar_arc_govern_first_sentence",
      "profile_snapshot_governs_personal_lens",
      "subordinate_suppressed_evidence",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const badText =
    "Hathor's first decan sꜣḥ asked for stability regained. Vitamin A support for strong bones appeared through the decan, so nutrition became the central thread of the record. The recording rhythm around vitamin A needs a home. What existing moment could carry that mark?";
  const validation = validateGeneratedTextAgainstPlan(plan, badText);
  const grade = gradeGeneratedTextAgainstPlan(plan, badText, validation);

  assert(
    validation.warnings.includes("nutrition_as_topic_when_demoted_failure"),
  );
  assert(validation.warnings.includes("suppressed_evidence_leak_failure"));
  assertEquals(grade.profileLensGovernsScore, 2);
  assertEquals(grade.evidenceAnchorSubordinationScore, 2);
  assertEquals(grade.pass, false);
});

Deno.test("same nutrition evidence selects different profile snapshot lenses", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const recordFacts = [{
    version: "maat_user_profile_facts_v1" as const,
    fact_type: "record_style" as const,
    value: "surface_logger",
    source: "test",
    confidence: "high" as const,
    evidence_count: 5,
    first_seen: "2026-05-01T00:00:00.000Z",
    last_seen: "2026-05-24T00:00:00.000Z",
    stability: "stable" as const,
    counterevidence: null,
    metadata: {},
  }];
  const accumulatorFacts = [{
    ...recordFacts[0],
    fact_type: "commitment_pattern" as const,
    value: "accumulator",
  }];
  const recordLens = buildReflectionProfileSnapshot({
    profileFacts: recordFacts,
    normalizedObligationThreads,
    calendarFrame,
  });
  const accumulatorLens = buildReflectionProfileSnapshot({
    profileFacts: accumulatorFacts,
    normalizedObligationThreads,
    calendarFrame,
  });

  assertEquals(recordLens.dominantUserLens, "record_thinning");
  assertEquals(accumulatorLens.dominantUserLens, "overcommitment");
});

Deno.test("reflection profile snapshot adds Ma'at alignment lens above user lens", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const snapshot = buildReflectionProfileSnapshot({
    profileFacts: [{
      version: "maat_user_profile_facts_v1" as const,
      fact_type: "routine_style" as const,
      value: "single_recurring_support_thread",
      source: "test",
      confidence: "high" as const,
      evidence_count: 5,
      first_seen: "2026-05-01T00:00:00.000Z",
      last_seen: "2026-05-24T00:00:00.000Z",
      stability: "stable" as const,
      counterevidence: null,
      metadata: {},
    }],
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });

  assertEquals(snapshot.dominantMaatLens, "measure");
  assert(snapshot.maatLensCandidates.includes("truth"));
  assert(snapshot.maatLensCandidates.includes("life_preservation"));
  assertStringIncludes(snapshot.ethicalQuestion, "sized and placed");
  assertStringIncludes(
    snapshot.reflectionInstruction,
    "Ma'at lens is the topic",
  );
  assertStringIncludes(
    snapshot.interpretiveSpecificity.specificIntent,
    "strength and durability",
  );
  assert(snapshot.interpretiveSpecificity.avoidGenericSubstitutes.includes(
    "proper place",
  ));
  assertEquals(
    snapshot.bestEvidenceAnchor?.claim,
    "one care reminder kept returning without being marked complete",
  );
});

Deno.test("reflection specificity bridge rejects generic fortune-cookie substitutes", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
  });
  const arcPlan = buildReflectionArcPlan({ calendarFrame, alignmentMap });
  const snapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_specific_interpretation",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: arcPlan.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      snapshot.bestEvidenceAnchor?.claim ??
        "one recurring body-care promise appeared through the decan",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: { maxNamedEvidenceMentions: 1 },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap: alignmentMap,
    reflectionProfileSnapshot: snapshot,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: ["interpretive_specificity_bridge_governs"],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const badText =
    "Hathor's first decan sꜣḥ asked for stability regained. One recurring support thread kept returning without a simple recording home. The care was present, but the mark needs its proper place without making the account heavier. What existing moment in the day could carry this support mark?";
  const badValidation = validateGeneratedTextAgainstPlan(plan, badText);
  const badGrade = gradeGeneratedTextAgainstPlan(
    plan,
    badText,
    badValidation,
  );

  assert(badValidation.warnings.includes(
    "generic_interpretive_substitute_failure",
  ));
  assertEquals(badGrade.interpretiveSpecificityScore, 2);
  assertEquals(badGrade.pass, false);

  const goodText =
    "Hathor's first decan sꜣḥ asked for stability regained: care returning to a form the day can hold. One care reminder kept returning without being marked complete, and the named intention was strength and durability. The Ma'at question is measure, in plain terms: a promise with the right size and a clear place. The record answered through steady concern; it still needs one ordinary moment where the care can be done and plainly marked. What existing meal or threshold could carry this care without adding pressure?";
  const goodValidation = validateGeneratedTextAgainstPlan(plan, goodText);
  const goodGrade = gradeGeneratedTextAgainstPlan(
    plan,
    goodText,
    goodValidation,
  );

  assertEquals(
    goodValidation.warnings.includes("generic_interpretive_substitute_failure"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("interpretive_specificity_missing"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("reflection_plain_language_failure"),
    false,
  );
  assertEquals(goodGrade.interpretiveSpecificityScore, 5);
});

Deno.test("reflection judgment thesis governs final rendered reflection", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
  });
  const arcPlan = buildReflectionArcPlan({ calendarFrame, alignmentMap });
  const snapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const moralPortrait = buildFallbackReflectionMoralPortrait({
    calendarFrame,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const reflectionJudgment = buildFallbackReflectionJudgment({
    calendarFrame,
    moralPortrait,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_reflection_judgment",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: reflectionJudgment.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      snapshot.bestEvidenceAnchor?.claim ??
        "one recurring body-care promise appeared through the decan",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: { maxNamedEvidenceMentions: 1 },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap: alignmentMap,
    reflectionProfileSnapshot: snapshot,
    reflectionMoralPortrait: moralPortrait,
    reflectionJudgment,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: ["render_reflection_judgment_thesis"],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };

  const badText =
    "Hathor's first decan sꜣḥ asked for stability regained. The vitamin check needs a better recording rhythm and a reliable moment to log it. Put the check after one meal and complete it there.";
  const badValidation = validateGeneratedTextAgainstPlan(plan, badText);
  const badGrade = gradeGeneratedTextAgainstPlan(
    plan,
    badText,
    badValidation,
  );

  assert(badValidation.warnings.includes("reflection_moral_thesis_missing"));
  assert(badValidation.warnings.includes(
    "reflection_false_reading_not_avoided",
  ));
  assertEquals(badGrade.moralThesisScore, 2);
  assertEquals(badGrade.falseReadingAvoidedScore, 2);
  assertEquals(badGrade.habitMechanicsSuppressedScore, 2);
  assertEquals(badGrade.pass, false);

  const goodText =
    "Hathor's first decan sꜣḥ asked for stability regained: care returning to a truthful form the day can hold. You are becoming someone who refuses both neglect and overburdening, and Ma'at's measure means right size: a promise small enough to keep without pressure. Your heart kept returning toward preservation; restoration asks that care to take one clear place in your day. What care are you willing to make truly keepable?";
  const goodValidation = validateGeneratedTextAgainstPlan(plan, goodText);
  const goodGrade = gradeGeneratedTextAgainstPlan(
    plan,
    goodText,
    goodValidation,
  );

  assertEquals(
    goodValidation.warnings.includes("reflection_moral_thesis_missing"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("reflection_false_reading_not_avoided"),
    false,
  );
  assertEquals(goodGrade.moralThesisScore, 5);
  assertEquals(goodGrade.falseReadingAvoidedScore, 5);
  assertEquals(goodGrade.maatQuestionSpecificityScore, 5);
});

Deno.test("reflection thesis gate hides structurally loud recurring nutrition anchors", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
  });
  const arcPlan = buildReflectionArcPlan({ calendarFrame, alignmentMap });
  const snapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const moralPortrait = buildFallbackReflectionMoralPortrait({
    calendarFrame,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const reflectionJudgment = buildFallbackReflectionJudgment({
    calendarFrame,
    moralPortrait,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const thesisGate = buildReflectionThesisGate({
    judgment: reflectionJudgment,
    selectedEvidenceAnchor: snapshot.bestEvidenceAnchor?.claim,
    normalizedObligationThreads,
    profileSnapshot: snapshot,
    calendarFrame,
  });

  assertEquals(thesisGate.evidenceVisibility, "background_support");
  assert(thesisGate.forbiddenSurfaceFocus.includes("vitamin"));

  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_reflection_judgment",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 0,
    closingInstruction: reflectionJudgment.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      snapshot.bestEvidenceAnchor?.claim ??
        "one recurring body-care promise appeared through the decan",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: {
      maxNamedEvidenceMentions: 1,
      proportionateGravity: true,
      instruction:
        "Evidence is background support. Render truthful measure without naming the repeated item.",
    },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap: alignmentMap,
    reflectionProfileSnapshot: snapshot,
    reflectionMoralPortrait: moralPortrait,
    reflectionJudgment,
    reflectionThesisGate: thesisGate,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: [
      "render_reflection_judgment_thesis",
      "apply_reflection_thesis_gate",
    ],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };

  const badText =
    "Hathor's first decan sꜣḥ asked for stability regained. One recurring body-care promise appeared through the decan without a confirmed mark, which means the intention was present. The vitamin support needs a better recording rhythm. Where will you log this check tomorrow?";
  const badValidation = validateGeneratedTextAgainstPlan(plan, badText);
  const badGrade = gradeGeneratedTextAgainstPlan(
    plan,
    badText,
    badValidation,
  );

  assert(
    badValidation.warnings.includes("evidence_anchor_dominance_failure"),
  );
  assert(
    badValidation.warnings.includes("nutrition_visible_topic_failure"),
  );
  assert(badValidation.warnings.includes("habit_question_failure"));
  assertEquals(badGrade.evidenceAnchorDominanceScore, 2);
  assertEquals(badGrade.nutritionVisibleTopicScore, 2);
  assertEquals(badGrade.habitQuestionScore, 2);
  assertEquals(badGrade.pass, false);

  const goodText =
    "Hathor's first decan sꜣḥ asked for stability regained: not the appearance of order, but care restored to a truthful form the day can hold. You are seeking care that can become real order; Ma'at's measure means right size, a promise small enough to keep without pressure. Your heart kept returning toward preservation, and restoration asks that care to take one clear place in your day. What care are you willing to make truly keepable?";
  const goodValidation = validateGeneratedTextAgainstPlan(plan, goodText);
  const goodGrade = gradeGeneratedTextAgainstPlan(
    plan,
    goodText,
    goodValidation,
  );

  assertEquals(
    goodValidation.warnings.includes("no_evidence_anchor_literal_match"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("evidence_anchor_dominance_failure"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("nutrition_visible_topic_failure"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("reflection_plain_language_failure"),
    false,
  );
  assertEquals(goodGrade.evidenceAnchorDominanceScore, 5);
  assertEquals(goodGrade.nutritionVisibleTopicScore, 5);
});

Deno.test("reflection validator rejects coded Ma'at language without plain translation", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
  });
  const arcPlan = buildReflectionArcPlan({ calendarFrame, alignmentMap });
  const snapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const moralPortrait = buildFallbackReflectionMoralPortrait({
    calendarFrame,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const reflectionJudgment = buildFallbackReflectionJudgment({
    calendarFrame,
    moralPortrait,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_plainly",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 0,
    closingInstruction: reflectionJudgment.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      snapshot.bestEvidenceAnchor?.claim ?? "one care reminder kept returning",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: { maxNamedEvidenceMentions: 1 },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap: alignmentMap,
    reflectionProfileSnapshot: snapshot,
    reflectionMoralPortrait: moralPortrait,
    reflectionJudgment,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: ["translate_maat_into_plain_language"],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };

  const codedText =
    "Hathor's first decan sꜣḥ called for stability regained, where written witness and embodied order could carry truth forward. The act and account had not yet met, so the account cannot prove what life accomplished. Alignment is visible wherever measure was made visible, while underalignment remains in witnessed action still dependent on inference. What mark will make the next reflection less dependent on inference?";
  const codedValidation = validateGeneratedTextAgainstPlan(plan, codedText);
  const codedGrade = gradeGeneratedTextAgainstPlan(
    plan,
    codedText,
    codedValidation,
  );

  assert(codedValidation.warnings.includes(
    "reflection_plain_language_failure",
  ));
  assert(codedValidation.warnings.includes(
    "reflection_account_language_failure",
  ));
  assert(codedValidation.warnings.includes(
    "reflection_direct_address_missing",
  ));
  assertEquals(codedGrade.pass, false);

  const plainText =
    "Hathor's first decan sꜣḥ asked for stability regained: care returning to a truthful form the day can hold. You are seeking care that can become real order, and Ma'at's measure means right size: a promise small enough to keep without pressure. Your heart kept returning toward preservation, and restoration asks that care to take one clear place in your day. What care are you willing to make truly keepable?";
  const plainValidation = validateGeneratedTextAgainstPlan(plan, plainText);

  assertEquals(
    plainValidation.warnings.includes("reflection_plain_language_failure"),
    false,
  );
  assertEquals(
    plainValidation.warnings.includes("reflection_account_language_failure"),
    false,
  );
  assertEquals(
    plainValidation.warnings.includes("reflection_direct_address_missing"),
    false,
  );
});

Deno.test("reflection validator rejects system-serving evidence repair instead of moral portrait", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
  });
  const arcPlan = buildReflectionArcPlan({ calendarFrame, alignmentMap });
  const snapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "truthful_record.titles_only",
    selectedOffering: "record_what_was_done",
  });
  const moralPortrait = buildFallbackReflectionMoralPortrait({
    calendarFrame,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const reflectionJudgment = buildFallbackReflectionJudgment({
    calendarFrame,
    moralPortrait,
    profileSnapshot: snapshot,
    normalizedObligationThreads,
    alignmentMap,
    arcPlan,
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_as_orientation_not_observability",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 0,
    closingInstruction: reflectionJudgment.closingText,
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      snapshot.bestEvidenceAnchor?.claim ?? "one care reminder kept returning",
    ], { prefix: "reflection", required: false }),
    evidenceUsePolicy: { maxNamedEvidenceMentions: 1 },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap: alignmentMap,
    reflectionProfileSnapshot: snapshot,
    reflectionMoralPortrait: moralPortrait,
    reflectionJudgment,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: ["serve_reflection_moral_portrait"],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };

  const badText =
    "Hathor's first decan sꜣḥ asked for stability regained. Your record needs enough detail so the next reflection has less guesswork. The improvement direction is to make one mark that proves what happened.";
  const badValidation = validateGeneratedTextAgainstPlan(plan, badText);
  const badGrade = gradeGeneratedTextAgainstPlan(
    plan,
    badText,
    badValidation,
  );

  assert(badValidation.warnings.includes("system_need_leak_failure"));
  assert(badValidation.warnings.includes("portrait_before_directive_failure"));
  assertEquals(badGrade.breathToNoseScore, 2);
  assertEquals(badGrade.pass, false);

  const goodText =
    "Hathor's first decan sꜣḥ asked for stability regained: the return of care to a form the day can hold. You are seeking care that can become real order, and your heart is pointing toward truth rather than pressure. Ma'at's measure means right size; restoration asks you to name what moved so your next step can stand on what is real. What care are you willing to make truly keepable?";
  const goodValidation = validateGeneratedTextAgainstPlan(plan, goodText);
  const goodGrade = gradeGeneratedTextAgainstPlan(
    plan,
    goodText,
    goodValidation,
  );

  assertEquals(
    goodValidation.warnings.includes("system_need_leak_failure"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("portrait_before_directive_failure"),
    false,
  );
  assertEquals(goodGrade.moralPortraitPresentScore, 5);
  assertEquals(goodGrade.portraitBeforeDirectiveScore, 5);
  assertEquals(goodGrade.serudjOrientationScore, 5);
});

Deno.test("reflection validator keeps person and serudj directive as protagonist", () => {
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const moralPortrait = {
    version: "reflection_moral_portrait_v1" as const,
    source: "deterministic" as const,
    decanCall: "Hathor's first decan sꜣḥ called for stability regained.",
    sacredDimension:
      "Your heart turns toward care, and the sacred question is whether your own life remains included in that care.",
    relationalDimension:
      "Care for others is visible, but reciprocity asks that giving not erase the keeper.",
    naturalDimension:
      "Your body and time are part of the created order; they cannot be treated as endless supply.",
    heartSignal:
      "Your heart is generous, but Ma'at asks generosity to stay in right relation with self-preservation.",
    serudjCall:
      "Restore the place where your own maintenance belongs inside the care you give outward.",
    geruMaaOrientation:
      "Composure means giving without disappearing inside the giving.",
    portraitStatement:
      "You are moving as a keeper of care. This decan asks that care to become reciprocal: what you give outward must also leave you with enough life to stand whole.",
    personBecomingStatement:
      "You tend outward before returning inward; serudj asks for proportion between giving and self-return.",
    serudjDirective:
      "Return one act of care inward so proportion is restored between what you give and what you keep.",
    forbiddenFramings: [
      "next reflection",
      "less guesswork",
      "record tells the truth",
      "mark of care",
    ],
  };
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_as_person_centered_restoration",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 0,
    closingInstruction:
      "What act of care, tended for yourself today, would restore proportion between what you give and what you keep?",
    evidenceAnchors: [],
    reflectionCalendarFrame: calendarFrame,
    reflectionMoralPortrait: moralPortrait,
    rhetoricalMoves: ["serve_reflection_moral_portrait"],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };

  const badText =
    "Hathor's first decan sꜣḥ called for stability regained. Your acts and your written record drift apart, so one mark of care can complete today what your record needs to tell the truth. What one mark of care can you complete today so your record can match what you actually lived?";
  const badValidation = validateGeneratedTextAgainstPlan(plan, badText);
  const badGrade = gradeGeneratedTextAgainstPlan(
    plan,
    badText,
    badValidation,
  );

  assert(badValidation.warnings.includes("record_protagonist_failure"));
  assert(
    badValidation.warnings.includes("portrait_directive_continuity_failure"),
  );
  assertEquals(badGrade.recordProtagonistScore, 2);
  assertEquals(badGrade.portraitDirectiveContinuityScore, 2);
  assertEquals(badGrade.pass, false);

  const goodText =
    "Hathor's first decan sꜣḥ called for stability regained: the return of care to a form that can hold after disruption. You tend outward before returning inward, and Ma'at's measure means proportion between what you give and what you keep. Care is present; restoration asks that one act return toward your own center without becoming another burden. What act of care, tended for yourself today, would restore proportion between what you give outward and what you keep inward?";
  const goodValidation = validateGeneratedTextAgainstPlan(plan, goodText);
  const goodGrade = gradeGeneratedTextAgainstPlan(
    plan,
    goodText,
    goodValidation,
  );

  assertEquals(
    goodValidation.warnings.includes("record_protagonist_failure"),
    false,
  );
  assertEquals(
    goodValidation.warnings.includes("person_as_protagonist_failure"),
    false,
  );
  assertEquals(goodGrade.personAsProtagonistScore, 5);
  assertEquals(goodGrade.recordProtagonistScore, 5);
  assertEquals(goodGrade.serudjDirectiveFitScore, 5);

  const scaffoldText =
    "Hathor's first decan sꜣḥ called for stability regained. Where you answered this decan's call, your care moved toward what needed tending. Where restoration is still needed, the alignment is returning inward. What would it look like to give yourself the same care?";
  const scaffoldValidation = validateGeneratedTextAgainstPlan(
    plan,
    scaffoldText,
  );
  const scaffoldGrade = gradeGeneratedTextAgainstPlan(
    plan,
    scaffoldText,
    scaffoldValidation,
  );

  assert(scaffoldValidation.warnings.includes("rubric_leakage_failure"));
  assert(scaffoldValidation.warnings.includes("portrait_continuity_failure"));
  assert(scaffoldValidation.warnings.includes("poignancy_failure"));
  assertEquals(scaffoldGrade.portraitContinuityScore, 2);
  assertEquals(scaffoldGrade.poignancyScore, 3);
  assertEquals(scaffoldGrade.pass, false);

  const denseText =
    "Hathor's first decan sꜣḥ called for stability regained through sacred weight, Ma'at, truth, witness, measure, order, alignment, restoration, becoming, continuity, and trustworthy witness. The integration into order asks for inner knowing and outer action to become confirmed place through embodied order. What would it look like to check the record?";
  const denseValidation = validateGeneratedTextAgainstPlan(plan, denseText);
  const denseGrade = gradeGeneratedTextAgainstPlan(
    plan,
    denseText,
    denseValidation,
  );

  assert(denseValidation.warnings.includes("abstraction_stack_failure"));
  assert(
    denseValidation.warnings.includes("overwritten_spiritual_language_failure"),
  );
  assert(denseValidation.warnings.includes("muddled_progression_failure"));
  assert(denseValidation.warnings.includes("unclear_directive_failure"));
  assertEquals(denseGrade.oneIdeaAtATimeScore, 2);
  assertEquals(denseGrade.readabilityScore, 2);
  assertEquals(denseGrade.pass, false);

  const screenshotStyleText =
    "Hathor's first decan sꜣḥ calls you to step back onto the earth and restore the house through simple, honest witness.\n\nYour care flows outward steadily while your own tending remains unmarked, and the heart seeks one clear mark that can stand as true.\n\nMark one act of care for your body today with the same truth you bring to caring for others.";
  const screenshotStyleValidation = validateGeneratedTextAgainstPlan(
    plan,
    screenshotStyleText,
  );
  assert(
    screenshotStyleValidation.warnings.includes("abstraction_stack_failure"),
  );
  assert(
    screenshotStyleValidation.warnings.includes("record_protagonist_failure"),
  );

  const continuousText =
    "Hathor's first decan sꜣḥ called for stability regained, and you are someone whose care already knows how to move toward what needs tending.\n\nThe quieter restoration is allowing that same presence to return inward, not as obligation but as sanctuary. Ma'at's measure asks for proportion between what you give and what you keep.\n\nWhat would it mean to tend yourself with the same presence you bring to those you love?";
  const continuousValidation = validateGeneratedTextAgainstPlan(
    plan,
    continuousText,
  );
  const continuousGrade = gradeGeneratedTextAgainstPlan(
    plan,
    continuousText,
    continuousValidation,
  );

  assertEquals(
    continuousValidation.warnings.includes("rubric_leakage_failure"),
    false,
  );
  assertEquals(
    continuousValidation.warnings.includes("portrait_continuity_failure"),
    false,
  );
  assertEquals(
    continuousValidation.warnings.includes("poignancy_failure"),
    false,
  );
  assertEquals(
    continuousValidation.warnings.includes("muddled_progression_failure"),
    false,
  );
  assertEquals(continuousGrade.portraitContinuityScore, 5);
  assertEquals(continuousGrade.poignancyScore, 5);
});

Deno.test("reflection grader fails habit advice without Ma'at lens interpretation", () => {
  const normalizedObligationThreads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const alignmentMap = buildReflectionAlignmentMap({
    calendarFrame,
    normalizedObligationThreads,
  });
  const arcPlan = buildReflectionArcPlan({ calendarFrame, alignmentMap });
  const snapshot = buildReflectionProfileSnapshot({
    normalizedObligationThreads,
    calendarFrame,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
  });
  const plan = {
    policyVersion: OUTPUT_CONTROL_POLICY_VERSION,
    kind: "decan_reflection" as const,
    speechAct: "witness" as const,
    intent: "synthesize_the_full_decan_and_charge_one_next_step",
    moralFrame: "maat_order_seen_through_calendar_profile_and_evidence",
    emotionalTemperature: "medium" as const,
    targetWordRange: "75-130",
    requiredEvidenceDetailCount: 1,
    closingInstruction: arcPlan.closingText,
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    evidenceAnchors: evidenceAnchorsFromMemoryPhrases([
      snapshot.bestEvidenceAnchor?.claim ?? "one recurring support thread",
    ], { prefix: "reflection", required: true }),
    evidenceUsePolicy: { maxNamedEvidenceMentions: 1 },
    normalizedObligationThreads,
    reflectionCalendarFrame: calendarFrame,
    reflectionAlignmentMap: alignmentMap,
    reflectionProfileSnapshot: snapshot,
    reflectionArcPlan: arcPlan,
    rhetoricalMoves: ["maat_alignment_lens_governs"],
    surfaceConstraints: {
      wordsMin: 5,
      wordsMax: 150,
      sentencesMax: 6,
      bannedPhrases: DEFAULT_OUTPUT_BANNED_PHRASES,
      hiddenTerms: ["score", "matrix"],
    },
  };
  const badText =
    "Hathor's first decan sꜣḥ asked for stability regained. The vitamin check kept coming back, so the habit needs a better recording rhythm and a reliable moment to track it. Put the check after one meal and complete it there.";
  const validation = validateGeneratedTextAgainstPlan(plan, badText);
  const grade = gradeGeneratedTextAgainstPlan(plan, badText, validation);

  assert(validation.warnings.includes("missing_maat_lens_failure"));
  assert(validation.warnings.includes("habit_topic_dominance_failure"));
  assertEquals(grade.maatLensGovernsScore, 2);
  assertEquals(grade.habitSubordinationScore, 2);
  assertEquals(grade.pass, false);
});
