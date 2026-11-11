import type { MaatNormalizedObligationThreads } from "./maat_obligation_threads.ts";
import type { MaatTranslatedProfileContext } from "./profile_context_translator.ts";
import type {
  ReflectionAlignmentMap,
  ReflectionArcPlan,
  ReflectionCalendarFrame,
} from "./reflection_calendar.ts";
import type { ReflectionProfileSnapshot } from "./reflection_profile_snapshot.ts";

export type ReflectionMoralPortrait = {
  version: "reflection_moral_portrait_v1";
  source: "anthropic" | "deterministic";
  decanCall: string;
  sacredDimension: string;
  relationalDimension: string;
  naturalDimension: string;
  heartSignal: string;
  serudjCall: string;
  geruMaaOrientation: string;
  portraitStatement: string;
  personBecomingStatement: string;
  serudjDirective: string;
  forbiddenFramings: string[];
};

export type ReflectionMoralPortraitInput = {
  calendarFrame?: ReflectionCalendarFrame | null;
  profileSnapshot?: ReflectionProfileSnapshot | null;
  translatedProfileContext?: MaatTranslatedProfileContext | null;
  normalizedObligationThreads?: MaatNormalizedObligationThreads | null;
  alignmentMap?: ReflectionAlignmentMap | null;
  arcPlan?: ReflectionArcPlan | null;
  recentOutcomes?: unknown | null;
};

export const REFLECTION_MORAL_PORTRAIT_FORBIDDEN_FRAMINGS = [
  "next reflection",
  "less guesswork",
  "enough detail",
  "record cannot show",
  "what may already have occurred",
  "truth asks for enough detail",
  "improvement direction",
  "the next guidance has no foundation",
  "write for the next reflection",
  "record tells the truth",
  "record can match",
  "mark of care",
  "complete today so your record",
  "written record drift apart",
];

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sentence(value: string, fallback: string) {
  const cleaned = clean(value);
  return cleaned || fallback;
}

function hasSingleRecurringNutritionThread(
  input: ReflectionMoralPortraitInput,
) {
  const nutrition = input.normalizedObligationThreads?.nutrition;
  return Boolean(
    nutrition &&
      nutrition.unique_item_count === 1 &&
      nutrition.same_item_repeated,
  );
}

function profilePhrase(input: ReflectionMoralPortraitInput, pattern: RegExp) {
  return (input.translatedProfileContext?.phrases ?? []).find((phrase) =>
    pattern.test(phrase.toLowerCase())
  );
}

function moralProfilePattern(input: ReflectionMoralPortraitInput) {
  const lens = input.profileSnapshot?.dominantUserLens;
  if (lens === "creative_unclosed_work") return "creative_motion";
  if (lens === "care_outward_self_thin") return "outward_care";
  if (lens === "overcommitment") return "carried_too_much";
  if (lens === "routine_anchor_missing") return "unplaced_return";
  if (lens === "record_thinning") return "movement_before_witness";
  if (profilePhrase(input, /\bcreative\b/)) return "creative_motion";
  if (profilePhrase(input, /\bcare.*outward|others\b/)) return "outward_care";
  if (profilePhrase(input, /\baccumulat|open loops|smaller active list\b/)) {
    return "carried_too_much";
  }
  if (profilePhrase(input, /\bbatch|clustered|irregular\b/)) {
    return "focused_bursts";
  }
  if (hasSingleRecurringNutritionThread(input)) return "care_seeking_form";
  return "emerging_profile";
}

