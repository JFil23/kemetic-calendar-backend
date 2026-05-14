import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDecisionMatrix,
  classifyIntent,
  coercePlanSpec,
  generatePlanSpec,
  renderNotesFromPlanSpec,
  repairPlanSpec,
  validatePlanSpec,
} from "./plan_spec.ts";

Deno.test("generatePlanSpec produces action metadata for each note", () => {
  const classification = classifyIntent({
    description: "Build me a 7 day study flow for my exam.",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 7,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    requestedTimeWindow: {
      startTime: "07:00",
      endTime: "07:20",
      source: "single",
    },
    dateRangeDays: 7,
  });

  const planSpec = generatePlanSpec({
    description: "Build me a 7 day study flow for my exam.",
    flowName: "Exam Prep",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 7,
    notes: [
      {
        day_index: 0,
        title: "Recall chapter 1",
        details: "- Recall the chapter from memory\n- Self-check weak spots",
        all_day: false,
        start_time: "07:00",
        end_time: "07:20",
      },
    ],
    classification,
    decisionMatrix,
  });

  assertEquals(planSpec.version, "flowspec_v2");
  assertEquals(planSpec.goal.domain, "learning");
  assertEquals(planSpec.actions.length, 1);
  assertStringIncludes(planSpec.actions[0].trigger, "07:00");
  assertExists(planSpec.actions[0].minimum_version);
});

Deno.test("repair + validate yields full v2 coverage", () => {
  const classification = classifyIntent({
    description: "Create a focused project flow.",
    flowFormat: "PROJECT_PLAN",
    dateRangeDays: 5,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 5,
  });
  const seedNotes = [
    {
      day_index: 0,
      title: "Wire the endpoint",
      details: "Open the API route and return the expected payload.",
      all_day: false,
      start_time: "09:00",
      end_time: "10:00",
    },
  ];

  const initial = generatePlanSpec({
    description: "Create a focused project flow.",
    flowName: "Project Sprint",
    flowFormat: "PROJECT_PLAN",
    dateRangeDays: 5,
    notes: seedNotes,
    classification,
    decisionMatrix,
  });

  const repaired = repairPlanSpec(
    {
      ...initial,
      actions: [
        {
          ...initial.actions[0],
          trigger: "",
          minimum_version: "",
          obstacle_plan: {
            ...initial.actions[0].obstacle_plan,
            if_missed: "",
          },
          metric_keys: [],
        },
      ],
    },
    seedNotes,
  );
  const validation = validatePlanSpec(repaired, seedNotes.length);

  assertEquals(validation.ok, true);
  assertEquals(validation.quality_score, 100);
});

Deno.test("renderNotesFromPlanSpec attaches behavior payload", () => {
  const classification = classifyIntent({
    description: "Build me a 3 day budgeting flow.",
    flowFormat: "FINANCE_PLAN",
    dateRangeDays: 3,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 3,
  });
  const notes = [
    {
      day_index: 0,
      title: "Gather bank statements",
      details: "Collect the last 30 days of statements.",
      all_day: false,
      start_time: "18:00",
      end_time: "18:20",
    },
  ];
  const planSpec = generatePlanSpec({
    description: "Build me a 3 day budgeting flow.",
    flowName: "Budget Reset",
    flowFormat: "FINANCE_PLAN",
    dateRangeDays: 3,
    notes,
    classification,
    decisionMatrix,
  });
  const rendered = renderNotesFromPlanSpec({ notes, planSpec });

  assertEquals(rendered.length, 1);
  assertExists(rendered[0].action_id);
  assertExists(rendered[0].behavior_payload);
  assertEquals(
    rendered[0].behavior_payload?.action_id,
    planSpec.actions[0].action_id,
  );
});

Deno.test("renderNotesFromPlanSpec can preserve LLM-authored details while adding metadata", () => {
  const classification = classifyIntent({
    description: "Create a study flow that teaches the basics first.",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 1,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 1,
  });
  const notes = [
    {
      day_index: 0,
      title: "Wave-particle duality primer",
      details:
        "Start with a plain-language definition: light and matter can show wave-like or particle-like behavior depending on how they are observed. Sketch one everyday analogy, then try one guided example and write the first question that still feels confusing.",
      all_day: false,
      start_time: "09:00",
      end_time: "10:00",
    },
  ];
  const planSpec = generatePlanSpec({
    description: "Create a study flow that teaches the basics first.",
    flowName: "Quantum Study",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 1,
    notes,
    classification,
    decisionMatrix,
  });

  const rendered = renderNotesFromPlanSpec({
    notes,
    planSpec,
    preserveDetails: true,
  });

  assertEquals(rendered[0].details, notes[0].details);
  assertExists(rendered[0].action_id);
  assertExists(rendered[0].behavior_payload);
});

