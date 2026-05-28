import type {
  MaatAxisCode,
  MaatDimensionSnapshot,
} from "../ai_generate_reflection/maat_decision.ts";
import type { MaatLedgerField } from "./maat_ledger.ts";
import type {
  MaatNormalizedObligationThreads,
  MaatNutritionThreadProblem,
} from "./maat_obligation_threads.ts";
import {
  type MaatOutputExample,
  selectMaatOutputExample,
} from "./maat_output_examples.ts";

export const MAAT_SITUATION_INTERPRETER_VERSION =
  "maat_situation_interpreter_calculus_v1";

export type MaatOfferingKind =
  | "commit_today"
  | "focus_reminder"
  | "reduce_obligations"
  | "reduce_and_complete_one"
  | "consolidate_sources"
  | "merge_records"
  | "honor_batch"
  | "revisit_and_refit"
  | "record_what_was_done"
  | "open_support_flow"
  | "release_unrealistic_target"
  | "release_without_guilt"
  | "prune"
  | "reschedule"
  | "restart_streak"
  | "triage_by_consequence"
  | "anchor_one_thing"
  | "habit_stack"
  | "refresh"
  | "stabilize_floor"
  | "separate_accounts"
  | "set_finish_condition"
  | "finish_condition"
  | "write_record"
  | "protect_rhythm"
  | "orient"
  | "inquire"
  | "witness"
  | "fortify";

export type MaatCaseKey =
  | "provision.single_open_check"
  | "provision.repeated_open_checks"
  | "provision.overloaded_schedule"
  | "provision.scattered_sources"
  | "provision.completed_not_logged"
  | "provision.no_recent_completion"
  | "provision.aspirational_items"
  | "provision.schedule_conflict"
  | "provision.reactive_list"
  | "provision.consolidation_candidate"
  | "provision.batch_behavior"
  | "provision.completed_for_others"
  | "provision.stale_growing_list"
  | "provision.capacity_mismatch"
  | "provision.staleness_signal"
  | "provision.feast_famine"
  | "provision.clinical_mixed"
  | "provision.habit_stack_candidate"
  | "provision.prior_correction_unresolved"
  | "provision.good_pattern_needs_protection"
  | "visible_work.single_open_task"
  | "visible_work.too_many_open_loops"
  | "visible_work.no_finish_condition"
  | "visible_work.repeated_deferral"
  | "visible_work.started_not_closed"
  | "visible_work.prior_commitment_unresolved"
  | "visible_work.stale_growing_list"
  | "visible_work.good_pattern_needs_protection"
  | "truthful_record.low_signal"
  | "truthful_record.titles_only"
  | "truthful_record.vague_entries"
  | "truthful_record.record_after_action_missing"
  | "truthful_record.inconsistent_coverage"
  | "rhythm.anchor_missing"
  | "rhythm.anchor_present_needs_protection"
  | "rhythm.decan_opener_missed"
  | "rhythm.recovery_after_break"
  | "rhythm.good_pattern_needs_protection"
  | "restraint.force_exceeds_measure"
  | "restraint.too_many_commitments"
  | "restraint.repeated_overcommit"
  | "care.support_thread_open"
  | "care.self_care_displaced"
  | "speech.promise_unresolved"
  | "speech.conflict_unresolved"
  | "order.sequence_blocked"
  | "release.overcommitted"
  | "release.stale_obligation"
  | "attention.scattered_inputs"
  | "attention.single_thread_depth"
  | "study.retention_missing"
  | "study.application_gap"
  | "craft.piece_unfinished";

export type MaatBaselineDeviation =
  | "above_baseline"
  | "on_baseline"
  | "below_baseline"
  | "sharp_decline"
  | "sharp_improvement"
  | "first_decan";

export type MaatVoiceDirection = {
  register: "sacred" | "practical" | "relational" | "witnessing";
  temperatureHint: "warm" | "direct" | "gentle" | "grounding";
  leadWith: "situation" | "pattern" | "meaning" | "question";
  closeWith: "principle" | "question" | "permission" | "invitation";
  sentenceBudget: number;
};

export type MaatCalculusSignals = {
  highHistory: boolean;
  aboveBaseline: boolean;
  lowConfidence: boolean;
  effectiveNutritionLoad: number;
  disruptionSignal: boolean;
  transitionSignal: boolean;
  stalenessSignal: boolean;
  caretakingSignal: boolean;
  nutrientOverlap: boolean;
  smoothieSignal: boolean;
  batchPattern: boolean;
  dualTracking: boolean;
  scheduleConflict: boolean;
  itemsCreatedSameDate: boolean;
  aspirationalItems: boolean;
  listGrowing: boolean;
  completionDeclining: boolean;
  feastFamine: boolean;
  clinicalMixed: boolean;
  habitStackCandidate: boolean;
  obligationThreads: MaatNormalizedObligationThreads | null;
  nutritionUniqueOpenCount: number;
  nutritionOpenOccurrenceCount: number;
  nutritionSameItemRepeated: boolean;
  nutritionSameDayCollision: boolean;
  nutritionDominantProblem: MaatNutritionThreadProblem | "none";
};

export type MaatSituationDefinition = {
  key: MaatCaseKey;
  field: MaatLedgerField;
  humanLabel: string;
  inputPattern: string;
  maatMeaning: string;
  userTranslation: string;
  likelyUserCondition: string;
  risk: string;
  offeringCandidates: MaatOfferingKind[];
  defaultOffering: MaatOfferingKind;
  userFacingDiagnosis: string;
  concreteAction: string;
  forbiddenGenericPhrases: string[];
  axisCodes: MaatAxisCode[];
  ctaHint: "flow" | "planner" | "journal" | "none";
  voiceDirection?: Partial<MaatVoiceDirection>;
  resolutionCondition?: string;
};

export type MaatSituationInterpretation = MaatSituationDefinition & {
  version: typeof MAAT_SITUATION_INTERPRETER_VERSION;
  caseConcreteAction: string;
  selectedOffering: MaatOfferingKind;
  whyThisOfferingWon: string;
  evidenceDensity: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  sourceCounts: {
    todoPending: number;
    todoSkipped: number;
    todoDone: number;
    nutritionPending: number;
    nutritionSkipped: number;
    nutritionDone: number;
  };
  baselineDeviation: MaatBaselineDeviation;
  calculusSignals: MaatCalculusSignals;
  voiceDirection: MaatVoiceDirection;
  resolutionCondition: string;
  exampleReference: MaatOutputExample | null;
  renderContract: MaatOfferingRenderContract;
};

export type MaatOfferingRenderContract = {
  version: typeof MAAT_SITUATION_INTERPRETER_VERSION;
  caseKey: MaatCaseKey;
  offering: MaatOfferingKind;
  diagnosis: string;
  concreteAction: string;
  caseConcreteAction: string;
  offeringRationale: string;
  exampleId: string | null;
  exampleNudge: string | null;
  exampleReflection: string | null;
  voiceDirection: MaatVoiceDirection;
  bannedPhrases: string[];
  resolutionCondition: string;
};

type InterpretParams = {
  snapshot: MaatDimensionSnapshot;
  mode: "drift" | "strength";
  triggerReason?: string | null;
  evidencePhrases?: string[];
  personalBaseline?: {
    snapshotCount?: number;
    nutritionDoneRate?: number | null;
    medianScore?: number | null;
    medianBandRank?: number | null;
  } | null;
};

const FIELD_GENERIC_PHRASES = [
  "provision is the ground",
  "provision steadies",
  "tend to provision",
  "restore measure",
  "restore ma'at",
  "visible work needs",
  "truth becomes useful",
  "rhythm returns",
  "one small question",
  "record it plainly",
  "record plainly",
  "right measure makes",
  "in ma'at terms",
  "not failure",
  "not a failure",
];

