// deno-lint-ignore-file no-import-prefix

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
  renderGuidanceDraftWithLlm,
  resolveGatePolicyForMaturity,
  resolveGraphAxisPriors,
  resolveGuidanceCta,
  resolveGuidanceMaturity,
  shouldCompleteOpenCorrection,
  shouldCreateDayFiveCadenceNudge,
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

Deno.test("pending planner badges become Ma'at ledger obligations", () => {
  const badges: GuidanceBadgeRow[] = [{
    title: "Nutrition: water",
    details: "Planner nutrition entry for 2026-05-19. State: pending.",
    tags: ["planner", "kind:nutrition", "state:pending"],
    occurred_on: "2026-05-19",
  }, {
    title: "Nutrition: bee bread",
    details: "Planner nutrition entry for 2026-05-19. State: pending.",
    tags: ["planner", "kind:nutrition", "state:pending"],
    occurred_on: "2026-05-19",
  }, {
    title: "To-do: file notes",
    details: "Planner to-do entry for 2026-05-19. State: pending.",
    tags: ["planner", "kind:todo", "state:pending"],
    occurred_on: "2026-05-19",
  }];

  const summary = buildPlannerSummaryFromBadges(badges);
  const snapshot = buildGuidanceSnapshot({ window, badges });

  assertEquals(summary.total, 3);
  assertEquals(summary.nutritionPending, 2);
  assertEquals(summary.todoPending, 1);
  assertEquals(snapshot.source.pending_planner, 3);
  assertEquals(snapshot.source.open_obligations, 3);
  assertEquals(snapshot.source.ledger?.dominant_leak?.field, "visible_work");
  assertEquals(
    snapshot.source.ledger?.suggested_restoration?.action,
    "complete one to-do with a clear finish condition",
  );

  const nutritionOnly = buildGuidanceSnapshot({
    window,
    badges: badges.filter((badge) =>
      badge.tags?.includes("kind:nutrition") === true
    ),
  });
  assertEquals(nutritionOnly.source.ledger?.dominant_leak?.field, "provision");
  assertEquals(
    nutritionOnly.source.ledger?.suggested_restoration?.action,
    "complete one nutrition check today",
  );
});

Deno.test("drift nudge chooses the largest Ma'at ledger restoration target", () => {
  const snapshot = buildGuidanceSnapshot({
    window,
    badges: [{
      title: "To-do: file notes",
      details: "Planner to-do entry for 2026-05-19. State: pending.",
      tags: ["planner", "kind:todo", "state:pending"],
      occurred_on: "2026-05-19",
    }, {
      title: "To-do: revise plan",
      details: "Planner to-do entry for 2026-05-19. State: pending.",
      tags: ["planner", "kind:todo", "state:pending"],
      occurred_on: "2026-05-19",
    }, {
      title: "Nutrition: water",
      details: "Planner nutrition entry for 2026-05-19. State: pending.",
      tags: ["planner", "kind:nutrition", "state:pending"],
      occurred_on: "2026-05-19",
    }],
  });

  const draft = buildDriftNudgeDraft({
    snapshot,
    window,
    triggerReason: "test_pending_obligations",
  });

  assertStringIncludes(draft.teaserText, "open endings");
  assertStringIncludes(
    draft.bodyText,
    "Choose the task with the clearest finish line",
  );
  assertEquals(draft.bodyText.includes("failure"), false);
});

