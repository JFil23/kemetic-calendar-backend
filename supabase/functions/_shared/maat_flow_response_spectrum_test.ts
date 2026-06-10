// deno-lint-ignore-file no-import-prefix

import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildMaatFlowCompletionEvidenceBadges } from "./guidance_evidence.ts";
import {
  MAAT_FLOW_RESPONSE_SPECTRUM,
  MAAT_FLOW_TENSION_TEMPLATES,
  MAAT_THEME_RELATIONSHIP_TEMPLATES,
  synthesizeMaatFlowDecanPattern,
  THE_WEIGHING_FLOW_KEY,
  THE_WEIGHING_FLOW_TITLE,
} from "./maat_flow_response_spectrum.ts";

const decan = {
  decanId: "2026-05-16:2026-05-25:1-1",
  decanStart: "2026-05-16",
  decanEnd: "2026-05-25",
};

function completion(status: string, completedOn = "2026-05-18") {
  return {
    id: 1,
    client_event_id: `weighing-${status}-${completedOn}`,
    flow_id: 42,
    completed_on: completedOn,
    completed_at: `${completedOn}T17:00:00.000Z`,
    source: "client",
    metadata: {
      status,
      flow_key: THE_WEIGHING_FLOW_KEY,
      flow_title: THE_WEIGHING_FLOW_TITLE,
      event_title: "Open the Material Ledger",
      completed_on: completedOn,
    },
  };
}

function badgeFor(status: string) {
  return buildMaatFlowCompletionEvidenceBadges({
    completions: [completion(status)],
  })[0];
}

function badgeForOn(status: string, completedOn: string) {
  return buildMaatFlowCompletionEvidenceBadges({
    completions: [completion(status, completedOn)],
  })[0];
}

Deno.test("The Weighing manifest uses the discovered repo flow key and title", async () => {
  const sourceUrl = new URL(
    "../../../mobile/lib/features/calendar/the_weighing_flow.dart",
    import.meta.url,
  );
  const dayViewUrl = new URL(
    "../../../mobile/lib/features/calendar/day_view.dart",
    import.meta.url,
  );
  const sourceRead = await Deno.permissions.query({
    name: "read",
    path: sourceUrl,
  });
  const dayViewRead = await Deno.permissions.query({
    name: "read",
    path: dayViewUrl,
  });
  if (sourceRead.state === "granted" && dayViewRead.state === "granted") {
    const source = await Deno.readTextFile(sourceUrl);
    const dayView = await Deno.readTextFile(dayViewUrl);
    assertStringIncludes(
      source,
      "const String kTheWeighingFlowKey = 'the-weighing';",
    );
    assertStringIncludes(
      source,
      "const String kTheWeighingTitle = 'The Weighing';",
    );
    assertStringIncludes(source, "'flow_key': kTheWeighingFlowKey");
    assertStringIncludes(dayView, "'flow_key': flowKey");
  }

  assertEquals(THE_WEIGHING_FLOW_KEY, "the-weighing");
  assertEquals(THE_WEIGHING_FLOW_TITLE, "The Weighing");
  assertEquals(
    MAAT_FLOW_RESPONSE_SPECTRUM[THE_WEIGHING_FLOW_KEY].flowKey,
    "the-weighing",
  );
  assertEquals(
    MAAT_FLOW_RESPONSE_SPECTRUM[THE_WEIGHING_FLOW_KEY].flowTitle,
    "The Weighing",
  );
});

Deno.test("The Weighing authored spectrum copy loads from the final manifest", () => {
  const spectrum = MAAT_FLOW_RESPONSE_SPECTRUM[THE_WEIGHING_FLOW_KEY];

  assertEquals(spectrum.primaryTheme, "accountability");
  assertEquals(spectrum.secondaryTheme, "witnessing");
  assertEquals(
    spectrum.interpretiveSpine,
    "The gap between the account and the weight.",
  );

  assertEquals(
    spectrum.tiers.observed.meaning,
    "The sitting was completed. The account was brought to the scale and not adjusted before placement. The gap between what happened and what was recorded had a chance to close.",
  );
  assertEquals(
    spectrum.tiers.observed.lenses.reflection.seed,
    "The record was brought to the scale without alteration. What the decan carried has been acknowledged and set down.",
  );
  assertEquals(
    spectrum.tiers.partial.meaning,
    "The sitting was entered but not completed. The account was opened but the weight was not fully placed. The gap did not close, though the approach was made.",
  );
  assertEquals(
    spectrum.tiers.partial.lenses.reflection.seed,
    "The sitting was entered but not completed. The scale was approached; the full account was not placed.",
  );
  assertEquals(
    spectrum.tiers.skipped_explicit.meaning,
    "The sitting was available and was set aside. The scale was not approached. The account was not opened. The decan moved without the measure being taken.",
  );
  assertEquals(
    spectrum.tiers.unobserved.meaning,
    "No completion record exists for this event. The sitting did not enter the record. This is absence of signal, not proof of avoidance or rest.",
  );
});

