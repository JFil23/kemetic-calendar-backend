-- Local disposable database only. All fixtures/assertions roll back.
begin;
create or replace function pg_temp.require(ok boolean, message text)
returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end;
$$;
create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;
insert into auth.users(id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000fa01', 'appearance-owner@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000fa02', 'appearance-viewer@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000fa03', 'appearance-editor@example.test', 'authenticated', 'authenticated');
insert into public.profiles(id, email, handle, display_name, is_discoverable) values
  ('00000000-0000-4000-8000-00000000fa01', 'appearance-owner@example.test', 'appearanceowner', 'Appearance owner', true),
  ('00000000-0000-4000-8000-00000000fa02', 'appearance-viewer@example.test', 'appearanceviewer', 'Appearance viewer', true),
  ('00000000-0000-4000-8000-00000000fa03', 'appearance-editor@example.test', 'appearanceeditor', 'Appearance editor', true);
insert into public.shared_calendars(id, owner_id, name) values
  ('10000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-00000000fa01', 'Appearance fixture');
insert into public.shared_calendar_members(calendar_id, user_id, role, status) values
  ('10000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-00000000fa01', 'owner', 'accepted'),
  ('10000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-00000000fa03', 'editor', 'accepted');
insert into public.flows(id, user_id, calendar_id, name, notes, rules, appearance) values
  (99006001, '00000000-0000-4000-8000-00000000fa01', '10000000-0000-4000-8000-00000000fa01',
   'Source flow', 'Preserved overview', '[{"server_extension":{"opaque":true}}]',
   '{"image_object_path":"00000000-0000-4000-8000-00000000fa01/a.jpg","accent_argb":4291234567}'),
  (99006002, '00000000-0000-4000-8000-00000000fa01', '10000000-0000-4000-8000-00000000fa01',
   'Independent saved copy', 'Copy overview', '[]', '{"image_object_path":"owned-copy.jpg"}');
update public.flows set origin_type = 'profile_import', origin_flow_id = 99006001 where id = 99006002;
insert into public.user_events(user_id, calendar_id, client_event_id, title, starts_at, ends_at, flow_local_id) values
  ('00000000-0000-4000-8000-00000000fa01', '10000000-0000-4000-8000-00000000fa01',
   'appearance-event-one', 'Original title one', '2026-10-05T12:00:00Z', '2026-10-05T12:30:00Z', 99006001),
  ('00000000-0000-4000-8000-00000000fa01', '10000000-0000-4000-8000-00000000fa01',
   'appearance-event-two', 'Original title two', '2026-10-06T13:00:00Z', '2026-10-06T14:00:00Z', 99006001);
insert into public.flow_shares(id, flow_id, sender_id, recipient_id, channel, payload_json) values
  ('30000000-0000-4000-8000-00000000fa01', 99006001, '00000000-0000-4000-8000-00000000fa01',
   '00000000-0000-4000-8000-00000000fa02', 'in_app', '{"events":[{"title":"Shared snapshot"}],"opaque":true}');
insert into public.flow_posts(id, user_id, flow_id, name, color, notes, rules, start_date, end_date, is_hidden, ai_metadata) values
  ('20000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-00000000fa01', 99006001,
   'Published name', 123, 'Published overview', '[{"published_rule":true}]', '2026-10-05', '2026-10-06', false,
   '{"shared_note":"Caption","opaque":{"nested":[1,2]},"payload":{"name":"Snapshot name","events":[{"title":"Snapshot title","start_time":"12:00 PM"}],"shared_note":"Caption","unknown":42,"appearance":{"image_object_path":"stale.jpg"}}}'),
  ('20000000-0000-4000-8000-00000000fa02', '00000000-0000-4000-8000-00000000fa01', 99006001,
   'Second publication', 456, 'Second overview', '[]', null, null, true, '{"payload":{"events":[],"unknown":"retained"}}'),
  ('20000000-0000-4000-8000-00000000fa03', '00000000-0000-4000-8000-00000000fa02', 99006001,
   'Different author', 789, null, '[]', null, null, false, '{"payload":{"appearance":{"image_object_path":"other-author.jpg"}}}'),
  ('20000000-0000-4000-8000-00000000fa04', '00000000-0000-4000-8000-00000000fa01', 99006999,
   'Deleted source snapshot', 321, null, '[]', null, null, false, '{"payload":{"appearance":{"image_object_path":"historical.jpg"}}}');
insert into public.flow_post_likes(flow_post_id, user_id) values
  ('20000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-00000000fa02');
insert into public.flow_post_comments(flow_post_id, user_id, body) values
  ('20000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-00000000fa02', 'Retain the discussion');
insert into storage.objects(bucket_id, name) values
  ('flow-appearance-images', '00000000-0000-4000-8000-00000000fa01/a.jpg'),
  ('flow-appearance-images', '00000000-0000-4000-8000-00000000fa01/b.jpg');
create temp table original_events as select id, to_jsonb(e) as data from public.user_events e where flow_local_id = 99006001;
create temp table original_posts as select id, to_jsonb(p) - 'updated_at' as data from public.flow_posts p where id::text like '%fa0%';
create temp table original_independent as
  select 'copy' as kind, to_jsonb(f) as data from public.flows f where id = 99006002
  union all select 'share', to_jsonb(s) from public.flow_shares s where id = '30000000-0000-4000-8000-00000000fa01';
create temp table original_social as
  select 'like' as kind, to_jsonb(l) as data from public.flow_post_likes l where flow_post_id = '20000000-0000-4000-8000-00000000fa01'
  union all select 'comment', to_jsonb(c) from public.flow_post_comments c where flow_post_id = '20000000-0000-4000-8000-00000000fa01';
grant select on original_posts to authenticated;

-- The regular owner's existing source UPDATE is the only app mutation.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa01');
update public.flows set appearance = '{"image_object_path":"00000000-0000-4000-8000-00000000fa01/b.jpg","accent_argb":4287654321}' where id = 99006001;
select pg_temp.require((select count(*) = 2 and bool_and(ai_metadata #> '{payload,appearance}' =
  '{"image_object_path":"00000000-0000-4000-8000-00000000fa01/b.jpg","accent_argb":4287654321}')
  from public.flow_posts where flow_id = 99006001 and user_id = auth.uid()), 'Both owned posts must change atomically');
