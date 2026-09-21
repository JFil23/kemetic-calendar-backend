-- User-created Flow appearance contract.
-- This is intentionally independent of Ma'at flow presentation tables.

alter table public.flows
  add column if not exists appearance jsonb;

alter table public.flows
  drop constraint if exists flows_appearance_object_check;

alter table public.flows
  add constraint flows_appearance_object_check
  check (appearance is null or jsonb_typeof(appearance) = 'object');

-- Flow shares are immutable snapshots. The established create_flow_share
-- function predates the appearance column, while the client fallback already
-- includes it. Normalize both paths at the table boundary so there is one
-- snapshot contract and recipients never depend on which writer was used.
create or replace function public.attach_flow_appearance_to_share_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_appearance jsonb;
begin
  if new.flow_id is null then
    return new;
  end if;

  select f.appearance
    into source_appearance
    from public.flows f
   where f.id = new.flow_id
     and f.user_id = new.sender_id;

  if source_appearance is not null
     and jsonb_typeof(source_appearance) = 'object'
     and source_appearance <> '{}'::jsonb then
    new.payload_json := coalesce(new.payload_json, '{}'::jsonb)
      || jsonb_build_object('appearance', source_appearance);
  end if;

  return new;
end;
$$;

revoke all on function public.attach_flow_appearance_to_share_snapshot()
  from public, anon, authenticated;

drop trigger if exists attach_flow_appearance_to_share_snapshot
  on public.flow_shares;
create trigger attach_flow_appearance_to_share_snapshot
before insert on public.flow_shares
for each row
execute function public.attach_flow_appearance_to_share_snapshot();

create or replace view public.flows_with_calendars
with (security_invoker = true) as
with uid_ctx as (
  select (select auth.uid()) as uid
)
select
  f.id, f.user_id, f.calendar_id,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.is_personal as calendar_is_personal,
  f.name, f.color, f.active, f.is_saved, f.start_date, f.end_date,
  f.notes, f.rules, f.ai_metadata, f.is_hidden, f.share_id,
  f.created_at, f.updated_at, f.is_reminder, f.reminder_uuid,
  f.origin_type, f.origin_flow_id, f.origin_share_id,
  f.origin_generation_id, f.root_flow_id,
  f.appearance
from public.flows f
join public.shared_calendars sc on sc.id = f.calendar_id
join public.shared_calendar_members scm on scm.calendar_id = f.calendar_id
join uid_ctx u on scm.user_id = u.uid
where sc.deleted_at is null and scm.status = 'accepted';

alter view public.flows_with_calendars owner to postgres;
grant select on public.flows_with_calendars to authenticated;

comment on view public.flows_with_calendars is
  'Security-invoker flow catalog scoped to accepted calendar memberships; appearance is appended for backward-compatible clients.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'flow-appearance-images', 'flow-appearance-images', false, 12582912,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists flow_appearance_owner_read on storage.objects;
create policy flow_appearance_owner_read
on storage.objects for select to authenticated
using (
  bucket_id = 'flow-appearance-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists flow_appearance_owner_insert on storage.objects;
create policy flow_appearance_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'flow-appearance-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists flow_appearance_owner_update on storage.objects;
create policy flow_appearance_owner_update
on storage.objects for update to authenticated
using (
  bucket_id = 'flow-appearance-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'flow-appearance-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists flow_appearance_owner_delete on storage.objects;
create policy flow_appearance_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'flow-appearance-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- A direct-share recipient may read only their own sender snapshot. Public
-- profile posts are intentionally readable by signed-in users. Imports make
-- a recipient-owned copy so this policy is not a permanent dependency.
drop policy if exists flow_appearance_shared_read on storage.objects;
create policy flow_appearance_shared_read
on storage.objects for select to authenticated
using (
  bucket_id = 'flow-appearance-images'
  and (
    exists (
      select 1 from public.flow_shares fs
      where fs.recipient_id = (select auth.uid())
        and fs.deleted_at is null
        and coalesce(fs.status, 'pending') in (
          'pending', 'sent', 'viewed', 'imported'
        )
        and fs.payload_json -> 'appearance' ->> 'image_object_path' =
          storage.objects.name
    )
    or exists (
      select 1 from public.flow_posts fp
      where coalesce(fp.is_hidden, false) = false
        and fp.ai_metadata -> 'payload' -> 'appearance'
          ->> 'image_object_path' = storage.objects.name
    )
  )
);
