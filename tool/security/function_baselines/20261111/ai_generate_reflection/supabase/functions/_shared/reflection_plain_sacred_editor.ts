import type { ReflectionMoralPortrait } from "./reflection_moral_portrait.ts";
import type { ReflectionJudgment } from "./reflection_judgment.ts";
import type { ReflectionThesisGate } from "./reflection_thesis_gate.ts";
import type { ReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";
import type { ReflectionCalendarFrame } from "./reflection_calendar.ts";

export type ReflectionPlainSacredEdit = {
  version: "reflection_plain_sacred_editor_v1";
  source: "anthropic" | "deterministic";
  editedReflectionText: string;
  preservedMeaningSummary: string;
  removedAbstractions: string[];
  finalAction: string;
  editorWarnings: string[];
};

export type ReflectionPlainSacredEditorInput = {
  renderedReflection: string;
  moralPortrait?: ReflectionMoralPortrait | null;
  judgment?: ReflectionJudgment | null;
  thesisGate?: ReflectionThesisGate | null;
  profileSnapshot?: ReflectionProfileSnapshot | null;
  calendarFrame?: ReflectionCalendarFrame | null;
  targetWordRange?: string | null;
};

const STACKED_ABSTRACTIONS = [
  "sacred weight",
  "trustworthy witness",
  "outer action",
  "inner knowing",
  "integration into the order",
  "confirmed place",
  "embodied order",
  "written witness",
  "act and account",
  "life accomplished",
];

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function cleanParagraphText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function sentence(value: string) {
  const text = clean(value).replace(/[.!?]+$/g, "");
  return text ? `${text}.` : "";
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? clean(item) : "").filter(
      Boolean,
    )
    : [];
}

export function parseReflectionPlainSacredEdit(
  raw: string,
): ReflectionPlainSacredEdit | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const required = [
    "editedReflectionText",
    "preservedMeaningSummary",
    "finalAction",
  ];
  if (
    required.some((key) =>
      typeof parsed[key] !== "string" ||
      clean(parsed[key] as string).length === 0
    )
  ) {
    return null;
  }
  return {
    version: "reflection_plain_sacred_editor_v1",
    source: "anthropic",
    editedReflectionText: cleanParagraphText(
      parsed.editedReflectionText as string,
    ),
    preservedMeaningSummary: clean(parsed.preservedMeaningSummary as string),
    removedAbstractions: stringArray(parsed.removedAbstractions),
    finalAction: clean(parsed.finalAction as string),
    editorWarnings: stringArray(parsed.editorWarnings),
  };
}

function decanOpening(input: ReflectionPlainSacredEditorInput) {
  const name = clean(input.calendarFrame?.ceremonialDecanName) ||
    "This decan";
  const theme = clean(input.calendarFrame?.decanTheme) ||
    clean(input.calendarFrame?.arcSummary) ||
    "return";
  if (/hathor/i.test(name) || /sꜣḥ|s3h/i.test(name)) {
    return `${name} calls you back to the earth and into the quiet discipline of caring for what sustains you.`;
  }
  return `${name} calls you into ${theme}, asking what can be restored in a form your day can actually hold.`;
}

function centralTheme(input: ReflectionPlainSacredEditorInput) {
  const directive = clean(input.moralPortrait?.serudjDirective);
  const thesis = clean(input.judgment?.reflectionThesis);
  const lower = `${directive} ${thesis}`.toLowerCase();
  if (/\boutward|others|self-return|inward\b/.test(lower)) {
    return "This is not a moment for pressure or perfection, but for proportion: care that returns inward as surely as it moves outward.";
  }
  if (/\bcreative|work|maker|creation\b/.test(lower)) {
    return "This is not a moment for pressure or perfection, but for simple completion: enough form for the work to trust its next step.";
  }
  return "This is not a moment for pressure or perfection, but for simple completion: the kind that restores trust between what you know inwardly and what you choose outwardly.";
}

