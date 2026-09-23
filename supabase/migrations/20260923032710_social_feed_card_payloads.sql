create or replace function private.social_flow_post_card_metadata(
  p_ai_metadata jsonb
)
returns jsonb
language sql
immutable
set search_path = public, private
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'shared_note', nullif(
        btrim(
          coalesce(
            p_ai_metadata ->> 'shared_note',
            p_ai_metadata #>> '{payload,shared_note}'
          )
        ),
        ''
      ),
      'payload', jsonb_strip_nulls(
        jsonb_build_object(
          'shared_note', nullif(
            btrim(
              coalesce(
                p_ai_metadata #>> '{payload,shared_note}',
                p_ai_metadata ->> 'shared_note'
              )
            ),
            ''
          ),
          'appearance', p_ai_metadata #> '{payload,appearance}'
        )
      )
    )
  );
$$;

comment on function private.social_flow_post_card_metadata(jsonb) is
  'Returns only the caption and appearance required to render a social feed card. Full flow snapshots stay available through the post-detail query.';

create or replace function public.get_profile_feed_cards(
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language sql
security definer
stable
set search_path = public, private
as $$
  with feed_rows as (
    select *
    from public.get_profile_feed(p_limit, p_offset)
  )
  select coalesce(
    jsonb_agg(
      (to_jsonb(feed_rows) - 'ai_metadata')
        || jsonb_build_object(
          'ai_metadata',
          private.social_flow_post_card_metadata(feed_rows.ai_metadata)
        )
      order by feed_rows.score desc, feed_rows.created_at desc, feed_rows.id desc
    ),
    '[]'::jsonb
  )
  from feed_rows;
$$;

comment on function public.get_profile_feed_cards(integer, integer) is
  'Ranked mixed social feed with card-sized flow metadata. Use getFlowPostById for the complete saved-flow snapshot.';

create or replace function public.get_commons_home_cards(
  p_local_date date default current_date,
  p_question_id text default '',
  p_question_text text default '',
  p_limit integer default 12
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, private
as $$
declare
  v_home jsonb;
  v_discover jsonb;
begin
  v_home := public.get_commons_home(
    p_local_date,
    p_question_id,
    p_question_text,
    p_limit
  );

  select coalesce(
    jsonb_agg(
      case
        when item ->> 'post_type' = 'flow' then
          (item - 'ai_metadata')
            || jsonb_build_object(
              'ai_metadata',
              private.social_flow_post_card_metadata(item -> 'ai_metadata')
            )
        else item
      end
      order by item ->> 'created_at' desc
    ),
    '[]'::jsonb
  )
    into v_discover
  from jsonb_array_elements(coalesce(v_home -> 'discover', '[]'::jsonb)) item;

  return jsonb_set(v_home, '{discover}', v_discover, true);
end;
$$;

comment on function public.get_commons_home_cards(date, text, text, integer) is
  'Commons home payload with full rhythm, questions, and Reading House rooms, plus card-sized Discover metadata.';

revoke all on function public.get_profile_feed_cards(integer, integer) from public;
revoke all on function public.get_commons_home_cards(date, text, text, integer) from public;
grant execute on function public.get_profile_feed_cards(integer, integer) to authenticated;
grant execute on function public.get_commons_home_cards(date, text, text, integer) to authenticated;

notify pgrst, 'reload schema';
