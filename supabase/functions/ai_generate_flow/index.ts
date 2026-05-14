import { createClient } from "npm:@supabase/supabase-js@2.27.0";
import {
  buildConcreteActionDefaultsRule,
  buildEventDetailDensityRule,
  buildNoviceClarityRule,
  buildSourceBackedOverview,
  buildSparsePromptExpertDefaults,
  buildSparsePromptRoutineNotes,
  calendarizeRecurringSourceRoutineHint,
  calendarizeSourceDayHint,
  countYoutubeUrls,
  extractFirstUrl,
  findUnderSpecifiedActionPlaceholder,
  type FlowFormat,
  hasUnsafeVisibleRepeatReference,
  inferFlowFormat,
  inferMode,
  inferRequestedTimeWindow,
  inferSourceHandling,
  inferSparsePromptDomain,
  looksLikeYoutubeUrl,
  looksStructuredDayPlan,
  mergePreservedDetails,
  normalizeYoutubeVideoUrl,
  parseRecurringSourceRoutineHints,
  parseSourceDayHints,
  type RecurringSourceRoutineHint,
  type RequestedTimeWindow,
  sanitizeFlowLocation,
  type SourceDayHint,
  type SourceHandlingMode,
  sourceHintLooksEveningRoutine,
  stripUnsafeVisibleRepeatReferenceText,
  stripVisibleNumberedInstructionListMarkers,
  unsafeVisibleRepeatTargetDayIndex,
  wantsThreeMealDailyFlow,
  wantsYoutubeLinks,
} from "./generation_hints.ts";
import {
  buildDecisionMatrix,
  classifyIntent,
  coercePlanSpec,
  fingerprintPlanSpec,
  generatePlanSpec,
  type PlanBehaviorPayload,
  type PlanDecisionMatrixV2,
  type PlanSpecV2,
  renderNotesFromPlanSpec,
  repairPlanSpec,
  validatePlanSpec,
} from "./plan_spec.ts";
import { buildPlannerFirstTelemetry } from "./planner_first_telemetry.ts";
import {
  buildFlowPlanFromSparseRoutine,
  buildFlowPlanQualityMetadata,
  renderFlowPlanToParsedNotes,
  validateFlowPlan,
} from "./flow_plan.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const SNAPSHOT_VERSION = Deno.env.get("FLOW_SNAPSHOT_VERSION") ?? "v0";
const SCHEMA_VERSION = Deno.env.get("FLOW_SCHEMA_VERSION") ?? "flowspec_v1";
const POLICY_VERSION = Deno.env.get("FLOW_POLICY_VERSION") ?? "kg_dm_v1";
const PLAN_SPEC_VERSION = "plan_spec_v2";
const FLOWSPEC_V2_ENABLED = SCHEMA_VERSION === "flowspec_v2";
const PLANNER_FIRST_ENABLED = false;
const FLOW_GENERATION_CACHE_ENABLED =
  (Deno.env.get("AI_GENERATE_FLOW_CACHE_ENABLED") ?? "false") === "true";
const OUTCOME_VECTOR_LIMIT = 6;

// Add timeout protection for API calls
async function callAnthropicModel(
  modelId,
  systemPrompt,
  messages,
  temperature = 0.3,
  maxTokens = 4096,
  timeoutMs = 45000, // 45 seconds default timeout
) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.log("⚠️ ANTHROPIC_API_KEY missing — using mock response");
    return {
      content: [{
        text: JSON.stringify({
          flowName: "AI Draft Flow",
          flowColor: "#4dd0e1",
          notes: [{
            title: "Placeholder Block",
            details: "No API key configured in environment.",
            starts_at: new Date().toISOString(),
            allDay: true,
          }],
        }),
      }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const payload = {
    model: modelId,
    system: systemPrompt,
    messages: messages,
    max_tokens: maxTokens,
    temperature: temperature,
  };

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log("📡 Calling Anthropic API:");
    console.log("   Model:", modelId);
    console.log("   URL:", ANTHROPIC_API_URL);
    console.log("   Has API key:", !!apiKey);

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: controller.signal, // ✅ Timeout protection
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });

    clearTimeout(timeoutId); // Clear timeout on success

    console.log("📬 Anthropic API Response:");
    console.log("   Status:", res.status);
    console.log("   OK:", res.ok);

    if (!res.ok) {
      const text = await res.text();
      console.log("   Error body:", text);
      throw new Error(
        `Anthropic API error: ${res.status} ${res.statusText} - ${text}`,
      );
    }

    const data = await res.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId); // Clear timeout on error

    // Check if it's a timeout error
    if (error.name === "AbortError" || error.message?.includes("aborted")) {
      console.log("❌ Claude API timeout after 45 seconds");
      throw new Error("AI generation timed out. Please try again.");
    }

    throw error;
  }
}
const MAX_RETRIES = 1;
const SHORT_FLOW_REFLECTION_PAIR_THRESHOLD_DAYS = 14;

/** Beyond this, single JSON completion cannot reliably cover every day within token + wall-clock limits. */
const LONG_FLOW_THRESHOLD_DAYS = 22;
/** Days per LLM call — larger segments = fewer round trips (easier on edge CPU/memory). */
const LONG_FLOW_SEGMENT_DAYS = 30;
const LONG_FLOW_SOURCE_CLAMP = 110_000;
/** Plan phase only — huge plan prompts blow edge memory/CPU before the first OpenAI call returns. */
const LONG_FLOW_PLAN_SOURCE_CLAMP = 36_000;
const SINGLE_FLOW_SOURCE_CONTEXT_MAX_CHARS = 20_000;
const LONG_FLOW_PLAN_SOURCE_CONTEXT_MAX_CHARS = 18_000;
const VERY_LONG_FLOW_THRESHOLD_DAYS = 60;
/** Keep planner latency bounded so long-flow runs can still finish before Edge wall-clock shutdown. */
const LONG_FLOW_PLAN_TIMEOUT_MS = 18_000;
/** Per-segment timeout budget for multi-week generation. */
const LONG_FLOW_SEGMENT_TIMEOUT_MS = 60_000;
const LONG_FLOW_GLOBAL_ANCHORS_MAX_CHARS = 3_600;
const LONG_FLOW_SEGMENT_EXCERPT_CAP = 6_800;
const OPENAI_FETCH_TIMEOUT_MS = 95_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const PLANNER_FIRST_TIMEOUT_RAW = Number(
  Deno.env.get("PLANNER_FIRST_TIMEOUT_MS") ?? "25000",
);
const PLANNER_FIRST_TIMEOUT_MS = Number.isFinite(PLANNER_FIRST_TIMEOUT_RAW)
  ? Math.max(10_000, Math.min(60_000, Math.floor(PLANNER_FIRST_TIMEOUT_RAW)))
  : 25_000;
const PLANNER_FIRST_MODEL = Deno.env.get("OPENAI_PLANNER_MODEL") ??
  "gpt-4o-mini";
/** Default 2 keeps 90-day runs under Supabase wall-clock without spiking to 3+ concurrent calls. */
const LONG_FLOW_SEGMENT_CONCURRENCY_DEFAULT = 2;
const ENABLE_YOUTUBE_LINK_SEARCH =
  (Deno.env.get("ENABLE_YOUTUBE_LINK_SEARCH") ?? "false") === "true";
const YOUTUBE_SEARCH_VERSION = "yt_links_v2";
const YOUTUBE_SEARCH_MAX_OUTPUT_TOKENS = 1_400;

const FLOW_CONTRACT_V3 =
  `You generate a FLOW: a structured schedule template across a date range.

DEFINITION
- A FLOW is a container of NOTES distributed across a date range.
- Each NOTE represents a scheduled event (or all-day container) for a specific day_index.
- Multiple NOTES may share the same day_index to represent multiple events on the same day.

OUTPUT FORMAT (STRICT)
Return ONLY valid JSON matching this schema:
{
  "flowName": string (non-empty),
  "overview": { "title": string, "summary": string } (optional),
  "notes": [
    {
      "day_index": number (>=0),
      "title": string (non-empty),
      "details": string (non-empty),
      "allDay": boolean,
      "startsAt": "HH:MM" (required if allDay=false),
      "endsAt": "HH:MM" (required if allDay=false),
      "location": string (optional),
      "chips": number[] (optional, values 1-10)
    }
  ]
}

HARD REQUIREMENTS
- notes must cover EVERY day in the date range: include at least one note for each day_index from 0 to N-1.
- day_index is 0-based from the startDate (0 = first day).
- You MAY create multiple notes for the same day_index when appropriate.
- If allDay=false: startsAt/endsAt must be 24h "HH:MM" and endsAt must be later than startsAt.
- Prefer rounded times (e.g., 07:00, 12:00, 18:00). Avoid random minutes.
- If the user gives an exact start time, time window, or duration, use those exact time parameters for the main session unless the source material gives day-specific exceptions.
- If a note references a direct URL, meeting link, livestream, or video call, put that link in "location" instead of burying it in "details".
- Use "location" only when it is concretely useful: a direct URL, watch/join link, or a real-world venue like a gym, field, courthouse, studio, or classroom.
- Do not put generic setup cues in "location" (for example "study materials open", "workspace ready", or similar filler).
- If chips are omitted, that is acceptable.

INTERPRETATION MODES
You will be given MODE and scheduling hints.
- MODE=DICTATION: The user is dictating items/times. Do not expand with extra activities. Only structure faithfully.
- MODE=ELABORATION: The user gave goals/theme. Create a practical schedule with reasonable defaults, written as a domain expert. Let FLOW_FORMAT determine the right note shape for the material instead of forcing one template.
- If FLOW_FORMAT=REGIMEN, each MAIN SESSION note must be specific, execution-ready, and include at least one technical cue, one measurable target, and one adjustment.
- In FLOW_FORMAT=REGIMEN, write compact prose: setup/control, a short cue, one primary job with at most two supporting sub-actions, and one note-to-self close.
- If FLOW_FORMAT is not REGIMEN, infer the best note shape from the user's material. Use a short orientation when it helps, make the action concrete, and end with one concise benefit, verification, or reflection sentence only when it improves the flow.
- If FLOW_FORMAT=MEAL_PLAN: ignore MAIN SESSION rehearsal/session structure. Instead, each meal note must identify the meal, name concrete foods, and explain 1-2 direct benefits of that specific meal in plain language.

SOURCE_TEXT
If SOURCE_TEXT is provided:
- Treat it as authoritative content. Reuse its phrasing and structure when possible.
- Preserve direct links from SOURCE_TEXT on the matching note whenever possible.
- Do not invent quotes or claim the text says things it does not.

NO EXTRA TEXT
- No markdown, no commentary, no preface, no trailing notes. JSON only.`;

const FLOW_RULES_PACK_V1_2 = `RULES PACK v1.3

SCHEDULING INTERPRETATION
- If SCHEDULE_MODE=SPECIFIC_DAYS: Only schedule the main activity on those days.
  Non-scheduled days still require at least one note/day_index: use a short Maintain/Rest note.
- If SCHEDULE_MODE=DAILY: schedule the main activity daily.
- If SCHEDULE_MODE=INTERVAL: schedule the main activity every INTERVAL_N days; non-scheduled days get Maintain/Rest.

TIME-OF-DAY DEFAULTS (unless user specifies times)
- workout: 07:00–08:00
- body/health routines: 08:00–08:30
- business/deep work: 09:00–11:00
- reflection/journaling: 20:00–20:30

TIME PLACEMENT RULES (CRITICAL)
Choose event times that match the user’s intent and real-world context.
If the flow is about meals:
  breakfast: 07:00–08:00
  lunch: 12:00–13:00
  dinner: 18:00–19:30
The second daily note (reflection / recap / mental reps / evening note) must always be in the evening:
  20:00–20:30 by default (or 20:00–20:12 if brief).
Keep start times consistent across days unless the user implies otherwise.

MULTI-EVENT PER DAY
- If MULTI_EVENT_OK=true, create 2 notes/day_index when appropriate:
  main session + evening mental-only anchor.
- Do not create more than 3 notes per day_index unless the user explicitly requests it.

FLOW FORMAT ADAPTATION
- If FLOW_FORMAT=MEAL_PLAN, do NOT create evening reflection notes unless the user explicitly asks for them.
- If THREE_MEALS_PER_DAY=true, create breakfast, lunch, and dinner notes for every day_index instead of one daily summary note.
- Each meal note should be concrete and usable: foods first, then the benefit of that meal.
- If FLOW_FORMAT=REGIMEN, a short reflective close is good and an evening note is allowed when MULTI_EVENT_OK=true.
- If FLOW_FORMAT=PROJECT_PLAN, notes should move a real build/repair/admin deliverable forward with tools, materials, checks, or decisions. Do not force wellness-style reflection notes.
- If FLOW_FORMAT=FINANCE_PLAN, notes should center on numbers, documents, comparisons, applications, approvals, or decisions. Do not invent amounts.
- If FLOW_FORMAT=SYNTHESIS, turn long-form material into the strongest sequence of concrete checkpoints while preserving the user's voice and themes.
- If FLOW_FORMAT=STANDARD, infer the best note shape from the material instead of defaulting to a workout/session template.

ORIENTATION AND REFLECTION
- A short orientation sentence at the start of a note is good when it helps the user locate the purpose of the day.
- A brief closing line about the benefit, verification point, or reflection is good when it deepens connection to the flow.
- Do not create a separate reflection note unless MULTI_EVENT_OK=true or the user explicitly asks for it.

DETAILS WRITING STYLE (CRITICAL)
- Write details like a natural ChatGPT message the user would actually want in their calendar.
- Avoid big labeled sections/headings. Do not use numbered lists in visible details. Avoid repeating the same label pattern across days.
- Do NOT use meta phrases like "This reinforces..." or "Why this works..." or "Journal Anchor:".
  If you explain why, do it as a single natural sentence and vary it across days.
- Avoid generic grounding filler (e.g., "take a deep breath", "relax your shoulders") unless it’s domain-specific and concrete.
- Keep the tone calm, clear, and grounded. A lightly wisdom-guided cadence is fine; mystical filler is not.
- Keep it practical, specific, and execution-ready.
- Use domain specifics: tools, workspace, ingredients, instrument, IDE, file names, temperatures, durations, reps, etc.
- Assume the user is a capable beginner unless they explicitly ask for advanced, terse, expert, or professional-level instructions.
- When a note uses a technical term, setup convention, artifact, or shorthand, define only what the user needs to act today. For example, say what goes on a map/chart, name the movements in a circuit, or define standard guitar tuning as E-A-D-G-B-E from lowest to highest.

EXPERT MAIN SESSION RULE (MAIN SESSION ONLY)
Required structure
- Short opener sentence.
- One primary action with at most two supporting sub-actions, written as prose.
- Final 1-line close.
- This rule applies only when FLOW_FORMAT=REGIMEN.

Required content density
- ≥1 measurable element (number, unit, duration, range, count, tolerance).
- ≥1 adjustment instruction.
- ≥1 domain artifact.

Technical craft (when TECHNICAL_CRAFT=true)
- If the description implies equipment, measurements, physical components, code, instruments, or procedural skill-building, require ≥3 of: specific parts/values; tool/meter setting; expected output range; safety constraint; debug fork; logging/documentation output.
- Do not enumerate domains; TECHNICAL_CRAFT is set by the handler.

EVENING NOTE DEPTH LIMIT
- Keep it concise.
- Do NOT add additional technical depth or measurable constraints.
- Evening note is never the main-session note; exclude it from main-session structure validation and repair.

EXPERTISE ESCALATION RULE
Across the full flow:
- Early days = foundational technical control.
- Middle days = layered complexity and constraints.
- Final days = integration under realistic performance conditions.
- Expertise should compound naturally across day_index. Do not repeat the same technical cue twice in the flow.

MODE=DICTATION
- Keep source structure literal. You may add a brief setup/orientation sentence or one expert execution cue, but do not replace, flatten, or omit the source details and links.

SOURCE-GROUNDED ORGANIZATION
- If SOURCE_HANDLING=PRESERVE_STRUCTURE: keep obvious day-by-day order, titles, times, and links literal unless they break schema rules.
- In PRESERVE_STRUCTURE, the final note should still feel guided: keep the user/source details intact, but it is allowed to prepend a short orientation or execution cue and end with one concise adjustment/reflection sentence.
- If the user says not to change details, preserve details, do not simplify, keep wording, or similar: retain the original detail density and phrasing as much as possible and only normalize enough to fit the schema.
- If SOURCE_HANDLING=SYNTHESIZE_FROM_SOURCE: treat SOURCE_TEXT as raw material to organize. Extract the real initiatives, constraints, milestones, decisions, and repeated themes, then sequence them into the strongest progression for the requested range.
- In SYNTHESIZE_FROM_SOURCE, cluster related material, compress repetition, and pick what is actionable. Do not flatten rich source material into generic habit language.
- Notes, chat logs, transcripts, and book passages should become concrete sessions, checkpoints, and outputs while staying faithful to the source content and voice.

ANTI-MECHANICAL VARIATION (HARD)
- Never repeat the exact same sentence in two different notes (including evening notes).
- Never start two consecutive day_index notes with the same 3-word phrase.
- Avoid recurring openers like "Set up:", "Today's focus:", "Do this first:".
- Vary sentence rhythm and length. Some notes tight/direct. Some slightly descriptive.
- Vary wording across days, but keep visible details in compact prose rather than numbered instructions.
- Avoid motivational cliches.

SECOND NOTE (when MULTI_EVENT_OK=true)
- Create an evening note most days (20:00–20:30 by default). It must be mental-only (no physical tasks), 5–12 minutes, and must not look templated.
- Even day_index → pattern lock or replay (formats C or D).
- Odd day_index → recap or future-self (formats A or B).

Evening note formats (rotate; do not use the same format two nights in a row):
A) Tiny recap (3–4 sentences): what mattered / what shifted / what to try next.
B) Future-self postcard (4–6 sentences): speak from the future, name one specific win from today.
C) Replay the hardest 10 seconds: rewrite the approach in one clean sentence, then one vivid image cue.
D) Pattern lock (optional): one vivid image or phrase tied to ONE concept from today, explained simply.

Image cues must stay simple: one image, one concept, no elaborate mnemonic systems.

PATTERNING RULE
- Keep start time consistent across days unless user specifies otherwise.
- Do NOT repeat ritual text daily.
- If you include a start/end cue, keep it to one short line and keep it domain-specific.

CHIPS
- If chips are included, set chips = [(day_index % 10) + 1] unless the user provides a specific decan day.`;

// ---- LLM JSON schema for ai_generate_flow ----
type LLMNote = {
  day_index: number; // 0-based offset from startDate
  title: string;
  details: string;
  allDay: boolean;
  startsAt: string; // "HH:MM" 24h
  endsAt: string; // "HH:MM" 24h
  chips?: number[]; // decan day chips 1–10 (used by the model, NOT stored in DB)
  location?: string;
};

type LLMOverview = {
  title: string;
  summary: string;
};

type LLMFlow = {
  flowName: string;
  overview?: LLMOverview;
  notes: LLMNote[];
};

type LLMPlanEnvelope = {
  flowName: string;
  overview?: LLMOverview;
  plan_spec: unknown;
};

// Internal parsed shapes (no chips stored)
// ✅ REFACTOR: Removed all date logic - Flutter is the only time authority
type ParsedNote = {
  day_index: number; // 0-based offset from start date (Flutter will compute actual date)
  title: string;
  details: string;
  all_day: boolean;
  start_time?: string; // "HH:mm" format (optional, Flutter will default if missing)
  end_time?: string; // "HH:mm" format (optional)
  location?: string; // optional location field
  action_id?: string;
  behavior_payload?: PlanBehaviorPayload | null;
};

type ParsedFlow = {
  flow_name: string;
  flow_color?: string; // hex color (optional, Flutter will use fallback)
  overview_title: string;
  overview_summary: string;
  notes: ParsedNote[];
  ai_metadata?: {
    generated: boolean;
    model: string;
    prompt?: string;
  };
};

type FlowType = "meal" | "workout" | "body" | "business" | "generic";
type MealSlot = "breakfast" | "lunch" | "dinner";

type YouTubeResource = {
  title: string;
  url: string;
  whyRelevant?: string | null;
  creator?: string | null;
  durationText?: string | null;
};

type OutcomeVectorV1 = {
  vector_version?: string;
  window_start?: string | null;
  window_end?: string | null;
  flow_id?: number | null;
  origin_type?: string | null;
  origin_generation_id?: string | null;
  schedule_density?: number | null;
  journal_density?: number | null;
  events_total?: number | null;
  events_completed?: number | null;
  completion_ratio?: number | null;
  badge_count?: number | null;
  edit_count?: number | null;
  edit_pressure?: number | null;
  accepted_as_is?: boolean | null;
  outcome_confidence?: string | null;
  lower_bounds?: Record<string, boolean>;
  journal_days?: number | null;
  scheduled_days?: number | null;
  n_days?: number | null;
};

function usesSessionStyleStructure(flowFormat: FlowFormat): boolean {
  return flowFormat === "REGIMEN";
}

function buildFlowFormatPromptBlock(args: {
  flowFormat: FlowFormat;
  threeMealDailyFlow?: boolean;
}): string {
  const { flowFormat, threeMealDailyFlow = false } = args;
  switch (flowFormat) {
    case "MEAL_PLAN":
      return `MEAL_PLAN_RULE:
- This is a meal-plan flow.
- Do not create generic daily-summary notes or separate evening reflection notes unless the user explicitly asks for them.
- Every meal note must name concrete foods first, then explain 1-2 direct benefits of that specific meal in plain language.
${
        threeMealDailyFlow
          ? "- For EVERY day_index, create exactly 3 meal notes: breakfast, lunch, and dinner.\n- Use breakfast 07:00-08:00, lunch 12:00-13:00, dinner 18:00-19:30 unless SOURCE_TEXT gives different times.\n- Titles should make the meal obvious."
          : "- If the user only asked for one meal category, keep notes scoped to that meal category."
      }`;
    case "PROJECT_PLAN":
      return `PROJECT_PLAN_RULE:
- This is a build/repair/admin project flow.
- Each note should advance a concrete deliverable, diagnosis, procurement step, paperwork item, or decision.
- Open with a short orientation sentence, then give 1-3 concrete steps or checks, then close with one sentence about what to verify or decide next.
- Name tools, materials, parts, measurements, budgets, documents, or contacts when relevant.
- If the source is messy, infer the real workstream and stage it in a practical order instead of mirroring noise.
- Do not add wellness-style reflection filler or forced evening recap notes unless the user asked for them.`;
    case "FINANCE_PLAN":
      return `FINANCE_PLAN_RULE:
- This is a money/budget/loan flow.
- Each note should identify the task, the documents or numbers needed, and why that task matters.
- Favor concrete actions like gather statements, compare rates, call lender, update budget, submit application, or review terms.
- If exact amounts are missing, say what to calculate or verify instead of inventing numbers.
- A brief opening orientation and a one-line decision or verification close are good when they sharpen the task.
- Do not force workout-style rehearsal language or evening reflection notes unless the user explicitly asks for that format.`;
    case "SYNTHESIS":
      return `SYNTHESIS_RULE:
- The source is reflective, exploratory, or long-form.
- Distill it into the strongest progression of actions and checkpoints without flattening the user's voice.
- Each note should include a short orientation, one concrete action/output, and one concise reflection or adjustment sentence.
- Do not force workout/session-style bullets unless the material clearly wants that structure.`;
    case "REGIMEN":
      return `REGIMEN_RULE:
- This is a repeatable regimen, routine, practice, or training flow.
- Keep notes execution-ready, progressive, and anchored in the source material.
- Open with concrete setup, keep the work measurable, and end with a short note-to-self close.
- A short reflective close is good, and an evening note is acceptable when the structure genuinely benefits from it.
- If the routine naturally has separate daily phases, such as morning care plus night care, training plus recovery, or practice plus review, make those phases separate notes instead of hiding one inside a reflection. Keep the evening reflection/check-in as its own concise mental note when SHORT_FLOW_REFLECTION_RULE applies.`;
    default:
      return `GENERAL_FLOW_RULE:
- Infer the best note shape from the user's material instead of forcing a single template.
- Keep notes concrete, useful, and faithful to the source.
- A short orientation at the top and a brief benefit/check/reflection line at the end are good when they genuinely help the user connect to the flow.`;
  }
}

function buildFlowFormatRetryReminder(args: {
  flowFormat: FlowFormat;
  threeMealDailyFlow?: boolean;
}): string {
  const { flowFormat, threeMealDailyFlow = false } = args;
  switch (flowFormat) {
    case "MEAL_PLAN":
      return `\nMEAL PLAN REMINDER: keep foods concrete and explain the benefit of each meal.${
        threeMealDailyFlow
          ? " Each day_index must include breakfast, lunch, and dinner as separate notes."
          : ""
      }`;
    case "PROJECT_PLAN":
      return "\nPROJECT FLOW REMINDER: each note should move a real deliverable, diagnosis, procurement step, or verification step forward.";
    case "FINANCE_PLAN":
      return "\nFINANCE FLOW REMINDER: each note should name the documents, numbers, comparisons, or decisions involved.";
    case "SYNTHESIS":
      return "\nSYNTHESIS REMINDER: distill the source into concrete checkpoints without flattening the user's themes or voice.";
    case "REGIMEN":
      return "\nREGIMEN REMINDER: keep notes progressive, measurable, and practice-oriented.";
    default:
      return "\nFLOW REMINDER: infer the right structure from the user's material instead of defaulting to a generic session template.";
  }
}

function buildPlanSpecPromptBlock(args: {
  flowFormat: FlowFormat;
  schemaVersion: string;
}): string {
  if (args.schemaVersion !== "flowspec_v2") return "";

  const domainRule = (() => {
    switch (args.flowFormat) {
      case "FINANCE_PLAN":
        return "- Finance notes should center on documents, numbers, automation, comparisons, and decision rules.";
      case "MEAL_PLAN":
        return "- Nutrition notes should still make the concrete action and done criteria obvious.";
      case "PROJECT_PLAN":
        return "- Project notes should define the deliverable, check, or decision that proves progress.";
      case "REGIMEN":
        return "- Regimen notes should make the cue, done criteria, and fallback version explicit in the action itself.";
      case "SYNTHESIS":
        return "- Synthesis notes should turn reflection into a clear next action with a visible output.";
      default:
        return "- Each note should point to the next concrete action the user can actually complete.";
    }
  })();

  return `ACTION_QUALITY_RULES:
- Every meaningful note must make clear: the one primary thing to do, when or after what cue to do it, and what counts as done. Include minimum version, missed-action recovery, or tracking only when it fits naturally; do not cram every support layer into every visible note.
- Write those details in plain language, as 2-4 useful calendar sentences or short lines. Do not expose schema labels like "Do:", "Cue:", "Minimum:", "Stretch:", "If missed:", or "Track:" in the user-visible calendar text, and do not append the same cue/fallback/track checklist to every note.
- Avoid stock coaching language such as "begin your practice", "focused overview", "key concepts", "dedicate the last", and "aim to" unless the user's source uses those words. Prefer concrete verbs and objects from the actual goal.
- Keep titles concrete. Reject vague titles like "Review" or "Practice" unless the note itself makes the done criteria specific.
- Favor direct goal actions over generic support filler.
- For learning flows, do not make reading, reviewing, or taking notes the whole action. Turn source work into active recall, self-quiz, teach-back, worked examples, correction, and a named output the user can inspect.
- For fitness flows, default toward progression and recovery awareness.
${buildConcreteActionDefaultsRule()}
${buildNoviceClarityRule()}
${buildEventDetailDensityRule()}
${domainRule}`;
}

function buildVisibleNoteQualityPromptBlock(args: {
  flowFormat: FlowFormat;
}): string {
  const domainRule = (() => {
    switch (args.flowFormat) {
      case "FINANCE_PLAN":
        return "- For finance notes, name the exact document, number, comparison, or decision the user should handle.";
      case "MEAL_PLAN":
        return "- For meal notes, name concrete foods first. Do not turn the meal into abstract nutrition advice.";
      case "PROJECT_PLAN":
        return "- For project notes, name the artifact, tool, file, part, call, or verification step that moves the work forward.";
      case "REGIMEN":
        return "- For regimen notes, keep the practical session structure, but avoid repeating the exact same opener/fallback language across days.";
      case "SYNTHESIS":
        return "- For synthesis notes, preserve the user's concrete themes and turn them into useful checkpoints, not generic habit language.";
      default:
        return "- Match the note shape to the user's actual goal instead of forcing a universal template.";
    }
  })();

  return `VISIBLE_NOTE_QUALITY_RULES:
- The visible details field is the product. Write it like a helpful expert giving the user the next useful step, not like a schema checklist.
- Do not repeat the event's start time just because the calendar already stores it. Mention time only when it changes how the user should prepare or sequence the work.
- If the goal contains specialized terms and the user did not say they are already advanced, start from a plain-language foothold before assigning practice. Do not assume the user already knows the concept.
- Do not say "related problems", "key concepts", or "review the basics" without naming what the user should actually look at, produce, compare, solve, define, or check.
- Do not invent textbooks, chapters, lab equipment, physical experiments, tools, source materials, or study partners the user did not provide. For abstract academic topics, use a definition, analogy, toy example, guided question, or worked prompt before asking for independent practice.
- A strong note usually has a short orientation, one primary action, one or two supporting sub-actions, and one useful close such as a question to bring forward, a verification point, or a reflection prompt.
- Never use numbered lists in visible details. If the source has numbered material, convert it into compact prose unless the user explicitly asks to preserve source numbering.
- Fallbacks and tracking are useful, but do not append the same fallback/track lines to every note. Include them only when they read naturally and help the user act.
${buildConcreteActionDefaultsRule()}
${buildNoviceClarityRule()}
${buildEventDetailDensityRule()}
${domainRule}`;
}