Deno.test("Moon Return backlog records are not planner skip evidence", () => {
  const badges: GuidanceBadgeRow[] = [{
    title: "Moon Return: Whole Eye",
    details: "Backfilled lunar calendar record.",
    tags: ["maat", "flow:the-moon-return"],
    occurred_on: "2026-05-17",
    flow_id: 43,
    event_id: "moon-return:43:full:2026-05-17",
  }, {
    title: "Moon Return: Empty Eye",
    details: "Future lunar calendar record.",
    tags: ["maat", "flow:the-moon-return"],
    occurred_on: "2026-05-31",
    flow_id: 43,
    event_id: "moon-return:43:new:2026-05-31",
  }];

  const summary = buildPlannerSummaryFromBadges(badges);
  const snapshot = buildGuidanceSnapshot({ window, badges });

  assertEquals(summary.total, 0);
  assertEquals(summary.todoSkipped, 0);
  assertEquals(summary.nutritionSkipped, 0);
  assertEquals(snapshot.source.planner_total, 0);
  assertEquals(snapshot.source.skipped_planner, 0);
  assertEquals(snapshot.source.pending_planner, 0);
  assertEquals(snapshot.source.open_obligations, 0);
  assertEquals(snapshot.hardGates, []);
});

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
  assertEquals(draft.ctaType, "flow_template");
  assertEquals(draft.ctaRef, "the-decan-watch");
  assertStringIncludes(draft.teaserText, "sets records in order");
  assertStringIncludes(draft.bodyText, "Today centers Record honestly");
  const compiledPackage = draft.payload.compiled_output_package as {
    package_version?: string;
    final_text?: string;
    teaser_text?: string | null;
    push_text?: string | null;
    cta_type?: string | null;
    cta_ref?: string | null;
    destination?: { type?: string; ref?: string; source?: string };
    compiler?: {
      surface?: string;
      status?: string;
      renderer?: string;
      fallback_used?: boolean;
    };
  };
  assertEquals(compiledPackage.package_version, "compiled_output_package_v1");
  assertEquals(compiledPackage.final_text, draft.bodyText);
  assertEquals(compiledPackage.teaser_text, draft.teaserText);
  assertEquals((compiledPackage.push_text?.length ?? 0) > 0, true);
  assertEquals(compiledPackage.cta_type, "flow_template");
  assertEquals(compiledPackage.cta_ref, "the-decan-watch");
  assertEquals(compiledPackage.destination?.ref, "the-decan-watch");
  assertEquals(compiledPackage.destination?.source, "calendar_arc");
  assertEquals(compiledPackage.compiler?.surface, "opening");
  assertEquals(compiledPackage.compiler?.status, "compiled");
  assertEquals(compiledPackage.compiler?.renderer, "controlled_output");
  assertEquals(compiledPackage.compiler?.fallback_used, false);
  assertEquals(draft.teaserText.includes("Today's card names"), false);
  assertEquals(draft.teaserText.includes("This decan"), false);
  assertEquals(draft.teaserText.includes("score"), false);
  assertEquals(draft.teaserText.includes("isfet"), false);
});

Deno.test("opening guidance teaser uses short decan name for titled contexts", () => {
  const snapshot = buildGuidanceSnapshot({
    window: {
      ...window,
      decanName: 'Hathor — ḥry-ib sꜣḥ ("Heart of Sah")',
      decanContextKey: "3-2",
    },
    decanContext: {
      detailDescription: "Harmonization — Stability Shared and Lived.",
    },
    badges: [],
  });
  const draft = buildDecanOpeningDraft({
    window: {
      ...window,
      decanName: 'Hathor — ḥry-ib sꜣḥ ("Heart of Sah")',
      decanContextKey: "3-2",
    },
    decanContext: {
      shortName: "ḥry-ib sꜣḥ",
      detailDescription: "Harmonization — Stability Shared and Lived.",
    },
    dayCard: {
      date: "2026-05-29",
      maatPrinciple: "Name the Partnership",
      decanDayAction: "Say clearly who you build with",
    },
    snapshot,
  });

  assertStringIncludes(draft.teaserText, "ḥry-ib sꜣḥ marks harmonization");
  assertEquals(draft.teaserText.includes("This decan"), false);
  assertStringIncludes(draft.bodyText, "ḥry-ib sꜣḥ opens the threshold");
});