export function buildFallbackReflectionMoralPortrait(
  input: ReflectionMoralPortraitInput,
): ReflectionMoralPortrait {
  const frame = input.calendarFrame;
  const decanName = clean(frame?.ceremonialDecanName) || "this decan";
  const calendarDemand = clean(frame?.arcSummary) ||
    clean(frame?.decanTheme) ||
    "a return to right relation";
  const pattern = moralProfilePattern(input);
  const profileSummary = clean(input.profileSnapshot?.userPatternSummary);
  const naturalCare = hasSingleRecurringNutritionThread(input);

  let sacredDimension =
    "Your inner work is trying to move from pressure into truth, so the next step can be chosen from what is real.";
  let relationalDimension =
    "Your obligations ask for a form that protects care without turning it into a heavier burden.";
  let naturalDimension = naturalCare
    ? "Care for the body is present as part of the created order; the question is how lightly and honestly it can be carried."
    : "The season asks your ordinary rhythm, body, time, and place to become part of the repair, not scenery around it.";
  let heartSignal =
    "Your heart is moving faster than the visible witness of that movement.";
  let serudjCall =
    "Restore the bridge between what moved and what you can trust about it; raise the real movement into form.";
  let geruMaaOrientation =
    "Composure here means choosing the next step from truth instead of pressure.";
  let portraitStatement =
    "You are not absent from the work. Something in you is moving, and Ma'at is asking that movement to be named, restored, and made easier to carry.";
  let personBecomingStatement =
    "You are becoming someone who can meet movement with truth instead of pressure.";
  let serudjDirective =
    "Restore one living movement by giving it a human form you can carry, not an administrative proof.";

  if (pattern === "creative_motion") {
    sacredDimension =
      "Your inner orientation is toward making and returning, not abandoning the work when the form is unfinished.";
    relationalDimension =
      "Your visible work asks for one truthful close, so what you make can meet the next person, task, or season with less pressure.";
    naturalDimension =
      "The rhythm of the day needs to hold the work gently enough that creation can return without becoming extraction.";
    heartSignal =
      "Your heart is ahead of your witness: the work is moving before it has been fully named.";
    serudjCall =
      "Restore one piece of the work by naming what actually changed, so progress becomes something you can stand on.";
    geruMaaOrientation =
      "Composure means letting the work be real without forcing it to become bigger than the day can hold.";
    portraitStatement =
      "You build by moving. This decan shows real forward motion looking for a truthful form, so the next step can come from what actually changed rather than from pressure to prove it.";
    personBecomingStatement =
      "You are becoming a maker who can let real movement be enough to guide the next act.";
    serudjDirective =
      "Restore one piece of the work by naming what changed for yourself, so creation returns as self-trust rather than pressure.";
  } else if (pattern === "outward_care") {
    sacredDimension =
      "Your heart turns toward care, and the sacred question is whether your own life remains included in that care.";
    relationalDimension =
      "Care for others is visible, but reciprocity asks that giving not erase the keeper.";
    naturalDimension =
      "Your body and time are part of the created order; they cannot be treated as endless supply.";
    heartSignal =
      "Your heart is generous, but Ma'at asks generosity to stay in right relation with self-preservation.";
    serudjCall =
      "Restore the place where your own maintenance belongs inside the care you give outward.";
    geruMaaOrientation =
      "Composure means giving without disappearing inside the giving.";
    portraitStatement =
      "You are moving as a keeper of care. This decan asks that care to become reciprocal: what you give outward must also leave you with enough life to stand whole.";
    personBecomingStatement =
      "You tend outward before returning inward; serudj asks for proportion between giving and self-return.";
    serudjDirective =
      "Return one act of care inward so proportion is restored between what you give and what you keep.";
  } else if (pattern === "carried_too_much") {
    sacredDimension =
      "Your will is active, but worthiness is not proven by carrying every possible promise.";
    relationalDimension =
      "Open commitments need right measure so promises remain trustworthy instead of multiplying pressure.";
    naturalDimension =
      "The day has limits, and Ma'at treats those limits as truth, not weakness.";
    heartSignal =
      "Your heart is reaching beyond the container available to hold the work.";
    serudjCall =
      "Restore proportion by letting one promise become clear, placed, and keepable before another is added.";
    geruMaaOrientation =
      "Composure means choosing the right-sized form over the impressive load.";
    portraitStatement =
      "You are carrying real intention, but this decan asks intention to accept measure. What cannot be placed honestly becomes weight; what is right-sized can become order.";
    personBecomingStatement =
      "You are becoming someone who can honor intention without letting it multiply into burden.";
    serudjDirective =
      "Restore proportion by releasing or right-sizing one promise until what remains can be carried with a whole heart.";
  } else if (pattern === "unplaced_return" || pattern === "care_seeking_form") {
    sacredDimension =
      "Your intention is present; Ma'at is asking whether that intention has a truthful form.";
    relationalDimension =
      "A promise becomes trustworthy when it is given a place where the act can meet the day without force.";
    naturalDimension =
      "Care for the body belongs to life-preservation, but life-preservation has to fit the actual rhythm of the day.";
    heartSignal =
      "Your heart has kept returning to care before the day has made a reliable place for it.";
    serudjCall =
      "Restore right measure by giving the care a form that can be kept, or by releasing it until it can be carried honestly.";
    geruMaaOrientation =
      "Composure means refusing both neglect and overpromising; the true form is the one you can actually keep.";
    portraitStatement =
      "You are seeking care that can become real order. The desire is alive; the restoration is to give that care a truthful size and place.";
    personBecomingStatement =
      "You are becoming someone who refuses both neglect and overburdening, and looks for the form care can actually live in.";
    serudjDirective =
      "Restore proportion by giving one act of care a place in your actual day, or releasing it until it can be carried honestly.";
  } else if (pattern === "focused_bursts") {
    sacredDimension =
      "Your inner rhythm seems to gather force in focused returns rather than constant display.";
    relationalDimension =
      "The work asks to be honored in the way it actually moves, not judged only by daily visibility.";
    naturalDimension =
      "The day may not carry this practice evenly, but it can still carry it truthfully.";
    heartSignal =
      "Your heart appears to return in bursts; the question is how those returns become trustworthy rather than accidental.";
    serudjCall =
      "Restore a simple vessel for the burst, so concentrated effort leaves a shape behind.";
    geruMaaOrientation =
      "Composure means trusting the real rhythm and giving it one place to land.";
    portraitStatement =
      "You move in gathered returns. This decan asks those returns to leave a form behind, so effort becomes continuity rather than only intensity.";
    personBecomingStatement =
      "You are becoming someone whose force returns in gathered moments and can still leave continuity behind.";
    serudjDirective =
      "Restore one simple landing place for the burst, so focused effort becomes something you can return to.";
  } else if (pattern === "movement_before_witness") {
    sacredDimension =
      "Your inner life is active before it has fully turned back to witness what changed.";
    relationalDimension =
      "Your work and care ask to be met by self-recognition, not only outward movement.";
    naturalDimension =
      "The day holds movement that deserves a pause, so the next step can grow from reality rather than pressure.";
    heartSignal =
      "Your heart is moving before you have fully returned inward to name what it knows.";
    serudjCall =
      "Restore the inward turn: raise what moved into truth for yourself, not for the system.";
    geruMaaOrientation =
      "Composure means pausing long enough to choose from what is real.";
    portraitStatement =
      "You move before you fully turn inward to witness it. The motion is real; what asks restoration is the inward return that lets you know what changed.";
    personBecomingStatement =
      "You are becoming someone who can let action and self-knowledge meet before pressure chooses the next step.";
    serudjDirective =
      "Return inward long enough to name what moved, so your next step comes from truth instead of pressure.";
  }

  if (profileSummary && pattern === "emerging_profile") {
    portraitStatement =
      `${profileSummary} This decan asks that pattern to become more truthful, more whole, and easier to carry.`;
    personBecomingStatement =
      "You are still becoming legible through the practice; the invitation is to choose one truthful next step without forcing a full diagnosis.";
    serudjDirective =
      "Restore one small place where truth, care, or measure can become easier to carry.";
  }

  return {
    version: "reflection_moral_portrait_v1",
    source: "deterministic",
    decanCall: `${decanName} called for ${calendarDemand}.`,
    sacredDimension,
    relationalDimension,
    naturalDimension,
    heartSignal,
    serudjCall,
    geruMaaOrientation,
    portraitStatement,
    personBecomingStatement,
    serudjDirective,
    forbiddenFramings: REFLECTION_MORAL_PORTRAIT_FORBIDDEN_FRAMINGS,
  };
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

export function parseReflectionMoralPortrait(
  raw: string,
): ReflectionMoralPortrait | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const required = [
    "decanCall",
    "sacredDimension",
    "relationalDimension",
    "naturalDimension",
    "heartSignal",
    "serudjCall",
    "geruMaaOrientation",
    "portraitStatement",
    "personBecomingStatement",
    "serudjDirective",
  ];
  if (
    required.some((key) =>
      typeof parsed[key] !== "string" ||
      clean(parsed[key] as string).length === 0
    )
  ) {
    return null;
  }
  const forbiddenFramings = Array.isArray(parsed.forbiddenFramings)
    ? parsed.forbiddenFramings.map((item) =>
      typeof item === "string" ? clean(item) : ""
    ).filter(Boolean)
    : REFLECTION_MORAL_PORTRAIT_FORBIDDEN_FRAMINGS;
  return {
    version: "reflection_moral_portrait_v1",
    source: "anthropic",
    decanCall: clean(parsed.decanCall as string),
    sacredDimension: clean(parsed.sacredDimension as string),
    relationalDimension: clean(parsed.relationalDimension as string),
    naturalDimension: clean(parsed.naturalDimension as string),
    heartSignal: clean(parsed.heartSignal as string),
    serudjCall: clean(parsed.serudjCall as string),
    geruMaaOrientation: clean(parsed.geruMaaOrientation as string),
    portraitStatement: clean(parsed.portraitStatement as string),
    personBecomingStatement: clean(parsed.personBecomingStatement as string),
    serudjDirective: clean(parsed.serudjDirective as string),
    forbiddenFramings: forbiddenFramings.length
      ? forbiddenFramings
      : REFLECTION_MORAL_PORTRAIT_FORBIDDEN_FRAMINGS,
  };
}

