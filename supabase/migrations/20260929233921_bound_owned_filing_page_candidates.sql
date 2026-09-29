begin;

-- Preserve the filing view as classification and RLS authority. Bound the raw
-- candidates before evaluating its expensive projections. Continue scanning
-- until the requested number of classified rows has been found, including
-- across batches of deleted/nonmatching events; LIMIT is never a coverage cap.
create or replace function public.get_owned_filing_page_v1(
  p_kind text,
  p_offset integer default 0,
  p_limit integer default 50,
  p_starts_on_or_after timestamptz default null
)
returns setof public.user_event_filing_items_client
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_candidates uuid[];
  v_base_offset integer := 0;
  v_seen integer := 0;
  v_returned integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_row public.user_event_filing_items_client%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('note', 'reminder', 'flow') then
    raise exception 'invalid filing kind' using errcode = '22023';
  end if;
  loop
    select array_agg(candidate.id order by candidate.starts_at desc, candidate.id desc)
      into v_candidates
    from (
      select ue.id, ue.starts_at
      from public.user_events ue
      where ue.user_id = v_uid
        and (p_starts_on_or_after is null or ue.starts_at >= p_starts_on_or_after)
      order by ue.starts_at desc, ue.id desc
      limit 100 offset v_base_offset
    ) candidate;
    if coalesce(cardinality(v_candidates), 0) = 0 then return; end if;
    for v_row in
      select filed.*
      from public.user_event_filing_items_client filed
      where filed.id = any(v_candidates)
        and filed.user_id = v_uid
        and filed.item_kind = p_kind
      order by filed.starts_at desc, filed.id desc
    loop
      if v_seen >= v_offset then
        return next v_row;
        v_returned := v_returned + 1;
        if v_returned >= v_limit then return; end if;
      end if;
      v_seen := v_seen + 1;
    end loop;
    v_base_offset := v_base_offset + cardinality(v_candidates);
    if cardinality(v_candidates) < 100 then return; end if;
  end loop;
end;
$$;
revoke all on function public.get_owned_filing_page_v1(text, integer, integer, timestamptz) from public, anon;
grant execute on function public.get_owned_filing_page_v1(text, integer, integer, timestamptz) to authenticated;
comment on function public.get_owned_filing_page_v1(text, integer, integer, timestamptz) is
  'Ordered, complete owned filing pages. Bounded candidates reuse the security-invoker filing view and preserve classification, deletion, sharing and offset semantics.';
notify pgrst, 'reload schema';
commit;
