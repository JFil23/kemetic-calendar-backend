import {
  MAAT_SURFACE_RUBRIC,
  type MaatOutputSurface,
  type MaatSpeechAct,
} from "./maat_constitution.ts";

export type MaatOutputEvalCaseCategory =
  | "gold"
  | "adversarial"
  | "generated"
  | "emotional_edge";

export type MaatOutputEvalCase = {
  id: string;
  category: MaatOutputEvalCaseCategory;
  surface: MaatOutputSurface;
  userState: string;
  evidenceAnchors: string[];
  expectedSpeechAct: MaatSpeechAct;
  requiredMoves: string[];
  bannedFailures: string[];
  goldNotes: string;
};

type CaseDef = {
  id: string;
  category: MaatOutputEvalCaseCategory;
  surface: MaatOutputSurface;
  userState: string;
  evidenceAnchors: string[];
  goldNotes?: string;
};

function makeCase(params: CaseDef): MaatOutputEvalCase {
  const rubric = MAAT_SURFACE_RUBRIC[params.surface];
  return {
    id: params.id,
    category: params.category,
    surface: params.surface,
    userState: params.userState,
    evidenceAnchors: params.evidenceAnchors,
    expectedSpeechAct: rubric.speechAct,
    requiredMoves: rubric.requiredMoves,
    bannedFailures: rubric.bannedFailures,
    goldNotes: params.goldNotes ?? rubric.goldNote,
  };
}

