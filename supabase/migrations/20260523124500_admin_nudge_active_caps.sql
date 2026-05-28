-- Let handled Ma'at nudges remain historical without blocking a new active
-- admin/test delivery in the same decan. Active duplicate protection remains.

create or replace function public.enforce_maat_guidance_delivery_caps()
returns trigger
language plpgsql
as $function$
declare
  existing_active_count integer;
begin
  if new.kind = 'drift_nudge'
    and coalesce(new.status, 'pending') in ('pending', 'shown', 'opened')
  then
    perform pg_advisory_xact_lock(
      hashtext(new.user_id::text || ':' || new.decan_period_key || ':drift_nudge')
    );

    select count(*)
      into existing_active_count
      from public.maat_guidance_deliveries d
     where d.user_id = new.user_id
       and d.decan_period_key = new.decan_period_key
       and d.kind = 'drift_nudge'
       and d.status in ('pending', 'shown', 'opened')
       and d.id is distinct from new.id;

    if existing_active_count >= 2 then
      raise exception 'active drift_nudge cap reached for this decan'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

drop index if exists public.uq_maat_guidance_strength_nudge;

create unique index uq_maat_guidance_strength_nudge
  on public.maat_guidance_deliveries (user_id, decan_period_key)
  where kind = 'strength_nudge'
    and status in ('pending', 'shown', 'opened');