Deno.test("completion evidence preserves observed, partial, and skipped statuses", () => {
  const observed = badgeFor("observed");
  assertEquals(observed.raw_status, "observed");
  assertEquals(observed.canonical_tier, "observed");
  assertEquals(observed.metadata?.status, "observed");
  assertEquals(observed.metadata?.flow_key, THE_WEIGHING_FLOW_KEY);
  assertEquals(observed.metadata?.flow_title, THE_WEIGHING_FLOW_TITLE);
  assertEquals(observed.metadata?.event_title, "Open the Material Ledger");
  assertEquals(observed.metadata?.completed_on, "2026-05-18");
  assertEquals(observed.metadata?.completed_at, "2026-05-18T17:00:00.000Z");
  assertEquals(observed.metadata?.canonical_tier, "observed");
  assert(observed.tags.includes("state:observed"));
  assertEquals(observed.tags.includes("state:done"), false);

  const partial = badgeFor("observed_partly");
  assertEquals(partial.raw_status, "observed_partly");
  assertEquals(partial.canonical_tier, "partial");
  assertEquals(partial.metadata?.status, "observed_partly");
  assertEquals(partial.metadata?.canonical_tier, "partial");
  assert(partial.tags.includes("state:partial"));
  assertEquals(partial.tags.includes("state:done"), false);

  const skipped = badgeFor("skipped");
  assertEquals(skipped.raw_status, "skipped");
  assertEquals(skipped.canonical_tier, "skipped_explicit");
  assertEquals(skipped.metadata?.status, "skipped");
  assertEquals(skipped.metadata?.canonical_tier, "skipped_explicit");
  assert(skipped.tags.includes("state:skipped"));
  assertEquals(skipped.tags.includes("state:done"), false);
});

Deno.test("scheduled but uncompleted Weighing becomes unobserved, not skipped", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    scheduledEvents: [{
      flowKey: THE_WEIGHING_FLOW_KEY,
      eventTitle: "Open the Material Ledger",
      scheduledOn: "2026-05-18",
      clientEventId: "the-weighing-event-01",
    }],
  });

  assertEquals(synthesis.flowSignals.length, 1);
  assertEquals(synthesis.flowSignals[0].canonicalTier, "unobserved");
  assertNotEquals(synthesis.flowSignals[0].canonicalTier, "skipped_explicit");
  assertEquals(synthesis.flowSignals[0].inferenceMode, "neutral");
  assertEquals(synthesis.centralTension, null);
  assertEquals(synthesis.selectedTensionTemplateId, null);
  assertEquals(synthesis.selectedSeeds.reflection?.tier, "unobserved");
  assertEquals(synthesis.interpretiveEmphasis, {
    dominantTier: "unobserved",
    lastExplicitTier: null,
    reflectionTier: "unobserved",
    orientationTier: "unobserved",
    alignmentTier: "unobserved",
    reason: "no_explicit_completion_signal",
  });
});