Deno.test("guidance drafts season from memory without reciting activities", () => {
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
    dayCard: {
      date: "2026-05-16",
      maatPrinciple: "Record honestly",
      decanDayAction: "Write one true mark",
    },
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

  assertStringIncludes(opening.bodyText, "Write one true mark");
  assertEquals(drift.bodyText.includes("write one true mark"), false);
  assertEquals(strength.bodyText.includes("write one true mark"), false);
  assertEquals(drift.bodyText.includes("Tend to"), false);
  assertStringIncludes(drift.bodyText, "One piece of the work");
  assertStringIncludes(strength.teaserText, "is holding");
  assertEquals(opening.bodyText.includes("memory brief"), false);
  assertEquals(drift.bodyText.includes("hard gate"), false);
  assertEquals(strength.bodyText.includes("score"), false);
});

Deno.test("LLM nudge renderer uses render contract, evidence anchors, and example helper", async () => {
  const badges: GuidanceBadgeRow[] = [{
    title: "Nutrition: bee bread",
    details: "Planner nutrition entry for 2026-05-19. State: pending.",
    tags: ["planner", "kind:nutrition", "state:pending"],
    occurred_on: "2026-05-19",
  }, {
    title: "Nutrition: coconut water",
    details: "Planner nutrition entry for 2026-05-19. State: pending.",
    tags: ["planner", "kind:nutrition", "state:pending"],
    occurred_on: "2026-05-19",
  }, {
    title: "Nutrition: banana",
    details: "Planner nutrition entry for 2026-05-19. State: pending.",
    tags: ["planner", "kind:nutrition", "state:pending"],
    occurred_on: "2026-05-19",
  }];
  const snapshot = buildGuidanceSnapshot({ window, badges });
  const memoryBrief = buildUserMemoryBrief({
    profile: null,
    badges,
    evidencePhrases: [
      "bee bread, coconut water, and banana are open support marks",
    ],
    snapshot,
    decanName: window.decanName,
  });
  const draft = buildDriftNudgeDraft({
    snapshot,
    triggerReason: "admin_preview",
    window,
    memoryBrief,
  });
  const rendered = await renderGuidanceDraftWithLlm(draft, {
    renderer: async ({ userPrompt }) => {
      assertStringIncludes(userPrompt, "EVIDENCE ANCHORS");
      assertStringIncludes(userPrompt, "TARGET QUALITY EXAMPLE");
      assertStringIncludes(userPrompt, "bee bread");
      return {
        modelUsed: "mock-nudge-model",
        text:
          "Bee bread, coconut water, and banana are open as separate supports. Choose the one source that carries the most real nourishment today and close that single mark. A smaller account kept cleanly gives the body more order than a wider list left waiting.",
      };
    },
  });

  assertStringIncludes(rendered.bodyText, "Bee bread");
  assertStringIncludes(rendered.bodyText, "single mark");
  assertEquals(rendered.bodyText.includes("Several support marks"), false);
  assertEquals(
    (rendered.payload.nudge_renderer as { model_version?: string })
      .model_version,
    "mock-nudge-model",
  );
  assertEquals(
    (rendered.payload.nudge_renderer as { renderer?: string }).renderer,
    "anthropic",
  );
  assertEquals(
    (rendered.payload.output_compiler as { status?: string }).status,
    "compiled",
  );
  assertEquals(
    (rendered.payload.output_compiler as { fallback_used?: boolean })
      .fallback_used,
    false,
  );
  assertEquals(
    (rendered.payload.compiled_output_package as {
      package_version?: string;
      fallback_used?: boolean;
    }).package_version,
    "compiled_output_package_v1",
  );
  assertEquals(
    (rendered.payload.compiled_output_package as { fallback_used?: boolean })
      .fallback_used,
    false,
  );
});

