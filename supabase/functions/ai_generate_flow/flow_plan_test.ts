import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildSourceBackedOverview,
  buildSparsePromptRoutineNotes,
  inferSparsePromptDomain,
} from "./generation_hints.ts";
import {
  buildFlowPlanFromSparseRoutine,
  buildFlowPlanQualityMetadata,
  renderFlowPlanToParsedNotes,
  validateFlowPlan,
} from "./flow_plan.ts";

const GUITAR_PROMPT =
  "learn beyond the 7th sky by lenny kravitz on electric guitar";

function buildGuitarFlowPlan() {
  const dateRangeDays = 16;
  const notes = buildSparsePromptRoutineNotes({
    description: GUITAR_PROMPT,
    sourceText: null,
    dateRangeDays,
    flowFormat: "REGIMEN",
  });
  const overview = buildSourceBackedOverview(
    GUITAR_PROMPT,
    null,
    dateRangeDays,
  );

  assertExists(notes);
  assertExists(overview);

  const plan = buildFlowPlanFromSparseRoutine({
    description: GUITAR_PROMPT,
    sourceText: null,
    dateRangeDays,
    flowFormat: "REGIMEN",
    domain: inferSparsePromptDomain(GUITAR_PROMPT, null),
    overview,
    notes,
  });

  assertExists(plan);
  return plan;
}

Deno.test("FlowPlan validates and renders the named guitar sparse routine", () => {
  const plan = buildGuitarFlowPlan();
  const validation = validateFlowPlan(plan);

  assertEquals(validation.ok, true);
  assertEquals(validation.errors, []);
  assertEquals(validation.scores.day_coverage, 1);
  assert(validation.scores.actionability >= 0.95);
  assert(validation.scores.render_readiness >= 0.95);

  const rendered = renderFlowPlanToParsedNotes(plan);
  assertEquals(rendered.length, 32);
  assertEquals(new Set(rendered.map((note) => note.day_index)).size, 16);

  const allText = rendered.map((note) => `${note.title}\n${note.details}`).join(
    "\n",
  );
  assertStringIncludes(allText, "E-A-D-G-B-E");
  assertStringIncludes(allText, "intro section");
  assertStringIncludes(allText, "A, Am, and C");
  assertEquals(
    /\b(?:repeat day|same as above|previous day|day_index)\b/i.test(allText),
    false,
  );
  assertEquals(/(?:^|\n)\s*\d+\.\s+\S/.test(allText), false);
  assertEquals(
    /\b(?:Reference anchors|General practice|working song map|instead of generic)\b/i
      .test(
        allText,
      ),
    false,
  );
});

Deno.test("FlowPlan metadata exposes route, playbook, validators, and scores", () => {
  const plan = buildGuitarFlowPlan();
  const validation = validateFlowPlan(plan);
  const metadata = buildFlowPlanQualityMetadata({ plan, validation });

  assertEquals(metadata.generation_pipeline, "flow_plan_v1");
  assertEquals(metadata.route, "sparse_prompt_routine");
  assertEquals(metadata.domain, "music");
  assertEquals(metadata.assumed_user_level, "novice");
  assertEquals(metadata.playbook_version, "music_playbook_v1");
  assertEquals(metadata.plan_validation.ok, true);
  assertEquals(metadata.quality_scores.day_coverage, 1);
});

Deno.test("FlowPlan validation fails when a day has no events", () => {
  const overview = buildSourceBackedOverview(
    "10 day skin care routine",
    null,
    3,
  );
  assertExists(overview);
  const plan = buildFlowPlanFromSparseRoutine({
    description: "10 day skin care routine",
    sourceText: null,
    dateRangeDays: 3,
    flowFormat: "REGIMEN",
    domain: "skincare",
    overview,
    notes: [{
      day_index: 0,
      title: "Morning skincare routine",
      details:
        "Cleanse gently, moisturize, and apply tinted SPF. Done when the skin is covered without burning or scrubbing.",
      all_day: false,
      start_time: "08:00",
      end_time: "08:20",
    }],
  });

  const validation = validateFlowPlan(plan);
  assertEquals(validation.ok, false);
  assertStringIncludes(
    validation.errors.join("\n"),
    "day_index 1 has no events",
  );
});

Deno.test("FlowPlan validation rejects vague action placeholders", () => {
  const overview = buildSourceBackedOverview("practice kung fu", null, 1);
  assertExists(overview);
  const plan = buildFlowPlanFromSparseRoutine({
    description: "practice kung fu",
    sourceText: null,
    dateRangeDays: 1,
    flowFormat: "REGIMEN",
    domain: "martial_arts",
    overview,
    notes: [{
      day_index: 0,
      title: "Focused Drills",
      details:
        "Do dynamic stretching, then practice specific techniques for 20 minutes.",
      all_day: false,
      start_time: "18:00",
      end_time: "18:20",
    }],
  });

  const validation = validateFlowPlan(plan);
  assertEquals(validation.ok, false);
  assertStringIncludes(
    validation.errors.join("\n"),
    "under-specified action language",
  );
});
