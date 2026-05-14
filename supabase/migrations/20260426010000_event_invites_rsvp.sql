alter table public.event_shares
  add column if not exists response_status text not null default 'no_response',
  add column if not exists responded_at timestamp with time zone;

alter table public.event_shares
  drop constraint if exists event_shares_response_status_check;

alter table public.event_shares
  add constraint event_shares_response_status_check
    check (
      response_status = any (
        array[
          'no_response'::text,
          'accepted'::text,
          'declined'::text,
          'maybe'::text
        ]
      )
    );

update public.event_shares es
set payload_json = jsonb_build_object(
      'event_id', ue.id,
      'title', ue.title,
      'detail', ue.detail,
      'location', ue.location,
      'starts_at', ue.starts_at,
      'ends_at', ue.ends_at,
      'all_day', ue.all_day
    )
from public.user_events ue
where es.event_id = ue.id
  and (
    es.payload_json is null
    or es.payload_json = '{}'::jsonb
    or coalesce(es.payload_json ->> 'title', '') = ''
  );

update public.event_shares
set response_status = 'accepted',
    responded_at = coalesce(responded_at, imported_at, viewed_at, created_at)
where imported_at is not null
  and response_status = 'no_response';

create index if not exists idx_event_shares_pending_rsvp
  on public.event_shares (recipient_id, response_status, created_at desc)
  where recipient_id is not null and deleted_at is null;

drop view if exists public.inbox_unread_count_filtered;
drop view if exists public.inbox_share_items_filtered;

create view public.inbox_share_items_filtered as
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
  and es.deleted_at is null;

create view public.inbox_unread_count_filtered as
select count(*) as count
from public.inbox_share_items_filtered
where viewed_at is null
  and deleted_at is null;
