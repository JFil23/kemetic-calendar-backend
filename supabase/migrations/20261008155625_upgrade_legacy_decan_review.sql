begin;
-- All app entries now use the authored review. Upgrade an existing generated
-- period through the same acknowledged owner and UUID, without deleting its
-- stored text/provenance or creating a second period. reflection_text remains
-- compatibility history; review_context.question is the active question.
alter policy decan_review_update_owner on public.decan_reflections
  using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id and review_context is not null);

create or replace function private.decan_review_revision_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and (old.review_context is not null or new.review_context is not null) then
  if new.id<>old.id or new.user_id<>old.user_id or new.decan_start<>old.decan_start or new.decan_end<>old.decan_end then
   raise exception 'Review period identity is immutable' using errcode='22023'; end if;
  if current_setting('haw.decan_review_mutation',true) is distinct from new.user_id::text then
   raise exception 'Use the revisioned decan reviewer' using errcode='40001'; end if;
  if new.review_context is null then
   raise exception 'Review context cannot be removed' using errcode='22023'; end if;
  new.review_revision:=old.review_revision+1;
 elsif new.review_context is not null then new.review_revision:=1;
 end if;
 return new;
end $$;
revoke all on function private.decan_review_revision_v1() from public,anon,authenticated;

create or replace function public.apply_decan_review_v1(p_account uuid,p_mutation uuid,p_id uuid,p_start date,p_end date,
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
 if (v_row.id is not null and (v_row.id<>p_id or v_row.decan_end<>p_end)) or coalesce(v_row.review_revision,0)<>p_expected_revision then
   v_result:=jsonb_build_object('status','conflict','row',to_jsonb(v_row));
 else
   perform set_config('haw.decan_review_mutation',p_account::text,true);
   if v_row.id is null then
     insert into public.decan_reflections(id,user_id,decan_start,decan_end,decan_name,reflection_text,badge_count,review_context,review_revision)
       values(p_id,p_account,p_start,p_end,p_name,p_context->>'question',0,p_context,1) returning * into v_row;
   else
     update public.decan_reflections set review_context=p_context,review_revision=review_revision+1
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

commit;
