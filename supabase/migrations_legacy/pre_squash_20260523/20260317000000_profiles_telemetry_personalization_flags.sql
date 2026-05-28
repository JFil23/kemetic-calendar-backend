-- Phase 4: user controls for telemetry and personalization (see docs/phase4-policy.md)
alter table public.profiles
  add column if not exists telemetry_enabled boolean not null default true;

alter table public.profiles
  add column if not exists personalization_enabled boolean not null default true;

comment on column public.profiles.telemetry_enabled is 'When false, client should not send app_events (edits, feedback, etc.). Completions and product behavior unchanged.';
comment on column public.profiles.personalization_enabled is 'When false, do not compute/store flow_outcomes for this user and do not fetch outcome vectors in ai_generate_flow.';

create or replace function public.get_my_telemetry_and_personalization()
returns table(telemetry_enabled boolean, personalization_enabled boolean)
language sql
security definer
set search_path = public
as $$
  select coalesce(p.telemetry_enabled, true), coalesce(p.personalization_enabled, true)
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_telemetry_and_personalization() from public;
grant execute on function public.get_my_telemetry_and_personalization() to authenticated;
grant execute on function public.get_my_telemetry_and_personalization() to service_role;
