#!/usr/bin/env python3
"""Source contracts owned by Supabase migrations and Edge Functions."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def require_all(test: unittest.TestCase, body: str, needles: list[str]) -> None:
    for needle in needles:
        with test.subTest(needle=needle):
            test.assertIn(needle, body)


def reject_all(test: unittest.TestCase, body: str, needles: list[str]) -> None:
    for needle in needles:
        with test.subTest(needle=needle):
            test.assertNotIn(needle, body)


class MigrationSourceContractsTest(unittest.TestCase):
    def test_reading_house_invites_have_one_live_delivery_identity(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260920000953_reading_house_invite_delivery.sql"
        )
        require_all(
            self,
            body,
            [
                "'shared_calendar_members'",
                "'shared_calendar_notifications'",
                "alter publication supabase_realtime add table public.%I",
                "create or replace view "
                "public.shared_calendar_invite_filing_items_client",
                "with (security_invoker = true)",
                "source_flow.source_flow_id",
                "source_flow.source_flow_key",
                "source_flow.source_book_title",
                "flow.calendar_id = sc.id",
                "flow.ai_metadata ->> 'flow_key' = 'the-reading-house'",
                "coalesce(flow.notes, '') like '%maat=the-reading-house%'",
                "scm.user_id = auth.uid()",
                "grant select on "
                "public.shared_calendar_invite_filing_items_client",
            ],
        )
        reject_all(
            self,
            body,
            [
                "sc.name like '%Reading House%'",
                "sc.name ilike '%Reading House%'",
                "system_type = 'reading_house'",
            ],
        )

        smoke = source(
            "supabase/dev/reading_house_invite_delivery_smoke.sql"
        )
        require_all(
            self,
            smoke,
            [
                "public.invite_user_to_shared_calendar",
                "public.shared_calendar_notifications",
                "public.shared_calendar_invite_filing_items_client",
                "invite.source_flow_id = 881101",
                "invite.source_flow_key = 'the-reading-house'",
                "invite.source_book_title = 'The Odyssey'",
                "from pg_publication_tables publication_table",
                "rollback;",
            ],
        )

    def test_reading_house_event_ids_leave_legacy_maat_namespace(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260918143708_reading_house_event_identity.sql"
        )
        require_all(
            self,
            body,
            [
                "^maat:reading-house:",
                "reading-house:",
                "the-reading-house-sitting-%",
                "update public.user_events event",
                "update public.user_event_completions completion",
                "update public.scheduled_notifications notification",
                "update public.event_deletion_trash deletion",
                "canonical ID collision",
                "Active Reading House events remain",
            ],
        )

    def test_shared_calendar_privacy_schema_conventions(self) -> None:
        body = source("db/schema.sql")
        list_start = body.index(
            'CREATE OR REPLACE FUNCTION "public".'
            '"list_shared_calendar_members"'
        )
        list_end = body.index(
            'ALTER FUNCTION "public"."list_shared_calendar_members"',
            list_start,
        )
        require_all(
            self,
            body[list_start:list_end],
            [
                "v_actor_id uuid := auth.uid()",
                "scm.status = 'accepted'",
                "CALENDAR_NOT_ACCESSIBLE",
                "or (v_is_owner and scm.status = 'pending')",
            ],
        )
        invite_start = body.index(
            'CREATE OR REPLACE FUNCTION "public".'
            '"invite_user_to_shared_calendar"'
        )
        invite_end = body.index(
            'ALTER FUNCTION "public"."invite_user_to_shared_calendar"',
            invite_start,
        )
        require_all(
            self,
            body[invite_start:invite_end],
            [
                "scm.status = 'accepted'",
                "scm.role = 'owner'",
                "CALENDAR_NOT_INVITABLE",
                "v_role not in ('editor', 'viewer')",
            ],
        )
        view_start = body.index(
            'CREATE OR REPLACE VIEW "public".'
            '"shared_calendar_filing_items_client"'
        )
        view_end = body.index(
            'ALTER VIEW "public"."shared_calendar_filing_items_client"',
            view_start,
        )
        require_all(
            self,
            body[view_start:view_end],
            [
                '"scm"."user_id" = "auth"."uid"()',
                '"scm"."status" = \'accepted\'::"text"',
                '"sc"."deleted_at" IS NULL',
            ],
        )
        policy_start = body.index(
            'CREATE POLICY "shared_calendar_members_select_visible"'
        )
        policy_end = body.index(
            'ALTER TABLE "public"."shared_calendar_notifications"',
            policy_start,
        )
        require_all(
            self,
            body[policy_start:policy_end],
            [
                '"user_id" = "auth"."uid"()',
                "can_view_shared_calendar_member_row",
            ],
        )

    def test_flow_snapshots_do_not_grant_live_sender_event_access(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260815121000_drop_live_shared_flow_event_access.sql"
        )
        require_all(
            self,
            body,
            [
                'drop policy if exists "user_events_select_shared_flow_events"',
                "on public.user_events",
            ],
        )

    def test_saved_import_is_allowed_by_database_lineage(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260616120000_allow_saved_import_flow_origin.sql"
        )
        require_all(self, body, ["'saved_import'", "flows_origin_type_check"])

    def test_evening_threshold_orientation_tables_are_migration_backed(self) -> None:
        body = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((ROOT / "supabase/migrations").glob("*.sql"))
        )
        require_all(
            self,
            body,
            [
                "create table if not exists public.daily_orientation",
                "create table if not exists public.evening_threshold_decisions",
                "daily_orientation_user_chosen_return_idx",
                "where chosen_return is not null",
                "kemetic_day_key",
                "entry_state",
                "chosen_return",
                "source",
                "set_at",
                "landing_status",
                "landed_at",
                "carryover_choice",
                "evening_reflection_status",
                "badge_label",
                "status",
                "completed_at",
                "new_carry_text",
                "primary key (user_id, local_date)",
                "primary key (user_id, decision_date)",
                "auth.uid() = user_id",
                "decision in ('carried', 'released')",
                "landing_status in ('held', 'slipped', 'working_on_it')",
            ],
        )

    def test_stable_notification_id_migration(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260528090000_stable_scheduled_notification_ids.sql"
        )
        sequence = body.index(
            "create sequence if not exists "
            "public.scheduled_notifications_notification_id_seq"
        )
        duplicate_rank = body.index(
            "row_number() over (\n      partition by notification_id"
        )
        duplicate_update = body.index(
            "update public.scheduled_notifications sn", duplicate_rank
        )
        default_set = body.index(
            "alter column notification_id set default", duplicate_update
        )
        unique_index = body.index(
            "create unique index if not exists "
            "scheduled_notifications_notification_id_key",
            default_set,
        )
        self.assertLess(sequence, duplicate_rank)
        self.assertLess(duplicate_rank, duplicate_update)
        self.assertLess(duplicate_update, default_set)
        self.assertLess(default_set, unique_index)
        require_all(
            self,
            body,
            [
                "maxvalue 2147483647",
                "check (notification_id > 0)",
                "create or replace function public.upsert_scheduled_notification",
                "v_user_id uuid := auth.uid()",
                "on conflict (user_id, client_event_id, notification_type)",
                "sn.notification_id",
                "grant execute on function public.upsert_scheduled_notification",
            ],
        )
        update_start = body.index("do update set")
        returning_start = body.index("returning", update_start)
        self.assertNotIn("notification_id", body[update_start:returning_start])
        insert_start = body.index("insert into public.scheduled_notifications as sn (")
        values_start = body.index("  values (", insert_start)
        self.assertNotIn("notification_id", body[insert_start:values_start])
        schema = source("db/schema.sql")
        self.assertIn(
            'ADD CONSTRAINT "unique_user_client_event_type" UNIQUE '
            '("user_id", "client_event_id", "notification_type")',
            schema,
        )

    def test_kar_private_versioned_history(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260910092351_kar_private_versioned_history.sql"
        )
        require_all(
            self,
            body,
            [
                "create table public.kar_shrines",
                "unique (user_id, netjer_key)",
                "alter table public.kar_shrines enable row level security",
                "using ((select auth.uid()) = user_id)",
                "with check ((select auth.uid()) = user_id)",
                "revoke all on table public.kar_shrines from anon",
                "grant select, insert on table public.kar_shrines to authenticated",
                "grant update (state, revision, updated_at)\n"
                "  on table public.kar_shrines\n"
                "  to authenticated",
                "revision bigint not null default 0",
                "application-preserved scene lineage",
                "'djehuty'",
                "'maat'",
                "'sekhmet'",
                "'hetheru'",
                "'khepri'",
                "'ptah'",
            ],
        )
        reject_all(
            self,
            body,
            [
                "grant select, insert, update on table public.kar_shrines "
                "to authenticated",
                "grant delete",
                "for delete",
            ],
        )

    def test_reading_house_unscheduled_filing_is_additive(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260830120000_reading_house_unscheduled_filing.sql"
        )
        for authority in [
            "private.flow_activity_summary_v1",
            "public.get_my_filed_flows_v1",
            "public.get_profile_flow_counts",
            "public.get_my_flow_activity_v1",
            "public.get_currently_active_imported_flows_v1",
        ]:
            self.assertIsNone(
                re.search(
                    r"create\s+or\s+replace\s+function\s+"
                    + re.escape(authority),
                    body,
                    re.IGNORECASE,
                )
            )
        reject_all(
            self,
            body,
            [
                "alter table",
                "create policy",
                "drop policy",
                "create trigger",
                "drop trigger",
                "reading_house_[^;]*=",
                "placeholder",
                "membership.status = 'pending'",
                "insert into public.user_events",
                "insert into public.flow_posts",
                "update public.flow_posts",
                "shared_practice",
                "grant execute on function public.get_my_filed_flows_v1",
            ],
        )
        self.assertIsNone(re.search(r"\bdraft_house\b", body))
        self.assertIsNone(
            re.search(
                r"\b(insert\s+into|update|delete\s+from|truncate)\s+public\.",
                body,
                re.IGNORECASE,
            )
        )
        require_all(
            self,
            body,
            [
                "create function private.flow_is_reading_house",
                "create function private.flow_is_held_reading_house",
                "create function public.get_my_held_reading_houses_v1",
                "'the-reading-house'",
                "reading_house_state=held_house",
                "'{reading_house,state}'",
                "join public.shared_calendar_members membership",
                "membership.calendar_id = f.calendar_id",
                "membership.user_id = v_uid",
                "membership.status = 'accepted'",
                "left join lateral private.flow_activity_summary_v1",
                "private.flow_activity_summary_v1(\n    f.user_id",
                "when f.user_id = v_uid then",
                "public.flow_is_schedule_open",
                "coalesce(summary.is_counted_active, false)",
                "f.start_date is null and f.end_date is null",
                "grant execute on function "
                "public.get_my_held_reading_houses_v1(integer)",
            ],
        )

    def test_reading_house_commons_detail_preserves_room_access(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260830230300_reading_house_shared_practice_detail.sql"
        )
        access = body.index(
            "if not public.shared_practice_can_read_room(v_room.id, v_uid)"
        )
        projection = body.index("f.ai_metadata ->> 'flow_key' = 'the-reading-house'")
        self.assertLess(access, projection)
        require_all(
            self,
            body,
            [
                "'source_flow', v_source_flow",
                "'viewer_can_edit', v_room.created_by = v_uid",
                "f.ai_metadata -> 'reading_house'",
            ],
        )
        reject_all(
            self,
            body,
            [
                "alter policy",
                "drop ",
                "update public.flows",
                "insert into public.flows",
            ],
        )

    def test_reading_house_room_state_and_realtime(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260905152737_reading_house_rooms_realtime_and_read_state.sql"
        )
        require_all(
            self,
            body,
            [
                "primary key (calendar_id, flow_id, user_id)",
                "greatest(",
                "user_id = (select auth.uid())",
                "HOUSE_READ_STATE_CANNOT_REGRESS",
                "HOUSE_READ_STATE_IDENTITY_IMMUTABLE",
                "new.last_read_at := least(",
                "revoke insert, update, delete, truncate, references, trigger\n"
                "on public.reading_house_room_read_state from authenticated;",
                "grant select on public.reading_house_room_read_state to authenticated;",
                "before insert or update on public.reading_house_room_read_state",
                "mark_reading_house_room_read",
                "security definer",
                "set search_path = ''",
                "auth.uid() is not null",
                "public.reading_house_is_calendar_member(",
                "with (security_invoker = true)",
                "unread.author_id <> (select auth.uid())",
                "unread.deleted_at is null",
                "private.reading_house_is_active_house",
                "before insert or update or delete on public.%I",
                "private.guard_reading_house_live_lane_mutation()",
                "HOUSE_ROOM_IDENTITY_IMMUTABLE",
                "tg_table_name = 'reading_house_announcements'",
                "public.reading_house_can_moderate_calendar(",
                "ANNOUNCEMENT_NOT_ALLOWED",
                "update_reading_house_chat_message",
                "delete_reading_house_chat_message",
                "set deleted_at = timezone",
                "v_message.author_id <> v_uid",
                "'reading_house_chat_messages'",
                "'reading_house_shared_fragments'",
                "'reading_house_fragment_replies'",
                "'reading_house_announcements'",
                "pubname = 'supabase_realtime'",
                "alter publication supabase_realtime add table",
            ],
        )
        self.assertGreaterEqual(body.count("HOUSE_ENDED_READ_ONLY"), 2)
        reject_all(
            self,
            body,
            [
                "grant select, insert, update",
                "create policy reading_house_room_read_state_insert_own",
                "create policy reading_house_room_read_state_update_own",
            ],
        )

    def test_reading_house_room_lifecycle_keeps_admin_archive(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260918183843_reading_house_room_lifecycle.sql"
        )
        require_all(
            self,
            body,
            [
                "f.active is true",
                "coalesce(f.is_hidden, false) is false",
                "with (security_invoker = true)",
                "self_member.user_id = (select auth.uid())",
            ],
        )
        reject_all(
            self,
            body,
            [
                "delete from public.reading_house_chat_messages",
                "delete from public.reading_house_room_read_state",
                "delete from public.flows",
                "truncate ",
                "disable trigger",
                "session_replication_role",
                "create trigger trg_delete_reading_house_room_on_flow_end",
                "security definer",
            ],
        )

    def test_reading_house_lane_rls_contracts(self) -> None:
        contracts = {
            "20260626170000_reading_house_house_chat.sql": {
                "required": [
                    "reading_house_chat_messages",
                    "reading_house_chat_messages_select_members",
                    "reading_house_is_calendar_member",
                    "reading_house_flow_on_calendar",
                    "reading_house_is_solo_study_house",
                    "create_reading_house_chat_message",
                    "delete_reading_house_chat_message",
                    "CHAT_NOT_AVAILABLE_FOR_SOLO_STUDY",
                    "CHAT_OPENS_WHEN_READERS_JOIN",
                    "CHAT_MESSAGE_NOT_EDITABLE",
                    "scm.status = 'accepted'",
                    "v_active_member_count < 2",
                    "grant select on public.reading_house_chat_messages",
                ],
                "forbidden": [
                    "parent_message_id",
                    "parent_reply_id",
                    "likes",
                    "reaction",
                    "ranking",
                    "global_commons",
                    "pod",
                ],
            },
            "20260625170000_reading_house_shared_fragments.sql": {
                "required": [
                    "reading_house_shared_fragments",
                    "reading_house_sitting_positions",
                    "reading_house_is_calendar_member",
                    "reading_house_can_moderate_calendar",
                    "reading_house_fragment_event_exists",
                    "reading_house_has_fragment_unlock",
                    "rhsp.reading_position = 'carrying'",
                    "uec.metadata ->> 'reading_position' = 'carrying'",
                    "reading_house_shared_fragments_select_members_unlocked",
                    "reading_house_shared_fragments_insert_author_unlocked",
                    "author_id = auth.uid()",
                    "deleted_at is null",
                    "delete_reading_house_shared_fragment",
                    "FRAGMENT_NOT_EDITABLE",
                ],
                "forbidden": ["reply", "likes", "ranking"],
            },
            "20260625203000_reading_house_fragment_replies.sql": {
                "required": [
                    "reading_house_fragment_replies",
                    "fragment_id uuid not null",
                    "references public.reading_house_shared_fragments",
                    "is_host_ack boolean not null default false",
                    "reading_house_can_read_fragment",
                    "reading_house_fragment_replies_select_parent_visible",
                    "create_reading_house_fragment_reply",
                    "delete_reading_house_fragment_reply",
                    "FRAGMENT_NOT_ACCESSIBLE",
                    "ACK_NOT_ALLOWED",
                    "REPLY_NOT_EDITABLE",
                    "v_reply.author_id <> v_uid",
                    "reading_house_can_moderate_calendar",
                    "grant select on public.reading_house_fragment_replies",
                ],
                "forbidden": [
                    "parent_reply_id",
                    "likes",
                    "reaction",
                    "ranking",
                    "commons",
                ],
            },
            "20260626110000_reading_house_margin_announcements.sql": {
                "required": [
                    "reading_house_margin_items",
                    "reading_house_announcements",
                    "reading_house_flow_on_calendar",
                    "reading_house_margin_items_select_members",
                    "reading_house_announcements_select_members",
                    "create_reading_house_margin_item",
                    "delete_reading_house_margin_item",
                    "create_reading_house_announcement",
                    "delete_reading_house_announcement",
                    "reading_house_is_calendar_member",
                    "reading_house_can_moderate_calendar",
                    "MARGIN_NOT_EDITABLE",
                    "ANNOUNCEMENT_NOT_ALLOWED",
                    "ANNOUNCEMENT_NOT_EDITABLE",
                    "spoiler boolean not null default false",
                    "announcement_type in ('schedule', 'pace', 'recap', 'note')",
                    "grant select on public.reading_house_margin_items",
                    "grant select on public.reading_house_announcements",
                ],
                "forbidden": [
                    "private_reflection",
                    "short_note",
                    "likes",
                    "reaction",
                    "ranking",
                    "commons",
                    "chat",
                ],
            },
        }
        for name, contract in contracts.items():
            with self.subTest(migration=name):
                body = source(f"supabase/migrations/{name}")
                require_all(self, body, contract["required"])
                reject_all(self, body, contract["forbidden"])

    def test_shared_calendar_fanout_and_experience(self) -> None:
        fanout = source(
            "supabase/migrations/"
            "20260602110000_shared_calendar_item_added_fanout.sql"
        )
        require_all(
            self,
            fanout,
            [
                "dedupe_key text primary key",
                "shared_calendar_item_added:{calendarId}:{itemType}:{itemId}",
            ],
        )
        experience = source(
            "supabase/migrations/"
            "20260627120000_shared_calendar_flow_experience.sql"
        )
        require_all(
            self,
            experience,
            [
                "ensure_shared_experience_for_flow",
                "trg_user_events_stamp_shared_practice_room",
                "- 'shared_practice_room_id'",
                "- 'shared_practice_entry_id'",
                "v_existing_room_id is distinct from v_room_id",
                "old.behavior_payload->>'shared_practice_room_id'",
                "create_joint_flow_experience_from_commons",
                "shared experience backfill candidates",
                "shared experience stale payload cleanup candidates",
            ],
        )

    def test_social_safety_migration(self) -> None:
        body = source(
            "supabase/migrations/20260602090000_social_safety_controls.sql"
        )
        require_all(
            self,
            body,
            [
                "create table if not exists public.user_blocks",
                "create table if not exists public.content_reports",
                "alter table public.user_blocks enable row level security",
                "alter table public.content_reports enable row level security",
                "Users can create their own reports",
                "Users can delete their own blocks",
                "Users can view unblocked flow posts",
                "Public can view visible flow posts",
                "Users can view unblocked insight posts",
                "Users can view unblocked flow post comments",
            ],
        )


class EdgeFunctionSourceContractsTest(unittest.TestCase):
    def test_shared_calendar_notification_fanout(self) -> None:
        body = source(
            "supabase/functions/notify_shared_calendar_item_added/index.ts"
        )
        require_all(
            self,
            body,
            [
                'notification_type: "shared_calendar_item_added"',
                'notification_kind: "calendar_event"',
                "shared_calendar_item_added_fanout",
                "getRecipientUserIds",
                "userId !== actorUserId",
            ],
        )
        send_push = source("supabase/functions/send_push/index.ts")
        require_all(
            self,
            send_push,
            [
                'kind === "shared_calendar_item_added"',
                'push_kind: "shared_calendar_item_added"',
                "const passthroughValue",
            ],
        )

    def test_social_safety_account_deletion(self) -> None:
        body = source("supabase/functions/delete_account/index.ts")
        require_all(
            self,
            body,
            [
                '["content_reports", "reporter_user_id"]',
                '["content_reports", "reported_user_id"]',
                '["user_blocks", "blocker_user_id"]',
                '["user_blocks", "blocked_user_id"]',
            ],
        )

    def test_push_payload_contracts(self) -> None:
        flow_share = source("supabase/functions/create_flow_share/index.ts")
        require_all(
            self,
            flow_share,
            ['type: "flow_share"', 'kind: "flow_share"'],
        )
        send_dm = source("supabase/functions/send_dm_message/index.ts")
        require_all(
            self,
            send_dm,
            [
                'notification_type: "direct_message"',
                "conversation_user_id: senderId",
                "headers.Authorization",
            ],
        )
        dm_conversations = source(
            "supabase/functions/_shared/dm_conversations.ts"
        )
        require_all(
            self,
            dm_conversations,
            ['type: "dm_message_v2"', "conversation_id: conversationId"],
        )
        push_auth = source(
            "supabase/functions/send_push/user_jwt_push_auth.ts"
        )
        require_all(
            self,
            push_auth,
            ['"dm_message_v2"', "lookupDmConversationMembers"],
        )
        send_push = source("supabase/functions/send_push/index.ts")
        require_all(
            self,
            send_push,
            [
                'kind === "flow_share"',
                'push_kind: "flow_share"',
                'kind === "dm"',
                'push_kind: "dm"',
                'push_kind: "dm_message_v2"',
                'params.set("conversation_id"',
                'kind === "follow"',
                'push_kind: "follow"',
            ],
        )


if __name__ == "__main__":
    unittest.main()
