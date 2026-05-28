create or replace view public.inbox_share_items_filtered
with (security_invoker = true) as
select
  fs.id as share_id,
  'flow'::text as kind,
  fs.recipient_id,
  fs.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  (fs.id)::text as payload_id,
  coalesce((fs.payload_json ->> 'name'::text), ''::text) as title,
  (fs.flow_id)::text as original_flow_id,
  fs.created_at,
  fs.viewed_at,
  fs.imported_at,
  fs.deleted_at,
  fs.suggested_schedule,
  null::text as event_date,
  fs.payload_json,
  null::text as response_status,
  null::timestamp with time zone as responded_at
from public.flow_shares fs
left join public.profiles s on fs.sender_id = s.id
left join public.profiles r on fs.recipient_id = r.id
where fs.recipient_id is not null
  and fs.status = any (array['sent'::text, 'viewed'::text, 'imported'::text])
  and fs.deleted_at is null
union all
select
  es.id as share_id,
  'event'::text as kind,
  es.recipient_id,
  es.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  (es.id)::text as payload_id,
  coalesce(
    es.payload_json ->> 'title',
    es.payload_json ->> 'name',
    ''::text
  ) as title,
  null::text as original_flow_id,
  es.created_at,
  es.viewed_at,
  es.imported_at,
  es.deleted_at,
  null::jsonb as suggested_schedule,
  es.payload_json ->> 'starts_at' as event_date,
  es.payload_json,
  es.response_status,
  es.responded_at
from public.event_shares es
left join public.profiles s on es.sender_id = s.id
left join public.profiles r on es.recipient_id = r.id
where es.recipient_id is not null
  and es.status = any (array['sent'::text, 'viewed'::text, 'imported'::text])
  and es.deleted_at is null
union all
select
  scn.id as share_id,
  'calendar'::text as kind,
  scn.recipient_id,
  scn.actor_id as sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  (scn.calendar_id)::text as payload_id,
  coalesce(nullif(btrim(scn.title), ''), 'Calendar update') as title,
  null::text as original_flow_id,
  scn.created_at,
  scn.viewed_at,
  null::timestamp with time zone as imported_at,
  scn.deleted_at,
  null::jsonb as suggested_schedule,
  scn.payload_json ->> 'starts_at' as event_date,
  coalesce(scn.payload_json, '{}'::jsonb) || jsonb_build_object(
    'notification_kind',
    coalesce(
      nullif(
        btrim(
          coalesce(
            scn.payload_json ->> 'notification_kind',
            scn.payload_json ->> 'calendar_kind',
            scn.kind
          )
        ),
        ''
      ),
      scn.kind
    ),
    'calendar_id',
    scn.calendar_id::text,
    'body',
    scn.body
  ) as payload_json,
  null::text as response_status,
  null::timestamp with time zone as responded_at
from public.shared_calendar_notifications scn
left join public.profiles s on scn.actor_id = s.id
left join public.profiles r on scn.recipient_id = r.id
where scn.deleted_at is null;

notify pgrst, 'reload schema';
