import type {
  MaatAxisCode,
  MaatDimensionSnapshot,
} from "../ai_generate_reflection/maat_decision.ts";
import type {
  MaatCaseKey,
  MaatOfferingKind,
} from "./maat_situation_interpreter.ts";
import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type { MaatUserProfileFact } from "./profile_fact_extractor.ts";
import type { ReflectionCalendarFrame } from "./reflection_calendar.ts";
import type { ReflectionUserLens } from "./reflection_profile_snapshot.ts";

export type MaatAlignmentLens =
  | "truth"
  | "witness"
  | "measure"
  | "order"
  | "life_preservation"
  | "restraint"
  | "self_mastery"
  | "reciprocity"
  | "care"
  | "justice"
  | "vulnerable_protection"
  | "offering_service"
  | "harmony"
  | "worthiness"
  | "becoming"
  | "continuity"
  | "repair_isfet"
  | "effective_speech";

export type MaatAlignmentSourceDomain =
  | "theology"
  | "ontology"
  | "anthropology"
  | "social_practice";

export type MaatAlignmentRelationDomain =
  | "self"
  | "others"
  | "nature"
  | "divine"
  | "future";

export type MaatAlignmentLensDefinition = {
  lens: MaatAlignmentLens;
  sourceDomain: MaatAlignmentSourceDomain;
  relationDomain: MaatAlignmentRelationDomain;
  ethicalQuestion: string;
  alignedExpression: string;
  isfetDistortion: string;
  repairDirection: string;
  reflectionMove: string;
  possibleOfferings: string[];
  bannedFlatteningTerms: string[];
};

export type MaatAlignmentLensSelection = {
  version: "maat_alignment_lens_v1";
  dominantMaatLens: MaatAlignmentLens;
  secondaryMaatLens: MaatAlignmentLens | null;
  candidateLenses: MaatAlignmentLens[];
  lensReason: string;
  ethicalQuestion: string;
  alignmentReading: string;
  underalignmentReading: string;
  repairDirection: string;
  reflectionMove: string;
  sourceDomain: MaatAlignmentSourceDomain;
  relationDomain: MaatAlignmentRelationDomain;
  bannedFlatteningTerms: string[];
};

export const MAAT_ALIGNMENT_LENS_DEFINITIONS: Record<
  MaatAlignmentLens,
  MaatAlignmentLensDefinition