Deno.test("LLM nudge fallback is compiler-marked archive-only and not quality proof", async () => {
  const badges: GuidanceBadgeRow[] = [{
    title: "Nutrition: bee bread",
    details: "Planner nutrition entry for 2026-05-19. State: pending.",
    tags: ["planner", "kind:nutrition", "state:pending"],
    occurred_on: "2026-05-19",
  }];
  const snapshot = buildGuidanceSnapshot({ window, badges });
  const draft = buildDriftNudgeDraft({
    snapshot,
    triggerReason: "admin_preview",
    window,
  });
  const rendered = await renderGuidanceDraftWithLlm(draft, {
    enabled: false,
  });
  const compiler = rendered.payload.output_compiler as {
    status?: string;
    fallback_used?: boolean;
    fallback_quality?: boolean;
    not_quality_proof?: boolean;
    delivery_recommendation?: string;
  };

  assertEquals(compiler.status, "fallback");
  assertEquals(compiler.fallback_used, true);
  assertEquals(compiler.fallback_quality, true);
  assertEquals(compiler.not_quality_proof, true);
  assertEquals(compiler.delivery_recommendation, "archive_only");
  assertEquals(rendered.ctaType, draft.ctaType);
  assertEquals(rendered.ctaRef, draft.ctaRef);
  assertEquals(rendered.payload.delivery_channel, "archive_only");
  assertEquals(rendered.payload.cta_type, draft.ctaType);
  assertEquals(rendered.payload.cta_ref, draft.ctaRef);
  assertEquals(
    (rendered.payload.compiled_output_package as {
      delivery_recommendation?: string;
      cta_type?: string | null;
      cta_ref?: string | null;
      destination?: unknown;
    }).delivery_recommendation,
    "archive_only",
  );
  assertEquals(
    (rendered.payload.compiled_output_package as { cta_type?: string | null })
      .cta_type,
    null,
  );
  assertEquals(
    (rendered.payload.compiled_output_package as { cta_ref?: string | null })
      .cta_ref,
    null,
  );
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
  assertEquals(draft.ctaRef, "the-offering-table");
  assertStringIncludes(draft.bodyText, "The same provision thread");
  assertStringIncludes(draft.bodyText, "Choose the nutrition source");
  assertEquals(draft.bodyText.includes("failure"), false);
  assertEquals(draft.bodyText.includes("Corrective act"), false);
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
    decanDayIndex: 5,
    openingHandled: true,
  });
  assertEquals(shouldCreate, true);

  const dayFourBlocked = shouldCreateStrengthNudge({
    snapshots: [strong, strong, strong],
    strengthCount: 0,
    driftCount: 0,
    decanDayIndex: 4,
    openingHandled: true,
  });
  assertEquals(dayFourBlocked, false);

  const blockedByCorrection = shouldCreateStrengthNudge({
    snapshots: [strong, strong, strong],
    strengthCount: 0,
    driftCount: 0,
    openCorrectionExists: true,
    decanDayIndex: 5,
    openingHandled: true,
  });
  assertEquals(blockedByCorrection, false);

  const draft = buildStrengthNudgeDraft({ snapshot: strong, window });
  assertEquals(draft.kind, "strength_nudge");
  assertStringIncludes(draft.teaserText, "is holding");
});

