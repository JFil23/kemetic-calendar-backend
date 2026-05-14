import {
  findUnderSpecifiedActionPlaceholder,
  type FlowFormat,
  type SourceBackedOverview,
  type SparsePromptDomain,
  type SparsePromptRoutineNote,
} from "./generation_hints.ts";

export const FLOW_PLAN_VERSION = "flow_plan_v1";

export type FlowPlanAssumedUserLevel =
  | "novice"
  | "capable_beginner"
  | "intermediate"
  | "advanced";

export type FlowPlanOverviewBlockKind =
  | "summary"
  | "setup"
  | "practice_advice"
  | "anchor_table"
  | "product_list"
  | "desired_outcome";

export type FlowPlanOverviewBlock = {
  kind: FlowPlanOverviewBlockKind;
  title: string | null;
  text: string;
  rows: string[][];
};

export type FlowPlanBeginnerTerm = {
  term: string;
  plain_english: string;
};

export type FlowPlanEventSlot =
  | "morning"
  | "main"
  | "night"
  | "reflection"
  | "review"
  | "support";

export type FlowPlanEventSchedule = {
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
};

export type FlowPlanEventRenderHints = {
  visible_details: string;
  max_sentences: number;
  avoid_numbered_steps: true;
  materialize_repeats: true;
};

export type FlowPlanEvent = {
  slot: FlowPlanEventSlot;
  title: string;
  primary_action: string;
  supporting_actions: string[];
  done_when: string;
  beginner_terms: FlowPlanBeginnerTerm[];
  reflection_prompt: string | null;
  routine_key: string | null;
  schedule: FlowPlanEventSchedule;
  render_hints: FlowPlanEventRenderHints;
};

export type FlowPlanDay = {
  day_index: number;
  day_theme: string;
  events: FlowPlanEvent[];
};

export type FlowPlanQualityScores = {
  day_coverage: number;
  actionability: number;
  render_readiness: number;
  overview_utility: number;
  overall: number;
};

export type FlowPlan = {
  version: typeof FLOW_PLAN_VERSION;
  intent: {
    domain: SparsePromptDomain;
    goal: string;
    flow_format: FlowFormat;
    assumed_user_level: FlowPlanAssumedUserLevel;
    source_mode: "user_prompt" | "source_text" | "mixed";
  };
  duration_days: number;
  overview: {
    title: string;
    summary: string;
    blocks: FlowPlanOverviewBlock[];
  };
  days: FlowPlanDay[];
  assumptions: string[];
  warnings_or_limits: string[];
  render_hints: {
    tone: "clear_natural_calendar_prose";
    numbered_steps: false;
    materialize_repeats: true;
  };
  quality: {
    route: string;
    playbook_version: string;
    planner: string;
    renderer: string;
    validators: string[];
  };
};

export type FlowPlanValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  scores: FlowPlanQualityScores;
};

export type FlowPlanRenderedNote = {
  day_index: number;
  title: string;
  details: string;
  all_day: boolean;
  start_time?: string;
  end_time?: string;
  location?: string;
};

const FORBIDDEN_REPEAT_RE =
  /\b(?:repeat|same as above|as above|previous day|prior day|last day|see day|refer back|day[_\s-]*index|day\s+0)\b/i;
const NUMBERED_INSTRUCTION_RE = /(?:^|\n)\s*\d+\.\s+\S/;
const ROUGH_INTERNAL_LANGUAGE_RE =
  /\b(?:reference anchors?|general practice|working song map|instead of generic|source-backed|schema|render hints?)\b/i;