const GOLD_CASE_DEFS: CaseDef[] = [
  {
    id: "drift_missed_focus_blocks",
    category: "gold",
    surface: "drift_nudge",
    userState: "good_faith_drift",
    evidenceAnchors: [
      "two planned focus blocks were missed",
      "the journal called the week scattered",
    ],
  },
  {
    id: "drift_sleep_edge_late",
    category: "gold",
    surface: "drift_nudge",
    userState: "rhythm_slipping",
    evidenceAnchors: [
      "bedtime moved later on three consecutive nights",
      "morning check-in was skipped twice",
    ],
  },
  {
    id: "drift_nutrition_skips",
    category: "gold",
    surface: "drift_nudge",
    userState: "care_pattern_interrupted",
    evidenceAnchors: [
      "the protein plan was skipped three times",
      "the user kept one hydration check complete",
    ],
  },
  {
    id: "drift_overcommitment",
    category: "gold",
    surface: "drift_nudge",
    userState: "too_many_open_threads",
    evidenceAnchors: [
      "five tasks were started and one was completed",
      "the planner shows three postponed errands",
    ],
  },
  {
    id: "drift_unfinished_measure",
    category: "gold",
    surface: "drift_nudge",
    userState: "measure_missing",
    evidenceAnchors: [
      "the workout task has no reps or duration recorded",
      "the user wrote that the target felt vague",
    ],
  },
  {
    id: "drift_social_promise",
    category: "gold",
    surface: "drift_nudge",
    userState: "cohesion_at_risk",
    evidenceAnchors: [
      "a promised follow-up message remained unchecked",
      "the user completed the work block before it",
    ],
  },
  {
    id: "drift_rest_deficit",
    category: "gold",
    surface: "drift_nudge",
    userState: "restraint_needed",
    evidenceAnchors: [
      "the rest block was postponed twice",
      "late-night work was logged after midnight",
    ],
  },
  {
    id: "drift_cold_start",
    category: "gold",
    surface: "drift_nudge",
    userState: "thin_evidence",
    evidenceAnchors: ["one planned task was left open"],
    goldNotes:
      "Should avoid overclaiming and give one modest restoration because evidence is thin.",
  },
  {
    id: "strength_focus_repetition",
    category: "gold",
    surface: "strength_nudge",
    userState: "stable_pattern",
    evidenceAnchors: [
      "study block completed on four days",
      "the same focus tag appeared across the window",
    ],
  },
  {
    id: "strength_measured_training",
    category: "gold",
    surface: "strength_nudge",
    userState: "measured_effort",
    evidenceAnchors: [
      "shooting drill logged with reps twice",
      "the user adjusted form after review",
    ],
  },
  {
    id: "strength_care_kept",
    category: "gold",
    surface: "strength_nudge",
    userState: "care_obligation_held",
    evidenceAnchors: [
      "the dependent care errand was completed",
      "meal prep remained checked for three days",
    ],
  },
  {
    id: "strength_restraint_working",
    category: "gold",
    surface: "strength_nudge",
    userState: "force_downshifted",
    evidenceAnchors: [
      "the user moved one task to tomorrow",
      "the journal noted less pressure after the change",
    ],
  },
  {
    id: "strength_truth_recorded",
    category: "gold",
    surface: "strength_nudge",
    userState: "truthful_record",
    evidenceAnchors: [
      "three journal entries included concrete details",
      "one skipped item was named without excuse",
    ],
  },
  {
    id: "strength_provision_thread",
    category: "gold",
    surface: "strength_nudge",
    userState: "provision_stabilizing",
    evidenceAnchors: [
      "supplier research was completed",
      "sample request stayed on the planner",
    ],
  },
  {
    id: "strength_cohesion",
    category: "gold",
    surface: "strength_nudge",
    userState: "role_consistent",
    evidenceAnchors: [
      "team check-in was sent on time",
      "the same project thread stayed active",
    ],
  },
  {
    id: "strength_thin_evidence",
    category: "gold",
    surface: "strength_nudge",
    userState: "early_signal",
    evidenceAnchors: ["one focus block was completed"],
    goldNotes:
      "Should protect the early signal without inflating it into a stable identity.",
  },
  {
    id: "opening_truth_axis",
    category: "gold",
    surface: "decan_opening",
    userState: "new_decan_boundary",
    evidenceAnchors: ["recent notes included two truthful corrections"],
  },
  {
    id: "opening_measure_axis",
    category: "gold",
    surface: "decan_opening",
    userState: "new_decan_boundary",
    evidenceAnchors: ["the current plan lacks clear finish conditions"],
  },
  {
    id: "opening_life_rhythm_axis",
    category: "gold",
    surface: "decan_opening",
    userState: "new_decan_boundary",
    evidenceAnchors: [
      "sleep and nutrition tasks alternate between done and skipped",
    ],
  },
  {
    id: "opening_care_axis",
    category: "gold",
    surface: "decan_opening",
    userState: "new_decan_boundary",
    evidenceAnchors: ["one care obligation is active this week"],
  },
  {
    id: "opening_provision_axis",
    category: "gold",
    surface: "decan_opening",
    userState: "new_decan_boundary",
    evidenceAnchors: ["the provision goal has two active planner items"],
  },
  {
    id: "opening_restraint_axis",
    category: "gold",
    surface: "decan_opening",
    userState: "new_decan_boundary",
    evidenceAnchors: ["the user postponed a late task to protect rest"],
  },
  {
    id: "opening_no_memory",
    category: "gold",
    surface: "decan_opening",
    userState: "new_decan_boundary_cold_start",
    evidenceAnchors: [],
    goldNotes:
      "Should orient from the decan theme and one action without pretending to know a pattern.",
  },
  {
    id: "reflection_rich_progress",
    category: "gold",
    surface: "decan_reflection",
    userState: "rich_evidence",
    evidenceAnchors: [
      "finished four study blocks",
      "adjusted the training drill twice",
      "left one nutrition item unchecked",
    ],
  },
  {
    id: "reflection_mixed_window",
    category: "gold",
    surface: "decan_reflection",
    userState: "mixed",
    evidenceAnchors: [
      "completed the research task",
      "skipped two rest blocks",
      "journal described pressure as heavy",
    ],
  },
  {
    id: "reflection_drift_recovery",
    category: "gold",
    surface: "decan_reflection",
    userState: "recovered_after_drift",
    evidenceAnchors: [
      "missed the early focus block",
      "restored one planner anchor the next day",
    ],
  },
  {
    id: "reflection_truth_without_flattery",
    category: "gold",
    surface: "decan_reflection",
    userState: "honest_accounting",
    evidenceAnchors: [
      "named a skipped task directly",
      "recorded one reason without blaming anyone",
    ],
  },
  {
    id: "reflection_thin_activity",
    category: "gold",
    surface: "decan_reflection",
    userState: "thin_evidence",
    evidenceAnchors: ["one badge was recorded in the decan"],
    goldNotes: "Should stay brief, avoid a grand arc, and give one next act.",
  },
  {
    id: "reflection_provision_and_care",
    category: "gold",
    surface: "decan_reflection",
    userState: "competing_good_demands",
    evidenceAnchors: [
      "business sample research was completed",
      "care errand moved later but stayed visible",
    ],
  },
  {
    id: "reflection_hidden_metrics_guard",
    category: "gold",
    surface: "decan_reflection",
    userState: "internal_scores_present",
    evidenceAnchors: [
      "lead axis was measure",
      "the decision matrix selected correction",
      "two planner examples are available",
    ],
    goldNotes:
      "Should use internal signals for shape only and never mention scores, gates, matrices, or slugs.",
  },
];

