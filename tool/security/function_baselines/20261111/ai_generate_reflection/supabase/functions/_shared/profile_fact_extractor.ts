import type { ReflectionProfileRow } from "../ai_generate_reflection/maat_decision.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";

export const MAAT_USER_PROFILE_FACTS_VERSION = "maat_user_profile_facts_v1";

export type MaatUserProfileFactType =
  | "role_context"
  | "work_domain"
  | "routine_style"
  | "record_style"
  | "capacity_state"
  | "care_direction"
  | "commitment_pattern"
  | "guidance_response"
  | "offering_fit"
  | "register_affinity"
  | "completion_timing"
  | "practice_trajectory";

export type MaatUserProfileFactConfidence = "low" | "medium" | "high";
export type MaatUserProfileFactStability =
  | "emerging"
  | "stable"
  | "shifting"
  | "contradicted";

export type MaatUserProfileFact = {
  version: typeof MAAT_USER_PROFILE_FACTS_VERSION;
  user_id?: string | null;
  fact_type: MaatUserProfileFactType;
  value: string;
  source: string;
  confidence: MaatUserProfileFactConfidence;
  evidence_count: number;
  first_seen: string;
  last_seen: string;
  stability: MaatUserProfileFactStability;
  counterevidence?: string | null;
  metadata: Record<string, unknown>;
};

export type ProfileEvidenceBadge = {
  title?: string | null;
  details?: string | null;
  tags?: string[] | null;
  occurred_on?: string | null;
  event_id?: string | null;
};

export type ProfileHistoryMetric = {
  badgeCount?: number | null;
  daysActive?: number | null;
  progressMarkersCount?: number | null;
  topThread?: string | null;
};

export type ProfileGuidanceOutcomeStats = {
  opened: number;
  acted: number;
  resolved: number;
  dismissed: number;
  expired: number;
};

export type ProfileFlowBehaviorStats = {
  flowCount: number;
  eventsTotal: number;
  eventsCompleted: number;
  editCount: number;
  acceptedAsIsCount: number;
};

export type ExtractMaatUserProfileFactsInput = {
  userId?: string | null;
  badges?: ProfileEvidenceBadge[];
  historyMetrics?: ProfileHistoryMetric[];
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  reflectionProfile?: ReflectionProfileRow | null;
  guidanceOutcomes?: ProfileGuidanceOutcomeStats | null;
  flowBehavior?: ProfileFlowBehaviorStats | null;
  nowIso?: string;
};

type FactCandidate = {
  fact_type: MaatUserProfileFactType;
  value: string;
  source: string;
  evidence_count: number;
  metadata?: Record<string, unknown>;
  counterevidence?: string | null;
};

