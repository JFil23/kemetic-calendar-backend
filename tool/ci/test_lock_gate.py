import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from tool.ci.lock_gate import evaluate_full_suite, stable_id


class LockGateEvaluatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.mobile = self.root / "mobile"
        self.mobile.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_run(
        self,
        *,
        file: str = "test/example_test.dart",
        groups: list[str] | None = None,
        test_name: str = "example passes",
        result: str = "success",
        error: str | None = None,
        skipped: bool = False,
        complete: bool = True,
    ) -> Path:
        groups = groups or []
        test_path = self.mobile / file
        test_path.parent.mkdir(parents=True, exist_ok=True)
        test_path.write_text("// fixture\n", encoding="utf-8")
        events: list[dict[str, object]] = [
            {"protocolVersion": "0.1.1", "type": "start", "time": 0},
            {
                "suite": {"id": 1, "platform": "vm", "path": str(test_path)},
                "type": "suite",
                "time": 1,
            },
        ]
        group_ids: list[int] = []
        parent_id: int | None = None
        for index, group in enumerate(groups, start=10):
            group_ids.append(index)
            events.append(
                {
                    "group": {
                        "id": index,
                        "suiteID": 1,
                        "parentID": parent_id,
                        "name": group,
                        "metadata": {"skip": False, "skipReason": None},
                        "testCount": 1,
                    },
                    "type": "group",
                    "time": index,
                }
            )
            parent_id = index
        full_name = " ".join([*groups, test_name])
        events.append(
            {
                "test": {
                    "id": 20,
                    "name": full_name,
                    "suiteID": 1,
                    "groupIDs": group_ids,
                    "metadata": {"skip": skipped, "skipReason": "fixture" if skipped else None},
                    "line": 1,
                    "column": 1,
                    "url": test_path.as_uri(),
                },
                "type": "testStart",
                "time": 20,
            }
        )
        if error is not None:
            events.append(
                {
                    "testID": 20,
                    "error": error,
                    "stackTrace": "fixture stack",
                    "isFailure": result == "failure",
                    "type": "error",
                    "time": 21,
                }
            )
        events.append(
            {
                "testID": 20,
                "result": result,
                "skipped": skipped,
                "hidden": False,
                "type": "testDone",
                "time": 22,
            }
        )
        if complete:
            events.append({"success": result == "success", "type": "done", "time": 23})
        path = self.root / "run.jsonl"
        path.write_text(
            "".join(json.dumps(event, separators=(",", ":")) + "\n" for event in events),
            encoding="utf-8",
        )
        return path

    def _registry(self, entries: list[dict[str, object]], allowed_skips=None) -> Path:
        path = self.root / "quarantine-registry.yaml"
        path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "taxonomyVersion": 1,
                    "maxLifetimeDays": 14,
                    "entries": entries,
                    "allowedSkips": allowed_skips or [],
                }
            ),
            encoding="utf-8",
        )
        return path

    def _locked(self, expected_ids: list[str] | None = None) -> Path:
        path = self.root / "locked-contracts.json"
        if expected_ids:
            unit = {
                "file": "test/widgets/global_drawer_navigation_contract_test.dart",
                "mode": "exact",
                "plainName": "fixture locked navigation contract",
                "evidenceType": "router-widget",
                "coverageRole": "LOCKED",
                "contractRefs": ["NAV-CONTRACT-001"],
                "expectedIds": expected_ids,
            }
        else:
            unit = {
                "file": "test/widgets/global_drawer_navigation_contract_test.dart",
                "mode": "whole-file",
                "evidenceType": "router-widget",
                "coverageRole": "LOCKED",
                "contractRefs": ["NAV-CONTRACT-001"],
                "expectedTestCount": 1,
                "expectedIdsSha256": "0" * 64,
            }
        path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "neverQuarantineFiles": [
                        "test/widgets/global_drawer_navigation_contract_test.dart"
                    ],
                    "units": [unit],
                    "processUnits": [
                        {
                            "id": "fixture-process",
                            "harness": "integration_test/fixture_harness.dart",
                            "evidenceType": "process-behavior",
                            "coverageRole": "LOCKED",
                            "contractRefs": ["RESTORE-FIXTURE-001"],
                            "assertions": ["terminate and relaunch"],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        return path

    def _entry(
        self,
        *,
        file: str,
        groups: list[str],
        test_name: str,
        category: str,
        created: str = "2026-07-18",
        expires: str = "2026-07-31",
    ) -> dict[str, object]:
        return {
            "file": file,
            "groupHierarchy": groups,
            "testName": test_name,
            "normalizedCategory": category,
            "classification": "FIXTURE_KNOWN_FAILURE",
            "contractRef": "FIXTURE-001",
            "ticket": "FIXTURE-001",
            "owner": "Fixture Owner",
            "created": created,
            "expires": expires,
        }

    def _evaluate(self, run: Path, registry: Path, locked: Path, status: int):
        return evaluate_full_suite(
            machine_log=run,
            flutter_status=status,
            registry_path=registry,
            locked_manifest_path=locked,
            mobile_root=self.mobile,
            evaluated_on=date(2026, 7, 18),
        )

    def test_clean_pass_is_green(self) -> None:
        decision = self._evaluate(
            self._write_run(), self._registry([]), self._locked(), 0
        )
        self.assertTrue(decision["passed"], decision)

    def test_new_failure_is_rejected(self) -> None:
        decision = self._evaluate(
            self._write_run(result="failure", error="Expected true, actual false"),
            self._registry([]),
            self._locked(),
            1,
        )
        self.assertEqual(len(decision["newFailures"]), 1)
        self.assertFalse(decision["passed"])

    def test_category_change_is_rejected(self) -> None:
        file = "test/services/source_guard_test.dart"
        groups = ["source guard"]
        name = "source remains pinned"
        entry = self._entry(
            file=file, groups=groups, test_name=name, category="assertion-mismatch"
        )
        decision = self._evaluate(
            self._write_run(
                file=file,
                groups=groups,
                test_name=name,
                result="failure",
                error="Missing source start: pinned call",
            ),
            self._registry([entry]),
            self._locked(),
            1,
        )
        self.assertEqual(len(decision["categoryChanges"]), 1)
        self.assertFalse(decision["passed"])

    def test_expired_entry_is_rejected(self) -> None:
        file = "test/example_test.dart"
        name = "example fails"
        entry = self._entry(
            file=file,
            groups=[],
            test_name=name,
            category="assertion-mismatch",
            created="2026-07-01",
            expires="2026-07-15",
        )
        decision = self._evaluate(
            self._write_run(
                file=file,
                test_name=name,
                result="failure",
                error="Expected true, actual false",
            ),
            self._registry([entry]),
            self._locked(),
            1,
        )
        self.assertTrue(any("expired" in item for item in decision["invalidEntries"]))
        self.assertFalse(decision["passed"])

    def test_missing_test_is_rejected(self) -> None:
        entry = self._entry(
            file="test/missing_test.dart",
            groups=[],
            test_name="missing",
            category="assertion-mismatch",
        )
        decision = self._evaluate(
            self._write_run(), self._registry([entry]), self._locked(), 0
        )
        self.assertEqual(len(decision["missingTests"]), 1)
        self.assertFalse(decision["passed"])

    def test_navigation_matrix_quarantine_is_rejected(self) -> None:
        file = "test/widgets/global_drawer_navigation_contract_test.dart"
        groups = ["Rule 2"]
        name = "matching Library detail exposes its mounted canonical base"
        identity = stable_id(file, groups, name)
        entry = self._entry(
            file=file,
            groups=groups,
            test_name=name,
            category="assertion-mismatch",
        )
        decision = self._evaluate(
            self._write_run(
                file=file,
                groups=groups,
                test_name=name,
                result="failure",
                error="Expected /nodes, actual /nodes/maat",
            ),
            self._registry([entry]),
            self._locked([identity]),
            1,
        )
        self.assertEqual(len(decision["lockedOverlaps"]), 1)
        self.assertFalse(decision["passed"])

    def test_incomplete_machine_stream_is_rejected(self) -> None:
        decision = self._evaluate(
            self._write_run(complete=False), self._registry([]), self._locked(), 1
        )
        self.assertTrue(decision["streamErrors"])
        self.assertFalse(decision["passed"])


if __name__ == "__main__":
    unittest.main()
