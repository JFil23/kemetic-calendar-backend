import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildFallbackReflectionPlainSacredEdit,
  buildReflectionPlainSacredEditorPrompt,
  parseReflectionPlainSacredEdit,
} from "./reflection_plain_sacred_editor.ts";
import type { ReflectionMoralPortrait } from "./reflection_moral_portrait.ts";
import type { ReflectionJudgment } from "./reflection_judgment.ts";
import type { ReflectionThesisGate } from "./reflection_thesis_gate.ts";
import { buildReflectionCalendarFrame } from "./reflection_calendar.ts";
import { getDecanContext } from "./decan_context.ts";

const moralPortrait: ReflectionMoralPortrait = {
  version: "reflection_moral_portrait_v1",
  source: "deterministic",
  decanCall:
    "Hathor's first decan sꜣḥ calls for stability regained and care restored to a form the day can hold.",
  sacredDimension:
    "The heart is learning to choose from reality instead of pressure.",
  relationalDimension:
    "Care moves outward naturally, but reciprocity asks that self-care remain included.",
  naturalDimension:
    "The body belongs to the created order and asks for steady nourishment.",
  heartSignal:
    "The desire to nourish yourself is present before the rhythm has fully formed.",
  serudjCall: "Restore proportion between outward care and inward tending.",
  geruMaaOrientation:
    "Composure means choosing the form care can actually live in.",
  portraitStatement:
    "You care outwardly before returning inward, and this decan asks that return to become simple enough to keep.",
  personBecomingStatement:
    "You are becoming someone whose care can return inward without becoming another burden.",
  serudjDirective:
    "Return one act of care inward so proportion is restored between what you give and what you keep.",
  forbiddenFramings: ["next reflection", "less guesswork"],
};

const judgment: ReflectionJudgment = {
  version: "reflection_judgment_v1",
  source: "deterministic",
  primaryMaatQuestion:
    "Can care become right measure without becoming pressure?",
  selectedMaatLens: "measure",
  secondaryMaatLens: "care",
  falseReadingToAvoid:
    "Do not make this about nutrition compliance or logging mechanics.",
  centralMoralReading: "Care is present, but it needs a grounded form.",
  alignment: "The desire to nourish yourself is present.",
  underalignment: "The care needs a form the day can hold.",
  evidenceAnchor: "vitamin A care",
  userProfileConnection: "The user tends outward before returning inward.",
  deeperDirective: "Return one act of care inward in a keepable form.",
  reflectionThesis:
    "Ma'at is asking for care to become simple enough to live, not heavier to carry.",
  closingKind: "charge",
  closingText:
    "Complete the vitamin A care in whatever form genuinely supports you.",
};

const thesisGate: ReflectionThesisGate = {
  version: "reflection_thesis_gate_v1",
  finalReflectionThesis: "Care needs a form simple enough to live.",
  visibleTopic: "vitamin A care",
  evidenceVisibility: "visible_anchor",
  evidenceUseReason: "The anchor is allowed as one practical sign.",
  userMeaning: "Care is trying to become keepable.",
  maatDirective: "Make the care real in one simple action.",
  forbiddenSurfaceFocus: [],
};

Deno.test("plain sacred editor parses structured JSON", () => {
  const parsed = parseReflectionPlainSacredEdit(JSON.stringify({
    editedReflectionText:
      "Hathor's first decan calls you back to earth.\n\nYour care has meaning.\n\nComplete one act today.",
    preservedMeaningSummary: "Care becomes grounded.",
    removedAbstractions: ["sacred weight"],
    finalAction: "Complete one care act.",
    editorWarnings: [],
  }));

  assert(parsed);
  assertEquals(parsed.source, "anthropic");
  assertEquals(parsed.removedAbstractions, ["sacred weight"]);
  assertEquals(parsed.editedReflectionText.split(/\n\s*\n/).length, 3);
});

Deno.test("plain sacred editor fallback creates the approved three-part shape", () => {
  const calendarFrame = buildReflectionCalendarFrame({
    decanContext: getDecanContext("3-1"),
    decanName: "Hathor - s3h",
    decanTheme: "stability regained",
  });
  const dense =
    "Hathor's first decan sꜣḥ called for stability regained. The intention to nourish carries sacred weight even when unmarked, but integration into the order needs trustworthy witness between inner knowing and outer action. Where restoration is still needed, the alignment is completion.";
  const edit = buildFallbackReflectionPlainSacredEdit({
    renderedReflection: dense,
    moralPortrait,
    judgment,
    thesisGate,
    calendarFrame,
    targetWordRange: "155-215",
  });

  assertStringIncludes(
    edit.editedReflectionText,
    "calls you back to the earth",
  );
  assertStringIncludes(edit.editedReflectionText, "vitamin A care");
  assertStringIncludes(edit.editedReflectionText, "inner knowing");
  assertStringIncludes(edit.editedReflectionText, "daily actions");
  assertEquals(edit.editedReflectionText.split(/\n\s*\n/).length, 3);
  assert(edit.removedAbstractions.includes("sacred weight"));
  assert(
    !/Where restoration is still needed|The alignment is/.test(
      edit.editedReflectionText,
    ),
  );
});

Deno.test("plain sacred editor prompt enforces clarity and abstraction budget", () => {
  const prompt = buildReflectionPlainSacredEditorPrompt({
    renderedReflection: "Dense reflection",
    moralPortrait,
    judgment,
    thesisGate,
    calendarFrame: buildReflectionCalendarFrame({
      decanContext: getDecanContext("3-1"),
      decanName: "Hathor - s3h",
      decanTheme: "stability regained",
    }),
  });

  assertStringIncludes(prompt, "Paragraph 1: calendar call + central theme");
  assertStringIncludes(prompt, "Make one idea meaningful at a time");
  assertStringIncludes(prompt, "No more than one major symbolic phrase");
  assertStringIncludes(prompt, "editedReflectionText");
});
