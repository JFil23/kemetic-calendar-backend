export type FlowKey = string;

export const THE_WEIGHING_FLOW_KEY = "the-weighing" as const;
export const THE_WEIGHING_FLOW_TITLE = "The Weighing" as const;
export const THE_WEIGHING_THEME_SPINE =
  "The gap between the account and the weight." as const;
export const THE_WEIGHING_SUPPORTING_CONCEPTS = [
  "record",
  "weight",
  "account",
  "truth",
  "measure",
  "consequence",
  "self-narration",
  "witnessing",
] as const;

export type CanonicalCompletionTier =
  | "observed"
  | "partial"
  | "skipped_explicit"
  | "unobserved";

export type InferenceMode =
  | "neutral"
  | "affirming"
  | "corrective"
  | "restorative";

export type LensType = "reflection" | "orientation" | "alignment";

export type ThemeAxis =
  | "accountability"
  | "embodiment"
  | "orientation"
  | "release"
  | "continuity"
  | "nourishment"
  | "ancestral_debt"
  | "transmission"
  | "threshold"
  | "witnessing";

export type ThemeMode =
  | "held"
  | "interrupted"
  | "set_aside"
  | "absent";

export type ThemeSignal = {
  role: "primary" | "secondary";
  theme: ThemeAxis;
  mode: ThemeMode;
  sourceFlow: FlowKey;
  sourceTier: CanonicalCompletionTier;
  evidenceWeight: number;
};

export type MaatResponseSurface =
  | "lower_third_badge"
  | "detail_view"
  | "push_excerpt";

export type MaatResponseKind =
  | "reflection"
  | "orientation"
  | "alignment";

export type MaatResponseBadgeRole =
  | "end_decan_reflection"
  | "opening_orientation"
  | "mid_decan_alignment";

export type MaatResponseSurfaceMetadata = {
  responseKind: MaatResponseKind;
  preferredSurface: MaatResponseSurface;
  badgeTitle: "Reflection" | "Orientation" | "Alignment";
  badgeRole: MaatResponseBadgeRole;
};

export type LensSeed = {
  seed: string;
  register: "grounded" | "spacious" | "direct" | "still";
  weight: "light" | "medium" | "serious";
  openingMove: string;
  sentenceRhythm: "short" | "varied" | "extended";
  constraints: {
    maxSentences: number;
    imperativesAllowed: boolean;
    subjectRule: string;
    tenseRule: string;
    actionRequired: boolean;
  };
};

export type TierSpectrumEntry = {
  meaning: string;
  inferenceMode: InferenceMode;
  evidenceWeight: number;
  theme: ThemeAxis;
  themeMode: ThemeMode;
  secondaryTheme?: ThemeAxis;
  secondaryThemeMode?: ThemeMode;
  lenses: {
    reflection: LensSeed;
    orientation: LensSeed;
    alignment: LensSeed;
  };
  doNotSay: string[];
};

export type TensionTemplate = {
  id: string;
  primaryFlow: FlowKey;
  secondaryFlow?: FlowKey;
  primaryTier: CanonicalCompletionTier;
  secondaryTier?: CanonicalCompletionTier;
  tension: string;
  appliesTo: LensType[] | "all";
  priority: number;
};

export type ThemeRelationshipTemplate = {
  id: string;
  primaryTheme: ThemeAxis;
  primaryMode?: ThemeMode;
  secondaryTheme?: ThemeAxis;
  secondaryMode?: ThemeMode;
  tension: string;
  appliesTo: LensType[] | "all";
  priority: number;
};

