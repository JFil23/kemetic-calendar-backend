\set ON_ERROR_STOP on

-- Required psql variables (values are supplied by the operator; do not commit
-- credentials or principal identifiers):
--   user_id        authenticated fixture/measurement principal UUID
--   start_utc      inclusive ISO-8601 hydration window start
--   end_utc        exclusive ISO-8601 hydration window end
--   flow_ids_csv   comma-separated requested flow ids
-- Optional:
--   page_size                 defaults to 1000
--   unauthorized_flow_ids_csv non-visible flow ids; when supplied, V2 must
--                              return no rows for them

\if :{?user_id}
\else
  \echo 'missing -v user_id=<uuid>'
  \quit
\endif
\if :{?start_utc}
\else
  \echo 'missing -v start_utc=<iso8601>'
  \quit
\endif
\if :{?end_utc}
\else
  \echo 'missing -v end_utc=<iso8601>'
  \quit
\endif
\if :{?flow_ids_csv}
\else
  \echo 'missing -v flow_ids_csv=<id,id,...>'
  \quit
\endif
\if :{?page_size}
\else
  \set page_size 1000
\endif
\if :{?run_fixture_matrix}
\else
  \set run_fixture_matrix false
\endif

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'user_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temp table hydration_parameters on commit drop as
select
  :'start_utc'::timestamptz as start_utc,
  :'end_utc'::timestamptz as end_utc,
  string_to_array(:'flow_ids_csv', ',')::bigint[] as flow_ids,
  greatest(1, least(:'page_size'::integer, 2000)) as page_size;

create temp table v1_flow on commit drop as
select result.*
from hydration_parameters p
cross join lateral public.get_calendar_hydration_events_v1(
  p.start_utc,
  p.end_utc,
  'flow',
  p.flow_ids,
  2000,
  0
) result;

create temp table v1_standalone on commit drop as
select result.*
from hydration_parameters p
cross join lateral public.get_calendar_hydration_events_v1(
  p.start_utc,
  p.end_utc,
  'standalone',
  null,
  2000,
  0
) result;

create temp table v2_flow on commit drop as
select result.*
from hydration_parameters p
cross join lateral public.get_calendar_flow_events_v2(
  p.start_utc,
  p.end_utc,
  p.flow_ids,
  2000,
  0
) result;

create temp table v2_standalone on commit drop as
select result.*
from hydration_parameters p
cross join lateral public.get_calendar_standalone_events_v2(
  p.start_utc,
  p.end_utc,
  2000,
  0
) result;

create temp table legacy_filtered on commit drop as
select
  filing.id,
  filing.calendar_id,
  filing.calendar_name,
  filing.calendar_color,
  filing.calendar_is_personal,
  filing.client_event_id,
  filing.title,
  filing.detail,
  filing.location,
  filing.all_day,
  filing.starts_at,
  filing.ends_at,
  filing.flow_local_id,
  filing.filed_flow_id,
  filing.item_kind,
  filing.category,
  filing.action_id,
  filing.behavior_payload
from public.user_event_filing_items_client filing
cross join hydration_parameters p
where filing.starts_at >= p.start_utc
  and filing.starts_at < p.end_utc
  and (
    (
      filing.item_kind = 'flow'
      and filing.filed_flow_id = any(p.flow_ids)
    )
    or filing.item_kind in ('note', 'reminder')
  );

create temp table v1_all on commit drop as
select * from v1_flow
union all
select * from v1_standalone;

create temp table v2_all on commit drop as
select * from v2_flow
union all
select * from v2_standalone;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from (
    select * from v1_all
    except all
    select * from v2_all
  ) difference;
  if v_count <> 0 then
    raise exception 'V1 has % rows not reproduced by V2', v_count;
  end if;

  select count(*) into v_count
  from (
    select * from v2_all
    except all
    select * from v1_all
  ) difference;
  if v_count <> 0 then
    raise exception 'V2 has % rows not present in V1', v_count;
  end if;

  select count(*) into v_count
  from (
    select * from legacy_filtered
    except all
    select * from v2_all
  ) difference;
  if v_count <> 0 then
    raise exception 'legacy filing has % rows not reproduced by V2', v_count;
  end if;

  select count(*) into v_count
  from (
    select * from v2_all
    except all
    select * from legacy_filtered
  ) difference;
  if v_count <> 0 then
    raise exception 'V2 has % rows not present in legacy filing', v_count;
  end if;

  select count(*) into v_count
  from v2_flow flow_lane
  join v2_standalone standalone_lane
    on standalone_lane.id = flow_lane.id;
  if v_count <> 0 then
    raise exception 'V2 flow and standalone lanes overlap by % ids', v_count;
  end if;
