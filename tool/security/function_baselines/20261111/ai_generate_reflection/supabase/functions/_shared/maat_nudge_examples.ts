import type {
  MaatCaseKey,
  MaatOfferingKind,
} from "./maat_situation_interpreter.ts";

export const MAAT_OUTPUT_EXAMPLE_STORE_VERSION = "maat_nudge_examples_v1";

export type MaatOutputExample = {
  id: string;
  caseKey: MaatCaseKey;
  offering: MaatOfferingKind;
  scenario: string;
  nudge: string;
  reflection: string;
  sourceFile: string;
};

export const MAAT_OUTPUT_EXAMPLES: MaatOutputExample[] = [
  {
    id: "provision_repeated_reschedule_support_mark",
    caseKey: "provision.repeated_open_checks",
    offering: "reschedule",
    scenario:
      "One recurring support item appears across many days without closing",
    nudge:
      "The same support mark keeps returning unclosed. Make it easier to keep: reduce the recurrence, attach it to one meal, or mark it immediately after use. The issue is the rhythm around the mark, not the whole provision list.",
    reflection:
      "One body-support thread repeated through the decan without finding a reliable recording rhythm. That is different from several supports competing for attention. The useful correction is structural: reduce how often the mark appears, attach it to the moment it actually happens, or record it immediately after use. A recurring obligation becomes keepable when the rhythm around it is honest.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_consolidation_candidate_micronutrients",
    caseKey: "provision.consolidation_candidate",
    offering: "consolidate_sources",
    scenario: "Overlapping nutrient supports are tracked separately",
    nudge:
      "Several support marks cover overlapping ground. Choose one source that does the most real work and let it carry the mark. The record gets cleaner when one act is not split into many obligations.",
    reflection:
      "The tracking is more granular than the practice requires. Items that serve the same support function do not always need separate rows; splitting one act into many components can make the account look heavier than the care actually is. The question is which source corresponds to a distinct moment of care. Let that source carry the mark, and let the smaller duplicates wait.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_overloaded_release_ritual_items",
    caseKey: "provision.overloaded_schedule",
    offering: "release_unrealistic_target",
    scenario: "Spiritual practice with too many ritual nourishment marks open",
    nudge:
      "Five ritual nourishment marks are open. They do not all belong to the same level of obligation. Keep the anchors, let the extra marks rest, and protect the foundation before widening the practice.",
    reflection:
      "The care of the physical self was present in intention and scattered in the keeping. Some marks were anchors; others were aspirational additions made during a high-commitment moment. The difference matters. An anchor carries the practice when everything else slips. An aspiration waits until the anchor is secure.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_overloaded_merge_mealtime",
    caseKey: "provision.overloaded_schedule",
    offering: "merge_records",
    scenario: "Protein and water tracked separately but consumed together",
    nudge:
      "Protein and water are separate marks for one real moment of care. Merge them into a mealtime entry. Same nourishment, half the logging weight.",
    reflection:
      "The physical care record has open marks that belong to the same act. Protein and hydration do not happen independently in a work day; they happen at meals, breaks, during and after effort. The record does not get more accurate from more rows. It gets more accurate from rows that match how the practice actually happens.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_overloaded_reduce_new_user",
    caseKey: "provision.overloaded_schedule",
    offering: "reduce_and_complete_one",
    scenario: "New user added many wellness items before the routine exists",
    nudge:
      "The list is larger than the routine. Pick the support that is most real to how you already eat, close that one today, and let the rest wait until the first mark is reliable.",
    reflection:
      "Starting body care with a full list is generous, and it often creates a period where almost nothing closes. The list was built for the optimized version of the routine, not the one currently running. A short list that closes consistently teaches the account more than a long list that stays open.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_overloaded_focus_long_history",
    caseKey: "provision.overloaded_schedule",
    offering: "focus_reminder",
    scenario: "Long-time user with high history and one off-decan slip",
    nudge:
      "The routine has been running well for months. This decan went quiet. Come back to what already works and close the first familiar mark.",
    reflection:
      "The body support routine has been consistent across many decans, and this one went quieter than usual. Nothing in the pattern says the approach needs rebuilding. The rhythm is still real; one quiet period does not erase it. Re-enter as a continuation, not a restart.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_overloaded_anchor_transition",
    caseKey: "provision.overloaded_schedule",
    offering: "anchor_one_thing",
    scenario: "Major life transition disrupted the full routine",
    nudge:
      "The full routine does not travel well through a major transition. One item does. Find the nourishment practice that needs no special kitchen, store, or schedule, and protect that one while the new context settles.",
    reflection:
      "The body care routine dropped when the environment changed, which is expected. Routines are built around infrastructure: a kitchen, a store, a sequence of daily events. When the infrastructure moves, the routine that depended on it loses footing. The next account should begin from the one practice that belongs to the user in any context.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_scattered_consolidate_sources",
    caseKey: "provision.scattered_sources",
    offering: "consolidate_sources",
    scenario: "Several support marks are open without proof they are one act",
    nudge:
      "Several support marks are trying to cover the same ground. Choose the one source that does the most real work today, close that mark, and let the smaller supports wait.",
    reflection:
      "The body-support account was not empty; it was split into more marks than the practice needed. The lesson is not to do more. It is to let one real source carry more of the work so the record becomes easier to keep.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_completed_not_logged",
    caseKey: "provision.completed_not_logged",
    offering: "record_what_was_done",
    scenario: "Meals happened but no nutrition completions were recorded",
    nudge:
      "The care happened; the record has not caught up. Close what was actually done. The account needs the mark, not a redo.",
    reflection:
      "The provision record is thin, but the evidence says the body was fed. The gap is between living the practice and recording it. That is different from not doing the work. The next improvement is to make logging as frictionless as the care itself.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_schedule_conflict",
    caseKey: "provision.schedule_conflict",
    offering: "reschedule",
    scenario: "Supplement timing conflicts with the user schedule",
    nudge:
      "The schedule is fighting the practice. Move the support mark to the window where it can actually happen, then close it there.",
    reflection:
      "The provision marks kept slipping because the timing did not fit the body or the day. That is a structural mismatch, not an effort problem. A schedule that fits the practice is easier to keep than a practice forced into the wrong part of the day.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "provision_feast_famine",
    caseKey: "provision.feast_famine",
    offering: "stabilize_floor",
    scenario: "High completion variance, currently in an empty phase",
    nudge:
      "The provision record runs in cycles: very full, then empty. Do not return to full today. Pick the smallest useful mark and set the floor.",
    reflection:
      "The provision account went quiet after a strong period, which is the familiar shape of this rhythm. High completion when energy is present, little when it is not. The question is what survives without motivation. That smallest useful mark is the real floor; everything else is bonus.",
    sourceFile: "maat_examples_provision_all_cases.md",
  },
  {
    id: "visible_work_many_open_loops",
    caseKey: "visible_work.too_many_open_loops",
    offering: "reduce_and_complete_one",
    scenario: "Many work tasks open with no closure",
    nudge:
      "The work is split across too many endings. Choose the task with the cleanest finish line, close that one, and keep the rest outside the gate today.",
    reflection:
      "The visible work account is not asking for more force. It is asking for fewer open endings. When many tasks stay active at once, attention becomes maintenance instead of motion. One closed edge teaches more than another widened list.",
    sourceFile: "maat_examples_visible_work_truthful_record.md",
  },
  {
    id: "visible_work_finish_condition",
    caseKey: "visible_work.no_finish_condition",
    offering: "finish_condition",
    scenario: "Work exists but the definition of done is unclear",
    nudge:
      "The work needs a finish line before it needs more effort. Name what done means for one task, then do only that.",
    reflection:
      "The task kept widening because the edge was never named. Without a finish condition, effort has no place to land. The first act is not more work; it is measure. Define the edge, then let the work close against it.",
    sourceFile: "maat_examples_visible_work_truthful_record.md",
  },
  {
    id: "truthful_record_low_signal",
    caseKey: "truthful_record.low_signal",
    offering: "orient",
    scenario: "Cold-start or low-data user with little record",
    nudge:
      "The record is still new. Add one real thing that actually happened, and the account starts taking shape.",
    reflection:
      "A new practice does not produce evidence immediately. The account is quiet because it has not had time to accumulate. What matters now is honesty, not volume. One real entry, specific enough to matter later, begins the account.",
    sourceFile: "maat_examples_visible_work_truthful_record.md",
  },
  {
    id: "release_overcommitted",
    caseKey: "release.overcommitted",
    offering: "release_unrealistic_target",
    scenario: "Total active obligations exceed sustainable capacity",
    nudge:
      "The account does not need more completion effort. It needs deliberate reduction. Release one obligation fully today so the remaining ones can be kept cleanly.",
    reflection:
      "The full account is carrying more than the available capacity can sustain. The issue is load relative to capacity. Right measure includes the right size of commitment, not only the quality of execution. A smaller set of obligations kept cleanly produces more real order than a larger set partly maintained.",
    sourceFile: "maat_examples_remaining_fields.md",
  },
];

export function selectMaatOutputExample(params: {
  caseKey?: string | null;
  offering?: string | null;
}): MaatOutputExample | null {
  const caseKey = params.caseKey?.trim();
  if (!caseKey) return null;
  const offering = params.offering?.trim();
  return MAAT_OUTPUT_EXAMPLES.find((example) =>
    example.caseKey === caseKey && example.offering === offering
  ) ?? MAAT_OUTPUT_EXAMPLES.find((example) => example.caseKey === caseKey) ??
    null;
}

export function maatExamplePromptBlock(
  examples: MaatOutputExample[] | null | undefined,
) {
  const usable = (examples ?? []).slice(0, 2);
  if (!usable.length) return "";
  return `\n\nMAAT_EXAMPLE_OUTPUTS (${MAAT_OUTPUT_EXAMPLE_STORE_VERSION}; style references, do not copy details that are not in evidence):\n${
    usable.map((example) =>
      `- ${example.id} [${example.caseKey} / ${example.offering}]\n  Scenario: ${example.scenario}\n  Nudge: ${example.nudge}\n  Reflection: ${example.reflection}`
    ).join("\n")
  }`;
}