const CASES: Partial<Record<MaatCaseKey, MaatSituationDefinition>> = {
  "provision.single_open_check": {
    key: "provision.single_open_check",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "one open nutrition/body-support check",
    maatMeaning: "a single provision obligation is open and can still be kept",
    userTranslation: "the user needs recommitment, not a full reset",
    likelyUserCondition: "one support mark slipped outside the current line",
    risk: "turning one open mark into a heavier story than it deserves",
    offeringCandidates: ["commit_today", "open_support_flow"],
    defaultOffering: "commit_today",
    userFacingDiagnosis: "One nutrition check is open.",
    concreteAction:
      "Complete that check today and mark the finish with one clean detail.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "H", "M"],
    ctaHint: "flow",
  },
  "provision.repeated_open_checks": {
    key: "provision.repeated_open_checks",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "one nutrition support repeats before it is kept",
    maatMeaning:
      "a recurring provision obligation is returning before its recording rhythm exists",
    userTranslation:
      "the current nutrition promise may need a better anchor, lower recurrence, or easier mark",
    likelyUserCondition:
      "one support is being scheduled more often than it is being recorded",
    risk: "mistaking one recurring item for several separate supports",
    offeringCandidates: [
      "reschedule",
      "reduce_obligations",
      "open_support_flow",
    ],
    defaultOffering: "reschedule",
    userFacingDiagnosis: "The same support mark keeps returning unclosed.",
    concreteAction:
      "Reduce the recurrence, attach the mark to one meal, or record it immediately after use.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "H", "R"],
    ctaHint: "flow",
  },
  "provision.overloaded_schedule": {
    key: "provision.overloaded_schedule",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "many nutrition obligations open in the same decan",
    maatMeaning: "body support is over-specified and under-kept",
    userTranslation:
      "the user may be carrying too many separate nutrition obligations",
    likelyUserCondition: "tracking friction is stronger than the provision act",
    risk: "more targets making order harder to keep",
    offeringCandidates: [
      "reduce_and_complete_one",
      "consolidate_sources",
      "merge_records",
      "release_unrealistic_target",
      "focus_reminder",
      "anchor_one_thing",
    ],
    defaultOffering: "reduce_and_complete_one",
    userFacingDiagnosis: "The list is larger than the routine right now.",
    concreteAction:
      "Keep one support that fits how you actually eat today, and let one nonessential target wait until next decan.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "M", "R"],
    ctaHint: "planner",
  },
  "provision.scattered_sources": {
    key: "provision.scattered_sources",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "multiple nutrition sources are open together",
    maatMeaning: "provision is fragmented across too many small supports",
    userTranslation:
      "the user may need consolidation before more completion pressure",
    likelyUserCondition: "separate support marks are competing for attention",
    risk: "fragmentation turning care into friction",
    offeringCandidates: ["consolidate_sources", "commit_today"],
    defaultOffering: "consolidate_sources",
    userFacingDiagnosis:
      "Body support is split across more marks than the day needs.",
    concreteAction:
      "Choose one nutrition source that covers the most ground today and leave the smaller supports for later.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "E", "R"],
    ctaHint: "flow",
  },
  "provision.completed_not_logged": {
    key: "provision.completed_not_logged",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "evidence suggests nutrition happened but the check is open",
    maatMeaning: "the act and the account are out of step",
    userTranslation: "the user may need to reconcile the record, not do more",
    likelyUserCondition: "action may be ahead of logging",
    risk: "false disorder caused by an incomplete account",
    offeringCandidates: ["record_what_was_done"],
    defaultOffering: "record_what_was_done",
    userFacingDiagnosis: "The act may be ahead of the record.",
    concreteAction:
      "Mark what was actually completed today so the account matches the act.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["T", "M", "S"],
    ctaHint: "journal",
  },
  "provision.no_recent_completion": {
    key: "provision.no_recent_completion",
    field: "provision",
    humanLabel: "body support",
    inputPattern:
      "nutrition obligations exist but no recent completion appears",
    maatMeaning: "provision needs a supported return, not a larger demand",
    userTranslation: "the user may need structure before another direct ask",
    likelyUserCondition: "body support has lost its practical foothold",
    risk: "asking for completion when support structure is missing",
    offeringCandidates: ["open_support_flow", "commit_today"],
    defaultOffering: "open_support_flow",
    userFacingDiagnosis:
      "Body support has no recent completed mark to stand on.",
    concreteAction:
      "Use a short provision flow, then complete one nutrition check inside that structure.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "H", "E"],
    ctaHint: "flow",
  },
  "provision.aspirational_items": {
    key: "provision.aspirational_items",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "nutrition items were created earlier but never began",
    maatMeaning:
      "some obligations belong to a future practice, not the active account",
    userTranslation: "the user needs release before another completion ask",
    likelyUserCondition:
      "the list is preserving intention longer than practice",
    risk: "aspiration masquerading as current obligation",
    offeringCandidates: ["release_unrealistic_target"],
    defaultOffering: "release_unrealistic_target",
    userFacingDiagnosis:
      "Some nutrition targets belong to a future routine, not the active one.",
    concreteAction:
      "Release one support target that has not begun, then keep the mark that already belongs to your real day.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "R", "J"],
    ctaHint: "planner",
  },
  "provision.schedule_conflict": {
    key: "provision.schedule_conflict",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "nutrition timing conflicts with the user's schedule",
    maatMeaning: "the structure fights the practice",
    userTranslation: "the user needs a schedule repair rather than more force",
    likelyUserCondition: "the act is possible, but it sits in the wrong window",
    risk: "calling a structural mismatch a motivation problem",
    offeringCandidates: ["reschedule"],
    defaultOffering: "reschedule",
    userFacingDiagnosis: "The schedule is fighting the practice.",
    concreteAction:
      "Move the support mark to the window where it can actually happen, then close it there.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "M", "E"],
    ctaHint: "planner",
  },
  "provision.reactive_list": {
    key: "provision.reactive_list",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "a large nutrition list was created in one reactive moment",
    maatMeaning: "the list may be carrying the shape of a past pressure",
    userTranslation: "the user needs to refit the list to current reality",
    likelyUserCondition: "the original urgency has shifted",
    risk: "keeping old urgency inside a new routine",
    offeringCandidates: ["revisit_and_refit", "release_unrealistic_target"],
    defaultOffering: "revisit_and_refit",
    userFacingDiagnosis:
      "The nutrition list may still carry the shape of an earlier pressure.",
    concreteAction:
      "Choose one target that still fits your body now, and release one that was built for a past moment.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "T", "R"],
    ctaHint: "planner",
  },
  "provision.consolidation_candidate": {
    key: "provision.consolidation_candidate",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "multiple nutrition marks cover overlapping support",
    maatMeaning: "the record is more granular than the practice",
    userTranslation: "the user needs a smaller tracking surface",
    likelyUserCondition: "one act is being split into many marks",
    risk: "accuracy turning into friction",
    offeringCandidates: ["merge_records", "consolidate_sources"],
    defaultOffering: "merge_records",
    userFacingDiagnosis:
      "One act of care is being split across more rows than it needs.",
    concreteAction:
      "Merge the overlapping checks into one real support mark, then close that mark today.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "M", "R"],
    ctaHint: "planner",
  },
  "provision.batch_behavior": {
    key: "provision.batch_behavior",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "nutrition completion appears in batches rather than daily",
    maatMeaning: "the practice has a batch rhythm",
    userTranslation: "the user should design for the rhythm they actually keep",
    likelyUserCondition: "daily tracking is fighting a batch pattern",
    risk: "mistaking batching for neglect",
    offeringCandidates: ["honor_batch"],
    defaultOffering: "honor_batch",
    userFacingDiagnosis:
      "The provision practice appears to run in batches, not daily increments.",
    concreteAction:
      "Set one dedicated provision window and close the support marks inside that window.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "E", "M"],
    ctaHint: "planner",
  },
  "provision.completed_for_others": {
    key: "provision.completed_for_others",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "the nutrition list appears to include another person's care",
    maatMeaning: "one account is holding more than one body",
    userTranslation:
      "the user needs account boundaries before completion pressure",
    likelyUserCondition:
      "care for others is muddying the user's own provision record",
    risk: "measuring another person's obligation as the user's disorder",
    offeringCandidates: ["separate_accounts"],
    defaultOffering: "separate_accounts",
    userFacingDiagnosis:
      "Some support marks may belong to another person's account.",
    concreteAction:
      "Separate what belongs to your body from what belongs to someone else's care, then close one mark that is yours.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "V", "J"],
    ctaHint: "planner",
  },
  "provision.stale_growing_list": {
    key: "provision.stale_growing_list",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "the nutrition list keeps growing while completion falls",
    maatMeaning: "the account is accumulating faster than it is being kept",
    userTranslation: "the user needs pruning before adding another target",
    likelyUserCondition: "the list is becoming comprehensive instead of usable",
    risk: "more intention producing less order",
    offeringCandidates: ["prune"],
    defaultOffering: "prune",
    userFacingDiagnosis:
      "The provision list is growing faster than the practice can keep.",
    concreteAction:
      "Remove one support target before adding anything else, then keep one remaining mark cleanly.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "R", "M"],
    ctaHint: "planner",
  },
  "provision.capacity_mismatch": {
    key: "provision.capacity_mismatch",
    field: "provision",
    humanLabel: "body support",
    inputPattern:
      "external load or transition appears alongside a heavy nutrition list",
    maatMeaning: "the practice has outgrown current capacity",
    userTranslation: "the user needs permission to shrink the load",
    likelyUserCondition: "life load is heavier than the current obligation set",
    risk: "forcing a full routine through reduced capacity",
    offeringCandidates: ["release_without_guilt", "anchor_one_thing"],
    defaultOffering: "release_without_guilt",
    userFacingDiagnosis:
      "The body-support load is heavier than the current ground can carry.",
    concreteAction:
      "Keep the easiest support mark today and release the rest of the nutrition load for this decan.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "H", "R"],
    ctaHint: "planner",
  },
  "provision.staleness_signal": {
    key: "provision.staleness_signal",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "strong history with boredom or stale-stack language",
    maatMeaning: "the practice may need renewal rather than correction",
    userTranslation:
      "the user needs freshness inside an otherwise working rhythm",
    likelyUserCondition: "interest has drained from a stable practice",
    risk: "treating staleness as drift",
    offeringCandidates: ["refresh"],
    defaultOffering: "refresh",
    userFacingDiagnosis:
      "The support rhythm may be sound, but the stack has gone stale.",
    concreteAction:
      "Swap one support item for something that still serves the body and renews the practice.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "E", "C"],
    ctaHint: "planner",
  },
  "provision.feast_famine": {
    key: "provision.feast_famine",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "completion swings between high intensity and quiet periods",
    maatMeaning: "the floor is missing beneath the practice",
    userTranslation: "the user needs a minimum viable mark",
    likelyUserCondition: "motivation is carrying the ceiling but not the floor",
    risk: "waiting for energy before the account can resume",
    offeringCandidates: ["stabilize_floor"],
    defaultOffering: "stabilize_floor",
    userFacingDiagnosis:
      "The provision record appears to run in cycles: full, then empty.",
    concreteAction:
      "Choose the smallest useful support mark and complete it today as the floor.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "E", "R"],
    ctaHint: "planner",
  },
  "provision.clinical_mixed": {
    key: "provision.clinical_mixed",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "health-critical and wellness marks are mixed together",
    maatMeaning: "not every support mark carries equal consequence",
    userTranslation: "the user needs triage, not a flat list",
    likelyUserCondition: "high-stakes support is mixed with optional support",
    risk: "treating all open marks as equal",
    offeringCandidates: ["triage_by_consequence"],
    defaultOffering: "triage_by_consequence",
    userFacingDiagnosis:
      "Not every body-support mark carries the same consequence.",
    concreteAction:
      "Complete the health-critical support first, then decide what else has room today.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "H", "J"],
    ctaHint: "flow",
  },
  "provision.habit_stack_candidate": {
    key: "provision.habit_stack_candidate",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "other rhythms hold while nutrition floats unanchored",
    maatMeaning: "the missing support needs an entry point",
    userTranslation: "the user should attach provision to an existing anchor",
    likelyUserCondition: "the issue is attachment, not effort",
    risk: "adding a floating obligation to an otherwise working routine",
    offeringCandidates: ["habit_stack"],
    defaultOffering: "habit_stack",
    userFacingDiagnosis:
      "The support mark is floating outside the rhythm that already holds.",
    concreteAction:
      "Attach one nutrition mark to a habit you already keep, and close it when that anchor fires.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "E", "C"],
    ctaHint: "planner",
  },
  "provision.prior_correction_unresolved": {
    key: "provision.prior_correction_unresolved",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "a prior provision restoration was acted on but not resolved",
    maatMeaning: "the restoration was accepted but the obligation stayed open",
    userTranslation:
      "the next correction should reduce scope instead of repeating the same ask",
    likelyUserCondition: "the user is willing, but the step is mismatched",
    risk: "turning willingness into fatigue",
    offeringCandidates: ["reduce_obligations", "release_unrealistic_target"],
    defaultOffering: "reduce_obligations",
    userFacingDiagnosis:
      "The provision repair was touched, but the account stayed open.",
    concreteAction:
      "Reduce the nutrition promise to one support you can keep today, or release the target that no longer fits this decan.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "R", "J"],
    ctaHint: "planner",
  },
  "provision.good_pattern_needs_protection": {
    key: "provision.good_pattern_needs_protection",
    field: "provision",
    humanLabel: "body support",
    inputPattern: "provision is being kept",
    maatMeaning: "body support is already inside order",
    userTranslation: "the user needs reinforcement, not a new demand",
    likelyUserCondition: "a useful support rhythm is forming",
    risk: "overloading a working pattern",
    offeringCandidates: ["protect_rhythm"],
    defaultOffering: "protect_rhythm",
    userFacingDiagnosis: "Body support is holding its place.",
    concreteAction:
      "Protect the current support rhythm and keep new weight off it today.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["S", "H", "R"],
    ctaHint: "none",
  },
  "visible_work.single_open_task": {
    key: "visible_work.single_open_task",
    field: "visible_work",
    humanLabel: "visible work",
    inputPattern: "one open task",
    maatMeaning: "one material obligation needs closure",
    userTranslation: "the next restoration is a finish line, not motivation",
    likelyUserCondition: "one task remains available for clean completion",
    risk: "letting one open loop blur the rest of the day",
    offeringCandidates: ["set_finish_condition", "commit_today"],
    defaultOffering: "set_finish_condition",
    userFacingDiagnosis: "One visible task needs a clear edge.",
    concreteAction:
      "Name the finish condition, close that task today, and stop there.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "C", "S"],
    ctaHint: "planner",
  },
  "visible_work.too_many_open_loops": {
    key: "visible_work.too_many_open_loops",
    field: "visible_work",
    humanLabel: "visible work",
    inputPattern: "many tasks are open at once",
    maatMeaning: "work is leaking through too many unfinished endings",
    userTranslation: "the user needs reduction and one finish condition",
    likelyUserCondition: "the list is heavier than the available force",
    risk: "mistaking more options for more order",
    offeringCandidates: ["reduce_and_complete_one", "set_finish_condition"],
    defaultOffering: "reduce_and_complete_one",
    userFacingDiagnosis:
      "The burden is not one task; it is too many open endings.",
    concreteAction:
      "Choose the task with the clearest finish line, close that one, and let the rest wait.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "C", "R"],
    ctaHint: "planner",
  },
  "visible_work.no_finish_condition": {
    key: "visible_work.no_finish_condition",
    field: "visible_work",
    humanLabel: "visible work",
    inputPattern: "work exists without a clear completion edge",
    maatMeaning: "measure is missing from the obligation",
    userTranslation: "the user needs definition before effort",
    likelyUserCondition: "the task cannot close because the end is unnamed",
    risk: "labor expanding without due measure",
    offeringCandidates: ["set_finish_condition"],
    defaultOffering: "set_finish_condition",
    userFacingDiagnosis: "The work needs a finish line before more force.",
    concreteAction:
      "Write the condition that would make one task complete, then do only that.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "T", "C"],
    ctaHint: "planner",
  },
  "visible_work.repeated_deferral": {
    key: "visible_work.repeated_deferral",
    field: "visible_work",
    humanLabel: "visible work",
    inputPattern: "the same work is skipped or deferred repeatedly",
    maatMeaning: "a material obligation is not matching capacity",
    userTranslation: "the work may need a smaller shape or rightful release",
    likelyUserCondition: "the current task shape is too large or poorly timed",
    risk: "punishing the user with a task that cannot be kept as written",
    offeringCandidates: ["reduce_obligations", "release_unrealistic_target"],
    defaultOffering: "reduce_obligations",
    userFacingDiagnosis: "The work keeps returning in the same open form.",
    concreteAction:
      "Cut the task to its smallest useful piece, or release it if it no longer belongs this decan.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "R", "J"],
    ctaHint: "planner",
  },
  "visible_work.started_not_closed": {
    key: "visible_work.started_not_closed",
    field: "visible_work",
    humanLabel: "visible work",
    inputPattern: "partial work exists without closure",
    maatMeaning: "effort has begun but needs a closing mark",
    userTranslation: "the user needs completion, not expansion",
    likelyUserCondition: "momentum exists but has not been sealed",
    risk: "partial work multiplying into clutter",
    offeringCandidates: ["set_finish_condition"],
    defaultOffering: "set_finish_condition",
    userFacingDiagnosis: "The work has begun but lacks its closing mark.",
    concreteAction:
      "Finish one visible piece and record the exact condition that made it complete.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "C", "T"],
    ctaHint: "planner",
  },
  "visible_work.prior_commitment_unresolved": {
    key: "visible_work.prior_commitment_unresolved",
    field: "visible_work",
    humanLabel: "visible work",
    inputPattern: "a prior work restoration was acted on but not resolved",
    maatMeaning: "the accepted repair did not close the obligation",
    userTranslation:
      "the next offering should reduce the task or release it truthfully",
    likelyUserCondition: "the commitment needs a smaller vessel",
    risk: "engagement without resolution",
    offeringCandidates: ["reduce_obligations", "release_unrealistic_target"],
    defaultOffering: "reduce_obligations",
    userFacingDiagnosis:
      "The work repair was touched, but the loop stayed open.",
    concreteAction:
      "Reduce the task to one finish condition, or release the obligation cleanly.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "R", "J"],
    ctaHint: "planner",
  },
  "visible_work.good_pattern_needs_protection": {
    key: "visible_work.good_pattern_needs_protection",
    field: "visible_work",
    humanLabel: "visible work",
    inputPattern: "visible work is being closed",
    maatMeaning: "material obligations are finding clean edges",
    userTranslation: "the user needs protection of the working pattern",
    likelyUserCondition: "finish conditions are beginning to hold",
    risk: "widening the list before the rhythm is stable",
    offeringCandidates: ["protect_rhythm"],
    defaultOffering: "protect_rhythm",
    userFacingDiagnosis: "The work is finding clean edges.",
    concreteAction:
      "Protect the finish condition that is already working before adding another task.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "C", "R"],
    ctaHint: "none",
  },
  "truthful_record.low_signal": {
    key: "truthful_record.low_signal",
    field: "truthful_record",
    humanLabel: "honest record",
    inputPattern: "not enough evidence to weigh a concrete pattern",
    maatMeaning: "truthful order cannot be inferred without a trustworthy mark",
    userTranslation: "the user needs inquiry before correction",
    likelyUserCondition: "the account is too thin for a hard diagnosis",
    risk: "pretending certainty where the app has little evidence",
    offeringCandidates: ["write_record"],
    defaultOffering: "write_record",
    userFacingDiagnosis: "The record is too thin to weigh the pattern.",
    concreteAction:
      "Write one concrete detail from today before the day closes.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["T", "M"],
    ctaHint: "journal",
  },
  "truthful_record.vague_entries": {
    key: "truthful_record.vague_entries",
    field: "truthful_record",
    humanLabel: "honest record",
    inputPattern: "records exist but lack concrete detail",
    maatMeaning: "truth needs one detail that can be checked",
    userTranslation: "the user needs specificity, not more reflection",
    likelyUserCondition: "the account is present but too soft to guide action",
    risk: "a record that feels honest but cannot steer the next act",
    offeringCandidates: ["write_record"],
    defaultOffering: "write_record",
    userFacingDiagnosis: "The record exists, but it needs one harder detail.",
    concreteAction:
      "Add one number, time, or finish condition to today's mark.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["T", "M"],
    ctaHint: "journal",
  },
  "truthful_record.record_after_action_missing": {
    key: "truthful_record.record_after_action_missing",
    field: "truthful_record",
    humanLabel: "honest record",
    inputPattern: "action appears without a closing record",
    maatMeaning: "the act needs witness so it can teach the next day",
    userTranslation: "the user may be doing more than the account can show",
    likelyUserCondition: "completion is outpacing memory",
    risk: "losing useful proof of what works",
    offeringCandidates: ["record_what_was_done"],
    defaultOffering: "record_what_was_done",
    userFacingDiagnosis: "The action needs a witness mark.",
    concreteAction:
      "Record what actually happened, with one detail the next day can use.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["T", "M", "C"],
    ctaHint: "journal",
  },
  "rhythm.anchor_missing": {
    key: "rhythm.anchor_missing",
    field: "rhythm",
    humanLabel: "daily rhythm",
    inputPattern: "a repeated anchor is absent or inconsistent",
    maatMeaning: "flow needs one repeated point in time",
    userTranslation: "the user needs a repeatable anchor before expansion",
    likelyUserCondition: "timing is scattering the effort",
    risk: "variation replacing rhythm",
    offeringCandidates: ["protect_rhythm", "commit_today"],
    defaultOffering: "protect_rhythm",
    userFacingDiagnosis: "The day is missing one repeated anchor.",
    concreteAction:
      "Choose one act and give it the same time boundary for the next two days.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["E", "C", "M"],
    ctaHint: "planner",
  },
  "rhythm.good_pattern_needs_protection": {
    key: "rhythm.good_pattern_needs_protection",
    field: "rhythm",
    humanLabel: "daily rhythm",
    inputPattern: "a useful rhythm is visible",
    maatMeaning: "repetition is becoming order",
    userTranslation: "the user needs protection before more ambition",
    likelyUserCondition: "the anchor is working",
    risk: "overloading a living rhythm",
    offeringCandidates: ["protect_rhythm"],
    defaultOffering: "protect_rhythm",
    userFacingDiagnosis: "The rhythm is beginning to hold.",
    concreteAction:
      "Keep the same anchor today and do not add a second demand to it.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["E", "R", "C"],
    ctaHint: "none",
  },
  "restraint.force_exceeds_measure": {
    key: "restraint.force_exceeds_measure",
    field: "restraint",
    humanLabel: "restraint",
    inputPattern: "pressure or force appears larger than the useful measure",
    maatMeaning: "power needs proportion",
    userTranslation: "the user needs downshift before effort",
    likelyUserCondition: "the ask is becoming too forceful to keep well",
    risk: "excess turning effort into harm",
    offeringCandidates: ["reduce_obligations", "release_unrealistic_target"],
    defaultOffering: "reduce_obligations",
    userFacingDiagnosis:
      "The current demand is larger than the useful measure.",
    concreteAction:
      "Cut one demand by half before adding effort anywhere else.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["R", "H", "M"],
    ctaHint: "planner",
  },
  "care.support_thread_open": {
    key: "care.support_thread_open",
    field: "care",
    humanLabel: "care",
    inputPattern: "a care or support thread is open",
    maatMeaning: "care needs one kept support action",
    userTranslation: "the user needs one visible act of tending",
    likelyUserCondition: "a support obligation needs a small kept form",
    risk: "care staying abstract instead of becoming protection",
    offeringCandidates: ["commit_today", "set_finish_condition"],
    defaultOffering: "commit_today",
    userFacingDiagnosis: "One care thread needs a kept form.",
    concreteAction:
      "Choose one support action small enough to finish today and complete it.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["V", "H", "C"],
    ctaHint: "planner",
  },
  "speech.promise_unresolved": {
    key: "speech.promise_unresolved",
    field: "speech",
    humanLabel: "speech",
    inputPattern: "a word, promise, or message is unresolved",
    maatMeaning: "speech needs directness and a clean boundary",
    userTranslation: "the user needs to close or clarify one word",
    likelyUserCondition: "a communication thread is holding disorder open",
    risk: "silence or vagueness distorting the account",
    offeringCandidates: ["commit_today", "release_unrealistic_target"],
    defaultOffering: "commit_today",
    userFacingDiagnosis: "One word or promise is still unresolved.",
    concreteAction:
      "Send one direct message, or name the promise you are releasing.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["T", "C", "J"],
    ctaHint: "journal",
  },
  "order.sequence_blocked": {
    key: "order.sequence_blocked",
    field: "order",
    humanLabel: "order",
    inputPattern: "the next step is hidden by clutter or sequence",
    maatMeaning: "order needs placement before motion",
    userTranslation: "the user needs one thing put in its proper place",
    likelyUserCondition: "sequence is blocking flow",
    risk: "action starting before the path is clear",
    offeringCandidates: ["set_finish_condition", "commit_today"],
    defaultOffering: "set_finish_condition",
    userFacingDiagnosis: "The next step is hidden by clutter or sequence.",
    concreteAction:
      "Put one item, file, or task in its proper place before doing more.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "C", "S"],
    ctaHint: "planner",
  },
  "release.overcommitted": {
    key: "release.overcommitted",
    field: "release",
    humanLabel: "right release",
    inputPattern: "obligations exceed right measure",
    maatMeaning: "truth may require setting down what cannot be rightly kept",
    userTranslation: "the user needs release, not more pressure",
    likelyUserCondition: "the account is carrying more than the day can hold",
    risk: "false obligation crowding out real order",
    offeringCandidates: ["release_unrealistic_target", "reduce_obligations"],
    defaultOffering: "release_unrealistic_target",
    userFacingDiagnosis:
      "The account is carrying more than the day can rightly hold.",
    concreteAction:
      "Release one obligation that no longer fits, or reduce it to a single kept mark.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["R", "M", "J"],
    ctaHint: "planner",
  },
  "attention.scattered_inputs": {
    key: "attention.scattered_inputs",
    field: "attention",
    humanLabel: "attention",
    inputPattern: "attention is split across too many inputs",
    maatMeaning: "attention needs one boundary before force can gather",
    userTranslation: "the user needs a protected focus interval",
    likelyUserCondition: "context switching is weakening the first act",
    risk: "scatter becoming the day shape",
    offeringCandidates: ["set_finish_condition", "protect_rhythm"],
    defaultOffering: "set_finish_condition",
    userFacingDiagnosis: "Attention is split before the first mark is made.",
    concreteAction:
      "Choose one focus, set a visible boundary, and keep everything else outside it.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "R", "C"],
    ctaHint: "planner",
  },
  "study.retention_missing": {
    key: "study.retention_missing",
    field: "study",
    humanLabel: "study",
    inputPattern: "learning appears without a retained mark",
    maatMeaning: "knowledge needs one usable record",
    userTranslation: "the user needs retention, not more intake",
    likelyUserCondition: "study may be passing through without becoming tool",
    risk: "learning becoming consumption",
    offeringCandidates: ["write_record"],
    defaultOffering: "write_record",
    userFacingDiagnosis: "Study needs one retained mark.",
    concreteAction:
      "Write one note you can use again before reading or watching more.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["T", "M", "C"],
    ctaHint: "journal",
  },
  "craft.piece_unfinished": {
    key: "craft.piece_unfinished",
    field: "craft",
    humanLabel: "craft",
    inputPattern:
      "creative or building work is open without one finished piece",
    maatMeaning: "craft needs a completed unit",
    userTranslation: "the user needs a small finish before opening more work",
    likelyUserCondition: "making is scattering before one piece lands",
    risk: "activity without leverage",
    offeringCandidates: ["set_finish_condition", "commit_today"],
    defaultOffering: "set_finish_condition",
    userFacingDiagnosis: "One piece of the work needs a clean finish.",
    concreteAction:
      "Finish the smallest useful piece before opening another draft.",
    forbiddenGenericPhrases: FIELD_GENERIC_PHRASES,
    axisCodes: ["M", "C", "S"],
    ctaHint: "planner",
  },
};