reset role;
select pg_temp.require((select bool_and(
  (to_jsonb(p) - 'updated_at') #- '{ai_metadata,payload,appearance}' = o.data #- '{ai_metadata,payload,appearance}')
  from public.flow_posts p join original_posts o using(id)), 'Appearance save changed published content, identity, captions or unknown metadata');
select pg_temp.require((select count(*) = 2 and bool_and(to_jsonb(e) = o.data) from public.user_events e join original_events o using(id)),
  'Appearance save changed exact scheduled events');
select pg_temp.require((select rules = '[{"server_extension":{"opaque":true}}]' and notes = 'Preserved overview' from public.flows where id = 99006001),
  'Appearance save changed raw source rules or overview');
select pg_temp.require((select to_jsonb(f) = o.data from public.flows f join original_independent o on o.kind = 'copy' where f.id = 99006002)
  and (select to_jsonb(s) = o.data from public.flow_shares s join original_independent o on o.kind = 'share' where s.id = '30000000-0000-4000-8000-00000000fa01'),
  'Direct share or imported flow changed');
select pg_temp.require((select bool_and(to_jsonb(l) = o.data) from public.flow_post_likes l join original_social o on o.kind = 'like' where flow_post_id = '20000000-0000-4000-8000-00000000fa01')
  and (select bool_and(to_jsonb(c) = o.data) from public.flow_post_comments c join original_social o on o.kind = 'comment' where flow_post_id = '20000000-0000-4000-8000-00000000fa01'), 'Engagement changed');
select pg_temp.require((select bool_and(to_jsonb(p) - 'updated_at' = o.data) from public.flow_posts p join original_posts o using(id)
  where p.id in ('20000000-0000-4000-8000-00000000fa03', '20000000-0000-4000-8000-00000000fa04')), 'Other-author or deleted-source snapshot changed');

-- A cold viewer sees the same canonical object through post/feed + Storage RLS.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa02');
select pg_temp.require(exists(select 1 from storage.objects where bucket_id = 'flow-appearance-images'
  and name = '00000000-0000-4000-8000-00000000fa01/b.jpg'), 'Viewer cannot read newly posted image');
select pg_temp.require(exists(select 1 from jsonb_array_elements(public.get_profile_feed_together_cards(48,0)) item
  where item->>'id' = '20000000-0000-4000-8000-00000000fa01'
    and item #>> '{ai_metadata,payload,appearance,image_object_path}' = '00000000-0000-4000-8000-00000000fa01/b.jpg'), 'Timeline still returns previous appearance');
update public.flow_posts set ai_metadata = '{}' where id = '20000000-0000-4000-8000-00000000fa01';
reset role;
select pg_temp.require((select ai_metadata #>> '{payload,appearance,image_object_path}' = '00000000-0000-4000-8000-00000000fa01/b.jpg' from public.flow_posts where id = '20000000-0000-4000-8000-00000000fa01'), 'Another account updated the owner post');

-- Old clients send stale whole metadata when editing a caption; never restore A.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa01');
update public.flow_posts set ai_metadata = jsonb_set((select data->'ai_metadata' from original_posts where id = '20000000-0000-4000-8000-00000000fa01'),
  '{shared_note}', '"New caption"') where id = '20000000-0000-4000-8000-00000000fa01';
select pg_temp.require((select ai_metadata->>'shared_note' = 'New caption'
  and ai_metadata #>> '{payload,appearance,image_object_path}' = '00000000-0000-4000-8000-00000000fa01/b.jpg' from public.flow_posts where id = '20000000-0000-4000-8000-00000000fa01'), 'Stale caption write resurrected old photo');
update public.flows set appearance = null where id = 99006001;
select pg_temp.require((select count(*) = 2 and bool_and(ai_metadata #> '{payload,appearance}' = 'null'::jsonb) from public.flow_posts where flow_id = 99006001 and user_id = auth.uid()), 'Image removal did not reach every owned post');
update public.flow_posts set ai_metadata = (select data->'ai_metadata' from original_posts where id = '20000000-0000-4000-8000-00000000fa01') where id = '20000000-0000-4000-8000-00000000fa01';
select pg_temp.require((select ai_metadata #> '{payload,appearance}' = 'null'::jsonb from public.flow_posts where id = '20000000-0000-4000-8000-00000000fa01'), 'Stale caption write resurrected removed photo');
reset role;

-- Removing the posted object withdraws its public-read grant while the old
-- direct-share image remains readable through that independent snapshot.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa02');
select pg_temp.require(not exists(select 1 from storage.objects where bucket_id = 'flow-appearance-images'
  and name = '00000000-0000-4000-8000-00000000fa01/b.jpg'), 'Removed post image remains public');
select pg_temp.require(exists(select 1 from storage.objects where bucket_id = 'flow-appearance-images'
  and name = '00000000-0000-4000-8000-00000000fa01/a.jpg'), 'Independent share lost its image access');
reset role;
-- Actual deletion of a source does not erase its published snapshot.
insert into public.flow_posts(id,user_id,flow_id,name,ai_metadata) values
  ('20000000-0000-4000-8000-00000000fa05','00000000-0000-4000-8000-00000000fa01',99006002,
   'Retained after deletion','{"payload":{"events":[{"title":"History"}]}}');
delete from public.flows where id = 99006002;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa01');
update public.flow_posts set ai_metadata = jsonb_set(ai_metadata, '{shared_note}', '"Historical caption"')
  where id = '20000000-0000-4000-8000-00000000fa05';
select pg_temp.require((select ai_metadata #>> '{payload,appearance,image_object_path}' = 'owned-copy.jpg'
  and ai_metadata #>> '{payload,events,0,title}' = 'History' from public.flow_posts
  where id = '20000000-0000-4000-8000-00000000fa05'), 'Deleted-source caption update lost its snapshot');
reset role;

-- Same-value or unrelated source writes never rewrite existing post rows.
create temp table post_versions as select id, ctid::text as version from public.flow_posts where flow_id = 99006001;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa01');
update public.flows set name = 'Changed actual name', appearance = appearance where id = 99006001;
reset role;
select pg_temp.require((select bool_and(p.ctid::text = x.version) from public.flow_posts p join post_versions x using(id)), 'Unrelated source edit rewrote posted snapshots');
-- Calendar editor permission remains unchanged; post writes retain owner RLS.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa03');
update public.flows set appearance = '{"sign_kind":"palm_count"}' where id = 99006001;
reset role;
select pg_temp.require((select appearance = '{"sign_kind":"palm_count"}' from public.flows where id = 99006001), 'Existing calendar editor permission changed');
select pg_temp.require((select bool_and(p.ctid::text = x.version) from public.flow_posts p join post_versions x using(id)), 'Calendar editor gained another author post write');
-- A future malformed linked payload fails atomically instead of silently
-- dropping opaque authored content or acknowledging an unsynchronized save.
alter table public.flow_posts disable trigger normalize_posted_flow_appearance;
update public.flow_posts set ai_metadata = '{"opaque":"retained","payload":42}'
  where id = '20000000-0000-4000-8000-00000000fa02';
alter table public.flow_posts enable trigger normalize_posted_flow_appearance;
create temp table before_invalid_save as select to_jsonb(p) as data from public.flow_posts p where flow_id = 99006001;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000fa01');
do $$ begin
  begin
    update public.flows set appearance = '{"image_object_path":"must-not-commit.jpg"}' where id = 99006001;
    raise exception 'Malformed published payload was silently replaced';
  exception when invalid_parameter_value then
    if sqlerrm <> 'FLOW_POST_PAYLOAD_INVALID' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.require((select appearance = '{"sign_kind":"palm_count"}' from public.flows where id = 99006001), 'Failed projection committed source appearance');
select pg_temp.require(not exists((select to_jsonb(p) from public.flow_posts p where flow_id = 99006001)
  except (select data from before_invalid_save)), 'Failed projection partially changed a post');
select pg_temp.require((select bool_and(not prosecdef) from pg_proc where oid in
  ('private.normalize_posted_flow_appearance()'::regprocedure, 'private.sync_posted_flow_appearance()'::regprocedure)), 'Projection bypasses caller RLS');
select pg_temp.require(not has_function_privilege('authenticated', 'private.sync_posted_flow_appearance()', 'execute')
  and not has_function_privilege('anon', 'private.normalize_posted_flow_appearance()', 'execute'), 'Internal trigger became a public RPC');
rollback;
