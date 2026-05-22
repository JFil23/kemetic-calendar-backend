import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDecanOpeningDraft,
  buildDriftNudgeDraft,
  buildGuidanceSnapshot,
  buildPlannerSummaryFromBadges,
  buildStrengthNudgeDraft,
  decanDayIndex,
  type GuidanceBadgeRow,
  resolveGatePolicyForMaturity,
  resolveGraphAxisPriors,
  resolveGuidanceCta,
  resolveGuidanceMaturity,
  shouldCompleteOpenCorrection,
  shouldCreateDriftNudge,
  shouldCreateStrengthNudge,
} from "./maat_guidance.ts";
import { buildUserMemoryBrief } from "./user_memory_brief.ts";
import { buildMaatDimensionSnapshot } from "../ai_generate_reflection/maat_decision.ts";

const window = {
  start: "2026-05-16",
  end: "2026-05-25",
  decanName: "Thoth - measure",
  decanTheme: "measure",
  decanContextKey: "1-1",
};

Deno.test("opening guidance keeps scores hidden while naming one action", () => {
  const snapshot = buildGuidanceSnapshot({
    window,
    decanContext: {
      detailDescription: "This decan sets records in order.",
    },
    badges: [],
  });
  const draft = buildDecanOpeningDraft({
    window,
    decanContext: {
      detailDescription: "This decan sets records in order.",
    },
    dayCard: {
      date: "2026-05-16",
      maatPrinciple: "Record honestly",
      decanDayAction: "Write one true mark",
    },
    snapshot,
  });

  assertEquals(draft.kind, "decan_opening");
  assertEquals(draft.ctaType, "node");
  assertEquals(draft.ctaRef, "maat");
  assertStringIncludes(draft.teaserText, "Begin with one measured act");
  assertStringIncludes(draft.teaserText, "Today centers Record honestly");
  assertEquals(draft.teaserText.includes("Today's card names"), false);
  assertEquals(draft.teaserText.includes("score"), false);
  assertEquals(draft.teaserText.includes("isfet"), false);
});

Deno.test("guidance drafts can include user memory evidence without leaking internals", () => {
  const snapshot = buildGuidanceSnapshot({
    window,
    badges: [{
      title: "Completed task: write one true mark",
      details: "Finished before sunset.",
      tags: ["planner", "kind:todo", "state:done"],
      occurred_on: "2026-05-16",
    }],
  });
  const memoryBrief = buildUserMemoryBrief({
    profile: {
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [["maat", "isfet"]],
    },
    badges: [{
      title: "Completed task: write one true mark",
      details: "Finished before sunset.",
      tags: ["planner", "kind:todo", "state:done"],
      occurred_on: "2026-05-16",
    }],
    snapshot,
    decanName: window.decanName,
  });

  const opening = buildDecanOpeningDraft({
    window,
    snapshot,
    memoryBrief,
  });
  const drift = buildDriftNudgeDraft({
    snapshot: { ...snapshot, reflectionMove: "correct", correctionAxes: ["M"] },
    triggerReason: "correction_persisted",
    window,
    memoryBrief,
  });
  const strength = buildStrengthNudgeDraft({
    snapshot,
    window,
    memoryBrief,
  });

  assertStringIncludes(opening.bodyText, "write one true mark");
  assertStringIncludes(drift.bodyText, "write one true mark");
  assertStringIncludes(strength.bodyText, "write one true mark");
  assertEquals(opening.bodyText.includes("memory brief"), false);
  assertEquals(drift.bodyText.includes("hard gate"), false);
  assertEquals(strength.bodyText.includes("score"), false);
});

