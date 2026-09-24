begin;

-- Legacy flow events can carry their owner in client_event_id or detail while
-- flow_local_id remains null. The canonical accountant resolves that owner
-- with an immutable function; indexing the same expression prevents every My
-- Flows read from reparsing the account's unrelated null-flow events.
create index if not exists user_events_user_fallback_flow_ref_idx
  on public.user_events (
    user_id,
    (
      public.user_event_referenced_flow_id(
        flow_local_id,
        client_event_id,
        detail
      )
    )
  )
  include (id, client_event_id, category, all_day, starts_at, ends_at)
  where flow_local_id is null
    and public.user_event_referenced_flow_id(
      flow_local_id,
      client_event_id,
      detail
    ) is not null;

comment on index public.user_events_user_fallback_flow_ref_idx is
  'Supports canonical flow accounting for legacy events whose flow owner is encoded outside flow_local_id.';

-- Action-owned fallback events use normalized action ids and must not re-read
-- large detail payloads after the canonical reference resolver returns null.
create index if not exists user_events_user_fallback_action_idx
  on public.user_events (
    user_id,
    (btrim(action_id))
  )
  include (id, client_event_id, category, all_day, starts_at, ends_at)
  where flow_local_id is null
    and action_id is not null
    and public.user_event_referenced_flow_id(
      flow_local_id,
      client_event_id,
      detail
    ) is null;

comment on index public.user_events_user_fallback_action_idx is
  'Supports canonical flow accounting for action-owned legacy events without reparsing large detail payloads.';

commit;
