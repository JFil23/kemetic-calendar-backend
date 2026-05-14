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
  select tombstone_keys.client_event_id is not null
    and (
      exists (
        select 1
        from public.event_deletion_trash edt
        where edt.user_id = p_user_id
          and edt.purged_at is null
          and edt.purge_after > timezone('utc', now())
          and (
            edt.client_event_id = tombstone_keys.client_event_id
            or (
              tombstone_keys.reminder_uuid is not null
              and edt.client_event_id in (
                tombstone_keys.reminder_series_key,
                tombstone_keys.reminder_rule_key
              )
            )
          )
      )
      or (
        tombstone_keys.reminder_uuid is not null
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
    )
  from tombstone_keys
$$;

comment on function public.user_event_recently_deleted(uuid, text) is
'Returns true when a user event has an active delete tombstone. Reminder occurrence tombstones match only the exact occurrence; reminder:<uuid> and reminder:rule:<uuid> tombstones suppress the whole series.';

notify pgrst, 'reload schema';