function personalMeaning(input: ReflectionPlainSacredEditorInput) {
  const becoming = clean(input.moralPortrait?.personBecomingStatement);
  const directive = clean(input.moralPortrait?.serudjDirective);
  const lower = `${becoming} ${directive}`.toLowerCase();
  if (/\boutward|others|self-return|inward\b/.test(lower)) {
    return "Your care for others flows naturally, yet your own foundation has been asking for the same steadiness you offer elsewhere.";
  }
  if (/\bcreative|maker|work|creation\b/.test(lower)) {
    return "Your creative work has been moving, but it needs a clean enough form that you can choose the next step from reality instead of pressure.";
  }
  return "Your foundation has been asking for attention through needs your body already understands.";
}

function alignmentMeaning(input: ReflectionPlainSacredEditorInput) {
  const lens = input.judgment?.selectedMaatLens ??
    input.profileSnapshot?.dominantMaatLens;
  if (lens === "truth" || lens === "witness") {
    return "The desire to tell the truth about your life carries meaning, but intention alone is not enough; it asks to become action clear enough to stand on.";
  }
  if (lens === "care" || lens === "reciprocity") {
    return "The desire to care carries meaning even when no one else sees it, but care has to include the one who is doing the caring.";
  }
  return "The desire to nourish yourself carries meaning even when no one else sees it, but intention alone is not enough; it asks to be grounded in action, in rhythms that can support and hold it consistently.";
}

function concreteAction(input: ReflectionPlainSacredEditorInput) {
  const topic = clean(input.thesisGate?.visibleTopic);
  const judgmentAnchor = clean(input.judgment?.evidenceAnchor);
  const candidate = topic || judgmentAnchor;
  if (/\bvitamin a\b/i.test(candidate)) {
    return "Complete the vitamin A care in whatever form genuinely supports you";
  }
  if (/\bcreative|work|draft|build|project\b/i.test(candidate)) {
    return "Give the work one concrete finish line you can actually honor";
  }
  if (
    /\boutward|inward|self|care\b/i.test(
      clean(input.moralPortrait?.serudjDirective),
    )
  ) {
    return "Return one act of care toward yourself in a form you can actually keep";
  }
  return "Choose one real act of care and complete it in the form your day can hold";
}

function closingSentence(input: ReflectionPlainSacredEditorInput) {
  const action = concreteAction(input);
  if (input.judgment?.closingKind === "question") {
    const closing = clean(input.judgment.closingText);
    if (
      closing &&
      !/\b(record|mark|log|check|what would it look like)\b/i.test(closing)
    ) {
      return closing.endsWith("?") ? closing : `${closing}?`;
    }
    return "What would it mean to let your inner knowing and your daily actions move together?";
  }
  return `${action}, and let that act become a small proof that your inner knowing and your daily actions are learning to move together.`;
}

export function buildFallbackReflectionPlainSacredEdit(
  input: ReflectionPlainSacredEditorInput,
): ReflectionPlainSacredEdit {
  const paragraph1 = [
    decanOpening(input),
    centralTheme(input),
  ].join(" ");
  const paragraph2 = [
    personalMeaning(input),
    alignmentMeaning(input),
  ].join(" ");
  const action = concreteAction(input);
  const close = closingSentence(input);
  const paragraph3 = [
    "Today's reminder is gentle but clear: choose from reality rather than urgency.",
    input.judgment?.closingKind === "question" ? close : sentence(close),
  ].join(" ");
  const editedReflectionText = [paragraph1, paragraph2, paragraph3].join(
    "\n\n",
  );
  const original = input.renderedReflection.toLowerCase();
  const removedAbstractions = STACKED_ABSTRACTIONS.filter((phrase) =>
    original.includes(phrase)
  );
  return {
    version: "reflection_plain_sacred_editor_v1",
    source: "deterministic",
    editedReflectionText,
    preservedMeaningSummary: clean(input.judgment?.reflectionThesis) ||
      clean(input.moralPortrait?.portraitStatement) ||
      "The reflection preserves the Ma'at reading while making the language plainer.",
    removedAbstractions,
    finalAction: action,
    editorWarnings: [],
  };
}

