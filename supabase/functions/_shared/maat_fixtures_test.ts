import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMaatDimensionSnapshot,
  type MaatAxisCode,
  type MaatPlannerSummaryInput,
} from "../ai_generate_reflection/maat_decision.ts";
import {
  buildDriftNudgeDraft,
  buildGuidanceSnapshot,
  buildStrengthNudgeDraft,
  type GuidanceCtaOutcomeSignal,
  type GuidanceMaturity,
  type GuidanceMaturityLevel,
  resolveGatePolicyForMaturity,
  resolveGuidanceCta,
  shouldCreateDriftNudge,
} from "./maat_guidance.ts";

type Fixture = {
  id: string;
  description?: string;
  maturityLevel?: GuidanceMaturityLevel;
  scenario?:
    | "snapshot"
    | "drift_decision"
    | "cta_resolution"
    | "strength_draft";
  input?: {
    evidenceTexts?: string[];
    planner?: Partial<MaatPlannerSummaryInput>;
    current?: {
      band?: string;
      reflectionMove?: string;
      leadAxis?: MaatAxisCode;
      correctionAxes?: MaatAxisCode[];
      hardGates?: string[];
    };
    previous?: Array<{
      band?: string;
      reflectionMove?: string;
      hardGates?: string[];
    }>;
    driftParams?: {
      driftCount?: number;
      openingHandled?: boolean;
      decanDayIndex?: number;
      confidence?: number;
      lastDriftAt?: string | null;
      now?: string;
      reviewOnlyHardGates?: string[];
    };
    mode?: "drift" | "strength";
    outcomeSignals?: GuidanceCtaOutcomeSignal[];
  };
  expect: {
    hardGates?: string[];
    band?: string;
    notBand?: string;
    reflectionMove?: string;
    axisAtLeast?: Partial<Record<MaatAxisCode, number>>;
    delivery?: {
      kind: "drift_nudge" | "strength_nudge";
      ctaType: string;
      ctaRef: string;
    };
    driftDecision?: {
      create: boolean;
      reason: string;
    };
    cta?: {
      ctaType: string;
      ctaRef: string | null;
      reasonIncludes?: string;
    };
  };
};

const fixtureFile = new URL("./maat_fixtures.json", import.meta.url);
const fixtureCatalog = JSON.parse(await Deno.readTextFile(fixtureFile)) as {
  policy_version: string;
  fixtures: Fixture[];
};

const emptyPlanner: MaatPlannerSummaryInput = {
  total: 0,
  todoDone: 0,
  todoPartial: 0,
  todoSkipped: 0,
  nutritionDone: 0,
  nutritionPartial: 0,
  nutritionSkipped: 0,
};

const window = {
  start: "2026-05-16",
  end: "2026-05-25",
  decanName: "Thoth - measure",
  decanTheme: "measure",
  decanContextKey: "1-1",
};

function plannerFor(fixture: Fixture): MaatPlannerSummaryInput {
  return { ...emptyPlanner, ...(fixture.input?.planner ?? {}) };
}

function maturityFor(level: GuidanceMaturityLevel): GuidanceMaturity {
  switch (level) {
    case "L1":
      return {
        level,
        label: "cold_start",
        confidence: 0.5,
        reasons: ["fixture"],
      };
    case "L2":
      return {
        level,
        label: "warming",
        confidence: 0.7,
        reasons: ["fixture"],
      };
    case "L3":
      return {
        level,
        label: "established",
        confidence: 1,
        reasons: ["fixture"],
      };
    case "L4":
      return {
        level,
        label: "goal_calibrated",
        confidence: 1,
        reasons: ["fixture"],
      };
    case "L5":
      return {
        level,
        label: "personal_model",
        confidence: 1,
        reasons: ["fixture"],
      };
  }
}

