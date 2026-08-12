do $migration$
declare
  v_signature regprocedure :=
    'public.get_my_flow_activity_v1(bigint[])'::regprocedure;
  v_definition text;
  v_broken text := 'when es.starts_at is null then false';
  v_fixed text := 'when es.starts_at is null then null::timestamptz';
begin
  select pg_get_functiondef(v_signature)
  into v_definition;

  if position(v_broken in v_definition) = 0 then
    raise exception
      'get_my_flow_activity_v1 null-start correction source did not match';
  end if;

  execute replace(v_definition, v_broken, v_fixed);
end;
$migration$;

notify pgrst, 'reload schema';