Deno.test("guidance copy audit samples keep internal labels hidden", () => {
  const forbidden = [
    /\bisfet\b/i,
    /\bscore\b/i,
    /\bband\b/i,
    /hard gate/i,
    /corrupt_judgment/i,
    /malicious_social_disruption/i,
    /vulnerable_deprivation/i,
    /life_supporting_flow_disrupted/i,
    /excessive_force_or_harm/i,
    /knowingly_false_record/i,
  ];
  const samples: Array<{ kind: string; text: string }> = [];

  for (
    const [theme, action] of [
      ["measure", "Write one true mark"],
      ["provision", "Protect one support line"],
      ["rhythm", "Observe one timing cue"],
    ]
  ) {
    const snapshot = buildGuidanceSnapshot({
      window: { ...window, decanTheme: theme },
      badges: [],
    });
    const draft = buildDecanOpeningDraft({
      window: { ...window, decanTheme: theme },
      decanContext: { detailDescription: `This decan turns toward ${theme}.` },
      dayCard: {
        date: "2026-05-16",
        maatPrinciple: theme,
        decanDayAction: action,
      },
      snapshot,
    });
    samples.push({
      kind: `opening:${theme}`,
      text: `${draft.teaserText}\n${draft.bodyText}`,
    });
  }

  for (
    const axis of ["T", "M", "H", "V", "J", "S", "E", "R", "C"] as const
  ) {
    const snapshot = {
      ...buildGuidanceSnapshot({ window, badges: [] }),
      leadAxis: axis,
      correctionAxes: [axis],
      hardGates: [],
    };
    const drift = buildDriftNudgeDraft({
      snapshot,
      triggerReason: "band_worsened",
      window,
    });
    const strength = buildStrengthNudgeDraft({
      snapshot: { ...snapshot, correctionAxes: [] },
      window,
    });
    samples.push({
      kind: `drift:${axis}`,
      text: `${drift.teaserText}\n${drift.bodyText}`,
    }, {
      kind: `strength:${axis}`,
      text: `${strength.teaserText}\n${strength.bodyText}`,
    });
  }

  for (const sample of samples) {
    for (const pattern of forbidden) {
      assertEquals(
        pattern.test(sample.text),
        false,
        `${sample.kind} leaked ${pattern}`,
      );
    }
  }
});

Deno.test("drift hysteresis waits for repeated correction unless hard gate triggers", () => {
  const current = buildGuidanceSnapshot({
    window,
    badges: [{
      title: "Skipped nutrition: dinner",
      details: "No food. No water.",
      tags: ["planner", "kind:nutrition", "state:skipped"],
      occurred_on: "2026-05-17",
    }, {
      title: "Skipped nutrition: lunch",
      details: "No food. No water.",
      tags: ["planner", "kind:nutrition", "state:skipped"],
      occurred_on: "2026-05-18",
    }],
  });

  const hardGateDecision = shouldCreateDriftNudge({
    current,
    previous: [],
    driftCount: 0,
    openingHandled: true,
    decanDayIndex: 3,
    now: new Date("2026-05-18T18:00:00Z"),
  });

  assertEquals(hardGateDecision.create, true);
  assertEquals(hardGateDecision.reason, "hard_gate");

  const activeDriftDecision = shouldCreateDriftNudge({
    current,
    previous: [],
    driftCount: 0,
    activeDriftExists: true,
    openingHandled: true,
    decanDayIndex: 3,
    now: new Date("2026-05-18T18:00:00Z"),
  });
  assertEquals(activeDriftDecision.create, false);
  assertEquals(activeDriftDecision.reason, "active_drift_exists");

  const draft = buildDriftNudgeDraft({
    snapshot: current,
    triggerReason: hardGateDecision.reason,
    window,
  });
  assertEquals(draft.kind, "drift_nudge");
  assertEquals(draft.ctaType, "flow_template");
  assertEquals(draft.ctaRef, "dawn-house-rite");
  assertStringIncludes(draft.bodyText, "next step");
});