Deno.test("day-five cadence chooses Ma'at affirmation or Isfet correction", () => {
  const strong = buildGuidanceSnapshot({
    window,
    badges: [{
      title: "Completed to-do: review",
      details: "Measured 30 minutes and recorded 4 notes.",
      tags: ["planner", "kind:todo", "state:done"],
      occurred_on: "2026-05-20",
    }, {
      title: "Completed nutrition: water",
      details: "Food and water protected.",
      tags: ["planner", "kind:nutrition", "state:done"],
      occurred_on: "2026-05-20",
    }],
  });
  const stable = {
    ...strong,
    band: "maat" as const,
    reflectionMove: "affirm" as const,
    hardGates: [],
  };

  const maatDecision = shouldCreateDayFiveCadenceNudge({
    current: stable,
    decanDayIndex: 5,
    driftCount: 0,
    strengthCount: 0,
  });
  assertEquals(maatDecision, {
    create: true,
    mode: "maat",
    kind: "strength_nudge",
    reason: "decan_day_5_maat",
  });

  const isfetDecision = shouldCreateDayFiveCadenceNudge({
    current: {
      ...stable,
      band: "leaning_isfet",
      reflectionMove: "correct",
      correctionAxes: ["H"],
      hardGates: ["life_supporting_flow_disrupted"],
    },
    decanDayIndex: 5,
    driftCount: 0,
    strengthCount: 0,
  });
  assertEquals(isfetDecision, {
    create: true,
    mode: "isfet",
    kind: "drift_nudge",
    reason: "decan_day_5_isfet",
  });

  const cappedIsfetDecision = shouldCreateDayFiveCadenceNudge({
    current: {
      ...stable,
      band: "mixed",
      reflectionMove: "correct",
    },
    decanDayIndex: 5,
    driftCount: 2,
    strengthCount: 0,
  });
  assertEquals(cappedIsfetDecision.reason, "drift_cap_reached");

  const lowDataDecision = shouldCreateDayFiveCadenceNudge({
    current: buildGuidanceSnapshot({ window, badges: [] }),
    decanDayIndex: 5,
    driftCount: 0,
    strengthCount: 0,
  });
  assertEquals(lowDataDecision, {
    create: true,
    mode: "inquire",
    kind: "drift_nudge",
    reason: "decan_day_5_insufficient_signal",
  });

  const lowDataDraft = buildDriftNudgeDraft({
    snapshot: buildGuidanceSnapshot({ window, badges: [] }),
    window,
    triggerReason: "decan_day_5_insufficient_signal",
  });
  assertStringIncludes(lowDataDraft.bodyText, "The record is too thin");
  assertEquals(lowDataDraft.bodyText.includes("failure"), false);
  const lowDataControl = lowDataDraft.payload.output_control as {
    grade: { pass: boolean };
  };
  assertEquals(lowDataControl.grade.pass, true);

  const maatDraft = buildStrengthNudgeDraft({
    snapshot: stable,
    window,
    triggerReason: "decan_day_5_maat",
    celebrationOnly: true,
  });
  assertEquals(maatDraft.triggerReason, "decan_day_5_maat");
  assertEquals(maatDraft.ctaType, "none");

  const isfetDraft = buildDriftNudgeDraft({
    snapshot: {
      ...stable,
      band: "mixed" as const,
      reflectionMove: "correct" as const,
      leadAxis: "M" as const,
      correctionAxes: ["M" as const],
      hardGates: [],
    },
    window,
    triggerReason: "decan_day_5_isfet",
    enablePersonalizedFlow: true,
    outcomeSignals: [{
      ctaType: "node",
      ctaRef: "djehuty",
      outcomeFlag: "winning",
      completedWindowCount: 8,
      weightedDeltaDoneRate: 0.08,
    }, {
      ctaType: "flow_template",
      ctaRef: "dawn-house-rite",
      outcomeFlag: "winning",
      completedWindowCount: 8,
      weightedDeltaDoneRate: 0.08,
    }],
  });
  assertEquals(isfetDraft.triggerReason, "decan_day_5_isfet");
  assertEquals(isfetDraft.ctaType, "flow_template");
  assertEquals(isfetDraft.ctaRef, "the-weighing");
  assertEquals(isfetDraft.payload.cta_reason, "axis:M");
  assertEquals(isfetDraft.payload.fallback_template_key ?? null, null);
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
      ctaRef: "the-course",
      reason: "axis:E:temporal",
    },
  );

  const rhythmDrift = {
    ...baseline,
    leadAxis: "E" as const,
    correctionAxes: ["E" as const],
    hardGates: [],
  };
  assertEquals(
    resolveGuidanceCta({ snapshot: rhythmDrift, mode: "drift" }),
    {
      ctaType: "flow_template",
      ctaRef: "the-course",
      reason: "axis:E:temporal",
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

  const measureDrift = {
    ...baseline,
    leadAxis: "M" as const,
    correctionAxes: ["M" as const],
    hardGates: [],
  };
  assertEquals(
    resolveGuidanceCta({ snapshot: measureDrift, mode: "drift" }),
    {
      ctaType: "flow_template",
      ctaRef: "the-weighing",
      reason: "axis:M",
    },
  );

  const falseRecord = {
    ...measureDrift,
    hardGates: ["knowingly_false_record" as const],
  };
  assertEquals(
    resolveGuidanceCta({ snapshot: falseRecord, mode: "drift" }),
    {
      ctaType: "flow_template",
      ctaRef: "the-weighing",
      reason: "gate:knowingly_false_record",
    },
  );

  const provisionDrift = {
    ...baseline,
    leadAxis: "S" as const,
    correctionAxes: ["S" as const],
    hardGates: [],
  };
  assertEquals(
    resolveGuidanceCta({ snapshot: provisionDrift, mode: "drift" }),
    {
      ctaType: "flow_template",
      ctaRef: "the-offering-table",
      reason: "axis:S",
    },
  );

  const careDrift = {
    ...baseline,
    leadAxis: "V" as const,
    correctionAxes: ["V" as const],
    hardGates: [],
  };
  assertEquals(
    resolveGuidanceCta({ snapshot: careDrift, mode: "drift" }),
    {
      ctaType: "flow_template",
      ctaRef: "the-tending",
      reason: "axis:V",
    },
  );

  const cohesionDrift = {
    ...baseline,
    leadAxis: "C" as const,
    correctionAxes: ["C" as const],
    hardGates: [],
  };
  const cohesionCta = resolveGuidanceCta({
    snapshot: cohesionDrift,
    mode: "drift",
  });
  assertEquals(cohesionCta, {
    ctaType: "flow_template",
    ctaRef: "the-kept-word",
    reason: "axis:C",
  });
  assertEquals(cohesionCta.ctaRef === "the-tending", false);
  assertEquals(cohesionCta.ctaRef === "dawn-house-rite", false);
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

  const rhythmDrift = {
    ...baseline,
    leadAxis: "E" as const,
    correctionAxes: ["E" as const],
    hardGates: [],
  };
  const skyOutcomeWeighted = resolveGuidanceCta({
    snapshot: rhythmDrift,
    mode: "drift",
    outcomeSignals: [{
      ctaType: "flow_template",
      ctaRef: "track-the-sky",
      outcomeFlag: "winning",
      completedWindowCount: 8,
      weightedDeltaDoneRate: 0.04,
    }],
  });
  assertEquals(skyOutcomeWeighted.ctaType, "flow_template");
  assertEquals(skyOutcomeWeighted.ctaRef, "track-the-sky");
  assertStringIncludes(skyOutcomeWeighted.reason, "axis:E:sky");
  assertStringIncludes(skyOutcomeWeighted.reason, "outcome_winning");

  const structuralCohesion = {
    ...baseline,
    leadAxis: "C" as const,
    correctionAxes: ["C" as const],
    hardGates: [],
  };
  const djedOutcomeWeighted = resolveGuidanceCta({
    snapshot: structuralCohesion,
    mode: "drift",
    outcomeSignals: [{
      ctaType: "flow_template",
      ctaRef: "the-djed",
      outcomeFlag: "winning",
      completedWindowCount: 8,
      weightedDeltaDoneRate: 0.04,
    }],
  });
  assertEquals(djedOutcomeWeighted.ctaType, "flow_template");
  assertEquals(djedOutcomeWeighted.ctaRef, "the-djed");
  assertStringIncludes(djedOutcomeWeighted.reason, "axis:C:structural");
  assertStringIncludes(djedOutcomeWeighted.reason, "outcome_winning");

  const hardGate = {
    ...measureDrift,
    hardGates: ["life_supporting_flow_disrupted"],
  };
  const gateDecision = resolveGuidanceCta({
    snapshot: hardGate,
    mode: "drift",
    outcomeSignals: [{
      ctaType: "flow_template",
      ctaRef: "the-offering-table",
      outcomeFlag: "negative",
      completedWindowCount: 8,
      weightedDeltaDoneRate: -0.09,
    }],
  });
  assertEquals(gateDecision.ctaType, "flow_template");
  assertEquals(gateDecision.ctaRef, "the-offering-table");
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
  assertEquals(draft.payload.fallback_template_key, "the-tending");
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
