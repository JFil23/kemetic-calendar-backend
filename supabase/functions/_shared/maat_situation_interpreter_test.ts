// deno-lint-ignore-file no-import-prefix

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDriftNudgeDraft,
  buildGuidanceSnapshot,
  type GuidanceBadgeRow,
} from "./maat_guidance.ts";
import { interpretMaatSituation } from "./maat_situation_interpreter.ts";

const window = {
  start: "2026-05-16",
  end: "2026-05-25",
  decanName: "Thoth - measure",
  decanTheme: "measure",
  decanContextKey: "1-1",
};

function nutritionBadge(
  label: string,
  state: "pending" | "skipped" | "done",
  date = "2026-05-19",
): GuidanceBadgeRow {
  return {
    title: `Nutrition: ${label}`,
    details: `Planner nutrition entry for ${date}. State: ${state}.`,
    tags: ["planner", "kind:nutrition", `state:${state}`],
    occurred_on: date,
  };
}

function todoBadge(
  label: string,
  state: "pending" | "skipped" | "done",
): GuidanceBadgeRow {
  return {
    title: `To-do: ${label}`,
    details: `Planner to-do entry. State: ${state}.`,
    tags: ["planner", "kind:todo", `state:${state}`],
    occurred_on: "2026-05-19",
  };
}

Deno.test("Ma'at situation interpreter distinguishes one provision miss from capped nutrition load", () => {
  const single = buildGuidanceSnapshot({
    window,
    badges: [nutritionBadge("water", "pending")],
  });
  const singleCase = interpretMaatSituation({
    snapshot: single,
    mode: "drift",
  });
  assertEquals(singleCase.key, "provision.single_open_check");
  assertEquals(singleCase.selectedOffering, "commit_today");
  assertStringIncludes(
    singleCase.concreteAction,
    "Complete that one support check",
  );

  const overloaded = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("water", "pending"),
      nutritionBadge("bee bread", "pending"),
      nutritionBadge("coconut water", "pending"),
      nutritionBadge("banana", "pending"),
      nutritionBadge("potato", "pending"),
    ],
  });
  const overloadedCase = interpretMaatSituation({
    snapshot: overloaded,
    mode: "drift",
  });
  assertEquals(overloadedCase.key, "provision.scattered_sources");
  assertEquals(overloadedCase.selectedOffering, "consolidate_sources");
  assertStringIncludes(
    overloadedCase.concreteAction,
    "Choose the one source",
  );
  assertEquals(overloadedCase.exampleReference?.caseKey, overloadedCase.key);
});

Deno.test("Ma'at situation interpreter separates consolidation, repeated misses, and logging gaps", () => {
  const scattered = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("water", "pending"),
      nutritionBadge("bee bread", "pending"),
      nutritionBadge("banana", "pending"),
    ],
  });
  assertEquals(
    interpretMaatSituation({ snapshot: scattered, mode: "drift" }).key,
    "provision.scattered_sources",
  );

  const repeated = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("water", "skipped"),
      nutritionBadge("bee bread", "skipped"),
    ],
  });
  const repeatedCase = interpretMaatSituation({
    snapshot: repeated,
    mode: "drift",
  });
  assertEquals(repeatedCase.key, "provision.repeated_open_checks");
  assertEquals(repeatedCase.selectedOffering, "reschedule");

  const completedButOpen = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("water", "done"),
      nutritionBadge("bee bread", "pending"),
    ],
  });
  const loggingCase = interpretMaatSituation({
    snapshot: completedButOpen,
    mode: "drift",
    evidencePhrases: ["completed water but the later check stayed open"],
  });
  assertEquals(loggingCase.key, "provision.completed_not_logged");
  assertEquals(loggingCase.selectedOffering, "record_what_was_done");
});

Deno.test("one recurring nutrition item is one thread, not several supports", () => {
  const repeatedVitamin = buildGuidanceSnapshot({
    window,
    badges: Array.from({ length: 10 }, (_, index) =>
      nutritionBadge(
        "vitamin A",
        "pending",
        `2026-05-${String(16 + index).padStart(2, "0")}`,
      )),
  });
  const situation = interpretMaatSituation({
    snapshot: repeatedVitamin,
    mode: "drift",
  });

  assertEquals(situation.key, "provision.repeated_open_checks");
  assertEquals(situation.selectedOffering, "reschedule");
  assertStringIncludes(situation.concreteAction, "reduce the recurrence");
  assertEquals(
    situation.calculusSignals.obligationThreads?.nutrition.unique_item_count,
    1,
  );
  assertEquals(
    situation.calculusSignals.obligationThreads?.nutrition.occurrence_count,
    10,
  );
  assertEquals(
    situation.calculusSignals.obligationThreads?.nutrition.dominant_problem,
    "recurrence_too_ambitious",
  );
});

