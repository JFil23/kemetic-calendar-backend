begin;
-- Shared Journal acknowledgement and decan source ownership. Additive to V2
-- paragraphs: older documents and legacy generated reflections remain readable.
alter table public.journal_entries add column if not exists revision bigint not null default 1;
create table public.journal_document_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  greg_date date not null,
  revision bigint not null,
  primary key(user_id, greg_date)
);
alter table public.journal_document_versions enable row level security;
create policy journal_versions_owner_read on public.journal_document_versions
  for select to authenticated using ((select auth.uid())=user_id);
grant select on public.journal_document_versions to authenticated;
revoke all on public.journal_document_versions from anon;
insert into public.journal_document_versions(user_id,greg_date,revision)
  select user_id,greg_date,revision from public.journal_entries;

create table public.journal_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,mutation_id)
);
alter table public.journal_mutation_receipts enable row level security;
create policy journal_receipts_owner on public.journal_mutation_receipts
  for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert on public.journal_mutation_receipts to authenticated;
revoke all on public.journal_mutation_receipts from anon;
create index journal_mutation_recovery_idx on public.journal_mutation_receipts(user_id, (request->>'date'), created_at desc)
 where result->>'status'='conflict';

alter table public.decan_reflections add column if not exists review_context jsonb;
alter table public.decan_reflections add column if not exists review_revision bigint not null default 0;
alter table public.decan_reflections add constraint decan_review_shape check (
  review_context is null or coalesce((
    review_context->>'schema'='1' and jsonb_typeof(review_context->'moments')='array'
    and jsonb_array_length(review_context->'moments')<=3
    and length(review_context->>'question') between 1 and 500
    and jsonb_typeof(review_context->'question_id')='string'
    and decan_end=decan_start+9
  ),false)
);
create policy decan_review_update_owner on public.decan_reflections
  for update to authenticated using ((select auth.uid())=user_id and review_context is not null)
  with check ((select auth.uid())=user_id and review_context is not null);
grant select,insert,update on public.decan_reflections to authenticated;

create function private.decan_review_revision_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.review_context is not null then
  if new.user_id<>old.user_id or new.decan_start<>old.decan_start or new.decan_end<>old.decan_end then
   raise exception 'Review period identity is immutable' using errcode='22023'; end if;
  if current_setting('haw.decan_review_mutation',true) is distinct from new.user_id::text then
   raise exception 'Use the revisioned decan reviewer' using errcode='40001'; end if;
  new.review_revision:=old.review_revision+1;
 elsif new.review_context is not null then new.review_revision:=1;
 end if;
 return new;
end $$;
revoke all on function private.decan_review_revision_v1() from public,anon,authenticated;
create trigger decan_review_revision_v1 before insert or update on public.decan_reflections
 for each row execute function private.decan_review_revision_v1();

create table public.decan_journal_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  reflection_id uuid not null references public.decan_reflections(id) on delete cascade,
  greg_date date not null,
  block_id text not null,
  is_deleted boolean not null default false,
  primary key(user_id,reflection_id)
);
create index decan_journal_sources_date_idx on public.decan_journal_sources(user_id,greg_date);
alter table public.decan_journal_sources enable row level security;
create policy decan_journal_sources_owner on public.decan_journal_sources for all to authenticated
  using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id and exists (
    select 1 from public.decan_reflections r where r.id=reflection_id and r.user_id=(select auth.uid()) and r.review_context is not null));
grant select,insert,update on public.decan_journal_sources to authenticated;
revoke all on public.decan_journal_sources from anon;

create or replace function private.journal_document_revision_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := coalesce(new.user_id,old.user_id);
  v_date date := coalesce(new.greg_date,old.greg_date);
  v_revision bigint;
  v_body jsonb;
  v_old_body jsonb;
  v_source public.decan_journal_sources%rowtype;
  v_old_blocks jsonb;
  v_new_blocks jsonb;