Deno.test("drift timing covers opening-first, cooldown, and band hysteresis", () => {
  const base = buildGuidanceSnapshot({
    window,
    badges: [],
  });
  const currentWeak = {
    ...base,
    band: "leaning_isfet" as const,
    reflectionMove: "inquire" as const,
    hardGates: [],
  };
  const previousMixed = {
    ...base,
    band: "mixed" as const,
    reflectionMove: "inquire" as const,
    hardGates: [],
  };

  const openingFirst = shouldCreateDriftNudge({
    current: currentWeak,
    previous: [previousMixed],
    driftCount: 0,
    openingHandled: false,
    decanDayIndex: 1,
    now: new Date("2026-05-16T18:00:00Z"),
  });
  assertEquals(openingFirst.create, false);
  assertEquals(openingFirst.reason, "opening_first");

  const cooldown = shouldCreateDriftNudge({
    current: currentWeak,
    previous: [previousMixed],
    driftCount: 1,
    openingHandled: true,
    decanDayIndex: 4,
    lastDriftAt: new Date("2026-05-18T18:00:00Z"),
    now: new Date("2026-05-19T18:00:00Z"),
  });
  assertEquals(cooldown.create, false);
  assertEquals(cooldown.reason, "cooldown");

  const bandWorsened = shouldCreateDriftNudge({
    current: currentWeak,
    previous: [previousMixed],
    driftCount: 0,
    openingHandled: true,
    decanDayIndex: 4,
    now: new Date("2026-05-19T18:00:00Z"),
  });
  assertEquals(bandWorsened.create, true);
  assertEquals(bandWorsened.reason, "band_worsened");

  const currentMixed = {
    ...base,
    band: "mixed" as const,
    reflectionMove: "inquire" as const,
    hardGates: [],
  };
  const weakPersisted = shouldCreateDriftNudge({
    current: currentMixed,
    previous: [previousMixed],
    driftCount: 0,
    openingHandled: true,
    decanDayIndex: 4,
    now: new Date("2026-05-19T18:00:00Z"),
  });
  assertEquals(weakPersisted.create, true);
  assertEquals(weakPersisted.reason, "weak_band_persisted");
});

Deno.test("strength nudge requires three strong snapshots after opening", () => {
  const strong = buildGuidanceSnapshot({
    window,
    decanContext: {
      detailDescription: "Measure and provision.",
    },
    badges: [{
      title: "Completed to-do: review",
      details: "Measured 30 minutes and recorded 4 notes.",
      tags: ["planner", "kind:todo", "state:done"],
      occurred_on: "2026-05-16",
    }, {
      title: "Completed nutrition: water",
      details: "Food and water protected.",
      tags: ["planner", "kind:nutrition", "state:done"],
      occurred_on: "2026-05-16",
    }],
  });

  const shouldCreate = shouldCreateStrengthNudge({
    snapshots: [strong, strong, strong],
    strengthCount: 0,
    driftCount: 0,
    decanDayIndex: 4,
    openingHandled: true,
  });
  assertEquals(shouldCreate, true);

  const blockedByCorrection = shouldCreateStrengthNudge({
    snapshots: [strong, strong, strong],
    strengthCount: 0,
    driftCount: 0,
    openCorrectionExists: true,
    decanDayIndex: 4,
    openingHandled: true,
  });
  assertEquals(blockedByCorrection, false);

  const draft = buildStrengthNudgeDraft({ snapshot: strong, window });
  assertEquals(draft.kind, "strength_nudge");
  assertStringIncludes(draft.teaserText, "Your rhythm is holding");
});

Deno.test("guidance CTA resolver maps existing flow templates conservatively", () => {
  const baseline = buildGuidanceSnapshot({
    window,
    badges: [],
  });

  const skyStrength = {
    ...baseline,
    leadAxis: "E" as const,
    hardGates: [],
  };
  assertEquals(
    resolveGuidanceCta({ snapshot: skyStrength, mode: "strength" }),
    {
      ctaType: "flow_template",
      ctaRef: "track-the-sky",
      reason: "axis:E",
    },
  );

  const justiceDrift = {
    ...baseline,
    leadAxis: "J" as const,
    correctionAxes: ["J" as const],
    hardGates: [],
  };
  assertEquals(
    resolveGuidanceCta({ snapshot: justiceDrift, mode: "drift" }),
    {
      ctaType: "node",
      ctaRef: "maat",
      reason: "axis:J:node_fallback",
    },
  );
});

