export type FlowKey = string;

export const THE_WEIGHING_FLOW_KEY = "the-weighing" as const;
export const THE_WEIGHING_FLOW_TITLE = "The Weighing" as const;
export const THE_WEIGHING_THEME_SPINE =
  "The person becomes trustworthy by giving a plain account before adding meaning." as const;
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
  badgeBody?: string;
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

export type MaatFlowInterpretiveEmphasis = {
  dominantTier: CanonicalCompletionTier | null;
  lastExplicitTier: CanonicalCompletionTier | null;
  reflectionTier: CanonicalCompletionTier | null;
  orientationTier: CanonicalCompletionTier | null;
  alignmentTier: CanonicalCompletionTier | null;
  reason: string;
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
  interpretiveEmphasis: MaatFlowInterpretiveEmphasis;
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
          "The sitting was completed. The account was made plain. This is what observed means - not success, not approval, not a performance reviewed. The account was given without arrangement beforehand.",
        inferenceMode: "affirming",
        evidenceWeight: 1,
        theme: "accountability",
        themeMode: "held",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "held",
        lenses: {
          reflection: {
            seed: "The account was made plain.",
            badgeBody: "The account was made plain.",
            register: "grounded",
            weight: "light",
            openingMove: "name what was met plainly",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule: "The subject is the pattern, not the user as agent.",
              tenseRule: "Use past tense.",
              actionRequired: false,
            },
          },
          orientation: {
            seed: "Keep the record plain before drawing meaning from it.",
            badgeBody: "Keep the record plain before drawing meaning from it.",
            register: "direct",
            weight: "light",
            openingMove: "offer posture counsel without concrete task action",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule:
                "Address posture or direction; concrete actions such as write, sit, or name belong to alignment only.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed:
              "Write one sentence about what happened, without explaining it.",
            badgeBody:
              "Write one sentence about what happened, without explaining it.",
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
          "Ma'at is pleased",
          "well done",
          "you passed",
          "any language grading the practice as a performance",
        ],
      },
      partial: {
        meaning:
          "The sitting was entered but not completed. The account was opened but not all of it was named. The approach was made - that is not nothing. But what remains unfinished still waits in the same condition it was left.",
        inferenceMode: "corrective",
        evidenceWeight: 0.7,
        theme: "accountability",
        themeMode: "interrupted",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "interrupted",
        lenses: {
          reflection: {
            seed:
              "The account was opened, but not completed. What remains unnamed should stay simple enough to return to.",
            badgeBody: "The account was opened, but not completed.",
            register: "grounded",
            weight: "medium",
            openingMove: "name the interruption without explaining it",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule: "The subject is the pattern, not motive.",
              tenseRule: "Use past tense.",
              actionRequired: false,
            },
          },
          orientation: {
            seed: "Let the next account be smaller and complete.",
            badgeBody: "Let the next account be smaller and complete.",
            register: "grounded",
            weight: "medium",
            openingMove: "offer posture counsel without concrete task action",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule:
                "Address posture or direction; concrete actions such as write, sit, or name belong to alignment only.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed:
              "Name the part that remains unfinished, without explaining it.",
            badgeBody: "Name the part that remains unfinished.",
            register: "direct",
            weight: "medium",
            openingMove: "offer one behavioral action",
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
          "you weren't honest",
          "something blocked you",
          "you weren't ready",
          "any language diagnosing why the sitting was not completed",
        ],
      },
      skipped_explicit: {
        meaning:
          "The sitting was available and was set aside. The account was not opened. What was set aside still needs a plain account - not because the sitting must be recovered, but because what is not named does not resolve on its own.",
        inferenceMode: "restorative",
        evidenceWeight: 0.4,
        theme: "accountability",
        themeMode: "set_aside",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "set_aside",
        lenses: {
          reflection: {
            seed:
              "The sitting was set aside. What was set aside still needs a plain account.",
            badgeBody: "The sitting was set aside.",
            register: "grounded",
            weight: "medium",
            openingMove: "name the absence plainly, without verdict",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule: "The subject is the pattern.",
              tenseRule: "Use past tense.",
              actionRequired: false,
            },
          },
          orientation: {
            seed:
              "The account can reopen with something small - one true thing, named plainly, is enough to begin.",
            badgeBody: "The account can still be opened.",
            register: "spacious",
            weight: "medium",
            openingMove: "offer posture counsel without concrete task action",
            sentenceRhythm: "varied",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule:
                "Address posture or direction; concrete actions such as write, sit, or name belong to alignment only.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed: "Sit for two minutes and name one true thing plainly.",
            badgeBody: "Sit for two minutes and name one true thing plainly.",
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
          "you missed",
          "you failed",
          "it's okay",
          "life happens",
          "try again next time",
          "Ma'at is patient",
          "you avoided the truth",
          "any language that shames the skip or dismisses it",
        ],
      },
      unobserved: {
        meaning:
          "No record was made here. The sitting did not enter the day. Absence is not a verdict - the record simply has nothing from this point to work with.",
        inferenceMode: "neutral",
        evidenceWeight: 0.2,
        theme: "accountability",
        themeMode: "absent",
        secondaryTheme: "witnessing",
        secondaryThemeMode: "absent",
        lenses: {
          reflection: {
            seed: "No record was made here. Absence is not a verdict.",
            badgeBody: "No record was made here. Absence is not a verdict.",
            register: "still",
            weight: "light",
            openingMove: "name the absence neutrally",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 2,
              imperativesAllowed: false,
              subjectRule: "The subject is the record, not the user.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          orientation: {
            seed: "A light record is still a record.",
            badgeBody: "A light record is still a record.",
            register: "spacious",
            weight: "light",
            openingMove: "offer posture counsel without concrete task action",
            sentenceRhythm: "short",
            constraints: {
              maxSentences: 1,
              imperativesAllowed: false,
              subjectRule:
                "Address posture or direction; concrete actions such as write, sit, or name belong to alignment only.",
              tenseRule: "Use present tense.",
              actionRequired: false,
            },
          },
          alignment: {
            seed: "Write one plain line from the day.",
            badgeBody: "Write one plain line from the day.",
            register: "direct",
            weight: "light",
            openingMove: "offer the minimum viable action",
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
          "it's not too late",
          "any language implying urgency, lateness, or judgment",
        ],
      },
    },
  },
};