function looksLikeAcademicLearningRequest(
  description?: string | null,
  sourceText?: string | null,
): boolean {
  const text = `${description ?? ""}\n${sourceText ?? ""}`;
  return /\b(study|studying|learn|learning|practice|exam|quiz|recall|flashcards?|homework|chapter|textbook|concept|principle|theory|language|vocabulary|symbol|medu neter|math|physics|chemistry|biology|quantum|mechanics|calculus|history)\b/i
    .test(text);
}

function buildAcademicLearningPromptBlock(args: {
  description?: string | null;
  sourceText?: string | null;
}): string {
  if (!looksLikeAcademicLearningRequest(args.description, args.sourceText)) {
    return "";
  }
  return `ACADEMIC_LEARNING_RULE:
- Treat this as a learning/tutoring flow, not a lab protocol, workout session, or generic productivity routine.
- Do not invent equipment, experiments, calculators, textbooks, chapters, readings, worksheets, or partners unless the user supplied them.
- When the user names a concept, assume they may need a foothold. Start with a plain-language definition or contrast, then give a small guided practice step.
- Good study actions include: explain the term in your own words, compare two ideas, make a simple analogy, work through a tiny example, self-quiz from memory, correct one misunderstanding, and write the next question.
- Avoid vague assignments like "solve related problems" unless you spell out what the problem looks like or give a toy prompt the user can answer without extra materials.
- For abstract science topics, prefer conceptual walkthroughs and toy examples over physical demonstrations unless the user explicitly asks for an experiment.`;
}

function buildPlanSpecRetryReminder(schemaVersion: string): string {
  if (schemaVersion !== "flowspec_v2") return "";
  return "\nFLOWSPEC_V2 REMINDER: each note should imply a clear cue, done criteria, minimum version, miss recovery, and trackable result.";
}

function buildPlannerDecisionMatrixPromptBlock(args: {
  classification: ReturnType<typeof classifyIntent>;
  decisionMatrix: PlanDecisionMatrixV2;
}): string {
  const { classification, decisionMatrix } = args;
  return [
    "PLANNER_DECISION_MATRIX:",
    `- DOMAIN: ${classification.domain}`,
    `- GOAL_TYPE: ${classification.goal_type}`,
    `- COMPLEXITY: ${classification.complexity}`,
    `- RISK_TIER: ${classification.risk_tier}`,
    `- CUE_TYPE: ${decisionMatrix.cue_type}`,
    `- PRIMARY_STRATEGY: ${decisionMatrix.strategy_kind}`,
    `- MAX_ACTIONS_PER_DAY: ${decisionMatrix.max_actions_per_day}`,
    `- MINIMUM_DURATION_MIN: ${decisionMatrix.minimum_duration_min}`,
    `- FALLBACK_STRICTNESS: ${decisionMatrix.fallback_strictness}`,
    `- REVIEW_INTERVAL_DAYS: ${decisionMatrix.review_day_interval}`,
    `- DOWN_SHIFT_REQUIRED: ${decisionMatrix.downshift_required}`,
    classification.unstable_schedule
      ? "- SCHEDULE_STABILITY: variable; prefer situational cues over rigid clock times."
      : "- SCHEDULE_STABILITY: stable; time cues are acceptable when useful.",
    classification.high_stress
      ? "- STRESS_LOAD: high; keep the minimum version short and protective."
      : "- STRESS_LOAD: manageable; ramp only when adherence is stable.",
    classification.scatter_risk
      ? "- SCATTER_RISK: elevated; keep finish criteria tight and parallel work low."
      : "- SCATTER_RISK: moderate; keep the sequence legible.",
  ].join("\n");
}

function buildPlannerFirstSystemPrompt(): string {
  return `You are a senior behavioral planner. Output JSON only with no markdown.

Return this exact top-level shape:
{
  "flowName": string,
  "overview": { "title": string, "summary": string },
  "plan_spec": {
    "version": "flowspec_v2",
    "goal": {
      "title": string,
      "domain": string,
      "source": "direct" | "source_text" | "mixed",
      "goal_type": "learning" | "performance",
      "success_definition": string,
      "horizon_days": number
    },
    "readiness_profile": {
      "complexity": "low" | "medium" | "high",
      "risk_tier": "low" | "medium" | "high",
      "schedule_stability": "stable" | "variable",
      "stress_load": "low" | "medium" | "high",
      "completion_pressure": "low" | "medium" | "high",
      "attention_style": "focused" | "scattered" | "unknown"
    },
    "strategy": {
      "primary": string,
      "supports": string[],
      "cue_type": "clock" | "situational" | "preceding_event" | "place" | "social",
      "daily_dose": {
        "max_actions": number,
        "minimum_duration_min": number,
        "ramp": "steady" | "conservative" | "progressive"
      },
      "fallback_strictness": "gentle" | "standard" | "strict",
      "rationale": string[]
    },
    "milestones": [{
      "milestone_id": string,
      "title": string,
      "target_day_index": number,
      "success_signal": string,
      "action_ids": string[]
    }],
    "actions": [{
      "action_id": string,
      "title": string,
      "definition_of_done": string,
      "duration_min": number,
      "trigger": string,
      "context_anchor": string,
      "learning_mode": string,
      "minimum_version": string,
      "stretch_version": string,
      "obstacle_plan": {
        "if_low_time": string,
        "if_distracted": string,
        "if_missed": string
      },
      "metric_keys": string[],
      "evidence_tags": string[],
      "risk_tier": "low" | "medium" | "high",
      "scheduled_day_index": number,
      "render_hints": {
        "details": string,
        "all_day": boolean,
        "start_time": string | null,
        "end_time": string | null,
        "location": string | null
      }
    }],
    "metrics": [{
      "key": string,
      "label": string,
      "type": "count" | "boolean" | "rating" | "duration_min",
      "target": string
    }],
    "review_loop": {
      "cadence": "weekly",
      "day_interval": number,
      "prompt_questions": string[],
      "adjusters": string[]
    },
    "support_layers": {
      "cue_type": string,
      "environment": string[],
      "fallback_strictness": string,
      "accountability": string[],
      "downshift_step": string | null
    },
    "safety_flags": [{
      "code": string,
      "severity": "info" | "warning",
      "message": string
    }]
  }
}

Hard requirements:
- Cover every day_index from 0 through N-1 with at least one action.
- Use plan_spec as the source of truth. Do not return notes.
- Keep titles concrete and specific.
- Hidden action metadata should include a real trigger, a done definition, a minimum version, a missed-action recovery, and metric keys.
- render_hints.details must sound like plain calendar language from a helpful person, not raw schema text. Use 2-4 concrete sentences or short lines. Integrate only the support that helps the user act; do not append a repeated cue/fallback/track checklist.
- render_hints.details should center on one primary job with no more than two supporting sub-actions. If more work matters, create another action instead of packing one event.
- Assume the user is a capable beginner unless they explicitly ask for advanced, terse, expert, or professional-level instructions. Define technical terms, setup conventions, artifacts, and shorthand the first time they matter for action.
- For learning actions, make passive source work active: close the source, recall, teach back, solve or apply, check mistakes, and leave a concrete output. Do not use "read chapters and take notes" as the full plan.
- Avoid stale boilerplate such as "begin your practice", "focused overview", "key concepts", "dedicate the last", and "aim to" unless those words come from the user's source.
- If exact clock times are unclear, set render_hints.start_time/end_time to null and rely on the trigger text.
- Use conservative defaults for finance, health, athletic, and other higher-risk requests.
- Do not mention knowledge graphs, matrices, telemetry, or internal policy language.`;
}

function parsePlanEnvelopeFromResponse(text: string): LLMPlanEnvelope | null {
  const cleaned = stripCodeFences(text);
  const parseObject = (input: string): LLMPlanEnvelope | null => {
    try {
      const parsed = JSON.parse(input);
      const flowName = String(
        parsed?.flowName ?? parsed?.flow_name ?? "",
      ).trim();
      const overviewRaw = parsed?.overview;
      const overview = overviewRaw && typeof overviewRaw === "object"
        ? {
          title: String(overviewRaw.title ?? flowName ?? "").trim(),
          summary: String(overviewRaw.summary ?? "").trim(),
        }
        : undefined;
      const planSpec = parsed?.plan_spec ?? parsed?.planSpec ?? null;
      if (!flowName || !planSpec || typeof planSpec !== "object") return null;
      return {
        flowName,
        overview,
        plan_spec: planSpec,
      };
    } catch {
      return null;
    }
  };

  return parseObject(cleaned) ??
    (() => {
      const match = cleaned.match(/\{[\s\S]*\}/m);
      return match ? parseObject(match[0]) : null;
    })();
}

function transformPlanEnvelopeToParsedFlow(args: {
  envelope: LLMPlanEnvelope;
  planSpec: PlanSpecV2;
}): ParsedFlow {
  const { envelope, planSpec } = args;
  const notes = renderNotesFromPlanSpec({ planSpec });
  return {
    flow_name: envelope.flowName,
    overview_title: envelope.overview?.title?.trim() || envelope.flowName,
    overview_summary: envelope.overview?.summary?.trim() || "",
    notes: notes.map((note) => ({
      day_index: note.day_index,
      title: note.title,
      details: note.details,
      all_day: note.all_day,
      start_time: note.start_time ?? null,
      end_time: note.end_time ?? null,
      location: note.location ?? null,
      action_id: note.action_id,
      behavior_payload: note.behavior_payload ?? null,
    })),
  };
}

type ConstraintsV1 = {
  constraints_version: "constraints_v1";
  eligible_vectors: number;
  sample_days: number | null;
  signals: {
    avg_completion_ratio?: number;
    avg_events_per_day?: number;
    avg_edit_pressure?: number;
  };
  limits: {
    max_events_per_day?: number;
  };
};

type ReflectionProfileRow = {
  top_nodes?: Array<{ slug?: string; score?: number | null }> | null;
  top_edges?:
    | Array<{
      source?: string;
      target?: string;
      score?: number | null;
    }>
    | null;
  dominant_patterns?: string[] | null;
  tension_pairs?: string[][] | null;
  maat_score?: number | null;
  isfet_risk_score?: number | null;
  last_computed_at?: string | null;
};

type FlowDecisionMatrixV1 = {
  version: "kg_dm_v1";
  anchorNodes: string[];
  dominantPatterns: string[];
  tensionPairs: string[];
  balanceMode: "reduce_scatter" | "reinforce_structure" | "neutral";
  promptBlock: string;
  fingerprint: Record<string, unknown>;
};

function roundTo(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function toNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeOutcomeVector(raw: any): OutcomeVectorV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const vectorVersion = raw.vector_version ?? raw.vectorVersion;
  if (vectorVersion && vectorVersion !== "ov_v1") return null;
  const lowerBounds = raw.lower_bounds && typeof raw.lower_bounds === "object"
    ? raw.lower_bounds
    : {};

  return {
    vector_version: (vectorVersion as string) ?? "ov_v1",
    window_start: raw.window_start ?? raw.windowStart ?? null,
    window_end: raw.window_end ?? raw.windowEnd ?? null,
    flow_id: toNumber(raw.flow_id),
    origin_type: raw.origin_type ?? null,
    origin_generation_id: raw.origin_generation_id ?? null,
    schedule_density: toNumber(raw.schedule_density),
    journal_density: toNumber(raw.journal_density),
    events_total: toNumber(raw.events_total),
    events_completed: toNumber(raw.events_completed),
    completion_ratio: toNumber(raw.completion_ratio),
    badge_count: toNumber(raw.badge_count),
    edit_count: toNumber(raw.edit_count),
    edit_pressure: toNumber(raw.edit_pressure),
    accepted_as_is: typeof raw.accepted_as_is === "boolean"
      ? raw.accepted_as_is
      : null,
    outcome_confidence: typeof raw.outcome_confidence === "string"
      ? raw.outcome_confidence
      : null,
    lower_bounds: lowerBounds,
    journal_days: toNumber(raw.journal_days),
    scheduled_days: toNumber(raw.scheduled_days),
    n_days: toNumber(raw.n_days),
  };
}

function averageSafe(values: Array<number | null | undefined>): number | null {
  const nums = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, n) => acc + n, 0);
  return roundTo(sum / nums.length, 4);
}

function isVectorEligible(v: OutcomeVectorV1): boolean {
  const nDays = typeof v.n_days === "number" ? v.n_days : null;
  const eventsTotal = typeof v.events_total === "number" ? v.events_total : 0;
  const eventsCompleted = typeof v.events_completed === "number"
    ? v.events_completed
    : 0;

  if (eventsCompleted >= 3) return true;
  if (nDays !== null && nDays >= 5 && eventsTotal >= 5) return true;
  return false;
}

function deriveConstraintsV1(vectors: OutcomeVectorV1[]): ConstraintsV1 {
  const all = vectors ?? [];

  const capacityEligible = all.filter((v) => {
    const nDays = toNumber(v.n_days);
    const eventsTotal = toNumber(v.events_total);
    const eventsCompleted = toNumber(v.events_completed);
    if (eventsCompleted !== null && eventsCompleted >= 3) return true;
    if (
      nDays !== null && nDays >= 5 && eventsTotal !== null && eventsTotal >= 5
    ) return true;
    return false;
  });

  const performanceEligible = all.filter((v) => {
    const eventsCompleted = toNumber(v.events_completed);
    return eventsCompleted !== null && eventsCompleted >= 1;
  });

  const sampleDaysRaw = capacityEligible.reduce((acc, v) => {
    const n = typeof v.n_days === "number" ? v.n_days : 0;
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  const sampleDays = sampleDaysRaw > 0 ? Math.min(sampleDaysRaw, 365) : null;

  const avgEventsPerDay = averageSafe(
    capacityEligible.map((v) => {
      const total = toNumber(v.events_total);
      const days = toNumber(v.n_days);
      if (total === null || days === null || days <= 0) return null;
      return total / days;
    }),
  );
  const avgCompletion = averageSafe(
    performanceEligible.map((v) => toNumber(v.completion_ratio)),
  );
  const avgEditPressure = averageSafe(
    performanceEligible.map((v) => toNumber(v.edit_pressure)),
  );

  let maxEventsPerDay: number | null = null;
  if (avgEventsPerDay !== null) {
    maxEventsPerDay = Math.max(1, Math.min(4, Math.round(avgEventsPerDay)));
  }

  const hasPerformanceEvidence = performanceEligible.length > 0;
  if (hasPerformanceEvidence) {
    if (avgCompletion !== null && avgCompletion < 0.55) {
      maxEventsPerDay = maxEventsPerDay === null
        ? 2
        : Math.min(maxEventsPerDay, 2);
    }
    if (avgEditPressure !== null && avgEditPressure > 0.6) {
      maxEventsPerDay = maxEventsPerDay === null
        ? 2
        : Math.min(maxEventsPerDay, 2);
    }
  }
  if (capacityEligible.length === 0) {
    maxEventsPerDay = null;
  }

  const constraints: ConstraintsV1 = {
    constraints_version: "constraints_v1",
    eligible_vectors: capacityEligible.length,
    sample_days: sampleDays,
    signals: {},
    limits: {},
  };

  if (avgEventsPerDay !== null) {
    constraints.signals.avg_events_per_day = roundTo(avgEventsPerDay, 3);
  }
  if (hasPerformanceEvidence && avgCompletion !== null) {
    constraints.signals.avg_completion_ratio = avgCompletion;
  }
  if (hasPerformanceEvidence && avgEditPressure !== null) {
    constraints.signals.avg_edit_pressure = avgEditPressure;
  }
  if (maxEventsPerDay !== null) {
    constraints.limits.max_events_per_day = maxEventsPerDay;
  }

  return constraints;
}

async function fetchOutcomeVectors(
  supabaseClient: any,
  userId: string,
  limit: number = OUTCOME_VECTOR_LIMIT,
): Promise<
  { vectors: OutcomeVectorV1[]; status: "ok" | "error" | "unavailable" }
> {
  if (!supabaseClient || !userId) {
    return { vectors: [], status: "unavailable" };
  }
  try {
    const { data, error } = await supabaseClient
      .rpc("get_recent_outcome_vectors", {
        p_user_id: userId,
        p_limit: limit,
      });
    if (error) {
      console.log(
        "⚠️ get_recent_outcome_vectors error:",
        error.message ?? error,
      );
      return { vectors: [], status: "error" };
    }
    if (!Array.isArray(data)) {
      return { vectors: [], status: "error" };
    }
    const vectors = data
      .map(normalizeOutcomeVector)
      .filter((v): v is OutcomeVectorV1 => !!v);
    return { vectors, status: "ok" };
  } catch (err) {
    console.log("⚠️ get_recent_outcome_vectors threw:", err?.message ?? err);
    return { vectors: [], status: "error" };
  }
}

type PrefsEnvelope = {
  prefs_version?: string | null;
  prefs?: {
    preferred_hours?: number[];
    avoid_hours?: number[];
    [k: string]: any;
  } | null;
  computed_at?: string | null;
  window_days?: number | null;
  timezone?: string | null;
} | null;

async function fetchMyPreferences(supabaseClient: any): Promise<PrefsEnvelope> {
  if (!supabaseClient) {
    return null;
  }
  try {
    const { data, error } = await supabaseClient.rpc("get_my_preferences");
    if (error) {
      console.log("⚠️ get_my_preferences error:", error.message ?? error);
      return null;
    }
    if (!data) {
      return null;
    }
    return data as PrefsEnvelope;
  } catch (err) {
    console.log("⚠️ get_my_preferences threw:", err?.message ?? err);
    return null;
  }
}

async function fetchReflectionProfile(
  supabaseClient: any,
  userId: string,
): Promise<ReflectionProfileRow | null> {
  if (!supabaseClient || !userId) {
    return null;
  }
  try {
    const { data, error } = await supabaseClient
      .from("reflection_profiles")
      .select(
        "top_nodes,top_edges,dominant_patterns,tension_pairs,maat_score,isfet_risk_score,last_computed_at",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.log(
        "⚠️ reflection_profiles fetch error:",
        error.message ?? error,
      );
      return null;
    }
    return (data ?? null) as ReflectionProfileRow | null;
  } catch (err) {
    console.log("⚠️ reflection_profiles fetch threw:", err?.message ?? err);
    return null;
  }
}

function buildFlowDecisionMatrix(
  profile?: ReflectionProfileRow | null,
): FlowDecisionMatrixV1 | null {
  if (!profile) {
    return null;
  }

  const anchorNodes = (profile.top_nodes ?? [])
    .map((node) => node.slug?.trim())
    .filter((slug): slug is string => !!slug)
    .slice(0, 4);
  const dominantPatterns = (profile.dominant_patterns ?? [])
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .slice(0, 4);
  const tensionPairs = (profile.tension_pairs ?? [])
    .map((pair) => pair.filter(Boolean).join(" vs "))
    .filter(Boolean)
    .slice(0, 3);

  const maatScore = toNumber(profile.maat_score);
  const isfetScore = toNumber(profile.isfet_risk_score);
  const balanceMode: FlowDecisionMatrixV1["balanceMode"] =
    maatScore !== null && isfetScore !== null
      ? (isfetScore > maatScore ? "reduce_scatter" : "reinforce_structure")
      : isfetScore !== null && isfetScore > 0
      ? "reduce_scatter"
      : maatScore !== null && maatScore > 0
      ? "reinforce_structure"
      : "neutral";

  if (
    anchorNodes.length === 0 &&
    dominantPatterns.length === 0 &&
    tensionPairs.length === 0 &&
    balanceMode === "neutral"
  ) {
    return null;
  }

  const lines = [
    "DECISION_MATRIX (quality guardrails derived from the user's knowledge graph; use these to improve planning quality, not as user-facing jargon):",
  ];
  if (anchorNodes.length > 0) {
    lines.push(
      `- Keep the flow anchored to these live themes when compatible with the user's request: ${
        anchorNodes.join(", ")
      }.`,
    );
  }
  if (dominantPatterns.length > 0) {
    lines.push(
      `- Favor concrete sessions that continue these patterns through action, not abstraction: ${
        dominantPatterns.join(", ")
      }.`,
    );
  }
  if (tensionPairs.length > 0) {
    lines.push(
      `- Where the request allows, turn these tensions into structure, sequencing, or closure instead of split priorities: ${
        tensionPairs.join(", ")
      }.`,
    );
  }
  if (balanceMode === "reduce_scatter") {
    lines.push(
      "- Current graph balance leans toward disorder risk. Prefer fewer, clearer sessions, stable timing, explicit finish conditions, and less simultaneous sprawl.",
    );
  } else if (balanceMode === "reinforce_structure") {
    lines.push(
      "- Current graph balance rewards structure. Let complexity build progressively, keep the sequence legible, and avoid restarting the arc mid-flow.",
    );
  }
  lines.push(
    "- Do not mention node slugs, graph scores, or decision-matrix language in the output unless the user explicitly asks for that language.",
  );

  return {
    version: "kg_dm_v1",
    anchorNodes,
    dominantPatterns,
    tensionPairs,
    balanceMode,
    promptBlock: lines.join("\n"),
    fingerprint: {
      version: "kg_dm_v1",
      anchor_nodes: anchorNodes,
      dominant_patterns: dominantPatterns,
      tension_pairs: tensionPairs,
      balance_mode: balanceMode,
      maat_score: maatScore,
      isfet_risk_score: isfetScore,
    },
  };
}

// ---- OpenAI helper (Deno fetch, no SDK) ----
type OpenAIMessage = { role: "system" | "user" | "assistant"; content: string };

async function generateWithOpenAI({
  messages,
  model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
  temperature = 0.7,
  max_tokens = 1800,
  signal,
}: {
  messages: OpenAIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}): Promise<{
  ok: boolean;
  modelUsed: string;
  content: string;
  tokensIn: number;
  tokensOut: number;
  raw?: unknown;
  error?: string;
  finishReason?: string;
}> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("MISSING_OPENAI_KEY");

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
      }),
    });
  } catch (e: any) {
    const name = e?.name ?? "";
    const msg = e?.message ?? String(e);
    if (name === "AbortError" || /aborted|timeout/i.test(msg)) {
      return {
        ok: false,
        modelUsed: model,
        content: "",
        tokensIn: 0,
        tokensOut: 0,
        error: `OpenAI request aborted or timed out: ${msg}`,
      };
    }
    return {
      ok: false,
      modelUsed: model,
      content: "",
      tokensIn: 0,
      tokensOut: 0,
      error: msg,
    };
  }

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return {
      ok: false,
      modelUsed: model,
      content: "",
      tokensIn: 0,
      tokensOut: 0,
      error: `HTTP ${res.status}: ${err}`,
    };
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? "";
  const usage = data?.usage ?? {};
  const finishReason = choice?.finish_reason;

  return {
    ok: true,
    modelUsed: data?.model ?? model,
    content,
    tokensIn: usage?.prompt_tokens ?? 0,
    tokensOut: usage?.completion_tokens ?? 0,
    raw: data,
    finishReason, // Add this to detect truncation
  };
}

function normalizeYoutubeUrl(raw: string | null | undefined): string | null {
  return normalizeYoutubeVideoUrl(raw);
}

function dedupeYoutubeResources(
  resources: YouTubeResource[],
): YouTubeResource[] {
  const seen = new Set<string>();
  const out: YouTubeResource[] = [];
  for (const resource of resources) {
    const normalizedUrl = normalizeYoutubeUrl(resource?.url ?? null);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    out.push({
      title: String(resource?.title ?? "").trim() || "YouTube video",
      url: normalizedUrl,
      whyRelevant: resource?.whyRelevant?.trim() || null,
      creator: resource?.creator?.trim() || null,
      durationText: resource?.durationText?.trim() || null,
    });
  }
  return out;
}

function extractOutputTextFromResponsesApi(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const contentPart of item?.content ?? []) {
      if (
        contentPart?.type === "output_text" &&
        typeof contentPart?.text === "string" &&
        contentPart.text.trim()
      ) {
        parts.push(contentPart.text.trim());
      }
    }
  }
  return parts.join("\n").trim();
}

function parseYoutubeResourcesFromJsonValue(value: unknown): YouTubeResource[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as Record<string, unknown>)?.videos)
    ? (value as Record<string, unknown>).videos as unknown[]
    : [];

  const mapped: Array<YouTubeResource | null> = list.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    return {
      title: String(record.title ?? "").trim(),
      url: String(record.url ?? record.link ?? "").trim(),
      whyRelevant: String(
        record.why_relevant ?? record.whyRelevant ?? record.relevance ?? "",
      ).trim() || null,
      creator: String(record.creator ?? record.channel ?? "").trim() || null,
      durationText: String(
        record.duration_text ?? record.durationText ?? record.duration ?? "",
      ).trim() || null,
    };
  });

  return mapped.filter((entry): entry is YouTubeResource =>
    !!entry && !!entry.title && !!entry.url
  );
}

function parseYoutubeResourcesFromResponseText(
  text: string,
): YouTubeResource[] {
  const cleaned = stripCodeFences(text ?? "").trim();
  if (!cleaned) return [];

  const candidates = [cleaned];
  const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/m);
  if (jsonMatch && jsonMatch[0] !== cleaned) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const resources = parseYoutubeResourcesFromJsonValue(parsed);
      if (resources.length > 0) return dedupeYoutubeResources(resources);
    } catch {
      // fall through to URL extraction fallback
    }
  }

  const urlMatches = cleaned.match(
    /\b(?:https?:\/\/|www\.)?(?:m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>()]+/gi,
  ) ?? [];
  return dedupeYoutubeResources(
    urlMatches.map((url) => ({ title: "YouTube video", url })),
  );
}

function extractYoutubeResourcesFromAnnotations(data: any): YouTubeResource[] {
  const resources: YouTubeResource[] = [];
  for (const item of data?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const contentPart of item?.content ?? []) {
      if (contentPart?.type !== "output_text") continue;
      for (const annotation of contentPart?.annotations ?? []) {
        const normalizedUrl = normalizeYoutubeUrl(annotation?.url ?? null);
        if (!normalizedUrl) continue;
        resources.push({
          title: String(annotation?.title ?? "YouTube video").trim(),
          url: normalizedUrl,
        });
      }
    }
  }
  return dedupeYoutubeResources(resources);
}

async function searchYoutubeResources(args: {
  description: string;
  sourceText?: string | null;
  timezone?: string | null;
  maxResults: number;
}): Promise<
  | {
    ok: true;
    resources: YouTubeResource[];
    modelUsed: string;
    tokensIn: number;
    tokensOut: number;
  }
  | {
    ok: false;
    error: string;
    message: string;
  }
> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      error: "MISSING_OPENAI_KEY",
      message: "OPENAI_API_KEY is not configured",
    };
  }

  const modelCandidates = [
    Deno.env.get("OPENAI_WEB_SEARCH_MODEL") ?? "",
    "gpt-5.4-mini",
    "gpt-5.4",
    Deno.env.get("OPENAI_MODEL") ?? "",
  ].filter(Boolean);
  const models = [...new Set(modelCandidates)];

  const prompt = [
    `Find up to ${args.maxResults} real, public YouTube videos that are directly useful for the user's flow request.`,
    'Return ONLY valid JSON with this shape: {"videos":[{"title":"", "url":"", "why_relevant":"", "creator":"", "duration_text":""}]}',
    "Rules:",
    "- Use exact YouTube video URLs only. No channel pages, no playlists, no non-YouTube domains.",
    "- Prefer instructional or follow-along videos over commentary.",
    "- Keep results tightly relevant to the request and varied enough to cover progression, recovery, or alternatives when useful.",
    "- Do not invent URLs. If you are unsure, omit the item.",
    "",
    "USER_REQUEST:",
    args.description.trim(),
    args.sourceText?.trim()
      ? `\nSOURCE_CONTEXT:\n${String(args.sourceText).trim().slice(0, 2000)}`
      : "",
  ].join("\n");

  const toolVariants = [
    {
      type: "web_search_preview",
      domains: ["youtube.com", "youtu.be"],
      search_context_size: "medium",
      user_location: {
        type: "approximate",
        country: "US",
        timezone: args.timezone ?? undefined,
      },
    },
    { type: "web_search_preview" },
  ];

  const errors: string[] = [];

  for (const model of models) {
    for (const tool of toolVariants) {
      let res: Response;
      try {
        res = await fetch(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            input: prompt,
            tools: [tool],
            temperature: 0,
            max_output_tokens: YOUTUBE_SEARCH_MAX_OUTPUT_TOKENS,
            store: false,
          }),
          signal: AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS),
        });
      } catch (err: any) {
        errors.push(`${model}: ${err?.message ?? String(err)}`);
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        errors.push(`${model}: HTTP ${res.status}: ${errorText}`);
        continue;
      }

      const data = await res.json();
      const resources = dedupeYoutubeResources([
        ...parseYoutubeResourcesFromResponseText(
          extractOutputTextFromResponsesApi(data),
        ),
        ...extractYoutubeResourcesFromAnnotations(data),
      ]).slice(0, args.maxResults);

      if (resources.length > 0) {
        return {
          ok: true,
          resources,
          modelUsed: data?.model ?? model,
          tokensIn: data?.usage?.input_tokens ?? 0,
          tokensOut: data?.usage?.output_tokens ?? 0,
        };
      }
    }
  }

  return {
    ok: false,
    error: "YOUTUBE_SEARCH_FAILED",
    message: errors.join(" | ") || "No relevant YouTube results found",
  };
}