function normalizeWhitespace(text: string | null | undefined): string {
  return String(text ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function sourceModeFor(
  description: string | null | undefined,
  sourceText: string | null | undefined,
): "user_prompt" | "source_text" | "mixed" {
  const hasDescription = normalizeWhitespace(description).length > 0;
  const hasSource = normalizeWhitespace(sourceText).length > 0;
  if (hasDescription && hasSource) return "mixed";
  if (hasSource) return "source_text";
  return "user_prompt";
}

function inferAssumedUserLevel(
  description: string | null | undefined,
  sourceText: string | null | undefined,
): FlowPlanAssumedUserLevel {
  const text = `${description ?? ""}\n${sourceText ?? ""}`.toLowerCase();
  if (/\b(?:advanced|expert|professional|masterclass)\b/.test(text)) {
    return "advanced";
  }
  if (
    /\b(?:intermediate|already know|already play|already practice)\b/.test(text)
  ) {
    return "intermediate";
  }
  if (/\b(?:beginner|new to|starting|novice|never)\b/.test(text)) {
    return "novice";
  }
  return "novice";
}

function playbookVersionForDomain(domain: SparsePromptDomain): string {
  return `${domain}_playbook_v1`;
}

function firstNonEmptySentence(text: string): string {
  const normalized = normalizeWhitespace(text).replace(/\n+/g, " ");
  const sentences = normalized.split(/(?<=[.!?])\s+/).map((part) => part.trim())
    .filter(Boolean);
  return sentences[0] ?? normalized;
}

function supportingSentences(text: string): string[] {
  const normalized = normalizeWhitespace(text).replace(/\n+/g, " ");
  return normalized.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(
    Boolean,
  ).slice(1, 4);
}

function inferSlot(note: SparsePromptRoutineNote): FlowPlanEventSlot {
  const title = note.title.toLowerCase();
  const details = note.details.toLowerCase();
  const startHour = Number.parseInt((note.start_time ?? "").slice(0, 2), 10);
  const haystack = `${title} ${details}`;

  if (
    /\b(reflection|review|listen back|skin check|assessment)\b/.test(haystack)
  ) {
    return title.includes("review") ? "review" : "reflection";
  }
  if (/\b(morning|wake|a\.m\.)\b/.test(haystack)) return "morning";
  if (/\b(night|evening|bed|p\.m\.)\b/.test(haystack)) return "night";
  if (Number.isFinite(startHour) && startHour < 12) return "morning";
  return "main";
}

function inferRoutineKey(note: SparsePromptRoutineNote): string | null {
  const title = note.title.toLowerCase();
  if (title.includes("morning skincare routine")) return "skincare_morning";
  if (title.includes("skin check")) return "skincare_evening_check";
  if (title.includes("listening review")) return "music_listening_review";
  if (title.includes("morning warm-up")) return "martial_arts_warmup";
  if (title.includes("evening reflection")) return "evening_reflection";
  return null;
}

function inferDoneWhen(note: SparsePromptRoutineNote): string {
  const details = normalizeWhitespace(note.details).replace(/\n+/g, " ");
  const explicit = details.match(
    /\b(?:done means|done when|it counts if|the win is)\b[^.!?]*(?:[.!?]|$)/i,
  )?.[0];
  if (explicit) return explicit.trim();

  const slot = inferSlot(note);
  if (slot === "reflection" || slot === "review") {
    return "Done when you have written one clear observation and one next-session adjustment.";
  }
  if (
    /skincare|cleanse|moisturizer|sunscreen|differin|azelaic/i.test(details)
  ) {
    return "Done when the products are applied in order without burning, scrubbing, or stacking extra actives.";
  }
  if (/guitar|riff|chord|recording|metronome|tab/i.test(details)) {
    return "Done when you can name the cleanest section, the roughest section, and the next slow repair spot.";
  }
  if (/stance|kick|strike|footwork|warm-up|stretch/i.test(details)) {
    return "Done when the movement stays controlled and you can name one balance or timing correction.";
  }
  return "Done when the event is complete and the next useful adjustment is clear.";
}

function inferBeginnerTerms(
  note: SparsePromptRoutineNote,
): FlowPlanBeginnerTerm[] {
  const details = `${note.title}\n${note.details}`.toLowerCase();
  const terms: FlowPlanBeginnerTerm[] = [];

  const add = (term: string, plain_english: string) => {
    if (!terms.some((item) => item.term === term)) {
      terms.push({ term, plain_english });
    }
  };

  if (details.includes("standard tuning")) {
    add(
      "standard tuning",
      "Tune the guitar strings to E-A-D-G-B-E from lowest string to highest string.",
    );
  }
  if (details.includes("bpm")) {
    add("BPM", "Beats per minute; use it as the tempo setting on a metronome.");
  }
  if (details.includes("tab")) {
    add(
      "tab",
      "A guitar diagram showing which frets and strings to play.",
    );
  }
  if (details.includes("metronome")) {
    add("metronome", "A steady click that keeps your timing honest.");
  }
  if (details.includes("zone 2")) {
    add(
      "Zone 2",
      "A cardio pace where breathing is elevated but conversation is still possible.",
    );
  }
  if (details.includes("adapalene") || details.includes("differin")) {
    add(
      "adapalene",
      "The retinoid in Differin; use one pea-sized amount for the whole face.",
    );
  }
  if (details.includes("azelaic")) {
    add(
      "azelaic acid",
      "A pigment and blemish support active that should not be stacked with retinoid at first.",
    );
  }

  return terms;
}

function inferReflectionPrompt(note: SparsePromptRoutineNote): string | null {
  const slot = inferSlot(note);
  if (slot !== "reflection" && slot !== "review") return null;
  return firstNonEmptySentence(note.details);
}

function dayThemeFor(events: FlowPlanEvent[]): string {
  const main = events.find((event) =>
    event.slot === "main" || event.slot === "night" || event.slot === "morning"
  );
  return main?.title ?? events[0]?.title ?? "Daily work";
}

function eventFromNote(note: SparsePromptRoutineNote): FlowPlanEvent {
  return {
    slot: inferSlot(note),
    title: normalizeWhitespace(note.title),
    primary_action: firstNonEmptySentence(note.details),
    supporting_actions: supportingSentences(note.details),
    done_when: inferDoneWhen(note),
    beginner_terms: inferBeginnerTerms(note),
    reflection_prompt: inferReflectionPrompt(note),
    routine_key: inferRoutineKey(note),
    schedule: {
      all_day: Boolean(note.all_day),
      start_time: normalizeWhitespace(note.start_time) || null,
      end_time: normalizeWhitespace(note.end_time) || null,
      location: normalizeWhitespace(note.location) || null,
    },
    render_hints: {
      visible_details: normalizeWhitespace(note.details),
      max_sentences: 4,
      avoid_numbered_steps: true,
      materialize_repeats: true,
    },
  };
}

function overviewBlocksFrom(
  overview: SourceBackedOverview,
): FlowPlanOverviewBlock[] {
  return [{
    kind: "summary",
    title: null,
    text: normalizeWhitespace(overview.summary),
    rows: [],
  }];
}

export function buildFlowPlanFromSparseRoutine(args: {
  description: string | null | undefined;
  sourceText?: string | null;
  dateRangeDays: number;
  flowFormat: FlowFormat;
  domain: SparsePromptDomain;
  overview: SourceBackedOverview;
  notes: SparsePromptRoutineNote[];
}): FlowPlan | null {
  if (!Number.isFinite(args.dateRangeDays) || args.dateRangeDays <= 0) {
    return null;
  }
  if (!Array.isArray(args.notes) || args.notes.length === 0) return null;

  const days: FlowPlanDay[] = Array.from(
    { length: args.dateRangeDays },
    (_unused, dayIndex) => ({
      day_index: dayIndex,
      day_theme: "Daily work",
      events: [],
    }),
  );

  const sortedNotes = [...args.notes].sort((a, b) => {
    if (a.day_index !== b.day_index) return a.day_index - b.day_index;
    return String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""));
  });

  for (const note of sortedNotes) {
    if (note.day_index < 0 || note.day_index >= args.dateRangeDays) continue;
    days[note.day_index].events.push(eventFromNote(note));
  }

  for (const day of days) {
    day.day_theme = dayThemeFor(day.events);
  }

  return {
    version: FLOW_PLAN_VERSION,
    intent: {
      domain: args.domain,
      goal: normalizeWhitespace(args.description) || normalizeWhitespace(
        args.overview.title,
      ),
      flow_format: args.flowFormat,
      assumed_user_level: inferAssumedUserLevel(
        args.description,
        args.sourceText,
      ),
      source_mode: sourceModeFor(args.description, args.sourceText),
    },
    duration_days: args.dateRangeDays,
    overview: {
      title: normalizeWhitespace(args.overview.title),
      summary: normalizeWhitespace(args.overview.summary),
      blocks: overviewBlocksFrom(args.overview),
    },
    days,
    assumptions: [
      "The user can follow novice-friendly instructions unless they explicitly ask for advanced work.",
      "Repeated routines must be fully materialized in each rendered calendar event.",
    ],
    warnings_or_limits: [],
    render_hints: {
      tone: "clear_natural_calendar_prose",
      numbered_steps: false,
      materialize_repeats: true,
    },
    quality: {
      route: "sparse_prompt_routine",
      playbook_version: playbookVersionForDomain(args.domain),
      planner: "deterministic_sparse_routine_to_flow_plan",
      renderer: "flow_plan_renderer_v1",
      validators: [
        "day_coverage",
        "actionability",
        "visible_repeat_guard",
        "numbered_instruction_guard",
        "generic_placeholder_guard",
      ],
    },
  };
}