end;
$$;

create temp table v2_flow_paged on commit drop as
with page_count as (
  select case
    when count(*) = 0 then 0
    else ((count(*) - 1) / p.page_size)::integer + 1
  end as pages
  from v2_flow
  cross join hydration_parameters p
  group by p.page_size
)
select result.*
from hydration_parameters p
cross join page_count page_count
cross join lateral generate_series(0, page_count.pages - 1) page_number
cross join lateral public.get_calendar_flow_events_v2(
  p.start_utc,
  p.end_utc,
  p.flow_ids,
  p.page_size,
  page_number * p.page_size
) result;

create temp table v2_standalone_paged on commit drop as
with page_count as (
  select case
    when count(*) = 0 then 0
    else ((count(*) - 1) / p.page_size)::integer + 1
  end as pages
  from v2_standalone
  cross join hydration_parameters p
  group by p.page_size
)
select result.*
from hydration_parameters p
cross join page_count page_count
cross join lateral generate_series(0, page_count.pages - 1) page_number
cross join lateral public.get_calendar_standalone_events_v2(
  p.start_utc,
  p.end_utc,
  p.page_size,
  page_number * p.page_size
) result;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from (
    select * from v2_flow
    except all
    select * from v2_flow_paged
  ) difference;
  if v_count <> 0 then
    raise exception 'flow paging omitted % rows', v_count;
  end if;

  select count(*) into v_count
  from (
    select * from v2_flow_paged
    except all
    select * from v2_flow
  ) difference;
  if v_count <> 0 then
    raise exception 'flow paging duplicated or added % rows', v_count;
  end if;

  select count(*) into v_count
  from (
    select * from v2_standalone
    except all
    select * from v2_standalone_paged
  ) difference;
  if v_count <> 0 then
    raise exception 'standalone paging omitted % rows', v_count;
  end if;

  select count(*) into v_count
  from (
    select * from v2_standalone_paged
    except all
    select * from v2_standalone
  ) difference;
  if v_count <> 0 then
    raise exception 'standalone paging duplicated or added % rows', v_count;
  end if;
end;
$$;

-- SECURITY DEFINER must still reject an unauthenticated call.
do $$
declare
  v_user_id text := current_setting('request.jwt.claim.sub', true);
  v_failed boolean := false;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform *
    from public.get_calendar_standalone_events_v2(
      (select start_utc from hydration_parameters),
      (select end_utc from hydration_parameters),
      1,
      0
    );
  exception when others then
    v_failed := true;
  end;
  perform set_config('request.jwt.claim.sub', v_user_id, true);
  if not v_failed then
    raise exception 'unauthenticated V2 call unexpectedly succeeded';
  end if;
end;
$$;

\if :{?unauthorized_flow_ids_csv}
create temp table unauthorized_flow_parameters on commit drop as
select string_to_array(:'unauthorized_flow_ids_csv', ',')::bigint[] as flow_ids;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from hydration_parameters p
  cross join lateral public.get_calendar_flow_events_v2(
    p.start_utc,
    p.end_utc,
    (select flow_ids from unauthorized_flow_parameters),
    2000,
    0
  ) result;
  if v_count <> 0 then
    raise exception 'non-visible arbitrary flow ids returned % rows', v_count;
  end if;
end;
$$;
\endif

\if :run_fixture_matrix
-- Disposable authorization/lifecycle/action fixtures. This section needs a
-- database-owner connection because it creates auth principals; every row is
-- rolled back with the surrounding transaction.
reset role;