> = {
  truth: {
    lens: "truth",
    sourceDomain: "theology",
    relationDomain: "self",
    ethicalQuestion:
      "Does the account tell the truth of what happened without exaggeration or concealment?",
    alignedExpression:
      "The user is seeking a record that can stand as true witness.",
    isfetDistortion:
      "The act and the account drift apart until the record cannot carry truth.",
    repairDirection:
      "Make the account match the act with one clear, proportionate mark.",
    reflectionMove:
      "translate the habit evidence into truth and accountability, not tracking advice",
    possibleOfferings: ["write", "clarify", "record", "name plainly"],
    bannedFlatteningTerms: ["tracking issue", "log better", "data entry"],
  },
  witness: {
    lens: "witness",
    sourceDomain: "theology",
    relationDomain: "future",
    ethicalQuestion:
      "Will this period leave a trustworthy witness for later judgment and guidance?",
    alignedExpression:
      "The user is trying to let lived experience become visible enough to guide the future.",
    isfetDistortion:
      "What was lived disappears from the account before it can teach anything.",
    repairDirection:
      "Give one lived detail a place in the record so it can be remembered rightly.",
    reflectionMove:
      "frame sparse record as missing witness rather than missing worth",
    possibleOfferings: ["write one detail", "preserve", "remember"],
    bannedFlatteningTerms: ["journal more", "add notes", "content capture"],
  },
  measure: {
    lens: "measure",
    sourceDomain: "ontology",
    relationDomain: "self",
    ethicalQuestion:
      "Is the obligation sized and placed so it can actually be kept?",
    alignedExpression:
      "The user is seeking proportion between intention, capacity, and act.",
    isfetDistortion:
      "The account carries more than the day can hold, or places care where it cannot be kept.",
    repairDirection:
      "Reduce, place, clarify, or release until the remaining act can be kept.",
    reflectionMove:
      "translate habit strain into right measure, not motivation failure",
    possibleOfferings: [
      "reduce",
      "place",
      "clarify",
      "release",
      "complete one",
    ],
    bannedFlatteningTerms: ["productivity", "habit hack", "try harder"],
  },
  order: {
    lens: "order",
    sourceDomain: "ontology",
    relationDomain: "self",
    ethicalQuestion:
      "Does each obligation have its rightful place in the whole account?",
    alignedExpression:
      "The user is trying to turn scattered intention into an ordered practice.",
    isfetDistortion:
      "Good intentions remain loose, competing, or improperly sequenced.",
    repairDirection:
      "Give one obligation a rightful sequence before adding more to the account.",
    reflectionMove:
      "read open loops as a question of right placement and sequence",
    possibleOfferings: ["sequence", "place", "finish", "prune"],
    bannedFlatteningTerms: ["task management", "checklist", "workflow tip"],
  },
  life_preservation: {
    lens: "life_preservation",
    sourceDomain: "anthropology",
    relationDomain: "self",
    ethicalQuestion:
      "Is life-supporting care becoming part of the living order rather than a named intention only?",
    alignedExpression:
      "The user shows care for the body's continuity and livability.",
    isfetDistortion:
      "The support is named but not yet settled into a form that preserves life reliably.",
    repairDirection:
      "Give body-support care a keepable place that protects life without inflating the burden.",
    reflectionMove:
      "interpret provision as care for life, not as nutrition optimization",
    possibleOfferings: ["protect", "anchor", "simplify", "prioritize"],
    bannedFlatteningTerms: [
      "nutrition optimization",
      "diet tracking",
      "wellness checklist",
    ],
  },
  restraint: {
    lens: "restraint",
    sourceDomain: "anthropology",
    relationDomain: "self",
    ethicalQuestion:
      "Where does force need to be reduced so the practice can remain rightful?",
    alignedExpression: "The user is learning to govern effort without excess.",
    isfetDistortion: "Intensity outruns measure and turns care into pressure.",
    repairDirection:
      "Lower force, narrow scope, and let right measure carry the act.",
    reflectionMove:
      "name overreach as a restraint question, not a character flaw",
    possibleOfferings: ["downshift", "reduce", "pause", "release"],
    bannedFlatteningTerms: ["discipline problem", "willpower", "grind"],
  },
  self_mastery: {
    lens: "self_mastery",
    sourceDomain: "anthropology",
    relationDomain: "self",
    ethicalQuestion:
      "Is the user governing appetite, ambition, and effort toward right measure?",
    alignedExpression:
      "The user is developing mastery through proportionate choice.",
    isfetDistortion:
      "Unruled ambition multiplies obligations beyond what can be held.",
    repairDirection:
      "Choose the measure that can be governed, then keep that measure.",
    reflectionMove: "frame repeated overcommitment as training in self-command",
    possibleOfferings: ["choose less", "govern scope", "commit one"],
    bannedFlatteningTerms: [
      "self-control hack",
      "motivation trick",
      "discipline hack",
    ],
  },
  reciprocity: {
    lens: "reciprocity",
    sourceDomain: "social_practice",
    relationDomain: "others",
    ethicalQuestion:
      "Is care moving in right relation, with giving and receiving kept in balance?",
    alignedExpression:
      "The user is trying to keep relation and obligation alive.",
    isfetDistortion:
      "Care flows outward while the account of return, self-care, or mutuality thins.",
    repairDirection:
      "Restore the relation by naming what must be returned, received, or kept for the self.",
    reflectionMove:
      "read care patterns through reciprocity rather than mere output",
    possibleOfferings: [
      "receive",
      "return",
      "separate accounts",
      "protect self-care",
    ],
    bannedFlatteningTerms: [
      "relationship task",
      "care chore",
      "people management",
    ],
  },
  care: {
    lens: "care",
    sourceDomain: "social_practice",
    relationDomain: "others",
    ethicalQuestion:
      "Is the care obligation held with warmth, clarity, and right boundary?",
    alignedExpression:
      "The user recognizes care as part of order, not a distraction from it.",
    isfetDistortion:
      "Care becomes diffuse, displaced, or unmeasured until it drains the keeper.",
    repairDirection:
      "Name whose care this is and what one act would keep it rightly.",
    reflectionMove: "translate care evidence into moral relation and boundary",
    possibleOfferings: ["tend", "bound", "protect", "separate"],
    bannedFlatteningTerms: ["support task", "errand", "care admin"],
  },
  justice: {
    lens: "justice",
    sourceDomain: "social_practice",
    relationDomain: "others",
    ethicalQuestion:
      "Is due measure being given where obligation, consequence, or fairness requires it?",
    alignedExpression:
      "The user is seeking right apportionment and fair response.",
    isfetDistortion:
      "Consequence and obligation are treated as if they carry equal weight when they do not.",
    repairDirection:
      "Sort by consequence and give first measure to what is actually due.",
    reflectionMove:
      "make the reflection about due measure, not equal completion",
    possibleOfferings: ["triage", "prioritize", "restore due measure"],
    bannedFlatteningTerms: ["priority list", "sort tasks", "rank items"],
  },
  vulnerable_protection: {
    lens: "vulnerable_protection",
    sourceDomain: "social_practice",
    relationDomain: "others",
    ethicalQuestion:
      "Is the vulnerable person, place, or need protected from being crowded out?",
    alignedExpression: "The user is carrying protection as a moral obligation.",
    isfetDistortion:
      "The vulnerable need is exposed by delay, overload, or unclear ownership.",
    repairDirection:
      "Protect the vulnerable thread first, then let lesser obligations wait.",
    reflectionMove: "distinguish protection from general care or productivity",
    possibleOfferings: ["protect", "triage", "clarify ownership"],
    bannedFlatteningTerms: ["urgent task", "dependency", "todo"],
  },
  offering_service: {
    lens: "offering_service",
    sourceDomain: "theology",
    relationDomain: "divine",
    ethicalQuestion:
      "What act places Ma'at back into the world as offering and service?",
    alignedExpression:
      "The user is trying to make practice serve something beyond private completion.",
    isfetDistortion:
      "The act becomes self-enclosed and loses its offering character.",
    repairDirection:
      "Choose one act that gives order back to the world, not just to the list.",
    reflectionMove:
      "read completion as offering Ma'at rather than personal productivity",
    possibleOfferings: ["offer", "serve", "complete for order"],
    bannedFlatteningTerms: [
      "personal goal",
      "self-improvement",
      "productivity",
    ],
  },
  harmony: {
    lens: "harmony",
    sourceDomain: "ontology",
    relationDomain: "nature",
    ethicalQuestion:
      "Does this practice keep the user in right relation with season, body, others, and place?",
    alignedExpression:
      "The user is trying to move with the larger pattern rather than against it.",
    isfetDistortion:
      "A practice fights the season, body, timing, or relation it depends on.",
    repairDirection: "Move the practice where the larger order can support it.",
    reflectionMove:
      "translate friction into relation with the whole, not private failure",
    possibleOfferings: ["reschedule", "align with season", "move with rhythm"],
    bannedFlatteningTerms: ["schedule tweak", "timing hack", "routine fix"],
  },
  worthiness: {
    lens: "worthiness",
    sourceDomain: "social_practice",
    relationDomain: "future",
    ethicalQuestion:
      "What kind of character is being formed by the way this obligation is held?",
    alignedExpression:
      "The user is becoming more trustworthy through kept measure.",
    isfetDistortion:
      "The account asks for a claim of worth without the corresponding practice to stand on.",
    repairDirection:
      "Let one keepable act become evidence of character rather than intention alone.",
    reflectionMove:
      "connect practice to becoming worthy without shaming the user",
    possibleOfferings: ["keep one act", "clarify", "stand well"],
    bannedFlatteningTerms: ["performance", "achievement", "success metric"],
  },
  becoming: {
    lens: "becoming",
    sourceDomain: "anthropology",
    relationDomain: "future",
    ethicalQuestion:
      "What stage of becoming is this practice asking the user to enter next?",
    alignedExpression:
      "The user is in process, learning through repeated moral formation.",
    isfetDistortion:
      "The account treats an unfolding practice as if it should already be complete.",
    repairDirection:
      "Name the next stage clearly and let that be enough for this decan.",
    reflectionMove:
      "frame unfinished practice as development when evidence supports it",
    possibleOfferings: ["next stage", "refine", "complete one piece"],
    bannedFlatteningTerms: [
      "unfinished task",
      "progress tracking",
      "milestone",
    ],
  },
  continuity: {
    lens: "continuity",
    sourceDomain: "ontology",
    relationDomain: "future",
    ethicalQuestion:
      "What must be carried forward so the next decan has a truthful foundation?",
    alignedExpression: "The user is preserving a thread across time.",
    isfetDistortion:
      "A thread appears and disappears without enough continuity to become guidance.",
    repairDirection:
      "Carry one true mark forward so the next account can stand on it.",
    reflectionMove:
      "read repetition through continuity rather than recurrence alone",
    possibleOfferings: ["carry forward", "preserve", "continue"],
    bannedFlatteningTerms: ["streak", "consistency hack", "habit chain"],
  },
  repair_isfet: {
    lens: "repair_isfet",
    sourceDomain: "theology",
    relationDomain: "self",
    ethicalQuestion:
      "Where did disorder appear, and what repair places Ma'at there instead?",
    alignedExpression:
      "The user is able to answer disorder with restoration rather than drama.",
    isfetDistortion:
      "Disorder remains unnamed or grows through avoidance, excess, or fragmentation.",
    repairDirection:
      "Name the specific disorder and answer it with one proportionate restoration.",
    reflectionMove:
      "make repair concrete without inflating ordinary drift into moral crisis",
    possibleOfferings: ["repair", "restore", "release", "complete one"],
    bannedFlatteningTerms: ["fix yourself", "failure", "problem user"],
  },
  effective_speech: {
    lens: "effective_speech",
    sourceDomain: "theology",
    relationDomain: "others",
    ethicalQuestion:
      "Does speech create order by matching word, intention, and act?",
    alignedExpression:
      "The user is being asked to let the word become effective and trustworthy.",
    isfetDistortion:
      "Words, promises, or questions remain unjoined to accountable action.",
    repairDirection:
      "Give one word a corresponding act, or one act a truthful word.",
    reflectionMove:
      "interpret speech as effective moral action, not expression alone",
    possibleOfferings: [
      "speak clearly",
      "keep promise",
      "write one truthful sentence",
    ],
    bannedFlatteningTerms: ["communication tip", "message follow-up", "note"],
  },
};