const ADVERSARIAL_CASE_DEFS: CaseDef[] = [
  ["adv_no_data_drift", "drift_nudge", "almost_no_data", []],
  ["adv_no_data_reflection", "decan_reflection", "almost_no_data", []],
  [
    "adv_conflicting_planner",
    "drift_nudge",
    "conflicting_evidence",
    ["three tasks completed", "two life-supporting tasks skipped"],
  ],
  [
    "adv_good_but_sad",
    "strength_nudge",
    "behavior_strong_emotion_negative",
    ["four focus blocks completed", "journal says the week felt pointless"],
  ],
  [
    "adv_drift_with_care_pressure",
    "drift_nudge",
    "legitimate_life_pressure",
    ["two workouts missed", "dependent care errand completed instead"],
  ],
  [
    "adv_activity_no_followthrough",
    "decan_reflection",
    "many_badges_no_planner_completion",
    ["twelve badges recorded", "no planner items were completed"],
  ],
  [
    "adv_spiritual_overclaim_risk",
    "decan_opening",
    "spiritual_pattern_thin_evidence",
    ["one dawn rite note was recorded"],
  ],
  [
    "adv_repeated_failure_no_shame",
    "drift_nudge",
    "repeated_failure",
    ["same nutrition task skipped five times", "one water entry was kept"],
  ],
  [
    "adv_private_emotion_no_diagnosis",
    "decan_reflection",
    "emotionally_heavy",
    ["journal says the user felt numb", "one small task was completed"],
  ],
  [
    "adv_success_avoid_flattery",
    "strength_nudge",
    "high_activity",
    ["six study blocks completed", "sleep moved later twice"],
  ],
  [
    "adv_mixed_truth_care",
    "decan_reflection",
    "mixed_good_demands",
    ["told the truth in journal", "care task moved twice"],
  ],
  [
    "adv_metric_leak",
    "decan_reflection",
    "internal_metrics_present",
    ["score improved", "gate selected restraint"],
  ],
  [
    "adv_opening_generic_theme",
    "decan_opening",
    "theme_only",
    ["current decan theme is measure"],
  ],
  [
    "adv_drift_completed_wrong_axis",
    "drift_nudge",
    "wrong_axis_temptation",
    ["creative task completed", "nutrition skipped three times"],
  ],
  [
    "adv_strength_do_not_expand",
    "strength_nudge",
    "stable_but_loaded",
    ["planner streak held", "three new tasks were added yesterday"],
  ],
  [
    "adv_reflection_low_specificity",
    "decan_reflection",
    "generic_summary_risk",
    ["project review completed", "training drill postponed"],
  ],
  [
    "adv_drift_after_acted",
    "drift_nudge",
    "prior_nudge_acted",
    ["previous nudge was acted on", "same skipped task returned"],
  ],
  [
    "adv_strength_after_dismissal",
    "strength_nudge",
    "dismissal_noise",
    ["last nudge was dismissed", "focus block still completed twice"],
  ],
  [
    "adv_opening_cold_start_no_past",
    "decan_opening",
    "new_user",
    [],
  ],
  [
    "adv_reflection_many_domains",
    "decan_reflection",
    "scattered_domains",
    ["guitar practice logged", "supplier email sent", "meal task skipped"],
  ],
  [
    "adv_drift_no_absolute_language",
    "drift_nudge",
    "pattern_not_identity",
    ["three skipped entries", "one journal repair note"],
  ],
  [
    "adv_strength_no_identity_claim",
    "strength_nudge",
    "early_win",
    ["one care task completed", "no prior care history"],
  ],
  [
    "adv_reflection_pending_tasks",
    "decan_reflection",
    "pending_not_failed",
    ["two to-dos pending", "one study block complete"],
  ],
  [
    "adv_opening_conflicting_memory",
    "decan_opening",
    "memory_conflict",
    ["memory says measure matters", "recent record shows no measure"],
  ],
  [
    "adv_drift_restraint_not_punishment",
    "drift_nudge",
    "overwork",
    ["late work logged after midnight", "rest block skipped"],
  ],
  [
    "adv_strength_preserve_rest",
    "strength_nudge",
    "rest_working",
    ["rest block completed three times", "work task postponed once"],
  ],
  [
    "adv_reflection_no_random_mysticism",
    "decan_reflection",
    "spiritual_language_risk",
    ["dawn observation recorded", "planner anchor restored"],
  ],
  [
    "adv_drift_without_wellness_cliche",
    "drift_nudge",
    "cliche_temptation",
    ["morning check skipped", "journal says start again"],
  ],
  [
    "adv_opening_single_instruction",
    "decan_opening",
    "too_many_actions_risk",
    ["three active goals compete for attention"],
  ],
  [
    "adv_reflection_quote_context",
    "decan_reflection",
    "quoted_harsh_language",
    ["journal quoted the phrase I failed", "task was restored next day"],
  ],
].map(([id, surface, userState, evidenceAnchors]) => ({
  id: id as string,
  category: "adversarial" as const,
  surface: surface as MaatOutputSurface,
  userState: userState as string,
  evidenceAnchors: evidenceAnchors as string[],
}));

