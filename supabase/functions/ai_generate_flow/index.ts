import { createClient } from "npm:@supabase/supabase-js@2.27.0";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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
    console.error("⚠️ ANTHROPIC_API_KEY missing — using mock response");
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
    console.error("📡 Calling Anthropic API:");
    console.error("   Model:", modelId);
    console.error("   URL:", ANTHROPIC_API_URL);
    console.error("   Has API key:", !!apiKey);

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

    console.error("📬 Anthropic API Response:");
    console.error("   Status:", res.status);
    console.error("   OK:", res.ok);

    if (!res.ok) {
      const text = await res.text();
      console.error("   Error body:", text);
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
      console.error("❌ Claude API timeout after 45 seconds");
      throw new Error('AI generation timed out. Please try again.');
    }
    
    throw error;
  }
}
const MAX_RETRIES = 1;

// ---- LLM JSON schema for ai_generate_flow ----
type LLMNote = {
  day_index: number;       // 0-based offset from startDate
  title: string;
  details: string;
  allDay: boolean;
  startsAt: string;        // "HH:MM" 24h
  endsAt: string;          // "HH:MM" 24h
  chips?: number[];        // decan day chips 1–10 (used by the model, NOT stored in DB)
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

// ---- OpenAI helper (Deno fetch, no SDK) ----
type OpenAIMessage = { role: "system" | "user" | "assistant"; content: string };

async function generateWithOpenAI({
  messages,
  model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
  temperature = 0.7,
  max_tokens = 1800,
}: {
  messages: OpenAIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
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
  return `

You are the **Ma'at Flow Architect**.

You design 7–30 day lifestyle FLOWS for the Ma'at Living Calendar App.

A **Flow** = a sequence of daily, actionable tasks tied to specific days in a date range.
The app converts your JSON into scheduled events.

You MUST obey this JSON schema EXACTLY (no extra fields, no comments):

{
  "flowName": "string",
  "overview": {
    "title": "string",
    "summary": "string"
  },
  "notes": [
    {
      "day_index": 0,
      "title": "string",
      "details": "string",
      "allDay": true,
      "startsAt": "HH:MM",
      "endsAt": "HH:MM",
      "chips": [1, 2, 3]
    }
  ]
}

Rules:
- Output **ONLY** valid JSON that matches this schema. No markdown, no prose, no explanations.
- \`day_index\` is 0-based from the user's startDate (0 = first day, 1 = second day, etc).
- \`chips\` is a list of **decan day numbers 1–10** that the day belongs to. If unclear, use the 1–10 pattern blindly by cycling: (day_index % 10) + 1.
- \`allDay\`:
  - true  → ignore \`startsAt\`/\`endsAt\` (can be "00:00").
  - false → \`startsAt\` and \`endsAt\` MUST be "HH:MM" 24h time.
- Times must make sense: \`endsAt\` later than \`startsAt\`.
- Every day in the requested date range should have **at least one note**.

ALWAYS RESPECT:
- The provided date range (start_date, end_date).
- The FLOW_TYPE you receive. If FLOW_TYPE=workout, you MUST only generate training-related notes (no Lunch, Dinner, chores) unless the user explicitly includes meals.
- Any user preferences:
  - If they mention "weekdays only", only schedule on Monday–Friday.
  - If they mention specific times (e.g., 7pm, mornings), use those for startsAt/endsAt.
  - If they say "3 days per week", space notes across the range accordingly.

GENERAL STYLE RULES
- Never be vague or motivational only.
- Every \`details\` field must be rich and step-by-step:
  - Lists of actions
  - Quantities, durations, measurements, or examples
  - Clear "how to", not "remember to…".
- Use short paragraphs or bullet-like lines separated by newlines; avoid giant walls of text.

IF THE USER GIVES SOURCE MATERIAL
- The request may include a \`source_text\` with raw notes / book pages / chat logs.
- Boil that down into a **structured flow**:
  - Preserve the important ideas and sequencing.
  - Turn high-level advice into concrete daily tasks.
  - Respect any explicit constraints (weekdays only, mornings only, etc).

WEEKDAY / TIME CONSTRAINTS
- If the user mentions weekdays (Mon–Fri, weekends only, etc.), or specific times:
  - Respect those when assigning \`day_index\` and \`startsAt\`/\`endsAt\`.
  - If they say "weekdays only", leave weekend days empty or use reflection / review tasks that fit the theme.

HAIR / BODY / HEALTH FLOWS (EXAMPLE STYLE)
- For goals like "regrow hair", "improve sleep", "detox", etc:
  - Include protocols, recipes, dosages where reasonable (e.g. "drink 16 oz warm water with lemon").
  - Reference safe, common-sense practices (hydration, nutrition, gentle routines).
  - Each day should feel like a **mini protocol**, not a reminder.

WORKOUT / TRAINING FLOWS (STRICT RULES)
When the user asks for any **workout, lifting, training, sport practice, or physical routine**:

1. Each training day MUST include:
   - 3–6 distinct exercises.
   - For each exercise: **sets, reps, and rest** (e.g. "3 × 10–12 reps, 60–90 sec rest").
   - Any needed equipment (dumbbells, barbell, bands, bodyweight).
   - A clear goal for the session (e.g. "Hypertrophy for shoulders and triceps", "Technique-focused drum practice").

2. Program design:
   - Use simple, real-world programming principles:
     - Upper/Lower, Push/Pull/Legs, full-body, or skill practice blocks.
     - Slight progression over the days (more volume, tempo, or intensity).
     - At least one lighter / recovery day in a 7+ day flow.

3. DETAILS LENGTH (NON-NEGOTIABLE):
   - \`details\` MUST contain **at least 4 separate action lines**.
   - Use line breaks (\`\n\`) or \`1)\`, \`2)\`, \`3)\` style numbering.
   - Never write a single short sentence like "Increase intensity with weights."  
     That is INVALID. Expand it into concrete instructions.

4. TOPIC DISCIPLINE:
   - If the user's description is clearly about a **workout or training plan only**, do **NOT** add unrelated notes like "Lunch", "Dinner", "Meetings", or random chores.
   - Only include nutrition / lifestyle tasks if the user explicitly mentions wanting meals / diet in this particular flow.

5. EXAMPLES (FOLLOW FORMAT & DETAIL LEVEL, NOT THE CONTENT):

Example 1 – Strength Workout Flow (short, 3 days shown):

{
  "flowName": "Upper/Lower Strength Split",
  "overview": {
    "title": "Upper/Lower Strength & Core – 4 Week Template",
    "summary": "A simple, progressive 4-week plan focusing on basic compound lifts, joint-friendly accessory work, and consistent core training. Two upper days, two lower days per week. Each session lasts 45–60 minutes."
  },
  "notes": [
    {
      "day_index": 0,
      "title": "Day 1 – Upper Body Strength",
      "details": "Warm-up: 5–8 min brisk walk or cycle.\\n\\n1) Bench Press – 4 × 5–6 reps, 2–3 min rest. Choose a weight that feels heavy but repeatable with clean form.\\n2) Bent-Over Barbell Row – 4 × 6–8 reps, 2 min rest. Keep back flat and pull bar to lower ribs.\\n3) Seated Dumbbell Shoulder Press – 3 × 8–10 reps, 90 sec rest.\\n4) Lat Pulldown or Pull-ups – 3 × 6–10 reps, 90 sec rest.\\n5) Plank – 3 × 30–45 sec holds, 45 sec rest.\\n\\nCool-down: 5 min easy stretching for chest, shoulders, and upper back.",
      "allDay": false,
      "startsAt": "18:00",
      "endsAt": "19:00",
      "chips": [1]
    },
    {
      "day_index": 2,
      "title": "Day 3 – Lower Body & Core",
      "details": "Warm-up: 5–8 min light bike or incline walk.\\n\\n1) Back Squat or Goblet Squat – 4 × 6–8 reps, 2–3 min rest.\\n2) Romanian Deadlift – 3 × 8–10 reps, 2 min rest.\\n3) Walking Lunges – 3 × 10–12 steps per leg, 90 sec rest.\\n4) Calf Raises – 3 × 12–15 reps, 60–90 sec rest.\\n5) Hanging Knee Raises – 3 × 12–15 reps, 60 sec rest.\\n\\nCool-down: 5 min stretching for quads, hamstrings, and hips.",
      "allDay": false,
      "startsAt": "18:00",
      "endsAt": "19:00",
      "chips": [3]
    },
    {
      "day_index": 4,
      "title": "Day 5 – Upper Volume & Core",
      "details": "Warm-up: 5–8 min brisk walk or jump rope.\\n\\n1) Incline Dumbbell Press – 4 × 8–10 reps, 90 sec rest.\\n2) One-arm Dumbbell Row – 3 × 10–12 reps per arm, 90 sec rest.\\n3) Lateral Raises – 3 × 12–15 reps, 60 sec rest.\\n4) Tricep Rope Pushdowns – 3 × 10–12 reps, 60–90 sec rest.\\n5) Cable or Band Face Pulls – 3 × 15 reps, 60 sec rest.\\n6) Side Plank – 3 × 20–30 sec per side, 45 sec rest.\\n\\nCool-down: 5 min stretching for shoulders and upper back.",
      "allDay": false,
      "startsAt": "18:00",
      "endsAt": "19:00",
      "chips": [5]
    }
  ]
}

Example 2 – Hair/Body Care Flow (structure only, not for copying content):

{
  "flowName": "30-Day Hair Growth & Scalp Reset",
  "overview": {
    "title": "Scalp Reset and Growth Stimulation",
    "summary": "Thirty days of rotating scalp detox, circulation work, microneedling, and nutrition so the follicles get both external and internal support. Weekly cycles repeat with small progressions rather than random tasks."
  },
  "notes": [
    {
      "day_index": 0,
      "title": "Day 1 – Deep Scalp Reset",
      "details": "1) Mix detox mask: 2 tbsp bentonite clay + 1 tbsp apple cider vinegar + 1 tbsp aloe gel + a little water until paste-like.\\n2) Apply only to scalp, avoiding hair length. Leave on 10–12 minutes, then rinse thoroughly.\\n3) Wash with rosemary shampoo bar, focusing massage on the scalp, not the ends.\\n4) Drink 16 oz warm water with lemon in the morning; aim for 64 oz of water across the day.\\n5) Supplements: Vitamin D3 2000 IU and Zinc 15–30 mg with food, unless medically contraindicated.\\n\\nGoal: Remove buildup, open follicles, and hydrate from inside.",
      "allDay": false,
      "startsAt": "09:00",
      "endsAt": "10:00",
      "chips": [1]
    }
  ]
}

JSON OUTPUT REQUIREMENTS
- Do NOT include trailing commas.
- Do NOT include comments or explanations outside the JSON.
- Do NOT wrap JSON in backticks.
- If the user's request is extremely short, still generate a full, rich flow that matches the date range.

Your job: Given description, date range, timezone, and optional source_text, return **one JSON object** exactly matching the schema above, with detailed, real-world tasks for each day.

`;
}

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

// ✅ REFACTOR: Removed all date/time helper functions
// Flutter is now the only source of truth for all date calculations

// ✅ REFACTOR: Transform LLMFlow -> ParsedFlow (no date calculations)
// Flutter will compute all actual dates from day_index + startDate
// ✅ Always use sequential day_index (0, 1, 2...) - never trust LLM's day_index
function transformLLMFlowToParsedFlow(
  llm: LLMFlow,
  startDateStr: string  // kept for logging only, not used in calculations
): ParsedFlow {
  const overviewTitle = llm.overview?.title ?? null;
  const overviewSummary = llm.overview?.summary ?? null;
  const notes = llm.notes ?? [];

  // ✅ Simplified: Always use sequential indices (0, 1, 2...)
  // Never trust LLM's day_index - it's unreliable and causes date drift
  const parsedNotes: ParsedNote[] = notes.map((n: LLMNote, idx: number) => {
    const rawAllDay = typeof n.allDay === "boolean" ? n.allDay : false;

    // Extract time strings if LLM provided them (but ignore any dates)
    const startTime = n.startsAt && n.startsAt.includes(":")
      ? n.startsAt
      : rawAllDay
      ? null  // all-day events don't need times
      : null;  // Flutter will set defaults if needed

    const endTime = n.endsAt && n.endsAt.includes(":")
      ? n.endsAt
      : rawAllDay
      ? null
      : null;

    return {
      day_index: idx,  // ✅ Always sequential, never trust LLM
      title: n.title?.trim() || `Day ${idx + 1}`,
      details: (n.details ?? "").toString().trim(),
      all_day: rawAllDay,
      start_time: startTime,
      end_time: endTime,
      location: n.location?.trim() || null,
    };
  });

  return {
    flow_name: llm.flowName ?? "Untitled Flow",
    overview_title: overviewTitle?.trim() || llm.flowName || "Untitled Flow",
    overview_summary: overviewSummary?.trim() || "",
    notes: parsedNotes,
  };
}


function validateParsedFlow(flow: ParsedFlow): { ok: boolean; error?: string } {
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
      n.day_index < 0 ||
      !Number.isFinite(n.day_index)
    ) {
      return {
        ok: false,
        error: `notes[${i}].day_index is required and must be a non-negative number`,
      };
    }

    if (typeof n.title !== "string" || n.title.trim() === "")
      return { ok: false, error: `notes[${i}].title is required` };

    if (typeof n.details !== "string" || n.details.trim() === "")
      return { ok: false, error: `notes[${i}].details must be a non-empty string` };

    if (typeof n.all_day !== "boolean")
      return { ok: false, error: `notes[${i}].all_day must be a boolean` };

    if (n.start_time != null && typeof n.start_time !== "string")
      return { ok: false, error: `notes[${i}].start_time must be a string if provided` };

    if (n.end_time != null && typeof n.end_time !== "string")
      return { ok: false, error: `notes[${i}].end_time must be a string if provided` };

    if (n.location != null && typeof n.location !== "string")
      return { ok: false, error: `notes[${i}].location must be a string if provided` };
  }

  return { ok: true };
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

    const { description, startDate, endDate, flowName, flowColor, timezone, source_text } =
      body;
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

    // Quota/rate limits removed - let OpenAI handle rate limiting

    // 🔧 EXTENSIVE AUTH DEBUG LOGGING
    console.error("=== AUTH DEBUG START ===");
    
    // Log all headers that contain 'auth'
    const allHeaders = {};
    for (const [key, value] of req.headers.entries()) {
      if (key.toLowerCase().includes('auth')) {
        allHeaders[key] = value;
      }
    }
    console.error("🔍 All request headers with 'auth':", allHeaders);
    
    // __authHeader already extracted above - reuse it
    console.error("🔍 Auth header present:", !!__authHeader);
    console.error("🔍 Auth header length:", __authHeader.length);
    console.error("🔍 Auth header starts with 'Bearer':", __authHeader.startsWith("Bearer"));
    console.error("🔍 Auth header first 100 chars:", __authHeader.substring(0, 100));
    
    if (!__authHeader) {
      console.error("❌ No Authorization header found");
      console.error("=== AUTH DEBUG END ===");
      return new Response(JSON.stringify({ error: "Unauthorized: No auth header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // Extract JWT token for debugging (jwt already extracted above)
    const jwtToken = jwt;
    console.error("🔍 Extracted JWT length:", jwtToken.length);
    console.error("🔍 JWT first 50 chars:", jwtToken.substring(0, 50));

    console.error("🔍 Creating Supabase client with auth header...");
    console.error("🔍 SUPABASE_URL:", SUPABASE_URL);
    console.error("🔍 SUPABASE_ANON_KEY present:", !!SUPABASE_ANON_KEY);
    
    // supabaseUser already created earlier for quota check - reuse it
    // (removed duplicate definition)

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    console.error("🔍 Calling getUser() with JWT...");
    // CRITICAL FIX: Reuse jwt from earlier extraction (line 319) - no duplicate declaration
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(jwt);
    
    console.error("🔍 getUser() returned:");
    console.error("   - user:", user ? `${user.id} (${user.email})` : "null");
    console.error("   - error:", userErr);
    
    if (userErr) {
      console.error("❌ getUser() error details:", JSON.stringify(userErr, null, 2));
      console.error("=== AUTH DEBUG END ===");
      return new Response(
        JSON.stringify({ error: "Unauthorized: " + userErr.message }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    
    if (!user) {
      console.error("❌ No user returned from getUser()");
      console.error("=== AUTH DEBUG END ===");
      return new Response(JSON.stringify({ error: "Unauthorized: No user" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.error("✅ User authenticated:", user.id);
    console.error("=== AUTH DEBUG END ===");
    // ✅ userId already exists from line 321 (JWT claims) - no need to redeclare
    // Sanity check: ensure getUser() userId matches JWT claims
    if (user.id !== userId) {
      console.error("⚠️ WARNING: getUser() userId mismatch with JWT claims");
    }

    // Rate limiting removed - let OpenAI handle rate limiting

    // Cache lookup
    const inputForHash = JSON.stringify({ description, startDate, endDate, source_text });
    const input_hash = await sha256Hex(inputForHash);

    let cached = false;
    let llmFlow: LLMFlow | null = null;
    let modelUsed = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let llmStatus = "error";
    let costCents = 0;
    const startTime = Date.now();

    const { data: cacheRows, error: cacheErr } = await supabaseAdmin
      .from("flow_generation_cache")
      .select("response_json, created_at")
      .eq("input_hash", input_hash)
      .gte(
        "created_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      )
      .limit(1);

    if (!cacheErr && Array.isArray(cacheRows) && cacheRows.length > 0) {
      try {
        llmFlow = cacheRows[0].response_json as LLMFlow;
        cached = true;
        llmStatus = "cache_hit";
      } catch (e) {
        cached = false;
      }
    }

    if (!cached) {
      // Derive flow type from description
      const descLower = description.toLowerCase();
      let flowType: "workout" | "body" | "business" | "generic" = "generic";
      if (/(workout|gym|lift|training|practice drums|practice guitar)/i.test(description)) {
        flowType = "workout";
      } else if (/(hair|skin|scalp|body care|detox)/i.test(description)) {
        flowType = "body";
      } else if (/(business|startup|marketing|sales|clients|leads)/i.test(description)) {
        flowType = "business";
      }

      // Build messages from your existing prompt pieces
      const sys = buildSystemPrompt();
      
      // Calculate date range days
      const start = new Date(startDate);
      const end = new Date(endDate);
      const dateRangeDays = Math.floor(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
      
      // Calculate max_tokens based on date range (roughly 150-200 tokens per day)
      // Minimum 3500 for short flows, scale up for longer flows
      const calculatedMaxTokens = Math.max(3500, Math.ceil(dateRangeDays * 200));
      // Cap at 16000 (gpt-4o-mini's max output tokens)
      const maxTokens = Math.min(calculatedMaxTokens, 16000);
      
      const userPrompt =
        `FLOW_TYPE: ${flowType}\n\nUSER_DESCRIPTION: ${description}\n\nDATE_RANGE: ${startDate} → ${endDate}\n\n${
          flowName ? `Flow name: ${flowName}\n` : ""
        }${timezone ? `Timezone: ${timezone}\n` : ""}${
          source_text ? `\nSOURCE_TEXT:\n${source_text}\n` : ""
        }\n\nDate range: ${dateRangeDays} days (${startDate} to ${endDate}).
Generate exactly ${dateRangeDays} notes, one per calendar day in this range. Each note must have a detailed "details" field: no placeholders, no generic summaries.

Generate a JSON flow strictly following the schema.`.trim();

      const aiResp = await generateWithOpenAI({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
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

      // Extract tokens and model from OpenAI response
      tokensIn = aiResp.tokensIn;
      tokensOut = aiResp.tokensOut;
      modelUsed = aiResp.modelUsed;

      // Check if response was truncated
      if (aiResp.finishReason === "length") {
        console.error("⚠️ LLM response was truncated (hit token limit)");
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "LLM_TRUNCATED", 
            message: `Response was too long for ${dateRangeDays} days. Try a shorter date range or the model may need more tokens.` 
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

      // Parse the content
      let text = aiResp.content;
      text = stripCodeFences(text);

      // Log raw LLM content for debugging (truncate if very long)
      const contentPreview = aiResp.content.length > 5000 
        ? aiResp.content.substring(0, 5000) + "...[truncated for logging]"
        : aiResp.content;
      console.error("🔍 LLM RAW CONTENT:", contentPreview);
      console.error("🔍 LLM CONTENT LENGTH:", aiResp.content.length, "chars");
      console.error("🔍 LLM TOKENS OUT:", tokensOut, "max_tokens:", maxTokens);
      console.error("🔍 LLM FINISH REASON:", aiResp.finishReason);

      try {
        llmFlow = JSON.parse(text) as LLMFlow;
      } catch (err) {
        console.error("❌ JSON parse error:", err);
        // Try to extract JSON from truncated response
        const jsonMatch = text.match(/\{[\s\S]*\}/m);
        if (jsonMatch) {
          try {
            llmFlow = JSON.parse(jsonMatch[0]) as LLMFlow;
            console.error("⚠️ Used regex-extracted JSON (may be incomplete)");
          } catch (parseErr) {
            console.error("❌ Regex-extracted JSON also failed:", parseErr);
            llmFlow = null;
          }
        } else {
          llmFlow = null;
        }
      }

      // Log parsed LLM JSON
      if (llmFlow) {
        const notesCount = llmFlow.notes?.length ?? 0;
        console.error("🔍 LLM PARSED JSON: flowName='${llmFlow.flowName}', notesCount=${notesCount}");
        if (notesCount < dateRangeDays) {
          console.error(`⚠️ WARNING: Expected ${dateRangeDays} notes but got ${notesCount}`);
        }
      }

      if (!llmFlow) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "LLM_PARSE_ERROR", 
            message: `Model did not return valid JSON. Response length: ${aiResp.content.length} chars, tokens: ${tokensOut}/${maxTokens}. ${aiResp.finishReason === "length" ? "Response was truncated." : ""}` 
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

      costCents = calculateCostCents(modelUsed, tokensIn, tokensOut);
      llmStatus = "success";
    }

    if (!llmFlow) {
      return new Response(
        JSON.stringify({ error: "Failed to obtain valid LLM output" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // Transform LLM output to ParsedFlow
    const startDateStr = startDate;
    const parsedFlow = transformLLMFlowToParsedFlow(llmFlow, startDateStr);

    // Log parsed flow for debugging
    console.error("🔍 PARSED FLOW:", JSON.stringify(parsedFlow, null, 2));

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
    const validation = validateParsedFlow(parsedFlow);
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

    console.error("╔═══════════════════════════════════════╗");
    console.error("║   PRE-INSERT DIAGNOSTIC               ║");
    console.error("╚═══════════════════════════════════════╝");

    console.error("🎨 Color Selection:");
    console.error("   Request body color:", flowColor, "(type:", typeof flowColor, ")");
    console.error("   Final Color:", finalColor, "(ARGB int)");
    console.error("   Source:", finalColor === DEFAULT_COLOR ? "Default" : "Client");

    // Check ai_metadata validity
    console.error("📦 ai_metadata:");
    try {
      const jsonStr = JSON.stringify(ai_metadata);
      console.error("   Valid JSON ✅");
      console.error("   Size:", jsonStr.length, "chars");
    } catch (e) {
      console.error("   INVALID JSON ❌:", e.message);
    }

    // ✅ REFACTOR: No DB insertions - Flutter will create flow and events
    // Edge function now only returns the generated content

    // Log generation
    const duration_ms = Date.now() - startTime;
    const logRow = {
      user_id: userId,
      flow_id: null,  // ✅ Flutter creates the flow, not Edge
      input_hash,
      user_prompt_raw: description,
      model_used: modelUsed,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_cents: costCents,
      duration_ms,
      llm_status: llmStatus,
    };

    const { error: logErr } = await supabaseAdmin
      .from("flow_generation_logs")
      .insert(logRow);
    if (logErr) {
      console.error("Failed to insert flow_generation_logs:", logErr);
    }

    // Cache result (cache raw llmFlow, not parsedFlow)
    if (!cached && llmFlow) {
      const cacheRow = {
        input_hash,
        user_prompt: description,
        response_json: llmFlow,
      };
      const { error: cacheInsertErr } = await supabaseAdmin
        .from("flow_generation_cache")
        .insert(cacheRow);
      if (cacheInsertErr) {
        console.error(
          "Failed to insert into flow_generation_cache:",
          cacheInsertErr
        );
      }
    }

    // Convert color integer back to hex string for response
    // finalColor is RGB int like 0x4dd0e1 (no alpha channel, matches DEFAULT_COLOR format)
    // Pad to 6 digits and add # prefix
    const rgbHex = finalColor.toString(16).padStart(6, '0');
    const colorHex = '#' + rgbHex;

    // ✅ REFACTOR: Return only the generated content (no DB IDs)
    // Flutter will create the flow and events using this data
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