Deno.test("CTA resolver uses outcome flags only as a conservative preference", () => {
  const baseline = buildGuidanceSnapshot({
    window,
    badges: [],
  });

  const measureDrift = {
    ...baseline,
    leadAxis: "M" as const,
    correctionAxes: ["M" as const],
    hardGates: [],
  };
  const outcomeWeighted = resolveGuidanceCta({
    snapshot: measureDrift,
    mode: "drift",
    outcomeSignals: [{
      ctaType: "flow_template",
      ctaRef: "dawn-house-rite",
      outcomeFlag: "negative",
      completedWindowCount: 8,
      weightedDeltaDoneRate: -0.09,
    }, {
      ctaType: "node",
      ctaRef: "djehuty",
      outcomeFlag: "winning",
      completedWindowCount: 8,
      weightedDeltaDoneRate: 0.08,
    }],
  });
  assertEquals(outcomeWeighted.ctaType, "node");
  assertEquals(outcomeWeighted.ctaRef, "djehuty");
  assertStringIncludes(outcomeWeighted.reason, "outcome_winning");

  const hardGate = {
    ...measureDrift,
    hardGates: ["life_supporting_flow_disrupted"],
  };
  const gateDecision = resolveGuidanceCta({
    snapshot: hardGate,
    mode: "drift",
    outcomeSignals: [{
      ctaType: "flow_template",
      ctaRef: "dawn-house-rite",
      outcomeFlag: "negative",
      completedWindowCount: 8,
      weightedDeltaDoneRate: -0.09,
    }],
  });
  assertEquals(gateDecision.ctaType, "flow_template");
  assertEquals(gateDecision.ctaRef, "dawn-house-rite");
  assertEquals(gateDecision.reason, "gate:life_supporting_flow_disrupted");
});

Deno.test("drift draft can offer a personalized flow brief after consent", () => {
  const snapshot = buildGuidanceSnapshot({
    window,
    badges: [{
      title: "Skipped nutrition: lunch",
      details: "No food.",
      tags: ["planner", "kind:nutrition", "state:skipped"],
      occurred_on: "2026-05-17",
    }, {
      title: "Skipped nutrition: dinner",
      details: "No water.",
      tags: ["planner", "kind:nutrition", "state:skipped"],
      occurred_on: "2026-05-18",
    }],
  });

  const draft = buildDriftNudgeDraft({
    snapshot,
    triggerReason: "hard_gate",
    window,
    maturity: {
      level: "L3",
      label: "established",
      confidence: 1,
      reasons: ["test"],
    },
    enablePersonalizedFlow: true,
  });

  assertEquals(draft.ctaType, "flow_personalized");
  assertEquals(draft.payload.brief_policy_version, "maat_flow_brief_v1");
  assertStringIncludes(
    String(draft.payload.preview_summary ?? ""),
    "10 days",
  );
});

Deno.test("soft care-axis drift can offer a personalized care brief", () => {
  const baseline = buildGuidanceSnapshot({
    window,
    badges: [{
      title: "Skipped to-do: call family",
      details: "I missed one care check-in and need a smaller next step.",
      tags: ["planner", "kind:todo", "state:skipped"],
      occurred_on: "2026-05-18",
    }],
  });
  const snapshot = {
    ...baseline,
    hardGates: [],
    correctionAxes: ["V" as const],
    leadAxis: "V" as const,
  };

  const draft = buildDriftNudgeDraft({
    snapshot,
    triggerReason: "band_worsened",
    window,
    maturity: {
      level: "L3",
      label: "established",
      confidence: 1,
      reasons: ["test"],
    },
    enablePersonalizedFlow: true,
  });

  assertEquals(draft.ctaType, "flow_personalized");
  assertEquals(draft.payload.fallback_template_key, "dawn-house-rite");
  assertEquals(
    (draft.payload.flow_brief as { fingerprint?: { recipe_key?: string } })
      .fingerprint?.recipe_key,
    "restore-care-axis",
  );
  assertStringIncludes(String(draft.payload.preview_summary ?? ""), "care");
});

