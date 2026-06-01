import {
  assert,
  assertArrayIncludes,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ALL_MAAT_FLOW_TEMPLATE_KEYS,
  compiledDestinationForPackage,
  destinationPayload,
  resolveCalendarDestination,
  resolveMaatGuidanceDestination,
  resolveReflectionDestination,
} from "./maat_destination_resolver.ts";
import type { MaatDimensionSnapshot } from "../ai_generate_reflection/maat_decision.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type { ReflectionCalendarFrame } from "./reflection_calendar.ts";
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
  overrides: Partial<ReflectionJudgment> = {},
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
    ...overrides,
  };
}

function calendarFrame(
  overrides: Partial<ReflectionCalendarFrame> = {},
): ReflectionCalendarFrame {
  return {
    version: "reflection_calendar_frame_v1",
    monthName: "Thoth",
    monthTransliteration: "Djehuty",
    monthMeaning: "measure, record keeping, and right orientation",
    seasonName: "Akhet",
    seasonMeaning: "emergence",
    decanName: "ordinary decan",
    decanShortName: "ordinary",
    decanNumber: 1,
    decanOrdinal: "first",
    ceremonialDecanName: "ordinary decan",
    decanTheme: "ordinary wisdom and instruction",
    decanDescription: "A period for learning from the record.",
    dayCards: [],
    arcSummary: "The arc asks learning to become right orientation.",
    ...overrides,
  };
}

function careThreads(): MaatNormalizedObligationThreads {
  return {
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
  };
}

