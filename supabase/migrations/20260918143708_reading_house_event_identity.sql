-- Remote migration identity: 20260918143708.
-- Reading House sittings were accidentally written with the reserved
-- `maat:` legacy prefix. Calendar hydration correctly excludes that prefix,
-- so move active Reading House identities into their own namespace while
-- preserving any records keyed to the same client event ID.

create temporary table reading_house_event_identity_map
on commit drop
as
select
  ue.id as event_id,
  ue.user_id,
  ue.client_event_id as legacy_client_event_id,
  regexp_replace(
    ue.client_event_id,
    '^maat:reading-house:',
    'reading-house:',
    'i'
  ) as canonical_client_event_id
from public.user_events ue
join public.flows f
  on f.id = ue.flow_local_id
where f.active = true
  and coalesce(f.is_hidden, false) = false
  and coalesce(f.is_reminder, false) = false
  and lower(coalesce(ue.client_event_id, '')) like 'maat:reading-house:%'
  and lower(coalesce(ue.action_id, '')) like 'the-reading-house-sitting-%'
  and lower(coalesce(ue.category, '')) <> 'tombstone';

do $$
begin
  if exists (
    select 1
    from reading_house_event_identity_map mapping
    join public.user_events existing
      on existing.client_event_id = mapping.canonical_client_event_id
     and existing.id <> mapping.event_id
  ) then
    raise exception
      'Reading House client-event migration found a canonical ID collision';
  end if;
end;
$$;

update public.user_event_completions completion
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where completion.user_id = mapping.user_id
  and completion.client_event_id = mapping.legacy_client_event_id;

update public.scheduled_notifications notification
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where notification.user_id = mapping.user_id
  and notification.client_event_id = mapping.legacy_client_event_id;

update public.event_deletion_trash deletion
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where deletion.user_id = mapping.user_id
  and deletion.client_event_id = mapping.legacy_client_event_id;

update public.reading_house_announcements item
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where item.client_event_id = mapping.legacy_client_event_id;

update public.reading_house_fragment_replies item
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where item.client_event_id = mapping.legacy_client_event_id;

update public.reading_house_margin_items item
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where item.client_event_id = mapping.legacy_client_event_id;

update public.reading_house_shared_fragments item
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where item.client_event_id = mapping.legacy_client_event_id;

update public.reading_house_sitting_positions item
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where item.client_event_id = mapping.legacy_client_event_id;

update public.shared_practice_entries item
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where item.client_event_id = mapping.legacy_client_event_id;

update public.shared_practice_presence item
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where item.client_event_id = mapping.legacy_client_event_id;

update public.user_events event
set client_event_id = mapping.canonical_client_event_id
from reading_house_event_identity_map mapping
where event.id = mapping.event_id;

do $$
begin
  if exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = ue.flow_local_id
    where f.active = true
      and coalesce(f.is_hidden, false) = false
      and coalesce(f.is_reminder, false) = false
      and lower(coalesce(ue.client_event_id, ''))
        like 'maat:reading-house:%'
      and lower(coalesce(ue.action_id, ''))
        like 'the-reading-house-sitting-%'
      and lower(coalesce(ue.category, '')) <> 'tombstone'
  ) then
    raise exception
      'Active Reading House events remain in the legacy Ma''at namespace';
  end if;
end;
$$;
