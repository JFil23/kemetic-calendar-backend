import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildGuidanceSnapshot } from "./maat_guidance.ts";
import { composeMaatFlowBrief } from "./maat_flow_brief.ts";

const window = {
  start: "2026-05-16",
  end: "2026-05-25",
  decanName: "Thoth - measure",
  decanTheme: "measure",
  decanContextKey: "1-1",
};

const l3 = { level: "L3" as const, label: "established" };

Deno.test("flow brief composes deterministic provision restore recipe", () => {
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
  const brief = composeMaatFlowBrief({
    snapshot,
    mode: "drift",
    window,
    maturity: l3,
    triggerReason: "hard_gate",
    fallbackTemplateKey: "dawn-house-rite",
  });

  assertEquals(brief?.policyVersion, "maat_flow_brief_v1");
  assertEquals(brief?.intent, "restore");
  assertEquals(brief?.durationDays, 10);
  assertEquals(brief?.fallbackTemplateKey, "dawn-house-rite");
  assertStringIncludes(brief?.sourceText ?? "", "MAAT_FLOW_BRIEF v1");
  assertStringIncludes(brief?.preview.overviewSummary ?? "", "10 days");
});

Deno.test("flow brief refuses cold start and review-only gates", () => {
  const base = buildGuidanceSnapshot({ window, badges: [] });
  const cold = composeMaatFlowBrief({
    snapshot: {
      ...base,
      hardGates: ["life_supporting_flow_disrupted"],
    },
    mode: "drift",
    window,
    maturity: { level: "L1", label: "cold_start" },
    fallbackTemplateKey: "dawn-house-rite",
  });
  assertEquals(cold, null);

  const reviewOnly = composeMaatFlowBrief({
    snapshot: {
      ...base,
      hardGates: ["malicious_social_disruption"],
    },
    mode: "drift",
    window,
    maturity: l3,
    fallbackTemplateKey: "dawn-house-rite",
  });
  assertEquals(reviewOnly, null);
});

Deno.test("flow brief composes strength rhythm recipe", () => {
  const base = buildGuidanceSnapshot({ window, badges: [] });
  const brief = composeMaatFlowBrief({
    snapshot: {
      ...base,
      leadAxis: "E",
      hardGates: [],
    },
    mode: "strength",
    window,
    maturity: l3,
    fallbackTemplateKey: "track-the-sky",
  });

  assertEquals(brief?.intent, "strengthen");
  assertEquals(brief?.durationDays, 14);
  assertEquals(brief?.domain, "rhythm");
});

Deno.test("flow brief composes care-axis restore recipe", () => {
  const base = buildGuidanceSnapshot({ window, badges: [] });
  const brief = composeMaatFlowBrief({
    snapshot: {
      ...base,
      leadAxis: "V",
      correctionAxes: ["V"],
      hardGates: [],
    },
    mode: "drift",
    window,
    maturity: l3,
    fallbackTemplateKey: "dawn-house-rite",
  });

  assertEquals(brief?.intent, "protect");
  assertEquals(brief?.durationDays, 7);
  assertEquals(brief?.domain, "care");
  assertEquals(brief?.plannerHints.cueType, "care");
  assertEquals(brief?.fingerprint.recipe_key, "restore-care-axis");
});
