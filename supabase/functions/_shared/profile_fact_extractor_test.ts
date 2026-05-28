import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  extractMaatUserProfileFacts,
  type MaatUserProfileFact,
} from "./profile_fact_extractor.ts";
import { translateMaatProfileContext } from "./profile_context_translator.ts";
import {
  buildReflectionAlignmentMap,
  buildReflectionArcPlan,
} from "./reflection_calendar.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";

const nowIso = "2026-05-24T12:00:00.000Z";

function badge(
  title: string,
  details = "",
  occurred_on = "2026-05-24",
  tags: string[] = [],
) {
  return {
    title,
    details,
    occurred_on,
    tags,
  };
}

function emptyThreads(): MaatNormalizedObligationThreads {
  const emptyDomain = {
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
    dominant_problem: "none" as const,
    confidence: "low" as const,
  };
  return {
    version: "maat_obligation_threads_v1",
    threads: [],
    nutrition: { ...emptyDomain },
    todo: { ...emptyDomain },
  };
}

Deno.test("profile facts identify batch completion and translate without raw labels", () => {
  const facts = extractMaatUserProfileFacts({
    nowIso,
    badges: Array.from({ length: 6 }, (_, index) =>
      badge(
        `Completed to-do: creative draft ${index + 1}`,
        "Finished a section of the design draft.",
        "2026-05-24",
        ["planner", "kind:todo", "state:done"],
      )),
  });
  assert(
    facts.some((fact) =>
      fact.fact_type === "routine_style" && fact.value === "batch_worker"
    ),
  );
  const context = translateMaatProfileContext(facts);
  assertStringIncludes(context.phrases.join(" "), "focused batches");
  assert(!context.phrases.join(" ").includes("routine_style"));
  assert(!context.phrases.join(" ").includes("batch_worker"));
});

Deno.test("profile facts identify surface logger record style", () => {
  const facts = extractMaatUserProfileFacts({
    nowIso,
    badges: [
      badge("Journal: prayer", ""),
      badge("Journal: nutrition", ""),
      badge("Journal: work", ""),
      badge("Journal: study", ""),
    ],
  });
  assert(
    facts.some((fact) =>
      fact.fact_type === "record_style" && fact.value === "surface_logger"
    ),
  );
  const context = translateMaatProfileContext(facts);
  assertStringIncludes(context.phrases.join(" "), "written record");
});

Deno.test("profile facts identify reminder-anchored rhythm", () => {
  const facts = extractMaatUserProfileFacts({
    nowIso,
    badges: [
      badge("Morning reminder", "Notification helped me return."),
      badge("Evening reminder", "Scheduled alert carried the close."),
    ],
  });
  assert(
    facts.some((fact) =>
      fact.fact_type === "routine_style" &&
      fact.value === "reminder_anchored"
    ),
  );

  const context = translateMaatProfileContext(facts);
  assertStringIncludes(context.phrases.join(" "), "Reminder behavior");
});

Deno.test("profile facts identify accumulator and recurring obligation patterns", () => {
  const threads = emptyThreads();
  threads.nutrition = {
    ...threads.nutrition,
    unique_item_count: 2,
    occurrence_count: 8,
    pending_count: 8,
    same_item_repeated: true,
    dominant_problem: "schedule_too_dense",
    confidence: "high",
  };
  threads.todo = {
    ...threads.todo,
    unique_item_count: 4,
    occurrence_count: 4,
    pending_count: 4,
    confidence: "high",
  };
  const facts = extractMaatUserProfileFacts({
    nowIso,
    normalizedObligationThreads: threads,
  });
  assert(
    facts.some((fact) =>
      fact.fact_type === "commitment_pattern" && fact.value === "accumulator"
    ),
  );
  assert(
    facts.some((fact) =>
      fact.fact_type === "commitment_pattern" &&
      fact.value === "many_open_loops"
    ),
  );
  const context = translateMaatProfileContext(facts);
  assertStringIncludes(context.phrases.join(" "), "smaller active list");
});

Deno.test("profile facts distinguish caretaker and self-care direction", () => {
  const threads = emptyThreads();
  threads.nutrition = {
    ...threads.nutrition,
    unique_item_count: 1,
    occurrence_count: 3,
    pending_count: 2,
    confidence: "high",
  };
  const facts = extractMaatUserProfileFacts({
    nowIso,
    normalizedObligationThreads: threads,
    badges: [
      badge(
        "Family medicine support",
        "Prepared medicine for child and checked family care.",
      ),
      badge("Care note", "Supported partner with household burden."),
    ],
  });
  assert(
    facts.some((fact) =>
      fact.fact_type === "role_context" && fact.value === "caretaker"
    ),
  );
  assert(facts.some((fact) =>
    fact.fact_type === "care_direction" &&
    fact.value === "mixed_self_and_other_care"
  ));
  const context = translateMaatProfileContext(facts);
  assertStringIncludes(context.phrases.join(" "), "outward");
});

Deno.test("profile facts translate interruption-averse and scope-mismatch outcomes", () => {
  const facts = extractMaatUserProfileFacts({
    nowIso,
    guidanceOutcomes: {
      opened: 1,
      acted: 3,
      resolved: 0,
      dismissed: 4,
      expired: 0,
    },
  });
  assert(facts.some((fact) =>
    fact.fact_type === "guidance_response" &&
    fact.value === "interruption_averse"
  ));
  assert(
    facts.some((fact) =>
      fact.fact_type === "offering_fit" && fact.value === "scope_reduction"
    ),
  );
  const context = translateMaatProfileContext(facts);
  assertStringIncludes(context.phrases.join(" "), "question or invitation");
});

Deno.test("low-confidence facts are omitted by default or phrased cautiously", () => {
  const facts = extractMaatUserProfileFacts({
    nowIso,
    badges: [badge("Story", "")],
  });
  const lowFact = facts.find((fact) => fact.confidence === "low");
  assert(lowFact);
  const defaultContext = translateMaatProfileContext(facts);
  assertEquals(defaultContext.phrases.length, 0);
  const cautiousContext = translateMaatProfileContext(facts, {
    includeLowConfidenceFallback: true,
  });
  assertStringIncludes(cautiousContext.phrases.join(" "), "light signal");
});

Deno.test("reflection arc plan carries translated profile context", () => {
  const profileFact: MaatUserProfileFact = {
    version: "maat_user_profile_facts_v1",
    fact_type: "record_style",
    value: "surface_logger",
    source: "test",
    confidence: "medium",
    evidence_count: 2,
    first_seen: nowIso,
    last_seen: nowIso,
    stability: "emerging",
    counterevidence: null,
    metadata: {},
  };
  const translatedProfileContext = translateMaatProfileContext([profileFact]);
  const plan = buildReflectionArcPlan({
    alignmentMap: buildReflectionAlignmentMap({
      translatedProfileContext,
    }),
    translatedProfileContext,
  });
  assertEquals(plan.profileContextRefs[0]?.value, "surface_logger");
  assertStringIncludes(plan.profileContextPhrases.join(" "), "written record");
});
