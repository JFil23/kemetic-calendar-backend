create or replace function public.user_event_recently_deleted(
  p_user_id uuid,
  p_client_event_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_event_id text := nullif(btrim(coalesce(p_client_event_id, '')), '');
  v_reminder_uuid uuid;
  v_series_key text;
  v_rule_key text;
begin
  if p_user_id is null or v_client_event_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.event_deletion_trash edt
    where edt.user_id = p_user_id
      and edt.client_event_id = v_client_event_id
      and edt.purged_at is null
      and edt.purge_after > timezone('utc', now())
      and edt.suppresses_client = true
  ) then
    return true;
  end if;

  v_reminder_uuid := public.user_event_reminder_uuid(v_client_event_id);
  if v_reminder_uuid is null then
    return false;
  end if;

  v_series_key := 'reminder:' || v_reminder_uuid::text;
  v_rule_key := 'reminder:rule:' || v_reminder_uuid::text;

  if exists (
    select 1
    from public.event_deletion_trash edt
    where edt.user_id = p_user_id
      and edt.client_event_id in (v_series_key, v_rule_key)
      and edt.purged_at is null
      and edt.purge_after > timezone('utc', now())
      and edt.suppresses_client = true
  ) then
    return true;
  end if;

  if public.user_event_has_active_reminder_flow_for_occurrence(
    p_user_id,
    v_client_event_id
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.reminders r
    where r.user_id = p_user_id
      and r.id = v_reminder_uuid
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.scheduled_notifications sn
    where sn.user_id = p_user_id
      and sn.is_active = true
      and sn.client_event_id = v_client_event_id
  ) then
    return false;
  end if;

  return true;
end;
$$;
revoke all on function public.user_event_recently_deleted(uuid, text) from public;
grant execute on function public.user_event_recently_deleted(uuid, text) to anon;
grant execute on function public.user_event_recently_deleted(uuid, text) to authenticated;
grant execute on function public.user_event_recently_deleted(uuid, text) to service_role;
comment on function public.user_event_recently_deleted(uuid, text) is
'Returns true when an event has an active tombstone. Implemented in PL/pgSQL so non-reminder event filing checks short-circuit before reminder-flow reconciliation.';
notify pgrst, 'reload schema';
