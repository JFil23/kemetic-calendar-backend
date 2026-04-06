/**
 * Edge Function: translate_memory_text
 *
 * Required secrets (Project Settings → Functions → Secrets):
 * - SUPABASE_URL (e.g., https://vrbubwqapwkxxexkwkgu.supabase.co)
 * - SUPABASE_SERVICE_ROLE_KEY (service role)
 * - OPENAI_API_KEY
 *
 * Deploy:
 *   supabase functions deploy translate_memory_text --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
// Seeded source-of-truth for memory palace anchors (used for both seeding and in-function fallback lookups)
// Note: This file is bundled with the Edge Function to improve resilience while the DB is being seeded.
import memoryPalaceSeed from "../../seeds/memory_palace_seed_v1.json" assert { type: "json" };

type OpenAIChatResponse = {
  choices: { message: { content: string } }[];
};

type DictionaryRow = {
  id: string;
  glyph: string | null;
  unicode: string | null;
  transliteration: string | null;
  gardiner_code: string | null;
  english_glosses: string[] | null;
  semantic_tags: string[] | null;
  key: string | null;
  primary_gloss: string | null;
  anchor_type: string | null;
  imageability_score: number | null;
  phonetic_flexibility_score: number | null;
  mnemonic_aliases: string[] | null;
  render_mode: string | null;
  image_asset_key: string | null;
  image_prompt: string | null;
  visual_description: string | null;
  source_confidence: string | null;
  is_visual_anchor: boolean | null;
};

type LociResponse = {
  memory_phrase: string;
  scene: string;
  tokens: string[];
};

type MemorySeedEntry = {
  key: string;
  gardiner_code: string | null;
  unicode: string | null;
  transliteration: string | null;
  primary_gloss: string | null;
  english_glosses: string[] | null;
  semantic_tags: string[] | null;
  is_visual_anchor: boolean | null;
  anchor_type: string | null;
  imageability_score: number | null;
  phonetic_flexibility_score: number | null;
  mnemonic_aliases: string[] | null;
  render_mode: string | null;
  image_asset_key: string | null;
  image_prompt: string | null;
  visual_description: string | null;
  source_confidence: string | null;
};

type MemorySeed = {
  version: string;
  description?: string;
  entries: MemorySeedEntry[];
  mnemonic_aliases?: { source_token: string; aliases: string[] }[];
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const MEMORY_SEED = memoryPalaceSeed as MemorySeed;
const SEED_ENTRIES: DictionaryRow[] = (MEMORY_SEED.entries || []).map((e) => ({
  id: e.key,
  key: e.key,
  glyph: e.glyph ?? null,
  unicode: e.unicode ?? null,
  transliteration: e.transliteration ?? null,
  gardiner_code: e.gardiner_code ?? null,
  english_glosses: e.english_glosses ?? null,
  primary_gloss: e.primary_gloss ?? null,
  semantic_tags: e.semantic_tags ?? null,
  anchor_type: e.anchor_type ?? null,
  imageability_score: e.imageability_score ?? null,
  phonetic_flexibility_score: e.phonetic_flexibility_score ?? null,
  mnemonic_aliases: e.mnemonic_aliases ?? null,
  render_mode: e.render_mode ?? null,
  image_asset_key: e.image_asset_key ?? null,
  image_prompt: e.image_prompt ?? null,
  visual_description: e.visual_description ?? null,
  source_confidence: e.source_confidence ?? null,
  is_visual_anchor: e.is_visual_anchor ?? null,
}));

const SEED_TOKEN_ALIASES: Record<string, string[]> = {};
for (const alias of MEMORY_SEED.mnemonic_aliases ?? []) {
  SEED_TOKEN_ALIASES[alias.source_token.toLowerCase()] = (alias.aliases || []).map((a) => a.toLowerCase());
}

const LOCI_SYSTEM_PROMPT = `You are a mnemonic engine that ONLY creates vivid loci-style memory images. RULES:
- Do NOT use or mention Medu Neter, hieroglyphs, or Egyptian translation.
- Focus purely on phonetic / memory hooks.
- Keep scenes short, concrete, weird, and memorable.
- Output structured JSON only, with keys: memory_phrase, scene, tokens.
- Tokens must be 2-5 imageable nouns/actions/sound-based units.
Example output:
{
  "memory_phrase": "Why mix a bee?",
  "scene": "A confused man asking why while mixing a bowl full of bees.",
  "tokens": ["why", "mix", "bee"]
}`;

function maskKey(key: string) {
  if (!key) return "<empty>";
  if (key.length <= 10) return `${key} (len=${key.length})`;
  return `${key.substring(0, 6)}...${key.substring(key.length - 4)} (len=${key.length})`;
}

const LETTER_HOMOPHONES: Record<string, string> = {
  why: "y",
  bee: "b",
  sea: "c",
  see: "c",
  cue: "q",
  you: "u",
  are: "r",
  ar: "r",
  jay: "j",
  kay: "k",
  aye: "i",
  eye: "i",
  oh: "o",
  ex: "x",
  tea: "t",
  tee: "t",
  pee: "p",
  pea: "p",
  em: "m",
  en: "n",
  eff: "f",
  el: "l",
  ell: "l",
  ess: "s",
  dee: "d",
  zed: "z",
  zee: "z",
};

const LETTER_TO_MNEMONIC: Record<string, string[]> = {
  y: ["why", "question"],
  b: ["bee", "be"],
  m: ["m", "owl", "mix"],
  x: ["x", "unknown"],
  c: ["sea", "see"],
};

const TOKEN_SYNONYM_VARIANTS: Record<string, string[]> = {
  mix: ["unite", "combine", "m", "x"],
  mx: ["mix", "m", "x"],
  blend: ["unite", "combine"],
  combine: ["unite"],
  add: ["unite"],
  plus: ["unite"],
  sum: ["unite"],
  equal: ["balance"],
  equals: ["balance"],
};

const MNEMONIC_ALIASES: Record<string, string[]> = {
  why: ["wake", "ask", "question", "raised hand", "unknown"],
  mix: ["mix", "stir", "blend", "bowl", "spoon", "combine"],
  bee: ["bee", "honeybee"],
};

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseJsonFlexible<T>(content: string): T {
  const attempt = (text: string) => {
    const trimmed = text.trim();
    return JSON.parse(trimmed) as T;
  };

  const candidates: string[] = [];
  candidates.push(content);
  candidates.push(content.replace(/```json/gi, "").replace(/```/g, "").trim());

  // handle stray text before/after JSON object
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(content.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      // normalize single quotes in arrays/objects
      const normalized = candidate.trim().startsWith("{") || candidate.trim().startsWith("[")
        ? candidate.replace(/'/g, '"')
        : candidate;
      // remove trailing commas before closing braces/brackets
      const noTrailingCommas = normalized.replace(/,(\s*[}\]])/g, "$1");
      // quote bare keys if any slipped through
      const quotedKeys = noTrailingCommas.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
      return attempt(quotedKeys);
    } catch {
      continue;
    }
  }

  throw new Error("Failed to parse JSON from OpenAI response");
}

async function generateLociMnemonic(inputText: string): Promise<LociResponse> {
  const payload = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: LOCI_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create a short loci mnemonic. Input: ${inputText}.
Return only JSON with memory_phrase, scene, and 2-5 tokens.
Tokens must anchor to the phonetic sounds of the input (letters, symbols, operators) so they can later be mapped, e.g., "why" for "y", "mix" for "m x", "bee" for "b".
Do not mention Medu Neter or hieroglyphs.`,
      },
    ],
    max_tokens: 200,
    temperature: 0.6,
    response_format: { type: "json_object" },
  };

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  try {
    const data = (await res.json()) as OpenAIChatResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonFlexible<LociResponse>(content);

    const tokens = (parsed.tokens || []).map((t) => String(t).trim()).filter((t) => t.length > 0);
    if (tokens.length === 0) {
      throw new Error("Invalid mnemonic response: missing tokens");
    }

    return {
      memory_phrase: parsed.memory_phrase?.toString().trim() ?? "",
      scene: parsed.scene?.toString().trim() ?? "",
      tokens,
    };
  } catch (e) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      msg: "loci parse fallback",
      error: e instanceof Error ? e.message : String(e),
    }));
    const rawTokens = inputText.toLowerCase().match(/[a-z]+|[0-9]+|[=+*/-]/g) ?? ["unknown"];
    const tokens = rawTokens.slice(0, 5).map((t) => {
      if (t === "=") return "equals";
      if (t === "+") return "plus";
      if (t === "-") return "minus";
      if (t === "*") return "times";
      if (t === "/") return "divide";
      return t;
    });
    return {
      memory_phrase: `Remember: ${inputText}`,
      scene: `Memorize: ${inputText}`,
      tokens,
    };
  }
}

