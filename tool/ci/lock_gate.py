#!/usr/bin/env python3
"""Zero-tolerance locked contracts and controlled full-suite quarantine gates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any


ALLOWED_CATEGORIES = {
    "assertion-mismatch",
    "pending-timer",
    "guard-allowlist-violation",
    "environment-layout",
    "missing-hermetic-fixture",
    "timeout",
    "compile-error",
    "uncaught-runtime-error",
}
ALLOWED_EVIDENCE_TYPES = {
    "router-widget",
    "storage-behavior",
    "lifecycle-behavior",
    "process-behavior",
    "model-supporting",
}
ALLOWED_COVERAGE_ROLES = {"LOCKED", "PARTIAL_SUPPORTING", "PARTIAL_IN_PROCESS"}
REQUIRED_ENTRY_FIELDS = {
    "file",
    "groupHierarchy",
    "testName",
    "normalizedCategory",
    "classification",
    "contractRef",
    "ticket",
    "owner",
    "created",
    "expires",
}
WILDCARD_CHARS = set("*?[")


def stable_id(file: str, groups: list[str], test_name: str) -> str:
    return " :: ".join([file, *groups, test_name])


def _ids_sha256(identities: list[str] | set[str]) -> str:
    payload = "".join(f"{identity}\n" for identity in sorted(identities))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _json_load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_suite_path(path: str, mobile_root: Path) -> str:
    candidate = Path(path)
    try:
        return candidate.resolve().relative_to(mobile_root.resolve()).as_posix()
    except (ValueError, OSError):
        normalized = path.replace("\\", "/")
        marker = "/test/"
        if marker in normalized:
            return "test/" + normalized.rsplit(marker, 1)[1]
        return normalized


def _leaf_name(full_name: str, groups: list[str]) -> str:
    prefix = " ".join(groups)
    if prefix and full_name.startswith(prefix + " "):
        return full_name[len(prefix) + 1 :]
    return full_name


@dataclass(frozen=True)
class TestResult:
    identity: str
    file: str
    groups: list[str]
    test_name: str
    full_name: str
    result: str
    skipped: bool
    hidden: bool
    errors: list[dict[str, Any]]


@dataclass
class MachineRun:
    tests: list[TestResult]
    stream_errors: list[str]
    done_success: bool | None
    suite_files: set[str]

    @property
    def substantive(self) -> list[TestResult]:
        return [test for test in self.tests if not test.hidden]


def load_machine_run(path: Path, mobile_root: Path) -> MachineRun:
    events: list[dict[str, Any]] = []
    stream_errors: list[str] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            event = json.loads(raw)
        except json.JSONDecodeError as error:
            stream_errors.append(f"line {line_number}: malformed machine JSON: {error}")
            continue
        if (
            isinstance(event, list)
            and event
            and all(
                isinstance(item, dict)
                and item.get("event") == "test.startedProcess"
                for item in event
            )
        ):
            # Flutter can interleave this VM-service lifecycle envelope with
            # otherwise valid machine protocol JSON. It is not a test event.
            continue
        if not isinstance(event, dict) or not isinstance(event.get("type"), str):
            stream_errors.append(f"line {line_number}: invalid machine event")
            continue
        events.append(event)

    starts = [event for event in events if event.get("type") == "start"]
    done = [event for event in events if event.get("type") == "done"]
    if len(starts) != 1:
        stream_errors.append(f"machine stream has {len(starts)} start events; expected 1")
    if len(done) != 1:
        stream_errors.append(f"machine stream has {len(done)} done events; expected 1")

    suites: dict[int, str] = {}
    groups: dict[int, str] = {}
    starts_by_id: dict[int, dict[str, Any]] = {}
    done_by_id: dict[int, list[dict[str, Any]]] = {}
    errors_by_id: dict[int, list[dict[str, Any]]] = {}

    for event in events:
        event_type = event.get("type")
        if event_type == "suite":
            suite = event.get("suite", {})
            if isinstance(suite.get("id"), int) and isinstance(suite.get("path"), str):
                suites[suite["id"]] = _normalize_suite_path(suite["path"], mobile_root)
        elif event_type == "group":
            group = event.get("group", {})
            if isinstance(group.get("id"), int) and isinstance(group.get("name"), str):
                groups[group["id"]] = group["name"]
        elif event_type == "testStart":
            test = event.get("test", {})
            test_id = test.get("id")
            if not isinstance(test_id, int):
                stream_errors.append("testStart without integer test id")
            elif test_id in starts_by_id:
                stream_errors.append(f"duplicate testStart id {test_id}")
            else:
                starts_by_id[test_id] = test
        elif event_type == "testDone":
            test_id = event.get("testID")
            if isinstance(test_id, int):
                done_by_id.setdefault(test_id, []).append(event)
        elif event_type == "error":
            test_id = event.get("testID")
            if isinstance(test_id, int):
                errors_by_id.setdefault(test_id, []).append(event)

    results: list[TestResult] = []
    for test_id, start in starts_by_id.items():
        completions = done_by_id.get(test_id, [])
        if len(completions) != 1:
            stream_errors.append(
                f"test id {test_id} has {len(completions)} testDone events; expected 1"
            )
            continue
        completion = completions[0]
        suite_id = start.get("suiteID")
        file = suites.get(suite_id, f"<unknown-suite:{suite_id}>")
        group_ids = start.get("groupIDs") or []
        hierarchy = [
            groups[group_id]
            for group_id in group_ids
            if isinstance(group_id, int) and groups.get(group_id, "")
        ]
        full_name = str(start.get("name", ""))
        test_name = _leaf_name(full_name, hierarchy)
        hidden = bool(completion.get("hidden", False))
        result = str(completion.get("result", "unknown"))
        skipped = bool(completion.get("skipped", False))
        results.append(
            TestResult(
                identity=stable_id(file, hierarchy, test_name),
                file=file,
                groups=hierarchy,
                test_name=test_name,
                full_name=full_name,
                result=result,
                skipped=skipped,
                hidden=hidden,
                errors=errors_by_id.get(test_id, []),
            )
        )

    orphan_done = sorted(set(done_by_id) - set(starts_by_id))
    if orphan_done:
        stream_errors.append(f"testDone events without testStart: {orphan_done}")

    return MachineRun(
        tests=results,
        stream_errors=stream_errors,
        done_success=bool(done[0].get("success")) if len(done) == 1 else None,
        suite_files=set(suites.values()),
    )


def normalized_category(test: TestResult) -> str:
    error_messages = "\n".join(
        str(item.get("error", "")) for item in test.errors
    ).lower()
    combined = "\n".join(
        str(item.get("error", "")) + "\n" + str(item.get("stackTrace", ""))
        for item in test.errors
    ).lower()
    if test.hidden:
        return "compile-error"
    if "pending timer" in combined or "timer is still pending" in combined:
        return "pending-timer"
    if test.result == "error":
        if "timeout" in error_messages or "timed out" in error_messages:
            return "timeout"
        return "uncaught-runtime-error"
    guard_signal = (
        "missing source" in combined
        or "_sourcebetween" in combined
        or "source contains" in test.full_name.lower()
        or "raw context.push" in test.full_name.lower()
        or (
            "_guard_test.dart" in test.file
            and "which: does not contain" in combined
        )
    )
    if guard_signal:
        return "guard-allowlist-violation"
    if "timeout" in error_messages or "timed out" in error_messages:
        return "timeout"
    if "renderflex overflowed" in combined or "physical size" in combined:
        return "environment-layout"
    if "no materiallocalizations" in combined or "fixture" in combined:
        return "missing-hermetic-fixture"
    return "assertion-mismatch"


def _entry_identity(entry: dict[str, Any]) -> str:
    return stable_id(entry["file"], entry["groupHierarchy"], entry["testName"])


def _has_wildcard(value: str) -> bool:
    return any(character in value for character in WILDCARD_CHARS)


def _load_locked_manifest(path: Path) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    try:
        manifest = _json_load(path)
    except (OSError, json.JSONDecodeError) as error:
        return {}, [f"locked manifest cannot be read: {error}"]
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
        errors.append("locked manifest schemaVersion must be 1")
        return manifest if isinstance(manifest, dict) else {}, errors
    units = manifest.get("units")
    if not isinstance(units, list) or not units:
        errors.append("locked manifest units must be a non-empty list")
        return manifest, errors
    for index, unit in enumerate(units):
        if not isinstance(unit, dict):
            errors.append(f"locked unit {index} must be an object")
            continue
        if unit.get("evidenceType") not in ALLOWED_EVIDENCE_TYPES:
            errors.append(f"locked unit {index} has forbidden evidence type")
        if unit.get("evidenceType") == "process-behavior":
            errors.append(f"locked VM unit {index} cannot claim process behavior")
        if unit.get("coverageRole") not in ALLOWED_COVERAGE_ROLES:
            errors.append(f"locked unit {index} has invalid coverageRole")
        if (
            unit.get("evidenceType") == "model-supporting"
            and unit.get("coverageRole") != "PARTIAL_SUPPORTING"
        ):
            errors.append(f"locked model unit {index} must be PARTIAL_SUPPORTING")
        if unit.get("mode") not in {"whole-file", "exact"}:
            errors.append(f"locked unit {index} has invalid mode")
        file = unit.get("file")
        if not isinstance(file, str) or not file.startswith("test/") or _has_wildcard(file):
            errors.append(f"locked unit {index} has invalid file")
        if not isinstance(unit.get("contractRefs"), list) or not unit["contractRefs"]:
            errors.append(f"locked unit {index} lacks contractRefs")
        if unit.get("mode") == "exact":
            if not isinstance(unit.get("plainName"), str) or not unit["plainName"]:
                errors.append(f"locked exact unit {index} lacks plainName")
            expected = unit.get("expectedIds")
            if not isinstance(expected, list) or not expected:
                errors.append(f"locked exact unit {index} lacks expectedIds")
        else:
            count = unit.get("expectedTestCount")
            digest = unit.get("expectedIdsSha256")
            if not isinstance(count, int) or count <= 0:
                errors.append(f"locked whole-file unit {index} lacks expectedTestCount")
            if not isinstance(digest, str) or len(digest) != 64:
                errors.append(f"locked whole-file unit {index} lacks expectedIdsSha256")

    process_units = manifest.get("processUnits")
    if not isinstance(process_units, list) or not process_units:
        errors.append("locked manifest processUnits must be a non-empty list")
    else:
        for index, unit in enumerate(process_units):
            if not isinstance(unit, dict):
                errors.append(f"locked process unit {index} must be an object")
                continue
            required = {"id", "harness", "evidenceType", "contractRefs", "assertions"}
            if required - set(unit):
                errors.append(f"locked process unit {index} lacks required metadata")
                continue
            if unit.get("evidenceType") != "process-behavior":
                errors.append(f"locked process unit {index} has forbidden evidence type")
            if unit.get("coverageRole") != "LOCKED":
                errors.append(f"locked process unit {index} must be LOCKED")
            if not isinstance(unit.get("contractRefs"), list) or not unit["contractRefs"]:
                errors.append(f"locked process unit {index} lacks contractRefs")
            if not isinstance(unit.get("assertions"), list) or not unit["assertions"]:
                errors.append(f"locked process unit {index} lacks assertions")
            harness = unit.get("harness")
            if (
                not isinstance(harness, str)
                or not harness.startswith("integration_test/")
                or _has_wildcard(harness)
            ):
                errors.append(f"locked process unit {index} has invalid harness")
    return manifest, errors


def _locked_boundaries(manifest: dict[str, Any]) -> tuple[set[str], set[str]]:
    locked_ids: set[str] = set()
    locked_files: set[str] = set(manifest.get("neverQuarantineFiles") or [])
    for unit in manifest.get("units") or []:
        if not isinstance(unit, dict):
            continue
        file = unit.get("file")
        if unit.get("mode") == "whole-file" and isinstance(file, str):
            locked_files.add(file)
        for identity in unit.get("expectedIds") or []:
            if isinstance(identity, str):
                locked_ids.add(identity)
    return locked_ids, locked_files


def evaluate_full_suite(
    *,
    machine_log: Path,
    flutter_status: int,
    registry_path: Path,
    locked_manifest_path: Path,
    mobile_root: Path,
    evaluated_on: date,
) -> dict[str, Any]:
    run = load_machine_run(machine_log, mobile_root)
    stream_errors = list(run.stream_errors)
    manifest, manifest_errors = _load_locked_manifest(locked_manifest_path)
    stream_errors.extend(manifest_errors)
    locked_ids, locked_files = _locked_boundaries(manifest)

    try:
        registry = _json_load(registry_path)
    except (OSError, json.JSONDecodeError) as error:
        registry = {}
        stream_errors.append(f"quarantine registry cannot be read: {error}")

    invalid_entries: list[str] = []
    entries_by_id: dict[str, dict[str, Any]] = {}
    if not isinstance(registry, dict) or registry.get("schemaVersion") != 1:
        invalid_entries.append("registry schemaVersion must be 1")
        registry = {}
    if registry.get("taxonomyVersion") != 1:
        invalid_entries.append("registry taxonomyVersion must be 1")
    max_lifetime = registry.get("maxLifetimeDays")
    if not isinstance(max_lifetime, int) or not 0 < max_lifetime <= 14:
        invalid_entries.append("registry maxLifetimeDays must be between 1 and 14")
        max_lifetime = 14

    entries = registry.get("entries") or []
    if not isinstance(entries, list):
        invalid_entries.append("registry entries must be a list")
        entries = []
    for index, entry in enumerate(entries):
        label = f"entry {index}"
        if not isinstance(entry, dict):
            invalid_entries.append(f"{label}: must be an object")
            continue
        missing = sorted(REQUIRED_ENTRY_FIELDS - set(entry))
        if missing:
            invalid_entries.append(f"{label}: missing metadata {missing}")
            continue
        if not isinstance(entry["groupHierarchy"], list) or not all(
            isinstance(group, str) and group for group in entry["groupHierarchy"]
        ):
            invalid_entries.append(f"{label}: invalid groupHierarchy")
            continue
        scalar_fields = REQUIRED_ENTRY_FIELDS - {"groupHierarchy"}
        if any(not isinstance(entry[field], str) or not entry[field] for field in scalar_fields):
            invalid_entries.append(f"{label}: metadata must contain non-empty strings")
            continue
        if any(
            _has_wildcard(value)
            for value in [entry["file"], entry["testName"], *entry["groupHierarchy"]]
        ):
            invalid_entries.append(f"{label}: wildcard identities are forbidden")
        if not entry["file"].startswith("test/"):
            invalid_entries.append(f"{label}: file must be repository-relative under test/")
        if entry["normalizedCategory"] not in ALLOWED_CATEGORIES:
            invalid_entries.append(f"{label}: unknown normalized category")
        try:
            created = date.fromisoformat(entry["created"])
            expires = date.fromisoformat(entry["expires"])
            lifetime = (expires - created).days
            if lifetime < 0 or lifetime > min(max_lifetime, 14):
                invalid_entries.append(f"{label}: quarantine lifetime exceeds 14 days")
            if evaluated_on > expires:
                invalid_entries.append(f"{label}: expired on {expires.isoformat()}")
        except ValueError:
            invalid_entries.append(f"{label}: created/expires must be ISO dates")
        identity = _entry_identity(entry)
        if identity in entries_by_id:
            invalid_entries.append(f"{label}: duplicate identity {identity}")
        entries_by_id[identity] = entry
        if identity in locked_ids or entry["file"] in locked_files:
            # Recorded separately below, but invalid regardless of run outcome.
            pass

    substantive = run.substantive
    checkout_suite_files = {
        path.relative_to(mobile_root).as_posix()
        for path in (mobile_root / "test").rglob("*_test.dart")
        if path.is_file()
    }
    missing_suites = sorted(checkout_suite_files - run.suite_files)
    unknown_suites = sorted(run.suite_files - checkout_suite_files)
    if missing_suites:
        stream_errors.append(f"checkout test suites not enumerated: {missing_suites}")
    if unknown_suites:
        stream_errors.append(f"machine suites absent from checkout: {unknown_suites}")
    all_by_id = {test.identity: test for test in substantive}
    observed_failures = {
        test.identity: test
        for test in run.tests
        if not test.skipped and test.result not in {"success"}
    }
    observed_skips = {test.identity for test in substantive if test.skipped}

    if len(all_by_id) != len(substantive):
        stream_errors.append("duplicate stable test identity in machine stream")
    if observed_failures and flutter_status == 0:
        stream_errors.append("Flutter returned zero despite observed failures")
    if not observed_failures and flutter_status != 0:
        stream_errors.append("Flutter returned non-zero without an observed failure")
    if run.done_success is True and observed_failures:
        stream_errors.append("machine done event reports success despite failures")
    if run.done_success is False and not observed_failures:
        stream_errors.append("machine done event reports failure without failing tests")

    new_failures: list[dict[str, Any]] = []
    category_changes: list[dict[str, Any]] = []
    matched: list[dict[str, Any]] = []
    for identity, test in sorted(observed_failures.items()):
        actual = normalized_category(test)
        entry = entries_by_id.get(identity)
        observed = {
            "id": identity,
            "result": test.result,
            "normalizedCategory": actual,
        }
        if entry is None:
            new_failures.append(observed)
        elif entry["normalizedCategory"] != actual:
            category_changes.append(
                {
                    **observed,
                    "expectedCategory": entry["normalizedCategory"],
                }
            )
        else:
            matched.append(observed)

    registry_ids = set(entries_by_id)
    observed_ids = set(observed_failures)
    missing_tests = sorted(identity for identity in registry_ids if identity not in all_by_id)
    disappeared = sorted(
        identity
        for identity in registry_ids
        if identity in all_by_id and identity not in observed_ids
    )
    locked_overlaps = sorted(
        identity
        for identity, entry in entries_by_id.items()
        if identity in locked_ids
        or entry.get("file") in locked_files
        or entry.get("contractRef") == "NAV-CONTRACT-001"
        or entry.get("classification") == "NAVIGATION_CONTRACT"
    )

    allowed_skip_entries = registry.get("allowedSkips") or []
    allowed_skip_ids: set[str] = set()
    if not isinstance(allowed_skip_entries, list):
        invalid_entries.append("allowedSkips must be a list")
        allowed_skip_entries = []
    for index, skip in enumerate(allowed_skip_entries):
        if not isinstance(skip, dict):
            invalid_entries.append(f"allowed skip {index}: must be an object")
            continue
        required = {"file", "groupHierarchy", "testName", "reason", "ticket", "owner"}
        if required - set(skip):
            invalid_entries.append(f"allowed skip {index}: missing metadata")
            continue
        if (
            not isinstance(skip["groupHierarchy"], list)
            or not all(isinstance(group, str) and group for group in skip["groupHierarchy"])
            or any(
                not isinstance(skip[field], str) or not skip[field]
                for field in required - {"groupHierarchy"}
            )
        ):
            invalid_entries.append(f"allowed skip {index}: invalid metadata")
            continue
        if any(
            _has_wildcard(value)
            for value in [skip["file"], skip["testName"], *skip["groupHierarchy"]]
        ):
            invalid_entries.append(f"allowed skip {index}: wildcard identity")
            continue
        identity = stable_id(skip["file"], skip["groupHierarchy"], skip["testName"])
        if identity in allowed_skip_ids:
            invalid_entries.append(f"allowed skip {index}: duplicate identity")
        allowed_skip_ids.add(identity)
    unexpected_skips = sorted(observed_skips - allowed_skip_ids)
    missing_expected_skips = sorted(allowed_skip_ids - observed_skips)

    decision: dict[str, Any] = {
        "schemaVersion": 1,
        "evaluatedOn": evaluated_on.isoformat(),
        "passed": False,
        "observed": {
            "tests": len(substantive),
            "testSuites": len(run.suite_files),
            "checkoutTestSuites": len(checkout_suite_files),
            "failures": len(observed_failures),
            "skips": len(observed_skips),
            "flutterStatus": flutter_status,
            "doneSuccess": run.done_success,
        },
        "matchedQuarantines": matched,
        "newFailures": new_failures,
        "categoryChanges": category_changes,
        "disappearedFailures": disappeared,
        "missingTests": missing_tests,
        "invalidEntries": invalid_entries,
        "lockedOverlaps": locked_overlaps,
        "unexpectedSkips": unexpected_skips,
        "missingExpectedSkips": missing_expected_skips,
        "streamErrors": stream_errors,
        "normalizedResults": [
            {
                "id": test.identity,
                "result": test.result,
                "skipped": test.skipped,
                "normalizedCategory": (
                    normalized_category(test) if test.result != "success" else None
                ),
            }
            for test in substantive
        ],
    }
    blockers = [
        new_failures,
        category_changes,
        disappeared,
        missing_tests,
        invalid_entries,
        locked_overlaps,
        unexpected_skips,
        missing_expected_skips,
        stream_errors,
    ]
    decision["passed"] = not any(blockers)
    return decision


def _run_git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    )
    return completed.stdout.strip()


def verify_identity(
    *,
    parent_root: Path,
    mobile_root: Path,
    expected_parent: str | None,
    include_toolchain: bool,
    expected_flutter: str | None = None,
    expected_dart: str | None = None,
) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    parent_sha = _run_git(parent_root, "rev-parse", "HEAD")
    tree = _run_git(parent_root, "ls-tree", "HEAD", "mobile").split()
    mobile_sha = _run_git(mobile_root, "rev-parse", "HEAD")
    parent_status = _run_git(parent_root, "status", "--porcelain=v1")
    mobile_status = _run_git(mobile_root, "status", "--porcelain=v1")
    gitlink_mode = tree[0] if len(tree) >= 3 else None
    gitlink_sha = tree[2] if len(tree) >= 3 else None
    if expected_parent and parent_sha != expected_parent:
        errors.append(f"parent HEAD {parent_sha} != event SHA {expected_parent}")
    if gitlink_mode != "160000":
        errors.append(f"mobile tree mode is {gitlink_mode}, expected 160000")
    if gitlink_sha != mobile_sha:
        errors.append(f"mobile HEAD {mobile_sha} != parent gitlink {gitlink_sha}")
    if parent_status:
        errors.append(f"parent worktree/index is dirty: {parent_status}")
    if mobile_status:
        errors.append(f"mobile worktree/index is dirty: {mobile_status}")
    receipt: dict[str, Any] = {
        "parentSha": parent_sha,
        "mobileGitlink": gitlink_sha,
        "mobileHead": mobile_sha,
        "gitlinkMode": gitlink_mode,
        "githubRunId": os.environ.get("GITHUB_RUN_ID"),
        "githubRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "githubEventSha": expected_parent,
    }
    if include_toolchain:
        flutter = subprocess.run(
            ["flutter", "--version", "--machine"],
            check=True,
            capture_output=True,
            text=True,
        )
        dart = subprocess.run(
            ["dart", "--version"], check=True, capture_output=True, text=True
        )
        receipt["flutter"] = json.loads(flutter.stdout)
        receipt["dartVersion"] = (dart.stdout or dart.stderr).strip()
        actual_flutter = receipt["flutter"].get("frameworkVersion")
        if expected_flutter and actual_flutter != expected_flutter:
            errors.append(
                f"Flutter {actual_flutter} != pinned version {expected_flutter}"
            )
        if expected_dart and f"Dart SDK version: {expected_dart} " not in receipt["dartVersion"]:
            errors.append(
                f"Dart receipt does not contain pinned version {expected_dart}"
            )
    return receipt, errors


def run_locked_contracts(
    *, manifest_path: Path, mobile_root: Path, results_dir: Path
) -> dict[str, Any]:
    manifest, config_errors = _load_locked_manifest(manifest_path)
    results_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(manifest_path, results_dir / "locked-contracts.json")
    unit_results: list[dict[str, Any]] = []
    errors = list(config_errors)
    for index, unit in enumerate(manifest.get("units") or []):
        if not isinstance(unit, dict):
            continue
        file = unit.get("file", "")
        slug = f"{index:02d}-" + file.replace("/", "-").replace(".dart", "")
        log_path = results_dir / f"{slug}.jsonl"
        command = [
            "flutter",
            "test",
            "--no-pub",
            "--machine",
            "--concurrency=1",
            file,
        ]
        if unit.get("mode") == "exact":
            command.extend(["--plain-name", unit.get("plainName", "")])
        with log_path.open("w", encoding="utf-8") as output:
            completed = subprocess.run(
                command,
                cwd=mobile_root,
                stdout=output,
                stderr=subprocess.STDOUT,
                check=False,
                text=True,
            )
        run = load_machine_run(log_path, mobile_root)
        substantive = run.substantive
        observed_ids = {test.identity for test in substantive}
        failures = [
            test.identity
            for test in run.tests
            if test.result != "success" and not test.skipped
        ]
        skips = [test.identity for test in substantive if test.skipped]
        unit_errors = list(run.stream_errors)
        if completed.returncode != 0:
            unit_errors.append(f"Flutter exit status {completed.returncode}")
        if failures:
            unit_errors.append(f"locked failures: {failures}")
        if skips:
            unit_errors.append(f"unexpected locked skips: {skips}")
        if unit.get("mode") == "exact":
            expected = set(unit.get("expectedIds") or [])
            if observed_ids != expected:
                unit_errors.append(
                    f"exact ID mismatch expected={sorted(expected)} observed={sorted(observed_ids)}"
                )
        else:
            expected_count = unit.get("expectedTestCount")
            expected_digest = unit.get("expectedIdsSha256")
            observed_digest = _ids_sha256(observed_ids)
            if len(observed_ids) != expected_count:
                unit_errors.append(
                    f"test count {len(observed_ids)} != expected {expected_count}"
                )
            if observed_digest != expected_digest:
                unit_errors.append(
                    f"ID digest {observed_digest} != expected {expected_digest}"
                )
        errors.extend(f"unit {index}: {error}" for error in unit_errors)
        normalized_path = results_dir / f"{slug}.normalized.json"
        normalized_path.write_text(
            json.dumps(
                {
                    "file": file,
                    "mode": unit.get("mode"),
                    "command": command,
                    "flutterStatus": completed.returncode,
                    "observedIds": sorted(observed_ids),
                    "observedIdsSha256": _ids_sha256(observed_ids),
                    "failures": failures,
                    "skips": skips,
                    "streamErrors": run.stream_errors,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        unit_results.append(
            {
                "file": file,
                "mode": unit.get("mode"),
                "observedTestCount": len(observed_ids),
                "observedIdsSha256": _ids_sha256(observed_ids),
                "passed": not unit_errors,
            }
        )
    summary = {
        "schemaVersion": 1,
        "passed": not errors,
        "manifest": str(manifest_path),
        "units": unit_results,
        "errors": errors,
    }
    (results_dir / "locked-contract-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary


def _write_full_outputs(
    decision: dict[str, Any],
    output_dir: Path,
    registry_path: Path,
    locked_manifest_path: Path,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    normalized = decision.pop("normalizedResults")
    (output_dir / "full-suite-normalized.json").write_text(
        json.dumps(normalized, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "quarantine-decision.json").write_text(
        json.dumps(decision, indent=2) + "\n", encoding="utf-8"
    )
    shutil.copyfile(registry_path, output_dir / "quarantine-registry.yaml")
    shutil.copyfile(locked_manifest_path, output_dir / "locked-contracts.json")
    observed = decision["observed"]
    summary = [
        f"passed: {decision['passed']}",
        f"tests: {observed['tests']}",
        f"failures: {observed['failures']}",
        f"skips: {observed['skips']}",
        f"matched quarantines: {len(decision['matchedQuarantines'])}",
    ]
    for key in (
        "newFailures",
        "categoryChanges",
        "disappearedFailures",
        "missingTests",
        "invalidEntries",
        "lockedOverlaps",
        "unexpectedSkips",
        "missingExpectedSkips",
        "streamErrors",
    ):
        summary.append(f"{key}: {len(decision[key])}")
    (output_dir / "full-suite-summary.txt").write_text(
        "\n".join(summary) + "\n", encoding="utf-8"
    )


def write_hash_manifest(root: Path, output: Path) -> None:
    root = root.resolve()
    output_resolved = output.resolve()
    lines: list[str] = []
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        if path.resolve() == output_resolved:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {path.relative_to(root).as_posix()}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    evaluate = subparsers.add_parser("evaluate-full")
    evaluate.add_argument("--machine-log", type=Path, required=True)
    evaluate.add_argument("--flutter-status", type=int, required=True)
    evaluate.add_argument("--registry", type=Path, required=True)
    evaluate.add_argument("--locked-manifest", type=Path, required=True)
    evaluate.add_argument("--mobile-root", type=Path, required=True)
    evaluate.add_argument("--evaluated-on", type=date.fromisoformat, required=True)
    evaluate.add_argument("--output-dir", type=Path, required=True)

    identity = subparsers.add_parser("verify-identity")
    identity.add_argument("--parent-root", type=Path, required=True)
    identity.add_argument("--mobile-root", type=Path, required=True)
    identity.add_argument("--expected-parent")
    identity.add_argument("--include-toolchain", action="store_true")
    identity.add_argument("--expected-flutter")
    identity.add_argument("--expected-dart")
    identity.add_argument("--output", type=Path, required=True)

    locked = subparsers.add_parser("run-locked")
    locked.add_argument("--manifest", type=Path, required=True)
    locked.add_argument("--mobile-root", type=Path, required=True)
    locked.add_argument("--results-dir", type=Path, required=True)

    hashes = subparsers.add_parser("hash-results")
    hashes.add_argument("--root", type=Path, required=True)
    hashes.add_argument("--output", type=Path, required=True)

    args = parser.parse_args(argv)
    if args.command == "evaluate-full":
        decision = evaluate_full_suite(
            machine_log=args.machine_log,
            flutter_status=args.flutter_status,
            registry_path=args.registry,
            locked_manifest_path=args.locked_manifest,
            mobile_root=args.mobile_root,
            evaluated_on=args.evaluated_on,
        )
        _write_full_outputs(
            decision,
            args.output_dir,
            args.registry,
            args.locked_manifest,
        )
        print(json.dumps(decision, indent=2))
        return 0 if decision["passed"] else 1
    if args.command == "verify-identity":
        receipt, errors = verify_identity(
            parent_root=args.parent_root,
            mobile_root=args.mobile_root,
            expected_parent=args.expected_parent,
            include_toolchain=args.include_toolchain,
            expected_flutter=args.expected_flutter,
            expected_dart=args.expected_dart,
        )
        receipt["errors"] = errors
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(receipt, indent=2))
        return 0 if not errors else 1
    if args.command == "hash-results":
        write_hash_manifest(args.root, args.output)
        return 0
    summary = run_locked_contracts(
        manifest_path=args.manifest,
        mobile_root=args.mobile_root,
        results_dir=args.results_dir,
    )
    print(json.dumps(summary, indent=2))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
