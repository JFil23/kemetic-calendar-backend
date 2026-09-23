update public.flow_posts fp
set ai_metadata = jsonb_set(
  coalesce(fp.ai_metadata, '{}'::jsonb),
  '{payload}',
  jsonb_set(
    coalesce(fp.ai_metadata -> 'payload', '{}'::jsonb),
    '{appearance}',
    source_flow.appearance,
    true
  ),
  true
)
from public.flows source_flow
where fp.id = '4fb7764a-02ee-48f9-b554-06b4ed53023f'::uuid
  and fp.user_id = '27d63169-a28a-4550-a0a0-8fee0e8e7b95'::uuid
  and fp.name = 'Daily Math Visuals: 90-Day Visual Math Ladder.'
  and fp.ai_metadata #> '{payload,appearance}' is null
  and source_flow.id = 967
  and source_flow.user_id = fp.user_id
  and source_flow.name = fp.name
  and source_flow.appearance is not null
  and source_flow.appearance <> '{}'::jsonb;
