-- Refactor the existing security-invoker owner without another filing renderer,
-- data store, API, classification rule, or ownership resolver.
do $migration$
declare
  original text := pg_get_viewdef('public.user_event_filing_items_client'::regclass, true);
  revised text;
begin
  -- Lifecycle has only active/inactive for nondeleted rows. Filtering by its
  -- canonical deletion predicate avoids evaluating date/timezone presentation
  -- for every rejected row before the caller's page limit can be applied.
  revised := regexp_replace(
    original,
    'WHERE lifecycle <> ''deleted''::text;\s*$',
    'WHERE is_deleted = false;'
  );
  if revised = original then
    raise exception 'Unrecognized canonical filing deletion predicate';
  end if;

  execute 'create or replace view public.user_event_filing_items_client '
    || 'with (security_invoker = true) as ' || revised;
end;
$migration$;
