create or replace view public.share_filing_items_client
with (security_invoker = true) as
with flow_share_rows as (
  select
    fs.id::text as share_id,
    'flow'::text as kind,
    fs.recipient_id,
    fs.sender_id,
    s.handle as sender_handle,
    s.display_name as sender_name,
    s.avatar_url as sender_avatar,
    r.handle as recipient_handle,
    r.display_name as recipient_display_name,
    r.avatar_url as recipient_avatar_url,
    fs.id::text as payload_id,
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
    null::timestamp with time zone as responded_at,
    imported_flow.id as imported_flow_id,
    imported_flow.lifecycle as imported_flow_lifecycle,
    imported_flow.visible_in_active_list as imported_flow_visible_active,
    imported_flow.visible_in_saved_list as imported_flow_visible_saved,
    case
      when fs.sender_id = auth.uid() then 'sent'
      when fs.recipient_id = auth.uid() then 'received'
      else 'other'
    end as filing_direction,
    case
      when fs.deleted_at is not null then 'deleted'
      when fs.imported_at is not null
        or coalesce(fs.status, 'pending') = 'imported'
        then 'imported'
      when fs.viewed_at is not null
        or coalesce(fs.status, 'pending') = 'viewed'
        then 'viewed'
      else 'pending'
    end as filing_lifecycle,
    'shared_flow'::text as filing_item_kind
  from public.flow_shares fs
  left join public.profiles s on fs.sender_id = s.id
  left join public.profiles r on fs.recipient_id = r.id
  left join lateral (
    select
      candidate.id,
      case
        when candidate.is_deleted then 'deleted'::text
        when coalesce(candidate.is_reminder, false) then 'inactive'::text
        when candidate.flow_record_kind = 'hiddenHelper' then 'inactive'::text
        when not coalesce(candidate.active, false) then 'inactive'::text
        when candidate.schedule_open = false then 'inactive'::text
        else 'active'::text
      end as lifecycle,
      (
        not candidate.is_deleted
        and not coalesce(candidate.is_reminder, false)
        and candidate.flow_record_kind <> 'hiddenHelper'
        and coalesce(candidate.active, false)
        and candidate.schedule_open
      ) as visible_in_active_list,
      candidate.visible_in_saved_list,
      candidate.created_at
    from (
      select
        f.id,
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes,
        f.end_date,
        f.created_at,
        coalesce(f.is_saved, false) or fsaves.flow_id is not null
          as visible_in_saved_list,
        public.flow_record_kind(
          f.active,
          f.is_hidden,
          f.is_reminder,
          f.notes
        ) as flow_record_kind,
        public.flow_is_schedule_open(
          f.end_date,
          public._get_user_timezone(f.user_id)
        ) as schedule_open,
        public.flow_is_deleted_state(
          f.active,
          f.is_hidden,
          f.notes
        ) as is_deleted
      from public.flows f
      join public.shared_calendars sc
        on sc.id = f.calendar_id
       and sc.deleted_at is null
      left join public.flow_saves fsaves
        on fsaves.flow_id = f.id
       and fsaves.user_id = auth.uid()
      where f.share_id = fs.id
        and f.user_id = auth.uid()
        and exists (
          select 1
          from public.shared_calendar_members scm
          where scm.calendar_id = f.calendar_id
            and scm.user_id = auth.uid()
            and scm.status = 'accepted'
        )
    ) candidate
    order by
      visible_in_active_list desc,
      visible_in_saved_list desc,
      created_at desc
    limit 1
  ) imported_flow on true
  where fs.recipient_id is not null
    and (fs.recipient_id = auth.uid() or fs.sender_id = auth.uid())
    and fs.status = any (
      array['sent'::text, 'viewed'::text, 'imported'::text, 'public'::text]
    )
),
event_share_rows as (
  select
    es.id::text as share_id,
    'event'::text as kind,
    es.recipient_id,
    es.sender_id,
    s.handle as sender_handle,
    s.display_name as sender_name,
    s.avatar_url as sender_avatar,
    r.handle as recipient_handle,
    r.display_name as recipient_display_name,
    r.avatar_url as recipient_avatar_url,
    es.id::text as payload_id,
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
    es.responded_at,
    null::bigint as imported_flow_id,
    null::text as imported_flow_lifecycle,
    false as imported_flow_visible_active,
    false as imported_flow_visible_saved,
    case
      when es.sender_id = auth.uid() then 'sent'
      when es.recipient_id = auth.uid() then 'received'
      else 'other'
    end as filing_direction,
    case
      when es.deleted_at is not null then 'deleted'
      when coalesce(es.response_status, 'no_response') = 'accepted'
        then 'accepted'
      when coalesce(es.response_status, 'no_response') = 'declined'
        then 'declined'
      when coalesce(es.response_status, 'no_response') = 'maybe'
        then 'maybe'
      else 'pending'
    end as filing_lifecycle,
    'event_invite'::text as filing_item_kind
  from public.event_shares es
  left join public.profiles s on es.sender_id = s.id
  left join public.profiles r on es.recipient_id = r.id
  where es.recipient_id is not null
    and (es.recipient_id = auth.uid() or es.sender_id = auth.uid())
    and es.status = any (
      array['sent'::text, 'viewed'::text, 'imported'::text, 'public'::text]
    )
),
calendar_notification_rows as (
  select
    scn.id::text as share_id,
    'calendar'::text as kind,
    scn.recipient_id,
    scn.actor_id as sender_id,
    s.handle as sender_handle,
    s.display_name as sender_name,
    s.avatar_url as sender_avatar,
    r.handle as recipient_handle,
    r.display_name as recipient_display_name,
    r.avatar_url as recipient_avatar_url,
    scn.calendar_id::text as payload_id,
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
    null::timestamp with time zone as responded_at,
    null::bigint as imported_flow_id,
    null::text as imported_flow_lifecycle,
    false as imported_flow_visible_active,
    false as imported_flow_visible_saved,
    'received'::text as filing_direction,
    case
      when scn.deleted_at is not null then 'deleted'
      when scn.viewed_at is not null then 'viewed'
      else 'pending'
    end as filing_lifecycle,
    case
      when coalesce(
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
      ) = 'calendar_invite_response' then 'calendar_invite_response'
      when scn.kind = 'calendar_invite' then 'calendar_invite'
      else 'calendar_update'
    end as filing_item_kind
  from public.shared_calendar_notifications scn
  left join public.profiles s on scn.actor_id = s.id
  left join public.profiles r on scn.recipient_id = r.id
  where scn.recipient_id = auth.uid()
),
combined as (
  select * from flow_share_rows
  union all
  select * from event_share_rows
  union all
  select * from calendar_notification_rows
)
select
  combined.*,
  (combined.filing_lifecycle <> 'deleted') as visible_in_inbox,
  (combined.filing_lifecycle = 'pending') as is_pending,
  (combined.filing_item_kind in (
    'event_invite',
    'calendar_invite',
    'calendar_invite_response'
  )) as is_invite,
  (combined.filing_item_kind = 'shared_flow') as is_shared_flow,
  (combined.filing_item_kind in (
    'calendar_invite',
    'calendar_invite_response',
    'calendar_update'
  )) as is_shared_calendar,
  coalesce(combined.imported_flow_visible_saved, false) as is_saved,
  jsonb_build_object(
    'item_kind', combined.filing_item_kind,
    'lifecycle', combined.filing_lifecycle,
    'direction', combined.filing_direction,
    'source', combined.kind,
    'flow', jsonb_build_object(
      'original_flow_id', combined.original_flow_id,
      'imported_flow_id', combined.imported_flow_id,
      'imported_lifecycle', combined.imported_flow_lifecycle,
      'visible_active', combined.imported_flow_visible_active,
      'visible_saved', combined.imported_flow_visible_saved
    )
  ) as filing_reasons