export type MaatFlowCompletionEvidenceInput = {
  flowKey?: string | null;
  flow_key?: string | null;
  flowTitle?: string | null;
  flow_title?: string | null;
  eventTitle?: string | null;
  event_title?: string | null;
  status?: string | null;
  rawStatus?: string | null;
  raw_status?: string | null;
  canonicalTier?: CanonicalCompletionTier | null;
  canonical_tier?: CanonicalCompletionTier | null;
  completedOn?: string | null;
  completed_on?: string | null;
  occurred_on?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  clientEventId?: string | null;
  client_event_id?: string | null;
  event_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type MaatFlowScheduledEventInput = {
  flowKey?: string | null;
  flow_key?: string | null;
  flowTitle?: string | null;
  flow_title?: string | null;
  eventTitle?: string | null;
  event_title?: string | null;
  scheduledOn?: string | null;
  scheduled_on?: string | null;
  startsAt?: string | null;
  starts_at?: string | null;
  clientEventId?: string | null;
  client_event_id?: string | null;
  event_id?: string | null;
  behaviorPayload?: Record<string, unknown> | null;
  behavior_payload?: Record<string, unknown> | null;
};

export type FlowSignal = {
  flowKey: FlowKey;
  flowTitle: string | null;
  eventTitle: string | null;
  canonicalTier: CanonicalCompletionTier;
  theme: ThemeAxis;
  themeMode: ThemeMode;
  secondaryTheme?: ThemeAxis;
  secondaryThemeMode?: ThemeMode;
  inferenceMode: InferenceMode;
  evidenceWeight: number;
  status: string;
  completedOn: string | null;
  completedAt: string | null;
  clientEventId: string | null;
  source: "completion" | "scheduled_uncompleted";
  reliable: boolean;
};

export type SelectedLensSeed = LensSeed & {
  lensType: LensType;
  responseKind: MaatResponseKind;
  preferredSurface: MaatResponseSurface;
  badgeTitle: "Reflection" | "Orientation" | "Alignment";
  badgeRole: MaatResponseBadgeRole;
  flowKey: FlowKey;
  flowTitle: string;
  tier: CanonicalCompletionTier;
  meaning: string;
  inferenceMode: InferenceMode;
  evidenceWeight: number;
  doNotSay: string[];
};

export type MaatFlowDecanPatternSynthesis = {
  decanId: string;
  flowSignals: FlowSignal[];
  themeSignals: ThemeSignal[];
  supportFlows: FlowKey[];
  frictionFlows: FlowKey[];
  dominantTier: CanonicalCompletionTier | null;
  dominantTheme: ThemeAxis | null;
  dominantThemeMode: ThemeMode | null;
  lastTier: CanonicalCompletionTier | null;
  centralTension: string | null;
  selectedThemeRelationshipTemplateId: string | null;
  selectedTensionTemplateId: string | null;
  selectedFlowTensionTemplateId: string | null;
  selectedSeeds: {
    reflection?: SelectedLensSeed;
    orientation?: SelectedLensSeed;
    alignment?: SelectedLensSeed;
  };
  confidence: "low" | "medium" | "high";
  fallbackReason?: string;
};

export const MAAT_FLOW_RESPONSE_SPECTRUM: Record<
  FlowKey,
  {
    flowKey: FlowKey;
    flowTitle: string;
    interpretiveSpine: string;
    primaryTheme: ThemeAxis;
    secondaryTheme?: ThemeAxis;
    supportingConcepts: readonly string[];
    tiers: Record<CanonicalCompletionTier, TierSpectrumEntry>;
  }
> = {
  [THE_WEIGHING_FLOW_KEY]: {
    flowKey: THE_WEIGHING_FLOW_KEY,
    flowTitle: THE_WEIGHING_FLOW_TITLE,
    interpretiveSpine: THE_WEIGHING_THEME_SPINE,
    primaryTheme: "accountability",
    secondaryTheme: "witnessing",
    supportingConcepts: THE_WEIGHING_SUPPORTING_CONCEPTS,
    tiers: {
      observed: {
        meaning:
          "The sitting was completed. The account was brought to the scale and not adjusted before placement. The gap between what happened and what was recorded had a chance to close.",
        inferenceMode: "affirming",
        evidenceWeight: 1,
        theme: "accountability",
        themeMode: "held",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "held",
        lenses: {
          reflection: {
            seed:
              "The record was brought to the scale without alteration. What the decan carried has been acknowledged and set down.",
            register: "grounded",
            weight: "light",
            openingMove: "name what was met",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule:
                "The subject is the pattern or record, not the user as agent; use 'the record was brought' rather than 'you brought the record'.",
              tenseRule: "Use past tense.",
              actionRequired: false,
            },
          },
          orientation: {
            seed: "The balance holds when the measure continues.",
            register: "still",
            weight: "light",
            openingMove: "name the posture that sustains what is present",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule: "Address posture, not a task.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed:
              "Write one sentence about this decan that you would not need to revise tomorrow.",
            register: "direct",
            weight: "light",
            openingMove: "offer the smallest honest act",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: true,
              subjectRule: "Imperative address is permitted here only.",
              tenseRule: "Use present tense.",
              actionRequired: true,
            },
          },
        },
        doNotSay: [
          "you did the work",
          "you showed up",
          "great job",
          "the scale is satisfied",
          "Ma'at is pleased",
          "well done",
          "anything that grades the practice as a performance",
        ],
      },
      partial: {
        meaning:
          "The sitting was entered but not completed. The account was opened but the weight was not fully placed. The gap did not close, though the approach was made.",
        inferenceMode: "corrective",
        evidenceWeight: 0.7,
        theme: "accountability",
        themeMode: "interrupted",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "interrupted",
        lenses: {
          reflection: {
            seed:
              "The sitting was entered but not completed. The scale was approached; the full account was not placed.",
            register: "grounded",
            weight: "medium",
            openingMove: "name the interruption without explaining it",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule:
                "The subject is the pattern or record, not the user; use 'the sitting was entered' rather than 'you started but stopped'.",
              tenseRule: "Use past tense.",
              actionRequired: false,
            },
          },
          orientation: {
            seed:
              "The incomplete measure is still a measure - what remains can be placed without starting again.",
            register: "grounded",
            weight: "medium",
            openingMove: "name what is still available without demanding it",
            sentenceRhythm: "varied",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule: "Address what is possible, not what was failed.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed:
              "Return to the sitting and place the one thing that was not yet named.",
            register: "direct",
            weight: "medium",
            openingMove: "offer return without ceremony",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: true,
              subjectRule: "Imperative address is permitted here only.",
              tenseRule: "Use present tense.",
              actionRequired: true,
            },
          },
        },
        doNotSay: [
          "you didn't finish",
          "try again",
          "you avoided the truth",
          "you were not honest",
          "something blocked you",
          "you weren't ready",
          "anything diagnosing why the sitting was not completed",
        ],
      },
      skipped_explicit: {
        meaning:
          "The sitting was available and was set aside. The scale was not approached. The account was not opened. The decan moved without the measure being taken.",
        inferenceMode: "restorative",
        evidenceWeight: 0.4,
        theme: "accountability",
        themeMode: "set_aside",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "set_aside",
        lenses: {
          reflection: {
            seed:
              "The sitting was available and set aside. The decan moved without the account being opened.",
            register: "grounded",
            weight: "medium",
            openingMove: "name the absence plainly",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule:
                "The subject is the pattern; use 'the sitting was set aside' rather than 'you chose not to sit'.",
              tenseRule: "Use past tense.",
              actionRequired: false,
            },
          },
          orientation: {
            seed:
              "The scale is not closed by a missed sitting - the account can be approached from where the decan actually stands.",
            register: "spacious",
            weight: "medium",
            openingMove: "restore the horizon without rewarding avoidance",
            sentenceRhythm: "varied",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule: "Address what remains possible.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed:
              "Sit for two minutes, name one true thing about this decan, and set it down without elaboration.",
            register: "direct",
            weight: "medium",
            openingMove: "offer the lowest threshold of re-entry",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: true,
              subjectRule: "Imperative address is permitted here only.",
              tenseRule: "Use present tense.",
              actionRequired: true,
            },
          },
        },
        doNotSay: [
          "you missed the practice",
          "you failed to sit",
          "it's okay",
          "you'll get it next time",
          "life happens",
          "the scale forgives",
          "Ma'at is patient",
          "anything that either shames the skip or dismisses it",
        ],
      },
      unobserved: {
        meaning:
          "No completion record exists for this event. The sitting did not enter the record. This is absence of signal, not proof of avoidance or rest.",
        inferenceMode: "neutral",
        evidenceWeight: 0.2,
        theme: "accountability",
        themeMode: "absent",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "absent",
        lenses: {
          reflection: {
            seed:
              "No record exists for this sitting. The scale has nothing to weigh from this point in the decan.",
            register: "still",
            weight: "light",
            openingMove: "name the absence neutrally",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule: "The subject is the record, not the user.",
              tenseRule: "Use present tense for the current absence.",
              actionRequired: false,
            },
          },
          orientation: {
            seed:
              "A lighter point of contact is still contact - the account does not require a full sitting to begin.",
            register: "spacious",
            weight: "light",
            openingMove: "offer a lower threshold without pressing",
            sentenceRhythm: "varied",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule: "Address what is available.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed:
              "Open the sitting, name one thing the decan has contained, and close it.",
            register: "direct",
            weight: "light",
            openingMove: "offer the minimum viable sitting",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: true,
              subjectRule: "Imperative address is permitted here only.",
              tenseRule: "Use present tense.",
              actionRequired: true,
            },
          },
        },
        doNotSay: [
          "you forgot",
          "you missed",
          "you should have",
          "don't worry",
          "it's not too late (implies lateness)",
          "anything implying judgment or urgency",
        ],
      },
    },
  },
};

