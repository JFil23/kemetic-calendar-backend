begin;

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'together-host@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'together-viewer@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'together-outsider@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, email, handle, display_name)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'together-host@example.test', 'together_host', 'Together Host'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'together-viewer@example.test', 'together_viewer', 'Together Viewer'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'together-outsider@example.test', 'together_outsider', 'Together Outsider')
on conflict (id) do update set
  handle = excluded.handle,
  display_name = excluded.display_name;

insert into public.shared_calendars (id, owner_id, name, is_personal)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Together host calendar',
  true
)
on conflict (id) do nothing;

insert into public.flows (
  id,
  user_id,
  calendar_id,
  name,
  active,
  start_date,
  end_date,
  is_hidden
)
values (
  990000001,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'Together source flow',
  true,
  current_date - 2,
  current_date + 20,
  false
)
on conflict (id) do update set active = true, is_hidden = false;

insert into public.user_events (
  id,
  user_id,
  calendar_id,
  client_event_id,
  title,
  detail,
  all_day,
  starts_at,
  ends_at,
  flow_local_id,
  category,
  behavior_payload
)
values
  (
    'f1111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'together-smoke-flow-990000001-day-1',
    'Together day one',
    'Earlier host position',
    true,
    (current_date - 2)::timestamp + interval '8 hours',
    (current_date - 2)::timestamp + interval '9 hours',
    990000001,
    'flow',
    '{}'::jsonb
  ),
  (
    'f2222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'together-smoke-flow-990000001-day-2',
    'Together day two',
    'Earlier host position',
    true,
    (current_date - 1)::timestamp + interval '8 hours',
    (current_date - 1)::timestamp + interval '9 hours',
    990000001,
    'flow',
    '{}'::jsonb
  ),
  (
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'together-smoke-flow-990000001-day-3',
    'Together day three',
    'Host current position',
    true,
    current_date::timestamp + interval '8 hours',
    current_date::timestamp + interval '9 hours',
    990000001,
    'flow',
    '{}'::jsonb
  )
on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  behavior_payload = excluded.behavior_payload;

insert into public.flow_posts (
  id,
  user_id,
  flow_id,
  name,
  color,
  start_date,
  end_date,
  is_hidden
)
values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  990000001,
  'Together source flow',
  5099745,
  current_date - 2,
  current_date + 20,
  false
)
on conflict (id) do update set is_hidden = false;

insert into public.follows (follower_id, followee_id)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
)
on conflict do nothing;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $test$
begin
  perform public.request_together_on_flow_post(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  );
  raise exception 'expected MUTUAL_FOLLOW_REQUIRED';
exception
  when others then
    if sqlerrm not like '%MUTUAL_FOLLOW_REQUIRED%' then
      raise;
    end if;
end;
$test$;

reset role;
insert into public.follows (follower_id, followee_id)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
)
on conflict do nothing;

set local role authenticated;

do $test$
declare
  v_card jsonb;
begin
  select item
    into v_card
  from jsonb_array_elements(
    public.get_profile_feed_together_cards(48, 0)
  ) item
  where item ->> 'id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  if coalesce((v_card ->> 'viewer_can_request_together')::boolean, false)
      is not true then
    raise exception 'mutual follower did not receive Together capability: %', v_card;
  end if;
end;
$test$;

do $test$
declare
  v_result jsonb;
begin
  v_result := public.request_together_on_flow_post(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  );
  if v_result ->> 'status' <> 'pending' then
    raise exception 'request was not pending: %', v_result;
  end if;

  if exists (
    select 1
    from public.shared_practice_rooms room
    where room.id = (v_result ->> 'room_id')::uuid
      and (room.calendar_id is not null or room.shared_flow_id is not null)
  ) then
    raise exception 'Together created a forked flow or calendar';
  end if;
end;
$test$;

do $test$
declare
  v_result jsonb;
begin
  v_result := public.cancel_together_request(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  );
  if v_result ->> 'status' <> 'cancelled' then
    raise exception 'request was not cancelled: %', v_result;
  end if;