Deno.test("The Weighing observed, partial, and skipped resolve canonical tiers", () => {
  const observed = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed")],
  });
  assertEquals(observed.dominantTier, "observed");
  assertEquals(observed.themeSignals[0].theme, "accountability");
  assertEquals(observed.themeSignals[0].mode, "held");
  assertEquals(observed.themeSignals[0].role, "primary");
  assertEquals(observed.themeSignals[1].theme, "witnessing");
  assertEquals(observed.themeSignals[1].mode, "held");
  assertEquals(observed.themeSignals[1].role, "secondary");
  assertEquals(observed.dominantTheme, "accountability");
  assertEquals(observed.dominantThemeMode, "held");

  const partial = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed_partly")],
  });
  assertEquals(partial.dominantTier, "partial");
  assertEquals(partial.themeSignals[0].theme, "accountability");
  assertEquals(partial.themeSignals[0].mode, "interrupted");
  assertEquals(partial.themeSignals[1].theme, "witnessing");
  assertEquals(partial.themeSignals[1].mode, "interrupted");

  const skipped = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("skipped")],
  });
  assertEquals(skipped.dominantTier, "skipped_explicit");
  assertEquals(skipped.themeSignals[0].theme, "accountability");
  assertEquals(skipped.themeSignals[0].mode, "set_aside");
  assertEquals(skipped.themeSignals[1].theme, "witnessing");
  assertEquals(skipped.themeSignals[1].mode, "set_aside");
  assertEquals(skipped.flowSignals[0].inferenceMode, "restorative");
  assertNotEquals(skipped.flowSignals[0].inferenceMode, "neutral");
});

Deno.test("unobserved Weighing emits accountability absent with neutral absence", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    scheduledEvents: [{
      flowKey: THE_WEIGHING_FLOW_KEY,
      eventTitle: "Open the Material Ledger",
      scheduledOn: "2026-05-18",
      clientEventId: "the-weighing-event-01",
    }],
  });

  assertEquals(synthesis.dominantTier, "unobserved");
  assertEquals(synthesis.themeSignals[0].theme, "accountability");
  assertEquals(synthesis.themeSignals[0].mode, "absent");
  assertEquals(synthesis.themeSignals[1].theme, "witnessing");
  assertEquals(synthesis.themeSignals[1].mode, "absent");
  assertEquals(synthesis.flowSignals[0].inferenceMode, "neutral");
  assertEquals(synthesis.centralTension, null);
  assertEquals(synthesis.selectedTensionTemplateId, null);
  assertEquals(
    synthesis.fallbackReason,
    "only_unobserved_scheduled_flow_signal",
  );
  assertEquals(synthesis.interpretiveEmphasis.lastExplicitTier, null);
  assertEquals(synthesis.interpretiveEmphasis.reflectionTier, "unobserved");
});

Deno.test("same medium-confidence decan pattern deterministically selects authored solo tension text", () => {
  const first = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed"), badgeFor("observed")],
  });
  const second = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed"), badgeFor("observed")],
  });
  assertEquals(
    first.selectedFlowTensionTemplateId,
    second.selectedFlowTensionTemplateId,
  );
  assertEquals(first.selectedThemeRelationshipTemplateId, null);
  assertEquals(second.selectedThemeRelationshipTemplateId, null);

  const template = MAAT_FLOW_TENSION_TEMPLATES.find((entry) =>
    entry.id === first.selectedFlowTensionTemplateId
  );
  assertExists(template);
  assertEquals(first.centralTension, template.tension);
  assertEquals(first.selectedTensionTemplateId, template.id);
});

Deno.test("partial solo tension uses cleaned non-diagnostic wording", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeFor("observed_partly"),
      buildMaatFlowCompletionEvidenceBadges({
        completions: [completion("observed_partly", "2026-05-19")],
      })[0],
    ],
  });

  assertEquals(synthesis.confidence, "medium");
  assertEquals(
    synthesis.selectedFlowTensionTemplateId,
    "weighing-partial-solo",
  );
  assertEquals(
    synthesis.centralTension,
    "The scale was approached and the account opened, but not all of it reached the scale.",
  );
  assertEquals(
    (synthesis.centralTension?.match(/account opened/g) ?? []).length,
    1,
  );
  assertEquals(
    synthesis.centralTension?.includes("not everything was placed"),
    false,
  );
  assertEquals(
    synthesis.centralTension?.includes("being held back"),
    false,
  );
});