export const MAAT_THEME_RELATIONSHIP_TEMPLATES: ThemeRelationshipTemplate[] = [
  {
    id: "accountability-embodiment-any",
    primaryTheme: "accountability",
    secondaryTheme: "embodiment",
    tension:
      "The account is being approached in the mind before it has been carried in the body. What is known and what is lived have not yet met at the same weight.",
    appliesTo: "all",
    priority: 40,
  },
  {
    id: "accountability-held-embodiment-interrupted",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "embodiment",
    secondaryMode: "interrupted",
    tension:
      "The account was placed honestly, but the body has not yet carried what the record revealed. Knowing and doing are not the same measure.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-interrupted-embodiment-absent",
    primaryTheme: "accountability",
    primaryMode: "interrupted",
    secondaryTheme: "embodiment",
    secondaryMode: "absent",
    tension:
      "Neither the account nor the body has completed its movement. The decan has produced awareness without either the record or the conduct that should follow it.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-set-aside-embodiment-set-aside",
    primaryTheme: "accountability",
    primaryMode: "set_aside",
    secondaryTheme: "embodiment",
    secondaryMode: "set_aside",
    tension:
      "Both the account and the body have been set aside in the same decan. The gap between what is true and what is being lived has had room to widen without witness.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-witnessing-any",
    primaryTheme: "accountability",
    secondaryTheme: "witnessing",
    tension:
      "The account is present, but what is being placed on the scale may not be the unedited version. The record and the witness of it are not always the same weight.",
    appliesTo: "all",
    priority: 40,
  },
  {
    id: "accountability-held-witnessing-held",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "witnessing",
    secondaryMode: "held",
    tension:
      "The account was brought and placed without prior arrangement. The tongue was the plummet and the heart was the weight - and neither distorted the other.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-held-witnessing-interrupted",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "witnessing",
    secondaryMode: "interrupted",
    tension:
      "The sitting was completed, but what was placed may have been shaped before it reached the scale. The account was given; whether it was the full account is what remains.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-interrupted-witnessing-interrupted",
    primaryTheme: "accountability",
    primaryMode: "interrupted",
    secondaryTheme: "witnessing",
    secondaryMode: "interrupted",
    tension:
      "Neither the account nor the clear view of it was completed. The decan held both a partial record and a partial witness - the scale has less to work with than the period actually contained.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-set-aside-witnessing-set-aside",
    primaryTheme: "accountability",
    primaryMode: "set_aside",
    secondaryTheme: "witnessing",
    secondaryMode: "set_aside",
    tension:
      "The sitting was set aside and the clear view with it. What the decan contained has not been brought to any measure.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-orientation-any",
    primaryTheme: "accountability",
    secondaryTheme: "orientation",
    tension:
      "Direction requires an honest account of where things actually stand. A bearing taken from an adjusted record leads somewhere other than where it claims.",
    appliesTo: "all",
    priority: 40,
  },
  {
    id: "accountability-held-orientation-held",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "orientation",
    secondaryMode: "held",
    tension:
      "The account was placed and the direction is present. The decan has both a true record and a bearing - what follows from here is more likely to land where it aims.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-held-orientation-interrupted",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "orientation",
    secondaryMode: "interrupted",
    tension:
      "The record is honest but the direction has not yet resolved. The account is ready; the bearing needs one more clear look at the horizon.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-interrupted-orientation-held",
    primaryTheme: "accountability",
    primaryMode: "interrupted",
    secondaryTheme: "orientation",
    secondaryMode: "held",
    tension:
      "Direction is present but the account that should ground it is incomplete. The bearing is aimed at a record that has not yet been fully placed.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-set-aside-orientation-set-aside",
    primaryTheme: "accountability",
    primaryMode: "set_aside",
    secondaryTheme: "orientation",
    secondaryMode: "set_aside",
    tension:
      "Neither the account nor the direction was taken up. The decan moved without measure and without bearing - both need to be re-established before the next threshold.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-set-aside-orientation-interrupted",
    primaryTheme: "accountability",
    primaryMode: "set_aside",
    secondaryTheme: "orientation",
    secondaryMode: "interrupted",
    tension:
      "The direction was approached but could not hold without a true account beneath it. Orientation built on an unweighed record tends to correct itself later, and less gently.",
    appliesTo: "all",
    priority: 80,
  },
];