create temp table hydration_fixture_ids on commit drop as
select
  gen_random_uuid() as actor_id,
  gen_random_uuid() as owner_id,
  gen_random_uuid() as outsider_id,
  gen_random_uuid() as actor_calendar_id,
  gen_random_uuid() as actor_pending_calendar_id,
  gen_random_uuid() as accepted_calendar_id,
  gen_random_uuid() as pending_calendar_id,
  gen_random_uuid() as flow_share_calendar_id,
  gen_random_uuid() as event_share_calendar_id,
  gen_random_uuid() as private_calendar_id,
  gen_random_uuid() as owned_pending_event_id,
  gen_random_uuid() as accepted_event_id,
  gen_random_uuid() as pending_event_id,
  gen_random_uuid() as flow_share_event_id,
  gen_random_uuid() as event_share_event_id,
  gen_random_uuid() as reminder_event_id,
  gen_random_uuid() as tombstoned_event_id,
  gen_random_uuid() as hidden_event_id,
  gen_random_uuid() as deleted_event_id,
  gen_random_uuid() as collision_event_id,
  gen_random_uuid() as reminder_id,
  'calendar-v2-collision-' || gen_random_uuid()::text as collision_action_id,
  nextval('public.flows_id_seq')::bigint as owned_flow_id,
  nextval('public.flows_id_seq')::bigint as flow_share_flow_id,
  nextval('public.flows_id_seq')::bigint as event_share_flow_id,
  nextval('public.flows_id_seq')::bigint as hidden_flow_id,
  nextval('public.flows_id_seq')::bigint as deleted_flow_id,
  nextval('public.flows_id_seq')::bigint as collision_winner_flow_id,
  nextval('public.flows_id_seq')::bigint as collision_requested_loser_flow_id,
  nextval('public.flows_id_seq')::bigint as outsider_flow_id,
  '2099-01-01 00:00:00+00'::timestamptz as start_utc,
  '2099-01-03 00:00:00+00'::timestamptz as end_utc;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at,
  updated_at
)
select actor_id, 'authenticated', 'authenticated',
       actor_id::text || '@calendar-v2.test', 'not-used', now(), now(), now()
from hydration_fixture_ids
union all
select owner_id, 'authenticated', 'authenticated',
       owner_id::text || '@calendar-v2.test', 'not-used', now(), now(), now()
from hydration_fixture_ids
union all
select outsider_id, 'authenticated', 'authenticated',
       outsider_id::text || '@calendar-v2.test', 'not-used', now(), now(), now()
from hydration_fixture_ids;

insert into public.shared_calendars (id, owner_id, name, is_personal)
select actor_calendar_id, actor_id, 'V2 actor accepted', false
from hydration_fixture_ids
union all
select actor_pending_calendar_id, actor_id, 'V2 actor pending', false
from hydration_fixture_ids
union all
select accepted_calendar_id, owner_id, 'V2 accepted share', false
from hydration_fixture_ids
union all
select pending_calendar_id, owner_id, 'V2 pending share', false
from hydration_fixture_ids
union all
select flow_share_calendar_id, owner_id, 'V2 flow share', false
from hydration_fixture_ids
union all
select event_share_calendar_id, owner_id, 'V2 event share', false
from hydration_fixture_ids
union all
select private_calendar_id, outsider_id, 'V2 private', false
from hydration_fixture_ids;

insert into public.shared_calendar_members (
  calendar_id, user_id, role, status, invited_by, responded_at
)
select actor_calendar_id, actor_id, 'owner', 'accepted', actor_id, now()
from hydration_fixture_ids
union all
select actor_pending_calendar_id, actor_id, 'owner', 'pending', actor_id, null
from hydration_fixture_ids
union all
select accepted_calendar_id, owner_id, 'owner', 'accepted', owner_id, now()
from hydration_fixture_ids
union all
select accepted_calendar_id, actor_id, 'viewer', 'accepted', owner_id, now()
from hydration_fixture_ids
union all
select pending_calendar_id, owner_id, 'owner', 'accepted', owner_id, now()
from hydration_fixture_ids
union all
select pending_calendar_id, actor_id, 'viewer', 'pending', owner_id, null
from hydration_fixture_ids
union all
select flow_share_calendar_id, owner_id, 'owner', 'accepted', owner_id, now()
from hydration_fixture_ids
union all
select flow_share_calendar_id, actor_id, 'viewer', 'pending', owner_id, null
from hydration_fixture_ids
union all
select event_share_calendar_id, owner_id, 'owner', 'accepted', owner_id, now()
from hydration_fixture_ids
union all
select event_share_calendar_id, actor_id, 'viewer', 'pending', owner_id, null
from hydration_fixture_ids
union all
select private_calendar_id, outsider_id, 'owner', 'accepted', outsider_id, now()
from hydration_fixture_ids;