export const MAAT_THEME_RELATIONSHIP_TEMPLATES: ThemeRelationshipTemplate[] = [
  {
    id: "accountability-witnessing-any",
    primaryTheme: "accountability",
    secondaryTheme: "witnessing",
    tension: "An account shaped to sound acceptable is not a plain account.",
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
      "The account was made plain and the view of it was clear. The record and the witness of it were the same thing.",
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
      "The sitting was completed, but the view of it may have been adjusted before the account was named. Whether the full account was given is what remains.",
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
      "The account was not completed, and the clear view of it was not completed either. What the period contained is partly named and partly still unexamined.",
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
      "The sitting was set aside, and so was the plain view of what the period contained. What has not been looked at plainly cannot be named plainly.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-embodiment-any",
    primaryTheme: "accountability",
    secondaryTheme: "embodiment",
    tension: "What is known but not carried in conduct remains unweighed.",
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
      "The account was made plain, but the conduct it describes has not yet been carried through. Knowing what is true and acting on it are two different things.",
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
      "Neither the account nor the practice was completed. The gap between what is known and what is being done has had room to widen.",
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
      "Both the account and the practice were set aside. What is neither examined nor acted on does not stay still.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-held-embodiment-held",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "embodiment",
    secondaryMode: "held",
    tension:
      "The account was made plain and the practice was carried. The record and the conduct are aligned.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-orientation-any",
    primaryTheme: "accountability",
    secondaryTheme: "orientation",
    tension:
      "A direction set from an incomplete account tends to need correction later.",
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
      "The account was plain and the direction is present. The next movement has something true beneath it.",
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
      "The record is plain, but the direction has not yet resolved. The account is ready — the bearing still needs to be set.",
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
      "A direction is present, but the account beneath it is unfinished. The bearing may need revision once the account is complete.",
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
      "Neither the account nor the direction was completed. Direction without a plain account beneath it is harder to trust.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-set-aside-orientation-held",
    primaryTheme: "accountability",
    primaryMode: "set_aside",
    secondaryTheme: "orientation",
    secondaryMode: "held",
    tension:
      "A direction is being followed, but the account that should ground it was set aside. Moving forward without a plain record does not make the record unnecessary.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-release-any",
    primaryTheme: "accountability",
    secondaryTheme: "release",
    tension:
      "What is still being held tends to shape the account before it is named.",
    appliesTo: "all",
    priority: 40,
  },
  {
    id: "accountability-held-release-interrupted",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "release",
    secondaryMode: "interrupted",
    tension:
      "The account was made plain, but something from this period has not yet been set down. The record is honest as far as it goes.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-interrupted-release-set-aside",
    primaryTheme: "accountability",
    primaryMode: "interrupted",
    secondaryTheme: "release",
    secondaryMode: "set_aside",
    tension:
      "The account was not completed, and what might have made it easier to complete was also not released. Each one makes the other harder.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-set-aside-release-set-aside",
    primaryTheme: "accountability",
    primaryMode: "set_aside",
    secondaryTheme: "release",
    secondaryMode: "set_aside",
    tension:
      "Neither the account nor the release was taken up. What is neither named nor set down accumulates without notice.",
    appliesTo: "all",
    priority: 80,
  },
  {
    id: "accountability-held-release-held",
    primaryTheme: "accountability",
    primaryMode: "held",
    secondaryTheme: "release",
    secondaryMode: "held",
    tension:
      "The account was made plain and what needed to be set down was set down. Both happened in the same period.",
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
      "The account was made plain. What was named can now be carried without decoration.",
    appliesTo: ["reflection"],
    priority: 1,
  },
  {
    id: "weighing-partial-solo",
    primaryFlow: THE_WEIGHING_FLOW_KEY,
    primaryTier: "partial",
    tension:
      "The account was opened, but not all of it was named. What remains unfinished does not disappear — it waits in the same condition it was left.",
    appliesTo: ["reflection"],
    priority: 1,
  },
  {
    id: "weighing-skipped-solo",
    primaryFlow: THE_WEIGHING_FLOW_KEY,
    primaryTier: "skipped_explicit",
    tension:
      "The sitting was set aside and the account was not opened. What is not named does not resolve on its own. Return is still available through one plain account of what the period actually contained.",
    appliesTo: ["reflection"],
    priority: 1,
  },
  {
    id: "weighing-unobserved-solo",
    primaryFlow: THE_WEIGHING_FLOW_KEY,
    primaryTier: "unobserved",
    tension:
      "No record was made here. The absence is not a conclusion — it is a part of the period that has not yet been named.",
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

function lastExplicitTier(signals: FlowSignal[]) {
  const last = signals
    .filter((signal) => signal.source === "completion" && signal.reliable)
    .sort((a, b) =>
      signalSortDate(a).localeCompare(signalSortDate(b)) ||
      a.flowKey.localeCompare(b.flowKey) ||
      a.status.localeCompare(b.status)
    )
    .at(-1);
  return last?.canonicalTier ?? null;
}

function interpretiveEmphasisForSignals(
  signals: FlowSignal[],
  dominant: CanonicalCompletionTier | null,
): MaatFlowInterpretiveEmphasis {
  const explicitLast = lastExplicitTier(signals);
  if (!dominant) {
    return {
      dominantTier: null,
      lastExplicitTier: explicitLast,
      reflectionTier: null,
      orientationTier: null,
      alignmentTier: null,
      reason: "no_current_decan_flow_signal",
    };
  }
  if (!explicitLast) {
    return {
      dominantTier: dominant,
      lastExplicitTier: null,
      reflectionTier: dominant,
      orientationTier: dominant,
      alignmentTier: dominant,
      reason: "no_explicit_completion_signal",
    };
  }
  if (explicitLast === dominant) {
    return {
      dominantTier: dominant,
      lastExplicitTier: explicitLast,
      reflectionTier: dominant,
      orientationTier: dominant,
      alignmentTier: dominant,
      reason: "dominant_and_recent_explicit_tier_aligned",
    };
  }
  return {
    dominantTier: dominant,
    lastExplicitTier: explicitLast,
    reflectionTier: explicitLast,
    orientationTier: dominant,
    alignmentTier: explicitLast,
    reason: `dominant_${dominant}_but_recent_${explicitLast}`,
  };
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
  const interpretiveEmphasis = interpretiveEmphasisForSignals(
    flowSignals,
    dominant,
  );
  const reflectionFlow = primaryFlowForTier(
    flowSignals,
    interpretiveEmphasis.reflectionTier,
  );
  const orientationFlow = primaryFlowForTier(
    flowSignals,
    interpretiveEmphasis.orientationTier,
  );
  const alignmentFlow = primaryFlowForTier(
    flowSignals,
    interpretiveEmphasis.alignmentTier,
  );
  const themeSignals = themeSignalsFromFlowSignals(flowSignals);
  const dominantThemeSignal = primaryThemeSignalForTier(flowSignals, dominant);
  const tensionPrimaryThemeSignal = primaryThemeSignalForTier(
    flowSignals,
    interpretiveEmphasis.reflectionTier,
  );
  const confidence = confidenceForSignals(flowSignals);
  const fallbackReason = fallbackReasonForSignals(flowSignals);
  const canSelectTension = confidence !== "low";
  const themeTemplate = canSelectTension
    ? selectThemeRelationshipTemplate({
      primarySignal: tensionPrimaryThemeSignal,
      themeSignals,
    })
    : null;
  const fallbackFlowTemplate = canSelectTension && !themeTemplate
    ? selectTensionTemplate({
      primaryFlow: reflectionFlow,
      primaryTier: interpretiveEmphasis.reflectionTier,
    })
    : null;
  const selectedSeeds = {
    ...(reflectionFlow && interpretiveEmphasis.reflectionTier
      ? {
        reflection: selectedSeed({
          lensType: "reflection",
          flowKey: reflectionFlow,
          tier: interpretiveEmphasis.reflectionTier,
        }),
      }
      : {}),
    ...(orientationFlow && interpretiveEmphasis.orientationTier
      ? {
        orientation: selectedSeed({
          lensType: "orientation",
          flowKey: orientationFlow,
          tier: interpretiveEmphasis.orientationTier,
        }),
      }
      : {}),
    ...(alignmentFlow && interpretiveEmphasis.alignmentTier
      ? {
        alignment: selectedSeed({
          lensType: "alignment",
          flowKey: alignmentFlow,
          tier: interpretiveEmphasis.alignmentTier,
        }),
      }
      : {}),
  };
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
    dominantTheme: dominantThemeSignal?.theme ?? null,
    dominantThemeMode: dominantThemeSignal?.mode ?? null,
    lastTier: lastTier(flowSignals),
    centralTension: themeTemplate?.tension ?? fallbackFlowTemplate?.tension ??
      null,
    selectedThemeRelationshipTemplateId: themeTemplate?.id ?? null,
    selectedTensionTemplateId: themeTemplate?.id ?? fallbackFlowTemplate?.id ??
      null,
    selectedFlowTensionTemplateId: fallbackFlowTemplate?.id ?? null,
    selectedSeeds,
    interpretiveEmphasis,
    confidence,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
