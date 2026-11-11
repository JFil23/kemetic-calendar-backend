import type { DecanContext } from "./decan_context.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type { MaatTranslatedProfileContext } from "./profile_context_translator.ts";
import type {
  MaatAxisCode,
  MaatDimensionSnapshot,
} from "../ai_generate_reflection/maat_decision.ts";

export type ReflectionCalendarFrame = {
  version: "reflection_calendar_frame_v1";
  monthName: string;
  monthTransliteration: string;
  monthMeaning: string;
  seasonName: string;
  seasonMeaning: string;
  decanName: string;
  decanShortName: string;
  decanNumber: number | null;
  decanOrdinal: string;
  ceremonialDecanName: string;
  decanTheme: string;
  decanDescription: string;
  dayCards: Array<{
    day: number;
    stage: string;
    theme: string;
    action: string;
    reflectionPrompt: string;
  }>;
  arcSummary: string;
};

export type ReflectionEvidenceDensity = "thin" | "balanced" | "dense";

export type ReflectionDomainSignal = {
  domain:
    | "nutrition"
    | "todo"
    | "flow"
    | "note_record"
    | "reminder"
    | "node_library"
    | "guidance"
    | "calendar_day_card";
  meaningWeight: number;
  occurrenceCount: number;
  threadCount: number;
  reason: string;
};

export type ReflectionDomainBalance = {
  version: "reflection_domain_balance_v1";
  evidenceDensity: ReflectionEvidenceDensity;
  primaryDomain: ReflectionDomainSignal["domain"] | null;
  domainSignals: ReflectionDomainSignal[];
  occurrenceVsMeaningNote: string;
};

export type ReflectionAlignmentMap = {
  version: "reflection_alignment_map_v1";
  calendarFrame: ReflectionCalendarFrame | null;
  alignedSignals: string[];
  underansweredSignals: string[];
  dominantLesson: string;
  nextDecanCharge: string;
  evidenceDensity: ReflectionEvidenceDensity;
  domainBalance: ReflectionDomainBalance;
  profileLensApplied: boolean;
  immediateCaseThread?: {
    caseKey?: string | null;
    offering?: string | null;
    diagnosis?: string | null;
    concreteAction?: string | null;
  } | null;
};

export type ReflectionUserPatternProfile = {
  version: "reflection_user_pattern_profile_v1";
  maturity: {
    level?: string | null;
    label?: string | null;
    confidence?: number | null;
  } | null;
  roleSignals: string[];
  routineStyle: string;
  workStyle: string;
  recordStyle: string;
  careDirection: string;
  capacitySignals: string[];
  preferredRegister: "practical" | "sacred" | "direct" | "witnessing";
  recentOutcomePattern: string;
};

export type ReflectionArcPlan = {
  version: "reflection_arc_plan_v1";
  calendarDemand: string;
  decanArc: string;
  userAlignedBy: string;
  userUnderansweredBy: string;
  caseThreadRole: "primary_gap" | "minor_gap" | "supporting_signal";
  notWholeIdentity: string;
  maatLesson: string;
  closingKind: "question" | "charge";
  closingText: string;
  evidenceAnchorLimit: 1;
  evidenceDensity: ReflectionEvidenceDensity;
  domainBalanceSummary: string;
  profileLensRequired: boolean;
  profileContextPhrases: string[];
  profileContextRefs: MaatTranslatedProfileContext["factRefs"];
  prohibitedFocus: string[];
  exampleRefs: string[];
};

type MonthMeta = {
  transliteration: string;
  meaning: string;
};

const MONTH_META: Record<string, MonthMeta> = {
  thoth: {
    transliteration: "Ḏḥwty",
    meaning: "measure, record keeping, and right orientation",
  },
  paopi: {
    transliteration: "Mnḫt",
    meaning: "strength, continuity, and what can be carried",
  },
  hathor: {
    transliteration: "Ḥwt-Ḥr",
    meaning: "restoration, beauty, embodied order, and safe return",
  },
  kaherka: {
    transliteration: "Kȝ-ḥr-Kȝ",
    meaning: "vital force, offering, and embodied steadiness",
  },
  shefbedet: {
    transliteration: "Šf-bdt",
    meaning: "emergence, provision, and shaped growth",
  },
  rekhwer: {
    transliteration: "Rḫ-wr",
    meaning: "larger knowledge, discernment, and accountable formation",
  },
  rekhnedjes: {
    transliteration: "Rḫ-nḏs",
    meaning: "near knowledge, refinement, and practical understanding",
  },
  renwet: {
    transliteration: "Rnnwt",
    meaning: "nourishment, ripening, and sustained provision",
  },
  hnsw: {
    transliteration: "Ḥnsw",
    meaning: "movement, timing, and work that travels correctly",
  },
  hentihet: {
    transliteration: "Ḥnt-ḥtj",
    meaning: "front placement, readiness, and what must be faced",
  },
  paipi: {
    transliteration: "ỉpt-ḥmt",
    meaning: "threshold, testing, and consequential keeping",
  },
  mesutra: {
    transliteration: "Mswt-Rꜥ",
    meaning: "completion, distribution, and accountable harvest",
  },
};