end;
$test$;

select public.request_together_on_flow_post(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
set local role authenticated;

do $test$
declare
  v_inbox jsonb;
  v_request_id uuid;
  v_response jsonb;
begin
  v_inbox := public.get_together_inbox();
  if jsonb_array_length(v_inbox -> 'join_requests') <> 1 then
    raise exception 'host inbox did not contain one request: %', v_inbox;
  end if;

  v_request_id := (
    v_inbox #>> '{join_requests,0,id}'
  )::uuid;
  v_response := public.respond_to_join_request(v_request_id, 'approved');
  if coalesce((v_response ->> 'policy_prompt_required')::boolean, false)
      is not true then
    raise exception 'second-member policy prompt was not requested: %', v_response;
  end if;
  if (v_response ->> 'member_count')::integer <> 2 then
    raise exception 'accepted member count was not two: %', v_response;
  end if;
  v_inbox := public.get_together_inbox();
  if jsonb_array_length(v_inbox -> 'active_rooms') <> 1
      or v_inbox #>> '{active_rooms,0,member_count}' <> '2' then
    raise exception 'accepted group was not retained in Inbox: %', v_inbox;
  end if;
  if public.get_together_room_for_flow(990000001) is null then
    raise exception 'host Day View could not resolve its Together overlay';
  end if;
end;
$test$;

do $test$
declare
  v_room_id uuid;
  v_access jsonb;
  v_message jsonb;
  v_entry jsonb;
  v_quote jsonb;
  v_snapshot jsonb;
begin
  select room.id
    into v_room_id
  from public.shared_practice_rooms room
  where room.created_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and room.source_flow_id = 990000001
    and room.calendar_id is null
    and room.status = 'active';

  v_access := public.set_shared_practice_access(
    v_room_id,
    'public',
    'anyone'
  );
  if v_access ->> 'visibility' <> 'public'
      or v_access ->> 'request_audience' <> 'anyone' then
    raise exception 'independent access settings were not persisted: %', v_access;
  end if;

  v_message := public.send_shared_practice_message(
    v_room_id,
    'We are keeping day three together.'
  );
  if v_message ->> 'body_text' <> 'We are keeping day three together.'
      or v_message ->> 'host_client_event_id' <>
        'together-smoke-flow-990000001-day-3' then
    raise exception 'group message did not bind to host position: %', v_message;
  end if;

  v_entry := public.upsert_shared_practice_entry(
    v_room_id,
    'together-smoke-flow-990000001-day-3',
    990000001,
    current_date,
    'observed',
    null,
    'private'
  );
  if v_entry ->> 'completion_status' <> 'observed'
      or not exists (
        select 1
        from public.user_event_completions completion
        where completion.user_id =
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
          and completion.client_event_id =
            'together-smoke-flow-990000001-day-3'
          and completion.flow_id = 990000001
          and completion.completed_on = current_date
      ) then
    raise exception 'host completion did not preserve the source flow: %',
      v_entry;
  end if;

  v_quote := public.request_shared_practice_quote_post(
    (v_message ->> 'id')::uuid
  );
  if v_quote ->> 'status' <> 'approved'
      or coalesce((v_quote ->> 'approval_required')::boolean, true) then
    raise exception 'own chat quote was not published directly: %', v_quote;
  end if;

  v_snapshot := public.get_shared_practice_room(v_room_id, current_date);
  if v_snapshot #>> '{today_step,step_index}' <> '3'
      or v_snapshot #>> '{today_step,total_steps}' <> '3'
      or jsonb_array_length(v_snapshot -> 'messages') <> 1
      or v_snapshot #>> '{source_flow,id}' <> '990000001' then
    raise exception 'overlay room did not follow host current flow: %', v_snapshot;
  end if;
end;
$test$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  true
);
set local role authenticated;

do $test$
declare
  v_room_id uuid;
  v_message jsonb;
  v_entry jsonb;
  v_snapshot jsonb;
  v_decisions jsonb;
  v_feed_card jsonb;