Deno.test("observed plus partial splits response-kind tiers and aligns tension to reflection", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeForOn("observed", "2026-05-18"),
      badgeForOn("observed_partly", "2026-05-19"),
    ],
  });

  assertEquals(synthesis.confidence, "medium");
  assertEquals(synthesis.dominantTier, "observed");
  assertEquals(synthesis.lastTier, "partial");
  assertEquals(synthesis.interpretiveEmphasis, {
    dominantTier: "observed",
    lastExplicitTier: "partial",
    reflectionTier: "partial",
    orientationTier: "observed",
    alignmentTier: "partial",
    reason: "dominant_observed_but_recent_partial",
  });
  assertEquals(synthesis.selectedSeeds.reflection?.tier, "partial");
  assertEquals(
    synthesis.selectedSeeds.reflection?.seed,
    "The sitting was entered but not completed. The scale was approached; the full account was not placed.",
  );
  assertEquals(synthesis.selectedSeeds.orientation?.tier, "observed");
  assertEquals(
    synthesis.selectedSeeds.orientation?.seed,
    "The balance holds when the measure continues.",
  );
  assertEquals(synthesis.selectedSeeds.alignment?.tier, "partial");
  assertEquals(
    synthesis.selectedSeeds.alignment?.seed,
    "Return to the sitting and place the one thing that was not yet named.",
  );
  assertEquals(
    synthesis.centralTension,
    "The scale was approached and the account opened, but not all of it reached the scale.",
  );
  assertEquals(synthesis.selectedTensionTemplateId, "weighing-partial-solo");
  assertEquals(
    synthesis.selectedFlowTensionTemplateId,
    "weighing-partial-solo",
  );
});

Deno.test("partial plus skipped reflects latest set-aside tier while orienting from partial", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeForOn("observed_partly", "2026-05-18"),
      badgeForOn("skipped", "2026-05-19"),
    ],
  });

  assertEquals(synthesis.confidence, "medium");
  assertEquals(synthesis.dominantTier, "partial");
  assertEquals(synthesis.lastTier, "skipped_explicit");
  assertEquals(synthesis.interpretiveEmphasis, {
    dominantTier: "partial",
    lastExplicitTier: "skipped_explicit",
    reflectionTier: "skipped_explicit",
    orientationTier: "partial",
    alignmentTier: "skipped_explicit",
    reason: "dominant_partial_but_recent_skipped_explicit",
  });
  assertEquals(synthesis.selectedSeeds.reflection?.tier, "skipped_explicit");
  assertEquals(
    synthesis.selectedSeeds.reflection?.seed,
    "The sitting was available and set aside. The decan moved without the account being opened.",
  );
  assertEquals(synthesis.selectedSeeds.orientation?.tier, "partial");
  assertEquals(
    synthesis.selectedSeeds.orientation?.seed,
    "The incomplete measure is still a measure - what remains can be placed without starting again.",
  );
  assertEquals(synthesis.selectedSeeds.alignment?.tier, "skipped_explicit");
  assertEquals(
    synthesis.selectedSeeds.alignment?.seed,
    "Sit for two minutes, name one true thing about this decan, and set it down without elaboration.",
  );
  assertEquals(
    synthesis.centralTension,
    "The sitting was available. The account was not opened. The gap between what happened and what has been named continues to hold whatever was not yet ready to be weighed.",
  );
  assertEquals(synthesis.selectedTensionTemplateId, "weighing-skipped-solo");
  assertEquals(
    synthesis.selectedFlowTensionTemplateId,
    "weighing-skipped-solo",
  );
  assert(
    synthesis.selectedSeeds.reflection?.doNotSay.includes(
      "you failed to sit",
    ),
  );
  assert(
    synthesis.selectedSeeds.orientation?.doNotSay.includes(
      "you didn't finish",
    ),
  );
  assert(
    synthesis.selectedSeeds.alignment?.doNotSay.includes(
      "you failed to sit",
    ),
  );
});

Deno.test("partial and skipped language avoids motive, shame, and failure framing", () => {
  const partial = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed_partly")],
  });
  const partialText = [
    partial.centralTension,
    partial.selectedSeeds.reflection?.seed,
    partial.flowSignals[0].status,
  ].join(" ").toLowerCase();
  assertEquals(
    /\b(avoided|refused|because|didn't care|failure|shame)\b/.test(partialText),
    false,
  );

  const skipped = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("skipped")],
  });
  const skippedText = [
    skipped.centralTension,
    skipped.selectedSeeds.orientation?.seed,
    skipped.selectedSeeds.alignment?.seed,
  ].join(" ").toLowerCase();
  assertEquals(/\b(failure|failed|shame|abandoned)\b/.test(skippedText), false);
  assertEquals(skipped.dominantThemeMode, "set_aside");
  assertEquals(skipped.flowSignals[0].inferenceMode, "restorative");
});