function buildYoutubePromptBlock(resources: YouTubeResource[]): string {
  if (!Array.isArray(resources) || resources.length === 0) return "";
  const lines = [
    "YOUTUBE_LINK_REQUIREMENT:",
    "- The user explicitly asked for real YouTube links.",
    "- Use ONLY URLs from YOUTUBE_RESOURCE_POOL below. Do not invent or alter URLs.",
    "- Put the chosen YouTube URL in the note's location field instead of the details field.",
    "- Prefer assigning a link to the main session note for the day. Reuse the best-fit video when needed instead of fabricating a new link.",
    "",
    "YOUTUBE_RESOURCE_POOL:",
  ];

  for (const [index, resource] of resources.entries()) {
    lines.push(`${index + 1}. ${truncateInline(resource.title, 120)}`);
    lines.push(`   URL: ${resource.url}`);
    if (resource.creator) {
      lines.push(`   Creator: ${truncateInline(resource.creator, 80)}`);
    }
    if (resource.durationText) {
      lines.push(`   Duration: ${truncateInline(resource.durationText, 40)}`);
    }
    if (resource.whyRelevant) {
      lines.push(`   Why: ${truncateInline(resource.whyRelevant, 160)}`);
    }
  }

  return lines.join("\n");
}

const RESOURCE_MATCH_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "along",
  "because",
  "build",
  "calendar",
  "could",
  "daily",
  "each",
  "flow",
  "from",
  "have",
  "into",
  "just",
  "main",
  "more",
  "note",
  "over",
  "practice",
  "real",
  "relevant",
  "session",
  "than",
  "that",
  "their",
  "them",
  "there",
  "these",
  "this",
  "through",
  "today",
  "user",
  "video",
  "videos",
  "with",
  "youtube",
]);

function tokenizeForResourceMatch(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !RESOURCE_MATCH_STOPWORDS.has(part));
}

function scoreYoutubeResource(
  note: ParsedNote,
  resource: YouTubeResource,
  requestTokens: Set<string>,
): number {
  const noteTokens = new Set(
    tokenizeForResourceMatch(`${note.title} ${note.details}`),
  );
  const resourceTokens = new Set(
    tokenizeForResourceMatch(
      `${resource.title} ${resource.whyRelevant ?? ""} ${
        resource.creator ?? ""
      }`,
    ),
  );

  let score = 0;
  for (const token of noteTokens) {
    if (resourceTokens.has(token)) score += 4;
  }
  for (const token of requestTokens) {
    if (resourceTokens.has(token)) score += 2;
  }

  const resourceText = `${resource.title} ${resource.whyRelevant ?? ""}`;
  if (isRestNote(note.title, note.details)) {
    if (
      /(rest|restore|recovery|yin|stretch|mobility|breath|meditation)/i.test(
        resourceText,
      )
    ) {
      score += 6;
    }
  } else if (
    /(tutorial|class|routine|follow along|guide|workout|practice)/i.test(
      resourceText,
    )
  ) {
    score += 3;
  }

  return score;
}

function assignYoutubeLocationsFromResources(
  notes: ParsedNote[],
  resources: YouTubeResource[],
  description: string,
): ParsedNote[] {
  if (!Array.isArray(notes) || notes.length === 0 || resources.length === 0) {
    return notes;
  }

  const byDay = new Map<number, ParsedNote[]>();
  for (const note of notes) {
    const bucket = byDay.get(note.day_index) ?? [];
    bucket.push(note);
    byDay.set(note.day_index, bucket);
  }

  const requestTokens = new Set(tokenizeForResourceMatch(description));
  const unused = new Set(resources.map((_, index) => index));

  for (const dayIndex of [...byDay.keys()].sort((a, b) => a - b)) {
    const mainNote = getMainSessionNote(byDay.get(dayIndex) ?? []) ??
      (byDay.get(dayIndex) ?? [])[0];
    if (!mainNote) continue;
    if ((mainNote.location ?? "").trim()) continue;

    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < resources.length; index++) {
      const score = scoreYoutubeResource(
        mainNote,
        resources[index],
        requestTokens,
      ) + (unused.has(index) ? 1.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) continue;
    mainNote.location = resources[bestIndex].url;
    unused.delete(bestIndex);
  }

  return notes;
}

function sanitizeYoutubeLocations(
  notes: ParsedNote[],
  resources: YouTubeResource[],
  requireVerifiedResourceMatch: boolean,
): ParsedNote[] {
  if (!Array.isArray(notes) || notes.length === 0) return notes;

  const allowedUrls = new Set(
    resources.map((resource) => normalizeYoutubeUrl(resource.url)).filter((
      url,
    ): url is string => !!url),
  );

  for (const note of notes) {
    const rawLocation = (note.location ?? "").trim();
    if (!rawLocation) {
      note.location = null;
      continue;
    }

    if (!looksLikeYoutubeUrl(rawLocation)) {
      note.location = rawLocation;
      continue;
    }

    const normalized = normalizeYoutubeUrl(rawLocation);
    if (!normalized) {
      note.location = null;
      continue;
    }

    if (
      requireVerifiedResourceMatch &&
      (allowedUrls.size === 0 || !allowedUrls.has(normalized))
    ) {
      note.location = null;
      continue;
    }

    note.location = normalized;
  }

  return notes;
}

function sanitizeGeneratedLocations(notes: ParsedNote[]): ParsedNote[] {
  if (!Array.isArray(notes) || notes.length === 0) return notes;

  for (const note of notes) {
    note.location = sanitizeFlowLocation(note.location);
  }

  return notes;
}

function sanitizeVisibleNumberedInstructionDetails(
  notes: ParsedNote[],
): ParsedNote[] {
  if (!Array.isArray(notes) || notes.length === 0) return notes;

  for (const note of notes) {
    note.details = stripVisibleNumberedInstructionListMarkers(note.details);
  }

  return notes;
}

