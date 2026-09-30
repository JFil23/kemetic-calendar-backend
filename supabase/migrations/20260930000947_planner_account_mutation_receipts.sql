-- Revisions also advance for older clients that still write the tables directly.
alter table public.alignment_notes add column planner_revision bigint not null default 1;
alter table public.nutrition_items add column planner_revision bigint not null default 1;
create function public.bump_planner_revision() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin new.planner_revision := old.planner_revision + 1; return new; end;
$$;
revoke all on function public.bump_planner_revision() from public,anon;
create trigger alignment_notes_revision before update on public.alignment_notes
  for each row execute function public.bump_planner_revision();
create trigger nutrition_items_revision before update on public.nutrition_items
  for each row execute function public.bump_planner_revision();

-- Existing Planner tables remain authoritative. Receipts make retry after a
-- lost response idempotent and preserve conflicting edits in the account.
create table public.planner_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  kind text not null check (kind in ('notes', 'nutrition')),
  record_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (user_id, mutation_id)
);
alter table public.planner_mutation_receipts enable row level security;
create policy planner_mutation_receipts_owner on public.planner_mutation_receipts
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update on public.planner_mutation_receipts to authenticated;
revoke all on public.planner_mutation_receipts from anon;
create index planner_mutation_unresolved_idx
  on public.planner_mutation_receipts(user_id, created_at)
  where resolved_at is null and result->>'status' = 'conflict';

create function public.apply_planner_mutation_v1(
  p_account_id uuid, p_mutation_id uuid, p_kind text, p_record_id uuid, p_change jsonb,
  p_expected_revision bigint default null,
  p_delete boolean default false, p_resolves uuid default null
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_table text;
  v_before jsonb;
  v_after jsonb;
  v_request jsonb;
  v_result jsonb;
  v_receipt public.planner_mutation_receipts%rowtype;
  v_allowed text[];
  v_columns text;
  v_assignments text;
  v_select text;
begin
  if v_uid is null or p_account_id is distinct from v_uid then raise exception 'Not authenticated' using errcode='42501'; end if;
  if p_mutation_id is null or p_record_id is null or p_kind is null
    or p_delete is null or p_change is null or jsonb_typeof(p_change) <> 'object' then
    raise exception 'Invalid mutation' using errcode='22023';
  end if;
  if p_kind = 'notes' then
    v_table := 'alignment_notes';
    v_allowed := array['body','position'];
  elsif p_kind = 'nutrition' then
    v_table := 'nutrition_items';
    v_allowed := array['nutrient','source','purpose','mode','days_of_week',
      'decan_days','repeat','time_h','time_m','alert_offset_minutes','enabled'];
  else
    raise exception 'Invalid Planner kind' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_change) k where not k=any(v_allowed)) then
    raise exception 'Invalid Planner fields' using errcode='22023';
  end if;
  v_request := jsonb_build_object('account_id',p_account_id,'kind',p_kind,'record_id',p_record_id,
    'change',p_change,'expected_revision',p_expected_revision,
    'delete',p_delete,'resolves',p_resolves);
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||p_mutation_id::text,0));
  select * into v_receipt from public.planner_mutation_receipts
    where user_id=v_uid and mutation_id=p_mutation_id;
  if found then
    if v_receipt.request <> v_request then
      raise exception 'Mutation identity reused with different content' using errcode='22023';
    end if;
    return v_receipt.result;
  end if;
  -- Serializes competing creates as well as locking existing rows against old clients.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||p_kind||p_record_id::text,1));
  execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2 for update',v_table)
    into v_before using p_record_id,v_uid;
  if (v_before is null and p_expected_revision is not null and not p_delete)
    or (v_before is not null and (p_expected_revision is null
      or (v_before->>'planner_revision')::bigint <> p_expected_revision)) then
    v_result := jsonb_build_object('status','conflict','row',v_before);
  elsif p_delete then
    execute format('delete from public.%I where id=$1 and user_id=$2',v_table)
      using p_record_id,v_uid;
    v_result := jsonb_build_object('status','applied','row',null);
  else
    v_after := coalesce(v_before, jsonb_build_object('position',0,'repeat',true,'enabled',true))
      || p_change || jsonb_build_object('id',p_record_id,'user_id',v_uid);
    if v_before is null then
      select string_agg(format('%I',c),','),string_agg(format('r.%I',c),',')
        into v_columns,v_select from unnest(array['id','user_id']||v_allowed) c;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r returning to_jsonb(%I)',
        v_table,v_columns,v_select,v_table,v_table) into v_after using v_after;
    else
      select string_agg(format('%I=r.%I',c,c),',') into v_assignments from unnest(v_allowed) c;
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=$2 and t.user_id=$3 returning to_jsonb(t)',
        v_table,v_assignments,v_table) into v_after using v_after,p_record_id,v_uid;
    end if;
    v_result := jsonb_build_object('status','applied','row',v_after);
  end if;
  v_result := v_result || jsonb_build_object('mutation_id',p_mutation_id);
  insert into public.planner_mutation_receipts(user_id,mutation_id,kind,record_id,request,result)
    values(v_uid,p_mutation_id,p_kind,p_record_id,v_request,v_result);
  if p_resolves is not null and v_result->>'status'='applied' then
    update public.planner_mutation_receipts set resolved_at=now()
      where user_id=v_uid and mutation_id=p_resolves and kind=p_kind and record_id=p_record_id;
  end if;
  return v_result;