function getTokenVariants(token: string): string[] {
  const t = token.trim();
  const lc = t.toLowerCase();
  const variants = new Set<string>([t, lc]);

  if (LETTER_HOMOPHONES[lc]) variants.add(LETTER_HOMOPHONES[lc]);

  if (TOKEN_SYNONYM_VARIANTS[lc]) {
    TOKEN_SYNONYM_VARIANTS[lc].forEach((v) => variants.add(v));
  }
  for (const [key, vals] of Object.entries(TOKEN_SYNONYM_VARIANTS)) {
    if (lc.includes(key)) vals.forEach((v) => variants.add(v));
  }

  if (MNEMONIC_ALIASES[lc]) {
    MNEMONIC_ALIASES[lc].forEach((v) => variants.add(v));
  }
  if (SEED_TOKEN_ALIASES[lc]) {
    SEED_TOKEN_ALIASES[lc].forEach((v) => variants.add(v));
  }
  if (lc.length === 1 && LETTER_TO_MNEMONIC[lc]) {
    LETTER_TO_MNEMONIC[lc].forEach((v) => variants.add(v));
  }

  return Array.from(variants).map((v) => v.trim()).filter((v) => v.length > 0);
}

async function lookupGlyphCandidates(token: string, variants: string[]): Promise<DictionaryRow[]> {
  const seen = new Set<string>();
  const results: DictionaryRow[] = [];
  const add = (rows: DictionaryRow[] | null | undefined) => {
    if (!rows) return;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      results.push(row);
    }
  };

  const baseSelect = () =>
    supabase.from("medu_dictionary").select("*");

  for (const variant of variants) {
    const val = variant.trim();
    if (!val) continue;

    const glossRes = await baseSelect().contains("english_glosses", [val]).limit(20);
    if (glossRes.error) throw new Error(glossRes.error.message);
    add(glossRes.data as DictionaryRow[]);

    const tagsRes = await baseSelect().contains("semantic_tags", [val]).limit(20);
    if (tagsRes.error) throw new Error(tagsRes.error.message);
    add(tagsRes.data as DictionaryRow[]);

    const translitRes = await baseSelect().ilike("transliteration", `%${val}%`).limit(20);
    if (translitRes.error) throw new Error(translitRes.error.message);
    add(translitRes.data as DictionaryRow[]);
  }

  const variantSet = new Set(variants.map((v) => v.toLowerCase()));
  for (const entry of SEED_ENTRIES) {
    const glosses = entry.english_glosses?.map((g) => g.toLowerCase()) ?? [];
    const tags = entry.semantic_tags?.map((t) => t.toLowerCase()) ?? [];
    const aliases = entry.mnemonic_aliases?.map((a) => a.toLowerCase()) ?? [];
    const anchor = entry.anchor_type?.toLowerCase() ?? "";

    const match =
      glosses.some((g) => variantSet.has(g) || Array.from(variantSet).some((v) => g.includes(v) || v.includes(g))) ||
      tags.some((t) => variantSet.has(t)) ||
      aliases.some((a) => variantSet.has(a)) ||
      (anchor && variantSet.has(anchor));

    if (match) add([entry]);
  }

  return results;
}