export const MAAT_FLOW_TENSION_TEMPLATES: TensionTemplate[] = [
  {
    id: "weighing-observed-solo",
    primaryFlow: THE_WEIGHING_FLOW_KEY,
    primaryTier: "observed",
    tension:
      "The account was brought to the scale. The question the decan now holds is whether what was placed was the full weight or the arranged version of it.",
    appliesTo: ["reflection"],
    priority: 1,
  },
  {
    id: "weighing-partial-solo",
    primaryFlow: THE_WEIGHING_FLOW_KEY,
    primaryTier: "partial",
    tension:
      "The scale was approached and the account opened, but not all of it reached the scale.",
    appliesTo: ["reflection"],
    priority: 1,
  },
  {
    id: "weighing-skipped-solo",
    primaryFlow: THE_WEIGHING_FLOW_KEY,
    primaryTier: "skipped_explicit",
    tension:
      "The sitting was available. The account was not opened. The gap between what happened and what has been named continues to hold whatever was not yet ready to be weighed.",
    appliesTo: ["reflection"],
    priority: 1,
  },
  {
    id: "weighing-unobserved-solo",
    primaryFlow: THE_WEIGHING_FLOW_KEY,
    primaryTier: "unobserved",
    tension:
      "The scale received no account from this point in the decan. What the period contained is still unweighed.",
    appliesTo: ["reflection"],
    priority: 1,
  },
];