type SelectMaatAlignmentLensParams = {
  calendarFrame?: ReflectionCalendarFrame | null;
  maatSnapshot?: MaatDimensionSnapshot | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  profileFacts?: MaatUserProfileFact[] | null;
  dominantUserLens?: ReflectionUserLens | null;
  caseKey?: MaatCaseKey | null;
  selectedOffering?: MaatOfferingKind | null;
};

function hasFact(
  facts: MaatUserProfileFact[],
  type: string,
  values: string[],
) {
  return facts.some((fact) =>
    fact.fact_type === type && values.includes(fact.value) &&
    fact.stability !== "contradicted"
  );
}

function add(
  scores: Map<MaatAlignmentLens, number>,
  reasons: Map<MaatAlignmentLens, string[]>,
  lens: MaatAlignmentLens,
  weight: number,
  reason: string,
) {
  scores.set(lens, (scores.get(lens) ?? 0) + weight);
  const list = reasons.get(lens) ?? [];
  list.push(reason);
  reasons.set(lens, list);
}

function caseSignals(
  scores: Map<MaatAlignmentLens, number>,
  reasons: Map<MaatAlignmentLens, string[]>,
  caseKey: MaatCaseKey | null | undefined,
) {
  if (!caseKey) return;
  if (caseKey.startsWith("provision.")) {
    add(
      scores,
      reasons,
      "life_preservation",
      2,
      `${caseKey} concerns life-supporting care`,
    );
    add(
      scores,
      reasons,
      "measure",
      3,
      `${caseKey} asks whether support is keepable`,
    );
    if (
      caseKey === "provision.repeated_open_checks" ||
      caseKey === "provision.completed_not_logged"
    ) {
      add(
        scores,
        reasons,
        "measure",
        2,
        `${caseKey} turns care into a question of keepable proportion`,
      );
      add(
        scores,
        reasons,
        "truth",
        3,
        `${caseKey} strains the match between act and account`,
      );
      add(scores, reasons, "witness", 2, `${caseKey} needs a trustworthy mark`);
    }
    if (
      caseKey === "provision.overloaded_schedule" ||
      caseKey === "provision.scattered_sources" ||
      caseKey === "provision.stale_growing_list" ||
      caseKey === "provision.consolidation_candidate"
    ) {
      add(scores, reasons, "order", 3, `${caseKey} asks for right placement`);
      add(scores, reasons, "restraint", 2, `${caseKey} asks for less force`);
    }
    if (caseKey === "provision.clinical_mixed") {
      add(
        scores,
        reasons,
        "justice",
        3,
        `${caseKey} requires due measure by consequence`,
      );
    }
  }
  if (caseKey.startsWith("visible_work.")) {
    add(
      scores,
      reasons,
      "order",
      4,
      `${caseKey} concerns open work and right sequence`,
    );
    add(
      scores,
      reasons,
      "measure",
      3,
      `${caseKey} asks for proportionate scope`,
    );
    add(
      scores,
      reasons,
      "repair_isfet",
      2,
      `${caseKey} asks disorder to be answered directly`,
    );
  }
  if (caseKey.startsWith("truthful_record.")) {
    add(scores, reasons, "truth", 4, `${caseKey} concerns truthful record`);
    add(scores, reasons, "witness", 4, `${caseKey} concerns witness`);
    add(
      scores,
      reasons,
      "continuity",
      2,
      `${caseKey} affects what can be carried forward`,
    );
  }
  if (caseKey.startsWith("rhythm.")) {
    add(
      scores,
      reasons,
      "continuity",
      3,
      `${caseKey} concerns return across time`,
    );
    add(scores, reasons, "order", 2, `${caseKey} asks for a stable place`);
    add(
      scores,
      reasons,
      "harmony",
      2,
      `${caseKey} asks the practice to fit its larger timing`,
    );
  }
  if (caseKey.startsWith("restraint.") || caseKey.startsWith("release.")) {
    add(scores, reasons, "measure", 4, `${caseKey} concerns proportion`);
    add(scores, reasons, "restraint", 4, `${caseKey} concerns force and scope`);
    add(
      scores,
      reasons,
      "self_mastery",
      3,
      `${caseKey} concerns governed effort`,
    );
  }
  if (caseKey.startsWith("care.")) {
    add(scores, reasons, "care", 4, `${caseKey} concerns care obligation`);
    add(
      scores,
      reasons,
      "reciprocity",
      3,
      `${caseKey} concerns right relation`,
    );
    add(
      scores,
      reasons,
      "life_preservation",
      2,
      `${caseKey} concerns support of life`,
    );
  }
  if (caseKey.startsWith("speech.")) {
    add(scores, reasons, "truth", 3, `${caseKey} concerns word and act`);
    add(
      scores,
      reasons,
      "effective_speech",
      4,
      `${caseKey} concerns effective speech`,
    );
    add(
      scores,
      reasons,
      "worthiness",
      2,
      `${caseKey} concerns trustworthy character`,
    );
  }
  if (caseKey.startsWith("study.")) {
    add(
      scores,
      reasons,
      "becoming",
      3,
      `${caseKey} concerns learning as formation`,
    );
    add(scores, reasons, "continuity", 3, `${caseKey} needs retention`);
    add(scores, reasons, "truth", 2, `${caseKey} needs usable witness`);
  }
  if (caseKey.startsWith("craft.")) {
    add(
      scores,
      reasons,
      "becoming",
      3,
      `${caseKey} concerns unfinished formation`,
    );
    add(scores, reasons, "order", 2, `${caseKey} needs a finishable shape`);
    add(
      scores,
      reasons,
      "measure",
      2,
      `${caseKey} asks for right-sized refinement`,
    );
  }
}

