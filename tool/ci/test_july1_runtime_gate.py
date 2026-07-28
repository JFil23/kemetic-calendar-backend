import contextlib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from tool.ci.july1_runtime_gate import (
    EXPECTED_CONTROL_PATHS,
    EXPECTED_EXECUTION_TIME_ZONE,
    EXPECTED_PARENT_DELETED_PATHS,
    EXPECTED_PARENT_DELTA_PATHS,
    EXPECTED_PARENT_HASHED_PATHS,
    EXPECTED_TIME_ZONE_CLASSIFICATION,
    EXPECTED_TIME_ZONE_FIX_COMMIT,
    EXPECTED_TIME_ZONE_TEST_ID,
    EXPECTED_TIME_ZONE_TICKET,
    _canonical_flutter_metadata,
    evaluate_full_suite,
    inspect_pub_get_mutation,
    load_profile,
    main,
    stable_id,
    verify_checkout,
)


def _digest(values):
    payload = "".join(f"{value}\n" for value in sorted(values))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _path_sha_digest(entries):
    payload = "".join(
        f"{entry['path']}\t{entry['sha256']}\n"
        for entry in sorted(entries, key=lambda value: value["path"])
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class July1RuntimeGateTest(unittest.TestCase):
    def setUp(self):
        self.original_time_zone = os.environ.get("TZ")
        os.environ["TZ"] = EXPECTED_EXECUTION_TIME_ZONE
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

        self._write_mobile_tree("historical")
        self._git(self.mobile, "add", ".")
        self._git(self.mobile, "commit", "-qm", "historical")
        self.historical = self._git(self.mobile, "rev-parse", "HEAD")

        (self.mobile / "base.txt").write_text("current base\n", encoding="utf-8")
        self._git(self.mobile, "add", ".")
        self._git(self.mobile, "commit", "-qm", "current base")
        self.mobile_base = self._git(self.mobile, "rev-parse", "HEAD")

        (self.mobile / "base.txt").unlink()
        self._write_mobile_tree("recovery")
        self._git(self.mobile, "add", "-A")
        self._git(self.mobile, "commit", "-qm", "recovery")
        self.mobile_head = self._git(self.mobile, "rev-parse", "HEAD")

        (self.parent / "README.md").write_text("parent\n", encoding="utf-8")
        (self.parent / ".github" / "workflows").mkdir(parents=True)
        (self.parent / ".github" / "workflows" / "mobile.yml").write_text(
            "name: old\n", encoding="utf-8"
        )
        (self.parent / "ci").mkdir()
        (self.parent / "ci" / "LOCK_GATE.md").write_text(
            "old authority\n", encoding="utf-8"
        )
        (self.parent / "ci" / "locked-contracts.json").write_text(
            '{"status":"ACTIVE"}\n', encoding="utf-8"
        )
        (self.parent / "ci" / "quarantine-registry.yaml").write_text(
            '{"status":"ACTIVE"}\n', encoding="utf-8"
        )
        self._git(self.parent, "add", ".")
        self._git(
            self.parent,
            "update-index",
            "--add",
            "--cacheinfo",
            f"160000,{self.mobile_base},mobile",
        )
        self._git(self.parent, "commit", "-qm", "parent base")
        self.parent_base = self._git(self.parent, "rev-parse", "HEAD")

        (self.parent / ".github" / "workflows" / "mobile.yml").write_text(
            "name: July 1\n", encoding="utf-8"
        )
        (self.parent / "ci" / "LOCK_GATE.md").write_text(
            "July 1 authority\n", encoding="utf-8"
        )
        (self.parent / "ci" / "locked-contracts.json").unlink()
        (self.parent / "ci" / "quarantine-registry.yaml").unlink()
        for relative in EXPECTED_PARENT_HASHED_PATHS:
            path = self.parent / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            if relative.endswith(
                "locked-contracts.post-july1.242.json"
            ):
                payload = '{"status":"SUPERSEDED_LOCKED"}\n'
            elif relative.endswith(
                "quarantine-registry.post-july1.7.json"
            ):
                payload = '{"status":"SUPERSEDED_REGISTRY"}\n'
            elif relative not in {
                ".github/workflows/mobile.yml",
                "ci/LOCK_GATE.md",
            }:
                payload = f"fixture:{relative}\n"
            else:
                continue
            path.write_text(payload, encoding="utf-8")
        authority_path = self.parent / "ci" / "runtime-authority"
        authority_path.mkdir(parents=True)
        (authority_path / "july1-recovery.v1.json").write_text(
            '{"self":"validated by external fixture profile"}\n',
            encoding="utf-8",
        )
        self._git(self.parent, "add", "-A")
        self._git(
            self.parent,
            "update-index",
            "--add",
            "--cacheinfo",
            f"160000,{self.mobile_head},mobile",
        )
        self._git(self.parent, "commit", "-qm", "pair mobile")
        self.parent_head = self._git(self.parent, "rev-parse", "HEAD")

        self.pass_id = stable_id("test/a_test.dart", ["matrix"], "passes")
        self.debt_id = stable_id("test/a_test.dart", ["matrix"], "guard debt")
        self.skip_id = stable_id("test/b_test.dart", [], "owned skip")
        self.control_id = stable_id(
            "test/core/web_runtime_config_guard_test.dart",
            [],
            "runtime config control",
        )
        self.present_ids = {
            stable_id(
                f"test/present_{index}_test.dart",
                [],
                f"present contract {index}",
            )
            for index in range(6)
        }
        self.profile = self.root / "profile.json"
        self.log = self.root / "machine.jsonl"
        self._write_log()
        self._write_profile()

    def tearDown(self):
        self.temp.cleanup()
        if self.original_time_zone is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = self.original_time_zone

    def _git(self, cwd, *args):
        return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()

    def _write_mobile_tree(self, label):
        (self.mobile / "lib").mkdir(exist_ok=True)
        (self.mobile / "test").mkdir(exist_ok=True)
        (self.mobile / "lib" / "app.dart").write_text(
            f"const label = '{label}';\n", encoding="utf-8"
        )
        (self.mobile / "test" / "a_test.dart").write_text("// a\n", encoding="utf-8")
        (self.mobile / "test" / "b_test.dart").write_text("// b\n", encoding="utf-8")
        for index in range(6):
            (self.mobile / "test" / f"present_{index}_test.dart").write_text(
                f"// present {index}\n",
                encoding="utf-8",
            )
        (self.mobile / "pubspec.lock").write_text("lock fixture\n", encoding="utf-8")
        for relative in EXPECTED_CONTROL_PATHS:
            path = self.mobile / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"control:{relative}\n".encode())
        (self.mobile / ".flutter-plugins-dependencies").write_text(
            json.dumps(
                {
                    "info": (
                        "This is a generated file; do not edit or check into "
                        "version control."
                    ),
                    "plugins": {
                        "linux": [
                            {
                                "name": "fixture_plugin",
                                "path": (
                                    "/Users/fixture/.pub-cache/hosted/pub.dev/"
                                    "fixture_plugin-1.2.3/"
                                ),
                                "native_build": True,
                                "dependencies": [],
                                "dev_dependency": False,
                            }
                        ]
                    },
                    "dependencyGraph": [
                        {
                            "name": "fixture_plugin",
                            "dependencies": [],
                        }
                    ],
                    "date_created": "2026-07-01 00:00:00.000000",
                    "version": "3.35.3",
                    "swift_package_manager_enabled": False,
                },
                separators=(",", ":"),
            )
            + "\n",
            encoding="utf-8",
        )

    def _test_events(
        self,
        suite_id,
        file,
        tests,
        start_time,
    ):
        events = [
            {
                "suite": {
                    "id": suite_id,
                    "platform": "vm",
                    "path": str(self.mobile / file),
                },
                "type": "suite",
                "time": start_time,
            }
        ]
        loading_test_id = suite_id * 1000
        events.extend(
            [
                {
                    "test": {
                        "id": loading_test_id,
                        "name": f"loading {self.mobile / file}",
                        "suiteID": suite_id,
                        "groupIDs": [],
                        "metadata": {"skip": False, "skipReason": None},
                    },
                    "type": "testStart",
                    "time": start_time,
                },
                {
                    "testID": loading_test_id,
                    "result": "success",
                    "skipped": False,
                    "hidden": True,
                    "type": "testDone",
                    "time": start_time,
                },
            ]
        )
        root_group_id = suite_id * 10
        group_ids = [root_group_id]
        events.append(
            {
                "group": {
                    "id": root_group_id,
                    "suiteID": suite_id,
                    "parentID": None,
                    "name": "",
                    "metadata": {"skip": False, "skipReason": None},
                    "testCount": len(tests),
                },
                "type": "group",
                "time": start_time + 1,
            }
        )
        if tests[0].get("groups"):
            named_group_id = root_group_id + 1
            group_ids.append(named_group_id)
            events.append(
                {
                    "group": {
                        "id": named_group_id,
                        "suiteID": suite_id,
                        "parentID": root_group_id,
                        "name": tests[0]["groups"][0],
                        "metadata": {"skip": False, "skipReason": None},
                        "testCount": len(tests),
                    },
                    "type": "group",
                    "time": start_time + 1,
                }
            )
        for offset, test in enumerate(tests, start=1):
            test_id = suite_id * 100 + offset
            groups = test.get("groups", [])
            full_name = " ".join([*groups, test["name"]])
            skipped = test.get("skipped", False)
            events.append(
                {
                    "test": {
                        "id": test_id,
                        "name": full_name,
                        "suiteID": suite_id,
                        "groupIDs": group_ids if groups else [root_group_id],
                        "metadata": {
                            "skip": skipped,
                            "skipReason": test.get("reason") if skipped else None,
                        },
                    },
                    "type": "testStart",
                    "time": start_time + offset * 3,
                }
            )
            if test.get("error"):
                events.append(
                    {
                        "testID": test_id,
                        "error": test["error"],
                        "stackTrace": test.get("stack", "fixture stack"),
                        "isFailure": test.get("result") == "failure",
                        "type": "error",
                        "time": start_time + offset * 3 + 1,
                    }
                )
            events.append(
                {
                    "testID": test_id,
                    "result": test.get("result", "success"),
                    "skipped": skipped,
                    "hidden": False,
                    "type": "testDone",
                    "time": start_time + offset * 3 + 2,
                }
            )
        return events

    def _write_log(
        self,
        *,
        debt_result="failure",
        debt_error="Missing source start: expected source",
        skip_reason="owned fixture",
        add_extra_failure=False,
        duplicate_suite=False,
        omit_debt=False,
    ):
        events = [
            {"protocolVersion": "0.1.1", "type": "start", "time": 0},
            {"count": 9, "type": "allSuites", "time": 1},
        ]
        tests_a = [{"name": "passes", "groups": ["matrix"]}]
        if not omit_debt:
            tests_a.append(
                {
                    "name": "guard debt",
                    "groups": ["matrix"],
                    "result": debt_result,
                    "error": debt_error,
                }
            )
        if add_extra_failure:
            tests_a.append(
                {
                    "name": "new failure",
                    "groups": ["matrix"],
                    "result": "failure",
                    "error": "Expected true, actual false",
                }
            )
        events += self._test_events(1, "test/a_test.dart", tests_a, 1)
        events += self._test_events(
            2,
            "test/b_test.dart",
            [{"name": "owned skip", "skipped": True, "reason": skip_reason}],
            50,
        )
        events += self._test_events(
            4,
            "test/core/web_runtime_config_guard_test.dart",
            [{"name": "runtime config control"}],
            60,
        )
        for index in range(6):
            events += self._test_events(
                5 + index,
                f"test/present_{index}_test.dart",
                [{"name": f"present contract {index}"}],
                65 + index,
            )
        if duplicate_suite:
            events.append(
                {
                    "suite": {
                        "id": 3,
                        "platform": "vm",
                        "path": str(self.mobile / "test/a_test.dart"),
                    },
                    "type": "suite",
                    "time": 70,
                }
            )
        events.append({"success": False, "type": "done", "time": 99})
        self.log.write_text(
            "".join(json.dumps(event, separators=(",", ":")) + "\n" for event in events),
            encoding="utf-8",
        )

    def _write_profile(self):
        control_paths = []
        for relative in sorted(EXPECTED_CONTROL_PATHS):
            control_paths.append(
                {
                    "path": relative,
                    "class": "build-control",
                    "sha256": hashlib.sha256(
                        (self.mobile / relative).read_bytes()
                    ).hexdigest(),
                }
            )
        suite_files = {
            "test/a_test.dart",
            "test/b_test.dart",
            "test/core/web_runtime_config_guard_test.dart",
            *{
                f"test/present_{index}_test.dart"
                for index in range(6)
            },
        }
        stable_ids = {
            self.pass_id,
            self.debt_id,
            self.skip_id,
            self.control_id,
            *self.present_ids,
        }
        present_later_paths = [
            "test/a_test.dart",
            "test/b_test.dart",
            "test/core/web_runtime_config_guard_test.dart",
            *[
                f"test/present_{index}_test.dart"
                for index in range(6)
            ],
        ]
        absent_later_paths = [
            f"test/absent_{index}_test.dart"
            for index in range(10)
        ]
        profile = {
            "schemaVersion": 1,
            "profileId": "JULY1-FIXTURE",
            "status": "ACTIVE_EXACT_RECOVERY_RUNTIME",
            "identity": {
                "parentAuthorityBaseCommit": self.parent_base,
                "currentMobileBaseCommit": self.mobile_base,
                "historicalMobileCommit": self.historical,
                "authorizedForwardCommit": self.mobile_head,
                "mergedMobileCommit": self.mobile_head,
                "mobileTree": self._git(self.mobile, "rev-parse", "HEAD^{tree}"),
                "libTree": self._git(self.mobile, "rev-parse", "HEAD:lib"),
                "testTree": self._git(self.mobile, "rev-parse", "HEAD:test"),
                "pubspecLockSha256": hashlib.sha256(
                    (self.mobile / "pubspec.lock").read_bytes()
                ).hexdigest(),
                "flutterVersion": "3.35.3",
                "dartVersion": "3.9.2",
            },
            "controlOverlay": {
                "paths": control_paths,
                "sortedPathSha256Digest": _path_sha_digest(control_paths),
            },
            "parentDelta": {
                "baseCommit": self.parent_base,
                "exactPaths": sorted(EXPECTED_PARENT_DELTA_PATHS),
                "deletedPaths": sorted(EXPECTED_PARENT_DELETED_PATHS),
                "selfValidatedPath": (
                    "ci/runtime-authority/july1-recovery.v1.json"
                ),
                "mobileGitlinkPath": "mobile",
                "files": [
                    {
                        "path": relative,
                        "sha256": hashlib.sha256(
                            (self.parent / relative).read_bytes()
                        ).hexdigest(),
                    }
                    for relative in sorted(EXPECTED_PARENT_HASHED_PATHS)
                ],
            },
            "generatedMetadata": {
                "path": ".flutter-plugins-dependencies",
                "committedSha256": hashlib.sha256(
                    (self.mobile / ".flutter-plugins-dependencies").read_bytes()
                ).hexdigest(),
                "canonicalSha256": "",
                "permittedVolatileFields": [
                    "date_created",
                    "absolute plugin path roots",
                ],
            },
            "executionEnvironment": {
                "timeZone": EXPECTED_EXECUTION_TIME_ZONE,
                "classification": EXPECTED_TIME_ZONE_CLASSIFICATION,
                "affectedTestId": EXPECTED_TIME_ZONE_TEST_ID,
                "ticket": EXPECTED_TIME_ZONE_TICKET,
                "laterTestOnlyFixCommit": EXPECTED_TIME_ZONE_FIX_COMMIT,
                "policy": "Historical fixture environment only.",
            },
            "testInventory": {
                "suiteFileCount": 9,
                "suiteFilesSha256": _digest(suite_files),
                "substantiveCount": 10,
                "stableIdsSha256": _digest(stable_ids),
                "expectedPassCount": 8,
                "passingIdsSha256": _digest(
                    {self.pass_id, self.control_id, *self.present_ids}
                ),
                "expectedAcceptedDebtCount": 1,
                "acceptedDebtIdsSha256": _digest({self.debt_id}),
                "expectedOwnedSkipCount": 1,
                "ownedSkipIdsSha256": _digest({self.skip_id}),
            },
            "acceptedDebt": [
                {
                    "id": self.debt_id,
                    "historicalCategory": "stale source guard",
                    "evaluatorCategory": "guard-allowlist-violation",
                    "classification": "ACCEPTED_BASELINE_DEBT",
                    "ticket": "FIXTURE-DEBT-001",
                    "owner": "Fixture Owner",
                }
            ],
            "ownedSkips": [
                {
                    "id": self.skip_id,
                    "reason": "owned fixture",
                    "ticket": "FIXTURE-SKIP-001",
                    "owner": "Fixture Owner",
                }
            ],
            "supersededAuthority": {
                "status": "SUPERSEDED_LATER_RUNTIME_EVIDENCE",
                "lockedManifestPath": (
                    "ci/superseded/locked-contracts.post-july1.242.json"
                ),
                "lockedManifestSha256": hashlib.sha256(
                    (
                        self.parent
                        / "ci"
                        / "superseded"
                        / "locked-contracts.post-july1.242.json"
                    ).read_bytes()
                ).hexdigest(),
                "lockedVmTestCount": 1,
                "lockedVmUnitCount": 1,
                "processUnitCount": 1,
                "registryPath": (
                    "ci/superseded/quarantine-registry.post-july1.7.json"
                ),
                "registrySha256": hashlib.sha256(
                    (
                        self.parent
                        / "ci"
                        / "superseded"
                        / "quarantine-registry.post-july1.7.json"
                    ).read_bytes()
                ).hexdigest(),
                "laterRuntimeTestFiles": [
                    *[
                        {
                            "path": path,
                            "presentInJuly1": True,
                        }
                        for path in present_later_paths
                    ],
                    *[
                        {
                            "path": path,
                            "presentInJuly1": False,
                        }
                        for path in absent_later_paths
                    ],
                ],
                "absentTestFiles": absent_later_paths,
                "processHarness": {
                    "path": "integration_test/process.dart",
                    "presentInJuly1": False,
                },
            },
            "evidence": {
                "provenanceClassification": (
                    "NON_AUTHORITATIVE_RECOVERY_EVIDENCE"
                ),
                "recoveryEvidenceParentCommit": self.parent_base,
                "recoveryEvidenceMobileCommit": self.mobile_head,
                "localValidationCommit": self.mobile_head,
                "controlMachineLogSha256": "1" * 64,
                "recoveryArchiveSha256": "2" * 64,
            },
        }
        profile["parentDelta"]["sortedPathSha256Digest"] = _path_sha_digest(
            profile["parentDelta"]["files"]
        )
        generated_json = json.loads(
            (self.mobile / ".flutter-plugins-dependencies").read_text()
        )
        canonical, invalid = _canonical_flutter_metadata(generated_json)
        self.assertEqual(invalid, [])
        profile["generatedMetadata"]["canonicalSha256"] = hashlib.sha256(
            json.dumps(
                canonical, sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        self.profile.write_text(json.dumps(profile), encoding="utf-8")

    def test_profile_accepts_complete_strict_authority(self):
        _, errors = load_profile(self.profile)
        self.assertEqual(errors, [])

    def test_profile_rejects_debt_relabelled_as_locked(self):
        profile = json.loads(self.profile.read_text())
        profile["acceptedDebt"][0]["classification"] = "LOCKED"
        self.profile.write_text(json.dumps(profile))
        _, errors = load_profile(self.profile)
        self.assertTrue(any("ACCEPTED_BASELINE_DEBT" in error for error in errors))

    def test_profile_rejects_fixture_binding_as_accepted_debt(self):
        profile = json.loads(self.profile.read_text())
        profile["acceptedDebt"].append(
            {
                "id": EXPECTED_TIME_ZONE_TEST_ID,
                "historicalCategory": "assertion-mismatch",
                "evaluatorCategory": "assertion-mismatch",
                "classification": "ACCEPTED_BASELINE_DEBT",
                "ticket": EXPECTED_TIME_ZONE_TICKET,
                "owner": "Fixture Owner",
            }
        )
        profile["testInventory"]["expectedAcceptedDebtCount"] = 2
        profile["testInventory"]["acceptedDebtIdsSha256"] = _digest(
            {self.debt_id, EXPECTED_TIME_ZONE_TEST_ID}
        )
        self.profile.write_text(json.dumps(profile))
        _, errors = load_profile(self.profile)
        self.assertTrue(
            any("cannot enter acceptedDebt" in error for error in errors)
        )

    def test_profile_rejects_control_path_substitution(self):
        profile = json.loads(self.profile.read_text())
        profile["controlOverlay"]["paths"][0]["path"] = "scripts/other.py"
        self.profile.write_text(json.dumps(profile))
        _, errors = load_profile(self.profile)
        self.assertTrue(any("exact set mismatch" in error for error in errors))

    def test_verify_checkout_accepts_exact_gitlink_tree_and_controls(self):
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=self.parent_head,
            include_toolchain=False,
        )
        self.assertTrue(decision["passed"], decision)

    def test_verify_checkout_rejects_control_blob_drift(self):
        path = self.mobile / sorted(EXPECTED_CONTROL_PATHS)[0]
        path.write_text("drift\n", encoding="utf-8")
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=self.parent_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("control path SHA-256 mismatch" in error for error in decision["errors"])
        )

    def test_verify_checkout_rejects_later_test_presence_drift(self):
        (self.mobile / "test" / "present_0_test.dart").unlink()
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=self.parent_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any(
                "later runtime test presence mismatch" in error
                for error in decision["errors"]
            )
        )

    def test_verify_checkout_rejects_unexpected_process_harness(self):
        harness = self.mobile / "integration_test" / "process.dart"
        harness.parent.mkdir()
        harness.write_text("// unexpected\n", encoding="utf-8")
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=self.parent_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any(
                "process harness presence mismatch" in error
                for error in decision["errors"]
            )
        )

    def test_verify_checkout_rejects_wrong_parent_identity(self):
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent="0" * 40,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(any("expected parent" in error for error in decision["errors"]))

    def test_verify_checkout_rejects_unrelated_parent_delta_path(self):
        (self.parent / "unrelated.txt").write_text("not authorized\n", encoding="utf-8")
        self._git(self.parent, "add", "unrelated.txt")
        self._git(self.parent, "commit", "-qm", "unrelated")
        unrelated_head = self._git(self.parent, "rev-parse", "HEAD")
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=unrelated_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("parent delta exact path mismatch" in error for error in decision["errors"])
        )

    def test_verify_checkout_rejects_parent_blob_drift(self):
        changed = self.parent / ".github" / "workflows" / "mobile.yml"
        changed.write_text("name: unauthorized drift\n", encoding="utf-8")
        self._git(self.parent, "add", str(changed.relative_to(self.parent)))
        self._git(self.parent, "commit", "-qm", "drift authorized path")
        drift_head = self._git(self.parent, "rev-parse", "HEAD")
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=drift_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any(
                "authorized parent delta SHA-256 mismatch" in error
                for error in decision["errors"]
            )
        )

    def test_verify_checkout_rejects_parent_mode_drift(self):
        changed = self.parent / ".github" / "workflows" / "mobile.yml"
        changed.chmod(0o755)
        self._git(self.parent, "add", str(changed.relative_to(self.parent)))
        self._git(self.parent, "commit", "-qm", "mode drift")
        drift_head = self._git(self.parent, "rev-parse", "HEAD")
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=drift_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("must be 100644 blob" in error for error in decision["errors"])
        )

    def test_verify_checkout_rejects_wrong_merged_mobile_commit(self):
        profile = json.loads(self.profile.read_text())
        profile["identity"]["mergedMobileCommit"] = self.mobile_base
        self.profile.write_text(json.dumps(profile))
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=self.parent_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("merged mobile authority" in error for error in decision["errors"])
        )

    def test_verify_checkout_rejects_forward_commit_with_wrong_tree(self):
        profile = json.loads(self.profile.read_text())
        profile["identity"]["authorizedForwardCommit"] = self.mobile_base
        self.profile.write_text(json.dumps(profile))
        decision = verify_checkout(
            profile_path=self.profile,
            parent_root=self.parent,
            mobile_root=self.mobile,
            expected_parent=self.parent_head,
            include_toolchain=False,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any(
                "authorized forward commit tree" in error
                for error in decision["errors"]
            )
        )

    def test_pub_generated_metadata_accepts_byte_identical_checkout(self):
        decision = inspect_pub_get_mutation(
            profile_path=self.profile,
            mobile_root=self.mobile,
        )
        self.assertTrue(decision["passed"], decision)
        self.assertFalse(decision["changed"])

    def test_pub_generated_metadata_accepts_only_valid_host_variability(self):
        path = self.mobile / ".flutter-plugins-dependencies"
        generated = json.loads(path.read_text())
        generated["date_created"] = "2026-07-28T10:11:12.123456"
        generated["plugins"]["linux"][0]["path"] = (
            "/home/runner/.pub-cache/hosted/pub.dev/fixture_plugin-1.2.3/"
        )
        path.write_text(json.dumps(generated, separators=(",", ":")) + "\n")
        decision = inspect_pub_get_mutation(
            profile_path=self.profile,
            mobile_root=self.mobile,
        )
        self.assertTrue(decision["passed"], decision)
        self.assertTrue(decision["changed"])
        self.assertEqual(
            decision["headCanonicalSha256"],
            decision["observedCanonicalSha256"],
        )

    def test_pub_generated_metadata_rejects_dependency_semantic_drift(self):
        path = self.mobile / ".flutter-plugins-dependencies"
        generated = json.loads(path.read_text())
        generated["dependencyGraph"][0]["dependencies"] = ["other"]
        path.write_text(json.dumps(generated, separators=(",", ":")) + "\n")
        decision = inspect_pub_get_mutation(
            profile_path=self.profile,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("semantics differ" in error for error in decision["errors"])
        )

    def test_pub_generated_metadata_rejects_unrelated_dirty_path(self):
        (self.mobile / "lib" / "app.dart").write_text(
            "const label = 'dirty';\n", encoding="utf-8"
        )
        decision = inspect_pub_get_mutation(
            profile_path=self.profile,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("outside the one allowed" in error for error in decision["errors"])
        )

    def test_pub_generated_metadata_rejects_staged_rewrite(self):
        path = self.mobile / ".flutter-plugins-dependencies"
        generated = json.loads(path.read_text())
        generated["date_created"] = "2026-07-28T10:11:12"
        path.write_text(json.dumps(generated, separators=(",", ":")) + "\n")
        self._git(self.mobile, "add", ".flutter-plugins-dependencies")
        decision = inspect_pub_get_mutation(
            profile_path=self.profile,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("index state" in error for error in decision["errors"])
        )

    def test_pub_generated_metadata_rejects_arbitrary_path_root(self):
        path = self.mobile / ".flutter-plugins-dependencies"
        generated = json.loads(path.read_text())
        generated["plugins"]["linux"][0]["path"] = (
            "/tmp/untrusted/fixture_plugin-1.2.3/"
        )
        path.write_text(json.dumps(generated, separators=(",", ":")) + "\n")
        decision = inspect_pub_get_mutation(
            profile_path=self.profile,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("outside hosted/pub.dev" in error for error in decision["errors"])
        )

    def test_pub_generated_metadata_rejects_malformed_timestamp(self):
        path = self.mobile / ".flutter-plugins-dependencies"
        generated = json.loads(path.read_text())
        generated["date_created"] = "not-a-time"
        path.write_text(json.dumps(generated, separators=(",", ":")) + "\n")
        decision = inspect_pub_get_mutation(
            profile_path=self.profile,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("not ISO-8601" in error for error in decision["errors"])
        )

    def test_full_suite_accepts_exact_debt_and_owned_skip(self):
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertTrue(decision["passed"], decision)
        self.assertEqual(
            decision["acceptedBaselineDebt"][0]["classification"],
            "ACCEPTED_BASELINE_DEBT",
        )
        self.assertEqual(
            decision["executionEnvironment"],
            {
                "classification": EXPECTED_TIME_ZONE_CLASSIFICATION,
                "affectedTestId": EXPECTED_TIME_ZONE_TEST_ID,
                "expectedTimeZone": EXPECTED_EXECUTION_TIME_ZONE,
                "observedTimeZone": EXPECTED_EXECUTION_TIME_ZONE,
                "matched": True,
                "ticket": EXPECTED_TIME_ZONE_TICKET,
                "laterTestOnlyFixCommit": EXPECTED_TIME_ZONE_FIX_COMMIT,
            },
        )

    def test_full_suite_rejects_missing_execution_timezone(self):
        os.environ.pop("TZ")
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertFalse(decision["executionEnvironment"]["matched"])
        self.assertTrue(
            any("execution timezone mismatch" in error for error in decision["errors"])
        )

    def test_full_suite_rejects_wrong_execution_timezone(self):
        os.environ["TZ"] = "UTC"
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertEqual(
            decision["executionEnvironment"]["observedTimeZone"],
            "UTC",
        )
        self.assertTrue(
            any("execution timezone mismatch" in error for error in decision["errors"])
        )

    def test_full_suite_rejects_disappeared_debt(self):
        self._write_log(omit_debt=True)
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertEqual(decision["missingDebt"], [self.debt_id])

    def test_full_suite_rejects_category_change(self):
        self._write_log(debt_error="Expected true, actual false")
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any("evaluator category changed" in error for error in decision["errors"])
        )

    def test_full_suite_rejects_extra_failure(self):
        self._write_log(add_extra_failure=True)
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertEqual(len(decision["extraFailures"]), 1)

    def test_full_suite_rejects_hidden_loading_failure(self):
        events = [
            json.loads(line)
            for line in self.log.read_text(encoding="utf-8").splitlines()
        ]
        loading_done = next(
            event
            for event in events
            if event.get("type") == "testDone" and event.get("hidden") is True
        )
        loading_done["result"] = "failure"
        self.log.write_text(
            "".join(
                json.dumps(event, separators=(",", ":")) + "\n"
                for event in events
            ),
            encoding="utf-8",
        )
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(
            any(
                "hidden loading/compile tests did not pass" in error
                for error in decision["errors"]
            )
        )

    def test_full_suite_rejects_changed_skip_reason(self):
        self._write_log(skip_reason="different owner")
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(any("skip reason changed" in error for error in decision["errors"]))

    def test_full_suite_rejects_duplicate_suite_path(self):
        self._write_log(duplicate_suite=True)
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(any("duplicate suite paths" in error for error in decision["errors"]))

    def test_full_suite_rejects_truncated_machine_stream(self):
        lines = self.log.read_text().splitlines()
        self.log.write_text("\n".join(lines[:-1]) + "\n")
        decision = evaluate_full_suite(
            profile_path=self.profile,
            machine_log=self.log,
            flutter_status=1,
            mobile_root=self.mobile,
        )
        self.assertFalse(decision["passed"])
        self.assertTrue(any("done events" in error for error in decision["errors"]))

    def test_cli_writes_evaluate_outputs(self):
        output = self.root / "results"
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = main(
                [
                    "evaluate-full",
                    "--profile",
                    str(self.profile),
                    "--machine-log",
                    str(self.log),
                    "--flutter-status",
                    "1",
                    "--mobile-root",
                    str(self.mobile),
                    "--output-dir",
                    str(output),
                ]
            )
        self.assertEqual(status, 0)
        self.assertTrue((output / "july1-runtime-decision.json").is_file())
        normalized = json.loads(
            (output / "july1-runtime-normalized.json").read_text()
        )
        debt = [entry for entry in normalized if entry["id"] == self.debt_id]
        self.assertEqual(debt[0]["status"], "ACCEPTED_BASELINE_DEBT")


if __name__ == "__main__":
    unittest.main()
