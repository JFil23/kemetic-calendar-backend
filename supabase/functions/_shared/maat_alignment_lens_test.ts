// deno-lint-ignore-file no-import-prefix

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import { selectMaatAlignmentLens } from "./maat_alignment_lens.ts";

const baseFact = {
  version: "maat_user_profile_facts_v1" as const,
  source: "test",
  confidence: "high" as const,
  evidence_count: 5,
  first_seen: "2026-05-01T00:00:00.000Z",
  last_seen: "2026-05-24T00:00:00.000Z",
  stability: "stable" as const,
  counterevidence: null,
  metadata: {},
};

Deno.test("nutrition recording issue maps to measure truth and life preservation", () => {
  const threads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const selection = selectMaatAlignmentLens({
    caseKey: "provision.repeated_open_checks",
    selectedOffering: "reschedule",
    normalizedObligationThreads: threads,
  });

  assertEquals(selection.dominantMaatLens, "measure");
  assert(selection.candidateLenses.includes("truth"));
  assert(selection.candidateLenses.includes("life_preservation"));
  assert(selection.ethicalQuestion.includes("sized and placed"));
});

Deno.test("todo overload maps to order measure and repair of isfet", () => {
  const threads = buildNormalizedObligationThreads([
    "Todo: finish deploy. State: pending. kind:todo state:pending",
    "Todo: fix test. State: pending. kind:todo state:pending",
    "Todo: write docs. State: pending. kind:todo state:pending",
    "Todo: review admin. State: pending. kind:todo state:pending",
  ]);
  const selection = selectMaatAlignmentLens({
    caseKey: "visible_work.too_many_open_loops",
    selectedOffering: "reduce_and_complete_one",
    normalizedObligationThreads: threads,
  });

  assertEquals(selection.dominantMaatLens, "order");
  assert(selection.candidateLenses.includes("measure"));
  assert(selection.candidateLenses.includes("repair_isfet"));
});

Deno.test("vague journal maps to truth witness and continuity", () => {
  const selection = selectMaatAlignmentLens({
    caseKey: "truthful_record.vague_entries",
    selectedOffering: "write_record",
  });

  assertEquals(selection.dominantMaatLens, "truth");
  assert(selection.candidateLenses.includes("witness"));
  assert(selection.candidateLenses.includes("continuity"));
});

Deno.test("caretaker self-care maps to reciprocity life preservation and care", () => {
  const selection = selectMaatAlignmentLens({
    caseKey: "care.self_care_displaced",
    profileFacts: [{
      ...baseFact,
      fact_type: "care_direction",
      value: "mixed_self_and_other_care",
    }],
  });

  assertEquals(selection.dominantMaatLens, "care");
  assert(selection.candidateLenses.includes("reciprocity"));
  assert(selection.candidateLenses.includes("life_preservation"));
});

Deno.test("repeated overcommitment maps to measure restraint and self-mastery", () => {
  const selection = selectMaatAlignmentLens({
    caseKey: "restraint.repeated_overcommit",
    profileFacts: [{
      ...baseFact,
      fact_type: "commitment_pattern",
      value: "accumulator",
    }],
  });

  assertEquals(selection.dominantMaatLens, "measure");
  assert(selection.candidateLenses.includes("restraint"));
  assert(selection.candidateLenses.includes("self_mastery"));
});

Deno.test("same habit evidence can take different Ma'at lenses from profile facts", () => {
  const threads = buildNormalizedObligationThreads([
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-19. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-20. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
    "Nutrition: vitamin A Planner nutrition entry for 2026-05-21. State: pending. Source: apple. Purpose: strong bones. kind:nutrition state:pending",
  ]);
  const recordLens = selectMaatAlignmentLens({
    normalizedObligationThreads: threads,
    profileFacts: [{
      ...baseFact,
      fact_type: "record_style",
      value: "surface_logger",
    }],
  });
  const careLens = selectMaatAlignmentLens({
    normalizedObligationThreads: threads,
    profileFacts: [{
      ...baseFact,
      fact_type: "care_direction",
      value: "mixed_self_and_other_care",
    }],
  });

  assertEquals(recordLens.dominantMaatLens, "truth");
  assert(careLens.candidateLenses.includes("care"));
  assert(careLens.candidateLenses.includes("reciprocity"));
});