function axisSignals(
  scores: Map<MaatAlignmentLens, number>,
  reasons: Map<MaatAlignmentLens, string[]>,
  axis: MaatAxisCode | null | undefined,
  reason: string,
) {
  const axisMap: Record<MaatAxisCode, MaatAlignmentLens[]> = {
    T: ["truth", "witness", "effective_speech"],
    M: ["measure", "order"],
    H: ["life_preservation", "harmony"],
    V: ["vulnerable_protection", "care"],
    J: ["justice", "measure"],
    S: ["life_preservation", "care"],
    E: ["harmony", "continuity"],
    R: ["restraint", "self_mastery", "measure"],
    C: ["reciprocity", "harmony", "worthiness"],
  };
  if (!axis) return;
  for (const lens of axisMap[axis] ?? []) {
    add(scores, reasons, lens, 2, reason);
  }
}

function profileSignals(
  scores: Map<MaatAlignmentLens, number>,
  reasons: Map<MaatAlignmentLens, string[]>,
  facts: MaatUserProfileFact[],
  userLens?: ReflectionUserLens | null,
) {
  if (hasFact(facts, "record_style", ["surface_logger", "detailed_witness"])) {
    add(
      scores,
      reasons,
      "truth",
      3,
      "profile record style makes truth the moral question",
    );
    add(
      scores,
      reasons,
      "witness",
      3,
      "profile record style makes witness the moral question",
    );
  }
  if (
    hasFact(facts, "commitment_pattern", [
      "accumulator",
      "many_open_loops",
      "recurring_obligation_unkept",
    ])
  ) {
    add(
      scores,
      reasons,
      "measure",
      3,
      "profile commitment pattern asks for proportion",
    );
    add(
      scores,
      reasons,
      "order",
      2,
      "profile commitment pattern asks for right placement",
    );
    add(
      scores,
      reasons,
      "restraint",
      2,
      "profile commitment pattern asks for restraint",
    );
  }
  if (
    hasFact(facts, "care_direction", [
      "other_directed_care_visible",
      "mixed_self_and_other_care",
      "self_provision_visible",
    ])
  ) {
    add(
      scores,
      reasons,
      "care",
      3,
      "profile care direction makes care morally central",
    );
    add(
      scores,
      reasons,
      "reciprocity",
      2,
      "profile care direction asks for right relation",
    );
  }
  if (
    hasFact(facts, "capacity_state", [
      "external_load_visible",
      "transition_load",
    ])
  ) {
    add(
      scores,
      reasons,
      "restraint",
      2,
      "profile capacity state asks for less force",
    );
    add(
      scores,
      reasons,
      "harmony",
      2,
      "profile capacity state asks practice to fit context",
    );
  }
  if (hasFact(facts, "work_domain", ["technical_builder"])) {
    add(scores, reasons, "order", 2, "technical work asks for sequence");
    add(
      scores,
      reasons,
      "measure",
      2,
      "technical work asks for finishable scope",
    );
  }
  if (hasFact(facts, "work_domain", ["creative_worker"])) {
    add(scores, reasons, "becoming", 2, "creative work asks for formation");
    add(scores, reasons, "order", 2, "creative work asks for one clean shape");
  }
  if (hasFact(facts, "work_domain", ["academic_or_student"])) {
    add(scores, reasons, "becoming", 2, "study asks for formation");
    add(
      scores,
      reasons,
      "continuity",
      2,
      "study asks knowledge to be retained",
    );
  }
  if (userLens === "practice_recovery") {
    add(
      scores,
      reasons,
      "repair_isfet",
      2,
      "profile recovery asks how order is restored",
    );
    add(
      scores,
      reasons,
      "continuity",
      2,
      "profile recovery asks what should endure",
    );
  }
}

