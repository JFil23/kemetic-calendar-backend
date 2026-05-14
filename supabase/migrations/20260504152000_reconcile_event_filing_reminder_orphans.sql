create or replace function public.user_event_reminder_uuid(
  p_client_event_id text
)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when nullif(btrim(coalesce(p_client_event_id, '')), '') is null then null
    when substring(
      btrim(p_client_event_id)
      from '^reminder:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
    ) is not null
      then substring(
        btrim(p_client_event_id)
        from '^reminder:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
      )::uuid
    when substring(
      btrim(p_client_event_id)
      from '^reminder:rule:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
    ) is not null
      then substring(
        btrim(p_client_event_id)
        from '^reminder:rule:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
      )::uuid
    else null
  end
$$;

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
  )
  select input.client_event_id is not null
    and (
      exists (
        select 1
        from public.event_deletion_trash edt
        where edt.user_id = p_user_id
          and edt.purged_at is null
          and edt.purge_after > timezone('utc', now())
          and (
            edt.client_event_id = input.client_event_id
            or (
              input.reminder_uuid is not null
              and public.user_event_reminder_uuid(edt.client_event_id) = input.reminder_uuid
            )
          )
      )
      or (
        input.reminder_uuid is not null
        and not exists (
          select 1
          from public.reminders r
          where r.user_id = p_user_id
            and r.id = input.reminder_uuid
        )
        and not exists (
          select 1
          from public.scheduled_notifications sn
          where sn.user_id = p_user_id
            and sn.is_active = true
            and sn.client_event_id = input.client_event_id
        )
      )
    )
  from input
$$;

create or replace function public.purge_old_event_deletion_trash()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  -- If an old trash marker survived while the raw event row also survived,
  -- remove the raw row before removing the hidden trash marker. The delete
  -- trigger will archive that raw row again, keeping client-safe suppression
  -- intact for another retention window instead of allowing a ghost to refile.
  delete from public.user_events ue
  using public.event_deletion_trash edt
  where edt.purge_after <= timezone('utc', now())
    and edt.purged_at is null
    and ue.user_id = edt.user_id
    and ue.client_event_id = edt.client_event_id;

  with deleted as (
    delete from public.event_deletion_trash edt
    where edt.purge_after <= timezone('utc', now())
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.reconcile_event_filing_backbone(
  p_limit integer default 50000
)
returns table (
  orphan_reminder_events_deleted integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 50000), 1);
begin
  with candidates as (
    select ue.id
    from public.user_events ue
    where public.user_event_reminder_uuid(ue.client_event_id) is not null
      and not exists (
        select 1
        from public.reminders r
        where r.user_id = ue.user_id
          and r.id = public.user_event_reminder_uuid(ue.client_event_id)
      )
      and not exists (
        select 1
        from public.scheduled_notifications sn
        where sn.user_id = ue.user_id
          and sn.is_active = true
          and sn.client_event_id = ue.client_event_id
      )
    order by ue.created_at nulls last, ue.id
    limit v_limit
  ),
  deleted as (
    delete from public.user_events ue
    using candidates c
    where ue.id = c.id
    returning 1
  )
  select count(*)::integer
  into orphan_reminder_events_deleted
  from deleted;

  return next;
end;
$$;

revoke all on function public.user_event_reminder_uuid(text) from public;
grant execute on function public.user_event_reminder_uuid(text) to authenticated;
grant execute on function public.user_event_reminder_uuid(text) to service_role;

revoke all on function public.reconcile_event_filing_backbone(integer) from public;
grant execute on function public.reconcile_event_filing_backbone(integer) to service_role;

comment on function public.user_event_reminder_uuid(text) is
'Extracts the canonical reminder UUID from reminder materialized event client ids such as reminder:<uuid>:<date> and reminder:rule:<uuid>.';

comment on function public.reconcile_event_filing_backbone(integer) is
'Repeatable filing reconciliation job. Removes orphan materialized reminder events whose backing reminder row and active notification no longer exist.';

select * from public.reconcile_event_filing_backbone(50000);

notify pgrst, 'reload schema';
