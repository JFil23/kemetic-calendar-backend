-- Immutable baseline from backend 58e9eef before the October 27 refactor.
create or replace view public.user_event_filing_items_client
with (security_invoker = true) as
 WITH filed AS (
         SELECT ue.id,
            ue.user_id,
            ue.client_event_id,
            ue.calendar_id,
            sc.name AS calendar_name,
            sc.color AS calendar_color,
            sc.is_personal AS calendar_is_personal,
            ue.title,
            ue.detail,
            ue.location,
            ue.all_day,
            ue.starts_at,
            ue.ends_at,
            ue.flow_local_id,
            ue.category,
            ue.action_id,
            ue.behavior_payload,
            ue.updated_at,
            ue.created_at,
            ref.flow_id AS filed_flow_id,
            f.active AS flow_active,
            f.is_hidden AS flow_is_hidden,
            f.is_reminder AS flow_is_reminder,
            f.is_saved AS flow_is_saved,
            f.notes AS flow_notes,
            COALESCE(NULLIF(_get_user_timezone(ue.user_id), ''::text), 'UTC'::text) AS user_timezone,
            user_event_active_until(ue.user_id, ue.all_day, ue.starts_at, ue.ends_at) AS active_until,
            user_event_date_lifecycle(ue.user_id, ue.all_day, ue.starts_at, ue.ends_at) AS date_lifecycle,
            (EXISTS ( SELECT 1
                   FROM event_shares es
                  WHERE es.event_id = ue.id AND es.deleted_at IS NULL AND (COALESCE(es.status, 'pending'::text) = ANY (ARRAY['sent'::text, 'viewed'::text, 'imported'::text, 'public'::text])))) AS has_event_share,
            (EXISTS ( SELECT 1
                   FROM flow_shares fs
                  WHERE fs.flow_id = ref.flow_id AND fs.deleted_at IS NULL AND (COALESCE(fs.status, 'pending'::text) = ANY (ARRAY['sent'::text, 'viewed'::text, 'imported'::text, 'public'::text])))) AS has_flow_share,
            (EXISTS ( SELECT 1
                   FROM flow_posts fp
                  WHERE fp.flow_id = ref.flow_id AND COALESCE(fp.is_hidden, false) = false)) AS has_flow_post,
            (EXISTS ( SELECT 1
                   FROM reminders r
                  WHERE r.user_id = ue.user_id AND COALESCE(r.status, 'pending'::text) <> 'completed'::text AND (r.event_id = ue.id OR r.flow_event_id = ue.id))) AS has_active_reminder,
            (EXISTS ( SELECT 1
                   FROM scheduled_notifications sn
                  WHERE sn.user_id = ue.user_id AND sn.is_active = true AND ue.client_event_id IS NOT NULL AND sn.client_event_id = ue.client_event_id)) AS has_scheduled_notification
           FROM user_events ue
             JOIN shared_calendars sc ON sc.id = ue.calendar_id AND sc.deleted_at IS NULL
             LEFT JOIN LATERAL ( SELECT COALESCE(user_event_referenced_flow_id(ue.flow_local_id::bigint, ue.client_event_id, ue.detail), flow_id_from_action_id(ue.user_id, ue.action_id)) AS flow_id) ref ON true
             LEFT JOIN flows f ON f.id = ref.flow_id
        ), reasoned AS (
         SELECT filed.id,
            filed.user_id,
            filed.client_event_id,
            filed.calendar_id,
            filed.calendar_name,
            filed.calendar_color,
            filed.calendar_is_personal,
            filed.title,
            filed.detail,
            filed.location,
            filed.all_day,
            filed.starts_at,
            filed.ends_at,
            filed.flow_local_id,
            filed.category,
            filed.action_id,
            filed.behavior_payload,
            filed.updated_at,
            filed.created_at,
            filed.filed_flow_id,
            filed.flow_active,
            filed.flow_is_hidden,
            filed.flow_is_reminder,
            filed.flow_is_saved,
            filed.flow_notes,
            filed.user_timezone,
            filed.active_until,
            filed.date_lifecycle,
            filed.has_event_share,
            filed.has_flow_share,
            filed.has_flow_post,
            filed.has_active_reminder,
            filed.has_scheduled_notification,
                CASE
                    WHEN lower(COALESCE(filed.client_event_id, ''::text)) ~~ 'reminder:%'::text THEN 'client_event_id_reminder_prefix'::text
                    WHEN lower(COALESCE(filed.client_event_id, ''::text)) ~~ 'nutrition:%'::text THEN 'client_event_id_nutrition_prefix'::text
                    WHEN COALESCE(filed.flow_is_reminder, false) THEN 'flow_is_reminder'::text
                    WHEN filed.filed_flow_id IS NOT NULL THEN 'flow_reference'::text
                    WHEN lower(COALESCE(filed.client_event_id, ''::text)) ~~ 'maat:%'::text THEN 'legacy_maat_prefix'::text
                    ELSE 'standalone_event'::text
                END AS reason_item_kind,
                CASE
                    WHEN lower(COALESCE(filed.category, ''::text)) = 'tombstone'::text THEN 'category_tombstone'::text
                    WHEN lower(COALESCE(filed.client_event_id, ''::text)) ~~ 'reminder:tombstone:%'::text THEN 'reminder_tombstone'::text
                    WHEN lower(COALESCE(filed.client_event_id, ''::text)) ~~ 'maat:%'::text THEN 'legacy_maat_event'::text
                    WHEN user_event_recently_deleted(filed.user_id, filed.client_event_id) THEN 'event_deletion_trash'::text
                    WHEN filed.filed_flow_id IS NOT NULL AND filed.flow_active IS NULL THEN 'orphaned_flow_reference'::text
                    WHEN filed.filed_flow_id IS NOT NULL AND flow_is_deleted_state(filed.flow_active, filed.flow_is_hidden, filed.flow_notes) THEN 'deleted_flow'::text
                    ELSE NULL::text
                END AS reason_deleted,
                CASE
                    WHEN COALESCE(filed.all_day, false) AND filed.ends_at IS NOT NULL AND filed.ends_at > filed.starts_at THEN 'all_day_valid_ends_at'::text
                    WHEN COALESCE(filed.all_day, false) THEN 'all_day_local_day_end'::text
                    WHEN filed.ends_at IS NOT NULL AND filed.ends_at > filed.starts_at THEN 'timed_valid_ends_at'::text
                    ELSE 'starts_at'::text
                END AS reason_active_until
           FROM filed
        ), classified AS (
         SELECT reasoned.id,
            reasoned.user_id,
            reasoned.client_event_id,
            reasoned.calendar_id,
            reasoned.calendar_name,
            reasoned.calendar_color,
            reasoned.calendar_is_personal,
            reasoned.title,
            reasoned.detail,
            reasoned.location,
            reasoned.all_day,
            reasoned.starts_at,
            reasoned.ends_at,
            reasoned.flow_local_id,
            reasoned.category,
            reasoned.action_id,
            reasoned.behavior_payload,
            reasoned.updated_at,
            reasoned.created_at,
            reasoned.filed_flow_id,
            reasoned.flow_active,
            reasoned.flow_is_hidden,
            reasoned.flow_is_reminder,
            reasoned.flow_is_saved,
            reasoned.flow_notes,
            reasoned.user_timezone,
            reasoned.active_until,
            reasoned.date_lifecycle,
            reasoned.has_event_share,
            reasoned.has_flow_share,
            reasoned.has_flow_post,
            reasoned.has_active_reminder,
            reasoned.has_scheduled_notification,
            reasoned.reason_item_kind,
            reasoned.reason_deleted,
            reasoned.reason_active_until,
                CASE
                    WHEN lower(COALESCE(reasoned.client_event_id, ''::text)) ~~ 'reminder:%'::text OR lower(COALESCE(reasoned.client_event_id, ''::text)) ~~ 'nutrition:%'::text OR COALESCE(reasoned.flow_is_reminder, false) THEN 'reminder'::text
                    WHEN reasoned.filed_flow_id IS NOT NULL OR lower(COALESCE(reasoned.client_event_id, ''::text)) ~~ 'maat:%'::text THEN 'flow'::text
                    ELSE 'note'::text
                END AS item_kind,
            reasoned.reason_deleted IS NOT NULL AS is_deleted,
            COALESCE(reasoned.flow_is_saved, false) AS is_saved,
            reasoned.calendar_is_personal = false AS is_shared_calendar_source,
            reasoned.has_event_share AS is_event_share_source,
            reasoned.has_flow_share AS is_flow_share_source,
            reasoned.has_flow_post AS is_flow_post_source,
            COALESCE(reasoned.flow_is_saved, false) AS is_flow_saved_source,
            reasoned.has_active_reminder AS is_active_reminder_source,
            reasoned.has_scheduled_notification AS is_scheduled_notification_source
           FROM reasoned
        ), projected AS (
         SELECT classified.id,
            classified.user_id,
            classified.client_event_id,
            classified.calendar_id,
            classified.calendar_name,
            classified.calendar_color,
            classified.calendar_is_personal,
            classified.title,
            classified.detail,
            classified.location,
            classified.all_day,
            classified.starts_at,
            classified.ends_at,
            classified.flow_local_id,
            classified.category,
            classified.action_id,
            classified.behavior_payload,
            classified.updated_at,
            classified.created_at,
            classified.filed_flow_id,
            classified.flow_active,
            classified.flow_is_hidden,
            classified.flow_is_reminder,
            classified.flow_is_saved,
            classified.flow_notes,
            classified.user_timezone,
            classified.active_until,
            classified.date_lifecycle,
            classified.has_event_share,
            classified.has_flow_share,
            classified.has_flow_post,
            classified.has_active_reminder,
            classified.has_scheduled_notification,
            classified.reason_item_kind,
            classified.reason_deleted,
            classified.reason_active_until,
            classified.item_kind,
            classified.is_deleted,
            classified.is_saved,
            classified.is_shared_calendar_source,
            classified.is_event_share_source,
            classified.is_flow_share_source,
            classified.is_flow_post_source,
            classified.is_flow_saved_source,
            classified.is_active_reminder_source,
            classified.is_scheduled_notification_source,
                CASE
                    WHEN classified.is_deleted THEN 'deleted'::text
                    ELSE classified.date_lifecycle
                END AS lifecycle,
            classified.is_deleted = false AND classified.date_lifecycle = 'active'::text AS live_on_calendar,
            classified.is_shared_calendar_source OR classified.is_event_share_source OR classified.is_flow_share_source AS is_shared,
            classified.is_flow_post_source AS is_posted
           FROM classified
        )
 SELECT id,
    user_id,
    client_event_id,
    calendar_id,
    calendar_name,
    calendar_color,
    calendar_is_personal,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    category,
    action_id,
    behavior_payload,
    updated_at,
    created_at,
    filed_flow_id,
    flow_active,
    flow_is_hidden,
    flow_is_reminder,
    flow_is_saved,
    flow_notes,
    user_timezone,
    active_until,
    date_lifecycle,
    has_event_share,
    has_flow_share,
    has_flow_post,
    has_active_reminder,
    has_scheduled_notification,
    reason_item_kind,
    reason_deleted,
    reason_active_until,
    item_kind,
    is_deleted,
    is_saved,
    is_shared_calendar_source,
    is_event_share_source,
    is_flow_share_source,
    is_flow_post_source,
    is_flow_saved_source,
    is_active_reminder_source,
    is_scheduled_notification_source,
    lifecycle,
    live_on_calendar,
    is_shared,
    is_posted,
    jsonb_build_object('item_kind', jsonb_build_object('value', item_kind, 'reason', reason_item_kind), 'lifecycle', jsonb_build_object('value', lifecycle, 'date_lifecycle', date_lifecycle, 'deleted_reason', reason_deleted, 'active_until', active_until, 'active_until_reason', reason_active_until, 'timezone', user_timezone), 'calendar', jsonb_build_object('calendar_id', calendar_id, 'calendar_name', calendar_name, 'calendar_is_personal', calendar_is_personal, 'live_on_calendar', live_on_calendar), 'share_sources', jsonb_build_object('shared_calendar', is_shared_calendar_source, 'event_share', is_event_share_source, 'flow_share', is_flow_share_source), 'post_sources', jsonb_build_object('flow_post', is_flow_post_source), 'save_sources', jsonb_build_object('flow_saved', is_flow_saved_source), 'reminder_sources', jsonb_build_object('active_reminder', is_active_reminder_source, 'scheduled_notification', is_scheduled_notification_source)) AS filing_reasons
   FROM projected
  WHERE lifecycle <> 'deleted'::text;