begin
  select room.id into v_room_id
  from public.shared_practice_rooms room
  where room.source_flow_id = 990000001
    and room.calendar_id is null
    and room.status = 'active';

  if public.get_together_room_for_flow(990000001) is distinct from v_room_id then
    raise exception 'member Day View did not resolve the accepted overlay';
  end if;

  perform public.set_shared_practice_public_identity(v_room_id, false);
  v_decisions := public.get_together_request_decisions();
  if jsonb_array_length(v_decisions) <> 1
      or v_decisions #>> '{0,status}' <> 'approved' then
    raise exception 'requester did not receive acceptance: %', v_decisions;
  end if;
  perform public.mark_together_request_decision_seen(
    (v_decisions #>> '{0,id}')::uuid
  );
  if jsonb_array_length(public.get_together_request_decisions()) <> 0 then
    raise exception 'seen request decision remained in Inbox';
  end if;

  select item into v_feed_card
  from jsonb_array_elements(
    public.get_profile_feed_together_cards(48, 0)
  ) item
  where item ->> 'id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  if coalesce(
    (v_feed_card ->> 'viewer_can_request_together')::boolean,
    true
  ) then
    raise exception 'group flow still exposed Together in the solo feed: %',
      v_feed_card;
  end if;

  v_message := public.send_shared_practice_message(
    v_room_id,
    'I joined on day three.'
  );
  v_entry := public.upsert_shared_practice_entry(
    v_room_id,
    'together-smoke-flow-990000001-day-3',
    990000001,
    current_date,
    'partial',
    'I kept part of this step.',
    'shared_with_calendar'
  );
  if v_entry ->> 'completion_status' <> 'partial'
      or exists (
        select 1
        from public.user_event_completions completion
        where completion.user_id =
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
          and completion.client_event_id =
            'together-smoke-flow-990000001-day-3'
      ) then
    raise exception 'member progress was not kept independent: %', v_entry;
  end if;
  v_snapshot := public.get_shared_practice_room(v_room_id, current_date);
  if jsonb_array_length(v_snapshot -> 'messages') <> 2
      or v_snapshot #>> '{today_step,step_index}' <> '3' then
    raise exception 'accepted member did not share host position/chat: %', v_snapshot;
  end if;
end;
$test$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
set local role authenticated;

do $test$
declare
  v_quote jsonb;
begin
  v_quote := public.request_shared_practice_quote_post(
    (
      select message.id
      from public.shared_practice_messages message
      where message.user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        and message.body_text = 'I joined on day three.'
      order by message.created_at desc
      limit 1
    )
  );
  if v_quote ->> 'status' <> 'pending'
      or coalesce((v_quote ->> 'approval_required')::boolean, false)
        is not true then
    raise exception 'other-member quote did not require approval: %', v_quote;
  end if;
end;
$test$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  true
);
set local role authenticated;

do $test$
declare
  v_approvals jsonb;
  v_response jsonb;
begin
  v_approvals := public.get_together_quote_approvals();
  if jsonb_array_length(v_approvals) <> 1 then
    raise exception 'quote approval was not routed to Inbox: %', v_approvals;
  end if;
  v_response := public.respond_to_shared_practice_quote_post(
    (v_approvals #>> '{0,id}')::uuid,
    true
  );
  if v_response ->> 'status' <> 'approved' then
    raise exception 'quote approval did not publish: %', v_response;
  end if;
end;
$test$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  true
);
set local role authenticated;

do $test$
declare
  v_room_id uuid;
  v_visible_members integer;
  v_home jsonb;
  v_card jsonb;
  v_request jsonb;
  v_like jsonb;
  v_quote_posts jsonb;
  v_quote_like jsonb;
  v_quote_comment jsonb;
  v_public_quote_authors integer;
  v_private_quote_authors integer;