-- Insert the unresolved action row before either colliding flow exists so the
-- write-time integrity trigger cannot pre-resolve it.
insert into public.user_events (
  id, user_id, calendar_id, client_event_id, title, starts_at, action_id
)
select collision_event_id, actor_id, actor_calendar_id,
       'calendar-v2-collision-event-' || collision_event_id::text,
       'collision', start_utc + interval '1 hour', collision_action_id
from hydration_fixture_ids;

insert into public.flows (
  id, user_id, calendar_id, name, active, is_hidden, is_reminder, notes,
  ai_metadata, updated_at
)
select owned_flow_id, actor_id, actor_calendar_id, 'owned', true, false,
       false, null::text, null::jsonb, now()
from hydration_fixture_ids
union all
select flow_share_flow_id, owner_id, flow_share_calendar_id, 'flow shared',
       true, false, false, null::text, null::jsonb, now()
from hydration_fixture_ids
union all
select event_share_flow_id, owner_id, event_share_calendar_id, 'event shared',
       true, false, false, null::text, null::jsonb, now()
from hydration_fixture_ids
union all
select hidden_flow_id, actor_id, actor_calendar_id, 'hidden repeating', true,
       true, false, '{"kind":"repeating_note"}'::text, null::jsonb, now()
from hydration_fixture_ids
union all
select deleted_flow_id, actor_id, actor_calendar_id, 'deleted', false, true,
       false, null::text, null::jsonb, now()
from hydration_fixture_ids
union all
select collision_winner_flow_id, actor_id, actor_calendar_id,
       'collision winner', true, false, false, null::text,
       jsonb_build_object(
         'plan_spec', jsonb_build_object(
           'actions', jsonb_build_array(
             jsonb_build_object('action_id', collision_action_id)
           )
         )
       ), now()
from hydration_fixture_ids
union all
select collision_requested_loser_flow_id, actor_id, actor_calendar_id,
       'collision requested loser', false, false, false, null::text,
       jsonb_build_object(
         'plan_spec', jsonb_build_object(
           'actions', jsonb_build_array(
             jsonb_build_object('action_id', collision_action_id)
           )
         )
       ), now() + interval '1 hour'
from hydration_fixture_ids
union all
select outsider_flow_id, outsider_id, private_calendar_id, 'not visible',
       true, false, false, null::text, null::jsonb, now()
from hydration_fixture_ids;

insert into public.user_events (
  id, user_id, calendar_id, client_event_id, title, starts_at, flow_local_id
)
select owned_pending_event_id, actor_id, actor_pending_calendar_id,
       'calendar-v2-owned-pending-' || owned_pending_event_id::text,
       'owned pending', start_utc + interval '2 hours', null::integer
from hydration_fixture_ids
union all
select accepted_event_id, owner_id, accepted_calendar_id,
       'calendar-v2-accepted-' || accepted_event_id::text,
       'accepted', start_utc + interval '3 hours', null::integer
from hydration_fixture_ids
union all
select pending_event_id, owner_id, pending_calendar_id,
       'calendar-v2-pending-' || pending_event_id::text,
       'pending', start_utc + interval '4 hours', null::integer
from hydration_fixture_ids
union all
select flow_share_event_id, owner_id, flow_share_calendar_id,
       'calendar-v2-flow-share-' || flow_share_event_id::text,
       'flow shared', start_utc + interval '5 hours',
       flow_share_flow_id::integer
from hydration_fixture_ids
union all
select event_share_event_id, owner_id, event_share_calendar_id,
       'calendar-v2-event-share-' || event_share_event_id::text,
       'event shared', start_utc + interval '6 hours',
       event_share_flow_id::integer
from hydration_fixture_ids
union all
select hidden_event_id, actor_id, actor_calendar_id,
       'calendar-v2-hidden-' || hidden_event_id::text,
       'hidden', start_utc + interval '7 hours', hidden_flow_id::integer
from hydration_fixture_ids;

-- A deleted flow cannot receive new rows through the normal write guard. The
-- replica setting is local to this transaction and used only for this fixture.
set local session_replication_role = replica;
insert into public.user_events (
  id, user_id, calendar_id, client_event_id, title, starts_at, flow_local_id
)
select deleted_event_id, actor_id, actor_calendar_id,
       'calendar-v2-deleted-' || deleted_event_id::text,
       'deleted', start_utc + interval '8 hours', deleted_flow_id::integer