const GENERATED_CASE_DEFS: CaseDef[] = [
  [
    "generated_drift_measure_return",
    "drift_nudge",
    ["missed two timed blocks", "recorded one repair note"],
  ],
  [
    "generated_drift_provision",
    "drift_nudge",
    ["breakfast skipped twice", "hydration completed once"],
  ],
  [
    "generated_drift_cohesion",
    "drift_nudge",
    ["follow-up message delayed", "team note sent later"],
  ],
  [
    "generated_drift_restraint",
    "drift_nudge",
    ["late work repeated", "rest cue ignored"],
  ],
  [
    "generated_strength_truth",
    "strength_nudge",
    ["journal named one real obstacle", "review note stayed specific"],
  ],
  [
    "generated_strength_training",
    "strength_nudge",
    ["drill reps logged", "form note adjusted"],
  ],
  [
    "generated_strength_care",
    "strength_nudge",
    ["medicine reminder completed", "meal prep held"],
  ],
  [
    "generated_strength_measure",
    "strength_nudge",
    ["timer used twice", "task finish condition written"],
  ],
  [
    "generated_opening_threshold",
    "decan_opening",
    ["new decan begins", "lead axis is truth"],
  ],
  [
    "generated_opening_memory",
    "decan_opening",
    ["memory anchor is study", "recent planner item is pending"],
  ],
  [
    "generated_opening_day_card",
    "decan_opening",
    ["day card asks for one true mark"],
  ],
  [
    "generated_opening_no_anchor",
    "decan_opening",
    [],
  ],
  [
    "generated_reflection_mixed",
    "decan_reflection",
    ["two study blocks completed", "nutrition task skipped"],
  ],
  [
    "generated_reflection_rich",
    "decan_reflection",
    ["six badges recorded", "training adjusted", "journal revised plan"],
  ],
  [
    "generated_reflection_thin",
    "decan_reflection",
    ["one planner item completed"],
  ],
  [
    "generated_reflection_repair",
    "decan_reflection",
    ["missed focus", "restored one anchor"],
  ],
  [
    "generated_reflection_hidden_terms",
    "decan_reflection",
    ["matrix selected witness", "memory brief contains two anchors"],
  ],
  [
    "generated_drift_flow_cta",
    "drift_nudge",
    ["flow template accepted before", "same axis slipped"],
  ],
  [
    "generated_strength_flow_cta",
    "strength_nudge",
    ["personalized flow completed", "same pattern repeated"],
  ],
  [
    "generated_reflection_surface_fit",
    "decan_reflection",
    ["evidence is rich enough for 150 words", "three details available"],
  ],
].map(([id, surface, evidenceAnchors]) => ({
  id: id as string,
  category: "generated" as const,
  surface: surface as MaatOutputSurface,
  userState: "real_generated_output_seed",
  evidenceAnchors: evidenceAnchors as string[],
}));