function threadSignals(
  scores: Map<MaatAlignmentLens, number>,
  reasons: Map<MaatAlignmentLens, string[]>,
  threads?: MaatNormalizedObligationThreads | null,
) {
  const nutrition = threads?.nutrition;
  const todo = threads?.todo;
  if (nutrition?.unique_item_count === 1 && nutrition.same_item_repeated) {
    add(
      scores,
      reasons,
      "life_preservation",
      2,
      "one recurring body-care promise concerns embodied care",
    );
    add(
      scores,
      reasons,
      "measure",
      4,
      "one recurring body-care promise needs a keepable measure",
    );
    add(
      scores,
      reasons,
      "truth",
      2,
      "one recurring body-care promise asks the account to match the act",
    );
  } else if ((nutrition?.unique_item_count ?? 0) >= 3) {
    add(
      scores,
      reasons,
      "measure",
      3,
      "several body-care obligations ask for proportion",
    );
    add(
      scores,
      reasons,
      "order",
      3,
      "several body-care obligations ask for right placement",
    );
  }
  if ((todo?.unique_item_count ?? 0) >= 3) {
    add(scores, reasons, "order", 3, "open work threads ask for order");
    add(
      scores,
      reasons,
      "repair_isfet",
      2,
      "open work threads ask for repair of fragmentation",
    );
  }
}

