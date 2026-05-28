import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMaatDimensionSnapshot,
  buildReflectionDecisionMatrix,
  resolveDecanPrimaryAxes,
} from "./maat_decision.ts";

const emptyPlanner = {
  total: 0,
  todoDone: 0,
  todoPartial: 0,
  todoSkipped: 0,
  nutritionDone: 0,
  nutritionPartial: 0,
  nutritionSkipped: 0,
};

Deno.test("buildMaatDimensionSnapshot affirms high measure and follow-through", () => {
  const snapshot = buildMaatDimensionSnapshot({
    decanName: "Thoth — ḥry-ib sbꜣw",
    decanTheme: "integration and measure",
    decanContext: {
      detailDescription:
        "Checking accounts, refining plans, and keeping truth under examination.",
    },
    evidenceTexts: [
      "Completed task: review sources. Measured 30 minutes and recorded 8 notes.",
      "Completed task: practice drill. Track 20 reps and adjust form.",
      "Completed nutrition: breakfast. Water and meal prepared.",
      "Completed nutrition: dinner. Food and rest protected.",
    ],
    badgeCount: 4,
    badgesWithDetails: 4,
    activeDays: 4,
    windowStart: "2026-05-01",
    windowEnd: "2026-05-10",
    plannerSummary: {
      total: 4,
      todoDone: 2,
      todoPartial: 0,
      todoSkipped: 0,
      nutritionDone: 2,
      nutritionPartial: 0,
      nutritionSkipped: 0,
    },
  });

  assertEquals(snapshot.reflectionMove, "affirm");
  assertEquals(snapshot.band, "maat");
  assertEquals(snapshot.hardGates, []);
  assertEquals(snapshot.leadAxis, "M");
});

Deno.test("buildMaatDimensionSnapshot hard-gates false records without exposing punishment logic", () => {
  const snapshot = buildMaatDimensionSnapshot({
    decanName: "Thoth — tpy-ꜣ sbꜣw",
    decanTheme: "orientation",
    decanContext: {
      detailDescription: "Truth and recordkeeping set direction.",
    },
    evidenceTexts: ["I falsified the record and lied about the task."],
    badgeCount: 1,
    badgesWithDetails: 1,
    activeDays: 1,
    windowStart: "2026-05-01",
    windowEnd: "2026-05-10",
    plannerSummary: emptyPlanner,
  });

  assertEquals(snapshot.hardGates, ["knowingly_false_record"]);
  assertEquals(snapshot.band, "isfet_patterned");
  assertEquals(snapshot.reflectionMove, "correct");
});

Deno.test("buildMaatDimensionSnapshot hard-gates life-support disruption", () => {
  const snapshot = buildMaatDimensionSnapshot({
    decanName: "Nile provision",
    decanTheme: "food and water",
    decanContext: {
      detailDescription: "Provision and life-supporting flow.",
    },
    evidenceTexts: [
      "Skipped nutrition: lunch. No food.",
      "Skipped nutrition: dinner. No water.",
    ],
    badgeCount: 2,
    badgesWithDetails: 2,
    activeDays: 2,
    windowStart: "2026-05-01",
    windowEnd: "2026-05-10",
    plannerSummary: {
      total: 2,
      todoDone: 0,
      todoPartial: 0,
      todoSkipped: 0,
      nutritionDone: 0,
      nutritionPartial: 0,
      nutritionSkipped: 2,
    },
  });

  assertEquals(snapshot.hardGates, ["life_supporting_flow_disrupted"]);
  assertEquals(snapshot.reflectionMove, "correct");
});

Deno.test("buildMaatDimensionSnapshot accounts for pending nutrition without overcorrecting", () => {
  const snapshot = buildMaatDimensionSnapshot({
    decanName: "Nile provision",
    decanTheme: "food and water",
    decanContext: {
      detailDescription: "Provision and life-supporting flow.",
    },
    evidenceTexts: [
      "Nutrition: water. State: pending.",
      "Nutrition: bee bread. State: pending.",
      "Nutrition: CoQ10. State: pending.",
    ],
    badgeCount: 3,
    badgesWithDetails: 3,
    activeDays: 1,
    windowStart: "2026-05-01",
    windowEnd: "2026-05-10",
    plannerSummary: {
      total: 3,
      todoDone: 0,
      todoPartial: 0,
      todoSkipped: 0,
      todoPending: 0,
      nutritionDone: 0,
      nutritionPartial: 0,
      nutritionSkipped: 0,
      nutritionPending: 3,
    },
  });

  assertEquals(snapshot.source.pending_planner, 3);
  assertEquals(snapshot.source.open_obligations, 3);
  assertEquals(snapshot.source.ledger?.dominant_leak?.field, "provision");
  assertEquals(snapshot.dimensions.S < 0, true);
  assertEquals(snapshot.reflectionMove, "inquire");
});

Deno.test("resolveDecanPrimaryAxes maps decan language to primary dimensions", () => {
  assertEquals(
    resolveDecanPrimaryAxes({
      decanName: "ḥry-ib msḥtjw",
      decanTheme: "control",
      decanContext: {
        detailDescription:
          "Force without direction creates disorder; power becomes useful when governed by restraint.",
      },
    }),
    ["R", "H"],
  );
});

Deno.test("buildReflectionDecisionMatrix keeps graph language hidden and adds measure cue", () => {
  const snapshot = buildMaatDimensionSnapshot({
    decanName: "Thoth — ḥry-ib sbꜣw",
    decanTheme: "integration and measure",
    decanContext: {
      detailDescription: "Checking accounts and correcting imbalance.",
    },
    evidenceTexts: ["Skipped task: review plan."],
    badgeCount: 1,
    badgesWithDetails: 0,
    activeDays: 1,
    windowStart: "2026-05-01",
    windowEnd: "2026-05-10",
    plannerSummary: {
      total: 1,
      todoDone: 0,
      todoPartial: 0,
      todoSkipped: 1,
      nutritionDone: 0,
      nutritionPartial: 0,
      nutritionSkipped: 0,
    },
  });

  const matrix = buildReflectionDecisionMatrix(
    {
      top_nodes: [{ slug: "djehuty", score: 2 }],
      dominant_patterns: ["maat"],
      tension_pairs: [["maat", "isfet"]],
      maat_score: 1,
      isfet_risk_score: 2,
    },
    snapshot,
    { useKnowledgeGraph: true, useDecisionMatrix: true },
  );

  assertStringIncludes(matrix?.promptBlock ?? "", "one number");
  assertStringIncludes(matrix?.promptBlock ?? "", "Never call the user");
  assertEquals(matrix?.balanceMode, "reduce_scatter");
});
