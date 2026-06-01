alter table public.profiles
  add column if not exists timezone text;

update public.profiles
set timezone = 'America/Los_Angeles'
where timezone is null;

alter table public.profiles
  alter column timezone set default 'America/Los_Angeles';

alter table public.profiles
  alter column timezone set not null;

comment on column public.profiles.timezone is
  'IANA timezone used for local scheduling of reminders and decan reflections.';