begin
  -- A date and account are the stable document identity. Moves are explicit
  -- copy/delete operations, never an update which escapes the revision fence.
  if tg_op='UPDATE' and (new.user_id<>old.user_id or new.greg_date<>old.greg_date) then
    raise exception 'Journal document identity is immutable' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('journal:'||v_user::text||':'||v_date::text,0));
  -- INSERT ... ON CONFLICT runs both BEFORE triggers. An existing date is
  -- checked and revisioned by the UPDATE trigger; do not mutate the ledger or
  -- source tombstones during its speculative insert (including DO NOTHING).
  if tg_op='INSERT' and exists(select 1 from public.journal_entries j where j.user_id=v_user and j.greg_date=v_date) then
    return new;
  end if;
  -- Older app versions may edit ordinary writing on the same day. Preserve
  -- linked paragraphs exactly, including their source metadata; reject stale
  -- whole-document writes and resurrection after either paragraph or row deletion.
  begin v_body:=new.body::jsonb; exception when invalid_text_representation then v_body:=null; end;
  if current_setting('haw.journal_mutation',true) is distinct from v_user::text then
    begin v_old_body:=old.body::jsonb; exception when invalid_text_representation then v_old_body:=null; end;
    for v_source in select * from public.decan_journal_sources s where s.user_id=v_user and s.greg_date=v_date loop
      select coalesce(jsonb_agg(b),'[]'::jsonb) into v_new_blocks
        from jsonb_array_elements(case when jsonb_typeof(v_body->'blocks')='array' then v_body->'blocks' else '[]'::jsonb end) b
        where b->>'id'=v_source.block_id;
      if v_source.is_deleted then
        if jsonb_array_length(v_new_blocks)>0 then
          raise exception 'Restore this reflection in an updated app' using errcode='40001';
        end if;
      else
        select coalesce(jsonb_agg(b),'[]'::jsonb) into v_old_blocks
          from jsonb_array_elements(case when jsonb_typeof(v_old_body->'blocks')='array' then v_old_body->'blocks' else '[]'::jsonb end) b
          where b->>'id'=v_source.block_id;
        if tg_op<>'UPDATE' or jsonb_array_length(v_old_blocks)<>1 or v_new_blocks is distinct from v_old_blocks
          or (v_body->'meta'->'decan_sources'->v_source.reflection_id::text) is distinct from
             (v_old_body->'meta'->'decan_sources'->v_source.reflection_id::text) then
          raise exception 'Refresh this reflection in an updated app before changing it' using errcode='40001';
        end if;
      end if;
    end loop;
  end if;
  insert into public.journal_document_versions(user_id,greg_date,revision) values(v_user,v_date,1)
    on conflict(user_id,greg_date) do update set revision=public.journal_document_versions.revision+1
    returning revision into v_revision;
  if tg_op='DELETE' then
    update public.decan_journal_sources set is_deleted=true where user_id=v_user and greg_date=v_date;
    return old;
  end if;
  new.revision:=v_revision;
  -- Missing linked paragraphs are tombstoned, not recreated by future refreshes.
  begin v_body:=new.body::jsonb; exception when invalid_text_representation then v_body:='{}'::jsonb; end;
  update public.decan_journal_sources s set is_deleted=not exists(
    select 1 from jsonb_array_elements(coalesce(v_body->'blocks','[]'::jsonb)) b where b->>'id'=s.block_id
  ) where s.user_id=v_user and s.greg_date=v_date;
  return new;
end $$;
revoke all on function private.journal_document_revision_v1() from public,anon,authenticated;
create trigger journal_document_revision_v1 before insert or update or delete on public.journal_entries
  for each row execute function private.journal_document_revision_v1();

create function public.read_journal_state_v1(p_account uuid,p_date date)
returns jsonb language plpgsql security invoker stable set search_path='' as $$
begin
  if auth.uid() is null or auth.uid()<>p_account then raise insufficient_privilege; end if;
  return jsonb_build_object('revision',coalesce((select revision from public.journal_document_versions where user_id=p_account and greg_date=p_date),0),
    'row',(select to_jsonb(j) from public.journal_entries j where user_id=p_account and greg_date=p_date),
    'recovery',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from (
      select mutation_id,length(request->>'body') as character_count,created_at from public.journal_mutation_receipts
       where user_id=p_account and request->>'date'=p_date::text and result->>'status'='conflict'
       and request->>'body' is not null order by created_at desc limit 3
    ) d),'[]'::jsonb));
end $$;
revoke all on function public.read_journal_state_v1(uuid,date) from public,anon;
grant execute on function public.read_journal_state_v1(uuid,date) to authenticated;

