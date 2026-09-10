import inspect
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tool.ci.forward_candidate_gate import (
    ALLOWED_AUTHORITY_PARENT_PATHS,
    CUT_CLASS_FLOW_DETAIL_SURFACE_TEST_RENAME,
    CUT_CLASS_KAR_GUARD_REPAIR,
    CUT_CLASS_KAR_RELEASE,
    CUT_CLASS_MAAT_VISUAL_TEST_RENAME,
    CUT_CLASS_READING_HOUSE_RELEASE,
    FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB,
    FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH,
    FLOW_DETAIL_SURFACE_TEST_RENAME_BASE_MOBILE,
    FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT,
    FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE,
    FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT,
    FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE,
    KAR_GUARD_REPAIR_BASE_MOBILE,
    KAR_GUARD_REPAIR_DECLARED_BASE,
    KAR_GUARD_REPAIR_DIRECT_PARENT,
    KAR_GUARD_REPAIR_MOBILE,
    KAR_GUARD_REPAIR_PARENT_PATHS,
    KAR_RELEASE_BASE_MOBILE,
    KAR_RELEASE_DECLARED_BASE,
    KAR_RELEASE_MIGRATION_BLOB,
    KAR_RELEASE_MIGRATION_PATH,
    KAR_RELEASE_MOBILE,
    KAR_RELEASE_PRODUCT_PARENT,
    KAR_RELEASE_TEST_RENAME_AUDIT_BLOB,
    KAR_RELEASE_TEST_RENAME_AUDIT_PATH,
    KAR_RELEASE_TEST_RENAME_COUNT,
    MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB,
    MAAT_VISUAL_TEST_RENAME_AUDIT_PATH,
    MAAT_VISUAL_TEST_RENAME_BASE_MOBILE,
    MAAT_VISUAL_TEST_RENAME_COUNT,
    MAAT_VISUAL_TEST_RENAME_DECLARED_BASE,
    MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT,
    MAAT_VISUAL_TEST_RENAME_MOBILE,
    MissingTestAuditEntry,
    READING_HOUSE_RELEASE_AUTHORITY_PARENT,
    READING_HOUSE_RELEASE_DECLARED_BASE,
    READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB,
    READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH,
    READING_HOUSE_RELEASE_MISSING_TEST_COUNT,
    READING_HOUSE_RELEASE_MIGRATION_BLOB,
    READING_HOUSE_RELEASE_MIGRATION_PATH,
    READING_HOUSE_RELEASE_MOBILE,
    READING_HOUSE_RELEASE_PRODUCT_PARENT,
    REQUIRED_AGGREGATE_JOBS,
    REQUIRED_FORWARD_RUNTIME_COMMANDS,
    ZERO_SHA,
    ForwardCandidateError,
    ForwardTestResult,
    _classify_parent_delta,
    _validate_flow_detail_surface_test_rename_identity,
    _validate_kar_guard_repair_identity,
    _validate_kar_release_identity,
    _validate_maat_visual_test_rename_identity,
    _validate_reading_house_release_identity,
    compare_analyze,
    compare_test,
    compare_test_inventories,
    load_missing_test_audit,
    normalize_failure_signature,
    resolve_historical_parent,
    resolve_pinned_missing_test_audit,
    validate_forward_workflow,
    verify_forward,
)


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/mobile.yml"


class ForwardWorkflowContractTest(unittest.TestCase):
    def test_current_workflow_requires_historical_forward_and_pipeline(self) -> None:
        result = validate_forward_workflow(WORKFLOW)
        self.assertEqual(result["required_jobs"], list(REQUIRED_AGGREGATE_JOBS))
        self.assertEqual(result["forward_runtime_job"], "forward-candidate-runtime")
        source = WORKFLOW.read_text(encoding="utf-8")
        runtime = source.split("  forward-candidate-runtime:\n", 1)[1]
        runtime = runtime.split("\n  lock-gate-required:\n", 1)[0]
        for command in REQUIRED_FORWARD_RUNTIME_COMMANDS:
            self.assertIn(command, runtime)
        self.assertNotIn("july1_runtime_gate.py evaluate-full", runtime)
        self.assertNotIn("july1_runtime_gate.py verify-checkout", runtime)
        self.assertIn("      - production", source)
        self.assertNotIn("      - main", source)
        self.assertNotIn('      - "codex/**"', source)
        self.assertNotIn("origin/main", runtime)
        self.assertIn('refs/heads/production', runtime)
        self.assertIn('${{ github.event.before }}', runtime)
        self.assertIn(
            "tool/ci/release_pipeline_gate.py",
            ALLOWED_AUTHORITY_PARENT_PATHS,
        )
        self.assertIn(
            "tool/ci/test_release_pipeline_gate.py",
            ALLOWED_AUTHORITY_PARENT_PATHS,
        )
        compare_index = runtime.index(
            "python3 tool/ci/forward_candidate_gate.py compare-test"
        )
        archive_index = runtime.index(
            'tar -czf "$RESULTS_DIR/candidate-golden-failure-output.tar.gz"'
        )
        decision_index = runtime.index(
            'receipt.get("passed") is True and not receipt.get("regressions")'
        )
        remove_index = runtime.index('rm -rf -- "$golden_failures"')
        clean_index = runtime.index(
            "python3 tool/ci/forward_candidate_gate.py verify-worktree-clean"
        )
        self.assertIn(
            'test "$(git -C mobile status --short)" = '
            '"?? test/features/calendar/failures/"',
            runtime,
        )
        self.assertIn('test ! -L "$golden_failures"', runtime)
        self.assertLess(compare_index, archive_index)
        self.assertLess(compare_index, decision_index)
        self.assertLess(decision_index, archive_index)
        self.assertLess(archive_index, remove_index)
        self.assertLess(remove_index, clean_index)

    def test_missing_forward_runtime_need_fails(self) -> None:
        source = WORKFLOW.read_text(encoding="utf-8").replace(
            "      - forward-candidate-runtime\n",
            "      - forward-candidate-runtime-removed\n",
            1,
        )
        path = Path(
            tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", suffix=".yml", delete=False
            ).name
        )
        path.write_text(source, encoding="utf-8")
        self.addCleanup(path.unlink)
        with self.assertRaisesRegex(ForwardCandidateError, "does not need"):
            validate_forward_workflow(path)

    def test_forward_runtime_success_assertion_is_required(self) -> None:
        source = WORKFLOW.read_text(encoding="utf-8").replace(
            'test "${{ needs.forward-candidate-runtime.result }}" = "success"',
            'echo "${{ needs.forward-candidate-runtime.result }}"',
            1,
        )
        path = Path(
            tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", suffix=".yml", delete=False
            ).name
        )
        path.write_text(source, encoding="utf-8")
        self.addCleanup(path.unlink)
        with self.assertRaisesRegex(ForwardCandidateError, "fail closed"):
            validate_forward_workflow(path)


class ForwardCandidateGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.parent = self.root / "parent"
        self.mobile = self.parent / "mobile"
        self.parent.mkdir()
        self.mobile.mkdir()
        self._git(self.mobile, "init", "-q")
        self._git(self.parent, "init", "-q")
        for repo in (self.mobile, self.parent):
            self._git(repo, "config", "user.email", "fixture@example.invalid")
            self._git(repo, "config", "user.name", "Fixture")
            self._git(repo, "config", "advice.addEmbeddedRepo", "false")

        (self.mobile / "lib").mkdir()
        (self.mobile / "app.dart").write_text("historical\n", encoding="utf-8")
        self._git(self.mobile, "add", ".")
        self._git(self.mobile, "commit", "-qm", "merged recovery")
        self.mobile_head = self._git(self.mobile, "rev-parse", "HEAD")

        (self.mobile / "app.dart").write_text("later\n", encoding="utf-8")
        self._git(self.mobile, "add", ".")
        self._git(self.mobile, "commit", "-qm", "later mobile")
        self.mobile_base = self._git(self.mobile, "rev-parse", "HEAD")
        self._git(self.mobile, "checkout", "-q", self.mobile_head)

        (self.parent / ".github" / "workflows").mkdir(parents=True)
        (self.parent / ".github" / "workflows" / "mobile.yml").write_text(
            "name: fixture\n", encoding="utf-8"
        )
        (self.parent / "ci").mkdir()
        (self.parent / "ci" / "LOCK_GATE.md").write_text(
            "historical\n", encoding="utf-8"
        )
        (self.parent / "README.md").write_text("parent\n", encoding="utf-8")
        self._git(self.parent, "add", ".")
        self._git(
            self.parent,
            "update-index",
            "--add",
            "--cacheinfo",
            f"160000,{self.mobile_head},mobile",
        )
        self._git(self.parent, "commit", "-qm", "pair historical mobile")
        self.parent_head = self._git(self.parent, "rev-parse", "HEAD")
        self.profile = self.root / "profile.json"
        self.profile.write_text(
            json.dumps(
                {
                    "identity": {"mergedMobileCommit": self.mobile_head},
                }
            )
            + "\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _git(self, cwd: Path, *args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()

    def _gitlink(self, revision: str) -> str:
        line = self._git(self.parent, "ls-tree", revision, "mobile")
        return line.split()[2]

    def test_resolve_historical_parent_selects_newest_matching_gitlink(self) -> None:
        older = self.parent_head
        (self.parent / "later.txt").write_text("later\n", encoding="utf-8")
        self._git(self.parent, "add", "later.txt")
        self._git(
            self.parent,
            "update-index",
            "--cacheinfo",
            f"160000,{self.mobile_base},mobile",
        )
        self._git(self.parent, "commit", "-qm", "later gitlink")
        receipt = resolve_historical_parent(
            parent_root=self.parent, profile_path=self.profile
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(receipt["historicalParent"], older)
        self.assertEqual(receipt["historicalGitlink"], self.mobile_head)
        self.assertEqual(self._gitlink(older), self.mobile_head)

    def test_resolve_historical_parent_fails_when_matching_commits_diverge(self) -> None:
        default_branch = self._git(self.parent, "rev-parse", "--abbrev-ref", "HEAD")
        self._git(self.parent, "checkout", "-q", "-b", "side")
        (self.parent / "side.txt").write_text("side\n", encoding="utf-8")
        self._git(self.parent, "add", "side.txt")
        self._git(self.parent, "commit", "-qm", "side with same gitlink")
        side = self._git(self.parent, "rev-parse", "HEAD")
        self._git(self.parent, "checkout", "-q", default_branch)
        (self.parent / "mainline.txt").write_text("mainline\n", encoding="utf-8")
        self._git(self.parent, "add", "mainline.txt")
        self._git(self.parent, "commit", "-qm", "mainline with same gitlink")
        self._git(self.parent, "merge", "-q", "--no-ff", "--no-commit", side)
        self._git(
            self.parent,
            "update-index",
            "--cacheinfo",
            f"160000,{self.mobile_base},mobile",
        )
        self._git(self.parent, "commit", "-qm", "merge without historical gitlink")
        receipt = resolve_historical_parent(
            parent_root=self.parent, profile_path=self.profile
        )
        self.assertTrue(
            any("ambiguous" in error for error in receipt["errors"]),
            receipt["errors"],
        )
        self.assertIsNone(receipt["historicalParent"])

    def test_verify_forward_requires_unchanged_mobile_for_authority_rollover(self) -> None:
        declared = self.parent_head
        (self.parent / "ci" / "LOCK_GATE.md").write_text(
            "forward authority\n", encoding="utf-8"
        )
        self._git(self.parent, "add", "ci/LOCK_GATE.md")
        self._git(self.parent, "commit", "-qm", "authority rollover")
        receipt = verify_forward(
            parent_root=self.parent,
            mobile_root=self.mobile,
            declared_base=declared,
        )
        self.assertTrue(receipt["passed"], receipt["errors"])
        self.assertEqual(receipt["cutClass"], "parent-authority-rollover")
        self.assertEqual(receipt["baseMobileGitlink"], receipt["candidateGitlink"])
        self.assertEqual(receipt["mobileDelta"], [])
        self.assertEqual(
            {record["path"] for record in receipt["parentDelta"]},
            {"ci/LOCK_GATE.md"},
        )
        self.assertTrue(
            {record["path"] for record in receipt["parentDelta"]}.issubset(
                ALLOWED_AUTHORITY_PARENT_PATHS
            )
        )

    def test_verify_forward_rejects_authority_rollover_that_moves_mobile(self) -> None:
        declared = self.parent_head
        (self.parent / "ci" / "LOCK_GATE.md").write_text(
            "forward authority\n", encoding="utf-8"
        )
        self._git(self.parent, "add", "ci/LOCK_GATE.md")
        self._git(
            self.parent,
            "update-index",
            "--cacheinfo",
            f"160000,{self.mobile_base},mobile",
        )
        self._git(self.parent, "commit", "-qm", "authority plus gitlink")
        receipt = verify_forward(
            parent_root=self.parent,
            mobile_root=self.mobile,
            declared_base=declared,
        )
        self.assertFalse(receipt["passed"])
        self.assertTrue(
            any("extra=" in error or "gitlink" in error for error in receipt["errors"]),
            receipt["errors"],
        )

    def test_exact_reading_house_release_mixed_cut_is_classified(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {
                "mobile",
                READING_HOUSE_RELEASE_MIGRATION_PATH,
                ".github/workflows/mobile.yml",
                "ci/LOCK_GATE.md",
                READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix(),
                "tool/ci/forward_candidate_gate.py",
                "tool/ci/test_forward_candidate_gate.py",
            },
            declared_base=READING_HOUSE_RELEASE_DECLARED_BASE,
            candidate_gitlink=READING_HOUSE_RELEASE_MOBILE,
        )
        self.assertEqual(errors, [])
        self.assertEqual(cut_class, CUT_CLASS_READING_HOUSE_RELEASE)

    def test_reading_house_release_mixed_cut_rejects_any_other_base(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {"mobile", READING_HOUSE_RELEASE_MIGRATION_PATH},
            declared_base=self.parent_head,
            candidate_gitlink=READING_HOUSE_RELEASE_MOBILE,
        )
        self.assertIsNone(cut_class)
        self.assertTrue(any("declared_base" in error for error in errors), errors)

    def test_reading_house_release_mixed_cut_rejects_any_other_mobile(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {"mobile", READING_HOUSE_RELEASE_MIGRATION_PATH},
            declared_base=READING_HOUSE_RELEASE_DECLARED_BASE,
            candidate_gitlink=self.mobile_head,
        )
        self.assertIsNone(cut_class)
        self.assertTrue(any("candidate mobile" in error for error in errors), errors)

    def test_reading_house_release_mixed_cut_rejects_any_other_parent_path(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {"mobile", READING_HOUSE_RELEASE_MIGRATION_PATH, "README.md"},
            declared_base=READING_HOUSE_RELEASE_DECLARED_BASE,
            candidate_gitlink=READING_HOUSE_RELEASE_MOBILE,
        )
        self.assertIsNone(cut_class)
        self.assertTrue(any("README.md" in error for error in errors), errors)

    def test_reading_house_release_rejects_changed_migration_blob(self) -> None:
        errors = _validate_reading_house_release_identity(
            parent_line=["candidate", READING_HOUSE_RELEASE_AUTHORITY_PARENT],
            migration_records=[
                {"status": "A", "path": READING_HOUSE_RELEASE_MIGRATION_PATH}
            ],
            migration_blob="0" * 40,
            audit_records=[
                {
                    "status": "A",
                    "path": READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix(),
                }
            ],
            audit_blob=READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB,
        )
        self.assertEqual(len(errors), 1)
        self.assertIn("migration blob", errors[0])

    def test_reading_house_release_rejects_non_direct_product_parent(self) -> None:
        errors = _validate_reading_house_release_identity(
            parent_line=["candidate", self.parent_head],
            migration_records=[
                {"status": "A", "path": READING_HOUSE_RELEASE_MIGRATION_PATH}
            ],
            migration_blob=READING_HOUSE_RELEASE_MIGRATION_BLOB,
            audit_records=[
                {
                    "status": "A",
                    "path": READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix(),
                }
            ],
            audit_blob=READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB,
        )
        self.assertEqual(len(errors), 1)
        self.assertIn("one commit directly", errors[0])

    def test_exact_maat_visual_test_rename_cut_is_classified(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {
                "mobile",
                ".github/workflows/mobile.yml",
                "ci/LOCK_GATE.md",
                MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix(),
                "tool/ci/forward_candidate_gate.py",
                "tool/ci/test_forward_candidate_gate.py",
            },
            declared_base=MAAT_VISUAL_TEST_RENAME_DECLARED_BASE,
            candidate_gitlink=MAAT_VISUAL_TEST_RENAME_MOBILE,
        )
        self.assertEqual(errors, [])
        self.assertEqual(cut_class, CUT_CLASS_MAAT_VISUAL_TEST_RENAME)

    def test_maat_visual_test_rename_cut_rejects_wrong_base(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {"mobile", MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix()},
            declared_base=self.parent_head,
            candidate_gitlink=MAAT_VISUAL_TEST_RENAME_MOBILE,
        )
        self.assertIsNone(cut_class)
        self.assertTrue(any("declared_base" in error for error in errors), errors)

    def test_maat_visual_test_rename_cut_rejects_wrong_mobile(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {"mobile", MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix()},
            declared_base=MAAT_VISUAL_TEST_RENAME_DECLARED_BASE,
            candidate_gitlink=self.mobile_head,
        )
        self.assertIsNone(cut_class)
        self.assertTrue(any("candidate mobile" in error for error in errors), errors)

    def test_maat_visual_test_rename_cut_rejects_extra_path(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {
                "mobile",
                MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix(),
                "README.md",
            },
            declared_base=MAAT_VISUAL_TEST_RENAME_DECLARED_BASE,
            candidate_gitlink=MAAT_VISUAL_TEST_RENAME_MOBILE,
        )
        self.assertIsNone(cut_class)
        self.assertTrue(any("README.md" in error for error in errors), errors)

    def test_maat_visual_test_rename_identity_is_fully_pinned(self) -> None:
        records = [
            {
                "status": "A",
                "path": MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix(),
            }
        ]
        self.assertEqual(
            _validate_maat_visual_test_rename_identity(
                parent_line=["candidate", MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT],
                base_gitlink=MAAT_VISUAL_TEST_RENAME_BASE_MOBILE,
                candidate_gitlink=MAAT_VISUAL_TEST_RENAME_MOBILE,
                audit_records=records,
                audit_blob=MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB,
            ),
            [],
        )
        errors = _validate_maat_visual_test_rename_identity(
            parent_line=["candidate", self.parent_head],
            base_gitlink=self.mobile_head,
            candidate_gitlink=self.mobile_head,
            audit_records=[],
            audit_blob="0" * 40,
        )
        self.assertEqual(len(errors), 5)

    def test_exact_flow_detail_surface_test_rename_cut_is_classified(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {
                "mobile",
                ".github/workflows/mobile.yml",
                "ci/LOCK_GATE.md",
                FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
                "tool/ci/forward_candidate_gate.py",
                "tool/ci/test_forward_candidate_gate.py",
            },
            declared_base=FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE,
            candidate_gitlink=FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE,
        )
        self.assertEqual(errors, [])
        self.assertEqual(
            cut_class,
            CUT_CLASS_FLOW_DETAIL_SURFACE_TEST_RENAME,
        )

    def test_flow_detail_surface_test_rename_cut_fails_closed(self) -> None:
        paths = {
            "mobile",
            FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
        }
        wrong_base, base_errors = _classify_parent_delta(
            paths,
            declared_base=self.parent_head,
            candidate_gitlink=FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE,
        )
        wrong_mobile, mobile_errors = _classify_parent_delta(
            paths,
            declared_base=FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE,
            candidate_gitlink=self.mobile_head,
        )
        extra_path, path_errors = _classify_parent_delta(
            paths | {"README.md"},
            declared_base=FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE,
            candidate_gitlink=FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE,
        )
        self.assertIsNone(wrong_base)
        self.assertTrue(any("declared_base" in error for error in base_errors))
        self.assertIsNone(wrong_mobile)
        self.assertTrue(
            any("candidate mobile" in error for error in mobile_errors)
        )
        self.assertIsNone(extra_path)
        self.assertTrue(any("README.md" in error for error in path_errors))

    def test_flow_detail_surface_test_rename_identity_is_fully_pinned(self) -> None:
        records = [
            {
                "status": "A",
                "path": FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
            }
        ]
        self.assertEqual(
            _validate_flow_detail_surface_test_rename_identity(
                parent_line=[
                    "candidate",
                    FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT,
                ],
                base_gitlink=FLOW_DETAIL_SURFACE_TEST_RENAME_BASE_MOBILE,
                candidate_gitlink=FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE,
                audit_records=records,
                audit_blob=FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB,
            ),
            [],
        )
        errors = _validate_flow_detail_surface_test_rename_identity(
            parent_line=["candidate", self.parent_head],
            base_gitlink=self.mobile_head,
            candidate_gitlink=self.mobile_head,
            audit_records=[],
            audit_blob="0" * 40,
        )
        self.assertEqual(len(errors), 5)

    def test_exact_kar_release_cut_is_classified(self) -> None:
        cut_class, errors = _classify_parent_delta(
            {
                "mobile",
                KAR_RELEASE_MIGRATION_PATH,
                KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix(),
                "ci/LOCK_GATE.md",
                "tool/ci/forward_candidate_gate.py",
                "tool/ci/test_forward_candidate_gate.py",
            },
            declared_base=KAR_RELEASE_DECLARED_BASE,
            candidate_gitlink=KAR_RELEASE_MOBILE,
        )
        self.assertEqual(errors, [])
        self.assertEqual(cut_class, CUT_CLASS_KAR_RELEASE)

    def test_kar_release_cut_fails_closed(self) -> None:
        paths = {
            "mobile",
            KAR_RELEASE_MIGRATION_PATH,
            KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix(),
        }
        wrong_base, base_errors = _classify_parent_delta(
            paths,
            declared_base=self.parent_head,
            candidate_gitlink=KAR_RELEASE_MOBILE,
        )
        wrong_mobile, mobile_errors = _classify_parent_delta(
            paths,
            declared_base=KAR_RELEASE_DECLARED_BASE,
            candidate_gitlink=self.mobile_head,
        )
        extra_path, path_errors = _classify_parent_delta(
            paths | {"README.md"},
            declared_base=KAR_RELEASE_DECLARED_BASE,
            candidate_gitlink=KAR_RELEASE_MOBILE,
        )
        self.assertIsNone(wrong_base)
        self.assertTrue(any("declared_base" in error for error in base_errors))
        self.assertIsNone(wrong_mobile)
        self.assertTrue(
            any("candidate mobile" in error for error in mobile_errors)
        )
        self.assertIsNone(extra_path)
        self.assertTrue(any("README.md" in error for error in path_errors))

    def test_kar_release_identity_is_fully_pinned(self) -> None:
        migration_records = [
            {"status": "A", "path": KAR_RELEASE_MIGRATION_PATH}
        ]
        audit_records = [
            {
                "status": "A",
                "path": KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix(),
            }
        ]
        self.assertEqual(
            _validate_kar_release_identity(
                parent_line=["candidate", KAR_RELEASE_PRODUCT_PARENT],
                base_gitlink=KAR_RELEASE_BASE_MOBILE,
                candidate_gitlink=KAR_RELEASE_MOBILE,
                migration_records=migration_records,
                migration_blob=KAR_RELEASE_MIGRATION_BLOB,
                audit_records=audit_records,
                audit_blob=KAR_RELEASE_TEST_RENAME_AUDIT_BLOB,
            ),
            [],
        )
        errors = _validate_kar_release_identity(
            parent_line=["candidate", self.parent_head],
            base_gitlink=self.mobile_head,
            candidate_gitlink=self.mobile_head,
            migration_records=[],
            migration_blob="0" * 40,
            audit_records=[],
            audit_blob="0" * 40,
        )
        self.assertEqual(len(errors), 7)

    def test_exact_kar_guard_repair_cut_is_classified(self) -> None:
        cut_class, errors = _classify_parent_delta(
            KAR_GUARD_REPAIR_PARENT_PATHS,
            declared_base=KAR_GUARD_REPAIR_DECLARED_BASE,
            candidate_gitlink=KAR_GUARD_REPAIR_MOBILE,
        )
        self.assertEqual(errors, [])
        self.assertEqual(cut_class, CUT_CLASS_KAR_GUARD_REPAIR)

    def test_kar_guard_repair_identity_is_fully_pinned(self) -> None:
        self.assertEqual(
            _validate_kar_guard_repair_identity(
                parent_line=["candidate", KAR_GUARD_REPAIR_DIRECT_PARENT],
                base_gitlink=KAR_GUARD_REPAIR_BASE_MOBILE,
                candidate_gitlink=KAR_GUARD_REPAIR_MOBILE,
            ),
            [],
        )
        errors = _validate_kar_guard_repair_identity(
            parent_line=["candidate", self.parent_head],
            base_gitlink=self.mobile_head,
            candidate_gitlink=self.mobile_head,
        )
        self.assertEqual(len(errors), 3)

    def test_verify_forward_gitlink_only_may_change_mobile(self) -> None:
        declared = self.parent_head
        self._git(
            self.parent,
            "update-index",
            "--cacheinfo",
            f"160000,{self.mobile_base},mobile",
        )
        self._git(self.parent, "commit", "-qm", "gitlink only")
        self._git(self.mobile, "checkout", "-q", self.mobile_base)
        receipt = verify_forward(
            parent_root=self.parent,
            mobile_root=self.mobile,
            declared_base=declared,
        )
        self.assertTrue(receipt["passed"], receipt["errors"])
        self.assertEqual(receipt["cutClass"], "parent-gitlink-only")
        self.assertNotEqual(receipt["baseMobileGitlink"], receipt["candidateGitlink"])
        self.assertGreater(len(receipt["mobileDelta"] or []), 0)

    def test_verify_forward_rejects_unrelated_parent_path(self) -> None:
        declared = self.parent_head
        sneak = self.parent / "docs" / "sneak.md"
        sneak.parent.mkdir(parents=True, exist_ok=True)
        sneak.write_text("no\n", encoding="utf-8")
        self._git(self.parent, "add", "docs/sneak.md")
        self._git(self.parent, "commit", "-qm", "unrelated")
        receipt = verify_forward(
            parent_root=self.parent,
            mobile_root=self.mobile,
            declared_base=declared,
        )
        self.assertFalse(receipt["passed"])
        self.assertTrue(
            any("docs/sneak.md" in error for error in receipt["errors"]),
            receipt["errors"],
        )

    def test_verify_forward_rejects_zero_declared_base(self) -> None:
        receipt = verify_forward(
            parent_root=self.parent,
            mobile_root=self.mobile,
            declared_base=ZERO_SHA,
        )
        self.assertFalse(receipt["passed"])
        self.assertTrue(
            any("nonzero" in error for error in receipt["errors"]),
            receipt["errors"],
        )


class ForwardAnalyzeComparisonTest(unittest.TestCase):
    BASELINE = (
        "   warning • A value for optional parameter 'framedSurface' isn't ever given "
        "• lib/features/calendar/calendar_grid_widgets.dart:757:10 "
        "• unused_element_parameter\n"
    )

    def test_baseline_diagnostic_may_survive(self) -> None:
        receipt = compare_analyze(base_log=self.BASELINE, candidate_log=self.BASELINE)
        self.assertTrue(receipt["passed"], receipt["errors"])
        self.assertEqual(receipt["newDiagnostics"], [])
        self.assertEqual(receipt["droppedDiagnostics"], [])

    def test_new_diagnostic_fails(self) -> None:
        candidate = self.BASELINE + (
            "   warning • Unused import: 'dart:math' "
            "• lib/features/calendar/calendar_grid_widgets.dart:1:8 "
            "• unused_import\n"
        )
        receipt = compare_analyze(base_log=self.BASELINE, candidate_log=candidate)
        self.assertFalse(receipt["passed"])
        self.assertEqual(receipt["newDiagnostics"][0]["code"], "unused_import")
        self.assertEqual(receipt["droppedDiagnostics"], [])

    def test_removed_diagnostic_passes(self) -> None:
        receipt = compare_analyze(base_log=self.BASELINE, candidate_log="")
        self.assertTrue(receipt["passed"], receipt["errors"])
        self.assertEqual(receipt["newDiagnostics"], [])
        self.assertEqual(
            receipt["droppedDiagnostics"][0]["code"], "unused_element_parameter"
        )

    def test_location_only_movement_does_not_create_false_debt(self) -> None:
        moved = (
            "   warning • A value for optional parameter 'framedSurface' isn't ever given "
            "• lib/features/calendar/calendar_grid_widgets.dart:900:4 "
            "• unused_element_parameter\n"
        )
        receipt = compare_analyze(base_log=self.BASELINE, candidate_log=moved)
        self.assertTrue(receipt["passed"], receipt["errors"])
        self.assertEqual(receipt["newDiagnostics"], [])
        self.assertEqual(receipt["droppedDiagnostics"], [])

    def test_machine_json_matches_human_fingerprint(self) -> None:
        machine = json.dumps(
            {
                "version": 1,
                "diagnostics": [
                    {
                        "code": "unused_element_parameter",
                        "severity": "WARNING",
                        "problemMessage": (
                            "A value for optional parameter 'framedSurface' "
                            "isn't ever given"
                        ),
                        "location": {
                            "file": "/tmp/base/lib/features/calendar/calendar_grid_widgets.dart",
                            "range": {"start": {"line": 12, "column": 2}},
                        },
                    }
                ],
            }
        )
        receipt = compare_analyze(
            base_log=machine,
            candidate_log=self.BASELINE,
            base_mobile_root=Path("/tmp/base"),
        )
        self.assertTrue(receipt["passed"], receipt["errors"])
        self.assertEqual(receipt["newDiagnostics"], [])


def _fwd(
    identity: str,
    status: str,
    *,
    category: str = "",
    signature: str = "",
    skip_reason: str = "",
) -> ForwardTestResult:
    if status == "PASS":
        category = category or "pass"
    elif status == "SKIP":
        category = category or "skip"
    elif status == "FAIL":
        category = category or "assertion-mismatch"
    elif status == "ERROR":
        category = category or "uncaught-runtime-error"
    elif status == "TIMEOUT":
        category = category or "timeout"
    return ForwardTestResult(
        identity=identity,
        status=status,
        category=category,
        signature=signature,
        skip_reason=skip_reason,
    )


class ForwardTestComparisonTest(unittest.TestCase):
    FOO = "test/foo_test.dart :: Foo :: bar"

    def test_pass_to_fail_is_rejected(self) -> None:
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "PASS")},
            {self.FOO: _fwd(self.FOO, "FAIL", signature="Expected false Actual true")},
        )
        self.assertTrue(receipt["errors"])
        self.assertEqual(receipt["regressions"][0]["id"], self.FOO)

    def test_same_failure_is_allowed(self) -> None:
        failed = _fwd(self.FOO, "FAIL", signature="Expected false Actual true")
        receipt = compare_test_inventories({self.FOO: failed}, {self.FOO: failed})
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(receipt["persistingBaselineFailures"][0]["id"], self.FOO)
        self.assertEqual(
            receipt["persistingBaselineFailures"][0]["signature"],
            "Expected false Actual true",
        )

    def test_different_failure_is_rejected(self) -> None:
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "FAIL", signature="Expected false Actual true")},
            {
                self.FOO: _fwd(
                    self.FOO,
                    "ERROR",
                    category="uncaught-runtime-error",
                    signature="Null check operator used on a null value",
                )
            },
        )
        self.assertTrue(receipt["errors"])
        self.assertEqual(receipt["persistingBaselineFailures"], [])

    def test_same_status_different_signature_is_rejected(self) -> None:
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "FAIL", signature="Expected false Actual true")},
            {self.FOO: _fwd(self.FOO, "FAIL", signature="Expected 1 Actual 2")},
        )
        self.assertTrue(receipt["errors"])
        self.assertEqual(receipt["persistingBaselineFailures"], [])

    def test_fail_to_pass_is_allowed_improvement(self) -> None:
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "FAIL", signature="Expected false Actual true")},
            {self.FOO: _fwd(self.FOO, "PASS")},
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(receipt["improvements"], [self.FOO])
        self.assertEqual(receipt["persistingBaselineFailures"], [])

    def test_skip_reason_change_is_rejected(self) -> None:
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "SKIP", skip_reason="not ready")},
            {self.FOO: _fwd(self.FOO, "SKIP", skip_reason="different reason")},
        )
        self.assertTrue(receipt["errors"])
        self.assertIn("SKIP reason changed", receipt["errors"][0])

    def test_missing_candidate_test_is_rejected(self) -> None:
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "PASS")},
            {},
        )
        self.assertTrue(receipt["errors"])
        self.assertIn("missing from candidate", receipt["errors"][0])

    def test_versioned_missing_test_audit_is_exact_and_wildcard_free(self) -> None:
        path = ROOT / READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH
        audit = load_missing_test_audit(path)
        self.assertEqual(len(audit), READING_HOUSE_RELEASE_MISSING_TEST_COUNT)
        retired = [entry for entry in audit.values() if entry.disposition == "retired"]
        replaced = [
            entry for entry in audit.values() if entry.disposition == "replaced"
        ]
        self.assertEqual(len(retired), 144)
        self.assertEqual(len(replaced), 58)
        self.assertTrue(all(entry.replacement_identity for entry in replaced))
        observed_blob = subprocess.run(
            ["git", "hash-object", path.as_posix()],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(
            observed_blob,
            READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB,
        )
        self.assertTrue(
            READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix()
            in ALLOWED_AUTHORITY_PARENT_PATHS
        )

    def test_maat_visual_rename_audit_is_exact_and_requires_replacements(self) -> None:
        path = ROOT / MAAT_VISUAL_TEST_RENAME_AUDIT_PATH
        authority = {
            "declaredBase": MAAT_VISUAL_TEST_RENAME_DECLARED_BASE,
            "candidateMobile": MAAT_VISUAL_TEST_RENAME_MOBILE,
            "candidateDirectParent": MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT,
            "expectedMissingCount": MAAT_VISUAL_TEST_RENAME_COUNT,
        }
        audit = load_missing_test_audit(
            path,
            expected_authority=authority,
            expected_count=MAAT_VISUAL_TEST_RENAME_COUNT,
            authority_label="Ma’at visual test rename reconciliation",
        )
        self.assertEqual(len(audit), MAAT_VISUAL_TEST_RENAME_COUNT)
        self.assertTrue(
            all(
                entry.disposition == "replaced" and entry.replacement_identity
                for entry in audit.values()
            )
        )
        observed_blob = subprocess.run(
            ["git", "hash-object", path.as_posix()],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(observed_blob, MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB)
        self.assertIn(
            MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix(),
            ALLOWED_AUTHORITY_PARENT_PATHS,
        )

        base = {identity: _fwd(identity, "PASS") for identity in audit}
        candidate = {
            entry.replacement_identity: _fwd(entry.replacement_identity, "PASS")
            for entry in audit.values()
            if entry.replacement_identity is not None
        }
        receipt = compare_test_inventories(
            base,
            candidate,
            missing_test_audit=audit,
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(
            len(receipt["auditedMissingTests"]),
            MAAT_VISUAL_TEST_RENAME_COUNT,
        )

    def test_maat_visual_rename_audit_resolves_only_for_exact_pin(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_parent = root / "base"
            candidate_parent = root / "candidate"
            candidate_mobile = candidate_parent / "mobile"
            candidate_mobile.mkdir(parents=True)
            destination = candidate_parent / MAAT_VISUAL_TEST_RENAME_AUDIT_PATH
            destination.parent.mkdir(parents=True)
            destination.write_text(
                (ROOT / MAAT_VISUAL_TEST_RENAME_AUDIT_PATH).read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            candidate_sha = "1" * 40

            def git_text(cwd: Path, *args: str) -> str:
                if cwd == base_parent and args == ("rev-parse", "HEAD"):
                    return MAAT_VISUAL_TEST_RENAME_DECLARED_BASE
                if cwd == candidate_parent and args == ("rev-parse", "HEAD"):
                    return candidate_sha
                if cwd == candidate_mobile and args == ("rev-parse", "HEAD"):
                    return MAAT_VISUAL_TEST_RENAME_MOBILE
                if cwd == candidate_parent and args[:4] == (
                    "rev-list",
                    "--parents",
                    "-n",
                    "1",
                ):
                    return f"{candidate_sha} {MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT}"
                if cwd == candidate_parent and args[0] == "rev-parse":
                    return MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB
                raise AssertionError((cwd, args))

            def mobile_gitlink(cwd: Path, revision: str) -> str:
                if cwd == base_parent:
                    return MAAT_VISUAL_TEST_RENAME_BASE_MOBILE
                if cwd == candidate_parent:
                    return MAAT_VISUAL_TEST_RENAME_MOBILE
                raise AssertionError((cwd, revision))

            with mock.patch(
                "tool.ci.forward_candidate_gate._git_text", side_effect=git_text
            ), mock.patch(
                "tool.ci.forward_candidate_gate._mobile_gitlink",
                side_effect=mobile_gitlink,
            ):
                audit, metadata, errors = resolve_pinned_missing_test_audit(
                    base_parent_root=base_parent,
                    candidate_parent_root=candidate_parent,
                    candidate_mobile_root=candidate_mobile,
                )

        self.assertEqual(errors, [])
        self.assertIsNotNone(audit)
        self.assertEqual(len(audit or {}), MAAT_VISUAL_TEST_RENAME_COUNT)
        self.assertTrue(metadata["applied"])
        self.assertEqual(
            metadata["path"], MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix()
        )

    def test_flow_detail_surface_rename_audit_is_exact(self) -> None:
        path = ROOT / FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH
        authority = {
            "declaredBase": FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE,
            "candidateMobile": FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE,
            "candidateDirectParent": FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT,
            "expectedMissingCount": FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT,
        }
        audit = load_missing_test_audit(
            path,
            expected_authority=authority,
            expected_count=FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT,
            authority_label="Flow-detail surface test rename reconciliation",
        )
        self.assertEqual(len(audit), FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT)
        self.assertTrue(
            all(
                entry.disposition == "replaced" and entry.replacement_identity
                for entry in audit.values()
            )
        )
        observed_blob = subprocess.run(
            ["git", "hash-object", path.as_posix()],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(
            observed_blob,
            FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB,
        )
        self.assertIn(
            FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
            ALLOWED_AUTHORITY_PARENT_PATHS,
        )

        base = {identity: _fwd(identity, "PASS") for identity in audit}
        candidate = {
            entry.replacement_identity: _fwd(entry.replacement_identity, "PASS")
            for entry in audit.values()
            if entry.replacement_identity is not None
        }
        receipt = compare_test_inventories(
            base,
            candidate,
            missing_test_audit=audit,
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(
            len(receipt["auditedMissingTests"]),
            FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT,
        )

    def test_flow_detail_surface_rename_audit_resolves_only_for_pin(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_parent = root / "base"
            candidate_parent = root / "candidate"
            candidate_mobile = candidate_parent / "mobile"
            candidate_mobile.mkdir(parents=True)
            destination = candidate_parent / FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH
            destination.parent.mkdir(parents=True)
            destination.write_text(
                (ROOT / FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH).read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            candidate_sha = "2" * 40

            def git_text(cwd: Path, *args: str) -> str:
                if cwd == base_parent and args == ("rev-parse", "HEAD"):
                    return FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE
                if cwd == candidate_parent and args == ("rev-parse", "HEAD"):
                    return candidate_sha
                if cwd == candidate_mobile and args == ("rev-parse", "HEAD"):
                    return FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE
                if cwd == candidate_parent and args[:4] == (
                    "rev-list",
                    "--parents",
                    "-n",
                    "1",
                ):
                    return (
                        f"{candidate_sha} "
                        f"{FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT}"
                    )
                if cwd == candidate_parent and args[0] == "rev-parse":
                    return FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB
                raise AssertionError((cwd, args))

            def mobile_gitlink(cwd: Path, revision: str) -> str:
                if cwd == base_parent:
                    return FLOW_DETAIL_SURFACE_TEST_RENAME_BASE_MOBILE
                if cwd == candidate_parent:
                    return FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE
                raise AssertionError((cwd, revision))

            with mock.patch(
                "tool.ci.forward_candidate_gate._git_text", side_effect=git_text
            ), mock.patch(
                "tool.ci.forward_candidate_gate._mobile_gitlink",
                side_effect=mobile_gitlink,
            ):
                audit, metadata, errors = resolve_pinned_missing_test_audit(
                    base_parent_root=base_parent,
                    candidate_parent_root=candidate_parent,
                    candidate_mobile_root=candidate_mobile,
                )

        self.assertEqual(errors, [])
        self.assertIsNotNone(audit)
        self.assertEqual(
            len(audit or {}),
            FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT,
        )
        self.assertTrue(metadata["applied"])
        self.assertEqual(
            metadata["path"],
            FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
        )

    def test_kar_release_rename_audit_is_exact_and_requires_replacements(self) -> None:
        path = ROOT / KAR_RELEASE_TEST_RENAME_AUDIT_PATH
        authority = {
            "declaredBase": KAR_RELEASE_DECLARED_BASE,
            "candidateMobile": KAR_RELEASE_MOBILE,
            "candidateDirectParent": KAR_RELEASE_PRODUCT_PARENT,
            "expectedMissingCount": KAR_RELEASE_TEST_RENAME_COUNT,
        }
        audit = load_missing_test_audit(
            path,
            expected_authority=authority,
            expected_count=KAR_RELEASE_TEST_RENAME_COUNT,
            authority_label="Kꜣr five-flow release reconciliation",
        )
        self.assertEqual(len(audit), KAR_RELEASE_TEST_RENAME_COUNT)
        self.assertTrue(
            all(
                entry.disposition == "replaced" and entry.replacement_identity
                for entry in audit.values()
            )
        )
        observed_blob = subprocess.run(
            ["git", "hash-object", path.as_posix()],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(observed_blob, KAR_RELEASE_TEST_RENAME_AUDIT_BLOB)
        self.assertIn(
            KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix(),
            ALLOWED_AUTHORITY_PARENT_PATHS,
        )

        base = {identity: _fwd(identity, "PASS") for identity in audit}
        candidate = {
            entry.replacement_identity: _fwd(entry.replacement_identity, "PASS")
            for entry in audit.values()
            if entry.replacement_identity is not None
        }
        receipt = compare_test_inventories(
            base,
            candidate,
            missing_test_audit=audit,
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(
            len(receipt["auditedMissingTests"]),
            KAR_RELEASE_TEST_RENAME_COUNT,
        )

        replacement = next(iter(candidate))
        candidate[replacement] = _fwd(replacement, "SKIP", skip_reason="missing")
        rejected = compare_test_inventories(
            base,
            candidate,
            missing_test_audit=audit,
        )
        self.assertTrue(rejected["errors"])
        self.assertIn("not a passing candidate test", " ".join(rejected["errors"]))

    def test_kar_release_rename_audit_resolves_only_for_exact_pin(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_parent = root / "base"
            candidate_parent = root / "candidate"
            candidate_mobile = candidate_parent / "mobile"
            candidate_mobile.mkdir(parents=True)
            destination = candidate_parent / KAR_RELEASE_TEST_RENAME_AUDIT_PATH
            destination.parent.mkdir(parents=True)
            destination.write_text(
                (ROOT / KAR_RELEASE_TEST_RENAME_AUDIT_PATH).read_text(
                    encoding="utf-8"
                ),
                encoding="utf-8",
            )
            candidate_sha = "3" * 40

            def git_text(cwd: Path, *args: str) -> str:
                if cwd == base_parent and args == ("rev-parse", "HEAD"):
                    return KAR_RELEASE_DECLARED_BASE
                if cwd == candidate_parent and args == ("rev-parse", "HEAD"):
                    return candidate_sha
                if cwd == candidate_mobile and args == ("rev-parse", "HEAD"):
                    return KAR_RELEASE_MOBILE
                if cwd == candidate_parent and args[:4] == (
                    "rev-list",
                    "--parents",
                    "-n",
                    "1",
                ):
                    return f"{candidate_sha} {KAR_RELEASE_PRODUCT_PARENT}"
                if cwd == candidate_parent and args[0] == "rev-parse":
                    return KAR_RELEASE_TEST_RENAME_AUDIT_BLOB
                raise AssertionError((cwd, args))

            def mobile_gitlink(cwd: Path, revision: str) -> str:
                if cwd == base_parent:
                    return KAR_RELEASE_BASE_MOBILE
                if cwd == candidate_parent:
                    return KAR_RELEASE_MOBILE
                raise AssertionError((cwd, revision))

            with mock.patch(
                "tool.ci.forward_candidate_gate._git_text", side_effect=git_text
            ), mock.patch(
                "tool.ci.forward_candidate_gate._mobile_gitlink",
                side_effect=mobile_gitlink,
            ):
                audit, metadata, errors = resolve_pinned_missing_test_audit(
                    base_parent_root=base_parent,
                    candidate_parent_root=candidate_parent,
                    candidate_mobile_root=candidate_mobile,
                )

        self.assertEqual(errors, [])
        self.assertIsNotNone(audit)
        self.assertEqual(len(audit or {}), KAR_RELEASE_TEST_RENAME_COUNT)
        self.assertTrue(metadata["applied"])
        self.assertEqual(
            metadata["path"], KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix()
        )

    def test_missing_test_audit_rejects_wildcards(self) -> None:
        source = (
            ROOT / READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH
        ).read_text(encoding="utf-8")
        source = source.replace("test/core/", "test/*/", 1)
        path = Path(
            tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", suffix=".json", delete=False
            ).name
        )
        path.write_text(source, encoding="utf-8")
        self.addCleanup(path.unlink)
        with self.assertRaisesRegex(ForwardCandidateError, "wildcards"):
            load_missing_test_audit(path)

    def test_exact_audited_replacement_may_cover_one_missing_identity(self) -> None:
        replacement = "test/foo_test.dart :: Foo :: replacement"
        audit = {
            self.FOO: MissingTestAuditEntry(
                identity=self.FOO,
                disposition="replaced",
                replacement_identity=replacement,
            )
        }
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "PASS")},
            {replacement: _fwd(replacement, "PASS")},
            missing_test_audit=audit,
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(receipt["auditedMissingTests"][0]["id"], self.FOO)
        self.assertEqual(
            receipt["auditedMissingTests"][0]["replacementIdentity"],
            replacement,
        )

    def test_audit_does_not_allow_an_unlisted_missing_identity(self) -> None:
        second = "test/foo_test.dart :: Foo :: second"
        audit = {
            self.FOO: MissingTestAuditEntry(
                identity=self.FOO,
                disposition="retired",
                replacement_identity=None,
            )
        }
        receipt = compare_test_inventories(
            {
                self.FOO: _fwd(self.FOO, "PASS"),
                second: _fwd(second, "PASS"),
            },
            {},
            missing_test_audit=audit,
        )
        self.assertTrue(receipt["errors"])
        self.assertTrue(
            any("does not exactly match" in error for error in receipt["errors"])
        )
        self.assertTrue(
            any("missing from candidate" in error for error in receipt["errors"])
        )

    def test_audited_replacement_must_be_a_passing_candidate_test(self) -> None:
        replacement = "test/foo_test.dart :: Foo :: replacement"
        audit = {
            self.FOO: MissingTestAuditEntry(
                identity=self.FOO,
                disposition="replaced",
                replacement_identity=replacement,
            )
        }
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "PASS")},
            {replacement: _fwd(replacement, "FAIL", signature="boom")},
            missing_test_audit=audit,
        )
        self.assertTrue(receipt["errors"])
        self.assertTrue(
            any("replacement is not a passing" in error for error in receipt["errors"])
        )
        self.assertTrue(any("new test is FAIL" in error for error in receipt["errors"]))

    def test_audit_keeps_persisting_baseline_failures_recorded(self) -> None:
        existing_failure = "test/foo_test.dart :: Foo :: existing failure"
        failed = _fwd(
            existing_failure,
            "FAIL",
            signature="Expected false Actual true",
        )
        audit = {
            self.FOO: MissingTestAuditEntry(
                identity=self.FOO,
                disposition="retired",
                replacement_identity=None,
            )
        }
        receipt = compare_test_inventories(
            {
                self.FOO: _fwd(self.FOO, "PASS"),
                existing_failure: failed,
            },
            {existing_failure: failed},
            missing_test_audit=audit,
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(
            receipt["persistingBaselineFailures"][0]["id"],
            existing_failure,
        )

    def test_new_passing_test_is_allowed(self) -> None:
        new_id = "test/foo_test.dart :: Foo :: new case"
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "PASS")},
            {
                self.FOO: _fwd(self.FOO, "PASS"),
                new_id: _fwd(new_id, "PASS"),
            },
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(receipt["newPassingTests"], [new_id])

    def test_new_failing_test_is_rejected(self) -> None:
        new_id = "test/foo_test.dart :: Foo :: new case"
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "PASS")},
            {
                self.FOO: _fwd(self.FOO, "PASS"),
                new_id: _fwd(new_id, "FAIL", signature="boom"),
            },
        )
        self.assertTrue(receipt["errors"])
        self.assertIn("new test is FAIL", receipt["errors"][0])

    def test_path_and_line_noise_is_same_failure(self) -> None:
        base = normalize_failure_signature(
            "Expected: <false>\n  Actual: <true>\n"
            "#0      main.<anonymous closure> "
            "(file:///Users/dev/mobile/test/foo_test.dart:12:5)"
        )
        candidate = normalize_failure_signature(
            "Expected: <false>\n  Actual: <true>\n"
            "#0      main.<anonymous closure> "
            "(file:///tmp/other/mobile/test/foo_test.dart:99:1)"
        )
        self.assertEqual(base, candidate)
        receipt = compare_test_inventories(
            {self.FOO: _fwd(self.FOO, "FAIL", signature=base)},
            {self.FOO: _fwd(self.FOO, "FAIL", signature=candidate)},
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(len(receipt["persistingBaselineFailures"]), 1)

    def test_july_accepted_debt_is_not_consulted(self) -> None:
        source = "\n".join(
            [
                inspect.getsource(compare_test),
                inspect.getsource(compare_test_inventories),
            ]
        )
        self.assertNotIn("acceptedDebt", source)
        self.assertNotIn("load_profile", source)
        self.assertNotIn("july1-recovery", source)
        self.assertNotIn("profile", inspect.signature(compare_test).parameters)
        july_debt_id = (
            "test/features/calendar/daily_reflection_widget_data_test.dart :: "
            "DailyReflectionWidget data contract :: keeps local date"
        )
        receipt = compare_test_inventories(
            {
                july_debt_id: _fwd(
                    july_debt_id, "FAIL", signature="Expected false Actual true"
                )
            },
            {
                july_debt_id: _fwd(
                    july_debt_id, "FAIL", signature="Expected false Actual true"
                )
            },
        )
        self.assertEqual(receipt["errors"], [])
        self.assertEqual(receipt["persistingBaselineFailures"][0]["id"], july_debt_id)

    def test_malformed_machine_output_fails_closed(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        parent = root / "parent"
        mobile = parent / "mobile"
        (parent / "supabase").mkdir(parents=True)
        (mobile / "test").mkdir(parents=True)
        (mobile / "test" / "foo_test.dart").write_text("void main() {}\n")
        log = mobile / "machine.jsonl"
        log.write_text("this is not machine json\n", encoding="utf-8")
        receipt = compare_test(
            base_log=log,
            candidate_log=log,
            base_mobile_root=mobile,
            candidate_mobile_root=mobile,
            base_parent_root=parent,
            candidate_parent_root=parent,
            base_status=1,
            candidate_status=1,
        )
        self.assertFalse(receipt["passed"])
        self.assertTrue(
            any("malformed" in error for error in receipt["errors"]),
            receipt["errors"],
        )
        self.assertEqual(receipt["persistingBaselineFailures"], [])

    def test_missing_parent_pair_layout_fails_closed(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        parent = root / "parent"
        mobile = parent / "mobile"
        mobile.mkdir(parents=True)
        log = mobile / "machine.jsonl"
        log.write_text("", encoding="utf-8")
        receipt = compare_test(
            base_log=log,
            candidate_log=log,
            base_mobile_root=mobile,
            candidate_mobile_root=mobile,
            base_parent_root=parent,
            candidate_parent_root=parent,
            base_status=0,
            candidate_status=0,
        )
        self.assertFalse(receipt["passed"])
        self.assertTrue(
            any("supabase" in error for error in receipt["errors"]),
            receipt["errors"],
        )

    def test_harness_crash_fails_closed_without_baseline_classification(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        parent = root / "parent"
        mobile = parent / "mobile"
        (parent / "supabase").mkdir(parents=True)
        (mobile / "test").mkdir(parents=True)
        log = mobile / "machine.jsonl"
        log.write_text("", encoding="utf-8")
        receipt = compare_test(
            base_log=log,
            candidate_log=log,
            base_mobile_root=mobile,
            candidate_mobile_root=mobile,
            base_parent_root=parent,
            candidate_parent_root=parent,
            base_status=2,
            candidate_status=0,
        )
        self.assertFalse(receipt["passed"])
        self.assertTrue(
            any("harness exited 2" in error for error in receipt["errors"]),
            receipt["errors"],
        )
        self.assertEqual(receipt["persistingBaselineFailures"], [])


if __name__ == "__main__":
    unittest.main()
