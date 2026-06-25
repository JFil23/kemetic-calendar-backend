create or replace function public.get_community_rhythm_rollups(
  p_local_date date default current_date,
  p_privacy_threshold integer default 3
)
returns table (
  metric text,
  count_label text,
  is_thresholded boolean,
  sort_order integer
)
language sql
security definer
stable
set search_path = public
as $$
  with args as (
    select
      coalesce(p_local_date, current_date) as local_date,
      greatest(coalesce(p_privacy_threshold, 3), 3) as privacy_threshold
  ),
  decan_window as (
    select
      local_date,
      local_date - 9 as starts_on
    from args
  ),
  raw_counts as (
    select
      'flow_steps_completed'::text as metric,
      count(distinct uec.user_id)::bigint as raw_count,
      1 as sort_order
    from public.user_event_completions uec
    join args on true
    where uec.completed_on = args.local_date

    union all

    select
      'flows_began'::text as metric,
      count(distinct f.user_id)::bigint as raw_count,
      2 as sort_order
    from public.flows f
    join args on true
    where f.start_date = args.local_date
      and public.flow_is_calendar_placed(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      )

    union all

    select
      'reflections_recorded'::text as metric,
      count(distinct je.user_id)::bigint as raw_count,
      3 as sort_order
    from public.journal_entries je
    join decan_window dw on true
    where je.greg_date between dw.starts_on and dw.local_date
      and btrim(coalesce(je.body, '')) <> ''

    union all

    select
      'insight_fragments_shared'::text as metric,
      count(distinct ip.user_id)::bigint as raw_count,
      4 as sort_order
    from public.insight_posts ip
    join public.profiles p on p.id = ip.user_id
    join args on true
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and (ip.created_at at time zone 'UTC')::date = args.local_date
  )
  select
    raw_counts.metric,
    case
      when raw_counts.raw_count >= args.privacy_threshold
        then raw_counts.raw_count::text
      when raw_counts.raw_count > 0
        then 'a few'
      else null
    end as count_label,
    raw_counts.raw_count > 0
      and raw_counts.raw_count < args.privacy_threshold as is_thresholded,
    raw_counts.sort_order
  from raw_counts
  cross join args
  order by raw_counts.sort_order;
$$;

comment on function public.get_community_rhythm_rollups(date, integer) is
'Privacy-preserving aggregate counts for Today''s Commons. Returns display labels only; exact sub-threshold counts and user ids are never returned.';

revoke all on function public.get_community_rhythm_rollups(date, integer) from public;
revoke all on function public.get_community_rhythm_rollups(date, integer) from anon;
grant execute on function public.get_community_rhythm_rollups(date, integer) to authenticated;

notify pgrst, 'reload schema';