export function interpretMaatSituation(
  params: InterpretParams,
): MaatSituationInterpretation {
  const snapshot = params.snapshot;
  const counts = countsFromSnapshot(snapshot);
  const signals = calculusSignals({
    snapshot,
    counts,
    evidencePhrases: params.evidencePhrases ?? [],
    personalBaseline: params.personalBaseline ?? null,
  });
  const baselineDeviation = baselineDeviationFor(snapshot, signals, params);
  const key = selectCaseKey({
    snapshot,
    counts,
    mode: params.mode,
    triggerReason: params.triggerReason,
    evidencePhrases: params.evidencePhrases ?? [],
    signals,
    baselineDeviation,
  });
  const definition = CASES[key] ?? CASES["truthful_record.low_signal"];
  if (!definition) {
    throw new Error("missing_truthful_record_low_signal_definition");
  }
  const selectedOffering = selectOffering(
    definition,
    counts,
    snapshot,
    signals,
    baselineDeviation,
  );
  const exampleReference = selectMaatOutputExample({
    caseKey: definition.key,
    offering: selectedOffering,
  });
  const voiceDirection = resolveVoiceDirection(
    definition,
    selectedOffering,
    signals,
  );
  const resolution = definition.resolutionCondition ??
    resolutionCondition(definition, selectedOffering);
  const concreteAction = offeringConcreteAction(
    definition,
    selectedOffering,
    counts,
    signals,
  );
  const diagnosis = offeringDiagnosis(
    definition,
    selectedOffering,
    signals,
  );
  const whyThisOfferingWon = offeringRationale(
    definition,
    selectedOffering,
    counts,
    signals,
    baselineDeviation,
  );
  const renderContract: MaatOfferingRenderContract = {
    version: MAAT_SITUATION_INTERPRETER_VERSION,
    caseKey: definition.key,
    offering: selectedOffering,
    diagnosis,
    concreteAction,
    caseConcreteAction: definition.concreteAction,
    offeringRationale: whyThisOfferingWon,
    exampleId: exampleReference?.id ?? null,
    exampleNudge: exampleReference?.nudge ?? null,
    exampleReflection: exampleReference?.reflection ?? null,
    voiceDirection,
    bannedPhrases: definition.forbiddenGenericPhrases,
    resolutionCondition: resolution,
  };
  return {
    ...definition,
    version: MAAT_SITUATION_INTERPRETER_VERSION,
    caseConcreteAction: definition.concreteAction,
    concreteAction,
    selectedOffering,
    whyThisOfferingWon,
    evidenceDensity: evidenceDensity(snapshot),
    confidence: confidence(snapshot, definition, counts),
    sourceCounts: counts,
    baselineDeviation,
    calculusSignals: signals,
    voiceDirection,
    resolutionCondition: resolution,
    exampleReference,
    renderContract,
  };
}