function textFailsRenderReadiness(text: string): boolean {
  return FORBIDDEN_REPEAT_RE.test(text) ||
    NUMBERED_INSTRUCTION_RE.test(text) ||
    ROUGH_INTERNAL_LANGUAGE_RE.test(text) ||
    findUnderSpecifiedActionPlaceholder(text) !== null;
}

function computeScores(
  plan: FlowPlan,
  errors: string[],
): FlowPlanQualityScores {
  const daysWithEvents = plan.days.filter((day) => day.events.length > 0)
    .length;
  const events = plan.days.flatMap((day) => day.events);
  const actionableEvents =
    events.filter((event) =>
      event.primary_action.length >= 24 && event.done_when.length >= 24 &&
      !textFailsRenderReadiness(
        `${event.title}\n${event.primary_action}\n${event.done_when}\n${event.render_hints.visible_details}`,
      )
    ).length;
  const renderReadyEvents = events.filter((event) =>
    !textFailsRenderReadiness(
      `${event.title}\n${event.render_hints.visible_details}`,
    )
  ).length;
  const overviewText = `${plan.overview.title}\n${plan.overview.summary}`;
  const overviewUtility = normalizeWhitespace(plan.overview.summary).length >=
        80 &&
      normalizeWhitespace(plan.overview.summary).length <= 520 &&
      !ROUGH_INTERNAL_LANGUAGE_RE.test(overviewText)
    ? 1
    : 0.5;

  const dayCoverage = clampScore(daysWithEvents / plan.duration_days);
  const actionability = clampScore(
    events.length > 0 ? actionableEvents / events.length : 0,
  );
  const renderReadiness = clampScore(
    events.length > 0 ? renderReadyEvents / events.length : 0,
  );
  const overall = clampScore(
    errors.length > 0
      ? Math.min(dayCoverage, actionability, renderReadiness)
      : (dayCoverage + actionability + renderReadiness + overviewUtility) / 4,
  );

  return {
    day_coverage: dayCoverage,
    actionability,
    render_readiness: renderReadiness,
    overview_utility: clampScore(overviewUtility),
    overall,
  };
}