function calendarSignals(
  scores: Map<MaatAlignmentLens, number>,
  reasons: Map<MaatAlignmentLens, string[]>,
  frame?: ReflectionCalendarFrame | null,
) {
  const text = [
    frame?.decanTheme,
    frame?.monthMeaning,
    frame?.arcSummary,
  ].join(" ").toLowerCase();
  if (/\bstab|restore|ground|house|sanctuary|order/.test(text)) {
    add(scores, reasons, "order", 2, "calendar arc asks for restored order");
    add(
      scores,
      reasons,
      "continuity",
      2,
      "calendar arc asks for stable return",
    );
  }
  if (/\btruth|record|witness|mark/.test(text)) {
    add(scores, reasons, "truth", 2, "calendar arc asks for truthful witness");
  }
  if (/\bcare|body|life|provision/.test(text)) {
    add(
      scores,
      reasons,
      "life_preservation",
      2,
      "calendar arc asks for embodied care",
    );
  }
}

function offeringSignals(
  scores: Map<MaatAlignmentLens, number>,
  reasons: Map<MaatAlignmentLens, string[]>,
  offering?: MaatOfferingKind | null,
) {
  if (!offering) return;
  if (
    [
      "reduce_obligations",
      "reduce_and_complete_one",
      "prune",
      "release_unrealistic_target",
      "release_without_guilt",
    ].includes(offering)
  ) {
    add(scores, reasons, "measure", 2, `${offering} asks for proportion`);
    add(scores, reasons, "restraint", 2, `${offering} asks for restraint`);
  }
  if (
    ["record_what_was_done", "write_record", "merge_records"].includes(offering)
  ) {
    add(
      scores,
      reasons,
      "truth",
      2,
      `${offering} asks the account to match the act`,
    );
    add(scores, reasons, "witness", 2, `${offering} asks for witness`);
  }
  if (
    ["anchor_one_thing", "habit_stack", "reschedule", "protect_rhythm"]
      .includes(offering)
  ) {
    add(scores, reasons, "order", 2, `${offering} asks for right placement`);
    add(
      scores,
      reasons,
      "harmony",
      2,
      `${offering} asks practice to fit its context`,
    );
  }
}