Deno.test("maturity controls gate policy and low-confidence drift", () => {
  const l1 = resolveGuidanceMaturity({
    badgeCount: 2,
    snapshotCount: 1,
    profile: null,
  });
  assertEquals(l1.level, "L1");
  assertEquals(resolveGatePolicyForMaturity(l1), {
    g1RegexEnabled: false,
    g4StructuralEnabled: false,
    g5RegexEnabled: false,
    g6MinSkips: 3,
    g6RequiresText: false,
    g7RegexEnabled: false,
    g8RegexEnabled: false,
  });

  const current = {
    ...buildGuidanceSnapshot({ window, badges: [] }),
    band: "leaning_isfet" as const,
    reflectionMove: "correct" as const,
    hardGates: [],
  };
  const previous = {
    ...current,
    band: "mixed" as const,
    reflectionMove: "inquire" as const,
  };
  const decision = shouldCreateDriftNudge({
    current,
    previous: [previous],
    driftCount: 0,
    confidence: l1.confidence,
    openingHandled: true,
    decanDayIndex: 3,
    now: new Date("2026-05-18T18:00:00Z"),
  });
  assertEquals(decision.create, false);
  assertEquals(decision.reason, "low_confidence");

  const structuralGate = {
    ...current,
    hardGates: ["life_supporting_flow_disrupted"],
  };
  const structuralDecision = shouldCreateDriftNudge({
    current: structuralGate,
    previous: [],
    driftCount: 0,
    confidence: l1.confidence,
    openingHandled: true,
    decanDayIndex: 3,
    now: new Date("2026-05-18T18:00:00Z"),
  });
  assertEquals(structuralDecision.create, true);
  assertEquals(structuralDecision.reason, "hard_gate");
});

Deno.test("goal and personal maturity tune gates and drift baseline", () => {
  const goalProfile = {
    key: "provision" as const,
    active: true,
    axes: ["S" as const, "E" as const, "H" as const],
    nutritionGoal: true,
    source: ["fixture"],
  };
  const l4 = resolveGuidanceMaturity({
    badgeCount: 4,
    snapshotCount: 3,
    profile: null,
    goalProfile,
  });
  assertEquals(l4.level, "L4");
  assertEquals(resolveGatePolicyForMaturity(l4, goalProfile).g6MinSkips, 1);

  const personalBaseline = {
    snapshotCount: 12,
    medianBandRank: 4,
    medianScore: 70,
    nutritionDoneRate: 0.8,
  };
  const l5 = resolveGuidanceMaturity({
    badgeCount: 12,
    snapshotCount: 12,
    profile: null,
    personalBaseline,
  });
  assertEquals(l5.level, "L5");

  const current = {
    ...buildGuidanceSnapshot({ window, badges: [] }),
    band: "mixed" as const,
    reflectionMove: "inquire" as const,
    hardGates: [],
  };
  const decision = shouldCreateDriftNudge({
    current,
    previous: [],
    driftCount: 0,
    confidence: l5.confidence,
    openingHandled: true,
    decanDayIndex: 5,
    now: new Date("2026-05-20T18:00:00Z"),
    personalBaselineBandRank: personalBaseline.medianBandRank,
  });
  assertEquals(decision.create, true);
  assertEquals(decision.reason, "personal_baseline_drop");
});

Deno.test("graph priors conservatively shape established snapshots", () => {
  const l2 = resolveGuidanceMaturity({
    badgeCount: 3,
    snapshotCount: 1,
    profile: {
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [["maat", "isfet"]],
    },
  });
  assertEquals(l2.level, "L2");
  const axisPriors = resolveGraphAxisPriors({
    maturity: l2,
    profile: {
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [["maat", "isfet"]],
    },
  });
  assertEquals(axisPriors.T, 0.08);
  assertEquals(axisPriors.M, 0.12);
  assertEquals(axisPriors.J, 0.04);
  assertEquals(axisPriors.R, 0.04);

  const shaped = buildGuidanceSnapshot({
    window,
    badges: [],
    axisPriors,
  });
  const baseline = buildGuidanceSnapshot({
    window,
    badges: [],
  });
  assertEquals(
    shaped.dimensions.M > baseline.dimensions.M,
    true,
  );
  assertEquals(shaped.source.axis_priors?.M, 0.12);
});