function scoreGlyphCandidate(token: string, candidate: DictionaryRow, variants: string[]): number {
  const lc = token.toLowerCase();
  const glosses = candidate.english_glosses?.map((g) => g.toLowerCase()) ?? [];
  const tags = candidate.semantic_tags?.map((t) => t.toLowerCase()) ?? [];
  const transliteration = candidate.transliteration?.toLowerCase() ?? "";
  const mnemonicAliases = candidate.mnemonic_aliases?.map((a) => a.toLowerCase()) ?? [];
  const anchor = candidate.anchor_type?.toLowerCase() ?? "";

  let score = 0;

  const variantSet = new Set<string>(variants.map((v) => v.toLowerCase()));

  const visualTags = [
    "animal",
    "object",
    "action",
    "person",
    "human",
    "figure",
    "scene",
    "visual",
    "memory",
    "pictorial",
    "body",
    "hand",
    "gesture",
    "tool",
    "food",
    "vessel",
    "bowl",
    "spoon",
    "bee",
  ];
  const isVisual = tags.some((t) => visualTags.includes(t));
  if (candidate.is_visual_anchor) score += 12;
  if (isVisual) score += 6;
  if (["animal", "person", "gesture", "tool", "container", "action_scene", "scene", "body_part", "action", "nature", "object", "plant"].includes(anchor)) {
    score += 8;
  }

  const glossExact = glosses.some((g) => variantSet.has(g));
  const glossPartial = glosses.some((g) => Array.from(variantSet).some((v) => g.includes(v) || v.includes(g)));
  if (glossExact) score += 8;
  else if (glossPartial) score += 4;

  const tagExact = tags.some((t) => variantSet.has(t));
  const tagPartial = tags.some((t) => Array.from(variantSet).some((v) => t.includes(v) || v.includes(t)));
  if (tagExact) score += 5;
  else if (tagPartial) score += 3;

  if (transliteration && variantSet.has(transliteration)) score += 3;
  else if (transliteration && Array.from(variantSet).some((v) => transliteration.includes(v))) score += 1;

  if (candidate.unicode && candidate.unicode.length > 1) score += 1;
  if (candidate.primary_gloss && variantSet.has(candidate.primary_gloss.toLowerCase())) score += 4;
  if (mnemonicAliases.some((a) => variantSet.has(a))) score += 6;
  else if (mnemonicAliases.some((a) => Array.from(variantSet).some((v) => a.includes(v) || v.includes(a)))) score += 3;

  if (typeof candidate.imageability_score === "number") score += Math.min(candidate.imageability_score, 10) * 0.6;
  if (typeof candidate.phonetic_flexibility_score === "number") score += Math.min(candidate.phonetic_flexibility_score, 10) * 0.2;
  if ((candidate.source_confidence ?? "").toLowerCase() === "grounded") score += 2;
  if ((candidate.render_mode ?? "").toLowerCase() === "asset") score += 2;
  if (candidate.image_asset_key) score += 2;

  // Penalize placeholder/phonetic-only rows when no strong image cues
  const isSingleLetter = transliteration.length === 1 || (candidate.unicode?.length === 1 && !candidate.english_glosses?.some((g) => g.length > 1));
  const isPhoneticTag = tags.includes("phonetic");
  if (isSingleLetter && !isVisual) score -= 8;
  if (isPhoneticTag && !isVisual) score -= 4;

  return score;
}