export function maatSituationPayload(
  situation: MaatSituationInterpretation | null | undefined,
): Record<string, unknown> {
  if (!situation) return {};
  return {
    maat_situation: {
      version: situation.version,
      case_key: situation.key,
      field: situation.field,
      human_label: situation.humanLabel,
      input_pattern: situation.inputPattern,
      maat_meaning: situation.maatMeaning,
      user_translation: situation.userTranslation,
      likely_user_condition: situation.likelyUserCondition,
      risk: situation.risk,
      offering_candidates: situation.offeringCandidates,
      selected_offering: situation.selectedOffering,
      default_offering: situation.defaultOffering,
      why_this_offering_won: situation.whyThisOfferingWon,
      user_facing_diagnosis: situation.userFacingDiagnosis,
      concrete_action: situation.concreteAction,
      case_concrete_action: situation.caseConcreteAction,
      cta_hint: situation.ctaHint,
      confidence: situation.confidence,
      evidence_density: situation.evidenceDensity,
      source_counts: situation.sourceCounts,
      normalized_obligation_threads: situation.calculusSignals
        .obligationThreads,
      baseline_deviation: situation.baselineDeviation,
      calculus_signals: situation.calculusSignals,
      voice_direction: situation.voiceDirection,
      resolution_condition: situation.resolutionCondition,
      example_reference: situation.exampleReference,
      render_contract: situation.renderContract,
    },
  };
}