Deno.test("guidance and reflection snapshot builders stay policy-parity aligned", () => {
  const badges: GuidanceBadgeRow[] = [{
    title: "Completed to-do: review",
    details: "Measured 30 minutes and recorded 4 notes.",
    tags: ["planner", "kind:todo", "state:done"],
    occurred_on: "2026-05-18",
  }, {
    title: "Skipped nutrition: water",
    details: "No water protected today.",
    tags: ["planner", "kind:nutrition", "state:skipped"],
    occurred_on: "2026-05-18",
  }];
  const maturity = resolveGuidanceMaturity({
    badgeCount: badges.length,
    snapshotCount: 1,
    profile: {
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [["maat", "isfet"]],
    },
  });
  const gatePolicy = resolveGatePolicyForMaturity(maturity);
  const axisPriors = resolveGraphAxisPriors({
    maturity,
    profile: {
      top_nodes: [{ slug: "djehuty", score: 1 }],
      tension_pairs: [["maat", "isfet"]],
    },
  });

  const guidanceSnapshot = buildGuidanceSnapshot({
    window,
    badges,
    gatePolicy,
    axisPriors,
  });
  const reflectionSnapshot = buildMaatDimensionSnapshot({
    decanName: window.decanName,
    decanTheme: window.decanTheme,
    evidenceTexts: badges.map((badge) =>
      [
        badge.title ?? "",
        badge.details ?? "",
        (badge.tags ?? []).join(" ").toLowerCase(),
      ].filter(Boolean).join(" ")
    ),
    badgeCount: badges.length,
    badgesWithDetails: badges.length,
    activeDays: 1,
    windowStart: window.start,
    windowEnd: window.end,
    plannerSummary: buildPlannerSummaryFromBadges(badges),
    gatePolicy,
    axisPriors,
  });

  assertEquals(reflectionSnapshot.hardGates, guidanceSnapshot.hardGates);
  assertEquals(reflectionSnapshot.band, guidanceSnapshot.band);
  assertEquals(
    reflectionSnapshot.reflectionMove,
    guidanceSnapshot.reflectionMove,
  );
  assertEquals(reflectionSnapshot.leadAxis, guidanceSnapshot.leadAxis);
  assertEquals(reflectionSnapshot.source.axis_priors, axisPriors);
});

Deno.test("open corrections complete only after sustained recovered snapshots", () => {
  const baseline = buildGuidanceSnapshot({
    window,
    badges: [{
      title: "Completed nutrition: water",
      details: "Food and water protected.",
      tags: ["planner", "kind:nutrition", "state:done"],
      occurred_on: "2026-05-19",
    }],
  });
  const strong = {
    ...baseline,
    band: "leaning_maat" as const,
    reflectionMove: "affirm" as const,
    hardGates: [],
  };
  const weak = {
    ...baseline,
    band: "mixed" as const,
    reflectionMove: "inquire" as const,
    hardGates: [],
  };

  assertEquals(
    shouldCompleteOpenCorrection({ snapshots: [strong, strong] }),
    true,
  );
  assertEquals(
    shouldCompleteOpenCorrection({ snapshots: [strong] }),
    false,
  );
  assertEquals(
    shouldCompleteOpenCorrection({ snapshots: [strong, weak] }),
    false,
  );
});

Deno.test("decanDayIndex is one-based", () => {
  assertEquals(decanDayIndex("2026-05-16", "2026-05-16"), 1);
  assertEquals(decanDayIndex("2026-05-16", "2026-05-19"), 4);
});
