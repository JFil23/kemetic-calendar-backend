import type {
  MaatUserProfileFact,
  MaatUserProfileFactConfidence,
} from "./profile_fact_extractor.ts";

export const MAAT_PROFILE_CONTEXT_VERSION = "maat_profile_context_v1";

export type MaatTranslatedProfileContext = {
  version: typeof MAAT_PROFILE_CONTEXT_VERSION;
  phrases: string[];
  factRefs: Array<{
    fact_type: string;
    value: string;
    confidence: MaatUserProfileFactConfidence;
    stability: string;
  }>;
  omittedLowConfidenceCount: number;
};

const TRANSLATIONS: Record<string, string> = {
  "routine_style:batch_worker":
    "This user tends to complete in focused batches rather than daily increments; a quiet middle of the decan is not absence by itself.",
  "routine_style:daily_returner":
    "This user shows strength through return; reflection should protect rhythm before asking for expansion.",
  "routine_style:irregular_engagement":
    "Engagement appears irregular, so the next step should be easy to re-enter rather than built around perfect continuity.",
  "routine_style:single_recurring_support_thread":
    "The current support pattern is one recurring thread, so the reflection should read rhythm and recording structure rather than many competing obligations.",
  "routine_style:reminder_anchored":
    "Reminder behavior is part of the rhythm; reflection can ask what the reminder is carrying instead of treating the user as unstructured.",

  "record_style:surface_logger":
    "The written record often stays thinner than the practice itself; distinguish what happened from what was written down instead of assuming absence.",
  "record_style:detailed_witness":
    "The record can hold detail when the user gives it time; use that strength to make one next mark more useful.",

  "commitment_pattern:accumulator":
    "Commitments tend to accumulate faster than they close, so a smaller active list may be more truthful than another push.",
  "commitment_pattern:many_open_loops":
    "Visible work is prone to open loops; finish conditions and release will be more useful than broad effort language.",
  "commitment_pattern:recurring_obligation_unkept":
    "A repeated open obligation points to structure and fit, not motivation; make the promise easier to place in the day.",

  "role_context:caretaker":
    "Care often moves outward first; reflection should notice whether the user's own maintenance is being displaced.",
  "role_context:spiritual_practitioner":
    "The user can receive sacred register when it clarifies practice, but the reflection still needs concrete plain language.",

  "work_domain:technical_builder":
    "Visible work appears build-oriented, where blocked prerequisites and finish conditions matter more than broad effort.",
  "work_domain:creative_worker":
    "Creative work may move before it looks complete; reflection should ask what deserves a clean close or one honest witness.",
  "work_domain:academic_or_student":
    "Study signals need retention, not just exposure; reflection should ask what knowledge became usable.",

  "capacity_state:external_load_visible":
    "There are signs of external load; use a witnessing register and avoid treating thinner completion as a character problem.",
  "capacity_state:transition_load":
    "The user's context may be shifting; look for one portable rhythm rather than assuming the old structure still fits.",

  "care_direction:self_provision_visible":
    "Self-provision is visible; reflect on how body support becomes simple enough to keep.",
  "care_direction:other_directed_care_visible":
    "Other-directed care is visible; the reflection should weigh care given outward alongside care kept for the user.",
  "care_direction:mixed_self_and_other_care":
    "Your record holds both self-care and care for others; reflection should clarify which obligation belongs where.",

  "guidance_response:interruption_averse":
    "This user appears sensitive to interruption; a question or invitation is safer than a command.",
  "guidance_response:aware_but_scope_mismatch":
    "Guidance is engaged but not always resolved, which points toward smaller scope rather than more motivation.",
  "guidance_response:restoration_responsive":
    "Prior restoration can resolve when the ask is well matched; preserve clarity and avoid overcomplicating the charge.",

  "offering_fit:scope_reduction":
    "Scope reduction is likely to serve better than repetition of the same correction.",

  "register_affinity:measure_record_language":
    "Measure and record language fits this profile only when it is translated into plain, practical terms.",
  "register_affinity:embodied_care_language":
    "Embodied care language fits this profile when it stays grounded in ordinary support.",
  "register_affinity:sacred_register":
    "Sacred register can be used as texture, not as a substitute for concrete interpretation.",
  "register_affinity:practical_register":
    "Practical register should lead; symbolic language should clarify, not decorate.",

  "completion_timing:clustered_completion":
    "Completion appears clustered; do not overread sparse daily marks when focused sessions may be the real rhythm.",

  "practice_trajectory:sparse_across_decans":
    "The record has been sparse across decans; keep claims cautious and orient toward one trustworthy mark.",
  "practice_trajectory:same_thread_returning":
    "The same thread keeps returning, so the reflection should name the repeated lesson without making it feel heavier than it is.",
  "practice_trajectory:self_revising_practice":
    "The user revises their structures; reflection can frame adjustment as part of the practice, not a detour from it.",
  "practice_trajectory:flow_structure_works":
    "Structured flows appear to work when the fit is right; reflection can point toward structure without over-commanding.",
};

function confidenceRank(value: MaatUserProfileFactConfidence) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function translationFor(fact: MaatUserProfileFact) {
  return TRANSLATIONS[`${fact.fact_type}:${fact.value}`] ?? "";
}

function lowConfidencePhrase(fact: MaatUserProfileFact) {
  const translated = translationFor(fact);
  if (!translated) return "";
  return `A light signal suggests this may be true: ${
    translated.charAt(0).toLowerCase() + translated.slice(1)
  }`;
}

export function translateMaatProfileContext(
  facts: MaatUserProfileFact[],
  options: {
    maxPhrases?: number;
    includeLowConfidenceFallback?: boolean;
  } = {},
): MaatTranslatedProfileContext {
  const maxPhrases = options.maxPhrases ?? 4;
  const sorted = facts
    .filter((fact) => fact.stability !== "contradicted")
    .slice()
    .sort((a, b) =>
      confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
      b.evidence_count - a.evidence_count ||
      a.fact_type.localeCompare(b.fact_type)
    );

  const phrases: string[] = [];
  const factRefs: MaatTranslatedProfileContext["factRefs"] = [];
  let omittedLowConfidenceCount = 0;

  for (const fact of sorted) {
    if (phrases.length >= maxPhrases) break;
    const isLow = fact.confidence === "low";
    const phrase = isLow
      ? (options.includeLowConfidenceFallback ? lowConfidencePhrase(fact) : "")
      : translationFor(fact);
    if (!phrase) {
      if (isLow) omittedLowConfidenceCount++;
      continue;
    }
    if (isLow && !options.includeLowConfidenceFallback) {
      omittedLowConfidenceCount++;
      continue;
    }
    if (phrases.includes(phrase)) continue;
    phrases.push(phrase);
    factRefs.push({
      fact_type: fact.fact_type,
      value: fact.value,
      confidence: fact.confidence,
      stability: fact.stability,
    });
  }

  return {
    version: MAAT_PROFILE_CONTEXT_VERSION,
    phrases,
    factRefs,
    omittedLowConfidenceCount,
  };
}

export function profileContextPromptBlock(
  context: MaatTranslatedProfileContext | null | undefined,
) {
  if (!context?.phrases.length) return "";
  return [
    "USER_PROFILE_CONTEXT (translated durable profile; use to personalize interpretation, never print labels or raw fact keys):",
    ...context.phrases.map((phrase) => `- ${phrase}`),
  ].join("\n");
}
