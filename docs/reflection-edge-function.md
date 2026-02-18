# Reflection Edge Function Snapshot

## Function
- Name: `ai_generate_reflection`
- Scope: single decan (10-day window) reflections; Anthropic first, deterministic fallback

## Invocation
- Client uses Supabase Functions invoke: `_sb.functions.invoke('ai_generate_reflection', body: payload)`
- Payload includes `user_id`, `decan_name`, `decan_theme`, `decan_start`, `decan_end`, `include_history`, optional `badges`, `persist`

## Required environment
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` (LLM path); optional `ANTHROPIC_MODEL`

## Deploy
- Project: `vrbubwqapwkxxexkwkgu`
- Commands:
  - Link (once per clone): `supabase link` (select project above)
  - Deploy: `supabase functions deploy ai_generate_reflection`

## Notes
- History summaries include badge snippets; prompt enforces decan-only scope and concise (80–120 words) badge-specific reflections.
- Backup copy stored at `backup/ai_generate_reflection_20260218/index.ts`.