type MaatProfileFactDbRow = {
  user_id?: string | null;
  fact_type: string;
  value: string;
  source?: string | null;
  confidence?: string | null;
  evidence_count?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  stability?: string | null;
  counterevidence?: string | null;
  metadata?: Record<string, unknown> | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function lower(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function factKey(fact: Pick<MaatUserProfileFact, "fact_type" | "value">) {
  return `${fact.fact_type}:${fact.value}`;
}

function confidenceFor(count: number): MaatUserProfileFactConfidence {
  if (count >= 4) return "high";
  if (count >= 2) return "medium";
  return "low";
}

function stabilityFor(
  confidence: MaatUserProfileFactConfidence,
  counterevidence?: string | null,
): MaatUserProfileFactStability {
  if (counterevidence) return "contradicted";
  if (confidence === "high") return "stable";
  return "emerging";
}

function countMatches(text: string, terms: string[]) {
  let count = 0;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`, "gi");
    count += (text.match(re) ?? []).length;
  }
  return count;
}

function badgeText(badge: ProfileEvidenceBadge) {
  return [
    badge.title,
    badge.details,
    badge.tags?.join(" "),
    badge.event_id,
  ].map((part) => clean(part)).filter(Boolean).join(" ");
}

function activeDates(badges: ProfileEvidenceBadge[]) {
  return new Set(
    badges.map((badge) => clean(badge.occurred_on)).filter(Boolean),
  );
}

function detailCoverage(badges: ProfileEvidenceBadge[]) {
  if (!badges.length) return 0;
  const withDetails = badges.filter((badge) => clean(badge.details).length > 0)
    .length;
  return withDetails / badges.length;
}

function addFact(
  out: FactCandidate[],
  fact_type: MaatUserProfileFactType,
  value: string,
  source: string,
  evidence_count: number,
  metadata: Record<string, unknown> = {},
  counterevidence?: string | null,
) {
  if (!value || evidence_count <= 0) return;
  out.push({
    fact_type,
    value,
    source,
    evidence_count,
    metadata,
    counterevidence: counterevidence ?? null,
  });
}

function profileNodeText(profile?: ReflectionProfileRow | null) {
  return [
    ...(profile?.top_nodes ?? []).map((node) => node.slug ?? ""),
    ...(profile?.dominant_patterns ?? []),
    ...(profile?.tension_pairs ?? []).flat(),
  ].join(" ").toLowerCase();
}

function buildFact(
  candidate: FactCandidate,
  nowIso: string,
  userId?: string | null,
): MaatUserProfileFact {
  const confidence = confidenceFor(candidate.evidence_count);
  return {
    version: MAAT_USER_PROFILE_FACTS_VERSION,
    user_id: userId ?? null,
    fact_type: candidate.fact_type,
    value: candidate.value,
    source: candidate.source,
    confidence,
    evidence_count: candidate.evidence_count,
    first_seen: nowIso,
    last_seen: nowIso,
    stability: stabilityFor(confidence, candidate.counterevidence),
    counterevidence: candidate.counterevidence ?? null,
    metadata: candidate.metadata ?? {},
  };
}

function validFactType(value: string): value is MaatUserProfileFactType {
  return [
    "role_context",
    "work_domain",
    "routine_style",
    "record_style",
    "capacity_state",
    "care_direction",
    "commitment_pattern",
    "guidance_response",
    "offering_fit",
    "register_affinity",
    "completion_timing",
    "practice_trajectory",
  ].includes(value);
}

function validConfidence(
  value: string,
): value is MaatUserProfileFactConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function validStability(value: string): value is MaatUserProfileFactStability {
  return value === "emerging" || value === "stable" ||
    value === "shifting" || value === "contradicted";
}

export function normalizeMaatUserProfileFact(
  row: MaatProfileFactDbRow,
): MaatUserProfileFact | null {
  if (!validFactType(row.fact_type) || !clean(row.value)) return null;
  const confidence = validConfidence(clean(row.confidence))
    ? clean(row.confidence) as MaatUserProfileFactConfidence
    : confidenceFor(Number(row.evidence_count ?? 1));
  const stability = validStability(clean(row.stability))
    ? clean(row.stability) as MaatUserProfileFactStability
    : stabilityFor(confidence, row.counterevidence);
  return {
    version: MAAT_USER_PROFILE_FACTS_VERSION,
    user_id: row.user_id ?? null,
    fact_type: row.fact_type,
    value: clean(row.value),
    source: clean(row.source) || "stored",
    confidence,
    evidence_count: Math.max(1, Number(row.evidence_count ?? 1)),
    first_seen: clean(row.first_seen) || clean(row.last_seen) ||
      new Date().toISOString(),
    last_seen: clean(row.last_seen) || clean(row.first_seen) ||
      new Date().toISOString(),
    stability,
    counterevidence: clean(row.counterevidence) || null,
    metadata: row.metadata ?? {},
  };
}

export function extractMaatUserProfileFacts(
  input: ExtractMaatUserProfileFactsInput,
): MaatUserProfileFact[] {
  const badges = input.badges ?? [];
  const text = badges.map(badgeText).join(" ").toLowerCase();
  const dates = activeDates(badges);
  const coverage = detailCoverage(badges);
  const profileText = profileNodeText(input.reflectionProfile);
  const nowIso = input.nowIso ?? new Date().toISOString();
  const candidates: FactCandidate[] = [];

  const caretakerHits = countMatches(text, [
    "child",
    "children",
    "kids",
    "family",
    "partner",
    "dependent",
    "elder",
    "care",
    "caregiving",
    "medicine",
  ]);
  addFact(
    candidates,
    "role_context",
    "caretaker",
    "evidence_keywords",
    caretakerHits,
    { matched_context: "care terms" },
  );

  const technicalHits = countMatches(text, [
    "code",
    "deploy",
    "debug",
    "github",
    "server",
    "software",
    "api",
    "build",
    "feature",
    "bug",
  ]);
  addFact(
    candidates,
    "work_domain",
    "technical_builder",
    "evidence_keywords",
    technicalHits,
    { matched_context: "technical work terms" },
  );

  const creativeHits = countMatches(text, [
    "art",
    "creative",
    "design",
    "piece",
    "craft",
    "music",
    "write",
    "draft",
    "story",
  ]);
  addFact(
    candidates,
    "work_domain",
    "creative_worker",
    "evidence_keywords",
    creativeHits,
    { matched_context: "creative work terms" },
  );

  const academicHits = countMatches(text, [
    "research",
    "paper",
    "study",
    "class",
    "academic",
    "read",
    "sources",
  ]);
  addFact(
    candidates,
    "work_domain",
    "academic_or_student",
    "evidence_keywords",
    academicHits,
    {
      matched_context: "study terms",
    },
  );

  const spiritualHits = countMatches(`${text} ${profileText}`, [
    "ritual",
    "altar",
    "offering",
    "prayer",
    "ceremony",
    "oracle",
    "maat",
    "djehuty",
    "hathor",
  ]);
  addFact(
    candidates,
    "role_context",
    "spiritual_practitioner",
    "evidence_or_graph",
    spiritualHits,
    {
      matched_context: "ritual or graph terms",
    },
  );

  const capacityHits = countMatches(text, [
    "grief",
    "illness",
    "sick",
    "loss",
    "hospital",
    "pain",
    "overwhelm",
    "exhausted",
    "too much",
    "burnout",
    "stress",
  ]);
  addFact(
    candidates,
    "capacity_state",
    "external_load_visible",
    "evidence_keywords",
    capacityHits,
    {
      matched_context: "load terms",
    },
  );

  const transitionHits = countMatches(text, [
    "moving",
    "move",
    "travel",
    "transition",
    "new job",
    "shift",
  ]);
  addFact(
    candidates,
    "capacity_state",
    "transition_load",
    "evidence_keywords",
    transitionHits,
  );

  const reminderHits = countMatches(text, [
    "reminder",
    "reminders",
    "notification",
    "notify",
    "scheduled alert",
  ]);
  addFact(
    candidates,
    "routine_style",
    "reminder_anchored",
    "evidence_keywords",
    reminderHits,
    { matched_context: "reminder terms" },
  );

  const nutrition = input.normalizedObligationThreads?.nutrition;
  const todo = input.normalizedObligationThreads?.todo;
  if (nutrition?.unique_item_count === 1 && nutrition.same_item_repeated) {
    addFact(
      candidates,
      "routine_style",
      "single_recurring_support_thread",
      "obligation_threads",
      Math.max(1, nutrition.occurrence_count),
      {
        dominant_problem: nutrition.dominant_problem,
      },
    );
    if (nutrition.pending_count + nutrition.skipped_count >= 3) {
      addFact(
        candidates,
        "commitment_pattern",
        "recurring_obligation_unkept",
        "obligation_threads",
        nutrition.pending_count + nutrition.skipped_count,
        { domain: "nutrition", dominant_problem: nutrition.dominant_problem },
      );
    }
  }
  if ((todo?.unique_item_count ?? 0) >= 4) {
    addFact(
      candidates,
      "commitment_pattern",
      "many_open_loops",
      "obligation_threads",
      todo?.unique_item_count ?? 0,
      {
        domain: "todo",
      },
    );
  }
  if (
    (nutrition?.unique_item_count ?? 0) + (todo?.unique_item_count ?? 0) >= 6
  ) {
    addFact(
      candidates,
      "commitment_pattern",
      "accumulator",
      "obligation_threads",
      (nutrition?.unique_item_count ?? 0) +
        (todo?.unique_item_count ?? 0),
      {
        nutrition_unique: nutrition?.unique_item_count ?? 0,
        todo_unique: todo?.unique_item_count ?? 0,
      },
    );
  }
  if (nutrition && !caretakerHits) {
    addFact(
      candidates,
      "care_direction",
      "self_provision_visible",
      "obligation_threads",
      Math.max(1, nutrition.unique_item_count),
    );
  }
  if (caretakerHits > 0 && nutrition) {
    addFact(
      candidates,
      "care_direction",
      "mixed_self_and_other_care",
      "evidence_and_threads",
      caretakerHits + nutrition.unique_item_count,
    );
  } else if (caretakerHits > 0) {
    addFact(
      candidates,
      "care_direction",
      "other_directed_care_visible",
      "evidence_keywords",
      caretakerHits,
    );
  }

  if (badges.length >= 5 && dates.size <= 2) {
    addFact(
      candidates,
      "routine_style",
      "batch_worker",
      "decan_badges",
      badges.length,
      { active_days: dates.size },
    );
    addFact(
      candidates,
      "completion_timing",
      "clustered_completion",
      "decan_badges",
      badges.length,
      { active_days: dates.size },
    );
  } else if (dates.size >= 6) {
    addFact(
      candidates,
      "routine_style",
      "daily_returner",
      "decan_badges",
      dates.size,
    );
  } else if (badges.length >= 3 && dates.size <= 2) {
    addFact(
      candidates,
      "routine_style",
      "irregular_engagement",
      "decan_badges",
      badges.length,
      { active_days: dates.size },
    );
  }

  if (badges.length >= 3 && coverage < 0.25) {
    addFact(
      candidates,
      "record_style",
      "surface_logger",
      "badge_detail_ratio",
      badges.length,
      { detail_coverage: coverage },
    );
  } else if (badges.length >= 3 && coverage >= 0.6) {
    addFact(
      candidates,
      "record_style",
      "detailed_witness",
      "badge_detail_ratio",
      badges.length,
      { detail_coverage: coverage },
    );
  }

  const history = input.historyMetrics ?? [];
  if (history.length >= 2) {
    const activeDays = history.map((item) => Number(item.daysActive ?? 0));
    const lowActive = activeDays.filter((value) => value <= 2).length;
    if (lowActive >= 2) {
      addFact(
        candidates,
        "practice_trajectory",
        "sparse_across_decans",
        "history_metrics",
        lowActive,
        { active_days: activeDays },
      );
    }
    const threads = history.map((item) => lower(item.topThread)).filter(
      Boolean,
    );
    if (threads.length >= 2 && new Set(threads).size === 1) {
      addFact(
        candidates,
        "practice_trajectory",
        "same_thread_returning",
        "history_metrics",
        threads.length,
        { thread: threads[0] },
      );
    }
  }

  const outcomes = input.guidanceOutcomes;
  if (outcomes) {
    if (outcomes.dismissed >= 3 && outcomes.dismissed > outcomes.opened) {
      addFact(
        candidates,
        "guidance_response",
        "interruption_averse",
        "guidance_outcomes",
        outcomes.dismissed,
        outcomes,
      );
    }
    if (outcomes.acted >= 2 && outcomes.resolved === 0) {
      addFact(
        candidates,
        "guidance_response",
        "aware_but_scope_mismatch",
        "guidance_outcomes",
        outcomes.acted,
        outcomes,
      );
      addFact(
        candidates,
        "offering_fit",
        "scope_reduction",
        "guidance_outcomes",
        outcomes.acted,
        outcomes,
      );
    }
    if (outcomes.resolved >= 2 && outcomes.resolved >= outcomes.acted / 2) {
      addFact(
        candidates,
        "guidance_response",
        "restoration_responsive",
        "guidance_outcomes",
        outcomes.resolved,
        outcomes,
      );
    }
  }

  const flows = input.flowBehavior;
  if (flows && flows.flowCount > 0) {
    const completionRate = flows.eventsTotal > 0
      ? flows.eventsCompleted / flows.eventsTotal
      : 0;
    if (flows.editCount >= flows.flowCount) {
      addFact(
        candidates,
        "practice_trajectory",
        "self_revising_practice",
        "flow_behavior",
        flows.editCount,
        flows,
      );
    }
    if (completionRate >= 0.65) {
      addFact(
        candidates,
        "practice_trajectory",
        "flow_structure_works",
        "flow_behavior",
        flows.eventsCompleted,
        flows,
      );
    }
  }

  if (profileText.includes("djehuty") || profileText.includes("seshat")) {
    addFact(
      candidates,
      "register_affinity",
      "measure_record_language",
      "knowledge_graph",
      2,
      { graph_terms: "Djehuty/Seshat" },
    );
  }
  if (
    profileText.includes("hathor") || profileText.includes("renenutet") ||
    profileText.includes("ka")
  ) {
    addFact(
      candidates,
      "register_affinity",
      "embodied_care_language",
      "knowledge_graph",
      2,
      { graph_terms: "Hathor/Renenutet/Ka" },
    );
  }
  if (spiritualHits >= 2) {
    addFact(
      candidates,
      "register_affinity",
      "sacred_register",
      "evidence_or_graph",
      spiritualHits,
    );
  } else if (technicalHits >= 2 || academicHits >= 2) {
    addFact(
      candidates,
      "register_affinity",
      "practical_register",
      "evidence_keywords",
      Math.max(technicalHits, academicHits),
    );
  }

  const byKey = new Map<string, MaatUserProfileFact>();
  for (const candidate of candidates) {
    const fact = buildFact(candidate, nowIso, input.userId);
    const key = factKey(fact);
    const current = byKey.get(key);
    if (!current || fact.evidence_count > current.evidence_count) {
      byKey.set(key, fact);
    }
  }

  return [...byKey.values()].sort((a, b) =>
    b.evidence_count - a.evidence_count ||
    a.fact_type.localeCompare(b.fact_type)
  );
}

export function mergeMaatUserProfileFacts(
  stored: MaatUserProfileFact[],
  extracted: MaatUserProfileFact[],
): MaatUserProfileFact[] {
  const merged = new Map<string, MaatUserProfileFact>();
  for (const fact of stored) merged.set(factKey(fact), fact);
  for (const fact of extracted) {
    const key = factKey(fact);
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, fact);
      continue;
    }
    const evidenceCount = Math.max(
      prior.evidence_count,
      fact.evidence_count,
      prior.evidence_count + Math.min(fact.evidence_count, 3),
    );
    const confidence = confidenceFor(evidenceCount);
    merged.set(key, {
      ...prior,
      source: [...new Set([prior.source, fact.source].filter(Boolean))].join(
        ",",
      ),
      confidence,
      evidence_count: evidenceCount,
      first_seen: [prior.first_seen, fact.first_seen].filter(Boolean).sort()[0],
      last_seen: [prior.last_seen, fact.last_seen].filter(Boolean).sort().at(
        -1,
      ) ?? fact.last_seen,
      stability: stabilityFor(confidence, fact.counterevidence),
      counterevidence: fact.counterevidence ?? prior.counterevidence ?? null,
      metadata: { ...prior.metadata, ...fact.metadata },
    });
  }
  return [...merged.values()].sort((a, b) =>
    confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
    b.evidence_count - a.evidence_count
  );
}

function confidenceRank(value: MaatUserProfileFactConfidence) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

export async function fetchStoredMaatUserProfileFacts(
  client: { from: (table: string) => any } | null | undefined,
  userId: string,
  limit = 40,
): Promise<MaatUserProfileFact[]> {
  if (!client || !userId) return [];
  try {
    const { data, error } = await client
      .from("maat_user_profile_facts")
      .select(
        "user_id,fact_type,value,source,confidence,evidence_count,first_seen,last_seen,stability,counterevidence,metadata",
      )
      .eq("user_id", userId)
      .order("last_seen", { ascending: false })
      .limit(limit);
    if (error) {
      console.log(
        "maat_user_profile_facts fetch error:",
        error.message ?? error,
      );
      return [];
    }
    return ((data ?? []) as MaatProfileFactDbRow[])
      .map(normalizeMaatUserProfileFact)
      .filter((fact): fact is MaatUserProfileFact => !!fact);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("maat_user_profile_facts fetch threw:", message);
    return [];
  }
}

export async function upsertMaatUserProfileFacts(
  client: { from: (table: string) => any } | null | undefined,
  userId: string,
  facts: MaatUserProfileFact[],
) {
  if (!client || !userId || !facts.length) return;
  const rows = facts.map((fact) => ({
    user_id: userId,
    fact_type: fact.fact_type,
    value: fact.value,
    source: fact.source,
    confidence: fact.confidence,
    evidence_count: fact.evidence_count,
    first_seen: fact.first_seen,
    last_seen: fact.last_seen,
    stability: fact.stability,
    counterevidence: fact.counterevidence,
    metadata: {
      ...fact.metadata,
      version: MAAT_USER_PROFILE_FACTS_VERSION,
    },
  }));
  try {
    const { error } = await client
      .from("maat_user_profile_facts")
      .upsert(rows, { onConflict: "user_id,fact_type,value" });
    if (error) {
      console.log(
        "maat_user_profile_facts upsert error:",
        error.message ?? error,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("maat_user_profile_facts upsert threw:", message);
  }
}