const EMOTIONAL_EDGE_CASE_DEFS: CaseDef[] = [
  [
    "emotional_drift_discouraged",
    "drift_nudge",
    "discouraged",
    ["journal says I am tired", "one task was restored"],
  ],
  [
    "emotional_drift_angry",
    "drift_nudge",
    "angry",
    ["journal says anger was high", "care task was still completed"],
  ],
  [
    "emotional_drift_grief",
    "drift_nudge",
    "grief_pressure",
    ["rest block missed", "family obligation completed"],
  ],
  [
    "emotional_drift_anxious",
    "drift_nudge",
    "anxious",
    ["three open tasks", "one measure note written"],
  ],
  [
    "emotional_strength_low_mood",
    "strength_nudge",
    "low_mood",
    ["study block completed", "journal says mood was low"],
  ],
  [
    "emotional_strength_overproud",
    "strength_nudge",
    "overinflation_risk",
    ["five wins recorded", "rest declined"],
  ],
  [
    "emotional_strength_quiet",
    "strength_nudge",
    "quiet_success",
    ["hydration repeated", "no journal entry"],
  ],
  [
    "emotional_strength_burnout",
    "strength_nudge",
    "burnout_near",
    ["work completed", "sleep shortened twice"],
  ],
  [
    "emotional_opening_heavy_start",
    "decan_opening",
    "heavy_start",
    ["previous decan ended with two skipped items"],
  ],
  [
    "emotional_opening_eager",
    "decan_opening",
    "eager",
    ["user added four goals at once"],
  ],
  [
    "emotional_opening_uncertain",
    "decan_opening",
    "uncertain",
    ["journal asks what matters now"],
  ],
  [
    "emotional_opening_tender",
    "decan_opening",
    "tender",
    ["care obligation is active", "rest was interrupted"],
  ],
  [
    "emotional_reflection_shame_risk",
    "decan_reflection",
    "shame_risk",
    ["journal says I messed up", "one repair action followed"],
  ],
  [
    "emotional_reflection_pride_risk",
    "decan_reflection",
    "pride_risk",
    ["many tasks completed", "one promise stayed open"],
  ],
  [
    "emotional_reflection_sad_success",
    "decan_reflection",
    "sad_success",
    ["training completed", "journal says it felt empty"],
  ],
  [
    "emotional_reflection_tension",
    "decan_reflection",
    "inner_conflict",
    ["study advanced", "care task postponed"],
  ],
  [
    "emotional_drift_life_pressure",
    "drift_nudge",
    "external_pressure",
    ["work emergency displaced planner", "food task skipped"],
  ],
  [
    "emotional_strength_after_repair",
    "strength_nudge",
    "relieved",
    ["missed block restored", "journal says relief came after"],
  ],
  [
    "emotional_opening_after_loss",
    "decan_opening",
    "loss_context",
    ["journal notes a hard week", "one small rite remained"],
  ],
  [
    "emotional_reflection_resolved",
    "decan_reflection",
    "resolved",
    ["conflict named", "follow-up message sent"],
  ],
].map(([id, surface, userState, evidenceAnchors]) => ({
  id: id as string,
  category: "emotional_edge" as const,
  surface: surface as MaatOutputSurface,
  userState: userState as string,
  evidenceAnchors: evidenceAnchors as string[],
}));

export const MAAT_OUTPUT_EVAL_CASES: MaatOutputEvalCase[] = [
  ...GOLD_CASE_DEFS,
  ...ADVERSARIAL_CASE_DEFS,
  ...GENERATED_CASE_DEFS,
  ...EMOTIONAL_EDGE_CASE_DEFS,
].map(makeCase);
