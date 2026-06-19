-- Allow saved-flow imports to preserve their lineage marker.
alter table public.flows
  drop constraint if exists flows_origin_type_check;

alter table public.flows
  add constraint flows_origin_type_check
  check (
    origin_type is null
    or origin_type in (
      'manual',
      'ai',
      'share_import',
      'profile_import',
      'saved_import',
      'fork',
      'template'
    )
  );