async function parseJsonSafe(req) {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildAnthropicMessages(userPrompt) {
  return [
    {
      role: "user",
      content: userPrompt,
    },
  ];
}

function buildSystemPrompt(): string {
  return `${FLOW_CONTRACT_V3}

${FLOW_RULES_PACK_V1_2}

PRIORITY ORDER (HIGHEST TO LOWEST). If a conflict occurs, drop lower-priority constraints first.
1. Valid JSON + schema compliance
2. Scheduling + day coverage
3. FLOW_FORMAT-fit structure + domain density
4. Natural non-templated tone
5. Anti-mechanical variation
6. Avoidance of repeated phrasing`;
}

async function getPromptFingerprint(systemPrompt?: string): Promise<string> {
  const prompt = systemPrompt ?? buildSystemPrompt();
  return sha256Hex(prompt);
}

let _memoSystemPrompt: string | null = null;
let _memoPromptFingerprintPromise: Promise<string> | null = null;

function getMemoSystemPrompt(): string {
  return (_memoSystemPrompt ??= buildSystemPrompt());
}

/** One SHA-256 per isolate — avoids re-hashing multi‑KB prompts on every invocation. */
function getMemoPromptFingerprint(): Promise<string> {
  return (_memoPromptFingerprintPromise ??= getPromptFingerprint(
    getMemoSystemPrompt(),
  ));
}

const LONG_FLOW_SEGMENT_SYSTEM =
  `You output ONLY valid JSON (no markdown, no code fences).

Schema:
{
  "flowName": string,
  "overview": {"title": string, "summary": string},
  "notes": [
    {
      "day_index": number,
      "title": string,
      "details": string,
      "allDay": boolean,
      "startsAt": "HH:MM",
      "endsAt": "HH:MM",
      "location": string (optional)
    }
  ]
}

Hard rules:
- notes must use only day_index values in the inclusive range the user specifies.
- Cover every day_index in that range at least once.
- If allDay is false: startsAt/endsAt are 24h "HH:MM", endsAt later than startsAt.
- Prefer rounded times (09:00, 12:00, 20:00).
- If the user specifies a direct time or duration, use it consistently for the main session.
- Put direct watch/join URLs in location when a day has a meeting/video link.
- details: usually 45-130 words, concrete, grounded in SOURCE excerpt and segment theme; do not invent facts absent from the excerpt. If FLOW_FORMAT=MEAL_PLAN or FINANCE_PLAN, shorter notes are fine when they remain complete and usable.
- Titles: deliverable-oriented; avoid generic "Day N" placeholders.
- Vary phrasing across days; do not repeat the same opening sentence.`;

function extractAnthropicText(data) {
  if (!data) return "";
  if (
    data?.content &&
    Array.isArray(data.content) &&
    data.content[0]?.text
  ) {
    return String(data.content[0].text);
  }
  if (
    data?.choices &&
    Array.isArray(data.choices) &&
    data.choices[0]?.message?.content
  ) {
    return String(data.choices[0].message.content);
  }
  if (typeof data?.completion === "string") {
    return data.completion;
  }
  return JSON.stringify(data);
}

function stripCodeFences(input) {
  if (!input) return input;
  const fenced = input
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();
  return fenced;
}

const DAY_ORDER = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_LOOKUP: Record<string, string> = {
  sun: "SUN",
  sunday: "SUN",
  mon: "MON",
  monday: "MON",
  tue: "TUE",
  tues: "TUE",
  tuesday: "TUE",
  wed: "WED",
  weds: "WED",
  wednesday: "WED",
  thu: "THU",
  thur: "THU",
  thurs: "THU",
  thursday: "THU",
  fri: "FRI",
  friday: "FRI",
  sat: "SAT",
  saturday: "SAT",
};

function isValidTimeString(value?: string | null): boolean {
  if (!value || typeof value !== "string") return false;
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function timeToMinutes(value?: string | null): number | null {
  if (!isValidTimeString(value)) return null;
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type ScheduleInference = {
  scheduleMode: "DAILY" | "SPECIFIC_DAYS" | "INTERVAL";
  specificDays: string[];
  intervalN?: number;
};

function normalizeSpecificDays(days: Set<string>): string[] {
  const ordered = DAY_ORDER.filter((d) => days.has(d));
  return ordered;
}

function inferSchedule(description: string): ScheduleInference {
  const lower = (description || "").toLowerCase();
  const specificDays = new Set<string>();

  if (/\bweekdays?\b/.test(lower)) {
    ["MON", "TUE", "WED", "THU", "FRI"].forEach((d) => specificDays.add(d));
  }
  if (/\bweekends?\b/.test(lower)) {
    ["SAT", "SUN"].forEach((d) => specificDays.add(d));
  }
  if (/\bmwf\b/i.test(description)) {
    ["MON", "WED", "FRI"].forEach((d) => specificDays.add(d));
  }
  if (/\btth\b/i.test(description) || /\bt\/?th\b/i.test(description)) {
    ["TUE", "THU"].forEach((d) => specificDays.add(d));
  }

  for (const [token, day] of Object.entries(DAY_LOOKUP)) {
    const re = new RegExp(`\\b${token}\\b`, "i");
    if (re.test(description)) specificDays.add(day);
  }

  let intervalN: number | undefined;
  if (specificDays.size === 0) {
    const intervalMatch = lower.match(/every\s+(other|\d+)\s+days?/i);
    if (intervalMatch) {
      intervalN = intervalMatch[1].toLowerCase() === "other"
        ? 2
        : parseInt(intervalMatch[1], 10);
    }
  }

  if (specificDays.size > 0) {
    return {
      scheduleMode: "SPECIFIC_DAYS",
      specificDays: normalizeSpecificDays(specificDays),
    };
  }

  if (intervalN && Number.isFinite(intervalN) && intervalN > 0) {
    return { scheduleMode: "INTERVAL", specificDays: [], intervalN };
  }

  return { scheduleMode: "DAILY", specificDays: [] };
}

function hasExplicitMultiEventRequest(text: string): boolean {
  if (!text) return false;
  return /(two\s+(times|sessions)\s+a\s+day|twice\s+a\s+day|morning\s+and\s+evening|am\s+and\s+pm|both\s+morning\s+and\s+night|split\s+into\s+am\/pm)/i
    .test(
      text,
    );
}

function inferMealSlot(
  title?: string | null,
  details?: string | null,
  startTime?: string | null,
): MealSlot | null {
  const text = `${title ?? ""} ${details ?? ""}`.toLowerCase();
  if (/\b(breakfast|meal\s*1|first meal)\b/.test(text)) {
    return "breakfast";
  }
  if (/\b(lunch|meal\s*2|midday meal)\b/.test(text)) {
    return "lunch";
  }
  if (/\b(dinner|meal\s*3|supper|evening meal)\b/.test(text)) {
    return "dinner";
  }

  const startMinutes = timeToMinutes(startTime);
  if (startMinutes == null) return null;
  if (startMinutes < 10 * 60 + 30) return "breakfast";
  if (startMinutes < 15 * 60 + 30) return "lunch";
  if (startMinutes < 21 * 60) return "dinner";
  return null;
}

function validateThreeMealDailyShape(
  notes: Array<{
    day_index: number;
    title?: string;
    details?: string;
    startsAt?: string;
    start_time?: string;
  }>,
  dateRangeDays: number,
  startDay = 0,
  endDay = dateRangeDays - 1,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const byDay = new Map<number, typeof notes>();

  for (const note of notes ?? []) {
    if (!Number.isInteger(note?.day_index)) continue;
    const bucket = byDay.get(note.day_index) ?? [];
    bucket.push(note);
    byDay.set(note.day_index, bucket);
  }

  for (let dayIndex = startDay; dayIndex <= endDay; dayIndex++) {
    const dayNotes = byDay.get(dayIndex) ?? [];
    if (dayNotes.length < 3) {
      errors.push(`day_index ${dayIndex} has fewer than 3 meal notes`);
      continue;
    }

    const slots = new Set<MealSlot>();
    for (const note of dayNotes) {
      const slot = inferMealSlot(
        note.title,
        note.details,
        note.startsAt ?? note.start_time,
      );
      if (slot) slots.add(slot);
    }

    for (const slot of ["breakfast", "lunch", "dinner"] as MealSlot[]) {
      if (!slots.has(slot)) {
        errors.push(`day_index ${dayIndex} missing ${slot}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function requiresShortFlowReflectionPair(
  dateRangeDays = 0,
  mode: "DICTATION" | "ELABORATION" = "ELABORATION",
  flowFormat: FlowFormat = "STANDARD",
): boolean {
  if (mode === "DICTATION" || !usesSessionStyleStructure(flowFormat)) {
    return false;
  }
  return (
    Number.isFinite(dateRangeDays) &&
    dateRangeDays > 0 &&
    dateRangeDays <= SHORT_FLOW_REFLECTION_PAIR_THRESHOLD_DAYS
  );
}

function inferMultiEventOk(
  mode: "DICTATION" | "ELABORATION",
  flowType: FlowType,
  description: string,
  dateRangeDays = 0,
  flowFormat: FlowFormat = "STANDARD",
): boolean {
  if (requiresShortFlowReflectionPair(dateRangeDays, mode, flowFormat)) {
    return true;
  }
  if (!usesSessionStyleStructure(flowFormat)) {
    return hasExplicitMultiEventRequest(description);
  }
  if (hasExplicitMultiEventRequest(description)) return true;
  if (mode === "DICTATION") return false;

  if (dateRangeDays >= 50) {
    return false;
  }

  // Always allow two anchors for these established categories
  if (
    flowType === "workout" || flowType === "body" || flowType === "business"
  ) return true;

  // For generic flows, only allow two anchors when intent is clearly learning/skill-building
  const learningIntent =
    /(learn|learning|practice|skill|study|train|training|get better|improve|master|drill|retention|memory|reps|mental reps|visualize|visualization)/i
      .test(
        description,
      );

  // Avoid accidentally forcing two anchors for simple "plan my dinners" type requests
  const recipeLike =
    /(recipe|recipes|meal plan|meals|dinner|dinners|menu|shopping list)/i.test(
      description,
    );

  if (recipeLike) return false;

  return learningIntent;
}

function inferTimePreference(
  description: string,
): "morning" | "midday" | "evening" | "none" {
  if (!description) return "none";
  const lower = description.toLowerCase();
  if (/\bmorn(ing)?\b/.test(lower) || /\bdawn\b/.test(lower)) return "morning";
  if (/\bevening\b|\bnight\b/.test(lower)) return "evening";
  if (/\bafternoon\b|\bmidday\b/.test(lower)) return "midday";

  const timeMatch = description.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minutesPresent = typeof timeMatch[2] === "string";
    const meridiem = timeMatch[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (!meridiem && !minutesPresent) return "none";
    if (hour < 11) return "morning";
    if (hour < 16) return "midday";
    return "evening";
  }

  return "none";
}

function detectTechnicalCraft(description: string): boolean {
  if (!description) return false;
  const technicalRe =
    /(equipment|measurement|physical components|code|instruments|procedural|skill-building|voltage|current|resistance|circuit|multimeter|ohm|resistor|breadboard|script|\bide\b|drill|saw|recipe|ingredients|temperature|puck|stick)/i;
  return technicalRe.test(description);
}

function dayNameFromIndex(
  startDateStr: string,
  dayIndex: number,
): string | null {
  const startMs = Date.parse(startDateStr);
  if (Number.isNaN(startMs)) return null;
  const targetMs = startMs + dayIndex * 24 * 60 * 60 * 1000;
  const dayNum = new Date(targetMs).getUTCDay();
  return DAY_ORDER[dayNum] ?? null;
}

function isRestNote(title?: string, details?: string): boolean {
  const text = `${title ?? ""} ${details ?? ""}`.toLowerCase();
  return /(maintain|rest|recover|journal|reflection|check[- ]?in|review)/i.test(
    text,
  );
}

function validateSpecificDays(
  notes: LLMNote[],
  startDate: string,
  allowedDays: string[],
): { ok: boolean; violations: number } {
  if (!allowedDays || allowedDays.length === 0) {
    return { ok: true, violations: 0 };
  }
  const allowed = new Set(allowedDays);
  let violations = 0;

  for (const n of notes || []) {
    if (!Number.isInteger(n?.day_index)) continue;
    const dayName = dayNameFromIndex(startDate, n.day_index);
    if (!dayName || allowed.has(dayName)) continue;
    if (!isRestNote(n.title, n.details)) violations += 1;
  }

  return { ok: violations === 0, violations };
}

function getMainSessionNote(notesForDay: ParsedNote[]): ParsedNote | null {
  if (!Array.isArray(notesForDay) || notesForDay.length === 0) return null;
  if (notesForDay.length === 1) return notesForDay[0];

  const mainCandidates = notesForDay.filter((n) => !isEveningReflectionNote(n));
  if (mainCandidates.length === 0) return null;
  if (mainCandidates.length === 1) return mainCandidates[0];

  const sorted = mainCandidates.slice().sort((a, b) => {
    const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
    const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
    if (aMinutes !== bMinutes) return aMinutes - bMinutes;
    const aLen = (a.details ?? "").length;
    const bLen = (b.details ?? "").length;
    return bLen - aLen;
  });

  return sorted[0] ?? null;
}

function sortParsedNotesByDayAndTime(notes: ParsedNote[]): ParsedNote[] {
  return [...(notes ?? [])].sort((a, b) => {
    if (a.day_index !== b.day_index) return a.day_index - b.day_index;
    const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
    const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
    if (aMinutes !== bMinutes) return aMinutes - bMinutes;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
}

const EVENING_REFLECTION_TITLE_RE =
  /\b(recap|reflection|review|wind down|postcard|memory|peg|insight|journal)\b/i;
const REFLECTION_DETAIL_RE =
  /\b(reflect|reflection|review|recap|journal|write|wrote|note|postcard|replay|pattern lock|mental-only|tomorrow|what changed|friction|adjustment|question)\b/i;

function isEveningReflectionNote(note: ParsedNote): boolean {
  const title = (note.title ?? "").trim();
  const details = (note.details ?? "").trim();
  const text = `${title} ${details}`;
  if (EVENING_REFLECTION_TITLE_RE.test(title)) return true;
  const startMinutes = timeToMinutes(note.start_time);
  if (startMinutes === null) return false;
  const endMinutes = timeToMinutes(note.end_time);
  const durationMinutes = endMinutes !== null
    ? endMinutes - startMinutes
    : null;
  const startsInReflectionWindow = startMinutes >= 19 * 60 + 30 &&
    startMinutes <= 20 * 60 + 30;
  return startsInReflectionWindow &&
    (durationMinutes === null || durationMinutes <= 45) &&
    REFLECTION_DETAIL_RE.test(text);
}

function buildShortFlowReflectionNote(
  dayIndex: number,
  mainNote: ParsedNote | null,
): ParsedNote {
  const cue = (mainNote?.title ?? `Day ${dayIndex + 1}`).trim();
  const templates = [
    {
      title: "Evening recap",
      details:
        `Take 8 quiet minutes to review "${cue}". Name the one move that actually changed the day, the friction point that slowed you down, and the smallest adjustment you want tomorrow. End by writing one sentence that keeps the momentum honest and specific.`,
    },
    {
      title: "Future-self postcard",
      details:
        `Spend 10 minutes writing a short postcard from tomorrow about "${cue}". Mention the specific part you executed well, the part that still needs tightening, and the next visible win you want to land. Keep it reflective and mental-only; do not add more physical work tonight.`,
    },
    {
      title: "Evening replay",
      details:
        `Replay the hardest 10 seconds from "${cue}" in your head for 6-8 minutes. Write one cleaner sentence for how you want to handle that moment next time, then attach one vivid image or cue that will help you remember it when the day starts again.`,
    },
    {
      title: "Pattern lock",
      details:
        `Create one simple pattern lock for "${cue}" during a 5-10 minute reflection. Tie the most important concept from today to one vivid image or phrase, note why that cue matters, and finish with one sentence about what tomorrow should feel easier than today.`,
    },
  ];
  const template = templates[dayIndex % templates.length];
  return {
    day_index: dayIndex,
    title: template.title,
    details: template.details,
    all_day: false,
    start_time: "20:00",
    end_time: "20:30",
    location: null,
  };
}

function buildShortFlowPrimaryFallbackNote(
  dayIndex: number,
  reflectionNote: ParsedNote | null,
): ParsedNote {
  const rawTheme = [
    reflectionNote?.title,
    reflectionNote?.details,
    `Day ${dayIndex + 1}`,
  ].filter(Boolean).join(" ");
  const theme = truncateInline(
    rawTheme
      .replace(EVENING_REFLECTION_TITLE_RE, " ")
      .replace(/\b(at|by)\s+20:?00\b/gi, " ")
      .replace(/\breflect(?:ion)?\b|\breview\b|\brecap\b|\bevening\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || `day ${dayIndex + 1} practice`,
    72,
  );
  const title = theme && !/^day \d+ practice$/i.test(theme)
    ? `Practice ${theme.charAt(0).toLowerCase()}${theme.slice(1)}`
    : "Primary practice block";

  return {
    day_index: dayIndex,
    title,
    details: [
      `Use this block to create one visible rep for ${theme}.`,
      "Pick the smallest move that will make tonight's review easy to answer: what moved, what was still fuzzy, and what comes next.",
      "On a tight day, spend 5 focused minutes and leave one written sentence, solved step, corrected rep, or clear next question.",
      "If the window slips, do that small rep before the evening reflection and keep tomorrow intact.",
    ].join("\n"),
    all_day: false,
    start_time: "09:00",
    end_time: "09:30",
    location: reflectionNote?.location ?? null,
  };
}

function ensureShortFlowReflectionPairs(
  notes: ParsedNote[],
  dateRangeDays: number,
  mode: "DICTATION" | "ELABORATION",
  flowFormat: FlowFormat = "STANDARD",
): ParsedNote[] {
  if (!requiresShortFlowReflectionPair(dateRangeDays, mode, flowFormat)) {
    return notes;
  }

  const grouped = new Map<number, ParsedNote[]>();
  for (const note of notes ?? []) {
    const dayIndex = Number(note?.day_index);
    if (
      !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= dateRangeDays
    ) {
      continue;
    }
    const bucket = grouped.get(dayIndex) ?? [];
    bucket.push({ ...note });
    grouped.set(dayIndex, bucket);
  }

  const normalized: ParsedNote[] = [];
  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    const dayNotes = (grouped.get(dayIndex) ?? []).slice().sort((a, b) => {
      const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
      const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
      return aMinutes - bMinutes;
    });

    if (dayNotes.length === 0) {
      const reflectionNote = buildShortFlowReflectionNote(dayIndex, null);
      normalized.push(
        buildShortFlowPrimaryFallbackNote(dayIndex, reflectionNote),
        reflectionNote,
      );
      continue;
    }

    const actionNotes = dayNotes.filter((note) =>
      !isEveningReflectionNote(note)
    );
    const nonEveningNote = actionNotes[0] ?? null;
    let mainNote = getMainSessionNote(dayNotes) ?? nonEveningNote;
    if (!mainNote || isEveningReflectionNote(mainNote)) {
      mainNote = nonEveningNote ??
        buildShortFlowPrimaryFallbackNote(dayIndex, dayNotes[0] ?? null);
    }
    if (!mainNote) continue;

    const reflectionNote = dayNotes.find((note) =>
      note !== mainNote && isEveningReflectionNote(note)
    ) ??
      buildShortFlowReflectionNote(dayIndex, mainNote);

    const extraActionNotes = actionNotes
      .filter((note) =>
        note !== mainNote
      )
      .slice()
      .sort((a, b) => {
        const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
        const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
        if (aMinutes !== bMinutes) return aMinutes - bMinutes;
        return (b.details ?? "").length - (a.details ?? "").length;
      })
      .slice(0, 1)
      .map((note) => ({ ...note }));
    const pair = [{ ...mainNote }, ...extraActionNotes, { ...reflectionNote }];
    pair.sort((a, b) => {
      const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
      const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
      return aMinutes - bMinutes;
    });

    normalized.push(...pair);
  }

  normalized.sort((a, b) => {
    if (a.day_index !== b.day_index) return a.day_index - b.day_index;
    const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
    const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
    return aMinutes - bMinutes;
  });

  return normalized;
}

function mergeSourceDayHints(
  dateRangeDays: number,
  ...texts: Array<string | null | undefined>
): Map<number, SourceDayHint> {
  const merged = new Map<number, SourceDayHint>();

  for (const text of texts) {
    if (!text) continue;
    const hints = parseSourceDayHints(text, dateRangeDays);
    for (const [dayIndex, hint] of hints.entries()) {
      const existing = merged.get(dayIndex);
      if (!existing) {
        merged.set(dayIndex, { ...hint });
        continue;
      }
      merged.set(dayIndex, {
        ...existing,
        title: existing.title ?? hint.title,
        details: existing.details ?? hint.details,
        location: existing.location ?? hint.location,
        startTime: existing.startTime ?? hint.startTime,
        endTime: existing.endTime ?? hint.endTime,
      });
    }
  }

  return merged;
}

function mergeRecurringSourceRoutineHints(
  dateRangeDays: number,
  ...texts: Array<string | null | undefined>
): RecurringSourceRoutineHint[] {
  const merged: RecurringSourceRoutineHint[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    if (!text) continue;
    const hints = parseRecurringSourceRoutineHints(text, dateRangeDays);
    for (const hint of hints) {
      const key = [
        hint.cadence,
        hint.startDayIndex,
        hint.endDayIndex,
        hint.title.trim().toLowerCase(),
        hint.details.replace(/\s+/g, " ").trim().toLowerCase(),
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(hint);
    }
  }

  return merged;
}

function routineHintAppliesToDay(
  hint: RecurringSourceRoutineHint,
  dayIndex: number,
): boolean {
  return dayIndex >= hint.startDayIndex && dayIndex <= hint.endDayIndex;
}

function looksLikeRecurringRoutineNote(note: ParsedNote): boolean {
  const text = `${note.title ?? ""}\n${note.details ?? ""}`.toLowerCase();
  return /\b(morning|evening|daily)\s+routine\b/.test(text) ||
    /\bcold under-eye reset\b/.test(text) ||
    (
      /\bsunscreen\b/.test(text) &&
      /\bposture reset\b/.test(text) &&
      /\bmoisturizer\b/.test(text)
    );
}

function looksLikeCadenceNote(
  note: ParsedNote,
  cadence: RecurringSourceRoutineHint["cadence"],
): boolean {
  const text = `${note.title ?? ""}\n${note.details ?? ""}`.toLowerCase();
  const start = timeToMinutes(note.start_time);
  if (cadence === "morning") {
    return /\bmorning\b/.test(text) || (start !== null && start < 12 * 60);
  }
  if (cadence === "evening") {
    return /\b(evening|night)\b/.test(text) ||
      (start !== null && start >= 17 * 60);
  }
  return looksLikeRecurringRoutineNote(note);
}

function noteCadenceLabel(
  note: ParsedNote,
): "morning" | "evening" | "daily" | "other" {
  const text = `${note.title ?? ""}\n${note.details ?? ""}`.toLowerCase();
  const start = timeToMinutes(note.start_time);
  if (/\bmorning\b/.test(text) || (start !== null && start < 12 * 60)) {
    return "morning";
  }
  if (
    /\b(evening|night)\b/.test(text) || (start !== null && start >= 17 * 60)
  ) {
    return "evening";
  }
  if (/\bdaily\b/.test(text)) return "daily";
  return "other";
}

function buildRecurringRoutineNote(
  dayIndex: number,
  hint: RecurringSourceRoutineHint,
): ParsedNote {
  const displayHint = calendarizeRecurringSourceRoutineHint(hint);
  const allDay = !displayHint.startTime || !displayHint.endTime;
  return {
    day_index: dayIndex,
    title: displayHint.title,
    details: displayHint.details,
    all_day: allDay,
    start_time: allDay ? null : displayHint.startTime,
    end_time: allDay ? null : displayHint.endTime,
    location: null,
  };
}

function ensureRecurringSourceRoutineNotes(
  notes: ParsedNote[],
  recurringHints: RecurringSourceRoutineHint[],
  dateRangeDays: number,
): ParsedNote[] {
  if (!Array.isArray(notes) || recurringHints.length === 0) return notes;

  const out = notes.map((note) => ({ ...note }));
  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    const dayNotes = out.filter((note) => note.day_index === dayIndex);
    for (const hint of recurringHints) {
      if (!routineHintAppliesToDay(hint, dayIndex)) continue;
      const existing = dayNotes.find((note) =>
        looksLikeCadenceNote(note, hint.cadence) &&
        looksLikeRecurringRoutineNote(note)
      );
      if (existing) {
        existing.title = existing.title?.trim() || hint.title;
        existing.details = hasUnsafeVisibleRepeatReference(existing.details)
          ? hint.details
          : mergePreservedDetails(existing.details, hint.details);
        if (!existing.all_day && hint.startTime && hint.endTime) {
          existing.start_time = existing.start_time ?? hint.startTime;
          existing.end_time = existing.end_time ?? hint.endTime;
        }
        continue;
      }

      out.push(buildRecurringRoutineNote(dayIndex, hint));
    }
  }

  return out;
}

function sourceHintPrefersEvening(hint: SourceDayHint): boolean {
  return sourceHintLooksEveningRoutine(hint);
}

function selectSourceHintTargetNote(
  dayNotes: ParsedNote[],
  hint: SourceDayHint,
): ParsedNote | null {
  if (!Array.isArray(dayNotes) || dayNotes.length === 0) return null;

  const nonRecurring = dayNotes.filter((note) =>
    !looksLikeRecurringRoutineNote(note)
  );
  if (
    nonRecurring.length === 0 && dayNotes.some(looksLikeRecurringRoutineNote)
  ) {
    return null;
  }
  const pool = nonRecurring.length > 0 ? nonRecurring : dayNotes;

  if (sourceHintPrefersEvening(hint)) {
    const evening = pool.find((note) => {
      const start = timeToMinutes(note.start_time);
      const text = `${note.title ?? ""}\n${note.details ?? ""}`.toLowerCase();
      return /\b(night|evening)\b/.test(text) ||
        (start !== null && start >= 17 * 60);
    });
    if (evening) return evening;
  }

  return getMainSessionNote(pool) ?? pool[0] ?? null;
}

function buildSourceHintNote(
  dayIndex: number,
  hint: SourceDayHint,
): ParsedNote {
  const displayHint = calendarizeSourceDayHint(hint);
  const startTime = displayHint.startTime ??
    (sourceHintPrefersEvening(displayHint) ? "20:00" : "12:00");
  const endTime = displayHint.endTime ??
    (sourceHintPrefersEvening(displayHint) ? "20:30" : "12:30");
  return {
    day_index: dayIndex,
    title: displayHint.title?.trim() || `Day ${dayIndex + 1}`,
    details: displayHint.details?.trim() ||
      "Complete the day-specific routine.",
    all_day: false,
    start_time: startTime,
    end_time: endTime,
    location: displayHint.location?.trim() || null,
  };
}

function normalizedRepeatExpansionTitle(note: ParsedNote): string {
  return `${note.title ?? ""}`
    .toLowerCase()
    .replace(/\bday\s*\d{1,3}\b/g, "")
    .replace(/[^\w\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repeatExpansionTokens(note: ParsedNote): Set<string> {
  const text = `${note.title ?? ""} ${note.start_time ?? ""} ${
    note.end_time ?? ""
  }`
    .toLowerCase();
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  const stopwords = new Set([
    "day",
    "routine",
    "session",
    "event",
    "note",
    "the",
    "and",
    "for",
    "with",
  ]);
  return new Set(
    tokens.filter((token) => token.length >= 3 && !stopwords.has(token)),
  );
}

function repeatExpansionResidual(text: string): string {
  const residual = stripUnsafeVisibleRepeatReferenceText(text);
  if (!residual) return "";
  if (hasUnsafeVisibleRepeatReference(residual)) return "";
  if (/\bas\s+(?:instructed|directed|above|before)\b/i.test(residual)) {
    return "";
  }
  return residual;
}

function appendRepeatExpansionResidual(
  sourceDetails: string,
  residual: string,
): string {
  const source = sourceDetails.trim();
  const extra = residual.trim();
  if (!extra) return source;
  const sourceKey = source.replace(/\s+/g, " ").toLowerCase();
  const extraKey = extra.replace(/\s+/g, " ").toLowerCase();
  if (!extraKey || sourceKey.includes(extraKey)) return source;
  return [source, extra].filter(Boolean).join("\n\n");
}

function findRepeatExpansionSourceNote(
  notes: ParsedNote[],
  current: ParsedNote,
  targetDayIndex: number,
): ParsedNote | null {
  const currentCadence = noteCadenceLabel(current);
  const currentTitle = normalizedRepeatExpansionTitle(current);
  const currentTokens = repeatExpansionTokens(current);
  const candidates = notes.filter((note) =>
    note !== current &&
    note.day_index === targetDayIndex &&
    (note.details ?? "").trim().length > 0 &&
    !hasUnsafeVisibleRepeatReference(note.title) &&
    !hasUnsafeVisibleRepeatReference(note.details)
  );
  if (candidates.length === 0) return null;

  let best: ParsedNote | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    let score = 0;
    const candidateCadence = noteCadenceLabel(candidate);
    if (currentCadence !== "other" && candidateCadence === currentCadence) {
      score += 10;
    }
    if (
      current.start_time && candidate.start_time &&
      current.start_time === candidate.start_time
    ) {
      score += 5;
    }
    if (
      currentTitle && currentTitle === normalizedRepeatExpansionTitle(candidate)
    ) {
      score += 4;
    }
    const candidateTokens = repeatExpansionTokens(candidate);
    for (const token of currentTokens) {
      if (candidateTokens.has(token)) score += 1;
    }
    score += Math.min(2, (candidate.details ?? "").length / 500);

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function expandVisibleRepeatReferences(notes: ParsedNote[]): ParsedNote[] {
  if (!Array.isArray(notes) || notes.length === 0) return notes;

  const expanded = notes.map((note) => ({ ...note }));
  const sorted = expanded.slice().sort((a, b) => {
    if (a.day_index !== b.day_index) return a.day_index - b.day_index;
    const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
    const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
    return aMinutes - bMinutes;
  });

  for (const note of sorted) {
    const text = `${note.title ?? ""}\n${note.details ?? ""}`;
    if (!hasUnsafeVisibleRepeatReference(text)) continue;

    const targetDayIndex = unsafeVisibleRepeatTargetDayIndex(
      text,
      note.day_index,
    );
    const source = targetDayIndex == null
      ? null
      : findRepeatExpansionSourceNote(expanded, note, targetDayIndex);
    if (source?.details?.trim()) {
      note.details = appendRepeatExpansionResidual(
        source.details.trim(),
        repeatExpansionResidual(note.details ?? ""),
      );
      continue;
    }

    const stripped = repeatExpansionResidual(note.details ?? "");
    if (stripped) {
      note.details = stripped;
    }
  }

  return expanded;
}

function hydrateNoteLocationsFromHints(
  notes: ParsedNote[],
  sourceDayHints: Map<number, SourceDayHint>,
): ParsedNote[] {
  if (!Array.isArray(notes) || notes.length === 0) return notes;

  const byDay = new Map<number, ParsedNote[]>();
  for (const note of notes) {
    if (!note) continue;

    const explicitLocation = (note.location ?? "").trim();
    const urlFromDetails = extractFirstUrl(note.details ?? "");
    if (!explicitLocation && urlFromDetails) {
      note.location = urlFromDetails;
    } else if (!explicitLocation) {
      note.location = null;
    } else {
      note.location = explicitLocation;
    }

    const bucket = byDay.get(note.day_index) ?? [];
    bucket.push(note);
    byDay.set(note.day_index, bucket);
  }

  for (const [dayIndex, dayNotes] of byDay.entries()) {
    const hintLocation = sourceDayHints.get(dayIndex)?.location?.trim();
    if (!hintLocation) continue;
    const mainNote = getMainSessionNote(dayNotes) ?? dayNotes[0];
    if (!mainNote) continue;
    if ((mainNote.location ?? "").trim().length === 0) {
      mainNote.location = hintLocation;
    }
  }

  return notes;
}

function hydrateNotesFromSourceHints(
  notes: ParsedNote[],
  sourceDayHints: Map<number, SourceDayHint>,
  sourceHandling: SourceHandlingMode,
): ParsedNote[] {
  if (!Array.isArray(notes) || notes.length === 0) return notes;
  if (sourceHandling !== "PRESERVE_STRUCTURE") return notes;

  const byDay = new Map<number, ParsedNote[]>();
  for (const note of notes) {
    if (!note || !Number.isInteger(note.day_index)) continue;
    const bucket = byDay.get(note.day_index) ?? [];
    bucket.push(note);
    byDay.set(note.day_index, bucket);
  }

  for (const [dayIndex, dayNotes] of byDay.entries()) {
    const rawHint = sourceDayHints.get(dayIndex);
    const hint = rawHint ? calendarizeSourceDayHint(rawHint) : undefined;
    if (!hint) continue;

    let mainNote = selectSourceHintTargetNote(dayNotes, hint);
    if (!mainNote) {
      mainNote = buildSourceHintNote(dayIndex, hint);
      notes.push(mainNote);
      dayNotes.push(mainNote);
    }

    const hintTitle = (hint.title ?? "").trim();
    const hintDetails = (hint.details ?? "").trim();
    const hintLocation = (hint.location ?? "").trim();

    if (hintTitle) {
      mainNote.title = hintTitle;
    }
    if (hintDetails) {
      mainNote.details = hasUnsafeVisibleRepeatReference(mainNote.details)
        ? hintDetails
        : mergePreservedDetails(mainNote.details, hintDetails);
    }
    if (hintLocation) {
      mainNote.location = hintLocation;
    }
  }

  return notes;
}

function buildCanonicalSourceStructuredRoutineNotes(args: {
  sourceHandling: SourceHandlingMode;
  recurringHints: RecurringSourceRoutineHint[];
  sourceDayHints: Map<number, SourceDayHint>;
  dateRangeDays: number;
}): ParsedNote[] | null {
  const {
    sourceHandling,
    recurringHints,
    sourceDayHints,
    dateRangeDays,
  } = args;
  if (sourceHandling !== "PRESERVE_STRUCTURE") return null;
  if (!Number.isFinite(dateRangeDays) || dateRangeDays <= 0) return null;
  if (recurringHints.length === 0 || sourceDayHints.size < dateRangeDays) {
    return null;
  }

  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    if (!sourceDayHints.has(dayIndex)) return null;
    const recurringForDay = recurringHints.filter((hint) =>
      routineHintAppliesToDay(hint, dayIndex)
    );
    if (recurringForDay.length === 0) return null;
  }

  const notes: ParsedNote[] = [];
  for (let dayIndex = 0; dayIndex < dateRangeDays; dayIndex++) {
    for (const hint of recurringHints) {
      if (!routineHintAppliesToDay(hint, dayIndex)) continue;
      notes.push(buildRecurringRoutineNote(dayIndex, hint));
    }
    const sourceHint = sourceDayHints.get(dayIndex);
    if (sourceHint) {
      notes.push(buildSourceHintNote(dayIndex, sourceHint));
    }
  }

  return sortParsedNotesByDayAndTime(notes);
}

function validateMainSessionStructure(
  parsedFlow: ParsedFlow,
  technicalCraft: boolean,
): { ok: boolean; failedDayIndices: number[] } {
  if (!parsedFlow || !Array.isArray(parsedFlow.notes)) {
    return { ok: false, failedDayIndices: [] };
  }

  const byDay = new Map<number, ParsedNote[]>();
  for (const n of parsedFlow.notes) {
    if (!n || !Number.isInteger(n.day_index)) continue;
    const bucket = byDay.get(n.day_index) ?? [];
    bucket.push(n);
    byDay.set(n.day_index, bucket);
  }

  const bulletRe = /^([-*•]\s+|\d+\.\s+)/;
  const failed: number[] = [];

  for (const [dayIndex, notes] of byDay.entries()) {
    const main = getMainSessionNote(notes);
    if (!main) continue;

    const details = (main.details ?? "").trim();
    if (!details) {
      failed.push(dayIndex);
      continue;
    }

    const lines = details.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const firstBulletIdx = lines.findIndex((l) => bulletRe.test(l));
    const openerBlock = firstBulletIdx === -1
      ? lines.join(" ")
      : lines.slice(0, firstBulletIdx).join(" ");
    const hasOpener = openerBlock.trim().length > 0 &&
      /[.!?]/.test(openerBlock);

    const stepCount = lines.filter((l) => bulletRe.test(l)).length;

    const nonEmpty = lines.filter((l) => l.length > 0);
    const lastLine = nonEmpty[nonEmpty.length - 1] ?? "";
    const isLastBullet = bulletRe.test(lastLine);

    const closeLines: string[] = [];
    for (let i = nonEmpty.length - 1; i >= 0 && closeLines.length < 2; i--) {
      const line = nonEmpty[i];
      if (bulletRe.test(line)) break;
      closeLines.unshift(line);
    }

    const adjustmentRe =
      /\b(if|next time|adjust|try|tighten|when\b.*\bthen|tweak|fallback|swap)\b/i;
    const hasClose = closeLines.length > 0 &&
      closeLines.length <= 2 &&
      !isLastBullet &&
      adjustmentRe.test(closeLines.join(" "));

    const hasDigit = /\d/.test(details);

    let technicalOk = true;
    if (technicalCraft) {
      const expectedRe =
        /(expect|should read|target|range|~|±|tolerance|output|reading)/i;
      const unitOrRangeRe =
        /(\d+\s*-\s*\d+|\d+\s?(ms|s|sec|min|hr|hz|°c|c|f|kg|lbs|lb|mm|cm|v|w|%|rpm|mph|kph|bpm|ohm)|~|±)/i;
      technicalOk = expectedRe.test(details) && unitOrRangeRe.test(details);
    }

    const sentenceCount = details.match(/[.!?](?:\s|$)/g)?.length ?? 0;
    const actionCount = details.match(
      /\b(cleanse|apply|use|check|write|solve|compare|practice|review|build|measure|call|gather|test|track|stretch|lift|walk|run|cook|prep|read|recall|explain|correct)\b/gi,
    )?.length ?? 0;
    const proseStructured = stepCount === 0 &&
      sentenceCount >= 3 &&
      actionCount >= 3 &&
      hasDigit;
    const listStructured = stepCount >= 3 && hasClose;

    if (
      !(hasOpener && (listStructured || proseStructured) && hasDigit &&
        technicalOk)
    ) {
      failed.push(dayIndex);
    }
  }

  failed.sort((a, b) => a - b);
  return { ok: failed.length === 0, failedDayIndices: failed };
}

// ✅ REFACTOR: Removed all date/time helper functions
// Flutter is now the only source of truth for all date calculations

// ✅ Transform LLMFlow -> ParsedFlow with trust-but-verify day_index handling
function transformLLMFlowToParsedFlow(
  llm: LLMFlow,
  startDateStr: string, // kept for logging/validation only
  dateRangeDays: number,
): ParsedFlow {
  const overviewTitle = llm.overview?.title ?? null;
  const overviewSummary = llm.overview?.summary ?? null;
  const notes = Array.isArray(llm.notes) ? llm.notes : [];

  const isValidDayIndex = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value < dateRangeDays;

  const buildParsedNote = (n: LLMNote, dayIndex: number): ParsedNote => {
    const rawAllDay = typeof n.allDay === "boolean" ? n.allDay : false;
    const startTime = isValidTimeString(n.startsAt) ? n.startsAt : null;
    const endTime = isValidTimeString(n.endsAt) ? n.endsAt : null;

    return {
      day_index: dayIndex,
      title: n.title?.trim() || `Day ${dayIndex + 1}`,
      details: (n.details ?? "").toString().trim(),
      all_day: rawAllDay,
      start_time: rawAllDay ? null : startTime,
      end_time: rawAllDay ? null : endTime,
      location: n.location?.trim() || null,
    };
  };

  let validCount = 0;
  for (const n of notes) {
    if (isValidDayIndex(n?.day_index)) validCount += 1;
  }

  const mostlyInvalid = notes.length > 0 && validCount / notes.length < 0.5;
  let parsedNotes: ParsedNote[] = [];

  if (mostlyInvalid) {
    parsedNotes = notes.map((n: LLMNote, idx: number) => {
      const safeIndex = dateRangeDays > 0 ? idx % dateRangeDays : idx;
      return buildParsedNote(n, safeIndex);
    });
  } else {
    const invalidBucket: LLMNote[] = [];
    const used = new Set<number>();

    for (const n of notes) {
      if (isValidDayIndex(n?.day_index)) {
        parsedNotes.push(buildParsedNote(n, n.day_index));
        used.add(n.day_index);
      } else {
        invalidBucket.push(n);
      }
    }

    const missing = [];
    for (let i = 0; i < dateRangeDays; i++) {
      if (!used.has(i)) missing.push(i);
    }

    let fallbackIdx = parsedNotes.length % Math.max(dateRangeDays, 1);
    for (const n of invalidBucket) {
      const target = missing.length > 0 ? missing.shift()! : fallbackIdx;
      parsedNotes.push(buildParsedNote(n, target));
      used.add(target);
      fallbackIdx = (fallbackIdx + 1) % Math.max(dateRangeDays, 1);
    }
  }

  const seen = new Set(parsedNotes.map((n) => n.day_index));
  for (let i = 0; i < dateRangeDays; i++) {
    if (!seen.has(i)) {
      parsedNotes.push({
        day_index: i,
        title: `Day ${i + 1} – Maintain`,
        details: "Maintain momentum with an all-day placeholder.",
        all_day: true,
        start_time: null,
        end_time: null,
        location: null,
      });
    }
  }

  parsedNotes.sort((a, b) => {
    if (a.day_index !== b.day_index) return a.day_index - b.day_index;
    const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
    const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
    return aMinutes - bMinutes;
  });

  return {
    flow_name: llm.flowName ?? "Untitled Flow",
    overview_title: overviewTitle?.trim() || llm.flowName || "Untitled Flow",
    overview_summary: overviewSummary?.trim() || "",
    notes: parsedNotes,
  };
}

function validateParsedFlow(
  flow: ParsedFlow,
  dateRangeDays?: number,
): { ok: boolean; error?: string } {
  if (!flow || typeof flow !== "object") {
    return { ok: false, error: "Parsed content is not an object" };
  }

  if (typeof flow.flow_name !== "string" || flow.flow_name.trim() === "") {
    return { ok: false, error: "Missing or invalid flow_name" };
  }

  if (!Array.isArray(flow.notes) || flow.notes.length === 0) {
    return { ok: false, error: "notes must be a non-empty array" };
  }

  for (const [i, n] of flow.notes.entries()) {
    if (!n || typeof n !== "object") {
      return { ok: false, error: `notes[${i}] is not an object` };
    }

    if (
      typeof n.day_index !== "number" ||
      !Number.isInteger(n.day_index) ||
      n.day_index < 0 ||
      !Number.isFinite(n.day_index)
    ) {
      return {
        ok: false,
        error:
          `notes[${i}].day_index is required and must be a non-negative number`,
      };
    }
    if (typeof dateRangeDays === "number" && n.day_index >= dateRangeDays) {
      return {
        ok: false,
        error: `notes[${i}].day_index must be within the requested range`,
      };
    }

    if (typeof n.title !== "string" || n.title.trim() === "") {
      return { ok: false, error: `notes[${i}].title is required` };
    }
    if (hasUnsafeVisibleRepeatReference(n.title)) {
      return {
        ok: false,
        error:
          `notes[${i}].title points to another day instead of including full instructions`,
      };
    }

    if (typeof n.details !== "string" || n.details.trim() === "") {
      return {
        ok: false,
        error: `notes[${i}].details must be a non-empty string`,
      };
    }
    if (hasUnsafeVisibleRepeatReference(n.details)) {
      return {
        ok: false,
        error:
          `notes[${i}].details points to another day instead of including full instructions`,
      };
    }
    const underSpecifiedDetails = findUnderSpecifiedActionPlaceholder(
      n.details,
    );
    if (underSpecifiedDetails) {
      return {
        ok: false,
        error: `notes[${i}].details too generic: ${underSpecifiedDetails}`,
      };
    }

    if (typeof n.all_day !== "boolean") {
      return { ok: false, error: `notes[${i}].all_day must be a boolean` };
    }

    if (!n.all_day) {
      if (!isValidTimeString(n.start_time)) {
        return {
          ok: false,
          error: `notes[${i}].start_time must be HH:MM when all_day is false`,
        };
      }
      if (!isValidTimeString(n.end_time)) {
        return {
          ok: false,
          error: `notes[${i}].end_time must be HH:MM when all_day is false`,
        };
      }
      const startMinutes = timeToMinutes(n.start_time);
      const endMinutes = timeToMinutes(n.end_time);
      if (
        startMinutes == null || endMinutes == null || endMinutes <= startMinutes
      ) {
        return {
          ok: false,
          error: `notes[${i}].end_time must be later than start_time`,
        };
      }
    }

    if (n.start_time != null && typeof n.start_time !== "string") {
      return {
        ok: false,
        error: `notes[${i}].start_time must be a string if provided`,
      };
    }

    if (n.end_time != null && typeof n.end_time !== "string") {
      return {
        ok: false,
        error: `notes[${i}].end_time must be a string if provided`,
      };
    }

    if (n.location != null && typeof n.location !== "string") {
      return {
        ok: false,
        error: `notes[${i}].location must be a string if provided`,
      };
    }
  }

  if (
    typeof dateRangeDays === "number" && Number.isFinite(dateRangeDays) &&
    dateRangeDays > 0
  ) {
    const covered = new Set(flow.notes.map((n) => n.day_index));
    for (let i = 0; i < dateRangeDays; i++) {
      if (!covered.has(i)) {
        return { ok: false, error: `Missing coverage for day_index ${i}` };
      }
    }
  }

  return { ok: true };
}

function validateLLMFlowOutput(
  llm: LLMFlow | null,
  dateRangeDays: number,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!llm || typeof llm !== "object") {
    return { ok: false, errors: ["LLM output missing"] };
  }

  if (typeof llm.flowName !== "string" || llm.flowName.trim() === "") {
    errors.push("Missing flowName");
  }

  if (!Array.isArray(llm.notes) || llm.notes.length === 0) {
    errors.push("notes must be a non-empty array");
    return { ok: errors.length === 0, errors };
  }

  const covered = new Set<number>();

  for (const [i, n] of llm.notes.entries()) {
    if (!n || typeof n !== "object") {
      errors.push(`notes[${i}] is not an object`);
      continue;
    }

    if (
      !Number.isInteger(n.day_index) || n.day_index < 0 ||
      n.day_index >= dateRangeDays
    ) {
      errors.push(`notes[${i}].day_index invalid`);
    } else {
      covered.add(n.day_index);
    }

    if (typeof n.title !== "string" || n.title.trim() === "") {
      errors.push(`notes[${i}].title missing`);
    }
    if (typeof n.details !== "string" || n.details.trim() === "") {
      errors.push(`notes[${i}].details missing`);
    }
    if (typeof n.allDay !== "boolean") {
      errors.push(`notes[${i}].allDay must be boolean`);
    }
    if (n.location != null && typeof n.location !== "string") {
      errors.push(`notes[${i}].location must be string when provided`);
    }
    if (n.allDay === false) {
      if (!isValidTimeString(n.startsAt)) {
        errors.push(`notes[${i}].startsAt invalid`);
      }
      if (!isValidTimeString(n.endsAt)) {
        errors.push(`notes[${i}].endsAt invalid`);
      }
      const startMinutes = timeToMinutes(n.startsAt);
      const endMinutes = timeToMinutes(n.endsAt);
      if (
        startMinutes == null || endMinutes == null || endMinutes <= startMinutes
      ) {
        errors.push(`notes[${i}].endsAt must be later than startsAt`);
      }
    }
  }

  for (let i = 0; i < dateRangeDays; i++) {
    if (!covered.has(i)) errors.push(`Missing day_index ${i}`);
  }

  return { ok: errors.length === 0, errors };
}

type ConcreteDetailIssue = {
  noteIndex: number;
  dayIndex: number;
  title: string;
  details: string;
  reason: string;
};

function findConcreteParsedFlowDetailIssues(
  flow: ParsedFlow,
): ConcreteDetailIssue[] {
  const notes = Array.isArray(flow.notes) ? flow.notes : [];
  const issues: ConcreteDetailIssue[] = [];
  for (const [i, note] of notes.entries()) {
    const placeholder = findUnderSpecifiedActionPlaceholder(note.details);
    if (placeholder) {
      issues.push({
        noteIndex: i,
        dayIndex: note.day_index,
        title: note.title,
        details: note.details,
        reason: placeholder,
      });
    }
  }
  return issues;
}

async function repairConcreteParsedFlowDetails(args: {
  parsedFlow: ParsedFlow;
  description: string;
  sourceText?: string | null;
  flowFormat: FlowFormat;
  systemPrompt: string;
}): Promise<{ repaired: number; remainingIssues: ConcreteDetailIssue[] }> {
  const { parsedFlow, description, sourceText, flowFormat, systemPrompt } =
    args;
  let remainingIssues = findConcreteParsedFlowDetailIssues(parsedFlow);
  if (remainingIssues.length === 0) {
    return { repaired: 0, remainingIssues: [] };
  }

  let repaired = 0;
  const maxRepairPasses = 3;
  const repairBatchSize = 10;

  for (let pass = 0; pass < maxRepairPasses; pass++) {
    const issues = remainingIssues.slice(0, repairBatchSize);
    if (issues.length === 0) break;

    const repairPrompt = [
      "Rewrite only the listed calendar note details that are too generic.",
      "Do not change titles, day_index, times, locations, or note count.",
      "Each replacement must be concrete enough for the user to act without extra research.",
      "Keep each event focused on one primary job with at most two supporting sub-actions.",
      "Use 2-4 plain calendar sentences or short lines.",
      "Do not use numbered lists or leading labels like 1., 2., or Step 1.",
      "Avoid placeholders such as specific techniques, specific cultural practices, healthy meal, self-care activities, work on your project, review the basics, intro riff, verse chords, chord progression, song structure, strumming pattern, or as instructed.",
      "If the note references a set such as first ten hieroglyphs, basic symbols, common verbs, key terms, main chords, core movements, important figures, main topics, or online resources, the replacement must name the actual items in the visible details.",
      "For any topic, infer conservative domain-standard starter items when the user did not provide them. Examples: language prompts should name verbs/forms; study prompts should name concepts/examples; fitness prompts should name movements/sets; project prompts should name artifacts/files/decisions; spirituality or character prompts should name the practice, words, prompt, or evidence.",
      "For Medu Neter or hieroglyph prompts, name the starter signs directly, for example 𓇋 reed leaf = i/y, 𓅱 quail chick = w/u, 𓅓 owl = m, 𓈖 water ripple = n, and 𓂋 mouth = r, instead of saying first ten hieroglyphs or basic symbols.",
      "For named-song guitar prompts, name the chords, tuning/tempo, section map, riff/fret or timestamp target, rhythm pattern, tone setting, or recording checkpoint. Do not say to learn the riff or chords without naming the music.",
      'Return JSON only with this shape: {"repairs":[{"note_index":number,"details":string}]}',
      "",
      `USER_DESCRIPTION:\n${description}`,
      sourceText
        ? `SOURCE_TEXT_EXCERPT:\n${String(sourceText).slice(0, 1800)}`
        : "",
      `FLOW_FORMAT: ${flowFormat}`,
      `REPAIR_PASS: ${pass + 1} of ${maxRepairPasses}`,
      "ISSUES:",
      JSON.stringify(
        issues.map((issue) => ({
          note_index: issue.noteIndex,
          day_index: issue.dayIndex,
          title: issue.title,
          reason: issue.reason,
          current_details: issue.details,
        })),
        null,
        2,
      ),
    ].filter(Boolean).join("\n\n");

    const repairResp = await generateWithOpenAI({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: repairPrompt },
      ],
      temperature: 0.2,
      max_tokens: 3200,
      signal: AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS),
    });

    if (!repairResp.ok) {
      console.log(
        "[ai_generate_flow] concrete detail repair failed:",
        repairResp.error,
      );
      break;
    }

    let repairs: Array<{ note_index?: unknown; details?: unknown }> = [];
    const text = stripCodeFences(repairResp.content);
    try {
      const parsed = JSON.parse(text);
      repairs = Array.isArray(parsed?.repairs) ? parsed.repairs : [];
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/m);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          repairs = Array.isArray(parsed?.repairs) ? parsed.repairs : [];
        } catch {
          repairs = [];
        }
      }
    }

    let repairedThisPass = 0;
    for (const repair of repairs) {
      const noteIndex = Number(repair?.note_index);
      const details = typeof repair?.details === "string"
        ? repair.details.trim()
        : "";
      if (!Number.isInteger(noteIndex) || noteIndex < 0) continue;
      const note = parsedFlow.notes[noteIndex];
      if (!note || !details) continue;
      if (hasUnsafeVisibleRepeatReference(details)) continue;
      if (findUnderSpecifiedActionPlaceholder(details)) continue;
      note.details = details;
      repaired += 1;
      repairedThisPass += 1;
    }

    remainingIssues = findConcreteParsedFlowDetailIssues(parsedFlow);
    if (remainingIssues.length === 0 || repairedThisPass === 0) break;
  }

  return {
    repaired,
    remainingIssues,
  };
}

type FlowArcSegmentPlan = {
  startDay: number;
  endDay: number;
  theme: string;
  objectives: string[];
  beats: string[];
};

function normalizeSourceWhitespace(text: string): string {
  return (text ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeTelemetryBlock(block: string): boolean {
  const compact = normalizeSourceWhitespace(block).replace(/\s+/g, " ");
  if (!compact) return false;
  const jsonKeys = (compact.match(/"[\w.-]+":/g) ?? []).length;
  const telemetryHits = (
    compact.match(
      /\b(event_message|deployment_id|execution_id|function_id|project_ref|served_by|booted|shutdown|wallclocktime|cpu_time_used|memory_used|timestamp|version|region)\b/gi,
    ) ?? []
  ).length;
  return telemetryHits >= 2 ||
    (compact.startsWith("{") && compact.endsWith("}") && jsonKeys >= 4);
}

function splitSourceBlocks(text: string): string[] {
  return normalizeSourceWhitespace(text)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function truncateInline(text: string, maxChars: number): string {
  const compact = normalizeSourceWhitespace(text).replace(/\s+/g, " ");
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function dedupeBlocks(blocks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const block of blocks) {
    const key = block.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(block);
  }
  return out;
}

function isLongFlowScaffoldingBlock(block: string): boolean {
  const compact = normalizeSourceWhitespace(block);
  return /^SYSTEM DIRECTIVES\b/i.test(compact);
}

function sanitizeLongFlowDescription(description: string): string {
  const cleanedBlocks = splitSourceBlocks(description)
    .map((block) =>
      block
        .replace(/^USER_INTENT(?:_SUMMARY)?\s*:?\s*/i, "")
        .trim()
    )
    .filter((block) => block && !isLongFlowScaffoldingBlock(block));

  return cleanedBlocks.length > 0
    ? cleanedBlocks.join("\n\n")
    : normalizeSourceWhitespace(description);
}

function scoreSourceBlock(block: string, index: number, total: number): number {
  if (!/[A-Za-z]/.test(block)) return -999;
  if (looksLikeTelemetryBlock(block)) return -999;
  if (isLongFlowScaffoldingBlock(block)) return -999;

  let score = 0;
  if (/^(?:\d+[\).\s]|[-*•]\s)/.test(block)) score += 18;
  if (/^[A-Z][^.!?\n]{2,100}:/.test(block)) score += 10;
  if (/^#{1,6}\s/.test(block)) score += 10;
  if (
    /(turn|make|convert|transform|create|build|organize|map)\b[\s\S]{0,40}\b(?:\d{1,3}\s*day\s+)?flow\b/i
      .test(block)
  ) {
    score += 36;
  }
  if (
    /\b(flow|plan|timeline|phase|milestone|constraint|goal|deliverable|checkpoint|decision|dependency|priority|theme|chapter|lesson|exercise|practice|session|prompt|experiment|review)\b/i
      .test(block)
  ) {
    score += 16;
  }
  if (
    /\b(day|week|month|quarter|timeline|chapter|section|stage|phase|\d{1,3}%|\$\d|\d{1,3}\+)\b/i
      .test(block)
  ) score += 8;
  if (
    /\b(must|should|need to|avoid|watch for|if\b.*\bthen|when\b.*\bthen)\b/i
      .test(block)
  ) {
    score += 8;
  }
  if (/(https?:\/\/|www\.)/i.test(block)) score += 8;
  if (/[0-9]/.test(block)) score += 6;
  if (block.length >= 80 && block.length <= 900) score += 10;
  if ((block.match(/[.!?]/g) ?? []).length >= 2) score += 6;
  if (index === 0 || index === total - 1) score += 3;
  return score;
}

function buildLongFlowSourceAnchors(
  description: string,
  sourceText: string,
  maxChars = LONG_FLOW_GLOBAL_ANCHORS_MAX_CHARS,
): string {
  const descriptionBlocks = splitSourceBlocks(description).filter(
    (block) => !looksLikeTelemetryBlock(block),
  );
  const sourceBlocks = splitSourceBlocks(sourceText).filter(
    (block) => !looksLikeTelemetryBlock(block),
  );
  const allBlocks = dedupeBlocks([...descriptionBlocks, ...sourceBlocks]);
  if (allBlocks.length === 0) {
    return truncateInline(
      [description, sourceText].filter(Boolean).join("\n\n"),
      maxChars,
    );
  }

  const seeds: string[] = [];
  const addSeed = (idx: number) => {
    if (idx >= 0 && idx < sourceBlocks.length) seeds.push(sourceBlocks[idx]);
  };
  addSeed(0);
  addSeed(Math.floor(sourceBlocks.length / 3));
  addSeed(Math.floor((sourceBlocks.length * 2) / 3));
  addSeed(sourceBlocks.length - 1);

  const ranked = allBlocks
    .map((block, index) => ({
      block,
      score: scoreSourceBlock(block, index, allBlocks.length),
    }))
    .filter((item) => item.score > -999)
    .sort((a, b) => b.score - a.score || a.block.length - b.block.length)
    .map((item) => item.block);

  const selected = dedupeBlocks([
    ...descriptionBlocks.slice(0, 1),
    ...seeds,
    ...ranked,
  ]);
  const lines: string[] = [];
  let used = 0;

  for (const block of selected) {
    const line = `- ${truncateInline(block, 280)}`;
    const nextSize = used + line.length + (lines.length > 0 ? 1 : 0);
    if (nextSize > maxChars) break;
    lines.push(line);
    used = nextSize;
    if (lines.length >= 12) break;
  }

  if (lines.length === 0) {
    return truncateInline(allBlocks[0], maxChars);
  }
  return lines.join("\n");
}

function buildCondensedSourceContext(
  text: string,
  maxChars: number,
  maxBlocks = 20,
  maxBlockChars = 1200,
): string {
  const clean = normalizeSourceWhitespace(text);
  if (!clean) return "";
  if (looksStructuredDayPlan(clean) && clean.length <= maxChars) {
    return clean;
  }

  const blocks = dedupeBlocks(
    splitSourceBlocks(clean).filter((block) => !looksLikeTelemetryBlock(block)),
  );
  if (blocks.length === 0) {
    return truncateInline(clean, maxChars);
  }

  const seeds: string[] = [];
  const addSeed = (idx: number) => {
    if (idx >= 0 && idx < blocks.length) seeds.push(blocks[idx]);
  };
  addSeed(0);
  addSeed(Math.floor(blocks.length / 2));
  addSeed(blocks.length - 1);

  const ranked = blocks
    .map((block, index) => ({
      block,
      score: scoreSourceBlock(block, index, blocks.length),
    }))
    .filter((item) => item.score > -999)
    .sort((a, b) => b.score - a.score || a.block.length - b.block.length)
    .map((item) => item.block);

  const selected = dedupeBlocks([...seeds, ...ranked]);
  const out: string[] = [];
  let used = 0;

  for (const block of selected) {
    const chunk = block.length <= maxBlockChars
      ? block
      : `${block.slice(0, maxBlockChars).trimEnd()}…`;
    const nextSize = used + chunk.length + (out.length > 0 ? 2 : 0);
    if (nextSize > maxChars) {
      const remaining = maxChars - used - (out.length > 0 ? 2 : 0);
      if (remaining > 180) {
        out.push(truncateInline(chunk, remaining));
      }
      break;
    }
    out.push(chunk);
    used = nextSize;
    if (out.length >= maxBlocks) break;
  }

  if (out.length === 0) {
    return truncateInline(clean, maxChars);
  }
  return out.join("\n\n");
}

function clampLongSource(text: string, max = LONG_FLOW_SOURCE_CLAMP): string {
  const clean = normalizeSourceWhitespace(text);
  if (!clean || clean.length <= max) return clean;
  const head = Math.floor(max * 0.55);
  const tail = max - head - 120;
  return `${
    clean.slice(0, head)
  }\n\n[... middle omitted for model context ...]\n\n${
    clean.slice(clean.length - tail)
  }`;
}

function excerptForSourceSegment(
  full: string,
  segIndex: number,
  segCount: number,
  cap = LONG_FLOW_SEGMENT_EXCERPT_CAP,
): string {
  const blocks = splitSourceBlocks(full).filter((block) =>
    !looksLikeTelemetryBlock(block)
  );
  if (blocks.length === 0) return truncateInline(full, cap);

  if (blocks.join("\n\n").length <= cap) {
    return blocks.join("\n\n");
  }

  const startIdx = Math.floor((blocks.length * segIndex) / segCount);
  const rawEndIdx = Math.max(
    startIdx + 1,
    Math.floor((blocks.length * (segIndex + 1)) / segCount),
  );
  let left = Math.max(0, startIdx);
  let right = Math.min(blocks.length, rawEndIdx);
  const chosen = blocks.slice(left, right);
  let totalChars = chosen.join("\n\n").length;

  while (
    totalChars < Math.floor(cap * 0.6) && (left > 0 || right < blocks.length)
  ) {
    const addLeft = left > 0;
    const addRight = right < blocks.length;
    if (addLeft) {
      left -= 1;
      chosen.unshift(blocks[left]);
      totalChars = chosen.join("\n\n").length;
      if (totalChars >= cap) break;
    }
    if (addRight) {
      chosen.push(blocks[right]);
      right += 1;
      totalChars = chosen.join("\n\n").length;
      if (totalChars >= cap) break;
    }
  }

  const excerpt = chosen.join("\n\n");
  return excerpt.length <= cap ? excerpt : truncateInline(excerpt, cap);
}

function defaultArcSegments(
  dateRangeDays: number,
  chunkDays: number,
): FlowArcSegmentPlan[] {
  const segments: FlowArcSegmentPlan[] = [];
  for (let start = 0; start < dateRangeDays; start += chunkDays) {
    const end = Math.min(dateRangeDays - 1, start + chunkDays - 1);
    segments.push({
      startDay: start,
      endDay: end,
      theme: `Arc ${start + 1}–${end + 1}`,
      objectives: [
        "Advance outcomes implied by the user’s material during this window.",
        "Ship one concrete, checkable milestone before the segment ends.",
      ],
      beats: [
        "Pull the next unblocked move implied by the source text.",
        "Make one visible artifact or checkpoint the user can inspect by the end of the segment.",
        "Increase difficulty only after the prior layer is grounded in the material.",
        "Close with a short review: what moved, what blocked, what to carry forward.",
      ],
    });
  }
  return segments;
}

function validateArcSegments(
  segments: FlowArcSegmentPlan[],
  dateRangeDays: number,
): boolean {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  const sorted = [...segments].sort((a, b) => a.startDay - b.startDay);
  let expect = 0;
  for (const s of sorted) {
    const sd = Number(s.startDay);
    const ed = Number(s.endDay);
    if (!Number.isFinite(sd) || !Number.isFinite(ed)) return false;
    if (sd !== expect) return false;
    if (ed < sd || ed >= dateRangeDays) return false;
    if (!String(s.theme || "").trim()) return false;
    expect = ed + 1;
  }
  return expect === dateRangeDays;
}

function parseArcPlanFromResponse(text: string): {
  flowName: string;
  overview?: LLMOverview;
  segments: FlowArcSegmentPlan[];
} | null {
  const cleaned = stripCodeFences(text);
  try {
    const obj = JSON.parse(cleaned);
    const segs = Array.isArray(obj.segments) ? obj.segments : [];
    const mapped: FlowArcSegmentPlan[] = segs.map((s: any) => ({
      startDay: Number(s.startDay ?? s.start_day),
      endDay: Number(s.endDay ?? s.end_day),
      theme: String(s.theme ?? "").trim(),
      objectives: Array.isArray(s.objectives)
        ? s.objectives.map((x: any) => String(x))
        : [],
      beats: Array.isArray(s.beats) ? s.beats.map((x: any) => String(x)) : [],
    }));
    const flowName = String(obj.flowName ?? obj.flow_name ?? "").trim();
    if (!flowName || mapped.length === 0) return null;
    let overview: LLMOverview | undefined;
    const ov = obj.overview;
    if (ov && typeof ov === "object") {
      overview = {
        title: String(ov.title ?? "").trim(),
        summary: String(ov.summary ?? "").trim(),
      };
    }
    return { flowName, overview, segments: mapped };
  } catch {
    return null;
  }
}

function ensureLLMNoteTimes(flow: LLMFlow): void {
  for (const n of flow.notes ?? []) {
    if (n.allDay === true) continue;
    if (!isValidTimeString(n.startsAt)) n.startsAt = "09:00";
    if (!isValidTimeString(n.endsAt)) n.endsAt = "11:00";
    const sm = timeToMinutes(n.startsAt);
    const em = timeToMinutes(n.endsAt);
    if (sm == null || em == null || em <= sm) {
      n.startsAt = "09:00";
      n.endsAt = "11:00";
    }
  }
}

function validateLLMFlowOutputForRange(
  flow: LLMFlow,
  dateRangeDays: number,
  start: number,
  end: number,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const notes = flow.notes ?? [];
  const covered = new Set<number>();
  for (const n of notes) {
    if (!Number.isInteger(n?.day_index)) continue;
    if (n.day_index < 0 || n.day_index >= dateRangeDays) {
      errors.push(`note day_index ${n.day_index} out of range`);
      continue;
    }
    if (n.day_index < start || n.day_index > end) {
      errors.push(
        `note day_index ${n.day_index} outside segment ${start}-${end}`,
      );
    }
    covered.add(n.day_index);
  }
  for (let d = start; d <= end; d++) {
    if (!covered.has(d)) errors.push(`missing day_index ${d}`);
  }
  return { ok: errors.length === 0, errors };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const safe = Math.max(1, Math.min(4, Math.floor(concurrency)));
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safe, items.length) }, () => worker()),
  );
  return results;
}

async function generateLongRangeFlowLlm(args: {
  description: string;
  sourceText: string;
  decisionMatrixBlock?: string;
  youtubePromptBlock?: string;
  startDate: string;
  endDate: string;
  dateRangeDays: number;
  flowType: FlowType;
  flowFormat?: FlowFormat;
  technicalCraft: boolean;
  schedule: ScheduleInference;
  timezoneValue: string;
  timePreference: string;
  requestedTimeWindow?: RequestedTimeWindow | null;
  mode: "DICTATION" | "ELABORATION";
  sourceHandling: SourceHandlingMode;
  mealFlow?: boolean;
  threeMealDailyFlow?: boolean;
}): Promise<
  | {
    ok: true;
    llmFlow: LLMFlow;
    tokensIn: number;
    tokensOut: number;
    modelUsed: string;
    llmStatus: string;
  }
  | { ok: false; error: string; message: string }
> {
  const {
    description,
    sourceText,
    decisionMatrixBlock,
    youtubePromptBlock,
    startDate,
    endDate,
    dateRangeDays,
    flowType,
    flowFormat = "STANDARD",
    technicalCraft,
    schedule,
    timezoneValue,
    timePreference,
    requestedTimeWindow,
    mode,
    sourceHandling,
    mealFlow = false,
    threeMealDailyFlow = false,
  } = args;

  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
  let totalIn = 0;
  let totalOut = 0;
  const cleanDescription = sanitizeLongFlowDescription(description);
  const cleanSource = normalizeSourceWhitespace(sourceText || description);
  const globalAnchors = buildLongFlowSourceAnchors(
    cleanDescription,
    cleanSource,
  );
  const plannerSourceContext = buildCondensedSourceContext(
    [cleanDescription, cleanSource].filter(Boolean).join("\n\n"),
    LONG_FLOW_PLAN_SOURCE_CONTEXT_MAX_CHARS,
    24,
    1100,
  );
  const veryLongFlow = dateRangeDays >= VERY_LONG_FLOW_THRESHOLD_DAYS;
  const fallbackOverview: LLMOverview = {
    title: "Flow arc",
    summary:
      "A staged long-range flow built from the user's pasted material, carrying concrete priorities forward instead of flattening them into generic routines.",
  };
  const flowFormatPromptBlock = buildFlowFormatPromptBlock({
    flowFormat,
    threeMealDailyFlow,
  });
  const planSpecPromptBlock = buildPlanSpecPromptBlock({
    flowFormat,
    schemaVersion: SCHEMA_VERSION,
  });

  const planSystem = `You are a senior planner. Output JSON only (no markdown).

Schema:
{
  "flowName": string,
  "overview": { "title": string, "summary": string },
  "segments": [
    {
      "startDay": number,
      "endDay": number,
      "theme": string,
      "objectives": string[],
      "beats": string[]
    }
  ]
}

Rules:
- segments must partition day indices 0 through TOTAL_DAYS-1 exactly once, in order, with no gaps or overlaps.
- startDay/endDay are inclusive; 0-based from flow start.
- Use SOURCE_HANDLING to decide whether to preserve source order or synthesize a stronger progression from the material.
- If SOURCE_HANDLING=PRESERVE_STRUCTURE, keep the source sequence and day-level artifacts recognizable instead of flattening them into generic segment themes.
- Use GLOBAL_SOURCE_ANCHORS as non-negotiable through-lines that should show up across the arc.
- objectives: concrete, sourced from the user's material (name their initiatives, practices, themes, deliverables, constraints, or timelines)—do not invent facts not implied by the text.
- beats: 4-8 short bullets, highly actionable, still grounded in the same material.
- overview.summary should describe the arc of the full window in 2-5 sentences.`;

  const material = plannerSourceContext ||
    clampLongSource(
      [cleanDescription, cleanSource].filter(Boolean).join("\n\n---\n\n"),
      LONG_FLOW_PLAN_SOURCE_CLAMP,
    );
  let segments = defaultArcSegments(dateRangeDays, LONG_FLOW_SEGMENT_DAYS);
  let flowName = truncateInline(cleanDescription || "Planned Flow", 72)
    .replace(/[.!?].*$/, "")
    .trim();
  let overview: LLMOverview | undefined = fallbackOverview;

  const planUser = [
    `TOTAL_DAYS: ${dateRangeDays}`,
    `DATE_RANGE: ${startDate} → ${endDate}`,
    `TARGET_SEGMENT_LENGTH_DAYS: ~${LONG_FLOW_SEGMENT_DAYS}`,
    `FLOW_FORMAT: ${flowFormat}`,
    `THREE_MEALS_PER_DAY: ${threeMealDailyFlow}`,
    `SOURCE_HANDLING: ${sourceHandling}`,
    decisionMatrixBlock ? `\n${decisionMatrixBlock}` : "",
    youtubePromptBlock ? `\n${youtubePromptBlock}` : "",
    "",
    flowFormatPromptBlock,
    "",
    "GLOBAL_SOURCE_ANCHORS:",
    globalAnchors || "(none)",
    "",
    "SOURCE_AND_INTENT (read carefully):",
    material,
  ].join("\n");

  const planResp = await generateWithOpenAI({
    messages: [
      { role: "system", content: planSystem },
      { role: "user", content: planUser },
    ],
    model,
    temperature: 0.3,
    max_tokens: 1600,
    signal: AbortSignal.timeout(LONG_FLOW_PLAN_TIMEOUT_MS),
  });

  if (planResp.ok) {
    totalIn += planResp.tokensIn;
    totalOut += planResp.tokensOut;

    const parsedPlan = parseArcPlanFromResponse(planResp.content);
    if (validateArcSegments(parsedPlan?.segments ?? [], dateRangeDays)) {
      segments = parsedPlan!.segments;
      flowName = parsedPlan?.flowName ?? flowName;
      overview = parsedPlan?.overview ?? overview;
    } else {
      console.log(
        "[ai_generate_flow] long_flow: planner returned invalid segments; using default tiling",
      );
    }
  } else {
    console.log(
      "[ai_generate_flow] long_flow: planner failed, continuing with default tiling:",
      planResp.error,
    );
  }

  if (!String(flowName ?? "").trim()) flowName = "Planned Flow";

  const multiEventOk = inferMultiEventOk(
    mode,
    flowType,
    cleanDescription,
    dateRangeDays,
    flowFormat,
  );

  const segmentChunkAddendum = `

LONG_FLOW_SEGMENT_MODE (overrides general rules where they conflict):
- Return the same top-level JSON shape (flowName, optional overview, notes[]).
- notes MUST ONLY use day_index values from START_DAY through END_DAY (inclusive).
- Cover every day_index in that inclusive range at least once.
- Prefer ONE timed main session per day unless MULTI_EVENT_OK is true or FLOW_FORMAT clearly requires multiple notes for the day.
- If SOURCE_HANDLING=SYNTHESIZE_FROM_SOURCE, organize the material into the best progression for this segment instead of mirroring raw source order.
- If SOURCE_HANDLING=PRESERVE_STRUCTURE, keep source day order, titles, details, and links recognizable, but you may add a brief setup/execution cue and one concise adjustment sentence.
- Preserve nuance from GLOBAL_SOURCE_ANCHORS and SOURCE_EXCERPT. Do not collapse the user's material into generic habit advice.
- Keep details concise but fully usable. Regimen and project notes can be denser; meal, finance, and synthesis notes can be shorter when they stay concrete and complete.
- Keep titles specific; avoid placeholder language like "Day 5 task"—use deliverable-oriented titles.
- Vary wording day-to-day; no recycled opener sentences.
- Later days must build on earlier work instead of restarting the flow from scratch.
${flowFormatPromptBlock}${
    planSpecPromptBlock ? `\n${planSpecPromptBlock}` : ""
  }`;

  const shouldSplitTimedOutSegment = (
    errorText: string | undefined,
    daysInSeg: number,
    depth: number,
  ): boolean =>
    !!errorText &&
    /timed out|timeout|aborted/i.test(errorText) &&
    daysInSeg >= 20 &&
    depth < 2;

  const baseHeaderStatic = [
    `MODE: ${mode}`,
    `SCHEDULE_MODE: ${schedule.scheduleMode}`,
    `SPECIFIC_DAYS: ${schedule.specificDays.join(",")}`,
    `INTERVAL_N: ${
      schedule.scheduleMode === "INTERVAL" ? (schedule.intervalN ?? "") : ""
    }`,
    `TIME_PREFERENCE: ${timePreference}`,
    `REQUESTED_TIME_WINDOW: ${
      requestedTimeWindow
        ? `${requestedTimeWindow.startTime}-${requestedTimeWindow.endTime}`
        : ""
    }`,
    `SOURCE_HANDLING: ${sourceHandling}`,
    `TIMEZONE: ${timezoneValue}`,
    `FLOW_TYPE: ${flowType}`,
    `FLOW_FORMAT: ${flowFormat}`,
    `THREE_MEALS_PER_DAY: ${threeMealDailyFlow}`,
    `TECHNICAL_CRAFT: ${technicalCraft}`,
  ].join("\n");

  const segCount = segments.length;

  const runOneSegment = async (
    seg: FlowArcSegmentPlan,
    segIndex: number,
    depth = 0,
  ): Promise<
    { ok: boolean; chunk?: LLMFlow; error?: string; tin: number; tout: number }
  > => {
    const start = seg.startDay;
    const end = seg.endDay;
    const daysInSeg = end - start + 1;
    const header = [
      baseHeaderStatic,
      `MULTI_EVENT_OK: ${multiEventOk}`,
      `DATE_RANGE: ${startDate} → ${endDate} (${dateRangeDays} days total)`,
      `LONG_FLOW: true`,
      `SEGMENT: ${segIndex + 1} of ${segCount}`,
      `START_DAY: ${start}`,
      `END_DAY: ${end}`,
      `(Generate ONLY day_index ${start}..${end} inclusive.)`,
    ].join("\n");

    const excerpt = excerptForSourceSegment(
      cleanSource || cleanDescription,
      segIndex,
      segCount,
      veryLongFlow ? 4_800 : LONG_FLOW_SEGMENT_EXCERPT_CAP,
    );
    const userBlock = [
      header,
      "",
      "GLOBAL_SOURCE_ANCHORS:",
      globalAnchors || "(none)",
      decisionMatrixBlock ? `\n${decisionMatrixBlock}` : "",
      youtubePromptBlock ? `\n${youtubePromptBlock}` : "",
      "",
      flowFormatPromptBlock,
      "",
      `ARC_OVERVIEW_SUMMARY: ${
        (overview?.summary || fallbackOverview.summary).trim()
      }`,
      "",
      `SEGMENT_THEME: ${seg.theme}`,
      `SEGMENT_OBJECTIVES:\n- ${
        (seg.objectives?.length
          ? seg.objectives
          : ["Execute next milestones from material"]).join("\n- ")
      }`,
      `SEGMENT_BEATS:\n- ${
        (seg.beats?.length
          ? seg.beats
          : ["Ship one tangible artifact this segment"]).join("\n- ")
      }`,
      "",
      "SOURCE_EXCERPT_FOR_THIS_SEGMENT:",
      excerpt || "(no additional excerpt; use USER_DESCRIPTION below)",
      "",
      "USER_DESCRIPTION:",
      cleanDescription.slice(0, 8000),
    ].join("\n");

    const targetTokensPerDay = veryLongFlow
      ? 120
      : dateRangeDays >= 50
      ? 160
      : 210;
    const maxTok = Math.min(
      veryLongFlow ? 3600 : 4600,
      Math.max(1500, Math.ceil(daysInSeg * targetTokensPerDay)),
    );

    const aiResp = await generateWithOpenAI({
      messages: [
        {
          role: "system",
          content: LONG_FLOW_SEGMENT_SYSTEM + segmentChunkAddendum,
        },
        { role: "user", content: userBlock },
      ],
      model,
      temperature: mode === "DICTATION" ? 0.2 : 0.45,
      max_tokens: maxTok,
      signal: AbortSignal.timeout(LONG_FLOW_SEGMENT_TIMEOUT_MS),
    });

    if (!aiResp.ok) {
      if (shouldSplitTimedOutSegment(aiResp.error, daysInSeg, depth)) {
        const splitPoint = start + Math.floor(daysInSeg / 2) - 1;
        const leftSeg: FlowArcSegmentPlan = {
          ...seg,
          endDay: splitPoint,
        };
        const rightSeg: FlowArcSegmentPlan = {
          ...seg,
          startDay: splitPoint + 1,
        };

        console.log(
          "[ai_generate_flow] segment timeout, splitting range",
          JSON.stringify({ start, end, depth, splitPoint }),
        );

        const left = await runOneSegment(leftSeg, segIndex, depth + 1);
        if (!left.ok || !left.chunk) {
          return {
            ok: false,
            error: left.error ?? aiResp.error,
            tin: left.tin,
            tout: left.tout,
          };
        }

        const right = await runOneSegment(rightSeg, segIndex, depth + 1);
        if (!right.ok || !right.chunk) {
          return {
            ok: false,
            error: right.error ?? aiResp.error,
            tin: left.tin + right.tin,
            tout: left.tout + right.tout,
          };
        }

        const mergedSplitChunk: LLMFlow = {
          flowName,
          overview: overview ?? fallbackOverview,
          notes: [...(left.chunk.notes ?? []), ...(right.chunk.notes ?? [])],
        };

        ensureLLMNoteTimes(mergedSplitChunk);
        const mergedValidation = validateLLMFlowOutputForRange(
          mergedSplitChunk,
          dateRangeDays,
          start,
          end,
        );
        if (!mergedValidation.ok) {
          return {
            ok: false,
            error: mergedValidation.errors.join("; "),
            tin: left.tin + right.tin,
            tout: left.tout + right.tout,
          };
        }

        return {
          ok: true,
          chunk: mergedSplitChunk,
          tin: left.tin + right.tin,
          tout: left.tout + right.tout,
        };
      }
      return { ok: false, error: aiResp.error, tin: 0, tout: 0 };
    }

    const text = stripCodeFences(aiResp.content);
    let chunk: LLMFlow | null = null;
    try {
      chunk = JSON.parse(text) as LLMFlow;
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/m);
      if (jsonMatch) {
        try {
          chunk = JSON.parse(jsonMatch[0]) as LLMFlow;
        } catch {
          chunk = null;
        }
      }
    }

    if (!chunk || !Array.isArray(chunk.notes)) {
      return {
        ok: false,
        error: "parse",
        tin: aiResp.tokensIn,
        tout: aiResp.tokensOut,
      };
    }

    ensureLLMNoteTimes(chunk);
    const sliceValidation = validateLLMFlowOutputForRange(
      chunk,
      dateRangeDays,
      start,
      end,
    );
    const mealValidation = threeMealDailyFlow
      ? validateThreeMealDailyShape(
        chunk.notes ?? [],
        dateRangeDays,
        start,
        end,
      )
      : { ok: true, errors: [] as string[] };
    if (!sliceValidation.ok) {
      console.log(
        "[ai_generate_flow] segment validation issues:",
        sliceValidation.errors.slice(0, 8),
      );
    }
    if (!mealValidation.ok) {
      console.log(
        "[ai_generate_flow] meal segment validation issues:",
        mealValidation.errors.slice(0, 8),
      );
    }

    return {
      ok: sliceValidation.ok && mealValidation.ok,
      chunk,
      error: !sliceValidation.ok
        ? sliceValidation.errors.join("; ")
        : (!mealValidation.ok ? mealValidation.errors.join("; ") : undefined),
      tin: aiResp.tokensIn,
      tout: aiResp.tokensOut,
    };
  };

  const rawConc = parseInt(
    Deno.env.get("LONG_FLOW_SEGMENT_CONCURRENCY") ??
      String(LONG_FLOW_SEGMENT_CONCURRENCY_DEFAULT),
    10,
  );
  const segmentConcurrency = Number.isFinite(rawConc) && rawConc >= 1
    ? Math.min(4, Math.floor(rawConc))
    : LONG_FLOW_SEGMENT_CONCURRENCY_DEFAULT;
  console.log(
    "[ai_generate_flow] long_flow segments=",
    segments.length,
    "concurrency=",
    segmentConcurrency,
  );

  const segmentOutcomes = await mapPool(
    segments,
    segmentConcurrency,
    (seg, i) => runOneSegment(seg, i),
  );
  const chunkResults: LLMFlow[] = [];
  for (const o of segmentOutcomes) {
    if (!o.ok || !o.chunk) {
      return {
        ok: false,
        error: "SEGMENT_ERROR",
        message: o.error ?? "A segment failed to generate",
      };
    }
    totalIn += o.tin;
    totalOut += o.tout;
    chunkResults.push(o.chunk);
  }

  const mergedNotes: LLMNote[] = [];
  for (const c of chunkResults) {
    for (const n of c.notes ?? []) {
      mergedNotes.push(n);
    }
  }
  mergedNotes.sort((a, b) => {
    if (a.day_index !== b.day_index) return a.day_index - b.day_index;
    return 0;
  });

  const merged: LLMFlow = {
    flowName,
    overview: overview ?? chunkResults[0]?.overview,
    notes: mergedNotes,
  };

  ensureLLMNoteTimes(merged);
  const fullValidation = validateLLMFlowOutput(merged, dateRangeDays);
  if (!fullValidation.ok) {
    return {
      ok: false,
      error: "MERGE_VALIDATION",
      message: fullValidation.errors.join("; "),
    };
  }

  return {
    ok: true,
    llmFlow: merged,
    tokensIn: totalIn,
    tokensOut: totalOut,
    modelUsed: model,
    llmStatus: "long_flow_success",
  };
}

// Minimal post-processing: only normalize legacy headings and fill truly empty notes.
function enforceRichStructure(flow: ParsedFlow) {
  const normalizeOldHeadings = (text: string) =>
    (text ?? "").replace(/^\s*Orientation:\s*$/im, "Arrival:");

  flow.notes = flow.notes.map((n) => {
    const details = normalizeOldHeadings((n.details ?? "").trim());

    // If the note is empty, provide a single prompt; otherwise leave model output untouched.
    if (!details) {
      return {
        ...n,
        details:
          "Write one sentence: what is the next obvious move, and what would make it easier?",
      };
    }

    return { ...n, details };
  });
}

function applySensibleTimes(opts: {
  notes: ParsedNote[];
  mode: "DICTATION" | "ELABORATION";
  flowType: FlowType;
  flowFormat?: FlowFormat;
  description: string;
  requestedTimeWindow?: RequestedTimeWindow | null;
  mealFlow?: boolean;
  threeMealDailyFlow?: boolean;
}): ParsedNote[] {
  const {
    notes,
    mode,
    flowType,
    flowFormat = "STANDARD",
    description,
    requestedTimeWindow,
    mealFlow = false,
    threeMealDailyFlow = false,
  } = opts;
  if (!Array.isArray(notes)) return notes;
  const hasExplicitTimeWindow = requestedTimeWindow != null &&
    isValidTimeString(requestedTimeWindow.startTime) &&
    isValidTimeString(requestedTimeWindow.endTime);
  if (mode === "DICTATION" && !hasExplicitTimeWindow) return notes;

  const desc = (description || "").toLowerCase();
  const ft = (flowType || "").toLowerCase();

  const isMealFlow = mealFlow ||
    /\b(meal|meals|recipe|recipes|cook|cooking|dinner|lunch|breakfast|meal prep)\b/
      .test(desc) ||
    ft === "meal";

  const wantsDinner = /\b(dinner|dinners)\b/.test(desc) ||
    /\bweek of dinners\b/.test(desc) ||
    /\b(dinner recipes)\b/.test(desc);

  const wantsLunch = /\blunch\b/.test(desc);
  const wantsBreakfast = /\bbreakfast\b/.test(desc);
  const sessionStyle = usesSessionStyleStructure(flowFormat);

  let mainStart = "09:00";
  let mainEnd = "10:00";

  if (hasExplicitTimeWindow) {
    mainStart = requestedTimeWindow!.startTime;
    mainEnd = requestedTimeWindow!.endTime;
  } else if (isMealFlow) {
    if (wantsDinner) {
      mainStart = "18:00";
      mainEnd = "19:00";
    } else if (wantsLunch) {
      mainStart = "12:00";
      mainEnd = "12:45";
    } else if (wantsBreakfast) {
      mainStart = "07:00";
      mainEnd = "07:45";
    } else {
      mainStart = "18:00";
      mainEnd = "19:00";
    }
  } else if (flowFormat === "PROJECT_PLAN") {
    mainStart = "09:00";
    mainEnd = "10:30";
  } else if (flowFormat === "FINANCE_PLAN") {
    mainStart = "09:30";
    mainEnd = "10:30";
  } else if (flowFormat === "SYNTHESIS") {
    mainStart = "08:30";
    mainEnd = "09:30";
  } else if (
    /\bworkout|fitness|training\b/.test(ft) || /\bworkout|gym\b/.test(desc)
  ) {
    mainStart = "07:00";
    mainEnd = "08:00";
  } else if (
    /\bbusiness|deep work|work\b/.test(ft) || /\bdeep work|focus\b/.test(desc)
  ) {
    mainStart = "09:00";
    mainEnd = "11:00";
  } else if (/\bjournal|reflection\b/.test(ft)) {
    mainStart = "20:00";
    mainEnd = "20:30";
  }

  const grouped = new Map<number, ParsedNote[]>();
  for (const n of notes) {
    const di = Number.isFinite(n?.day_index) ? (n.day_index as number) : 0;
    const bucket = grouped.get(di) ?? [];
    bucket.push(n);
    grouped.set(di, bucket);
  }

  const setNoteTime = (n: ParsedNote, start: string, end: string) => {
    n.all_day = false;
    n.start_time = start;
    n.end_time = end;
  };
  const hasUsableTime = (n: ParsedNote) =>
    isValidTimeString(n.start_time) && isValidTimeString(n.end_time);
  const minutesToClock = (totalMinutes: number) => {
    const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return `${String(hour).padStart(2, "0")}:${
      String(minute).padStart(2, "0")
    }`;
  };

  const clampEvening = (n: ParsedNote) => setNoteTime(n, "20:00", "20:30");
  const setMain = (n: ParsedNote) => setNoteTime(n, mainStart, mainEnd);
  const setMealSlot = (n: ParsedNote, slot: MealSlot) => {
    if (slot === "breakfast") {
      setNoteTime(n, "07:00", "08:00");
    } else if (slot === "lunch") {
      setNoteTime(n, "12:00", "13:00");
    } else {
      setNoteTime(n, "18:00", "19:30");
    }
  };

  for (const [, dayNotes] of grouped.entries()) {
    if (!Array.isArray(dayNotes) || dayNotes.length === 0) continue;

    if (threeMealDailyFlow) {
      const mealNotes = dayNotes.filter((n) => !isEveningReflectionNote(n));
      const assigned = new Set<ParsedNote>();

      for (const slot of ["breakfast", "lunch", "dinner"] as MealSlot[]) {
        const matched = mealNotes.find((note) =>
          !assigned.has(note) &&
          inferMealSlot(note.title, note.details, note.start_time) === slot
        );
        if (matched) {
          setMealSlot(matched, slot);
          assigned.add(matched);
        }
      }

      const leftovers = mealNotes.filter((note) => !assigned.has(note));
      for (const [index, note] of leftovers.entries()) {
        const fallbackSlot = (["breakfast", "lunch", "dinner"] as MealSlot[])[
          Math.min(index, 2)
        ];
        setMealSlot(note, fallbackSlot);
      }
      continue;
    }

    if (!sessionStyle) {
      const durationMinutes = Math.max(
        30,
        (timeToMinutes(mainEnd) ?? 600) - (timeToMinutes(mainStart) ?? 540),
      );
      const gapMinutes = flowFormat === "PROJECT_PLAN" ? 90 : 60;
      let nextStartMinutes = timeToMinutes(mainStart) ?? 540;
      const ordered = dayNotes.slice().sort((a, b) => {
        const aMinutes = timeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
        const bMinutes = timeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
        return aMinutes - bMinutes;
      });

      for (const note of ordered) {
        if (!hasExplicitTimeWindow && hasUsableTime(note)) {
          nextStartMinutes =
            (timeToMinutes(note.end_time) ?? nextStartMinutes) + gapMinutes;
          continue;
        }
        const start = minutesToClock(nextStartMinutes);
        const end = minutesToClock(nextStartMinutes + durationMinutes);
        setNoteTime(note, start, end);
        nextStartMinutes += durationMinutes + gapMinutes;
      }
      continue;
    }

    if (dayNotes.length === 1) {
      setMain(dayNotes[0]);
      continue;
    }

    dayNotes.sort((a, b) =>
      (a.start_time || "").localeCompare(b.start_time || "")
    );

    let evening = dayNotes.find((n) => isEveningReflectionNote(n)) ??
      dayNotes[dayNotes.length - 1];
    const main = dayNotes.find((n) => n !== evening) ?? dayNotes[0];

    clampEvening(evening);
    setMain(main);
  }

  return notes;
}

function calculateCostCents(model, tokensIn, tokensOut) {
  if (model.includes("haiku")) {
    return Math.round(((tokensIn * 0.8 + tokensOut * 4.0) / 10000) * 100);
  }
  return Math.round(((tokensIn * 3.0 + tokensOut * 15.0) / 10000) * 100);
}

function hexColorToBigInt(hexColor) {
  if (!hexColor) return NaN; // Return NaN for consistency with parseInt behavior
  // Remove # if present
  const hex = hexColor.replace("#", "");
  // Convert to integer (0xFFFFFF format)
  // parseInt returns NaN if it can't parse
  return parseInt(hex, 16);
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origin.length ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  console.log(
    "[ai_generate_flow] request",
    JSON.stringify({
      method: req.method,
      origin: origin ?? null,
      acrh: req.headers.get("access-control-request-headers"),
      userAgent: req.headers.get("user-agent"),
    }),
  );

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  console.log(
    "AI_GENERATE_FLOW_BUILD=2026-05-08_flow_plan_fast_path_v1",
  );
  const systemPrompt = getMemoSystemPrompt();
  const promptFingerprint = await getMemoPromptFingerprint();
  const promptFingerprintShort = promptFingerprint.slice(0, 12);
  console.log(`[ai_generate_flow] PROMPT_VERSION=${promptFingerprintShort}`);

  try {
    const body = await parseJsonSafe(req);
    if (!body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    const { description, startDate, endDate, flowName, flowColor, timezone } =
      body;
    const MAX_INBOUND_SOURCE = 96_000;
    const rawSource = body?.source_text;
    const source_text =
      typeof rawSource === "string" && rawSource.length > MAX_INBOUND_SOURCE
        ? rawSource.slice(0, MAX_INBOUND_SOURCE)
        : (typeof rawSource === "string" ? rawSource : undefined);
    const forceRefresh = body?.force_refresh === true;
    console.log("[ai_generate_flow] PROMPT_VERSION:", promptFingerprintShort);
    console.log("[ai_generate_flow] force_refresh:", forceRefresh);
    if (!description || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    // ✅ Initialize immediately after required fields check (avoids TDZ)
    const descForSignals = `${description}\n${source_text ?? ""}`;
    const flowFormat = inferFlowFormat(description, source_text);
    const mealFlow = flowFormat === "MEAL_PLAN";
    const threeMealDailyFlow = mealFlow &&
      wantsThreeMealDailyFlow(description, source_text);
    let flowType: FlowType = "generic";
    if (mealFlow) {
      flowType = "meal";
    } else if (
      /(workout|gym|lift|training|practice drums|practice guitar)/i.test(
        descForSignals,
      )
    ) {
      flowType = "workout";
    } else if (/(hair|skin|scalp|body care|detox)/i.test(descForSignals)) {
      flowType = "body";
    } else if (
      /(business|startup|marketing|sales|clients|leads)/i.test(descForSignals)
    ) {
      flowType = "business";
    }
    const technicalCraft = mealFlow
      ? false
      : detectTechnicalCraft(descForSignals);
    console.log("[ai_generate_flow] technicalCraft:", technicalCraft);
    console.log("[ai_generate_flow] flowType:", flowType);
    console.log("[ai_generate_flow] flowFormat:", flowFormat);
    console.log("[ai_generate_flow] mealFlow:", mealFlow);
    console.log("[ai_generate_flow] threeMealDailyFlow:", threeMealDailyFlow);

    const start = new Date(startDate);
    const end = new Date(endDate);
    const dateRangeDays = Math.floor(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      !Number.isFinite(dateRangeDays) ||
      dateRangeDays <= 0
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid date range" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    const __authHeader = req.headers.get("authorization") ?? "";
    if (!__authHeader.trim()) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: No auth header" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    const earlySparsePromptRoutineNotes = buildSparsePromptRoutineNotes({
      description,
      sourceText: source_text,
      dateRangeDays,
      flowFormat,
    });
    if (earlySparsePromptRoutineNotes) {
      const sourceBackedOverview = buildSourceBackedOverview(
        description,
        source_text,
        dateRangeDays,
      );
      const earlyFlowName = sourceBackedOverview?.title?.trim() ||
        String(flowName ?? "").trim() ||
        "Generated Flow";
      const earlyOverview = sourceBackedOverview ?? {
        title: earlyFlowName,
        summary:
          `A ${dateRangeDays}-day flow with concrete daily actions and short review checkpoints.`,
      };
      const earlyFlowPlan = buildFlowPlanFromSparseRoutine({
        description,
        sourceText: source_text,
        dateRangeDays,
        flowFormat,
        domain: inferSparsePromptDomain(description, source_text),
        overview: earlyOverview,
        notes: earlySparsePromptRoutineNotes,
      });
      const earlyPlanValidation = validateFlowPlan(earlyFlowPlan);
      if (!earlyPlanValidation.ok || !earlyFlowPlan) {
        console.error(
          "[ai_generate_flow] pre-auth flow_plan validation failed:",
          earlyPlanValidation.errors.join("; "),
        );
      } else {
        const earlyParsedFlow: ParsedFlow = {
          flow_name: earlyFlowName,
          overview_title: earlyFlowPlan.overview.title || earlyFlowName,
          overview_summary: earlyFlowPlan.overview.summary ||
            earlyOverview.summary,
          notes: sortParsedNotesByDayAndTime(
            sanitizeVisibleNumberedInstructionDetails(
              sanitizeGeneratedLocations(
                renderFlowPlanToParsedNotes(earlyFlowPlan),
              ),
            ),
          ),
        };
        const earlyValidation = validateParsedFlow(
          earlyParsedFlow,
          dateRangeDays,
        );
        if (!earlyValidation.ok) {
          console.error(
            "[ai_generate_flow] pre-auth sparse routine validation failed:",
            earlyValidation.error,
          );
        } else {
          const requestedColor = typeof flowColor === "string"
            ? flowColor.trim()
            : "";
          const colorHex = /^#?[0-9a-f]{6}$/i.test(requestedColor)
            ? (requestedColor.startsWith("#")
              ? requestedColor
              : `#${requestedColor}`)
            : "#4dd0e1";
          console.log(
            "[ai_generate_flow] pre-auth sparse_prompt routine return count=",
            earlyParsedFlow.notes.length,
          );
          return new Response(
            JSON.stringify({
              success: true,
              flow_name: earlyParsedFlow.flow_name,
              flow_color: colorHex,
              overview_title: earlyParsedFlow.overview_title,
              overview_summary: earlyParsedFlow.overview_summary,
              notes: earlyParsedFlow.notes,
              ai_metadata: {
                generated: true,
                model: "deterministic:flow_plan_sparse_prompt_routine",
                prompt: String(description).substring(0, 200),
                sparse_prompt_routine: true,
                fast_path: "pre_auth_flow_plan_sparse_prompt_routine",
                ...buildFlowPlanQualityMetadata({
                  plan: earlyFlowPlan,
                  validation: earlyPlanValidation,
                }),
              },
              generation_id: crypto.randomUUID(),
              schema_version: SCHEMA_VERSION,
              policy_version: POLICY_VERSION,
              snapshot_version: SNAPSHOT_VERSION,
              modelUsed: "deterministic:flow_plan_sparse_prompt_routine",
              cached: false,
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders(origin),
              },
            },
          );
        }
      }
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({
          error: "Server misconfiguration: Supabase env missing",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    // ✅ Decode JWT helper (only define once in the file)
    function decodeJwtPayload(token: string): Record<string, any> | null {
      try {
        const parts = token.split(".");
        if (parts.length < 2) return null;
        const payloadB64 = parts[1];
        const b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json);
      } catch {
        return null;
      }
    }

    // ✅ Extract userId (declare ONCE, early)
    const jwt = __authHeader.startsWith("Bearer ")
      ? __authHeader.slice(7)
      : __authHeader;
    const claims = jwt ? decodeJwtPayload(jwt) : null;
    const userId: string | null = (claims && typeof claims.sub === "string")
      ? claims.sub
      : null;

    if (!userId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "UNAUTHENTICATED",
          message: "Missing or invalid Authorization token",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    // ✅ Create the user-bound client (declare ONCE, before quota + OpenAI)
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: __authHeader } },
    });

    const verboseAuth =
      Deno.env.get("AI_GENERATE_FLOW_VERBOSE_AUTH") === "true";
    if (verboseAuth) {
      console.log("=== AUTH DEBUG START ===");
      const authKeys: string[] = [];
      for (const [key] of req.headers.entries()) {
        if (key.toLowerCase().includes("auth")) authKeys.push(key);
      }
      console.log("🔍 Auth-related header keys:", authKeys.join(", "));
    }

    if (!__authHeader.trim()) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: No auth header" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SERVICE_ROLE_KEY");
    const supabaseAdmin = supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey)
      : null;

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(
      jwt,
    );

    if (userErr) {
      console.error(
        "[ai_generate_flow] getUser failed:",
        userErr.message ?? userErr,
      );
      if (verboseAuth) console.log("=== AUTH DEBUG END ===");
      return new Response(
        JSON.stringify({ error: "Unauthorized: " + userErr.message }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    if (!user) {
      console.error("[ai_generate_flow] getUser returned no user");
      if (verboseAuth) console.log("=== AUTH DEBUG END ===");
      return new Response(JSON.stringify({ error: "Unauthorized: No user" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      });
    }

    if (verboseAuth) {
      console.log("✅ User authenticated:", user.id);
      console.log("=== AUTH DEBUG END ===");
    }
    // ✅ userId already exists from line 321 (JWT claims) - no need to redeclare
    // Sanity check: ensure getUser() userId matches JWT claims
    if (user.id !== userId) {
      console.log("⚠️ WARNING: getUser() userId mismatch with JWT claims");
    }

    const generationId = crypto.randomUUID();
    const snapshotVersion = SNAPSHOT_VERSION;
    const schemaVersion = SCHEMA_VERSION;
    const policyVersion = POLICY_VERSION;

    // Rate limiting removed - let OpenAI handle rate limiting

    const cacheUnavailable = !supabaseAdmin;
    const skipCache = forceRefresh === true || cacheUnavailable ||
      !FLOW_GENERATION_CACHE_ENABLED;
    let cached = false;
    let llmFlow: LLMFlow | null = null;
    let cachedPlanEnvelope: LLMPlanEnvelope | null = null;
    let modelUsed = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let llmStatus = skipCache ? "cache_bypass" : "error";
    let costCents = 0;
    let mode: "DICTATION" | "ELABORATION" = "ELABORATION";
    let sourceHandling: SourceHandlingMode = "NONE";
    const startTime = Date.now();
    const dmPolicyVersion = "kg_dm_v1";
    let outcomeVectors: OutcomeVectorV1[] = [];
    let constraintsJson: ConstraintsV1 = deriveConstraintsV1([]);
    let constraintsFetchStatus:
      | "ok"
      | "error"
      | "unavailable"
      | "skipped_personalization_off" = "unavailable";
    let personalizationEnabled: boolean | null = null;
    let prefsEnvelope: PrefsEnvelope = null;
    let preferredHours: number[] = [];
    let avoidHours: number[] = [];
    let prefsVersion = "prefs_v1";
    let prefsPromptSnippet: string | null = null;
    let prefsUsed = false;
    let reflectionProfile: ReflectionProfileRow | null = null;
    let decisionMatrix: FlowDecisionMatrixV1 | null = null;
    let youtubeResources: YouTubeResource[] = [];
    let youtubePromptBlock = "";
    let youtubeSearchModel = "";
    let planIntent: ReturnType<typeof classifyIntent> | null = null;
    let planDecisionMatrix: PlanDecisionMatrixV2 | null = null;
    let planSpec: PlanSpecV2 | null = null;
    let planSpecValidation:
      | ReturnType<typeof validatePlanSpec>
      | null = null;
    let planSpecError: string | null = null;
    let plannerFirstAttempted = false;
    let plannerFirstError: string | null = null;
    let plannerFirstUsed = false;
    let flowPlanMetadata: Record<string, unknown> | null = null;
    let parsedFlow: ParsedFlow | null = null;

    try {
      const { data: profileRow, error: profileErr } = await supabaseUser
        .from("profiles")
        .select("personalization_enabled")
        .eq("id", userId)
        .maybeSingle();
      if (profileErr) {
        console.log(
          "⚠️ personalization flag fetch error:",
          profileErr.message ?? profileErr,
        );
      } else {
        personalizationEnabled = profileRow?.personalization_enabled ?? true;
      }
    } catch (err) {
      console.log("⚠️ personalization flag fetch threw:", err?.message ?? err);
    }

    const personalizationDisabled = personalizationEnabled === false;

    if (personalizationDisabled) {
      outcomeVectors = [];
      constraintsJson = deriveConstraintsV1([]);
      constraintsFetchStatus = "skipped_personalization_off";
      prefsEnvelope = null;
      preferredHours = [];
      avoidHours = [];
      prefsPromptSnippet = null;
      prefsVersion = "prefs_v1";
      prefsUsed = false;
    } else {
      const outcomeResult = await fetchOutcomeVectors(
        supabaseUser,
        userId,
        OUTCOME_VECTOR_LIMIT,
      );
      outcomeVectors = outcomeResult.vectors;
      constraintsFetchStatus = outcomeResult.status;
      constraintsJson = deriveConstraintsV1(outcomeVectors);

      prefsEnvelope = await fetchMyPreferences(supabaseUser);
      const prefs = prefsEnvelope?.prefs ?? null;
      const sanitizeHours = (value: any): number[] => {
        if (!Array.isArray(value)) return [];
        const seen = new Set<number>();
        const result: number[] = [];
        for (const hourValue of value) {
          const n = Number(hourValue);
          if (!Number.isFinite(n)) continue;
          const hour = Math.floor(n);
          if (hour < 0 || hour > 23) continue;
          if (seen.has(hour)) continue;
          seen.add(hour);
          result.push(hour);
          if (result.length >= 6) break;
        }
        return result;
      };

      preferredHours = sanitizeHours(prefs?.preferred_hours);
      avoidHours = sanitizeHours(prefs?.avoid_hours);
      prefsVersion = prefsEnvelope?.prefs_version ?? prefs?.prefs_version ??
        "prefs_v1";

      let prefsSnippet = "";
      if (preferredHours.length > 0 || avoidHours.length > 0) {
        prefsSnippet = `DM_PREFERENCES (${prefsVersion}):`;
        if (preferredHours.length > 0) {
          prefsSnippet += `\n- PREFERRED_HOURS_LOCAL: ${
            preferredHours.join(",")
          }`;
        }
        if (avoidHours.length > 0) {
          prefsSnippet += `\n- AVOID_HOURS_LOCAL: ${avoidHours.join(",")}`;
        }
      }
      prefsPromptSnippet = prefsSnippet ? prefsSnippet.trim() : null;
      prefsUsed = !!(prefsPromptSnippet && prefsPromptSnippet.length > 0);

      reflectionProfile = await fetchReflectionProfile(supabaseUser, userId);
      decisionMatrix = buildFlowDecisionMatrix(reflectionProfile);
    }
    const baseInputMeta: Record<string, any> = {
      cache_bypass: skipCache,
      cache_enabled: FLOW_GENERATION_CACHE_ENABLED,
      cache_unavailable: cacheUnavailable,
      constraints_vectors: outcomeVectors.length,
      constraints_eligible: constraintsJson.eligible_vectors,
      constraints_fetch_status: constraintsFetchStatus,
      constraints_version: constraintsJson.constraints_version,
    };
    const prefsFetchStatus = personalizationDisabled
      ? "skipped_personalization_off"
      : (prefsEnvelope ? "ok" : "none");
    const prefsSnippetForMeta = prefsUsed && prefsPromptSnippet
      ? prefsPromptSnippet.trim().slice(0, 220)
      : null;

    baseInputMeta.prefs_fetch = prefsFetchStatus;
    baseInputMeta.prefs_used = prefsUsed;
    baseInputMeta.prefs_version = prefsUsed ? prefsVersion : null;
    baseInputMeta.prefs_ph = prefsUsed ? preferredHours : [];
    baseInputMeta.prefs_ah = prefsUsed ? avoidHours : [];
    baseInputMeta.prefs_snippet = prefsSnippetForMeta;
    baseInputMeta.graph_profile_used = reflectionProfile != null;
    baseInputMeta.decision_matrix_used = decisionMatrix != null;
    baseInputMeta.decision_matrix_version = decisionMatrix?.version ?? null;
    baseInputMeta.decision_matrix_anchor_nodes = decisionMatrix?.anchorNodes ??
      [];
    baseInputMeta.decision_matrix_balance = decisionMatrix?.balanceMode ?? null;
    baseInputMeta.plan_spec_enabled = FLOWSPEC_V2_ENABLED;
    baseInputMeta.plan_spec_version = FLOWSPEC_V2_ENABLED
      ? PLAN_SPEC_VERSION
      : null;
    baseInputMeta.planner_first_enabled = PLANNER_FIRST_ENABLED;
    baseInputMeta.visible_output_source = PLANNER_FIRST_ENABLED
      ? "planner_first"
      : "legacy_notes_with_hidden_plan_spec";
    baseInputMeta.meal_flow = mealFlow;
    baseInputMeta.three_meals_per_day = threeMealDailyFlow;

    // --- Phase 4: constraint-to-prompt decision (Option A) ---
    const DM_USE_CONSTRAINTS =
      (Deno.env.get("DM_USE_CONSTRAINTS") ?? "false") === "true";
    const maxEpd = constraintsJson?.limits?.max_events_per_day;
    const constraintsEligible = (constraintsJson?.eligible_vectors ?? 0) >= 1;
    sourceHandling = inferSourceHandling(description, source_text);
    mode = inferMode(description, source_text);
    const youtubeLinksRequested = ENABLE_YOUTUBE_LINK_SEARCH &&
      wantsYoutubeLinks(description, source_text);
    const sourceHasYoutubeLinks = countYoutubeUrls(source_text ?? "") > 0;
    const shouldSearchYoutubeResources = youtubeLinksRequested &&
      !sourceHasYoutubeLinks;
    const requestedTimeWindow = inferRequestedTimeWindow(description) ??
      inferRequestedTimeWindow(source_text ?? "");
    const sparsePromptExpertDefaultsBlock = buildSparsePromptExpertDefaults({
      description,
      sourceText: source_text,
      dateRangeDays,
      flowFormat,
    });
    baseInputMeta.sparse_prompt_defaults_used =
      sparsePromptExpertDefaultsBlock.length > 0;
    baseInputMeta.sparse_prompt_defaults_preview =
      sparsePromptExpertDefaultsBlock
        ? sparsePromptExpertDefaultsBlock.slice(0, 260)
        : null;
    if (FLOWSPEC_V2_ENABLED) {
      planIntent = classifyIntent({
        description,
        sourceText: source_text,
        flowFormat,
        dateRangeDays,
        sourceHandling,
      });
      planDecisionMatrix = buildDecisionMatrix({
        classification: planIntent,
        requestedTimeWindow,
        outcomeVectors,
        dateRangeDays,
      });
      baseInputMeta.plan_goal_domain = planIntent.domain;
      baseInputMeta.plan_goal_type = planIntent.goal_type;
      baseInputMeta.plan_cue_type = planDecisionMatrix.cue_type;
      baseInputMeta.plan_strategy = planDecisionMatrix.strategy_kind;
    }
    const shortFlowReflectionPairRequired = requiresShortFlowReflectionPair(
      dateRangeDays,
      mode,
      flowFormat,
    );
    const constraintsCanInject = !shortFlowReflectionPairRequired &&
      DM_USE_CONSTRAINTS &&
      constraintsEligible &&
      typeof maxEpd === "number" &&
      Number.isFinite(maxEpd) &&
      maxEpd >= 1;
    let constraintsPromptSnippet: string | null = null;
    if (constraintsCanInject) {
      constraintsPromptSnippet = `DM_CONSTRAINTS (constraints_v1):\n` +
        `- MAX_EVENTS_PER_DAY: ${maxEpd}\n` +
        `Follow this limit unless the user explicitly requests otherwise.`;
    }
    baseInputMeta.constraints_used = constraintsCanInject;
    baseInputMeta.constraints_used_reason = !DM_USE_CONSTRAINTS
      ? "kill_switch_off"
      : shortFlowReflectionPairRequired
      ? "short_flow_reflection_pair_override"
      : (!constraintsEligible
        ? "no_eligible_vectors"
        : (typeof maxEpd !== "number" || !Number.isFinite(maxEpd) || maxEpd < 1
          ? "no_limits"
          : "eligible_vectors>=1 && max_events_per_day set"));
    baseInputMeta.constraints_prompt_snippet = constraintsPromptSnippet
      ? constraintsPromptSnippet.slice(0, 300)
      : null;
    baseInputMeta.source_handling = sourceHandling;
    baseInputMeta.youtube_links_requested = youtubeLinksRequested;
    baseInputMeta.youtube_search_enabled = ENABLE_YOUTUBE_LINK_SEARCH;
    baseInputMeta.youtube_source_links_present = sourceHasYoutubeLinks;
    baseInputMeta.youtube_search_requested = shouldSearchYoutubeResources;
    baseInputMeta.youtube_search_version = shouldSearchYoutubeResources
      ? YOUTUBE_SEARCH_VERSION
      : null;

    const constraintsFingerprint = constraintsCanInject
      ? { v: constraintsJson.constraints_version, max_epd: maxEpd }
      : { v: "none" };
    const prefsFingerprint = prefsUsed
      ? { v: prefsVersion, ph: preferredHours, ah: avoidHours }
      : { v: "none" };
    const decisionMatrixFingerprint = decisionMatrix?.fingerprint ??
      { v: "none" };
    const planSpecFingerprint = FLOWSPEC_V2_ENABLED
      ? {
        v: PLAN_SPEC_VERSION,
        schema: "flowspec_v2",
        prompt: PLANNER_FIRST_ENABLED
          ? "planner_first_v1"
          : "notes_first_hidden_plan_spec_v2",
      }
      : { v: "none" };
    const inputForHash = JSON.stringify({
      description,
      startDate,
      endDate,
      source_text,
      promptFingerprint,
      youtube_links_requested: youtubeLinksRequested,
      youtube_search_version: shouldSearchYoutubeResources
        ? YOUTUBE_SEARCH_VERSION
        : "none",
      constraints: constraintsFingerprint,
      prefs: prefsFingerprint,
      decision_matrix: decisionMatrixFingerprint,
      plan_spec: planSpecFingerprint,
      meal_flow: mealFlow,
      three_meals_per_day: threeMealDailyFlow,
      sparse_prompt_defaults: sparsePromptExpertDefaultsBlock
        ? "expert_defaults_v1"
        : "none",
      cache_enabled: FLOW_GENERATION_CACHE_ENABLED,
      generation_strategy: PLANNER_FIRST_ENABLED && mode !== "DICTATION"
        ? "planner_first_v1"
        : (FLOWSPEC_V2_ENABLED
          ? (dateRangeDays >= LONG_FLOW_THRESHOLD_DAYS
            ? "long_chunked_v1_hidden_plan_spec"
            : "single_v1_hidden_plan_spec")
          : (dateRangeDays >= LONG_FLOW_THRESHOLD_DAYS
            ? "long_chunked_v1"
            : "single_v1")),
    });
    const input_hash = await sha256Hex(inputForHash);

    if (cacheUnavailable) {
      console.log("[ai_generate_flow] cache unavailable (no service role key)");
    }

    if (!skipCache) {
      const { data: cacheRows, error: cacheErr } = await supabaseAdmin
        .from("flow_generation_cache")
        .select(
          "response_json, created_at, model_used, llm_status, prompt_fingerprint",
        )
        .eq("user_id", userId)
        .eq("snapshot_version", snapshotVersion)
        .eq("schema_version", schemaVersion)
        .eq("policy_version", policyVersion)
        .eq("input_hash", input_hash)
        .gte(
          "created_at",
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        )
        .order("created_at", { ascending: false })
        .limit(1);

      if (!cacheErr && Array.isArray(cacheRows) && cacheRows.length > 0) {
        try {
          if (PLANNER_FIRST_ENABLED && mode !== "DICTATION") {
            cachedPlanEnvelope = parsePlanEnvelopeFromResponse(
              JSON.stringify(cacheRows[0].response_json),
            );
          } else {
            llmFlow = cacheRows[0].response_json as LLMFlow;
          }
          cached = true;
          llmStatus = "cache_hit";
          modelUsed = cacheRows[0].model_used ?? "cache";
        } catch (e) {
          cached = false;
        }
      }

      if (cached && PLANNER_FIRST_ENABLED && mode !== "DICTATION") {
        if (
          !cachedPlanEnvelope || !planIntent || !planDecisionMatrix
        ) {
          cached = false;
          cachedPlanEnvelope = null;
          llmStatus = "cache_invalid";
        } else {
          planSpec = coercePlanSpec({
            raw: cachedPlanEnvelope.plan_spec,
            fallbackFlowName: cachedPlanEnvelope.flowName,
            classification: planIntent,
            decisionMatrix: planDecisionMatrix,
            dateRangeDays,
          });
          planSpecValidation = validatePlanSpec(
            planSpec,
            planSpec.actions.length,
            dateRangeDays,
          );
          if (!planSpecValidation.ok) {
            cached = false;
            cachedPlanEnvelope = null;
            planSpec = null;
            planSpecValidation = null;
            llmStatus = "cache_invalid";
          } else {
            parsedFlow = transformPlanEnvelopeToParsedFlow({
              envelope: cachedPlanEnvelope,
              planSpec,
            });
            plannerFirstUsed = true;
          }
        }
      } else if (cached && llmFlow) {
        const cacheValidation = validateLLMFlowOutput(llmFlow, dateRangeDays);
        const mealValidation = threeMealDailyFlow
          ? validateThreeMealDailyShape(llmFlow.notes ?? [], dateRangeDays)
          : { ok: true, errors: [] as string[] };
        if (!cacheValidation.ok || !mealValidation.ok) {
          cached = false;
          llmFlow = null;
          llmStatus = "cache_invalid";
        }
      }
    }

    if (shouldSearchYoutubeResources) {
      const maxYoutubeResults = Math.min(
        18,
        Math.max(8, Math.ceil(dateRangeDays / 2)),
      );
      const youtubeSearch = await searchYoutubeResources({
        description,
        sourceText: source_text,
        timezone,
        maxResults: maxYoutubeResults,
      });
      if (youtubeSearch.ok === true) {
        youtubeResources = youtubeSearch.resources;
        youtubeSearchModel = youtubeSearch.modelUsed;
        youtubePromptBlock = buildYoutubePromptBlock(youtubeResources);
        baseInputMeta.youtube_search_used = true;
        baseInputMeta.youtube_search_context = cached
          ? "postprocess"
          : "generation";
        baseInputMeta.youtube_search_model = youtubeSearchModel;
        baseInputMeta.youtube_results_count = youtubeResources.length;
        baseInputMeta.youtube_search_tokens = {
          in: youtubeSearch.tokensIn,
          out: youtubeSearch.tokensOut,
        };
      } else {
        console.log(
          "[ai_generate_flow] youtube search unavailable:",
          youtubeSearch.message,
        );
        baseInputMeta.youtube_search_used = false;
        baseInputMeta.youtube_search_context = cached
          ? "postprocess"
          : "generation";
        baseInputMeta.youtube_search_error = youtubeSearch.error;
      }
    }

    if (!cached) {
      sourceHandling = inferSourceHandling(description, source_text);
      mode = inferMode(description, source_text);
      const schedule = inferSchedule(description);
      const scheduleForSignals = `${description}\n${
        (source_text || "").slice(0, 8000)
      }`;
      const timePreference = inferTimePreference(scheduleForSignals);
      const timezoneValue = timezone || "UTC";
      console.log(
        "🗓️ INFERRED SCHEDULE:",
        JSON.stringify({
          mode: schedule.scheduleMode,
          specificDays: schedule.specificDays,
          intervalN: schedule.intervalN ?? null,
        }),
      );
      const decisionMatrixBlock = decisionMatrix?.promptBlock
        ? `${decisionMatrix.promptBlock}\n`
        : "";

      if (
        PLANNER_FIRST_ENABLED &&
        mode !== "DICTATION" &&
        planIntent &&
        planDecisionMatrix
      ) {
        plannerFirstAttempted = true;
        const flowNameHint = flowName ? `\nFLOW_NAME_HINT: ${flowName}` : "";
        const constraintsBlock = baseInputMeta.constraints_used &&
            baseInputMeta.constraints_prompt_snippet
          ? `\n\n${String(baseInputMeta.constraints_prompt_snippet)}\n`
          : "\n\n";
        const flowFormatPromptBlock = buildFlowFormatPromptBlock({
          flowFormat,
          threeMealDailyFlow,
        });
        const academicLearningPromptBlock = buildAcademicLearningPromptBlock({
          description,
          sourceText: source_text,
        });
        const planSpecPromptBlock = buildPlanSpecPromptBlock({
          flowFormat,
          schemaVersion,
        });
        const promptSourceText = source_text
          ? buildCondensedSourceContext(
            source_text,
            sourceHandling === "PRESERVE_STRUCTURE"
              ? LONG_FLOW_PLAN_SOURCE_CLAMP
              : SINGLE_FLOW_SOURCE_CONTEXT_MAX_CHARS,
            sourceHandling === "PRESERVE_STRUCTURE" ? 36 : 20,
            sourceHandling === "PRESERVE_STRUCTURE" ? 1400 : 1000,
          )
          : "";
        const prefsBlock = prefsUsed && prefsPromptSnippet
          ? `${prefsPromptSnippet}\n`
          : "";
        const plannerMatrixBlock = buildPlannerDecisionMatrixPromptBlock({
          classification: planIntent,
          decisionMatrix: planDecisionMatrix,
        });
        const shortFlowPlannerRule = shortFlowReflectionPairRequired
          ? `SHORT_FLOW_PLANNER_RULE:\n- This flow is ${dateRangeDays} days (<= ${SHORT_FLOW_REFLECTION_PAIR_THRESHOLD_DAYS}). Every day_index must include a concise evening review action at 20:00-20:30.\n- Default to one concrete primary action before 19:00 plus the evening review.\n- If the domain naturally needs a separate daily implementation phase, create up to two concrete non-reflection actions before the evening review, for a maximum of 3 actions per day_index.\n- Non-reflection action titles must not include evening, review, recap, or reflection. They must be direct goal-progress work, not planning or reflection substitutes.`
          : "";
        const plannerPromptBase = [
          `MODE: ${mode}`,
          `SOURCE_HANDLING: ${sourceHandling}`,
          `SCHEDULE_MODE: ${schedule.scheduleMode}`,
          `SPECIFIC_DAYS: ${schedule.specificDays.join(",")}`,
          `INTERVAL_N: ${
            schedule.scheduleMode === "INTERVAL"
              ? (schedule.intervalN ?? "")
              : ""
          }`,
          `TIME_PREFERENCE: ${timePreference}`,
          `REQUESTED_TIME_WINDOW: ${
            requestedTimeWindow
              ? `${requestedTimeWindow.startTime}-${requestedTimeWindow.endTime}`
              : ""
          }`,
          `TIMEZONE: ${timezoneValue}`,
          `DATE_RANGE: ${startDate} → ${endDate} (${dateRangeDays} days)`,
          `FLOW_TYPE: ${flowType}`,
          `FLOW_FORMAT: ${flowFormat}`,
          `THREE_MEALS_PER_DAY: ${threeMealDailyFlow}`,
          `TECHNICAL_CRAFT: ${technicalCraft}`,
        ].join("\n") +
          `${flowNameHint}${constraintsBlock}${prefsBlock}${decisionMatrixBlock}${plannerMatrixBlock}\n\n${
            shortFlowPlannerRule ? `${shortFlowPlannerRule}\n\n` : ""
          }${flowFormatPromptBlock}\n\n${
            sparsePromptExpertDefaultsBlock
              ? `${sparsePromptExpertDefaultsBlock}\n\n`
              : ""
          }${
            academicLearningPromptBlock
              ? `${academicLearningPromptBlock}\n\n`
              : ""
          }${planSpecPromptBlock}\n\nUSER_DESCRIPTION:\n${description}\n\n${
            promptSourceText ? `SOURCE_TEXT:\n${promptSourceText}\n\n` : ""
          }${
            youtubePromptBlock ? `${youtubePromptBlock}\n\n` : ""
          }Cover every day_index 0..${
            dateRangeDays - 1
          } with at least one action. Use short maintain/reset/review actions on lighter days instead of leaving gaps.`;
        const plannerMaxTokens = Math.min(
          12000,
          Math.max(3500, 1400 + dateRangeDays * 140),
        );
        const plannerSystemPrompt = buildPlannerFirstSystemPrompt();
        for (
          let attempt = 0;
          attempt <= MAX_RETRIES && !plannerFirstUsed;
          attempt++
        ) {
          const retryReminder = attempt > 0
            ? `\n\nReturn valid JSON only. Fix any missing action fields, ensure full day coverage, and keep render_hints concise but complete.${
              buildPlanSpecRetryReminder(schemaVersion)
            }`
            : "";
          const plannerResp = await generateWithOpenAI({
            messages: [
              { role: "system", content: plannerSystemPrompt },
              {
                role: "user",
                content: `${plannerPromptBase}${retryReminder}`,
              },
            ],
            model: PLANNER_FIRST_MODEL,
            temperature: 0.4,
            max_tokens: plannerMaxTokens,
            signal: AbortSignal.timeout(PLANNER_FIRST_TIMEOUT_MS),
          });
          if (!plannerResp.ok) {
            plannerFirstError = plannerResp.error ??
              "planner_first_openai_error";
            console.log(
              "[ai_generate_flow] planner-first request failed:",
              plannerFirstError,
            );
            break;
          }

          tokensIn = plannerResp.tokensIn;
          tokensOut = plannerResp.tokensOut;
          modelUsed = plannerResp.modelUsed;
          const envelope = parsePlanEnvelopeFromResponse(plannerResp.content);
          if (!envelope) {
            plannerFirstError = "planner_first_parse_error";
            continue;
          }

          const candidatePlanSpec = coercePlanSpec({
            raw: envelope.plan_spec,
            fallbackFlowName: envelope.flowName,
            classification: planIntent,
            decisionMatrix: planDecisionMatrix,
            dateRangeDays,
          });
          const candidateValidation = validatePlanSpec(
            candidatePlanSpec,
            candidatePlanSpec.actions.length,
            dateRangeDays,
          );
          if (!candidateValidation.ok) {
            plannerFirstError = candidateValidation.errors.join("; ");
            console.log(
              "[ai_generate_flow] planner-first validation failed:",
              plannerFirstError,
            );
            continue;
          }

          plannerFirstError = null;
          planSpec = candidatePlanSpec;
          planSpecValidation = candidateValidation;
          parsedFlow = transformPlanEnvelopeToParsedFlow({
            envelope,
            planSpec: candidatePlanSpec,
          });
          cachedPlanEnvelope = envelope;
          plannerFirstUsed = true;
          llmStatus = attempt === 0
            ? "planner_first_success"
            : "planner_first_retry_success";
          costCents = calculateCostCents(modelUsed, tokensIn, tokensOut);
        }
      }

      if (!plannerFirstUsed && dateRangeDays >= LONG_FLOW_THRESHOLD_DAYS) {
        console.log(
          "[ai_generate_flow] long_flow path, days=",
          dateRangeDays,
          "threshold=",
          LONG_FLOW_THRESHOLD_DAYS,
        );
        const longRes = await generateLongRangeFlowLlm({
          description,
          sourceText: source_text ?? "",
          decisionMatrixBlock,
          youtubePromptBlock,
          startDate,
          endDate,
          dateRangeDays,
          flowType,
          flowFormat,
          technicalCraft,
          schedule,
          timezoneValue,
          timePreference,
          requestedTimeWindow,
          mode,
          sourceHandling,
          mealFlow,
          threeMealDailyFlow,
        });
        if (longRes.ok !== true) {
          return new Response(
            JSON.stringify({
              success: false,
              error: longRes.error,
              message: longRes.message,
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders(origin),
              },
            },
          );
        }
        llmFlow = longRes.llmFlow;
        tokensIn = longRes.tokensIn;
        tokensOut = longRes.tokensOut;
        modelUsed = longRes.modelUsed;
        llmStatus = longRes.llmStatus;
        costCents = calculateCostCents(modelUsed, tokensIn, tokensOut);
      } else if (!plannerFirstUsed) {
        const multiEventOk = inferMultiEventOk(
          mode,
          flowType,
          description,
          dateRangeDays,
          flowFormat,
        );

        const sys = systemPrompt;
        // Clamp completion tokens to stay below the 16,384 cap of gpt-4o-mini.
        // This prevents OpenAI from rejecting requests with "max_tokens is too large".
        const modelMaxTokens = 14000;
        const promptReserve = 1500;
        const calculatedMaxTokens = Math.max(
          3500,
          Math.ceil(dateRangeDays * 500),
        );
        const maxTokens = Math.min(calculatedMaxTokens, modelMaxTokens);
        const temperature = mode === "DICTATION" ? 0.3 : 0.6;

        const header = [
          `MODE: ${mode}`,
          `SOURCE_HANDLING: ${sourceHandling}`,
          `SCHEDULE_MODE: ${schedule.scheduleMode}`,
          `SPECIFIC_DAYS: ${schedule.specificDays.join(",")}`,
          `INTERVAL_N: ${
            schedule.scheduleMode === "INTERVAL"
              ? (schedule.intervalN ?? "")
              : ""
          }`,
          `MULTI_EVENT_OK: ${multiEventOk}`,
          `TIME_PREFERENCE: ${timePreference}`,
          `REQUESTED_TIME_WINDOW: ${
            requestedTimeWindow
              ? `${requestedTimeWindow.startTime}-${requestedTimeWindow.endTime}`
              : ""
          }`,
          `TIMEZONE: ${timezoneValue}`,
          `DATE_RANGE: ${startDate} → ${endDate} (${dateRangeDays} days)`,
          `FLOW_TYPE: ${flowType}`,
          `FLOW_FORMAT: ${flowFormat}`,
          `THREE_MEALS_PER_DAY: ${threeMealDailyFlow}`,
          `TECHNICAL_CRAFT: ${technicalCraft}`,
        ].join("\n");

        const flowNameHint = flowName ? `\nFLOW_NAME_HINT: ${flowName}` : "";
        const constraintsBlock = baseInputMeta.constraints_used &&
            baseInputMeta.constraints_prompt_snippet
          ? `\n\n${String(baseInputMeta.constraints_prompt_snippet)}\n`
          : "\n\n";
        const shortFlowReflectionBlock = shortFlowReflectionPairRequired
          ? `SHORT_FLOW_REFLECTION_RULE:\n- Because this flow is ${dateRangeDays} days (<= ${SHORT_FLOW_REFLECTION_PAIR_THRESHOLD_DAYS}), every day_index must include an evening reflection / recap / review note at 20:00–20:30.\n- Default to one primary flow note plus the evening reflection.\n- If the domain naturally needs a separate daily implementation phase, create up to two concrete non-reflection notes before the evening reflection, for a maximum of 3 notes per day_index.\n- The evening note must stay mental-only and concise.`
          : "";
        const flowFormatPromptBlock = buildFlowFormatPromptBlock({
          flowFormat,
          threeMealDailyFlow,
        });
        const academicLearningPromptBlock = buildAcademicLearningPromptBlock({
          description,
          sourceText: source_text,
        });
        const visibleQualityPromptBlock = buildVisibleNoteQualityPromptBlock({
          flowFormat,
        });
        const promptSourceText = source_text
          ? buildCondensedSourceContext(
            source_text,
            sourceHandling === "PRESERVE_STRUCTURE"
              ? LONG_FLOW_PLAN_SOURCE_CLAMP
              : SINGLE_FLOW_SOURCE_CONTEXT_MAX_CHARS,
            sourceHandling === "PRESERVE_STRUCTURE" ? 36 : 20,
            sourceHandling === "PRESERVE_STRUCTURE" ? 1400 : 1000,
          )
          : "";
        const prefsBlock = prefsUsed && prefsPromptSnippet
          ? `${prefsPromptSnippet}\n`
          : "";
        const dmBlock =
          `${constraintsBlock}${prefsBlock}${decisionMatrixBlock}`;
        const baseUserPrompt =
          `${header}${flowNameHint}${dmBlock}${
            shortFlowReflectionBlock ? `${shortFlowReflectionBlock}\n\n` : ""
          }${flowFormatPromptBlock ? `${flowFormatPromptBlock}\n\n` : ""}${
            sparsePromptExpertDefaultsBlock
              ? `${sparsePromptExpertDefaultsBlock}\n\n`
              : ""
          }${
            academicLearningPromptBlock
              ? `${academicLearningPromptBlock}\n\n`
              : ""
          }${
            visibleQualityPromptBlock ? `${visibleQualityPromptBlock}\n\n` : ""
          }` +
          `USER_DESCRIPTION:\n${description}\n\n${
            promptSourceText ? `SOURCE_TEXT:\n${promptSourceText}\n\n` : ""
          }${
            youtubePromptBlock ? `${youtubePromptBlock}\n\n` : ""
          }Cover every day_index 0..${
            dateRangeDays - 1
          } with at least one note. You may create multiple notes for a day_index when appropriate.`;

        const correctionBase =
          `Return valid JSON only. Ensure notes cover every day_index 0..${
            dateRangeDays - 1
          }. Follow the schema exactly.`;
        const specificDaysReminder =
          "Only schedule the main activity on SPECIFIC_DAYS. Other days must be Maintain/Rest notes.";
        const flowFormatReminder = buildFlowFormatRetryReminder({
          flowFormat,
          threeMealDailyFlow,
        });
        const concreteDetailsReminder =
          "\nCONCRETE DETAIL REMINDER: replace placeholder phrases with named examples, quantities, and done criteria. Do not write dynamic stretching, basic exercises, specific techniques, healthy meals, self-care activities, work on your project, review the basics, intro riff, verse chords, chord progression, song structure, strumming pattern, or as instructed unless the same note names exactly what to do. For named-song guitar prompts, include chord names, tuning/tempo, section order, riff/fret or timestamp targets, rhythm feel, tone setting, or a recording checkpoint.";

        let attempt = 0;
        while (attempt <= MAX_RETRIES) {
          const retryInstruction = attempt > 0
            ? `${correctionBase}${
              schedule.scheduleMode === "SPECIFIC_DAYS"
                ? `\n${specificDaysReminder}`
                : ""
            }${flowFormatReminder}${concreteDetailsReminder}${
              buildPlanSpecRetryReminder(schemaVersion)
            }`
            : "";
          const promptToSend = retryInstruction
            ? `${baseUserPrompt}\n\n${retryInstruction}`
            : baseUserPrompt;

          let usedMaxTokens = maxTokens;
          let aiResp = await generateWithOpenAI({
            messages: [
              { role: "system", content: sys },
              { role: "user", content: promptToSend },
            ],
            temperature,
            max_tokens: maxTokens,
            signal: AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS),
          });

          if (!aiResp.ok) {
            return new Response(
              JSON.stringify({
                success: false,
                error: "OPENAI_ERROR",
                message: aiResp.error ?? "Unknown OpenAI error",
              }),
              {
                status: 502,
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders(origin),
                },
              },
            );
          }

          tokensIn = aiResp.tokensIn;
          tokensOut = aiResp.tokensOut;
          modelUsed = aiResp.modelUsed;

          if (aiResp.finishReason === "length") {
            console.log(
              "⚠️ LLM response was truncated (hit token limit) — retrying with shorter main sessions",
            );
            const shortenedPrompt =
              `${promptToSend}\n\nShorten each MAIN SESSION by ~15% but preserve structure and domain artifacts. Keep each MAIN SESSION under 220 words.`;
            const maxTokensRetry = Math.max(500, Math.floor(maxTokens * 0.85));
            usedMaxTokens = maxTokensRetry;
            const retryResp = await generateWithOpenAI({
              messages: [
                { role: "system", content: sys },
                { role: "user", content: shortenedPrompt },
              ],
              temperature,
              max_tokens: maxTokensRetry,
              signal: AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS),
            });

            if (!retryResp.ok) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error: "OPENAI_ERROR",
                  message: retryResp.error ?? "Unknown OpenAI error",
                }),
                {
                  status: 502,
                  headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders(origin),
                  },
                },
              );
            }

            tokensIn = retryResp.tokensIn;
            tokensOut = retryResp.tokensOut;
            modelUsed = retryResp.modelUsed;

            if (retryResp.finishReason === "length") {
              console.log("❌ Length retry also truncated");
              return new Response(
                JSON.stringify({
                  success: false,
                  error: "LLM_TRUNCATED",
                  message:
                    `Response was too long for ${dateRangeDays} days, even after shortening. Try a shorter date range.`,
                }),
                {
                  status: 500,
                  headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders(origin),
                  },
                },
              );
            }

            aiResp = retryResp;
          }

          const text = stripCodeFences(aiResp.content);

          const contentPreview = aiResp.content.length > 1500
            ? aiResp.content.substring(0, 1500) + "...[truncated for logging]"
            : aiResp.content;
          console.log("🔍 LLM RAW CONTENT:", contentPreview);
          console.log("🔍 LLM CONTENT LENGTH:", aiResp.content.length, "chars");
          console.log(
            "🔍 LLM TOKENS OUT:",
            tokensOut,
            "max_tokens:",
            usedMaxTokens,
          );
          console.log("🔍 LLM FINISH REASON:", aiResp.finishReason);

          try {
            llmFlow = JSON.parse(text) as LLMFlow;
          } catch (err) {
            console.error("❌ JSON parse error:", err);
            const jsonMatch = text.match(/\{[\s\S]*\}/m);
            if (jsonMatch) {
              try {
                llmFlow = JSON.parse(jsonMatch[0]) as LLMFlow;
                console.log("⚠️ Used regex-extracted JSON (may be incomplete)");
              } catch (parseErr) {
                console.error("❌ Regex-extracted JSON also failed:", parseErr);
                llmFlow = null;
              }
            } else {
              llmFlow = null;
            }
          }

          if (llmFlow) {
            const llmValidation = validateLLMFlowOutput(llmFlow, dateRangeDays);
            const mealValidation = threeMealDailyFlow
              ? validateThreeMealDailyShape(
                llmFlow.notes ?? [],
                dateRangeDays,
              )
              : { ok: true, errors: [] as string[] };
            const specificCheck = schedule.scheduleMode === "SPECIFIC_DAYS"
              ? validateSpecificDays(
                llmFlow.notes ?? [],
                startDate,
                schedule.specificDays,
              )
              : { ok: true, violations: 0 };
            const notesCount = llmFlow.notes?.length ?? 0;
            console.log(
              "🔍 LLM PARSED JSON: flowName='%s', notesCount=%s, validationOk=%s",
              llmFlow.flowName,
              notesCount,
              llmValidation.ok,
            );

            if (llmValidation.ok && specificCheck.ok && mealValidation.ok) {
              costCents = calculateCostCents(modelUsed, tokensIn, tokensOut);
              llmStatus = attempt === 0 ? "success" : "retry_success";
              break;
            }

            if (!llmValidation.ok) {
              console.log(
                "❌ LLM VALIDATION ERRORS:",
                JSON.stringify(llmValidation.errors),
              );
            }
            if (!specificCheck.ok) {
              console.log(
                "❌ SPECIFIC DAY VALIDATION FAILED:",
                JSON.stringify(specificCheck),
              );
            }
            if (!mealValidation.ok) {
              console.log(
                "❌ MEAL PLAN VALIDATION FAILED:",
                JSON.stringify(mealValidation.errors),
              );
            }

            if (attempt >= MAX_RETRIES) {
              llmStatus = "validation_failed";
              llmFlow = null;
              break;
            }

            llmFlow = null;
          }

          attempt += 1;
        }
      }
    }

    const buildLogInputMeta = () => {
      const plannerTelemetry = buildPlannerFirstTelemetry({
        enabled: PLANNER_FIRST_ENABLED,
        mode,
        hasPlanInputs: planIntent != null && planDecisionMatrix != null,
        attempted: plannerFirstAttempted,
        used: plannerFirstUsed,
        servedFromCache: cached,
        plannerFirstError,
        planSpecError,
      });
      return {
        ...baseInputMeta,
        ...plannerTelemetry,
        plan_spec_error: planSpecError,
      };
    };

    if (!llmFlow && !parsedFlow) {
      const status = llmStatus === "validation_failed" ? 400 : 500;
      const payload = llmStatus === "validation_failed"
        ? {
          success: false,
          error: "LLM_VALIDATION_ERROR",
          message: "Model output failed validation after retry.",
        }
        : { error: "Failed to obtain valid LLM output" };
      if (supabaseAdmin) {
        const failureLogRow = {
          user_id: userId,
          flow_id: null,
          generation_id: generationId,
          input_hash,
          user_prompt_raw: description,
          model_used: null,
          tokens_in: 0,
          tokens_out: 0,
          cost_cents: 0,
          duration_ms: Date.now() - startTime,
          llm_status: llmStatus,
          schema_version: schemaVersion,
          policy_version: policyVersion,
          range_start: startDate,
          range_end: endDate,
          snapshot_version: snapshotVersion,
          prompt_fingerprint: promptFingerprint ?? null,
          served_from_cache: false,
          dm_policy_version: dmPolicyVersion,
          constraints_json: constraintsJson,
          state_snapshot: {},
          context_summary: "llm_failure",
          input_meta: buildLogInputMeta(),
        };
        try {
          const { error: failureLogErr } = await supabaseAdmin
            .from("flow_generation_logs")
            .insert(failureLogRow);
          if (failureLogErr) {
            console.log(
              "Failed to insert failure flow_generation_logs:",
              failureLogErr,
            );
          }
        } catch (e) {
          console.error("flow_generation_logs failure insert threw:", e);
        }
      }
      return new Response(
        JSON.stringify(payload),
        {
          status,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    // Ensure mode is available for post-processing decisions (cached or fresh)
    mode = inferMode(description, source_text);

    const startDateStr = startDate;
    if (!parsedFlow && llmFlow) {
      parsedFlow = transformLLMFlowToParsedFlow(
        llmFlow,
        startDateStr,
        dateRangeDays,
      );
    }
    if (!parsedFlow) {
      throw new Error("parsedFlow missing after generation");
    }
    parsedFlow.notes = ensureShortFlowReflectionPairs(
      parsedFlow.notes,
      dateRangeDays,
      mode,
      flowFormat,
    );
    const sourceDayHints = mergeSourceDayHints(
      dateRangeDays,
      source_text,
      description,
    );
    const recurringSourceRoutineHints = mergeRecurringSourceRoutineHints(
      dateRangeDays,
      source_text,
      description,
    );
    if (sourceHandling === "PRESERVE_STRUCTURE" && sourceDayHints.size > 0) {
      console.log(
        "[ai_generate_flow] preserve_structure source day hints=",
        sourceDayHints.size,
      );
    }
    if (
      sourceHandling === "PRESERVE_STRUCTURE" &&
      recurringSourceRoutineHints.length > 0
    ) {
      console.log(
        "[ai_generate_flow] preserve_structure recurring routine hints=",
        recurringSourceRoutineHints.length,
      );
    }
    const canonicalSourceNotes = buildCanonicalSourceStructuredRoutineNotes({
      sourceHandling,
      recurringHints: recurringSourceRoutineHints,
      sourceDayHints,
      dateRangeDays,
    });
    if (canonicalSourceNotes) {
      parsedFlow.notes = canonicalSourceNotes;
    } else {
      parsedFlow.notes = ensureRecurringSourceRoutineNotes(
        parsedFlow.notes,
        recurringSourceRoutineHints,
        dateRangeDays,
      );
      parsedFlow.notes = hydrateNotesFromSourceHints(
        parsedFlow.notes,
        sourceDayHints,
        sourceHandling,
      );
    }
    const sparsePromptRoutineNotes = buildSparsePromptRoutineNotes({
      description,
      sourceText: source_text,
      dateRangeDays,
      flowFormat,
    });
    if (
      sparsePromptRoutineNotes &&
      sourceDayHints.size === 0 &&
      recurringSourceRoutineHints.length === 0
    ) {
      const sparseOverview = buildSourceBackedOverview(
        description,
        source_text,
        dateRangeDays,
      ) ?? {
        title: parsedFlow.overview_title || parsedFlow.flow_name ||
          "Generated Flow",
        summary: parsedFlow.overview_summary ||
          `A ${dateRangeDays}-day flow with concrete daily actions and short review checkpoints.`,
      };
      const sparseFlowPlan = buildFlowPlanFromSparseRoutine({
        description,
        sourceText: source_text,
        dateRangeDays,
        flowFormat,
        domain: inferSparsePromptDomain(description, source_text),
        overview: sparseOverview,
        notes: sparsePromptRoutineNotes,
      });
      const sparseFlowPlanValidation = validateFlowPlan(sparseFlowPlan);
      if (!sparseFlowPlan || !sparseFlowPlanValidation.ok) {
        console.error(
          "[ai_generate_flow] sparse_prompt flow_plan override validation failed:",
          sparseFlowPlanValidation.errors.join("; "),
        );
      } else {
        console.log(
          "[ai_generate_flow] sparse_prompt flow_plan notes applied count=",
          sparsePromptRoutineNotes.length,
        );
        parsedFlow.flow_name = sparseFlowPlan.overview.title;
        parsedFlow.overview_title = sparseFlowPlan.overview.title;
        parsedFlow.overview_summary = sparseFlowPlan.overview.summary;
        parsedFlow.notes = renderFlowPlanToParsedNotes(sparseFlowPlan);
        flowPlanMetadata = buildFlowPlanQualityMetadata({
          plan: sparseFlowPlan,
          validation: sparseFlowPlanValidation,
        });
        llmStatus = llmStatus === "cache_hit"
          ? "cache_hit_flow_plan_sparse_prompt_routine_override"
          : "flow_plan_sparse_prompt_routine_override";
      }
    }
    parsedFlow.notes = expandVisibleRepeatReferences(parsedFlow.notes);
    parsedFlow.notes = hydrateNoteLocationsFromHints(
      parsedFlow.notes,
      sourceDayHints,
    );
    parsedFlow.notes = sanitizeYoutubeLocations(
      parsedFlow.notes,
      youtubeResources,
      shouldSearchYoutubeResources,
    );
    parsedFlow.notes = assignYoutubeLocationsFromResources(
      parsedFlow.notes,
      youtubeResources,
      description,
    );
    parsedFlow.notes = sanitizeYoutubeLocations(
      parsedFlow.notes,
      youtubeResources,
      shouldSearchYoutubeResources,
    );
    parsedFlow.notes = sanitizeGeneratedLocations(parsedFlow.notes);
    parsedFlow.notes = sanitizeVisibleNumberedInstructionDetails(
      parsedFlow.notes,
    );

    // Enforce richer structure when LLM output is thin/unlabeled
    if (mode === "ELABORATION") {
      enforceRichStructure(parsedFlow);
    }

    parsedFlow.notes = applySensibleTimes({
      notes: parsedFlow.notes,
      mode,
      flowType,
      flowFormat,
      description,
      requestedTimeWindow,
      mealFlow,
      threeMealDailyFlow,
    });

    let structureResult: { ok: boolean; failedDayIndices: number[] } = {
      ok: true,
      failedDayIndices: [],
    };

    if (
      mode === "ELABORATION" && usesSessionStyleStructure(flowFormat) &&
      !plannerFirstUsed
    ) {
      structureResult = validateMainSessionStructure(
        parsedFlow,
        technicalCraft,
      );
      console.log("🔍 MAIN SESSION STRUCTURE CHECK:", structureResult);

      if (
        !structureResult.ok &&
        structureResult.failedDayIndices.length > 0 &&
        dateRangeDays < LONG_FLOW_THRESHOLD_DAYS
      ) {
        const structureLines = [
          "- Short opener sentence.",
          "- One primary action with at most two supporting sub-actions, written as compact prose.",
          "- Do not use numbered lists or bullet checklists in visible details.",
          "- Close with 1–2 lines (not bullets) that capture a win + adjustment (keywords: if, next time, adjust, try, tighten, when...then).",
          "- At least one measurable element (digit/unit/range).",
        ];
        if (technicalCraft) {
          structureLines.push(
            "- Include an expected/measurement phrase plus units/tolerance/range and ≥3 of: specific parts/values, tool/meter setting, expected output range, safety constraint, debug fork, logging/documentation output.",
          );
        }
        structureLines.push(
          "- If the note lacks a short rehearsal cue (first 60 seconds), add one.",
        );

        const batchSize = dateRangeDays >= 45 ? 8 : 16;
        const fails = [...structureResult.failedDayIndices];
        const batches: number[][] = [];
        while (fails.length) {
          batches.push(fails.splice(0, batchSize));
        }

        for (const batch of batches) {
          const flowJsonForRepair = {
            flowName: parsedFlow.flow_name,
            overview: {
              title: parsedFlow.overview_title,
              summary: parsedFlow.overview_summary,
            },
            notes: parsedFlow.notes
              .filter((n) => batch.includes(n.day_index))
              .map((n) => ({
                day_index: n.day_index,
                title: n.title,
                details: n.details,
                allDay: n.all_day,
                startsAt: n.start_time ?? null,
                endsAt: n.end_time ?? null,
                location: n.location ?? null,
              })),
          };

          const repairPrompt = [
            `Repair MAIN SESSION details ONLY for day_index: ${
              batch.join(", ")
            }.`,
            "Return JSON only with this shape (copy flowName + overview from input):",
            '{"flowName":string,"overview":{"title":string,"summary":string},"notes":[...]}',
            "The notes array must contain ONLY the provided day_index values, with improved details for MAIN SESSION notes.",
            "",
            "PARTIAL_FLOW_JSON:",
            JSON.stringify(flowJsonForRepair, null, 2),
            "",
            `User description: ${description.slice(0, 8000)}`,
            source_text
              ? `SOURCE_TEXT (excerpt):\n${String(source_text).slice(0, 12000)}`
              : "",
            "",
            "Structure requirements for MAIN SESSION notes:",
            structureLines.join("\n"),
            "",
            "Do NOT modify evening notes (the 20:00–20:30 mental note).",
            "Rewrite ONLY the details field for the MAIN SESSION note on each listed day_index.",
          ]
            .filter((s) => s.length > 0)
            .join("\n");

          console.log("🔧 Repair batch day_index:", batch.join(","));

          const repairResp = await generateWithOpenAI({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: repairPrompt },
            ],
            temperature: 0.4,
            max_tokens: Math.min(8000, 800 + batch.length * 750),
            signal: AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS),
          });

          if (!repairResp.ok) {
            console.log("⚠️ Repair batch request failed:", repairResp.error);
            continue;
          }

          const repairedText = stripCodeFences(repairResp.content);
          let repairedFlow: LLMFlow | null = null;
          try {
            repairedFlow = JSON.parse(repairedText) as LLMFlow;
          } catch {
            const jsonMatch = repairedText.match(/\{[\s\S]*\}/m);
            if (jsonMatch) {
              try {
                repairedFlow = JSON.parse(jsonMatch[0]) as LLMFlow;
              } catch {
                repairedFlow = null;
              }
            }
          }

          if (repairedFlow) {
            const repairedParsed = transformLLMFlowToParsedFlow(
              repairedFlow,
              startDateStr,
              dateRangeDays,
            );
            repairedParsed.notes = applySensibleTimes({
              notes: repairedParsed.notes,
              mode,
              flowType,
              flowFormat,
              description,
              requestedTimeWindow,
              mealFlow,
              threeMealDailyFlow,
            });

            for (const dayIdx of batch) {
              const existing = parsedFlow.notes.filter((n) =>
                n.day_index === dayIdx
              );
              const repaired = repairedParsed.notes.filter((n) =>
                n.day_index === dayIdx
              );
              const existingMain = getMainSessionNote(existing);
              const repairedMain = getMainSessionNote(repaired);
              if (existingMain && repairedMain && repairedMain.details) {
                existingMain.details = (repairedMain.details ?? "").trim();
              }
            }
          } else {
            console.log(
              "⚠️ Repair batch response could not be parsed; keeping original for batch",
            );
          }
        }

        console.log(
          "🔧 Repaired main-session details (batched) for day_index count:",
          structureResult.failedDayIndices.length,
        );
      } else if (
        !structureResult.ok &&
        structureResult.failedDayIndices.length > 0
      ) {
        console.log(
          "[ai_generate_flow] skipping structure repair for long_flow; failures=",
          structureResult.failedDayIndices.length,
        );
      }
    }

    parsedFlow.notes = expandVisibleRepeatReferences(parsedFlow.notes);
    parsedFlow.notes = sanitizeVisibleNumberedInstructionDetails(
      parsedFlow.notes,
    );
    const sourceBackedOverview = buildSourceBackedOverview(
      description,
      source_text,
      dateRangeDays,
    );
    if (sourceBackedOverview) {
      parsedFlow.flow_name = sourceBackedOverview.title;
      parsedFlow.overview_title = sourceBackedOverview.title;
      parsedFlow.overview_summary = sourceBackedOverview.summary;
    }

    if (mode === "ELABORATION") {
      const concreteRepair = await repairConcreteParsedFlowDetails({
        parsedFlow,
        description,
        sourceText: source_text,
        flowFormat,
        systemPrompt,
      });
      if (concreteRepair.repaired > 0) {
        console.log(
          "[ai_generate_flow] concrete detail repair applied count=",
          concreteRepair.repaired,
        );
      }
      if (concreteRepair.remainingIssues.length > 0) {
        console.warn(
          "[ai_generate_flow] concrete detail repair unresolved; continuing count=",
          concreteRepair.remainingIssues.length,
          "first=",
          concreteRepair.remainingIssues[0]?.reason ?? "",
        );
      }
    }

    // Log parsed flow for debugging (post-repair)
    if (Deno.env.get("AI_GENERATE_FLOW_DEBUG_FLOW_JSON") === "true") {
      console.log("🔍 PARSED FLOW:", JSON.stringify(parsedFlow, null, 2));
    } else {
      console.log(
        `[ai_generate_flow] parsed flow ok name=${parsedFlow.flow_name} notes=${
          parsedFlow.notes?.length ?? 0
        }`,
      );
    }

    // FINAL VALIDATION: structural only
    if (!parsedFlow || !Array.isArray(parsedFlow.notes)) {
      console.error("❌ Invalid structure from LLM:", parsedFlow);
      return new Response(
        JSON.stringify({
          success: false,
          error: "INVALID_LLM_STRUCTURE",
          message: "LLM returned invalid structure.",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }

    // Validate the transformed flow
    const validation = validateParsedFlow(parsedFlow, dateRangeDays);
    if (!validation.ok) {
      console.error("❌ PARSED FLOW VALIDATION ERROR:", validation.error);
      console.log(
        "❌ PARSED FLOW SUMMARY:",
        JSON.stringify({
          flow_name: parsedFlow.flow_name,
          notes_count: parsedFlow.notes?.length ?? 0,
          first_notes: (parsedFlow.notes ?? []).slice(0, 3).map((note) => ({
            day_index: note.day_index,
            title: note.title,
            all_day: note.all_day,
            start_time: note.start_time ?? null,
            end_time: note.end_time ?? null,
            has_location: !!(note.location ?? "").trim(),
            details_len: (note.details ?? "").length,
          })),
        }),
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "LLM_VALIDATION_ERROR",
          message: validation.error ?? "Invalid AI output",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      );
    }
    if (threeMealDailyFlow) {
      const mealValidation = validateThreeMealDailyShape(
        parsedFlow.notes,
        dateRangeDays,
      );
      if (!mealValidation.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "MEAL_PLAN_VALIDATION_ERROR",
            message: mealValidation.errors.join("; "),
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders(origin),
            },
          },
        );
      }
    }

    if (FLOWSPEC_V2_ENABLED && !planSpec) {
      try {
        if (!planIntent) {
          planIntent = classifyIntent({
            description,
            sourceText: source_text,
            flowFormat,
            dateRangeDays,
            sourceHandling,
          });
        }
        if (!planDecisionMatrix) {
          planDecisionMatrix = buildDecisionMatrix({
            classification: planIntent,
            requestedTimeWindow,
            outcomeVectors,
            dateRangeDays,
          });
        }
        const generatedPlanSpec = generatePlanSpec({
          description,
          flowName: parsedFlow.flow_name,
          sourceText: source_text,
          flowFormat,
          dateRangeDays,
          notes: parsedFlow.notes,
          classification: planIntent,
          decisionMatrix: planDecisionMatrix,
        });
        const repairedPlanSpec = repairPlanSpec(
          generatedPlanSpec,
          parsedFlow.notes,
        );
        const validationResult = validatePlanSpec(
          repairedPlanSpec,
          parsedFlow.notes.length,
          dateRangeDays,
        );

        planSpec = repairedPlanSpec;
        planSpecValidation = validationResult;
        parsedFlow.notes = renderNotesFromPlanSpec({
          notes: parsedFlow.notes,
          planSpec: repairedPlanSpec,
          preserveDetails: true,
        });
        parsedFlow.notes = sanitizeGeneratedLocations(parsedFlow.notes);
        parsedFlow.notes = sanitizeVisibleNumberedInstructionDetails(
          parsedFlow.notes,
        );
      } catch (error) {
        planSpecError = error?.message ?? String(error);
        console.error("[ai_generate_flow] plan_spec generation failed:", error);
      }
    }

    parsedFlow.notes = sanitizeVisibleNumberedInstructionDetails(
      parsedFlow.notes,
    );
    parsedFlow.notes = sortParsedNotesByDayAndTime(parsedFlow.notes);

    const plannerFirstTelemetry = buildPlannerFirstTelemetry({
      enabled: PLANNER_FIRST_ENABLED,
      mode,
      hasPlanInputs: planIntent != null && planDecisionMatrix != null,
      attempted: plannerFirstAttempted,
      used: plannerFirstUsed,
      servedFromCache: cached,
      plannerFirstError,
      planSpecError,
    });

    // Create flow
    const generatedAt = new Date().toISOString();
    const youtubeLinkedNotesCount = parsedFlow.notes.filter((note) =>
      !!normalizeYoutubeUrl(note.location ?? null)
    ).length;
    const ai_metadata = {
      generated: true,
      model: modelUsed,
      prompt: description,
      dateRange: { startDate, endDate },
      generatedAt,
      tokensUsed: { in: tokensIn, out: tokensOut },
      costCents,
      youtubeLinksRequested,
      youtubeResourcesCount: youtubeLinkedNotesCount,
      youtubeSearchModel: youtubeSearchModel || null,
      planSpecVersion: FLOWSPEC_V2_ENABLED ? PLAN_SPEC_VERSION : null,
      planDecisionMatrix,
      planSpecFingerprint: planSpec ? fingerprintPlanSpec(planSpec) : null,
      planSpecQualityScore: planSpecValidation?.quality_score ?? null,
      planSpecCoverage: planSpecValidation?.coverage ?? null,
      planSpecValidation,
      plannerFirstTelemetry,
      plannerFirstError: plannerFirstTelemetry.planner_first_error,
      planSpecError,
      plan_spec: planSpec,
      flowPlanMetadata,
    };

    // ═══════════════════════════════════════════════════════════
    // PRE-INSERT DIAGNOSTIC
    // ═══════════════════════════════════════════════════════════

    // 🔥 CRITICAL: Normalize color with NaN-safe validation
    // Client sends hex string (e.g., "#4dd0e1") or number
    // Always provide a valid color, never undefined/null/NaN
    const DEFAULT_COLOR = 0x4dd0e1; // Default cyan (24-bit RGB: 0x4dd0e1)

    /**
     * Coerce any input to a valid 24-bit RGB color integer
     * Always returns a valid number (never NaN, null, or undefined)
     */
    function coerceColor(input: unknown): number {
      if (
        typeof input === "number" && Number.isFinite(input) &&
        !Number.isNaN(input)
      ) {
        const n = Math.floor(input);
        return n < 0 ? DEFAULT_COLOR : (n > 0xFFFFFF ? 0xFFFFFF : n);
      }
      if (typeof input === "string") {
        const s = input.trim().replace(/^#/, "").replace(/^0x/i, "");
        const n = parseInt(s, 16);
        if (Number.isFinite(n) && !Number.isNaN(n)) {
          return n < 0 ? 0 : (n > 0xFFFFFF ? 0xFFFFFF : n);
        }
      }
      return DEFAULT_COLOR;
    }

    // Convert color from client request (hex string like "#4dd0e1")
    // and/or from AI response - client wins, else default
    const finalColor = coerceColor(body?.flowColor ?? DEFAULT_COLOR);

    console.log("╔═══════════════════════════════════════╗");
    console.log("║   PRE-INSERT DIAGNOSTIC               ║");
    console.log("╚═══════════════════════════════════════╝");

    console.log("🎨 Color Selection:");
    console.log(
      "   Request body color:",
      flowColor,
      "(type:",
      typeof flowColor,
      ")",
    );
    console.log("   Final Color:", finalColor, "(ARGB int)");
    console.log(
      "   Source:",
      finalColor === DEFAULT_COLOR ? "Default" : "Client",
    );

    // Check ai_metadata validity
    console.log("📦 ai_metadata:");
    try {
      const jsonStr = JSON.stringify(ai_metadata);
      console.log("   Valid JSON ✅");
      console.log("   Size:", jsonStr.length, "chars");
    } catch (e) {
      console.log("   INVALID JSON ❌:", e.message);
    }

    // ✅ REFACTOR: No DB insertions - Flutter will create flow and events
    // Edge function now only returns the generated content

    // Log generation
    const duration_ms = Date.now() - startTime;
    const logRow = {
      user_id: userId,
      flow_id: null, // ✅ Flutter creates the flow, not Edge
      generation_id: generationId,
      input_hash,
      user_prompt_raw: description,
      model_used: cached ? (modelUsed || "cache") : modelUsed,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_cents: costCents,
      duration_ms,
      llm_status: llmStatus,
      schema_version: schemaVersion,
      policy_version: policyVersion,
      range_start: startDate,
      range_end: endDate,
      snapshot_version: snapshotVersion,
      prompt_fingerprint: promptFingerprint ?? null,
      served_from_cache: cached,
      dm_policy_version: dmPolicyVersion,
      constraints_json: constraintsJson,
      state_snapshot: {},
      context_summary: cached ? "cache_hit" : "fresh_gen",
      input_meta: buildLogInputMeta(),
    };

    if (supabaseAdmin) {
      try {
        const { error: logErr } = await supabaseAdmin
          .from("flow_generation_logs")
          .insert(logRow);
        if (logErr) {
          console.log("Failed to insert flow_generation_logs:", logErr);
        }
      } catch (e) {
        console.error("flow_generation_logs threw:", e);
      }
    }

    // Cache result
    if (
      supabaseAdmin &&
      FLOW_GENERATION_CACHE_ENABLED &&
      !cached &&
      (
        (PLANNER_FIRST_ENABLED && plannerFirstUsed && planSpec) ||
        llmFlow
      )
    ) {
      try {
        const responseJson = PLANNER_FIRST_ENABLED && plannerFirstUsed &&
            planSpec
          ? {
            flowName: parsedFlow.flow_name,
            overview: {
              title: parsedFlow.overview_title,
              summary: parsedFlow.overview_summary,
            },
            plan_spec: planSpec,
          }
          : llmFlow;
        const cacheRow = {
          user_id: userId,
          snapshot_version: snapshotVersion,
          schema_version: schemaVersion,
          policy_version: policyVersion,
          input_hash,
          user_prompt: description,
          response_json: responseJson,
          model_used: modelUsed || null,
          llm_status: llmStatus || null,
          prompt_fingerprint: promptFingerprint || null,
        };
        const { error: cacheInsertErr } = await supabaseAdmin
          .from("flow_generation_cache")
          .upsert(cacheRow, {
            onConflict:
              "user_id,snapshot_version,schema_version,policy_version,input_hash",
          });
        if (cacheInsertErr) {
          console.log(
            "Failed to insert into flow_generation_cache:",
            cacheInsertErr,
          );
        }
      } catch (e) {
        console.error("flow_generation_cache threw:", e);
      }
    }

    // Convert color integer back to hex string for response
    // finalColor is RGB int like 0x4dd0e1 (no alpha channel, matches DEFAULT_COLOR format)
    // Pad to 6 digits and add # prefix
    const rgbHex = finalColor.toString(16).padStart(6, "0");
    const colorHex = "#" + rgbHex;

    // ✅ REFACTOR: Return only the generated content (no DB IDs)
    // Flutter will create the flow and events using this data
    console.log("ai_generate_flow: completed, returning success");
    return new Response(
      JSON.stringify({
        success: true,
        flow_name: parsedFlow.flow_name,
        flow_color: colorHex,
        overview_title: parsedFlow.overview_title,
        overview_summary: parsedFlow.overview_summary,
        notes: parsedFlow.notes,
        ai_metadata: {
          generated: true,
          model: modelUsed,
          prompt: description.substring(0, 200), // Truncate for response size
          youtube_links_requested: youtubeLinksRequested,
          youtube_resources_count: youtubeLinkedNotesCount,
          plan_spec_version: FLOWSPEC_V2_ENABLED ? PLAN_SPEC_VERSION : null,
          plan_spec_quality_score: planSpecValidation?.quality_score ?? null,
          plan_spec_coverage: planSpecValidation?.coverage ?? null,
          plan_spec_validation: planSpecValidation,
          planner_first_telemetry: plannerFirstTelemetry,
          planner_first_attempted: plannerFirstTelemetry
            .planner_first_attempted,
          planner_first_used: plannerFirstTelemetry.planner_first_used,
          planner_first_error: plannerFirstTelemetry.planner_first_error,
          planner_first_skip_reason: plannerFirstTelemetry
            .planner_first_skip_reason,
          planner_first_status: plannerFirstTelemetry.planner_first_status,
          plan_spec_error: planSpecError,
          plan_decision_matrix: planDecisionMatrix,
          plan_spec: planSpec,
        },
        generation_id: generationId,
        schema_version: schemaVersion,
        policy_version: policyVersion,
        snapshot_version: snapshotVersion,
        modelUsed,
        cached,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      },
    );
  } catch (err) {
    console.error("Unhandled error in ai_generate_flow:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      },
    );
  }
});