export function validateFlowPlan(
  plan: FlowPlan | null,
): FlowPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan) {
    return {
      ok: false,
      errors: ["plan is missing"],
      warnings,
      scores: {
        day_coverage: 0,
        actionability: 0,
        render_readiness: 0,
        overview_utility: 0,
        overall: 0,
      },
    };
  }

  if (plan.version !== FLOW_PLAN_VERSION) {
    errors.push(`unsupported plan version: ${plan.version}`);
  }
  if (!Number.isFinite(plan.duration_days) || plan.duration_days <= 0) {
    errors.push("duration_days must be positive");
  }
  if (plan.render_hints.numbered_steps !== false) {
    errors.push("render_hints.numbered_steps must be false");
  }
  if (plan.render_hints.materialize_repeats !== true) {
    errors.push("render_hints.materialize_repeats must be true");
  }
  if (!normalizeWhitespace(plan.overview.title)) {
    errors.push("overview.title is required");
  }
  if (!normalizeWhitespace(plan.overview.summary)) {
    errors.push("overview.summary is required");
  }

  const dayIndices = new Set(plan.days.map((day) => day.day_index));
  for (let dayIndex = 0; dayIndex < plan.duration_days; dayIndex++) {
    if (!dayIndices.has(dayIndex)) {
      errors.push(`missing day_index ${dayIndex}`);
      continue;
    }
    const day = plan.days.find((candidate) => candidate.day_index === dayIndex);
    if (!day || day.events.length === 0) {
      errors.push(`day_index ${dayIndex} has no events`);
    }
  }

  for (const [dayPosition, day] of plan.days.entries()) {
    if (day.day_index !== dayPosition) {
      warnings.push(
        `days[${dayPosition}] has day_index ${day.day_index}; renderer will sort by day_index`,
      );
    }
    for (const [eventPosition, event] of day.events.entries()) {
      const path = `days[${day.day_index}].events[${eventPosition}]`;
      if (!normalizeWhitespace(event.title)) {
        errors.push(`${path}.title is required`);
      }
      if (!normalizeWhitespace(event.primary_action)) {
        errors.push(`${path}.primary_action is required`);
      }
      if (!normalizeWhitespace(event.done_when)) {
        errors.push(`${path}.done_when is required`);
      }
      if (!normalizeWhitespace(event.render_hints.visible_details)) {
        errors.push(`${path}.render_hints.visible_details is required`);
      }
      const renderedText =
        `${event.title}\n${event.primary_action}\n${event.done_when}\n${event.render_hints.visible_details}`;
      if (FORBIDDEN_REPEAT_RE.test(renderedText)) {
        errors.push(`${path} contains a visible repeat/reference shortcut`);
      }
      if (NUMBERED_INSTRUCTION_RE.test(renderedText)) {
        errors.push(`${path} contains a visible numbered instruction list`);
      }
      if (ROUGH_INTERNAL_LANGUAGE_RE.test(renderedText)) {
        errors.push(`${path} contains internal/process language`);
      }
      if (findUnderSpecifiedActionPlaceholder(renderedText)) {
        errors.push(`${path} contains under-specified action language`);
      }
      if (
        (event.slot === "reflection" || event.slot === "review") &&
        !normalizeWhitespace(event.reflection_prompt)
      ) {
        errors.push(`${path}.reflection_prompt is required for review events`);
      }
    }
  }

  const scores = computeScores(plan, errors);
  if (scores.overall < 0.9) {
    warnings.push(`quality score below target: ${scores.overall}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    scores,
  };
}

function renderEventDetails(event: FlowPlanEvent): string {
  const visible = normalizeWhitespace(event.render_hints.visible_details);
  if (visible) return visible;

  const parts = [
    event.primary_action,
    ...event.supporting_actions,
    event.done_when,
    event.reflection_prompt ?? "",
  ].map(normalizeWhitespace).filter(Boolean);
  return parts.join(" ");
}

export function renderFlowPlanToParsedNotes(
  plan: FlowPlan,
): FlowPlanRenderedNote[] {
  return plan.days
    .flatMap((day) =>
      day.events.map((event) => {
        const note: FlowPlanRenderedNote = {
          day_index: day.day_index,
          title: event.title,
          details: renderEventDetails(event),
          all_day: event.schedule.all_day,
        };
        if (event.schedule.start_time) {
          note.start_time = event.schedule.start_time;
        }
        if (event.schedule.end_time) note.end_time = event.schedule.end_time;
        if (event.schedule.location) note.location = event.schedule.location;
        return note;
      })
    )
    .sort((a, b) => {
      if (a.day_index !== b.day_index) return a.day_index - b.day_index;
      return String(a.start_time ?? "").localeCompare(
        String(b.start_time ?? ""),
      );
    });
}

export function buildFlowPlanQualityMetadata(args: {
  plan: FlowPlan;
  validation: FlowPlanValidationResult;
}) {
  return {
    generation_pipeline: "flow_plan_v1",
    flow_plan_version: args.plan.version,
    route: args.plan.quality.route,
    domain: args.plan.intent.domain,
    assumed_user_level: args.plan.intent.assumed_user_level,
    source_mode: args.plan.intent.source_mode,
    playbook_version: args.plan.quality.playbook_version,
    planner: args.plan.quality.planner,
    renderer: args.plan.quality.renderer,
    validators: args.plan.quality.validators,
    plan_validation: {
      ok: args.validation.ok,
      errors: args.validation.errors,
      warnings: args.validation.warnings,
    },
    quality_scores: args.validation.scores,
  };
}