create function public.apply_journal_mutation_v1(p_account uuid,p_mutation uuid,p_date date,p_expected_revision bigint,
  p_body text,p_meta jsonb default '{}'::jsonb,p_category text default null,p_delete boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request jsonb; v_receipt public.journal_mutation_receipts%rowtype;
  v_row public.journal_entries%rowtype; v_revision bigint; v_result jsonb;
begin
  if auth.uid() is null or auth.uid()<>p_account then raise insufficient_privilege; end if;
  if p_mutation is null or p_date is null or p_expected_revision is null or p_expected_revision<0 or octet_length(p_body)>5242880 then
    raise exception 'Invalid Journal mutation' using errcode='22023'; end if;
  v_request:=jsonb_build_object('date',p_date,'revision',p_expected_revision,'body',p_body,'meta',p_meta,'category',p_category,'delete',p_delete);
  perform pg_advisory_xact_lock(hashtextextended('journal-mutation:'||p_account::text||':'||p_mutation::text,0));
  select * into v_receipt from public.journal_mutation_receipts where user_id=p_account and mutation_id=p_mutation;
  if found then
    if v_receipt.request<>v_request then raise exception 'Mutation identity reused' using errcode='22023'; end if;
    return v_receipt.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('journal:'||p_account::text||':'||p_date::text,0));
  select * into v_row from public.journal_entries where user_id=p_account and greg_date=p_date for update;
  select coalesce((select revision from public.journal_document_versions where user_id=p_account and greg_date=p_date),0) into v_revision;
  if v_revision<>p_expected_revision then
    v_result:=jsonb_build_object('status','conflict','revision',v_revision,'row',case when v_row.id is null then null else to_jsonb(v_row) end);
  else
    perform set_config('haw.journal_mutation',p_account::text,true);
    if p_delete then
      delete from public.journal_entries where user_id=p_account and greg_date=p_date;
      select coalesce((select revision from public.journal_document_versions where user_id=p_account and greg_date=p_date),0) into v_revision;
      v_result:=jsonb_build_object('status','applied','revision',v_revision,'row',null);
    else
      if p_body is null then raise exception 'Journal body required' using errcode='22023'; end if;
      if v_row.id is null then
        insert into public.journal_entries(user_id,greg_date,body,meta,category) values(p_account,p_date,p_body,coalesce(p_meta,'{}'),p_category) returning * into v_row;
      else
        update public.journal_entries set body=p_body,meta=coalesce(meta,'{}')||coalesce(p_meta,'{}'),category=coalesce(p_category,category)
          where id=v_row.id returning * into v_row;
      end if;
      v_result:=jsonb_build_object('status','applied','revision',v_row.revision,'row',to_jsonb(v_row));
    end if;
    perform set_config('haw.journal_mutation','',true);
  end if;
  insert into public.journal_mutation_receipts(user_id,mutation_id,request,result) values(p_account,p_mutation,v_request,v_result);
  return v_result;
end $$;
revoke all on function public.apply_journal_mutation_v1(uuid,uuid,date,bigint,text,jsonb,text,boolean) from public,anon;
grant execute on function public.apply_journal_mutation_v1(uuid,uuid,date,bigint,text,jsonb,text,boolean) to authenticated;

create table public.decan_review_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,mutation_id)
);
alter table public.decan_review_mutation_receipts enable row level security;
create policy decan_review_receipts_owner on public.decan_review_mutation_receipts for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert on public.decan_review_mutation_receipts to authenticated;
revoke all on public.decan_review_mutation_receipts from anon;


create index decan_review_recovery_idx on public.decan_review_mutation_receipts
 (user_id, (coalesce(request->>'reflection',request->>'id')), created_at desc)
 where result->>'status' in ('conflict','source_changed');
create function public.read_decan_recovery_v1(p_account uuid,p_reflection uuid)
returns jsonb language plpgsql security invoker stable set search_path='' as $$
begin
 if auth.uid() is null or auth.uid()<>p_account then raise insufficient_privilege; end if;
 return coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from (
   select mutation_id,request,created_at from public.decan_review_mutation_receipts
    where user_id=p_account and coalesce(request->>'reflection',request->>'id')=p_reflection::text
    and result->>'status' in ('conflict','source_changed') order by created_at desc limit 3
 ) d),'[]'::jsonb);