from hydration_fixture_ids;
set local session_replication_role = origin;

insert into public.reminders (id, user_id, alert_at, title)
select reminder_id, actor_id, start_utc + interval '9 hours', 'reminder'
from hydration_fixture_ids;

insert into public.user_events (
  id, user_id, calendar_id, client_event_id, title, starts_at
)
select reminder_event_id, actor_id, actor_calendar_id,
       'reminder:' || reminder_id::text || ':2099-01-01',
       'reminder', start_utc + interval '9 hours'
from hydration_fixture_ids
union all
select tombstoned_event_id, actor_id, actor_calendar_id,
       'calendar-v2-tombstone-' || tombstoned_event_id::text,
       'tombstoned', start_utc + interval '10 hours'
from hydration_fixture_ids;

insert into public.event_deletion_trash (
  user_id, source_id, client_event_id, calendar_id, title, starts_at,
  purge_after, suppresses_client
)
select actor_id, tombstoned_event_id,
       'calendar-v2-tombstone-' || tombstoned_event_id::text,
       actor_calendar_id, 'tombstoned', start_utc + interval '10 hours',
       now() + interval '1 day', true
from hydration_fixture_ids;

insert into public.flow_shares (
  flow_id, sender_id, recipient_id, channel, status
)
select flow_share_flow_id, owner_id, actor_id, 'in_app', 'sent'
from hydration_fixture_ids;

insert into public.event_shares (
  event_id, sender_id, recipient_id, channel, status
)
select event_share_event_id, owner_id, actor_id, 'in_app', 'sent'
from hydration_fixture_ids;

grant select on hydration_fixture_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', actor_id::text, true)
from hydration_fixture_ids;
select set_config('request.jwt.claim.role', 'authenticated', true);

create temp table fixture_v1_flow on commit drop as
select result.*
from hydration_fixture_ids fixture
cross join lateral public.get_calendar_hydration_events_v1(
  fixture.start_utc,
  fixture.end_utc,
  'flow',
  array[
    fixture.owned_flow_id,
    fixture.flow_share_flow_id,
    fixture.event_share_flow_id,
    fixture.hidden_flow_id,
    fixture.deleted_flow_id,
    fixture.collision_winner_flow_id,
    fixture.collision_requested_loser_flow_id,
    fixture.outsider_flow_id
  ],
  2000,
  0
) result;

create temp table fixture_v2_flow on commit drop as
select result.*
from hydration_fixture_ids fixture
cross join lateral public.get_calendar_flow_events_v2(
  fixture.start_utc,
  fixture.end_utc,
  array[
    fixture.owned_flow_id,
    fixture.flow_share_flow_id,
    fixture.event_share_flow_id,
    fixture.hidden_flow_id,
    fixture.deleted_flow_id,
    fixture.collision_winner_flow_id,
    fixture.collision_requested_loser_flow_id,
    fixture.outsider_flow_id
  ],
  2000,
  0
) result;

create temp table fixture_v1_standalone on commit drop as
select result.*
from hydration_fixture_ids fixture
cross join lateral public.get_calendar_hydration_events_v1(
  fixture.start_utc, fixture.end_utc, 'standalone', null, 2000, 0
) result;

create temp table fixture_v2_standalone on commit drop as
select result.*
from hydration_fixture_ids fixture
cross join lateral public.get_calendar_standalone_events_v2(
  fixture.start_utc, fixture.end_utc, 2000, 0
) result;

do $$
declare
  fixture hydration_fixture_ids%rowtype;
  v_count bigint;
