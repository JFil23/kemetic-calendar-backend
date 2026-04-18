import { createClient } from "npm:@supabase/supabase-js@2.27.0";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const SNAPSHOT_VERSION =
  Deno.env.get("FLOW_SNAPSHOT_VERSION") ?? "v0";
const SCHEMA_VERSION =
  Deno.env.get("FLOW_SCHEMA_VERSION") ?? "flowspec_v1";
const POLICY_VERSION =
  Deno.env.get("FLOW_POLICY_VERSION") ?? "dm_v1";
const OUTCOME_VECTOR_LIMIT = 6;

// Add timeout protection for API calls
async function callAnthropicModel(
  modelId,
  systemPrompt,
  messages,
  temperature = 0.3,
  maxTokens = 4096,
  timeoutMs = 45000  // 45 seconds default timeout
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
          }]
        })
      }],
      usage: { input_tokens: 0, output_tokens: 0 }
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
      signal: controller.signal,  // ✅ Timeout protection
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });

    clearTimeout(timeoutId);  // Clear timeout on success

    console.log("📬 Anthropic API Response:");
    console.log("   Status:", res.status);
    console.log("   OK:", res.ok);

    if (!res.ok) {
      const text = await res.text();
      console.log("   Error body:", text);
      throw new Error(
        `Anthropic API error: ${res.status} ${res.statusText} - ${text}`
      );
    }

    const data = await res.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId);  // Clear timeout on error
    
    // Check if it's a timeout error
    if (error.name === 'AbortError' || error.message?.includes('aborted')) {
      console.log("❌ Claude API timeout after 45 seconds");
      throw new Error('AI generation timed out. Please try again.');
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
const VERY_LONG_FLOW_THRESHOLD_DAYS = 60;
/** Keep planner latency bounded so long-flow runs can still finish before Edge wall-clock shutdown. */
const LONG_FLOW_PLAN_TIMEOUT_MS = 18_000;
/** Per-segment timeout budget for multi-week generation. */
const LONG_FLOW_SEGMENT_TIMEOUT_MS = 60_000;
const LONG_FLOW_GLOBAL_ANCHORS_MAX_CHARS = 3_600;
const LONG_FLOW_SEGMENT_EXCERPT_CAP = 6_800;
const OPENAI_FETCH_TIMEOUT_MS = 95_000;
/** Default 2 keeps 90-day runs under Supabase wall-clock without spiking to 3+ concurrent calls. */
const LONG_FLOW_SEGMENT_CONCURRENCY_DEFAULT = 2;

const FLOW_CONTRACT_V3 = `You generate a FLOW: a structured schedule template across a date range.

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
- If chips are omitted, that is acceptable.

INTERPRETATION MODES
You will be given MODE and scheduling hints.
- MODE=DICTATION: The user is dictating items/times. Do not expand with extra activities. Only structure faithfully.
- MODE=ELABORATION: The user gave goals/theme. Create a practical schedule with reasonable defaults, written as a domain expert: each MAIN SESSION note must be specific, execution-ready, and include at least one technical cue, one measurable target, and one adjustment.
In MODE=ELABORATION, each MAIN SESSION note must follow this internal order (unlabeled):
(1) opener with concrete setup + control
(2) short rehearsal cue
(3) 3–7 actionable steps
(4) one-line note-to-self close (win + adjustment).

SOURCE_TEXT
If SOURCE_TEXT is provided:
- Treat it as authoritative content. Reuse its phrasing and structure when possible.
- Do not invent quotes or claim the text says things it does not.

NO EXTRA TEXT
- No markdown, no commentary, no preface, no trailing notes. JSON only.`;

const FLOW_RULES_PACK_V1_2 = `RULES PACK v1.2

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

DETAILS WRITING STYLE (CRITICAL)
- Write details like a natural ChatGPT message the user would actually want in their calendar.
- Avoid big labeled sections/headings. Micro-structure is allowed (1–4 bullets, short numbered steps). Avoid repeating the same label pattern across days.
- Do NOT use meta phrases like "This reinforces..." or "Why this works..." or "Journal Anchor:".
  If you explain why, do it as a single natural sentence and vary it across days.
- Avoid generic grounding filler (e.g., "take a deep breath", "relax your shoulders") unless it’s domain-specific and concrete.
- Keep it practical, specific, and execution-ready.
- Use domain specifics: tools, workspace, ingredients, instrument, IDE, file names, temperatures, durations, reps, etc.

EXPERT MAIN SESSION RULE (MAIN SESSION ONLY)
Required structure
- Opener block before any list.
- Steps list (≥3 items).
- Final 1-line close.

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
- Keep details literal and minimal; do not add extra activities or coaching.

ANTI-MECHANICAL VARIATION (HARD)
- Never repeat the exact same sentence in two different notes (including evening notes).
- Never start two consecutive day_index notes with the same 3-word phrase.
- Avoid recurring openers like "Set up:", "Today's focus:", "Do this first:".
- Vary sentence rhythm and length. Some notes tight/direct. Some slightly descriptive.
- Vary formatting across days (numbered steps, bullets, compact paragraph), but keep clarity.
- Avoid motivational cliches.

SECOND NOTE (when MULTI_EVENT_OK=true)
- Create an evening note most days (20:00–20:30 by default). It must be mental-only (no physical tasks), 5–12 minutes, and must not look templated.
- Even day_index → memory peg or replay (formats C or D).
- Odd day_index → recap or future-self (formats A or B).

Evening note formats (rotate; do not use the same format two nights in a row):
A) Tiny recap (3–4 sentences): what mattered / what shifted / what to try next.
B) Future-self postcard (4–6 sentences): speak from the future, name one specific win from today.
C) Replay the hardest 10 seconds: rewrite the approach in one clean sentence, then one vivid image cue.
D) Memory peg (optional): one exaggerated image tied to ONE concept from today, explained simply.

Memory cues must be simple: familiar place, one room, one object, one concept. No recurring phrase "memory palace".

PATTERNING RULE
- Keep start time consistent across days unless user specifies otherwise.
- Do NOT repeat ritual text daily.
- If you include a start/end cue, keep it to one short line and keep it domain-specific.

CHIPS
- If chips are included, set chips = [(day_index % 10) + 1] unless the user provides a specific decan day.`;

// ---- LLM JSON schema for ai_generate_flow ----
type LLMNote = {
  day_index: number;       // 0-based offset from startDate
  title: string;
  details: string;
  allDay: boolean;
  startsAt: string;        // "HH:MM" 24h
  endsAt: string;          // "HH:MM" 24h
  chips?: number[];        // decan day chips 1–10 (used by the model, NOT stored in DB)
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

// Internal parsed shapes (no chips stored)
// ✅ REFACTOR: Removed all date logic - Flutter is the only time authority
type ParsedNote = {
  day_index: number;       // 0-based offset from start date (Flutter will compute actual date)
  title: string;
  details: string;
  all_day: boolean;
  start_time?: string;      // "HH:mm" format (optional, Flutter will default if missing)
  end_time?: string;        // "HH:mm" format (optional)
  location?: string;        // optional location field
};

type ParsedFlow = {
  flow_name: string;
  flow_color?: string;      // hex color (optional, Flutter will use fallback)
  overview_title: string;
  overview_summary: string;
  notes: ParsedNote[];
  ai_metadata?: {
    generated: boolean;
    model: string;
    prompt?: string;
  };
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
  const lowerBounds =
    raw.lower_bounds && typeof raw.lower_bounds === "object"
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
    accepted_as_is:
      typeof raw.accepted_as_is === "boolean" ? raw.accepted_as_is : null,
    outcome_confidence:
      typeof raw.outcome_confidence === "string"
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
  const eventsTotal =
    typeof v.events_total === "number" ? v.events_total : 0;
  const eventsCompleted =
    typeof v.events_completed === "number" ? v.events_completed : 0;

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
    if (nDays !== null && nDays >= 5 && eventsTotal !== null && eventsTotal >= 5) return true;
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
      maxEventsPerDay = maxEventsPerDay === null ? 2 : Math.min(maxEventsPerDay, 2);
    }
    if (avgEditPressure !== null && avgEditPressure > 0.6) {
      maxEventsPerDay = maxEventsPerDay === null ? 2 : Math.min(maxEventsPerDay, 2);
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
): Promise<{ vectors: OutcomeVectorV1[]; status: "ok" | "error" | "unavailable" }> {
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
      console.log("⚠️ get_recent_outcome_vectors error:", error.message ?? error);
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
    return { ok: false, modelUsed: model, content: "", tokensIn: 0, tokensOut: 0, error: `HTTP ${res.status}: ${err}` };
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
3. MAIN SESSION structure + domain density
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
  return (_memoPromptFingerprintPromise ??= getPromptFingerprint(getMemoSystemPrompt()));
}

const LONG_FLOW_SEGMENT_SYSTEM = `You output ONLY valid JSON (no markdown, no code fences).

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
      "endsAt": "HH:MM"
    }
  ]
}

Hard rules:
- notes must use only day_index values in the inclusive range the user specifies.
- Cover every day_index in that range at least once.
- If allDay is false: startsAt/endsAt are 24h "HH:MM", endsAt later than startsAt.
- Prefer rounded times (09:00, 12:00, 20:00).
- details: 65–130 words, concrete, grounded in SOURCE excerpt and segment theme; do not invent facts absent from the excerpt.
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

function detectExplicitTimes(text: string): boolean {
  if (!text) return false;
  const timePattern = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(?:am|pm))\b/i;
  return timePattern.test(text);
}

function looksListLike(text: string): boolean {
  if (!text) return false;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bulletLines = lines.filter((l) => /^[-*•\d]/.test(l));
  const shortLines = lines.filter((l) => l.length > 0 && l.length <= 60);
  const commaChunks = text.split(",").map((c) => c.trim()).filter(Boolean);
  return (
    bulletLines.length >= 2 ||
    shortLines.length >= 3 ||
    (commaChunks.length >= 3 && text.length <= 240)
  );
}

function inferMode(description: string, sourceText?: string): "DICTATION" | "ELABORATION" {
  const lower = (description || "").toLowerCase();
  const hasDictationCue = /(just\s+add|put\s+this\s+in|log\s+this|schedule\s+these)/i.test(lower);
  const hasTransformCue =
    /(turn|make|convert|transform|create|build|organize|map)\b[\s\S]{0,40}\b(?:\d{1,3}\s*day\s+)?flow\b/i
      .test(description) ||
    /\b(?:\d{1,3}\s*day|90\s*day|30\s*day)\s+flow\b/i.test(description);
  const hasExplicitTimes = detectExplicitTimes(description);
  const listy = looksListLike(description);
  // Long pasted documents look "structured" but should still allow elaboration
  // when the user is asking for a multi-day flow.
  const structuredSource =
    !!sourceText &&
    sourceText.length > 400 &&
    sourceText.length < 3200 &&
    /\n/.test(sourceText);

  if (hasTransformCue) {
    return "ELABORATION";
  }
  if (hasExplicitTimes || hasDictationCue || listy || structuredSource) {
    return "DICTATION";
  }
  return "ELABORATION";
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
  return /(two\s+(times|sessions)\s+a\s+day|twice\s+a\s+day|morning\s+and\s+evening|am\s+and\s+pm|both\s+morning\s+and\s+night|split\s+into\s+am\/pm)/i.test(
    text,
  );
}

function requiresShortFlowReflectionPair(dateRangeDays = 0): boolean {
  return (
    Number.isFinite(dateRangeDays) &&
    dateRangeDays > 0 &&
    dateRangeDays <= SHORT_FLOW_REFLECTION_PAIR_THRESHOLD_DAYS
  );
}

function inferMultiEventOk(
  mode: "DICTATION" | "ELABORATION",
  flowType: "workout" | "body" | "business" | "generic",
  description: string,
  dateRangeDays = 0,
): boolean {
  if (requiresShortFlowReflectionPair(dateRangeDays)) return true;
  if (hasExplicitMultiEventRequest(description)) return true;
  if (mode === "DICTATION") return false;

  if (dateRangeDays >= 50) {
    return false;
  }

  // Always allow two anchors for these established categories
  if (flowType === "workout" || flowType === "body" || flowType === "business") return true;

  // For generic flows, only allow two anchors when intent is clearly learning/skill-building
  const learningIntent =
    /(learn|learning|practice|skill|study|train|training|get better|improve|master|drill|retention|memory|reps|mental reps|visualize|visualization)/i.test(
      description,
    );

  // Avoid accidentally forcing two anchors for simple "plan my dinners" type requests
  const recipeLike =
    /(recipe|recipes|meal plan|meals|dinner|dinners|menu|shopping list)/i.test(description);

  if (recipeLike) return false;

  return learningIntent;
}

function inferTimePreference(description: string): "morning" | "midday" | "evening" | "none" {
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

function dayNameFromIndex(startDateStr: string, dayIndex: number): string | null {
  const startMs = Date.parse(startDateStr);
  if (Number.isNaN(startMs)) return null;
  const targetMs = startMs + dayIndex * 24 * 60 * 60 * 1000;
  const dayNum = new Date(targetMs).getUTCDay();
  return DAY_ORDER[dayNum] ?? null;
}

function isRestNote(title?: string, details?: string): boolean {
  const text = `${title ?? ""} ${details ?? ""}`.toLowerCase();
  return /(maintain|rest|recover|journal|reflection|check[- ]?in|review)/i.test(text);
}

function validateSpecificDays(
  notes: LLMNote[],
  startDate: string,
  allowedDays: string[],
): { ok: boolean; violations: number } {
  if (!allowedDays || allowedDays.length === 0) return { ok: true, violations: 0 };
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

  const looksEvening = (note: ParsedNote) => {
    const start = note.start_time?.trim();
    if (start === "20:00" || start === "20:30") return true;
    const title = (note.title ?? "").toLowerCase();
    const eveningTitle = /\b(evening|recap|reflection|review|wind down|postcard|memory|peg|insight|journal)\b/;
    return note.all_day === true && eveningTitle.test(title);
  };

  const mainCandidates = notesForDay.filter((n) => !looksEvening(n));
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

const EVENING_REFLECTION_TITLE_RE =
  /\b(evening|recap|reflection|review|wind down|postcard|memory|peg|insight|journal)\b/i;

function isEveningReflectionNote(note: ParsedNote): boolean {
  const title = (note.title ?? "").trim();
  if (EVENING_REFLECTION_TITLE_RE.test(title)) return true;
  const startMinutes = timeToMinutes(note.start_time);
  if (startMinutes === null) return false;
  const endMinutes = timeToMinutes(note.end_time);
  const durationMinutes = endMinutes !== null ? endMinutes - startMinutes : null;
  const startsInReflectionWindow =
    startMinutes >= 19 * 60 + 30 && startMinutes <= 20 * 60 + 30;
  return startsInReflectionWindow && (durationMinutes === null || durationMinutes <= 45);
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
      title: "Memory peg",
      details:
        `Create one simple memory peg for "${cue}" during a 5-10 minute reflection. Tie the most important concept from today to one familiar place or object, then note why that image matters. Finish with one sentence about what tomorrow should feel easier than today.`,
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

function ensureShortFlowReflectionPairs(
  notes: ParsedNote[],
  dateRangeDays: number,
): ParsedNote[] {
  if (!requiresShortFlowReflectionPair(dateRangeDays)) return notes;

  const grouped = new Map<number, ParsedNote[]>();
  for (const note of notes ?? []) {
    const dayIndex = Number(note?.day_index);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= dateRangeDays) {
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
      continue;
    }

    const mainNote =
      getMainSessionNote(dayNotes) ??
      dayNotes.find((note) => !isEveningReflectionNote(note)) ??
      dayNotes[0];
    if (!mainNote) continue;

    const reflectionNote =
      dayNotes.find((note) => note !== mainNote && isEveningReflectionNote(note)) ??
      buildShortFlowReflectionNote(dayIndex, mainNote);

    const pair = [{ ...mainNote }, { ...reflectionNote }];
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
    const openerBlock = firstBulletIdx === -1 ? lines.join(" ") : lines.slice(0, firstBulletIdx).join(" ");
    const hasOpener = openerBlock.trim().length > 0 && /[.!?]/.test(openerBlock);

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

    const adjustmentRe = /\b(if|next time|adjust|try|tighten|when\b.*\bthen|tweak|fallback|swap)\b/i;
    const hasClose =
      closeLines.length > 0 &&
      closeLines.length <= 2 &&
      !isLastBullet &&
      adjustmentRe.test(closeLines.join(" "));

    const hasDigit = /\d/.test(details);

    let technicalOk = true;
    if (technicalCraft) {
      const expectedRe = /(expect|should read|target|range|~|±|tolerance|output|reading)/i;
      const unitOrRangeRe =
        /(\d+\s*-\s*\d+|\d+\s?(ms|s|sec|min|hr|hz|°c|c|f|kg|lbs|lb|mm|cm|v|w|%|rpm|mph|kph|bpm|ohm)|~|±)/i;
      technicalOk = expectedRe.test(details) && unitOrRangeRe.test(details);
    }

    if (!(hasOpener && stepCount >= 3 && hasClose && hasDigit && technicalOk)) {
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
  startDateStr: string,  // kept for logging/validation only
  dateRangeDays: number,
): ParsedFlow {
  const overviewTitle = llm.overview?.title ?? null;
  const overviewSummary = llm.overview?.summary ?? null;
  const notes = Array.isArray(llm.notes) ? llm.notes : [];

  const isValidDayIndex = (value: unknown) =>
    Number.isInteger(value) && value >= 0 && value < dateRangeDays;

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
  if (!flow || typeof flow !== "object")
    return { ok: false, error: "Parsed content is not an object" };

  if (typeof flow.flow_name !== "string" || flow.flow_name.trim() === "")
    return { ok: false, error: "Missing or invalid flow_name" };

  if (!Array.isArray(flow.notes) || flow.notes.length === 0)
    return { ok: false, error: "notes must be a non-empty array" };

  for (const [i, n] of flow.notes.entries()) {
    if (!n || typeof n !== "object")
      return { ok: false, error: `notes[${i}] is not an object` };

    if (
      typeof n.day_index !== "number" ||
      !Number.isInteger(n.day_index) ||
      n.day_index < 0 ||
      !Number.isFinite(n.day_index)
    ) {
      return {
        ok: false,
        error: `notes[${i}].day_index is required and must be a non-negative number`,
      };
    }
    if (typeof dateRangeDays === "number" && n.day_index >= dateRangeDays) {
      return {
        ok: false,
        error: `notes[${i}].day_index must be within the requested range`,
      };
    }

    if (typeof n.title !== "string" || n.title.trim() === "")
      return { ok: false, error: `notes[${i}].title is required` };

    if (typeof n.details !== "string" || n.details.trim() === "")
      return { ok: false, error: `notes[${i}].details must be a non-empty string` };

    if (typeof n.all_day !== "boolean")
      return { ok: false, error: `notes[${i}].all_day must be a boolean` };

    if (!n.all_day) {
      if (!isValidTimeString(n.start_time)) {
        return { ok: false, error: `notes[${i}].start_time must be HH:MM when all_day is false` };
      }
      if (!isValidTimeString(n.end_time)) {
        return { ok: false, error: `notes[${i}].end_time must be HH:MM when all_day is false` };
      }
      const startMinutes = timeToMinutes(n.start_time);
      const endMinutes = timeToMinutes(n.end_time);
      if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
        return { ok: false, error: `notes[${i}].end_time must be later than start_time` };
      }
    }

    if (n.start_time != null && typeof n.start_time !== "string")
      return { ok: false, error: `notes[${i}].start_time must be a string if provided` };

    if (n.end_time != null && typeof n.end_time !== "string")
      return { ok: false, error: `notes[${i}].end_time must be a string if provided` };

    if (n.location != null && typeof n.location !== "string")
      return { ok: false, error: `notes[${i}].location must be a string if provided` };
  }

  if (typeof dateRangeDays === "number" && Number.isFinite(dateRangeDays) && dateRangeDays > 0) {
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
  if (!llm || typeof llm !== "object") return { ok: false, errors: ["LLM output missing"] };

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

    if (!Number.isInteger(n.day_index) || n.day_index < 0 || n.day_index >= dateRangeDays) {
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
    if (n.allDay === false) {
      if (!isValidTimeString(n.startsAt)) errors.push(`notes[${i}].startsAt invalid`);
      if (!isValidTimeString(n.endsAt)) errors.push(`notes[${i}].endsAt invalid`);
      const startMinutes = timeToMinutes(n.startsAt);
      const endMinutes = timeToMinutes(n.endsAt);
      if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
        errors.push(`notes[${i}].endsAt must be later than startsAt`);
      }
    }
  }

  for (let i = 0; i < dateRangeDays; i++) {
    if (!covered.has(i)) errors.push(`Missing day_index ${i}`);
  }

  return { ok: errors.length === 0, errors };
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
  return telemetryHits >= 2 || (compact.startsWith("{") && compact.endsWith("}") && jsonKeys >= 4);
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
  if (/^[A-Z][^.!?\n]{2,80}:/.test(block)) score += 8;
  if (
    /(turn|make|convert|transform|create|build|organize|map)\b[\s\S]{0,40}\b(?:\d{1,3}\s*day\s+)?flow\b/i
      .test(block)
  ) {
    score += 36;
  }
  if (
    /\b(flow|plan|timeline|launch|marketing|content|product|feature|pricing|revenue|users|support|feedback|analytics|retention|kdp|ocr|admin|legal|llc|yc|loan|amazon|mturk)\b/i
      .test(block)
  ) {
    score += 16;
  }
  if (/\b(day|week|month|quarter|timeline|\d{1,3}%|\$\d|\d{1,3}\+)\b/i.test(block)) score += 8;
  if (block.length >= 80 && block.length <= 700) score += 10;
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
    return truncateInline([description, sourceText].filter(Boolean).join("\n\n"), maxChars);
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

  const selected = dedupeBlocks([...descriptionBlocks.slice(0, 1), ...seeds, ...ranked]);
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

function clampLongSource(text: string, max = LONG_FLOW_SOURCE_CLAMP): string {
  const clean = normalizeSourceWhitespace(text);
  if (!clean || clean.length <= max) return clean;
  const head = Math.floor(max * 0.55);
  const tail = max - head - 120;
  return `${clean.slice(0, head)}\n\n[... middle omitted for model context ...]\n\n${clean.slice(clean.length - tail)}`;
}

function excerptForSourceSegment(
  full: string,
  segIndex: number,
  segCount: number,
  cap = LONG_FLOW_SEGMENT_EXCERPT_CAP,
): string {
  const blocks = splitSourceBlocks(full).filter((block) => !looksLikeTelemetryBlock(block));
  if (blocks.length === 0) return truncateInline(full, cap);

  if (blocks.join("\n\n").length <= cap) {
    return blocks.join("\n\n");
  }

  const startIdx = Math.floor((blocks.length * segIndex) / segCount);
  const rawEndIdx = Math.max(startIdx + 1, Math.floor((blocks.length * (segIndex + 1)) / segCount));
  let left = Math.max(0, startIdx);
  let right = Math.min(blocks.length, rawEndIdx);
  const chosen = blocks.slice(left, right);
  let totalChars = chosen.join("\n\n").length;

  while (totalChars < Math.floor(cap * 0.6) && (left > 0 || right < blocks.length)) {
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
        "Pull the next unblocked deliverable implied by the source text.",
        "Make one visible artifact (draft, listing, post, design, measurement, or outreach batch).",
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
      errors.push(`note day_index ${n.day_index} outside segment ${start}-${end}`);
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
  startDate: string;
  endDate: string;
  dateRangeDays: number;
  flowType: "workout" | "body" | "business" | "generic";
  technicalCraft: boolean;
  schedule: ScheduleInference;
  timezoneValue: string;
  timePreference: string;
  mode: "DICTATION" | "ELABORATION";
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
    startDate,
    endDate,
    dateRangeDays,
    flowType,
    technicalCraft,
    schedule,
    timezoneValue,
    timePreference,
    mode,
  } = args;

  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
  let totalIn = 0;
  let totalOut = 0;
  const cleanDescription = sanitizeLongFlowDescription(description);
  const cleanSource = normalizeSourceWhitespace(sourceText || description);
  const globalAnchors = buildLongFlowSourceAnchors(cleanDescription, cleanSource);
  const veryLongFlow = dateRangeDays >= VERY_LONG_FLOW_THRESHOLD_DAYS;
  const skipPlanner = veryLongFlow || cleanSource.length >= 28_000;
  const fallbackOverview: LLMOverview = {
    title: "Flow arc",
    summary:
      "A staged long-range flow built from the user's pasted material, carrying concrete priorities forward instead of flattening them into generic routines.",
  };

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
- Use GLOBAL_SOURCE_ANCHORS as non-negotiable through-lines that should show up across the arc.
- objectives: concrete, sourced from the user's material (name their initiatives, channels, products, timelines)—do not invent facts not implied by the text.
- beats: 4-8 short bullets, highly actionable, still grounded in the same material.
- overview.summary should describe the arc of the full window in 2-5 sentences.`;

  const material = clampLongSource(
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
    "",
    "GLOBAL_SOURCE_ANCHORS:",
    globalAnchors || "(none)",
    "",
    "SOURCE_AND_INTENT (read carefully):",
    material,
  ].join("\n");

  if (!skipPlanner) {
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
        console.log("[ai_generate_flow] long_flow: planner returned invalid segments; using default tiling");
      }
    } else {
      console.log("[ai_generate_flow] long_flow: planner failed, continuing with default tiling:", planResp.error);
    }
  } else {
    console.log(
      "[ai_generate_flow] long_flow: skipping planner",
      JSON.stringify({
        veryLongFlow,
        sourceChars: cleanSource.length,
      }),
    );
  }

  if (!String(flowName ?? "").trim()) flowName = "Planned Flow";

  const multiEventOk = inferMultiEventOk(
    mode,
    flowType,
    cleanDescription,
    dateRangeDays,
  );

  const segmentChunkAddendum = `

LONG_FLOW_SEGMENT_MODE (overrides general rules where they conflict):
- Return the same top-level JSON shape (flowName, optional overview, notes[]).
- notes MUST ONLY use day_index values from START_DAY through END_DAY (inclusive).
- Cover every day_index in that inclusive range at least once.
- Prefer ONE timed main session per day unless MULTI_EVENT_OK is true (then at most two).
- Preserve nuance from GLOBAL_SOURCE_ANCHORS and SOURCE_EXCERPT. Do not collapse the user's material into generic habit advice.
- Main session details: ${veryLongFlow ? "40-80" : "55-110"} words; dense, practical, and grounded in the source.
- Keep titles specific; avoid placeholder language like "Day 5 task"—use deliverable-oriented titles.
- Vary wording day-to-day; no recycled opener sentences.
- Later days must build on earlier work instead of restarting the flow from scratch.`;

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
    `INTERVAL_N: ${schedule.scheduleMode === "INTERVAL" ? (schedule.intervalN ?? "") : ""}`,
    `TIME_PREFERENCE: ${timePreference}`,
    `TIMEZONE: ${timezoneValue}`,
    `FLOW_TYPE: ${flowType}`,
    `TECHNICAL_CRAFT: ${technicalCraft}`,
  ].join("\n");

  const segCount = segments.length;

  const runOneSegment = async (
    seg: FlowArcSegmentPlan,
    segIndex: number,
    depth = 0,
  ): Promise<{ ok: boolean; chunk?: LLMFlow; error?: string; tin: number; tout: number }> => {
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
      "",
      `ARC_OVERVIEW_SUMMARY: ${(overview?.summary || fallbackOverview.summary).trim()}`,
      "",
      `SEGMENT_THEME: ${seg.theme}`,
      `SEGMENT_OBJECTIVES:\n- ${(seg.objectives?.length ? seg.objectives : ["Execute next milestones from material"]).join("\n- ")}`,
      `SEGMENT_BEATS:\n- ${(seg.beats?.length ? seg.beats : ["Ship one tangible artifact this segment"]).join("\n- ")}`,
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
      return { ok: false, error: "parse", tin: aiResp.tokensIn, tout: aiResp.tokensOut };
    }

    ensureLLMNoteTimes(chunk);
    const sliceValidation = validateLLMFlowOutputForRange(
      chunk,
      dateRangeDays,
      start,
      end,
    );
    if (!sliceValidation.ok) {
      console.log(
        "[ai_generate_flow] segment validation issues:",
        sliceValidation.errors.slice(0, 8),
      );
    }

    return {
      ok: true,
      chunk,
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
        details: "Write one sentence: what is the next obvious move, and what would make it easier?",
      };
    }

    return { ...n, details };
  });
}

