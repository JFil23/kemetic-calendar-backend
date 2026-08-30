-- Reading House RC filing is additive because staging and production share
-- one Supabase project. Deployed v1 filing/accounting functions remain
-- untouched; the RC client composes this supplement with v1 results.

create function private.flow_is_reading_house(
  p_notes text,
  p_ai_metadata jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    nullif(btrim(coalesce(p_ai_metadata ->> 'flow_key', '')), '') =
      'the-reading-house'
    or coalesce(p_notes, '') ~ '(^|;)maat=the-reading-house(;|$)'
$$;

create function private.flow_is_held_reading_house(
  p_notes text,
  p_ai_metadata jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    private.flow_is_reading_house(p_notes, p_ai_metadata)
    and (
      nullif(
        btrim(coalesce(p_ai_metadata #>> '{reading_house,state}', '')),
        ''
      ) = 'held_house'
      or coalesce(p_notes, '') ~
        '(^|;)reading_house_state=held_house(;|$)'
    )
$$;

-- This supplement intentionally returns the existing filed-flow row shape so
-- the RC client can merge by flow id without cloning the v1 accountant. For
-- creator-owned rows, v1 event counts are reused. Accepted members receive the
-- same lifecycle-live house with zero owner-accounting counts; calendar
-- hydration remains the event visibility authority.
create function public.get_my_held_reading_houses_v1(
  p_limit integer default null
)
returns table (
  id bigint,
  user_id uuid,
  calendar_id uuid,
  name text,
  color bigint,
  active boolean,
  is_saved boolean,
  start_date date,
  end_date date,
  notes text,
  rules jsonb,
  ai_metadata jsonb,
  is_hidden boolean,
  is_reminder boolean,
  reminder_uuid uuid,
  share_id uuid,
  origin_share_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  saved_at timestamptz,
  lifecycle text,
  visible_in_active_list boolean,
  visible_in_saved_list boolean,
  total_event_count bigint,
  remaining_event_count bigint,
  remaining_live_event_count bigint,
  is_shared boolean,
  is_posted boolean,
  is_shared_calendar_source boolean,
  is_flow_share_source boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_timezone text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_timezone := coalesce(
    nullif(btrim(public._get_user_timezone(v_uid)), ''),
    'UTC'
  );

  return query
  select
    f.id,
    f.user_id,
    f.calendar_id,
    f.name,
    f.color,
    f.active,
    (
      case
        when f.user_id = v_uid then coalesce(f.is_saved, false)
        else false
      end
      or fsaves.flow_id is not null
    ) as is_saved,
    f.start_date,
    f.end_date,
    f.notes,
    f.rules,
    f.ai_metadata,
    coalesce(f.is_hidden, false) as is_hidden,
    coalesce(f.is_reminder, false) as is_reminder,
    f.reminder_uuid,
    f.share_id,
    f.origin_share_id,
    f.created_at,
    f.updated_at,
    fsaves.saved_at,
    'active'::text as lifecycle,
    true as visible_in_active_list,
    (
      (
        case
          when f.user_id = v_uid then coalesce(f.is_saved, false)
          else false
        end
        or fsaves.flow_id is not null
      )
      and public.flow_record_kind(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      ) in ('active', 'inactive')
    ) as visible_in_saved_list,
    case
      when f.user_id = v_uid then coalesce(summary.total_event_count, 0)
      else 0
    end::bigint as total_event_count,
    case
      when f.user_id = v_uid then coalesce(summary.remaining_event_count, 0)
      else 0
    end::bigint as remaining_event_count,
    case
      when f.user_id = v_uid then
        coalesce(summary.remaining_live_event_count, 0)
      else 0
    end::bigint as remaining_live_event_count,
    (
      coalesce(sc.is_personal, true) = false
      or exists (
        select 1
        from public.flow_shares fshare
        where fshare.flow_id = f.id
          and fshare.deleted_at is null
          and coalesce(fshare.status, 'pending')
            in ('sent', 'viewed', 'imported', 'public')
      )
    ) as is_shared,
    exists (
      select 1
      from public.flow_posts fp
      where fp.flow_id = f.id
        and coalesce(fp.is_hidden, false) = false
    ) as is_posted,
    (coalesce(sc.is_personal, true) = false) as is_shared_calendar_source,
    exists (
      select 1
      from public.flow_shares fshare
      where fshare.flow_id = f.id
        and fshare.deleted_at is null
        and coalesce(fshare.status, 'pending')
          in ('sent', 'viewed', 'imported', 'public')
    ) as is_flow_share_source
  from public.flows f
  join public.shared_calendars sc
    on sc.id = f.calendar_id
   and sc.deleted_at is null
  join public.shared_calendar_members membership
    on membership.calendar_id = f.calendar_id
   and membership.user_id = v_uid
   and membership.status = 'accepted'
  left join public.flow_saves fsaves
    on fsaves.flow_id = f.id
   and fsaves.user_id = v_uid
  left join lateral private.flow_activity_summary_v1(
    f.user_id,
    array[f.id]::bigint[]
  ) summary
    on summary.flow_id = f.id
  where private.flow_is_held_reading_house(f.notes, f.ai_metadata)
    and public.flow_is_deleted_state(
      f.active,
      f.is_hidden,
      f.notes
    ) = false
    and coalesce(f.is_reminder, false) = false
    and coalesce(f.active, false) = true
    and public.flow_record_kind(
      f.active,
      f.is_hidden,
      f.is_reminder,
      f.notes
    ) <> 'hiddenHelper'
    and public.flow_is_schedule_open(f.end_date, v_timezone, v_now)
    and (
      (f.start_date is null and f.end_date is null)
      or coalesce(summary.is_counted_active, false)
    )
  order by f.created_at desc, f.id desc
  limit p_limit;
end;
$$;

revoke all on function private.flow_is_reading_house(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.flow_is_reading_house(text, jsonb)
  to service_role;

revoke all on function private.flow_is_held_reading_house(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.flow_is_held_reading_house(text, jsonb)
  to service_role;

revoke all on function public.get_my_held_reading_houses_v1(integer)
  from public, anon;
grant execute on function public.get_my_held_reading_houses_v1(integer)
  to authenticated;

comment on function private.flow_is_reading_house(text, jsonb) is
'Exact Reading House type detector; type alone never grants filing visibility.';
comment on function private.flow_is_held_reading_house(text, jsonb) is
'Exact Reading House type plus explicit held_house lifecycle detector.';
comment on function public.get_my_held_reading_houses_v1(integer) is
'RC-only additive supplement for lifecycle-live held Reading Houses, constrained to accepted membership on the exact calendar.';

notify pgrst, 'reload schema';
