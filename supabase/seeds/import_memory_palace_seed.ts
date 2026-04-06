#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const seedPath = new URL("./memory_palace_seed_v1.json", import.meta.url);
const seedJson = JSON.parse(await Deno.readTextFile(seedPath));
const entries = seedJson.entries as any[];

function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

for (const batch of chunk(entries, 50)) {
  const payload = batch.map((e) => ({
    key: e.key,
    gardiner_code: e.gardiner_code ?? null,
    glyph: e.glyph ?? null,
    unicode: e.unicode ?? null,
    transliteration: e.transliteration ?? null,
    primary_gloss: e.primary_gloss ?? null,
    english_glosses: e.english_glosses ?? null,
    semantic_tags: e.semantic_tags ?? null,
    is_visual_anchor: e.is_visual_anchor ?? null,
    anchor_type: e.anchor_type ?? null,
    imageability_score: e.imageability_score ?? null,
    phonetic_flexibility_score: e.phonetic_flexibility_score ?? null,
    mnemonic_aliases: e.mnemonic_aliases ?? null,
    render_mode: e.render_mode ?? null,
    image_asset_key: e.image_asset_key ?? null,
    image_prompt: e.image_prompt ?? null,
    visual_description: e.visual_description ?? null,
    source_confidence: e.source_confidence ?? null,
  }));

  const { error } = await supabase
    .from("medu_dictionary")
    .upsert(payload, { onConflict: "key" });

  if (error) {
    console.error("Upsert error", error);
    Deno.exit(1);
  }
  console.log(`Upserted batch of ${payload.length}`);
}

console.log("Memory Palace seed import complete.");