function selectCaseKey(params: {
  snapshot: MaatDimensionSnapshot;
  counts: MaatSituationInterpretation["sourceCounts"];
  mode: "drift" | "strength";
  triggerReason?: string | null;
  evidencePhrases: string[];
  signals: MaatCalculusSignals;
  baselineDeviation: MaatBaselineDeviation;
}): MaatCaseKey {
  const ledger = params.snapshot.source.ledger;
  const field = ledger?.stalled_restoration?.field ??
    ledger?.suggested_restoration?.field ?? null;
  if (
    params.baselineDeviation === "above_baseline" ||
    params.baselineDeviation === "sharp_improvement"
  ) {
    if (field === "visible_work") {
      return "visible_work.good_pattern_needs_protection";
    }
    if (field === "rhythm") return "rhythm.good_pattern_needs_protection";
    return "provision.good_pattern_needs_protection";
  }
  if (params.mode === "strength" && !field) {
    if (params.counts.nutritionDone >= params.counts.todoDone) {
      if (params.counts.nutritionDone > 0) {
        return "provision.good_pattern_needs_protection";
      }
    }
    if (params.counts.todoDone > 0) {
      return "visible_work.good_pattern_needs_protection";
    }
    if (params.snapshot.source.days_active > 0) {
      return "rhythm.good_pattern_needs_protection";
    }
  }
  const lowSignal = params.triggerReason ===
      "decan_day_5_insufficient_signal" ||
    params.signals.lowConfidence ||
    (!field && params.snapshot.source.planner_total === 0) ||
    (params.snapshot.source.planner_total <= 1 &&
      params.snapshot.source.details_coverage < 0.25);
  if (lowSignal) return "truthful_record.low_signal";

  if (params.mode === "strength") {
    if (field === "provision") return "provision.good_pattern_needs_protection";
    if (field === "visible_work") {
      return "visible_work.good_pattern_needs_protection";
    }
    if (field === "rhythm") return "rhythm.good_pattern_needs_protection";
  }

  if (ledger?.stalled_restoration) {
    if (ledger.stalled_restoration.field === "provision") {
      return "provision.prior_correction_unresolved";
    }
    if (ledger.stalled_restoration.field === "visible_work") {
      return "visible_work.prior_commitment_unresolved";
    }
    return "release.overcommitted";
  }

  if (field === "provision") return provisionCase(params);
  if (field === "visible_work") return visibleWorkCase(params);
  if (field === "truthful_record") return "truthful_record.vague_entries";
  if (field === "rhythm") return "rhythm.anchor_missing";
  if (field === "restraint") return "restraint.force_exceeds_measure";
  if (field === "care") return "care.support_thread_open";
  if (field === "speech") return "speech.promise_unresolved";
  if (field === "order") return "order.sequence_blocked";
  if (field === "release") return "release.overcommitted";
  if (field === "attention") return "attention.scattered_inputs";
  if (field === "study") return "study.retention_missing";
  if (field === "craft") return "craft.piece_unfinished";
  return "truthful_record.low_signal";
}

