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
    "Binding instruction: when selectedSeeds.reflection exists, explicitly honor reflection_seed, reflection_tier, and authored_central_tension. Other evidence may contextualize them, but must not replace them.",
    "Reflection tier rule: if reflection_tier is partial, name interruption or incompletion without motive; if skipped_explicit, name set-aside/restorative absence without shame; if unobserved, keep the language neutral and do not imply avoidance.",
    "Reflection/action boundary: do not convert this reflection into an alignment instruction. If reflection_constraints says imperatives_allowed=false, do not end with a direct command or concrete task imperative.",
    "Preserve the selected tier meaning; do not invent motive for partial, do not shame skipped, and keep unobserved as absence of signal.",
  ].filter(Boolean).join("\n");
}

export function maatFlowReflectionContractInstruction(
  pattern: MaatFlowDecanPatternSynthesis,
) {
  const reflectionTier = pattern.interpretiveEmphasis.reflectionTier;
  if (reflectionTier === "partial") {
    return "include a reflection sentence that names interruption or incompletion in The Weighing: the sitting or measure was entered/approached but was not completed or not fully placed; do not explain why.";
  }
  if (reflectionTier === "skipped_explicit") {
    return "include a reflection sentence that names the sitting as set aside/restorative absence; do not shame the skip or dismiss it.";
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

function startsWithImperative(text: string) {
  const sentence = lowerText(text).replace(/^["'“”‘’\s]+/, "");
  return /^(complete|return|try|do|make|name|place|choose|let|keep|bring|give|set|take|hold|offer|write|ask|carry|turn|notice|remember|restore)\b/
    .test(sentence);
}

function namesPartialInterruption(text: string) {
  const lower = lowerText(text);
  const hasWeighingSurface =
    /\b(sitting|measure|weighing|scale|placed|placement)\b/.test(lower);
  const hasPartialMeaning =
    /\b(not completed|incomplete|interrupted|interruption|not fully|not all|not placed|not yet placed|approached but|entered but)\b/
      .test(lower);
  return hasWeighingSurface && hasPartialMeaning;
}

function namesSkippedSetAside(text: string) {
  const lower = lowerText(text);
  return /\b(sitting|measure|weighing|scale)\b/.test(lower) &&
    /\b(set aside|not opened|restorative absence|left unentered|available and set aside)\b/
      .test(lower);
}

function keepsUnobservedNeutral(text: string) {
  const lower = lowerText(text);
  return !/\b(avoid|avoided|avoidance|dishonest|refused|refusal|hid|hiding)\b/
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

  if (
    reflectionConstraints.imperativesAllowed === false &&
    startsWithImperative(lastSentence(text))
  ) {
    reasons.push("imperative_closing_forbidden");
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
    "Revise the reflection so this contract is visibly honored before broader decan/profile interpretation.",
    "Do not add motive, shame, avoidance, dishonesty, or performance grading.",
    pattern.selectedSeeds.reflection.constraints.imperativesAllowed === false
      ? "Do not end with a direct command, task, or imperative. Use a reflective question or non-commanding closing if the earlier judgment requested a charge."
      : "",
  ].filter(Boolean).join("\n");
}