begin
  select room.id
    into v_room_id
  from public.shared_practice_rooms room
  where room.source_flow_id = 990000001
    and room.calendar_id is null
    and room.status = 'active';

  select count(*)::integer
    into v_visible_members
  from public.shared_practice_room_members member
  where member.room_id = v_room_id;

  if v_visible_members <> 1 then
    raise exception 'public viewer saw non-opted-in member identities: %', v_visible_members;
  end if;

  v_home := public.get_commons_together_home_cards(
    current_date,
    'together-smoke',
    'Together smoke?',
    12
  );
  select item
    into v_card
  from jsonb_array_elements(v_home -> 'public_shared_practices') item
  where item ->> 'id' = v_room_id::text;

  if v_card is null
      or (v_card ->> 'member_count')::integer <> 2
      or jsonb_array_length(v_card -> 'public_members') <> 1
      or coalesce((v_card ->> 'viewer_can_request_join')::boolean, false)
        is not true then
    raise exception 'Commons did not expose the bounded public-group card: %', v_card;
  end if;

  v_request := public.request_join_shared_practice(v_room_id);
  if v_request ->> 'status' <> 'pending' then
    raise exception 'Commons request was not pending: %', v_request;
  end if;
  if public.cancel_join_shared_practice(v_room_id) ->> 'status' <> 'cancelled' then
    raise exception 'Commons request was not cancelled';
  end if;

  v_like := public.toggle_shared_practice_room_like(v_room_id);
  if coalesce((v_like ->> 'liked_by_me')::boolean, false) is not true
      or (v_like ->> 'likes_count')::integer <> 1 then
    raise exception 'Commons like was not created: %', v_like;
  end if;
  v_like := public.toggle_shared_practice_room_like(v_room_id);
  if coalesce((v_like ->> 'liked_by_me')::boolean, true) is not false
      or (v_like ->> 'likes_count')::integer <> 0 then
    raise exception 'Commons like was not removed: %', v_like;
  end if;

  v_quote_posts := public.get_shared_practice_quote_posts(null, 20);
  select
    count(*) filter (
      where coalesce((item ->> 'author_is_public')::boolean, false)
    )::integer,
    count(*) filter (
      where not coalesce((item ->> 'author_is_public')::boolean, false)
    )::integer
    into v_public_quote_authors, v_private_quote_authors
  from jsonb_array_elements(v_quote_posts) item;
  if jsonb_array_length(v_quote_posts) <> 2
      or v_public_quote_authors <> 1
      or v_private_quote_authors <> 1 then
    raise exception 'public quotes did not honor member identity choices: %',
      v_quote_posts;
  end if;

  v_quote_like := public.toggle_shared_practice_quote_like(
    (v_quote_posts #>> '{0,id}')::uuid
  );
  if coalesce((v_quote_like ->> 'liked_by_me')::boolean, false)
      is not true then
    raise exception 'quote like was not created: %', v_quote_like;
  end if;
  v_quote_comment := public.add_shared_practice_quote_comment(
    (v_quote_posts #>> '{0,id}')::uuid,
    'This stayed with me.'
  );
  if v_quote_comment ->> 'body_text' <> 'This stayed with me.' then
    raise exception 'quote comment was not created: %', v_quote_comment;
  end if;
end;
$test$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
set local role authenticated;

select public.set_shared_practice_access(
  (
    select room.id
    from public.shared_practice_rooms room
    where room.source_flow_id = 990000001
      and room.calendar_id is null
      and room.status = 'active'
  ),
  'public',
  'nobody'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  true
);
set local role authenticated;

do $test$
declare
  v_room_id uuid;
begin
  select room.id
    into v_room_id
  from public.shared_practice_rooms room
  where room.source_flow_id = 990000001
    and room.calendar_id is null
    and room.status = 'active';
  if public.shared_practice_can_request_room(v_room_id) then
    raise exception 'nobody request audience exposed request capability';
  end if;

  begin
    perform public.get_shared_practice_room(v_room_id, current_date);
    raise exception 'expected ROOM_NOT_ACCESSIBLE';
  exception
    when others then
      if sqlerrm not like '%ROOM_NOT_ACCESSIBLE%' then
        raise;
      end if;
  end;
end;
$test$;

rollback;
