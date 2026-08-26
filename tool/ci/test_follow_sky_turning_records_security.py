import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ORIGINAL_MIGRATION = (
    ROOT
    / "supabase/migrations/20260826204209_follow_sky_turning_records.sql"
)
LEAST_PRIVILEGE_MIGRATION = (
    ROOT
    / "supabase/migrations/20260826235549_follow_sky_turning_records_least_privilege.sql"
)
ORIGINAL_MIGRATION_SHA256 = (
    "7f6769e2bbb28e7855b9f3733399a853769466992d1c3cba0928115923eb6f1c"
)


def normalized_statements(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    source = re.sub(r"--[^\n]*", "", source)
    return [
        re.sub(r"\s+", " ", statement).strip().lower() + ";"
        for statement in source.split(";")
        if statement.strip()
    ]


class FollowSkyTurningRecordsSecurityTest(unittest.TestCase):
    def test_applied_original_migration_remains_immutable(self) -> None:
        digest = hashlib.sha256(ORIGINAL_MIGRATION.read_bytes()).hexdigest()
        self.assertEqual(digest, ORIGINAL_MIGRATION_SHA256)

    def test_corrective_migration_is_table_scoped_least_privilege_only(self) -> None:
        self.assertEqual(
            normalized_statements(LEAST_PRIVILEGE_MIGRATION),
            [
                (
                    "revoke all on table public.follow_sky_turning_records "
                    "from anon, authenticated;"
                ),
                (
                    "grant select, insert, update, delete on table "
                    "public.follow_sky_turning_records to authenticated;"
                ),
            ],
        )

    def test_original_owner_rls_contract_is_preserved(self) -> None:
        statements = normalized_statements(ORIGINAL_MIGRATION)
        source = "\n".join(statements)

        self.assertIn(
            "alter table public.follow_sky_turning_records enable row level security;",
            statements,
        )
        self.assertIn(
            'create policy "turning records are readable by their owner" '
            "on public.follow_sky_turning_records for select to authenticated "
            "using ((select auth.uid()) = user_id);",
            statements,
        )
        self.assertIn(
            'create policy "turning records are insertable by their owner" '
            "on public.follow_sky_turning_records for insert to authenticated "
            "with check ((select auth.uid()) = user_id);",
            statements,
        )
        self.assertIn(
            'create policy "turning records are editable by their owner" '
            "on public.follow_sky_turning_records for update to authenticated "
            "using ((select auth.uid()) = user_id) "
            "with check ((select auth.uid()) = user_id);",
            statements,
        )
        self.assertIn(
            'create policy "turning records are deletable by their owner" '
            "on public.follow_sky_turning_records for delete to authenticated "
            "using ((select auth.uid()) = user_id);",
            statements,
        )
        self.assertNotIn("alter default privileges", source)


if __name__ == "__main__":
    unittest.main()