end;
$$;
revoke all on function public.apply_planner_mutation_v1(uuid,uuid,text,uuid,jsonb,bigint,boolean,uuid) from public,anon;
grant execute on function public.apply_planner_mutation_v1(uuid,uuid,text,uuid,jsonb,bigint,boolean,uuid) to authenticated;
notify pgrst, 'reload schema';

-- Reuse the existing journal badge representation, but replace its former
-- separate DELETE/INSERT requests with one account-fenced transaction.
create function public.sync_planner_nutrition_state_v1(
  p_account_id uuid, p_item_id uuid, p_date date, p_state text,
  p_title text, p_details text
) returns void
language plpgsql security invoker set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_event text:='planner-nutrition:'||p_date::text||':'||p_item_id::text;
begin
  if v_uid is null or p_account_id is distinct from v_uid then
    raise exception 'Not authenticated' using errcode='42501';
  end if;
  if p_date is null or p_state is null or p_state not in ('pending','done','partial','skipped') then
    raise exception 'Invalid nutrition state' using errcode='22023';
  end if;
  if not exists(select 1 from public.nutrition_items where id=p_item_id and user_id=v_uid) then
    raise exception 'Save the nutrition source to your account first' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||v_event,2));
  delete from public.journal_badges where user_id=v_uid and event_id=v_event;
  if p_state<>'pending' then
    insert into public.journal_badges(user_id,badge_id,event_id,title,details,tags,occurred_on)
      values(v_uid,v_event,v_event,p_title,p_details,array['planner','kind:nutrition','state:'||p_state],p_date);
  end if;
end;
$$;
revoke all on function public.sync_planner_nutrition_state_v1(uuid,uuid,date,text,text,text) from public,anon;
grant execute on function public.sync_planner_nutrition_state_v1(uuid,uuid,date,text,text,text) to authenticated;
notify pgrst,'reload schema';

-- Immutable per-device legacy checkmark backups belong to the account, too.
-- Recovery is separate from current journal truth: stale backups must not
-- automatically resurrect checkmarks removed on a different device.
create table public.planner_legacy_recovery (
  user_id uuid not null references auth.users(id) on delete cascade,
  backup_id uuid not null,
  kind text not null check (kind = 'nutrition_checkmarks'),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, backup_id)
);
alter table public.planner_legacy_recovery enable row level security;
create policy planner_legacy_recovery_owner on public.planner_legacy_recovery
  to authenticated using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id);
revoke all on public.planner_legacy_recovery from authenticated;
grant select,insert on public.planner_legacy_recovery to authenticated;
revoke all on public.planner_legacy_recovery from anon;
notify pgrst,'reload schema';
