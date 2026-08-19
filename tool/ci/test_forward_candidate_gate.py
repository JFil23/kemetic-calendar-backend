import inspect
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tool.ci.forward_candidate_gate import (
    ALLOWED_AUTHORITY_PARENT_PATHS,
    REQUIRED_AGGREGATE_JOBS,
    REQUIRED_FORWARD_RUNTIME_COMMANDS,
    ZERO_SHA,
    ForwardCandidateError,
    ForwardTestResult,
    compare_analyze,
    compare_test,
    compare_test_inventories,
    normalize_failure_signature,
    resolve_historical_parent,
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
