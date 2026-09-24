begin;

-- Fail closed rather than waiting behind production traffic.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- These functions must retain server-side access after their backing tables
-- become service-only. Abort if their trusted owner has drifted.
do $$
declare
  v_function regprocedure;
begin
  foreach v_function in array array[
    'public.block_suspect_flow_inserts()'::regprocedure,
    'public.flow_guard_enabled()'::regprocedure,
    'public.fn_audit_row()'::regprocedure,
    'public.audit_log_row()'::regprocedure,
    'public.log_flow_inserts()'::regprocedure
  ]::regprocedure[]
  loop
    if (
      select pg_get_userbyid(p.proowner)
      from pg_proc p
      where p.oid = v_function
    ) <> 'postgres' then
      raise exception
        'Containment aborted: function % is not owned by postgres',
        v_function;
    end if;
  end loop;
end
$$;

alter function public.block_suspect_flow_inserts()
  security definer;
alter function public.block_suspect_flow_inserts()
  set search_path = pg_catalog, public;

alter function public.flow_guard_enabled()
  security definer;
alter function public.flow_guard_enabled()
  set search_path = pg_catalog, public;

alter function public.fn_audit_row()
  security definer;
alter function public.fn_audit_row()
  set search_path = pg_catalog, public;

-- Already SECURITY DEFINER; fix their mutable search paths.
alter function public.audit_log_row()
  set search_path = pg_catalog, public;

alter function public.log_flow_inserts()
  set search_path = pg_catalog, public;

-- Enable RLS and remove direct Data API access. The conditional lookup keeps
-- a clean rebuild compatible with obsolete Medu tables that a later migration
-- drops, while containing them when schema drift leaves them present.
do $$
declare
  v_table text;
  v_relation regclass;
begin
  foreach v_table in array array[
    'public.audit_log',
    'public.flow_insert_debug',
    'public.flow_insert_guard_flag',
    'public.flow_insert_blocklist',
    'public.share_short_links',
    'public.user_ai_usage',
    'public.backup_user_events_flow_fix',
    'public.backup_user_events_cid_only',
    'public.medu_dictionary',
    'public.medu_kg_edges',
    'public.medu_decision_matrix',
    'public.memory_nodes',
    'public.maat_delivery_timing_events',
    'public.maat_delivery_receipt_events',
    'public.maat_obligations',
    'public.maat_restoration_attempts',
    'public.rc_contract_load_raw_runs'
  ]
  loop
    v_relation := to_regclass(v_table);

    if v_relation is not null then
      execute format(
        'alter table %s enable row level security',
        v_relation
      );

      execute format(
        'revoke all privileges on table %s from public, anon, authenticated',
        v_relation
      );

      -- Preserve existing service-side and administrative behavior.
      execute format(
        'grant all privileges on table %s to service_role',
        v_relation
      );
    end if;
  end loop;
end
$$;

-- Prevent direct use of the two internal diagnostic sequences.
do $$
declare
  v_sequence text;
  v_relation regclass;
begin
  foreach v_sequence in array array[
    'public.audit_log_id_seq',
    'public.flow_insert_debug_id_seq'
  ]
  loop
    v_relation := to_regclass(v_sequence);

    if v_relation is not null then
      execute format(
        'revoke all privileges on sequence %s from public, anon, authenticated',
        v_relation
      );

      execute format(
        'grant all privileges on sequence %s to service_role',
        v_relation
      );
    end if;
  end loop;
end
$$;

commit;