export function selectMaatAlignmentLens(
  params: SelectMaatAlignmentLensParams,
): MaatAlignmentLensSelection {
  const scores = new Map<MaatAlignmentLens, number>();
  const reasons = new Map<MaatAlignmentLens, string[]>();
  const facts = (params.profileFacts ?? []).filter((fact) =>
    fact.stability !== "contradicted"
  );

  caseSignals(scores, reasons, params.caseKey);
  offeringSignals(scores, reasons, params.selectedOffering);
  threadSignals(scores, reasons, params.normalizedObligationThreads);
  profileSignals(scores, reasons, facts, params.dominantUserLens ?? null);
  calendarSignals(scores, reasons, params.calendarFrame);
  axisSignals(
    scores,
    reasons,
    params.maatSnapshot?.leadAxis,
    "Ma'at lead axis adds moral prior",
  );
  for (const axis of params.maatSnapshot?.correctionAxes ?? []) {
    axisSignals(
      scores,
      reasons,
      axis,
      "Ma'at correction axis adds moral prior",
    );
  }

  if (scores.size === 0) {
    add(
      scores,
      reasons,
      "measure",
      1,
      "fallback moral lens uses right measure",
    );
    add(
      scores,
      reasons,
      "truth",
      1,
      "fallback moral lens asks for a truthful account",
    );
  }

  const ranked = [...scores.entries()].sort((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0])
  ).map(([lens]) => lens);
  const dominant = ranked[0] ?? "measure";
  const secondary = ranked.find((lens) => lens !== dominant) ?? null;
  const definition = MAAT_ALIGNMENT_LENS_DEFINITIONS[dominant];
  const dominantReasons = reasons.get(dominant) ?? [];
  const secondaryDefinition = secondary
    ? MAAT_ALIGNMENT_LENS_DEFINITIONS[secondary]
    : null;

  return {
    version: "maat_alignment_lens_v1",
    dominantMaatLens: dominant,
    secondaryMaatLens: secondary,
    candidateLenses: ranked.slice(0, 5),
    lensReason: dominantReasons[0] ??
      `${dominant} is the clearest Ma'at dimension in the current account`,
    ethicalQuestion: definition.ethicalQuestion,
    alignmentReading: definition.alignedExpression,
    underalignmentReading: definition.isfetDistortion,
    repairDirection: definition.repairDirection,
    reflectionMove: definition.reflectionMove,
    sourceDomain: definition.sourceDomain,
    relationDomain: definition.relationDomain,
    bannedFlatteningTerms: [
      ...definition.bannedFlatteningTerms,
      ...(secondaryDefinition?.bannedFlatteningTerms ?? []),
    ],
  };
}