function provisionCase(params: {
  counts: MaatSituationInterpretation["sourceCounts"];
  evidencePhrases: string[];
  signals: MaatCalculusSignals;
  baselineDeviation: MaatBaselineDeviation;
}): MaatCaseKey {
  const { nutritionPending, nutritionSkipped, nutritionDone } = params.counts;
  const effectiveNutritionPending = params.signals.effectiveNutritionLoad;
  const open = effectiveNutritionPending + nutritionSkipped;
  const evidence = params.evidencePhrases.join(" ").toLowerCase();
  const nutritionThreads = params.signals.obligationThreads?.nutrition ?? null;
  const uniqueOpen = params.signals.nutritionUniqueOpenCount;
  const openOccurrences = params.signals.nutritionOpenOccurrenceCount;
  const threadProblem = params.signals.nutritionDominantProblem;
  const doneButOpen = nutritionDone > 0 &&
    nutritionPending > 0 &&
    nutritionSkipped === 0 &&
    /\b(done|completed|ate|drank|finished|logged|checked)\b/.test(evidence);
  if (doneButOpen || threadProblem === "completed_but_unlogged") {
    return "provision.completed_not_logged";
  }
  if (params.signals.clinicalMixed) return "provision.clinical_mixed";
  if (params.signals.scheduleConflict) return "provision.schedule_conflict";
  if (params.signals.dualTracking) return "provision.completed_for_others";
  if (params.signals.batchPattern) return "provision.batch_behavior";
  if (params.signals.nutrientOverlap || params.signals.smoothieSignal) {
    return "provision.consolidation_candidate";
  }
  if (
    uniqueOpen === 1 &&
    (params.signals.nutritionSameItemRepeated || openOccurrences >= 3)
  ) {
    return "provision.repeated_open_checks";
  }
  if (params.signals.aspirationalItems) return "provision.aspirational_items";
  if (params.signals.itemsCreatedSameDate) return "provision.reactive_list";
  if (params.signals.listGrowing && params.signals.completionDeclining) {
    return "provision.stale_growing_list";
  }
  if (params.signals.transitionSignal && open >= 2) {
    return "provision.capacity_mismatch";
  }
  if (params.signals.disruptionSignal && open >= 2) {
    return "provision.capacity_mismatch";
  }
  if (params.signals.stalenessSignal && params.signals.highHistory) {
    return "provision.staleness_signal";
  }
  if (params.signals.feastFamine) return "provision.feast_famine";
  if (params.signals.habitStackCandidate) {
    return "provision.habit_stack_candidate";
  }
  if (
    threadProblem === "several_distinct_items_one_day" ||
    (params.signals.nutritionSameDayCollision && uniqueOpen >= 3)
  ) {
    return "provision.scattered_sources";
  }
  if (
    threadProblem === "schedule_too_dense" &&
    (nutritionThreads?.unique_item_count ?? 0) > 1
  ) {
    return "provision.overloaded_schedule";
  }
  if (effectiveNutritionPending >= 5 || open >= 6) {
    return "provision.overloaded_schedule";
  }
  if (effectiveNutritionPending >= 3 && uniqueOpen !== 1) {
    return "provision.scattered_sources";
  }
  if (nutritionSkipped >= 2) return "provision.repeated_open_checks";
  if (nutritionDone === 0 && open >= 2) return "provision.no_recent_completion";
  return "provision.single_open_check";
}

function visibleWorkCase(params: {
  counts: MaatSituationInterpretation["sourceCounts"];
  evidencePhrases: string[];
}): MaatCaseKey {
  const { todoPending, todoSkipped, todoDone } = params.counts;
  const open = todoPending + todoSkipped;
  const evidence = params.evidencePhrases.join(" ").toLowerCase();
  if (todoPending >= 4 || open >= 5) return "visible_work.too_many_open_loops";
  if (todoSkipped >= 2) return "visible_work.repeated_deferral";
  if (todoDone > 0 && todoPending > 0) return "visible_work.started_not_closed";
  if (
    /\b(vague|unclear|finish condition|no finish|open-ended|undefined)\b/.test(
      evidence,
    )
  ) {
    return "visible_work.no_finish_condition";
  }
  if (todoPending >= 2) return "visible_work.too_many_open_loops";
  return "visible_work.single_open_task";
}

function selectOffering(
  definition: MaatSituationDefinition,
  counts: MaatSituationInterpretation["sourceCounts"],
  snapshot: MaatDimensionSnapshot,
  signals: MaatCalculusSignals,
  baselineDeviation: MaatBaselineDeviation,
): MaatOfferingKind {
  const hasCandidate = (offering: MaatOfferingKind) =>
    definition.offeringCandidates.includes(offering);
  if (definition.offeringCandidates.length === 1) {
    return definition.offeringCandidates[0];
  }
  if (
    baselineDeviation === "above_baseline" ||
    baselineDeviation === "sharp_improvement"
  ) {
    const focus = definition.offeringCandidates.find((item) =>
      item === "focus_reminder" || item === "protect_rhythm" ||
      item === "fortify"
    );
    if (focus) return focus;
    return "focus_reminder";
  }
  if (signals.transitionSignal) {
    const anchor = definition.offeringCandidates.find((item) =>
      item === "anchor_one_thing"
    );
    if (anchor) return anchor;
  }
  if (signals.disruptionSignal) {
    const release = definition.offeringCandidates.find((item) =>
      item === "release_without_guilt" || item === "witness"
    );
    if (release) return release;
  }
  if (signals.scheduleConflict && hasCandidate("reschedule")) {
    return "reschedule";
  }
  if (signals.clinicalMixed && hasCandidate("triage_by_consequence")) {
    return "triage_by_consequence";
  }
  if (signals.dualTracking && hasCandidate("separate_accounts")) {
    return "separate_accounts";
  }
  if (signals.batchPattern && hasCandidate("honor_batch")) return "honor_batch";
  if (
    (signals.smoothieSignal || signals.nutrientOverlap) &&
    hasCandidate("merge_records")
  ) {
    return "merge_records";
  }
  if (
    signals.aspirationalItems && hasCandidate("release_unrealistic_target")
  ) return "release_unrealistic_target";
  if (signals.itemsCreatedSameDate && hasCandidate("revisit_and_refit")) {
    return "revisit_and_refit";
  }
  if (
    signals.listGrowing && signals.completionDeclining && hasCandidate("prune")
  ) return "prune";
  if (
    signals.stalenessSignal && signals.highHistory && hasCandidate("refresh")
  ) {
    return "refresh";
  }
  if (signals.feastFamine && hasCandidate("stabilize_floor")) {
    return "stabilize_floor";
  }
  if (signals.habitStackCandidate && hasCandidate("habit_stack")) {
    return "habit_stack";
  }
  if (
    definition.field === "provision" &&
    (signals.effectiveNutritionLoad >= 5 || counts.nutritionSkipped >= 3) &&
    hasCandidate("reduce_and_complete_one")
  ) {
    return "reduce_and_complete_one";
  }
  if (
    definition.field === "provision" &&
    signals.effectiveNutritionLoad >= 3 &&
    hasCandidate("consolidate_sources")
  ) {
    return "consolidate_sources";
  }
  if (
    definition.field === "visible_work" &&
    (counts.todoPending >= 4 || counts.todoSkipped >= 2) &&
    hasCandidate("reduce_and_complete_one")
  ) {
    return "reduce_and_complete_one";
  }
  if (snapshot.hardGates.length > 0) {
    const support = definition.offeringCandidates.find((item) =>
      item === "open_support_flow"
    );
    if (support) return support;
  }
  return definition.defaultOffering;
}

