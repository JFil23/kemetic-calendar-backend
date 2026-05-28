-- Squashed app-schema baseline prelude.
-- Supabase-managed auth internals are only stubbed when the local database
-- image has not already created them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres superuser login password 'postgres';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create schema if not exists vault;

do $$
begin
  if to_regnamespace('auth') is null then
    create schema auth;
  end if;

  if to_regprocedure('auth.uid()') is null then
    execute $fn$
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $body$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $body$
    $fn$;
  end if;

  if to_regclass('auth.users') is null then
    create table auth.users (
      id uuid primary key,
      aud varchar(255),
      role varchar(255),
      email varchar(255),
      encrypted_password varchar(255),
      email_confirmed_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz
    );
  end if;

  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "api";


ALTER SCHEMA "api" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."_coerce_color_24bit_text"("p_txt" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $_$
DECLARE
  v_default constant integer := 5099745; -- #4dd0e1
  v_num numeric;
  v_int integer;
  v_hex text;
BEGIN
  IF p_txt IS NULL THEN
    RETURN v_default;
  END IF;

  -- Try numeric cast first
  BEGIN
    v_num := p_txt::numeric;
  EXCEPTION WHEN others THEN
    v_num := NULL;
  END;

  -- Guard NaN/Inf
  IF v_num IS NOT NULL AND v_num::text NOT IN ('NaN','Infinity','-Infinity') THEN
    v_int := round(v_num)::int;
  ELSE
    -- Fallback: parse '#RRGGBB' | '0xRRGGBB' | 'RRGGBB'
    v_hex := trim(p_txt);
    v_hex := regexp_replace(v_hex, '^(#|0x)', '', 'i');
    IF v_hex ~ '^[0-9A-Fa-f]{1,6}$' THEN
      BEGIN
        v_int := ('x' || v_hex)::bit(24)::int;
      EXCEPTION WHEN others THEN
        RETURN v_default;
      END;
    ELSE
      RETURN v_default;
    END IF;
  END IF;

  -- Clamp to 24-bit
  IF v_int < 0 THEN
    v_int := 0;
  ELSIF v_int > 16777215 THEN
    v_int := 16777215;
  END IF;
  RETURN v_int;
END;
$_$;


ALTER FUNCTION "public"."_coerce_color_24bit_text"("p_txt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_flows_color_biut"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_txt text;
BEGIN
  v_txt := NEW.color::text;                            -- works for bigint/double/text sources upstream
  NEW.color := public._coerce_color_24bit_text(v_txt); -- coerced int in range, never NaN/NULL
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_flows_color_biut"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_get_user_timezone"("p_uid" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select p.timezone
    from public.profiles p
    where p.id = p_uid
  ), 'UTC');
$$;


ALTER FUNCTION "public"."_get_user_timezone"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_is_personalization_enabled"("p_uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select p.personalization_enabled
    from public.profiles p
    where p.id = p_uid
  ), true);
$$;


ALTER FUNCTION "public"."_is_personalization_enabled"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_deleted_user_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_semantic text := coalesce(
    nullif(btrim(current_setting('app.event_delete_semantic', true)), ''),
    'raw_delete'
  );
  v_suppresses_client boolean := coalesce(
    nullif(btrim(current_setting('app.event_delete_suppresses_client', true)), '')::boolean,
    false
  );
  v_source_feature text := nullif(
    btrim(current_setting('app.event_delete_source_feature', true)),
    ''
  );
  v_delete_scope text := coalesce(
    nullif(btrim(current_setting('app.event_delete_scope', true)), ''),
    'exact_occurrence'
  );
  v_operation_id uuid := coalesce(
    nullif(btrim(current_setting('app.event_delete_operation_id', true)), '')::uuid,
    gen_random_uuid()
  );
  v_actor_id uuid := auth.uid();
begin
  insert into public.event_deletion_trash (
    user_id,
    source_table,
    source_id,
    client_event_id,
    calendar_id,
    flow_local_id,
    title,
    starts_at,
    ends_at,
    deleted_at,
    purge_after,
    delete_semantic,
    suppresses_client,
    source_feature,
    delete_scope,
    operation_id,
    actor_id,
    row_data
  )
  values (
    old.user_id,
    'user_events',
    old.id,
    old.client_event_id,
    old.calendar_id,
    old.flow_local_id,
    old.title,
    old.starts_at,
    old.ends_at,
    timezone('utc', now()),
    timezone('utc', now()) + interval '10 days',
    v_semantic,
    v_suppresses_client,
    v_source_feature,
    v_delete_scope,
    v_operation_id,
    v_actor_id,
    to_jsonb(old) || jsonb_build_object(
      'delete_semantic', v_semantic,
      'suppresses_client', v_suppresses_client,
      'source_feature', v_source_feature,
      'delete_scope', v_delete_scope,
      'operation_id', v_operation_id,
      'actor_id', v_actor_id
    )
  );

  return old;
end;
$$;


ALTER FUNCTION "public"."archive_deleted_user_event"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."archive_deleted_user_event"() IS 'Archives deleted user_events rows. Raw deletes are audit-only by default; durable client suppression must come through semantic delete RPCs or explicit trigger settings.';



CREATE OR REPLACE FUNCTION "public"."assign_flow_calendar_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.calendar_id is null then
    new.calendar_id := public.ensure_personal_calendar_for_user(new.user_id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_flow_calendar_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_user_event_calendar_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  if new.calendar_id is null then
    new.calendar_id := public.ensure_personal_calendar_for_user(new.user_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."assign_user_event_calendar_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_basic"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.audit_log(table_name, action, row_pk, new_data, user_id, at)
  values (TG_TABLE_NAME, TG_OP, jsonb_build_object('id', NEW.id), to_jsonb(NEW), (select auth.uid()), now());
  return NEW;
end;
$$;


ALTER FUNCTION "public"."audit_basic"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_row"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  jwt json;
  pk  jsonb := '{}'::jsonb;
  col text;
begin
  -- Try to read JWT claims for email
  begin
    jwt := current_setting('request.jwt.claims', true)::json;
  exception when others then
    jwt := null;
  end;

  -- Build PK object
  for col in
    select a.attname
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = TG_RELID and i.indisprimary
  loop
    if TG_OP = 'DELETE' then
      pk := pk || jsonb_build_object(col, to_jsonb(old.*) -> col);
    else
      pk := pk || jsonb_build_object(col, to_jsonb(new.*) -> col);
    end if;
  end loop;

  insert into public.audit_log(table_name, action, row_pk, old_data, new_data, user_id, email, request_ip)
  values (
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    TG_OP,
    nullif(pk, '{}'::jsonb),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) end,
    auth.uid(),
    coalesce(jwt->>'email', null),
    current_setting('request.headers', true)::json->>'x-forwarded-for'
  );
  return null;
end
$$;


ALTER FUNCTION "public"."audit_log_row"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_suspect_flow_inserts"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  _claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  _sub uuid := null;
  _role text := null;
  _ip inet := inet_client_addr();
  _hit boolean := false;
begin
  if not public.flow_guard_enabled() then
    return new;
  end if;

  if _claims is not null then
    _sub := nullif(_claims->>'sub','')::uuid;
    _role := nullif(_claims->>'role','');
  end if;

  select exists (
    select 1 from public.flow_insert_blocklist b
    where (b.sub is null or b.sub = _sub)
      and (b.role is null or b.role = _role)
      and (b.ip  is null or b.ip  = _ip)
  ) into _hit;

  if _hit then
    raise exception 'Flow insert blocked by guard';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."block_suspect_flow_inserts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_shared_calendar_members"("p_calendar_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and sc.deleted_at is null
  );
$$;


ALTER FUNCTION "public"."can_view_shared_calendar_members"("p_calendar_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_shared_calendar_member_row"("p_calendar_id" "uuid", "p_member_status" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.shared_calendars sc
    where sc.id = p_calendar_id
      and sc.deleted_at is null
      and (
        sc.owner_id = auth.uid()
        or (
          p_member_status = 'accepted'
          and exists (
            select 1
            from public.shared_calendar_members self_scm
            where self_scm.calendar_id = p_calendar_id
              and self_scm.user_id = auth.uid()
              and self_scm.status = 'accepted'
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_view_shared_calendar_member_row"("p_calendar_id" "uuid", "p_member_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_due_decan_reflection_schedule"("p_now" timestamp with time zone DEFAULT "now"(), "p_limit" integer DEFAULT 25, "p_lease_seconds" integer DEFAULT 900) RETURNS TABLE("id" "uuid", "user_id" "uuid", "decan_start" "date", "decan_end" "date", "decan_name" "text", "decan_theme" "text", "decan_context_key" "text", "attempt_count" integer, "claim_token" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 250);
  v_lease interval := make_interval(
    secs => greatest(coalesce(p_lease_seconds, 900), 30)
  );
  v_claim_token text := gen_random_uuid()::text;
begin
  return query
  with candidate_ids as (
    select drs.id
    from public.decan_reflection_schedule drs
    where drs.send_at <= p_now
      and (
        drs.status = 'pending'
        or (
          drs.status = 'claimed'
          and (
            drs.claimed_at is null
            or drs.claimed_at < (p_now - v_lease)
          )
        )
      )
    order by drs.send_at asc, drs.id asc
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.decan_reflection_schedule drs
    set status = 'claimed',
        claimed_at = p_now,
        claim_token = v_claim_token
    from candidate_ids c
    where drs.id = c.id
    returning
      drs.id,
      drs.user_id,
      drs.decan_start,
      drs.decan_end,
      drs.decan_name,
      drs.decan_theme,
      drs.decan_context_key,
      drs.attempt_count
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.decan_start,
    claimed.decan_end,
    claimed.decan_name,
    claimed.decan_theme,
    claimed.decan_context_key,
    claimed.attempt_count,
    v_claim_token as claim_token
  from claimed;
end;
$$;


ALTER FUNCTION "public"."claim_due_decan_reflection_schedule"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_due_decan_reflection_schedule"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) IS 'Atomically claims due decan_reflection_schedule rows using FOR UPDATE SKIP LOCKED and a lease token so interrupted cron runs can be retried safely.';



CREATE OR REPLACE FUNCTION "public"."claim_due_scheduled_notifications"("p_now" timestamp with time zone DEFAULT "now"(), "p_limit" integer DEFAULT 500, "p_lease_seconds" integer DEFAULT 900) RETURNS TABLE("id" bigint, "user_id" "uuid", "client_event_id" "text", "title" "text", "body" "text", "payload" "text", "notification_type" "text", "scheduled_at" timestamp with time zone, "claim_token" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_lease interval := make_interval(
    secs => greatest(coalesce(p_lease_seconds, 900), 30)
  );
  v_claim_token text := gen_random_uuid()::text;
begin
  return query
  with candidate_ids as (
    select sn.id
    from public.scheduled_notifications sn
    where sn.is_active = true
      and sn.scheduled_at <= p_now
      and (
        sn.claimed_at is null
        or sn.claimed_at < (p_now - v_lease)
      )
    order by sn.scheduled_at asc, sn.id asc
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.scheduled_notifications sn
    set claimed_at = p_now,
        claim_token = v_claim_token,
        updated_at = p_now
    from candidate_ids c
    where sn.id = c.id
    returning
      sn.id,
      sn.user_id,
      sn.client_event_id,
      sn.title,
      sn.body,
      sn.payload,
      sn.notification_type,
      sn.scheduled_at
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.client_event_id,
    claimed.title,
    claimed.body,
    claimed.payload,
    claimed.notification_type,
    claimed.scheduled_at,
    v_claim_token as claim_token
  from claimed;
end;
$$;


ALTER FUNCTION "public"."claim_due_scheduled_notifications"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_due_scheduled_notifications"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) IS 'Atomically claims due scheduled_notifications rows using FOR UPDATE SKIP LOCKED and a lease token so overlapping cron runs do not send the same row concurrently.';



CREATE OR REPLACE FUNCTION "public"."clear_event_share_import_tombstone"("p_user_id" "uuid", "p_share_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_target_cid text;
begin
  if p_user_id is null or p_share_id is null then
    return;
  end if;

  v_target_cid := public.event_share_import_client_event_id(p_share_id);

  update public.event_deletion_trash
     set purged_at = coalesce(purged_at, timezone('utc', now())),
         suppresses_client = false,
         row_data = coalesce(row_data, '{}'::jsonb) || jsonb_build_object(
           'cleared_by', 'event_invite_acceptance',
           'cleared_at', timezone('utc', now()),
           'event_share_id', p_share_id::text
         )
   where user_id = p_user_id
     and client_event_id = v_target_cid
     and purged_at is null
     and suppresses_client = true;
end;
$$;


ALTER FUNCTION "public"."clear_event_share_import_tombstone"("p_user_id" "uuid", "p_share_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."clear_event_share_import_tombstone"("p_user_id" "uuid", "p_share_id" "uuid") IS 'Clears exact user_events tombstones for an event_share import when the recipient explicitly accepts that invite.';



CREATE OR REPLACE FUNCTION "public"."clear_flow_import_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.clear_flow_import_status_by_share_id(old.share_id);
  return old;
end;
$$;


ALTER FUNCTION "public"."clear_flow_import_status"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."clear_flow_import_status"() IS 'Resilient trigger to clear imported_at when a flow is deleted; failures are logged, not fatal.';



CREATE OR REPLACE FUNCTION "public"."clear_flow_import_status_by_share_id"("p_share_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if p_share_id is null then
    return;
  end if;

  begin
    update public.flow_shares
       set imported_at = null
     where id = p_share_id;
  exception when others then
    raise warning 'Failed to clear import status for share %: %',
      p_share_id, SQLERRM;
  end;
end;
$$;


ALTER FUNCTION "public"."clear_flow_import_status_by_share_id"("p_share_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."clear_flow_import_status_by_share_id"("p_share_id" "uuid") IS 'Resilient helper that clears flow_shares.imported_at for a soft-deleted or deleted imported flow.';



CREATE OR REPLACE FUNCTION "public"."compute_flow_outcome"("p_flow_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_flow record;
  v_window_start date;
  v_window_end date;
  v_window_start_ts timestamptz;
  v_window_end_ts timestamptz;
  v_events_total integer := 0;
  v_events_completed integer := null;
  v_completed_days integer := 0;
  v_events_completed_ratio numeric := null;
  v_events_completed_confident boolean := false;
  v_scheduled_days integer := 0;
  v_journal_days integer := 0;
  v_badge_count integer := 0;
  v_edit_events integer := 0;
  v_delete_events integer := 0;
  v_reschedule_events integer := 0;
  v_edit_total integer := 0;
  v_has_edit_telemetry boolean := false;
  v_outcome_confidence text := 'low';
  v_accepted_as_is boolean := null;
  v_total_days integer := 0;
  v_schedule_density numeric;
  v_metadata jsonb := '{}'::jsonb;
begin
  select id, user_id, start_date, end_date
  into v_flow
  from public.flows
  where id = p_flow_id
  limit 1;

  if v_flow.id is null then
    raise exception 'Flow % not found', p_flow_id;
  end if;

  if v_flow.user_id is null then
    return;
  end if;

  v_window_start := coalesce(v_flow.start_date, current_date);
  v_window_end := coalesce(v_flow.end_date, current_date);
  if v_window_end < v_window_start then
    v_window_end := v_window_start;
  end if;

  -- UTC timestamp window (no created_at::date truncation)
  v_window_start_ts := (v_window_start::timestamp at time zone 'UTC');
  v_window_end_ts := ((v_window_end + 1)::timestamp at time zone 'UTC');
  v_total_days := (v_window_end - v_window_start) + 1;

  select
    count(*) as total_events,
    count(distinct (ue.starts_at at time zone 'utc')::date) as scheduled_days
  into v_events_total, v_scheduled_days
  from public.user_events ue
  where ue.user_id = v_flow.user_id
    and ue.flow_local_id = p_flow_id
    and ue.starts_at >= v_window_start_ts
    and ue.starts_at < v_window_end_ts;

  -- Journal engagement (date-based)
  select
    count(distinct je.greg_date) as journal_days
  into v_journal_days
  from public.journal_entries je
  where je.user_id = v_flow.user_id
    and je.flow_id = p_flow_id
    and je.greg_date between v_window_start and v_window_end;

  -- Badge count: lower bound until journal_badges has flow_id/occurred_on; join drops rows when entry_id is null.
  select
    count(*) as badge_count
  into v_badge_count
  from public.journal_badges jb
  join public.journal_entries je on je.id = jb.entry_id
  where je.user_id = v_flow.user_id
    and je.flow_id = p_flow_id
    and je.greg_date between v_window_start and v_window_end;

  -- Completions (client_event_id keyed, survives reschedule)
  select
    count(*) as events_completed,
    count(distinct uec.completed_on) as completed_days
  into v_events_completed, v_completed_days
  from public.user_event_completions uec
  where uec.user_id = v_flow.user_id
    and uec.flow_id = p_flow_id
    and uec.completed_on between v_window_start and v_window_end;

  if v_events_total > 0 and v_events_completed is not null then
    v_events_completed_ratio := round((v_events_completed::numeric / v_events_total::numeric), 4);
    -- Require coverage to avoid single-accidental taps: minimum 2 completions and >=60% of scheduled events.
    if v_events_completed >= 2 and v_events_completed_ratio >= 0.6 then
      v_events_completed_confident := true;
    end if;
  end if;

  -- Telemetry: guarded cast for flow_id; only flow-scoped edit/reschedule events
  with ae as (
    select
      ae.event,
      p.flow_id
    from public.app_events ae
    left join lateral (
      select (ae.properties->>'flow_id')::bigint as flow_id
      where (ae.properties ? 'flow_id') and (ae.properties->>'flow_id') ~ '^\d+$'
    ) p on true
    where ae.user_id = v_flow.user_id
      and ae.created_at >= v_window_start_ts
      and ae.created_at < v_window_end_ts
      and ae.event in ('event_updated','event_deleted','flow_rescheduled')
  )
  select
    coalesce(count(*) filter (where event = 'event_updated' and flow_id = p_flow_id), 0),
    coalesce(count(*) filter (where event = 'event_deleted' and flow_id = p_flow_id), 0),
    coalesce(count(*) filter (where event = 'flow_rescheduled' and flow_id = p_flow_id), 0),
    coalesce(count(*) filter (where flow_id = p_flow_id), 0) > 0
  into v_edit_events, v_delete_events, v_reschedule_events, v_has_edit_telemetry
  from ae;

  v_edit_total := coalesce(v_edit_events, 0) + coalesce(v_delete_events, 0) + coalesce(v_reschedule_events, 0);

  if v_has_edit_telemetry then
    v_accepted_as_is := (v_edit_total = 0);
  else
    v_accepted_as_is := null;
  end if;

  if v_total_days > 0 then
    v_schedule_density := round((v_scheduled_days::numeric / v_total_days)::numeric, 4);
  else
    v_schedule_density := null;
  end if;

  -- Outcome confidence:
  -- high: sufficient completion coverage (>=60% and at least 2 completions) on a non-empty schedule
  -- medium: any completion data or, absent that, presence of telemetry
  v_outcome_confidence := 'low';
  if v_events_total > 0 and v_events_completed is not null then
    if v_events_completed > 0 then
      if v_events_completed_confident then
        v_outcome_confidence := 'high';
      else
        v_outcome_confidence := 'medium';
      end if;
    end if;
  end if;
  if v_outcome_confidence = 'low' and v_has_edit_telemetry then
    v_outcome_confidence := 'medium';
  end if;

  v_metadata := jsonb_build_object(
    'scheduled_days', coalesce(v_scheduled_days, 0),
    'badge_count', coalesce(v_badge_count, 0),
    'journal_days', coalesce(v_journal_days, 0),
    'schedule_density', v_schedule_density,
    'events_completed', coalesce(v_events_completed, 0),
    'completed_days', coalesce(v_completed_days, 0),
    'completion_ratio', v_events_completed_ratio,
    'edit_count', coalesce(v_edit_events, 0),
    'delete_count', coalesce(v_delete_events, 0),
    'reschedule_count', coalesce(v_reschedule_events, 0),
    'has_edit_telemetry', v_has_edit_telemetry,
    'outcome_confidence', v_outcome_confidence
  );

  insert into public.flow_outcomes (
    user_id,
    flow_id,
    window_start,
    window_end,
    events_total,
    events_completed,
    edit_count,
    accepted_as_is,
    metadata
  ) values (
    v_flow.user_id,
    p_flow_id,
    v_window_start,
    v_window_end,
    v_events_total,
    v_events_completed,
    v_edit_total,
    v_accepted_as_is,
    v_metadata
  )
  on conflict (user_id, flow_id, window_start) where (window_start is not null)
  do update set
    window_end = excluded.window_end,
    events_total = excluded.events_total,
    events_completed = excluded.events_completed,
    edit_count = excluded.edit_count,
    accepted_as_is = excluded.accepted_as_is,
    metadata = excluded.metadata,
    recorded_at = now();
end;
$_$;


ALTER FUNCTION "public"."compute_flow_outcome"("p_flow_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."compute_flow_outcome"("p_flow_id" bigint) IS 'Phase 1: aggregates schedule, journal/badges, flow-scoped telemetry, and completions (client_event_id + completed_on). High confidence requires completion coverage (>=60%, >=2 completions); accepted_as_is set only when flow-scoped telemetry is present.';



CREATE OR REPLACE FUNCTION "public"."compute_user_preferences"("p_window_days" integer DEFAULT 90) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  perform public.compute_user_preferences_impl(v_uid, p_window_days);
end;
$$;


ALTER FUNCTION "public"."compute_user_preferences"("p_window_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_user_preferences_for"("p_user_id" "uuid", "p_window_days" integer DEFAULT 90) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text := current_setting('request.jwt.claims.role', true);
begin
  if v_role is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  perform public.compute_user_preferences_impl(p_user_id, p_window_days);
end;
$$;


ALTER FUNCTION "public"."compute_user_preferences_for"("p_user_id" "uuid", "p_window_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_user_preferences_impl"("p_uid" "uuid", "p_window_days" integer DEFAULT 90) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_days integer;
  v_tz text;
  v_window_start timestamptz;
  v_now timestamptz;
  v_sample_min integer := 3;
  v_top_n integer := 6;

  v_sched jsonb := '{}'::jsonb;
  v_comp jsonb := '{}'::jsonb;
  v_sched_total integer := 0;
  v_comp_total integer := 0;

  v_preferred integer[] := '{}';
  v_avoid integer[] := '{}';
  v_prefs jsonb;
begin
  if p_uid is null then
    raise exception 'user_id required';
  end if;

  if not public._is_personalization_enabled(p_uid) then
    return;
  end if;

  v_days := greatest(7, least(coalesce(p_window_days, 90), 365));
  v_tz := public._get_user_timezone(p_uid);
  v_now := now();
  v_window_start := v_now - make_interval(days => v_days);

  with
  hours as (
    select generate_series(0, 23) as hour_bucket
  ),
  scheduled as (
    select
      greatest(
        0,
        least(
          23,
          case
            when e.all_day then 9
            when cast(date_part('hour', e.starts_at at time zone v_tz) as integer) = 0
             and cast(date_part('minute', e.starts_at at time zone v_tz) as integer) = 0
              then 9
            else cast(date_part('hour', e.starts_at at time zone v_tz) as integer)
          end
        )
      ) as hour_bucket,
      count(*) as scheduled_count
    from public.user_events e
    where e.user_id = p_uid
      and e.flow_local_id is not null
      and e.starts_at >= v_window_start
      and e.starts_at < v_now
    group by 1
  ),
  completed as (
    select
      greatest(
        0,
        least(
          23,
          case
            when e.all_day then 9
            when cast(date_part('hour', e.starts_at at time zone v_tz) as integer) = 0
             and cast(date_part('minute', e.starts_at at time zone v_tz) as integer) = 0
              then 9
            else cast(date_part('hour', e.starts_at at time zone v_tz) as integer)
          end
        )
      ) as hour_bucket,
      count(*) as completed_count
    from public.user_event_completions c
    join public.user_events e
      on e.user_id = c.user_id
     and e.client_event_id = c.client_event_id
     and e.client_event_id is not null
     and c.client_event_id is not null
    where c.user_id = p_uid
      and e.flow_local_id is not null
      and c.completed_at >= v_window_start
      and c.completed_at < v_now
    group by 1
  ),
  stats as (
    select
      h.hour_bucket,
      coalesce(s.scheduled_count, 0) as scheduled_count,
      coalesce(c.completed_count, 0) as completed_count
    from hours h
    left join scheduled s on s.hour_bucket = h.hour_bucket
    left join completed c on c.hour_bucket = h.hour_bucket
  ),
  enriched as (
    select
      hour_bucket,
      scheduled_count,
      completed_count,
      case
        when scheduled_count > 0
          then round((completed_count::numeric / scheduled_count::numeric), 4)
        else null::numeric
      end as completion_rate,
      (sum(completed_count) over ()) as completed_total_all
    from stats
  )
  select
    coalesce(jsonb_object_agg(hour_bucket::text, scheduled_count order by hour_bucket), '{}'::jsonb),
    coalesce(jsonb_object_agg(hour_bucket::text, completed_count order by hour_bucket), '{}'::jsonb),
    coalesce(sum(scheduled_count), 0),
    coalesce(sum(completed_count), 0),
    coalesce((
      select array(
        select hour_bucket
        from enriched
        where scheduled_count >= v_sample_min
        order by
          case
            when completed_total_all > 0 then completion_rate
            else scheduled_count::numeric
          end desc nulls last,
          hour_bucket asc
        limit v_top_n
      )
    ), '{}'::integer[]),
    coalesce((
      select array(
        select hour_bucket
        from enriched
        where scheduled_count >= v_sample_min
        order by
          case
            when completed_total_all > 0 then completion_rate
            else scheduled_count::numeric
          end asc nulls last,
          hour_bucket asc
        limit v_top_n
      )
    ), '{}'::integer[])
  into v_sched, v_comp, v_sched_total, v_comp_total, v_preferred, v_avoid
  from enriched;

  v_prefs := jsonb_build_object(
    'version', 'prefs_v1',
    'timezone_used', v_tz,
    'window_days', v_days,
    'preferred_hours', v_preferred,
    'avoid_hours', v_avoid,
    'schedule_by_hour', v_sched,
    'completion_by_hour', v_comp,
    'counts', jsonb_build_object(
      'scheduled_total', v_sched_total,
      'completed_total', v_comp_total
    )
  );

  insert into public.ukg_user_preferences
    (user_id, computed_at, window_days, timezone, prefs_version, prefs, updated_at)
  values
    (p_uid, v_now, v_days, v_tz, 'prefs_v1', v_prefs, v_now)
  on conflict (user_id) do update set
    computed_at = excluded.computed_at,
    window_days = excluded.window_days,
    timezone = excluded.timezone,
    prefs_version = excluded.prefs_version,
    prefs = excluded.prefs,
    updated_at = excluded.updated_at;
end;
$$;


ALTER FUNCTION "public"."compute_user_preferences_impl"("p_uid" "uuid", "p_window_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_shared_calendar"("p_name" "text", "p_color" bigint DEFAULT 5099745) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_calendar_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_name is null then
    raise exception 'CALENDAR_NAME_REQUIRED';
  end if;

  insert into public.shared_calendars (
    owner_id,
    name,
    color,
    icon,
    is_personal
  )
  values (
    v_user_id,
    v_name,
    coalesce(p_color, 5099745),
    'calendar',
    false
  )
  returning id into v_calendar_id;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at
  )
  values (
    v_calendar_id,
    v_user_id,
    'owner',
    'accepted',
    v_user_id,
    now()
  )
  on conflict (calendar_id, user_id)
  do nothing;

  return v_calendar_id;
end;
$$;


ALTER FUNCTION "public"."create_shared_calendar"("p_name" "text", "p_color" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT auth.uid();
$$;


ALTER FUNCTION "public"."current_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_push_subscription"("sub_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  delete from push_subscriptions
   where id = sub_id
     and user_id = auth.uid();
$$;


ALTER FUNCTION "public"."delete_push_subscription"("sub_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_events_by_category_semantic"("p_category" "text", "p_delete_semantic" "text" DEFAULT 'user_delete'::"text", "p_suppresses_client" boolean DEFAULT true, "p_source_feature" "text" DEFAULT NULL::"text", "p_delete_scope" "text" DEFAULT 'category'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_category text := nullif(btrim(p_category), '');
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_category is null then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_category_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'category'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and ue.category = v_category
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;


ALTER FUNCTION "public"."delete_user_events_by_category_semantic"("p_category" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_events_by_client_id_prefix_semantic"("p_client_event_id_prefix" "text", "p_from_utc" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_until_utc" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_delete_semantic" "text" DEFAULT 'user_delete'::"text", "p_suppresses_client" boolean DEFAULT true, "p_source_feature" "text" DEFAULT NULL::"text", "p_delete_scope" "text" DEFAULT 'client_id_prefix'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_prefix text := nullif(btrim(p_client_event_id_prefix), '');
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_prefix is null then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_client_id_prefix_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'client_id_prefix'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and left(coalesce(ue.client_event_id, ''), char_length(v_prefix)) = v_prefix
      and (p_from_utc is null or ue.starts_at >= p_from_utc)
      and (p_until_utc is null or ue.starts_at < p_until_utc)
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;


ALTER FUNCTION "public"."delete_user_events_by_client_id_prefix_semantic"("p_client_event_id_prefix" "text", "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_events_by_client_id_semantic"("p_client_event_id" "text", "p_delete_semantic" "text" DEFAULT 'user_delete'::"text", "p_suppresses_client" boolean DEFAULT true, "p_source_feature" "text" DEFAULT NULL::"text", "p_delete_scope" "text" DEFAULT 'exact_occurrence'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_client_event_id text := nullif(btrim(p_client_event_id), '');
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_client_event_id is null then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_client_id_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'exact_occurrence'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and ue.client_event_id = v_client_event_id
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;


ALTER FUNCTION "public"."delete_user_events_by_client_id_semantic"("p_client_event_id" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_events_by_flow_semantic"("p_flow_id" bigint, "p_from_utc" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_until_utc" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_delete_semantic" "text" DEFAULT 'user_delete'::"text", "p_suppresses_client" boolean DEFAULT true, "p_source_feature" "text" DEFAULT NULL::"text", "p_delete_scope" "text" DEFAULT 'flow'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_flow_id is null or p_flow_id <= 0 then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_flow_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'flow'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and ue.flow_local_id = p_flow_id
      and (p_from_utc is null or ue.starts_at >= p_from_utc)
      and (p_until_utc is null or ue.starts_at < p_until_utc)
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;


ALTER FUNCTION "public"."delete_user_events_by_flow_semantic"("p_flow_id" bigint, "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_events_by_ids_semantic"("p_ids" "text"[], "p_delete_semantic" "text" DEFAULT 'user_delete'::"text", "p_suppresses_client" boolean DEFAULT true, "p_source_feature" "text" DEFAULT NULL::"text", "p_delete_scope" "text" DEFAULT 'exact_occurrence'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_ids_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'exact_occurrence'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with input_ids as (
    select distinct nullif(btrim(raw_id), '')::uuid as id
    from unnest(p_ids) as raw_id
    where nullif(btrim(raw_id), '') is not null
  ),
  deleted as (
    delete from public.user_events ue
    using input_ids
    where ue.user_id = v_uid
      and ue.id = input_ids.id
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;


ALTER FUNCTION "public"."delete_user_events_by_ids_semantic"("p_ids" "text"[], "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dm_user_pref_candidates"("p_limit" integer DEFAULT 200) RETURNS TABLE("user_id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with active as (
    select ue.user_id
    from public.user_events ue
    where ue.starts_at >= now() - interval '30 days'
    group by ue.user_id

    union

    select f.user_id
    from public.flows f
    where f.created_at >= now() - interval '30 days'
    group by f.user_id
  ),
  need_prefs as (
    select a.user_id
    from active a
    left join public.ukg_user_preferences p on p.user_id = a.user_id
    where p.user_id is null
       or p.computed_at < now() - interval '7 days'
  )
  select need_prefs.user_id
  from need_prefs
  limit greatest(coalesce(p_limit, 200), 0);
$$;


ALTER FUNCTION "public"."dm_user_pref_candidates"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dm_user_pref_candidates"("p_limit" integer) IS 'Returns user_ids with recent activity and missing or stale ukg_user_preferences; used by cron_compute_user_preferences.';



CREATE OR REPLACE FUNCTION "public"."end_flow"("p_flow_id" bigint, "p_ended_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()), "p_ended_on" "date" DEFAULT NULL::"date", "p_delete_all_materialized" boolean DEFAULT false) RETURNS TABLE("flow_id" bigint, "ended_at" timestamp with time zone, "ended_on" "date", "deleted_event_count" integer, "retired_notification_count" integer, "deleted_completion_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_flow_user_id uuid;
  v_flow_calendar_id uuid;
  v_flow_reminder_uuid uuid;
  v_flow_active boolean;
  v_flow_is_hidden boolean;
  v_flow_notes text;
  v_flow_ai_metadata jsonb;
  v_ended_at timestamptz := coalesce(p_ended_at, timezone('utc', now()));
  v_ended_on date;
  v_deleted_event_count integer := 0;
  v_retired_notification_count integer := 0;
  v_deleted_completion_count integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(p_flow_id, 0) <= 0 then
    raise exception 'flow_id required';
  end if;

  v_ended_on := coalesce(
    p_ended_on,
    (v_ended_at at time zone public._get_user_timezone(v_uid))::date
  );

  select
    f.user_id,
    f.calendar_id,
    f.reminder_uuid,
    f.active,
    f.is_hidden,
    f.notes,
    f.ai_metadata
    into
      v_flow_user_id,
      v_flow_calendar_id,
      v_flow_reminder_uuid,
      v_flow_active,
      v_flow_is_hidden,
      v_flow_notes,
      v_flow_ai_metadata
  from public.flows f
  where f.id = p_flow_id
    and (
      f.user_id = v_uid
      or exists (
        select 1
        from public.shared_calendar_members scm
        join public.shared_calendars sc
          on sc.id = scm.calendar_id
        where scm.calendar_id = f.calendar_id
          and scm.user_id = v_uid
          and scm.status = 'accepted'
          and scm.role in ('owner', 'editor')
          and sc.deleted_at is null
      )
    )
  for update;

  if not found then
    raise exception 'flow not found or insufficient calendar role';
  end if;

  if public.flow_is_deleted_state(
    v_flow_active,
    v_flow_is_hidden,
    v_flow_notes
  ) then
    raise exception 'flow already deleted';
  end if;

  update public.flows f
     set active = false,
         end_date = case
           when f.end_date is null or f.end_date > v_ended_on then v_ended_on
           else f.end_date
         end
   where f.id = p_flow_id;

  with deleted_events as (
    delete from public.user_events ue
    where lower(coalesce(ue.category, '')) <> 'tombstone'
      and (
        p_delete_all_materialized
        or ue.starts_at >= v_ended_at
      )
      and coalesce(ue.calendar_id, v_flow_calendar_id) = v_flow_calendar_id
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        v_flow_ai_metadata
      )
    returning ue.id, ue.user_id, ue.client_event_id
  ),
  retired_notifications as (
    update public.scheduled_notifications sn
       set is_active = false
      where sn.is_active = true
        and exists (
          select 1
          from deleted_events de
          where de.user_id = sn.user_id
            and de.client_event_id is not null
            and de.client_event_id = sn.client_event_id
        )
    returning sn.id
  ),
  deleted_completions as (
    delete from public.user_event_completions uec
    where exists (
      select 1
      from deleted_events de
      where de.user_id = uec.user_id
        and de.client_event_id is not null
        and de.client_event_id = uec.client_event_id
    )
    returning uec.user_id, uec.client_event_id
  ),
  retired_reminders as (
    update public.reminders r
       set status = 'completed',
           updated_at = now()
      where r.status <> 'completed'
        and (
          (v_flow_reminder_uuid is not null and r.id = v_flow_reminder_uuid)
          or exists (
            select 1
            from deleted_events de
            where r.event_id = de.id
               or r.flow_event_id = de.id
          )
        )
    returning r.id
  )
  select
    coalesce((select count(*) from deleted_events), 0)::integer,
    coalesce((select count(*) from retired_notifications), 0)::integer,
    coalesce((select count(*) from deleted_completions), 0)::integer
    into
      v_deleted_event_count,
      v_retired_notification_count,
      v_deleted_completion_count;

  return query
  select
    p_flow_id,
    v_ended_at,
    v_ended_on,
    v_deleted_event_count,
    v_retired_notification_count,
    v_deleted_completion_count;
end;
$$;


ALTER FUNCTION "public"."end_flow"("p_flow_id" bigint, "p_ended_at" timestamp with time zone, "p_ended_on" "date", "p_delete_all_materialized" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."end_flow"("p_flow_id" bigint, "p_ended_at" timestamp with time zone, "p_ended_on" "date", "p_delete_all_materialized" boolean) IS 'Canonical end-flow lifecycle RPC. Owners and accepted shared-calendar owners/editors may end a flow; when p_delete_all_materialized is false the RPC prunes future materialized rows from the cutoff, and when true it removes every matched materialized row from that flow calendar while leaving already shared, posted, or saved copies in their own records unchanged. Notifications, reminders, and completions linked to deleted rows are retired in the same transaction.';



CREATE OR REPLACE FUNCTION "public"."enforce_event_share_update_guards"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  actor uuid := auth.uid();
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Allow trusted backend and migration contexts that do not have auth.uid().
  if actor is null then
    return new;
  end if;

  if actor = new.sender_id and actor is distinct from new.recipient_id then
    if new.response_status is distinct from old.response_status
      or new.responded_at is distinct from old.responded_at
      or new.viewed_at is distinct from old.viewed_at
      or new.imported_at is distinct from old.imported_at then
      raise exception 'Only the recipient can change RSVP or read state on an event invite'
        using errcode = '42501';
    end if;
  end if;

  if actor = new.recipient_id and actor is distinct from new.sender_id then
    if new.event_id is distinct from old.event_id
      or new.sender_id is distinct from old.sender_id
      or new.recipient_id is distinct from old.recipient_id
      or new.channel is distinct from old.channel
      or new.invite_token is distinct from old.invite_token
      or new.invite_expires_at is distinct from old.invite_expires_at
      or new.sender_note is distinct from old.sender_note
      or new.status is distinct from old.status
      or new.payload_json is distinct from old.payload_json then
      raise exception 'Only the sender can change event invite metadata'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_event_share_update_guards"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_user_event_flow_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_client_flow_id bigint;
  v_detail_flow_id bigint;
  v_action_flow_id bigint;
  v_flow_active boolean;
  v_flow_is_hidden boolean;
  v_flow_notes text;
begin
  if new.flow_local_id is not null and new.flow_local_id <= 0 then
    new.flow_local_id := null;
  end if;

  if lower(coalesce(new.category, '')) = 'tombstone' then
    perform public.record_user_event_tombstone(
      new.client_event_id,
      new.calendar_id,
      'user_events_tombstone'
    );
    return null;
  end if;

  if public.user_event_recently_deleted(new.user_id, new.client_event_id) then
    raise exception 'EVENT_RECENTLY_DELETED';
  end if;

  v_client_flow_id := public.flow_id_from_client_event_id(new.client_event_id);
  v_detail_flow_id := public.flow_id_from_detail_metadata(new.detail);
  v_action_flow_id := public.flow_id_from_action_id(new.user_id, new.action_id);

  new.flow_local_id := coalesce(
    v_client_flow_id,
    v_detail_flow_id,
    v_action_flow_id,
    new.flow_local_id
  );

  if new.flow_local_id is null then
    return new;
  end if;

  select f.active, f.is_hidden, f.notes
    into v_flow_active, v_flow_is_hidden, v_flow_notes
  from public.flows f
  where f.id = new.flow_local_id
  limit 1;

  if not found then
    raise exception 'FLOW_NOT_FOUND';
  end if;

  if public.flow_is_deleted_state(
    v_flow_active,
    v_flow_is_hidden,
    v_flow_notes
  ) then
    raise exception 'FLOW_ALREADY_DELETED';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_user_event_flow_integrity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_user_event_flow_integrity"() IS 'Canonical user_events guard. Moves tombstones out of client-readable event rows, blocks recently deleted client ids during the 10-day trash retention window, normalizes embedded flow metadata and generated action ids into flow_local_id, and blocks linking events to deleted flows.';



CREATE OR REPLACE FUNCTION "public"."ensure_personal_calendar_for_user"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := p_user_id;
  v_calendar_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select sc.id
    into v_calendar_id
  from public.shared_calendars sc
  where sc.owner_id = v_user_id
    and sc.is_personal = true
    and sc.deleted_at is null
  limit 1;

  if v_calendar_id is null then
    insert into public.shared_calendars (
      owner_id,
      name,
      color,
      icon,
      is_personal
    )
    values (
      v_user_id,
      'My Calendar',
      5099745,
      'calendar',
      true
    )
    returning id into v_calendar_id;
  end if;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at
  )
  values (
    v_calendar_id,
    v_user_id,
    'owner',
    'accepted',
    v_user_id,
    now()
  )
  on conflict (calendar_id, user_id)
  do update
    set role = 'owner',
        status = 'accepted',
        invited_by = excluded.invited_by,
        responded_at = coalesce(
          public.shared_calendar_members.responded_at,
          excluded.responded_at
        ),
        updated_at = now();

  return v_calendar_id;
end;
$$;


ALTER FUNCTION "public"."ensure_personal_calendar_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."event_share_flow_import_client_event_prefix"("p_share_id" "uuid") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select 'event_share_flow:' || p_share_id::text || ':';
$$;


ALTER FUNCTION "public"."event_share_flow_import_client_event_prefix"("p_share_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."event_share_import_client_event_id"("p_share_id" "uuid") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select 'event_share:' || p_share_id::text;
$$;


ALTER FUNCTION "public"."event_share_import_client_event_id"("p_share_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."event_share_rewrite_reminder_notes"("p_raw_notes" "text", "p_imported_reminder_uuid" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $_$
declare
  parsed jsonb;
  raw_id text;
  next_id text;
begin
  if p_imported_reminder_uuid is null then
    return p_raw_notes;
  end if;

  if p_raw_notes is null or btrim(p_raw_notes) = '' then
    return jsonb_build_object('id', p_imported_reminder_uuid::text)::text;
  end if;

  begin
    parsed := p_raw_notes::jsonb;
  exception
    when others then
      return p_raw_notes;
  end;

  if jsonb_typeof(parsed) <> 'object' then
    return p_raw_notes;
  end if;

  raw_id := nullif(btrim(parsed ->> 'id'), '');
  if raw_id is null then
    next_id := p_imported_reminder_uuid::text;
  elsif raw_id like 'nutrition:%' then
    next_id := 'nutrition:' || p_imported_reminder_uuid::text;
  elsif raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    next_id := p_imported_reminder_uuid::text;
  else
    return parsed::text;
  end if;

  return jsonb_set(parsed, '{id}', to_jsonb(next_id), true)::text;
end;
$_$;


ALTER FUNCTION "public"."event_share_rewrite_reminder_notes"("p_raw_notes" "text", "p_imported_reminder_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."event_share_source_flow_payload"("p_event_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  source_event public.user_events%rowtype;
  source_flow public.flows%rowtype;
  flow_events jsonb := '[]'::jsonb;
begin
  if p_event_id is null then
    return null;
  end if;

  select *
  into source_event
  from public.user_events
  where id = p_event_id
  limit 1;

  if not found
    or source_event.flow_local_id is null
    or source_event.flow_local_id <= 0 then
    return null;
  end if;

  select *
  into source_flow
  from public.flows
  where id = source_event.flow_local_id
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_client_event_id', ue.client_event_id,
        'title', ue.title,
        'detail', ue.detail,
        'location', ue.location,
        'all_day', coalesce(ue.all_day, false),
        'starts_at', ue.starts_at,
        'ends_at', ue.ends_at,
        'category', ue.category,
        'action_id', ue.action_id,
        'behavior_payload', ue.behavior_payload
      )
      order by ue.starts_at asc, ue.created_at asc, ue.id asc
    ),
    '[]'::jsonb
  )
  into flow_events
  from public.user_events ue
  where ue.flow_local_id = source_flow.id
    and coalesce(ue.category, '') <> 'tombstone';

  return jsonb_build_object(
    'flow_id', source_flow.id,
    'name', source_flow.name,
    'color', source_flow.color,
    'notes', source_flow.notes,
    'rules', coalesce(source_flow.rules, '[]'::jsonb),
    'start_date', source_flow.start_date,
    'end_date', source_flow.end_date,
    'is_hidden', coalesce(source_flow.is_hidden, false),
    'is_reminder', coalesce(source_flow.is_reminder, false),
    'reminder_uuid', source_flow.reminder_uuid,
    'origin_flow_id', source_flow.origin_flow_id,
    'root_flow_id', source_flow.root_flow_id,
    'events', flow_events
  );
end;
$$;


ALTER FUNCTION "public"."event_share_source_flow_payload"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fill_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fill_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flow_action_ids_from_metadata"("p_ai_metadata" "jsonb") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with event_snapshot as (
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb) -> 'event_snapshot') = 'array'
          then coalesce(p_ai_metadata, '{}'::jsonb) -> 'event_snapshot'
        else '[]'::jsonb
      end
    )
  ),
  plan_actions as (
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb) #> '{plan_spec,actions}') = 'array'
          then coalesce(p_ai_metadata, '{}'::jsonb) #> '{plan_spec,actions}'
        else '[]'::jsonb
      end
    )
  ),
  notes as (
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb) -> 'notes') = 'array'
          then coalesce(p_ai_metadata, '{}'::jsonb) -> 'notes'
        else '[]'::jsonb
      end
    )
  ),
  ids as (
    select nullif(btrim(value ->> 'action_id'), '') as action_id
    from event_snapshot
    union
    select nullif(btrim(value ->> 'action_id'), '') as action_id
    from plan_actions
    union
    select nullif(btrim(value ->> 'action_id'), '') as action_id
    from notes
  )
  select coalesce(array_agg(distinct action_id), array[]::text[])
  from ids
  where action_id is not null
$$;


ALTER FUNCTION "public"."flow_action_ids_from_metadata"("p_ai_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_action_ids_from_metadata"("p_ai_metadata" "jsonb") IS 'Extracts generated event action ids from flow ai_metadata snapshots and plan specs so companion rows remain flow-owned even if flow_local_id drifted.';



CREATE OR REPLACE FUNCTION "public"."flow_commit"("p_generation_id" "uuid", "p_flow_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_generation_id is null then raise exception 'generation_id is required'; end if;
  if p_flow_id is null then raise exception 'flow_id is required'; end if;
  if not exists (select 1 from public.flows f where f.id = p_flow_id and f.user_id = auth.uid()) then
    raise exception 'Not authorized to commit for this flow';
  end if;
  if not exists (select 1 from public.flow_generation_logs l where l.generation_id = p_generation_id and l.user_id = auth.uid()) then
    raise exception 'Not authorized to commit for this generation_id';
  end if;
  update public.flow_generation_logs set flow_id = p_flow_id where generation_id = p_generation_id and user_id = auth.uid();
  update public.flows set origin_generation_id = p_generation_id, origin_type = coalesce(origin_type, 'ai') where id = p_flow_id and user_id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."flow_commit"("p_generation_id" "uuid", "p_flow_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flow_guard_enabled"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select enabled from public.flow_insert_guard_flag where id = true
$$;


ALTER FUNCTION "public"."flow_guard_enabled"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flow_has_repeating_note_metadata"("p_notes" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_notes jsonb;
begin
  if p_notes is null or btrim(p_notes) = '' then
    return false;
  end if;

  begin
    v_notes := p_notes::jsonb;
  exception when others then
    return false;
  end;

  return jsonb_typeof(v_notes) = 'object'
    and coalesce(v_notes ->> 'kind', '') = 'repeating_note';
end;
$$;


ALTER FUNCTION "public"."flow_has_repeating_note_metadata"("p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_has_repeating_note_metadata"("p_notes" "text") IS 'Canonical helper-row detector. Returns true only for flow.notes payloads that decode to {"kind":"repeating_note", ...}.';



CREATE OR REPLACE FUNCTION "public"."flow_id_from_action_id"("p_user_id" "uuid", "p_action_id" "text") RETURNS bigint
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select f.id
  from public.flows f
  where f.user_id = p_user_id
    and public.flow_metadata_has_action_id(f.ai_metadata, p_action_id)
  order by
    case public.flow_record_kind(f.active, f.is_hidden, f.is_reminder, f.notes)
      when 'active' then 0
      when 'inactive' then 1
      else 2
    end,
    f.updated_at desc nulls last,
    f.id desc
  limit 1
$$;


ALTER FUNCTION "public"."flow_id_from_action_id"("p_user_id" "uuid", "p_action_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_id_from_action_id"("p_user_id" "uuid", "p_action_id" "text") IS 'Finds the owning flow for generated event/action companion rows when the row lost flow_local_id and only kept action_id.';



CREATE OR REPLACE FUNCTION "public"."flow_id_from_client_event_id"("p_client_event_id" "text") RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_match text[];
  v_flow_id bigint;
begin
  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    return null;
  end if;

  -- Imported flow ids are authoritative. The encoded payload can still contain
  -- the sender/source flow id in its legacy |f=... segment.
  v_match := regexp_match(
    p_client_event_id,
    '^flow_import:([0-9]+):',
    'i'
  );

  if v_match is not null and array_length(v_match, 1) > 0 then
    begin
      v_flow_id := nullif(v_match[1], '')::bigint;
    exception when others then
      v_flow_id := null;
    end;

    if v_flow_id is not null and v_flow_id > 0 then
      return v_flow_id;
    end if;
  end if;

  v_match := regexp_match(
    p_client_event_id,
    '\|f=([-0-9]+)(?:\||$)',
    'i'
  );

  if v_match is null or array_length(v_match, 1) = 0 then
    return null;
  end if;

  begin
    v_flow_id := nullif(v_match[1], '')::bigint;
  exception when others then
    return null;
  end;

  if v_flow_id is null or v_flow_id <= 0 then
    return null;
  end if;

  return v_flow_id;
end;
$_$;


ALTER FUNCTION "public"."flow_id_from_client_event_id"("p_client_event_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_id_from_client_event_id"("p_client_event_id" "text") IS 'Extracts the authoritative positive flow id from client_event_id. flow_import:<owner>:... owner ids win over legacy embedded |f= source ids.';



CREATE OR REPLACE FUNCTION "public"."flow_id_from_detail_metadata"("p_detail" "text") RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_match text[];
  v_flow_id bigint;
begin
  if p_detail is null or btrim(p_detail) = '' then
    return null;
  end if;

  v_match := regexp_match(
    p_detail,
    '(^|[;\r\n])flowLocalId=([-0-9]+)(?:[;\r\n]|$)',
    'i'
  );

  if v_match is null or array_length(v_match, 1) < 2 then
    return null;
  end if;

  begin
    v_flow_id := nullif(v_match[2], '')::bigint;
  exception when others then
    return null;
  end;

  if v_flow_id is null or v_flow_id <= 0 then
    return null;
  end if;

  return v_flow_id;
end;
$_$;


ALTER FUNCTION "public"."flow_id_from_detail_metadata"("p_detail" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_id_from_detail_metadata"("p_detail" "text") IS 'Extracts a positive flowLocalId=... reference from legacy event detail metadata. Negative/manual sentinels are ignored.';



CREATE OR REPLACE FUNCTION "public"."flow_is_calendar_placed"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select public.flow_record_kind(
    p_active,
    p_is_hidden,
    p_is_reminder,
    p_notes
  ) = 'active'
$$;


ALTER FUNCTION "public"."flow_is_calendar_placed"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_is_calendar_placed"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") IS 'Canonical flow placement predicate for user-facing active/inactive accounting. Only rows classified as active by the shared flow engine count as calendar-placed.';



CREATE OR REPLACE FUNCTION "public"."flow_is_deleted_state"("p_is_hidden" boolean, "p_notes" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    coalesce(p_is_hidden, false) = true
    and public.flow_has_repeating_note_metadata(p_notes) = false
$$;


ALTER FUNCTION "public"."flow_is_deleted_state"("p_is_hidden" boolean, "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_is_deleted_state"("p_is_hidden" boolean, "p_notes" "text") IS 'Canonical backend deletion predicate for rows that should never retain or accept linked user_events. Hidden repeating-note helper rows are excluded.';



CREATE OR REPLACE FUNCTION "public"."flow_is_deleted_state"("p_active" boolean, "p_is_hidden" boolean, "p_notes" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(p_is_hidden, false) = true
    and (
      public.flow_has_repeating_note_metadata(p_notes) = false
      or coalesce(p_active, false) = false
    )
$$;


ALTER FUNCTION "public"."flow_is_deleted_state"("p_active" boolean, "p_is_hidden" boolean, "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_is_deleted_state"("p_active" boolean, "p_is_hidden" boolean, "p_notes" "text") IS 'Deleted-state predicate with active-state awareness. Active repeating-note helpers are live helper rows; inactive hidden helpers are deleted rows.';



CREATE OR REPLACE FUNCTION "public"."flow_is_schedule_open"("p_end_date" "date", "p_timezone" "text", "p_now" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select
    p_end_date is null
    or p_end_date >= ((p_now at time zone coalesce(nullif(btrim(p_timezone), ''), 'UTC'))::date)
$$;


ALTER FUNCTION "public"."flow_is_schedule_open"("p_end_date" "date", "p_timezone" "text", "p_now" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_is_schedule_open"("p_end_date" "date", "p_timezone" "text", "p_now" timestamp with time zone) IS 'Canonical schedule-open predicate for flow accounting. A flow remains open through its local end_date in the user timezone.';



CREATE OR REPLACE FUNCTION "public"."flow_metadata_has_action_id"("p_ai_metadata" "jsonb", "p_action_id" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select nullif(btrim(coalesce(p_action_id, '')), '') is not null
    and btrim(p_action_id) = any(public.flow_action_ids_from_metadata(p_ai_metadata))
$$;


ALTER FUNCTION "public"."flow_metadata_has_action_id"("p_ai_metadata" "jsonb", "p_action_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flow_outcome_candidates"("p_limit" integer DEFAULT 500) RETURNS TABLE("flow_id" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select f.id as flow_id
  from public.flows f
  join public.profiles p on p.id = f.user_id and coalesce(p.personalization_enabled, true) = true
  left join public.flow_outcomes o
    on o.user_id = f.user_id
    and o.flow_id = f.id
    and o.window_start = f.start_date::date
  where f.start_date is not null
    and f.end_date is not null
    and (f.end_date::date) < current_date
    and coalesce(f.is_hidden, false) = false
    and coalesce(f.is_reminder, false) = false
    and o.id is null
  order by f.end_date
  limit greatest(p_limit, 0);
$$;


ALTER FUNCTION "public"."flow_outcome_candidates"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_outcome_candidates"("p_limit" integer) IS 'Returns ended, non-hidden, non-reminder flows with no outcome row for the start_date window, limited to users with personalization_enabled = true; used by cron to call compute_flow_outcome';



CREATE OR REPLACE FUNCTION "public"."flow_record_kind"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when coalesce(p_is_reminder, false) then 'reminder'
    when public.flow_has_repeating_note_metadata(p_notes)
      and coalesce(p_active, false) then 'hiddenHelper'
    when coalesce(p_is_hidden, false) then 'softDeleted'
    when coalesce(p_active, false) then 'active'
    else 'inactive'
  end
$$;


ALTER FUNCTION "public"."flow_record_kind"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flow_record_kind"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") IS 'Canonical flow classifier mirrored from the client engine. Repeating-note helper rows are helpers only while active; inactive hidden helpers are deleted rows.';



CREATE OR REPLACE FUNCTION "public"."fn_ai_quota_check_and_inc"("p_user_id" "uuid", "p_day" "date", "p_limit" integer DEFAULT 10) RETURNS TABLE("ok" boolean, "count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_curr int;
  v_new int;
begin
  -- Lock row if present
  select u."count" into v_curr
  from public.user_ai_usage as u
  where u.user_id = p_user_id
    and u.day = p_day
  for update;

  if not found then
    -- insert first hit
    insert into public.user_ai_usage(user_id, day, "count")
    values (p_user_id, p_day, 1);
    v_new := 1;

  else
    if v_curr < p_limit then
      update public.user_ai_usage as u
         set "count" = u."count" + 1
       where u.user_id = p_user_id
         and u.day = p_day
      returning u."count" into v_new;
    else
      v_new := v_curr;  -- at limit; do not increment
    end if;
  end if;

  if v_new <= p_limit then
    ok := true;
    count := v_new;
  else
    ok := false;
    count := v_new;
  end if;
  return next;
end;
$$;


ALTER FUNCTION "public"."fn_ai_quota_check_and_inc"("p_user_id" "uuid", "p_day" "date", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_audit_row"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_pk      jsonb;
  v_old     jsonb;
  v_new     jsonb;
  v_uid     uuid;
  v_email   text;
  v_ip      text;
begin
  if TG_OP = 'INSERT' then
    v_pk := to_jsonb(NEW) - (select array_agg(attname)
                             from pg_attribute
                             where attrelid = TG_RELID and attnum > 0 and not attisdropped
                            );
    if to_jsonb(NEW) ? 'id' then
      v_pk := jsonb_build_object('id', NEW.id);
    end if;
  else
    v_pk := jsonb_build_object('id', OLD.id);
  end if;

  if TG_OP in ('UPDATE','DELETE') then
    v_old := to_jsonb(OLD);
  end if;
  if TG_OP in ('INSERT','UPDATE') then
    v_new := to_jsonb(NEW);
  end if;

  v_uid   := auth.uid();
  begin
    v_email := coalesce( (auth.jwt() ->> 'email')::text, null );
  exception when others then
    v_email := null;
  end;

  begin
    v_ip := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  exception when others then
    v_ip := null;
  end;

  -- Safe audit insert: swallow any errors so main transaction continues
  begin
    INSERT INTO public.audit_log(table_name, action, row_pk, old_data, new_data, user_id, email, request_ip)
    VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP, v_pk, v_old, v_new, v_uid, v_email, v_ip);
  EXCEPTION WHEN OTHERS THEN
    -- swallow audit failures to avoid blocking main operation
    NULL;
  END;

  if TG_OP = 'DELETE' then
    return OLD;
  else
    return NEW;
  end if;
end;
$$;


ALTER FUNCTION "public"."fn_audit_row"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "flow_event_id" "uuid",
    "alert_at" timestamp with time zone NOT NULL,
    "channel" "text" DEFAULT 'push_and_in_app'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "detail" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reminders_channel_check" CHECK (("channel" = ANY (ARRAY['push_and_in_app'::"text", 'in_app_only'::"text", 'none'::"text"]))),
    CONSTRAINT "reminders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent_push'::"text", 'shown_in_app'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_due_reminders"("now_utc" timestamp with time zone) RETURNS SETOF "public"."reminders"
    LANGUAGE "sql" STABLE
    AS $$
  select * from reminders
  where user_id = auth.uid()
    and alert_at <= now_utc
    and status in ('pending','sent_push')
  order by alert_at asc;
$$;


ALTER FUNCTION "public"."get_due_reminders"("now_utc" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_flow_post_feed"("p_limit" integer DEFAULT 24, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "user_id" "uuid", "flow_id" bigint, "name" "text", "color" bigint, "notes" "text", "rules" "jsonb", "start_date" "date", "end_date" "date", "is_hidden" boolean, "ai_metadata" "jsonb", "created_at" timestamp with time zone, "author_handle" "text", "author_display_name" "text", "author_avatar_url" "text", "likes_count" integer, "comments_count" integer, "liked_by_me" boolean, "score" numeric, "is_following_author" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with
  args as (
    select
      greatest(1, least(coalesce(p_limit, 24), 48)) as limit_rows,
      greatest(0, coalesce(p_offset, 0)) as offset_rows
  ),
  viewer as (
    select auth.uid() as user_id
  ),
  viewer_profile as (
    select
      coalesce(
        (
          select array(
            select distinct slug
            from (
              select elem ->> 'slug' as slug
              from jsonb_array_elements(coalesce(rp.top_nodes, '[]'::jsonb)) elem
              union all
              select dominant_slug.slug
              from jsonb_array_elements_text(
                coalesce(rp.dominant_patterns, '[]'::jsonb)
              ) as dominant_slug(slug)
            ) viewer_slugs
            where coalesce(slug, '') <> ''
          )
          from public.reflection_profiles rp
          where rp.user_id = (select user_id from viewer)
        ),
        '{}'::text[]
      ) as nodes,
      coalesce(
        (
          select case
            when rp.isfet_risk_score is not null
              and rp.maat_score is not null
              and rp.isfet_risk_score > rp.maat_score
              then 'reduce_scatter'
            when rp.maat_score is not null
              and rp.maat_score > 0
              then 'reinforce_structure'
            else 'neutral'
          end
          from public.reflection_profiles rp
          where rp.user_id = (select user_id from viewer)
        ),
        'neutral'
      ) as balance_mode
  ),
  followed_authors as (
    select f.followee_id
    from public.follows f
    where f.follower_id = (select user_id from viewer)
    union
    select v.user_id
    from viewer v
    where v.user_id is not null
  ),
  followed_recent as (
    select fp.id
    from public.flow_posts fp
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and fp.user_id in (select followee_id from followed_authors)
    order by fp.created_at desc
    limit (select limit_rows from args) * 8
  ),
  community_recent as (
    select fp.id
    from public.flow_posts fp
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from followed_authors fa
        where fa.followee_id = fp.user_id
      )
    order by fp.created_at desc
    limit (select limit_rows from args) * 12
  ),
  candidate_posts as (
    select id from followed_recent
    union
    select id from community_recent
  ),
  posts as (
    select
      fp.id,
      fp.user_id,
      fp.flow_id,
      fp.name,
      fp.color,
      fp.notes,
      fp.rules,
      fp.start_date,
      fp.end_date,
      fp.is_hidden,
      fp.ai_metadata,
      fp.created_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      exists(
        select 1
        from public.follows f
        where f.follower_id = (select user_id from viewer)
          and f.followee_id = fp.user_id
      ) as is_following_author
    from public.flow_posts fp
    join candidate_posts cp
      on cp.id = fp.id
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
  ),
  post_likes as (
    select
      l.flow_post_id,
      count(*)::integer as likes_count
    from public.flow_post_likes l
    where l.flow_post_id in (select id from posts)
    group by l.flow_post_id
  ),
  post_viewer_likes as (
    select
      l.flow_post_id,
      true as liked_by_me
    from public.flow_post_likes l
    where l.user_id = (select user_id from viewer)
      and l.flow_post_id in (select id from posts)
  ),
  post_comments as (
    select
      c.flow_post_id,
      count(*)::integer as comments_count
    from public.flow_post_comments c
    where c.flow_post_id in (select id from posts)
    group by c.flow_post_id
  ),
  author_profiles as (
    select
      rp.user_id,
      array(
        select distinct slug
        from (
          select elem ->> 'slug' as slug
          from jsonb_array_elements(coalesce(rp.top_nodes, '[]'::jsonb)) elem
          union all
          select dominant_slug.slug
          from jsonb_array_elements_text(
            coalesce(rp.dominant_patterns, '[]'::jsonb)
          ) as dominant_slug(slug)
        ) author_slugs
        where coalesce(slug, '') <> ''
      ) as nodes,
      case
        when rp.isfet_risk_score is not null
          and rp.maat_score is not null
          and rp.isfet_risk_score > rp.maat_score
          then 'reduce_scatter'
        when rp.maat_score is not null
          and rp.maat_score > 0
          then 'reinforce_structure'
        else 'neutral'
      end as balance_mode
    from public.reflection_profiles rp
    where rp.user_id in (select distinct user_id from posts)
  ),
  scored_posts as (
    select
      p.id,
      p.user_id,
      p.flow_id,
      p.name,
      p.color,
      p.notes,
      p.rules,
      p.start_date,
      p.end_date,
      p.is_hidden,
      p.ai_metadata,
      p.created_at,
      p.author_handle,
      p.author_display_name,
      p.author_avatar_url,
      coalesce(pl.likes_count, 0) as likes_count,
      coalesce(pc.comments_count, 0) as comments_count,
      coalesce(pvl.liked_by_me, false) as liked_by_me,
      p.is_following_author,
      (
        case
          when p.user_id = (select user_id from viewer) then 6.5
          when p.is_following_author then 4.0
          else 0.0
        end
        + least(
          coalesce(pl.likes_count, 0) * 0.18
            + coalesce(pc.comments_count, 0) * 0.42,
          4.5
        )
        + exp(
          - greatest(
              extract(epoch from (timezone('utc', now()) - p.created_at))
                / 3600.0,
              0.0
            ) / 72.0
        ) * 5.5
        + coalesce(
            (
              select count(*)::numeric
              from unnest((select vp.nodes from viewer_profile vp)) viewer_node(slug)
              where viewer_node.slug = any(coalesce(ap.nodes, '{}'::text[]))
            ),
            0
          ) * 0.9
        + case
          when ap.balance_mode = (select vp.balance_mode from viewer_profile vp)
            and ap.balance_mode <> 'neutral'
            then 0.45
          else 0.0
        end
      )::numeric as score
    from posts p
    left join post_likes pl
      on pl.flow_post_id = p.id
    left join post_viewer_likes pvl
      on pvl.flow_post_id = p.id
    left join post_comments pc
      on pc.flow_post_id = p.id
    left join author_profiles ap
      on ap.user_id = p.user_id
  )
  select
    sp.id,
    sp.user_id,
    sp.flow_id,
    sp.name,
    sp.color,
    sp.notes,
    sp.rules,
    sp.start_date,
    sp.end_date,
    sp.is_hidden,
    sp.ai_metadata,
    sp.created_at,
    sp.author_handle,
    sp.author_display_name,
    sp.author_avatar_url,
    sp.likes_count,
    sp.comments_count,
    sp.liked_by_me,
    sp.score,
    sp.is_following_author
  from scored_posts sp
  order by sp.score desc, sp.created_at desc, sp.id desc
  limit (select limit_rows from args)
  offset (select offset_rows from args);
$$;


ALTER FUNCTION "public"."get_flow_post_feed"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_flow_post_feed"("p_limit" integer, "p_offset" integer) IS 'Returns a ranked page of public flow posts using follows, recency, engagement, and cached knowledge-graph overlap, including viewer like state.';



CREATE OR REPLACE FUNCTION "public"."get_my_flow_activity"() RETURNS TABLE("flow_id" bigint, "total_event_count" bigint, "remaining_event_count" bigint, "is_counted_active" boolean)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    f.id as flow_id,
    f.total_event_count,
    f.remaining_live_event_count as remaining_event_count,
    f.is_counted_active
  from public.flow_filing_items_client f
  where f.user_id = auth.uid()
$$;


ALTER FUNCTION "public"."get_my_flow_activity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_my_flow_activity"() IS 'Authenticated flow accountant backed by flow_filing_items_client. remaining_event_count is the count of live, not-completed, client-safe filed events.';



CREATE OR REPLACE FUNCTION "public"."get_my_preferences"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_row jsonb;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  v_enabled := _is_personalization_enabled(v_uid);
  if not v_enabled then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', p.user_id,
    'computed_at', p.computed_at,
    'window_days', p.window_days,
    'timezone', p.timezone,
    'prefs_version', p.prefs_version,
    'prefs', p.prefs
  )
  into v_row
  from public.ukg_user_preferences p
  where p.user_id = v_uid;

  if not found then
    return null;
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."get_my_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_telemetry_and_personalization"() RETURNS TABLE("telemetry_enabled" boolean, "personalization_enabled" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(p.telemetry_enabled, true), coalesce(p.personalization_enabled, true)
  from public.profiles p
  where p.id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_telemetry_and_personalization"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile_feed"("p_limit" integer DEFAULT 24, "p_offset" integer DEFAULT 0) RETURNS TABLE("post_type" "text", "id" "uuid", "user_id" "uuid", "flow_id" bigint, "name" "text", "color" bigint, "notes" "text", "rules" "jsonb", "start_date" "date", "end_date" "date", "ai_metadata" "jsonb", "insight_entry_id" "uuid", "node_slug" "text", "node_title" "text", "node_glyph" "text", "body_text" "text", "entry_date" "date", "is_hidden" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "author_handle" "text", "author_display_name" "text", "author_avatar_url" "text", "author_avatar_glyphs" "jsonb", "likes_count" integer, "comments_count" integer, "liked_by_me" boolean, "score" numeric, "is_following_author" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with
  args as (
    select
      greatest(1, least(coalesce(p_limit, 24), 48)) as limit_rows,
      greatest(0, coalesce(p_offset, 0)) as offset_rows
  ),
  viewer as (
    select auth.uid() as user_id
  ),
  viewer_profile as (
    select
      coalesce(
        (
          select array(
            select distinct slug
            from (
              select elem ->> 'slug' as slug
              from jsonb_array_elements(coalesce(rp.top_nodes, '[]'::jsonb)) elem
              union all
              select dominant_slug.slug
              from jsonb_array_elements_text(
                coalesce(rp.dominant_patterns, '[]'::jsonb)
              ) as dominant_slug(slug)
            ) viewer_slugs
            where coalesce(slug, '') <> ''
          )
          from public.reflection_profiles rp
          where rp.user_id = (select user_id from viewer)
        ),
        '{}'::text[]
      ) as nodes,
      coalesce(
        (
          select case
            when rp.isfet_risk_score is not null
              and rp.maat_score is not null
              and rp.isfet_risk_score > rp.maat_score
              then 'reduce_scatter'
            when rp.maat_score is not null
              and rp.maat_score > 0
              then 'reinforce_structure'
            else 'neutral'
          end
          from public.reflection_profiles rp
          where rp.user_id = (select user_id from viewer)
        ),
        'neutral'
      ) as balance_mode
  ),
  followed_authors as (
    select f.followee_id
    from public.follows f
    where f.follower_id = (select user_id from viewer)
    union
    select v.user_id
    from viewer v
    where v.user_id is not null
  ),
  followed_flow_recent as (
    select
      'flow'::text as post_type,
      fp.id
    from public.flow_posts fp
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and fp.user_id in (select followee_id from followed_authors)
    order by fp.created_at desc
    limit (select limit_rows from args) * 8
  ),
  community_flow_recent as (
    select
      'flow'::text as post_type,
      fp.id
    from public.flow_posts fp
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from followed_authors fa
        where fa.followee_id = fp.user_id
      )
    order by fp.created_at desc
    limit (select limit_rows from args) * 12
  ),
  followed_insight_recent as (
    select
      'insight'::text as post_type,
      ip.id
    from public.insight_posts ip
    join public.profiles p
      on p.id = ip.user_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and ip.user_id in (select followee_id from followed_authors)
    order by ip.created_at desc
    limit (select limit_rows from args) * 8
  ),
  community_insight_recent as (
    select
      'insight'::text as post_type,
      ip.id
    from public.insight_posts ip
    join public.profiles p
      on p.id = ip.user_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from followed_authors fa
        where fa.followee_id = ip.user_id
      )
    order by ip.created_at desc
    limit (select limit_rows from args) * 12
  ),
  candidate_posts as (
    select post_type, id from followed_flow_recent
    union
    select post_type, id from community_flow_recent
    union
    select post_type, id from followed_insight_recent
    union
    select post_type, id from community_insight_recent
  ),
  flow_posts as (
    select
      'flow'::text as post_type,
      fp.id,
      fp.user_id,
      fp.flow_id,
      fp.name,
      fp.color,
      fp.notes,
      fp.rules,
      fp.start_date,
      fp.end_date,
      fp.ai_metadata,
      null::uuid as insight_entry_id,
      null::text as node_slug,
      null::text as node_title,
      null::text as node_glyph,
      null::text as body_text,
      null::date as entry_date,
      fp.is_hidden,
      fp.created_at,
      fp.created_at as updated_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      p.avatar_glyphs as author_avatar_glyphs,
      exists(
        select 1
        from public.follows f
        where f.follower_id = (select user_id from viewer)
          and f.followee_id = fp.user_id
      ) as is_following_author
    from public.flow_posts fp
    join candidate_posts cp
      on cp.post_type = 'flow'
     and cp.id = fp.id
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
  ),
  insight_posts as (
    select
      'insight'::text as post_type,
      ip.id,
      ip.user_id,
      null::bigint as flow_id,
      null::text as name,
      null::bigint as color,
      null::text as notes,
      null::jsonb as rules,
      null::date as start_date,
      null::date as end_date,
      null::jsonb as ai_metadata,
      ip.insight_entry_id,
      n.slug as node_slug,
      n.title as node_title,
      n.glyph as node_glyph,
      ip.body_text,
      ip.entry_date,
      ip.is_hidden,
      ip.created_at,
      ip.updated_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      p.avatar_glyphs as author_avatar_glyphs,
      exists(
        select 1
        from public.follows f
        where f.follower_id = (select user_id from viewer)
          and f.followee_id = ip.user_id
      ) as is_following_author
    from public.insight_posts ip
    join candidate_posts cp
      on cp.post_type = 'insight'
     and cp.id = ip.id
    join public.nodes n
      on n.id = ip.node_id
    join public.profiles p
      on p.id = ip.user_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
  ),
  posts as (
    select * from flow_posts
    union all
    select * from insight_posts
  ),
  flow_likes as (
    select
      l.flow_post_id,
      count(*)::integer as likes_count
    from public.flow_post_likes l
    where l.flow_post_id in (
      select p.id
      from posts p
      where p.post_type = 'flow'
    )
    group by l.flow_post_id
  ),
  flow_viewer_likes as (
    select
      l.flow_post_id,
      true as liked_by_me
    from public.flow_post_likes l
    where l.user_id = (select user_id from viewer)
      and l.flow_post_id in (
        select p.id
        from posts p
        where p.post_type = 'flow'
      )
  ),
  flow_comments as (
    select
      c.flow_post_id,
      count(*)::integer as comments_count
    from public.flow_post_comments c
    where c.flow_post_id in (
      select p.id
      from posts p
      where p.post_type = 'flow'
    )
    group by c.flow_post_id
  ),
  author_profiles as (
    select
      rp.user_id,
      array(
        select distinct slug
        from (
          select elem ->> 'slug' as slug
          from jsonb_array_elements(coalesce(rp.top_nodes, '[]'::jsonb)) elem
          union all
          select dominant_slug.slug
          from jsonb_array_elements_text(
            coalesce(rp.dominant_patterns, '[]'::jsonb)
          ) as dominant_slug(slug)
        ) author_slugs
        where coalesce(slug, '') <> ''
      ) as nodes,
      case
        when rp.isfet_risk_score is not null
          and rp.maat_score is not null
          and rp.isfet_risk_score > rp.maat_score
          then 'reduce_scatter'
        when rp.maat_score is not null
          and rp.maat_score > 0
          then 'reinforce_structure'
        else 'neutral'
      end as balance_mode
    from public.reflection_profiles rp
    where rp.user_id in (select distinct user_id from posts)
  ),
  scored_posts as (
    select
      p.post_type,
      p.id,
      p.user_id,
      p.flow_id,
      p.name,
      p.color,
      p.notes,
      p.rules,
      p.start_date,
      p.end_date,
      p.ai_metadata,
      p.insight_entry_id,
      p.node_slug,
      p.node_title,
      p.node_glyph,
      p.body_text,
      p.entry_date,
      p.is_hidden,
      p.created_at,
      p.updated_at,
      p.author_handle,
      p.author_display_name,
      p.author_avatar_url,
      p.author_avatar_glyphs,
      case
        when p.post_type = 'flow' then coalesce(fl.likes_count, 0)
        else 0
      end as likes_count,
      case
        when p.post_type = 'flow' then coalesce(fc.comments_count, 0)
        else 0
      end as comments_count,
      case
        when p.post_type = 'flow' then coalesce(fvl.liked_by_me, false)
        else null
      end as liked_by_me,
      p.is_following_author,
      (
        case
          when p.user_id = (select user_id from viewer) then 6.5
          when p.is_following_author then 4.0
          else 0.0
        end
        + case
          when p.post_type = 'flow'
            then least(
              coalesce(fl.likes_count, 0) * 0.18
                + coalesce(fc.comments_count, 0) * 0.42,
              4.5
            )
          else 0.0
        end
        + exp(
          - greatest(
              extract(epoch from (timezone('utc', now()) - p.created_at))
                / 3600.0,
              0.0
            ) / 72.0
        ) * case
          when p.post_type = 'flow' then 5.5
          else 5.1
        end
        + coalesce(
            (
              select count(*)::numeric
              from unnest((select vp.nodes from viewer_profile vp)) viewer_node(slug)
              where viewer_node.slug = any(coalesce(ap.nodes, '{}'::text[]))
            ),
            0
          ) * 0.9
        + case
          when p.post_type = 'insight'
            and coalesce(p.node_slug, '') <> ''
            and p.node_slug = any(
              coalesce((select vp.nodes from viewer_profile vp), '{}'::text[])
            )
            then 1.25
          else 0.0
        end
        + case
          when ap.balance_mode = (select vp.balance_mode from viewer_profile vp)
            and ap.balance_mode <> 'neutral'
            then 0.45
          else 0.0
        end
      )::numeric as score
    from posts p
    left join flow_likes fl
      on fl.flow_post_id = p.id
    left join flow_comments fc
      on fc.flow_post_id = p.id
    left join flow_viewer_likes fvl
      on fvl.flow_post_id = p.id
    left join author_profiles ap
      on ap.user_id = p.user_id
  )
  select
    sp.post_type,
    sp.id,
    sp.user_id,
    sp.flow_id,
    sp.name,
    sp.color,
    sp.notes,
    sp.rules,
    sp.start_date,
    sp.end_date,
    sp.ai_metadata,
    sp.insight_entry_id,
    sp.node_slug,
    sp.node_title,
    sp.node_glyph,
    sp.body_text,
    sp.entry_date,
    sp.is_hidden,
    sp.created_at,
    sp.updated_at,
    sp.author_handle,
    sp.author_display_name,
    sp.author_avatar_url,
    sp.author_avatar_glyphs,
    sp.likes_count,
    sp.comments_count,
    sp.liked_by_me,
    sp.score,
    sp.is_following_author
  from scored_posts sp
  order by
    sp.score desc,
    sp.created_at desc,
    sp.id desc
  limit (select limit_rows from args)
  offset (select offset_rows from args);
$$;


ALTER FUNCTION "public"."get_profile_feed"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_profile_feed"("p_limit" integer, "p_offset" integer) IS 'Returns a ranked mixed feed of posted flows and posted insights using follows, recency, engagement, and reflection-profile overlap.';



CREATE OR REPLACE FUNCTION "public"."get_profile_flow_counts"("p_user_id" "uuid") RETURNS TABLE("active_flows_count" bigint, "total_flow_events_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'pg_temp'
    AS $$
  select
    count(*) filter (
      where f.visible_in_active_list
        and f.item_kind = 'flow'
    ) as active_flows_count,
    coalesce(
      sum(f.remaining_live_event_count) filter (
        where f.visible_in_active_list
          and f.item_kind = 'flow'
      ),
      0
    ) as total_flow_events_count
  from private.flow_filing_items_internal f
  where f.user_id = p_user_id
$$;


ALTER FUNCTION "public"."get_profile_flow_counts"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_profile_flow_counts"("p_user_id" "uuid") IS 'Profile flow counts backed by private.flow_filing_items_internal so profile stats use the same flow filing lifecycle as My Flows.';



CREATE OR REPLACE FUNCTION "public"."get_recent_outcome_vectors"("p_user_id" "uuid", "p_limit" integer DEFAULT 6) RETURNS SETOF "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid;
  v_role text;
  v_limit integer;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claims.role', true);
  v_limit := coalesce(p_limit, 6);
  v_limit := greatest(0, least(v_limit, 20)); -- hard cap to keep payload small

  -- Authz: require caller to request their own vectors, except service_role for debugging
  if v_uid is null then
    if v_role = 'service_role' and p_user_id is not null then
      v_uid := p_user_id;
    else
      raise exception 'unauthenticated';
    end if;
  end if;

  if p_user_id is distinct from v_uid then
    raise exception 'unauthorized for user %', coalesce(p_user_id::text, '<null>');
  end if;

  return query
  select jsonb_build_object(
    'vector_version', 'ov_v1',
    'window_start', o.window_start,
    'window_end', o.window_end,
    'flow_id', o.flow_id,
    'origin_type', f.origin_type,
    'origin_generation_id', f.origin_generation_id,
    'schedule_density', (
      case
        when o.window_start is not null and o.window_end is not null then
          coalesce(
            (o.metadata->>'schedule_density')::numeric,
            case
              when (o.metadata->>'scheduled_days') is not null then
                round(((o.metadata->>'scheduled_days')::numeric / greatest(((o.window_end - o.window_start) + 1), 1))::numeric, 4)
              else null::numeric
            end
          )
        else (o.metadata->>'schedule_density')::numeric
      end
    ),
    'journal_density', (
      case
        when o.window_start is not null
         and o.window_end is not null
         and (o.metadata->>'journal_days') is not null then
          round(((o.metadata->>'journal_days')::numeric / greatest(((o.window_end - o.window_start) + 1), 1))::numeric, 4)
        else null::numeric
      end
    ),
    'events_total', o.events_total,
    'events_completed', o.events_completed,
    'completion_ratio', (
      case
        when coalesce(o.events_total, 0) = 0 then null
        else coalesce(
          (o.metadata->>'completion_ratio')::numeric,
          case
            when o.events_completed is not null then round((o.events_completed::numeric / nullif(o.events_total, 0))::numeric, 4)
            else null::numeric
          end
        )
      end
    ),
    'badge_count', (o.metadata->>'badge_count')::integer,
    'edit_count', o.edit_count,
    'edit_pressure', (
      case
        when coalesce(o.events_total, 0) = 0 then null
        when o.edit_count is null then null
        else round((o.edit_count::numeric / nullif(o.events_total, 0))::numeric, 4)
      end
    ),
    'accepted_as_is', o.accepted_as_is,
    'outcome_confidence', o.metadata->>'outcome_confidence',
    'lower_bounds', jsonb_build_object(
      'edit_count', true,
      'badge_count', true
    ),
    'journal_days', (o.metadata->>'journal_days')::integer,
    'scheduled_days', (o.metadata->>'scheduled_days')::integer,
    'n_days', (
      case
        when o.window_start is not null and o.window_end is not null
          then (o.window_end - o.window_start) + 1
        else null
      end
    )
  )
  from public.flow_outcomes o
  join public.flows f
    on f.id = o.flow_id
   and f.user_id = o.user_id
  where o.user_id = v_uid
  order by o.recorded_at desc
  limit v_limit;
end;
$$;


ALTER FUNCTION "public"."get_recent_outcome_vectors"("p_user_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_recent_outcome_vectors"("p_user_id" "uuid", "p_limit" integer) IS 'Phase 4: returns recent ov_v1 outcome vectors for the current user (or explicit user when service_role), joining flow_outcomes + flows.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, created_at, updated_at)
  VALUES (NEW.id, now(), now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invite_user_to_shared_calendar"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text" DEFAULT 'editor'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_role text := coalesce(nullif(btrim(p_role), ''), 'editor');
  v_existing_status text;
  v_calendar_name text;
  v_calendar_color bigint;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'INVITEE_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_INVITE_SELF';
  end if;

  if v_role not in ('editor', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_INVITABLE';
  end if;

  select scm.status
    into v_existing_status
  from public.shared_calendar_members scm
  where scm.calendar_id = p_calendar_id
    and scm.user_id = p_user_id;

  if v_existing_status = 'accepted' then
    return;
  end if;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at
  )
  values (
    p_calendar_id,
    p_user_id,
    v_role,
    'pending',
    v_actor_id,
    null
  )
  on conflict (calendar_id, user_id)
  do update
    set role = excluded.role,
        status = 'pending',
        invited_by = excluded.invited_by,
        responded_at = null,
        updated_at = now();

  select sc.name, sc.color
    into v_calendar_name, v_calendar_color
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  update public.shared_calendar_notifications
     set deleted_at = now(),
         updated_at = now()
   where recipient_id = p_user_id
     and calendar_id = p_calendar_id
     and kind = 'calendar_invite'
     and deleted_at is null;

  insert into public.shared_calendar_notifications (
    calendar_id,
    recipient_id,
    actor_id,
    kind,
    title,
    body,
    payload_json
  )
  values (
    p_calendar_id,
    p_user_id,
    v_actor_id,
    'calendar_invite',
    coalesce(nullif(btrim(v_calendar_name), ''), 'Calendar invite'),
    format(
      'You were invited to join %s.',
      coalesce(nullif(btrim(v_calendar_name), ''), 'this calendar')
    ),
    jsonb_build_object(
      'notification_kind', 'calendar_invite',
      'calendar_id', p_calendar_id::text,
      'calendar_name', coalesce(v_calendar_name, ''),
      'calendar_color', v_calendar_color,
      'role', v_role
    )
  );
end;
$$;


ALTER FUNCTION "public"."invite_user_to_shared_calendar"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_shared_calendar"("p_calendar_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_is_personal boolean;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select sc.owner_id, sc.is_personal
    into v_owner_id, v_is_personal
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  if v_owner_id is null then
    raise exception 'CALENDAR_NOT_FOUND';
  end if;

  if v_owner_id = v_user_id then
    if v_is_personal then
      raise exception 'CANNOT_DELETE_PERSONAL_CALENDAR';
    end if;

    delete from public.shared_calendars
    where id = p_calendar_id
      and owner_id = v_user_id;
    return;
  end if;

  delete from public.shared_calendar_members scm
  where scm.calendar_id = p_calendar_id
    and scm.user_id = v_user_id;
end;
$$;


ALTER FUNCTION "public"."leave_shared_calendar"("p_calendar_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_shared_calendar_members"("p_calendar_id" "uuid") RETURNS TABLE("user_id" "uuid", "role" "text", "status" "text", "invited_by" "uuid", "invited_at" timestamp with time zone, "responded_at" timestamp with time zone, "updated_at" timestamp with time zone, "handle" "text", "display_name" "text", "avatar_url" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_is_owner boolean;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select sc.owner_id = v_actor_id
    into v_is_owner
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null
    and sc.is_personal = false;

  if v_is_owner is null then
    raise exception 'CALENDAR_NOT_FOUND';
  end if;

  if not v_is_owner and not exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
  ) then
    raise exception 'CALENDAR_NOT_ACCESSIBLE';
  end if;

  return query
  select
    scm.user_id,
    scm.role,
    scm.status,
    scm.invited_by,
    scm.created_at as invited_at,
    scm.responded_at,
    scm.updated_at,
    p.handle,
    p.display_name,
    p.avatar_url
  from public.shared_calendar_members scm
  left join public.profiles p
    on p.id = scm.user_id
  where scm.calendar_id = p_calendar_id
    and (
      scm.status = 'accepted'
      or (v_is_owner and scm.status = 'pending')
    )
  order by
    case scm.status
      when 'accepted' then 0
      when 'pending' then 1
      else 2
    end,
    case scm.role
      when 'owner' then 0
      when 'editor' then 1
      when 'viewer' then 2
      else 3
    end,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.handle), ''), scm.user_id::text);
end;
$$;


ALTER FUNCTION "public"."list_shared_calendar_members"("p_calendar_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_shared_calendar_member"("p_calendar_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_REMOVE_SELF';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_MANAGEABLE';
  end if;

  delete from public.shared_calendar_members scm
   where scm.calendar_id = p_calendar_id
     and scm.user_id = p_user_id
     and scm.status = 'accepted'
     and scm.role <> 'owner';

  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;
end;
$$;


ALTER FUNCTION "public"."remove_shared_calendar_member"("p_calendar_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_shared_calendar_invite"("p_calendar_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'INVITEE_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_REVOKE_SELF';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_MANAGEABLE';
  end if;

  delete from public.shared_calendar_members scm
   where scm.calendar_id = p_calendar_id
     and scm.user_id = p_user_id
     and scm.status = 'pending'
     and scm.role <> 'owner';

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  update public.shared_calendar_notifications scn
     set deleted_at = now(),
         updated_at = now()
   where scn.calendar_id = p_calendar_id
     and scn.recipient_id = p_user_id
     and scn.kind = 'calendar_invite'
     and scn.deleted_at is null;
end;
$$;


ALTER FUNCTION "public"."revoke_shared_calendar_invite"("p_calendar_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_shared_calendar_member_role"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_role text := coalesce(nullif(btrim(p_role), ''), '');
  v_status text;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_CHANGE_SELF';
  end if;

  if v_role not in ('editor', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_MANAGEABLE';
  end if;

  update public.shared_calendar_members scm
     set role = v_role,
         updated_at = now()
   where scm.calendar_id = p_calendar_id
     and scm.user_id = p_user_id
     and scm.status in ('accepted', 'pending')
     and scm.role <> 'owner'
  returning scm.status
    into v_status;

  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_status = 'pending' then
    update public.shared_calendar_notifications scn
       set payload_json = jsonb_set(
             coalesce(scn.payload_json, '{}'::jsonb),
             '{role}',
             to_jsonb(v_role),
             true
           ),
           updated_at = now()
     where scn.calendar_id = p_calendar_id
       and scn.recipient_id = p_user_id
       and scn.kind = 'calendar_invite'
       and scn.deleted_at is null;
  end if;
end;
$$;


ALTER FUNCTION "public"."update_shared_calendar_member_role"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_flow_inserts"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  _claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  insert into public.flow_insert_debug(ip, claims,
    sub, role, new_row)
  values (
    inet_client_addr(),
    _claims,
    coalesce((_claims->>'sub')::uuid, null),
    _claims->>'role',
    to_jsonb(new)
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."log_flow_inserts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_reminder_status"("reminder_id" "uuid", "new_status" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update reminders
     set status = new_status,
         updated_at = now()
   where id = reminder_id
     and user_id = auth.uid();
$$;


ALTER FUNCTION "public"."mark_reminder_status"("reminder_id" "uuid", "new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_flow_visibility_state"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if public.flow_is_deleted_state(new.active, new.is_hidden, new.notes) then
    new.active := false;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."normalize_flow_visibility_state"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."normalize_flow_visibility_state"() IS 'Prevents impossible hidden-active non-helper rows. Any hidden non-repeating-note flow is normalized to active=false before write.';



CREATE OR REPLACE FUNCTION "public"."notify_shared_calendar_members"("p_calendar_id" "uuid", "p_recipient_ids" "uuid"[], "p_kind" "text", "p_title" "text", "p_body" "text" DEFAULT NULL::"text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_kind text := coalesce(nullif(btrim(p_kind), ''), 'calendar_event');
  v_title text := coalesce(nullif(btrim(p_title), ''), 'Calendar update');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_inserted_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_calendar_id is null then
    raise exception 'CALENDAR_REQUIRED';
  end if;

  if coalesce(array_length(p_recipient_ids, 1), 0) = 0 then
    return 0;
  end if;

  if v_kind not in ('calendar_event') then
    raise exception 'INVALID_NOTIFICATION_KIND';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
      and sc.deleted_at is null
  ) then
    raise exception 'CALENDAR_NOT_EDITABLE';
  end if;

  with requested_recipients as (
    select distinct unnest(p_recipient_ids) as user_id
  )
  insert into public.shared_calendar_notifications (
    calendar_id,
    recipient_id,
    actor_id,
    kind,
    title,
    body,
    payload_json
  )
  select
    p_calendar_id,
    scm.user_id,
    v_actor_id,
    v_kind,
    v_title,
    nullif(btrim(coalesce(p_body, '')), ''),
    v_payload || jsonb_build_object(
      'notification_kind',
      v_kind,
      'calendar_id',
      p_calendar_id::text
    )
  from public.shared_calendar_members scm
  join requested_recipients rr
    on rr.user_id = scm.user_id
  where scm.calendar_id = p_calendar_id
    and scm.status = 'accepted'
    and scm.user_id <> v_actor_id;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
end;
$$;


ALTER FUNCTION "public"."notify_shared_calendar_members"("p_calendar_id" "uuid", "p_recipient_ids" "uuid"[], "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_stale_reminder_occurrences"() RETURNS TABLE("stale_reminder_events_removed" integer, "stale_reminder_notifications_deactivated" integer, "stale_reminder_tombstones_removed" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_events_removed integer := 0;
  v_notifications_deactivated integer := 0;
  v_tombstones_removed integer := 0;
begin
  drop table if exists pg_temp.stale_reminder_occurrences;

  create temporary table stale_reminder_occurrences (
    id uuid,
    user_id uuid not null,
    client_event_id text not null
  ) on commit drop;

  insert into stale_reminder_occurrences (id, user_id, client_event_id)
  with flow_rules as (
    select
      f.*,
      public.try_parse_jsonb(f.notes) as rule_json
    from public.flows f
    where f.is_reminder = true
      and f.active = true
      and coalesce(f.is_hidden, false) = false
      and f.reminder_uuid is not null
      and public.flow_is_deleted_state(
        f.active,
        coalesce(f.is_hidden, false),
        f.notes
      ) = false
  ),
  bounded_flows as (
    select
      flow_rules.*,
      coalesce(
        flow_rules.start_date,
        case
          when coalesce(flow_rules.rule_json ->> 'startLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'startLocal')::timestamp)::date
          else null
        end
      ) as effective_start_date,
      coalesce(
        flow_rules.end_date,
        case
          when coalesce(flow_rules.rule_json ->> 'endLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'endLocal')::timestamp)::date
          else null
        end
      ) as effective_end_date
    from flow_rules
  )
  select distinct
    ue.id,
    ue.user_id,
    ue.client_event_id
  from public.user_events ue
  join bounded_flows
    on bounded_flows.user_id = ue.user_id
   and bounded_flows.reminder_uuid = public.user_event_reminder_uuid(ue.client_event_id)
  cross join lateral (
    select public.user_event_reminder_occurrence_date(ue.client_event_id) as occurrence_date
  ) occurrence
  where occurrence.occurrence_date is not null
    and (
      occurrence.occurrence_date < coalesce(
        bounded_flows.effective_start_date,
        occurrence.occurrence_date
      )
      or (
        bounded_flows.effective_end_date is not null
        and occurrence.occurrence_date > bounded_flows.effective_end_date
      )
    );

  delete from public.user_events ue
  using stale_reminder_occurrences stale
  where ue.id = stale.id;

  get diagnostics v_events_removed = row_count;

  delete from public.event_deletion_trash edt
  using stale_reminder_occurrences stale
  where edt.user_id = stale.user_id
    and edt.client_event_id = stale.client_event_id
    and edt.purged_at is null;

  get diagnostics v_tombstones_removed = row_count;

  with flow_rules as (
    select
      f.*,
      public.try_parse_jsonb(f.notes) as rule_json
    from public.flows f
    where f.is_reminder = true
      and f.active = true
      and coalesce(f.is_hidden, false) = false
      and f.reminder_uuid is not null
      and public.flow_is_deleted_state(
        f.active,
        coalesce(f.is_hidden, false),
        f.notes
      ) = false
  ),
  bounded_flows as (
    select
      flow_rules.*,
      coalesce(
        flow_rules.start_date,
        case
          when coalesce(flow_rules.rule_json ->> 'startLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'startLocal')::timestamp)::date
          else null
        end
      ) as effective_start_date,
      coalesce(
        flow_rules.end_date,
        case
          when coalesce(flow_rules.rule_json ->> 'endLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'endLocal')::timestamp)::date
          else null
        end
      ) as effective_end_date
    from flow_rules
  ),
  stale_notifications as (
    select sn.id
    from public.scheduled_notifications sn
    join bounded_flows
      on bounded_flows.user_id = sn.user_id
     and bounded_flows.reminder_uuid = public.user_event_reminder_uuid(sn.client_event_id)
    cross join lateral (
      select public.user_event_reminder_occurrence_date(sn.client_event_id) as occurrence_date
    ) occurrence
    where sn.is_active = true
      and occurrence.occurrence_date is not null
      and (
        occurrence.occurrence_date < coalesce(
          bounded_flows.effective_start_date,
          occurrence.occurrence_date
        )
        or (
          bounded_flows.effective_end_date is not null
          and occurrence.occurrence_date > bounded_flows.effective_end_date
        )
      )
  )
  update public.scheduled_notifications sn
  set
    is_active = false,
    updated_at = now()
  from stale_notifications stale
  where sn.id = stale.id;

  get diagnostics v_notifications_deactivated = row_count;

  stale_reminder_events_removed := coalesce(v_events_removed, 0);
  stale_reminder_notifications_deactivated := coalesce(v_notifications_deactivated, 0);
  stale_reminder_tombstones_removed := coalesce(v_tombstones_removed, 0);
  return next;
end;
$$;


ALTER FUNCTION "public"."prune_stale_reminder_occurrences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_deleted_flow_events"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_was_deleted boolean;
  v_is_deleted boolean;
begin
  v_was_deleted := public.flow_is_deleted_state(
    old.active,
    old.is_hidden,
    old.notes
  );
  v_is_deleted := public.flow_is_deleted_state(
    new.active,
    new.is_hidden,
    new.notes
  );

  if not v_is_deleted then
    return new;
  end if;

  if v_was_deleted and old.share_id is not distinct from new.share_id then
    return new;
  end if;

  delete from public.user_events ue
  where lower(coalesce(ue.category, '')) <> 'tombstone'
    and public.user_event_references_flow(
      new.id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail
    );

  perform public.clear_flow_import_status_by_share_id(new.share_id);

  return new;
end;
$$;


ALTER FUNCTION "public"."purge_deleted_flow_events"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_deleted_flow_events"() IS 'Deletes every non-tombstone user_events row that references a flow when that flow transitions into the backend deleted state, including inactive repeating-note helpers.';



CREATE OR REPLACE FUNCTION "public"."purge_old_event_deletion_trash"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_count integer := 0;
begin
  delete from public.user_events ue
  using public.event_deletion_trash edt
  where edt.purge_after <= timezone('utc', now())
    and edt.purged_at is null
    and edt.suppresses_client = true
    and edt.user_id = ue.user_id
    and edt.client_event_id is not null
    and ue.client_event_id = edt.client_event_id;

  with deleted as (
    delete from public.event_deletion_trash edt
    where edt.purge_after <= timezone('utc', now())
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;


ALTER FUNCTION "public"."purge_old_event_deletion_trash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_event_filing_backbone"("p_limit" integer DEFAULT 50000) RETURNS TABLE("orphan_reminder_events_deleted" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_limit integer := greatest(coalesce(p_limit, 50000), 1);
begin
  with candidates as (
    select ue.id
    from public.user_events ue
    where public.user_event_reminder_uuid(ue.client_event_id) is not null
      and public.user_event_has_active_reminder_flow_for_occurrence(
        ue.user_id,
        ue.client_event_id
      ) = false
      and not exists (
        select 1
        from public.reminders r
        where r.user_id = ue.user_id
          and r.id = public.user_event_reminder_uuid(ue.client_event_id)
      )
      and not exists (
        select 1
        from public.scheduled_notifications sn
        where sn.user_id = ue.user_id
          and sn.is_active = true
          and sn.client_event_id = ue.client_event_id
      )
    order by ue.created_at nulls last, ue.id
    limit v_limit
  ),
  deleted as (
    delete from public.user_events ue
    using candidates c
    where ue.id = c.id
    returning 1
  )
  select count(*)::integer
  into orphan_reminder_events_deleted
  from deleted;

  return next;
end;
$$;


ALTER FUNCTION "public"."reconcile_event_filing_backbone"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_event_filing_backbone"("p_limit" integer) IS 'Repeatable filing reconciliation job. Removes orphan materialized reminder events only when no active reminder flow, legacy reminder row, or active notification can justify them.';



CREATE OR REPLACE FUNCTION "public"."record_event_completion"("p_client_event_id" "text", "p_flow_id" bigint, "p_completed_on" "date", "p_source" "text" DEFAULT 'client'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    raise exception 'client_event_id required';
  end if;

  if p_flow_id is null then
    raise exception 'flow_id required';
  end if;

  if p_completed_on is null then
    raise exception 'completed_on required';
  end if;

  if not exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = p_flow_id
     and f.user_id = v_uid
    where ue.user_id = v_uid
      and ue.client_event_id = p_client_event_id
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
  ) then
    raise exception 'event not found or not owned';
  end if;

  insert into public.user_event_completions (
    user_id,
    client_event_id,
    flow_id,
    completed_on,
    completed_at,
    source
  )
  values (
    v_uid,
    p_client_event_id,
    p_flow_id,
    p_completed_on,
    now(),
    coalesce(p_source, 'client')
  )
  on conflict (user_id, client_event_id) do update
    set completed_on = excluded.completed_on,
        completed_at = excluded.completed_at,
        source = excluded.source;
end;
$$;


ALTER FUNCTION "public"."record_event_completion"("p_client_event_id" "text", "p_flow_id" bigint, "p_completed_on" "date", "p_source" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_event_completion"("p_client_event_id" "text", "p_flow_id" bigint, "p_completed_on" "date", "p_source" "text") IS 'Validates ownership using the canonical flow-event matcher and upserts a completion keyed by client_event_id + completed_on.';



CREATE OR REPLACE FUNCTION "public"."record_user_event_tombstone"("p_client_event_id" "text", "p_calendar_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT 'client_delete'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_client_event_id text := nullif(btrim(p_client_event_id), '');
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'client_delete');
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_client_event_id is null then
    return;
  end if;

  if p_calendar_id is not null and not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_uid
      and scm.status = 'accepted'
      and sc.deleted_at is null
  ) then
    raise exception 'CALENDAR_NOT_ACCESSIBLE';
  end if;

  insert into public.event_deletion_trash (
    user_id,
    source_table,
    client_event_id,
    calendar_id,
    title,
    deleted_at,
    purge_after,
    delete_semantic,
    suppresses_client,
    source_feature,
    delete_scope,
    operation_id,
    actor_id,
    row_data
  )
  values (
    v_uid,
    'client_tombstone',
    v_client_event_id,
    p_calendar_id,
    'deleted',
    timezone('utc', now()),
    timezone('utc', now()) + interval '10 days',
    'client_tombstone',
    true,
    'record_user_event_tombstone',
    case
      when v_client_event_id like 'reminder:rule:%' then 'reminder_rule'
      when v_client_event_id like 'reminder:%' and v_client_event_id not like 'reminder:%:%' then 'reminder_series'
      else 'exact_occurrence'
    end,
    v_operation_id,
    v_uid,
    jsonb_build_object(
      'reason', v_reason,
      'delete_semantic', 'client_tombstone',
      'suppresses_client', true,
      'source_feature', 'record_user_event_tombstone',
      'operation_id', v_operation_id,
      'actor_id', v_uid
    )
  );
end;
$$;


ALTER FUNCTION "public"."record_user_event_tombstone"("p_client_event_id" "text", "p_calendar_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."repair_active_reminder_filing_backbone"() RETURNS TABLE("reminder_event_rows_restored" integer, "reminder_notifications_reactivated" integer, "reminder_occurrence_tombstones_removed" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_restored integer := 0;
  v_reactivated integer := 0;
  v_tombstones_removed integer := 0;
  v_pruned record;
begin
  drop table if exists pg_temp.reminder_restore_candidates;

  create temporary table reminder_restore_candidates (
    user_id uuid not null,
    client_event_id text not null,
    title text not null,
    detail text,
    location text,
    all_day boolean not null,
    starts_at timestamp with time zone not null,
    ends_at timestamp with time zone,
    flow_local_id integer not null,
    calendar_id uuid not null,
    category text,
    source_priority integer not null
  ) on commit drop;

  insert into reminder_restore_candidates (
    user_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    calendar_id,
    category,
    source_priority
  )
  with flow_rules as (
    select
      f.*,
      public.try_parse_jsonb(f.notes) as rule_json,
      coalesce(nullif(p.timezone, ''), 'America/Los_Angeles') as profile_timezone
    from public.flows f
    left join public.profiles p
      on p.id = f.user_id
    where f.is_reminder = true
      and f.active = true
      and coalesce(f.is_hidden, false) = false
      and f.reminder_uuid is not null
      and public.flow_is_deleted_state(
        f.active,
        coalesce(f.is_hidden, false),
        f.notes
      ) = false
  ),
  active_flows as (
    select
      flow_rules.*,
      case
        when coalesce(flow_rules.rule_json ->> 'alertOffsetMinutes', '') ~ '^-?[0-9]+$'
          then (flow_rules.rule_json ->> 'alertOffsetMinutes')::integer
        else -1
      end as alert_offset_minutes,
      case
        when lower(coalesce(flow_rules.rule_json ->> 'allDay', 'false')) = 'true'
          then true
        else false
      end as rule_all_day,
      case
        when coalesce(flow_rules.rule_json ->> 'startLocal', '') ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}'
          then ((flow_rules.rule_json ->> 'startLocal')::timestamp)::time
        else time '09:00'
      end as rule_start_time,
      coalesce(
        flow_rules.start_date,
        case
          when coalesce(flow_rules.rule_json ->> 'startLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'startLocal')::timestamp)::date
          else null
        end
      ) as effective_start_date,
      coalesce(
        flow_rules.end_date,
        case
          when coalesce(flow_rules.rule_json ->> 'endLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'endLocal')::timestamp)::date
          else null
        end
      ) as effective_end_date
    from flow_rules
    where not exists (
      select 1
      from public.event_deletion_trash edt
      where edt.user_id = flow_rules.user_id
        and edt.purged_at is null
        and edt.purge_after > timezone('utc', now())
        and edt.client_event_id in (
          'reminder:' || flow_rules.reminder_uuid::text,
          'reminder:rule:' || flow_rules.reminder_uuid::text
        )
    )
  ),
  trash_candidates as (
    select distinct on (edt.user_id, edt.client_event_id)
      edt.user_id,
      edt.client_event_id,
      coalesce(edt.row_data ->> 'title', edt.title, active_flows.name) as title,
      coalesce(
        edt.row_data ->> 'detail',
        'color=' || lpad(to_hex((active_flows.color & 16777215)::integer), 6, '0') ||
          case
            when active_flows.alert_offset_minutes is not null
              then ';alert=' || active_flows.alert_offset_minutes::text
            else ''
          end ||
          ';repeat=' || coalesce((active_flows.rule_json -> 'repeat')::text, '{"kind":"none","interval":1,"weekdays":[],"monthDay":null,"monthDays":[],"decanDays":[],"kemeticMonthDays":[]}') ||
          ';'
      ) as detail,
      coalesce(edt.row_data ->> 'location', null) as location,
      coalesce((edt.row_data ->> 'all_day')::boolean, active_flows.rule_all_day, false) as all_day,
      coalesce((edt.row_data ->> 'starts_at')::timestamp with time zone, edt.starts_at) as starts_at,
      coalesce(
        (edt.row_data ->> 'ends_at')::timestamp with time zone,
        edt.ends_at,
        case
          when coalesce((edt.row_data ->> 'all_day')::boolean, active_flows.rule_all_day, false)
            then null
          else coalesce((edt.row_data ->> 'starts_at')::timestamp with time zone, edt.starts_at) + interval '30 minutes'
        end
      ) as ends_at,
      coalesce(
        nullif(edt.row_data ->> 'flow_local_id', '')::integer,
        active_flows.id::integer
      ) as flow_local_id,
      coalesce(
        nullif(edt.row_data ->> 'calendar_id', '')::uuid,
        edt.calendar_id,
        active_flows.calendar_id
      ) as calendar_id,
      coalesce(edt.row_data ->> 'category', active_flows.rule_json ->> 'category') as category,
      1 as source_priority
    from public.event_deletion_trash edt
    join active_flows
      on active_flows.user_id = edt.user_id
     and active_flows.reminder_uuid = public.user_event_reminder_uuid(edt.client_event_id)
    cross join lateral (
      select public.user_event_reminder_occurrence_date(edt.client_event_id) as occurrence_date
    ) occurrence
    where edt.purged_at is null
      and edt.purge_after > timezone('utc', now())
      and edt.client_event_id like ('reminder:' || active_flows.reminder_uuid::text || ':%')
      and edt.starts_at >= (date_trunc('day', timezone('utc', now())) at time zone 'UTC')
      and edt.starts_at is not null
      and occurrence.occurrence_date is not null
      and occurrence.occurrence_date >= coalesce(
        active_flows.effective_start_date,
        occurrence.occurrence_date
      )
      and (
        active_flows.effective_end_date is null
        or occurrence.occurrence_date <= active_flows.effective_end_date
      )
    order by edt.user_id, edt.client_event_id, edt.deleted_at desc
  ),
  scheduled_base as (
    select
      sn.*,
      active_flows.id as flow_id,
      active_flows.name as flow_name,
      active_flows.color as flow_color,
      active_flows.calendar_id as flow_calendar_id,
      active_flows.rule_json,
      active_flows.profile_timezone,
      active_flows.alert_offset_minutes,
      active_flows.rule_all_day,
      active_flows.rule_start_time,
      active_flows.effective_start_date,
      active_flows.effective_end_date,
      public.user_event_reminder_occurrence_date(sn.client_event_id) as occurrence_date
    from public.scheduled_notifications sn
    join active_flows
      on active_flows.user_id = sn.user_id
     and active_flows.reminder_uuid = public.user_event_reminder_uuid(sn.client_event_id)
    where sn.notification_type = 'event_start'
      and sn.client_event_id like ('reminder:' || active_flows.reminder_uuid::text || ':%')
  ),
  scheduled_candidates as (
    select distinct on (scheduled_base.user_id, scheduled_base.client_event_id)
      scheduled_base.user_id,
      scheduled_base.client_event_id,
      coalesce(scheduled_base.rule_json ->> 'title', scheduled_base.title, scheduled_base.flow_name) as title,
      'color=' || lpad(to_hex((scheduled_base.flow_color & 16777215)::integer), 6, '0') ||
        case
          when scheduled_base.alert_offset_minutes is not null
            then ';alert=' || scheduled_base.alert_offset_minutes::text
          else ''
        end ||
        ';repeat=' || coalesce((scheduled_base.rule_json -> 'repeat')::text, '{"kind":"none","interval":1,"weekdays":[],"monthDay":null,"monthDays":[],"decanDays":[],"kemeticMonthDays":[]}') ||
        ';' as detail,
      null::text as location,
      scheduled_base.rule_all_day as all_day,
      ((scheduled_base.occurrence_date + scheduled_base.rule_start_time) at time zone scheduled_base.profile_timezone) as starts_at,
      case
        when scheduled_base.rule_all_day then null::timestamp with time zone
        else ((scheduled_base.occurrence_date + scheduled_base.rule_start_time) at time zone scheduled_base.profile_timezone) + interval '30 minutes'
      end as ends_at,
      scheduled_base.flow_id::integer as flow_local_id,
      scheduled_base.flow_calendar_id as calendar_id,
      scheduled_base.rule_json ->> 'category' as category,
      2 as source_priority
    from scheduled_base
    where scheduled_base.occurrence_date is not null
      and scheduled_base.occurrence_date >= (timezone(scheduled_base.profile_timezone, now()))::date
      and scheduled_base.occurrence_date >= coalesce(
        scheduled_base.effective_start_date,
        scheduled_base.occurrence_date
      )
      and (
        scheduled_base.effective_end_date is null
        or scheduled_base.occurrence_date <= scheduled_base.effective_end_date
      )
    order by scheduled_base.user_id, scheduled_base.client_event_id, scheduled_base.updated_at desc nulls last
  ),
  ranked_candidates as (
    select distinct on (candidate_rows.user_id, candidate_rows.client_event_id)
      candidate_rows.*
    from (
      select * from trash_candidates
      union all
      select * from scheduled_candidates
    ) candidate_rows
    where candidate_rows.client_event_id is not null
      and btrim(candidate_rows.client_event_id) <> ''
      and candidate_rows.calendar_id is not null
    order by candidate_rows.user_id, candidate_rows.client_event_id, candidate_rows.source_priority
  )
  select
    ranked_candidates.user_id,
    ranked_candidates.client_event_id,
    ranked_candidates.title,
    ranked_candidates.detail,
    ranked_candidates.location,
    ranked_candidates.all_day,
    ranked_candidates.starts_at,
    ranked_candidates.ends_at,
    ranked_candidates.flow_local_id,
    ranked_candidates.calendar_id,
    ranked_candidates.category,
    ranked_candidates.source_priority
  from ranked_candidates;

  delete from public.event_deletion_trash edt
  using reminder_restore_candidates c
  where edt.user_id = c.user_id
    and edt.client_event_id = c.client_event_id
    and edt.purged_at is null;

  get diagnostics v_tombstones_removed = row_count;

  insert into public.user_events (
    user_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    calendar_id,
    category,
    updated_at
  )
  select
    c.user_id,
    c.client_event_id,
    c.title,
    c.detail,
    c.location,
    c.all_day,
    c.starts_at,
    c.ends_at,
    c.flow_local_id,
    c.calendar_id,
    c.category,
    now()
  from reminder_restore_candidates c
  on conflict (user_id, client_event_id) do update
  set
    title = excluded.title,
    detail = excluded.detail,
    location = excluded.location,
    all_day = excluded.all_day,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    flow_local_id = excluded.flow_local_id,
    calendar_id = excluded.calendar_id,
    category = excluded.category,
    updated_at = now()
  where public.user_events.title is distinct from excluded.title
    or public.user_events.detail is distinct from excluded.detail
    or public.user_events.location is distinct from excluded.location
    or public.user_events.all_day is distinct from excluded.all_day
    or public.user_events.starts_at is distinct from excluded.starts_at
    or public.user_events.ends_at is distinct from excluded.ends_at
    or public.user_events.flow_local_id is distinct from excluded.flow_local_id
    or public.user_events.calendar_id is distinct from excluded.calendar_id
    or public.user_events.category is distinct from excluded.category;

  get diagnostics v_restored = row_count;

  with flow_rules as (
    select
      f.*,
      public.try_parse_jsonb(f.notes) as rule_json
    from public.flows f
    where f.is_reminder = true
      and f.active = true
      and coalesce(f.is_hidden, false) = false
      and f.reminder_uuid is not null
      and public.flow_is_deleted_state(
        f.active,
        coalesce(f.is_hidden, false),
        f.notes
      ) = false
  ),
  active_flows as (
    select
      flow_rules.*,
      case
        when coalesce(flow_rules.rule_json ->> 'alertOffsetMinutes', '') ~ '^-?[0-9]+$'
          then (flow_rules.rule_json ->> 'alertOffsetMinutes')::integer
        else -1
      end as alert_offset_minutes,
      coalesce(
        flow_rules.start_date,
        case
          when coalesce(flow_rules.rule_json ->> 'startLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'startLocal')::timestamp)::date
          else null
        end
      ) as effective_start_date,
      coalesce(
        flow_rules.end_date,
        case
          when coalesce(flow_rules.rule_json ->> 'endLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'endLocal')::timestamp)::date
          else null
        end
      ) as effective_end_date
    from flow_rules
    where not exists (
      select 1
      from public.event_deletion_trash edt
      where edt.user_id = flow_rules.user_id
        and edt.purged_at is null
        and edt.purge_after > timezone('utc', now())
        and edt.client_event_id in (
          'reminder:' || flow_rules.reminder_uuid::text,
          'reminder:rule:' || flow_rules.reminder_uuid::text
        )
    )
  ),
  notifications_to_reactivate as (
    select sn.id
    from public.scheduled_notifications sn
    join active_flows
      on active_flows.user_id = sn.user_id
     and active_flows.reminder_uuid = public.user_event_reminder_uuid(sn.client_event_id)
    cross join lateral (
      select public.user_event_reminder_occurrence_date(sn.client_event_id) as occurrence_date
    ) occurrence
    where sn.notification_type = 'event_start'
      and sn.scheduled_at >= timezone('utc', now())
      and active_flows.alert_offset_minutes <> -1
      and sn.is_active = false
      and occurrence.occurrence_date is not null
      and occurrence.occurrence_date >= coalesce(
        active_flows.effective_start_date,
        occurrence.occurrence_date
      )
      and (
        active_flows.effective_end_date is null
        or occurrence.occurrence_date <= active_flows.effective_end_date
      )
  )
  update public.scheduled_notifications sn
  set
    is_active = true,
    updated_at = now(),
    claimed_at = null,
    claim_token = null,
    last_error = null
  from notifications_to_reactivate ntr
  where sn.id = ntr.id;

  get diagnostics v_reactivated = row_count;

  select *
  into v_pruned
  from public.prune_stale_reminder_occurrences();

  reminder_event_rows_restored := coalesce(v_restored, 0);
  reminder_notifications_reactivated := greatest(
    coalesce(v_reactivated, 0) -
    coalesce(v_pruned.stale_reminder_notifications_deactivated, 0),
    0
  );
  reminder_occurrence_tombstones_removed :=
    coalesce(v_tombstones_removed, 0) +
    coalesce(v_pruned.stale_reminder_tombstones_removed, 0);
  return next;
end;
$_$;


ALTER FUNCTION "public"."repair_active_reminder_filing_backbone"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."repair_active_reminder_filing_backbone"() IS 'Repeatable reminder repair. Active visible reminder flows are the rule source; restored occurrences must fit the flow/rule date window, false occurrence tombstones are removed for restored rows, stale out-of-window rows are pruned, and future notifications are reactivated only inside the same bounds.';



CREATE OR REPLACE FUNCTION "public"."respond_to_shared_calendar_invite"("p_calendar_id" "uuid", "p_accept" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_status text := case when p_accept then 'accepted' else 'declined' end;
  v_invited_by uuid;
  v_role text;
  v_calendar_name text;
  v_calendar_color bigint;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_calendar_members scm
     set status = v_status,
         responded_at = now(),
         updated_at = now()
   where scm.calendar_id = p_calendar_id
     and scm.user_id = v_user_id
     and scm.status = 'pending'
  returning scm.invited_by, scm.role
    into v_invited_by, v_role;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  update public.shared_calendar_notifications scn
     set viewed_at = coalesce(scn.viewed_at, now()),
         updated_at = now(),
         payload_json = jsonb_set(
           jsonb_set(
             coalesce(scn.payload_json, '{}'::jsonb),
             '{invite_status}',
             to_jsonb(v_status),
             true
           ),
           '{notification_kind}',
           to_jsonb('calendar_invite'::text),
           true
         )
   where scn.calendar_id = p_calendar_id
     and scn.recipient_id = v_user_id
     and scn.kind = 'calendar_invite'
     and scn.deleted_at is null;

  select sc.name, sc.color
    into v_calendar_name, v_calendar_color
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  if v_invited_by is not null and v_invited_by <> v_user_id then
    insert into public.shared_calendar_notifications (
      calendar_id,
      recipient_id,
      actor_id,
      kind,
      title,
      body,
      payload_json
    )
    values (
      p_calendar_id,
      v_invited_by,
      v_user_id,
      'calendar_invite',
      coalesce(nullif(btrim(v_calendar_name), ''), 'Calendar invite'),
      format(
        'Your invitation was %s.',
        case when p_accept then 'accepted' else 'declined' end
      ),
      jsonb_build_object(
        'notification_kind', 'calendar_invite_response',
        'calendar_id', p_calendar_id::text,
        'calendar_name', coalesce(v_calendar_name, ''),
        'calendar_color', v_calendar_color,
        'invite_status', v_status,
        'role', coalesce(v_role, 'editor')
      )
    );
  end if;
end;
$$;


ALTER FUNCTION "public"."respond_to_shared_calendar_invite"("p_calendar_id" "uuid", "p_accept" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_app_event_email"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare jwt json;
begin
  if new.email is null then
    begin
      jwt := current_setting('request.jwt.claims', true)::json;
      new.email := jwt->>'email';
    exception when others then
      null;
    end;
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."set_app_event_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_app_event_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  -- user_id <- auth.uid() if missing
  if new.user_id is null then
    begin
      new.user_id := auth.uid();
    exception when others then
      new.user_id := null;
    end;
  end if;

  -- email <- request.jwt.claim.email if missing/empty
  if new.email is null or new.email = '' then
    begin
      new.email := current_setting('request.jwt.claim.email', true);
    exception when others then
      -- leave as-is if not available (e.g., no JWT)
      null;
    end;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_app_event_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_profile_email"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- If no explicit email provided, try to read it from the JWT claim (when behind PostgREST)
  if new.email is null or new.email = '' then
    begin
      new.email := coalesce(current_setting('request.jwt.claim.email', true), new.email);
    exception when others then
      -- ignore: not executing behind PostgREST (e.g., direct SQL)
      new.email := new.email;
    end;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_profile_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_events_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  return new;
end $$;


ALTER FUNCTION "public"."set_user_events_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."set_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_id_from_auth"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."set_user_id_from_auth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_event_share_calendar_copy"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' then
    if old.recipient_id is not null then
      delete from public.user_events
      where user_id = old.recipient_id
        and client_event_id = public.event_share_import_client_event_id(old.id);
    end if;
    return old;
  end if;

  if coalesce(new.response_status, 'no_response') = 'accepted'
    and (
      tg_op = 'INSERT'
      or coalesce(old.response_status, 'no_response') <> 'accepted'
    ) then
    perform public.clear_event_share_import_tombstone(new.recipient_id, new.id);
  end if;

  perform public.sync_event_share_calendar_copy_from_row(new);
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_event_share_calendar_copy"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "recipient_id" "uuid",
    "channel" "text" NOT NULL,
    "invite_token" "text",
    "invite_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "viewed_at" timestamp with time zone,
    "imported_at" timestamp with time zone,
    "sender_note" "text",
    "deleted_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text",
    "payload_json" "jsonb",
    "response_status" "text" DEFAULT 'no_response'::"text" NOT NULL,
    "responded_at" timestamp with time zone,
    CONSTRAINT "event_shares_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'phone'::"text", 'link'::"text"]))),
    CONSTRAINT "event_shares_response_status_check" CHECK (("response_status" = ANY (ARRAY['no_response'::"text", 'accepted'::"text", 'declined'::"text", 'maybe'::"text"]))),
    CONSTRAINT "event_shares_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))),
    CONSTRAINT "valid_recipient_or_token_event" CHECK ((("recipient_id" IS NOT NULL) OR (("invite_token" IS NOT NULL) AND ("invite_expires_at" IS NOT NULL))))
);


ALTER TABLE "public"."event_shares" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_event_share_calendar_copy_from_row"("p_share" "public"."event_shares") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  source_event public.user_events%rowtype;
  imported_flow public.flows%rowtype;
  payload jsonb := case
    when p_share.payload_json is not null
      and jsonb_typeof(p_share.payload_json) = 'object'
    then p_share.payload_json
    else '{}'::jsonb
  end;
  source_flow jsonb;
  source_flow_events jsonb := '[]'::jsonb;
  source_flow_id bigint;
  source_flow_name text;
  source_flow_color bigint := 5099745;
  source_flow_notes text;
  source_flow_rules jsonb := '[]'::jsonb;
  source_flow_start_date date;
  source_flow_end_date date;
  source_flow_root_flow_id bigint;
  source_flow_is_reminder boolean := false;
  imported_flow_id bigint;
  imported_reminder_uuid uuid;
  imported_notes text;
  matched_by_share_id boolean := false;
  first_event_start timestamptz;
  last_event_start timestamptz;
  source_item jsonb;
  source_key text;
  source_title text;
  source_detail text;
  source_location text;
  source_category text;
  source_action_id text;
  source_behavior_payload jsonb;
  source_all_day boolean;
  source_starts_at timestamptz;
  source_ends_at timestamptz;
  payload_title text;
  payload_detail text;
  payload_location text;
  payload_action_id text;
  payload_behavior_payload jsonb;
  payload_all_day boolean;
  payload_starts_at timestamptz;
  payload_ends_at timestamptz;
  effective_title text;
  effective_detail text;
  effective_location text;
  effective_action_id text;
  effective_behavior_payload jsonb;
  effective_all_day boolean;
  effective_starts_at timestamptz;
  effective_ends_at timestamptz;
  target_cid text;
  target_prefix text;
begin
  if p_share.recipient_id is null then
    return;
  end if;

  target_cid := public.event_share_import_client_event_id(p_share.id);
  target_prefix := public.event_share_flow_import_client_event_prefix(p_share.id);

  if p_share.event_id is not null then
    select *
    into source_event
    from public.user_events
    where id = p_share.event_id
    limit 1;
  end if;

  source_flow := case
    when payload ? 'source_flow'
      and jsonb_typeof(payload -> 'source_flow') = 'object'
    then payload -> 'source_flow'
    else public.event_share_source_flow_payload(p_share.event_id)
  end;
  source_flow_id := public.try_parse_bigint(source_flow ->> 'flow_id');

  if p_share.deleted_at is not null
    or coalesce(p_share.status, 'sent') not in ('sent', 'viewed', 'imported')
    or coalesce(p_share.response_status, 'no_response') <> 'accepted' then
    delete from public.user_events
    where user_id = p_share.recipient_id
      and (
        client_event_id = target_cid
        or client_event_id like target_prefix || '%'
      );

    delete from public.flows
    where user_id = p_share.recipient_id
      and origin_type = 'share_import'
      and origin_generation_id = p_share.id;

    if source_flow_id is not null and source_flow_id > 0 then
      delete from public.flows
      where user_id = p_share.recipient_id
        and origin_type = 'share_import'
        and origin_flow_id = source_flow_id
        and origin_generation_id is null;
    end if;
    return;
  end if;

  if source_flow is not null and source_flow_id is not null and source_flow_id > 0 then
    delete from public.user_events
    where user_id = p_share.recipient_id
      and client_event_id = target_cid;

    select *
    into imported_flow
    from public.flows
    where user_id = p_share.recipient_id
      and origin_type = 'share_import'
      and origin_generation_id = p_share.id
    order by updated_at desc
    limit 1;
    matched_by_share_id := found;

    if not found then
      select *
      into imported_flow
      from public.flows
      where user_id = p_share.recipient_id
        and origin_type = 'share_import'
        and origin_flow_id = source_flow_id
        and origin_generation_id is null
      order by updated_at desc
      limit 1;
    end if;

    if imported_flow.id is not null
      and matched_by_share_id
      and (
        coalesce(imported_flow.active, true) = false
        or coalesce(imported_flow.is_hidden, false) = true
        or (
          imported_flow.end_date is not null
          and imported_flow.end_date < current_date
        )
      ) then
      delete from public.user_events
      where user_id = p_share.recipient_id
        and (
          flow_local_id = imported_flow.id
          or client_event_id like target_prefix || '%'
        );
      return;
    end if;

    source_flow_events := case
      when jsonb_typeof(source_flow -> 'events') = 'array'
      then source_flow -> 'events'
      else '[]'::jsonb
    end;

    select
      min(public.try_parse_timestamptz(elem.value ->> 'starts_at')),
      max(public.try_parse_timestamptz(elem.value ->> 'starts_at'))
    into first_event_start, last_event_start
    from jsonb_array_elements(source_flow_events) as elem(value)
    where public.try_parse_timestamptz(elem.value ->> 'starts_at') is not null;

    source_flow_name := coalesce(
      nullif(btrim(source_flow ->> 'name'), ''),
      nullif(btrim(coalesce(payload ->> 'title', payload ->> 'name')), ''),
      nullif(btrim(source_event.title), ''),
      'Shared Flow'
    );
    source_flow_color := coalesce(
      public.try_parse_bigint(source_flow ->> 'color'),
      5099745
    ) & 16777215;
    source_flow_notes := nullif(source_flow ->> 'notes', '');
    source_flow_rules := case
      when jsonb_typeof(source_flow -> 'rules') = 'array'
      then source_flow -> 'rules'
      else '[]'::jsonb
    end;
    source_flow_start_date := coalesce(
      public.try_parse_date(source_flow ->> 'start_date'),
      (first_event_start at time zone 'utc')::date
    );
    source_flow_end_date := coalesce(
      public.try_parse_date(source_flow ->> 'end_date'),
      (last_event_start at time zone 'utc')::date
    );
    source_flow_root_flow_id := coalesce(
      public.try_parse_bigint(source_flow ->> 'root_flow_id'),
      source_flow_id
    );
    source_flow_is_reminder := case lower(coalesce(source_flow ->> 'is_reminder', ''))
      when '1' then true
      when 'true' then true
      when 't' then true
      when 'yes' then true
      else false
    end;

    if source_flow_is_reminder then
      imported_reminder_uuid := coalesce(imported_flow.reminder_uuid, gen_random_uuid());
      imported_notes := public.event_share_rewrite_reminder_notes(
        source_flow_notes,
        imported_reminder_uuid
      );
      source_flow_rules := '[]'::jsonb;
    else
      imported_reminder_uuid := null;
      imported_notes := source_flow_notes;
    end if;

    if imported_flow.id is null then
      insert into public.flows (
        user_id,
        name,
        color,
        active,
        start_date,
        end_date,
        notes,
        rules,
        is_hidden,
        is_reminder,
        reminder_uuid,
        origin_type,
        origin_flow_id,
        origin_generation_id,
        root_flow_id
      )
      values (
        p_share.recipient_id,
        source_flow_name,
        source_flow_color,
        true,
        source_flow_start_date,
        source_flow_end_date,
        imported_notes,
        source_flow_rules,
        false,
        source_flow_is_reminder,
        imported_reminder_uuid,
        'share_import',
        source_flow_id,
        p_share.id,
        source_flow_root_flow_id
      )
      on conflict (user_id, origin_generation_id)
      where (
        origin_type = 'share_import'
        and origin_generation_id is not null
      )
      do update
      set
        name = excluded.name,
        color = excluded.color,
        active = true,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        notes = excluded.notes,
        rules = excluded.rules,
        is_hidden = false,
        is_reminder = excluded.is_reminder,
        reminder_uuid = excluded.reminder_uuid,
        origin_type = 'share_import',
        origin_flow_id = excluded.origin_flow_id,
        origin_generation_id = excluded.origin_generation_id,
        root_flow_id = excluded.root_flow_id,
        updated_at = timezone('utc', now())
      returning id into imported_flow_id;
    else
      imported_flow_id := imported_flow.id;
      update public.flows
      set
        name = source_flow_name,
        color = source_flow_color,
        active = true,
        start_date = source_flow_start_date,
        end_date = source_flow_end_date,
        notes = imported_notes,
        rules = source_flow_rules,
        is_hidden = false,
        is_reminder = source_flow_is_reminder,
        reminder_uuid = imported_reminder_uuid,
        origin_type = 'share_import',
        origin_flow_id = source_flow_id,
        origin_generation_id = p_share.id,
        root_flow_id = source_flow_root_flow_id,
        updated_at = timezone('utc', now())
      where id = imported_flow_id;
    end if;

    delete from public.user_events
    where user_id = p_share.recipient_id
      and (
        flow_local_id = imported_flow_id
        or client_event_id like target_prefix || '%'
      );

    if source_flow_is_reminder then
      return;
    end if;

    for source_item in
      select value
      from jsonb_array_elements(source_flow_events)
    loop
      source_starts_at := public.try_parse_timestamptz(source_item ->> 'starts_at');
      if source_starts_at is null then
        continue;
      end if;

      source_ends_at := public.try_parse_timestamptz(source_item ->> 'ends_at');
      source_title := coalesce(
        nullif(btrim(source_item ->> 'title'), ''),
        source_flow_name
      );
      source_detail := nullif(source_item ->> 'detail', '');
      source_location := nullif(source_item ->> 'location', '');
      source_category := nullif(source_item ->> 'category', '');
      source_action_id := nullif(btrim(source_item ->> 'action_id'), '');
      source_behavior_payload := case
        when source_item ? 'behavior_payload'
          and jsonb_typeof(source_item -> 'behavior_payload') = 'object'
        then source_item -> 'behavior_payload'
        else null
      end;
      source_all_day := case lower(coalesce(source_item ->> 'all_day', ''))
        when '1' then true
        when 'true' then true
        when 't' then true
        when 'yes' then true
        else false
      end;
      source_key := md5(
        coalesce(
          nullif(btrim(source_item ->> 'source_client_event_id'), ''),
          nullif(btrim(source_item ->> 'client_event_id'), ''),
          coalesce(source_starts_at::text, '') || '|' ||
          coalesce(source_ends_at::text, '') || '|' ||
          coalesce(source_title, '') || '|' ||
          coalesce(source_location, '')
        )
      );

      insert into public.user_events (
        user_id,
        client_event_id,
        title,
        detail,
        location,
        all_day,
        starts_at,
        ends_at,
        flow_local_id,
        category,
        action_id,
        behavior_payload
      )
      values (
        p_share.recipient_id,
        target_prefix || source_key,
        source_title,
        source_detail,
        source_location,
        source_all_day,
        source_starts_at,
        source_ends_at,
        imported_flow_id,
        source_category,
        source_action_id,
        source_behavior_payload
      )
      on conflict (user_id, client_event_id) do update
      set
        title = excluded.title,
        detail = excluded.detail,
        location = excluded.location,
        all_day = excluded.all_day,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        flow_local_id = excluded.flow_local_id,
        category = excluded.category,
        action_id = excluded.action_id,
        behavior_payload = excluded.behavior_payload;
    end loop;

    return;
  end if;

  payload_title := nullif(
    btrim(coalesce(payload ->> 'title', payload ->> 'name')),
    ''
  );
  payload_detail := case
    when payload ? 'detail' then nullif(payload ->> 'detail', '')
    else null
  end;
  payload_location := case
    when payload ? 'location' then nullif(payload ->> 'location', '')
    else null
  end;
  payload_action_id := case
    when payload ? 'action_id' then nullif(btrim(payload ->> 'action_id'), '')
    else null
  end;
  payload_behavior_payload := case
    when payload ? 'behavior_payload'
      and jsonb_typeof(payload -> 'behavior_payload') = 'object'
    then payload -> 'behavior_payload'
    else null
  end;
  payload_all_day := case lower(coalesce(payload ->> 'all_day', ''))
    when '1' then true
    when 'true' then true
    when 't' then true
    when 'yes' then true
    when '0' then false
    when 'false' then false
    when 'f' then false
    when 'no' then false
    else null
  end;
  payload_starts_at := public.try_parse_timestamptz(payload ->> 'starts_at');
  payload_ends_at := public.try_parse_timestamptz(payload ->> 'ends_at');

  effective_title := coalesce(
    payload_title,
    nullif(btrim(source_event.title), ''),
    'Shared Event'
  );
  effective_detail := coalesce(payload_detail, source_event.detail);
  effective_location := coalesce(payload_location, source_event.location);
  effective_action_id := coalesce(
    payload_action_id,
    nullif(btrim(source_event.action_id), '')
  );
  effective_behavior_payload := coalesce(
    payload_behavior_payload,
    source_event.behavior_payload
  );
  effective_all_day := coalesce(payload_all_day, source_event.all_day, false);
  effective_starts_at := coalesce(payload_starts_at, source_event.starts_at);
  effective_ends_at := coalesce(payload_ends_at, source_event.ends_at);

  if effective_starts_at is null then
    raise exception
      'Accepted invite % is missing starts_at and cannot be imported',
      p_share.id
      using errcode = '22007';
  end if;

  insert into public.user_events (
    user_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    category,
    action_id,
    behavior_payload
  )
  values (
    p_share.recipient_id,
    target_cid,
    effective_title,
    effective_detail,
    effective_location,
    effective_all_day,
    effective_starts_at,
    effective_ends_at,
    null,
    null,
    effective_action_id,
    effective_behavior_payload
  )
  on conflict (user_id, client_event_id) do update
  set
    title = excluded.title,
    detail = excluded.detail,
    location = excluded.location,
    all_day = excluded.all_day,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    flow_local_id = null,
    category = null,
    action_id = excluded.action_id,
    behavior_payload = excluded.behavior_payload;
end;
$$;


ALTER FUNCTION "public"."sync_event_share_calendar_copy_from_row"("p_share" "public"."event_shares") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_event_share_import_marker"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Avoid mutating imported_at during sender-owned edits, since the
  -- RSVP/update guard treats imported_at as recipient-owned state.
  if actor is not null
    and actor = new.sender_id
    and actor is distinct from new.recipient_id then
    return new;
  end if;

  if new.deleted_at is not null
    or coalesce(new.response_status, 'no_response') <> 'accepted' then
    new.imported_at := null;
  elsif new.imported_at is null then
    new.imported_at := coalesce(
      new.responded_at,
      new.viewed_at,
      new.created_at,
      timezone('utc', now())
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_event_share_import_marker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_insight_post_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  update public.insight_posts
  set
    node_id = new.node_id,
    body_text = new.body_text,
    entry_date = new.entry_date,
    updated_at = timezone('utc', now())
  where insight_entry_id = new.id
    and user_id = new.user_id;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_insight_post_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_flows_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."tg_flows_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_shared_calendar_members_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_shared_calendar_members_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_shared_calendars_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_shared_calendars_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_maat_guidance_delivery_caps"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  existing_count integer;
begin
  if new.kind = 'drift_nudge' then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text || ':' || new.decan_period_key || ':drift_nudge'));

    select count(*)
      into existing_count
      from public.maat_guidance_deliveries d
     where d.user_id = new.user_id
       and d.decan_period_key = new.decan_period_key
       and d.kind = 'drift_nudge'
       and d.id is distinct from new.id;

    if existing_count >= 2 then
      raise exception 'drift_nudge cap reached for this decan'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_maat_guidance_delivery_caps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_parse_bigint"("p_value" "text") RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::bigint;
exception
  when others then
    return null;
end;
$$;


ALTER FUNCTION "public"."try_parse_bigint"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_parse_date"("p_value" "text") RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::date;
exception
  when others then
    return null;
end;
$$;


ALTER FUNCTION "public"."try_parse_date"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_parse_jsonb"("p_raw" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if p_raw is null or btrim(p_raw) = '' then
    return null;
  end if;

  return p_raw::jsonb;
exception
  when others then
    return null;
end;
$$;


ALTER FUNCTION "public"."try_parse_jsonb"("p_raw" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_parse_timestamptz"("p_value" "text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::timestamptz;
exception
  when others then
    return null;
end;
$$;


ALTER FUNCTION "public"."try_parse_timestamptz"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_journal_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_journal_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_nutrition_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_nutrition_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_scheduled_notifications_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_scheduled_notifications_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_shared_calendar"("p_calendar_id" "uuid", "p_name" "text", "p_color" bigint DEFAULT NULL::bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_name is null then
    raise exception 'CALENDAR_NAME_REQUIRED';
  end if;

  update public.shared_calendars sc
     set name = v_name,
         color = coalesce(p_color, sc.color),
         updated_at = now()
   where sc.id = p_calendar_id
     and sc.owner_id = v_user_id
     and sc.deleted_at is null;

  if not found then
    raise exception 'CALENDAR_NOT_EDITABLE';
  end if;
end;
$$;


ALTER FUNCTION "public"."update_shared_calendar"("p_calendar_id" "uuid", "p_name" "text", "p_color" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_event_active_until"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with tz as (
    select coalesce(nullif(public._get_user_timezone(p_user_id), ''), 'UTC') as name
  )
  select case
    when p_starts_at is null then null
    when coalesce(p_all_day, false) then
      case
        when p_ends_at is not null and p_ends_at > p_starts_at then p_ends_at
        else (
          (p_starts_at at time zone (select name from tz))::date
          + interval '1 day'
        ) at time zone (select name from tz)
      end
    else case
      when p_ends_at is not null and p_ends_at > p_starts_at then p_ends_at
      else p_starts_at
    end
  end
$$;


ALTER FUNCTION "public"."user_event_active_until"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_event_active_until"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone) IS 'Returns the authoritative instant through which a user_events row remains live on the calendar. All-day rows remain live through the end of their local calendar day.';



CREATE OR REPLACE FUNCTION "public"."user_event_completions_validate_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = new.flow_id
     and f.user_id = new.user_id
    where ue.user_id = new.user_id
      and ue.client_event_id = new.client_event_id
      and public.user_event_matches_flow(
        new.flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
  ) then
    raise exception
      'user_event_completions: no matching user_events row for (user_id, client_event_id, flow_id)';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."user_event_completions_validate_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_event_date_lifecycle"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_now" timestamp with time zone DEFAULT "now"()) RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when public.user_event_active_until(
      p_user_id,
      p_all_day,
      p_starts_at,
      p_ends_at
    ) >= coalesce(p_now, now())
      then 'active'
    else 'inactive'
  end
$$;


ALTER FUNCTION "public"."user_event_date_lifecycle"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_now" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_event_date_lifecycle"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_now" timestamp with time zone) IS 'Date-only lifecycle predicate for event filing. Active means the event has not ended yet; inactive means it has already passed.';



CREATE OR REPLACE FUNCTION "public"."user_event_has_active_reminder_flow"("p_user_id" "uuid", "p_reminder_uuid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select p_user_id is not null
    and p_reminder_uuid is not null
    and exists (
      select 1
      from public.flows f
      where f.user_id = p_user_id
        and f.reminder_uuid = p_reminder_uuid
        and f.is_reminder = true
        and f.active = true
        and coalesce(f.is_hidden, false) = false
        and public.flow_is_deleted_state(
          f.active,
          coalesce(f.is_hidden, false),
          f.notes
        ) = false
    )
$$;


ALTER FUNCTION "public"."user_event_has_active_reminder_flow"("p_user_id" "uuid", "p_reminder_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_event_has_active_reminder_flow_for_occurrence"("p_user_id" "uuid", "p_client_event_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with input as (
    select
      public.user_event_reminder_uuid(p_client_event_id) as reminder_uuid,
      public.user_event_reminder_occurrence_date(p_client_event_id) as occurrence_date
  ),
  flow_rules as (
    select
      f.*,
      public.try_parse_jsonb(f.notes) as rule_json
    from public.flows f
    join input
      on input.reminder_uuid = f.reminder_uuid
    where f.user_id = p_user_id
      and f.is_reminder = true
      and f.active = true
      and coalesce(f.is_hidden, false) = false
      and public.flow_is_deleted_state(
        f.active,
        coalesce(f.is_hidden, false),
        f.notes
      ) = false
  ),
  bounded_flows as (
    select
      flow_rules.*,
      coalesce(
        flow_rules.start_date,
        case
          when coalesce(flow_rules.rule_json ->> 'startLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'startLocal')::timestamp)::date
          else null
        end
      ) as effective_start_date,
      coalesce(
        flow_rules.end_date,
        case
          when coalesce(flow_rules.rule_json ->> 'endLocal', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then ((flow_rules.rule_json ->> 'endLocal')::timestamp)::date
          else null
        end
      ) as effective_end_date
    from flow_rules
  )
  select exists (
    select 1
    from bounded_flows
    cross join input
    where input.reminder_uuid is not null
      and (
        input.occurrence_date is null
        or (
          input.occurrence_date >= coalesce(
            bounded_flows.effective_start_date,
            input.occurrence_date
          )
          and (
            bounded_flows.effective_end_date is null
            or input.occurrence_date <= bounded_flows.effective_end_date
          )
        )
      )
  )
$$;


ALTER FUNCTION "public"."user_event_has_active_reminder_flow_for_occurrence"("p_user_id" "uuid", "p_client_event_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_event_matches_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text", "p_action_id" "text", "p_flow_ai_metadata" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.user_event_references_flow(
      p_flow_id,
      p_flow_local_id,
      p_client_event_id,
      p_detail
    )
    or public.flow_metadata_has_action_id(p_flow_ai_metadata, p_action_id)
$$;


ALTER FUNCTION "public"."user_event_matches_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text", "p_action_id" "text", "p_flow_ai_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_event_matches_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text", "p_action_id" "text", "p_flow_ai_metadata" "jsonb") IS 'Canonical flow-event match for destructive lifecycle operations: embedded flow ids first, generated action ids second.';



CREATE OR REPLACE FUNCTION "public"."user_event_recently_deleted"("p_user_id" "uuid", "p_client_event_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with input as (
    select
      nullif(btrim(coalesce(p_client_event_id, '')), '') as client_event_id,
      public.user_event_reminder_uuid(p_client_event_id) as reminder_uuid
  ),
  tombstone_keys as (
    select
      input.client_event_id,
      input.reminder_uuid,
      case
        when input.reminder_uuid is null then null
        else 'reminder:' || input.reminder_uuid::text
      end as reminder_series_key,
      case
        when input.reminder_uuid is null then null
        else 'reminder:rule:' || input.reminder_uuid::text
      end as reminder_rule_key
    from input
  ),
  filing_state as (
    select
      tombstone_keys.client_event_id,
      tombstone_keys.reminder_uuid,
      exists (
        select 1
        from public.event_deletion_trash edt
        where edt.user_id = p_user_id
          and edt.purged_at is null
          and edt.purge_after > timezone('utc', now())
          and edt.suppresses_client = true
          and edt.client_event_id = tombstone_keys.client_event_id
      ) as has_exact_tombstone,
      exists (
        select 1
        from public.event_deletion_trash edt
        where edt.user_id = p_user_id
          and edt.purged_at is null
          and edt.purge_after > timezone('utc', now())
          and edt.suppresses_client = true
          and tombstone_keys.reminder_uuid is not null
          and edt.client_event_id in (
            tombstone_keys.reminder_series_key,
            tombstone_keys.reminder_rule_key
          )
      ) as has_series_tombstone,
      public.user_event_has_active_reminder_flow_for_occurrence(
        p_user_id,
        tombstone_keys.client_event_id
      ) as has_active_reminder_flow,
      exists (
        select 1
        from public.reminders r
        where r.user_id = p_user_id
          and r.id = tombstone_keys.reminder_uuid
      ) as has_legacy_reminder_row,
      exists (
        select 1
        from public.scheduled_notifications sn
        where sn.user_id = p_user_id
          and sn.is_active = true
          and sn.client_event_id = tombstone_keys.client_event_id
      ) as has_active_notification
    from tombstone_keys
  )
  select filing_state.client_event_id is not null
    and (
      filing_state.has_exact_tombstone
      or filing_state.has_series_tombstone
      or (
        filing_state.reminder_uuid is not null
        and filing_state.has_active_reminder_flow = false
        and filing_state.has_legacy_reminder_row = false
        and filing_state.has_active_notification = false
      )
    )
  from filing_state
$$;


ALTER FUNCTION "public"."user_event_recently_deleted"("p_user_id" "uuid", "p_client_event_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_event_recently_deleted"("p_user_id" "uuid", "p_client_event_id" "text") IS 'Returns true when an event has an active tombstone. Reminder orphan cleanup now treats an active, visible reminder flow as the durable rule source; scheduled_notifications are delivery state only.';



CREATE OR REPLACE FUNCTION "public"."user_event_referenced_flow_id"("p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") RETURNS bigint
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    public.flow_id_from_client_event_id(p_client_event_id),
    public.flow_id_from_detail_metadata(p_detail),
    nullif(greatest(coalesce(p_flow_local_id, 0), 0), 0)
  )
$$;


ALTER FUNCTION "public"."user_event_referenced_flow_id"("p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_event_referenced_flow_id"("p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") IS 'Canonical user_events flow resolver: authoritative client_event_id owner first, then detail metadata, then stored flow_local_id fallback.';



CREATE OR REPLACE FUNCTION "public"."user_event_references_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    coalesce(p_flow_id, 0) > 0
    and public.user_event_referenced_flow_id(
      p_flow_local_id,
      p_client_event_id,
      p_detail
    ) = p_flow_id
$$;


ALTER FUNCTION "public"."user_event_references_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_event_references_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") IS 'True when any user_events flow pointer (flow_local_id, client_event_id, or detail metadata) refers to the supplied flow id.';



CREATE OR REPLACE FUNCTION "public"."user_event_reminder_occurrence_date"("p_client_event_id" "text") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
  select case
    when substring(
      btrim(coalesce(p_client_event_id, ''))
      from '^reminder:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:([0-9]{4}-[0-9]{2}-[0-9]{2})$'
    ) is not null
      then substring(
        btrim(coalesce(p_client_event_id, ''))
        from '^reminder:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:([0-9]{4}-[0-9]{2}-[0-9]{2})$'
      )::date
    else null
  end
$_$;


ALTER FUNCTION "public"."user_event_reminder_occurrence_date"("p_client_event_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_event_reminder_uuid"("p_client_event_id" "text") RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
  select case
    when nullif(btrim(coalesce(p_client_event_id, '')), '') is null then null
    when substring(
      btrim(p_client_event_id)
      from '^reminder:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
    ) is not null
      then substring(
        btrim(p_client_event_id)
        from '^reminder:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
      )::uuid
    when substring(
      btrim(p_client_event_id)
      from '^reminder:rule:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
    ) is not null
      then substring(
        btrim(p_client_event_id)
        from '^reminder:rule:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::|$)'
      )::uuid
    else null
  end
$_$;


ALTER FUNCTION "public"."user_event_reminder_uuid"("p_client_event_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_event_reminder_uuid"("p_client_event_id" "text") IS 'Extracts the canonical reminder UUID from reminder materialized event client ids such as reminder:<uuid>:<date> and reminder:rule:<uuid>.';



CREATE TABLE IF NOT EXISTS "public"."flow_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" bigint,
    "name" "text" NOT NULL,
    "color" bigint DEFAULT 0 NOT NULL,
    "notes" "text",
    "rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "is_hidden" boolean DEFAULT false NOT NULL,
    "ai_metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."flow_posts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."flow_posts"."flow_id" IS 'Optional pointer to the original flow (for auditing only)';



CREATE TABLE IF NOT EXISTS "public"."flow_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "flow_id" bigint NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "recipient_id" "uuid",
    "channel" "text" NOT NULL,
    "suggested_schedule" "jsonb",
    "invite_token" "text",
    "invite_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "viewed_at" timestamp with time zone,
    "imported_at" timestamp with time zone,
    "sender_note" "text",
    "share_token" "uuid",
    "deleted_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text",
    "payload_json" "jsonb",
    CONSTRAINT "flow_shares_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'phone'::"text", 'link'::"text"]))),
    CONSTRAINT "flow_shares_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))),
    CONSTRAINT "valid_recipient_or_token" CHECK ((("recipient_id" IS NOT NULL) OR (("invite_token" IS NOT NULL) AND ("invite_expires_at" IS NOT NULL))))
);


ALTER TABLE "public"."flow_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flows" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "color" bigint DEFAULT 5099745 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "notes" "text",
    "rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "share_id" "uuid",
    "ai_metadata" "jsonb",
    "is_hidden" boolean DEFAULT false,
    "is_reminder" boolean DEFAULT false NOT NULL,
    "reminder_uuid" "uuid",
    "is_saved" boolean DEFAULT false NOT NULL,
    "origin_type" "text",
    "origin_flow_id" bigint,
    "origin_share_id" "uuid",
    "origin_generation_id" "uuid",
    "root_flow_id" bigint,
    "calendar_id" "uuid" NOT NULL,
    CONSTRAINT "flows_color_valid" CHECK ((("color" >= 0) AND ("color" <= 16777215))),
    CONSTRAINT "flows_origin_type_check" CHECK ((("origin_type" IS NULL) OR ("origin_type" = ANY (ARRAY['manual'::"text", 'ai'::"text", 'share_import'::"text", 'profile_import'::"text", 'fork'::"text", 'template'::"text"]))))
);


ALTER TABLE "public"."flows" OWNER TO "postgres";


COMMENT ON COLUMN "public"."flows"."ai_metadata" IS 'AI metadata for generated flows (model, tokens, cost, prompt, etc)';



CREATE TABLE IF NOT EXISTS "public"."scheduled_notifications" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_event_id" "text" NOT NULL,
    "notification_id" integer NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "payload" "text" DEFAULT '{}'::"text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notification_type" "text" DEFAULT 'event_start'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "last_attempt_at" timestamp with time zone,
    "claimed_at" timestamp with time zone,
    "claim_token" "text",
    CONSTRAINT "check_notification_type" CHECK (("notification_type" = ANY (ARRAY['event_start'::"text", 'event_end'::"text", 'daily_review'::"text", 'flow_reminder'::"text", 'reminder_10min'::"text", 'flow_step'::"text"])))
);


ALTER TABLE "public"."scheduled_notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."scheduled_notifications" IS 'Stores scheduled notification metadata for persistence across app restarts';



CREATE TABLE IF NOT EXISTS "public"."shared_calendars" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" bigint DEFAULT 5099745 NOT NULL,
    "icon" "text" DEFAULT 'calendar'::"text" NOT NULL,
    "is_personal" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."shared_calendars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "client_event_id" "text",
    "title" "text" NOT NULL,
    "detail" "text",
    "location" "text",
    "all_day" boolean DEFAULT false NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "flow_local_id" integer,
    "flow_tpl_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category" "text",
    "calendar_id" "uuid" NOT NULL,
    "action_id" "text",
    "behavior_payload" "jsonb"
);


ALTER TABLE "public"."user_events" OWNER TO "postgres";


CREATE OR REPLACE VIEW "private"."user_event_filing_items_internal" WITH ("security_invoker"='true') AS
 WITH "filed" AS (
         SELECT "ue"."id",
            "ue"."user_id",
            "ue"."client_event_id",
            "ue"."calendar_id",
            "sc"."name" AS "calendar_name",
            "sc"."color" AS "calendar_color",
            "sc"."is_personal" AS "calendar_is_personal",
            "ue"."title",
            "ue"."detail",
            "ue"."location",
            "ue"."all_day",
            "ue"."starts_at",
            "ue"."ends_at",
            "ue"."flow_local_id",
            "ue"."category",
            "ue"."action_id",
            "ue"."behavior_payload",
            "ue"."updated_at",
            "ue"."created_at",
            "ref"."flow_id" AS "filed_flow_id",
            "f"."active" AS "flow_active",
            "f"."is_hidden" AS "flow_is_hidden",
            "f"."is_reminder" AS "flow_is_reminder",
            "f"."is_saved" AS "flow_is_saved",
            "f"."notes" AS "flow_notes",
            COALESCE(NULLIF("public"."_get_user_timezone"("ue"."user_id"), ''::"text"), 'UTC'::"text") AS "user_timezone",
            "public"."user_event_active_until"("ue"."user_id", "ue"."all_day", "ue"."starts_at", "ue"."ends_at") AS "active_until",
            "public"."user_event_date_lifecycle"("ue"."user_id", "ue"."all_day", "ue"."starts_at", "ue"."ends_at") AS "date_lifecycle",
            (EXISTS ( SELECT 1
                   FROM "public"."event_shares" "es"
                  WHERE (("es"."event_id" = "ue"."id") AND ("es"."deleted_at" IS NULL) AND (COALESCE("es"."status", 'pending'::"text") = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))))) AS "has_event_share",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_shares" "fs"
                  WHERE (("fs"."flow_id" = "ref"."flow_id") AND ("fs"."deleted_at" IS NULL) AND (COALESCE("fs"."status", 'pending'::"text") = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))))) AS "has_flow_share",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_posts" "fp"
                  WHERE (("fp"."flow_id" = "ref"."flow_id") AND (COALESCE("fp"."is_hidden", false) = false)))) AS "has_flow_post",
            (EXISTS ( SELECT 1
                   FROM "public"."reminders" "r"
                  WHERE (("r"."user_id" = "ue"."user_id") AND (COALESCE("r"."status", 'pending'::"text") <> 'completed'::"text") AND (("r"."event_id" = "ue"."id") OR ("r"."flow_event_id" = "ue"."id"))))) AS "has_active_reminder",
            (EXISTS ( SELECT 1
                   FROM "public"."scheduled_notifications" "sn"
                  WHERE (("sn"."user_id" = "ue"."user_id") AND ("sn"."is_active" = true) AND ("ue"."client_event_id" IS NOT NULL) AND ("sn"."client_event_id" = "ue"."client_event_id")))) AS "has_scheduled_notification"
           FROM ((("public"."user_events" "ue"
             JOIN "public"."shared_calendars" "sc" ON ((("sc"."id" = "ue"."calendar_id") AND ("sc"."deleted_at" IS NULL))))
             LEFT JOIN LATERAL ( SELECT COALESCE("public"."user_event_referenced_flow_id"(("ue"."flow_local_id")::bigint, "ue"."client_event_id", "ue"."detail"), "public"."flow_id_from_action_id"("ue"."user_id", "ue"."action_id")) AS "flow_id") "ref" ON (true))
             LEFT JOIN "public"."flows" "f" ON (("f"."id" = "ref"."flow_id")))
        ), "reasoned" AS (
         SELECT "filed"."id",
            "filed"."user_id",
            "filed"."client_event_id",
            "filed"."calendar_id",
            "filed"."calendar_name",
            "filed"."calendar_color",
            "filed"."calendar_is_personal",
            "filed"."title",
            "filed"."detail",
            "filed"."location",
            "filed"."all_day",
            "filed"."starts_at",
            "filed"."ends_at",
            "filed"."flow_local_id",
            "filed"."category",
            "filed"."action_id",
            "filed"."behavior_payload",
            "filed"."updated_at",
            "filed"."created_at",
            "filed"."filed_flow_id",
            "filed"."flow_active",
            "filed"."flow_is_hidden",
            "filed"."flow_is_reminder",
            "filed"."flow_is_saved",
            "filed"."flow_notes",
            "filed"."user_timezone",
            "filed"."active_until",
            "filed"."date_lifecycle",
            "filed"."has_event_share",
            "filed"."has_flow_share",
            "filed"."has_flow_post",
            "filed"."has_active_reminder",
            "filed"."has_scheduled_notification",
                CASE
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'reminder:%'::"text") THEN 'client_event_id_reminder_prefix'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'nutrition:%'::"text") THEN 'client_event_id_nutrition_prefix'::"text"
                    WHEN COALESCE("filed"."flow_is_reminder", false) THEN 'flow_is_reminder'::"text"
                    WHEN ("filed"."filed_flow_id" IS NOT NULL) THEN 'flow_reference'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'maat:%'::"text") THEN 'legacy_maat_prefix'::"text"
                    ELSE 'standalone_event'::"text"
                END AS "reason_item_kind",
                CASE
                    WHEN ("lower"(COALESCE("filed"."category", ''::"text")) = 'tombstone'::"text") THEN 'category_tombstone'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'reminder:tombstone:%'::"text") THEN 'reminder_tombstone'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'maat:%'::"text") THEN 'legacy_maat_event'::"text"
                    WHEN "public"."user_event_recently_deleted"("filed"."user_id", "filed"."client_event_id") THEN 'event_deletion_trash'::"text"
                    WHEN (("filed"."filed_flow_id" IS NOT NULL) AND ("filed"."flow_active" IS NULL)) THEN 'orphaned_flow_reference'::"text"
                    WHEN (("filed"."filed_flow_id" IS NOT NULL) AND "public"."flow_is_deleted_state"("filed"."flow_active", "filed"."flow_is_hidden", "filed"."flow_notes")) THEN 'deleted_flow'::"text"
                    ELSE NULL::"text"
                END AS "reason_deleted",
                CASE
                    WHEN (COALESCE("filed"."all_day", false) AND ("filed"."ends_at" IS NOT NULL) AND ("filed"."ends_at" > "filed"."starts_at")) THEN 'all_day_valid_ends_at'::"text"
                    WHEN COALESCE("filed"."all_day", false) THEN 'all_day_local_day_end'::"text"
                    WHEN (("filed"."ends_at" IS NOT NULL) AND ("filed"."ends_at" > "filed"."starts_at")) THEN 'timed_valid_ends_at'::"text"
                    ELSE 'starts_at'::"text"
                END AS "reason_active_until"
           FROM "filed"
        ), "classified" AS (
         SELECT "reasoned"."id",
            "reasoned"."user_id",
            "reasoned"."client_event_id",
            "reasoned"."calendar_id",
            "reasoned"."calendar_name",
            "reasoned"."calendar_color",
            "reasoned"."calendar_is_personal",
            "reasoned"."title",
            "reasoned"."detail",
            "reasoned"."location",
            "reasoned"."all_day",
            "reasoned"."starts_at",
            "reasoned"."ends_at",
            "reasoned"."flow_local_id",
            "reasoned"."category",
            "reasoned"."action_id",
            "reasoned"."behavior_payload",
            "reasoned"."updated_at",
            "reasoned"."created_at",
            "reasoned"."filed_flow_id",
            "reasoned"."flow_active",
            "reasoned"."flow_is_hidden",
            "reasoned"."flow_is_reminder",
            "reasoned"."flow_is_saved",
            "reasoned"."flow_notes",
            "reasoned"."user_timezone",
            "reasoned"."active_until",
            "reasoned"."date_lifecycle",
            "reasoned"."has_event_share",
            "reasoned"."has_flow_share",
            "reasoned"."has_flow_post",
            "reasoned"."has_active_reminder",
            "reasoned"."has_scheduled_notification",
            "reasoned"."reason_item_kind",
            "reasoned"."reason_deleted",
            "reasoned"."reason_active_until",
                CASE
                    WHEN (("lower"(COALESCE("reasoned"."client_event_id", ''::"text")) ~~ 'reminder:%'::"text") OR ("lower"(COALESCE("reasoned"."client_event_id", ''::"text")) ~~ 'nutrition:%'::"text") OR COALESCE("reasoned"."flow_is_reminder", false)) THEN 'reminder'::"text"
                    WHEN (("reasoned"."filed_flow_id" IS NOT NULL) OR ("lower"(COALESCE("reasoned"."client_event_id", ''::"text")) ~~ 'maat:%'::"text")) THEN 'flow'::"text"
                    ELSE 'note'::"text"
                END AS "item_kind",
            ("reasoned"."reason_deleted" IS NOT NULL) AS "is_deleted",
            COALESCE("reasoned"."flow_is_saved", false) AS "is_saved",
            ("reasoned"."calendar_is_personal" = false) AS "is_shared_calendar_source",
            "reasoned"."has_event_share" AS "is_event_share_source",
            "reasoned"."has_flow_share" AS "is_flow_share_source",
            "reasoned"."has_flow_post" AS "is_flow_post_source",
            COALESCE("reasoned"."flow_is_saved", false) AS "is_flow_saved_source",
            "reasoned"."has_active_reminder" AS "is_active_reminder_source",
            "reasoned"."has_scheduled_notification" AS "is_scheduled_notification_source"
           FROM "reasoned"
        ), "projected" AS (
         SELECT "classified"."id",
            "classified"."user_id",
            "classified"."client_event_id",
            "classified"."calendar_id",
            "classified"."calendar_name",
            "classified"."calendar_color",
            "classified"."calendar_is_personal",
            "classified"."title",
            "classified"."detail",
            "classified"."location",
            "classified"."all_day",
            "classified"."starts_at",
            "classified"."ends_at",
            "classified"."flow_local_id",
            "classified"."category",
            "classified"."action_id",
            "classified"."behavior_payload",
            "classified"."updated_at",
            "classified"."created_at",
            "classified"."filed_flow_id",
            "classified"."flow_active",
            "classified"."flow_is_hidden",
            "classified"."flow_is_reminder",
            "classified"."flow_is_saved",
            "classified"."flow_notes",
            "classified"."user_timezone",
            "classified"."active_until",
            "classified"."date_lifecycle",
            "classified"."has_event_share",
            "classified"."has_flow_share",
            "classified"."has_flow_post",
            "classified"."has_active_reminder",
            "classified"."has_scheduled_notification",
            "classified"."reason_item_kind",
            "classified"."reason_deleted",
            "classified"."reason_active_until",
            "classified"."item_kind",
            "classified"."is_deleted",
            "classified"."is_saved",
            "classified"."is_shared_calendar_source",
            "classified"."is_event_share_source",
            "classified"."is_flow_share_source",
            "classified"."is_flow_post_source",
            "classified"."is_flow_saved_source",
            "classified"."is_active_reminder_source",
            "classified"."is_scheduled_notification_source",
                CASE
                    WHEN "classified"."is_deleted" THEN 'deleted'::"text"
                    ELSE "classified"."date_lifecycle"
                END AS "lifecycle",
            (("classified"."is_deleted" = false) AND ("classified"."date_lifecycle" = 'active'::"text")) AS "live_on_calendar",
            ("classified"."is_shared_calendar_source" OR "classified"."is_event_share_source" OR "classified"."is_flow_share_source") AS "is_shared",
            "classified"."is_flow_post_source" AS "is_posted"
           FROM "classified"
        )
 SELECT "id",
    "user_id",
    "client_event_id",
    "calendar_id",
    "calendar_name",
    "calendar_color",
    "calendar_is_personal",
    "title",
    "detail",
    "location",
    "all_day",
    "starts_at",
    "ends_at",
    "flow_local_id",
    "category",
    "action_id",
    "behavior_payload",
    "updated_at",
    "created_at",
    "filed_flow_id",
    "flow_active",
    "flow_is_hidden",
    "flow_is_reminder",
    "flow_is_saved",
    "flow_notes",
    "user_timezone",
    "active_until",
    "date_lifecycle",
    "has_event_share",
    "has_flow_share",
    "has_flow_post",
    "has_active_reminder",
    "has_scheduled_notification",
    "reason_item_kind",
    "reason_deleted",
    "reason_active_until",
    "item_kind",
    "is_deleted",
    "is_saved",
    "is_shared_calendar_source",
    "is_event_share_source",
    "is_flow_share_source",
    "is_flow_post_source",
    "is_flow_saved_source",
    "is_active_reminder_source",
    "is_scheduled_notification_source",
    "lifecycle",
    "live_on_calendar",
    "is_shared",
    "is_posted",
    "jsonb_build_object"('item_kind', "jsonb_build_object"('value', "item_kind", 'reason', "reason_item_kind"), 'lifecycle', "jsonb_build_object"('value', "lifecycle", 'date_lifecycle', "date_lifecycle", 'deleted_reason', "reason_deleted", 'active_until', "active_until", 'active_until_reason', "reason_active_until", 'timezone', "user_timezone"), 'calendar', "jsonb_build_object"('calendar_id', "calendar_id", 'calendar_name', "calendar_name", 'calendar_is_personal', "calendar_is_personal", 'live_on_calendar', "live_on_calendar"), 'share_sources', "jsonb_build_object"('shared_calendar', "is_shared_calendar_source", 'event_share', "is_event_share_source", 'flow_share', "is_flow_share_source"), 'post_sources', "jsonb_build_object"('flow_post', "is_flow_post_source"), 'save_sources', "jsonb_build_object"('flow_saved', "is_flow_saved_source"), 'reminder_sources', "jsonb_build_object"('active_reminder', "is_active_reminder_source", 'scheduled_notification', "is_scheduled_notification_source")) AS "filing_reasons"
   FROM "projected";


ALTER VIEW "private"."user_event_filing_items_internal" OWNER TO "postgres";


COMMENT ON VIEW "private"."user_event_filing_items_internal" IS 'Internal audit filing view with deleted lifecycle rows and justification fields. Not granted to client API roles.';



CREATE TABLE IF NOT EXISTS "public"."user_event_completions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_event_id" "text" NOT NULL,
    "flow_id" bigint NOT NULL,
    "completed_on" "date" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'client'::"text" NOT NULL,
    "metadata" "jsonb"
);


ALTER TABLE "public"."user_event_completions" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_event_completions" IS 'Phase 1: one row per completed event; keyed by client_event_id so completions survive reschedule. completed_on = flow-window date; completed_at = audit timestamp.';



CREATE OR REPLACE VIEW "private"."flow_filing_items_internal" WITH ("security_invoker"='true') AS
 WITH "event_counts" AS (
         SELECT "e"."filed_flow_id" AS "flow_id",
            "count"(*) FILTER (WHERE ("e"."lifecycle" <> 'deleted'::"text")) AS "total_event_count",
            "count"(*) FILTER (WHERE (("e"."lifecycle" <> 'deleted'::"text") AND "e"."live_on_calendar")) AS "live_event_count",
            "count"(*) FILTER (WHERE ("e"."lifecycle" = 'inactive'::"text")) AS "inactive_event_count",
            "count"(*) FILTER (WHERE (("e"."lifecycle" <> 'deleted'::"text") AND ("uec"."id" IS NOT NULL))) AS "completed_event_count",
            "count"(*) FILTER (WHERE (("e"."lifecycle" <> 'deleted'::"text") AND (("e"."client_event_id" IS NULL) OR ("btrim"("e"."client_event_id") = ''::"text") OR ("uec"."id" IS NULL)))) AS "remaining_event_count",
            "count"(*) FILTER (WHERE (("e"."lifecycle" <> 'deleted'::"text") AND "e"."live_on_calendar" AND (("e"."client_event_id" IS NULL) OR ("btrim"("e"."client_event_id") = ''::"text") OR ("uec"."id" IS NULL)))) AS "remaining_live_event_count"
           FROM ("private"."user_event_filing_items_internal" "e"
             LEFT JOIN "public"."user_event_completions" "uec" ON ((("uec"."user_id" = "e"."user_id") AND ("uec"."flow_id" = "e"."filed_flow_id") AND ("uec"."client_event_id" = "e"."client_event_id"))))
          WHERE ("e"."filed_flow_id" IS NOT NULL)
          GROUP BY "e"."filed_flow_id"
        ), "flow_sources" AS (
         SELECT "f"."id",
            "f"."user_id",
            "f"."calendar_id",
            "sc"."name" AS "calendar_name",
            "sc"."color" AS "calendar_color",
            "sc"."is_personal" AS "calendar_is_personal",
            "f"."name",
            "f"."color",
            "f"."active",
            "f"."is_saved",
            "f"."start_date",
            "f"."end_date",
            "f"."notes",
            "f"."rules",
            "f"."ai_metadata",
            "f"."is_hidden",
            "f"."share_id",
            "f"."created_at",
            "f"."updated_at",
            "f"."is_reminder",
            "f"."reminder_uuid",
            "f"."origin_type",
            "f"."origin_flow_id",
            "f"."origin_share_id",
            "f"."origin_generation_id",
            "f"."root_flow_id",
            COALESCE(NULLIF("public"."_get_user_timezone"("f"."user_id"), ''::"text"), 'UTC'::"text") AS "user_timezone",
            "public"."flow_record_kind"("f"."active", "f"."is_hidden", "f"."is_reminder", "f"."notes") AS "flow_record_kind",
            "public"."flow_is_schedule_open"("f"."end_date", "public"."_get_user_timezone"("f"."user_id")) AS "schedule_open",
            "public"."flow_is_deleted_state"("f"."active", "f"."is_hidden", "f"."notes") AS "is_deleted",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_shares" "fs"
                  WHERE (("fs"."flow_id" = "f"."id") AND ("fs"."deleted_at" IS NULL) AND (COALESCE("fs"."status", 'pending'::"text") = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))))) AS "has_flow_share",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_posts" "fp"
                  WHERE (("fp"."flow_id" = "f"."id") AND (COALESCE("fp"."is_hidden", false) = false)))) AS "has_flow_post"
           FROM ("public"."flows" "f"
             JOIN "public"."shared_calendars" "sc" ON ((("sc"."id" = "f"."calendar_id") AND ("sc"."deleted_at" IS NULL))))
        ), "classified" AS (
         SELECT "fs"."id",
            "fs"."user_id",
            "fs"."calendar_id",
            "fs"."calendar_name",
            "fs"."calendar_color",
            "fs"."calendar_is_personal",
            "fs"."name",
            "fs"."color",
            "fs"."active",
            "fs"."is_saved",
            "fs"."start_date",
            "fs"."end_date",
            "fs"."notes",
            "fs"."rules",
            "fs"."ai_metadata",
            "fs"."is_hidden",
            "fs"."share_id",
            "fs"."created_at",
            "fs"."updated_at",
            "fs"."is_reminder",
            "fs"."reminder_uuid",
            "fs"."origin_type",
            "fs"."origin_flow_id",
            "fs"."origin_share_id",
            "fs"."origin_generation_id",
            "fs"."root_flow_id",
            "fs"."user_timezone",
            "fs"."flow_record_kind",
            "fs"."schedule_open",
            "fs"."is_deleted",
            "fs"."has_flow_share",
            "fs"."has_flow_post",
            COALESCE("ec"."total_event_count", (0)::bigint) AS "total_event_count",
            COALESCE("ec"."live_event_count", (0)::bigint) AS "live_event_count",
            COALESCE("ec"."inactive_event_count", (0)::bigint) AS "inactive_event_count",
            COALESCE("ec"."completed_event_count", (0)::bigint) AS "completed_event_count",
            COALESCE("ec"."remaining_event_count", (0)::bigint) AS "remaining_event_count",
            COALESCE("ec"."remaining_live_event_count", (0)::bigint) AS "remaining_live_event_count",
                CASE
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'reminder'::"text"
                    ELSE 'flow'::"text"
                END AS "item_kind",
                CASE
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'flow_is_reminder'::"text"
                    WHEN ("fs"."flow_record_kind" = 'hiddenHelper'::"text") THEN 'repeating_note_helper'::"text"
                    ELSE 'flow_row'::"text"
                END AS "reason_item_kind",
                CASE
                    WHEN "fs"."is_deleted" THEN 'flow_deleted_state'::"text"
                    ELSE NULL::"text"
                END AS "reason_deleted",
                CASE
                    WHEN "fs"."is_deleted" THEN 'deleted_flow'::"text"
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'reminder_backed_flow'::"text"
                    WHEN ("fs"."flow_record_kind" = 'hiddenHelper'::"text") THEN 'repeating_note_helper'::"text"
                    WHEN (COALESCE("fs"."active", false) = false) THEN 'flow_inactive'::"text"
                    WHEN ("fs"."schedule_open" = false) THEN 'schedule_closed'::"text"
                    WHEN (COALESCE("ec"."remaining_live_event_count", (0)::bigint) <= 0) THEN 'no_live_events'::"text"
                    ELSE 'active_with_live_events'::"text"
                END AS "reason_lifecycle",
                CASE
                    WHEN "fs"."is_deleted" THEN 'deleted'::"text"
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'inactive'::"text"
                    WHEN ("fs"."flow_record_kind" = 'hiddenHelper'::"text") THEN 'inactive'::"text"
                    WHEN (COALESCE("fs"."active", false) = false) THEN 'inactive'::"text"
                    WHEN ("fs"."schedule_open" = false) THEN 'inactive'::"text"
                    WHEN (COALESCE("ec"."remaining_live_event_count", (0)::bigint) <= 0) THEN 'inactive'::"text"
                    ELSE 'active'::"text"
                END AS "lifecycle",
            ("fs"."calendar_is_personal" = false) AS "is_shared_calendar_source",
            "fs"."has_flow_share" AS "is_flow_share_source",
            "fs"."has_flow_post" AS "is_flow_post_source",
            COALESCE("fs"."is_saved", false) AS "is_flow_saved_source"
           FROM ("flow_sources" "fs"
             LEFT JOIN "event_counts" "ec" ON (("ec"."flow_id" = "fs"."id")))
        )
 SELECT "id",
    "user_id",
    "calendar_id",
    "calendar_name",
    "calendar_color",
    "calendar_is_personal",
    "name",
    "color",
    "active",
    "is_saved",
    "start_date",
    "end_date",
    "notes",
    "rules",
    "ai_metadata",
    "is_hidden",
    "share_id",
    "created_at",
    "updated_at",
    "is_reminder",
    "reminder_uuid",
    "origin_type",
    "origin_flow_id",
    "origin_share_id",
    "origin_generation_id",
    "root_flow_id",
    "user_timezone",
    "flow_record_kind",
    "schedule_open",
    "is_deleted",
    "has_flow_share",
    "has_flow_post",
    "total_event_count",
    "live_event_count",
    "inactive_event_count",
    "completed_event_count",
    "remaining_event_count",
    "remaining_live_event_count",
    "item_kind",
    "reason_item_kind",
    "reason_deleted",
    "reason_lifecycle",
    "lifecycle",
    "is_shared_calendar_source",
    "is_flow_share_source",
    "is_flow_post_source",
    "is_flow_saved_source",
    ("lifecycle" = 'active'::"text") AS "live_on_calendar",
    ("lifecycle" = 'active'::"text") AS "is_counted_active",
    (("lifecycle" = 'active'::"text") AND ("item_kind" = 'flow'::"text")) AS "visible_in_active_list",
    (COALESCE("is_saved", false) AND ("item_kind" = 'flow'::"text") AND ("lifecycle" <> 'deleted'::"text") AND ("flow_record_kind" = ANY (ARRAY['active'::"text", 'inactive'::"text"]))) AS "visible_in_saved_list",
    ("is_shared_calendar_source" OR "is_flow_share_source") AS "is_shared",
    "is_flow_post_source" AS "is_posted",
    "jsonb_build_object"('item_kind', "jsonb_build_object"('value', "item_kind", 'reason', "reason_item_kind", 'flow_record_kind', "flow_record_kind"), 'lifecycle', "jsonb_build_object"('value', "lifecycle", 'reason', "reason_lifecycle", 'deleted_reason', "reason_deleted", 'schedule_open', "schedule_open", 'timezone', "user_timezone", 'remaining_live_event_count', "remaining_live_event_count"), 'calendar', "jsonb_build_object"('calendar_id', "calendar_id", 'calendar_name', "calendar_name", 'calendar_is_personal', "calendar_is_personal", 'live_on_calendar', ("lifecycle" = 'active'::"text")), 'event_counts', "jsonb_build_object"('total', "total_event_count", 'live', "live_event_count", 'inactive', "inactive_event_count", 'completed', "completed_event_count", 'remaining', "remaining_event_count", 'remaining_live', "remaining_live_event_count"), 'share_sources', "jsonb_build_object"('shared_calendar', "is_shared_calendar_source", 'flow_share', "is_flow_share_source"), 'post_sources', "jsonb_build_object"('flow_post', "is_flow_post_source"), 'save_sources', "jsonb_build_object"('flow_saved', "is_flow_saved_source")) AS "filing_reasons"
   FROM "classified";


ALTER VIEW "private"."flow_filing_items_internal" OWNER TO "postgres";


COMMENT ON VIEW "private"."flow_filing_items_internal" IS 'Internal flow-level filing audit view. Includes deleted flow rows and filing reasons for service-role diagnostics.';



CREATE TABLE IF NOT EXISTS "public"."alignment_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."alignment_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "email" "text",
    "event" "text" NOT NULL,
    "properties" "jsonb",
    "source" "text" DEFAULT 'client'::"text"
);


ALTER TABLE "public"."app_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" bigint NOT NULL,
    "txid" bigint DEFAULT "txid_current"() NOT NULL,
    "table_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "row_pk" "jsonb",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "user_id" "uuid",
    "email" "text",
    "request_ip" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."audit_log_id_seq" OWNED BY "public"."audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."backup_user_events_cid_only" (
    "id" "uuid",
    "user_id" "uuid",
    "client_event_id" "text",
    "title" "text",
    "detail" "text",
    "location" "text",
    "all_day" boolean,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "flow_local_id" integer,
    "flow_tpl_key" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "category" "text"
);


ALTER TABLE "public"."backup_user_events_cid_only" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_user_events_flow_fix" (
    "id" "uuid",
    "user_id" "uuid",
    "client_event_id" "text",
    "title" "text",
    "detail" "text",
    "location" "text",
    "all_day" boolean,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "flow_local_id" integer,
    "flow_tpl_key" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "category" "text"
);


ALTER TABLE "public"."backup_user_events_flow_fix" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checklist_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "source" "text" NOT NULL,
    "source_key" "text" NOT NULL,
    "title" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_opportunity" boolean DEFAULT true NOT NULL,
    "manual_lock" boolean DEFAULT false NOT NULL,
    "allow_evidence_upgrade" boolean DEFAULT true NOT NULL,
    "allow_evidence_override_pending" boolean DEFAULT true NOT NULL,
    "evidence_refs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "field_id" "uuid",
    "todo_id" "uuid",
    "event_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checklist_items_source_check" CHECK (("source" = ANY (ARRAY['cycle'::"text", 'todo'::"text", 'manual'::"text", 'event'::"text", 'suggestion'::"text"]))),
    CONSTRAINT "checklist_items_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'done'::"text", 'partial'::"text", 'skipped'::"text", 'unlogged'::"text"])))
);


ALTER TABLE "public"."checklist_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cycle_adjustment_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "suggestion" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "applied_patch" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "applied_from" "text",
    "decided_at" timestamp with time zone,
    "snooze_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cycle_adjustment_suggestions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'dismissed'::"text", 'snoozed'::"text"])))
);


ALTER TABLE "public"."cycle_adjustment_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cycle_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "node_id" "uuid",
    "value_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "checklist_enabled" boolean DEFAULT true NOT NULL,
    "reminder_enabled" boolean DEFAULT false NOT NULL,
    "tracker_enabled" boolean DEFAULT true NOT NULL,
    "resolution_mode" "text" DEFAULT 'checklist_primary'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cycle_fields_resolution_mode_check" CHECK (("resolution_mode" = ANY (ARRAY['checklist_primary'::"text", 'evidence_can_upgrade'::"text", 'evidence_can_override_pending'::"text"])))
);


ALTER TABLE "public"."cycle_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cycle_schedule_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "field_id" "uuid" NOT NULL,
    "title" "text",
    "days_of_week" integer[],
    "all_day" boolean DEFAULT false NOT NULL,
    "start_time_local" time without time zone,
    "end_time_local" time without time zone,
    "reminder_offset_minutes" integer,
    "is_optional" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cycle_schedule_rules_days_check" CHECK ((("days_of_week" IS NULL) OR ("days_of_week" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]))),
    CONSTRAINT "cycle_schedule_rules_time_check" CHECK (("all_day" OR ("start_time_local" IS NOT NULL)))
);


ALTER TABLE "public"."cycle_schedule_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decan_reflection_schedule" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "decan_start" "date" NOT NULL,
    "decan_end" "date" NOT NULL,
    "send_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "claimed_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "last_error" "text",
    "decan_name" "text",
    "decan_theme" "text",
    "decan_context_key" "text",
    "claim_token" "text",
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone
);


ALTER TABLE "public"."decan_reflection_schedule" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decan_reflections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "decan_key" "text",
    "decan_name" "text",
    "decan_theme" "text",
    "decan_start" "date",
    "decan_end" "date",
    "badge_count" integer,
    "reflection_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."decan_reflections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dm_message_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_share_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."dm_message_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_deletion_trash" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_table" "text" DEFAULT 'user_events'::"text" NOT NULL,
    "source_id" "uuid",
    "client_event_id" "text",
    "calendar_id" "uuid",
    "flow_local_id" bigint,
    "title" "text",
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "deleted_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "purge_after" timestamp with time zone DEFAULT ("timezone"('utc'::"text", "now"()) + '10 days'::interval) NOT NULL,
    "purged_at" timestamp with time zone,
    "row_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "delete_semantic" "text" DEFAULT 'user_delete'::"text" NOT NULL,
    "suppresses_client" boolean DEFAULT true NOT NULL,
    "source_feature" "text",
    "delete_scope" "text" DEFAULT 'exact_occurrence'::"text" NOT NULL,
    "operation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid"
);


ALTER TABLE "public"."event_deletion_trash" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flow_saves" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" bigint NOT NULL,
    "saved_from" "text" NOT NULL,
    "saved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb",
    CONSTRAINT "flow_saves_saved_from_check" CHECK (("saved_from" = ANY (ARRAY['profile'::"text", 'share'::"text", 'inbox'::"text", 'search'::"text", 'ai'::"text", 'self'::"text"])))
);


ALTER TABLE "public"."flow_saves" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shared_calendar_members" (
    "calendar_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'editor'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    CONSTRAINT "shared_calendar_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'viewer'::"text"]))),
    CONSTRAINT "shared_calendar_members_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."shared_calendar_members" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_event_filing_items_client" WITH ("security_invoker"='true') AS
 WITH "filed" AS (
         SELECT "ue"."id",
            "ue"."user_id",
            "ue"."client_event_id",
            "ue"."calendar_id",
            "sc"."name" AS "calendar_name",
            "sc"."color" AS "calendar_color",
            "sc"."is_personal" AS "calendar_is_personal",
            "ue"."title",
            "ue"."detail",
            "ue"."location",
            "ue"."all_day",
            "ue"."starts_at",
            "ue"."ends_at",
            "ue"."flow_local_id",
            "ue"."category",
            "ue"."action_id",
            "ue"."behavior_payload",
            "ue"."updated_at",
            "ue"."created_at",
            "ref"."flow_id" AS "filed_flow_id",
            "f"."active" AS "flow_active",
            "f"."is_hidden" AS "flow_is_hidden",
            "f"."is_reminder" AS "flow_is_reminder",
            "f"."is_saved" AS "flow_is_saved",
            "f"."notes" AS "flow_notes",
            COALESCE(NULLIF("public"."_get_user_timezone"("ue"."user_id"), ''::"text"), 'UTC'::"text") AS "user_timezone",
            "public"."user_event_active_until"("ue"."user_id", "ue"."all_day", "ue"."starts_at", "ue"."ends_at") AS "active_until",
            "public"."user_event_date_lifecycle"("ue"."user_id", "ue"."all_day", "ue"."starts_at", "ue"."ends_at") AS "date_lifecycle",
            (EXISTS ( SELECT 1
                   FROM "public"."event_shares" "es"
                  WHERE (("es"."event_id" = "ue"."id") AND ("es"."deleted_at" IS NULL) AND (COALESCE("es"."status", 'pending'::"text") = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))))) AS "has_event_share",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_shares" "fs"
                  WHERE (("fs"."flow_id" = "ref"."flow_id") AND ("fs"."deleted_at" IS NULL) AND (COALESCE("fs"."status", 'pending'::"text") = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))))) AS "has_flow_share",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_posts" "fp"
                  WHERE (("fp"."flow_id" = "ref"."flow_id") AND (COALESCE("fp"."is_hidden", false) = false)))) AS "has_flow_post",
            (EXISTS ( SELECT 1
                   FROM "public"."reminders" "r"
                  WHERE (("r"."user_id" = "ue"."user_id") AND (COALESCE("r"."status", 'pending'::"text") <> 'completed'::"text") AND (("r"."event_id" = "ue"."id") OR ("r"."flow_event_id" = "ue"."id"))))) AS "has_active_reminder",
            (EXISTS ( SELECT 1
                   FROM "public"."scheduled_notifications" "sn"
                  WHERE (("sn"."user_id" = "ue"."user_id") AND ("sn"."is_active" = true) AND ("ue"."client_event_id" IS NOT NULL) AND ("sn"."client_event_id" = "ue"."client_event_id")))) AS "has_scheduled_notification"
           FROM ((("public"."user_events" "ue"
             JOIN "public"."shared_calendars" "sc" ON ((("sc"."id" = "ue"."calendar_id") AND ("sc"."deleted_at" IS NULL))))
             LEFT JOIN LATERAL ( SELECT COALESCE("public"."user_event_referenced_flow_id"(("ue"."flow_local_id")::bigint, "ue"."client_event_id", "ue"."detail"), "public"."flow_id_from_action_id"("ue"."user_id", "ue"."action_id")) AS "flow_id") "ref" ON (true))
             LEFT JOIN "public"."flows" "f" ON (("f"."id" = "ref"."flow_id")))
        ), "reasoned" AS (
         SELECT "filed"."id",
            "filed"."user_id",
            "filed"."client_event_id",
            "filed"."calendar_id",
            "filed"."calendar_name",
            "filed"."calendar_color",
            "filed"."calendar_is_personal",
            "filed"."title",
            "filed"."detail",
            "filed"."location",
            "filed"."all_day",
            "filed"."starts_at",
            "filed"."ends_at",
            "filed"."flow_local_id",
            "filed"."category",
            "filed"."action_id",
            "filed"."behavior_payload",
            "filed"."updated_at",
            "filed"."created_at",
            "filed"."filed_flow_id",
            "filed"."flow_active",
            "filed"."flow_is_hidden",
            "filed"."flow_is_reminder",
            "filed"."flow_is_saved",
            "filed"."flow_notes",
            "filed"."user_timezone",
            "filed"."active_until",
            "filed"."date_lifecycle",
            "filed"."has_event_share",
            "filed"."has_flow_share",
            "filed"."has_flow_post",
            "filed"."has_active_reminder",
            "filed"."has_scheduled_notification",
                CASE
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'reminder:%'::"text") THEN 'client_event_id_reminder_prefix'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'nutrition:%'::"text") THEN 'client_event_id_nutrition_prefix'::"text"
                    WHEN COALESCE("filed"."flow_is_reminder", false) THEN 'flow_is_reminder'::"text"
                    WHEN ("filed"."filed_flow_id" IS NOT NULL) THEN 'flow_reference'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'maat:%'::"text") THEN 'legacy_maat_prefix'::"text"
                    ELSE 'standalone_event'::"text"
                END AS "reason_item_kind",
                CASE
                    WHEN ("lower"(COALESCE("filed"."category", ''::"text")) = 'tombstone'::"text") THEN 'category_tombstone'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'reminder:tombstone:%'::"text") THEN 'reminder_tombstone'::"text"
                    WHEN ("lower"(COALESCE("filed"."client_event_id", ''::"text")) ~~ 'maat:%'::"text") THEN 'legacy_maat_event'::"text"
                    WHEN "public"."user_event_recently_deleted"("filed"."user_id", "filed"."client_event_id") THEN 'event_deletion_trash'::"text"
                    WHEN (("filed"."filed_flow_id" IS NOT NULL) AND ("filed"."flow_active" IS NULL)) THEN 'orphaned_flow_reference'::"text"
                    WHEN (("filed"."filed_flow_id" IS NOT NULL) AND "public"."flow_is_deleted_state"("filed"."flow_active", "filed"."flow_is_hidden", "filed"."flow_notes")) THEN 'deleted_flow'::"text"
                    ELSE NULL::"text"
                END AS "reason_deleted",
                CASE
                    WHEN (COALESCE("filed"."all_day", false) AND ("filed"."ends_at" IS NOT NULL) AND ("filed"."ends_at" > "filed"."starts_at")) THEN 'all_day_valid_ends_at'::"text"
                    WHEN COALESCE("filed"."all_day", false) THEN 'all_day_local_day_end'::"text"
                    WHEN (("filed"."ends_at" IS NOT NULL) AND ("filed"."ends_at" > "filed"."starts_at")) THEN 'timed_valid_ends_at'::"text"
                    ELSE 'starts_at'::"text"
                END AS "reason_active_until"
           FROM "filed"
        ), "classified" AS (
         SELECT "reasoned"."id",
            "reasoned"."user_id",
            "reasoned"."client_event_id",
            "reasoned"."calendar_id",
            "reasoned"."calendar_name",
            "reasoned"."calendar_color",
            "reasoned"."calendar_is_personal",
            "reasoned"."title",
            "reasoned"."detail",
            "reasoned"."location",
            "reasoned"."all_day",
            "reasoned"."starts_at",
            "reasoned"."ends_at",
            "reasoned"."flow_local_id",
            "reasoned"."category",
            "reasoned"."action_id",
            "reasoned"."behavior_payload",
            "reasoned"."updated_at",
            "reasoned"."created_at",
            "reasoned"."filed_flow_id",
            "reasoned"."flow_active",
            "reasoned"."flow_is_hidden",
            "reasoned"."flow_is_reminder",
            "reasoned"."flow_is_saved",
            "reasoned"."flow_notes",
            "reasoned"."user_timezone",
            "reasoned"."active_until",
            "reasoned"."date_lifecycle",
            "reasoned"."has_event_share",
            "reasoned"."has_flow_share",
            "reasoned"."has_flow_post",
            "reasoned"."has_active_reminder",
            "reasoned"."has_scheduled_notification",
            "reasoned"."reason_item_kind",
            "reasoned"."reason_deleted",
            "reasoned"."reason_active_until",
                CASE
                    WHEN (("lower"(COALESCE("reasoned"."client_event_id", ''::"text")) ~~ 'reminder:%'::"text") OR ("lower"(COALESCE("reasoned"."client_event_id", ''::"text")) ~~ 'nutrition:%'::"text") OR COALESCE("reasoned"."flow_is_reminder", false)) THEN 'reminder'::"text"
                    WHEN (("reasoned"."filed_flow_id" IS NOT NULL) OR ("lower"(COALESCE("reasoned"."client_event_id", ''::"text")) ~~ 'maat:%'::"text")) THEN 'flow'::"text"
                    ELSE 'note'::"text"
                END AS "item_kind",
            ("reasoned"."reason_deleted" IS NOT NULL) AS "is_deleted",
            COALESCE("reasoned"."flow_is_saved", false) AS "is_saved",
            ("reasoned"."calendar_is_personal" = false) AS "is_shared_calendar_source",
            "reasoned"."has_event_share" AS "is_event_share_source",
            "reasoned"."has_flow_share" AS "is_flow_share_source",
            "reasoned"."has_flow_post" AS "is_flow_post_source",
            COALESCE("reasoned"."flow_is_saved", false) AS "is_flow_saved_source",
            "reasoned"."has_active_reminder" AS "is_active_reminder_source",
            "reasoned"."has_scheduled_notification" AS "is_scheduled_notification_source"
           FROM "reasoned"
        ), "projected" AS (
         SELECT "classified"."id",
            "classified"."user_id",
            "classified"."client_event_id",
            "classified"."calendar_id",
            "classified"."calendar_name",
            "classified"."calendar_color",
            "classified"."calendar_is_personal",
            "classified"."title",
            "classified"."detail",
            "classified"."location",
            "classified"."all_day",
            "classified"."starts_at",
            "classified"."ends_at",
            "classified"."flow_local_id",
            "classified"."category",
            "classified"."action_id",
            "classified"."behavior_payload",
            "classified"."updated_at",
            "classified"."created_at",
            "classified"."filed_flow_id",
            "classified"."flow_active",
            "classified"."flow_is_hidden",
            "classified"."flow_is_reminder",
            "classified"."flow_is_saved",
            "classified"."flow_notes",
            "classified"."user_timezone",
            "classified"."active_until",
            "classified"."date_lifecycle",
            "classified"."has_event_share",
            "classified"."has_flow_share",
            "classified"."has_flow_post",
            "classified"."has_active_reminder",
            "classified"."has_scheduled_notification",
            "classified"."reason_item_kind",
            "classified"."reason_deleted",
            "classified"."reason_active_until",
            "classified"."item_kind",
            "classified"."is_deleted",
            "classified"."is_saved",
            "classified"."is_shared_calendar_source",
            "classified"."is_event_share_source",
            "classified"."is_flow_share_source",
            "classified"."is_flow_post_source",
            "classified"."is_flow_saved_source",
            "classified"."is_active_reminder_source",
            "classified"."is_scheduled_notification_source",
                CASE
                    WHEN "classified"."is_deleted" THEN 'deleted'::"text"
                    ELSE "classified"."date_lifecycle"
                END AS "lifecycle",
            (("classified"."is_deleted" = false) AND ("classified"."date_lifecycle" = 'active'::"text")) AS "live_on_calendar",
            ("classified"."is_shared_calendar_source" OR "classified"."is_event_share_source" OR "classified"."is_flow_share_source") AS "is_shared",
            "classified"."is_flow_post_source" AS "is_posted"
           FROM "classified"
        )
 SELECT "id",
    "user_id",
    "client_event_id",
    "calendar_id",
    "calendar_name",
    "calendar_color",
    "calendar_is_personal",
    "title",
    "detail",
    "location",
    "all_day",
    "starts_at",
    "ends_at",
    "flow_local_id",
    "category",
    "action_id",
    "behavior_payload",
    "updated_at",
    "created_at",
    "filed_flow_id",
    "flow_active",
    "flow_is_hidden",
    "flow_is_reminder",
    "flow_is_saved",
    "flow_notes",
    "user_timezone",
    "active_until",
    "date_lifecycle",
    "has_event_share",
    "has_flow_share",
    "has_flow_post",
    "has_active_reminder",
    "has_scheduled_notification",
    "reason_item_kind",
    "reason_deleted",
    "reason_active_until",
    "item_kind",
    "is_deleted",
    "is_saved",
    "is_shared_calendar_source",
    "is_event_share_source",
    "is_flow_share_source",
    "is_flow_post_source",
    "is_flow_saved_source",
    "is_active_reminder_source",
    "is_scheduled_notification_source",
    "lifecycle",
    "live_on_calendar",
    "is_shared",
    "is_posted",
    "jsonb_build_object"('item_kind', "jsonb_build_object"('value', "item_kind", 'reason', "reason_item_kind"), 'lifecycle', "jsonb_build_object"('value', "lifecycle", 'date_lifecycle', "date_lifecycle", 'deleted_reason', "reason_deleted", 'active_until', "active_until", 'active_until_reason', "reason_active_until", 'timezone', "user_timezone"), 'calendar', "jsonb_build_object"('calendar_id', "calendar_id", 'calendar_name', "calendar_name", 'calendar_is_personal', "calendar_is_personal", 'live_on_calendar', "live_on_calendar"), 'share_sources', "jsonb_build_object"('shared_calendar', "is_shared_calendar_source", 'event_share', "is_event_share_source", 'flow_share', "is_flow_share_source"), 'post_sources', "jsonb_build_object"('flow_post', "is_flow_post_source"), 'save_sources', "jsonb_build_object"('flow_saved', "is_flow_saved_source"), 'reminder_sources', "jsonb_build_object"('active_reminder', "is_active_reminder_source", 'scheduled_notification', "is_scheduled_notification_source")) AS "filing_reasons"
   FROM "projected"
  WHERE ("lifecycle" <> 'deleted'::"text");


ALTER VIEW "public"."user_event_filing_items_client" OWNER TO "postgres";


COMMENT ON VIEW "public"."user_event_filing_items_client" IS 'Client-safe canonical event filing view. Deleted/trash lifecycle rows are excluded at the API surface.';



CREATE OR REPLACE VIEW "public"."flow_filing_items_client" WITH ("security_invoker"='true') AS
 WITH "event_counts" AS (
         SELECT "e"."filed_flow_id" AS "flow_id",
            "count"(*) AS "total_event_count",
            "count"(*) FILTER (WHERE "e"."live_on_calendar") AS "live_event_count",
            "count"(*) FILTER (WHERE ("e"."lifecycle" = 'inactive'::"text")) AS "inactive_event_count",
            "count"(*) FILTER (WHERE ("uec"."id" IS NOT NULL)) AS "completed_event_count",
            "count"(*) FILTER (WHERE (("e"."client_event_id" IS NULL) OR ("btrim"("e"."client_event_id") = ''::"text") OR ("uec"."id" IS NULL))) AS "remaining_event_count",
            "count"(*) FILTER (WHERE ("e"."live_on_calendar" AND (("e"."client_event_id" IS NULL) OR ("btrim"("e"."client_event_id") = ''::"text") OR ("uec"."id" IS NULL)))) AS "remaining_live_event_count"
           FROM ("public"."user_event_filing_items_client" "e"
             LEFT JOIN "public"."user_event_completions" "uec" ON ((("uec"."user_id" = "e"."user_id") AND ("uec"."flow_id" = "e"."filed_flow_id") AND ("uec"."client_event_id" = "e"."client_event_id"))))
          WHERE ("e"."filed_flow_id" IS NOT NULL)
          GROUP BY "e"."filed_flow_id"
        ), "flow_sources" AS (
         SELECT "f"."id",
            "f"."user_id",
            "f"."calendar_id",
            "sc"."name" AS "calendar_name",
            "sc"."color" AS "calendar_color",
            "sc"."is_personal" AS "calendar_is_personal",
            "f"."name",
            "f"."color",
            "f"."active",
            (COALESCE("f"."is_saved", false) OR ("fsaves"."flow_id" IS NOT NULL)) AS "is_saved",
            "f"."start_date",
            "f"."end_date",
            "f"."notes",
            "f"."rules",
            "f"."ai_metadata",
            "f"."is_hidden",
            "f"."share_id",
            "f"."created_at",
            "f"."updated_at",
            "f"."is_reminder",
            "f"."reminder_uuid",
            "f"."origin_type",
            "f"."origin_flow_id",
            "f"."origin_share_id",
            "f"."origin_generation_id",
            "f"."root_flow_id",
            "fsaves"."saved_at",
            COALESCE(NULLIF("public"."_get_user_timezone"("f"."user_id"), ''::"text"), 'UTC'::"text") AS "user_timezone",
            "public"."flow_record_kind"("f"."active", "f"."is_hidden", "f"."is_reminder", "f"."notes") AS "flow_record_kind",
            "public"."flow_is_schedule_open"("f"."end_date", "public"."_get_user_timezone"("f"."user_id")) AS "schedule_open",
            "public"."flow_is_deleted_state"("f"."active", "f"."is_hidden", "f"."notes") AS "is_deleted",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_shares" "fshare"
                  WHERE (("fshare"."flow_id" = "f"."id") AND ("fshare"."deleted_at" IS NULL) AND (COALESCE("fshare"."status", 'pending'::"text") = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"]))))) AS "has_flow_share",
            (EXISTS ( SELECT 1
                   FROM "public"."flow_posts" "fp"
                  WHERE (("fp"."flow_id" = "f"."id") AND (COALESCE("fp"."is_hidden", false) = false)))) AS "has_flow_post"
           FROM (("public"."flows" "f"
             JOIN "public"."shared_calendars" "sc" ON ((("sc"."id" = "f"."calendar_id") AND ("sc"."deleted_at" IS NULL))))
             LEFT JOIN "public"."flow_saves" "fsaves" ON ((("fsaves"."flow_id" = "f"."id") AND ("fsaves"."user_id" = "auth"."uid"()))))
          WHERE (("f"."user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
                   FROM "public"."shared_calendar_members" "scm"
                  WHERE (("scm"."calendar_id" = "f"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text")))))
        ), "classified" AS (
         SELECT "fs"."id",
            "fs"."user_id",
            "fs"."calendar_id",
            "fs"."calendar_name",
            "fs"."calendar_color",
            "fs"."calendar_is_personal",
            "fs"."name",
            "fs"."color",
            "fs"."active",
            "fs"."is_saved",
            "fs"."start_date",
            "fs"."end_date",
            "fs"."notes",
            "fs"."rules",
            "fs"."ai_metadata",
            "fs"."is_hidden",
            "fs"."share_id",
            "fs"."created_at",
            "fs"."updated_at",
            "fs"."is_reminder",
            "fs"."reminder_uuid",
            "fs"."origin_type",
            "fs"."origin_flow_id",
            "fs"."origin_share_id",
            "fs"."origin_generation_id",
            "fs"."root_flow_id",
            "fs"."saved_at",
            "fs"."user_timezone",
            "fs"."flow_record_kind",
            "fs"."schedule_open",
            "fs"."is_deleted",
            "fs"."has_flow_share",
            "fs"."has_flow_post",
            COALESCE("ec"."total_event_count", (0)::bigint) AS "total_event_count",
            COALESCE("ec"."live_event_count", (0)::bigint) AS "live_event_count",
            COALESCE("ec"."inactive_event_count", (0)::bigint) AS "inactive_event_count",
            COALESCE("ec"."completed_event_count", (0)::bigint) AS "completed_event_count",
            COALESCE("ec"."remaining_event_count", (0)::bigint) AS "remaining_event_count",
            COALESCE("ec"."remaining_live_event_count", (0)::bigint) AS "remaining_live_event_count",
                CASE
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'reminder'::"text"
                    ELSE 'flow'::"text"
                END AS "item_kind",
                CASE
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'flow_is_reminder'::"text"
                    WHEN ("fs"."flow_record_kind" = 'hiddenHelper'::"text") THEN 'repeating_note_helper'::"text"
                    ELSE 'flow_row'::"text"
                END AS "reason_item_kind",
                CASE
                    WHEN "fs"."is_deleted" THEN 'flow_deleted_state'::"text"
                    ELSE NULL::"text"
                END AS "reason_deleted",
                CASE
                    WHEN "fs"."is_deleted" THEN 'deleted_flow'::"text"
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'reminder_backed_flow'::"text"
                    WHEN ("fs"."flow_record_kind" = 'hiddenHelper'::"text") THEN 'repeating_note_helper'::"text"
                    WHEN (COALESCE("fs"."active", false) = false) THEN 'flow_inactive'::"text"
                    WHEN ("fs"."schedule_open" = false) THEN 'schedule_closed'::"text"
                    WHEN (COALESCE("ec"."remaining_live_event_count", (0)::bigint) <= 0) THEN 'no_live_events'::"text"
                    ELSE 'active_with_live_events'::"text"
                END AS "reason_lifecycle",
                CASE
                    WHEN "fs"."is_deleted" THEN 'deleted'::"text"
                    WHEN COALESCE("fs"."is_reminder", false) THEN 'inactive'::"text"
                    WHEN ("fs"."flow_record_kind" = 'hiddenHelper'::"text") THEN 'inactive'::"text"
                    WHEN (COALESCE("fs"."active", false) = false) THEN 'inactive'::"text"
                    WHEN ("fs"."schedule_open" = false) THEN 'inactive'::"text"
                    WHEN (COALESCE("ec"."remaining_live_event_count", (0)::bigint) <= 0) THEN 'inactive'::"text"
                    ELSE 'active'::"text"
                END AS "lifecycle",
            ("fs"."calendar_is_personal" = false) AS "is_shared_calendar_source",
            "fs"."has_flow_share" AS "is_flow_share_source",
            "fs"."has_flow_post" AS "is_flow_post_source",
            COALESCE("fs"."is_saved", false) AS "is_flow_saved_source"
           FROM ("flow_sources" "fs"
             LEFT JOIN "event_counts" "ec" ON (("ec"."flow_id" = "fs"."id")))
        )
 SELECT "id",
    "user_id",
    "calendar_id",
    "calendar_name",
    "calendar_color",
    "calendar_is_personal",
    "name",
    "color",
    "active",
    "is_saved",
    "start_date",
    "end_date",
    "notes",
    "rules",
    "ai_metadata",
    "is_hidden",
    "share_id",
    "created_at",
    "updated_at",
    "is_reminder",
    "reminder_uuid",
    "origin_type",
    "origin_flow_id",
    "origin_share_id",
    "origin_generation_id",
    "root_flow_id",
    "saved_at",
    "user_timezone",
    "flow_record_kind",
    "schedule_open",
    "is_deleted",
    "has_flow_share",
    "has_flow_post",
    "total_event_count",
    "live_event_count",
    "inactive_event_count",
    "completed_event_count",
    "remaining_event_count",
    "remaining_live_event_count",
    "item_kind",
    "reason_item_kind",
    "reason_deleted",
    "reason_lifecycle",
    "lifecycle",
    "is_shared_calendar_source",
    "is_flow_share_source",
    "is_flow_post_source",
    "is_flow_saved_source",
    ("lifecycle" = 'active'::"text") AS "live_on_calendar",
    ("lifecycle" = 'active'::"text") AS "is_counted_active",
    (("lifecycle" = 'active'::"text") AND ("item_kind" = 'flow'::"text")) AS "visible_in_active_list",
    (COALESCE("is_saved", false) AND ("item_kind" = 'flow'::"text") AND ("lifecycle" <> 'deleted'::"text") AND ("flow_record_kind" = ANY (ARRAY['active'::"text", 'inactive'::"text"]))) AS "visible_in_saved_list",
    ("is_shared_calendar_source" OR "is_flow_share_source") AS "is_shared",
    "is_flow_post_source" AS "is_posted",
    "jsonb_build_object"('item_kind', "jsonb_build_object"('value', "item_kind", 'reason', "reason_item_kind", 'flow_record_kind', "flow_record_kind"), 'lifecycle', "jsonb_build_object"('value', "lifecycle", 'reason', "reason_lifecycle", 'deleted_reason', "reason_deleted", 'schedule_open', "schedule_open", 'timezone', "user_timezone", 'remaining_live_event_count', "remaining_live_event_count"), 'calendar', "jsonb_build_object"('calendar_id', "calendar_id", 'calendar_name', "calendar_name", 'calendar_is_personal', "calendar_is_personal", 'live_on_calendar', ("lifecycle" = 'active'::"text")), 'event_counts', "jsonb_build_object"('total', "total_event_count", 'live', "live_event_count", 'inactive', "inactive_event_count", 'completed', "completed_event_count", 'remaining', "remaining_event_count", 'remaining_live', "remaining_live_event_count"), 'share_sources', "jsonb_build_object"('shared_calendar', "is_shared_calendar_source", 'flow_share', "is_flow_share_source"), 'post_sources', "jsonb_build_object"('flow_post', "is_flow_post_source"), 'save_sources', "jsonb_build_object"('flow_saved', "is_flow_saved_source")) AS "filing_reasons"
   FROM "classified"
  WHERE ("lifecycle" <> 'deleted'::"text");


ALTER VIEW "public"."flow_filing_items_client" OWNER TO "postgres";


COMMENT ON VIEW "public"."flow_filing_items_client" IS 'Client-safe flow-level filing view. Lifecycle and counts are derived from user_event_filing_items_client so My Flows and profile accounting share calendar-live event rules.';



CREATE TABLE IF NOT EXISTS "public"."flow_generation_cache" (
    "id" bigint NOT NULL,
    "input_hash" "text" NOT NULL,
    "user_prompt" "text" NOT NULL,
    "response_json" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "snapshot_version" "text",
    "schema_version" "text",
    "policy_version" "text",
    "model_used" "text",
    "llm_status" "text",
    "prompt_fingerprint" "text"
);


ALTER TABLE "public"."flow_generation_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."flow_generation_cache" IS 'Cache of recent AI responses keyed by input_hash';



CREATE SEQUENCE IF NOT EXISTS "public"."flow_generation_cache_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."flow_generation_cache_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."flow_generation_cache_id_seq" OWNED BY "public"."flow_generation_cache"."id";



CREATE TABLE IF NOT EXISTS "public"."flow_generation_logs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" bigint,
    "input_hash" "text" NOT NULL,
    "user_prompt_raw" "text" NOT NULL,
    "model_used" "text",
    "tokens_in" integer DEFAULT 0,
    "tokens_out" integer DEFAULT 0,
    "cost_cents" integer DEFAULT 0,
    "duration_ms" integer DEFAULT 0,
    "llm_status" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "generation_id" "uuid",
    "schema_version" "text",
    "policy_version" "text",
    "range_start" "date",
    "range_end" "date",
    "snapshot_version" "text",
    "prompt_fingerprint" "text",
    "served_from_cache" boolean DEFAULT false NOT NULL,
    "constraints_json" "jsonb",
    "state_snapshot" "jsonb",
    "dm_policy_version" "text",
    "context_summary" "text",
    "input_meta" "jsonb"
);


ALTER TABLE "public"."flow_generation_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."flow_generation_logs" IS 'Logs of AI flow generations (tokens, cost, status, timings)';



CREATE OR REPLACE VIEW "public"."flow_generation_daily_analytics" AS
 SELECT (("date_trunc"('day'::"text", "created_at") AT TIME ZONE 'UTC'::"text"))::"date" AS "day",
    "count"(*) FILTER (WHERE ("llm_status" IS NOT NULL)) AS "total_generations",
    "count"(*) FILTER (WHERE ("llm_status" = 'cache_hit'::"text")) AS "cache_hits",
    "count"(*) FILTER (WHERE ("llm_status" = 'escalated_to_sonnet'::"text")) AS "escalations_to_sonnet",
    COALESCE("sum"("cost_cents"), (0)::bigint) AS "total_cost_cents",
    COALESCE("avg"("duration_ms"), (0)::numeric) AS "avg_duration_ms"
   FROM "public"."flow_generation_logs"
  GROUP BY ("date_trunc"('day'::"text", "created_at"))
  ORDER BY ((("date_trunc"('day'::"text", "created_at") AT TIME ZONE 'UTC'::"text"))::"date") DESC;


ALTER VIEW "public"."flow_generation_daily_analytics" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."flow_generation_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."flow_generation_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."flow_generation_logs_id_seq" OWNED BY "public"."flow_generation_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."flow_insert_blocklist" (
    "sub" "uuid",
    "role" "text",
    "ip" "inet",
    CONSTRAINT "flow_insert_blocklist_any" CHECK ((("sub" IS NOT NULL) OR ("role" IS NOT NULL) OR ("ip" IS NOT NULL)))
);


ALTER TABLE "public"."flow_insert_blocklist" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flow_insert_debug" (
    "id" bigint NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip" "inet",
    "claims" "jsonb",
    "sub" "uuid",
    "role" "text",
    "new_row" "jsonb"
);


ALTER TABLE "public"."flow_insert_debug" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."flow_insert_debug_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."flow_insert_debug_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."flow_insert_debug_id_seq" OWNED BY "public"."flow_insert_debug"."id";



CREATE TABLE IF NOT EXISTS "public"."flow_insert_guard_flag" (
    "id" boolean DEFAULT true NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."flow_insert_guard_flag" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flow_outcomes" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" bigint NOT NULL,
    "window_start" "date",
    "window_end" "date",
    "events_total" integer,
    "events_completed" integer,
    "edit_count" integer,
    "accepted_as_is" boolean,
    "feedback_tags" "text"[],
    "user_rating" smallint,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb"
);


ALTER TABLE "public"."flow_outcomes" OWNER TO "postgres";


ALTER TABLE "public"."flow_outcomes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."flow_outcomes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."flow_post_comment_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."flow_post_comment_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flow_post_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "flow_post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "parent_comment_id" "uuid",
    CONSTRAINT "flow_post_comments_body_length" CHECK (("char_length"("body") <= 150))
);


ALTER TABLE "public"."flow_post_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flow_post_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "flow_post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."flow_post_likes" OWNER TO "postgres";


ALTER TABLE "public"."flow_saves" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."flow_saves_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."flows_color_debug" AS
 SELECT "id",
    "name",
    "color" AS "color_int",
    ('#'::"text" || "lpad"("to_hex"("color"), 6, '0'::"text")) AS "color_hex",
    "created_at",
    "updated_at"
   FROM "public"."flows" "f";


ALTER VIEW "public"."flows_color_debug" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."flows_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."flows_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."flows_id_seq" OWNED BY "public"."flows"."id";



CREATE OR REPLACE VIEW "public"."flows_with_calendars" WITH ("security_invoker"='true') AS
 SELECT "f"."id",
    "f"."user_id",
    "f"."calendar_id",
    "sc"."name" AS "calendar_name",
    "sc"."color" AS "calendar_color",
    "sc"."is_personal" AS "calendar_is_personal",
    "f"."name",
    "f"."color",
    "f"."active",
    "f"."is_saved",
    "f"."start_date",
    "f"."end_date",
    "f"."notes",
    "f"."rules",
    "f"."ai_metadata",
    "f"."is_hidden",
    "f"."share_id",
    "f"."created_at",
    "f"."updated_at",
    "f"."is_reminder",
    "f"."reminder_uuid",
    "f"."origin_type",
    "f"."origin_flow_id",
    "f"."origin_share_id",
    "f"."origin_generation_id",
    "f"."root_flow_id"
   FROM ("public"."flows" "f"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "f"."calendar_id")))
  WHERE (("sc"."deleted_at" IS NULL) AND (EXISTS ( SELECT 1
           FROM "public"."shared_calendar_members" "scm"
          WHERE (("scm"."calendar_id" = "f"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text")))));


ALTER VIEW "public"."flows_with_calendars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."follows" (
    "follower_id" "uuid" NOT NULL,
    "followee_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "follows_no_self" CHECK (("follower_id" <> "followee_id"))
);


ALTER TABLE "public"."follows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "timezone" "text" DEFAULT 'America/Los_Angeles'::"text" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "handle" "text",
    "display_name" "text",
    "avatar_url" "text",
    "bio" "text",
    "location" "text",
    "is_discoverable" boolean DEFAULT true,
    "allow_incoming_shares" boolean DEFAULT true,
    "telemetry_enabled" boolean DEFAULT true NOT NULL,
    "personalization_enabled" boolean DEFAULT true NOT NULL,
    "onboarding_completed_at" timestamp with time zone,
    "avatar_glyphs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "handle_format" CHECK (("handle" ~ '^[a-zA-Z0-9_]+$'::"text")),
    CONSTRAINT "handle_length" CHECK ((("char_length"("handle") >= 3) AND ("char_length"("handle") <= 30))),
    CONSTRAINT "profiles_avatar_glyphs_is_array" CHECK (("jsonb_typeof"("avatar_glyphs") = 'array'::"text"))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."timezone" IS 'IANA timezone used for local scheduling of reminders and decan reflections.';



COMMENT ON COLUMN "public"."profiles"."email" IS 'user email';



COMMENT ON COLUMN "public"."profiles"."created_at" IS 'row created time (UTC)';



COMMENT ON COLUMN "public"."profiles"."updated_at" IS 'row last update time (UTC)';



COMMENT ON COLUMN "public"."profiles"."telemetry_enabled" IS 'When false, client should not send app_events (edits, feedback, etc.). Completions and product behavior unchanged.';



COMMENT ON COLUMN "public"."profiles"."personalization_enabled" IS 'When false, do not compute/store flow_outcomes for this user and do not fetch outcome vectors in ai_generate_flow.';



COMMENT ON COLUMN "public"."profiles"."onboarding_completed_at" IS 'Timestamp when the user finished onboarding (v1).';



CREATE OR REPLACE VIEW "public"."inbox_share_items" AS
 SELECT 'flow'::"text" AS "kind",
    "fs"."id" AS "share_id",
    "fs"."recipient_id",
    "fs"."sender_id",
    "fs"."created_at",
    "fs"."viewed_at",
    "fs"."imported_at",
    ("fs"."flow_id")::"text" AS "payload_id",
    "f"."name" AS "title",
    "p"."handle" AS "sender_handle",
    "p"."display_name" AS "sender_name",
    "p"."avatar_url" AS "sender_avatar",
    "fs"."suggested_schedule",
    NULL::timestamp with time zone AS "event_date",
    "jsonb_build_object"('name', "f"."name", 'rules', "f"."rules", 'notes', "f"."notes", 'color', "f"."color") AS "payload_json"
   FROM (("public"."flow_shares" "fs"
     JOIN "public"."flows" "f" ON (("f"."id" = "fs"."flow_id")))
     JOIN "public"."profiles" "p" ON (("p"."id" = "fs"."sender_id")))
  WHERE (("fs"."recipient_id" IS NOT NULL) AND ("fs"."deleted_at" IS NULL) AND ("fs"."recipient_id" = ( SELECT "auth"."uid"() AS "uid")))
UNION ALL
 SELECT 'event'::"text" AS "kind",
    "es"."id" AS "share_id",
    "es"."recipient_id",
    "es"."sender_id",
    "es"."created_at",
    "es"."viewed_at",
    "es"."imported_at",
    ("es"."event_id")::"text" AS "payload_id",
    "ue"."title",
    "p"."handle" AS "sender_handle",
    "p"."display_name" AS "sender_name",
    "p"."avatar_url" AS "sender_avatar",
    NULL::"jsonb" AS "suggested_schedule",
    "ue"."starts_at" AS "event_date",
    "jsonb_build_object"('title', "ue"."title", 'detail', "ue"."detail", 'location', "ue"."location", 'starts_at', "ue"."starts_at", 'ends_at', "ue"."ends_at") AS "payload_json"
   FROM (("public"."event_shares" "es"
     JOIN "public"."user_events" "ue" ON (("ue"."id" = "es"."event_id")))
     JOIN "public"."profiles" "p" ON (("p"."id" = "es"."sender_id")))
  WHERE (("es"."recipient_id" IS NOT NULL) AND ("es"."recipient_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("es"."deleted_at" IS NULL));


ALTER VIEW "public"."inbox_share_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shared_calendar_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "calendar_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "payload_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "viewed_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shared_calendar_notifications_kind_check" CHECK (("kind" = ANY (ARRAY['calendar_invite'::"text", 'calendar_event'::"text"])))
);


ALTER TABLE "public"."shared_calendar_notifications" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."inbox_share_items_filtered" WITH ("security_invoker"='true') AS
 SELECT ("fs"."id")::"text" AS "share_id",
    'flow'::"text" AS "kind",
    "fs"."recipient_id",
    "fs"."sender_id",
    "s"."handle" AS "sender_handle",
    "s"."display_name" AS "sender_name",
    "s"."avatar_url" AS "sender_avatar",
    "r"."handle" AS "recipient_handle",
    "r"."display_name" AS "recipient_display_name",
    "r"."avatar_url" AS "recipient_avatar_url",
    ("fs"."id")::"text" AS "payload_id",
    COALESCE(("fs"."payload_json" ->> 'name'::"text"), ''::"text") AS "title",
    ("fs"."flow_id")::"text" AS "original_flow_id",
    "fs"."created_at",
    "fs"."viewed_at",
    "fs"."imported_at",
    "fs"."deleted_at",
    "fs"."suggested_schedule",
    NULL::"text" AS "event_date",
    "fs"."payload_json",
    NULL::"text" AS "response_status",
    NULL::timestamp with time zone AS "responded_at"
   FROM (("public"."flow_shares" "fs"
     LEFT JOIN "public"."profiles" "s" ON (("fs"."sender_id" = "s"."id")))
     LEFT JOIN "public"."profiles" "r" ON (("fs"."recipient_id" = "r"."id")))
  WHERE (("fs"."recipient_id" IS NOT NULL) AND ("fs"."status" = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text"])) AND ("fs"."deleted_at" IS NULL))
UNION ALL
 SELECT ("es"."id")::"text" AS "share_id",
    'event'::"text" AS "kind",
    "es"."recipient_id",
    "es"."sender_id",
    "s"."handle" AS "sender_handle",
    "s"."display_name" AS "sender_name",
    "s"."avatar_url" AS "sender_avatar",
    "r"."handle" AS "recipient_handle",
    "r"."display_name" AS "recipient_display_name",
    "r"."avatar_url" AS "recipient_avatar_url",
    ("es"."id")::"text" AS "payload_id",
    COALESCE(("es"."payload_json" ->> 'title'::"text"), ("es"."payload_json" ->> 'name'::"text"), ''::"text") AS "title",
    NULL::"text" AS "original_flow_id",
    "es"."created_at",
    "es"."viewed_at",
    "es"."imported_at",
    "es"."deleted_at",
    NULL::"jsonb" AS "suggested_schedule",
    ("es"."payload_json" ->> 'starts_at'::"text") AS "event_date",
    "es"."payload_json",
    "es"."response_status",
    "es"."responded_at"
   FROM (("public"."event_shares" "es"
     LEFT JOIN "public"."profiles" "s" ON (("es"."sender_id" = "s"."id")))
     LEFT JOIN "public"."profiles" "r" ON (("es"."recipient_id" = "r"."id")))
  WHERE (("es"."recipient_id" IS NOT NULL) AND ("es"."status" = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text"])) AND ("es"."deleted_at" IS NULL))
UNION ALL
 SELECT ("scn"."id")::"text" AS "share_id",
    'calendar'::"text" AS "kind",
    "scn"."recipient_id",
    "scn"."actor_id" AS "sender_id",
    "s"."handle" AS "sender_handle",
    "s"."display_name" AS "sender_name",
    "s"."avatar_url" AS "sender_avatar",
    "r"."handle" AS "recipient_handle",
    "r"."display_name" AS "recipient_display_name",
    "r"."avatar_url" AS "recipient_avatar_url",
    ("scn"."calendar_id")::"text" AS "payload_id",
    COALESCE(NULLIF("btrim"("scn"."title"), ''::"text"), 'Calendar update'::"text") AS "title",
    NULL::"text" AS "original_flow_id",
    "scn"."created_at",
    "scn"."viewed_at",
    NULL::timestamp with time zone AS "imported_at",
    "scn"."deleted_at",
    NULL::"jsonb" AS "suggested_schedule",
    ("scn"."payload_json" ->> 'starts_at'::"text") AS "event_date",
    (COALESCE("scn"."payload_json", '{}'::"jsonb") || "jsonb_build_object"('notification_kind', COALESCE(NULLIF("btrim"(COALESCE(("scn"."payload_json" ->> 'notification_kind'::"text"), ("scn"."payload_json" ->> 'calendar_kind'::"text"), "scn"."kind")), ''::"text"), "scn"."kind"), 'calendar_id', ("scn"."calendar_id")::"text", 'body', "scn"."body")) AS "payload_json",
    NULL::"text" AS "response_status",
    NULL::timestamp with time zone AS "responded_at"
   FROM (("public"."shared_calendar_notifications" "scn"
     LEFT JOIN "public"."profiles" "s" ON (("scn"."actor_id" = "s"."id")))
     LEFT JOIN "public"."profiles" "r" ON (("scn"."recipient_id" = "r"."id")))
  WHERE ("scn"."deleted_at" IS NULL);


ALTER VIEW "public"."inbox_share_items_filtered" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."inbox_unread_count_filtered" WITH ("security_invoker"='true') AS
 SELECT "count"(*) AS "count"
   FROM "public"."inbox_share_items_filtered"
  WHERE (("viewed_at" IS NULL) AND ("deleted_at" IS NULL));


ALTER VIEW "public"."inbox_unread_count_filtered" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."insight_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "source_range_start" integer,
    "source_range_end" integer,
    "source_selected_text" "text",
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "insight_links_source_type_check" CHECK (("source_type" = ANY (ARRAY['node_user_text'::"text", 'journal_entry'::"text", 'reflection_entry'::"text"]))),
    CONSTRAINT "insight_links_target_type_check" CHECK (("target_type" = ANY (ARRAY['node'::"text", 'journal_entry'::"text", 'reflection_entry'::"text"])))
);


ALTER TABLE "public"."insight_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."insight_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "insight_entry_id" "uuid" NOT NULL,
    "node_id" "uuid" NOT NULL,
    "body_text" "text" NOT NULL,
    "entry_date" "date" NOT NULL,
    "is_hidden" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "insight_posts_body_length" CHECK (("char_length"("body_text") <= 12000))
);


ALTER TABLE "public"."insight_posts" OWNER TO "postgres";


COMMENT ON TABLE "public"."insight_posts" IS 'Snapshot posts created from node insight entries for profile/feed display.';



CREATE TABLE IF NOT EXISTS "public"."journal_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entry_id" "uuid",
    "badge_id" "text",
    "title" "text",
    "details" "text",
    "tags" "text"[],
    "occurred_on" "date" NOT NULL,
    "occurred_at" timestamp with time zone,
    "flow_id" bigint,
    "event_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."journal_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journal_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "greg_date" "date" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "entry_type" "text" DEFAULT 'freeform'::"text" NOT NULL,
    "event_id" "uuid",
    "flow_id" bigint,
    "category" "text"
);


ALTER TABLE "public"."journal_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."journal_entries" IS 'Daily journal entries with one entry per user per local date';



CREATE TABLE IF NOT EXISTS "public"."medu_decision_matrix" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "dict_id" "uuid",
    "english_concept" "text" NOT NULL,
    "success_score" real DEFAULT 0.5,
    "last_used" timestamp with time zone DEFAULT "now"(),
    "concept" "text",
    "dictionary_id" "uuid",
    "weight" numeric DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."medu_decision_matrix" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medu_dictionary" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "gardiner_code" "text" NOT NULL,
    "unicode_char" "text",
    "transliteration" "text",
    "english_glosses" "text"[] NOT NULL,
    "semantic_tags" "text"[],
    "is_visual_anchor" boolean DEFAULT false,
    "is_logogram" boolean DEFAULT false,
    "unicode" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "key" "text",
    "primary_gloss" "text",
    "anchor_type" "text",
    "imageability_score" integer,
    "phonetic_flexibility_score" integer,
    "mnemonic_aliases" "text"[],
    "render_mode" "text",
    "image_asset_key" "text",
    "image_prompt" "text",
    "visual_description" "text",
    "source_confidence" "text",
    "glyph" "text"
);


ALTER TABLE "public"."medu_dictionary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medu_kg_edges" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "source_concept" "text" NOT NULL,
    "target_dict_id" "uuid",
    "relationship_type" "text" NOT NULL,
    "weight" real DEFAULT 1.0,
    "target_dictionary_id" "uuid",
    "relation_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."medu_kg_edges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memory_nodes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "original_text" "text" NOT NULL,
    "sign_sequence" "jsonb" NOT NULL,
    "next_review_at" timestamp with time zone DEFAULT "now"(),
    "source_text" "text",
    "sequence_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."memory_nodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."node_insight_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "node_id" "uuid" NOT NULL,
    "body_text" "text" DEFAULT ''::"text" NOT NULL,
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "node_insight_entries_body_length" CHECK (("char_length"("body_text") <= 12000))
);


ALTER TABLE "public"."node_insight_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."node_insight_entries" IS 'Dated user-authored insight entries attached to a Kemetic node. Replaces the single-note-per-node model for UI editing while preserving node_user_content for graph aggregation.';



CREATE TABLE IF NOT EXISTS "public"."node_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_node_id" "uuid" NOT NULL,
    "target_node_id" "uuid" NOT NULL,
    "link_phrase" "text",
    "link_type" "text" DEFAULT 'embedded_text'::"text" NOT NULL,
    "weight" numeric DEFAULT 1.0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "node_links_link_type_check" CHECK (("link_type" = ANY (ARRAY['embedded_text'::"text", 'thematic'::"text", 'structural'::"text", 'supports'::"text", 'opposes'::"text", 'restores'::"text", 'measures'::"text", 'contains'::"text", 'signals'::"text", 'associated_with'::"text"])))
);


ALTER TABLE "public"."node_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."node_user_content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "node_id" "uuid" NOT NULL,
    "plain_text" "text" DEFAULT ''::"text" NOT NULL,
    "rich_text_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."node_user_content" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "glyph" "text",
    "body_text" "text" NOT NULL,
    "aliases" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "node_type" "text" NOT NULL,
    "is_system_owned" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_key" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nodes_node_type_check" CHECK (("node_type" = ANY (ARRAY['netjer'::"text", 'animal'::"text", 'cosmic'::"text", 'earth'::"text", 'metaphysical'::"text", 'builder'::"text"])))
);


ALTER TABLE "public"."nodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nutrition_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nutrient" "text" NOT NULL,
    "source" "text",
    "purpose" "text",
    "mode" "text" NOT NULL,
    "days_of_week" integer[],
    "decan_days" integer[],
    "repeat" boolean DEFAULT true NOT NULL,
    "time_h" integer NOT NULL,
    "time_m" integer NOT NULL,
    "alert_offset_minutes" integer,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_nutrition_items_one_empty" CHECK (((COALESCE("cardinality"("days_of_week"), 0) = 0) OR (COALESCE("cardinality"("decan_days"), 0) = 0))),
    CONSTRAINT "ck_time_h" CHECK ((("time_h" >= 0) AND ("time_h" <= 23))),
    CONSTRAINT "ck_time_m" CHECK ((("time_m" >= 0) AND ("time_m" <= 59))),
    CONSTRAINT "nutrition_items_days_of_week_ck" CHECK ((("days_of_week" IS NULL) OR ("days_of_week" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]))),
    CONSTRAINT "nutrition_items_decan_days_ck" CHECK ((("decan_days" IS NULL) OR ("decan_days" <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))),
    CONSTRAINT "nutrition_items_mode_check" CHECK (("mode" = ANY (ARRAY['weekday'::"text", 'decan'::"text"]))),
    CONSTRAINT "nutrition_items_mode_consistency" CHECK (((("mode" = 'weekday'::"text") AND (COALESCE("cardinality"("decan_days"), 0) = 0)) OR (("mode" = 'decan'::"text") AND (COALESCE("cardinality"("days_of_week"), 0) = 0)) OR ((COALESCE("cardinality"("days_of_week"), 0) = 0) AND (COALESCE("cardinality"("decan_days"), 0) = 0)))),
    CONSTRAINT "nutrition_items_not_both_ck" CHECK ((NOT ((COALESCE("cardinality"("days_of_week"), 0) > 0) AND (COALESCE("cardinality"("decan_days"), 0) > 0))))
);


ALTER TABLE "public"."nutrition_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."nutrition_items"."mode" IS 'Use values: ''weekday'' or ''decan'' (text)';



COMMENT ON COLUMN "public"."nutrition_items"."days_of_week" IS 'Allowed subset of 1..7 (Mon..Sun); empty/NULL permitted';



COMMENT ON COLUMN "public"."nutrition_items"."decan_days" IS 'Allowed subset of 1..10 (Decan day within period); empty/NULL permitted';



CREATE OR REPLACE VIEW "public"."profile_stats" AS
 SELECT "p"."id",
    "p"."handle",
    "p"."display_name",
    "p"."avatar_url",
    "p"."bio",
    "p"."location",
    "p"."is_discoverable",
    "p"."allow_incoming_shares",
    "p"."created_at",
    "p"."updated_at",
    COALESCE("flow_counts"."active_flows_count", (0)::bigint) AS "active_flows_count",
    COALESCE("flow_counts"."total_flow_events_count", (0)::bigint) AS "total_flow_events_count",
    COALESCE("followers"."cnt", (0)::bigint) AS "followers_count",
    COALESCE("following"."cnt", (0)::bigint) AS "following_count",
    "p"."avatar_glyphs"
   FROM ((("public"."profiles" "p"
     LEFT JOIN LATERAL "public"."get_profile_flow_counts"("p"."id") "flow_counts"("active_flows_count", "total_flow_events_count") ON (true))
     LEFT JOIN LATERAL ( SELECT "count"(*) AS "cnt"
           FROM "public"."follows" "fo"
          WHERE ("fo"."followee_id" = "p"."id")) "followers" ON (true))
     LEFT JOIN LATERAL ( SELECT "count"(*) AS "cnt"
           FROM "public"."follows" "fo"
          WHERE ("fo"."follower_id" = "p"."id")) "following" ON (true));


ALTER VIEW "public"."profile_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_tokens" (
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "token" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"(),
    "is_active" boolean DEFAULT true NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_tokens_platform_check" CHECK (("platform" = ANY (ARRAY['android'::"text", 'ios'::"text", 'web_push'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."push_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."push_tokens" IS 'Stores FCM/APNs tokens per device; RLS restricts inserts/updates to owning user';



CREATE TABLE IF NOT EXISTS "public"."reflection_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "reflection_generation_id" "uuid" NOT NULL,
    "rating" integer,
    "feedback_tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reflection_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reflection_generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "period_type" "text" NOT NULL,
    "period_key" "text" NOT NULL,
    "anchor_nodes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "generated_text" "text" NOT NULL,
    "model_version" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reflection_generations_period_type_check" CHECK (("period_type" = ANY (ARRAY['daily'::"text", 'decan'::"text", 'monthly'::"text", 'manual'::"text", 'decan_opening'::"text", 'maat_nudge'::"text"])))
);


ALTER TABLE "public"."reflection_generations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reflection_profiles" (
    "user_id" "uuid" NOT NULL,
    "top_nodes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "top_edges" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "dominant_patterns" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "tension_pairs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "maat_score" numeric,
    "isfet_risk_score" numeric,
    "last_computed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reflection_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maat_user_baselines" (
    "user_id" "uuid" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stats" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."maat_user_baselines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maat_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "window_date" "date" NOT NULL,
    "decan_period_key" "text" NOT NULL,
    "window_start" "date" NOT NULL,
    "window_end" "date" NOT NULL,
    "dimensions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "score" integer DEFAULT 0 NOT NULL,
    "band" "text" NOT NULL,
    "reflection_move" "text" NOT NULL,
    "lead_axis" "text" NOT NULL,
    "correction_axes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "hard_gates" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "maat_snapshots_band_check" CHECK (("band" = ANY (ARRAY['maat'::"text", 'leaning_maat'::"text", 'mixed'::"text", 'leaning_isfet'::"text", 'isfet_patterned'::"text"]))),
    CONSTRAINT "maat_snapshots_reflection_move_check" CHECK (("reflection_move" = ANY (ARRAY['affirm'::"text", 'inquire'::"text", 'correct'::"text"])))
);


ALTER TABLE "public"."maat_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maat_guidance_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "decan_period_key" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer NOT NULL,
    "teaser_text" "text" NOT NULL,
    "body_text" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cta_type" "text" DEFAULT 'none'::"text" NOT NULL,
    "cta_ref" "text",
    "generation_id" "uuid",
    "trigger_reason" "text",
    "shown_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "acted_at" timestamp with time zone,
    "expired_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "maat_guidance_deliveries_cta_type_check" CHECK (("cta_type" = ANY (ARRAY['none'::"text", 'node'::"text", 'flow'::"text", 'flow_template'::"text", 'flow_personalized'::"text"]))),
    CONSTRAINT "maat_guidance_deliveries_kind_check" CHECK (("kind" = ANY (ARRAY['decan_opening'::"text", 'drift_nudge'::"text", 'strength_nudge'::"text"]))),
    CONSTRAINT "maat_guidance_deliveries_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'shown'::"text", 'dismissed'::"text", 'opened'::"text", 'acted'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."maat_guidance_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maat_flow_briefs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "decan_period_key" "text" NOT NULL,
    "delivery_id" "uuid",
    "brief_id" "text" NOT NULL,
    "policy_version" "text" DEFAULT 'maat_flow_brief_v1'::"text" NOT NULL,
    "brief" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "fingerprint" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "fallback_template_key" "text",
    "generated_at" timestamp with time zone,
    "generation_id" "uuid",
    "flow_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."maat_flow_briefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maat_corrections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "decan_period_key" "text" NOT NULL,
    "snapshot_id" "uuid",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "lead_axis" "text",
    "hard_gates" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "completed_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "maat_corrections_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'completed'::"text", 'dismissed'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."maat_corrections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maat_guidance_evaluations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "snapshot_id" "uuid",
    "decan_period_key" "text" NOT NULL,
    "window_date" "date" NOT NULL,
    "policy_version" "text" NOT NULL,
    "maturity_level" "text" NOT NULL,
    "shaping_fingerprint" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "decision" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "suppressed" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_delivery_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."maat_guidance_evaluations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maat_band_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "evaluation_id" "uuid",
    "snapshot_id" "uuid",
    "decan_period_key" "text" NOT NULL,
    "from_window_date" "date" NOT NULL,
    "to_window_date" "date" NOT NULL,
    "from_band" "text" NOT NULL,
    "to_band" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."maat_band_transitions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."scheduled_notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."scheduled_notifications_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."scheduled_notifications_id_seq" OWNED BY "public"."scheduled_notifications"."id";



CREATE OR REPLACE VIEW "public"."share_filing_items_client" WITH ("security_invoker"='true') AS
 WITH "flow_share_rows" AS (
         SELECT ("fs"."id")::"text" AS "share_id",
            'flow'::"text" AS "kind",
            "fs"."recipient_id",
            "fs"."sender_id",
            "s"."handle" AS "sender_handle",
            "s"."display_name" AS "sender_name",
            "s"."avatar_url" AS "sender_avatar",
            "r"."handle" AS "recipient_handle",
            "r"."display_name" AS "recipient_display_name",
            "r"."avatar_url" AS "recipient_avatar_url",
            ("fs"."id")::"text" AS "payload_id",
            COALESCE(("fs"."payload_json" ->> 'name'::"text"), ''::"text") AS "title",
            ("fs"."flow_id")::"text" AS "original_flow_id",
            "fs"."created_at",
            "fs"."viewed_at",
            "fs"."imported_at",
            "fs"."deleted_at",
            "fs"."suggested_schedule",
            NULL::"text" AS "event_date",
            "fs"."payload_json",
            NULL::"text" AS "response_status",
            NULL::timestamp with time zone AS "responded_at",
            "imported_flow"."id" AS "imported_flow_id",
            "imported_flow"."lifecycle" AS "imported_flow_lifecycle",
            "imported_flow"."visible_in_active_list" AS "imported_flow_visible_active",
            "imported_flow"."visible_in_saved_list" AS "imported_flow_visible_saved",
                CASE
                    WHEN ("fs"."sender_id" = "auth"."uid"()) THEN 'sent'::"text"
                    WHEN ("fs"."recipient_id" = "auth"."uid"()) THEN 'received'::"text"
                    ELSE 'other'::"text"
                END AS "filing_direction",
                CASE
                    WHEN ("fs"."deleted_at" IS NOT NULL) THEN 'deleted'::"text"
                    WHEN (("fs"."imported_at" IS NOT NULL) OR (COALESCE("fs"."status", 'pending'::"text") = 'imported'::"text")) THEN 'imported'::"text"
                    WHEN (("fs"."viewed_at" IS NOT NULL) OR (COALESCE("fs"."status", 'pending'::"text") = 'viewed'::"text")) THEN 'viewed'::"text"
                    ELSE 'pending'::"text"
                END AS "filing_lifecycle",
            'shared_flow'::"text" AS "filing_item_kind"
           FROM ((("public"."flow_shares" "fs"
             LEFT JOIN "public"."profiles" "s" ON (("fs"."sender_id" = "s"."id")))
             LEFT JOIN "public"."profiles" "r" ON (("fs"."recipient_id" = "r"."id")))
             LEFT JOIN LATERAL ( SELECT "iff"."id",
                    "iff"."lifecycle",
                    "iff"."visible_in_active_list",
                    "iff"."visible_in_saved_list",
                    "iff"."created_at"
                   FROM "public"."flow_filing_items_client" "iff"
                  WHERE (("iff"."share_id" = "fs"."id") AND ("iff"."user_id" = "auth"."uid"()))
                  ORDER BY "iff"."visible_in_active_list" DESC, "iff"."visible_in_saved_list" DESC, "iff"."created_at" DESC
                 LIMIT 1) "imported_flow" ON (true))
          WHERE (("fs"."recipient_id" IS NOT NULL) AND (("fs"."recipient_id" = "auth"."uid"()) OR ("fs"."sender_id" = "auth"."uid"())) AND ("fs"."status" = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"])))
        ), "event_share_rows" AS (
         SELECT ("es"."id")::"text" AS "share_id",
            'event'::"text" AS "kind",
            "es"."recipient_id",
            "es"."sender_id",
            "s"."handle" AS "sender_handle",
            "s"."display_name" AS "sender_name",
            "s"."avatar_url" AS "sender_avatar",
            "r"."handle" AS "recipient_handle",
            "r"."display_name" AS "recipient_display_name",
            "r"."avatar_url" AS "recipient_avatar_url",
            ("es"."id")::"text" AS "payload_id",
            COALESCE(("es"."payload_json" ->> 'title'::"text"), ("es"."payload_json" ->> 'name'::"text"), ''::"text") AS "title",
            NULL::"text" AS "original_flow_id",
            "es"."created_at",
            "es"."viewed_at",
            "es"."imported_at",
            "es"."deleted_at",
            NULL::"jsonb" AS "suggested_schedule",
            ("es"."payload_json" ->> 'starts_at'::"text") AS "event_date",
            "es"."payload_json",
            "es"."response_status",
            "es"."responded_at",
            NULL::bigint AS "imported_flow_id",
            NULL::"text" AS "imported_flow_lifecycle",
            false AS "imported_flow_visible_active",
            false AS "imported_flow_visible_saved",
                CASE
                    WHEN ("es"."sender_id" = "auth"."uid"()) THEN 'sent'::"text"
                    WHEN ("es"."recipient_id" = "auth"."uid"()) THEN 'received'::"text"
                    ELSE 'other'::"text"
                END AS "filing_direction",
                CASE
                    WHEN ("es"."deleted_at" IS NOT NULL) THEN 'deleted'::"text"
                    WHEN (COALESCE("es"."response_status", 'no_response'::"text") = 'accepted'::"text") THEN 'accepted'::"text"
                    WHEN (COALESCE("es"."response_status", 'no_response'::"text") = 'declined'::"text") THEN 'declined'::"text"
                    WHEN (COALESCE("es"."response_status", 'no_response'::"text") = 'maybe'::"text") THEN 'maybe'::"text"
                    ELSE 'pending'::"text"
                END AS "filing_lifecycle",
            'event_invite'::"text" AS "filing_item_kind"
           FROM (("public"."event_shares" "es"
             LEFT JOIN "public"."profiles" "s" ON (("es"."sender_id" = "s"."id")))
             LEFT JOIN "public"."profiles" "r" ON (("es"."recipient_id" = "r"."id")))
          WHERE (("es"."recipient_id" IS NOT NULL) AND (("es"."recipient_id" = "auth"."uid"()) OR ("es"."sender_id" = "auth"."uid"())) AND ("es"."status" = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'imported'::"text", 'public'::"text"])))
        ), "calendar_notification_rows" AS (
         SELECT ("scn"."id")::"text" AS "share_id",
            'calendar'::"text" AS "kind",
            "scn"."recipient_id",
            "scn"."actor_id" AS "sender_id",
            "s"."handle" AS "sender_handle",
            "s"."display_name" AS "sender_name",
            "s"."avatar_url" AS "sender_avatar",
            "r"."handle" AS "recipient_handle",
            "r"."display_name" AS "recipient_display_name",
            "r"."avatar_url" AS "recipient_avatar_url",
            ("scn"."calendar_id")::"text" AS "payload_id",
            COALESCE(NULLIF("btrim"("scn"."title"), ''::"text"), 'Calendar update'::"text") AS "title",
            NULL::"text" AS "original_flow_id",
            "scn"."created_at",
            "scn"."viewed_at",
            NULL::timestamp with time zone AS "imported_at",
            "scn"."deleted_at",
            NULL::"jsonb" AS "suggested_schedule",
            ("scn"."payload_json" ->> 'starts_at'::"text") AS "event_date",
            (COALESCE("scn"."payload_json", '{}'::"jsonb") || "jsonb_build_object"('notification_kind', COALESCE(NULLIF("btrim"(COALESCE(("scn"."payload_json" ->> 'notification_kind'::"text"), ("scn"."payload_json" ->> 'calendar_kind'::"text"), "scn"."kind")), ''::"text"), "scn"."kind"), 'calendar_id', ("scn"."calendar_id")::"text", 'body', "scn"."body")) AS "payload_json",
            NULL::"text" AS "response_status",
            NULL::timestamp with time zone AS "responded_at",
            NULL::bigint AS "imported_flow_id",
            NULL::"text" AS "imported_flow_lifecycle",
            false AS "imported_flow_visible_active",
            false AS "imported_flow_visible_saved",
            'received'::"text" AS "filing_direction",
                CASE
                    WHEN ("scn"."deleted_at" IS NOT NULL) THEN 'deleted'::"text"
                    WHEN ("scn"."viewed_at" IS NOT NULL) THEN 'viewed'::"text"
                    ELSE 'pending'::"text"
                END AS "filing_lifecycle",
                CASE
                    WHEN (COALESCE(NULLIF("btrim"(COALESCE(("scn"."payload_json" ->> 'notification_kind'::"text"), ("scn"."payload_json" ->> 'calendar_kind'::"text"), "scn"."kind")), ''::"text"), "scn"."kind") = 'calendar_invite_response'::"text") THEN 'calendar_invite_response'::"text"
                    WHEN ("scn"."kind" = 'calendar_invite'::"text") THEN 'calendar_invite'::"text"
                    ELSE 'calendar_update'::"text"
                END AS "filing_item_kind"
           FROM (("public"."shared_calendar_notifications" "scn"
             LEFT JOIN "public"."profiles" "s" ON (("scn"."actor_id" = "s"."id")))
             LEFT JOIN "public"."profiles" "r" ON (("scn"."recipient_id" = "r"."id")))
          WHERE ("scn"."recipient_id" = "auth"."uid"())
        ), "combined" AS (
         SELECT "flow_share_rows"."share_id",
            "flow_share_rows"."kind",
            "flow_share_rows"."recipient_id",
            "flow_share_rows"."sender_id",
            "flow_share_rows"."sender_handle",
            "flow_share_rows"."sender_name",
            "flow_share_rows"."sender_avatar",
            "flow_share_rows"."recipient_handle",
            "flow_share_rows"."recipient_display_name",
            "flow_share_rows"."recipient_avatar_url",
            "flow_share_rows"."payload_id",
            "flow_share_rows"."title",
            "flow_share_rows"."original_flow_id",
            "flow_share_rows"."created_at",
            "flow_share_rows"."viewed_at",
            "flow_share_rows"."imported_at",
            "flow_share_rows"."deleted_at",
            "flow_share_rows"."suggested_schedule",
            "flow_share_rows"."event_date",
            "flow_share_rows"."payload_json",
            "flow_share_rows"."response_status",
            "flow_share_rows"."responded_at",
            "flow_share_rows"."imported_flow_id",
            "flow_share_rows"."imported_flow_lifecycle",
            "flow_share_rows"."imported_flow_visible_active",
            "flow_share_rows"."imported_flow_visible_saved",
            "flow_share_rows"."filing_direction",
            "flow_share_rows"."filing_lifecycle",
            "flow_share_rows"."filing_item_kind"
           FROM "flow_share_rows"
        UNION ALL
         SELECT "event_share_rows"."share_id",
            "event_share_rows"."kind",
            "event_share_rows"."recipient_id",
            "event_share_rows"."sender_id",
            "event_share_rows"."sender_handle",
            "event_share_rows"."sender_name",
            "event_share_rows"."sender_avatar",
            "event_share_rows"."recipient_handle",
            "event_share_rows"."recipient_display_name",
            "event_share_rows"."recipient_avatar_url",
            "event_share_rows"."payload_id",
            "event_share_rows"."title",
            "event_share_rows"."original_flow_id",
            "event_share_rows"."created_at",
            "event_share_rows"."viewed_at",
            "event_share_rows"."imported_at",
            "event_share_rows"."deleted_at",
            "event_share_rows"."suggested_schedule",
            "event_share_rows"."event_date",
            "event_share_rows"."payload_json",
            "event_share_rows"."response_status",
            "event_share_rows"."responded_at",
            "event_share_rows"."imported_flow_id",
            "event_share_rows"."imported_flow_lifecycle",
            "event_share_rows"."imported_flow_visible_active",
            "event_share_rows"."imported_flow_visible_saved",
            "event_share_rows"."filing_direction",
            "event_share_rows"."filing_lifecycle",
            "event_share_rows"."filing_item_kind"
           FROM "event_share_rows"
        UNION ALL
         SELECT "calendar_notification_rows"."share_id",
            "calendar_notification_rows"."kind",
            "calendar_notification_rows"."recipient_id",
            "calendar_notification_rows"."sender_id",
            "calendar_notification_rows"."sender_handle",
            "calendar_notification_rows"."sender_name",
            "calendar_notification_rows"."sender_avatar",
            "calendar_notification_rows"."recipient_handle",
            "calendar_notification_rows"."recipient_display_name",
            "calendar_notification_rows"."recipient_avatar_url",
            "calendar_notification_rows"."payload_id",
            "calendar_notification_rows"."title",
            "calendar_notification_rows"."original_flow_id",
            "calendar_notification_rows"."created_at",
            "calendar_notification_rows"."viewed_at",
            "calendar_notification_rows"."imported_at",
            "calendar_notification_rows"."deleted_at",
            "calendar_notification_rows"."suggested_schedule",
            "calendar_notification_rows"."event_date",
            "calendar_notification_rows"."payload_json",
            "calendar_notification_rows"."response_status",
            "calendar_notification_rows"."responded_at",
            "calendar_notification_rows"."imported_flow_id",
            "calendar_notification_rows"."imported_flow_lifecycle",
            "calendar_notification_rows"."imported_flow_visible_active",
            "calendar_notification_rows"."imported_flow_visible_saved",
            "calendar_notification_rows"."filing_direction",
            "calendar_notification_rows"."filing_lifecycle",
            "calendar_notification_rows"."filing_item_kind"
           FROM "calendar_notification_rows"
        )
 SELECT "share_id",
    "kind",
    "recipient_id",
    "sender_id",
    "sender_handle",
    "sender_name",
    "sender_avatar",
    "recipient_handle",
    "recipient_display_name",
    "recipient_avatar_url",
    "payload_id",
    "title",
    "original_flow_id",
    "created_at",
    "viewed_at",
    "imported_at",
    "deleted_at",
    "suggested_schedule",
    "event_date",
    "payload_json",
    "response_status",
    "responded_at",
    "imported_flow_id",
    "imported_flow_lifecycle",
    "imported_flow_visible_active",
    "imported_flow_visible_saved",
    "filing_direction",
    "filing_lifecycle",
    "filing_item_kind",
    ("filing_lifecycle" <> 'deleted'::"text") AS "visible_in_inbox",
    ("filing_lifecycle" = 'pending'::"text") AS "is_pending",
    ("filing_item_kind" = ANY (ARRAY['event_invite'::"text", 'calendar_invite'::"text", 'calendar_invite_response'::"text"])) AS "is_invite",
    ("filing_item_kind" = 'shared_flow'::"text") AS "is_shared_flow",
    ("filing_item_kind" = ANY (ARRAY['calendar_invite'::"text", 'calendar_invite_response'::"text", 'calendar_update'::"text"])) AS "is_shared_calendar",
    COALESCE("imported_flow_visible_saved", false) AS "is_saved",
    "jsonb_build_object"('item_kind', "filing_item_kind", 'lifecycle', "filing_lifecycle", 'direction', "filing_direction", 'source', "kind", 'flow', "jsonb_build_object"('original_flow_id', "original_flow_id", 'imported_flow_id', "imported_flow_id", 'imported_lifecycle', "imported_flow_lifecycle", 'visible_active', "imported_flow_visible_active", 'visible_saved', "imported_flow_visible_saved")) AS "filing_reasons"
   FROM "combined"
  WHERE ("filing_lifecycle" <> 'deleted'::"text");


ALTER VIEW "public"."share_filing_items_client" OWNER TO "postgres";


COMMENT ON VIEW "public"."share_filing_items_client" IS 'Client-safe filing view for shared flows, event invites, calendar notifications, and invite responses. Deleted rows are filtered out at the API surface.';



CREATE TABLE IF NOT EXISTS "public"."share_short_links" (
    "id" "text" NOT NULL,
    "share_type" "text" NOT NULL,
    "share_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval) NOT NULL,
    "click_count" integer DEFAULT 0,
    "last_clicked_at" timestamp with time zone,
    CONSTRAINT "share_short_links_share_type_check" CHECK (("share_type" = ANY (ARRAY['flow'::"text", 'event'::"text"])))
);


ALTER TABLE "public"."share_short_links" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."shared_calendar_filing_items_client" WITH ("security_invoker"='true') AS
 WITH "calendar_event_counts" AS (
         SELECT "e"."calendar_id",
            "count"(*) AS "total_event_count",
            "count"(*) FILTER (WHERE "e"."live_on_calendar") AS "live_event_count",
            "count"(*) FILTER (WHERE ("e"."lifecycle" = 'inactive'::"text")) AS "inactive_event_count",
            "count"(DISTINCT "e"."filed_flow_id") FILTER (WHERE (("e"."filed_flow_id" IS NOT NULL) AND "e"."live_on_calendar")) AS "live_flow_count"
           FROM "public"."user_event_filing_items_client" "e"
          WHERE ("e"."calendar_id" IS NOT NULL)
          GROUP BY "e"."calendar_id"
        )
 SELECT "sc"."id",
    "sc"."owner_id",
    "sc"."name",
    "sc"."color",
    "sc"."icon",
    "sc"."is_personal",
    "sc"."created_at",
    "sc"."updated_at",
    "scm"."user_id" AS "member_user_id",
    "scm"."role",
    "scm"."status",
    "owner_profile"."handle" AS "owner_handle",
    "owner_profile"."display_name" AS "owner_display_name",
    ( SELECT ("count"(*))::integer AS "count"
           FROM "public"."shared_calendar_members" "inner_scm"
          WHERE (("inner_scm"."calendar_id" = "sc"."id") AND ("inner_scm"."status" = 'accepted'::"text"))) AS "member_count",
        CASE
            WHEN ("sc"."owner_id" = "auth"."uid"()) THEN ( SELECT ("count"(*))::integer AS "count"
               FROM "public"."shared_calendar_members" "inner_scm"
              WHERE (("inner_scm"."calendar_id" = "sc"."id") AND ("inner_scm"."status" = 'pending'::"text")))
            ELSE 0
        END AS "pending_invite_count",
    COALESCE("cec"."total_event_count", (0)::bigint) AS "total_event_count",
    COALESCE("cec"."live_event_count", (0)::bigint) AS "live_event_count",
    COALESCE("cec"."inactive_event_count", (0)::bigint) AS "inactive_event_count",
    COALESCE("cec"."live_flow_count", (0)::bigint) AS "live_flow_count",
    'shared_calendar'::"text" AS "item_kind",
        CASE
            WHEN ("sc"."deleted_at" IS NOT NULL) THEN 'deleted'::"text"
            WHEN ("scm"."status" = 'accepted'::"text") THEN 'active'::"text"
            ELSE "scm"."status"
        END AS "lifecycle",
    (("scm"."status" = 'accepted'::"text") AND ("sc"."deleted_at" IS NULL)) AS "live_on_calendar",
    ("sc"."is_personal" = false) AS "is_shared",
    "jsonb_build_object"('item_kind', 'shared_calendar', 'lifecycle',
        CASE
            WHEN ("sc"."deleted_at" IS NOT NULL) THEN 'deleted'::"text"
            WHEN ("scm"."status" = 'accepted'::"text") THEN 'active'::"text"
            ELSE "scm"."status"
        END, 'membership', "jsonb_build_object"('role', "scm"."role", 'status', "scm"."status", 'member_user_id', "scm"."user_id", 'owner_id', "sc"."owner_id"), 'event_counts', "jsonb_build_object"('total', COALESCE("cec"."total_event_count", (0)::bigint), 'live', COALESCE("cec"."live_event_count", (0)::bigint), 'inactive', COALESCE("cec"."inactive_event_count", (0)::bigint), 'live_flows', COALESCE("cec"."live_flow_count", (0)::bigint))) AS "filing_reasons"
   FROM ((("public"."shared_calendars" "sc"
     JOIN "public"."shared_calendar_members" "scm" ON (("scm"."calendar_id" = "sc"."id")))
     LEFT JOIN "public"."profiles" "owner_profile" ON (("owner_profile"."id" = "sc"."owner_id")))
     LEFT JOIN "calendar_event_counts" "cec" ON (("cec"."calendar_id" = "sc"."id")))
  WHERE (("sc"."deleted_at" IS NULL) AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text"));


ALTER VIEW "public"."shared_calendar_filing_items_client" OWNER TO "postgres";


COMMENT ON VIEW "public"."shared_calendar_filing_items_client" IS 'Client-safe filing view for accepted calendars. Pending invite counts are owner-only; event counts are derived from user_event_filing_items_client.';



CREATE OR REPLACE VIEW "public"."shared_calendar_invite_filing_items_client" WITH ("security_invoker"='true') AS
 SELECT "scm"."calendar_id",
    "sc"."name" AS "calendar_name",
    "sc"."color" AS "calendar_color",
    "sc"."icon" AS "calendar_icon",
    "sc"."owner_id",
    "scm"."user_id" AS "invitee_id",
    "invitee_profile"."handle" AS "invitee_handle",
    "invitee_profile"."display_name" AS "invitee_display_name",
    "invitee_profile"."avatar_url" AS "invitee_avatar_url",
    "scm"."role",
    "scm"."status",
    "scm"."created_at" AS "invited_at",
    "scm"."updated_at",
    "scm"."responded_at",
    "scm"."invited_by",
    "inviter_profile"."handle" AS "inviter_handle",
    "inviter_profile"."display_name" AS "inviter_display_name",
        CASE
            WHEN ("scm"."user_id" = "auth"."uid"()) THEN 'incoming'::"text"
            WHEN (("sc"."owner_id" = "auth"."uid"()) AND ("scm"."user_id" <> "auth"."uid"())) THEN 'sent'::"text"
            ELSE 'other'::"text"
        END AS "invite_direction",
    'calendar_invite'::"text" AS "item_kind",
    "scm"."status" AS "lifecycle",
    (("sc"."deleted_at" IS NULL) AND ("scm"."status" = 'pending'::"text")) AS "is_pending",
    "jsonb_build_object"('item_kind', 'calendar_invite', 'lifecycle', "scm"."status", 'direction',
        CASE
            WHEN ("scm"."user_id" = "auth"."uid"()) THEN 'incoming'::"text"
            WHEN (("sc"."owner_id" = "auth"."uid"()) AND ("scm"."user_id" <> "auth"."uid"())) THEN 'sent'::"text"
            ELSE 'other'::"text"
        END, 'calendar', "jsonb_build_object"('calendar_id', "sc"."id", 'calendar_name', "sc"."name", 'calendar_color', "sc"."color", 'owner_id', "sc"."owner_id"), 'membership', "jsonb_build_object"('role', "scm"."role", 'status', "scm"."status", 'invited_by', "scm"."invited_by", 'invitee_id', "scm"."user_id")) AS "filing_reasons"
   FROM ((("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
     LEFT JOIN "public"."profiles" "inviter_profile" ON (("inviter_profile"."id" = "scm"."invited_by")))
     LEFT JOIN "public"."profiles" "invitee_profile" ON (("invitee_profile"."id" = "scm"."user_id")))
  WHERE (("sc"."deleted_at" IS NULL) AND ("scm"."status" = 'pending'::"text") AND (("scm"."user_id" = "auth"."uid"()) OR (("sc"."owner_id" = "auth"."uid"()) AND ("scm"."user_id" <> "auth"."uid"()))));


ALTER VIEW "public"."shared_calendar_invite_filing_items_client" OWNER TO "postgres";


COMMENT ON VIEW "public"."shared_calendar_invite_filing_items_client" IS 'Client-safe filing view for pending shared calendar invites. Incoming rows are visible to invitees; sent rows are owner-only.';



CREATE OR REPLACE VIEW "public"."shared_calendar_pending_invites" WITH ("security_invoker"='true') AS
 SELECT "scm"."calendar_id",
    "sc"."name" AS "calendar_name",
    "sc"."color" AS "calendar_color",
    "sc"."icon" AS "calendar_icon",
    "sc"."owner_id",
    "scm"."role",
    "scm"."created_at" AS "invited_at",
    "scm"."invited_by",
    "inviter_profile"."handle" AS "inviter_handle",
    "inviter_profile"."display_name" AS "inviter_display_name"
   FROM (("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
     LEFT JOIN "public"."profiles" "inviter_profile" ON (("inviter_profile"."id" = "scm"."invited_by")))
  WHERE (("sc"."deleted_at" IS NULL) AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'pending'::"text"));


ALTER VIEW "public"."shared_calendar_pending_invites" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."shared_calendar_sent_pending_invites" WITH ("security_invoker"='true') AS
 SELECT "scm"."calendar_id",
    "sc"."name" AS "calendar_name",
    "sc"."color" AS "calendar_color",
    "sc"."icon" AS "calendar_icon",
    "sc"."owner_id",
    "scm"."user_id" AS "invitee_id",
    "invitee_profile"."handle" AS "invitee_handle",
    "invitee_profile"."display_name" AS "invitee_display_name",
    "invitee_profile"."avatar_url" AS "invitee_avatar_url",
    "scm"."role",
    "scm"."status",
    "scm"."created_at" AS "invited_at",
    "scm"."invited_by"
   FROM (("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
     LEFT JOIN "public"."profiles" "invitee_profile" ON (("invitee_profile"."id" = "scm"."user_id")))
  WHERE (("sc"."deleted_at" IS NULL) AND ("sc"."owner_id" = "auth"."uid"()) AND ("scm"."user_id" <> "auth"."uid"()) AND ("scm"."status" = 'pending'::"text"));


ALTER VIEW "public"."shared_calendar_sent_pending_invites" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."shared_calendar_summaries" WITH ("security_invoker"='true') AS
 SELECT "sc"."id",
    "sc"."owner_id",
    "sc"."name",
    "sc"."color",
    "sc"."icon",
    "sc"."is_personal",
    "sc"."created_at",
    "sc"."updated_at",
    "scm"."user_id" AS "member_user_id",
    "scm"."role",
    "scm"."status",
    "owner_profile"."handle" AS "owner_handle",
    "owner_profile"."display_name" AS "owner_display_name",
    ( SELECT ("count"(*))::integer AS "count"
           FROM "public"."shared_calendar_members" "inner_scm"
          WHERE (("inner_scm"."calendar_id" = "sc"."id") AND ("inner_scm"."status" = 'accepted'::"text"))) AS "member_count",
        CASE
            WHEN ("sc"."owner_id" = "auth"."uid"()) THEN ( SELECT ("count"(*))::integer AS "count"
               FROM "public"."shared_calendar_members" "inner_scm"
              WHERE (("inner_scm"."calendar_id" = "sc"."id") AND ("inner_scm"."status" = 'pending'::"text")))
            ELSE 0
        END AS "pending_invite_count"
   FROM (("public"."shared_calendars" "sc"
     JOIN "public"."shared_calendar_members" "scm" ON (("scm"."calendar_id" = "sc"."id")))
     LEFT JOIN "public"."profiles" "owner_profile" ON (("owner_profile"."id" = "sc"."owner_id")))
  WHERE (("sc"."deleted_at" IS NULL) AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text"));


ALTER VIEW "public"."shared_calendar_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "due_date" "date",
    "due_time" time without time zone,
    "priority" smallint,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "recurrence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "show_on_checklist" boolean DEFAULT true NOT NULL,
    "show_on_calendar" boolean DEFAULT true NOT NULL,
    "linked_field_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "todos_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'done'::"text", 'skipped'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."todos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ukg_user_preferences" (
    "user_id" "uuid" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "window_days" integer DEFAULT 90 NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "prefs_version" "text" DEFAULT 'prefs_v1'::"text" NOT NULL,
    "prefs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ukg_user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_ai_usage" (
    "user_id" "uuid" NOT NULL,
    "day" "date" NOT NULL,
    "count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."user_ai_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_app_restoration_snapshots" (
    "user_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "device_id" "text" DEFAULT ''::"text" NOT NULL,
    "window_id" "text" DEFAULT ''::"text" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "schema_version" integer NOT NULL,
    "route_location" "text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "user_app_restoration_snapshots_scope_check" CHECK (("scope" = ANY (ARRAY['window'::"text", 'latest'::"text"]))),
    CONSTRAINT "user_app_restoration_snapshots_snapshot_object_check" CHECK (("jsonb_typeof"("snapshot") = 'object'::"text"))
);


ALTER TABLE "public"."user_app_restoration_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_choice_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "node_id" "uuid",
    "flow_id" "uuid",
    "journal_entry_id" "uuid",
    "reflection_entry_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_choice_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['node_opened'::"text", 'node_link_tapped'::"text", 'node_insight_saved'::"text", 'journal_linked_to_node'::"text", 'reflection_linked_to_node'::"text", 'node_linked_to_journal'::"text", 'node_linked_to_reflection'::"text", 'flow_completed'::"text", 'flow_skipped'::"text", 'reflection_opened'::"text", 'reflection_saved'::"text", 'reflection_rated'::"text", 'cycle_field_saved'::"text", 'checklist_completed'::"text", 'checklist_partial'::"text", 'checklist_skipped'::"text", 'todo_created'::"text", 'todo_completed'::"text", 'suggestion_accepted'::"text", 'suggestion_dismissed'::"text", 'suggestion_snoozed'::"text", 'maat_correction_opened'::"text", 'maat_correction_recovered'::"text", 'maat_correction_completed'::"text", 'maat_correction_dismissed'::"text"])))
);


ALTER TABLE "public"."user_choice_events" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."maat_guidance_drift_outcomes" WITH ("security_invoker"='true') AS
 WITH "acted" AS (
         SELECT "e"."id" AS "suggestion_event_id",
            "e"."user_id",
            "e"."created_at" AS "acted_at",
            ("e"."created_at")::"date" AS "acted_date",
            "d"."id" AS "delivery_id",
            "d"."decan_period_key",
            "d"."cta_type",
            "d"."cta_ref"
           FROM ("public"."user_choice_events" "e"
             JOIN "public"."maat_guidance_deliveries" "d" ON ((("d"."id")::"text" = ("e"."metadata" ->> 'delivery_id'::"text"))))
          WHERE (("e"."event_type" = 'suggestion_accepted'::"text") AND ("d"."kind" = 'drift_nudge'::"text"))
        ), "nutrition" AS (
         SELECT "jb"."user_id",
            ("jb"."occurred_on")::"date" AS "occurred_on",
                CASE
                    WHEN ('state:done'::"text" = ANY (COALESCE("jb"."tags", '{}'::"text"[]))) THEN 1
                    ELSE 0
                END AS "done_count",
                CASE
                    WHEN ('state:skipped'::"text" = ANY (COALESCE("jb"."tags", '{}'::"text"[]))) THEN 1
                    ELSE 0
                END AS "skipped_count"
           FROM "public"."journal_badges" "jb"
          WHERE ('kind:nutrition'::"text" = ANY (COALESCE("jb"."tags", '{}'::"text"[])))
        ), "aggregated" AS (
         SELECT "a"."suggestion_event_id",
            "a"."user_id",
            "a"."acted_at",
            "a"."acted_date",
            "a"."delivery_id",
            "a"."decan_period_key",
            "a"."cta_type",
            "a"."cta_ref",
            count("n"."occurred_on") FILTER (WHERE (("n"."occurred_on" >= ("a"."acted_date" - 7)) AND ("n"."occurred_on" < "a"."acted_date"))) AS "pre_nutrition_count",
            COALESCE(sum("n"."done_count") FILTER (WHERE (("n"."occurred_on" >= ("a"."acted_date" - 7)) AND ("n"."occurred_on" < "a"."acted_date"))), (0)::bigint) AS "pre_done_count",
            COALESCE(sum("n"."skipped_count") FILTER (WHERE (("n"."occurred_on" >= ("a"."acted_date" - 7)) AND ("n"."occurred_on" < "a"."acted_date"))), (0)::bigint) AS "pre_skipped_count",
            count("n"."occurred_on") FILTER (WHERE (("n"."occurred_on" > "a"."acted_date") AND ("n"."occurred_on" <= ("a"."acted_date" + 7)))) AS "post_nutrition_count",
            COALESCE(sum("n"."done_count") FILTER (WHERE (("n"."occurred_on" > "a"."acted_date") AND ("n"."occurred_on" <= ("a"."acted_date" + 7)))), (0)::bigint) AS "post_done_count",
            COALESCE(sum("n"."skipped_count") FILTER (WHERE (("n"."occurred_on" > "a"."acted_date") AND ("n"."occurred_on" <= ("a"."acted_date" + 7)))), (0)::bigint) AS "post_skipped_count"
           FROM ("acted" "a"
             LEFT JOIN "nutrition" "n" ON ((("n"."user_id" = "a"."user_id") AND ("n"."occurred_on" >= ("a"."acted_date" - 7)) AND ("n"."occurred_on" <= ("a"."acted_date" + 7)))))
          GROUP BY "a"."suggestion_event_id", "a"."user_id", "a"."acted_at", "a"."acted_date", "a"."delivery_id", "a"."decan_period_key", "a"."cta_type", "a"."cta_ref"
        )
 SELECT "suggestion_event_id",
    "user_id",
    "acted_at",
    "delivery_id",
    "decan_period_key",
    "cta_type",
    "cta_ref",
    "pre_nutrition_count",
    "pre_done_count",
    "pre_skipped_count",
        CASE
            WHEN ("pre_nutrition_count" = 0) THEN NULL::numeric
            ELSE "round"((("pre_done_count")::numeric / ("pre_nutrition_count")::numeric), 4)
        END AS "pre_done_rate",
        CASE
            WHEN ("pre_nutrition_count" = 0) THEN NULL::numeric
            ELSE "round"((("pre_skipped_count")::numeric / ("pre_nutrition_count")::numeric), 4)
        END AS "pre_skipped_rate",
    "post_nutrition_count",
    "post_done_count",
    "post_skipped_count",
        CASE
            WHEN ("post_nutrition_count" = 0) THEN NULL::numeric
            ELSE "round"((("post_done_count")::numeric / ("post_nutrition_count")::numeric), 4)
        END AS "post_done_rate",
        CASE
            WHEN ("post_nutrition_count" = 0) THEN NULL::numeric
            ELSE "round"((("post_skipped_count")::numeric / ("post_nutrition_count")::numeric), 4)
        END AS "post_skipped_rate",
        CASE
            WHEN (("pre_nutrition_count" = 0) OR ("post_nutrition_count" = 0)) THEN NULL::numeric
            ELSE "round"(((("post_done_count")::numeric / ("post_nutrition_count")::numeric) - (("pre_done_count")::numeric / ("pre_nutrition_count")::numeric)), 4)
        END AS "delta_done_rate",
        CASE
            WHEN (("pre_nutrition_count" = 0) OR ("post_nutrition_count" = 0)) THEN NULL::numeric
            ELSE "round"(((("post_skipped_count")::numeric / ("post_nutrition_count")::numeric) - (("pre_skipped_count")::numeric / ("pre_nutrition_count")::numeric)), 4)
        END AS "delta_skipped_rate",
    (CURRENT_DATE > ("acted_date" + 7)) AS "post_window_complete"
   FROM "aggregated";


CREATE OR REPLACE VIEW "public"."maat_guidance_drift_outcome_summary" WITH ("security_invoker"='true') AS
 SELECT ("date_trunc"('week'::"text", "acted_at"))::"date" AS "acted_week",
    "cta_type",
    "cta_ref",
    count(*) AS "acted_count",
    count(*) FILTER (WHERE "post_window_complete") AS "completed_window_count",
    "round"(avg("delta_done_rate") FILTER (WHERE ("post_window_complete" AND ("delta_done_rate" IS NOT NULL))), 4) AS "avg_delta_done_rate",
    "round"(avg("delta_skipped_rate") FILTER (WHERE ("post_window_complete" AND ("delta_skipped_rate" IS NOT NULL))), 4) AS "avg_delta_skipped_rate",
    "round"(avg("pre_done_rate") FILTER (WHERE ("post_window_complete" AND ("pre_done_rate" IS NOT NULL))), 4) AS "avg_pre_done_rate",
    "round"(avg("post_done_rate") FILTER (WHERE ("post_window_complete" AND ("post_done_rate" IS NOT NULL))), 4) AS "avg_post_done_rate"
   FROM "public"."maat_guidance_drift_outcomes"
  GROUP BY (("date_trunc"('week'::"text", "acted_at"))::"date"), "cta_type", "cta_ref";


CREATE OR REPLACE VIEW "public"."maat_guidance_drift_outcome_flags" WITH ("security_invoker"='true') AS
 WITH "measured" AS (
         SELECT "maat_guidance_drift_outcome_summary"."cta_type",
            "maat_guidance_drift_outcome_summary"."cta_ref",
            "maat_guidance_drift_outcome_summary"."completed_window_count",
            "maat_guidance_drift_outcome_summary"."avg_delta_done_rate",
            "maat_guidance_drift_outcome_summary"."avg_delta_skipped_rate"
           FROM "public"."maat_guidance_drift_outcome_summary"
          WHERE ("maat_guidance_drift_outcome_summary"."completed_window_count" > 0)
        ), "aggregated" AS (
         SELECT "measured"."cta_type",
            "measured"."cta_ref",
            count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)) AS "measured_week_count",
            COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric) AS "completed_window_count",
            COALESCE(count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" >= 0.05)), (0)::bigint) AS "positive_week_count",
            COALESCE(count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" <= '-0.05'::numeric)), (0)::bigint) AS "negative_week_count",
            "round"((COALESCE(sum(("measured"."avg_delta_done_rate" * ("measured"."completed_window_count")::numeric)) FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric) / (NULLIF(COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric), (0)::numeric))::numeric), 4) AS "weighted_delta_done_rate",
            "round"((COALESCE(sum(("measured"."avg_delta_skipped_rate" * ("measured"."completed_window_count")::numeric)) FILTER (WHERE ("measured"."avg_delta_skipped_rate" IS NOT NULL)), (0)::numeric) / (NULLIF(COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_skipped_rate" IS NOT NULL)), (0)::numeric), (0)::numeric))::numeric), 4) AS "weighted_delta_skipped_rate"
           FROM "measured"
          GROUP BY "measured"."cta_type", "measured"."cta_ref"
        )
 SELECT "cta_type",
    "cta_ref",
    "measured_week_count",
    "completed_window_count",
    "positive_week_count",
    "negative_week_count",
    "weighted_delta_done_rate",
    "weighted_delta_skipped_rate",
        CASE
            WHEN (("completed_window_count" >= (5)::numeric) AND ("measured_week_count" >= 2) AND ("weighted_delta_done_rate" >= 0.05) AND ("positive_week_count" > "negative_week_count")) THEN 'winning'::"text"
            WHEN (("completed_window_count" >= (5)::numeric) AND ("measured_week_count" >= 2) AND ("weighted_delta_done_rate" <= '-0.05'::numeric) AND ("negative_week_count" >= "positive_week_count")) THEN 'negative'::"text"
            ELSE 'neutral'::"text"
        END AS "outcome_flag"
   FROM "aggregated";


CREATE OR REPLACE VIEW "public"."maat_guidance_drift_outcome_flags_user" WITH ("security_invoker"='true') AS
 WITH "measured" AS (
         SELECT "maat_guidance_drift_outcomes"."user_id",
            ("date_trunc"('week'::"text", "maat_guidance_drift_outcomes"."acted_at"))::"date" AS "acted_week",
            "maat_guidance_drift_outcomes"."cta_type",
            "maat_guidance_drift_outcomes"."cta_ref",
            count(*) FILTER (WHERE "maat_guidance_drift_outcomes"."post_window_complete") AS "completed_window_count",
            "round"(avg("maat_guidance_drift_outcomes"."delta_done_rate") FILTER (WHERE ("maat_guidance_drift_outcomes"."post_window_complete" AND ("maat_guidance_drift_outcomes"."delta_done_rate" IS NOT NULL))), 4) AS "avg_delta_done_rate",
            "round"(avg("maat_guidance_drift_outcomes"."delta_skipped_rate") FILTER (WHERE ("maat_guidance_drift_outcomes"."post_window_complete" AND ("maat_guidance_drift_outcomes"."delta_skipped_rate" IS NOT NULL))), 4) AS "avg_delta_skipped_rate"
           FROM "public"."maat_guidance_drift_outcomes"
          GROUP BY "maat_guidance_drift_outcomes"."user_id", (("date_trunc"('week'::"text", "maat_guidance_drift_outcomes"."acted_at"))::"date"), "maat_guidance_drift_outcomes"."cta_type", "maat_guidance_drift_outcomes"."cta_ref"
         HAVING (count(*) FILTER (WHERE "maat_guidance_drift_outcomes"."post_window_complete") > 0)
        ), "aggregated" AS (
         SELECT "measured"."user_id",
            "measured"."cta_type",
            "measured"."cta_ref",
            count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)) AS "measured_week_count",
            COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric) AS "completed_window_count",
            COALESCE(count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" >= 0.05)), (0)::bigint) AS "positive_week_count",
            COALESCE(count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" <= '-0.05'::numeric)), (0)::bigint) AS "negative_week_count",
            "round"((COALESCE(sum(("measured"."avg_delta_done_rate" * ("measured"."completed_window_count")::numeric)) FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric) / (NULLIF(COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric), (0)::numeric))::numeric), 4) AS "weighted_delta_done_rate",
            "round"((COALESCE(sum(("measured"."avg_delta_skipped_rate" * ("measured"."completed_window_count")::numeric)) FILTER (WHERE ("measured"."avg_delta_skipped_rate" IS NOT NULL)), (0)::numeric) / (NULLIF(COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_skipped_rate" IS NOT NULL)), (0)::numeric), (0)::numeric))::numeric), 4) AS "weighted_delta_skipped_rate"
           FROM "measured"
          GROUP BY "measured"."user_id", "measured"."cta_type", "measured"."cta_ref"
        )
 SELECT "user_id",
    "cta_type",
    "cta_ref",
    "measured_week_count",
    "completed_window_count",
    "positive_week_count",
    "negative_week_count",
    "weighted_delta_done_rate",
    "weighted_delta_skipped_rate",
        CASE
            WHEN (("completed_window_count" >= (5)::numeric) AND ("measured_week_count" >= 2) AND ("weighted_delta_done_rate" >= 0.05) AND ("positive_week_count" > "negative_week_count")) THEN 'winning'::"text"
            WHEN (("completed_window_count" >= (5)::numeric) AND ("measured_week_count" >= 2) AND ("weighted_delta_done_rate" <= '-0.05'::numeric) AND ("negative_week_count" >= "positive_week_count")) THEN 'negative'::"text"
            ELSE 'neutral'::"text"
        END AS "outcome_flag"
   FROM "aggregated";


CREATE OR REPLACE VIEW "public"."maat_guidance_drift_outcome_flags_cohort" WITH ("security_invoker"='true') AS
 WITH "outcome_context" AS (
         SELECT "o"."user_id",
            "o"."delivery_id",
            "o"."decan_period_key",
            "o"."acted_at",
            "o"."cta_type",
            "o"."cta_ref",
            "o"."pre_done_rate",
            "o"."post_done_rate",
            "o"."delta_done_rate",
            "o"."pre_skipped_rate",
            "o"."post_skipped_rate",
            "o"."delta_skipped_rate",
            "o"."post_window_complete",
            COALESCE("e"."maturity_level", 'unknown'::"text") AS "maturity_level",
            NULLIF((("e"."decision" -> 'goal_profile'::"text") ->> 'key'::"text"), ''::"text") AS "goal_profile_key",
            COALESCE(NULLIF("split_part"("p"."timezone", '/'::"text", 1), ''::"text"), 'unknown'::"text") AS "timezone_region"
           FROM (("public"."maat_guidance_drift_outcomes" "o"
             LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "o"."user_id")))
             LEFT JOIN LATERAL ( SELECT "e_1"."maturity_level",
                    "e_1"."decision"
                   FROM "public"."maat_guidance_evaluations" "e_1"
                  WHERE (("e_1"."user_id" = "o"."user_id") AND ("e_1"."decan_period_key" = "o"."decan_period_key") AND ("e_1"."created_at" <= "o"."acted_at"))
                  ORDER BY "e_1"."created_at" DESC
                 LIMIT 1) "e" ON (true))
        ), "cohort_rows" AS (
         SELECT "o"."user_id",
            "o"."delivery_id",
            "o"."decan_period_key",
            "o"."acted_at",
            "o"."cta_type",
            "o"."cta_ref",
            "o"."delta_done_rate",
            "o"."delta_skipped_rate",
            "o"."post_window_complete",
            'maturity_level'::"text" AS "cohort_type",
            "o"."maturity_level" AS "cohort_key"
           FROM "outcome_context" "o"
        UNION ALL
         SELECT "o"."user_id",
            "o"."delivery_id",
            "o"."decan_period_key",
            "o"."acted_at",
            "o"."cta_type",
            "o"."cta_ref",
            "o"."delta_done_rate",
            "o"."delta_skipped_rate",
            "o"."post_window_complete",
            'goal_profile'::"text" AS "cohort_type",
            "o"."goal_profile_key" AS "cohort_key"
           FROM "outcome_context" "o"
          WHERE ("o"."goal_profile_key" IS NOT NULL)
        UNION ALL
         SELECT "o"."user_id",
            "o"."delivery_id",
            "o"."decan_period_key",
            "o"."acted_at",
            "o"."cta_type",
            "o"."cta_ref",
            "o"."delta_done_rate",
            "o"."delta_skipped_rate",
            "o"."post_window_complete",
            'timezone_region'::"text" AS "cohort_type",
            "o"."timezone_region" AS "cohort_key"
           FROM "outcome_context" "o"
        ), "measured" AS (
         SELECT "cohort_rows"."cohort_type",
            "cohort_rows"."cohort_key",
            ("date_trunc"('week'::"text", "cohort_rows"."acted_at"))::"date" AS "acted_week",
            "cohort_rows"."cta_type",
            "cohort_rows"."cta_ref",
            count(*) FILTER (WHERE "cohort_rows"."post_window_complete") AS "completed_window_count",
            "round"(avg("cohort_rows"."delta_done_rate") FILTER (WHERE ("cohort_rows"."post_window_complete" AND ("cohort_rows"."delta_done_rate" IS NOT NULL))), 4) AS "avg_delta_done_rate",
            "round"(avg("cohort_rows"."delta_skipped_rate") FILTER (WHERE ("cohort_rows"."post_window_complete" AND ("cohort_rows"."delta_skipped_rate" IS NOT NULL))), 4) AS "avg_delta_skipped_rate"
           FROM "cohort_rows"
          GROUP BY "cohort_rows"."cohort_type", "cohort_rows"."cohort_key", (("date_trunc"('week'::"text", "cohort_rows"."acted_at"))::"date"), "cohort_rows"."cta_type", "cohort_rows"."cta_ref"
         HAVING (count(*) FILTER (WHERE "cohort_rows"."post_window_complete") > 0)
        ), "aggregated" AS (
         SELECT "measured"."cohort_type",
            "measured"."cohort_key",
            "measured"."cta_type",
            "measured"."cta_ref",
            count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)) AS "measured_week_count",
            COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric) AS "completed_window_count",
            COALESCE(count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" >= 0.05)), (0)::bigint) AS "positive_week_count",
            COALESCE(count(*) FILTER (WHERE ("measured"."avg_delta_done_rate" <= '-0.05'::numeric)), (0)::bigint) AS "negative_week_count",
            "round"((COALESCE(sum(("measured"."avg_delta_done_rate" * ("measured"."completed_window_count")::numeric)) FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric) / (NULLIF(COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric), (0)::numeric))::numeric), 4) AS "weighted_delta_done_rate",
            "round"((COALESCE(sum(("measured"."avg_delta_skipped_rate" * ("measured"."completed_window_count")::numeric)) FILTER (WHERE ("measured"."avg_delta_skipped_rate" IS NOT NULL)), (0)::numeric) / (NULLIF(COALESCE(sum("measured"."completed_window_count") FILTER (WHERE ("measured"."avg_delta_skipped_rate" IS NOT NULL)), (0)::numeric), (0)::numeric))::numeric), 4) AS "weighted_delta_skipped_rate"
           FROM "measured"
          GROUP BY "measured"."cohort_type", "measured"."cohort_key", "measured"."cta_type", "measured"."cta_ref"
        )
 SELECT "cohort_type",
    "cohort_key",
    "cta_type",
    "cta_ref",
    "measured_week_count",
    "completed_window_count",
    "positive_week_count",
    "negative_week_count",
    "weighted_delta_done_rate",
    "weighted_delta_skipped_rate",
        CASE
            WHEN (("completed_window_count" >= (5)::numeric) AND ("measured_week_count" >= 2) AND ("weighted_delta_done_rate" >= 0.05) AND ("positive_week_count" > "negative_week_count")) THEN 'winning'::"text"
            WHEN (("completed_window_count" >= (5)::numeric) AND ("measured_week_count" >= 2) AND ("weighted_delta_done_rate" <= '-0.05'::numeric) AND ("negative_week_count" >= "positive_week_count")) THEN 'negative'::"text"
            ELSE 'neutral'::"text"
        END AS "outcome_flag"
   FROM "aggregated";


CREATE OR REPLACE VIEW "public"."maat_guidance_drift_outcome_dashboard" WITH ("security_invoker"='true') AS
 WITH "weekly" AS (
         SELECT "maat_guidance_drift_outcome_summary"."acted_week",
            "maat_guidance_drift_outcome_summary"."cta_type",
            "maat_guidance_drift_outcome_summary"."cta_ref",
            "maat_guidance_drift_outcome_summary"."acted_count",
            "maat_guidance_drift_outcome_summary"."completed_window_count",
            "maat_guidance_drift_outcome_summary"."avg_delta_done_rate",
            "maat_guidance_drift_outcome_summary"."avg_delta_skipped_rate",
            "maat_guidance_drift_outcome_summary"."avg_pre_done_rate",
            "maat_guidance_drift_outcome_summary"."avg_post_done_rate"
           FROM "public"."maat_guidance_drift_outcome_summary"
          WHERE ("maat_guidance_drift_outcome_summary"."completed_window_count" > 0)
        ), "weekly_rollup" AS (
         SELECT "weekly"."cta_type",
            "weekly"."cta_ref",
            min("weekly"."acted_week") AS "first_measured_week",
            max("weekly"."acted_week") AS "latest_measured_week",
            "jsonb_agg"("jsonb_build_object"('week', "weekly"."acted_week", 'acted_count', "weekly"."acted_count", 'completed_window_count', "weekly"."completed_window_count", 'avg_delta_done_rate', "weekly"."avg_delta_done_rate", 'avg_delta_skipped_rate', "weekly"."avg_delta_skipped_rate", 'avg_pre_done_rate', "weekly"."avg_pre_done_rate", 'avg_post_done_rate', "weekly"."avg_post_done_rate") ORDER BY "weekly"."acted_week" DESC) AS "weekly_history"
           FROM "weekly"
          GROUP BY "weekly"."cta_type", "weekly"."cta_ref"
        )
 SELECT "f"."cta_type",
    "f"."cta_ref",
    "f"."outcome_flag",
        CASE
            WHEN ("f"."outcome_flag" = 'winning'::"text") THEN 'prefer_when_candidate'::"text"
            WHEN ("f"."outcome_flag" = 'negative'::"text") THEN 'avoid_when_alternative_exists'::"text"
            ELSE 'observe_only'::"text"
        END AS "routing_effect",
    "f"."measured_week_count",
    "f"."completed_window_count",
    "f"."positive_week_count",
    "f"."negative_week_count",
    "f"."weighted_delta_done_rate",
    "f"."weighted_delta_skipped_rate",
    "w"."first_measured_week",
    "w"."latest_measured_week",
    COALESCE("w"."weekly_history", '[]'::"jsonb") AS "weekly_history",
    'requires >=5 completed windows, >=2 measured weeks, and abs(weighted_delta_done_rate) >= 0.05'::"text" AS "flag_rule"
   FROM ("public"."maat_guidance_drift_outcome_flags" "f"
     LEFT JOIN "weekly_rollup" "w" ON ((("w"."cta_type" = "f"."cta_type") AND ("w"."cta_ref" IS NOT DISTINCT FROM "f"."cta_ref"))));


CREATE OR REPLACE VIEW "public"."maat_guidance_ops_alerts" WITH ("security_invoker"='true') AS
 WITH "recent_summary" AS (
         SELECT "maat_guidance_drift_outcome_summary"."cta_type",
            "maat_guidance_drift_outcome_summary"."cta_ref",
            COALESCE(sum("maat_guidance_drift_outcome_summary"."completed_window_count"), (0)::numeric) AS "recent_completed_window_count",
            "round"((COALESCE(sum(("maat_guidance_drift_outcome_summary"."avg_delta_done_rate" * ("maat_guidance_drift_outcome_summary"."completed_window_count")::numeric)) FILTER (WHERE ("maat_guidance_drift_outcome_summary"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric) / (NULLIF(COALESCE(sum("maat_guidance_drift_outcome_summary"."completed_window_count") FILTER (WHERE ("maat_guidance_drift_outcome_summary"."avg_delta_done_rate" IS NOT NULL)), (0)::numeric), (0)::numeric))::numeric), 4) AS "recent_weighted_delta_done_rate"
           FROM "public"."maat_guidance_drift_outcome_summary"
          WHERE ("maat_guidance_drift_outcome_summary"."acted_week" >= (CURRENT_DATE - 28))
          GROUP BY "maat_guidance_drift_outcome_summary"."cta_type", "maat_guidance_drift_outcome_summary"."cta_ref"
        ), "global_regressions" AS (
         SELECT 'winning_cta_recent_regression'::"text" AS "alert_key",
            'warning'::"text" AS "severity",
            "f"."cta_type",
            "f"."cta_ref",
            NULL::"text" AS "cohort_type",
            NULL::"text" AS "cohort_key",
            "jsonb_build_object"('outcome_flag', "f"."outcome_flag", 'recent_completed_window_count', "r"."recent_completed_window_count", 'recent_weighted_delta_done_rate', "r"."recent_weighted_delta_done_rate", 'global_weighted_delta_done_rate', "f"."weighted_delta_done_rate") AS "details"
           FROM ("public"."maat_guidance_drift_outcome_flags" "f"
             JOIN "recent_summary" "r" ON ((("r"."cta_type" = "f"."cta_type") AND ("r"."cta_ref" IS NOT DISTINCT FROM "f"."cta_ref"))))
          WHERE (("f"."outcome_flag" = 'winning'::"text") AND ("r"."recent_completed_window_count" >= (5)::numeric) AND ("r"."recent_weighted_delta_done_rate" < (0)::numeric))
        ), "negative_dawn_house" AS (
         SELECT 'dawn_house_negative_signal'::"text" AS "alert_key",
            'warning'::"text" AS "severity",
            "f"."cta_type",
            "f"."cta_ref",
            NULL::"text" AS "cohort_type",
            NULL::"text" AS "cohort_key",
            "jsonb_build_object"('outcome_flag', "f"."outcome_flag", 'completed_window_count', "f"."completed_window_count", 'weighted_delta_done_rate', "f"."weighted_delta_done_rate") AS "details"
           FROM "public"."maat_guidance_drift_outcome_flags" "f"
          WHERE (("f"."cta_type" = 'flow_template'::"text") AND ("f"."cta_ref" = 'dawn-house-rite'::"text") AND ("f"."outcome_flag" = 'negative'::"text"))
        ), "cohort_negative" AS (
         SELECT 'cohort_negative_signal'::"text" AS "alert_key",
            'observe'::"text" AS "severity",
            "f"."cta_type",
            "f"."cta_ref",
            "f"."cohort_type",
            "f"."cohort_key",
            "jsonb_build_object"('outcome_flag', "f"."outcome_flag", 'completed_window_count', "f"."completed_window_count", 'weighted_delta_done_rate', "f"."weighted_delta_done_rate") AS "details"
           FROM "public"."maat_guidance_drift_outcome_flags_cohort" "f"
          WHERE ("f"."outcome_flag" = 'negative'::"text")
        )
 SELECT "global_regressions"."alert_key",
    "global_regressions"."severity",
    "global_regressions"."cta_type",
    "global_regressions"."cta_ref",
    "global_regressions"."cohort_type",
    "global_regressions"."cohort_key",
    "global_regressions"."details"
   FROM "global_regressions"
UNION ALL
 SELECT "negative_dawn_house"."alert_key",
    "negative_dawn_house"."severity",
    "negative_dawn_house"."cta_type",
    "negative_dawn_house"."cta_ref",
    "negative_dawn_house"."cohort_type",
    "negative_dawn_house"."cohort_key",
    "negative_dawn_house"."details"
   FROM "negative_dawn_house"
UNION ALL
 SELECT "cohort_negative"."alert_key",
    "cohort_negative"."severity",
    "cohort_negative"."cta_type",
    "cohort_negative"."cta_ref",
    "cohort_negative"."cohort_type",
    "cohort_negative"."cohort_key",
    "cohort_negative"."details"
   FROM "cohort_negative";


ALTER TABLE "public"."user_event_completions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_event_completions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."user_event_filing_items" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "client_event_id",
    "calendar_id",
    "calendar_name",
    "calendar_color",
    "calendar_is_personal",
    "title",
    "detail",
    "location",
    "all_day",
    "starts_at",
    "ends_at",
    "flow_local_id",
    "category",
    "action_id",
    "behavior_payload",
    "updated_at",
    "created_at",
    "filed_flow_id",
    "flow_active",
    "flow_is_hidden",
    "flow_is_reminder",
    "flow_is_saved",
    "flow_notes",
    "user_timezone",
    "active_until",
    "date_lifecycle",
    "has_event_share",
    "has_flow_share",
    "has_flow_post",
    "has_active_reminder",
    "has_scheduled_notification",
    "reason_item_kind",
    "reason_deleted",
    "reason_active_until",
    "item_kind",
    "is_deleted",
    "is_saved",
    "is_shared_calendar_source",
    "is_event_share_source",
    "is_flow_share_source",
    "is_flow_post_source",
    "is_flow_saved_source",
    "is_active_reminder_source",
    "is_scheduled_notification_source",
    "lifecycle",
    "live_on_calendar",
    "is_shared",
    "is_posted",
    "filing_reasons"
   FROM "public"."user_event_filing_items_client";


ALTER VIEW "public"."user_event_filing_items" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_events_with_calendars" WITH ("security_invoker"='true') AS
 SELECT "ue"."id",
    "ue"."user_id",
    "ue"."client_event_id",
    "ue"."title",
    "ue"."detail",
    "ue"."location",
    "ue"."all_day",
    "ue"."starts_at",
    "ue"."ends_at",
    "ue"."flow_local_id",
    "ue"."flow_tpl_key",
    "ue"."created_at",
    "ue"."updated_at",
    "ue"."category",
    "ue"."calendar_id",
    "ue"."action_id",
    "ue"."behavior_payload",
    "sc"."name" AS "calendar_name",
    "sc"."color" AS "calendar_color",
    "sc"."is_personal" AS "calendar_is_personal"
   FROM ("public"."user_events" "ue"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "ue"."calendar_id")))
  WHERE ("sc"."deleted_at" IS NULL);


ALTER VIEW "public"."user_events_with_calendars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_state" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_state" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."flow_generation_cache" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."flow_generation_cache_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."flow_generation_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."flow_generation_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."flow_insert_debug" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."flow_insert_debug_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."flows" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."flows_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."scheduled_notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."scheduled_notifications_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."alignment_notes"
    ADD CONSTRAINT "alignment_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_events"
    ADD CONSTRAINT "app_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cycle_adjustment_suggestions"
    ADD CONSTRAINT "cycle_adjustment_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cycle_fields"
    ADD CONSTRAINT "cycle_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cycle_schedule_rules"
    ADD CONSTRAINT "cycle_schedule_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decan_reflection_schedule"
    ADD CONSTRAINT "decan_reflection_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decan_reflections"
    ADD CONSTRAINT "decan_reflections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dm_message_likes"
    ADD CONSTRAINT "dm_message_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dm_message_likes"
    ADD CONSTRAINT "dm_message_likes_unique" UNIQUE ("message_share_id", "user_id");



ALTER TABLE ONLY "public"."event_deletion_trash"
    ADD CONSTRAINT "event_deletion_trash_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_shares"
    ADD CONSTRAINT "event_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_generation_cache"
    ADD CONSTRAINT "flow_generation_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_generation_cache"
    ADD CONSTRAINT "flow_generation_cache_user_versions_hash_key" UNIQUE ("user_id", "snapshot_version", "schema_version", "policy_version", "input_hash");



ALTER TABLE ONLY "public"."flow_generation_logs"
    ADD CONSTRAINT "flow_generation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_insert_debug"
    ADD CONSTRAINT "flow_insert_debug_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_insert_guard_flag"
    ADD CONSTRAINT "flow_insert_guard_flag_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_outcomes"
    ADD CONSTRAINT "flow_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_post_comment_likes"
    ADD CONSTRAINT "flow_post_comment_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_post_comment_likes"
    ADD CONSTRAINT "flow_post_comment_likes_unique" UNIQUE ("comment_id", "user_id");



ALTER TABLE ONLY "public"."flow_post_comments"
    ADD CONSTRAINT "flow_post_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_post_likes"
    ADD CONSTRAINT "flow_post_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_post_likes"
    ADD CONSTRAINT "flow_post_likes_unique" UNIQUE ("flow_post_id", "user_id");



ALTER TABLE ONLY "public"."flow_posts"
    ADD CONSTRAINT "flow_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_saves"
    ADD CONSTRAINT "flow_saves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flow_shares"
    ADD CONSTRAINT "flow_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "flows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "flows_reminder_uuid_unique" UNIQUE ("reminder_uuid");



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_pkey" PRIMARY KEY ("follower_id", "followee_id");



ALTER TABLE ONLY "public"."insight_links"
    ADD CONSTRAINT "insight_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."insight_posts"
    ADD CONSTRAINT "insight_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."insight_posts"
    ADD CONSTRAINT "insight_posts_unique_entry" UNIQUE ("user_id", "insight_entry_id");



ALTER TABLE ONLY "public"."journal_badges"
    ADD CONSTRAINT "journal_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."maat_band_transitions"
    ADD CONSTRAINT "maat_band_transitions_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."maat_band_transitions"
    ADD CONSTRAINT "maat_band_transitions_user_decan_window_band_key" UNIQUE ("user_id", "decan_period_key", "from_window_date", "to_window_date", "from_band", "to_band");


ALTER TABLE ONLY "public"."maat_corrections"
    ADD CONSTRAINT "maat_corrections_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."maat_flow_briefs"
    ADD CONSTRAINT "maat_flow_briefs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."maat_flow_briefs"
    ADD CONSTRAINT "maat_flow_briefs_user_id_decan_period_key_brief_id_key" UNIQUE ("user_id", "decan_period_key", "brief_id");


ALTER TABLE ONLY "public"."maat_guidance_deliveries"
    ADD CONSTRAINT "maat_guidance_deliveries_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."maat_guidance_evaluations"
    ADD CONSTRAINT "maat_guidance_evaluations_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."maat_user_baselines"
    ADD CONSTRAINT "maat_user_baselines_pkey" PRIMARY KEY ("user_id");


ALTER TABLE ONLY "public"."maat_snapshots"
    ADD CONSTRAINT "maat_snapshots_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."maat_snapshots"
    ADD CONSTRAINT "maat_snapshots_user_window_decan_key" UNIQUE ("user_id", "window_date", "decan_period_key");



ALTER TABLE ONLY "public"."medu_decision_matrix"
    ADD CONSTRAINT "medu_decision_matrix_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medu_decision_matrix"
    ADD CONSTRAINT "medu_decision_matrix_user_concept_dict_key" UNIQUE ("user_id", "concept", "dictionary_id");



ALTER TABLE ONLY "public"."medu_decision_matrix"
    ADD CONSTRAINT "medu_decision_matrix_user_id_dict_id_english_concept_key" UNIQUE ("user_id", "dict_id", "english_concept");



ALTER TABLE ONLY "public"."medu_dictionary"
    ADD CONSTRAINT "medu_dictionary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medu_kg_edges"
    ADD CONSTRAINT "medu_kg_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memory_nodes"
    ADD CONSTRAINT "memory_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."node_insight_entries"
    ADD CONSTRAINT "node_insight_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."node_links"
    ADD CONSTRAINT "node_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."node_user_content"
    ADD CONSTRAINT "node_user_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."nutrition_items"
    ADD CONSTRAINT "nutrition_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_handle_key" UNIQUE ("handle");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("device_id");



ALTER TABLE ONLY "public"."reflection_feedback"
    ADD CONSTRAINT "reflection_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reflection_generations"
    ADD CONSTRAINT "reflection_generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reflection_profiles"
    ADD CONSTRAINT "reflection_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_notifications"
    ADD CONSTRAINT "scheduled_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."share_short_links"
    ADD CONSTRAINT "share_short_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_calendar_members"
    ADD CONSTRAINT "shared_calendar_members_pkey" PRIMARY KEY ("calendar_id", "user_id");



ALTER TABLE ONLY "public"."shared_calendar_notifications"
    ADD CONSTRAINT "shared_calendar_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_calendars"
    ADD CONSTRAINT "shared_calendars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ukg_user_preferences"
    ADD CONSTRAINT "ukg_user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."scheduled_notifications"
    ADD CONSTRAINT "unique_user_client_event_type" UNIQUE ("user_id", "client_event_id", "notification_type");



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "unique_user_date" UNIQUE ("user_id", "greg_date");



ALTER TABLE ONLY "public"."node_user_content"
    ADD CONSTRAINT "uq_node_user_content" UNIQUE ("user_id", "node_id");



ALTER TABLE ONLY "public"."reflection_feedback"
    ADD CONSTRAINT "uq_reflection_feedback" UNIQUE ("user_id", "reflection_generation_id");



ALTER TABLE ONLY "public"."user_ai_usage"
    ADD CONSTRAINT "user_ai_usage_pkey" PRIMARY KEY ("user_id", "day");



ALTER TABLE ONLY "public"."user_app_restoration_snapshots"
    ADD CONSTRAINT "user_app_restoration_snapshots_pk" PRIMARY KEY ("user_id", "scope", "device_id", "window_id");



ALTER TABLE ONLY "public"."user_choice_events"
    ADD CONSTRAINT "user_choice_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_event_completions"
    ADD CONSTRAINT "user_event_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_client_event_id_unique" UNIQUE ("client_event_id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_user_client_event_unique" UNIQUE ("user_id", "client_event_id");



ALTER TABLE ONLY "public"."user_state"
    ADD CONSTRAINT "user_state_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "alignment_notes_user_id_position_created_at_idx" ON "public"."alignment_notes" USING "btree" ("user_id", "position", "created_at");



CREATE INDEX "app_events_created_at_idx" ON "public"."app_events" USING "btree" ("created_at");



CREATE INDEX "app_events_user_id_created_at_idx" ON "public"."app_events" USING "btree" ("user_id", "created_at");



CREATE INDEX "app_events_user_id_idx" ON "public"."app_events" USING "btree" ("user_id");



CREATE UNIQUE INDEX "checklist_items_user_date_source_key" ON "public"."checklist_items" USING "btree" ("user_id", "local_date", "source_key");



CREATE UNIQUE INDEX "cycle_fields_user_slug_key" ON "public"."cycle_fields" USING "btree" ("user_id", "slug");



CREATE INDEX "dm_message_likes_message_created_idx" ON "public"."dm_message_likes" USING "btree" ("message_share_id", "created_at" DESC);



CREATE INDEX "event_deletion_trash_operation_idx" ON "public"."event_deletion_trash" USING "btree" ("operation_id");



CREATE INDEX "event_deletion_trash_purge_idx" ON "public"."event_deletion_trash" USING "btree" ("purge_after") WHERE ("purged_at" IS NULL);



CREATE INDEX "event_deletion_trash_suppressing_client_idx" ON "public"."event_deletion_trash" USING "btree" ("user_id", "client_event_id") WHERE (("client_event_id" IS NOT NULL) AND ("purged_at" IS NULL) AND ("suppresses_client" = true));



CREATE INDEX "event_deletion_trash_user_client_idx" ON "public"."event_deletion_trash" USING "btree" ("user_id", "client_event_id") WHERE (("client_event_id" IS NOT NULL) AND ("purged_at" IS NULL));



CREATE INDEX "event_shares_recipient_created_deleted_idx" ON "public"."event_shares" USING "btree" ("recipient_id", "deleted_at", "created_at" DESC);



CREATE INDEX "event_shares_sender_created_deleted_idx" ON "public"."event_shares" USING "btree" ("sender_id", "deleted_at", "created_at" DESC);



CREATE UNIQUE INDEX "flow_generation_cache_key_uniq" ON "public"."flow_generation_cache" USING "btree" ("user_id", COALESCE("snapshot_version", ''::"text"), COALESCE("schema_version", ''::"text"), COALESCE("policy_version", ''::"text"), "input_hash") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "flow_generation_cache_lookup_idx" ON "public"."flow_generation_cache" USING "btree" ("user_id", COALESCE("snapshot_version", ''::"text"), COALESCE("schema_version", ''::"text"), COALESCE("policy_version", ''::"text"), "input_hash", "created_at" DESC) WHERE ("user_id" IS NOT NULL);



CREATE INDEX "flow_generation_cache_user_created_at_idx" ON "public"."flow_generation_cache" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "flow_generation_logs_generation_id_idx" ON "public"."flow_generation_logs" USING "btree" ("generation_id") WHERE ("generation_id" IS NOT NULL);



CREATE UNIQUE INDEX "flow_generation_logs_generation_id_uniq" ON "public"."flow_generation_logs" USING "btree" ("generation_id") WHERE ("generation_id" IS NOT NULL);



CREATE INDEX "flow_generation_logs_served_from_cache_idx" ON "public"."flow_generation_logs" USING "btree" ("user_id", "served_from_cache");



CREATE INDEX "flow_generation_logs_user_created_at_idx" ON "public"."flow_generation_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "flow_generation_logs_user_range_idx" ON "public"."flow_generation_logs" USING "btree" ("user_id", "range_start", "range_end");



CREATE INDEX "flow_outcomes_flow_id_idx" ON "public"."flow_outcomes" USING "btree" ("flow_id");



CREATE UNIQUE INDEX "flow_outcomes_one_per_window_uniq" ON "public"."flow_outcomes" USING "btree" ("user_id", "flow_id", "window_start") WHERE ("window_start" IS NOT NULL);



CREATE INDEX "flow_outcomes_recorded_at_idx" ON "public"."flow_outcomes" USING "btree" ("recorded_at" DESC);



CREATE INDEX "flow_outcomes_user_id_idx" ON "public"."flow_outcomes" USING "btree" ("user_id");



CREATE INDEX "flow_outcomes_user_id_recorded_at_desc_idx" ON "public"."flow_outcomes" USING "btree" ("user_id", "recorded_at" DESC);



CREATE INDEX "flow_post_comment_likes_comment_created_idx" ON "public"."flow_post_comment_likes" USING "btree" ("comment_id", "created_at" DESC);



CREATE INDEX "flow_post_comments_parent_created_idx" ON "public"."flow_post_comments" USING "btree" ("parent_comment_id", "created_at");



CREATE INDEX "flow_post_comments_post_created_idx" ON "public"."flow_post_comments" USING "btree" ("flow_post_id", "created_at");



CREATE INDEX "flow_post_likes_post_created_idx" ON "public"."flow_post_likes" USING "btree" ("flow_post_id", "created_at" DESC);



CREATE INDEX "flow_posts_user_id_created_at_idx" ON "public"."flow_posts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "flow_posts_visibility_idx" ON "public"."flow_posts" USING "btree" ("is_hidden");



CREATE INDEX "flow_posts_visible_created_at_idx" ON "public"."flow_posts" USING "btree" ("created_at" DESC) WHERE (COALESCE("is_hidden", false) = false);



CREATE INDEX "flow_saves_flow_id_idx" ON "public"."flow_saves" USING "btree" ("flow_id");



CREATE INDEX "flow_saves_saved_at_idx" ON "public"."flow_saves" USING "btree" ("saved_at" DESC);



CREATE UNIQUE INDEX "flow_saves_user_flow_uniq" ON "public"."flow_saves" USING "btree" ("user_id", "flow_id");



CREATE INDEX "flow_saves_user_id_idx" ON "public"."flow_saves" USING "btree" ("user_id");



CREATE INDEX "flow_shares_recipient_created_deleted_idx" ON "public"."flow_shares" USING "btree" ("recipient_id", "deleted_at", "created_at" DESC);



CREATE INDEX "flow_shares_sender_created_deleted_idx" ON "public"."flow_shares" USING "btree" ("sender_id", "deleted_at", "created_at" DESC);



CREATE INDEX "flows_calendar_id_updated_idx" ON "public"."flows" USING "btree" ("calendar_id", "updated_at" DESC);



CREATE INDEX "flows_is_reminder_idx" ON "public"."flows" USING "btree" ("is_reminder");



CREATE INDEX "flows_origin_flow_id_idx" ON "public"."flows" USING "btree" ("origin_flow_id");



CREATE INDEX "flows_origin_generation_id_idx" ON "public"."flows" USING "btree" ("origin_generation_id");



CREATE INDEX "flows_origin_share_id_idx" ON "public"."flows" USING "btree" ("origin_share_id");



CREATE INDEX "flows_reminder_uuid_idx" ON "public"."flows" USING "btree" ("reminder_uuid");



CREATE INDEX "flows_root_flow_id_idx" ON "public"."flows" USING "btree" ("root_flow_id");



CREATE UNIQUE INDEX "flows_share_import_origin_generation_uniq" ON "public"."flows" USING "btree" ("user_id", "origin_generation_id") WHERE (("origin_type" = 'share_import'::"text") AND ("origin_generation_id" IS NOT NULL));



CREATE INDEX "flows_updated_idx" ON "public"."flows" USING "btree" ("updated_at");



CREATE INDEX "flows_user_active_idx" ON "public"."flows" USING "btree" ("user_id", "active");



CREATE INDEX "flows_user_id_created_at_idx" ON "public"."flows" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "flows_user_id_end_date_idx" ON "public"."flows" USING "btree" ("user_id", "end_date");



CREATE INDEX "flows_user_id_idx" ON "public"."flows" USING "btree" ("user_id");



CREATE INDEX "flows_user_saved_idx" ON "public"."flows" USING "btree" ("user_id", "is_saved");



CREATE INDEX "follows_followee_id_idx" ON "public"."follows" USING "btree" ("followee_id");



CREATE INDEX "follows_follower_id_idx" ON "public"."follows" USING "btree" ("follower_id");



CREATE INDEX "idx_app_events_created_at" ON "public"."app_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_app_events_created_at_desc" ON "public"."app_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_app_events_event" ON "public"."app_events" USING "btree" ("event");



CREATE INDEX "idx_app_events_user_id" ON "public"."app_events" USING "btree" ("user_id");



CREATE INDEX "idx_audit_log_at" ON "public"."audit_log" USING "btree" ("at" DESC);



CREATE INDEX "idx_audit_log_table" ON "public"."audit_log" USING "btree" ("table_name");



CREATE INDEX "idx_cache_user_hash" ON "public"."flow_generation_cache" USING "btree" ("user_id", "input_hash");



CREATE INDEX "idx_checklist_items_field" ON "public"."checklist_items" USING "btree" ("field_id");



CREATE INDEX "idx_checklist_items_status" ON "public"."checklist_items" USING "btree" ("user_id", "status");



CREATE INDEX "idx_checklist_items_user_date" ON "public"."checklist_items" USING "btree" ("user_id", "local_date");



CREATE INDEX "idx_cycle_adjustment_suggestions_status" ON "public"."cycle_adjustment_suggestions" USING "btree" ("user_id", "status");



CREATE INDEX "idx_cycle_fields_user" ON "public"."cycle_fields" USING "btree" ("user_id");



CREATE INDEX "idx_cycle_schedule_rules_days" ON "public"."cycle_schedule_rules" USING "gin" ("days_of_week");



CREATE INDEX "idx_cycle_schedule_rules_user_field" ON "public"."cycle_schedule_rules" USING "btree" ("user_id", "field_id");



CREATE INDEX "idx_decan_reflection_schedule_due_claim" ON "public"."decan_reflection_schedule" USING "btree" ("send_at", "claimed_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text"]));



CREATE INDEX "idx_event_shares_created" ON "public"."event_shares" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_event_shares_deleted_at" ON "public"."event_shares" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_event_shares_pending_rsvp" ON "public"."event_shares" USING "btree" ("recipient_id", "response_status", "created_at" DESC) WHERE (("recipient_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_event_shares_recipient" ON "public"."event_shares" USING "btree" ("recipient_id") WHERE ("recipient_id" IS NOT NULL);



CREATE INDEX "idx_event_shares_sender" ON "public"."event_shares" USING "btree" ("sender_id");



CREATE INDEX "idx_flow_generation_cache_input_hash_created_at" ON "public"."flow_generation_cache" USING "btree" ("input_hash", "created_at");



CREATE INDEX "idx_flow_generation_logs_flow_id" ON "public"."flow_generation_logs" USING "btree" ("flow_id");



CREATE INDEX "idx_flow_generation_logs_input_hash" ON "public"."flow_generation_logs" USING "btree" ("input_hash");



CREATE INDEX "idx_flow_generation_logs_user_id_created_at" ON "public"."flow_generation_logs" USING "btree" ("user_id", "created_at");



CREATE INDEX "idx_flow_shares_created" ON "public"."flow_shares" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_flow_shares_deleted_at" ON "public"."flow_shares" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_flow_shares_flow" ON "public"."flow_shares" USING "btree" ("flow_id");



CREATE INDEX "idx_flow_shares_recipient" ON "public"."flow_shares" USING "btree" ("recipient_id") WHERE ("recipient_id" IS NOT NULL);



CREATE INDEX "idx_flow_shares_sender" ON "public"."flow_shares" USING "btree" ("sender_id");



CREATE INDEX "idx_flow_shares_share_token" ON "public"."flow_shares" USING "btree" ("share_token") WHERE ("share_token" IS NOT NULL);



CREATE INDEX "idx_flow_shares_token" ON "public"."flow_shares" USING "btree" ("invite_token") WHERE ("invite_token" IS NOT NULL);



CREATE INDEX "idx_flows_is_hidden" ON "public"."flows" USING "btree" ("is_hidden") WHERE ("is_hidden" = false);



CREATE INDEX "idx_flows_share_id" ON "public"."flows" USING "btree" ("share_id");



CREATE INDEX "idx_flows_user_updated" ON "public"."flows" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "idx_insight_links_source" ON "public"."insight_links" USING "btree" ("source_type", "source_id");



CREATE INDEX "idx_insight_links_target" ON "public"."insight_links" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_insight_links_user" ON "public"."insight_links" USING "btree" ("user_id");



CREATE INDEX "idx_journal_badges_user_on" ON "public"."journal_badges" USING "btree" ("user_id", "occurred_on");


CREATE INDEX "idx_journal_badges_user_event_id" ON "public"."journal_badges" USING "btree" ("user_id", "event_id") WHERE ("event_id" IS NOT NULL);


CREATE INDEX "idx_maat_band_transitions_user_decan_date" ON "public"."maat_band_transitions" USING "btree" ("user_id", "decan_period_key", "to_window_date" DESC);


CREATE INDEX "idx_maat_corrections_open" ON "public"."maat_corrections" USING "btree" ("user_id", "decan_period_key", "status", "created_at" DESC);


CREATE INDEX "idx_maat_flow_briefs_delivery" ON "public"."maat_flow_briefs" USING "btree" ("delivery_id");


CREATE INDEX "idx_maat_flow_briefs_user_period" ON "public"."maat_flow_briefs" USING "btree" ("user_id", "decan_period_key");


CREATE INDEX "idx_maat_guidance_decan" ON "public"."maat_guidance_deliveries" USING "btree" ("user_id", "decan_period_key", "kind");


CREATE INDEX "idx_maat_guidance_evaluations_user_decan_date" ON "public"."maat_guidance_evaluations" USING "btree" ("user_id", "decan_period_key", "window_date" DESC, "created_at" DESC);


CREATE INDEX "idx_maat_guidance_pending" ON "public"."maat_guidance_deliveries" USING "btree" ("user_id", "status", "priority", "created_at");


CREATE INDEX "idx_maat_snapshots_user_decan_date" ON "public"."maat_snapshots" USING "btree" ("user_id", "decan_period_key", "window_date" DESC);


CREATE INDEX "idx_maat_user_baselines_computed_at" ON "public"."maat_user_baselines" USING "btree" ("computed_at" DESC);


CREATE UNIQUE INDEX "uq_maat_corrections_open" ON "public"."maat_corrections" USING "btree" ("user_id", "decan_period_key") WHERE ("status" = 'open'::"text");


CREATE UNIQUE INDEX "uq_maat_guidance_decan_opening" ON "public"."maat_guidance_deliveries" USING "btree" ("user_id", "decan_period_key") WHERE ("kind" = 'decan_opening'::"text");


CREATE UNIQUE INDEX "uq_maat_guidance_strength_nudge" ON "public"."maat_guidance_deliveries" USING "btree" ("user_id", "decan_period_key") WHERE ("kind" = 'strength_nudge'::"text");



CREATE INDEX "idx_journal_user_date" ON "public"."journal_entries" USING "btree" ("user_id", "greg_date" DESC);



CREATE INDEX "idx_node_links_source" ON "public"."node_links" USING "btree" ("source_node_id");



CREATE INDEX "idx_node_links_target" ON "public"."node_links" USING "btree" ("target_node_id");



CREATE INDEX "idx_node_user_content_node" ON "public"."node_user_content" USING "btree" ("node_id");



CREATE INDEX "idx_node_user_content_user" ON "public"."node_user_content" USING "btree" ("user_id");



CREATE INDEX "idx_nodes_aliases" ON "public"."nodes" USING "gin" ("aliases");



CREATE INDEX "idx_notifications_type" ON "public"."scheduled_notifications" USING "btree" ("notification_type");



CREATE INDEX "idx_nutrition_items_user" ON "public"."nutrition_items" USING "btree" ("user_id");



CREATE INDEX "idx_nutrition_items_user_id" ON "public"."nutrition_items" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_email_lower" ON "public"."profiles" USING "btree" ("lower"("email"));



CREATE INDEX "idx_profiles_handle" ON "public"."profiles" USING "btree" ("handle");



CREATE INDEX "idx_reflection_feedback_gen" ON "public"."reflection_feedback" USING "btree" ("reflection_generation_id");



CREATE INDEX "idx_reflection_generations_created" ON "public"."reflection_generations" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reflection_generations_period" ON "public"."reflection_generations" USING "btree" ("period_type", "period_key");



CREATE INDEX "idx_reflection_generations_user" ON "public"."reflection_generations" USING "btree" ("user_id");



CREATE INDEX "idx_scheduled_notifications_active" ON "public"."scheduled_notifications" USING "btree" ("user_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_scheduled_notifications_client_event_id" ON "public"."scheduled_notifications" USING "btree" ("client_event_id");



CREATE INDEX "idx_scheduled_notifications_due_claim" ON "public"."scheduled_notifications" USING "btree" ("scheduled_at", "claimed_at") WHERE ("is_active" = true);



CREATE INDEX "idx_scheduled_notifications_user_id" ON "public"."scheduled_notifications" USING "btree" ("user_id");



CREATE INDEX "idx_shared_calendar_notifications_recipient_created" ON "public"."shared_calendar_notifications" USING "btree" ("recipient_id", "created_at" DESC);



CREATE INDEX "idx_shared_calendar_notifications_recipient_unread" ON "public"."shared_calendar_notifications" USING "btree" ("recipient_id", "viewed_at", "deleted_at", "created_at" DESC);



CREATE INDEX "idx_short_links_expires" ON "public"."share_short_links" USING "btree" ("expires_at");



CREATE INDEX "idx_short_links_share" ON "public"."share_short_links" USING "btree" ("share_type", "share_id");



CREATE INDEX "idx_todos_status" ON "public"."todos" USING "btree" ("status");



CREATE INDEX "idx_todos_user_due" ON "public"."todos" USING "btree" ("user_id", "due_date");



CREATE INDEX "idx_user_choice_events_created" ON "public"."user_choice_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_user_choice_events_node" ON "public"."user_choice_events" USING "btree" ("node_id");



CREATE INDEX "idx_user_choice_events_type" ON "public"."user_choice_events" USING "btree" ("event_type");



CREATE INDEX "idx_user_choice_events_user" ON "public"."user_choice_events" USING "btree" ("user_id");



CREATE INDEX "idx_user_events_client_event_id" ON "public"."user_events" USING "btree" ("client_event_id");



CREATE INDEX "idx_user_events_client_event_id_like" ON "public"."user_events" USING "btree" ("client_event_id" "text_pattern_ops");



CREATE INDEX "idx_user_events_prefix_starts_at" ON "public"."user_events" USING "btree" ("client_event_id", "starts_at");



CREATE INDEX "idx_user_events_starts_at" ON "public"."user_events" USING "btree" ("starts_at");



CREATE INDEX "idx_user_events_user_id" ON "public"."user_events" USING "btree" ("user_id");



CREATE INDEX "idx_user_events_user_starts" ON "public"."user_events" USING "btree" ("user_id", "starts_at");



CREATE INDEX "idx_user_events_user_starts_at" ON "public"."user_events" USING "btree" ("user_id", "starts_at");



CREATE INDEX "insight_posts_user_created_idx" ON "public"."insight_posts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "insight_posts_visible_created_idx" ON "public"."insight_posts" USING "btree" ("created_at" DESC) WHERE (COALESCE("is_hidden", false) = false);



CREATE INDEX "journal_entries_user_id_flow_id_greg_date_idx" ON "public"."journal_entries" USING "btree" ("user_id", "flow_id", "greg_date");



CREATE INDEX "medu_decision_matrix_user_id_idx" ON "public"."medu_decision_matrix" USING "btree" ("user_id");



CREATE INDEX "medu_dictionary_english_glosses_gin" ON "public"."medu_dictionary" USING "gin" ("english_glosses");



CREATE UNIQUE INDEX "medu_dictionary_key_uidx" ON "public"."medu_dictionary" USING "btree" ("key") WHERE ("key" IS NOT NULL);



CREATE INDEX "medu_dictionary_semantic_tags_gin" ON "public"."medu_dictionary" USING "gin" ("semantic_tags");



CREATE INDEX "memory_nodes_user_id_idx" ON "public"."memory_nodes" USING "btree" ("user_id");



CREATE INDEX "node_insight_entries_user_created_idx" ON "public"."node_insight_entries" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "node_insight_entries_user_node_date_idx" ON "public"."node_insight_entries" USING "btree" ("user_id", "node_id", "entry_date" DESC, "created_at" DESC);



CREATE INDEX "nutrition_items_user_id_idx" ON "public"."nutrition_items" USING "btree" ("user_id");



CREATE INDEX "profiles_onboarding_completed_at_idx" ON "public"."profiles" USING "btree" ("onboarding_completed_at");



CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE INDEX "push_tokens_active_idx" ON "public"."push_tokens" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "push_tokens_device_id_idx" ON "public"."push_tokens" USING "btree" ("device_id");



CREATE UNIQUE INDEX "push_tokens_device_id_key" ON "public"."push_tokens" USING "btree" ("device_id");



CREATE INDEX "push_tokens_user_id_idx" ON "public"."push_tokens" USING "btree" ("user_id");



CREATE INDEX "reminders_alert_at_idx" ON "public"."reminders" USING "btree" ("alert_at");



CREATE INDEX "reminders_due_idx" ON "public"."reminders" USING "btree" ("user_id", "status", "alert_at");



CREATE INDEX "reminders_status_idx" ON "public"."reminders" USING "btree" ("status");



CREATE INDEX "reminders_user_id_idx" ON "public"."reminders" USING "btree" ("user_id");



CREATE INDEX "shared_calendar_members_calendar_status_idx" ON "public"."shared_calendar_members" USING "btree" ("calendar_id", "status", "updated_at" DESC);



CREATE INDEX "shared_calendar_members_user_status_idx" ON "public"."shared_calendar_members" USING "btree" ("user_id", "status", "updated_at" DESC);



CREATE UNIQUE INDEX "shared_calendars_owner_personal_unique" ON "public"."shared_calendars" USING "btree" ("owner_id") WHERE (("is_personal" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "ukg_user_preferences_computed_at_idx" ON "public"."ukg_user_preferences" USING "btree" ("computed_at" DESC);



CREATE UNIQUE INDEX "uq_dec_ref_sched_user_start" ON "public"."decan_reflection_schedule" USING "btree" ("user_id", "decan_start");



CREATE UNIQUE INDEX "uq_dec_ref_user_start" ON "public"."decan_reflections" USING "btree" ("user_id", "decan_start");



CREATE UNIQUE INDEX "uq_node_links_unique" ON "public"."node_links" USING "btree" ("source_node_id", "target_node_id", COALESCE("link_phrase", ''::"text"), "link_type");



CREATE INDEX "user_app_restoration_user_scope_updated_idx" ON "public"."user_app_restoration_snapshots" USING "btree" ("user_id", "scope", "updated_at" DESC);



CREATE INDEX "user_app_restoration_user_updated_idx" ON "public"."user_app_restoration_snapshots" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "user_event_completions_flow_completed_on_idx" ON "public"."user_event_completions" USING "btree" ("flow_id", "completed_on");



CREATE UNIQUE INDEX "user_event_completions_user_client_event_uniq" ON "public"."user_event_completions" USING "btree" ("user_id", "client_event_id");



CREATE INDEX "user_event_completions_user_completed_at_idx" ON "public"."user_event_completions" USING "btree" ("user_id", "completed_at" DESC);



CREATE INDEX "user_event_completions_user_flow_client_event_idx" ON "public"."user_event_completions" USING "btree" ("user_id", "flow_id", "client_event_id");



CREATE INDEX "user_events_calendar_id_starts_at_idx" ON "public"."user_events" USING "btree" ("calendar_id", "starts_at");



CREATE UNIQUE INDEX "user_events_client_event_id_key" ON "public"."user_events" USING "btree" ("client_event_id");



CREATE INDEX "user_events_starts_at_idx" ON "public"."user_events" USING "btree" ("starts_at");



CREATE UNIQUE INDEX "user_events_uid_client_event_id_uq" ON "public"."user_events" USING "btree" (COALESCE(("user_id")::"text", ''::"text"), "client_event_id");



CREATE INDEX "user_events_user_action_id_idx" ON "public"."user_events" USING "btree" ("user_id", "action_id") WHERE ("action_id" IS NOT NULL);



CREATE UNIQUE INDEX "user_events_user_client_event_id_notnull_uidx" ON "public"."user_events" USING "btree" ("user_id", "client_event_id") WHERE ("client_event_id" IS NOT NULL);



CREATE UNIQUE INDEX "user_events_user_client_event_id_uidx" ON "public"."user_events" USING "btree" ("user_id", "client_event_id");



CREATE INDEX "user_events_user_id_flow_local_id_starts_at_idx" ON "public"."user_events" USING "btree" ("user_id", "flow_local_id", "starts_at");



CREATE INDEX "user_events_user_id_idx" ON "public"."user_events" USING "btree" ("user_id");



CREATE INDEX "user_events_user_starts_at_idx" ON "public"."user_events" USING "btree" ("user_id", "starts_at" DESC);



CREATE UNIQUE INDEX "ux_user_events_user_client_event_id" ON "public"."user_events" USING "btree" ("user_id", "client_event_id");



CREATE OR REPLACE TRIGGER "alignment_notes_set_updated_at" BEFORE UPDATE ON "public"."alignment_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "clear_import_on_flow_delete" AFTER DELETE ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."clear_flow_import_status"();



CREATE OR REPLACE TRIGGER "flows_touch_updated_at" BEFORE UPDATE ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."tg_flows_touch_updated_at"();



CREATE OR REPLACE TRIGGER "journal_entries_updated_at" BEFORE UPDATE ON "public"."journal_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_journal_updated_at"();



CREATE OR REPLACE TRIGGER "nutrition_items_updated_at" BEFORE UPDATE ON "public"."nutrition_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_nutrition_updated_at"();



CREATE OR REPLACE TRIGGER "scheduled_notifications_updated_at" BEFORE UPDATE ON "public"."scheduled_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_scheduled_notifications_updated_at"();



CREATE OR REPLACE TRIGGER "set_flow_posts_updated_at" BEFORE UPDATE ON "public"."flow_posts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_app_events_set_user_email" BEFORE INSERT ON "public"."app_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_app_event_user_email"();



CREATE OR REPLACE TRIGGER "trg_archive_deleted_user_event" BEFORE DELETE ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."archive_deleted_user_event"();



CREATE OR REPLACE TRIGGER "trg_assign_flow_calendar_id" BEFORE INSERT ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."assign_flow_calendar_id"();



CREATE OR REPLACE TRIGGER "trg_assign_user_event_calendar_id" BEFORE INSERT ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."assign_user_event_calendar_id"();



CREATE OR REPLACE TRIGGER "trg_audit_app_events" AFTER INSERT OR DELETE OR UPDATE ON "public"."app_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_row"();



CREATE OR REPLACE TRIGGER "trg_audit_flows" AFTER INSERT ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."audit_basic"();



CREATE OR REPLACE TRIGGER "trg_audit_profiles" AFTER INSERT OR DELETE OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_row"();



CREATE OR REPLACE TRIGGER "trg_audit_user_events" AFTER INSERT ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."audit_basic"();



CREATE OR REPLACE TRIGGER "trg_block_suspect_flow_inserts" BEFORE INSERT ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."block_suspect_flow_inserts"();



CREATE OR REPLACE TRIGGER "trg_enforce_user_event_flow_integrity" BEFORE INSERT OR UPDATE OF "flow_local_id", "client_event_id", "detail", "category", "action_id" ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_user_event_flow_integrity"();



CREATE OR REPLACE TRIGGER "trg_event_shares_sync_calendar_copy" AFTER INSERT OR DELETE OR UPDATE ON "public"."event_shares" FOR EACH ROW EXECUTE FUNCTION "public"."sync_event_share_calendar_copy"();



CREATE OR REPLACE TRIGGER "trg_event_shares_sync_import_marker" BEFORE INSERT OR UPDATE ON "public"."event_shares" FOR EACH ROW EXECUTE FUNCTION "public"."sync_event_share_import_marker"();



CREATE OR REPLACE TRIGGER "trg_event_shares_update_guards" BEFORE UPDATE ON "public"."event_shares" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_event_share_update_guards"();



CREATE OR REPLACE TRIGGER "trg_flows_color_biut" BEFORE INSERT OR UPDATE ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."_flows_color_biut"();



CREATE OR REPLACE TRIGGER "trg_flows_set_updated_at" BEFORE UPDATE ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_log_flow_inserts" AFTER INSERT ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."log_flow_inserts"();



CREATE OR REPLACE TRIGGER "trg_normalize_flow_visibility_state" BEFORE INSERT OR UPDATE OF "active", "is_hidden", "notes" ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_flow_visibility_state"();



CREATE OR REPLACE TRIGGER "trg_nutrition_items_updated_at" BEFORE UPDATE ON "public"."nutrition_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_set_email_ins" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_profile_email"();



CREATE OR REPLACE TRIGGER "trg_profiles_set_email_upd" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_profile_email"();



CREATE OR REPLACE TRIGGER "trg_profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_purge_deleted_flow_events" AFTER UPDATE OF "active", "is_hidden", "notes", "share_id" ON "public"."flows" FOR EACH ROW EXECUTE FUNCTION "public"."purge_deleted_flow_events"();



CREATE OR REPLACE TRIGGER "trg_push_subs_updated_at" BEFORE UPDATE ON "public"."push_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_push_tokens_updated_at" BEFORE UPDATE ON "public"."push_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_reminders_updated_at" BEFORE UPDATE ON "public"."reminders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_user_events_user" BEFORE INSERT ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_events_user_id"();



CREATE OR REPLACE TRIGGER "trg_set_user_id" BEFORE INSERT ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_id_from_auth"();



CREATE OR REPLACE TRIGGER "trg_sync_insight_post_snapshot" AFTER INSERT OR UPDATE OF "node_id", "body_text", "entry_date" ON "public"."node_insight_entries" FOR EACH ROW EXECUTE FUNCTION "public"."sync_insight_post_snapshot"();



CREATE OR REPLACE TRIGGER "trg_touch_checklist_items" BEFORE UPDATE ON "public"."checklist_items" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_cycle_adjustment_suggestions" BEFORE UPDATE ON "public"."cycle_adjustment_suggestions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_cycle_fields" BEFORE UPDATE ON "public"."cycle_fields" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_cycle_schedule_rules" BEFORE UPDATE ON "public"."cycle_schedule_rules" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_insight_links" BEFORE UPDATE ON "public"."insight_links" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_insight_posts" BEFORE UPDATE ON "public"."insight_posts" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();


CREATE OR REPLACE TRIGGER "trg_enforce_maat_guidance_delivery_caps" BEFORE INSERT OR UPDATE OF "kind", "decan_period_key", "user_id" ON "public"."maat_guidance_deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_maat_guidance_delivery_caps"();


CREATE OR REPLACE TRIGGER "trg_touch_maat_corrections" BEFORE UPDATE ON "public"."maat_corrections" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();


CREATE OR REPLACE TRIGGER "trg_touch_maat_guidance_deliveries" BEFORE UPDATE ON "public"."maat_guidance_deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();


CREATE OR REPLACE TRIGGER "trg_touch_maat_flow_briefs" BEFORE UPDATE ON "public"."maat_flow_briefs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();


CREATE OR REPLACE TRIGGER "trg_touch_maat_snapshots" BEFORE UPDATE ON "public"."maat_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();


CREATE OR REPLACE TRIGGER "trg_touch_maat_user_baselines" BEFORE UPDATE ON "public"."maat_user_baselines" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_node_insight_entries" BEFORE UPDATE ON "public"."node_insight_entries" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_node_user_content" BEFORE UPDATE ON "public"."node_user_content" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_reflection_feedback" BEFORE UPDATE ON "public"."reflection_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_reflection_generations" BEFORE UPDATE ON "public"."reflection_generations" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_reflection_profiles" BEFORE UPDATE ON "public"."reflection_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_shared_calendar_members_updated_at" BEFORE UPDATE ON "public"."shared_calendar_members" FOR EACH ROW EXECUTE FUNCTION "public"."touch_shared_calendar_members_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_shared_calendar_notifications_updated_at" BEFORE UPDATE ON "public"."shared_calendar_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_shared_calendars_updated_at" BEFORE UPDATE ON "public"."shared_calendars" FOR EACH ROW EXECUTE FUNCTION "public"."touch_shared_calendars_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_todos" BEFORE UPDATE ON "public"."todos" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_updated_at" BEFORE UPDATE ON "public"."nutrition_items" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_user_events_set_user_id" BEFORE INSERT ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_id"();



CREATE OR REPLACE TRIGGER "trg_user_events_updated_at" BEFORE UPDATE ON "public"."user_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "user_event_completions_validate_before_insert" BEFORE INSERT ON "public"."user_event_completions" FOR EACH ROW EXECUTE FUNCTION "public"."user_event_completions_validate_insert"();



ALTER TABLE ONLY "public"."alignment_notes"
    ADD CONSTRAINT "alignment_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_events"
    ADD CONSTRAINT "app_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."user_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."cycle_fields"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cycle_adjustment_suggestions"
    ADD CONSTRAINT "cycle_adjustment_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cycle_fields"
    ADD CONSTRAINT "cycle_fields_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cycle_fields"
    ADD CONSTRAINT "cycle_fields_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cycle_schedule_rules"
    ADD CONSTRAINT "cycle_schedule_rules_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."cycle_fields"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cycle_schedule_rules"
    ADD CONSTRAINT "cycle_schedule_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decan_reflection_schedule"
    ADD CONSTRAINT "decan_reflection_schedule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decan_reflections"
    ADD CONSTRAINT "decan_reflections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dm_message_likes"
    ADD CONSTRAINT "dm_message_likes_message_share_id_fkey" FOREIGN KEY ("message_share_id") REFERENCES "public"."flow_shares"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dm_message_likes"
    ADD CONSTRAINT "dm_message_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_deletion_trash"
    ADD CONSTRAINT "event_deletion_trash_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_deletion_trash"
    ADD CONSTRAINT "event_deletion_trash_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "public"."shared_calendars"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_deletion_trash"
    ADD CONSTRAINT "event_deletion_trash_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_shares"
    ADD CONSTRAINT "event_shares_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."user_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_shares"
    ADD CONSTRAINT "event_shares_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_shares"
    ADD CONSTRAINT "event_shares_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "fk_flows_share_id" FOREIGN KEY ("share_id") REFERENCES "public"."flow_shares"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flow_generation_cache"
    ADD CONSTRAINT "flow_generation_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."flow_outcomes"
    ADD CONSTRAINT "flow_outcomes_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_outcomes"
    ADD CONSTRAINT "flow_outcomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_post_comment_likes"
    ADD CONSTRAINT "flow_post_comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."flow_post_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_post_comment_likes"
    ADD CONSTRAINT "flow_post_comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_post_comments"
    ADD CONSTRAINT "flow_post_comments_flow_post_id_fkey" FOREIGN KEY ("flow_post_id") REFERENCES "public"."flow_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_post_comments"
    ADD CONSTRAINT "flow_post_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."flow_post_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_post_comments"
    ADD CONSTRAINT "flow_post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_post_likes"
    ADD CONSTRAINT "flow_post_likes_flow_post_id_fkey" FOREIGN KEY ("flow_post_id") REFERENCES "public"."flow_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_post_likes"
    ADD CONSTRAINT "flow_post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_posts"
    ADD CONSTRAINT "flow_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_saves"
    ADD CONSTRAINT "flow_saves_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_saves"
    ADD CONSTRAINT "flow_saves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_shares"
    ADD CONSTRAINT "flow_shares_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flow_shares"
    ADD CONSTRAINT "flow_shares_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flow_shares"
    ADD CONSTRAINT "flow_shares_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "flows_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "public"."shared_calendars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "flows_origin_flow_id_fkey" FOREIGN KEY ("origin_flow_id") REFERENCES "public"."flows"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "flows_origin_share_id_fkey" FOREIGN KEY ("origin_share_id") REFERENCES "public"."flow_shares"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "flows_root_flow_id_fkey" FOREIGN KEY ("root_flow_id") REFERENCES "public"."flows"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flows"
    ADD CONSTRAINT "flows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_followee_id_fkey" FOREIGN KEY ("followee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insight_links"
    ADD CONSTRAINT "insight_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insight_posts"
    ADD CONSTRAINT "insight_posts_insight_entry_id_fkey" FOREIGN KEY ("insight_entry_id") REFERENCES "public"."node_insight_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insight_posts"
    ADD CONSTRAINT "insight_posts_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insight_posts"
    ADD CONSTRAINT "insight_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journal_badges"
    ADD CONSTRAINT "journal_badges_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journal_badges"
    ADD CONSTRAINT "journal_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."maat_band_transitions"
    ADD CONSTRAINT "maat_band_transitions_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."maat_guidance_evaluations"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."maat_band_transitions"
    ADD CONSTRAINT "maat_band_transitions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."maat_snapshots"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."maat_band_transitions"
    ADD CONSTRAINT "maat_band_transitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."maat_corrections"
    ADD CONSTRAINT "maat_corrections_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."maat_snapshots"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."maat_corrections"
    ADD CONSTRAINT "maat_corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."maat_flow_briefs"
    ADD CONSTRAINT "maat_flow_briefs_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."maat_guidance_deliveries"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."maat_flow_briefs"
    ADD CONSTRAINT "maat_flow_briefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."maat_guidance_deliveries"
    ADD CONSTRAINT "maat_guidance_deliveries_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "public"."reflection_generations"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."maat_guidance_deliveries"
    ADD CONSTRAINT "maat_guidance_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."maat_guidance_evaluations"
    ADD CONSTRAINT "maat_guidance_evaluations_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."maat_snapshots"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."maat_guidance_evaluations"
    ADD CONSTRAINT "maat_guidance_evaluations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."maat_user_baselines"
    ADD CONSTRAINT "maat_user_baselines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."maat_snapshots"
    ADD CONSTRAINT "maat_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."user_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."medu_decision_matrix"
    ADD CONSTRAINT "medu_decision_matrix_dict_id_fkey" FOREIGN KEY ("dict_id") REFERENCES "public"."medu_dictionary"("id");



ALTER TABLE ONLY "public"."medu_decision_matrix"
    ADD CONSTRAINT "medu_decision_matrix_dictionary_id_fkey" FOREIGN KEY ("dictionary_id") REFERENCES "public"."medu_dictionary"("id");



ALTER TABLE ONLY "public"."medu_decision_matrix"
    ADD CONSTRAINT "medu_decision_matrix_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."medu_kg_edges"
    ADD CONSTRAINT "medu_kg_edges_target_dict_id_fkey" FOREIGN KEY ("target_dict_id") REFERENCES "public"."medu_dictionary"("id");



ALTER TABLE ONLY "public"."medu_kg_edges"
    ADD CONSTRAINT "medu_kg_edges_target_dictionary_id_fkey" FOREIGN KEY ("target_dictionary_id") REFERENCES "public"."medu_dictionary"("id");



ALTER TABLE ONLY "public"."memory_nodes"
    ADD CONSTRAINT "memory_nodes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."node_insight_entries"
    ADD CONSTRAINT "node_insight_entries_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_insight_entries"
    ADD CONSTRAINT "node_insight_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_links"
    ADD CONSTRAINT "node_links_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "public"."nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_links"
    ADD CONSTRAINT "node_links_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "public"."nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_user_content"
    ADD CONSTRAINT "node_user_content_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_user_content"
    ADD CONSTRAINT "node_user_content_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_items"
    ADD CONSTRAINT "nutrition_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reflection_feedback"
    ADD CONSTRAINT "reflection_feedback_reflection_generation_id_fkey" FOREIGN KEY ("reflection_generation_id") REFERENCES "public"."reflection_generations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reflection_feedback"
    ADD CONSTRAINT "reflection_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reflection_generations"
    ADD CONSTRAINT "reflection_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reflection_profiles"
    ADD CONSTRAINT "reflection_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_notifications"
    ADD CONSTRAINT "scheduled_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_calendar_members"
    ADD CONSTRAINT "shared_calendar_members_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "public"."shared_calendars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_calendar_members"
    ADD CONSTRAINT "shared_calendar_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shared_calendar_members"
    ADD CONSTRAINT "shared_calendar_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_calendar_notifications"
    ADD CONSTRAINT "shared_calendar_notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_calendar_notifications"
    ADD CONSTRAINT "shared_calendar_notifications_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "public"."shared_calendars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_calendar_notifications"
    ADD CONSTRAINT "shared_calendar_notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_calendars"
    ADD CONSTRAINT "shared_calendars_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_linked_field_id_fkey" FOREIGN KEY ("linked_field_id") REFERENCES "public"."cycle_fields"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ukg_user_preferences"
    ADD CONSTRAINT "ukg_user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_restoration_snapshots"
    ADD CONSTRAINT "user_app_restoration_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_choice_events"
    ADD CONSTRAINT "user_choice_events_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_choice_events"
    ADD CONSTRAINT "user_choice_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_event_completions"
    ADD CONSTRAINT "user_event_completions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_event_completions"
    ADD CONSTRAINT "user_event_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "public"."shared_calendars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_flow_fk" FOREIGN KEY ("flow_local_id") REFERENCES "public"."flows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can view flow post comment likes" ON "public"."flow_post_comment_likes" FOR SELECT USING (true);



CREATE POLICY "Anyone can view flow post comments" ON "public"."flow_post_comments" FOR SELECT USING (true);



CREATE POLICY "Anyone can view flow post likes" ON "public"."flow_post_likes" FOR SELECT USING (true);



CREATE POLICY "Anyone can view flow posts" ON "public"."flow_posts" FOR SELECT USING (true);



CREATE POLICY "Anyone can view follows" ON "public"."follows" FOR SELECT USING (true);



CREATE POLICY "Anyone can view insight posts" ON "public"."insight_posts" FOR SELECT USING (true);



CREATE POLICY "Conversation participants can like dm messages" ON "public"."dm_message_likes" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."flow_shares" "fs"
  WHERE (("fs"."id" = "dm_message_likes"."message_share_id") AND (("fs"."sender_id" = "auth"."uid"()) OR ("fs"."recipient_id" = "auth"."uid"())) AND (COALESCE(("fs"."payload_json" ->> 'type'::"text"), ("fs"."payload_json" ->> 'kind'::"text")) = 'message'::"text"))))));



CREATE POLICY "Conversation participants can view dm message likes" ON "public"."dm_message_likes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."flow_shares" "fs"
  WHERE (("fs"."id" = "dm_message_likes"."message_share_id") AND (("fs"."sender_id" = "auth"."uid"()) OR ("fs"."recipient_id" = "auth"."uid"())) AND (COALESCE(("fs"."payload_json" ->> 'type'::"text"), ("fs"."payload_json" ->> 'kind'::"text")) = 'message'::"text")))));



CREATE POLICY "Owners can delete their flow posts" ON "public"."flow_posts" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can delete their insight posts" ON "public"."insight_posts" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can update their flow posts" ON "public"."flow_posts" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can update their insight posts" ON "public"."insight_posts" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Public can view visible flow posts" ON "public"."flow_posts" FOR SELECT USING (("is_hidden" = false));



CREATE POLICY "Public profiles are viewable by everyone" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Recipients can mark event shares as viewed/imported" ON "public"."event_shares" FOR UPDATE USING (("recipient_id" = "auth"."uid"())) WITH CHECK (("recipient_id" = "auth"."uid"()));



CREATE POLICY "Recipients can mark shares as viewed/imported" ON "public"."flow_shares" FOR UPDATE USING (("recipient_id" = "auth"."uid"())) WITH CHECK (("recipient_id" = "auth"."uid"()));



CREATE POLICY "Users can comment on flow posts" ON "public"."flow_post_comments" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create event shares" ON "public"."event_shares" FOR INSERT WITH CHECK (("sender_id" = "auth"."uid"()));



CREATE POLICY "Users can create own journal entries" ON "public"."journal_entries" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create shares" ON "public"."flow_shares" FOR INSERT WITH CHECK (("sender_id" = "auth"."uid"()));



CREATE POLICY "Users can create their own flow posts" ON "public"."flow_posts" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own insight posts" ON "public"."insight_posts" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own journal entries" ON "public"."journal_entries" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own rows" ON "public"."user_events" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own notifications" ON "public"."scheduled_notifications" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can follow others" ON "public"."follows" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "follower_id") AND ("follower_id" <> "followee_id")));



CREATE POLICY "Users can insert" ON "public"."user_events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own notifications" ON "public"."scheduled_notifications" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can like flow post comments" ON "public"."flow_post_comment_likes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can like flow posts" ON "public"."flow_post_likes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own nutrition items" ON "public"."nutrition_items" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can remove their dm message likes" ON "public"."dm_message_likes" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."flow_shares" "fs"
  WHERE (("fs"."id" = "dm_message_likes"."message_share_id") AND (("fs"."sender_id" = "auth"."uid"()) OR ("fs"."recipient_id" = "auth"."uid"())) AND (COALESCE(("fs"."payload_json" ->> 'type'::"text"), ("fs"."payload_json" ->> 'kind'::"text")) = 'message'::"text"))))));



CREATE POLICY "Users can remove their flow post comment likes" ON "public"."flow_post_comment_likes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can remove their flow post comments" ON "public"."flow_post_comments" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can remove their flow post likes" ON "public"."flow_post_likes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can select own rows" ON "public"."user_events" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can unfollow" ON "public"."follows" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "follower_id"));



CREATE POLICY "Users can update own journal entries" ON "public"."journal_entries" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own rows" ON "public"."user_events" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own notifications" ON "public"."scheduled_notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own journal entries" ON "public"."journal_entries" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view received event shares" ON "public"."event_shares" FOR SELECT USING (("recipient_id" = "auth"."uid"()));



CREATE POLICY "Users can view received shares" ON "public"."flow_shares" FOR SELECT USING (("recipient_id" = "auth"."uid"()));



CREATE POLICY "Users can view sent event shares" ON "public"."event_shares" FOR SELECT USING (("sender_id" = "auth"."uid"()));



CREATE POLICY "Users can view sent shares" ON "public"."flow_shares" FOR SELECT USING (("sender_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own notifications" ON "public"."scheduled_notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."alignment_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alignment_notes_owner_only" ON "public"."alignment_notes" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."app_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_events_insert" ON "public"."app_events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "app_events_select_own" ON "public"."app_events" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."checklist_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checklist_items_owner" ON "public"."checklist_items" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."cycle_adjustment_suggestions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cycle_adjustment_suggestions_owner" ON "public"."cycle_adjustment_suggestions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."cycle_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cycle_fields_owner" ON "public"."cycle_fields" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."cycle_schedule_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cycle_schedule_rules_owner" ON "public"."cycle_schedule_rules" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."decan_reflection_schedule" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decan_reflection_schedule_insert_own" ON "public"."decan_reflection_schedule" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "decan_reflection_schedule_no_client" ON "public"."decan_reflection_schedule" USING (false) WITH CHECK (false);



CREATE POLICY "decan_reflection_schedule_select_own" ON "public"."decan_reflection_schedule" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "decan_reflection_schedule_update_own" ON "public"."decan_reflection_schedule" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."decan_reflections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decan_reflections_insert_own" ON "public"."decan_reflections" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "decan_reflections_no_client_writes" ON "public"."decan_reflections" USING (false) WITH CHECK (false);



CREATE POLICY "decan_reflections_owner_select" ON "public"."decan_reflections" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "decan_reflections_select_own" ON "public"."decan_reflections" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "del_nutrition_items" ON "public"."nutrition_items" FOR DELETE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."dm_message_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_deletion_trash" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_shares_update_sender_or_recipient" ON "public"."event_shares" FOR UPDATE USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "recipient_id")));



CREATE POLICY "events insert" ON "public"."app_events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "events select own" ON "public"."app_events" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "events select svc" ON "public"."app_events" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "events_select" ON "public"."user_events" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."flow_generation_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "flow_generation_cache_insert_service" ON "public"."flow_generation_cache" FOR INSERT TO "service_role" WITH CHECK (true);



ALTER TABLE "public"."flow_generation_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "flow_generation_logs_insert_owner" ON "public"."flow_generation_logs" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "public"."current_user_id"()));



CREATE POLICY "flow_generation_logs_select_owner" ON "public"."flow_generation_logs" FOR SELECT TO "authenticated" USING (("user_id" = "public"."current_user_id"()));



ALTER TABLE "public"."flow_outcomes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "flow_outcomes_delete_own" ON "public"."flow_outcomes" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "flow_outcomes_insert_own" ON "public"."flow_outcomes" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "flow_outcomes_select_own" ON "public"."flow_outcomes" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "flow_outcomes_update_own" ON "public"."flow_outcomes" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."flow_post_comment_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flow_post_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flow_post_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flow_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flow_saves" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "flow_saves_delete_own" ON "public"."flow_saves" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "flow_saves_insert_own" ON "public"."flow_saves" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "flow_saves_select_own" ON "public"."flow_saves" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "flow_saves_update_own" ON "public"."flow_saves" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."flow_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "flow_shares_update_sender_or_recipient" ON "public"."flow_shares" FOR UPDATE USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "recipient_id")));



ALTER TABLE "public"."flows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "flows_delete_calendar_editor" ON "public"."flows" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
  WHERE (("scm"."calendar_id" = "flows"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"])) AND ("sc"."deleted_at" IS NULL)))));



CREATE POLICY "flows_insert_calendar_member" ON "public"."flows" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
  WHERE (("scm"."calendar_id" = "flows"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"])) AND ("sc"."deleted_at" IS NULL))))));



CREATE POLICY "flows_select_visible" ON "public"."flows" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
  WHERE (("scm"."calendar_id" = "flows"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("sc"."deleted_at" IS NULL)))) OR (EXISTS ( SELECT 1
   FROM "public"."flow_shares" "fs"
  WHERE (("fs"."flow_id" = "flows"."id") AND (("fs"."sender_id" = "auth"."uid"()) OR ("fs"."recipient_id" = "auth"."uid"())))))));



CREATE POLICY "flows_update_calendar_editor" ON "public"."flows" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
  WHERE (("scm"."calendar_id" = "flows"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"])) AND ("sc"."deleted_at" IS NULL))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."shared_calendar_members" "scm"
     JOIN "public"."shared_calendars" "sc" ON (("sc"."id" = "scm"."calendar_id")))
  WHERE (("scm"."calendar_id" = "flows"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"])) AND ("sc"."deleted_at" IS NULL)))));



ALTER TABLE "public"."follows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ins_nutrition_items" ON "public"."nutrition_items" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."insight_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insight_links owner" ON "public"."insight_links" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."insight_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."journal_badges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "journal_badges_owner_del" ON "public"."journal_badges" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "journal_badges_owner_ins" ON "public"."journal_badges" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "journal_badges_owner_select" ON "public"."journal_badges" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "journal_badges_owner_upd" ON "public"."journal_badges" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."maat_band_transitions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maat_band_transitions owner select" ON "public"."maat_band_transitions" FOR SELECT USING (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."maat_corrections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maat_corrections owner select" ON "public"."maat_corrections" FOR SELECT USING (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."maat_guidance_deliveries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maat_guidance_deliveries owner select" ON "public"."maat_guidance_deliveries" FOR SELECT USING (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."maat_flow_briefs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maat_flow_briefs owner select" ON "public"."maat_flow_briefs" FOR SELECT USING (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."maat_guidance_evaluations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maat_guidance_evaluations owner select" ON "public"."maat_guidance_evaluations" FOR SELECT USING (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."maat_user_baselines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maat_user_baselines owner select" ON "public"."maat_user_baselines" FOR SELECT USING (("auth"."uid"() = "user_id"));


ALTER TABLE "public"."maat_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maat_snapshots owner select" ON "public"."maat_snapshots" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."journal_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."node_insight_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "node_insight_entries owner" ON "public"."node_insight_entries" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."node_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "node_links no user writes" ON "public"."node_links" USING (false) WITH CHECK (false);



CREATE POLICY "node_links readable" ON "public"."node_links" FOR SELECT USING (true);



ALTER TABLE "public"."node_user_content" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "node_user_content owner" ON "public"."node_user_content" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "nodes no user writes" ON "public"."nodes" USING (false) WITH CHECK (false);



CREATE POLICY "nodes readable" ON "public"."nodes" FOR SELECT USING (true);



ALTER TABLE "public"."nutrition_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "nutrition_items_delete" ON "public"."nutrition_items" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "nutrition_items_insert" ON "public"."nutrition_items" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "nutrition_items_select" ON "public"."nutrition_items" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "nutrition_items_update" ON "public"."nutrition_items" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subscriptions delete own" ON "public"."push_subscriptions" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "push_subscriptions insert own" ON "public"."push_subscriptions" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "push_subscriptions select own" ON "public"."push_subscriptions" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "push_subscriptions update own" ON "public"."push_subscriptions" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_tokens delete own" ON "public"."push_tokens" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "push_tokens insert own" ON "public"."push_tokens" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "push_tokens select own" ON "public"."push_tokens" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "push_tokens update own" ON "public"."push_tokens" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "push_tokens_delete_own" ON "public"."push_tokens" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "push_tokens_insert_own" ON "public"."push_tokens" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "push_tokens_select_own" ON "public"."push_tokens" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "push_tokens_update_own" ON "public"."push_tokens" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "read own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."reflection_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reflection_feedback owner" ON "public"."reflection_feedback" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."reflection_generations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reflection_generations owner" ON "public"."reflection_generations" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."reflection_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reflection_profiles owner" ON "public"."reflection_profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reminders delete own" ON "public"."reminders" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "reminders insert own" ON "public"."reminders" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "reminders select own" ON "public"."reminders" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "reminders update own" ON "public"."reminders" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."scheduled_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sel_nutrition_items" ON "public"."nutrition_items" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."shared_calendar_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shared_calendar_members_select_visible" ON "public"."shared_calendar_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."can_view_shared_calendar_member_row"("calendar_id", "status")));



ALTER TABLE "public"."shared_calendar_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shared_calendar_notifications_select_own" ON "public"."shared_calendar_notifications" FOR SELECT TO "authenticated" USING (("recipient_id" = "auth"."uid"()));



CREATE POLICY "shared_calendar_notifications_update_own" ON "public"."shared_calendar_notifications" FOR UPDATE TO "authenticated" USING (("recipient_id" = "auth"."uid"())) WITH CHECK (("recipient_id" = "auth"."uid"()));



ALTER TABLE "public"."shared_calendars" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shared_calendars_select_member" ON "public"."shared_calendars" FOR SELECT USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."shared_calendar_members" "scm"
  WHERE (("scm"."calendar_id" = "shared_calendars"."id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = ANY (ARRAY['pending'::"text", 'accepted'::"text"])))))));



CREATE POLICY "svc can read audit" ON "public"."audit_log" FOR SELECT TO "service_role" USING (true);



ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "todos_owner" ON "public"."todos" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "ue_delete_own" ON "public"."user_events" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ue_insert_own" ON "public"."user_events" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ue_select_own" ON "public"."user_events" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ue_update_own" ON "public"."user_events" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."ukg_user_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ukg_user_preferences_insert_own" ON "public"."ukg_user_preferences" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "ukg_user_preferences_select_own" ON "public"."ukg_user_preferences" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "ukg_user_preferences_update_own" ON "public"."ukg_user_preferences" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "upd_nutrition_items" ON "public"."nutrition_items" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "upsert own profile" ON "public"."profiles" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "user_app_restoration_delete_own" ON "public"."user_app_restoration_snapshots" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_app_restoration_insert_own" ON "public"."user_app_restoration_snapshots" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_app_restoration_select_own" ON "public"."user_app_restoration_snapshots" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."user_app_restoration_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_app_restoration_update_own" ON "public"."user_app_restoration_snapshots" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."user_choice_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_choice_events owner" ON "public"."user_choice_events" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_event_completions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_event_completions_delete_own" ON "public"."user_event_completions" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_event_completions_insert_own" ON "public"."user_event_completions" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_event_completions_select_own" ON "public"."user_event_completions" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_event_completions_update_own" ON "public"."user_event_completions" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_events_delete_own" ON "public"."user_events" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_events_delete_shared_calendars" ON "public"."user_events" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."shared_calendar_members" "scm"
  WHERE (("scm"."calendar_id" = "user_events"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "user_events_insert_own" ON "public"."user_events" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_events_insert_owned_or_imported" ON "public"."user_events" FOR INSERT WITH CHECK (("flow_local_id" IN ( SELECT "flows"."id"
   FROM "public"."flows"
  WHERE ("flows"."user_id" = "auth"."uid"()))));



CREATE POLICY "user_events_insert_shared_calendars" ON "public"."user_events" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."shared_calendar_members" "scm"
  WHERE (("scm"."calendar_id" = "user_events"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"])))))));



CREATE POLICY "user_events_select_direct_event_shares" ON "public"."user_events" FOR SELECT USING (("id" IN ( SELECT "event_shares"."event_id"
   FROM "public"."event_shares"
  WHERE (("event_shares"."recipient_id" = "auth"."uid"()) OR ("event_shares"."sender_id" = "auth"."uid"())))));



CREATE POLICY "user_events_select_own" ON "public"."user_events" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_events_select_shared_calendars" ON "public"."user_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shared_calendar_members" "scm"
  WHERE (("scm"."calendar_id" = "user_events"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text")))));



CREATE POLICY "user_events_select_shared_flow_events" ON "public"."user_events" FOR SELECT USING (("flow_local_id" IN ( SELECT "flow_shares"."flow_id"
   FROM "public"."flow_shares"
  WHERE (("flow_shares"."recipient_id" = "auth"."uid"()) OR ("flow_shares"."sender_id" = "auth"."uid"())))));



CREATE POLICY "user_events_update_own" ON "public"."user_events" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_events_update_owned" ON "public"."user_events" FOR UPDATE USING (("flow_local_id" IN ( SELECT "flows"."id"
   FROM "public"."flows"
  WHERE ("flows"."user_id" = "auth"."uid"())))) WITH CHECK (("flow_local_id" IN ( SELECT "flows"."id"
   FROM "public"."flows"
  WHERE ("flows"."user_id" = "auth"."uid"()))));



CREATE POLICY "user_events_update_shared_calendars" ON "public"."user_events" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."shared_calendar_members" "scm"
  WHERE (("scm"."calendar_id" = "user_events"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."shared_calendar_members" "scm"
  WHERE (("scm"."calendar_id" = "user_events"."calendar_id") AND ("scm"."user_id" = "auth"."uid"()) AND ("scm"."status" = 'accepted'::"text") AND ("scm"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



ALTER TABLE "public"."user_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_state_insert_self" ON "public"."user_state" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_state_select_own" ON "public"."user_state" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_state_update_own" ON "public"."user_state" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."user_events";






GRANT USAGE ON SCHEMA "api" TO "anon";
GRANT USAGE ON SCHEMA "api" TO "authenticated";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT USAGE ON SCHEMA "private" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."_coerce_color_24bit_text"("p_txt" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_coerce_color_24bit_text"("p_txt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_coerce_color_24bit_text"("p_txt" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_flows_color_biut"() TO "anon";
GRANT ALL ON FUNCTION "public"."_flows_color_biut"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_flows_color_biut"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."_get_user_timezone"("p_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_get_user_timezone"("p_uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_user_timezone"("p_uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_user_timezone"("p_uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_is_personalization_enabled"("p_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_is_personalization_enabled"("p_uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_is_personalization_enabled"("p_uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_personalization_enabled"("p_uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."archive_deleted_user_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."archive_deleted_user_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_deleted_user_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_flow_calendar_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_flow_calendar_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_flow_calendar_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_user_event_calendar_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_user_event_calendar_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_user_event_calendar_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_basic"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_basic"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_basic"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_basic"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_log_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_row"() TO "service_role";



GRANT ALL ON FUNCTION "public"."block_suspect_flow_inserts"() TO "anon";
GRANT ALL ON FUNCTION "public"."block_suspect_flow_inserts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."block_suspect_flow_inserts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_shared_calendar_members"("p_calendar_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_shared_calendar_members"("p_calendar_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_shared_calendar_members"("p_calendar_id" "uuid") TO "service_role";


GRANT ALL ON FUNCTION "public"."can_view_shared_calendar_member_row"("p_calendar_id" "uuid", "p_member_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_shared_calendar_member_row"("p_calendar_id" "uuid", "p_member_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_shared_calendar_member_row"("p_calendar_id" "uuid", "p_member_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_due_decan_reflection_schedule"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_due_decan_reflection_schedule"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_due_decan_reflection_schedule"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_due_decan_reflection_schedule"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_due_scheduled_notifications"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_due_scheduled_notifications"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_due_scheduled_notifications"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_due_scheduled_notifications"("p_now" timestamp with time zone, "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_event_share_import_tombstone"("p_user_id" "uuid", "p_share_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clear_event_share_import_tombstone"("p_user_id" "uuid", "p_share_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_event_share_import_tombstone"("p_user_id" "uuid", "p_share_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_flow_import_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."clear_flow_import_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_flow_import_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_flow_import_status_by_share_id"("p_share_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clear_flow_import_status_by_share_id"("p_share_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_flow_import_status_by_share_id"("p_share_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_flow_outcome"("p_flow_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_flow_outcome"("p_flow_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_flow_outcome"("p_flow_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_flow_outcome"("p_flow_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_user_preferences"("p_window_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_user_preferences"("p_window_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_user_preferences"("p_window_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_user_preferences"("p_window_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_user_preferences_for"("p_user_id" "uuid", "p_window_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_user_preferences_for"("p_user_id" "uuid", "p_window_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_user_preferences_for"("p_user_id" "uuid", "p_window_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_user_preferences_for"("p_user_id" "uuid", "p_window_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_user_preferences_impl"("p_uid" "uuid", "p_window_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_user_preferences_impl"("p_uid" "uuid", "p_window_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_user_preferences_impl"("p_uid" "uuid", "p_window_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_shared_calendar"("p_name" "text", "p_color" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."create_shared_calendar"("p_name" "text", "p_color" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_shared_calendar"("p_name" "text", "p_color" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_push_subscription"("sub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_push_subscription"("sub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_push_subscription"("sub_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_events_by_category_semantic"("p_category" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_events_by_category_semantic"("p_category" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_category_semantic"("p_category" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_category_semantic"("p_category" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_events_by_client_id_prefix_semantic"("p_client_event_id_prefix" "text", "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_events_by_client_id_prefix_semantic"("p_client_event_id_prefix" "text", "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_client_id_prefix_semantic"("p_client_event_id_prefix" "text", "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_client_id_prefix_semantic"("p_client_event_id_prefix" "text", "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_events_by_client_id_semantic"("p_client_event_id" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_events_by_client_id_semantic"("p_client_event_id" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_client_id_semantic"("p_client_event_id" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_client_id_semantic"("p_client_event_id" "text", "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_events_by_flow_semantic"("p_flow_id" bigint, "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_events_by_flow_semantic"("p_flow_id" bigint, "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_flow_semantic"("p_flow_id" bigint, "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_flow_semantic"("p_flow_id" bigint, "p_from_utc" timestamp with time zone, "p_until_utc" timestamp with time zone, "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_events_by_ids_semantic"("p_ids" "text"[], "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_events_by_ids_semantic"("p_ids" "text"[], "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_ids_semantic"("p_ids" "text"[], "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_events_by_ids_semantic"("p_ids" "text"[], "p_delete_semantic" "text", "p_suppresses_client" boolean, "p_source_feature" "text", "p_delete_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dm_user_pref_candidates"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dm_user_pref_candidates"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dm_user_pref_candidates"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dm_user_pref_candidates"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."end_flow"("p_flow_id" bigint, "p_ended_at" timestamp with time zone, "p_ended_on" "date", "p_delete_all_materialized" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."end_flow"("p_flow_id" bigint, "p_ended_at" timestamp with time zone, "p_ended_on" "date", "p_delete_all_materialized" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."end_flow"("p_flow_id" bigint, "p_ended_at" timestamp with time zone, "p_ended_on" "date", "p_delete_all_materialized" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."end_flow"("p_flow_id" bigint, "p_ended_at" timestamp with time zone, "p_ended_on" "date", "p_delete_all_materialized" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_event_share_update_guards"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_event_share_update_guards"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_event_share_update_guards"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_user_event_flow_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_user_event_flow_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_user_event_flow_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_personal_calendar_for_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_personal_calendar_for_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_personal_calendar_for_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."event_share_flow_import_client_event_prefix"("p_share_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."event_share_flow_import_client_event_prefix"("p_share_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."event_share_flow_import_client_event_prefix"("p_share_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."event_share_import_client_event_id"("p_share_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."event_share_import_client_event_id"("p_share_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."event_share_import_client_event_id"("p_share_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."event_share_rewrite_reminder_notes"("p_raw_notes" "text", "p_imported_reminder_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."event_share_rewrite_reminder_notes"("p_raw_notes" "text", "p_imported_reminder_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."event_share_rewrite_reminder_notes"("p_raw_notes" "text", "p_imported_reminder_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."event_share_source_flow_payload"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."event_share_source_flow_payload"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."event_share_source_flow_payload"("p_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fill_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."fill_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fill_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_action_ids_from_metadata"("p_ai_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_action_ids_from_metadata"("p_ai_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_action_ids_from_metadata"("p_ai_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."flow_commit"("p_generation_id" "uuid", "p_flow_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."flow_commit"("p_generation_id" "uuid", "p_flow_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."flow_commit"("p_generation_id" "uuid", "p_flow_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_commit"("p_generation_id" "uuid", "p_flow_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_guard_enabled"() TO "anon";
GRANT ALL ON FUNCTION "public"."flow_guard_enabled"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_guard_enabled"() TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_has_repeating_note_metadata"("p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_has_repeating_note_metadata"("p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_has_repeating_note_metadata"("p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_id_from_action_id"("p_user_id" "uuid", "p_action_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_id_from_action_id"("p_user_id" "uuid", "p_action_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_id_from_action_id"("p_user_id" "uuid", "p_action_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_id_from_client_event_id"("p_client_event_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_id_from_client_event_id"("p_client_event_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_id_from_client_event_id"("p_client_event_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_id_from_detail_metadata"("p_detail" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_id_from_detail_metadata"("p_detail" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_id_from_detail_metadata"("p_detail" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_is_calendar_placed"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_is_calendar_placed"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_is_calendar_placed"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_is_deleted_state"("p_is_hidden" boolean, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_is_deleted_state"("p_is_hidden" boolean, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_is_deleted_state"("p_is_hidden" boolean, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_is_deleted_state"("p_active" boolean, "p_is_hidden" boolean, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_is_deleted_state"("p_active" boolean, "p_is_hidden" boolean, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_is_deleted_state"("p_active" boolean, "p_is_hidden" boolean, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_is_schedule_open"("p_end_date" "date", "p_timezone" "text", "p_now" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."flow_is_schedule_open"("p_end_date" "date", "p_timezone" "text", "p_now" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_is_schedule_open"("p_end_date" "date", "p_timezone" "text", "p_now" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_metadata_has_action_id"("p_ai_metadata" "jsonb", "p_action_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_metadata_has_action_id"("p_ai_metadata" "jsonb", "p_action_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_metadata_has_action_id"("p_ai_metadata" "jsonb", "p_action_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."flow_outcome_candidates"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."flow_outcome_candidates"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."flow_outcome_candidates"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_outcome_candidates"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."flow_record_kind"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flow_record_kind"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flow_record_kind"("p_active" boolean, "p_is_hidden" boolean, "p_is_reminder" boolean, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_ai_quota_check_and_inc"("p_user_id" "uuid", "p_day" "date", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_ai_quota_check_and_inc"("p_user_id" "uuid", "p_day" "date", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_ai_quota_check_and_inc"("p_user_id" "uuid", "p_day" "date", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_audit_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_row"() TO "service_role";



GRANT ALL ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_due_reminders"("now_utc" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_due_reminders"("now_utc" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_due_reminders"("now_utc" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_flow_post_feed"("p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_flow_post_feed"("p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_flow_post_feed"("p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_flow_post_feed"("p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_flow_activity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_flow_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_flow_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_flow_activity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_preferences"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_preferences"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_telemetry_and_personalization"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_telemetry_and_personalization"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_telemetry_and_personalization"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_telemetry_and_personalization"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_profile_feed"("p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profile_feed"("p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_profile_feed"("p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_feed"("p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_profile_flow_counts"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profile_flow_counts"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_profile_flow_counts"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_flow_counts"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_recent_outcome_vectors"("p_user_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_recent_outcome_vectors"("p_user_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_recent_outcome_vectors"("p_user_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recent_outcome_vectors"("p_user_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."invite_user_to_shared_calendar"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."invite_user_to_shared_calendar"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invite_user_to_shared_calendar"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."leave_shared_calendar"("p_calendar_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."leave_shared_calendar"("p_calendar_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_shared_calendar"("p_calendar_id" "uuid") TO "service_role";


GRANT ALL ON FUNCTION "public"."list_shared_calendar_members"("p_calendar_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."list_shared_calendar_members"("p_calendar_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_shared_calendar_members"("p_calendar_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_flow_inserts"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_flow_inserts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_flow_inserts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_reminder_status"("reminder_id" "uuid", "new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_reminder_status"("reminder_id" "uuid", "new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_reminder_status"("reminder_id" "uuid", "new_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_flow_visibility_state"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_flow_visibility_state"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_flow_visibility_state"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_shared_calendar_members"("p_calendar_id" "uuid", "p_recipient_ids" "uuid"[], "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_shared_calendar_members"("p_calendar_id" "uuid", "p_recipient_ids" "uuid"[], "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_shared_calendar_members"("p_calendar_id" "uuid", "p_recipient_ids" "uuid"[], "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_stale_reminder_occurrences"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_stale_reminder_occurrences"() TO "anon";
GRANT ALL ON FUNCTION "public"."prune_stale_reminder_occurrences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prune_stale_reminder_occurrences"() TO "service_role";



GRANT ALL ON FUNCTION "public"."purge_deleted_flow_events"() TO "anon";
GRANT ALL ON FUNCTION "public"."purge_deleted_flow_events"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_deleted_flow_events"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_old_event_deletion_trash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_old_event_deletion_trash"() TO "anon";
GRANT ALL ON FUNCTION "public"."purge_old_event_deletion_trash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_old_event_deletion_trash"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_event_filing_backbone"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_event_filing_backbone"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_event_filing_backbone"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_event_filing_backbone"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_event_completion"("p_client_event_id" "text", "p_flow_id" bigint, "p_completed_on" "date", "p_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_event_completion"("p_client_event_id" "text", "p_flow_id" bigint, "p_completed_on" "date", "p_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_event_completion"("p_client_event_id" "text", "p_flow_id" bigint, "p_completed_on" "date", "p_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_event_completion"("p_client_event_id" "text", "p_flow_id" bigint, "p_completed_on" "date", "p_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_user_event_tombstone"("p_client_event_id" "text", "p_calendar_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_user_event_tombstone"("p_client_event_id" "text", "p_calendar_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_user_event_tombstone"("p_client_event_id" "text", "p_calendar_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_user_event_tombstone"("p_client_event_id" "text", "p_calendar_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."repair_active_reminder_filing_backbone"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."repair_active_reminder_filing_backbone"() TO "anon";
GRANT ALL ON FUNCTION "public"."repair_active_reminder_filing_backbone"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."repair_active_reminder_filing_backbone"() TO "service_role";



GRANT ALL ON FUNCTION "public"."respond_to_shared_calendar_invite"("p_calendar_id" "uuid", "p_accept" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."respond_to_shared_calendar_invite"("p_calendar_id" "uuid", "p_accept" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."respond_to_shared_calendar_invite"("p_calendar_id" "uuid", "p_accept" boolean) TO "service_role";


GRANT ALL ON FUNCTION "public"."remove_shared_calendar_member"("p_calendar_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_shared_calendar_member"("p_calendar_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_shared_calendar_member"("p_calendar_id" "uuid", "p_user_id" "uuid") TO "service_role";


GRANT ALL ON FUNCTION "public"."revoke_shared_calendar_invite"("p_calendar_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."revoke_shared_calendar_invite"("p_calendar_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_shared_calendar_invite"("p_calendar_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_app_event_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_app_event_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_app_event_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_app_event_user_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_app_event_user_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_app_event_user_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_profile_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_profile_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_profile_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_user_events_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_user_events_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_events_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_user_id_from_auth"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_user_id_from_auth"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_id_from_auth"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_event_share_calendar_copy"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_event_share_calendar_copy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_event_share_calendar_copy"() TO "service_role";



GRANT ALL ON TABLE "public"."event_shares" TO "anon";
GRANT ALL ON TABLE "public"."event_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."event_shares" TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_event_share_calendar_copy_from_row"("p_share" "public"."event_shares") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_event_share_calendar_copy_from_row"("p_share" "public"."event_shares") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_event_share_calendar_copy_from_row"("p_share" "public"."event_shares") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_event_share_import_marker"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_event_share_import_marker"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_event_share_import_marker"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_insight_post_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_insight_post_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_insight_post_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_flows_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_flows_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_flows_touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_shared_calendar_members_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_shared_calendar_members_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_shared_calendar_members_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_shared_calendars_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_shared_calendars_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_shared_calendars_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."try_parse_bigint"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."try_parse_bigint"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_parse_bigint"("p_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."try_parse_date"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."try_parse_date"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_parse_date"("p_value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."try_parse_jsonb"("p_raw" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."try_parse_jsonb"("p_raw" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."try_parse_jsonb"("p_raw" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_parse_jsonb"("p_raw" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."try_parse_timestamptz"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."try_parse_timestamptz"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_parse_timestamptz"("p_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_journal_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_journal_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_journal_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_nutrition_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_nutrition_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_nutrition_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_scheduled_notifications_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_scheduled_notifications_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_scheduled_notifications_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_shared_calendar"("p_calendar_id" "uuid", "p_name" "text", "p_color" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."update_shared_calendar"("p_calendar_id" "uuid", "p_name" "text", "p_color" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_shared_calendar"("p_calendar_id" "uuid", "p_name" "text", "p_color" bigint) TO "service_role";


GRANT ALL ON FUNCTION "public"."update_shared_calendar_member_role"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_shared_calendar_member_role"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_shared_calendar_member_role"("p_calendar_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_event_active_until"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_active_until"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_active_until"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_event_completions_validate_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_completions_validate_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_completions_validate_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_event_date_lifecycle"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_now" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_date_lifecycle"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_now" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_date_lifecycle"("p_user_id" "uuid", "p_all_day" boolean, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_now" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_event_has_active_reminder_flow"("p_user_id" "uuid", "p_reminder_uuid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_event_has_active_reminder_flow"("p_user_id" "uuid", "p_reminder_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_has_active_reminder_flow"("p_user_id" "uuid", "p_reminder_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_has_active_reminder_flow"("p_user_id" "uuid", "p_reminder_uuid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_event_has_active_reminder_flow_for_occurrence"("p_user_id" "uuid", "p_client_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_event_has_active_reminder_flow_for_occurrence"("p_user_id" "uuid", "p_client_event_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_has_active_reminder_flow_for_occurrence"("p_user_id" "uuid", "p_client_event_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_has_active_reminder_flow_for_occurrence"("p_user_id" "uuid", "p_client_event_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_event_matches_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text", "p_action_id" "text", "p_flow_ai_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_matches_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text", "p_action_id" "text", "p_flow_ai_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_matches_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text", "p_action_id" "text", "p_flow_ai_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_event_recently_deleted"("p_user_id" "uuid", "p_client_event_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_recently_deleted"("p_user_id" "uuid", "p_client_event_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_recently_deleted"("p_user_id" "uuid", "p_client_event_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_event_referenced_flow_id"("p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_referenced_flow_id"("p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_referenced_flow_id"("p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_event_references_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_references_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_references_flow"("p_flow_id" bigint, "p_flow_local_id" bigint, "p_client_event_id" "text", "p_detail" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_event_reminder_occurrence_date"("p_client_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_event_reminder_occurrence_date"("p_client_event_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_reminder_occurrence_date"("p_client_event_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_reminder_occurrence_date"("p_client_event_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_event_reminder_uuid"("p_client_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_event_reminder_uuid"("p_client_event_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_event_reminder_uuid"("p_client_event_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_event_reminder_uuid"("p_client_event_id" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."flow_posts" TO "anon";
GRANT ALL ON TABLE "public"."flow_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_posts" TO "service_role";



GRANT ALL ON TABLE "public"."flow_shares" TO "anon";
GRANT ALL ON TABLE "public"."flow_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_shares" TO "service_role";



GRANT ALL ON TABLE "public"."flows" TO "anon";
GRANT ALL ON TABLE "public"."flows" TO "authenticated";
GRANT ALL ON TABLE "public"."flows" TO "service_role";



GRANT ALL ON TABLE "public"."scheduled_notifications" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."shared_calendars" TO "anon";
GRANT ALL ON TABLE "public"."shared_calendars" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_calendars" TO "service_role";



GRANT ALL ON TABLE "public"."user_events" TO "anon";
GRANT ALL ON TABLE "public"."user_events" TO "authenticated";
GRANT ALL ON TABLE "public"."user_events" TO "service_role";



GRANT SELECT ON TABLE "private"."user_event_filing_items_internal" TO "service_role";



GRANT ALL ON TABLE "public"."user_event_completions" TO "anon";
GRANT ALL ON TABLE "public"."user_event_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_event_completions" TO "service_role";



GRANT SELECT ON TABLE "private"."flow_filing_items_internal" TO "service_role";



GRANT ALL ON TABLE "public"."alignment_notes" TO "anon";
GRANT ALL ON TABLE "public"."alignment_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."alignment_notes" TO "service_role";



GRANT ALL ON TABLE "public"."app_events" TO "anon";
GRANT ALL ON TABLE "public"."app_events" TO "authenticated";
GRANT ALL ON TABLE "public"."app_events" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."backup_user_events_cid_only" TO "anon";
GRANT ALL ON TABLE "public"."backup_user_events_cid_only" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_user_events_cid_only" TO "service_role";



GRANT ALL ON TABLE "public"."backup_user_events_flow_fix" TO "anon";
GRANT ALL ON TABLE "public"."backup_user_events_flow_fix" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_user_events_flow_fix" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_items" TO "anon";
GRANT ALL ON TABLE "public"."checklist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_items" TO "service_role";



GRANT ALL ON TABLE "public"."cycle_adjustment_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."cycle_adjustment_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."cycle_adjustment_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."cycle_fields" TO "anon";
GRANT ALL ON TABLE "public"."cycle_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."cycle_fields" TO "service_role";



GRANT ALL ON TABLE "public"."cycle_schedule_rules" TO "anon";
GRANT ALL ON TABLE "public"."cycle_schedule_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."cycle_schedule_rules" TO "service_role";



GRANT ALL ON TABLE "public"."decan_reflection_schedule" TO "anon";
GRANT ALL ON TABLE "public"."decan_reflection_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."decan_reflection_schedule" TO "service_role";



GRANT ALL ON TABLE "public"."decan_reflections" TO "anon";
GRANT ALL ON TABLE "public"."decan_reflections" TO "authenticated";
GRANT ALL ON TABLE "public"."decan_reflections" TO "service_role";



GRANT ALL ON TABLE "public"."dm_message_likes" TO "anon";
GRANT ALL ON TABLE "public"."dm_message_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."dm_message_likes" TO "service_role";



GRANT ALL ON TABLE "public"."event_deletion_trash" TO "service_role";



GRANT ALL ON TABLE "public"."flow_saves" TO "anon";
GRANT ALL ON TABLE "public"."flow_saves" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_saves" TO "service_role";



GRANT ALL ON TABLE "public"."shared_calendar_members" TO "anon";
GRANT ALL ON TABLE "public"."shared_calendar_members" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_calendar_members" TO "service_role";



GRANT ALL ON TABLE "public"."user_event_filing_items_client" TO "service_role";
GRANT SELECT ON TABLE "public"."user_event_filing_items_client" TO "authenticated";



GRANT ALL ON TABLE "public"."flow_filing_items_client" TO "service_role";
GRANT SELECT ON TABLE "public"."flow_filing_items_client" TO "authenticated";



GRANT ALL ON TABLE "public"."flow_generation_cache" TO "anon";
GRANT ALL ON TABLE "public"."flow_generation_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_generation_cache" TO "service_role";



GRANT ALL ON SEQUENCE "public"."flow_generation_cache_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."flow_generation_cache_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."flow_generation_cache_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flow_generation_logs" TO "anon";
GRANT ALL ON TABLE "public"."flow_generation_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_generation_logs" TO "service_role";



GRANT ALL ON TABLE "public"."flow_generation_daily_analytics" TO "anon";
GRANT ALL ON TABLE "public"."flow_generation_daily_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_generation_daily_analytics" TO "service_role";



GRANT ALL ON SEQUENCE "public"."flow_generation_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."flow_generation_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."flow_generation_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flow_insert_blocklist" TO "anon";
GRANT ALL ON TABLE "public"."flow_insert_blocklist" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_insert_blocklist" TO "service_role";



GRANT ALL ON TABLE "public"."flow_insert_debug" TO "anon";
GRANT ALL ON TABLE "public"."flow_insert_debug" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_insert_debug" TO "service_role";



GRANT ALL ON SEQUENCE "public"."flow_insert_debug_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."flow_insert_debug_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."flow_insert_debug_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flow_insert_guard_flag" TO "anon";
GRANT ALL ON TABLE "public"."flow_insert_guard_flag" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_insert_guard_flag" TO "service_role";



GRANT ALL ON TABLE "public"."flow_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."flow_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_outcomes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."flow_outcomes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."flow_outcomes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."flow_outcomes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flow_post_comment_likes" TO "anon";
GRANT ALL ON TABLE "public"."flow_post_comment_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_post_comment_likes" TO "service_role";



GRANT ALL ON TABLE "public"."flow_post_comments" TO "anon";
GRANT ALL ON TABLE "public"."flow_post_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_post_comments" TO "service_role";



GRANT ALL ON TABLE "public"."flow_post_likes" TO "anon";
GRANT ALL ON TABLE "public"."flow_post_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."flow_post_likes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."flow_saves_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."flow_saves_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."flow_saves_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flows_color_debug" TO "anon";
GRANT ALL ON TABLE "public"."flows_color_debug" TO "authenticated";
GRANT ALL ON TABLE "public"."flows_color_debug" TO "service_role";



GRANT ALL ON SEQUENCE "public"."flows_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."flows_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."flows_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flows_with_calendars" TO "anon";
GRANT ALL ON TABLE "public"."flows_with_calendars" TO "authenticated";
GRANT ALL ON TABLE "public"."flows_with_calendars" TO "service_role";



GRANT ALL ON TABLE "public"."follows" TO "anon";
GRANT ALL ON TABLE "public"."follows" TO "authenticated";
GRANT ALL ON TABLE "public"."follows" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."inbox_share_items" TO "anon";
GRANT ALL ON TABLE "public"."inbox_share_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inbox_share_items" TO "service_role";



GRANT ALL ON TABLE "public"."shared_calendar_notifications" TO "anon";
GRANT ALL ON TABLE "public"."shared_calendar_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_calendar_notifications" TO "service_role";



GRANT UPDATE("viewed_at") ON TABLE "public"."shared_calendar_notifications" TO "authenticated";



GRANT UPDATE("deleted_at") ON TABLE "public"."shared_calendar_notifications" TO "authenticated";



GRANT ALL ON TABLE "public"."inbox_share_items_filtered" TO "anon";
GRANT ALL ON TABLE "public"."inbox_share_items_filtered" TO "authenticated";
GRANT ALL ON TABLE "public"."inbox_share_items_filtered" TO "service_role";



GRANT ALL ON TABLE "public"."inbox_unread_count_filtered" TO "anon";
GRANT ALL ON TABLE "public"."inbox_unread_count_filtered" TO "authenticated";
GRANT ALL ON TABLE "public"."inbox_unread_count_filtered" TO "service_role";



GRANT ALL ON TABLE "public"."insight_links" TO "anon";
GRANT ALL ON TABLE "public"."insight_links" TO "authenticated";
GRANT ALL ON TABLE "public"."insight_links" TO "service_role";



GRANT ALL ON TABLE "public"."insight_posts" TO "anon";
GRANT ALL ON TABLE "public"."insight_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."insight_posts" TO "service_role";



GRANT ALL ON TABLE "public"."journal_badges" TO "anon";
GRANT ALL ON TABLE "public"."journal_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."journal_badges" TO "service_role";



GRANT ALL ON TABLE "public"."journal_entries" TO "anon";
GRANT ALL ON TABLE "public"."journal_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."journal_entries" TO "service_role";


GRANT ALL ON TABLE "public"."maat_band_transitions" TO "anon";
GRANT ALL ON TABLE "public"."maat_band_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."maat_band_transitions" TO "service_role";


GRANT ALL ON TABLE "public"."maat_corrections" TO "anon";
GRANT ALL ON TABLE "public"."maat_corrections" TO "authenticated";
GRANT ALL ON TABLE "public"."maat_corrections" TO "service_role";


GRANT ALL ON TABLE "public"."maat_guidance_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."maat_guidance_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."maat_guidance_deliveries" TO "service_role";


GRANT ALL ON TABLE "public"."maat_flow_briefs" TO "anon";
GRANT ALL ON TABLE "public"."maat_flow_briefs" TO "authenticated";
GRANT ALL ON TABLE "public"."maat_flow_briefs" TO "service_role";


GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_dashboard" TO "anon";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_dashboard" TO "authenticated";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_dashboard" TO "service_role";


GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags" TO "anon";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags" TO "authenticated";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags" TO "service_role";


GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags_cohort" TO "anon";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags_cohort" TO "authenticated";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags_cohort" TO "service_role";


GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags_user" TO "anon";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags_user" TO "authenticated";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_flags_user" TO "service_role";


GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_summary" TO "anon";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_summary" TO "authenticated";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcome_summary" TO "service_role";


GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcomes" TO "anon";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcomes" TO "authenticated";
GRANT SELECT ON TABLE "public"."maat_guidance_drift_outcomes" TO "service_role";


GRANT SELECT ON TABLE "public"."maat_guidance_ops_alerts" TO "anon";
GRANT SELECT ON TABLE "public"."maat_guidance_ops_alerts" TO "authenticated";
GRANT SELECT ON TABLE "public"."maat_guidance_ops_alerts" TO "service_role";


GRANT ALL ON TABLE "public"."maat_guidance_evaluations" TO "anon";
GRANT ALL ON TABLE "public"."maat_guidance_evaluations" TO "authenticated";
GRANT ALL ON TABLE "public"."maat_guidance_evaluations" TO "service_role";


GRANT ALL ON TABLE "public"."maat_user_baselines" TO "anon";
GRANT ALL ON TABLE "public"."maat_user_baselines" TO "authenticated";
GRANT ALL ON TABLE "public"."maat_user_baselines" TO "service_role";


GRANT ALL ON TABLE "public"."maat_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."maat_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."maat_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."medu_decision_matrix" TO "anon";
GRANT ALL ON TABLE "public"."medu_decision_matrix" TO "authenticated";
GRANT ALL ON TABLE "public"."medu_decision_matrix" TO "service_role";



GRANT ALL ON TABLE "public"."medu_dictionary" TO "anon";
GRANT ALL ON TABLE "public"."medu_dictionary" TO "authenticated";
GRANT ALL ON TABLE "public"."medu_dictionary" TO "service_role";



GRANT ALL ON TABLE "public"."medu_kg_edges" TO "anon";
GRANT ALL ON TABLE "public"."medu_kg_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."medu_kg_edges" TO "service_role";



GRANT ALL ON TABLE "public"."memory_nodes" TO "anon";
GRANT ALL ON TABLE "public"."memory_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."memory_nodes" TO "service_role";



GRANT ALL ON TABLE "public"."node_insight_entries" TO "anon";
GRANT ALL ON TABLE "public"."node_insight_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."node_insight_entries" TO "service_role";



GRANT ALL ON TABLE "public"."node_links" TO "anon";
GRANT ALL ON TABLE "public"."node_links" TO "authenticated";
GRANT ALL ON TABLE "public"."node_links" TO "service_role";



GRANT ALL ON TABLE "public"."node_user_content" TO "anon";
GRANT ALL ON TABLE "public"."node_user_content" TO "authenticated";
GRANT ALL ON TABLE "public"."node_user_content" TO "service_role";



GRANT ALL ON TABLE "public"."nodes" TO "anon";
GRANT ALL ON TABLE "public"."nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."nodes" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_items" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_items" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_items" TO "service_role";



GRANT ALL ON TABLE "public"."profile_stats" TO "anon";
GRANT ALL ON TABLE "public"."profile_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_stats" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."reflection_feedback" TO "anon";
GRANT ALL ON TABLE "public"."reflection_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."reflection_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."reflection_generations" TO "anon";
GRANT ALL ON TABLE "public"."reflection_generations" TO "authenticated";
GRANT ALL ON TABLE "public"."reflection_generations" TO "service_role";



GRANT ALL ON TABLE "public"."reflection_profiles" TO "anon";
GRANT ALL ON TABLE "public"."reflection_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."reflection_profiles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."scheduled_notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."scheduled_notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."scheduled_notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."share_filing_items_client" TO "service_role";
GRANT SELECT ON TABLE "public"."share_filing_items_client" TO "authenticated";



GRANT ALL ON TABLE "public"."share_short_links" TO "anon";
GRANT ALL ON TABLE "public"."share_short_links" TO "authenticated";
GRANT ALL ON TABLE "public"."share_short_links" TO "service_role";



GRANT ALL ON TABLE "public"."shared_calendar_filing_items_client" TO "service_role";
GRANT SELECT ON TABLE "public"."shared_calendar_filing_items_client" TO "authenticated";



GRANT ALL ON TABLE "public"."shared_calendar_invite_filing_items_client" TO "service_role";
GRANT SELECT ON TABLE "public"."shared_calendar_invite_filing_items_client" TO "authenticated";



GRANT ALL ON TABLE "public"."shared_calendar_pending_invites" TO "anon";
GRANT ALL ON TABLE "public"."shared_calendar_pending_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_calendar_pending_invites" TO "service_role";



GRANT ALL ON TABLE "public"."shared_calendar_sent_pending_invites" TO "anon";
GRANT ALL ON TABLE "public"."shared_calendar_sent_pending_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_calendar_sent_pending_invites" TO "service_role";



GRANT ALL ON TABLE "public"."shared_calendar_summaries" TO "anon";
GRANT ALL ON TABLE "public"."shared_calendar_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_calendar_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."todos" TO "anon";
GRANT ALL ON TABLE "public"."todos" TO "authenticated";
GRANT ALL ON TABLE "public"."todos" TO "service_role";



GRANT ALL ON TABLE "public"."ukg_user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."ukg_user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."ukg_user_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_ai_usage" TO "anon";
GRANT ALL ON TABLE "public"."user_ai_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."user_ai_usage" TO "service_role";



GRANT ALL ON TABLE "public"."user_app_restoration_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."user_app_restoration_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."user_app_restoration_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."user_choice_events" TO "anon";
GRANT ALL ON TABLE "public"."user_choice_events" TO "authenticated";
GRANT ALL ON TABLE "public"."user_choice_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_event_completions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_event_completions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_event_completions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_event_filing_items" TO "service_role";
GRANT SELECT ON TABLE "public"."user_event_filing_items" TO "authenticated";



GRANT ALL ON TABLE "public"."user_events_with_calendars" TO "anon";
GRANT ALL ON TABLE "public"."user_events_with_calendars" TO "authenticated";
GRANT ALL ON TABLE "public"."user_events_with_calendars" TO "service_role";



GRANT ALL ON TABLE "public"."user_state" TO "anon";
GRANT ALL ON TABLE "public"."user_state" TO "authenticated";
GRANT ALL ON TABLE "public"."user_state" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