function applySensibleTimes(opts: {
  notes: ParsedNote[];
  mode: "DICTATION" | "ELABORATION";
  flowType: string;
  description: string;
}): ParsedNote[] {
  const { notes, mode, flowType, description } = opts;
  if (!Array.isArray(notes)) return notes;
  if (mode === "DICTATION") return notes;

  const desc = (description || "").toLowerCase();
  const ft = (flowType || "").toLowerCase();

  const isMealFlow =
    /\b(meal|meals|recipe|recipes|cook|cooking|dinner|lunch|breakfast|meal prep)\b/.test(desc) ||
    /\b(food|nutrition)\b/.test(ft);

  const wantsDinner =
    /\b(dinner|dinners)\b/.test(desc) ||
    /\bweek of dinners\b/.test(desc) ||
    /\b(dinner recipes)\b/.test(desc);

  const wantsLunch = /\blunch\b/.test(desc);
  const wantsBreakfast = /\bbreakfast\b/.test(desc);

  let mainStart = "09:00";
  let mainEnd = "10:00";

  if (isMealFlow) {
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
  } else if (/\bworkout|fitness|training\b/.test(ft) || /\bworkout|gym\b/.test(desc)) {
    mainStart = "07:00";
    mainEnd = "08:00";
  } else if (/\bbusiness|deep work|work\b/.test(ft) || /\bdeep work|focus\b/.test(desc)) {
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

  const clampEvening = (n: ParsedNote) => setNoteTime(n, "20:00", "20:30");
  const setMain = (n: ParsedNote) => setNoteTime(n, mainStart, mainEnd);

  for (const [, dayNotes] of grouped.entries()) {
    if (!Array.isArray(dayNotes) || dayNotes.length === 0) continue;

    if (dayNotes.length === 1) {
      setMain(dayNotes[0]);
      continue;
    }

    dayNotes.sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

    let evening = dayNotes.find((n) => isEveningReflectionNote(n)) ?? dayNotes[dayNotes.length - 1];
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
  const hex = hexColor.replace('#', '');
  // Convert to integer (0xFFFFFF format)
  // parseInt returns NaN if it can't parse
  return parseInt(hex, 16);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  console.log("AI_GENERATE_FLOW_BUILD=2026-04-15_longflow_timeout_fix");
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
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    const { description, startDate, endDate, flowName, flowColor, timezone } = body;
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
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // ✅ Initialize immediately after required fields check (avoids TDZ)
    const descForSignals = `${description}\n${source_text ?? ""}`;
    let flowType: "workout" | "body" | "business" | "generic" = "generic";
    if (/(workout|gym|lift|training|practice drums|practice guitar)/i.test(descForSignals)) {
      flowType = "workout";
    } else if (/(hair|skin|scalp|body care|detox)/i.test(descForSignals)) {
      flowType = "body";
    } else if (/(business|startup|marketing|sales|clients|leads)/i.test(descForSignals)) {
      flowType = "business";
    }
    const technicalCraft = detectTechnicalCraft(descForSignals);
    console.log("[ai_generate_flow] technicalCraft:", technicalCraft);
    console.log("[ai_generate_flow] flowType:", flowType);

    const start = new Date(startDate);
    const end = new Date(endDate);
    const dateRangeDays = Math.floor(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
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
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    );
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({
          error: "Server misconfiguration: Supabase env missing",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // ✅ Authorization header (declare ONCE, early)
    const __authHeader = req.headers.get("authorization") ?? "";

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
    const jwt = __authHeader.startsWith("Bearer ") ? __authHeader.slice(7) : __authHeader;
    const claims = jwt ? decodeJwtPayload(jwt) : null;
    const userId: string | null = (claims && typeof claims.sub === "string") ? claims.sub : null;

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: "UNAUTHENTICATED", message: "Missing or invalid Authorization token" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // ✅ Create the user-bound client (declare ONCE, before quota + OpenAI)
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: __authHeader } },
    });

    const verboseAuth = Deno.env.get("AI_GENERATE_FLOW_VERBOSE_AUTH") === "true";
    if (verboseAuth) {
      console.log("=== AUTH DEBUG START ===");
      const authKeys: string[] = [];
      for (const [key] of req.headers.entries()) {
        if (key.toLowerCase().includes("auth")) authKeys.push(key);
      }
      console.log("🔍 Auth-related header keys:", authKeys.join(", "));
    }

    if (!__authHeader.trim()) {
      return new Response(JSON.stringify({ error: "Unauthorized: No auth header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    const supabaseAdmin =
      supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(jwt);

    if (userErr) {
      console.error("[ai_generate_flow] getUser failed:", userErr.message ?? userErr);
      if (verboseAuth) console.log("=== AUTH DEBUG END ===");
      return new Response(
        JSON.stringify({ error: "Unauthorized: " + userErr.message }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!user) {
      console.error("[ai_generate_flow] getUser returned no user");
      if (verboseAuth) console.log("=== AUTH DEBUG END ===");
      return new Response(JSON.stringify({ error: "Unauthorized: No user" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
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
    const skipCache = forceRefresh === true || cacheUnavailable;
    let cached = false;
    let llmFlow: LLMFlow | null = null;
    let modelUsed = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let llmStatus = skipCache ? "cache_bypass" : "error";
    let costCents = 0;
    let mode: "DICTATION" | "ELABORATION" = "ELABORATION";
    const startTime = Date.now();
    const dmPolicyVersion = "dm_v1";
    let outcomeVectors: OutcomeVectorV1[] = [];
    let constraintsJson: ConstraintsV1 = deriveConstraintsV1([]);
    let constraintsFetchStatus: "ok" | "error" | "unavailable" | "skipped_personalization_off" = "unavailable";
    let personalizationEnabled: boolean | null = null;
    let prefsEnvelope: PrefsEnvelope = null;
    let preferredHours: number[] = [];
    let avoidHours: number[] = [];
    let prefsVersion = "prefs_v1";
    let prefsPromptSnippet: string | null = null;
    let prefsUsed = false;

    try {
      const { data: profileRow, error: profileErr } = await supabaseUser
        .from("profiles")
        .select("personalization_enabled")
        .eq("id", userId)
        .maybeSingle();
      if (profileErr) {
        console.log("⚠️ personalization flag fetch error:", profileErr.message ?? profileErr);
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
      prefsVersion = prefsEnvelope?.prefs_version ?? prefs?.prefs_version ?? "prefs_v1";

      let prefsSnippet = "";
      if (preferredHours.length > 0 || avoidHours.length > 0) {
        prefsSnippet = `DM_PREFERENCES (${prefsVersion}):`;
        if (preferredHours.length > 0) {
          prefsSnippet += `\n- PREFERRED_HOURS_LOCAL: ${preferredHours.join(",")}`;
        }
        if (avoidHours.length > 0) {
          prefsSnippet += `\n- AVOID_HOURS_LOCAL: ${avoidHours.join(",")}`;
        }
      }
      prefsPromptSnippet = prefsSnippet ? prefsSnippet.trim() : null;
      prefsUsed = !!(prefsPromptSnippet && prefsPromptSnippet.length > 0);
    }
    const baseInputMeta: Record<string, any> = {
      cache_bypass: skipCache,
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

    // --- Phase 4: constraint-to-prompt decision (Option A) ---
    const DM_USE_CONSTRAINTS = (Deno.env.get("DM_USE_CONSTRAINTS") ?? "false") === "true";
    const maxEpd = constraintsJson?.limits?.max_events_per_day;
    const constraintsEligible = (constraintsJson?.eligible_vectors ?? 0) >= 1;
    const shortFlowReflectionPairRequired =
      requiresShortFlowReflectionPair(dateRangeDays);
    const constraintsCanInject =
      !shortFlowReflectionPairRequired &&
      DM_USE_CONSTRAINTS &&
      constraintsEligible &&
      typeof maxEpd === "number" &&
      Number.isFinite(maxEpd) &&
      maxEpd >= 1;
    let constraintsPromptSnippet: string | null = null;
    if (constraintsCanInject) {
      constraintsPromptSnippet =
        `DM_CONSTRAINTS (constraints_v1):\n` +
        `- MAX_EVENTS_PER_DAY: ${maxEpd}\n` +
        `Follow this limit unless the user explicitly requests otherwise.`;
    }
    baseInputMeta.constraints_used = constraintsCanInject;
    baseInputMeta.constraints_used_reason = !DM_USE_CONSTRAINTS
      ? "kill_switch_off"
      : shortFlowReflectionPairRequired
        ? "short_flow_reflection_pair_override"
      : (constraintsEligible < 1
        ? "no_eligible_vectors"
        : (typeof maxEpd !== "number" || !Number.isFinite(maxEpd) || maxEpd < 1
          ? "no_limits"
          : "eligible_vectors>=1 && max_events_per_day set"));
    baseInputMeta.constraints_prompt_snippet =
      constraintsPromptSnippet ? constraintsPromptSnippet.slice(0, 300) : null;

    const constraintsFingerprint = constraintsCanInject
      ? { v: constraintsJson.constraints_version, max_epd: maxEpd }
      : { v: "none" };
    const prefsFingerprint = prefsUsed
      ? { v: prefsVersion, ph: preferredHours, ah: avoidHours }
      : { v: "none" };
    const inputForHash = JSON.stringify({
      description,
      startDate,
      endDate,
      source_text,
      promptFingerprint,
      constraints: constraintsFingerprint,
      prefs: prefsFingerprint,
      generation_strategy:
        dateRangeDays >= LONG_FLOW_THRESHOLD_DAYS ? "long_chunked_v1" : "single_v1",
    });
    const input_hash = await sha256Hex(inputForHash);

    if (cacheUnavailable) {
      console.log("[ai_generate_flow] cache unavailable (no service role key)");
    }

    if (!skipCache) {
      const { data: cacheRows, error: cacheErr } = await supabaseAdmin
        .from("flow_generation_cache")
        .select("response_json, created_at, model_used, llm_status, prompt_fingerprint")
        .eq("user_id", userId)
        .eq("snapshot_version", snapshotVersion)
        .eq("schema_version", schemaVersion)
        .eq("policy_version", policyVersion)
        .eq("input_hash", input_hash)
        .gte(
          "created_at",
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        )
        .order("created_at", { ascending: false })
        .limit(1);

      if (!cacheErr && Array.isArray(cacheRows) && cacheRows.length > 0) {
        try {
          llmFlow = cacheRows[0].response_json as LLMFlow;
          cached = true;
          llmStatus = "cache_hit";
          modelUsed = cacheRows[0].model_used ?? "cache";
        } catch (e) {
          cached = false;
        }
      }

      if (cached && llmFlow) {
        const cacheValidation = validateLLMFlowOutput(llmFlow, dateRangeDays);
        if (!cacheValidation.ok) {
          cached = false;
          llmFlow = null;
          llmStatus = "cache_invalid";
        }
      }
    }

    if (!cached) {
      mode = inferMode(description, source_text);
      const scheduleForSignals = `${description}\n${(source_text || "").slice(0, 8000)}`;
      const schedule = inferSchedule(scheduleForSignals);
      const timePreference = inferTimePreference(scheduleForSignals);
      const timezoneValue = timezone || "UTC";

      if (dateRangeDays >= LONG_FLOW_THRESHOLD_DAYS) {
        console.log(
          "[ai_generate_flow] long_flow path, days=",
          dateRangeDays,
          "threshold=",
          LONG_FLOW_THRESHOLD_DAYS,
        );
        const longRes = await generateLongRangeFlowLlm({
          description,
          sourceText: source_text ?? "",
          startDate,
          endDate,
          dateRangeDays,
          flowType,
          technicalCraft,
          schedule,
          timezoneValue,
          timePreference,
          mode,
        });
        if (!longRes.ok) {
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
                "Access-Control-Allow-Origin": origin,
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
      } else {
      const multiEventOk = inferMultiEventOk(mode, flowType, description, dateRangeDays);

      const sys = systemPrompt;
      // Clamp completion tokens to stay below the 16,384 cap of gpt-4o-mini.
      // This prevents OpenAI from rejecting requests with "max_tokens is too large".
      const modelMaxTokens = 14000;
      const promptReserve = 1500;
      const calculatedMaxTokens = Math.max(3500, Math.ceil(dateRangeDays * 500));
      const maxTokens = Math.min(calculatedMaxTokens, modelMaxTokens);
      const temperature = mode === "DICTATION" ? 0.3 : 0.6;

      const header = [
        `MODE: ${mode}`,
        `SCHEDULE_MODE: ${schedule.scheduleMode}`,
        `SPECIFIC_DAYS: ${schedule.specificDays.join(",")}`,
        `INTERVAL_N: ${schedule.scheduleMode === "INTERVAL" ? (schedule.intervalN ?? "") : ""}`,
        `MULTI_EVENT_OK: ${multiEventOk}`,
        `TIME_PREFERENCE: ${timePreference}`,
        `TIMEZONE: ${timezoneValue}`,
        `DATE_RANGE: ${startDate} → ${endDate} (${dateRangeDays} days)`,
        `FLOW_TYPE: ${flowType}`,
        `TECHNICAL_CRAFT: ${technicalCraft}`,
      ].join("\n");

      const flowNameHint = flowName ? `\nFLOW_NAME_HINT: ${flowName}` : "";
      const constraintsBlock =
        baseInputMeta.constraints_used && baseInputMeta.constraints_prompt_snippet
          ? `\n\n${String(baseInputMeta.constraints_prompt_snippet)}\n`
          : "\n\n";
      const shortFlowReflectionBlock = shortFlowReflectionPairRequired
        ? `SHORT_FLOW_REFLECTION_RULE:\n- Because this flow is ${dateRangeDays} days (<= ${SHORT_FLOW_REFLECTION_PAIR_THRESHOLD_DAYS}), create two notes for every day_index.\n- Note 1 must be the primary flow session.\n- Note 2 must be an evening reflection / recap / review note at 20:00–20:30.\n- The evening note must stay mental-only and concise.`
        : "";
      const prefsBlock =
        prefsUsed && prefsPromptSnippet ? `${prefsPromptSnippet}\n` : "";
      const dmBlock = `${constraintsBlock}${prefsBlock}`;
      const baseUserPrompt =
        `${header}${flowNameHint}${dmBlock}${shortFlowReflectionBlock ? `${shortFlowReflectionBlock}\n\n` : ""}` +
        `USER_DESCRIPTION:\n${description}\n\n${
          source_text ? `SOURCE_TEXT:\n${source_text}\n\n` : ""
        }Cover every day_index 0..${dateRangeDays - 1} with at least one note. You may create multiple notes for a day_index when appropriate.`;

      const correctionBase = `Return valid JSON only. Ensure notes cover every day_index 0..${dateRangeDays - 1}. Follow the schema exactly.`;
      const specificDaysReminder = "Only schedule the main activity on SPECIFIC_DAYS. Other days must be Maintain/Rest notes.";

      let attempt = 0;
      while (attempt <= MAX_RETRIES) {
        const retryInstruction = attempt > 0
          ? `${correctionBase}${schedule.scheduleMode === "SPECIFIC_DAYS" ? `\n${specificDaysReminder}` : ""}`
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
            JSON.stringify({ success: false, error: "OPENAI_ERROR", message: aiResp.error ?? "Unknown OpenAI error" }),
            {
              status: 502,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": origin,
              },
            }
          );
        }

        tokensIn = aiResp.tokensIn;
        tokensOut = aiResp.tokensOut;
        modelUsed = aiResp.modelUsed;

        if (aiResp.finishReason === "length") {
          console.log("⚠️ LLM response was truncated (hit token limit) — retrying with shorter main sessions");
          const shortenedPrompt = `${promptToSend}\n\nShorten each MAIN SESSION by ~15% but preserve structure and domain artifacts. Keep each MAIN SESSION under 220 words.`;
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
              JSON.stringify({ success: false, error: "OPENAI_ERROR", message: retryResp.error ?? "Unknown OpenAI error" }),
              {
                status: 502,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": origin,
                },
              }
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
                message: `Response was too long for ${dateRangeDays} days, even after shortening. Try a shorter date range.` 
              }),
              {
                status: 500,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": origin,
                },
              }
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
        console.log("🔍 LLM TOKENS OUT:", tokensOut, "max_tokens:", usedMaxTokens);
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
          const specificCheck = schedule.scheduleMode === "SPECIFIC_DAYS"
            ? validateSpecificDays(llmFlow.notes ?? [], startDate, schedule.specificDays)
            : { ok: true, violations: 0 };
          const notesCount = llmFlow.notes?.length ?? 0;
          console.log("🔍 LLM PARSED JSON: flowName='%s', notesCount=%s, validationOk=%s", llmFlow.flowName, notesCount, llmValidation.ok);

          if (llmValidation.ok && specificCheck.ok) {
            costCents = calculateCostCents(modelUsed, tokensIn, tokensOut);
            llmStatus = attempt === 0 ? "success" : "retry_success";
            break;
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

    if (!llmFlow) {
      const status = llmStatus === "validation_failed" ? 400 : 500;
      const payload =
        llmStatus === "validation_failed"
          ? { success: false, error: "LLM_VALIDATION_ERROR", message: "Model output failed validation after retry." }
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
          input_meta: baseInputMeta,
        };
        try {
          const { error: failureLogErr } = await supabaseAdmin
            .from("flow_generation_logs")
            .insert(failureLogRow);
          if (failureLogErr) {
            console.log("Failed to insert failure flow_generation_logs:", failureLogErr);
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
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // Ensure mode is available for post-processing decisions (cached or fresh)
    mode = inferMode(description, source_text);

    // Transform LLM output to ParsedFlow
    const startDateStr = startDate;
    const parsedFlow = transformLLMFlowToParsedFlow(llmFlow, startDateStr, dateRangeDays);
    parsedFlow.notes = ensureShortFlowReflectionPairs(
      parsedFlow.notes,
      dateRangeDays,
    );

    // Enforce richer structure when LLM output is thin/unlabeled
    if (mode === "ELABORATION") {
      enforceRichStructure(parsedFlow);
    }

    parsedFlow.notes = applySensibleTimes({
      notes: parsedFlow.notes,
      mode,
      flowType,
      description,
    });

    let structureResult: { ok: boolean; failedDayIndices: number[] } = {
      ok: true,
      failedDayIndices: [],
    };

    if (mode === "ELABORATION") {
      structureResult = validateMainSessionStructure(parsedFlow, technicalCraft);
      console.log("🔍 MAIN SESSION STRUCTURE CHECK:", structureResult);

      if (
        !structureResult.ok &&
        structureResult.failedDayIndices.length > 0 &&
        dateRangeDays < LONG_FLOW_THRESHOLD_DAYS
      ) {
        const structureLines = [
          "- Opener before any list (at least one full sentence).",
          "- 3+ bullet/numbered steps.",
          "- Close with 1–2 lines (not bullets) that capture a win + adjustment (keywords: if, next time, adjust, try, tighten, when...then).",
          "- At least one measurable element (digit/unit/range).",
        ];
        if (technicalCraft) {
          structureLines.push(
            "- Include an expected/measurement phrase plus units/tolerance/range and ≥3 of: specific parts/values, tool/meter setting, expected output range, safety constraint, debug fork, logging/documentation output.",
          );
        }
        structureLines.push("- If the note lacks a short rehearsal cue (first 60 seconds), add one.");

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
            `Repair MAIN SESSION details ONLY for day_index: ${batch.join(", ")}.`,
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
              description,
            });

            for (const dayIdx of batch) {
              const existing = parsedFlow.notes.filter((n) => n.day_index === dayIdx);
              const repaired = repairedParsed.notes.filter((n) => n.day_index === dayIdx);
              const existingMain = getMainSessionNote(existing);
              const repairedMain = getMainSessionNote(repaired);
              if (existingMain && repairedMain && repairedMain.details) {
                existingMain.details = (repairedMain.details ?? "").trim();
              }
            }
          } else {
            console.log("⚠️ Repair batch response could not be parsed; keeping original for batch");
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

    // Log parsed flow for debugging (post-repair)
    if (Deno.env.get("AI_GENERATE_FLOW_DEBUG_FLOW_JSON") === "true") {
      console.log("🔍 PARSED FLOW:", JSON.stringify(parsedFlow, null, 2));
    } else {
      console.log(
        `[ai_generate_flow] parsed flow ok name=${parsedFlow.flow_name} notes=${parsedFlow.notes?.length ?? 0}`,
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
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // Validate the transformed flow
    const validation = validateParsedFlow(parsedFlow, dateRangeDays);
    if (!validation.ok) {
      return new Response(
        JSON.stringify({ success: false, error: "LLM_VALIDATION_ERROR", message: validation.error ?? "Invalid AI output" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // Create flow
    const generatedAt = new Date().toISOString();
    const ai_metadata = {
      generated: true,
      model: modelUsed,
      prompt: description,
      dateRange: { startDate, endDate },
      generatedAt,
      tokensUsed: { in: tokensIn, out: tokensOut },
      costCents,
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
      if (typeof input === 'number' && Number.isFinite(input) && !Number.isNaN(input)) {
        const n = Math.floor(input);
        return n < 0 ? DEFAULT_COLOR : (n > 0xFFFFFF ? 0xFFFFFF : n);
      }
      if (typeof input === 'string') {
        const s = input.trim().replace(/^#/, '').replace(/^0x/i, '');
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
    console.log("   Request body color:", flowColor, "(type:", typeof flowColor, ")");
    console.log("   Final Color:", finalColor, "(ARGB int)");
    console.log("   Source:", finalColor === DEFAULT_COLOR ? "Default" : "Client");

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
      flow_id: null,  // ✅ Flutter creates the flow, not Edge
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
      input_meta: baseInputMeta,
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

    // Cache result (cache raw llmFlow, not parsedFlow)
    if (supabaseAdmin && !cached && llmFlow) {
      try {
        const cacheRow = {
          user_id: userId,
          snapshot_version: snapshotVersion,
          schema_version: schemaVersion,
          policy_version: policyVersion,
          input_hash,
          user_prompt: description,
          response_json: llmFlow,
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
            cacheInsertErr
          );
        }
      } catch (e) {
        console.error("flow_generation_cache threw:", e);
      }
    }

    // Convert color integer back to hex string for response
    // finalColor is RGB int like 0x4dd0e1 (no alpha channel, matches DEFAULT_COLOR format)
    // Pad to 6 digits and add # prefix
    const rgbHex = finalColor.toString(16).padStart(6, '0');
    const colorHex = '#' + rgbHex;

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
          "Access-Control-Allow-Origin": origin,
        },
      }
    );
  } catch (err) {
    console.error("Unhandled error in ai_generate_flow:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