end $$;
revoke all on function public.read_decan_recovery_v1(uuid,uuid) from public,anon;
grant execute on function public.read_decan_recovery_v1(uuid,uuid) to authenticated;

create function public.apply_decan_review_v1(p_account uuid,p_mutation uuid,p_id uuid,p_start date,p_end date,
  p_name text,p_context jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request jsonb; v_receipt public.decan_review_mutation_receipts%rowtype;
 v_row public.decan_reflections%rowtype; v_result jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_account then raise insufficient_privilege; end if;
 if p_end<>p_start+9 or p_id is null or p_mutation is null or p_expected_revision is null or p_expected_revision<0
   or p_context is null or p_context->>'schema' is distinct from '1' or octet_length(p_context::text)>65536 then
   raise exception 'Invalid decan review' using errcode='22023'; end if;
 v_request:=jsonb_build_object('kind','review','id',p_id,'start',p_start,'end',p_end,'name',p_name,'context',p_context,'revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('decan-mutation:'||p_account::text||':'||p_mutation::text,0));
 select * into v_receipt from public.decan_review_mutation_receipts where user_id=p_account and mutation_id=p_mutation;
 if found then
   if v_receipt.request<>v_request then raise exception 'Mutation identity reused' using errcode='22023'; end if;
   return v_receipt.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('decan:'||p_account::text||':'||p_start::text,0));
 select * into v_row from public.decan_reflections where user_id=p_account and decan_start=p_start for update;
 if (v_row.id is not null and (v_row.id<>p_id or v_row.review_context is null)) or coalesce(v_row.review_revision,0)<>p_expected_revision then
   v_result:=jsonb_build_object('status','conflict','row',to_jsonb(v_row));
 else
   perform set_config('haw.decan_review_mutation',p_account::text,true);
   if v_row.id is null then
     insert into public.decan_reflections(id,user_id,decan_start,decan_end,decan_name,reflection_text,badge_count,review_context,review_revision)
       values(p_id,p_account,p_start,p_end,p_name,p_context->>'question',0,p_context,1) returning * into v_row;
   else
     update public.decan_reflections set review_context=p_context,review_revision=review_revision+1,reflection_text=p_context->>'question'
       where id=p_id and user_id=p_account returning * into v_row;
   end if;
   perform set_config('haw.decan_review_mutation','',true);
   v_result:=jsonb_build_object('status','applied','row',to_jsonb(v_row));
 end if;
 insert into public.decan_review_mutation_receipts(user_id,mutation_id,request,result) values(p_account,p_mutation,v_request,v_result);
 return v_result;
end $$;
revoke all on function public.apply_decan_review_v1(uuid,uuid,uuid,date,date,text,jsonb,bigint) from public,anon;
grant execute on function public.apply_decan_review_v1(uuid,uuid,uuid,date,date,text,jsonb,bigint) to authenticated;

create function public.apply_decan_journal_v1(p_account uuid,p_mutation uuid,p_reflection uuid,p_date date,
 p_expected_revision bigint,p_words text,p_restore boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_review public.decan_reflections%rowtype; v_source public.decan_journal_sources%rowtype;
 v_entry public.journal_entries%rowtype; v_doc jsonb; v_blocks jsonb; v_block jsonb;
 v_result jsonb; v_block_id text:='decan_reflection:'||p_reflection::text;
 v_receipt public.decan_review_mutation_receipts%rowtype; v_request jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_account then raise insufficient_privilege; end if;
 if length(btrim(p_words)) not between 1 and 12000 or p_words is null or p_mutation is null then
   raise exception 'Write a reflection before saving' using errcode='22023'; end if;
 v_request:=jsonb_build_object('kind','journal','reflection',p_reflection,'date',p_date,'revision',p_expected_revision,'words',p_words,'restore',p_restore);
 perform pg_advisory_xact_lock(hashtextextended('decan-mutation:'||p_account::text||':'||p_mutation::text,0));
 select * into v_receipt from public.decan_review_mutation_receipts where user_id=p_account and mutation_id=p_mutation;
 if found then
   if v_receipt.request<>v_request then raise exception 'Mutation identity reused' using errcode='22023'; end if;
   return v_receipt.result;
 end if;
 select * into strict v_review from public.decan_reflections where id=p_reflection and user_id=p_account and review_context is not null;
 perform pg_advisory_xact_lock(hashtextextended('decan-source:'||p_account::text||':'||p_reflection::text,0));
 select * into v_source from public.decan_journal_sources where user_id=p_account and reflection_id=p_reflection;
 if v_source.reflection_id is not null and (v_source.greg_date<>p_date or (v_source.is_deleted and not p_restore)) then
   v_result:=jsonb_build_object('status','source_changed','source',to_jsonb(v_source));
   insert into public.decan_review_mutation_receipts(user_id,mutation_id,request,result) values(p_account,p_mutation,v_request,v_result);
   return v_result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('journal:'||p_account::text||':'||p_date::text,0));
 select * into v_entry from public.journal_entries where user_id=p_account and greg_date=p_date;
 begin v_doc:=v_entry.body::jsonb; exception when invalid_text_representation then v_doc:=null; end;
 if v_doc is null or jsonb_typeof(v_doc->'blocks') is distinct from 'array' then
   v_doc:=jsonb_build_object('version',1,'blocks',case when coalesce(v_entry.body,'')='' then '[]'::jsonb else
     jsonb_build_array(jsonb_build_object('id','legacy:'||v_entry.id::text,'type','paragraph','ops',jsonb_build_array(jsonb_build_object('insert',v_entry.body)))) end,'meta','{}'::jsonb);
 end if;
 v_block:=jsonb_build_object('id',v_block_id,'type','paragraph','ops',jsonb_build_array(jsonb_build_object('insert',p_words)));
 select coalesce(jsonb_agg(case when b->>'id'=v_block_id then v_block else b end order by pos),'[]'::jsonb) into v_blocks
   from jsonb_array_elements(v_doc->'blocks') with ordinality as parts(b,pos);
 if not exists(select 1 from jsonb_array_elements(v_blocks) b where b->>'id'=v_block_id) then v_blocks:=v_blocks||jsonb_build_array(v_block); end if;
 v_doc:=jsonb_set(v_doc,'{blocks}',v_blocks);
 v_doc:=jsonb_set(v_doc,'{meta}',coalesce(v_doc->'meta','{}')||jsonb_build_object('decan_sources',coalesce(v_doc->'meta'->'decan_sources','{}')||
   jsonb_build_object(p_reflection::text,jsonb_build_object('block_id',v_block_id,'question',v_review.review_context->>'question',
    'start',v_review.decan_start,'end',v_review.decan_end,'name',v_review.decan_name,
    'days',(select coalesce(jsonb_agg(distinct (m->>'occurred_on')::date-v_review.decan_start+1),'[]'::jsonb)
      from jsonb_array_elements(v_review.review_context->'moments') m
      where m->>'occurred_on' is not null and (m->>'occurred_on')::date between v_review.decan_start and v_review.decan_end)))));
 v_result:=public.apply_journal_mutation_v1(p_account,p_mutation,p_date,p_expected_revision,v_doc::text,'{}',null,false);
 if v_result->>'status'='applied' then
   insert into public.decan_journal_sources(user_id,reflection_id,greg_date,block_id,is_deleted) values(p_account,p_reflection,p_date,v_block_id,false)
     on conflict(user_id,reflection_id) do update set is_deleted=false;
 end if;
 insert into public.decan_review_mutation_receipts(user_id,mutation_id,request,result) values(p_account,p_mutation,v_request,v_result);
 return v_result;
end $$;
revoke all on function public.apply_decan_journal_v1(uuid,uuid,uuid,date,bigint,text,boolean) from public,anon;
grant execute on function public.apply_decan_journal_v1(uuid,uuid,uuid,date,bigint,text,boolean) to authenticated;
alter table public.insight_posts alter column insight_entry_id drop not null;
alter table public.insight_posts alter column node_id drop not null;
alter table public.insight_posts add column source_kind text not null default 'library';
alter table public.insight_posts add column source_reflection_id uuid;
alter table public.insight_posts add column question_text text;
alter table public.insight_posts add column reading_link jsonb;
alter table public.insight_posts add column revision bigint not null default 1;
alter table public.insight_posts add constraint insight_post_source_shape check (
 (source_kind='library' and insight_entry_id is not null and node_id is not null and source_reflection_id is null)
 or (source_kind='decan' and insight_entry_id is null and node_id is null and source_reflection_id is not null)
);
create unique index insight_posts_decan_source_idx on public.insight_posts(user_id,source_reflection_id) where source_kind='decan';

-- The reverse block row is intentionally not exposed to the blocked account.
-- This narrowly scoped private predicate authorizes only the current viewer.
create function private.can_view_decan_post(p_author uuid)
returns boolean language sql security definer stable set search_path='' as $$
 select auth.uid() is not null and (auth.uid()=p_author or not exists(
  select 1 from public.user_blocks b where
   (b.blocker_user_id=auth.uid() and b.blocked_user_id=p_author)
   or (b.blocked_user_id=auth.uid() and b.blocker_user_id=p_author)))
$$;
revoke all on function private.can_view_decan_post(uuid) from public,anon;
grant execute on function private.can_view_decan_post(uuid) to authenticated,anon;
create policy decan_posts_member_audience on public.insight_posts as restrictive for select
  using (source_kind<>'decan' or (auth.uid() is not null and private.can_view_decan_post(user_id)));

create function private.decan_post_revision_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.source_kind='decan' and auth.uid() is not null then
   raise exception 'Use the acknowledged reflection removal' using errcode='42501';
  end if;
  return old;
 end if;
 if tg_op='UPDATE' then
  if new.source_kind<>old.source_kind or new.user_id<>old.user_id or new.source_reflection_id is distinct from old.source_reflection_id then
   raise exception 'Post source is immutable' using errcode='22023'; end if;
  new.revision:=old.revision+1;
 else new.revision:=1;
 end if;
 if new.source_kind='decan' and current_setting('haw.decan_post_mutation',true) is distinct from new.user_id::text then
  raise exception 'Use the reviewed reflection publisher' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function private.decan_post_revision_v1() from public,anon,authenticated;
create trigger decan_post_revision_v1 before insert or update or delete on public.insight_posts
  for each row execute function private.decan_post_revision_v1();

create function public.apply_decan_post_v1(p_account uuid,p_mutation uuid,p_post uuid,p_reflection uuid,
 p_expected_revision bigint,p_body text,p_include_question boolean,p_reading_slug text,p_date date,p_remove boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_review public.decan_reflections%rowtype; v_post public.insight_posts%rowtype;
 v_receipt public.decan_review_mutation_receipts%rowtype; v_request jsonb; v_result jsonb; v_reading jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_account then raise insufficient_privilege; end if;
 if p_mutation is null or p_post is null or p_date is null or p_expected_revision is null or p_expected_revision<0
   or (not p_remove and (p_body is null or length(btrim(p_body)) not between 1 and 12000)) then
   raise exception 'Invalid reflection post' using errcode='22023'; end if;
 v_request:=jsonb_build_object('kind','post','id',p_post,'reflection',p_reflection,'revision',p_expected_revision,
   'body',p_body,'question',p_include_question,'reading',p_reading_slug,'date',p_date,'remove',p_remove);
 perform pg_advisory_xact_lock(hashtextextended('decan-mutation:'||p_account::text||':'||p_mutation::text,0));
 select * into v_receipt from public.decan_review_mutation_receipts where user_id=p_account and mutation_id=p_mutation;
 if found then
   if v_receipt.request<>v_request then raise exception 'Mutation identity reused' using errcode='22023'; end if;
   return v_receipt.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('decan-post:'||p_account::text||':'||p_reflection::text,0));
 select * into v_post from public.insight_posts where source_kind='decan' and source_reflection_id=p_reflection and user_id=p_account for update;
 select * into v_review from public.decan_reflections where id=p_reflection and user_id=p_account and review_context is not null;
 if v_post.id is null and v_review.id is null then raise insufficient_privilege; end if;
 if coalesce(v_post.revision,0)<>p_expected_revision or (v_post.id is not null and (v_post.id<>p_post or v_post.is_hidden)) then
   v_result:=jsonb_build_object('status','conflict','row',case when v_post.id is null then null else to_jsonb(v_post) end);
 else
   if p_reading_slug is not null then
    select jsonb_build_object('slug',slug,'title',title) into strict v_reading from public.nodes where slug=p_reading_slug;
   end if;
   perform set_config('haw.decan_post_mutation',p_account::text,true);
   if p_remove then
    if v_post.id is null then raise exception 'Post no longer exists' using errcode='22023'; end if;
    update public.insight_posts set is_hidden=true where id=p_post and user_id=p_account returning * into v_post;
   elsif v_post.id is null then
    insert into public.insight_posts(id,user_id,source_kind,source_reflection_id,body_text,entry_date,question_text,reading_link)
      values(p_post,p_account,'decan',p_reflection,p_body,p_date,
       case when p_include_question then coalesce(v_review.review_context->>'question',v_post.question_text) else null end,v_reading) returning * into v_post;
   else
    update public.insight_posts set body_text=p_body,question_text=case when p_include_question then coalesce(v_review.review_context->>'question',v_post.question_text) else null end,
      reading_link=v_reading where id=p_post and user_id=p_account returning * into v_post;
   end if;
   perform set_config('haw.decan_post_mutation','',true);
   v_result:=jsonb_build_object('status','applied','row',to_jsonb(v_post));
 end if;
 insert into public.decan_review_mutation_receipts(user_id,mutation_id,request,result) values(p_account,p_mutation,v_request,v_result);
 return v_result;
end $$;
revoke all on function public.apply_decan_post_v1(uuid,uuid,uuid,uuid,bigint,text,boolean,text,date,boolean) from public,anon;
grant execute on function public.apply_decan_post_v1(uuid,uuid,uuid,uuid,bigint,text,boolean,text,date,boolean) to authenticated;

-- Extend the existing bounded feed owner; its flow ranking is unchanged.
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
  with
  args as (
    select
      greatest(1, least(coalesce(p_limit, 24), 48)) as limit_rows,
      greatest(0, coalesce(p_offset, 0)) as offset_rows,
      auth.uid() as viewer_id
  ),
  recent_flows as (
    select
      jsonb_build_object(
        'post_type', 'flow',
        'id', fp.id,
        'user_id', fp.user_id,
        'flow_id', fp.flow_id,
        'name', fp.name,
        'color', fp.color,
        'notes', fp.notes,
        'rules', fp.rules,
        'start_date', fp.start_date,
        'end_date', fp.end_date,
        'ai_metadata', private.social_flow_post_card_metadata(fp.ai_metadata),
        'insight_entry_id', null,
        'node_slug', null,
        'node_title', null,
        'node_glyph', null,
        'body_text', null,
        'entry_date', null,
        'is_hidden', fp.is_hidden,
        'created_at', fp.created_at,
        'updated_at', fp.updated_at,
        'author_handle', p.handle,
        'author_display_name', p.display_name,
        'author_avatar_url', p.avatar_url,
        'author_avatar_glyphs', p.avatar_glyphs,
        'likes_count', coalesce(likes.likes_count, 0),
        'comments_count', coalesce(comments.comments_count, 0),
        'liked_by_me', coalesce(viewer_like.liked_by_me, false),
        'score', (
          case
            when fp.user_id = args.viewer_id then 6.5
            when following.is_following then 4.0
            else 0.0
          end
          + least(
              coalesce(likes.likes_count, 0) * 0.18
                + coalesce(comments.comments_count, 0) * 0.42,
              4.5
            )
          + exp(
              - greatest(
                  extract(epoch from (timezone('utc', now()) - fp.created_at))
                    / 3600.0,
                  0.0
                ) / 72.0
            ) * 5.5
        ),
        'is_following_author', following.is_following
      ) as item,
      (
        case
          when fp.user_id = args.viewer_id then 6.5
          when following.is_following then 4.0
          else 0.0
        end
        + least(
            coalesce(likes.likes_count, 0) * 0.18
              + coalesce(comments.comments_count, 0) * 0.42,
            4.5
          )
        + exp(
            - greatest(
                extract(epoch from (timezone('utc', now()) - fp.created_at))
                  / 3600.0,
                0.0
              ) / 72.0
          ) * 5.5
      )::numeric as score,
      fp.created_at,
      fp.id
    from public.flow_posts fp
    join public.profiles p on p.id = fp.user_id
    join args on true
    left join lateral (
      select count(*)::integer as likes_count
      from public.flow_post_likes l
      where l.flow_post_id = fp.id
    ) likes on true
    left join lateral (
      select count(*)::integer as comments_count
      from public.flow_post_comments c
      where c.flow_post_id = fp.id
    ) comments on true
    left join lateral (
      select true as liked_by_me
      from public.flow_post_likes l
      where l.flow_post_id = fp.id
        and l.user_id = args.viewer_id
      limit 1
    ) viewer_like on true
    left join lateral (
      select exists(
        select 1
        from public.follows f
        where f.follower_id = args.viewer_id
          and f.followee_id = fp.user_id
      ) as is_following
    ) following on true
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = fp.user_id
      )
    order by fp.created_at desc
    limit (select (limit_rows + offset_rows) * 3 from args)
  ),
  recent_insights as (
    select
      jsonb_build_object(
        'post_type', 'insight',
        'id', ip.id,
        'user_id', ip.user_id,
        'flow_id', null,
        'name', null,
        'color', null,
        'notes', null,
        'rules', null,
        'start_date', null,
        'end_date', null,
        'ai_metadata', null,
        'insight_entry_id', ip.insight_entry_id,
        'source_kind', ip.source_kind,
        'source_reflection_id', ip.source_reflection_id,
        'question_text', ip.question_text,
        'reading_link', ip.reading_link,
        'revision', ip.revision,
        'node_slug', n.slug,
        'node_title', n.title,
        'node_glyph', n.glyph,
        'body_text', ip.body_text,
        'entry_date', ip.entry_date,
        'is_hidden', ip.is_hidden,
        'created_at', ip.created_at,
        'updated_at', ip.updated_at,
        'author_handle', p.handle,
        'author_display_name', p.display_name,
        'author_avatar_url', p.avatar_url,
        'author_avatar_glyphs', p.avatar_glyphs,
        'likes_count', 0,
        'comments_count', 0,
        'liked_by_me', null,
        'score', (
          case
            when ip.user_id = args.viewer_id then 6.5
            when following.is_following then 4.0
            else 0.0
          end
          + exp(
              - greatest(
                  extract(epoch from (timezone('utc', now()) - ip.created_at))
                    / 3600.0,
                  0.0
                ) / 72.0
            ) * 5.1
        ),
        'is_following_author', following.is_following
      ) as item,
      (
        case
          when ip.user_id = args.viewer_id then 6.5
          when following.is_following then 4.0
          else 0.0
        end
        + exp(
            - greatest(
                extract(epoch from (timezone('utc', now()) - ip.created_at))
                  / 3600.0,
                0.0
              ) / 72.0
          ) * 5.1
      )::numeric as score,
      ip.created_at,
      ip.id
    from public.insight_posts ip
    join public.profiles p on p.id = ip.user_id
    left join public.nodes n on n.id = ip.node_id
    join args on true
    left join lateral (
      select exists(
        select 1
        from public.follows f
        where f.follower_id = args.viewer_id
          and f.followee_id = ip.user_id
      ) as is_following
    ) following on true
    where coalesce(ip.is_hidden, false) = false
      and (ip.source_kind <> 'decan' or private.can_view_decan_post(ip.user_id))
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = ip.user_id
      )
    order by ip.created_at desc
    limit (select (limit_rows + offset_rows) * 3 from args)
  ),
  ranked as (
    select item, score, created_at, id from recent_flows
    union all
    select item, score, created_at, id from recent_insights
  ),
  author_ranked as (
    select
      item,
      score,
      created_at,
      id,
      row_number() over (
        partition by item ->> 'user_id'
        order by score desc, created_at desc, id desc
      ) as author_sequence
    from ranked
  ),
  page as (
    select item, score, created_at, id, author_sequence
    from author_ranked
    order by author_sequence asc, score desc, created_at desc, id desc
    limit (select limit_rows from args)
    offset (select offset_rows from args)
  )
  select coalesce(
    jsonb_agg(
      item
      order by author_sequence asc, score desc, created_at desc, id desc
    ),
    '[]'::jsonb
  )
  from page;
$$;


commit;