Deno.test("reflection, orientation, and alignment seeds are selected separately with constraints and badge metadata", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed")],
  });

  const reflection = synthesis.selectedSeeds.reflection;
  const orientation = synthesis.selectedSeeds.orientation;
  const alignment = synthesis.selectedSeeds.alignment;
  assertExists(reflection);
  assertExists(orientation);
  assertExists(alignment);
  assertNotEquals(reflection.seed, orientation.seed);
  assertNotEquals(orientation.seed, alignment.seed);

  assertEquals(reflection.lensType, "reflection");
  assertEquals(reflection.responseKind, "reflection");
  assertEquals(reflection.preferredSurface, "lower_third_badge");
  assertEquals(reflection.badgeTitle, "Reflection");
  assertEquals(reflection.badgeRole, "end_decan_reflection");
  assertEquals(reflection.constraints.imperativesAllowed, false);
  assertEquals(reflection.constraints.maxSentences, 2);

  assertEquals(orientation.lensType, "orientation");
  assertEquals(orientation.responseKind, "orientation");
  assertEquals(orientation.preferredSurface, "lower_third_badge");
  assertEquals(orientation.badgeTitle, "Orientation");
  assertEquals(orientation.badgeRole, "opening_orientation");
  assertEquals(orientation.constraints.actionRequired, false);
  assertEquals(orientation.constraints.imperativesAllowed, false);
  assertEquals(orientation.constraints.maxSentences, 1);

  assertEquals(alignment.lensType, "alignment");
  assertEquals(alignment.responseKind, "alignment");
  assertEquals(alignment.preferredSurface, "lower_third_badge");
  assertEquals(alignment.badgeTitle, "Alignment");
  assertEquals(alignment.badgeRole, "mid_decan_alignment");
  assertEquals(alignment.constraints.actionRequired, true);
  assertEquals(alignment.constraints.imperativesAllowed, true);
  assertEquals(alignment.constraints.maxSentences, 1);

  assert(reflection.doNotSay.includes("you did the work"));
  assert(alignment.doNotSay.includes("the scale is satisfied"));
});

Deno.test("theme relationship templates load with Eloquent Peasant image only in the held witnessing variant", () => {
  assertExists(
    MAAT_THEME_RELATIONSHIP_TEMPLATES.find((entry) =>
      entry.id === "accountability-embodiment-any"
    ),
  );
  const witnessing = MAAT_THEME_RELATIONSHIP_TEMPLATES.find((entry) =>
    entry.id === "accountability-witnessing-any"
  );
  assertExists(witnessing);
  assertExists(
    MAAT_THEME_RELATIONSHIP_TEMPLATES.find((entry) =>
      entry.id === "accountability-orientation-any"
    ),
  );

  const peasantImage =
    "The tongue was the plummet and the heart was the weight";
  assertEquals(witnessing.tension.includes(peasantImage), false);
  assertEquals(
    MAAT_THEME_RELATIONSHIP_TEMPLATES.filter((entry) =>
      entry.tension.includes(peasantImage)
    ).length,
    1,
  );
  assertEquals(
    MAAT_THEME_RELATIONSHIP_TEMPLATES.find((entry) =>
      entry.tension.includes(peasantImage)
    )?.id,
    "accountability-held-witnessing-held",
  );
});

