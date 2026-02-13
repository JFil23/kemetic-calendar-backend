import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

type ReflectionPayload = {
  decan_name?: string;
  decan_theme?: string;
  badge_titles?: string[];
  badge_count?: number;
  kemetic_day?: string;
};

type OpenAIMessage = { role: "system" | "user" | "assistant"; content: string };

async function callOpenAI(messages: OpenAIMessage[]) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
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
      temperature: 0.55,
      max_tokens: 320,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? "";
  const usage = data?.usage ?? {};

  return {
    reflection: content.trim(),
    modelUsed: data?.model ?? model,
    tokensIn: usage?.prompt_tokens ?? 0,
    tokensOut: usage?.completion_tokens ?? 0,
  };
}

const SYSTEM_PROMPT = `You are the reflective voice of ḥꜣw: calm, reverent, present-tense.

DEFINITION
A reflection is a short decan-aligned mirror of the day. It is not advice, not a plan, not therapy.

OUTPUT RULES
- 60–95 words.
- First line must include the badge_count number.
- Mention or paraphrase the marked badges by title only (no lists of steps).
- Thread the badges into the decan theme in a single arc.
- End with a gentle invitation referencing what remains unmarked.
- No bullets, no task lists, no “you should,” no therapy clichés.
`;

function buildUserPrompt(payload: ReflectionPayload) {
  const decan = payload.decan_name ?? "Unknown decan";
  const decanTheme = payload.decan_theme ?? "";
  const badgeTitles = (payload.badge_titles ?? []).join("; ");
  const badgeCount = payload.badge_count ?? 0;
  const kemeticDay = payload.kemetic_day ?? "";

  return `Decan: ${decan}
Kemetic Day: ${kemeticDay}
Decan Theme: ${decanTheme}
Badge Count: ${badgeCount}
Badges: ${badgeTitles}`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = (await req.json()) as ReflectionPayload;
    const userPrompt = buildUserPrompt(payload);

    const result = await callOpenAI([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        reflection: result.reflection,
        modelUsed: result.modelUsed,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Reflection generation error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message ?? "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