const SEASON_META = {
  akhet: {
    name: "Akhet",
    meaning: "Inundation: preparation, receiving, and ground made ready.",
  },
  peret: {
    name: "Peret",
    meaning: "Emergence: what was prepared must now take form.",
  },
  shemu: {
    name: "Shemu",
    meaning: "Harvest: what matured must be gathered and accounted for.",
  },
  transition: {
    name: "Transition",
    meaning: "Days upon the Year: threshold, release, and return.",
  },
};

const AXIS_ALIGNMENT: Record<MaatAxisCode, string> = {
  T: "truth was present wherever the record became more honest",
  M: "measure was present wherever intention was made visible",
  H: "life-preserving rhythm was present wherever the body was considered",
  V: "care was present wherever burden and protection were noticed",
  J: "due measure was present wherever proportion was considered",
  S: "provision was present wherever body support was named",
  E: "seasonal flow was present wherever return and timing were visible",
  R: "restraint was present wherever the account asked for less force",
  C: "cohesion was present wherever one promise or role stayed in view",
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sentence(value: string | null | undefined) {
  const text = clean(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function firstSentence(value: string | null | undefined) {
  return sentence(clean(value).split(/(?<=[.!?])\s+/)[0] ?? "");
}

function roundWeight(value: number) {
  return Math.round(value * 10) / 10;
}

function seasonForMonth(month: number | null | undefined) {
  if (!month || month < 1 || month > 13) return SEASON_META.transition;
  if (month <= 4) return SEASON_META.akhet;
  if (month <= 8) return SEASON_META.peret;
  if (month <= 12) return SEASON_META.shemu;
  return SEASON_META.transition;
}

function stageForIndex(index: number) {
  if (index === 0) return "opening";
  if (index >= 1 && index <= 3) return "orientation";
  if (index === 4) return "midpoint weighing";
  if (index >= 5 && index <= 7) return "restoration";
  if (index === 8) return "visible proof";
  return "completion";
}

function ordinalName(value: number | null | undefined) {
  if (value === 1) return "first";
  if (value === 2) return "second";
  if (value === 3) return "third";
  return "";
}

function ceremonialDecanName(params: {
  monthName: string;
  shortName: string;
  decanNumber?: number | null;
  fallbackName: string;
}) {
  const month = clean(params.monthName);
  const short = clean(params.shortName);
  const ordinal = ordinalName(params.decanNumber);
  if (month && short && ordinal) return `${month}'s ${ordinal} decan ${short}`;
  if (month && short) return `${month}'s decan ${short}`;
  return clean(params.fallbackName);
}

function arcSummaryFor(
  decanName: string,
  description: string,
  dayCards: ReflectionCalendarFrame["dayCards"],
) {
  const first = dayCards[0]?.theme;
  const middle = dayCards[Math.min(4, Math.max(dayCards.length - 1, 0))]
    ?.theme;
  const last = dayCards.at(-1)?.theme;
  const frame = [first, middle, last].filter(Boolean).join(" -> ");
  const descriptionLead = firstSentence(description);
  if (frame && descriptionLead) {
    return `${decanName} moves through ${frame}; ${descriptionLead}`;
  }
  if (descriptionLead) return descriptionLead;
  if (frame) return `${decanName} moves through ${frame}.`;
  return `${decanName} asks the user to weigh the decan as a complete movement, not as isolated events.`;
}

export function buildReflectionCalendarFrame(params: {
  decanContext?: DecanContext | null;
  decanName?: string | null;
  decanTheme?: string | null;
}): ReflectionCalendarFrame | null {
  const context = params.decanContext;
  const decanName = clean(
    context?.defaultLabel ?? context?.displayName ?? params.decanName,
  );
  if (!context && !decanName) return null;
  const monthKey = clean(context?.monthKey).toLowerCase();
  const monthMeta = MONTH_META[monthKey] ?? {
    transliteration: clean(context?.monthShort),
    meaning: clean(params.decanTheme) || "the month's living frame",
  };
  const season = seasonForMonth(context?.month);
  const dayCards = (context?.dayCards ?? []).map((card, index) => ({
    day: card.day,
    stage: stageForIndex(index),
    theme: clean(card.theme),
    action: clean(card.action),
    reflectionPrompt: clean(card.reflection),
  }));
  const decanDescription = clean(context?.detailDescription);
  const frameName = decanName || clean(params.decanName) || "This decan";
  const monthName = clean(context?.monthShort) || frameName;
  const decanShortName = clean(context?.shortName ?? context?.displayName) ||
    frameName;
  const decanOrdinal = ordinalName(context?.decan);
  const spokenDecanName = ceremonialDecanName({
    monthName,
    shortName: decanShortName,
    decanNumber: context?.decan,
    fallbackName: frameName,
  });
  return {
    version: "reflection_calendar_frame_v1",
    monthName,
    monthTransliteration: monthMeta.transliteration,
    monthMeaning: monthMeta.meaning,
    seasonName: season.name,
    seasonMeaning: season.meaning,
    decanName: frameName,
    decanShortName,
    decanNumber: context?.decan ?? null,
    decanOrdinal,
    ceremonialDecanName: spokenDecanName,
    decanTheme: clean(params.decanTheme ?? context?.shortName),
    decanDescription,
    dayCards,
    arcSummary: arcSummaryFor(spokenDecanName, decanDescription, dayCards),
  };
}

function nutritionThreadSummary(
  threads?: MaatNormalizedObligationThreads | null,
) {
  const nutrition = threads?.nutrition;
  if (
    nutrition && nutrition.unique_item_count === 1 &&
    nutrition.same_item_repeated &&
    nutrition.pending_count + nutrition.skipped_count >= 3
  ) {
    return "one recurring body-care promise asked for clearer measure";
  }
  if (nutrition && nutrition.unique_item_count >= 3) {
    return "several body-care obligations asked for clearer proportion";
  }
  return "";
}

function openThreadSummary(threads?: MaatNormalizedObligationThreads | null) {
  const nutrition = nutritionThreadSummary(threads);
  if (nutrition) return nutrition;
  const todo = threads?.todo;
  if (todo && todo.unique_item_count >= 3) {
    return "visible work asked for fewer open endings";
  }
  return "";
}

function addDomainSignal(
  signals: ReflectionDomainSignal[],
  signal: ReflectionDomainSignal | null,
) {
  if (!signal || signal.meaningWeight <= 0) return;
  signals.push({
    ...signal,
    meaningWeight: roundWeight(signal.meaningWeight),
  });
}

function nutritionMeaningWeight(
  threads?: MaatNormalizedObligationThreads | null,
) {
  const nutrition = threads?.nutrition;
  if (!nutrition || nutrition.unique_item_count <= 0) return null;
  const openCount = nutrition.pending_count + nutrition.skipped_count;
  let meaningWeight = 1.1;
  let reason = "body-support evidence is present";
  if (
    nutrition.unique_item_count === 1 &&
    nutrition.same_item_repeated &&
    openCount >= 3
  ) {
    meaningWeight = nutrition.dominant_problem === "recurrence_too_ambitious"
      ? 1.6
      : 1.4;
    reason =
      "one recurring nutrition thread is frequency, not many separate obligations";
  } else if (
    nutrition.dominant_problem === "several_distinct_items_one_day" ||
    nutrition.same_day_collision
  ) {
    meaningWeight = 2.5;
    reason = "several distinct nutrition threads collided in the same day";
  } else if (nutrition.dominant_problem === "many_overlapping_sources") {
    meaningWeight = 2.4;
    reason = "several distinct nutrition sources overlap in purpose";
  } else if (nutrition.dominant_problem === "schedule_too_dense") {
    meaningWeight = 2.2;
    reason = "the nutrition schedule is dense after thread normalization";
  } else if (nutrition.dominant_problem === "completed_but_unlogged") {
    meaningWeight = 1.7;
    reason = "nutrition appears done in practice but thin in the record";
  } else if (nutrition.dominant_problem === "no_recent_completion") {
    meaningWeight = 1.6;
    reason = "nutrition has an open thread without recent completion evidence";
  } else if (nutrition.unique_item_count >= 3) {
    meaningWeight = 2.1;
    reason = "nutrition has several distinct open threads";
  }
  return {
    domain: "nutrition" as const,
    meaningWeight,
    occurrenceCount: nutrition.occurrence_count,
    threadCount: nutrition.unique_item_count,
    reason,
  };
}

function todoMeaningWeight(
  threads?: MaatNormalizedObligationThreads | null,
) {
  const todo = threads?.todo;
  if (!todo || todo.unique_item_count <= 0) return null;
  const openCount = todo.pending_count + todo.skipped_count +
    todo.partial_count;
  return {
    domain: "todo" as const,
    meaningWeight: Math.min(
      3.4,
      1.1 + todo.unique_item_count * 0.45 +
        openCount * 0.12 + (todo.completed_count > 0 ? 0.4 : 0),
    ),
    occurrenceCount: todo.occurrence_count,
    threadCount: todo.unique_item_count,
    reason: todo.unique_item_count >= 3
      ? "visible work has several distinct open loops"
      : "visible work has a concrete thread in the account",
  };
}

function isNutritionDerivedProfileRef(
  ref: MaatTranslatedProfileContext["factRefs"][number],
) {
  return (
    ref.fact_type === "routine_style" &&
    ref.value === "single_recurring_support_thread"
  ) ||
    (
      ref.fact_type === "commitment_pattern" &&
      ref.value === "recurring_obligation_unkept"
    ) ||
    (
      ref.fact_type === "care_direction" &&
      ref.value === "self_provision_visible"
    );
}

function profileRefsOfType(
  context: MaatTranslatedProfileContext | null | undefined,
  types: string[],
) {
  return (context?.factRefs ?? []).filter((ref) =>
    types.includes(ref.fact_type)
  );
}

export function buildReflectionDomainBalance(params: {
  calendarFrame?: ReflectionCalendarFrame | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  translatedProfileContext?: MaatTranslatedProfileContext | null;
  userPatternProfile?: ReflectionUserPatternProfile | null;
}): ReflectionDomainBalance {
  const signals: ReflectionDomainSignal[] = [];
  addDomainSignal(
    signals,
    nutritionMeaningWeight(
      params.normalizedObligationThreads,
    ),
  );
  addDomainSignal(
    signals,
    todoMeaningWeight(params.normalizedObligationThreads),
  );

  const recordRefs = profileRefsOfType(params.translatedProfileContext, [
    "record_style",
  ]);
  if (recordRefs.length > 0 || params.userPatternProfile?.recordStyle) {
    addDomainSignal(signals, {
      domain: "note_record",
      meaningWeight: recordRefs.length > 0 ? 2.5 : 1.5,
      occurrenceCount: recordRefs.reduce(
        (sum, ref) => sum + (ref.confidence === "high" ? 2 : 1),
        0,
      ),
      threadCount: recordRefs.length || 1,
      reason:
        "record-style profile facts shape how much the decan can be witnessed",
    });
  }

  const flowRefs = (params.translatedProfileContext?.factRefs ?? []).filter(
    (ref) =>
      ref.fact_type === "practice_trajectory" &&
      ["flow_structure_works", "self_revising_practice"].includes(ref.value),
  );
  if (flowRefs.length > 0) {
    addDomainSignal(signals, {
      domain: "flow",
      meaningWeight: 2.2,
      occurrenceCount: flowRefs.length,
      threadCount: flowRefs.length,
      reason: "flow behavior shows how structure does or does not help",
    });
  }

  const reminderRefs = (params.translatedProfileContext?.factRefs ?? []).filter(
    (ref) =>
      ref.fact_type === "routine_style" && ref.value === "reminder_anchored",
  );
  if (reminderRefs.length > 0) {
    addDomainSignal(signals, {
      domain: "reminder",
      meaningWeight: 1.9,
      occurrenceCount: reminderRefs.length,
      threadCount: reminderRefs.length,
      reason: "reminder behavior shows which structures are carrying rhythm",
    });
  }

  const guidanceRefs = profileRefsOfType(params.translatedProfileContext, [
    "guidance_response",
    "offering_fit",
  ]);
  if (guidanceRefs.length > 0) {
    addDomainSignal(signals, {
      domain: "guidance",
      meaningWeight: 2.2,
      occurrenceCount: guidanceRefs.length,
      threadCount: guidanceRefs.length,
      reason: "prior guidance outcomes shape the next reflection stance",
    });
  }

  const roleRefs = profileRefsOfType(params.translatedProfileContext, [
    "role_context",
    "work_domain",
    "register_affinity",
    "capacity_state",
    "completion_timing",
    "practice_trajectory",
  ]).filter((ref) => !isNutritionDerivedProfileRef(ref));
  if (
    roleRefs.length > 0 ||
    (params.userPatternProfile?.roleSignals.length ?? 0) > 0 ||
    params.userPatternProfile?.preferredRegister === "sacred"
  ) {
    addDomainSignal(signals, {
      domain: "node_library",
      meaningWeight: roleRefs.length > 0 ? 2.1 : 1.4,
      occurrenceCount: roleRefs.length,
      threadCount: roleRefs.length ||
        (params.userPatternProfile?.roleSignals.length ?? 1),
      reason:
        "durable profile and graph signals provide the personal lens beyond current rows",
    });
  }

  if (params.calendarFrame) {
    addDomainSignal(signals, {
      domain: "calendar_day_card",
      meaningWeight: 3,
      occurrenceCount: params.calendarFrame.dayCards.length,
      threadCount: 1,
      reason: "calendar and day-card arc governs the reflection frame",
    });
  }

  const nonCalendar = signals.filter((signal) =>
    signal.domain !== "calendar_day_card"
  );
  const nonNutritionProfileSignals = nonCalendar.filter((signal) =>
    signal.domain !== "nutrition" && signal.meaningWeight >= 1.5
  );
  const concreteBehaviorDomains = nonCalendar.filter((signal) =>
    ["nutrition", "todo", "flow", "guidance", "note_record", "reminder"]
      .includes(
        signal.domain,
      ) && signal.meaningWeight >= 1.2
  );
  const evidenceDensity: ReflectionEvidenceDensity =
    concreteBehaviorDomains.length <= 1 &&
      nonNutritionProfileSignals.length === 0
      ? "thin"
      : concreteBehaviorDomains.length + nonNutritionProfileSignals.length >= 4
      ? "dense"
      : "balanced";

  const sorted = signals.slice().sort((a, b) =>
    b.meaningWeight - a.meaningWeight ||
    a.domain.localeCompare(b.domain)
  );
  const primaryDomain = sorted[0]?.domain ?? null;
  return {
    version: "reflection_domain_balance_v1",
    evidenceDensity,
    primaryDomain,
    domainSignals: sorted,
    occurrenceVsMeaningNote:
      "Occurrences show frequency; normalized threads and profile facts determine meaning weight.",
  };
}

function textMatchesAny(value: string, patterns: RegExp | RegExp[]) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function joinedEvidence(params: {
  evidenceTexts?: string[] | null;
  profile?: {
    top_nodes?: unknown[] | null;
    dominant_patterns?: unknown[] | null;
    tension_pairs?: unknown[] | null;
  } | null;
}) {
  const profileValue = (value: unknown) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      return [row.slug, row.label, row.name, row.pattern]
        .filter((item) => typeof item === "string")
        .join(" ");
    }
    return "";
  };
  return [
    ...(params.evidenceTexts ?? []),
    ...(params.profile?.top_nodes ?? []).map(profileValue),
    ...(params.profile?.dominant_patterns ?? []).map(profileValue),
    ...(params.profile?.tension_pairs ?? []).map(profileValue),
  ].join(" ").toLowerCase();
}

export function buildReflectionUserPatternProfile(params: {
  maturity?: {
    level?: string | null;
    label?: string | null;
    confidence?: number | null;
  } | null;
  profile?: {
    top_nodes?: unknown[] | null;
    dominant_patterns?: unknown[] | null;
    tension_pairs?: unknown[] | null;
  } | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  evidenceTexts?: string[] | null;
  activeDays?: number | null;
}): ReflectionUserPatternProfile {
  const text = joinedEvidence(params);
  const nutrition = params.normalizedObligationThreads?.nutrition;
  const todo = params.normalizedObligationThreads?.todo;
  const roleSignals = [
    textMatchesAny(text, /\b(parent|child|kids?|family|partner|caretak)/g)
      ? "caretaker"
      : "",
    textMatchesAny(text, /\b(client|business|founder|entrepreneur|sale)/g)
      ? "entrepreneur"
      : "",
    textMatchesAny(text, /\b(research|paper|study|class|academic)/g)
      ? "academic_or_student"
      : "",
    textMatchesAny(text, /\b(art|creative|design|piece|craft|music|write)/g)
      ? "creative_worker"
      : "",
    textMatchesAny(text, /\b(code|deploy|debug|github|server|software)/g)
      ? "developer"
      : "",
    textMatchesAny(text, /\b(ritual|altar|offering|prayer|ceremony|oracle)/g)
      ? "spiritual_practitioner"
      : "",
  ].filter(Boolean);
  const capacitySignals = [
    textMatchesAny(text, /\b(grief|illness|sick|loss|hospital|pain)\b/g)
      ? "health_or_grief_load"
      : "",
    textMatchesAny(text, /\b(move|moving|travel|transition|new job|shift)\b/g)
      ? "transition_load"
      : "",
    textMatchesAny(text, /\b(overwhelm|exhaust|too much|burnout|stress)\b/g)
      ? "external_load"
      : "",
  ].filter(Boolean);
  const routineStyle = nutrition?.unique_item_count === 1 &&
      nutrition.same_item_repeated
    ? "single_recurring_support_thread"
    : nutrition && nutrition.unique_item_count >= 3
    ? "broad_body_support_surface"
    : todo && todo.unique_item_count >= 3
    ? "many_open_work_loops"
    : (params.activeDays ?? 0) <= 1
    ? "thin_or_new_record"
    : "mixed_record";
  const workStyle = todo && todo.unique_item_count >= 3
    ? "open_loop_work"
    : todo && (todo.completed_count ?? 0) > 0
    ? "visible_completion"
    : "not_enough_work_signal";
  const recordStyle = nutrition?.unique_item_count === 1 &&
      nutrition.same_item_repeated
    ? "recurring_mark_without_keepable_recording_rhythm"
    : (params.activeDays ?? 0) <= 1
    ? "thin_record"
    : "mixed_record";
  const careDirection = roleSignals.includes("caretaker")
    ? "other_directed_care_visible"
    : nutrition
    ? "self_provision_visible"
    : "unspecified";
  const preferredRegister: ReflectionUserPatternProfile["preferredRegister"] =
    capacitySignals.length > 0
      ? "witnessing"
      : roleSignals.includes("spiritual_practitioner")
      ? "sacred"
      : roleSignals.includes("caretaker")
      ? "direct"
      : "practical";
  return {
    version: "reflection_user_pattern_profile_v1",
    maturity: params.maturity ?? null,
    roleSignals: [...new Set(roleSignals)],
    routineStyle,
    workStyle,
    recordStyle,
    careDirection,
    capacitySignals: [...new Set(capacitySignals)],
    preferredRegister,
    recentOutcomePattern: params.maturity?.level === "cold_start"
      ? "new_account"
      : "current_decan_signal",
  };
}

export function buildReflectionAlignmentMap(params: {
  calendarFrame?: ReflectionCalendarFrame | null;
  snapshot?: MaatDimensionSnapshot | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  translatedProfileContext?: MaatTranslatedProfileContext | null;
  userPatternProfile?: ReflectionUserPatternProfile | null;
  immediateCaseThread?: ReflectionAlignmentMap["immediateCaseThread"];
}): ReflectionAlignmentMap {
  const leadAxis = params.snapshot?.leadAxis ?? "M";
  const domainBalance = buildReflectionDomainBalance({
    calendarFrame: params.calendarFrame ?? null,
    normalizedObligationThreads: params.normalizedObligationThreads ?? null,
    translatedProfileContext: params.translatedProfileContext ?? null,
    userPatternProfile: params.userPatternProfile ?? null,
  });
  const nutritionSummary = nutritionThreadSummary(
    params.normalizedObligationThreads,
  );
  const threadSummary = openThreadSummary(params.normalizedObligationThreads);
  const profilePhrases = params.translatedProfileContext?.phrases ?? [];
  const hasProfileLens = profilePhrases.length > 0;
  const primaryDomain = domainBalance.primaryDomain;
  const primaryMeaningDomain =
    domainBalance.domainSignals.find((signal) =>
      signal.domain !== "calendar_day_card"
    )?.domain ?? primaryDomain;
  const alignedSignals = [
    AXIS_ALIGNMENT[leadAxis],
    nutritionSummary && domainBalance.evidenceDensity !== "thin"
      ? "the body-support intention was visible in the account"
      : "",
    primaryMeaningDomain === "todo"
      ? "visible work gave the decan something concrete to measure"
      : "",
    primaryMeaningDomain === "flow"
      ? "structure was present wherever a flow made action easier to enter"
      : "",
    hasProfileLens
      ? "the durable profile gives the decan a personal lens beyond this period's loudest row"
      : "",
  ].filter(Boolean);
  const thinEvidenceUnderanswered = hasProfileLens
    ? "the reflection should use the user's profile pattern to interpret thin evidence without overstating it"
    : "the account is thin enough that the calendar arc should lead and the evidence should stay light";
  const domainUnderanswered = primaryMeaningDomain === "nutrition"
    ? nutritionSummary
    : primaryMeaningDomain === "todo"
    ? "visible work needs clearer endings than the current account shows"
    : primaryMeaningDomain === "flow"
    ? "structure needs to be carried into one repeatable opening"
    : primaryMeaningDomain === "reminder"
    ? "the reminder pattern needs to be read as part of the user's rhythm, not background noise"
    : primaryMeaningDomain === "guidance"
    ? "the next guidance stance should learn from what the user actually acts on"
    : primaryMeaningDomain === "note_record"
    ? "the written record needs one trustworthy witness, not more raw activity"
    : primaryMeaningDomain === "node_library"
    ? "the user's profile pattern should shape the charge more than the loudest current item"
    : threadSummary;
  const underansweredSignals = [
    domainBalance.evidenceDensity === "thin"
      ? thinEvidenceUnderanswered
      : domainUnderanswered ||
        "one part of the account still needs a clearer structure",
    params.snapshot?.reflectionMove === "correct"
      ? "the next alignment needs structure, not more explanation"
      : "",
  ].filter(Boolean);
  const calendarFrame = params.calendarFrame ?? null;
  const dominantLesson = calendarFrame
    ? `${calendarFrame.ceremonialDecanName} asks the user to read the record through ${calendarFrame.arcSummary.toLowerCase()}; evidence frequency should be weighed through normalized meaning, not raw row count`
    : "Ma'at asks the user to read intention and evidence together.";
  const nextDecanCharge = params.immediateCaseThread?.concreteAction ||
    "carry one proportionate correction into the next decan.";
  return {
    version: "reflection_alignment_map_v1",
    calendarFrame,
    alignedSignals: [...new Set(alignedSignals)].slice(0, 3),
    underansweredSignals: [...new Set(underansweredSignals)].slice(0, 3),
    dominantLesson,
    nextDecanCharge,
    evidenceDensity: domainBalance.evidenceDensity,
    domainBalance,
    profileLensApplied: hasProfileLens,
    immediateCaseThread: params.immediateCaseThread ?? null,
  };
}

function closingKindFor(
  selectedExampleClosing: "question" | "charge" | null | undefined,
  map: ReflectionAlignmentMap,
) {
  if (selectedExampleClosing) return selectedExampleClosing;
  const action = clean(map.immediateCaseThread?.concreteAction).toLowerCase();
  if (
    /^(make|choose|complete|record|release|write|name|close|attach)\b/.test(
      action,
    )
  ) {
    return "charge" as const;
  }
  return "question" as const;
}

function questionFromCase(
  map: ReflectionAlignmentMap,
  profile: ReflectionUserPatternProfile | null | undefined,
) {
  const caseKey = clean(map.immediateCaseThread?.caseKey).toLowerCase();
  if (caseKey.includes("provision.repeated_open_checks")) {
    return "What existing moment could let this care and its witness meet in one small measure?";
  }
  if (caseKey.includes("no_finish_condition")) {
    return "What would finished enough for this period mean for the one piece that matters most?";
  }
  if (caseKey.includes("truthful_record")) {
    return "What one detail from this decan deserves to be written so the record can stand on it later?";
  }
  if (caseKey.includes("overcommitted") || caseKey.includes("overloaded")) {
    return "What one obligation would make the remaining account more keepable if it were released or narrowed now?";
  }
  if (profile?.routineStyle === "many_open_work_loops") {
    return "Which one open thread would give the account firmer ground if it closed before the next decan?";
  }
  return "What one measure would make the next decan easier to keep honestly?";
}

export function buildReflectionArcPlan(params: {
  calendarFrame?: ReflectionCalendarFrame | null;
  alignmentMap: ReflectionAlignmentMap;
  userPatternProfile?: ReflectionUserPatternProfile | null;
  translatedProfileContext?: MaatTranslatedProfileContext | null;
  selectedExamples?:
    | Array<{
      id: string;
      closingMove?: "question" | "charge";
    }>
    | null;
}): ReflectionArcPlan {
  const frame = params.calendarFrame ?? params.alignmentMap.calendarFrame;
  const firstExample = params.selectedExamples?.[0];
  const closingKind = closingKindFor(
    firstExample?.closingMove,
    params.alignmentMap,
  );
  const aligned = params.alignmentMap.alignedSignals[0] ||
    "one part of the record answered the period's demand";
  const underanswered = params.alignmentMap.underansweredSignals[0] ||
    "one part of the account still needs a clearer structure";
  const caseThreadRole: ReflectionArcPlan["caseThreadRole"] =
    !params.alignmentMap.immediateCaseThread
      ? "supporting_signal"
      : params.alignmentMap.evidenceDensity === "thin"
      ? "supporting_signal"
      : params.alignmentMap.domainBalance.primaryDomain === "nutrition" &&
          clean(params.alignmentMap.immediateCaseThread.caseKey).includes(
            "provision",
          )
      ? "minor_gap"
      : "supporting_signal";
  const calendarDemand = frame
    ? `${frame.ceremonialDecanName} asks for ${
      frame.decanTheme || frame.monthMeaning
    }`
    : "The decan asks the record to be read as a complete movement";
  const decanArc = frame?.arcSummary ||
    "The reflection should read the decan as a whole arc, not as isolated evidence.";
  const closingText = closingKind === "question"
    ? questionFromCase(params.alignmentMap, params.userPatternProfile)
    : sentence(
      params.alignmentMap.immediateCaseThread?.concreteAction ||
        params.alignmentMap.nextDecanCharge,
    );
  return {
    version: "reflection_arc_plan_v1",
    calendarDemand,
    decanArc,
    userAlignedBy: aligned,
    userUnderansweredBy: underanswered,
    caseThreadRole,
    notWholeIdentity:
      "The case thread is one thread inside the decan account, not the user's whole identity and not the whole reflection.",
    maatLesson: params.alignmentMap.dominantLesson ||
      "Ma'at asks intention to become keepable order through truthful measure.",
    closingKind,
    closingText,
    evidenceAnchorLimit: 1,
    evidenceDensity: params.alignmentMap.evidenceDensity,
    domainBalanceSummary: params.alignmentMap.domainBalance.domainSignals.map((
      signal,
    ) =>
      `${signal.domain}: weight ${signal.meaningWeight}, occurrences ${signal.occurrenceCount}, reason: ${signal.reason}`
    ).join(" | "),
    profileLensRequired: params.alignmentMap.evidenceDensity === "thin" &&
      (params.translatedProfileContext?.phrases.length ?? 0) > 0,
    profileContextPhrases: params.translatedProfileContext?.phrases ?? [],
    profileContextRefs: params.translatedProfileContext?.factRefs ?? [],
    prohibitedFocus: [
      "do not open with the user's missed item, task, or case diagnosis",
      "do not let nutrition row density choose the reflection topic",
      "do not treat repeated occurrences as separate meaning",
      frame
        ? `name the current decan as ${frame.ceremonialDecanName}, not merely ${frame.monthName}'s decan`
        : "name the current decan when calendar context is available",
      "do not write a longer nudge",
      "do not let the case thread govern over the calendar arc",
      "do not repeat the concrete evidence anchor more than once",
      "do not list multiple corrective options",
      "do not end with both a question and a charge",
      "do not inflate routine care evidence into crisis or proof language",
    ],
    exampleRefs: (params.selectedExamples ?? []).map((example) => example.id),
  };
}

export function reflectionCalendarPromptBlock(params: {
  calendarFrame?: ReflectionCalendarFrame | null;
  alignmentMap?: ReflectionAlignmentMap | null;
  userPatternProfile?: ReflectionUserPatternProfile | null;
  arcPlan?: ReflectionArcPlan | null;
}) {
  const frame = params.calendarFrame;
  const map = params.alignmentMap;
  const profile = params.userPatternProfile;
  const arcPlan = params.arcPlan;
  if (!frame && !map && !profile && !arcPlan) return "";
  const dayCardLines = frame?.dayCards.length
    ? frame.dayCards.map((card) =>
      `- Day ${card.day} [${card.stage}]: ${card.theme}. Action: ${card.action} Reflection: ${card.reflectionPrompt}`
    ).join("\n")
    : "";
  return [
    "REFLECTION_CALENDAR_FRAME (use as the decan arc; do not print this heading):",
    frame
      ? [
        `Month: ${frame.monthName} (${frame.monthTransliteration}) - ${frame.monthMeaning}.`,
        `Season: ${frame.seasonName} - ${frame.seasonMeaning}`,
        `Decan: ${frame.decanName}${
          frame.decanTheme ? ` - ${frame.decanTheme}` : ""
        }.`,
        `Canonical spoken decan name: ${frame.ceremonialDecanName}. Use this form in the opening sentence.`,
        `Decan description: ${frame.decanDescription}`,
        `Arc summary: ${frame.arcSummary}`,
        dayCardLines ? `Day-card arc:\n${dayCardLines}` : "",
      ].filter(Boolean).join("\n")
      : "",
    map
      ? [
        "REFLECTION_ALIGNMENT_MAP:",
        `Evidence density: ${map.evidenceDensity}.`,
        `Domain balance: ${
          map.domainBalance.domainSignals.map((signal) =>
            `${signal.domain} weight=${signal.meaningWeight} occurrences=${signal.occurrenceCount} threads=${signal.threadCount} (${signal.reason})`
          ).join("; ") || "none"
        }.`,
        `Primary domain by meaning weight: ${
          map.domainBalance.primaryDomain ?? "none"
        }.`,
        `Occurrence/meaning rule: ${map.domainBalance.occurrenceVsMeaningNote}`,
        `Profile lens applied: ${map.profileLensApplied ? "yes" : "no"}.`,
        `Aligned signals: ${map.alignedSignals.join("; ") || "none detected"}.`,
        `Underanswered signals: ${
          map.underansweredSignals.join("; ") || "none detected"
        }.`,
        `Dominant lesson: ${map.dominantLesson}`,
        `Next decan charge: ${map.nextDecanCharge}`,
      ].join("\n")
      : "",
    profile
      ? [
        "REFLECTION_USER_PATTERN_PROFILE:",
        `Maturity: ${
          profile.maturity?.label ?? profile.maturity?.level ?? "unknown"
        }.`,
        `Role signals: ${profile.roleSignals.join("; ") || "none detected"}.`,
        `Routine style: ${profile.routineStyle}.`,
        `Work style: ${profile.workStyle}.`,
        `Record style: ${profile.recordStyle}.`,
        `Care direction: ${profile.careDirection}.`,
        `Capacity signals: ${
          profile.capacitySignals.join("; ") || "none detected"
        }.`,
        `Preferred register: ${profile.preferredRegister}.`,
        `Recent outcome pattern: ${profile.recentOutcomePattern}.`,
      ].join("\n")
      : "",
    arcPlan
      ? [
        "REFLECTION_ARC_PLAN (binding hierarchy):",
        `Calendar demand: ${arcPlan.calendarDemand}`,
        `Decan arc: ${arcPlan.decanArc}`,
        `User aligned by: ${arcPlan.userAlignedBy}`,
        `User underanswered by: ${arcPlan.userUnderansweredBy}`,
        `Case thread role: ${arcPlan.caseThreadRole}`,
        `Not whole identity: ${arcPlan.notWholeIdentity}`,
        `Ma'at lesson: ${arcPlan.maatLesson}`,
        `Closing kind: ${arcPlan.closingKind}`,
        `Closing text target: ${arcPlan.closingText}`,
        `Evidence anchor limit: ${arcPlan.evidenceAnchorLimit}`,
        `Evidence density: ${arcPlan.evidenceDensity}`,
        `Domain balance summary: ${arcPlan.domainBalanceSummary || "none"}`,
        `Profile lens required: ${arcPlan.profileLensRequired ? "yes" : "no"}`,
        arcPlan.profileContextPhrases.length
          ? `Profile context: ${arcPlan.profileContextPhrases.join("; ")}`
          : "Profile context: none.",
        `Prohibited focus: ${arcPlan.prohibitedFocus.join("; ")}`,
        `Example refs: ${arcPlan.exampleRefs.join(", ") || "none"}`,
      ].join("\n")
      : "",
  ].filter(Boolean).join("\n");
}