begin
  select * into fixture from hydration_fixture_ids;

  select count(*) into v_count from (
    (select * from fixture_v1_flow except all select * from fixture_v2_flow)
    union all
    (select * from fixture_v2_flow except all select * from fixture_v1_flow)
    union all
    (select * from fixture_v1_standalone except all
      select * from fixture_v2_standalone)
    union all
    (select * from fixture_v2_standalone except all
      select * from fixture_v1_standalone)
  ) differences;
  if v_count <> 0 then
    raise exception 'fixture V1/V2 equivalence failed with % unique rows', v_count;
  end if;

  if not exists (select 1 from fixture_v2_standalone where id = fixture.owned_pending_event_id) then
    raise exception 'owned event on pending calendar did not hydrate';
  end if;
  if not exists (select 1 from fixture_v2_standalone where id = fixture.accepted_event_id) then
    raise exception 'accepted shared-calendar event did not hydrate';
  end if;
  if exists (select 1 from fixture_v2_standalone where id = fixture.pending_event_id) then
    raise exception 'other-owner pending calendar event hydrated without a share';
  end if;
  if not exists (select 1 from fixture_v2_flow where id = fixture.flow_share_event_id) then
    raise exception 'flow-share event did not hydrate';
  end if;
  if not exists (select 1 from fixture_v2_flow where id = fixture.event_share_event_id) then
    raise exception 'event-share event did not hydrate';
  end if;
  if not exists (select 1 from fixture_v2_standalone where id = fixture.reminder_event_id) then
    raise exception 'authoritative reminder did not hydrate';
  end if;
  if exists (select 1 from fixture_v2_standalone where id = fixture.tombstoned_event_id) then
    raise exception 'tombstoned event hydrated';
  end if;
  if exists (select 1 from fixture_v2_flow where id = fixture.deleted_event_id) then
    raise exception 'deleted-flow event hydrated';
  end if;
  if not exists (select 1 from fixture_v2_flow where id = fixture.hidden_event_id) then
    raise exception 'non-deleted hidden repeating flow diverged from V1';
  end if;
  if exists (select 1 from fixture_v2_flow where filed_flow_id = fixture.outsider_flow_id) then
    raise exception 'arbitrary non-visible flow id returned rows';
  end if;
  if exists (
    select 1 from fixture_v2_flow flow_lane
    join fixture_v2_standalone standalone_lane using (id)
  ) then
    raise exception 'fixture flow and standalone lanes overlap';
  end if;

  select count(*) into v_count
  from public.get_calendar_flow_events_v2(
    fixture.start_utc,
    fixture.end_utc,
    array[fixture.collision_requested_loser_flow_id],
    2000,
    0
  );
  if v_count <> 0 then
    raise exception 'requested-only action expansion changed the V1 winner';
  end if;

  if not exists (
    select 1
    from public.get_calendar_flow_events_v2(
      fixture.start_utc,
      fixture.end_utc,
      array[fixture.collision_winner_flow_id],
      2000,
      0
    ) result
    where result.id = fixture.collision_event_id
  ) then
    raise exception 'V1 action collision winner was not returned';
  end if;
end;
$$;

create temp table fixture_v2_all on commit drop as
select * from fixture_v2_flow
union all
select * from fixture_v2_standalone;

create temp table fixture_v2_paged on commit drop as
with bounds as (
  select count(*)::integer as row_count from fixture_v2_all
)
select result.*
from hydration_fixture_ids fixture
cross join bounds
cross join lateral generate_series(0, greatest(bounds.row_count - 1, -1) / 2) page_number
cross join lateral (
  select * from public.get_calendar_flow_events_v2(
    fixture.start_utc,
    fixture.end_utc,
    array[
      fixture.owned_flow_id,
      fixture.flow_share_flow_id,
      fixture.event_share_flow_id,
      fixture.hidden_flow_id,
      fixture.deleted_flow_id,
      fixture.collision_winner_flow_id,
      fixture.collision_requested_loser_flow_id,
      fixture.outsider_flow_id
    ],
    2,
    page_number * 2
  )
  union all
  select * from public.get_calendar_standalone_events_v2(
    fixture.start_utc,
    fixture.end_utc,
    2,
    page_number * 2
  )
) result;

-- Each lane is paged independently in the general paging proof above. The
-- fixture boundary check remains a two-way multiset comparison as a final
-- guard around small pages.
do $$
declare
  v_missing bigint;
begin
  select count(*) into v_missing
  from (
    select * from fixture_v2_all
    except all
    select * from fixture_v2_paged
  ) missing;
  if v_missing <> 0 then
    raise exception 'fixture paging omitted % rows', v_missing;
  end if;
end;
$$;
\endif

select
  (select count(*) from v1_all) as v1_rows,
  (select count(*) from v2_all) as v2_rows,
  (select count(*) from legacy_filtered) as legacy_rows,
  (select count(*) from v2_flow) as v2_flow_rows,
  (select count(*) from v2_standalone) as v2_standalone_rows;

rollback;