Deno.test("theme relationship templates require a true second source before solo fallback", () => {
  const solo = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [
      badgeForOn("observed", "2026-05-18"),
      badgeForOn("observed", "2026-05-19"),
    ],
  });
  assertEquals(solo.selectedThemeRelationshipTemplateId, null);
  assertEquals(solo.selectedFlowTensionTemplateId, "weighing-observed-solo");

  const probeKey = "body-carrying-probe";
  const weighingSpectrum = MAAT_FLOW_RESPONSE_SPECTRUM[THE_WEIGHING_FLOW_KEY];
  MAAT_FLOW_RESPONSE_SPECTRUM[probeKey] = {
    flowKey: probeKey,
    flowTitle: "Body Carrying Probe",
    interpretiveSpine: "Temporary fixture for source-guard coverage.",
    primaryTheme: "embodiment",
    supportingConcepts: [],
    tiers: {
      observed: {
        meaning: "Probe observed.",
        inferenceMode: "affirming",
        evidenceWeight: 1,
        theme: "embodiment",
        themeMode: "held",
        lenses: weighingSpectrum.tiers.observed.lenses,
        doNotSay: [],
      },
      partial: {
        meaning: "Probe partial.",
        inferenceMode: "corrective",
        evidenceWeight: 0.7,
        theme: "embodiment",
        themeMode: "absent",
        lenses: weighingSpectrum.tiers.partial.lenses,
        doNotSay: [],
      },
      skipped_explicit: {
        meaning: "Probe skipped.",
        inferenceMode: "restorative",
        evidenceWeight: 0.4,
        theme: "embodiment",
        themeMode: "set_aside",
        lenses: weighingSpectrum.tiers.skipped_explicit.lenses,
        doNotSay: [],
      },
      unobserved: {
        meaning: "Probe unobserved.",
        inferenceMode: "neutral",
        evidenceWeight: 0.2,
        theme: "embodiment",
        themeMode: "absent",
        lenses: weighingSpectrum.tiers.unobserved.lenses,
        doNotSay: [],
      },
    },
  };

  try {
    const twoSource = synthesizeMaatFlowDecanPattern({
      ...decan,
      completionEvidence: [
        {
          flowKey: probeKey,
          flowTitle: "Body Carrying Probe",
          eventTitle: "Carry the Account",
          status: "observed_partly",
          completedOn: "2026-05-18",
          completedAt: "2026-05-18T17:00:00.000Z",
          clientEventId: "body-carrying-probe-1",
          metadata: { status: "observed_partly", flow_key: probeKey },
        },
        badgeForOn("observed", "2026-05-19"),
      ],
    });

    assertEquals(
      twoSource.selectedThemeRelationshipTemplateId,
      "accountability-embodiment-any",
    );
    assertEquals(
      twoSource.selectedTensionTemplateId,
      "accountability-embodiment-any",
    );
    assertEquals(twoSource.selectedFlowTensionTemplateId, null);
  } finally {
    delete MAAT_FLOW_RESPONSE_SPECTRUM[probeKey];
  }
});

Deno.test("one explicit completion is low confidence and does not select strong tension", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed")],
  });

  assertEquals(synthesis.confidence, "low");
  assertEquals(synthesis.fallbackReason, "only_one_explicit_flow_signal");
  assertEquals(synthesis.centralTension, null);
  assertEquals(synthesis.selectedThemeRelationshipTemplateId, null);
  assertEquals(synthesis.selectedFlowTensionTemplateId, null);
  assertEquals(synthesis.selectedTensionTemplateId, null);
  assertExists(synthesis.selectedSeeds.reflection);
  assertEquals(synthesis.interpretiveEmphasis, {
    dominantTier: "observed",
    lastExplicitTier: "observed",
    reflectionTier: "observed",
    orientationTier: "observed",
    alignmentTier: "observed",
    reason: "dominant_and_recent_explicit_tier_aligned",
  });
});

Deno.test("low-confidence synthesis returns fallback reason instead of overclaiming", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [],
    scheduledEvents: [],
  });

  assertEquals(synthesis.confidence, "low");
  assertEquals(synthesis.fallbackReason, "no_current_decan_flow_signal");
  assertEquals(synthesis.centralTension, null);
  assertEquals(synthesis.selectedTensionTemplateId, null);
  assertEquals(synthesis.dominantTier, null);
});

Deno.test("prior-decan completion evidence is ignored in current-decan prototype", () => {
  const synthesis = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [badgeFor("observed")],
    scheduledEvents: [{
      flowKey: THE_WEIGHING_FLOW_KEY,
      eventTitle: "Open the Material Ledger",
      scheduledOn: "2026-05-18",
      clientEventId: "current-uncompleted",
    }],
  });
  assertEquals(synthesis.dominantTier, "observed");

  const priorOnly = synthesizeMaatFlowDecanPattern({
    ...decan,
    completionEvidence: [completion("observed", "2026-05-10")],
    scheduledEvents: [{
      flowKey: THE_WEIGHING_FLOW_KEY,
      eventTitle: "Open the Material Ledger",
      scheduledOn: "2026-05-18",
      clientEventId: "current-uncompleted",
    }],
  });
  assertEquals(priorOnly.flowSignals.length, 1);
  assertEquals(priorOnly.flowSignals[0].source, "scheduled_uncompleted");
  assertEquals(priorOnly.dominantTier, "unobserved");
});
