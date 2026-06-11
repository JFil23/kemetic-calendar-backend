import type { MaatFlowDecanPatternSynthesis } from "./maat_flow_response_spectrum.ts";

export type MaatFlowReflectionBindingCheck = {
  ok: boolean;
  reasons: string[];
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function lowerText(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function uniqueTexts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = normalizeText(value ?? null);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function maatFlowSelectedDoNotSay(
  pattern: MaatFlowDecanPatternSynthesis,
) {
  return uniqueTexts([
    ...(pattern.selectedSeeds.reflection?.doNotSay ?? []),
    ...(pattern.selectedSeeds.orientation?.doNotSay ?? []),
    ...(pattern.selectedSeeds.alignment?.doNotSay ?? []),
  ]);
}

export function maatFlowPatternPromptBlock(
  pattern: MaatFlowDecanPatternSynthesis,
) {
  if (!pattern.flowSignals.length) return "";
  const reflectionSeed = pattern.selectedSeeds.reflection;
  const orientationSeed = pattern.selectedSeeds.orientation;
  const alignmentSeed = pattern.selectedSeeds.alignment;
  const reflectionConstraints = reflectionSeed?.constraints;

  return [
    "MAAT_FLOW_DECAN_PATTERN (hidden authored synthesis input)",
    `confidence: ${pattern.confidence}`,
    pattern.fallbackReason ? `fallback_reason: ${pattern.fallbackReason}` : "",
    `dominant_tier: ${pattern.dominantTier ?? "none"}`,
    `last_explicit_tier: ${
      pattern.interpretiveEmphasis.lastExplicitTier ?? "none"
    }`,
    `reflection_tier: ${pattern.interpretiveEmphasis.reflectionTier ?? "none"}`,
    `orientation_tier: ${
      pattern.interpretiveEmphasis.orientationTier ?? "none"
    }`,
    `alignment_tier: ${pattern.interpretiveEmphasis.alignmentTier ?? "none"}`,
    pattern.centralTension
      ? `authored_central_tension: ${pattern.centralTension}`
      : "",
    reflectionSeed ? `reflection_seed: ${reflectionSeed.seed}` : "",
    reflectionSeed?.meaning
      ? `reflection_meaning: ${reflectionSeed.meaning}`
      : "",
    reflectionConstraints
      ? `reflection_constraints: max_sentences=${reflectionConstraints.maxSentences}; imperatives_allowed=${reflectionConstraints.imperativesAllowed}; action_required=${reflectionConstraints.actionRequired}; subject_rule=${reflectionConstraints.subjectRule}; tense_rule=${reflectionConstraints.tenseRule}`
      : "",
    `required_reflection_contract: ${
      maatFlowReflectionContractInstruction(pattern)
    }`,
    "conflict_priority: if this block conflicts with REFLECTION_JUDGMENT, REFLECTION_THESIS_GATE, calendar frame, profile context, or planner evidence, preserve this block's tier meaning and reflection/action boundary.",
    "required_surface_order: honor the selected Ma'at flow reflection signal before broader decan care, maintenance, calendar, or profile interpretation.",
    orientationSeed ? `orientation_seed: ${orientationSeed.seed}` : "",
    alignmentSeed ? `alignment_seed: ${alignmentSeed.seed}` : "",
    `do_not_say: ${maatFlowSelectedDoNotSay(pattern).join(" | ")}`,
    "Binding instruction: when selectedSeeds.reflection exists, the first reflection movement must visibly honor reflection_seed, reflection_tier, required_reflection_contract, and authored_central_tension before broader decan, care, maintenance, calendar, or profile interpretation. Other evidence may contextualize them, but must not replace them.",
    "Reflection tier rule: if reflection_tier is partial, name that the account was opened but not completed and not all of it was named, without motive; if skipped_explicit, name that the sitting was set aside and still needs a plain account, without shame; if unobserved, keep the language neutral and do not imply avoidance.",
    "Reflection/action boundary: do not convert this reflection into an alignment instruction. If reflection_constraints says imperatives_allowed=false, the output must not contain an imperative sentence anywhere, including the closing.",
    "Preserve the selected tier meaning; do not invent motive for partial, do not shame skipped, and keep unobserved as absence of signal.",
  ].filter(Boolean).join("\n");
}

export function maatFlowReflectionContractInstruction(
  pattern: MaatFlowDecanPatternSynthesis,
) {
  const reflectionTier = pattern.interpretiveEmphasis.reflectionTier;
  if (reflectionTier === "partial") {
    return "include a reflection sentence that names interruption or incompletion in The Weighing: the account was opened but not completed, and not all of it was named; do not explain why.";
  }
  if (reflectionTier === "skipped_explicit") {
    return "include a reflection sentence that names the sitting as set aside and names that what was set aside still needs a plain account; do not shame the skip or dismiss it.";
  }
  if (reflectionTier === "unobserved") {
    return "keep the Weighing signal as neutral absence of signal; do not imply avoidance, refusal, or dishonesty.";
  }
  if (reflectionTier === "observed") {
    return "affirm that the sitting or measure was met without grading performance or saying Ma'at is pleased.";
  }
  return "do not force an interpretation beyond the authored selected reflection seed.";
}

function lastSentence(text: string) {
  const normalized = normalizeText(text);
  const matches = normalized.match(/[^.!?]+[.!?]*/g) ?? [];
  return normalizeText(matches.at(-1) ?? normalized);
}

function sentences(text: string) {
  const normalized = normalizeText(text);
  return (normalized.match(/[^.!?]+[.!?]*/g) ?? [normalized]).map((sentence) =>
    normalizeText(sentence)
  ).filter(Boolean);
}

function startsWithImperative(text: string) {
  const sentence = lowerText(text).replace(/^["'“”‘’\s]+/, "");
  return /^(begin|bring|carry|choose|complete|do|give|hold|keep|let|make|name|notice|offer|open|place|remember|restore|return|set|sit|take|try|turn|write)\b/
    .test(sentence);
}

function imperativeSentences(text: string) {
  return sentences(text).filter((sentence) => startsWithImperative(sentence));
}

function namesPartialInterruption(text: string) {
  const lower = lowerText(text);
  const hasWeighingSurface =
    /\b(account|full account|sitting|measure|weighing|scale|placed|placement|opened|approached|entered)\b/
      .test(lower);
  const hasPartialMeaning =
    /\b(entered but not completed|approached but|opened but not|not completed|incomplete|interrupted|interruption|not fully|not all|not placed|not yet placed|full account was not placed|not all of it reached)\b/
      .test(lower);
  return hasWeighingSurface && hasPartialMeaning;
}

function namesSkippedSetAside(text: string) {
  const lower = lowerText(text);
  const hasSetAsideMeaning =
    /\b(set aside|set-aside|was available|sitting was available|available and set aside|restorative absence|left unentered|set down unopened)\b/
      .test(lower);
  const hasNotOpenedMeaning =
    /\b(account was not opened|without the account being opened|not opened|was not opened|measure was not opened|measure was not entered|not entered|was not entered|sitting was not entered|scale was not approached|nothing was opened|still needs a plain account|needs a plain account)\b/
      .test(lower);
  return hasSetAsideMeaning && hasNotOpenedMeaning;
}

function keepsUnobservedNeutral(text: string) {
  const lower = lowerText(text);
  return !/\b(avoid|avoided|avoidance|dishonest|refused|refusal|hid|hiding)\b/
    .test(lower);
}

function diagnosesPartialMotive(text: string) {
  const lower = lowerText(text);
  return /\b(because you|you avoided|you were afraid|you were not ready|you weren't ready|you resisted|you refused|you held back|being held back|didn't want to|did not want to)\b/
    .test(lower);
}

export function validateMaatFlowReflectionTextBinding(
  text: string,
  pattern: MaatFlowDecanPatternSynthesis,
): MaatFlowReflectionBindingCheck {
  if (!pattern.flowSignals.length || !pattern.selectedSeeds.reflection) {
    return { ok: true, reasons: [] };
  }

  const reasons: string[] = [];
  const reflectionTier = pattern.interpretiveEmphasis.reflectionTier;
  const reflectionConstraints = pattern.selectedSeeds.reflection.constraints;
  if (reflectionTier === "partial" && !namesPartialInterruption(text)) {
    reasons.push("missing_weighing_partial_interruption");
  } else if (
    reflectionTier === "skipped_explicit" && !namesSkippedSetAside(text)
  ) {
    reasons.push("missing_weighing_skipped_set_aside");
  } else if (reflectionTier === "unobserved" && !keepsUnobservedNeutral(text)) {
    reasons.push("unobserved_not_neutral");
  }
  if (reflectionTier === "partial" && diagnosesPartialMotive(text)) {
    reasons.push("partial_motive_diagnosis");
  }

  if (
    reflectionConstraints.imperativesAllowed === false
  ) {
    const forbiddenImperatives = imperativeSentences(text);
    if (forbiddenImperatives.length) {
      reasons.push("imperative_sentence_forbidden");
    }
    if (startsWithImperative(lastSentence(text))) {
      reasons.push("imperative_closing_forbidden");
    }
  }

  const lower = lowerText(text);
  for (const phrase of maatFlowSelectedDoNotSay(pattern)) {
    const banned = lowerText(phrase);
    if (!banned || banned.startsWith("anything ")) continue;
    if (lower.includes(banned)) {
      reasons.push(`banned_phrase:${phrase}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export function maatFlowReflectionBindingRepairPrompt(
  pattern: MaatFlowDecanPatternSynthesis,
  reasons: string[],
) {
  if (!pattern.flowSignals.length || !pattern.selectedSeeds.reflection) {
    return "";
  }
  return [
    "MAAT_FLOW_REFLECTION_BINDING_REPAIR",
    `failed_reasons: ${reasons.join(", ")}`,
    `reflection_tier: ${pattern.interpretiveEmphasis.reflectionTier ?? "none"}`,
    pattern.centralTension
      ? `authored_central_tension: ${pattern.centralTension}`
      : "",
    `required_reflection_contract: ${
      maatFlowReflectionContractInstruction(pattern)
    }`,
    `reflection_seed: ${pattern.selectedSeeds.reflection.seed}`,
    "Revise the reflection so this contract is visibly honored in the first movement before broader decan/profile/care interpretation.",
    "Do not add motive, shame, avoidance, dishonesty, or performance grading.",
    pattern.selectedSeeds.reflection.constraints.imperativesAllowed === false
      ? "Do not include any direct command, task, or imperative sentence anywhere. Use a reflective question or non-commanding closing if the earlier judgment requested a charge."
      : "",
  ].filter(Boolean).join("\n");
}
