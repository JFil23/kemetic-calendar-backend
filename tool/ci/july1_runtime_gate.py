#!/usr/bin/env python3
"""Exact July 1 recovery runtime and full-suite authority evaluator.

This gate is intentionally separate from the post-July-1 locked/quarantine
authority.  A July 1 accepted failure is always reported as
``ACCEPTED_BASELINE_DEBT``; it is never promoted to PASS or LOCKED.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


EXPECTED_PROFILE_STATUS = "ACTIVE_EXACT_RECOVERY_RUNTIME"
EXPECTED_DEBT_CLASSIFICATION = "ACCEPTED_BASELINE_DEBT"
EXPECTED_EXECUTION_TIME_ZONE = "America/Los_Angeles"
EXPECTED_TIME_ZONE_CLASSIFICATION = "HISTORICAL_FIXTURE_ENVIRONMENT_BINDING"
EXPECTED_TIME_ZONE_TEST_ID = (
    "test/features/calendar/the_days_outside_year_flow_test.dart :: "
    "enrollment window is M12 D28 through before M13 D1"
)
EXPECTED_TIME_ZONE_TICKET = "TIMEZONE-DETERMINISM-001"
EXPECTED_TIME_ZONE_FIX_COMMIT = "f0a56d83b269532d84ff66ce81d27001f0870c52"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

EXPECTED_CONTROL_PATHS = {
    ".gitignore",
    "README.md",
    "config/web/cloudflare-served-contract.v1.json",
    "config/web/environment-delta-contract.v1.json",
    "config/web/icons/staging/Icon-192.png",
    "config/web/icons/staging/Icon-512.png",
    "config/web/icons/staging/Icon-maskable-192.png",
    "config/web/icons/staging/Icon-maskable-512.png",
    "config/web/production.public.json",
    "config/web/staging.public.json",
    "docs/web_release_build_contract.md",
    "launch-p0-verification.md",
    "scripts/build_web_release.sh",
    "scripts/deploy_cloudflare_pages.sh",
    "scripts/served_artifact_verifier.py",
    "scripts/served_artifact_verifier_test.py",
    "scripts/web_release_pipeline.py",
    "scripts/web_release_pipeline_test.py",
    "test/core/web_runtime_config_guard_test.dart",
}

AUTHORITY_PROFILE_PATH = "ci/runtime-authority/july1-recovery.v1.json"
MOBILE_GITLINK_PATH = "mobile"
GENERATED_PUB_GET_PATH = ".flutter-plugins-dependencies"
EXPECTED_PARENT_DELETED_PATHS = {
    "ci/locked-contracts.json",
    "ci/quarantine-registry.yaml",
}
EXPECTED_PARENT_HASHED_PATHS = {
    ".github/workflows/mobile.yml",
    "ci/LOCK_GATE.md",
    "ci/superseded/README.md",
    "ci/superseded/locked-contracts.post-july1.242.json",
    "ci/superseded/quarantine-registry.post-july1.7.json",
    "tool/ci/july1_runtime_gate.py",
    "tool/ci/test_july1_runtime_gate.py",
}
EXPECTED_PARENT_DELTA_PATHS = {
    *EXPECTED_PARENT_DELETED_PATHS,
    *EXPECTED_PARENT_HASHED_PATHS,
    AUTHORITY_PROFILE_PATH,
    MOBILE_GITLINK_PATH,
}

EVALUATOR_CATEGORIES = {
    "assertion-mismatch",
    "pending-timer",
    "guard-allowlist-violation",
    "environment-layout",
    "missing-hermetic-fixture",
    "timeout",
    "compile-error",
    "uncaught-runtime-error",
}


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _sorted_digest(values: list[str] | set[str]) -> str:
    payload = "".join(f"{value}\n" for value in sorted(values))
    return _sha256_bytes(payload.encode("utf-8"))


def _path_sha256_digest(entries: list[dict[str, Any]]) -> str:
    pairs = {
        (entry.get("path"), entry.get("sha256"))
        for entry in entries
        if isinstance(entry, dict)
        and isinstance(entry.get("path"), str)
        and isinstance(entry.get("sha256"), str)
    }
    payload = "".join(f"{path}\t{digest}\n" for path, digest in sorted(pairs))
    return _sha256_bytes(payload.encode("utf-8"))


def _canonical_flutter_metadata(value: Any) -> tuple[Any, list[str]]:
    invalid: list[str] = []

    def visit(child: Any, field: str | None = None) -> Any:
        if isinstance(child, dict):
            canonical: dict[str, Any] = {}
            for key, nested in sorted(child.items()):
                if key == "date_created":
                    if not isinstance(nested, str):
                        invalid.append("date_created is not a string")
                    else:
                        try:
                            datetime.fromisoformat(nested)
                        except ValueError:
                            invalid.append(
                                f"date_created is not ISO-8601: {nested!r}"
                            )
                    canonical[key] = "<generated-timestamp>"
                else:
                    canonical[key] = visit(nested, key)
            return canonical
        if isinstance(child, list):
            return [visit(nested, field) for nested in child]
        if field == "path" and isinstance(child, str):
            normalized = child.replace("\\", "/")
            if not normalized.startswith("/"):
                invalid.append(f"plugin path is not absolute: {child!r}")
                return f"<invalid>:{child}"
            hosted_marker = "/hosted/pub.dev/"
            sdk_marker = "/packages/"
            if hosted_marker in normalized:
                suffix = normalized.split(hosted_marker, 1)[1].strip("/")
                if not suffix or "/" in suffix:
                    invalid.append(f"hosted plugin path has invalid suffix: {child!r}")
                return f"hosted:{suffix}"
            if sdk_marker in normalized:
                suffix = normalized.split(sdk_marker, 1)[1].strip("/")
                if not suffix or "/" in suffix:
                    invalid.append(f"Flutter SDK plugin path has invalid suffix: {child!r}")
                return f"sdk-package:{suffix}"
            invalid.append(
                "plugin path is outside hosted/pub.dev and Flutter packages: "
                f"{child!r}"
            )
            return f"<invalid>:{child}"
        return child

    return visit(value), invalid


def _is_hex40(value: Any) -> bool:
    return isinstance(value, str) and HEX40.fullmatch(value) is not None


def _is_hex64(value: Any) -> bool:
    return isinstance(value, str) and HEX64.fullmatch(value) is not None


def _safe_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = Path(value)
    return not path.is_absolute() and ".." not in path.parts


def stable_id(file: str, groups: list[str], test_name: str) -> str:
    return " :: ".join([file, *groups, test_name])


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


def _run_git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=check,
        capture_output=True,
        text=True,
    )


def _git_text(cwd: Path, *args: str) -> str:
    return _run_git(cwd, *args).stdout.strip()


def _git_object_exists(cwd: Path, revision: str) -> bool:
    return _run_git(cwd, "cat-file", "-e", revision, check=False).returncode == 0


def _git_is_ancestor(cwd: Path, ancestor: str, descendant: str) -> bool:
    return (
        _run_git(
            cwd,
            "merge-base",
            "--is-ancestor",
            ancestor,
            descendant,
            check=False,
        ).returncode
        == 0
    )


def _git_tree_entry(cwd: Path, revision: str, path: str) -> tuple[str, str, str] | None:
    line = _git_text(cwd, "ls-tree", revision, "--", path)
    if not line:
        return None
    metadata, observed_path = line.split("\t", 1)
    parts = metadata.split()
    if len(parts) != 3 or observed_path != path:
        return None
    return parts[0], parts[1], parts[2]


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _required_object(
    container: dict[str, Any], key: str, errors: list[str]
) -> dict[str, Any]:
    value = container.get(key)
    if not isinstance(value, dict):
        errors.append(f"{key} must be an object")
        return {}
    return value


def load_profile(path: Path) -> tuple[dict[str, Any], list[str]]:
    """Load and strictly validate all authority-bearing profile fields."""

    errors: list[str] = []
    try:
        raw = _load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        return {}, [f"profile cannot be read: {error}"]
    if not isinstance(raw, dict):
        return {}, ["profile must be an object"]
    if raw.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")
    if not isinstance(raw.get("profileId"), str) or not raw["profileId"]:
        errors.append("profileId must be a non-empty string")
    if raw.get("status") != EXPECTED_PROFILE_STATUS:
        errors.append(f"status must be {EXPECTED_PROFILE_STATUS}")

    identity = _required_object(raw, "identity", errors)
    for field in (
        "parentAuthorityBaseCommit",
        "currentMobileBaseCommit",
        "historicalMobileCommit",
        "authorizedForwardCommit",
        "mergedMobileCommit",
        "mobileTree",
        "libTree",
        "testTree",
    ):
        if not _is_hex40(identity.get(field)):
            errors.append(f"identity.{field} must be a lowercase 40-hex value")
    if not _is_hex64(identity.get("pubspecLockSha256")):
        errors.append("identity.pubspecLockSha256 must be a lowercase SHA-256")
    for field in ("flutterVersion", "dartVersion"):
        if not isinstance(identity.get(field), str) or not identity[field]:
            errors.append(f"identity.{field} must be a non-empty string")

    overlay = _required_object(raw, "controlOverlay", errors)
    paths = overlay.get("paths")
    seen_paths: set[str] = set()
    if not isinstance(paths, list):
        errors.append("controlOverlay.paths must be a list")
        paths = []
    for index, entry in enumerate(paths):
        if not isinstance(entry, dict):
            errors.append(f"controlOverlay.paths[{index}] must be an object")
            continue
        path_value = entry.get("path")
        if not _safe_relative_path(path_value):
            errors.append(f"controlOverlay.paths[{index}].path is invalid")
            continue
        if path_value in seen_paths:
            errors.append(f"controlOverlay.paths contains duplicate {path_value}")
        seen_paths.add(path_value)
        if not isinstance(entry.get("class"), str) or not entry["class"]:
            errors.append(f"controlOverlay.paths[{index}].class is invalid")
        if not _is_hex64(entry.get("sha256")):
            errors.append(f"controlOverlay.paths[{index}].sha256 is invalid")
    if seen_paths != EXPECTED_CONTROL_PATHS:
        errors.append(
            "controlOverlay.paths exact set mismatch: "
            f"missing={sorted(EXPECTED_CONTROL_PATHS - seen_paths)} "
            f"extra={sorted(seen_paths - EXPECTED_CONTROL_PATHS)}"
        )
    expected_path_digest = _path_sha256_digest(paths)
    if overlay.get("sortedPathSha256Digest") != expected_path_digest:
        errors.append(
            "controlOverlay.sortedPathSha256Digest does not bind the exact "
            "19 path/SHA-256 pairs"
        )

    parent_delta = _required_object(raw, "parentDelta", errors)
    if parent_delta.get("baseCommit") != identity.get("parentAuthorityBaseCommit"):
        errors.append(
            "parentDelta.baseCommit must equal "
            "identity.parentAuthorityBaseCommit"
        )
    if parent_delta.get("mobileGitlinkPath") != MOBILE_GITLINK_PATH:
        errors.append(f"parentDelta.mobileGitlinkPath must be {MOBILE_GITLINK_PATH}")
    if parent_delta.get("selfValidatedPath") != AUTHORITY_PROFILE_PATH:
        errors.append(
            f"parentDelta.selfValidatedPath must be {AUTHORITY_PROFILE_PATH}"
        )
    exact_paths = parent_delta.get("exactPaths")
    if not isinstance(exact_paths, list) or not all(
        _safe_relative_path(path) for path in exact_paths
    ):
        errors.append("parentDelta.exactPaths must be safe relative paths")
        exact_path_set: set[str] = set()
    else:
        exact_path_set = set(exact_paths)
        if len(exact_path_set) != len(exact_paths):
            errors.append("parentDelta.exactPaths contains duplicates")
    if exact_path_set != EXPECTED_PARENT_DELTA_PATHS:
        errors.append(
            "parentDelta.exactPaths exact set mismatch: "
            f"missing={sorted(EXPECTED_PARENT_DELTA_PATHS - exact_path_set)} "
            f"extra={sorted(exact_path_set - EXPECTED_PARENT_DELTA_PATHS)}"
        )
    deleted_paths = parent_delta.get("deletedPaths")
    if not isinstance(deleted_paths, list) or not all(
        _safe_relative_path(path) for path in deleted_paths
    ):
        errors.append("parentDelta.deletedPaths must be safe relative paths")
        deleted_path_set: set[str] = set()
    else:
        deleted_path_set = set(deleted_paths)
        if len(deleted_path_set) != len(deleted_paths):
            errors.append("parentDelta.deletedPaths contains duplicates")
    if deleted_path_set != EXPECTED_PARENT_DELETED_PATHS:
        errors.append(
            "parentDelta.deletedPaths exact set mismatch: "
            f"missing={sorted(EXPECTED_PARENT_DELETED_PATHS - deleted_path_set)} "
            f"extra={sorted(deleted_path_set - EXPECTED_PARENT_DELETED_PATHS)}"
        )
    parent_files = parent_delta.get("files")
    parent_file_paths: set[str] = set()
    if not isinstance(parent_files, list):
        errors.append("parentDelta.files must be a list")
        parent_files = []
    for index, entry in enumerate(parent_files):
        if not isinstance(entry, dict):
            errors.append(f"parentDelta.files[{index}] must be an object")
            continue
        path_value = entry.get("path")
        if not _safe_relative_path(path_value):
            errors.append(f"parentDelta.files[{index}].path is invalid")
            continue
        if path_value in parent_file_paths:
            errors.append(f"parentDelta.files contains duplicate {path_value}")
        parent_file_paths.add(path_value)
        if not _is_hex64(entry.get("sha256")):
            errors.append(f"parentDelta.files[{index}].sha256 is invalid")
    if parent_file_paths != EXPECTED_PARENT_HASHED_PATHS:
        errors.append(
            "parentDelta.files exact set mismatch: "
            f"missing={sorted(EXPECTED_PARENT_HASHED_PATHS - parent_file_paths)} "
            f"extra={sorted(parent_file_paths - EXPECTED_PARENT_HASHED_PATHS)}"
        )
    expected_parent_digest = _path_sha256_digest(parent_files)
    if parent_delta.get("sortedPathSha256Digest") != expected_parent_digest:
        errors.append(
            "parentDelta.sortedPathSha256Digest does not bind the exact "
            "parent path/SHA-256 pairs"
        )

    generated_metadata = _required_object(raw, "generatedMetadata", errors)
    if generated_metadata.get("path") != GENERATED_PUB_GET_PATH:
        errors.append(f"generatedMetadata.path must be {GENERATED_PUB_GET_PATH}")
    for field in ("committedSha256", "canonicalSha256"):
        if not _is_hex64(generated_metadata.get(field)):
            errors.append(
                f"generatedMetadata.{field} must be a lowercase SHA-256"
            )
    if generated_metadata.get("permittedVolatileFields") != [
        "date_created",
        "absolute plugin path roots",
    ]:
        errors.append(
            "generatedMetadata.permittedVolatileFields must name only the "
            "timestamp and absolute plugin path roots"
        )

    execution_environment = _required_object(raw, "executionEnvironment", errors)
    expected_execution_environment = {
        "timeZone": EXPECTED_EXECUTION_TIME_ZONE,
        "classification": EXPECTED_TIME_ZONE_CLASSIFICATION,
        "affectedTestId": EXPECTED_TIME_ZONE_TEST_ID,
        "ticket": EXPECTED_TIME_ZONE_TICKET,
        "laterTestOnlyFixCommit": EXPECTED_TIME_ZONE_FIX_COMMIT,
    }
    for field, expected in expected_execution_environment.items():
        if execution_environment.get(field) != expected:
            errors.append(f"executionEnvironment.{field} must be {expected!r}")
    policy = execution_environment.get("policy")
    if not isinstance(policy, str) or not policy:
        errors.append("executionEnvironment.policy must be a non-empty string")

    inventory = _required_object(raw, "testInventory", errors)
    count_fields = (
        "suiteFileCount",
        "substantiveCount",
        "expectedPassCount",
        "expectedAcceptedDebtCount",
        "expectedOwnedSkipCount",
    )
    for field in count_fields:
        value = inventory.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            errors.append(f"testInventory.{field} must be a non-negative integer")
    digest_fields = (
        "suiteFilesSha256",
        "stableIdsSha256",
        "passingIdsSha256",
        "acceptedDebtIdsSha256",
        "ownedSkipIdsSha256",
    )
    for field in digest_fields:
        if not _is_hex64(inventory.get(field)):
            errors.append(f"testInventory.{field} must be a lowercase SHA-256")

    accepted_debt = raw.get("acceptedDebt")
    debt_ids: set[str] = set()
    if not isinstance(accepted_debt, list):
        errors.append("acceptedDebt must be a list")
        accepted_debt = []
    for index, entry in enumerate(accepted_debt):
        if not isinstance(entry, dict):
            errors.append(f"acceptedDebt[{index}] must be an object")
            continue
        required = {
            "id",
            "historicalCategory",
            "evaluatorCategory",
            "classification",
            "ticket",
            "owner",
        }
        if required - set(entry):
            errors.append(
                f"acceptedDebt[{index}] missing {sorted(required - set(entry))}"
            )
            continue
        if any(not isinstance(entry[field], str) or not entry[field] for field in required):
            errors.append(f"acceptedDebt[{index}] fields must be non-empty strings")
            continue
        identity_value = entry["id"]
        if identity_value in debt_ids:
            errors.append(f"acceptedDebt contains duplicate ID {identity_value}")
        debt_ids.add(identity_value)
        if entry["classification"] != EXPECTED_DEBT_CLASSIFICATION:
            errors.append(
                f"acceptedDebt[{index}].classification must be "
                f"{EXPECTED_DEBT_CLASSIFICATION}"
            )
        if entry["evaluatorCategory"] not in EVALUATOR_CATEGORIES:
            errors.append(f"acceptedDebt[{index}].evaluatorCategory is unknown")

    owned_skips = raw.get("ownedSkips")
    skip_ids: set[str] = set()
    if not isinstance(owned_skips, list):
        errors.append("ownedSkips must be a list")
        owned_skips = []
    for index, entry in enumerate(owned_skips):
        if not isinstance(entry, dict):
            errors.append(f"ownedSkips[{index}] must be an object")
            continue
        required = {"id", "reason", "ticket", "owner"}
        if required - set(entry):
            errors.append(f"ownedSkips[{index}] missing {sorted(required - set(entry))}")
            continue
        if any(not isinstance(entry[field], str) or not entry[field] for field in required):
            errors.append(f"ownedSkips[{index}] fields must be non-empty strings")
            continue
        identity_value = entry["id"]
        if identity_value in skip_ids:
            errors.append(f"ownedSkips contains duplicate ID {identity_value}")
        skip_ids.add(identity_value)

    if debt_ids & skip_ids:
        errors.append(
            f"acceptedDebt and ownedSkips overlap: {sorted(debt_ids & skip_ids)}"
        )
    if EXPECTED_TIME_ZONE_TEST_ID in debt_ids:
        errors.append(
            "historical fixture-environment binding cannot enter acceptedDebt"
        )
    if inventory:
        if inventory.get("expectedAcceptedDebtCount") != len(debt_ids):
            errors.append("acceptedDebt count does not match testInventory")
        if inventory.get("acceptedDebtIdsSha256") != _sorted_digest(debt_ids):
            errors.append("acceptedDebt ID digest does not match testInventory")
        if inventory.get("expectedOwnedSkipCount") != len(skip_ids):
            errors.append("ownedSkips count does not match testInventory")
        if inventory.get("ownedSkipIdsSha256") != _sorted_digest(skip_ids):
            errors.append("ownedSkips ID digest does not match testInventory")
        counts = [
            inventory.get("expectedPassCount"),
            inventory.get("expectedAcceptedDebtCount"),
            inventory.get("expectedOwnedSkipCount"),
        ]
        if all(isinstance(value, int) and not isinstance(value, bool) for value in counts):
            if sum(counts) != inventory.get("substantiveCount"):
                errors.append(
                    "pass + accepted debt + owned skip counts must equal "
                    "substantiveCount"
                )

    superseded = _required_object(raw, "supersededAuthority", errors)
    if superseded.get("status") != "SUPERSEDED_LATER_RUNTIME_EVIDENCE":
        errors.append(
            "supersededAuthority.status must be "
            "SUPERSEDED_LATER_RUNTIME_EVIDENCE"
        )
    for prefix in ("lockedManifest", "registry"):
        path_field = f"{prefix}Path"
        sha_field = f"{prefix}Sha256"
        if not _safe_relative_path(superseded.get(path_field)):
            errors.append(f"supersededAuthority.{path_field} must be a safe path")
        if not _is_hex64(superseded.get(sha_field)):
            errors.append(
                f"supersededAuthority.{sha_field} must be a lowercase SHA-256"
            )
    for field in (
        "lockedVmTestCount",
        "lockedVmUnitCount",
        "processUnitCount",
    ):
        value = superseded.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            errors.append(
                f"supersededAuthority.{field} must be a non-negative integer"
            )
    later_files = superseded.get("laterRuntimeTestFiles")
    later_paths: set[str] = set()
    declared_absent_from_later: set[str] = set()
    if not isinstance(later_files, list):
        errors.append("supersededAuthority.laterRuntimeTestFiles must be a list")
        later_files = []
    for index, entry in enumerate(later_files):
        if (
            not isinstance(entry, dict)
            or not _safe_relative_path(entry.get("path"))
            or not entry.get("path", "").startswith("test/")
            or not entry.get("path", "").endswith("_test.dart")
            or not isinstance(entry.get("presentInJuly1"), bool)
        ):
            errors.append(
                f"supersededAuthority.laterRuntimeTestFiles[{index}] is invalid"
            )
            continue
        path_value = entry["path"]
        if path_value in later_paths:
            errors.append(
                "supersededAuthority.laterRuntimeTestFiles contains duplicate "
                f"{path_value}"
            )
        later_paths.add(path_value)
        if not entry["presentInJuly1"]:
            declared_absent_from_later.add(path_value)
    if len(later_paths) != 19:
        errors.append(
            "supersededAuthority.laterRuntimeTestFiles must contain exactly 19 paths"
        )
    absent_files = superseded.get("absentTestFiles")
    if not isinstance(absent_files, list) or not all(
        _safe_relative_path(path)
        and path.startswith("test/")
        and path.endswith("_test.dart")
        for path in absent_files
    ):
        errors.append("supersededAuthority.absentTestFiles must be safe paths")
        absent_set: set[str] = set()
    else:
        absent_set = set(absent_files)
        if len(absent_set) != len(absent_files):
            errors.append("supersededAuthority.absentTestFiles contains duplicates")
        if len(absent_set) != 10:
            errors.append(
                "supersededAuthority.absentTestFiles must contain exactly 10 paths"
            )
    if later_paths and absent_set != declared_absent_from_later:
        errors.append(
            "supersededAuthority.absentTestFiles must equal later runtime tests "
            "marked presentInJuly1=false"
        )
    process_harness = superseded.get("processHarness")
    if not isinstance(process_harness, dict):
        errors.append("supersededAuthority.processHarness must be an object")
    else:
        if not _safe_relative_path(process_harness.get("path")):
            errors.append(
                "supersededAuthority.processHarness.path must be a safe path"
            )
        if process_harness.get("presentInJuly1") is not False:
            errors.append(
                "supersededAuthority.processHarness.presentInJuly1 must be false"
            )

    evidence = _required_object(raw, "evidence", errors)
    for field in ("controlMachineLogSha256", "recoveryArchiveSha256"):
        if not _is_hex64(evidence.get(field)):
            errors.append(f"evidence.{field} must be a lowercase SHA-256")
    if (
        evidence.get("provenanceClassification")
        != "NON_AUTHORITATIVE_RECOVERY_EVIDENCE"
    ):
        errors.append(
            "evidence.provenanceClassification must explicitly remain "
            "NON_AUTHORITATIVE_RECOVERY_EVIDENCE"
        )
    for field in (
        "recoveryEvidenceParentCommit",
        "recoveryEvidenceMobileCommit",
        "localValidationCommit",
    ):
        if not _is_hex40(evidence.get(field)):
            errors.append(f"evidence.{field} must be a lowercase 40-hex value")

    return raw, errors


@dataclass(frozen=True)
class TestRecord:
    identity: str
    file: str
    groups: list[str]
    test_name: str
    full_name: str
    result: str
    skipped: bool
    skip_reason: str | None
    hidden: bool
    errors: list[dict[str, Any]]


@dataclass
class MachineRun:
    tests: list[TestRecord]
    suite_files: set[str]
    stream_errors: list[str]
    done_success: bool | None

    @property
    def substantive(self) -> list[TestRecord]:
        return [test for test in self.tests if not test.hidden]


def load_machine_run(path: Path, mobile_root: Path) -> MachineRun:
    events: list[dict[str, Any]] = []
    stream_errors: list[str] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        return MachineRun(
            tests=[],
            suite_files=set(),
            stream_errors=[f"machine log cannot be read: {error}"],
            done_success=None,
        )
    for line_number, raw in enumerate(lines, 1):
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
            continue
        if not isinstance(event, dict) or not isinstance(event.get("type"), str):
            stream_errors.append(f"line {line_number}: invalid machine event")
            continue
        events.append(event)

    starts = [event for event in events if event.get("type") == "start"]
    done = [event for event in events if event.get("type") == "done"]
    all_suites = [event for event in events if event.get("type") == "allSuites"]
    if len(starts) != 1:
        stream_errors.append(f"machine stream has {len(starts)} start events; expected 1")
    if len(done) != 1:
        stream_errors.append(f"machine stream has {len(done)} done events; expected 1")
    if len(all_suites) != 1:
        stream_errors.append(
            f"machine stream has {len(all_suites)} allSuites events; expected 1"
        )

    suites: dict[int, str] = {}
    groups: dict[int, str] = {}
    starts_by_id: dict[int, dict[str, Any]] = {}
    done_by_id: dict[int, list[dict[str, Any]]] = {}
    errors_by_id: dict[int, list[dict[str, Any]]] = {}
    suite_path_counts: dict[str, int] = {}

    for event in events:
        event_type = event.get("type")
        if event_type == "suite":
            suite = event.get("suite", {})
            suite_id = suite.get("id")
            suite_path = suite.get("path")
            if not isinstance(suite_id, int) or not isinstance(suite_path, str):
                stream_errors.append("suite event lacks integer id or string path")
                continue
            normalized = _normalize_suite_path(suite_path, mobile_root)
            if suite_id in suites:
                stream_errors.append(f"duplicate suite id {suite_id}")
            suites[suite_id] = normalized
            suite_path_counts[normalized] = suite_path_counts.get(normalized, 0) + 1
        elif event_type == "group":
            group = event.get("group", {})
            group_id = group.get("id")
            group_name = group.get("name")
            if isinstance(group_id, int) and isinstance(group_name, str):
                if group_id in groups:
                    stream_errors.append(f"duplicate group id {group_id}")
                groups[group_id] = group_name
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
            else:
                stream_errors.append("testDone without integer testID")
        elif event_type == "error":
            test_id = event.get("testID")
            if isinstance(test_id, int):
                errors_by_id.setdefault(test_id, []).append(event)

    duplicate_suite_paths = sorted(
        path_value for path_value, count in suite_path_counts.items() if count != 1
    )
    if duplicate_suite_paths:
        stream_errors.append(f"duplicate suite paths: {duplicate_suite_paths}")
    if len(all_suites) == 1 and all_suites[0].get("count") != len(suites):
        stream_errors.append(
            "allSuites count does not match observed suite events: "
            f"{all_suites[0].get('count')} != {len(suites)}"
        )

    records: list[TestRecord] = []
    for test_id, start in starts_by_id.items():
        completions = done_by_id.get(test_id, [])
        if len(completions) != 1:
            stream_errors.append(
                f"test id {test_id} has {len(completions)} testDone events; expected 1"
            )
            continue
        completion = completions[0]
        if completion.get("result") not in {"success", "failure", "error"}:
            stream_errors.append(
                f"test id {test_id} has invalid result {completion.get('result')!r}"
            )
        suite_id = start.get("suiteID")
        file = suites.get(suite_id, f"<unknown-suite:{suite_id}>")
        if file.startswith("<unknown-suite:"):
            stream_errors.append(f"test id {test_id} references unknown suite {suite_id}")
        group_ids = start.get("groupIDs") or []
        unknown_group_ids = [
            group_id
            for group_id in group_ids
            if not isinstance(group_id, int) or group_id not in groups
        ]
        hierarchy = [
            groups[group_id]
            for group_id in group_ids
            if isinstance(group_id, int) and groups.get(group_id, "")
        ]
        if unknown_group_ids:
            stream_errors.append(
                f"test id {test_id} references unknown groups {unknown_group_ids}"
            )
        full_name = str(start.get("name", ""))
        test_name = _leaf_name(full_name, hierarchy)
        metadata = start.get("metadata")
        skip_reason = (
            metadata.get("skipReason")
            if isinstance(metadata, dict) and isinstance(metadata.get("skipReason"), str)
            else None
        )
        records.append(
            TestRecord(
                identity=stable_id(file, hierarchy, test_name),
                file=file,
                groups=hierarchy,
                test_name=test_name,
                full_name=full_name,
                result=str(completion.get("result", "unknown")),
                skipped=bool(completion.get("skipped", False)),
                skip_reason=skip_reason,
                hidden=bool(completion.get("hidden", False)),
                errors=errors_by_id.get(test_id, []),
            )
        )

    orphan_done = sorted(set(done_by_id) - set(starts_by_id))
    if orphan_done:
        stream_errors.append(f"testDone events without testStart: {orphan_done}")
    orphan_errors = sorted(set(errors_by_id) - set(starts_by_id))
    if orphan_errors:
        stream_errors.append(f"error events without testStart: {orphan_errors}")

    return MachineRun(
        tests=records,
        suite_files=set(suites.values()),
        stream_errors=stream_errors,
        done_success=bool(done[0].get("success")) if len(done) == 1 else None,
    )


def normalized_category(test: TestRecord) -> str:
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


def verify_checkout(
    *,
    profile_path: Path,
    parent_root: Path,
    mobile_root: Path,
    expected_parent: str,
    include_toolchain: bool,
) -> dict[str, Any]:
    profile, errors = load_profile(profile_path)
    identity = profile.get("identity") if isinstance(profile.get("identity"), dict) else {}
    overlay = (
        profile.get("controlOverlay")
        if isinstance(profile.get("controlOverlay"), dict)
        else {}
    )
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "command": "verify-checkout",
        "profileId": profile.get("profileId"),
        "passed": False,
        "identity": {},
        "controlOverlay": {"paths": []},
        "errors": errors,
    }

    try:
        parent_sha = _git_text(parent_root, "rev-parse", "HEAD")
        parent_tree = _git_text(parent_root, "rev-parse", "HEAD^{tree}")
        gitlink_parts = _git_text(parent_root, "ls-tree", "HEAD", "mobile").split()
        gitlink_mode = gitlink_parts[0] if len(gitlink_parts) >= 3 else None
        gitlink_sha = gitlink_parts[2] if len(gitlink_parts) >= 3 else None
        mobile_sha = _git_text(mobile_root, "rev-parse", "HEAD")
        mobile_tree = _git_text(mobile_root, "rev-parse", "HEAD^{tree}")
        lib_tree = _git_text(mobile_root, "rev-parse", "HEAD:lib")
        test_tree = _git_text(mobile_root, "rev-parse", "HEAD:test")
        parent_status = _git_text(parent_root, "status", "--porcelain=v1")
        mobile_status = _git_text(mobile_root, "status", "--porcelain=v1")
    except (OSError, subprocess.CalledProcessError) as error:
        receipt["errors"].append(f"git checkout inspection failed: {error}")
        return receipt

    observed_identity = {
        "parentHead": parent_sha,
        "parentTree": parent_tree,
        "mobileGitlinkMode": gitlink_mode,
        "mobileGitlink": gitlink_sha,
        "mobileHead": mobile_sha,
        "mobileTree": mobile_tree,
        "libTree": lib_tree,
        "testTree": test_tree,
    }
    receipt["identity"] = observed_identity
    if not _is_hex40(expected_parent):
        receipt["errors"].append("expected-parent must be a lowercase 40-hex SHA")
    elif parent_sha != expected_parent:
        receipt["errors"].append(
            f"parent HEAD {parent_sha} != expected parent {expected_parent}"
        )
    if gitlink_mode != "160000":
        receipt["errors"].append(f"mobile gitlink mode {gitlink_mode} != 160000")
    if gitlink_sha != mobile_sha:
        receipt["errors"].append(
            f"mobile HEAD {mobile_sha} != parent gitlink {gitlink_sha}"
        )
    for field, observed in (
        ("mobileTree", mobile_tree),
        ("libTree", lib_tree),
        ("testTree", test_tree),
    ):
        if identity.get(field) != observed:
            receipt["errors"].append(
                f"{field} {observed} != profile {identity.get(field)}"
            )
    if parent_status:
        receipt["errors"].append(f"parent worktree/index is dirty: {parent_status}")
    if mobile_status:
        receipt["errors"].append(f"mobile worktree/index is dirty: {mobile_status}")

    parent_base = identity.get("parentAuthorityBaseCommit")
    if _is_hex40(parent_base):
        if not _git_object_exists(parent_root, f"{parent_base}^{{commit}}"):
            receipt["errors"].append(
                f"parent authority base commit {parent_base} is unavailable"
            )
        elif not _git_is_ancestor(parent_root, parent_base, parent_sha):
            receipt["errors"].append(
                f"parent authority base {parent_base} is not an ancestor of HEAD"
            )
        else:
            delta_lines = _git_text(
                parent_root,
                "diff",
                "--name-status",
                "--no-renames",
                f"{parent_base}..{parent_sha}",
            ).splitlines()
            observed_delta: dict[str, str] = {}
            for line in delta_lines:
                parts = line.split("\t")
                if len(parts) != 2 or parts[0] not in {"A", "D", "M", "T"}:
                    receipt["errors"].append(
                        f"unsupported parent delta record: {line!r}"
                    )
                    continue
                observed_delta[parts[1]] = parts[0]
            receipt["parentDelta"] = {
                "baseCommit": parent_base,
                "observedPaths": [
                    {"path": path, "status": observed_delta[path]}
                    for path in sorted(observed_delta)
                ],
                "files": [],
            }
            observed_delta_paths = set(observed_delta)
            if observed_delta_paths != EXPECTED_PARENT_DELTA_PATHS:
                receipt["errors"].append(
                    "parent delta exact path mismatch: "
                    f"missing={sorted(EXPECTED_PARENT_DELTA_PATHS - observed_delta_paths)} "
                    f"extra={sorted(observed_delta_paths - EXPECTED_PARENT_DELTA_PATHS)}"
                )
            for path in EXPECTED_PARENT_DELETED_PATHS:
                if observed_delta.get(path) != "D":
                    receipt["errors"].append(
                        f"parent delta must delete exact path: {path}"
                    )
                if (parent_root / path).exists():
                    receipt["errors"].append(
                        f"deleted parent authority path still exists: {path}"
                    )
                if _git_tree_entry(parent_root, parent_sha, path) is not None:
                    receipt["errors"].append(
                        f"deleted parent authority path remains in HEAD tree: {path}"
                    )
            parent_delta = (
                profile.get("parentDelta")
                if isinstance(profile.get("parentDelta"), dict)
                else {}
            )
            parent_file_entries = {
                entry["path"]: entry
                for entry in parent_delta.get("files") or []
                if isinstance(entry, dict)
                and isinstance(entry.get("path"), str)
            }
            for path in sorted(EXPECTED_PARENT_HASHED_PATHS):
                candidate = parent_root / path
                observed_digest = (
                    _sha256_file(candidate) if candidate.is_file() else None
                )
                expected_digest = parent_file_entries.get(path, {}).get("sha256")
                tree_entry = _git_tree_entry(parent_root, parent_sha, path)
                receipt["parentDelta"]["files"].append(
                    {
                        "path": path,
                        "gitMode": tree_entry[0] if tree_entry else None,
                        "gitType": tree_entry[1] if tree_entry else None,
                        "gitObject": tree_entry[2] if tree_entry else None,
                        "expectedSha256": expected_digest,
                        "observedSha256": observed_digest,
                        "matched": observed_digest == expected_digest,
                    }
                )
                if tree_entry is None:
                    receipt["errors"].append(
                        f"authorized parent delta tree entry missing: {path}"
                    )
                elif tree_entry[:2] != ("100644", "blob"):
                    receipt["errors"].append(
                        "authorized parent delta tree entry must be 100644 blob: "
                        f"{path} observed={tree_entry[:2]}"
                    )
                if observed_digest is None:
                    receipt["errors"].append(
                        f"authorized parent delta file missing: {path}"
                    )
                elif observed_digest != expected_digest:
                    receipt["errors"].append(
                        f"authorized parent delta SHA-256 mismatch: {path}"
                    )
            authority_path = parent_root / AUTHORITY_PROFILE_PATH
            if not authority_path.is_file():
                receipt["errors"].append(
                    f"self-validated authority profile missing: {AUTHORITY_PROFILE_PATH}"
                )
            authority_entry = _git_tree_entry(
                parent_root, parent_sha, AUTHORITY_PROFILE_PATH
            )
            if authority_entry is None or authority_entry[:2] != ("100644", "blob"):
                receipt["errors"].append(
                    "self-validated authority profile must be a 100644 blob"
                )
            if observed_delta.get(AUTHORITY_PROFILE_PATH) != "A":
                receipt["errors"].append(
                    "authority profile must be a newly added parent delta path"
                )
            if observed_delta.get(MOBILE_GITLINK_PATH) not in {"M", "T"}:
                receipt["errors"].append(
                    "mobile gitlink must be modified by the authorized parent delta"
                )
            mobile_entry = _git_tree_entry(
                parent_root, parent_sha, MOBILE_GITLINK_PATH
            )
            if mobile_entry is None or mobile_entry[:2] != ("160000", "commit"):
                receipt["errors"].append(
                    "mobile authority path must be a 160000 commit gitlink"
                )
    for field in ("currentMobileBaseCommit", "historicalMobileCommit"):
        revision = identity.get(field)
        if _is_hex40(revision):
            if not _git_object_exists(mobile_root, f"{revision}^{{commit}}"):
                receipt["errors"].append(f"{field} commit {revision} is unavailable")
            elif not _git_is_ancestor(mobile_root, revision, mobile_sha):
                receipt["errors"].append(
                    f"{field} {revision} is not an ancestor of mobile HEAD"
                )

    merged_mobile = identity.get("mergedMobileCommit")
    if _is_hex40(merged_mobile) and mobile_sha != merged_mobile:
        receipt["errors"].append(
            f"mobile HEAD {mobile_sha} != merged mobile authority {merged_mobile}"
        )
    forward_commit = identity.get("authorizedForwardCommit")
    if _is_hex40(forward_commit):
        if not _git_object_exists(mobile_root, f"{forward_commit}^{{commit}}"):
            receipt["errors"].append(
                f"authorized forward commit {forward_commit} is unavailable"
            )
        else:
            forward_tree = _git_text(
                mobile_root, "rev-parse", f"{forward_commit}^{{tree}}"
            )
            observed_identity["authorizedForwardTree"] = forward_tree
            if forward_tree != identity.get("mobileTree"):
                receipt["errors"].append(
                    "authorized forward commit tree does not match mobileTree"
                )
            if not _git_is_ancestor(mobile_root, forward_commit, mobile_sha):
                receipt["errors"].append(
                    "authorized forward commit is not an ancestor of mobile HEAD"
                )

    pubspec_lock = mobile_root / "pubspec.lock"
    if not pubspec_lock.is_file():
        receipt["errors"].append("pubspec.lock is missing")
    else:
        pubspec_digest = _sha256_file(pubspec_lock)
        observed_identity["pubspecLockSha256"] = pubspec_digest
        if pubspec_digest != identity.get("pubspecLockSha256"):
            receipt["errors"].append(
                "pubspec.lock SHA-256 does not match profile authority"
            )

    for entry in overlay.get("paths") or []:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            continue
        relative = entry["path"]
        candidate = mobile_root / relative
        observed = _sha256_file(candidate) if candidate.is_file() else None
        receipt["controlOverlay"]["paths"].append(
            {
                "path": relative,
                "class": entry.get("class"),
                "expectedSha256": entry.get("sha256"),
                "observedSha256": observed,
                "matched": observed == entry.get("sha256"),
            }
        )
        if observed is None:
            receipt["errors"].append(f"control path missing: {relative}")
        elif observed != entry.get("sha256"):
            receipt["errors"].append(f"control path SHA-256 mismatch: {relative}")
    observed_control_pairs = [
        {
            "path": entry["path"],
            "sha256": _sha256_file(mobile_root / entry["path"]),
        }
        for entry in overlay.get("paths") or []
        if isinstance(entry, dict)
        and isinstance(entry.get("path"), str)
        and (mobile_root / entry["path"]).is_file()
    ]
    observed_control_digest = _path_sha256_digest(observed_control_pairs)
    receipt["controlOverlay"]["sortedPathSha256Digest"] = observed_control_digest
    if observed_control_digest != overlay.get("sortedPathSha256Digest"):
        receipt["errors"].append(
            "observed control path/SHA-256 digest does not match profile authority"
        )

    superseded = (
        profile.get("supersededAuthority")
        if isinstance(profile.get("supersededAuthority"), dict)
        else {}
    )
    receipt["supersededAuthority"] = {"files": []}
    for prefix in ("lockedManifest", "registry"):
        relative = superseded.get(f"{prefix}Path")
        expected_digest = superseded.get(f"{prefix}Sha256")
        candidate = parent_root / relative if isinstance(relative, str) else None
        observed_digest = (
            _sha256_file(candidate)
            if isinstance(candidate, Path) and candidate.is_file()
            else None
        )
        receipt["supersededAuthority"]["files"].append(
            {
                "authority": prefix,
                "path": relative,
                "expectedSha256": expected_digest,
                "observedSha256": observed_digest,
                "matched": observed_digest == expected_digest,
            }
        )
        if observed_digest is None:
            receipt["errors"].append(f"superseded authority file missing: {relative}")
        elif observed_digest != expected_digest:
            receipt["errors"].append(
                f"superseded authority file SHA-256 mismatch: {relative}"
            )
    receipt["supersededAuthority"]["laterRuntimeTestFiles"] = []
    for entry in superseded.get("laterRuntimeTestFiles") or []:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            continue
        relative = entry["path"]
        expected_present = entry.get("presentInJuly1")
        observed_present = (mobile_root / relative).is_file()
        matched = observed_present is expected_present
        receipt["supersededAuthority"]["laterRuntimeTestFiles"].append(
            {
                "path": relative,
                "expectedPresentInJuly1": expected_present,
                "observedPresentInJuly1": observed_present,
                "matched": matched,
            }
        )
        if not matched:
            receipt["errors"].append(
                "later runtime test presence mismatch: "
                f"{relative} observed={observed_present} "
                f"expected={expected_present}"
            )
    process_harness = superseded.get("processHarness")
    if isinstance(process_harness, dict) and isinstance(
        process_harness.get("path"), str
    ):
        harness_path = process_harness["path"]
        expected_present = process_harness.get("presentInJuly1")
        observed_present = (mobile_root / harness_path).is_file()
        receipt["supersededAuthority"]["processHarness"] = {
            "path": harness_path,
            "expectedPresentInJuly1": expected_present,
            "observedPresentInJuly1": observed_present,
            "matched": observed_present is expected_present,
        }
        if observed_present is not expected_present:
            receipt["errors"].append(
                "process harness presence mismatch: "
                f"{harness_path} observed={observed_present} "
                f"expected={expected_present}"
            )

    if include_toolchain:
        try:
            flutter = subprocess.run(
                ["flutter", "--version", "--machine"],
                check=True,
                capture_output=True,
                text=True,
            )
            flutter_receipt = json.loads(flutter.stdout)
            dart = subprocess.run(
                ["dart", "--version"],
                check=True,
                capture_output=True,
                text=True,
            )
            dart_receipt = (dart.stdout or dart.stderr).strip()
            observed_identity["flutterVersion"] = flutter_receipt.get(
                "frameworkVersion"
            )
            observed_identity["dartReceipt"] = dart_receipt
            if observed_identity["flutterVersion"] != identity.get("flutterVersion"):
                receipt["errors"].append("Flutter version does not match profile")
            dart_match = re.search(r"Dart SDK version:\s+(\S+)", dart_receipt)
            observed_dart = dart_match.group(1) if dart_match else None
            observed_identity["dartVersion"] = observed_dart
            if observed_dart != identity.get("dartVersion"):
                receipt["errors"].append("Dart version does not match profile")
        except (
            OSError,
            subprocess.CalledProcessError,
            json.JSONDecodeError,
        ) as error:
            receipt["errors"].append(f"toolchain inspection failed: {error}")

    receipt["githubRunId"] = os.environ.get("GITHUB_RUN_ID")
    receipt["githubRunAttempt"] = os.environ.get("GITHUB_RUN_ATTEMPT")
    receipt["passed"] = not receipt["errors"]
    return receipt


def inspect_pub_get_mutation(
    *, profile_path: Path, mobile_root: Path
) -> dict[str, Any]:
    """Fail closed around Flutter's tracked platform-specific metadata rewrite.

    The July 1 tree historically tracks ``.flutter-plugins-dependencies`` even
    though the file embeds machine paths and a creation timestamp.  CI must
    prove the checkout is exact before dependency resolution, allow no other
    source mutation, record this generated rewrite, and restore the tracked
    bytes before running the post-command source-authority check.
    """

    profile, errors = load_profile(profile_path)
    generated_authority = (
        profile.get("generatedMetadata")
        if isinstance(profile.get("generatedMetadata"), dict)
        else {}
    )
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "command": "inspect-pub-get-mutation",
        "allowedPath": GENERATED_PUB_GET_PATH,
        "passed": False,
        "errors": errors,
    }
    try:
        status_lines = _run_git(
            mobile_root,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
        ).stdout.splitlines()
        tracked = _git_text(
            mobile_root,
            "ls-files",
            "--error-unmatch",
            GENERATED_PUB_GET_PATH,
        )
        expected_bytes = subprocess.run(
            ["git", "show", f"HEAD:{GENERATED_PUB_GET_PATH}"],
            cwd=mobile_root,
            check=True,
            capture_output=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        errors.append(f"generated metadata inspection failed: {error}")
        receipt["statusLines"] = []
        return receipt

    receipt["statusLines"] = status_lines
    receipt["trackedPath"] = tracked
    expected_digest = _sha256_bytes(expected_bytes)
    candidate = mobile_root / GENERATED_PUB_GET_PATH
    observed_digest = _sha256_file(candidate) if candidate.is_file() else None
    receipt["headSha256"] = expected_digest
    receipt["observedSha256"] = observed_digest
    receipt["changed"] = observed_digest != expected_digest
    if expected_digest != generated_authority.get("committedSha256"):
        errors.append(
            "tracked generated metadata SHA-256 does not match profile authority"
        )

    allowed_status = f" M {GENERATED_PUB_GET_PATH}"
    unexpected = [line for line in status_lines if line != allowed_status]
    if unexpected:
        errors.append(
            "pub get changed paths or index state outside the one allowed "
            f"worktree rewrite: {unexpected}"
        )
    if len(status_lines) > 1:
        errors.append(
            "pub get produced more than one tracked/untracked status record"
        )
    if status_lines and status_lines != [allowed_status]:
        errors.append(
            f"allowed generated metadata status must be exactly {allowed_status!r}"
        )
    if not candidate.is_file():
        errors.append(f"generated metadata path is missing: {GENERATED_PUB_GET_PATH}")
    elif candidate.is_symlink():
        errors.append("generated metadata path must not be a symlink")
    else:
        try:
            generated = json.loads(candidate.read_text(encoding="utf-8"))
            expected_generated = json.loads(expected_bytes.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            errors.append(f"generated metadata is not valid JSON: {error}")
        else:
            if not isinstance(generated, dict):
                errors.append("generated metadata root must be an object")
            elif generated.get("info") != (
                "This is a generated file; do not edit or check into version control."
            ):
                errors.append("generated metadata lacks Flutter's exact ownership notice")
            if not isinstance(expected_generated, dict):
                errors.append("tracked generated metadata root must be an object")
            else:
                expected_canonical, expected_invalid = _canonical_flutter_metadata(
                    expected_generated
                )
                observed_canonical, observed_invalid = _canonical_flutter_metadata(
                    generated
                )
                receipt["headCanonicalSha256"] = _sha256_bytes(
                    json.dumps(
                        expected_canonical,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                )
                receipt["observedCanonicalSha256"] = _sha256_bytes(
                    json.dumps(
                        observed_canonical,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                )
                if expected_invalid:
                    errors.append(
                        "tracked generated metadata has invalid volatile fields: "
                        f"{sorted(set(expected_invalid))}"
                    )
                if observed_invalid:
                    errors.append(
                        "generated metadata has invalid volatile fields: "
                        f"{sorted(set(observed_invalid))}"
                    )
                if observed_canonical != expected_canonical:
                    errors.append(
                        "generated metadata dependency/platform semantics differ "
                        "after normalizing only timestamp and absolute path roots"
                    )
                if (
                    receipt["headCanonicalSha256"]
                    != generated_authority.get("canonicalSha256")
                ):
                    errors.append(
                        "tracked generated metadata canonical SHA-256 does not "
                        "match profile authority"
                    )

    receipt["passed"] = not errors
    return receipt


def evaluate_full_suite(
    *,
    profile_path: Path,
    machine_log: Path,
    flutter_status: int,
    mobile_root: Path,
) -> dict[str, Any]:
    profile, profile_errors = load_profile(profile_path)
    inventory = (
        profile.get("testInventory")
        if isinstance(profile.get("testInventory"), dict)
        else {}
    )
    debt_entries = {
        entry["id"]: entry
        for entry in profile.get("acceptedDebt") or []
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    skip_entries = {
        entry["id"]: entry
        for entry in profile.get("ownedSkips") or []
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    run = load_machine_run(machine_log, mobile_root)
    errors = [*profile_errors, *run.stream_errors]
    execution_authority = (
        profile.get("executionEnvironment")
        if isinstance(profile.get("executionEnvironment"), dict)
        else {}
    )
    expected_time_zone = execution_authority.get("timeZone")
    observed_time_zone = os.environ.get("TZ")
    time_zone_matches = observed_time_zone == expected_time_zone
    if not time_zone_matches:
        errors.append(
            "execution timezone mismatch: "
            f"{observed_time_zone!r} != {expected_time_zone!r}"
        )
    hidden_failures = sorted(
        test.identity
        for test in run.tests
        if test.hidden and (test.result != "success" or test.skipped)
    )
    if hidden_failures:
        errors.append(f"hidden loading/compile tests did not pass: {hidden_failures}")
    substantive = run.substantive
    identities = [test.identity for test in substantive]
    identity_counts: dict[str, int] = {}
    for identity in identities:
        identity_counts[identity] = identity_counts.get(identity, 0) + 1
    duplicate_ids = sorted(
        identity for identity, count in identity_counts.items() if count > 1
    )
    if duplicate_ids:
        errors.append(f"duplicate stable test IDs: {duplicate_ids}")
    tests_by_id = {test.identity: test for test in substantive}

    checkout_suites = {
        path.relative_to(mobile_root).as_posix()
        for path in (mobile_root / "test").rglob("*_test.dart")
        if path.is_file()
    }
    missing_suites = sorted(checkout_suites - run.suite_files)
    extra_suites = sorted(run.suite_files - checkout_suites)
    if missing_suites:
        errors.append(f"checkout suites missing from machine log: {missing_suites}")
    if extra_suites:
        errors.append(f"machine suites absent from checkout: {extra_suites}")

    passes = {
        identity: test
        for identity, test in tests_by_id.items()
        if not test.skipped and test.result == "success"
    }
    skips = {
        identity: test for identity, test in tests_by_id.items() if test.skipped
    }
    failures = {
        identity: test
        for identity, test in tests_by_id.items()
        if not test.skipped and test.result != "success"
    }

    expected_debt_ids = set(debt_entries)
    expected_skip_ids = set(skip_entries)
    observed_failure_ids = set(failures)
    observed_skip_ids = set(skips)
    missing_debt = sorted(expected_debt_ids - observed_failure_ids)
    extra_failures = sorted(observed_failure_ids - expected_debt_ids)
    missing_skips = sorted(expected_skip_ids - observed_skip_ids)
    extra_skips = sorted(observed_skip_ids - expected_skip_ids)
    if missing_debt:
        errors.append(f"accepted debt disappeared or changed status: {missing_debt}")
    if extra_failures:
        errors.append(f"unexpected failures: {extra_failures}")
    if missing_skips:
        errors.append(f"owned skips disappeared or changed status: {missing_skips}")
    if extra_skips:
        errors.append(f"unexpected skips: {extra_skips}")

    debt_results: list[dict[str, Any]] = []
    for identity_value, entry in sorted(debt_entries.items()):
        observed = failures.get(identity_value)
        actual_category = normalized_category(observed) if observed else None
        result = observed.result if observed else None
        matched = (
            observed is not None
            and result == "failure"
            and actual_category == entry.get("evaluatorCategory")
        )
        debt_results.append(
            {
                "id": identity_value,
                "classification": EXPECTED_DEBT_CLASSIFICATION,
                "historicalCategory": entry.get("historicalCategory"),
                "expectedEvaluatorCategory": entry.get("evaluatorCategory"),
                "observedEvaluatorCategory": actual_category,
                "observedStatus": result,
                "ticket": entry.get("ticket"),
                "owner": entry.get("owner"),
                "matched": matched,
            }
        )
        if observed is not None and result != "failure":
            errors.append(
                f"accepted debt status changed for {identity_value}: {result}"
            )
        if observed is not None and actual_category != entry.get("evaluatorCategory"):
            errors.append(
                "accepted debt evaluator category changed for "
                f"{identity_value}: {actual_category} != "
                f"{entry.get('evaluatorCategory')}"
            )

    skip_results: list[dict[str, Any]] = []
    for identity_value, entry in sorted(skip_entries.items()):
        observed = skips.get(identity_value)
        actual_reason = observed.skip_reason if observed else None
        matched = observed is not None and actual_reason == entry.get("reason")
        skip_results.append(
            {
                "id": identity_value,
                "expectedReason": entry.get("reason"),
                "observedReason": actual_reason,
                "ticket": entry.get("ticket"),
                "owner": entry.get("owner"),
                "matched": matched,
            }
        )
        if observed is not None and actual_reason != entry.get("reason"):
            errors.append(
                f"owned skip reason changed for {identity_value}: "
                f"{actual_reason!r} != {entry.get('reason')!r}"
            )

    observed = {
        "suiteFileCount": len(run.suite_files),
        "suiteFilesSha256": _sorted_digest(run.suite_files),
        "substantiveCount": len(substantive),
        "stableIdsSha256": _sorted_digest(set(identities)),
        "passCount": len(passes),
        "passingIdsSha256": _sorted_digest(set(passes)),
        "acceptedDebtCount": len(failures),
        "acceptedDebtIdsSha256": _sorted_digest(set(failures)),
        "ownedSkipCount": len(skips),
        "ownedSkipIdsSha256": _sorted_digest(set(skips)),
        "flutterStatus": flutter_status,
        "doneSuccess": run.done_success,
    }
    comparisons = {
        "suiteFileCount": inventory.get("suiteFileCount"),
        "suiteFilesSha256": inventory.get("suiteFilesSha256"),
        "substantiveCount": inventory.get("substantiveCount"),
        "stableIdsSha256": inventory.get("stableIdsSha256"),
        "passCount": inventory.get("expectedPassCount"),
        "passingIdsSha256": inventory.get("passingIdsSha256"),
        "acceptedDebtCount": inventory.get("expectedAcceptedDebtCount"),
        "acceptedDebtIdsSha256": inventory.get("acceptedDebtIdsSha256"),
        "ownedSkipCount": inventory.get("expectedOwnedSkipCount"),
        "ownedSkipIdsSha256": inventory.get("ownedSkipIdsSha256"),
    }
    for field, expected in comparisons.items():
        if observed.get(field) != expected:
            errors.append(
                f"inventory mismatch {field}: {observed.get(field)} != {expected}"
            )

    expected_flutter_status = 1 if failures else 0
    if flutter_status != expected_flutter_status:
        errors.append(
            f"Flutter exit status {flutter_status} != expected "
            f"{expected_flutter_status}"
        )
    expected_done = not bool(failures)
    if run.done_success is not expected_done:
        errors.append(
            f"machine done success {run.done_success} != expected {expected_done}"
        )

    normalized = [
        {
            "id": test.identity,
            "file": test.file,
            "groups": test.groups,
            "testName": test.test_name,
            "status": (
                "OWNED_SKIP"
                if test.skipped
                else (
                    EXPECTED_DEBT_CLASSIFICATION
                    if test.result != "success"
                    else "PASS"
                )
            ),
            "result": test.result,
            "skipReason": test.skip_reason,
            "evaluatorCategory": (
                normalized_category(test)
                if not test.skipped and test.result != "success"
                else None
            ),
        }
        for test in sorted(substantive, key=lambda item: item.identity)
    ]
    decision = {
        "schemaVersion": 1,
        "command": "evaluate-full",
        "profileId": profile.get("profileId"),
        "passed": False,
        "executionEnvironment": {
            "classification": execution_authority.get("classification"),
            "affectedTestId": execution_authority.get("affectedTestId"),
            "expectedTimeZone": expected_time_zone,
            "observedTimeZone": observed_time_zone,
            "matched": time_zone_matches,
            "ticket": execution_authority.get("ticket"),
            "laterTestOnlyFixCommit": execution_authority.get(
                "laterTestOnlyFixCommit"
            ),
        },
        "observed": observed,
        "expected": comparisons,
        "acceptedBaselineDebt": debt_results,
        "ownedSkips": skip_results,
        "missingDebt": missing_debt,
        "extraFailures": extra_failures,
        "missingSkips": missing_skips,
        "extraSkips": extra_skips,
        "missingSuites": missing_suites,
        "extraSuites": extra_suites,
        "duplicateIds": duplicate_ids,
        "hiddenFailures": hidden_failures,
        "streamErrors": run.stream_errors,
        "errors": errors,
        "normalizedResults": normalized,
    }
    decision["passed"] = not errors
    return decision


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    verify = subparsers.add_parser("verify-checkout")
    verify.add_argument("--profile", type=Path, required=True)
    verify.add_argument("--parent-root", type=Path, required=True)
    verify.add_argument("--mobile-root", type=Path, required=True)
    verify.add_argument("--expected-parent", required=True)
    verify.add_argument("--include-toolchain", action="store_true")
    verify.add_argument("--output", type=Path, required=True)

    generated = subparsers.add_parser("inspect-pub-get-mutation")
    generated.add_argument("--profile", type=Path, required=True)
    generated.add_argument("--mobile-root", type=Path, required=True)
    generated.add_argument("--output", type=Path, required=True)

    evaluate = subparsers.add_parser("evaluate-full")
    evaluate.add_argument("--profile", type=Path, required=True)
    evaluate.add_argument("--machine-log", type=Path, required=True)
    evaluate.add_argument("--flutter-status", type=int, required=True)
    evaluate.add_argument("--mobile-root", type=Path, required=True)
    evaluate.add_argument("--output-dir", type=Path, required=True)

    args = parser.parse_args(argv)
    if args.command == "verify-checkout":
        receipt = verify_checkout(
            profile_path=args.profile,
            parent_root=args.parent_root,
            mobile_root=args.mobile_root,
            expected_parent=args.expected_parent,
            include_toolchain=args.include_toolchain,
        )
        _write_json(args.output, receipt)
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0 if receipt["passed"] else 1

    if args.command == "inspect-pub-get-mutation":
        receipt = inspect_pub_get_mutation(
            profile_path=args.profile,
            mobile_root=args.mobile_root,
        )
        _write_json(args.output, receipt)
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0 if receipt["passed"] else 1

    decision = evaluate_full_suite(
        profile_path=args.profile,
        machine_log=args.machine_log,
        flutter_status=args.flutter_status,
        mobile_root=args.mobile_root,
    )
    output = dict(decision)
    normalized = output.pop("normalizedResults")
    _write_json(args.output_dir / "july1-runtime-decision.json", output)
    _write_json(args.output_dir / "july1-runtime-normalized.json", normalized)
    _write_json(args.output_dir / "july1-runtime-profile.json", _load_json(args.profile))
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if decision["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