export function buildReflectionPlainSacredEditorPrompt(
  input: ReflectionPlainSacredEditorInput,
) {
  const compact = {
    targetWordRange: input.targetWordRange ?? "150-210",
    calendarFrame: input.calendarFrame
      ? {
        ceremonialDecanName: input.calendarFrame.ceremonialDecanName,
        decanTheme: input.calendarFrame.decanTheme,
        arcSummary: input.calendarFrame.arcSummary,
      }
      : null,
    moralPortrait: input.moralPortrait
      ? {
        personBecomingStatement: input.moralPortrait.personBecomingStatement,
        portraitStatement: input.moralPortrait.portraitStatement,
        serudjDirective: input.moralPortrait.serudjDirective,
        heartSignal: input.moralPortrait.heartSignal,
        forbiddenFramings: input.moralPortrait.forbiddenFramings,
      }
      : null,
    judgment: input.judgment
      ? {
        selectedMaatLens: input.judgment.selectedMaatLens,
        reflectionThesis: input.judgment.reflectionThesis,
        falseReadingToAvoid: input.judgment.falseReadingToAvoid,
        closingKind: input.judgment.closingKind,
        closingText: input.judgment.closingText,
      }
      : null,
    thesisGate: input.thesisGate
      ? {
        evidenceVisibility: input.thesisGate.evidenceVisibility,
        finalReflectionThesis: input.thesisGate.finalReflectionThesis,
        visibleTopic: input.thesisGate.visibleTopic,
        forbiddenSurfaceFocus: input.thesisGate.forbiddenSurfaceFocus,
      }
      : null,
    profileLens: input.profileSnapshot
      ? {
        dominantUserLens: input.profileSnapshot.dominantUserLens,
        dominantMaatLens: input.profileSnapshot.dominantMaatLens,
      }
      : null,
    renderedReflection: input.renderedReflection,
  };

  return `You are the final Plain Sacred Editor for a Ma'at decan reflection. Return JSON only. Do not explain.

Your job is not to add more philosophy. Preserve the meaning, but make the final reflection clear, spacious, emotionally progressive, and readable.

Required movement:
1. Paragraph 1: calendar call + central theme.
2. Paragraph 2: personal meaning + Ma'at alignment in ordinary language.
3. Paragraph 3: one concrete directive + emotional resolution.

Style rules:
- Make one idea meaningful at a time.
- Use plain sacred language: grounded, nourishing, honest, steady, inward, outward, care, reality, trust.
- Keep the spiritual tone, but remove stacked abstractions.
- No more than one major symbolic phrase per sentence.
- No repeated abstract stacks like sacred weight, trustworthy witness, outer action, integration into order, confirmed place. "Inner knowing" is allowed only when paired with a plain phrase like daily actions.
- Do not use witness, witnessed, witnessing, mark, marked, unmarked, trustworthy witness, honest witness, confirmed mark, or clear mark in the edited reflection. Use proof, action, choice, rhythm, or daily actions instead.
- Do not use "restore the house" or "restore the sanctuary"; say "care for what sustains you" or "grounded care".
- Do not expose hidden scaffold: no "where you answered", "where restoration is still needed", "the alignment is", or "the improvement direction is".
- Do not make record/account/mark/evidence the protagonist.
- Use at most one concrete evidence item, preferably in the final directive when it makes the action clearer. Do not put the item in paragraph 1, and do not make it the subject of the reflection.
- Keep exactly one final action or one final question, based on judgment.closingKind.
- Avoid "what would it look like"; prefer "What would it mean...", "What would restore...", "What are you willing...", or a clear charge.
- Do not quote journal text or dump raw inputs.

Return exactly this JSON shape:
{
  "editedReflectionText": "string",
  "preservedMeaningSummary": "string",
  "removedAbstractions": ["string"],
  "finalAction": "string",
  "editorWarnings": ["string"]
}

PRIVATE_INPUT:
${JSON.stringify(compact, null, 2)}`;
}
