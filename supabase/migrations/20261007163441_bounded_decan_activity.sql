begin;
create function private.decan_document_json(p_body text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
begin return p_body::jsonb; exception when invalid_text_representation then return '{}'::jsonb; end $$;
revoke all on function private.decan_document_json(text) from public,anon;
grant execute on function private.decan_document_json(text) to authenticated;

-- A page is at most 12 short records. Drawings, complete journal documents,
-- private device margins, public activity and inferred traits are not inputs.
create function public.read_decan_activity_v1(p_account uuid,p_start date,p_end date,
 p_start_utc timestamptz,p_end_utc timestamptz,p_source text,p_cursor text default null)
returns jsonb language plpgsql security invoker stable set search_path='' as $$
declare v_rows jsonb; v_limit integer:=12;
begin
 if auth.uid() is null or auth.uid()<>p_account then raise insufficient_privilege; end if;
 if p_start is null or p_end is null or p_end<>p_start+9 or p_source not in ('flows','library','responses','journal','previous')
    or p_start_utc is null or p_end_utc is null or p_end_utc<=p_start_utc or p_end_utc-p_start_utc>interval '11 days' then
   raise exception 'Invalid decan activity request' using errcode='22023'; end if;
 if p_source='flows' then
   select coalesce(jsonb_agg(item order by cursor),'[]') into v_rows from (
    select c.completed_on::text||'/'||lpad(c.id::text,20,'0') as cursor,
      jsonb_build_object('id','completion:'||c.id::text,'kind','flow','source_id',c.client_event_id,
        'occurred_on',c.completed_on,'text',coalesce(c.metadata->>'event_title',f.name,'Flow activity'),
        'flow_id',c.flow_id,'flow_key',c.metadata->>'flow_key','flow_title',coalesce(c.metadata->>'flow_title',f.name),
        'status',coalesce(c.metadata->>'status',c.metadata->>'completion_status','completed'),
        'event_number',c.metadata->'event_number',
        'cursor',c.completed_on::text||'/'||lpad(c.id::text,20,'0')) as item
    from public.user_event_completions c left join public.flows f on f.id=c.flow_id and f.user_id=p_account
    where c.user_id=p_account and c.completed_on between p_start and p_end
      and (p_cursor is null or c.completed_on::text||'/'||lpad(c.id::text,20,'0')>p_cursor)
    order by cursor limit v_limit+1
   ) page;
 elsif p_source='library' then
   select coalesce(jsonb_agg(item order by cursor),'[]') into v_rows from (
     select x.at::text||'/'||p.node_id||'/'||x.action as cursor,
       jsonb_build_object('id','library:'||p.node_id||':'||x.action,'kind','library','source_id',p.node_id,
        'library_id',p.node_id,'occurred_on',x.at,'action',x.action,'progress',p.progress_percent,
        'cursor',x.at::text||'/'||p.node_id||'/'||x.action) as item
     from public.user_library_node_progress p cross join lateral (
       values (p.last_read_at,'read'),(p.bookmarked_at,'bookmarked')
     ) x(at,action)
     where p.user_id=p_account and x.at>=p_start_utc and x.at<p_end_utc
       and (p_cursor is null or x.at::text||'/'||p.node_id||'/'||x.action>p_cursor)
     order by cursor limit v_limit+1
   ) page;
 elsif p_source='responses' then
   with documents as (
     select j.id,j.greg_date,private.decan_document_json(j.body) as doc
     from public.journal_entries j where j.user_id=p_account and j.greg_date between p_start and p_end
   ), responses as (
     select d.id,d.greg_date,s.key,s.value from documents d
     cross join lateral jsonb_each_text(coalesce(d.doc->'meta'->'maat_plain_user_text_sources','{}')) s
     where btrim(s.value)<>'' and exists (
       select 1 from jsonb_array_elements(coalesce(d.doc->'blocks','[]')) b
       where b->>'type'='paragraph' and position(s.value in (
         select string_agg(o->>'insert','' order by ord) from jsonb_array_elements(b->'ops') with ordinality as ops(o,ord)
       ))>0)
   )
   select coalesce(jsonb_agg(item order by cursor),'[]') into v_rows from (
     select greg_date::text||'/'||key as cursor,
       jsonb_build_object('id','response:'||id::text||':'||key,'kind','response','source_id',key,
         'occurred_on',greg_date,'journal_entry_id',id,'flow_key',split_part(key,':',2),
         'text',left(value,1200),'is_excerpt',length(value)>1200,'cursor',greg_date::text||'/'||key) as item
     from responses where p_cursor is null or greg_date::text||'/'||key>p_cursor
     order by cursor limit v_limit+1
   ) page;
 elsif p_source='journal' then
   select coalesce(jsonb_agg(item order by cursor),'[]') into v_rows from (
     select j.greg_date::text||'/'||j.id::text as cursor,
       jsonb_build_object('id','journal:'||j.id::text,'kind','journal','source_id',j.id,
         'occurred_on',j.greg_date,'journal_entry_id',j.id,
         'text',left(case when private.decan_document_json(j.body)->'blocks' is null then j.body else (
           select string_agg(o->>'insert',' ' order by bi,oi)
           from jsonb_array_elements(private.decan_document_json(j.body)->'blocks') with ordinality as blocks(b,bi)
           cross join lateral jsonb_array_elements(coalesce(b->'ops','[]')) with ordinality as ops(o,oi)
           where b->>'type'='paragraph' and b->>'id' not like 'decan_reflection:%'
         ) end,1200),'cursor',j.greg_date::text||'/'||j.id::text) as item
     from public.journal_entries j where j.user_id=p_account and j.greg_date between p_start and p_end
       and (p_cursor is null or j.greg_date::text||'/'||j.id::text>p_cursor)
     order by cursor limit v_limit+1
   ) page;
 else
   select coalesce(jsonb_agg(item order by cursor),'[]') into v_rows from (
     select r.decan_start::text||'/'||r.id::text as cursor,
       jsonb_build_object('id','previous:'||r.id::text,'kind','previous','source_id',r.id,
        'occurred_on',null,'journal_entry_id',j.id,'text',left((select string_agg(o->>'insert','' order by oi)
         from jsonb_array_elements(private.decan_document_json(j.body)->'blocks') b
         cross join lateral jsonb_array_elements(coalesce(b->'ops','[]')) with ordinality as ops(o,oi)
         where b->>'id'=s.block_id),1200),
        'question_id',r.review_context->>'question_id',
        'excluded_suggestions',coalesce(r.review_context->'presented_suggestions','[]')||coalesce(r.review_context->'dismissed_suggestions','[]'),
        'cursor',r.decan_start::text||'/'||r.id::text) as item
     from public.decan_reflections r left join public.decan_journal_sources s on s.reflection_id=r.id and s.user_id=p_account and not s.is_deleted
     left join public.journal_entries j on j.user_id=p_account and j.greg_date=s.greg_date
     where r.user_id=p_account and r.decan_end<p_start and r.decan_end>=p_start-30
       and (p_cursor is null or r.decan_start::text||'/'||r.id::text>p_cursor)
     order by cursor limit v_limit+1
   ) page;
 end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(v order by ord),'[]') from jsonb_array_elements(v_rows) with ordinality as rows(v,ord) where ord<=v_limit),
   'next_cursor',case when jsonb_array_length(v_rows)>v_limit then v_rows->(v_limit-1)->>'cursor' else null end);
end $$;
revoke all on function public.read_decan_activity_v1(uuid,date,date,timestamptz,timestamptz,text,text) from public,anon;
grant execute on function public.read_decan_activity_v1(uuid,date,date,timestamptz,timestamptz,text,text) to authenticated;

commit;
