drop view if exists public.share_filing_items_client;
drop view if exists public.shared_calendar_invite_filing_items_client;
drop view if exists public.shared_calendar_filing_items_client;

create view public.share_filing_items_client
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
      iff.id,
      iff.lifecycle,
      iff.visible_in_active_list,
      iff.visible_in_saved_list,
      iff.created_at
    from public.flow_filing_items_client iff
    where iff.share_id = fs.id
      and iff.user_id = auth.uid()
    order by
      iff.visible_in_active_list desc,
      iff.visible_in_saved_list desc,
      iff.created_at desc
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

create view public.shared_calendar_filing_items_client
with (security_invoker = true) as
with calendar_event_counts as (
  select
    e.calendar_id,
    count(*) as total_event_count,
    count(*) filter (where e.live_on_calendar) as live_event_count,
    count(*) filter (where e.lifecycle = 'inactive') as inactive_event_count,
    count(distinct e.filed_flow_id) filter (
      where e.filed_flow_id is not null
        and e.live_on_calendar
    ) as live_flow_count
  from public.user_event_filing_items_client e
  where e.calendar_id is not null
  group by e.calendar_id
)
select
  sc.id,
  sc.owner_id,
  sc.name,
  sc.color,
  sc.icon,
  sc.is_personal,
  sc.created_at,
  sc.updated_at,
  scm.user_id as member_user_id,
  scm.role,
  scm.status,
  owner_profile.handle as owner_handle,
  owner_profile.display_name as owner_display_name,
  (
    select count(*)::int
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'accepted'
  ) as member_count,
  (
    select count(*)::int
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'pending'
  ) as pending_invite_count,
  coalesce(cec.total_event_count, 0) as total_event_count,
  coalesce(cec.live_event_count, 0) as live_event_count,
  coalesce(cec.inactive_event_count, 0) as inactive_event_count,
  coalesce(cec.live_flow_count, 0) as live_flow_count,
  'shared_calendar'::text as item_kind,
  case
    when sc.deleted_at is not null then 'deleted'
    when scm.status = 'accepted' then 'active'
    else scm.status
  end as lifecycle,
  (scm.status = 'accepted' and sc.deleted_at is null) as live_on_calendar,
  (sc.is_personal = false) as is_shared,
  jsonb_build_object(
    'item_kind', 'shared_calendar',
    'lifecycle', case
      when sc.deleted_at is not null then 'deleted'
      when scm.status = 'accepted' then 'active'
      else scm.status
    end,
    'membership', jsonb_build_object(
      'role', scm.role,
      'status', scm.status,
      'member_user_id', scm.user_id,
      'owner_id', sc.owner_id
    ),
    'event_counts', jsonb_build_object(
      'total', coalesce(cec.total_event_count, 0),
      'live', coalesce(cec.live_event_count, 0),
      'inactive', coalesce(cec.inactive_event_count, 0),
      'live_flows', coalesce(cec.live_flow_count, 0)
    )
  ) as filing_reasons
from public.shared_calendars sc
join public.shared_calendar_members scm
  on scm.calendar_id = sc.id
left join public.profiles owner_profile
  on owner_profile.id = sc.owner_id
left join calendar_event_counts cec
  on cec.calendar_id = sc.id
where sc.deleted_at is null
  and scm.user_id = auth.uid()
  and scm.status = 'accepted';

create view public.shared_calendar_invite_filing_items_client
with (security_invoker = true) as
select
  scm.calendar_id,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.icon as calendar_icon,
  sc.owner_id,
  scm.user_id as invitee_id,
  invitee_profile.handle as invitee_handle,
  invitee_profile.display_name as invitee_display_name,
  invitee_profile.avatar_url as invitee_avatar_url,
  scm.role,
  scm.status,
  scm.created_at as invited_at,
  scm.updated_at,
  scm.responded_at,
  scm.invited_by,
  inviter_profile.handle as inviter_handle,
  inviter_profile.display_name as inviter_display_name,
  case
    when scm.user_id = auth.uid() then 'incoming'
    when scm.invited_by = auth.uid() then 'sent'
    else 'other'
  end as invite_direction,
  'calendar_invite'::text as item_kind,
  scm.status as lifecycle,
  (sc.deleted_at is null and scm.status = 'pending') as is_pending,
  jsonb_build_object(
    'item_kind', 'calendar_invite',
    'lifecycle', scm.status,
    'direction', case
      when scm.user_id = auth.uid() then 'incoming'
      when scm.invited_by = auth.uid() then 'sent'
      else 'other'
    end,
    'calendar', jsonb_build_object(
      'calendar_id', sc.id,
      'calendar_name', sc.name,
      'calendar_color', sc.color,
      'owner_id', sc.owner_id
    ),
    'membership', jsonb_build_object(
      'role', scm.role,
      'status', scm.status,
      'invited_by', scm.invited_by,
      'invitee_id', scm.user_id
    )
  ) as filing_reasons
from public.shared_calendar_members scm
join public.shared_calendars sc
  on sc.id = scm.calendar_id
left join public.profiles inviter_profile
  on inviter_profile.id = scm.invited_by
left join public.profiles invitee_profile
  on invitee_profile.id = scm.user_id
where sc.deleted_at is null
  and scm.status = 'pending'
  and (
    scm.user_id = auth.uid()
    or (
      scm.invited_by = auth.uid()
      and scm.user_id <> auth.uid()
    )
  );

revoke all on public.share_filing_items_client from public;
revoke all on public.share_filing_items_client from anon;
revoke all on public.share_filing_items_client from authenticated;
grant select on public.share_filing_items_client to authenticated;
grant select on public.share_filing_items_client to service_role;

revoke all on public.shared_calendar_filing_items_client from public;
revoke all on public.shared_calendar_filing_items_client from anon;
revoke all on public.shared_calendar_filing_items_client from authenticated;
grant select on public.shared_calendar_filing_items_client to authenticated;
grant select on public.shared_calendar_filing_items_client to service_role;

revoke all on public.shared_calendar_invite_filing_items_client from public;
revoke all on public.shared_calendar_invite_filing_items_client from anon;
revoke all on public.shared_calendar_invite_filing_items_client from authenticated;
grant select on public.shared_calendar_invite_filing_items_client to authenticated;
grant select on public.shared_calendar_invite_filing_items_client to service_role;

comment on view public.share_filing_items_client is
'Client-safe filing view for shared flows, event invites, calendar notifications, and invite responses. Deleted rows are filtered out at the API surface.';

comment on view public.shared_calendar_filing_items_client is
'Client-safe filing view for accepted calendars. Event counts are derived from user_event_filing_items_client so calendar lists share the same live/deleted rules as calendar display.';

comment on view public.shared_calendar_invite_filing_items_client is
'Client-safe filing view for pending shared calendar invites, split by incoming vs sent direction with structured filing reasons.';

notify pgrst, 'reload schema';