export function reflectionMoralPortraitPromptBlock(
  portrait: ReflectionMoralPortrait | null | undefined,
) {
  if (!portrait) return "";
  return [
    "REFLECTION_MORAL_PORTRAIT (primary witness layer; do not print this heading or labels):",
    `Decan call: ${portrait.decanCall}`,
    `Sacred dimension: ${portrait.sacredDimension}`,
    `Relational dimension: ${portrait.relationalDimension}`,
    `Natural dimension: ${portrait.naturalDimension}`,
    `Heart signal: ${portrait.heartSignal}`,
    `Serudj call: ${portrait.serudjCall}`,
    `Geru maa orientation: ${portrait.geruMaaOrientation}`,
    `Portrait statement: ${portrait.portraitStatement}`,
    `Person becoming statement: ${portrait.personBecomingStatement}`,
    `Serudj directive: ${portrait.serudjDirective}`,
    `Forbidden framings: ${portrait.forbiddenFramings.join("; ")}`,
    "Hard rule: begin from this portrait of becoming. The person is the protagonist; record, account, mark, and evidence may not become the protagonist. The directive must arise from the serudj directive, not from the app's need for more evidence.",
  ].join("\n");
}

export function buildReflectionMoralPortraitPrompt(
  input: ReflectionMoralPortraitInput,
) {
  const compact = {
    calendarFrame: input.calendarFrame
      ? {
        ceremonialDecanName: input.calendarFrame.ceremonialDecanName,
        monthName: input.calendarFrame.monthName,
        seasonName: input.calendarFrame.seasonName,
        decanTheme: input.calendarFrame.decanTheme,
        arcSummary: input.calendarFrame.arcSummary,
      }
      : null,
    profileSnapshot: input.profileSnapshot
      ? {
        userPatternSummary: input.profileSnapshot.userPatternSummary,
        dominantUserLens: input.profileSnapshot.dominantUserLens,
        lensReason: input.profileSnapshot.lensReason,
        lensStability: input.profileSnapshot.lensStability,
        dominantMaatLens: input.profileSnapshot.dominantMaatLens,
        secondaryMaatLens: input.profileSnapshot.secondaryMaatLens,
        ethicalQuestion: input.profileSnapshot.ethicalQuestion,
        alignmentReading: input.profileSnapshot.alignmentReading,
        underalignmentReading: input.profileSnapshot.underalignmentReading,
        repairDirection: input.profileSnapshot.repairDirection,
        profileConfidence: input.profileSnapshot.profileConfidence,
        bestEvidenceAnchor: input.profileSnapshot.bestEvidenceAnchor,
        suppressedEvidenceAnchors:
          input.profileSnapshot.suppressedEvidenceAnchors,
      }
      : null,
    profileContext: input.translatedProfileContext?.phrases ?? [],
    alignedSignals: input.alignmentMap?.alignedSignals ?? [],
    underansweredSignals: input.alignmentMap?.underansweredSignals ?? [],
    domainBalance: input.alignmentMap?.domainBalance ?? null,
    evidenceDensity: input.arcPlan?.evidenceDensity ??
      input.alignmentMap?.evidenceDensity ?? null,
    normalizedObligationThreads: input.normalizedObligationThreads,
    recentOutcomes: input.recentOutcomes ?? null,
  };

  return `You are creating the private moral portrait for a Ma'at decan reflection. Return JSON only. Do not write the reflection.

Ma'at is an ideal theme: a point of orientation toward becoming, right relation, restoration, worthiness, truth, and life-giving order. Do not treat Ma'at as a compliance checklist.

Your task is to witness the person before judgment:
- What did this decan call forth?
- What is visible in the sacred/inner dimension?
- What is visible in relation to others, promises, work, care, or community?
- What is visible in relation to body, nature, rhythm, season, and created order?
- What is the heart revealing?
- Where is serudj called for: what asks to be restored, raised, repaired, or made more beautiful?
- What is this person becoming?

Hard rules:
- Do not serve the app's evidence problem.
- Do not tell the user to write so future reflections have better evidence.
- Do not use these framings: ${
    REFLECTION_MORAL_PORTRAIT_FORBIDDEN_FRAMINGS.join(", ")
  }.
- In portraitStatement, personBecomingStatement, and serudjDirective, avoid "record", "account", "mark", "evidence", "completion", and "confirmed" unless there is no other truthful wording.
- The person is the protagonist. The record/account/mark is never the protagonist.
- serudjDirective must name human restoration, not app maintenance.
- Do not quote journal text or dump raw inputs.
- Produce a portrait, not advice.

Return exactly this JSON shape:
{
  "decanCall": "string",
  "sacredDimension": "string",
  "relationalDimension": "string",
  "naturalDimension": "string",
  "heartSignal": "string",
  "serudjCall": "string",
  "geruMaaOrientation": "string",
  "portraitStatement": "string",
  "personBecomingStatement": "string",
  "serudjDirective": "string",
  "forbiddenFramings": ["string"]
}

PRIVATE_INPUT:
${JSON.stringify(compact, null, 2)}`;
}