Deno.test("renderNotesFromPlanSpec can render directly from planner actions", () => {
  const classification = classifyIntent({
    description: "Build me a 3 day budgeting flow.",
    flowFormat: "FINANCE_PLAN",
    dateRangeDays: 3,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 3,
  });
  const notes = [
    {
      day_index: 0,
      title: "Gather bank statements",
      details: "Collect the last 30 days of statements.",
      all_day: false,
      start_time: "18:00",
      end_time: "18:20",
    },
  ];
  const planSpec = generatePlanSpec({
    description: "Build me a 3 day budgeting flow.",
    flowName: "Budget Reset",
    flowFormat: "FINANCE_PLAN",
    dateRangeDays: 3,
    notes,
    classification,
    decisionMatrix,
  });

  const rendered = renderNotesFromPlanSpec({ planSpec });

  assertEquals(rendered.length, 1);
  assertEquals(rendered[0].title, "Gather bank statements");
  assertExists(rendered[0].behavior_payload);
  assertStringIncludes(rendered[0].details, "Collect the last 30 days");
  assertStringIncludes(rendered[0].details, "If time is tight");
  assertStringIncludes(rendered[0].details, "If you miss it");
  assertStringIncludes(rendered[0].details, "Keep score with");
  assertEquals(rendered[0].details.includes("Cue:"), false);
  assertEquals(rendered[0].details.includes("Minimum:"), false);
});

Deno.test("coercePlanSpec preserves render hints from planner JSON", () => {
  const classification = classifyIntent({
    description: "Build me a 2 day study flow.",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 2,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 2,
  });

  const planSpec = coercePlanSpec({
    raw: {
      goal: { title: "Study Flow", domain: "learning" },
      actions: [
        {
          action_id: "a001",
          title: "Recall chapter 1",
          definition_of_done: "Explain the chapter from memory.",
          duration_min: 20,
          trigger: "Start at 07:00.",
          context_anchor: "desk ready",
          learning_mode: "spaced_retrieval",
          minimum_version: "Recall one section.",
          stretch_version: "Recall and self-quiz.",
          obstacle_plan: {
            if_low_time: "Recall one section.",
            if_distracted: "Reset and do five minutes.",
            if_missed: "Do the minimum version later today.",
          },
          metric_keys: ["actions_completed"],
          evidence_tags: ["learning"],
          risk_tier: "low",
          scheduled_day_index: 0,
          render_hints: {
            details: "Recall, then self-check weak spots.",
            all_day: false,
            start_time: "07:00",
            end_time: "07:20",
            location: "desk",
          },
        },
      ],
    },
    fallbackFlowName: "Study Flow",
    classification,
    decisionMatrix,
    dateRangeDays: 2,
  });

  assertEquals(planSpec.actions[0].render_hints?.start_time, "07:00");
  assertEquals(planSpec.actions[0].render_hints?.location, "desk");
});

Deno.test("renderNotesFromPlanSpec enriches terse planner details", () => {
  const classification = classifyIntent({
    description: "Build me a 2 day study flow.",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 2,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 2,
  });

  const planSpec = coercePlanSpec({
    raw: {
      goal: { title: "Study Flow", domain: "learning" },
      actions: [
        {
          action_id: "a001",
          title: "Recall chapter 1",
          definition_of_done: "Explain the chapter from memory.",
          duration_min: 20,
          trigger: "After breakfast, sit at the desk and start recall.",
          context_anchor: "desk with notes closed",
          learning_mode: "spaced_retrieval",
          minimum_version: "Recall one section.",
          stretch_version: "Recall the chapter and write three quiz misses.",
          obstacle_plan: {
            if_low_time: "Recall one section.",
            if_distracted: "Put the phone away and do five minutes.",
            if_missed: "Do the minimum version later today.",
          },
          metric_keys: ["actions_completed", "retrieval_reps"],
          evidence_tags: ["learning"],
          risk_tier: "low",
          scheduled_day_index: 0,
          render_hints: {
            details: "Recall chapter 1.",
            all_day: false,
            start_time: "07:00",
            end_time: "07:20",
            location: "desk",
          },
        },
      ],
    },
    fallbackFlowName: "Study Flow",
    classification,
    decisionMatrix,
    dateRangeDays: 2,
  });

  const rendered = renderNotesFromPlanSpec({ planSpec });

  assertEquals(rendered.length, 1);
  assertStringIncludes(rendered[0].details, "Recall chapter 1.");
  assertStringIncludes(rendered[0].details, "After breakfast");
  assertStringIncludes(rendered[0].details, "On a tight day");
  assertStringIncludes(rendered[0].details, "five-sentence teach-back");
  assertStringIncludes(
    rendered[0].details,
    "If this gets missed",
  );
  assertStringIncludes(
    rendered[0].details,
    "Count closed-book recalls",
  );
  assertEquals(rendered[0].details.includes("Do:"), false);
  assertEquals(rendered[0].details.includes("Cue:"), false);
});