for (const fixture of fixtureCatalog.fixtures) {
  Deno.test(`maat fixture ${fixture.id}: ${fixture.description ?? ""}`, () => {
    if (fixture.scenario === "drift_decision") {
      const base = buildGuidanceSnapshot({ window, badges: [] });
      const current = {
        ...base,
        band: (fixture.input?.current?.band ?? base.band) as typeof base.band,
        reflectionMove: (fixture.input?.current?.reflectionMove ??
          base.reflectionMove) as typeof base.reflectionMove,
        hardGates: fixture.input?.current?.hardGates ?? base.hardGates,
      };
      const previous = (fixture.input?.previous ?? []).map((row) => ({
        ...base,
        band: (row.band ?? base.band) as typeof base.band,
        reflectionMove: (row.reflectionMove ??
          base.reflectionMove) as typeof base.reflectionMove,
        hardGates: row.hardGates ?? base.hardGates,
      }));
      const params = fixture.input?.driftParams ?? {};
      const decision = shouldCreateDriftNudge({
        current,
        previous,
        driftCount: params.driftCount ?? 0,
        confidence: params.confidence,
        openingHandled: params.openingHandled ?? true,
        decanDayIndex: params.decanDayIndex ?? 4,
        lastDriftAt: params.lastDriftAt ? new Date(params.lastDriftAt) : null,
        now: new Date(params.now ?? "2026-05-19T18:00:00.000Z"),
        reviewOnlyHardGates: params.reviewOnlyHardGates,
      });
      assertEquals(decision, fixture.expect.driftDecision);
      return;
    }

    if (fixture.scenario === "cta_resolution") {
      const base = buildGuidanceSnapshot({ window, badges: [] });
      const snapshot = {
        ...base,
        leadAxis: fixture.input?.current?.leadAxis ?? base.leadAxis,
        correctionAxes: fixture.input?.current?.correctionAxes ??
          base.correctionAxes,
        hardGates: fixture.input?.current?.hardGates ?? base.hardGates,
      };
      const cta = resolveGuidanceCta({
        snapshot,
        mode: fixture.input?.mode ?? "drift",
        outcomeSignals: fixture.input?.outcomeSignals,
      });
      assertEquals(cta.ctaType, fixture.expect.cta?.ctaType);
      assertEquals(cta.ctaRef, fixture.expect.cta?.ctaRef);
      if (fixture.expect.cta?.reasonIncludes) {
        assertEquals(
          cta.reason.includes(fixture.expect.cta.reasonIncludes),
          true,
        );
      }
      return;
    }

    if (fixture.scenario === "strength_draft") {
      const base = buildGuidanceSnapshot({ window, badges: [] });
      const snapshot = {
        ...base,
        leadAxis: fixture.input?.current?.leadAxis ?? base.leadAxis,
        hardGates: fixture.input?.current?.hardGates ?? base.hardGates,
      };
      const draft = buildStrengthNudgeDraft({
        snapshot,
        window,
        outcomeSignals: fixture.input?.outcomeSignals,
      });
      assertEquals(draft.kind, fixture.expect.delivery?.kind);
      assertEquals(draft.ctaType, fixture.expect.delivery?.ctaType);
      assertEquals(draft.ctaRef, fixture.expect.delivery?.ctaRef);
      return;
    }

    const snapshot = buildMaatDimensionSnapshot({
      decanName: window.decanName,
      decanTheme: window.decanTheme,
      decanContext: {
        detailDescription: "Measure, truth, provision, and restraint.",
      },
      evidenceTexts: fixture.input?.evidenceTexts ?? [],
      badgeCount: fixture.input?.evidenceTexts?.length ?? 0,
      badgesWithDetails: fixture.input?.evidenceTexts?.length ?? 0,
      activeDays: Math.min(2, fixture.input?.evidenceTexts?.length ?? 0),
      windowStart: window.start,
      windowEnd: window.end,
      plannerSummary: plannerFor(fixture),
      gatePolicy: resolveGatePolicyForMaturity(
        maturityFor(fixture.maturityLevel ?? "L3"),
      ),
    });

    if (fixture.expect.hardGates) {
      assertEquals(snapshot.hardGates, fixture.expect.hardGates);
    }
    if (fixture.expect.band) {
      assertEquals(snapshot.band, fixture.expect.band);
    }
    if (fixture.expect.notBand) {
      assertEquals(snapshot.band !== fixture.expect.notBand, true);
    }
    if (fixture.expect.reflectionMove) {
      assertEquals(snapshot.reflectionMove, fixture.expect.reflectionMove);
    }
    for (
      const [axis, minimum] of Object.entries(fixture.expect.axisAtLeast ?? {})
    ) {
      assertEquals(
        snapshot.dimensions[axis as MaatAxisCode] >= Number(minimum),
        true,
      );
    }

    if (fixture.expect.delivery?.kind === "drift_nudge") {
      const draft = buildDriftNudgeDraft({
        snapshot,
        triggerReason: "fixture",
        window,
      });
      assertEquals(draft.kind, fixture.expect.delivery.kind);
      assertEquals(draft.ctaType, fixture.expect.delivery.ctaType);
      assertEquals(draft.ctaRef, fixture.expect.delivery.ctaRef);
    }
  });
}