Deno.test("three distinct nutrition items on one day may become same-day overload", () => {
  const sameDay = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("bee bread", "pending", "2026-05-19"),
      nutritionBadge("coconut water", "pending", "2026-05-19"),
      nutritionBadge("CoQ10", "pending", "2026-05-19"),
    ],
  });
  const situation = interpretMaatSituation({
    snapshot: sameDay,
    mode: "drift",
  });

  assertEquals(situation.key, "provision.scattered_sources");
  assertEquals(
    situation.calculusSignals.obligationThreads?.nutrition.unique_item_count,
    3,
  );
  assertEquals(
    situation.calculusSignals.obligationThreads?.nutrition.same_day_collision,
    true,
  );
  assertEquals(
    situation.calculusSignals.obligationThreads?.nutrition.dominant_problem,
    "several_distinct_items_one_day",
  );
});

Deno.test("Ma'at situation interpreter routes task overload and low data away from generic provision", () => {
  const taskHeavy = buildGuidanceSnapshot({
    window,
    badges: [
      todoBadge("file notes", "pending"),
      todoBadge("revise outline", "pending"),
      todoBadge("send draft", "pending"),
      todoBadge("clear inbox", "pending"),
      nutritionBadge("water", "pending"),
    ],
  });
  const taskCase = interpretMaatSituation({
    snapshot: taskHeavy,
    mode: "drift",
  });
  assertEquals(taskCase.key, "visible_work.too_many_open_loops");
  assertEquals(taskCase.selectedOffering, "reduce_and_complete_one");

  const lowData = buildGuidanceSnapshot({ window, badges: [] });
  const lowDataCase = interpretMaatSituation({
    snapshot: lowData,
    mode: "drift",
    triggerReason: "decan_day_5_insufficient_signal",
  });
  assertEquals(lowDataCase.key, "truthful_record.low_signal");
  assertEquals(lowDataCase.selectedOffering, "write_record");
});

Deno.test("case-keyed drift output starts from diagnosis and carries the concrete offering", () => {
  const snapshot = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("water", "pending"),
      nutritionBadge("bee bread", "pending"),
      nutritionBadge("coconut water", "pending"),
      nutritionBadge("banana", "pending"),
      nutritionBadge("potato", "pending"),
    ],
  });
  const draft = buildDriftNudgeDraft({
    snapshot,
    window,
    triggerReason: "decan_day_5_isfet",
  });

  assertStringIncludes(
    draft.bodyText,
    "Several support marks are trying to cover the same ground.",
  );
  assertStringIncludes(
    draft.bodyText,
    "Choose the one source",
  );
  assertEquals(/^Provision is\b/.test(draft.bodyText), false);
  assertEquals(draft.bodyText.includes("not a verdict"), false);
  assertEquals(
    (draft.payload.maat_situation as { case_key?: string }).case_key,
    "provision.scattered_sources",
  );
  assertStringIncludes(
    JSON.stringify(draft.payload.maat_situation),
    "example_reference",
  );
});

Deno.test("Ma'at situation calculus routes specific provision signal clusters", () => {
  const overloaded = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("vitamin C", "pending"),
      nutritionBadge("zinc", "pending"),
      nutritionBadge("magnesium", "pending"),
      nutritionBadge("water", "pending"),
      nutritionBadge("protein", "pending"),
    ],
  });
  const merged = interpretMaatSituation({
    snapshot: overloaded,
    mode: "drift",
    evidencePhrases: [
      "vitamin C, zinc, magnesium, and protein are taken together in the same morning supplement session",
    ],
  });
  assertEquals(merged.key, "provision.consolidation_candidate");
  assertEquals(merged.selectedOffering, "merge_records");
  assertStringIncludes(merged.concreteAction, "Merge the overlapping checks");

  const clinical = interpretMaatSituation({
    snapshot: overloaded,
    mode: "drift",
    evidencePhrases: ["blood sugar check and medication with food are open"],
  });
  assertEquals(clinical.key, "provision.clinical_mixed");
  assertEquals(clinical.selectedOffering, "triage_by_consequence");

  const transition = interpretMaatSituation({
    snapshot: overloaded,
    mode: "drift",
    evidencePhrases: ["new city and changed schedule disrupted the routine"],
  });
  assertEquals(transition.key, "provision.capacity_mismatch");
  assertEquals(transition.selectedOffering, "anchor_one_thing");
});

Deno.test("Ma'at situation calculus caps raw nutrition load without inferring merged records", () => {
  const overloaded = buildGuidanceSnapshot({
    window,
    badges: [
      nutritionBadge("bee bread", "pending"),
      nutritionBadge("coconut water", "pending"),
      nutritionBadge("potatoes", "pending"),
      nutritionBadge("CoQ10", "pending"),
      nutritionBadge("banana", "pending"),
    ],
  });
  const situation = interpretMaatSituation({
    snapshot: overloaded,
    mode: "drift",
    evidencePhrases: [
      "bee bread, coconut water, potatoes, CoQ10, and banana are pending",
    ],
  });
  assertEquals(situation.key, "provision.scattered_sources");
  assertEquals(situation.selectedOffering, "consolidate_sources");
  assertEquals(situation.selectedOffering === "merge_records", false);
  assertEquals(situation.calculusSignals.effectiveNutritionLoad, 3);
});