async function buildSequenceFromTokens(tokens: string[]) {
  const seq: {
    token: string;
    glyph: string;
    unicode: string;
    concept: string;
    dictionary_id: string | null;
    gardiner_code?: string | null;
    image_asset_key?: string | null;
    render_mode?: string | null;
    visual_description?: string | null;
    image_prompt?: string | null;
  }[] = [];

  for (const token of tokens) {
    try {
      const variants = getTokenVariants(token);
      const candidates = await lookupGlyphCandidates(token, variants);
      let best: DictionaryRow | null = null;
      let bestScore = -Infinity;

      for (const cand of candidates) {
        const s = scoreGlyphCandidate(token, cand, variants);
        if (s > bestScore) {
          bestScore = s;
          best = cand;
        }
      }

      if (best) {
        const glyphVal = best.glyph || best.unicode || best.transliteration || token;
        seq.push({
          token,
          glyph: glyphVal,
          unicode: best.unicode || best.glyph || best.transliteration || token,
          concept: best.primary_gloss || best.english_glosses?.[0] || best.transliteration || token,
          dictionary_id: best.id,
          gardiner_code: best.gardiner_code,
          image_asset_key: best.image_asset_key,
          render_mode: best.render_mode,
          visual_description: best.visual_description,
          image_prompt: best.image_prompt,
        });
      } else {
        seq.push({ token, glyph: token, unicode: token, concept: token, dictionary_id: null, gardiner_code: null });
      }
    } catch (e) {
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        msg: "glyph lookup error",
        token,
        error: e instanceof Error ? e.message : String(e),
      }));
      seq.push({ token, glyph: token, unicode: token, concept: token, dictionary_id: null, gardiner_code: null });
    }
  }

  return seq;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const start = Date.now();
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    msg: "translate_memory_text start",
    hasUrl: !!SUPABASE_URL,
    hasServiceRole: !!SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleFingerprint: maskKey(SUPABASE_SERVICE_ROLE_KEY ?? ""),
    hasOpenAiKey: OPENAI_API_KEY.length > 0,
  }));

  try {
    const body = await req.json();
    const inputText = (body?.input_text as string | undefined)?.trim() ?? "";
    if (!inputText) {
      return new Response(JSON.stringify({ error: "input_text required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const loci = await generateLociMnemonic(inputText);
    const sequence = await buildSequenceFromTokens(loci.tokens);

    console.log(JSON.stringify({
      at: new Date().toISOString(),
      msg: "translate_memory_text complete",
      tokensCount: loci.tokens.length,
      durationMs: Date.now() - start,
    }));

    return new Response(JSON.stringify({
      source_text: inputText,
      memory_phrase: loci.memory_phrase,
      scene: loci.scene,
      tokens: loci.tokens,
      sequence,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      msg: "translate_memory_text error",
      error: e instanceof Error ? e.message : String(e),
      stack: e?.stack,
    }));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