Deno.test("destination resolver exposes every registered Ma'at flow template", () => {
  assertEquals(
    ALL_MAAT_FLOW_TEMPLATE_KEYS.sort(),
    [
      "dawn-house-rite",
      "evening-threshold-rite",
      "het-heru",
      "hotep",
      "the-clearing",
      "the-course",
      "the-autobiography",
      "the-boundary-stone",
      "the-days-outside-the-year",
      "the-decan-watch",
      "the-djed",
      "the-fair-hearing",
      "the-first-arrangement",
      "the-house-of-life",
      "the-kept-word",
      "the-khat",
      "the-living-pattern",
      "the-living-record",
      "the-living-text",
      "the-moon-return",
      "the-offering-table",
      "the-open-hand",
      "the-open-mouth",
      "the-oracle",
      "the-shore",
      "the-tending",
      "the-true-name",
      "the-wandering",
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
  assertEquals(
    resolveMaatGuidanceDestination({
      snapshot: snapshot("J"),
      mode: "drift",
    }).ctaRef,
    "the-fair-hearing",
  );
  assertEquals(
    resolveMaatGuidanceDestination({
      snapshot: snapshot("R"),
      mode: "drift",
    }).ctaRef,
    "the-boundary-stone",
  );
  assertEquals(
    resolveMaatGuidanceDestination({
      snapshot: snapshot("H"),
      mode: "drift",
    }).ctaRef,
    "hotep",
  );
});

Deno.test("reflection destination defaults to House of Life for general wisdom and learning", () => {
  const destination = resolveReflectionDestination({
    calendarFrame: calendarFrame({
      decanTheme: "wisdom and learning",
      decanDescription: "Instruction is the strongest bridge.",
      arcSummary: "Learn from what the decan made visible.",
    }),
  });

  assertEquals(destination.ctaType, "flow_template");
  assertEquals(destination.ctaRef, "the-house-of-life");
  assertEquals(destination.source, "calendar_arc");
});

Deno.test("reflection destination keeps order and imbalance reflections on Library nodes by default", () => {
  const destination = resolveReflectionDestination({
    judgment: judgment("order", {
      centralMoralReading:
        "The evidence shows imbalance and the need to understand order.",
      reflectionThesis:
        "The learning bridge should explain ordered form before action.",
    }),
  });

  assertEquals(destination.ctaType, "node");
  assertEquals(destination.ctaRef, "ptah");
  assertEquals(destination.source, "reflection_judgment");
});

Deno.test("reflection destination selects The Tending only with strong care evidence", () => {
  const care = resolveReflectionDestination({
    judgment: judgment("care", {
      evidenceAnchor:
        "A recurring body-care promise is still asking to be tended.",
      reflectionThesis:
        "Care must become a keepable tending practice rather than a vague intention.",
    }),
    normalizedObligationThreads: careThreads(),
  });
  assertEquals(care.ctaType, "flow_template");
  assertEquals(care.ctaRef, "the-tending");
  assertEquals(care.source, "reflection_judgment");
  assertEquals(care.fallback?.ctaType, "node");
  assertEquals(care.fallback?.ctaRef, "instruction_amenemope");
  assert(care.score !== null && care.score >= 7);
  assert(care.confidence >= 0.79);
  assertArrayIncludes(care.signals, [
    "lens:care",
    "care_thread",
    "care_language",
  ]);
  assertEquals(care.motivation.score, care.score);
  assertEquals(care.motivation.signals, care.signals);
});

Deno.test("reflection destination selects Kept Word only with strong agreement evidence", () => {
  const keptWord = resolveReflectionDestination({
    judgment: judgment("effective_speech", {
      centralMoralReading:
        "The unresolved point is an agreement where word and act must meet.",
      reflectionThesis:
        "A promise needs one corresponding act so the kept word can stand.",
    }),
  });

  assertEquals(keptWord.ctaType, "flow_template");
  assertEquals(keptWord.ctaRef, "the-kept-word");
  assertEquals(keptWord.fallback?.ctaType, "node");
  assertEquals(keptWord.fallback?.ctaRef, "instruction_amenemope");
  assertArrayIncludes(keptWord.signals, [
    "lens:effective_speech",
    "agreement_language",
  ]);
});

Deno.test("reflection destination separates Open Mouth speech from Kept Word agreements", () => {
  const openMouth = resolveReflectionDestination({
    judgment: judgment("effective_speech", {
      centralMoralReading:
        "The mouth is heated and an important truth has stayed unsaid.",
      reflectionThesis:
        "The next practice is governing the tongue before the utterance enters the world.",
    }),
  });

  assertEquals(openMouth.ctaType, "flow_template");
  assertEquals(openMouth.ctaRef, "the-open-mouth");
  assertArrayIncludes(openMouth.signals, [
    "lens:effective_speech",
    "speech_language",
  ]);
});

Deno.test("weak or ambiguous reflection signal chooses node instead of flow", () => {
  const weakCare = resolveReflectionDestination({
    judgment: judgment("care", {
      centralMoralReading: "The reflection asks for a clearer reading.",
      reflectionThesis: "The bridge should teach before it asks for action.",
    }),
  });
  assertEquals(weakCare.ctaType, "node");
  assertEquals(weakCare.ctaRef, "instruction_amenemope");

  const truth = resolveReflectionDestination({ judgment: judgment("truth") });
  assertEquals(truth.ctaType, "node");
  assertEquals(truth.ctaRef, "maat");
});

Deno.test("truth and judgment reflections choose Weighing only with strong evidence", () => {
  const weakTruth = resolveReflectionDestination({
    judgment: judgment("truth", {
      centralMoralReading: "The reflection asks for truthful attention.",
      reflectionThesis: "The user should learn the principle before acting.",
    }),
  });
  assertEquals(weakTruth.ctaType, "node");
  assertEquals(weakTruth.ctaRef, "maat");

  const weighing = resolveReflectionDestination({
    judgment: judgment("truth", {
      centralMoralReading:
        "The record must be weighed against truth without hiding the false record.",
      reflectionThesis:
        "A truthful account and accountability are the needed next practice.",
    }),
  });
  assertEquals(weighing.ctaType, "flow_template");
  assertEquals(weighing.ctaRef, "the-weighing");
  assertEquals(weighing.fallback?.ctaType, "node");
  assertEquals(weighing.fallback?.ctaRef, "maat");
  assertArrayIncludes(weighing.signals, [
    "lens:truth",
    "weighing_language",
  ]);
});

Deno.test("one weak keyword does not trigger a flow recommendation", () => {
  const speechOnly = resolveReflectionDestination({
    judgment: judgment("effective_speech", {
      centralMoralReading: "Speech needs more learning before action.",
      reflectionThesis: "The bridge should teach right expression first.",
    }),
  });
  assertEquals(speechOnly.ctaType, "node");
  assertEquals(speechOnly.ctaRef, "instruction_amenemope");

  const careOnly = resolveReflectionDestination({
    judgment: judgment("care", {
      centralMoralReading: "Care is present but not yet specific.",
      reflectionThesis: "The bridge should teach before it assigns a rite.",
    }),
  });
  assertEquals(careOnly.ctaType, "node");
  assertEquals(careOnly.ctaRef, "instruction_amenemope");
});

Deno.test("the same lens can choose different destinations from reflection evidence", () => {
  const learningCare = resolveReflectionDestination({
    judgment: judgment("care", {
      centralMoralReading: "Care needs clearer instruction before action.",
      reflectionThesis: "Study the care principle before forming a rite.",
    }),
  });
  assertEquals(learningCare.ctaType, "node");
  assertEquals(learningCare.ctaRef, "instruction_amenemope");

  const tendingCare = resolveReflectionDestination({
    judgment: judgment("care", {
      evidenceAnchor: "Nutrition and body support were repeatedly pending.",
      reflectionThesis:
        "The user's body care has become a concrete tending obligation.",
    }),
    normalizedObligationThreads: careThreads(),
  });
  assertEquals(tendingCare.ctaType, "flow_template");
  assertEquals(tendingCare.ctaRef, "the-tending");
});

Deno.test("reflection destination selects Living Record for full-app record keeping", () => {
  const destination = resolveReflectionDestination({
    judgment: judgment("continuity", {
      centralMoralReading:
        "The decan needs a living record across the day card, node library, planner, journal, feed, alignment grid, and Flow Studio.",
      reflectionThesis:
        "Continuity should become a dated decan record rather than a loose intention.",
    }),
  });

  assertEquals(destination.ctaType, "flow_template");
  assertEquals(destination.ctaRef, "the-living-record");
  assertEquals(destination.fallback?.ctaType, "node");
  assertEquals(destination.fallback?.ctaRef, "djehuty");
  assertArrayIncludes(destination.signals, [
    "lens:continuity",
    "living_record_language",
  ]);
});

Deno.test("reflection destination selects Het-Heru for joy and transformed heat", () => {
  const destination = resolveReflectionDestination({
    judgment: judgment("harmony", {
      centralMoralReading:
        "A hot force has momentum, but the next movement is joy, music, beauty, and delight rather than suppression.",
      reflectionThesis:
        "The Sekhmet force needs red beer: abundance that transforms the field.",
    }),
  });

  assertEquals(destination.ctaType, "flow_template");
  assertEquals(destination.ctaRef, "het-heru");
  assertEquals(destination.fallback?.ctaType, "node");
  assertEquals(destination.fallback?.ctaRef, "hathor");
  assertArrayIncludes(destination.signals, [
    "lens:harmony",
    "het_heru_language",
  ]);
});

Deno.test("reflection destination selects the new Ma'at Flow suite from explicit signals", () => {
  const cases = [
    {
      lens: "measure" as const,
      text:
        "Money, price, and exchange value are the real question in this client negotiation.",
      ref: "the-shore",
      signal: "exchange_language",
    },
    {
      lens: "continuity" as const,
      text:
        "A birthday life review is raising legacy, accomplishments, and unfinished work.",
      ref: "the-autobiography",
      signal: "life_review_language",
    },
    {
      lens: "order" as const,
      text:
        "The office desk and workspace clutter are blocking focus and need a physical reset.",
      ref: "the-first-arrangement",
      signal: "space_order_language",
    },
    {
      lens: "becoming" as const,
      text: "Nature observation and one plant pattern are teaching patience.",
      ref: "the-living-pattern",
      signal: "nature_observation_language",
    },
    {
      lens: "truth" as const,
      text:
        "Identity, confidence, and a false belief about people like me need an accurate account.",
      ref: "the-true-name",
      signal: "identity_language",
    },
    {
      lens: "becoming" as const,
      text:
        "The Library entry opened a question, a reflection, and a connection I should add as insight.",
      ref: "the-living-text",
      signal: "library_contribution_language",
    },
    {
      lens: "self_mastery" as const,
      text:
        "I snapped in conflict and need space before I reply from reactive heat.",
      ref: "the-clearing",
      signal: "reactivity_language",
    },
    {
      lens: "harmony" as const,
      text:
        "Grief and loss keep returning through memory; I am mourning what remains.",
      ref: "the-wandering",
      signal: "grief_language",
    },
    {
      lens: "care" as const,
      text:
        "My body is tired, carrying tension, and needs water, sleep, rest, and movement.",
      ref: "the-khat",
      signal: "body_care_language",
    },
    {
      lens: "becoming" as const,
      text:
        "A dream question before sleep may offer guidance through a symbol in the night.",
      ref: "the-oracle",
      signal: "oracle_language",
    },
  ];

  for (const item of cases) {
    const destination = resolveReflectionDestination({
      judgment: judgment(item.lens, {
        centralMoralReading: item.text,
        reflectionThesis: item.text,
      }),
    });
    assertEquals(destination.ctaType, "flow_template");
    assertEquals(destination.ctaRef, item.ref);
    assertArrayIncludes(destination.signals, [item.signal]);
  }
});

Deno.test("grief crisis language does not route to The Wandering as a substitute for support", () => {
  const destination = resolveReflectionDestination({
    judgment: judgment("harmony", {
      centralMoralReading:
        "Grief and loss are acute distress and crisis tonight.",
      reflectionThesis: "This needs support before a practice is suggested.",
    }),
  });

  assert(destination.ctaRef !== "the-wandering");
});

Deno.test("different reflection text changes the recommended Library node", () => {
  const learning = resolveReflectionDestination({
    calendarFrame: calendarFrame({
      decanTheme: "instruction and wisdom",
      decanDescription: "The period asks the user to learn from the record.",
    }),
  });
  assertEquals(learning.ctaType, "flow_template");
  assertEquals(learning.ctaRef, "the-house-of-life");

  const order = resolveReflectionDestination({
    calendarFrame: calendarFrame({
      decanTheme: "ordered form and craft",
      decanDescription: "The period asks for shape and structure.",
      arcSummary: "Craft turns scattered attention into ordered form.",
    }),
  });
  assertEquals(order.ctaType, "node");
  assertEquals(order.ctaRef, "ptah");
});

Deno.test("destination payload preserves explicit motivation metadata", () => {
  const destination = resolveReflectionDestination({
    judgment: judgment("effective_speech", {
      centralMoralReading:
        "The unresolved point is an agreement where word and act must meet.",
      reflectionThesis:
        "A promise needs one corresponding act so the kept word can stand.",
    }),
  });

  const payload = destinationPayload(destination);
  const compiledDestination = compiledDestinationForPackage(destination);
  const nested = payload.destination as Record<string, unknown>;
  assertEquals(payload.destination_reason, destination.reason);
  assertEquals(payload.destination_confidence, destination.confidence);
  assertEquals(payload.destination_score, destination.score);
  assertEquals(payload.destination_signals, destination.signals);
  assertEquals(nested.motivation, destination.motivation);
  assertEquals(compiledDestination?.motivation, destination.motivation);
  assertEquals(compiledDestination?.signals, destination.signals);
  assertArrayIncludes(nested.signals as string[], [
    "lens:effective_speech",
    "agreement_language",
  ]);
});

Deno.test("calendar destination can route sky, decan, moon, wag, boundary, dawn, and Ma'at flow contexts", () => {
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
    resolveCalendarDestination({ decanContext: "decanal star rising" }).ctaRef,
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
  assertEquals(
    resolveCalendarDestination({
      decanContext: "house of life scribal learning",
    })
      .ctaRef,
    "the-house-of-life",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "boundary stone and excess force",
    })
      .ctaRef,
    "the-boundary-stone",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "hotep cool heart before sleep",
    })
      .ctaRef,
    "hotep",
  );
  assertEquals(
    resolveCalendarDestination({ decanContext: "open mouth heated speech" })
      .ctaRef,
    "the-open-mouth",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext:
        "living record through the day card, node library, planner, journal, feed, and physical record",
    }).ctaRef,
    "the-living-record",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "Het-Heru red beer, music, beauty, and joy",
    }).ctaRef,
    "het-heru",
  );
  assertEquals(
    resolveCalendarDestination({ decanContext: "fair hearing before judgment" })
      .ctaRef,
    "the-fair-hearing",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "client exchange value and contract negotiation",
    })
      .ctaRef,
    "the-shore",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "legacy life review and unfinished work",
    })
      .ctaRef,
    "the-autobiography",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "workspace clutter and physical reset",
    })
      .ctaRef,
    "the-first-arrangement",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "nature observation of one plant pattern",
    })
      .ctaRef,
    "the-living-pattern",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "identity and accurate account",
    })
      .ctaRef,
    "the-true-name",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "Library entry reflection question and connection",
    })
      .ctaRef,
    "the-living-text",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "reactive heat in conflict before I reply",
    })
      .ctaRef,
    "the-clearing",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "grief and loss with memory of what remains",
    })
      .ctaRef,
    "the-wandering",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "body care through water, sleep, rest, and movement",
    })
      .ctaRef,
    "the-khat",
  );
  assertEquals(
    resolveCalendarDestination({
      decanContext: "dream question before sleep and night symbol guidance",
    })
      .ctaRef,
    "the-oracle",
  );
});

Deno.test("calendar destination falls back to decan watch", () => {
  const destination = resolveCalendarDestination({
    decanTheme: "ordinary decan context",
  });
  assertEquals(destination.ctaRef, "the-decan-watch");
  assert(destination.confidence > 0);
});
