import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ALL_MAAT_FLOW_TEMPLATE_KEYS,
  resolveCalendarDestination,
  resolveMaatGuidanceDestination,
  resolveReflectionDestination,
} from "./maat_destination_resolver.ts";
import type { MaatDimensionSnapshot } from "../ai_generate_reflection/maat_decision.ts";
import type { ReflectionJudgment } from "./reflection_judgment.ts";

function snapshot(
  axis: MaatDimensionSnapshot["leadAxis"],
): MaatDimensionSnapshot {
  return {
    version: "maat_dims_v1",
    dimensions: {
      T: 0,
      M: 0,
      H: 0,
      V: 0,
      J: 0,
      S: 0,
      E: 0,
      R: 0,
      C: 0,
    },
    score: 0,
    band: "mixed",
    reflectionMove: "inquire",
    leadAxis: axis,
    correctionAxes: [axis],
    hardGates: [],
    decanPrimaryAxes: [],
    source: {
      planner_total: 0,
      completed_planner: 0,
      partial_planner: 0,
      skipped_planner: 0,
      pending_planner: 0,
      open_obligations: 0,
      unresolved_obligations: 0,
      details_coverage: 0,
      days_active: 0,
    },
  };
}

function judgment(
  selectedMaatLens: ReflectionJudgment["selectedMaatLens"],
): ReflectionJudgment {
  return {
    version: "reflection_judgment_v1",
    source: "deterministic",
    primaryMaatQuestion: "What dimension of Ma'at is being tested?",
    selectedMaatLens,
    secondaryMaatLens: null,
    falseReadingToAvoid: "Do not let the evidence category govern.",
    centralMoralReading: "The lens governs the destination.",
    alignment: "Alignment is visible.",
    underalignment: "Repair is needed.",
    evidenceAnchor: "one nutrition thread",
    userProfileConnection: "The user lens is care.",
    deeperDirective: "Return care inward.",
    reflectionThesis: "Care must return inward.",
    closingKind: "question",
    closingText: "What would restore proportion?",
  };
}

Deno.test("destination resolver exposes every registered Ma'at flow template", () => {
  assertEquals(
    ALL_MAAT_FLOW_TEMPLATE_KEYS.sort(),
    [
      "dawn-house-rite",
      "evening-threshold-rite",
      "the-course",
      "the-days-outside-the-year",
      "the-decan-watch",
      "the-djed",
      "the-kept-word",
      "the-moon-return",
      "the-offering-table",
      "the-open-hand",
      "the-tending",
      "the-wag",
      "the-weighing",
      "track-the-sky",
    ].sort(),
  );
});

Deno.test("guidance destination keeps existing core axis mappings", () => {
  assertEquals(
    resolveMaatGuidanceDestination({
      snapshot: snapshot("M"),
      mode: "drift",
    }).ctaRef,
    "the-weighing",
  );
  assertEquals(
    resolveMaatGuidanceDestination({
      snapshot: snapshot("S"),
      mode: "drift",
    }).ctaRef,
    "the-offering-table",
  );
  assertEquals(
    resolveMaatGuidanceDestination({
      snapshot: snapshot("V"),
      mode: "strength",
    }).ctaRef,
    "the-tending",
  );
});

Deno.test("reflection destination follows judgment lens rather than evidence category", () => {
  const care = resolveReflectionDestination({
    judgment: judgment("reciprocity"),
    normalizedObligationThreads: {
      version: "maat_obligation_threads_v1",
      threads: [{
        domain: "nutrition",
        thread_key: "nutrition:vitamin-a",
        label: "vitamin A",
        unique_item_count: 1,
        occurrence_count: 10,
        pending_count: 10,
        skipped_count: 0,
        completed_count: 0,
        partial_count: 0,
        same_item_repeated: true,
        same_day_collision: false,
        distinct_source_count: 1,
        purpose_count: 1,
        completion_ratio: 0,
        first_seen_at: "2026-05-15",
        last_completed_at: null,
        last_marked_at: null,
        sources: ["vitamin A"],
        purposes: ["body support"],
        dates: ["2026-05-15"],
        confidence: "high",
      }],
      nutrition: {
        unique_item_count: 1,
        occurrence_count: 10,
        pending_count: 10,
        skipped_count: 0,
        completed_count: 0,
        partial_count: 0,
        same_item_repeated: true,
        same_day_collision: false,
        distinct_source_count: 1,
        purpose_count: 1,
        completion_ratio: 0,
        last_completed_at: null,
        last_marked_at: null,
        dominant_problem: "one_recurring_item_unkept",
        confidence: "high",
      },
      todo: {
        unique_item_count: 0,
        occurrence_count: 0,
        pending_count: 0,
        skipped_count: 0,
        completed_count: 0,
        partial_count: 0,
        same_item_repeated: false,
        same_day_collision: false,
        distinct_source_count: 0,
        purpose_count: 0,
        completion_ratio: 0,
        last_completed_at: null,
        last_marked_at: null,
        dominant_problem: "none",
        confidence: "low",
      },
    },
  });
  assertEquals(care.ctaType, "flow_template");
  assertEquals(care.ctaRef, "the-tending");
  assertEquals(care.source, "reflection_judgment");
});

Deno.test("truth and witness reflections select The Weighing", () => {
  assertEquals(
    resolveReflectionDestination({ judgment: judgment("truth") }).ctaRef,
    "the-weighing",
  );
  assertEquals(
    resolveReflectionDestination({ judgment: judgment("witness") }).ctaRef,
    "the-weighing",
  );
});

Deno.test("calendar destination can route sky, decan, moon, wag, boundary, dawn, and open hand contexts", () => {
  assertEquals(
    resolveCalendarDestination({ decanContext: "watch the sky and horizon" })
      .ctaRef,
    "track-the-sky",
  );
  assertEquals(
    resolveCalendarDestination({ decanName: "Hathor first decan sꜣḥ" }).ctaRef,
    "the-decan-watch",
  );
  assertEquals(
    resolveCalendarDestination({ decanContext: "the moon return" }).ctaRef,
    "the-moon-return",
  );
  assertEquals(
    resolveCalendarDestination({ decanContext: "Wag remembrance" }).ctaRef,
    "the-wag",
  );
  assertEquals(
    resolveCalendarDestination({ decanContext: "days outside the year" })
      .ctaRef,
    "the-days-outside-the-year",
  );
  assertEquals(
    resolveCalendarDestination({ dayCard: { decanDayAction: "Dawn rite" } })
      .ctaRef,
    "dawn-house-rite",
  );
  assertEquals(
    resolveCalendarDestination({ decanContext: "open hand generosity" })
      .ctaRef,
    "the-open-hand",
  );
});

Deno.test("calendar destination falls back to decan watch", () => {
  const destination = resolveCalendarDestination({
    decanTheme: "ordinary decan context",
  });
  assertEquals(destination.ctaRef, "the-decan-watch");
  assert(destination.confidence > 0);
});