function offeringRationale(
  definition: MaatSituationDefinition,
  selectedOffering: MaatOfferingKind,
  counts: MaatSituationInterpretation["sourceCounts"],
  signals: MaatCalculusSignals,
  baselineDeviation: MaatBaselineDeviation,
) {
  if (signals.lowConfidence && selectedOffering === "write_record") {
    return "the evidence gate is low-confidence, so the output should inquire rather than correct";
  }
  if (
    baselineDeviation === "sharp_decline" &&
    (selectedOffering === "inquire" || selectedOffering === "write_record")
  ) {
    return "the user's current pattern dropped against their baseline, so the first offering should seek truth before correction";
  }
  if (selectedOffering === "focus_reminder") {
    return "the user's baseline is strong enough that this reads as re-entry, not correction";
  }
  if (selectedOffering === "release_without_guilt") {
    return "external load is present, so reducing the obligation is more truthful than adding force";
  }
  if (selectedOffering === "anchor_one_thing") {
    return "transition is disrupting the full routine, so one portable anchor is the cleanest restoration";
  }
  if (selectedOffering === "merge_records") {
    return "overlapping support marks suggest one real act is being split into several rows";
  }
  if (selectedOffering === "honor_batch") {
    return "the pattern appears batch-based, so the schedule should match the actual rhythm";
  }
  if (selectedOffering === "revisit_and_refit") {
    return "the list appears built for an earlier moment and should be refit before more effort";
  }
  if (selectedOffering === "prune") {
    return "the list is growing while completion falls, so removal comes before addition";
  }
  if (selectedOffering === "reschedule") {
    return "the evidence points to structural timing friction rather than lack of will";
  }
  if (selectedOffering === "triage_by_consequence") {
    return "high-consequence and optional support marks should not be treated equally";
  }
  if (selectedOffering === "habit_stack") {
    return "the support mark needs attachment to an existing rhythm";
  }
  if (selectedOffering === "refresh") {
    return "a strong historical pattern with staleness language needs renewal, not correction";
  }
  if (selectedOffering === "stabilize_floor") {
    return "high variance asks for a reliable floor rather than a full return";
  }
  if (selectedOffering === "separate_accounts") {
    return "the account may be holding more than one person's provision";
  }
  if (selectedOffering === "reduce_and_complete_one") {
    return "the open count points to overload, so the next restoration is reduction plus one kept mark";
  }
  if (selectedOffering === "reduce_obligations") {
    return "the open count points to overload, so right measure comes before more effort";
  }
  if (selectedOffering === "consolidate_sources") {
    return "multiple open supports suggest fragmentation, so consolidation is the cleanest restoration";
  }
  if (selectedOffering === "record_what_was_done") {
    return "the account needs to match the act before asking for more";
  }
  if (selectedOffering === "open_support_flow") {
    return "the pattern needs structure before another direct completion ask";
  }
  if (selectedOffering === "release_unrealistic_target") {
    return "truthful release protects order when the obligation no longer fits";
  }
  if (selectedOffering === "set_finish_condition") {
    return "the restoration depends on a visible edge that can actually close";
  }
  if (selectedOffering === "protect_rhythm") {
    return "the pattern is working, so the best offering is protection";
  }
  if (
    definition.field === "provision" &&
    counts.nutritionPending + counts.nutritionSkipped <= 1
  ) {
    return "one open support mark can be restored without widening the ask";
  }
  return "the selected offering is the smallest action that matches the case";
}

function offeringConcreteAction(
  definition: MaatSituationDefinition,
  selectedOffering: MaatOfferingKind,
  counts: MaatSituationInterpretation["sourceCounts"],
  signals: MaatCalculusSignals,
) {
  switch (selectedOffering) {
    case "commit_today":
      return definition.field === "provision"
        ? "Complete that one support check today and mark what actually happened."
        : "Complete one clear piece today and mark it closed.";
    case "focus_reminder":
      return "Come back to the routine you already know works and close the first familiar mark.";
    case "reduce_obligations":
      return "Release one active obligation before asking the day to carry another.";
    case "reduce_and_complete_one":
      return definition.field === "provision"
        ? "Pick the support that matters most today, complete that one, and let one nonessential target rest."
        : "Choose the task with the clearest finish line, close that one, and keep the rest outside the gate today.";
    case "consolidate_sources":
      return "Choose the one source that covers the most real ground today and track that single support.";
    case "merge_records":
      return "Merge the overlapping checks into one real support mark, then close that mark today.";
    case "honor_batch":
      return "Schedule one dedicated batch window and close the related marks inside that window.";
    case "revisit_and_refit":
      return "Remove one item that no longer fits the present routine, then keep one that still does.";
    case "record_what_was_done":
      return "Close what actually happened so the account matches the act.";
    case "open_support_flow":
      return definition.field === "provision"
        ? "Choose the nutrition source that covers the most ground today and complete only that check."
        : "Use the support flow to choose the next small restoration instead of widening the list.";
    case "release_unrealistic_target":
      return "Release one target that has not begun and does not belong to this decan's active account.";
    case "release_without_guilt":
      return "Close one small support if it is available; release the rest without counting it against yourself.";
    case "prune":
      return "Remove one item before adding anything new.";
    case "reschedule":
      if (definition.key === "provision.repeated_open_checks") {
        return "Make the check easier to keep: reduce the recurrence, attach it to one meal, or mark it immediately after use.";
      }
      return "Move the mark to the window where it can actually happen, then close it there.";
    case "restart_streak":
      return "Close one familiar mark today and let the count start again.";
    case "triage_by_consequence":
      return "Do the highest-consequence support first; let the lower-weight marks wait.";
    case "anchor_one_thing":
      return "Find the support mark that travels with your current day and protect that one.";
    case "habit_stack":
      return "Attach one support mark to a habit you already keep, and close it when that anchor fires.";
    case "refresh":
      return "Swap one stale item for a support you are actually willing to meet this decan.";
    case "stabilize_floor":
      return "Pick the smallest useful mark and set the floor today.";
    case "separate_accounts":
      return "Separate what belongs to your body from what belongs to someone else's account.";
    case "set_finish_condition":
    case "finish_condition":
      return "Name what done means for one task, then do only that.";
    case "write_record":
      return "Write one concrete detail that gives the next guidance something true to stand on.";
    case "protect_rhythm":
    case "fortify":
      return "Protect the condition that made this pattern possible.";
    case "orient":
      return "Add one real thing that actually happened so the account can begin.";
    case "inquire":
      return "Name what changed before choosing the correction.";
    case "witness":
      return "Let the record tell the truth before asking for more action.";
  }
  return signals.effectiveNutritionLoad > 0 || counts.nutritionSkipped > 0
    ? "Choose one support mark that can honestly close today."
    : definition.concreteAction;
}

function offeringDiagnosis(
  definition: MaatSituationDefinition,
  selectedOffering: MaatOfferingKind,
  signals: MaatCalculusSignals,
) {
  switch (selectedOffering) {
    case "focus_reminder":
      return "This looks like a quiet period inside a routine that already knows how to run.";
    case "reduce_and_complete_one":
      return definition.field === "provision"
        ? "The support list is carrying more rows than the day can keep."
        : "The work has too many open endings.";
    case "reduce_obligations":
      return "The account is carrying more than the current measure can hold.";
    case "consolidate_sources":
      return "Several support marks are trying to cover the same ground.";
    case "merge_records":
      return "Several support marks appear to belong to the same act of care.";
    case "honor_batch":
      return "This practice works in a batch, not as scattered daily pressure.";
    case "revisit_and_refit":
      return "This list carries the shape of an older moment.";
    case "record_what_was_done":
      return "The care may have happened; the record has not caught up.";
    case "open_support_flow":
      return definition.field === "provision"
        ? "The same provision thread is reopening."
        : "The next restoration needs structure before it needs more force.";
    case "release_unrealistic_target":
      return "One target belongs to a future routine, not the active account.";
    case "release_without_guilt":
      return "The body is carrying more than the schedule can explain.";
    case "prune":
      return "The list is growing faster than the practice can keep.";
    case "reschedule":
      if (definition.key === "provision.repeated_open_checks") {
        return "One recurring support keeps returning without a usable recording rhythm.";
      }
      return "The schedule is fighting the practice.";
    case "restart_streak":
      return "The rhythm needs re-entry, not catch-up.";
    case "triage_by_consequence":
      return "Not every open support mark carries the same consequence.";
    case "anchor_one_thing":
      return "The full routine does not travel cleanly through this context.";
    case "habit_stack":
      return "The support mark is floating without an entry point.";
    case "refresh":
      return "The practice may need freshness more than pressure.";
    case "stabilize_floor":
      return "The pattern needs a floor before it needs a higher ceiling.";
    case "separate_accounts":
      return "More than one person's care may be living in the same account.";
    case "set_finish_condition":
    case "finish_condition":
      return "One piece of the work needs a clear edge before it needs more effort.";
    case "write_record":
      return "The record is too thin to support a harder reading.";
    case "protect_rhythm":
    case "fortify":
      return "The pattern is already carrying order.";
    case "orient":
      return "The record is still new.";
    case "inquire":
      return "The signal is not clean enough to correct yet.";
    case "witness":
      return "The account needs witness before instruction.";
    case "commit_today":
      return definition.userFacingDiagnosis;
  }
  if (signals.lowConfidence) return "The record is still quiet.";
  return definition.userFacingDiagnosis;
}

function countsFromSnapshot(
  snapshot: MaatDimensionSnapshot,
): MaatSituationInterpretation["sourceCounts"] {
  const source = (snapshot.source.ledger?.source_counts ?? {}) as Record<
    string,
    unknown
  >;
  return {
    todoPending: numberValue(source.todo_pending),
    todoSkipped: numberValue(source.todo_skipped),
    todoDone: numberValue(source.todo_done),
    nutritionPending: numberValue(source.nutrition_pending),
    nutritionSkipped: numberValue(source.nutrition_skipped),
    nutritionDone: numberValue(source.nutrition_done),
  };
}

function evidenceDensity(snapshot: MaatDimensionSnapshot) {
  const count = snapshot.source.planner_total + snapshot.source.days_active;
  if (count >= 8 || snapshot.source.details_coverage >= 0.7) return "high";
  if (count >= 3 || snapshot.source.details_coverage >= 0.35) return "medium";
  return "low";
}