const TIER_ORDER: CanonicalCompletionTier[] = [
  "observed",
  "partial",
  "skipped_explicit",
  "unobserved",
];

function cleanString(value: unknown) {
  return (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
}

function dateOnly(value: string | null | undefined) {
  const clean = cleanString(value);
  if (!clean) return null;
  const match = clean.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function isDateInRange(date: string | null, start: string, end: string) {
  return !!date && date >= start && date <= end;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFlowKey(value: unknown) {
  const clean = cleanString(value).toLowerCase();
  return clean || null;
}

function canonicalCompletionTierFromStatus(
  status: string | null | undefined,
): CanonicalCompletionTier {
  const normalized = cleanString(status).toLowerCase();
  switch (normalized) {
    case "observed":
    case "done":
    case "complete":
    case "completed":
    case "observed_from_inside":
    case "names_spoken":
    case "raised":
    case "decision_pronounced":
    case "transmitted":
    case "stones_placed":
    case "cooled":
    case "spoken":
    case "record_complete":
    case "beer_poured":
    case "golden_one_present":
      return "observed";
    case "partial":
    case "partly":
    case "observed_partly":
    case "partly_observed":
    case "in_progress":
    case "conversation_pending":
      return "partial";
    case "skipped":
    case "skip":
      return "skipped_explicit";
    default:
      return "unobserved";
  }
}

function rawCompletionStatus(input: MaatFlowCompletionEvidenceInput) {
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  return cleanString(
    input.rawStatus ??
      input.raw_status ??
      input.status ??
      metadata.status ??
      metadata.completion_status ??
      "observed",
  ).toLowerCase();
}

function completionTier(input: MaatFlowCompletionEvidenceInput) {
  return input.canonicalTier ?? input.canonical_tier ??
    canonicalCompletionTierFromStatus(rawCompletionStatus(input));
}

function spectrumForFlow(flowKey: string | null) {
  return flowKey ? MAAT_FLOW_RESPONSE_SPECTRUM[flowKey] : undefined;
}

function flowKeyFromCompletion(input: MaatFlowCompletionEvidenceInput) {
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  return normalizeFlowKey(
    input.flowKey ?? input.flow_key ?? metadata.flow_key,
  );
}

function flowTitleFromCompletion(input: MaatFlowCompletionEvidenceInput) {
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  return cleanString(
    input.flowTitle ?? input.flow_title ?? metadata.flow_title,
  ) ||
    null;
}

function eventTitleFromCompletion(input: MaatFlowCompletionEvidenceInput) {
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  return cleanString(
    input.eventTitle ?? input.event_title ?? metadata.event_title,
  ) || null;
}

function clientEventIdFromCompletion(input: MaatFlowCompletionEvidenceInput) {
  return cleanString(input.clientEventId ?? input.client_event_id) ||
    cleanString(input.event_id).replace(/^flow-completion:/, "") ||
    null;
}

function flowKeyFromScheduled(input: MaatFlowScheduledEventInput) {
  const behavior = isRecord(input.behaviorPayload)
    ? input.behaviorPayload
    : isRecord(input.behavior_payload)
    ? input.behavior_payload
    : {};
  return normalizeFlowKey(input.flowKey ?? input.flow_key ?? behavior.flow_key);
}

function flowTitleFromScheduled(input: MaatFlowScheduledEventInput) {
  return cleanString(input.flowTitle ?? input.flow_title) || null;
}

function eventTitleFromScheduled(input: MaatFlowScheduledEventInput) {
  return cleanString(input.eventTitle ?? input.event_title) || null;
}

function clientEventIdFromScheduled(input: MaatFlowScheduledEventInput) {
  return cleanString(input.clientEventId ?? input.client_event_id) ||
    cleanString(input.event_id) ||
    null;
}

function scheduledDate(input: MaatFlowScheduledEventInput) {
  return dateOnly(input.scheduledOn ?? input.scheduled_on) ??
    dateOnly(input.startsAt ?? input.starts_at);
}

function completionDate(input: MaatFlowCompletionEvidenceInput) {
  return dateOnly(input.completedOn ?? input.completed_on ?? input.occurred_on);
}

function signalSortDate(signal: FlowSignal) {
  return signal.completedOn ?? signal.completedAt ?? "";
}

function countByTier(signals: FlowSignal[]) {
  const counts: Record<CanonicalCompletionTier, number> = {
    observed: 0,
    partial: 0,
    skipped_explicit: 0,
    unobserved: 0,
  };
  for (const signal of signals) counts[signal.canonicalTier] += 1;
  return counts;
}

function dominantTier(signals: FlowSignal[]) {
  if (!signals.length) return null;
  const counts = countByTier(signals);
  return [...TIER_ORDER].sort((a, b) =>
    counts[b] - counts[a] ||
    totalWeight(signals, b) - totalWeight(signals, a) ||
    TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)
  )[0];
}

function totalWeight(signals: FlowSignal[], tier: CanonicalCompletionTier) {
  return signals
    .filter((signal) => signal.canonicalTier === tier)
    .reduce((sum, signal) => sum + signal.evidenceWeight, 0);
}

function lastTier(signals: FlowSignal[]) {
  const last = [...signals].sort((a, b) =>
    signalSortDate(a).localeCompare(signalSortDate(b)) ||
    a.flowKey.localeCompare(b.flowKey) ||
    a.status.localeCompare(b.status)
  ).at(-1);
  return last?.canonicalTier ?? null;
}

function primaryFlowForTier(
  signals: FlowSignal[],
  tier: CanonicalCompletionTier | null,
) {
  if (!tier) return null;
  const signal = signals
    .filter((entry) => entry.canonicalTier === tier)
    .sort((a, b) =>
      b.evidenceWeight - a.evidenceWeight ||
      signalSortDate(b).localeCompare(signalSortDate(a)) ||
      a.flowKey.localeCompare(b.flowKey)
    )[0];
  return signal?.flowKey ?? null;
}

function primaryThemeSignalForTier(
  signals: FlowSignal[],
  tier: CanonicalCompletionTier | null,
) {
  if (!tier) return null;
  const signal = signals
    .filter((entry) => entry.canonicalTier === tier)
    .sort((a, b) =>
      b.evidenceWeight - a.evidenceWeight ||
      signalSortDate(b).localeCompare(signalSortDate(a)) ||
      a.flowKey.localeCompare(b.flowKey)
    )[0];
  if (!signal) return null;
  return {
    role: "primary" as const,
    theme: signal.theme,
    mode: signal.themeMode,
    sourceFlow: signal.flowKey,
    sourceTier: signal.canonicalTier,
    evidenceWeight: signal.evidenceWeight,
  };
}

function themeSignalsFromFlowSignals(signals: FlowSignal[]): ThemeSignal[] {
  return signals.flatMap((signal) => {
    const primary: ThemeSignal = {
      role: "primary",
      theme: signal.theme,
      mode: signal.themeMode,
      sourceFlow: signal.flowKey,
      sourceTier: signal.canonicalTier,
      evidenceWeight: signal.evidenceWeight,
    };
    if (!signal.secondaryTheme || !signal.secondaryThemeMode) {
      return [primary];
    }
    return [
      primary,
      {
        role: "secondary" as const,
        theme: signal.secondaryTheme,
        mode: signal.secondaryThemeMode,
        sourceFlow: signal.flowKey,
        sourceTier: signal.canonicalTier,
        evidenceWeight: signal.evidenceWeight,
      },
    ];
  });
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function templateMatchesMode(
  templateMode: ThemeMode | undefined,
  signalMode: ThemeMode,
) {
  return templateMode === undefined || templateMode === signalMode;
}

function selectThemeRelationshipTemplate(params: {
  primarySignal: ThemeSignal | null;
  themeSignals: ThemeSignal[];
}) {
  if (!params.primarySignal) return null;
  const primarySignal = params.primarySignal;
  const secondarySignals = params.themeSignals
    .filter((signal) => signal.sourceFlow !== primarySignal.sourceFlow)
    .sort((a, b) =>
      b.evidenceWeight - a.evidenceWeight ||
      a.theme.localeCompare(b.theme) ||
      a.mode.localeCompare(b.mode)
    );
  const prioritySort = (
    a: ThemeRelationshipTemplate,
    b: ThemeRelationshipTemplate,
  ) => b.priority - a.priority || a.id.localeCompare(b.id);
  const multiTheme = MAAT_THEME_RELATIONSHIP_TEMPLATES
    .filter((template) => {
      if (!template.secondaryTheme) return false;
      if (template.primaryTheme !== primarySignal.theme) return false;
      if (!templateMatchesMode(template.primaryMode, primarySignal.mode)) {
        return false;
      }
      return secondarySignals.some((secondarySignal) =>
        template.secondaryTheme === secondarySignal.theme &&
        templateMatchesMode(template.secondaryMode, secondarySignal.mode)
      );
    })
    .sort(prioritySort)[0] ?? null;
  if (multiTheme) return multiTheme;
  return MAAT_THEME_RELATIONSHIP_TEMPLATES
    .filter((template) => {
      if (template.secondaryTheme) return false;
      if (template.primaryTheme !== primarySignal.theme) return false;
      if (
        !templateMatchesMode(
          template.primaryMode,
          primarySignal.mode,
        )
      ) {
        return false;
      }
      return true;
    })
    .sort(prioritySort)[0] ?? null;
}

function selectTensionTemplate(params: {
  primaryFlow: FlowKey | null;
  primaryTier: CanonicalCompletionTier | null;
}) {
  if (!params.primaryFlow || !params.primaryTier) return null;
  return MAAT_FLOW_TENSION_TEMPLATES
    .filter((template) =>
      template.primaryFlow === params.primaryFlow &&
      template.primaryTier === params.primaryTier &&
      !template.secondaryFlow &&
      !template.secondaryTier
    )
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] ??
    null;
}

function responseSurfaceMetadata(
  lensType: LensType,
): MaatResponseSurfaceMetadata {
  switch (lensType) {
    case "reflection":
      return {
        responseKind: "reflection",
        preferredSurface: "lower_third_badge",
        badgeTitle: "Reflection",
        badgeRole: "end_decan_reflection",
      };
    case "orientation":
      return {
        responseKind: "orientation",
        preferredSurface: "lower_third_badge",
        badgeTitle: "Orientation",
        badgeRole: "opening_orientation",
      };
    case "alignment":
      return {
        responseKind: "alignment",
        preferredSurface: "lower_third_badge",
        badgeTitle: "Alignment",
        badgeRole: "mid_decan_alignment",
      };
  }
}

function selectedSeed(params: {
  lensType: LensType;
  flowKey: FlowKey;
  tier: CanonicalCompletionTier;
}): SelectedLensSeed | undefined {
  const spectrum = MAAT_FLOW_RESPONSE_SPECTRUM[params.flowKey];
  const entry = spectrum?.tiers[params.tier];
  const seed = entry?.lenses[params.lensType];
  if (!spectrum || !entry || !seed) return undefined;
  const surface = responseSurfaceMetadata(params.lensType);
  return {
    ...seed,
    lensType: params.lensType,
    ...surface,
    flowKey: params.flowKey,
    flowTitle: spectrum.flowTitle,
    tier: params.tier,
    meaning: entry.meaning,
    inferenceMode: entry.inferenceMode,
    evidenceWeight: entry.evidenceWeight,
    doNotSay: [...entry.doNotSay],
  };
}

function confidenceForSignals(signals: FlowSignal[]) {
  const reliableCompletions =
    signals.filter((signal) =>
      signal.source === "completion" && signal.reliable
    ).length;
  if (reliableCompletions >= 2) return "medium";
  return "low";
}

function fallbackReasonForSignals(signals: FlowSignal[]) {
  if (!signals.length) return "no_current_decan_flow_signal";
  const reliableCompletions =
    signals.filter((signal) =>
      signal.source === "completion" && signal.reliable
    ).length;
  if (reliableCompletions === 1) {
    return "only_one_explicit_flow_signal";
  }
  if (reliableCompletions === 0) {
    return "only_unobserved_scheduled_flow_signal";
  }
  return undefined;
}

export function synthesizeMaatFlowDecanPattern(params: {
  decanId: string;
  decanStart: string;
  decanEnd: string;
  completionEvidence?: MaatFlowCompletionEvidenceInput[];
  scheduledEvents?: MaatFlowScheduledEventInput[];
}): MaatFlowDecanPatternSynthesis {
  const completionSignals: FlowSignal[] = [];
  const completedClientEventIds = new Set<string>();

  for (const completion of params.completionEvidence ?? []) {
    const flowKey = flowKeyFromCompletion(completion);
    const spectrum = spectrumForFlow(flowKey);
    if (!flowKey || !spectrum) continue;
    const completedOn = completionDate(completion);
    if (!isDateInRange(completedOn, params.decanStart, params.decanEnd)) {
      continue;
    }
    const tier = completionTier(completion);
    const entry = spectrum.tiers[tier];
    const clientEventId = clientEventIdFromCompletion(completion);
    if (clientEventId) completedClientEventIds.add(clientEventId);
    completionSignals.push({
      flowKey,
      flowTitle: flowTitleFromCompletion(completion) ?? spectrum.flowTitle,
      eventTitle: eventTitleFromCompletion(completion),
      canonicalTier: tier,
      theme: entry.theme,
      themeMode: entry.themeMode,
      secondaryTheme: entry.secondaryTheme,
      secondaryThemeMode: entry.secondaryThemeMode,
      inferenceMode: entry.inferenceMode,
      evidenceWeight: entry.evidenceWeight,
      status: rawCompletionStatus(completion),
      completedOn,
      completedAt:
        cleanString(completion.completedAt ?? completion.completed_at) ||
        null,
      clientEventId,
      source: "completion",
      reliable: tier !== "unobserved",
    });
  }

  const scheduledSignals: FlowSignal[] = [];
  for (const scheduled of params.scheduledEvents ?? []) {
    const flowKey = flowKeyFromScheduled(scheduled);
    const spectrum = spectrumForFlow(flowKey);
    if (!flowKey || !spectrum) continue;
    const scheduledOn = scheduledDate(scheduled);
    if (!isDateInRange(scheduledOn, params.decanStart, params.decanEnd)) {
      continue;
    }
    const clientEventId = clientEventIdFromScheduled(scheduled);
    if (clientEventId && completedClientEventIds.has(clientEventId)) continue;
    const entry = spectrum.tiers.unobserved;
    scheduledSignals.push({
      flowKey,
      flowTitle: flowTitleFromScheduled(scheduled) ?? spectrum.flowTitle,
      eventTitle: eventTitleFromScheduled(scheduled),
      canonicalTier: "unobserved",
      theme: entry.theme,
      themeMode: entry.themeMode,
      secondaryTheme: entry.secondaryTheme,
      secondaryThemeMode: entry.secondaryThemeMode,
      inferenceMode: entry.inferenceMode,
      evidenceWeight: entry.evidenceWeight,
      status: "unobserved",
      completedOn: scheduledOn,
      completedAt: null,
      clientEventId,
      source: "scheduled_uncompleted",
      reliable: false,
    });
  }

  const flowSignals = [...completionSignals, ...scheduledSignals].sort((a, b) =>
    signalSortDate(a).localeCompare(signalSortDate(b)) ||
    a.flowKey.localeCompare(b.flowKey) ||
    a.status.localeCompare(b.status)
  );
  const dominant = dominantTier(flowSignals);
  const primaryFlow = primaryFlowForTier(flowSignals, dominant);
  const themeSignals = themeSignalsFromFlowSignals(flowSignals);
  const primaryThemeSignal = primaryThemeSignalForTier(flowSignals, dominant);
  const confidence = confidenceForSignals(flowSignals);
  const fallbackReason = fallbackReasonForSignals(flowSignals);
  const canSelectTension = confidence !== "low";
  const themeTemplate = canSelectTension
    ? selectThemeRelationshipTemplate({
      primarySignal: primaryThemeSignal,
      themeSignals,
    })
    : null;
  const fallbackFlowTemplate = canSelectTension && !themeTemplate
    ? selectTensionTemplate({
      primaryFlow,
      primaryTier: dominant,
    })
    : null;
  const selectedSeeds = primaryFlow && dominant
    ? {
      reflection: selectedSeed({
        lensType: "reflection",
        flowKey: primaryFlow,
        tier: dominant,
      }),
      orientation: selectedSeed({
        lensType: "orientation",
        flowKey: primaryFlow,
        tier: dominant,
      }),
      alignment: selectedSeed({
        lensType: "alignment",
        flowKey: primaryFlow,
        tier: dominant,
      }),
    }
    : {};
  return {
    decanId: params.decanId,
    flowSignals,
    themeSignals,
    supportFlows: uniqueSorted(
      flowSignals
        .filter((signal) => signal.canonicalTier === "observed")
        .map((signal) => signal.flowKey),
    ),
    frictionFlows: uniqueSorted(
      flowSignals
        .filter((signal) => signal.canonicalTier !== "observed")
        .map((signal) => signal.flowKey),
    ),
    dominantTier: dominant,
    dominantTheme: primaryThemeSignal?.theme ?? null,
    dominantThemeMode: primaryThemeSignal?.mode ?? null,
    lastTier: lastTier(flowSignals),
    centralTension: themeTemplate?.tension ?? fallbackFlowTemplate?.tension ??
      null,
    selectedThemeRelationshipTemplateId: themeTemplate?.id ?? null,
    selectedTensionTemplateId: themeTemplate?.id ?? fallbackFlowTemplate?.id ??
      null,
    selectedFlowTensionTemplateId: fallbackFlowTemplate?.id ?? null,
    selectedSeeds,
    confidence,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