from combined
where combined.filing_lifecycle <> 'deleted';

comment on view public.share_filing_items_client is
'Client-safe filing view for shared flows, event invites, calendar notifications, and invite responses. Imported flow state is read directly from indexed flow rows to keep inbox startup queries bounded.';

create or replace function public.user_event_recently_deleted(
  p_user_id uuid,
  p_client_event_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with input as (
    select
      nullif(btrim(coalesce(p_client_event_id, '')), '') as client_event_id,
      public.user_event_reminder_uuid(p_client_event_id) as reminder_uuid
  ),
  tombstone_keys as (
    select
      input.client_event_id,
      input.reminder_uuid,
      case
        when input.reminder_uuid is null then null
        else 'reminder:' || input.reminder_uuid::text
      end as reminder_series_key,
      case
        when input.reminder_uuid is null then null
        else 'reminder:rule:' || input.reminder_uuid::text
      end as reminder_rule_key
    from input
  )
  select case
    when tombstone_keys.client_event_id is null then false
    when exists (
      select 1
      from public.event_deletion_trash edt
      where edt.user_id = p_user_id
        and edt.purged_at is null
        and edt.purge_after > timezone('utc', now())
        and edt.suppresses_client = true
        and edt.client_event_id = tombstone_keys.client_event_id
    ) then true
    when tombstone_keys.reminder_uuid is null then false
    when exists (
      select 1
      from public.event_deletion_trash edt
      where edt.user_id = p_user_id
        and edt.purged_at is null
        and edt.purge_after > timezone('utc', now())
        and edt.suppresses_client = true
        and edt.client_event_id in (
          tombstone_keys.reminder_series_key,
          tombstone_keys.reminder_rule_key
        )
    ) then true
    else (
      public.user_event_has_active_reminder_flow_for_occurrence(
        p_user_id,
        tombstone_keys.client_event_id
      ) = false
      and not exists (
        select 1
        from public.reminders r
        where r.user_id = p_user_id
          and r.id = tombstone_keys.reminder_uuid
      )
      and not exists (
        select 1
        from public.scheduled_notifications sn
        where sn.user_id = p_user_id
          and sn.is_active = true
          and sn.client_event_id = tombstone_keys.client_event_id
      )
    )
  end
  from tombstone_keys
$$;

comment on function public.user_event_recently_deleted(uuid, text) is
'Returns true when an event has an active tombstone. Non-reminder events skip reminder-flow reconciliation so filing views remain bounded on startup.';
