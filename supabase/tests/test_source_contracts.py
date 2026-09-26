#!/usr/bin/env python3
"""Source contracts owned by Supabase migrations and Edge Functions."""

from __future__ import annotations

import hashlib
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
    def test_legacy_flow_reference_index_uses_the_canonical_resolver(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923235000_index_fallback_flow_references.sql"
        )
        require_all(
            self,
            body,
            [
                "create index if not exists "
                "user_events_user_fallback_flow_ref_idx",
                "create index if not exists "
                "user_events_user_fallback_action_idx",
                "public.user_event_referenced_flow_id(",
                "where flow_local_id is null",
                "btrim(action_id)",
                "action_id is not null",
                ") is not null",
                ") is null",
            ],
        )
        reject_all(
            self,
            body,
            [
                "insert into ",
                "update public.",
                "delete from ",
                "create or replace function",
            ],
        )

    def test_my_flows_reads_selected_direct_events_once(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924015040_read_direct_events_once_for_my_flows.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "candidate_flow_ids as materialized (",
                "direct_event_rows as materialized (",
                "ue.flow_local_id = any(cfi.ids)",
                "from direct_event_rows der",
                "on cf.id = der.flow_id",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "from candidate_flows cf\n    join public.user_events ue",
                "create or replace function public.get_my_filed_flows_v1(",
                "insert into ",
                "update public.",
                "delete from ",
            ],
        )

    def test_my_flows_availability_refactors_the_existing_accountant_only(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923234822_restore_my_flows_read_availability.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "referenced_fallback_events as materialized (",
                "flow_action_map as materialized (",
                "action_fallback_events as materialized (",
                "completion_keys as materialized (",
                "public.user_event_referenced_flow_id(",
                "public.flow_action_ids_from_metadata(cf.ai_metadata)",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "fallback_base as materialized (",
                "create or replace function public.get_my_filed_flows_v1(",
                "insert into ",
                "update public.",
                "delete from ",
            ],
        )

    def test_latest_social_list_reads_have_one_bounded_authority(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923203000_bound_social_and_filing_list_reads.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.get_profile_feed_cards(",
                "from jsonb_to_recordset(\n    public.get_profile_feed_cards",
                "create or replace function public.get_commons_home_cards(",
                "v_discover := public.get_profile_feed_cards(8, 0)",
                "select public.get_commons_home_cards(",
            ],
        )

    def test_latest_flow_accounting_restores_known_good_authority(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923211500_restore_pre_regression_flow_accounting.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "public.flow_metadata_has_action_id(",
                "create or replace function public.get_my_filed_flows_v1(",
                "f.appearance",
                "join activity on activity.flow_id = f.id",
                "grant execute on function public.get_my_filed_flows_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "flow_action_map as materialized (",
                "where activity.is_counted_active or f.filed_is_saved",
            ],
        )

    def test_my_flows_restores_the_existing_single_bounded_authority(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924021634_restore_single_bounded_my_flows_authority.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.get_my_filed_flows_v1(",
                "public.flow_is_deleted_state(",
                "coalesce(f.is_reminder, false) = false",
                "in ('active', 'inactive')",
                "public.flow_is_schedule_open(",
                "private.flow_activity_summary_v1(",
                "where cardinality(flow_ids.ids) > 0",
                "where activity.is_counted_active or f.filed_is_saved",
                "f.filed_is_saved as visible_in_saved_list",
                "grant execute on function public.get_my_filed_flows_v1",
                "Single bounded My Flows list authority",
            ],
        )
        reject_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "create or replace function public.get_profile_flow_counts(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_canonical_flow_accountant_reads_user_relations_once(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924023519_make_canonical_flow_accounting_single_pass.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "member_calendars as materialized (",
                "flow_inputs as materialized (",
                "user_event_rows as materialized (",
                "from public.user_events ue\n    where ue.user_id = p_user_id",
                "when ue.flow_local_id is not null then ue.flow_local_id",
                "public.user_event_referenced_flow_id(",
                "left join action_flow_matches afm",
                "on cf.id = coalesce(uer.referenced_flow_id, afm.flow_id)",
                "from public.user_event_completions uec",
                "where uec.user_id = p_user_id",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "candidate_flow_ids as materialized (",
                "direct_event_rows as materialized (",
                "referenced_fallback_events as materialized (",
                "action_fallback_events as materialized (",
                "create or replace function public.get_my_filed_flows_v1(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_latest_flow_accountant_gates_metadata_to_unresolved_actions(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924025003_gate_flow_metadata_to_unresolved_actions.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "user_event_rows as materialized (",
                "unresolved_actions as materialized (",
                "from user_event_rows uer",
                "uer.flow_local_id is null",
                "uer.referenced_flow_id is null",
                "from unresolved_actions ua",
                "join candidate_flows cf",
                "public.flow_metadata_has_action_id(",
                "left join action_flow_matches afm",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "flow_action_map as materialized (",
                "public.flow_action_ids_from_metadata(",
                "create or replace function public.flow_action_ids_from_metadata(",
                "create or replace function public.get_my_filed_flows_v1(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_latest_flow_accountant_uses_indexed_ownership_branches(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924025608_bound_flow_accounting_to_indexed_ownership_branches.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "candidate_flow_ids as materialized (",
                "direct_event_rows as materialized (",
                "ue.flow_local_id = any(cfi.ids)",
                "referenced_fallback_events as materialized (",
                "public.user_event_referenced_flow_id(",
                ") is not null",
                "unresolved_actions as materialized (",
                "ue.action_id is not null",
                ") is null",
                "public.flow_metadata_has_action_id(",
                "action_fallback_events as materialized (",
                "from candidate_flows cf\n    join public.user_event_completions uec",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "user_event_rows as materialized (",
                "flow_action_map as materialized (",
                "public.flow_action_ids_from_metadata(",
                "create or replace function public.flow_action_ids_from_metadata(",
                "create or replace function public.get_my_filed_flows_v1(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_latest_flow_accountant_resolves_deletion_before_events(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924030720_avoid_rechecking_candidate_deletion_per_event.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "if p_flow_ids is not null and cardinality(p_flow_ids) = 0 then",
                "is_active_repeating_note",
                "candidate_flow_ids as materialized (",
                "direct_events as materialized (",
                "referenced_fallback_events as materialized (",
                "unresolved_actions as materialized (",
                "action_fallback_events as materialized (",
                "event_rows as materialized (",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "es.flow_notes",
                "es.flow_active",
                "es.flow_is_hidden",
                "user_event_rows as materialized (",
                "flow_action_map as materialized (",
                "public.flow_action_ids_from_metadata(",
                "create or replace function public.get_my_filed_flows_v1(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_existing_my_flows_authority_defers_display_flags(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924031041_simplify_existing_my_flows_wrapper.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.get_my_filed_flows_v1(",
                "coalesce(f.is_hidden, false) = false",
                "coalesce(f.is_reminder, false) = false",
                "public.flow_has_repeating_note_metadata(f.notes) = false",
                "private.flow_activity_summary_v1(",
                "selected_flows as materialized (",
                "where activity.is_counted_active or f.filed_is_saved",
                "limit p_limit",
                "social_flags as materialized (",
                "f.appearance",
                "f.filed_is_saved as visible_in_saved_list",
                "grant execute on function public.get_my_filed_flows_v1",
                "Single bounded My Flows list authority",
            ],
        )
        reject_all(
            self,
            body,
            [
                "public.flow_is_deleted_state(",
                "public.flow_record_kind(",
                "create or replace function private.flow_activity_summary_v1(",
                "create or replace function public.flow_action_ids_from_metadata(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_latest_accountant_inlines_only_single_use_stages(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924031656_inline_single_use_flow_accounting_stages.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "candidate_flows as materialized (",
                "unresolved_actions as materialized (",
                "action_flow_matches as materialized (",
                "event_source as materialized (",
                "reminder_refs as materialized (",
                "direct_events as (",
                "event_rows as (",
                "event_counts as (",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "direct_events as materialized (",
                "event_rows as materialized (",
                "event_counts as materialized (",
                "create or replace function public.get_my_filed_flows_v1(",
                "create or replace function public.flow_action_ids_from_metadata(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_latest_accountant_gates_tombstone_key_expansion(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924032113_gate_tombstone_key_expansion.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "active_tombstones as materialized (",
                "where edt.user_id = p_user_id",
                "edt.suppresses_client = true",
                "reminder_refs as materialized (",
                "where exists (select 1 from active_tombstones)",
                "tombstone_keys as (",
                "tombstoned_events as (",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "create or replace function public.get_my_filed_flows_v1(",
                "create or replace function public.user_event_reminder_uuid(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_latest_accountant_has_guarded_direct_only_path(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924032438_short_circuit_direct_only_flow_accounting.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "v_has_legacy_events boolean",
                "v_has_active_tombstones boolean",
                "into v_has_legacy_events",
                "into v_has_active_tombstones",
                "if not v_has_legacy_events and not v_has_active_tombstones then",
                "ue.flow_local_id is null",
                "public.user_event_referenced_flow_id(",
                ") is not null",
                "ue.action_id is not null",
                ") is null",
                "direct_events as (",
                "event_counts as (",
                "unresolved_actions as materialized (",
                "active_tombstones as materialized (",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "create or replace function public.get_my_filed_flows_v1(",
                "create or replace function public.user_event_referenced_flow_id(",
                "create or replace function public.flow_action_ids_from_metadata(",
                "insert into ",
                "update public.",
                "delete from ",
                "create index ",
                "alter table ",
                "drop table ",
            ],
        )

    def test_commons_uses_one_complete_social_snapshot_authority(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923194527_restore_canonical_commons_home.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.get_commons_home(",
                "from public.get_profile_feed(8, 0) feed_row",
                "create or replace function public.get_commons_home_cards(",
                "select public.get_commons_home(",
                "Compatibility delegate to the canonical get_commons_home RPC",
            ],
        )
        reject_all(
            self,
            body,
            [
                "v_discover := public.get_profile_feed_cards(8, 0)",
                "private.social_flow_post_card_metadata",
            ],
        )

    def test_flow_activity_completion_reads_use_selected_flow_index(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923193916_optimize_flow_activity_completion_reads.sql"
        )
        require_all(
            self,
            body,
            [
                "completion_keys as materialized (",
                "join public.user_event_completions uec",
                "and uec.flow_id = cf.id",
                "left join completion_keys completion",
                "(completion.flow_id is not null) as is_completed",
                "and er.is_completed",
                "or not er.is_completed",
            ],
        )
        reject_all(
            self,
            body,
            [
                "left join public.user_event_completions uec\n"
                "      on uec.user_id = es.user_id",
                "uec.id as completion_id",
            ],
        )

    def test_flow_activity_fallback_expands_each_flow_once(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923192643_optimize_flow_activity_fallback_once.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function private.flow_activity_summary_v1(",
                "flow_action_map as materialized (",
                "flow_action_ids_from_metadata(source_flow.ai_metadata)",
                "join flow_action_map fam",
                "fam.action_id = ua.action_id",
                "grant execute on function private.flow_activity_summary_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "flow_metadata_has_action_id(\n        cf.ai_metadata,",
            ],
        )

    def test_canonical_social_and_filing_reads_are_restored(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923191515_restore_canonical_social_and_filing_reads.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.get_profile_feed(",
                "fp.ai_metadata",
                "partition by ranked.user_id",
                "order by\n    ar.author_sequence asc",
                "source_flow.appearance",
                "create index if not exists user_events_flow_filing_cover_idx",
                "create index if not exists flow_posts_flow_id_visible_idx",
                "create function public.get_my_filed_flows_v1(",
                "f.appearance",
                "cross join lateral private.flow_activity_summary_v1(",
                "grant execute on function public.get_profile_feed",
                "grant execute on function public.get_my_filed_flows_v1",
            ],
        )
        reject_all(
            self,
            body,
            [
                "private.social_flow_post_card_metadata(fp.ai_metadata)",
                "public.get_profile_feed_cards(",
            ],
        )

    def test_flow_reads_keep_direct_owner_authority(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923160113_repair_social_flow_reads.sql"
        )
        require_all(
            self,
            body,
            [
                "create policy flows_select_visible",
                "to authenticated",
                "user_id = (select auth.uid())",
                "scm.user_id = (select auth.uid())",
                "fs.deleted_at is null",
                "fs.sender_id = (select auth.uid())",
                "fs.recipient_id = (select auth.uid())",
            ],
        )

    def test_social_feed_first_page_cannot_be_monopolized_by_one_author(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260923172656_make_social_reads_resilient.sql"
        )
        require_all(
            self,
            body,
            [
                "author_ranked as",
                "partition by item ->> 'user_id'",
                "order by author_sequence asc, score desc",
                "cannot monopolize the first page",
            ],
        )

    def test_social_feed_cards_keep_full_snapshots_out_of_list_payloads(self) -> None:
        boundary = source(
            "supabase/migrations/"
            "20260923032710_social_feed_card_payloads.sql"
        )
        feed = source(
            "supabase/migrations/"
            "20260923033313_optimize_social_feed_cards.sql"
        )
        commons = source(
            "supabase/migrations/"
            "20260923033701_optimize_commons_home_cards.sql"
        )
        require_all(
            self,
            boundary,
            [
                "private.social_flow_post_card_metadata",
                "p_ai_metadata #> '{payload,appearance}'",
                "public.get_profile_feed_cards",
                "public.get_profile_feed(p_limit, p_offset)",
                "public.get_commons_home_cards",
                "public.get_commons_home(",
                "item - 'ai_metadata'",
                "to authenticated",
            ],
        )
        require_all(
            self,
            feed,
            [
                "from public.flow_posts fp",
                "from public.insight_posts ip",
                "private.social_flow_post_card_metadata(fp.ai_metadata)",
                "from public.flow_post_likes l",
                "from public.flow_post_comments c",
                "from public.follows f",
                "from public.user_blocks b",
            ],
        )
        require_all(
            self,
            commons,
            [
                "public.get_community_rhythm_rollups",
                "public.commons_answer_json",
                "public.shared_practice_room_card_json",
                "public.get_profile_feed_cards(8, 0)",
                "'my_shared_practices'",
                "'public_shared_practices'",
            ],
        )
        reject_all(
            self,
            f"{boundary}\n{feed}\n{commons}",
            [
                "p_ai_metadata #> '{payload,events}'",
                "p_ai_metadata -> 'events'",
            ],
        )

    def test_user_flow_appearance_has_one_private_storage_contract(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260921004056_user_flow_appearance.sql"
        )
        select_start = body.index("select\n")
        from_start = body.index("from public.flows f", select_start)
        catalog_select = body[select_start:from_start]

        self.assertGreater(
            catalog_select.index("f.appearance"),
            catalog_select.index("f.root_flow_id"),
            "CREATE OR REPLACE VIEW may only append a new view column",
        )
        require_all(
            self,
            body,
            [
                "add column if not exists appearance jsonb",
                "jsonb_typeof(appearance) = 'object'",
                "with (security_invoker = true)",
                "'flow-appearance-images', false",
                "(storage.foldername(name))[1]",
                "to authenticated",
                "fs.payload_json -> 'appearance'",
                "fp.ai_metadata -> 'payload' -> 'appearance'",
                "attach_flow_appearance_to_share_snapshot",
                "before insert on public.flow_shares",
                "f.user_id = new.sender_id",
                "jsonb_build_object('appearance', source_appearance)",
                "revoke all on function "
                "public.attach_flow_appearance_to_share_snapshot()",
            ],
        )

    def test_reading_house_invites_have_one_live_delivery_identity(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260920014848_reading_house_invite_source_identity.sql"
        )
        require_all(
            self,
            body,
            [
                "add column if not exists source_flow_id bigint",
                "add column if not exists source_flow_key text",
                "add column if not exists source_title text",
                "create or replace view "
                "public.shared_calendar_invite_filing_items_client",
                "with (security_invoker = true)",
                "member.source_flow_id",
                "member.source_flow_key",
                "member.source_title as source_book_title",
                "p_source_flow_id bigint default null",
                "flow.calendar_id = p_calendar_id",
                "flow.ai_metadata ->> 'flow_key' = 'the-reading-house'",
                "coalesce(flow.notes, '') like '%maat=the-reading-house%'",
                "member.user_id = auth.uid()",
                "member.source_flow_key = 'the-reading-house'",
                "jsonb_strip_nulls",
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
                "set local role authenticated;",
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

    def test_scheduled_notification_no_token_state_is_additive_only(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924220159_add_scheduled_notification_no_token_state.sql"
        )
        require_all(
            self,
            body,
            [
                "add column no_token_attempt_count integer not null default 0",
                "add column no_token_first_at timestamp with time zone",
                "add column next_attempt_at timestamp with time zone",
                "add column expires_at timestamp with time zone",
                "add column token_available_at timestamp with time zone",
                "scheduled_notifications_no_token_attempt_count_nonnegative",
                "check (no_token_attempt_count >= 0)",
            ],
        )
        for forbidden in [
            r"^\s*update\s+public\.scheduled_notifications\b",
            r"^\s*create\s+(?:or\s+replace\s+)?function\b",
            r"^\s*create\s+trigger\b",
            r"^\s*create\s+policy\b",
            r"^\s*grant\b",
            r"^\s*revoke\b",
            r"\bclaim_due_scheduled_notifications\b",
            r"\bcron_reminder_push\b",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertIsNone(
                    re.search(forbidden, body, re.IGNORECASE | re.MULTILINE)
                )

    def test_push_token_activation_wakes_only_existing_no_token_waits(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924224005_wake_no_token_notifications_on_token_activation.sql"
        )
        require_all(
            self,
            body,
            [
                "create function "
                "private.wake_no_token_notifications_on_token_activation()",
                "security definer",
                "set search_path = ''",
                "new.is_active is not true",
                "old.is_active is true",
                "old.user_id is not distinct from new.user_id",
                "set token_available_at = v_now,",
                "next_attempt_at = v_now",
                "notification.user_id = new.user_id",
                "notification.is_active is true",
                "notification.last_error = 'no_tokens_for_recipients'",
                "notification.no_token_attempt_count > 0",
                "notification.no_token_first_at is not null",
                "notification.next_attempt_at is not null",
                "notification.expires_at > v_now",
                "from public, anon, authenticated, service_role",
                "after insert or update of is_active on public.push_tokens",
            ],
        )
        reject_all(
            self,
            body,
            [
                "claim_due_scheduled_notifications",
                "cron_reminder_push",
                "send_push",
                "set is_active =",
                "set attempt_count =",
                "set last_error =",
                "set last_attempt_at =",
                "set claimed_at =",
                "set claim_token =",
                "create policy",
                "alter policy",
                "grant ",
                "alter table",
                "create index",
            ],
        )

    def test_push_token_activation_rollback_keeps_cut2_state(self) -> None:
        body = source(
            "supabase/dev/"
            "rollback_wake_no_token_notifications_on_token_activation.sql"
        )
        require_all(
            self,
            body,
            [
                "drop trigger if exists "
                "wake_no_token_notifications_on_token_activation",
                "on public.push_tokens",
                "drop function if exists",
                "private.wake_no_token_notifications_on_token_activation()",
            ],
        )
        reject_all(
            self,
            body,
            [
                "drop column",
                "scheduled_notifications",
                "claim_due_scheduled_notifications",
                "cron_reminder_push",
            ],
        )

    def test_claim_rpc_adds_only_the_complete_no_token_retry_window(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924230252_claim_scheduled_notifications_no_token_retry_window.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.claim_due_scheduled_notifications(",
                "p_now timestamp with time zone default now()",
                "p_limit integer default 500",
                "p_lease_seconds integer default 900",
                "returns table(",
                "security definer",
                "set search_path = public",
                "sn.is_active = true",
                "sn.scheduled_at <= p_now",
                "sn.last_error = 'no_tokens_for_recipients'",
                "sn.no_token_attempt_count > 0",
                "sn.no_token_first_at is not null",
                "sn.next_attempt_at is not null",
                "sn.expires_at is not null",
                ") is not true",
                "sn.next_attempt_at <= p_now",
                "p_now < sn.expires_at",
                "sn.token_available_at < sn.expires_at",
                "p_now <= sn.expires_at + interval '2 minutes'",
                "sn.claimed_at < (p_now - v_lease)",
                "order by sn.scheduled_at asc, sn.id asc",
                "for update skip locked",
                "limit v_limit",
                "set claimed_at = p_now,",
                "claim_token = v_claim_token,",
                "updated_at = p_now",
            ],
        )
        for forbidden in [
            r"\bcron_reminder_push\b",
            r"\bwake_no_token_notifications_on_token_activation\b",
            r"^\s*(?:create|drop)\s+trigger\b",
            r"^\s*(?:create|alter|drop)\s+policy\b",
            r"^\s*create\s+(?:unique\s+)?index\b",
            r"^\s*alter\s+table\b",
            r"^\s*(?:grant|revoke)\b",
            r"\bset\s+is_active\s*=",
            r"\bset\s+attempt_count\s*=",
            r"\bset\s+last_error\s*=",
            r"\bset\s+last_attempt_at\s*=",
            r"\bset\s+no_token_attempt_count\s*=",
            r"\bset\s+no_token_first_at\s*=",
            r"\bset\s+next_attempt_at\s*=",
            r"\bset\s+expires_at\s*=",
            r"\bset\s+token_available_at\s*=",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertIsNone(
                    re.search(forbidden, body, re.IGNORECASE | re.MULTILINE)
                )

    def test_claim_rpc_rollback_restores_exact_legacy_contract_and_acl(self) -> None:
        body = source(
            "supabase/dev/"
            "rollback_claim_scheduled_notifications_no_token_retry_window.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.claim_due_scheduled_notifications(",
                "sn.is_active = true",
                "sn.scheduled_at <= p_now",
                "sn.claimed_at is null",
                "sn.claimed_at < (p_now - v_lease)",
                "order by sn.scheduled_at asc, sn.id asc",
                "for update skip locked",
                "set claimed_at = p_now,",
                "claim_token = v_claim_token,",
                "updated_at = p_now",
                "owner to postgres",
                "from public, postgres, anon, authenticated, service_role",
                "to postgres",
                "to anon, authenticated, service_role",
            ],
        )
        reject_all(
            self,
            body,
            [
                "no_token_attempt_count",
                "no_token_first_at",
                "next_attempt_at",
                "expires_at",
                "token_available_at",
                "wake_no_token_notifications_on_token_activation",
                "cron_reminder_push",
                "drop column",
            ],
        )

    def test_claim_rpc_concurrency_smoke_exercises_skip_locked(self) -> None:
        body = source(
            "supabase/dev/claim_scheduled_notifications_concurrency_smoke.sh"
        )
        require_all(
            self,
            body,
            [
                "claim_due_scheduled_notifications(",
                "pg_advisory_xact_lock(2147483000, 404)",
                "from pg_locks",
                "session A did not claim exactly one fixture row",
                "session B did not SKIP LOCKED",
                "claimed_at = '1801-01-01 00:00:00+00'",
                "claim_token is not null",
            ],
        )

    def test_reflection_generation_key_schema_is_additive_only(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260924234345_add_reflection_generation_key.sql"
        )
        require_all(
            self,
            body,
            [
                "-- pg-delta: transaction=false",
                "alter table public.reflection_generations",
                "add column generation_key text",
                "create unique index concurrently "
                "reflection_generations_generation_key_uidx",
                "on public.reflection_generations using btree (generation_key)",
                "where generation_key is not null",
            ],
        )
        for forbidden in [
            r"^\s*(?:insert|update|delete)\s+",
            r"^\s*create\s+(?:or\s+replace\s+)?function\b",
            r"^\s*create\s+trigger\b",
            r"^\s*(?:create|alter|drop)\s+policy\b",
            r"^\s*(?:grant|revoke)\b",
            r"\bcron_maat_decan_opening\b",
            r"\bai_generate_reflection\b",
            r"\(\s*user_id\s*,\s*period_key\s*\)",
            r"generation_key\s+text\s+not\s+null",
            r"generation_key\s+text\s+default",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertIsNone(
                    re.search(forbidden, body, re.IGNORECASE | re.MULTILINE)
                )

    def test_reflection_generation_key_rollback_is_narrow(self) -> None:
        body = source(
            "supabase/dev/rollback_reflection_generation_key.sql"
        )
        require_all(
            self,
            body,
            [
                "-- pg-delta: transaction=false",
                "drop index concurrently if exists",
                "public.reflection_generations_generation_key_uidx",
                "alter table public.reflection_generations",
                "drop column if exists generation_key",
            ],
        )
        reject_all(
            self,
            body,
            [
                "drop table",
                "drop function",
                "drop trigger",
                "delete from",
                "update public.",
            ],
        )

    def test_canonical_opening_truth_migration_is_view_only(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260925045707_canonicalize_decan_opening_truth.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace view public.maat_output_truth_loop",
                "with (security_invoker = true) as",
                "from public.maat_guidance_output_truth_loop g",
                "union all",
                "from public.reflection_generations r",
                "where r.metadata ? 'output_control'",
                "r.period_type is distinct from 'decan_opening'",
                "or exists (",
                "from public.maat_guidance_deliveries d",
                "d.kind = 'decan_opening'",
                "d.generation_id = r.id",
                "d.user_id = r.user_id",
                "d.decan_period_key = r.period_key",
            ],
        )
        self.assertEqual(
            body.lower().count(
                "create or replace view public.maat_output_truth_loop"
            ),
            1,
        )
        for forbidden in [
            r"^\s*(?:insert|update|delete)\s+",
            r"^\s*(?:create|alter|drop)\s+table\b",
            r"^\s*create\s+(?:unique\s+)?index\b",
            r"^\s*create\s+materialized\s+view\b",
            r"^\s*(?:create|alter|drop)\s+policy\b",
            r"^\s*(?:grant|revoke)\b",
            r"\bowner\s+to\b",
            r"generation_key\s+is\s+(?:not\s+)?null",
            r"max\s*\(\s*(?:r\.)?created_at",
            r"distinct\s+on\s*\(",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertIsNone(
                    re.search(forbidden, body, re.IGNORECASE | re.MULTILINE)
                )

    def test_canonical_opening_truth_smoke_covers_authority_contract(self) -> None:
        body = source(
            "supabase/dev/canonical_decan_opening_truth_smoke.sql"
        )
        require_all(
            self,
            body,
            [
                "Cut 9 ordinary decan truth row.",
                "Cut 9 canonical legacy opening.",
                "Cut 9 canonical keyed opening.",
                "Cut 9 historical duplicate one.",
                "Cut 9 historical duplicate two.",
                "Cut 9 mismatched-user opening.",
                "Cut 9 mismatched-period opening.",
                "generation_key is null",
                "cut9:keyed-canonical-generation",
                "A duplicate or mismatched opening leaked into truth output",
                "Opening truth output escaped canonical pointer authority",
                "EXISTS canonicalization multiplied opening truth rows",
                "Guidance truth branch semantics changed",
                "Cut 9 changed the maat_output_truth_loop column contract",
                "Cut 9 changed the maat_output_truth_loop column types",
                "Cut 9 changed view ownership or security behavior",
                "Cut 9 changed the view SELECT ACL",
                "rollback;",
            ],
        )

    def test_canonical_opening_truth_rollback_restores_prior_view_only(self) -> None:
        body = source(
            "supabase/dev/rollback_canonical_decan_opening_truth.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace view public.maat_output_truth_loop",
                "with (security_invoker = true) as",
                "from public.maat_guidance_output_truth_loop g",
                "union all",
                "from public.reflection_generations r",
                "where r.metadata ? 'output_control';",
            ],
        )
        reject_all(
            self,
            body,
            [
                "maat_guidance_deliveries d",
                "generation_key",
                "insert into",
                "update public.",
                "delete from",
                "drop table",
                "drop view",
                "grant ",
                "revoke ",
            ],
        )

    def test_manifest_v2_reader_migration_is_view_only(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260925151516_reflection_generation_manifest_v2_readers.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace view public.maat_output_truth_loop",
                "with (security_invoker = true) as",
                "from public.maat_guidance_output_truth_loop g",
                "union all",
                "from public.reflection_generations r",
                "reflection_generation_manifest_v2",
                "{manifest,truth,surface}",
                "{manifest,truth,speech_act}",
                "{manifest,truth,delivery_channel}",
                "{manifest,truth,grade,guidance_worthiness_score}",
                "{manifest,truth,grade,action_clarity_score}",
                "{manifest,truth,repair,pre_repair_text}",
                "{manifest,truth,repair,post_repair_text}",
                "r.metadata ? 'output_control'",
                "r.period_type is distinct from 'decan_opening'",
                "from public.maat_guidance_deliveries d",
                "d.kind = 'decan_opening'",
                "d.generation_id = r.id",
                "d.user_id = r.user_id",
                "d.decan_period_key = r.period_key",
            ],
        )
        self.assertEqual(
            body.lower().count(
                "create or replace view public.maat_output_truth_loop"
            ),
            1,
        )
        for forbidden in [
            r"^\s*(?:insert|update|delete)\s+",
            r"^\s*(?:create|alter|drop)\s+table\b",
            r"^\s*create\s+(?:unique\s+)?index\b",
            r"^\s*create\s+materialized\s+view\b",
            r"^\s*(?:create|alter|drop)\s+policy\b",
            r"^\s*(?:grant|revoke)\b",
            r"\bowner\s+to\b",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertIsNone(
                    re.search(forbidden, body, re.IGNORECASE | re.MULTILINE)
                )

    def test_manifest_v2_reader_preserves_guidance_branch_exactly(self) -> None:
        cut9 = source(
            "supabase/migrations/"
            "20260925045707_canonicalize_decan_opening_truth.sql"
        )
        cut11 = source(
            "supabase/migrations/"
            "20260925151516_reflection_generation_manifest_v2_readers.sql"
        )
        cut9_view = cut9[cut9.lower().index("create or replace view") :]
        cut11_view = cut11[cut11.lower().index("create or replace view") :]
        self.assertEqual(
            cut11_view.lower().split("union all", 1)[0].strip(),
            cut9_view.lower().split("union all", 1)[0].strip(),
        )

    def test_manifest_v2_reader_smoke_covers_equivalence_contract(self) -> None:
        body = source(
            "supabase/dev/"
            "reflection_generation_manifest_v2_readers_smoke.sql"
        )
        require_all(
            self,
            body,
            [
                "reflection_generation_manifest_v2",
                "Pure v2 fixture retained a bulky v1 output_control tree",
                "Paired v1/v2 truth projections are not equivalent",
                "Mixed v1/v2 truth row did not prefer Manifest v2",
                "Unknown manifest version masqueraded as supported v2",
                "V1 output_control projection changed",
                "V2 compact output_control lost review pre-repair text",
                "V2 compact output_control lost review post-repair text",
                "rollback;",
            ],
        )

    def test_manifest_v2_reader_rollback_restores_cut9_exactly(self) -> None:
        cut9 = source(
            "supabase/migrations/"
            "20260925045707_canonicalize_decan_opening_truth.sql"
        )
        rollback = source(
            "supabase/dev/"
            "rollback_reflection_generation_manifest_v2_readers.sql"
        )
        cut9_view = cut9[cut9.lower().index("create or replace view") :]
        rollback_view = rollback[
            rollback.lower().index("create or replace view") :
        ]
        self.assertEqual(rollback_view, cut9_view)

    def test_manifest_v2_writer_is_ordinary_decan_persistence_only(self) -> None:
        writer = source("supabase/functions/ai_generate_reflection/index.ts")
        helper = source(
            "supabase/functions/ai_generate_reflection/"
            "reflection_generation_manifest_v2.ts"
        )
        persist_start = writer.index("if (payload.persist)")
        response_start = writer.index("return new Response", persist_start)
        persistence = writer[persist_start:response_start]
        response_end = writer.index("// Legacy fallback", response_start)
        response = writer[response_start:response_end]

        require_all(
            self,
            persistence,
            [
                'from("decan_reflections")',
                'from("reflection_generations")',
                'period_type: "decan"',
                "buildReflectionGenerationManifestV2Storage({",
                "source_snapshot: generationStorage.sourceSnapshot",
                "metadata: generationStorage.metadata",
                '.select("id")',
                ".single()",
            ],
        )
        reject_all(
            self,
            persistence,
            [
                "output_control:",
                'period_type: "decan_opening"',
                ".update(",
                ".delete(",
            ],
        )
        require_all(
            self,
            helper,
            [
                '"reflection_generation_manifest_v2"',
                "decan_reflection_id: input.reflectionId",
                "render:",
                "graph:",
                "truth:",
                "guidance_worthiness_score:",
                "action_clarity_score:",
                "pre_repair_text:",
                "post_repair_text:",
            ],
        )
        reject_all(
            self,
            helper,
            [
                "output_control:",
                "shaping_fingerprint",
                "memory_brief",
                "maat_flow_decan_pattern",
            ],
        )
        require_all(
            self,
            response,
            [
                "success: true",
                "reflection: reflectionText",
                "modelUsed",
                "reflection_id: reflectionId",
                "reflection_generation_id: reflectionGenerationId",
                "outputControl:",
            ],
        )

    def test_manifest_v2_writer_does_not_change_opening_persistence(self) -> None:
        opening = source(
            "supabase/functions/cron_maat_decan_opening/index.ts"
        )
        require_all(
            self,
            opening,
            [
                'period_type: "decan_opening"',
                "generation_key: generationKey",
                'from("reflection_generations")',
            ],
        )
        self.assertNotIn("reflection_generation_manifest_v2", opening)

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


    def test_unique_grain_delivery_ledger_is_additive_and_reader_neutral(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260925222052_create_unique_grain_delivery_ledger.sql"
        )
        require_all(
            self,
            body,
            [
                "create table public.maat_delivery_ledger (",
                "delivery_key text primary key",
                "raw_event_count bigint not null default 0",
                "duplicate_sent_count bigint generated always as",
                "sent_latency_sum_seconds bigint not null default 0",
                "late_sent_count bigint not null default 0",
                "alter table public.maat_delivery_ledger enable row level security",
                "revoke all privileges on table public.maat_delivery_ledger",
                "grant all privileges on table public.maat_delivery_ledger to service_role",
                "create table private.maat_delivery_ledger_live_event_ids",
                "create unlogged table private.maat_delivery_ledger_backfill_batch",
                "create or replace function private.sync_maat_delivery_ledger_from_raw()",
                "security definer\nset search_path = pg_catalog, public, private",
                "create trigger maat_delivery_ledger_sync",
                "after insert on public.maat_delivery_timing_events",
                "on conflict (delivery_key) do update",
                "maat delivery ledger identity drift",
                "create or replace function private.backfill_maat_delivery_ledger()",
                "not exists (\n    select 1\n    from private.maat_delivery_ledger_live_event_ids",
                "backfill_completed_at",
                "already_completed",
            ],
        )
        reject_all(
            self,
            body,
            [
                "create or replace view public.maat_delivery_recent_events",
                "create or replace view public.maat_delivery_timing_health",
                "create or replace view public.maat_delivery_receipt_health",
                "create or replace view public.maat_delivery_alerts",
                "update public.maat_delivery_timing_events",
                "delete from public.maat_delivery_timing_events",
                "truncate public.maat_delivery_timing_events",
                "alter table public.maat_delivery_timing_events add column",
            ],
        )

        rollback = source(
            "supabase/dev/rollback_unique_grain_delivery_ledger.sql"
        )
        require_all(
            self,
            rollback,
            [
                "drop trigger if exists maat_delivery_ledger_sync",
                "drop trigger if exists zz_maat_delivery_ledger_handoff_cleanup",
                "drop function if exists private.sync_maat_delivery_ledger_from_raw()",
                "drop function if exists private.backfill_maat_delivery_ledger()",
                "drop function if exists private.backfill_maat_delivery_ledger(integer)",
                "drop function if exists private.finalize_maat_delivery_ledger_backfill()",
                "drop function if exists private.cleanup_maat_delivery_ledger_live_event_id()",
                "drop table if exists private.maat_delivery_ledger_live_event_ids",
                "drop table if exists private.maat_delivery_ledger_backfill_batch",
                "drop table if exists private.maat_delivery_ledger_backfill_state",
                "drop table if exists public.maat_delivery_ledger",
            ],
        )
        reject_all(
            self,
            rollback,
            [
                "drop table public.maat_delivery_timing_events",
                "delete from public.maat_delivery_timing_events",
                "truncate public.maat_delivery_timing_events",
                "create or replace view",
            ],
        )

    def test_delivery_ledger_backfill_is_bounded_resumable_and_reader_neutral(
        self,
    ) -> None:
        old_receipt = ROOT / (
            "supabase/migrations/"
            "20260925214532_create_unique_grain_delivery_ledger.sql"
        )
        self.assertFalse(old_receipt.exists())
        renamed_receipt = ROOT / (
            "supabase/migrations/"
            "20260925222052_create_unique_grain_delivery_ledger.sql"
        )
        self.assertEqual(
            hashlib.sha256(renamed_receipt.read_bytes()).hexdigest(),
            "5a8250d2b944fd9877a0684ee11888408cce3744f550c5e01b214a2fd1dcff70",
        )

        body = source(
            "supabase/migrations/"
            "20260926002638_resumable_delivery_ledger_backfill.sql"
        )
        require_all(
            self,
            body,
            [
                "backfill_cursor_delivery_key text",
                "backfill_batches_completed bigint not null default 0",
                "last_batch_started_at timestamp with time zone",
                "last_batch_completed_at timestamp with time zone",
                "last_batch_delivery_keys integer",
                "last_batch_raw_events bigint",
                "create function private.backfill_maat_delivery_ledger(",
                "p_batch_size integer default 200",
                "p_batch_size > 250",
                "event.delivery_key > v_state.backfill_cursor_delivery_key",
                "array_agg(next_key.delivery_key order by next_key.delivery_key)",
                "limit p_batch_size",
                "select distinct on (event.delivery_key)",
                "order by event.delivery_key, event.created_at desc, event.id desc",
                "maat delivery ledger batch parity failed",
                "backfill_batches_completed = backfill_batches_completed + 1",
                "create function private.finalize_maat_delivery_ledger_backfill()",
                "maat delivery ledger finalization found an unprocessed baseline key",
                "truncate table private.maat_delivery_ledger_live_event_ids",
                "create trigger zz_maat_delivery_ledger_handoff_cleanup",
                "execute function private.cleanup_maat_delivery_ledger_live_event_id()",
            ],
        )
        reject_all(
            self,
            body,
            [
                "create or replace view public.maat_delivery_recent_events",
                "create or replace view public.maat_delivery_timing_health",
                "create or replace view public.maat_delivery_receipt_health",
                "create or replace view public.maat_delivery_alerts",
                "update public.maat_delivery_timing_events",
                "delete from public.maat_delivery_timing_events",
                "truncate public.maat_delivery_timing_events",
                "alter table public.maat_delivery_timing_events add column",
                "offset ",
            ],
        )

    def test_unique_grain_delivery_ledger_has_parity_and_concurrency_gates(self) -> None:
        workflow = source(".github/workflows/supabase-functions.yml")
        require_all(
            self,
            workflow,
            [
                "supabase/dev/maat_delivery_ledger_smoke.sql",
                "supabase/dev/maat_delivery_ledger_concurrency_smoke.sh",
            ],
        )

        parity = source("supabase/dev/maat_delivery_ledger_parity.sql")
        require_all(
            self,
            parity,
            [
                "raw_by_key as materialized",
                "mismatched_delivery_keys",
                "one_row_per_delivery_key",
                "sent_latency_sum_seconds",
                "duplicate_sent_keys",
                "pg_current_snapshot()::text",
            ],
        )

    def test_cut_14_cleanup_is_explicit_bounded_and_preserves_live_writers(
        self,
    ) -> None:
        body = source(
            "supabase/migrations/"
            "20260926044418_contain_test_era_history.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function public.active_maat_user_ids(",
                "revoke all on function public.active_maat_user_ids",
                "create or replace function private.prune_bounded_history()",
                "clock_timestamp() - interval '14 days'",
                "clock_timestamp() - interval '90 days'",
                "clock_timestamp() - interval '30 days'",
                "drop trigger if exists trg_audit_app_events",
                "drop trigger if exists trg_audit_user_events",
                "drop trigger if exists trg_audit_flows",
                "drop trigger if exists trg_log_flow_inserts",
                "public.maat_delivery_timing_events,",
                "public.maat_delivery_ledger,",
                "backfill_completed_at,",
                "public.reflection_generations,",
                "public.decan_reflections,",
                "public.maat_snapshots,",
                "public.maat_guidance_evaluations,",
                "truncate table public.audit_log restart identity",
                "truncate table public.app_events",
                "haw_bounded_history_retention",
            ],
        )
        reject_all(
            self,
            body,
            [
                " cascade",
                "vacuum full",
                "truncate table public.admin_audit_log",
                "delete from public.admin_audit_log",
                "truncate table public.user_events",
                "truncate table public.flows",
                "truncate table public.profiles",
                "truncate table auth.users",
            ],
        )

        evaluation = source(
            "supabase/functions/cron_evaluate_maat_guidance/index.ts"
        )
        opening = source(
            "supabase/functions/cron_maat_decan_opening/index.ts"
        )
        reflection_push = source(
            "supabase/functions/cron_decan_reflection_push/index.ts"
        )
        reflection_reconcile = source(
            "supabase/functions/cron_decan_reflection_reconcile/index.ts"
        )
        require_all(
            self,
            evaluation,
            [
                "listActiveMaatUserIds",
                'profileQuery.in("id", activeUserIds)',
            ],
        )
        require_all(
            self,
            opening,
            [
                "listActiveMaatUserIds",
                'profileQuery.in("id", activeUserIds)',
            ],
        )
        require_all(
            self,
            reflection_push,
            [
                "hasActivePushToken",
                "generation_skipped: true",
                "hasEligiblePushToken(row.user_id)",
                'cronJobName: "decan_reflection_one_shot"',
            ],
        )
        reject_all(
            self,
            reflection_push,
            [
                "listActiveMaatUserIds",
                "seedMissingSchedules",
            ],
        )
        require_all(
            self,
            reflection_reconcile,
            [
                "listActiveMaatUserIds",
                "reconcileDecanReflectionSchedules",
                '"reconcile_decan_reflection_scheduler"',
            ],
        )

    def test_cut_15_moves_only_aggregate_health_readers_to_ledger(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260926051956_move_delivery_health_to_ledger.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace view public.maat_delivery_timing_health",
                "create or replace view public.maat_delivery_receipt_health",
                "with (security_invoker = true)",
                "from public.maat_delivery_ledger ledger",
                "ledger.last_event_at >= now() - interval '14 days'",
                "sum(ledger.picked_count)::bigint",
                "sum(ledger.sent_count)::bigint",
                "count(*) filter (where ledger.sent_count > 1)",
                "sum(ledger.sent_latency_sum_seconds)::numeric",
                "nullif(sum(ledger.sent_latency_count), 0)",
                "ledger.first_delivered_at as sent_at",
                "ledger.min_sent_latency_seconds as server_delivery_latency_seconds",
                "from public.maat_delivery_receipt_events receipt",
                "interval '15 minutes'",
                "interval '1 hour'",
            ],
        )
        reject_all(
            self,
            body,
            [
                "create or replace view public.maat_delivery_recent_events",
                "create or replace view public.maat_delivery_push_release_blockers",
                "create or replace view public.maat_delivery_alerts",
                "create or replace view public.maat_delivery_cron_health",
                "public.maat_delivery_timing_events",
                "insert into ",
                "update public.",
                "delete from ",
                "truncate ",
                "grant ",
                "revoke ",
            ],
        )

        workflow = source(".github/workflows/supabase-functions.yml")
        self.assertIn(
            "supabase/dev/cut15_delivery_health_ledger_readers_smoke.sql",
            workflow,
        )

        smoke = source(
            "supabase/dev/cut15_delivery_health_ledger_readers_smoke.sql"
        )
        require_all(
            self,
            smoke,
            [
                "cut15_raw_timing_expected",
                "cut15_raw_receipt_expected",
                "raw and ledger timing-health aggregates differ",
                "raw and ledger receipt-health results differ",
                "receipt status transition contract changed",
                "ledger-backed alert behavior changed",
                "recent events no longer uses raw timing events",
                "push release blockers lost recent-events authority",
                "ledger became directly visible to a client role",
            ],
        )

        rollback = source(
            "supabase/dev/rollback_cut15_delivery_health_to_raw.sql"
        )
        require_all(
            self,
            rollback,
            [
                "create or replace view public.maat_delivery_timing_health",
                "create or replace view public.maat_delivery_receipt_health",
                "from public.maat_delivery_timing_events event",
                "left join duplicate_sent_keys duplicate",
                "from public.maat_delivery_receipt_events receipt",
            ],
        )

    def test_cut_17_bounds_only_pg_cron_run_history(self) -> None:
        body = source(
            "supabase/migrations/"
            "20260926060109_bound_cron_job_run_details_history.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function "
                "private.prune_cron_job_run_details()",
                "delete from cron.job_run_details run",
                "run.start_time < clock_timestamp() - interval '14 days'",
                "revoke all on function "
                "private.prune_cron_job_run_details()",
                "grant execute on function "
                "private.prune_cron_job_run_details()",
                "to service_role",
                "v_cron_job_run_details := "
                "private.prune_cron_job_run_details()",
                "'cron_job_run_details', v_cron_job_run_details",
            ],
        )
        reject_all(
            self,
            body,
            [
                "truncate ",
                "vacuum full",
                " cascade",
                "create or replace view public.maat_delivery_cron_health",
                "update cron.",
                "delete from cron.job ",
            ],
        )

        workflow = source(".github/workflows/supabase-functions.yml")
        self.assertIn(
            "supabase/dev/cut17_cron_job_run_details_retention_smoke.sql",
            workflow,
        )

        smoke = source(
            "supabase/dev/cut17_cron_job_run_details_retention_smoke.sql"
        )
        require_all(
            self,
            smoke,
            [
                "expected two expired cron rows",
                "recent/current cron rows were removed",
                "cron run-detail retention is not idempotent",
                "reminder cron-health projection changed",
                "reflection cron-health projection changed",
                "daily bounded-history cleanup did not report cron delete",
                "cron definitions or health-view contract changed",
            ],
        )

    def test_cut_18_rejects_only_strictly_stale_restoration_updates(
        self,
    ) -> None:
        body = source(
            "supabase/migrations/"
            "20260926063608_prevent_stale_restoration_snapshot_updates.sql"
        )
        require_all(
            self,
            body,
            [
                "create or replace function "
                "private.prevent_stale_restoration_snapshot_update()",
                "returns trigger",
                "security invoker",
                "set search_path = pg_catalog",
                "if new.updated_at < old.updated_at then",
                "return null",
                "return new",
                "revoke all on function "
                "private.prevent_stale_restoration_snapshot_update()",
                "create trigger user_app_restoration_prevent_stale_update",
                "before update on public.user_app_restoration_snapshots",
                "for each row",
            ],
        )
        reject_all(
            self,
            body,
            [
                "new.updated_at <=",
                "security definer",
                "alter table ",
                "create policy ",
                "grant ",
                "insert into ",
                "update public.",
                "delete from ",
                "truncate ",
                " cascade",
            ],
        )

        workflow = source(".github/workflows/supabase-functions.yml")
        require_all(
            self,
            workflow,
            [
                "supabase/dev/"
                "cut18_restoration_stale_write_smoke.sql",
                "supabase/dev/"
                "cut18_restoration_stale_write_concurrency_smoke.sh",
            ],
        )

        sequential = source(
            "supabase/dev/cut18_restoration_stale_write_smoke.sql"
        )
        require_all(
            self,
            sequential,
            [
                "stale write replaced window or latest state",
                "cross-device row independence changed",
                "equal/newer restoration upsert behavior changed",
                "ownership policy allowed another user write",
                "existing rows, RLS policies, or grants changed",
            ],
        )

        concurrent = source(
            "supabase/dev/"
            "cut18_restoration_stale_write_concurrency_smoke.sh"
        )
        require_all(
            self,
            concurrent,
            [
                "concurrent-newer",
                "concurrent-stale",
                "pg_advisory_xact_lock(218, 18)",
                "stale interleaved transaction replaced a newer row",
                "fixture cleanup changed the row baseline",
            ],
        )

        rollback = source(
            "supabase/dev/"
            "rollback_cut18_restoration_stale_write_guard.sql"
        )
        require_all(
            self,
            rollback,
            [
                "drop trigger if exists "
                "user_app_restoration_prevent_stale_update",
                "drop function if exists",
                "private.prevent_stale_restoration_snapshot_update()",
            ],
        )


class EdgeFunctionSourceContractsTest(unittest.TestCase):
    def test_decan_opening_generation_is_keyed_get_or_create_only(self) -> None:
        body = source(
            "supabase/functions/cron_maat_decan_opening/index.ts"
        )
        generation_body = body.split(
            "async function buildAndPersistOpeningDraft", 1
        )[1].split("async function ensureOpeningForUser", 1)[0]
        require_all(
            self,
            body,
            [
                '"decan-opening-generation-v1"',
                "Object.keys(value)",
                ".sort()",
                'kind: "decan_opening"',
                "user_id: params.userId",
                "period_key: params.periodKey",
                "empty_snapshot: params.emptySnapshot",
                "input_fingerprint: inputFingerprint",
                "async function openingGenerationIdentity",
                "async function prepareOpeningGeneration",
                "inputFingerprint",
                "generationKey",
                "opening_contract_version: identity.contractVersion",
                "opening_input_fingerprint: identity.inputFingerprint",
                '.eq("generation_key", generationKey)',
                "function existingOpeningCanBeUpdated",
                "function existingOpeningHasDayCard",
            ],
        )
        require_all(
            self,
            generation_body,
            [
                "generation_key: generationKey",
                'generationError.code === "23505"',
                "winnerGenerationId",
                'throw new Error("Generation persist error")',
            ],
        )
        self.assertNotIn(".update(", generation_body)

        refresh_body = body.split(
            "function existingOpeningNeedsRefresh", 1
        )[1].split("function jsonResponse", 1)[0]
        require_all(
            self,
            refresh_body,
            [
                "if (!existingOpeningCanBeUpdated(existing)) return false",
                "payload.opening_contract_version !== currentIdentity.contractVersion",
                "payload.opening_input_fingerprint !== currentIdentity.inputFingerprint",
            ],
        )
        for legacy_shape_predicate in (
            'ctaType !== "flow_template"',
            "!ctaRef.trim()",
            "!nodeRef.trim()",
            "destination?.ref",
            "deliveryTrack !== DECAN_CONTEXT_OPENING_TRACK",
            "contentSource !== DECAN_CONTEXT_OPENING_SOURCE",
            "payload.profile_personalization_used !== false",
            "!outputControl",
            'compiledPackage?.package_version !== "compiled_output_package_v1"',
            'teaser.includes("Today\'s card names")',
            'body.includes("Today\'s card names")',
        ):
            self.assertNotIn(legacy_shape_predicate, refresh_body)

    def test_cron_scheduled_no_token_lifecycle_uses_fixed_event_checkpoints(self) -> None:
        body = source("supabase/functions/cron_reminder_push/index.ts")
        require_all(
            self,
            body,
            [
                'const NO_TOKEN_ERROR = "no_tokens_for_recipients"',
                "15 * 60 * 1000",
                "60 * 60 * 1000",
                "6 * 60 * 60 * 1000",
                "12 * 60 * 60 * 1000",
                "23 * 60 * 60 * 1000",
                "scheduledAtMs + NO_TOKEN_EXPIRY_MS",
                "checkpointMs > nowMs && checkpointMs < expiresAtMs",
                "row.last_error === NO_TOKEN_ERROR",
                "no_token_attempt_count: transition.noTokenAttemptCount",
                "no_token_first_at: transition.noTokenFirstAt",
                "next_attempt_at: transition.nextAttemptAt",
                "expires_at: transition.expiresAt",
                "claimed_at: null",
                "claim_token: null",
                "resetRearmedNoTokenLifecycle(",
                "token_available_at: null",
                "markScheduledInactive(\n        sentScheduledIds,",
            ],
        )
        reject_all(
            self,
            body,
            [
                "NO_TOKEN_GRACE_MINUTES",
                "nowMs + NO_TOKEN_EXPIRY_MS",
            ],
        )

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
