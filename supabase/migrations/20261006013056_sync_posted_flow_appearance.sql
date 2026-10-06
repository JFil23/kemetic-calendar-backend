begin;

-- Published content remains a snapshot; only its appearance follows the exact
-- source flow owned by the post author. Both triggers retain the caller's RLS.
create or replace function private.normalize_posted_flow_appearance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_appearance jsonb;
begin
  if new.flow_id is null then return new; end if;

  if tg_op = 'INSERT' then
    -- Serialize publishing with an appearance save. Without this lock, an
    -- uncommitted post could be missed by the source's projection update.
    select f.appearance into source_appearance
      from public.flows f
     where f.id = new.flow_id and f.user_id = new.user_id
     for share;
  else
    -- UPDATE already owns the post row lock. The source projection takes that
    -- same lock, so a caption write either sees its committed appearance or is
    -- followed by the source's projection. Taking the flow lock here would
    -- invert that order and introduce a post/flow deadlock.
    select f.appearance into source_appearance
      from public.flows f
     where f.id = new.flow_id and f.user_id = new.user_id;
  end if;
  if not found then return new; end if;
  if coalesce(new.ai_metadata #> '{payload,appearance}', 'null'::jsonb)
       = coalesce(source_appearance, 'null'::jsonb) then return new; end if;

  if (new.ai_metadata is not null and jsonb_typeof(new.ai_metadata) <> 'object')
     or (new.ai_metadata -> 'payload' is not null
         and jsonb_typeof(new.ai_metadata -> 'payload') not in ('object', 'null')) then
    raise exception 'FLOW_POST_PAYLOAD_INVALID' using errcode = '22023';
  end if;
  new.ai_metadata := jsonb_set(
    coalesce(new.ai_metadata, '{}'::jsonb), '{payload}',
    jsonb_set(coalesce(nullif(new.ai_metadata -> 'payload', 'null'::jsonb), '{}'::jsonb),
      '{appearance}', coalesce(source_appearance, 'null'::jsonb), true), true);
  return new;
end;
$$;
revoke all on function private.normalize_posted_flow_appearance()
  from public, anon, authenticated;

create or replace function private.sync_posted_flow_appearance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A single source UPDATE acknowledges both the owned flow and all of its
  -- owned posts. No schedule, caption, engagement or unrelated metadata write.
  -- Leave malformed JSON intact for the BEFORE normalizer to reject with the
  -- domain error, before jsonb_set could fail or silently replace a scalar.
  update public.flow_posts fp
     set ai_metadata = case
       when (fp.ai_metadata is not null and jsonb_typeof(fp.ai_metadata) <> 'object')
         or (fp.ai_metadata -> 'payload' is not null
             and jsonb_typeof(fp.ai_metadata -> 'payload') not in ('object', 'null'))
       then fp.ai_metadata
       else jsonb_set(
       coalesce(fp.ai_metadata, '{}'::jsonb), '{payload}',
       jsonb_set(coalesce(nullif(fp.ai_metadata -> 'payload', 'null'::jsonb), '{}'::jsonb),
         '{appearance}', coalesce(new.appearance, 'null'::jsonb), true), true) end
   where fp.flow_id = new.id and fp.user_id = new.user_id
     and coalesce(fp.ai_metadata #> '{payload,appearance}', 'null'::jsonb)
       is distinct from coalesce(new.appearance, 'null'::jsonb);
  return new;
end;
$$;
revoke all on function private.sync_posted_flow_appearance()
  from public, anon, authenticated;

drop trigger if exists normalize_posted_flow_appearance on public.flow_posts;
create trigger normalize_posted_flow_appearance
before insert or update of ai_metadata, flow_id, user_id on public.flow_posts
for each row execute function private.normalize_posted_flow_appearance();

drop trigger if exists sync_posted_flow_appearance on public.flows;
create trigger sync_posted_flow_appearance
after update of appearance on public.flows
for each row when (old.appearance is distinct from new.appearance)
execute function private.sync_posted_flow_appearance();

-- Repair previously posted photos using only the exact source/author pair.
-- Rerunning this bounded projection changes no already-matching post.
update public.flow_posts fp
   set ai_metadata = case
       when (fp.ai_metadata is not null and jsonb_typeof(fp.ai_metadata) <> 'object')
         or (fp.ai_metadata -> 'payload' is not null
             and jsonb_typeof(fp.ai_metadata -> 'payload') not in ('object', 'null'))
       then fp.ai_metadata
       else jsonb_set(
     coalesce(fp.ai_metadata, '{}'::jsonb), '{payload}',
     jsonb_set(coalesce(nullif(fp.ai_metadata -> 'payload', 'null'::jsonb), '{}'::jsonb),
       '{appearance}', coalesce(f.appearance, 'null'::jsonb), true), true) end
  from public.flows f
 where fp.flow_id = f.id and fp.user_id = f.user_id
   and coalesce(fp.ai_metadata #> '{payload,appearance}', 'null'::jsonb)
     is distinct from coalesce(f.appearance, 'null'::jsonb);

comment on function private.sync_posted_flow_appearance() is
'Owner-authorized appearance projection only; published flow content, direct shares and imported flows remain independent snapshots.';

commit;