Deno.test("renderNotesFromPlanSpec rewrites passive learning details into active plain language", () => {
  const classification = classifyIntent({
    description: "Create a quantum mechanics study flow.",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 1,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    requestedTimeWindow: {
      startTime: "09:00",
      endTime: "10:00",
      source: "single",
    },
    dateRangeDays: 1,
  });

  const planSpec = coercePlanSpec({
    raw: {
      goal: { title: "Quantum Mechanics", domain: "learning" },
      actions: [
        {
          action_id: "a001",
          title: "Quantum mechanics principles",
          definition_of_done:
            "Explain wave-particle duality and the uncertainty principle from memory.",
          duration_min: 60,
          trigger: "Start at 09:00 and protect the block until 10:00.",
          context_anchor: "study materials open",
          learning_mode: "spaced_retrieval",
          minimum_version: "Summarize one section from memory.",
          stretch_version: "Work one example problem.",
          obstacle_plan: {
            if_low_time: "Summarize one section from memory.",
            if_distracted: "Close distractions and recall for five minutes.",
            if_missed: "Do the minimum version later today.",
          },
          metric_keys: ["actions_completed", "retrieval_reps"],
          evidence_tags: ["learning", "retrieval"],
          risk_tier: "low",
          scheduled_day_index: 0,
          render_hints: {
            details:
              "Start by reviewing key principles of quantum mechanics. Read chapters 1-2 of your textbook, focusing on wave-particle duality and the uncertainty principle. Take notes on key concepts and examples, aiming for 2-3 pages of notes. If time is short, summarize each section instead.",
            all_day: false,
            start_time: "09:00",
            end_time: "10:00",
            location: "desk",
          },
        },
      ],
    },
    fallbackFlowName: "Quantum Mechanics",
    classification,
    decisionMatrix,
    dateRangeDays: 1,
  });

  const rendered = renderNotesFromPlanSpec({ planSpec });
  const details = rendered[0].details;

  assertStringIncludes(details, "chapters 1-2");
  assertStringIncludes(details, "close the source");
  assertStringIncludes(details, "teach-back");
  assertStringIncludes(details, "Count closed-book recalls");
  assertEquals(details.includes("Start by reviewing"), false);
  assertEquals(details.includes("key principles"), false);
  assertEquals(details.includes("Do:"), false);
  assertEquals(details.includes("Track:"), false);
});

Deno.test("renderNotesFromPlanSpec does not surface generic setup cues as location", () => {
  const classification = classifyIntent({
    description: "Create a 1 day study flow.",
    flowFormat: "SYNTHESIS",
    dateRangeDays: 1,
    sourceHandling: "NONE",
  });
  const decisionMatrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 1,
  });

  const planSpec = coercePlanSpec({
    raw: {
      goal: { title: "Study Flow", domain: "learning" },
      actions: [
        {
          action_id: "a001",
          title: "Recall chapter 1",
          definition_of_done: "Explain the chapter from memory.",
          duration_min: 20,
          trigger: "After breakfast, start recall.",
          context_anchor: "study materials open",
          learning_mode: "spaced_retrieval",
          minimum_version: "Recall one section.",
          stretch_version: "Teach back the whole chapter.",
          obstacle_plan: {
            if_low_time: "Recall one section.",
            if_distracted: "Reset and do five minutes.",
            if_missed: "Do the minimum version later today.",
          },
          metric_keys: ["actions_completed"],
          evidence_tags: ["learning"],
          risk_tier: "low",
          scheduled_day_index: 0,
          render_hints: {
            details: "Recall chapter 1 from memory.",
            all_day: false,
            start_time: "07:00",
            end_time: "07:20",
          },
        },
      ],
    },
    fallbackFlowName: "Study Flow",
    classification,
    decisionMatrix,
    dateRangeDays: 1,
  });

  const rendered = renderNotesFromPlanSpec({ planSpec });

  assertEquals(rendered[0].location, null);
});

Deno.test("classifyIntent treats Medu Neter practice as learning", () => {
  const classification = classifyIntent({
    description: "Practice Medu Neter symbols for 7 days.",
    flowFormat: "REGIMEN",
    dateRangeDays: 7,
    sourceHandling: "NONE",
  });

  assertEquals(classification.domain, "learning");
  assertEquals(classification.goal_type, "learning");
});

Deno.test("buildDecisionMatrix tolerates null-only outcome vectors", () => {
  const classification = classifyIntent({
    description: "Build me a practical finance flow.",
    flowFormat: "FINANCE_PLAN",
    dateRangeDays: 5,
    sourceHandling: "NONE",
  });

  const matrix = buildDecisionMatrix({
    classification,
    dateRangeDays: 5,
    outcomeVectors: [
      { completion_ratio: null, edit_pressure: null },
      {},
    ],
  });

  assertEquals(matrix.version, "plan_dm_v1");
  assertEquals(matrix.strategy_kind, "automation");
  assertEquals(matrix.max_actions_per_day >= 1, true);
});