function confidence(
  snapshot: MaatDimensionSnapshot,
  definition: MaatSituationDefinition,
  counts: MaatSituationInterpretation["sourceCounts"],
) {
  if (definition.key === "truthful_record.low_signal") return "low";
  if (snapshot.hardGates.length > 0) return "high";
  const relevant = definition.field === "provision"
    ? counts.nutritionPending + counts.nutritionSkipped + counts.nutritionDone
    : definition.field === "visible_work"
    ? counts.todoPending + counts.todoSkipped + counts.todoDone
    : snapshot.source.planner_total;
  if (relevant >= 4) return "high";
  if (relevant >= 1 || snapshot.source.details_coverage >= 0.35) {
    return "medium";
  }
  return "low";
}

function baselineDeviationFor(
  snapshot: MaatDimensionSnapshot,
  signals: MaatCalculusSignals,
  params: InterpretParams,
): MaatBaselineDeviation {
  const baseline = params.personalBaseline;
  const count = baseline?.snapshotCount ?? 0;
  if (count < 3) return "first_decan";
  if (signals.highHistory && snapshot.source.ledger?.dominant_leak?.score) {
    return "on_baseline";
  }
  if (signals.highHistory && snapshot.reflectionMove === "affirm") {
    return "above_baseline";
  }
  const medianScore = baseline?.medianScore;
  if (typeof medianScore === "number" && Number.isFinite(medianScore)) {
    const delta = snapshot.score - medianScore;
    if (delta >= 35) return "sharp_improvement";
    if (delta >= 15) return "above_baseline";
    if (delta <= -35) return "sharp_decline";
    if (delta <= -15) return "below_baseline";
  }
  return "on_baseline";
}

function calculusSignals(params: {
  snapshot: MaatDimensionSnapshot;
  counts: MaatSituationInterpretation["sourceCounts"];
  evidencePhrases: string[];
  personalBaseline?: InterpretParams["personalBaseline"];
}): MaatCalculusSignals {
  const text = params.evidencePhrases.join(" ").toLowerCase();
  const nutritionOpen = params.counts.nutritionPending +
    params.counts.nutritionSkipped;
  const todoOpen = params.counts.todoPending + params.counts.todoSkipped;
  const highHistory = (params.personalBaseline?.nutritionDoneRate ?? 0) >=
    0.75;
  const lowConfidence = params.snapshot.source.days_active <= 1 &&
    params.snapshot.source.planner_total <= 1 &&
    params.snapshot.source.details_coverage < 0.25;
  const disruptionSignal =
    /\b(grief|loss|ill|illness|sick|hospital|crisis|emergency|exhausted|overwhelmed|heavy|caregiving|burnout)\b/
      .test(text);
  const transitionSignal =
    /\b(moved|moving|new city|new job|travel|transition|relocation|new home|new schedule|changed schedule)\b/
      .test(text);
  const stalenessSignal =
    /\b(bored|stale|same thing|tired of|monotony|unchanged|routine feels old|getting tired)\b/
      .test(text);
  const caretakingSignal =
    /\b(child|kids|partner|spouse|parent|elder|dependent|family|care for|caretaking)\b/
      .test(text);
  const smoothieSignal = /\b(smoothie|shake|greens powder|protein shake)\b/
    .test(text);
  const explicitOverlap =
    /\b(overlap|overlapping|same act|same moment|same session|same time|taken together|consumed together|covers the same|cover the same|one mealtime|one morning supplement|one entry covers|merge|consolidat)\b/
      .test(text);
  const nutrientOverlap = explicitOverlap && nutritionOpen >= 2;
  const batchPattern =
    /\b(batch|all at once|sunday|weekly|one session|post-training|post workout|cluster)\b/
      .test(text);
  const dualTracking = caretakingSignal &&
    /\b(vitamin|nutrition|supplement|meal|food|medicine|medication)\b/.test(
      text,
    );
  const scheduleConflict =
    /\b(fasting|fast window|with food|after meal|before food|timing conflict|schedule conflict|absorb|absorption)\b/
      .test(text);
  const itemsCreatedSameDate =
    /\b(added on one day|same date|health scare|doctor|article|created together|single date|reactive)\b/
      .test(text);
  const aspirationalItems =
    /\b(never completed|zero completions|future routine|aspirational|eventually|has not started|haven't started|not begun)\b/
      .test(text);
  const listGrowing =
    /\b(list growing|adds every decan|keeps adding|growing list|more items|accumulating|crept past)\b/
      .test(text);
  const completionDeclining =
    /\b(completion declining|completion falling|falling completion|declining since|less completed)\b/
      .test(text);
  const feastFamine =
    /\b(feast famine|very full then empty|high variance|intensely then disappears|cycles|streak broke)\b/
      .test(text);
  const clinicalMixed =
    /\b(medication|blood sugar|clinical|doctor|prescribed|medical|health-critical|blood pressure)\b/
      .test(text);
  const habitStackCandidate =
    /\b(anchor|habit stack|morning coffee|wind-down|workout|existing habit|routine runs well|other habits)\b/
      .test(text) || (params.counts.todoDone >= 3 && nutritionOpen >= 1);
  const effectiveNutritionLoad = Math.min(params.counts.nutritionPending, 3);
  const obligationThreads = params.snapshot.source.ledger
    ?.obligation_threads ?? null;
  const nutritionThreads = obligationThreads?.nutrition ?? null;
  const nutritionOpenThreads = (obligationThreads?.threads ?? []).filter((
    thread,
  ) =>
    thread.domain === "nutrition" &&
    thread.pending_count + thread.skipped_count > 0
  );
  return {
    highHistory,
    aboveBaseline: highHistory && params.snapshot.reflectionMove === "affirm",
    lowConfidence,
    effectiveNutritionLoad,
    disruptionSignal,
    transitionSignal,
    stalenessSignal,
    caretakingSignal,
    nutrientOverlap,
    smoothieSignal,
    batchPattern,
    dualTracking,
    scheduleConflict,
    itemsCreatedSameDate,
    aspirationalItems,
    listGrowing,
    completionDeclining,
    feastFamine,
    clinicalMixed,
    habitStackCandidate,
    obligationThreads,
    nutritionUniqueOpenCount: nutritionOpenThreads.length,
    nutritionOpenOccurrenceCount: nutritionOpenThreads.reduce(
      (sum, thread) => sum + thread.pending_count + thread.skipped_count,
      0,
    ),
    nutritionSameItemRepeated: nutritionThreads?.same_item_repeated ?? false,
    nutritionSameDayCollision: nutritionThreads?.same_day_collision ?? false,
    nutritionDominantProblem: nutritionThreads?.dominant_problem ?? "none",
  };
}

function resolveVoiceDirection(
  definition: MaatSituationDefinition,
  selectedOffering: MaatOfferingKind,
  signals: MaatCalculusSignals,
): MaatVoiceDirection {
  const sacred = /\b(ritual|ceremony|prayer|offering|spirit|moon)\b/;
  const register: MaatVoiceDirection["register"] =
    signals.disruptionSignal || selectedOffering === "release_without_guilt"
      ? "witnessing"
      : signals.caretakingSignal || definition.field === "care"
      ? "relational"
      : sacred.test(`${definition.inputPattern} ${definition.userTranslation}`)
      ? "sacred"
      : "practical";
  return {
    register: definition.voiceDirection?.register ?? register,
    temperatureHint: definition.voiceDirection?.temperatureHint ??
      (register === "witnessing" ? "gentle" : "direct"),
    leadWith: definition.voiceDirection?.leadWith ?? "situation",
    closeWith: definition.voiceDirection?.closeWith ?? "principle",
    sentenceBudget: definition.voiceDirection?.sentenceBudget ??
      (selectedOffering === "witness" ? 3 : 4),
  };
}

function resolutionCondition(
  definition: MaatSituationDefinition,
  selectedOffering: MaatOfferingKind,
) {
  if (
    selectedOffering === "release_unrealistic_target" ||
    selectedOffering === "release_without_guilt" ||
    selectedOffering === "prune"
  ) {
    return `resolved when one ${definition.humanLabel} obligation is released or removed from the active account`;
  }
  if (
    selectedOffering === "merge_records" ||
    selectedOffering === "consolidate_sources"
  ) {
    return `resolved when overlapping ${definition.humanLabel} marks are merged and one consolidated mark is completed`;
  }
  if (selectedOffering === "reschedule") {
    return `resolved when the ${definition.humanLabel} mark is moved to a workable schedule window`;
  }
  if (selectedOffering === "write_record") {
    return "resolved when one concrete journal/detail mark is written";
  }
  return `resolved when the selected ${definition.humanLabel} action is completed or truthfully released`;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
