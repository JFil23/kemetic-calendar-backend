#!/usr/bin/env python3
"""Forward-candidate LOCK-GATE: declared-base delta plus current-runtime wiring.

Historical July 1 recovery evidence stays on a frozen second checkout. This
module proves the candidate's declared_base → HEAD transition and that the
workflow actually tests the current mobile gitlink. It does not fetch served
production and does not retarget july1-recovery.v1.json.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tool.ci.july1_runtime_gate import MachineRun, TestRecord, load_machine_run, verify_checkout


HEX40 = re.compile(r"^[0-9a-f]{40}$")
ZERO_SHA = "0" * 40
MOBILE_GITLINK_PATH = "mobile"
JULY1_PROFILE_PATH = Path("ci/runtime-authority/july1-recovery.v1.json")
WORKFLOW_PATH = Path(".github/workflows/mobile.yml")

READING_HOUSE_RELEASE_DECLARED_BASE = (
    "addeec5e196e8282f97d58e9cc857e11d99f2d4b"
)
READING_HOUSE_RELEASE_PRODUCT_PARENT = (
    "2cea8d3ae711c8b91e9c1f7e0f52d33407f49211"
)
READING_HOUSE_RELEASE_AUTHORITY_PARENT = (
    "74dc57f804b01db366d03f285e8b530c92546a5a"
)
READING_HOUSE_RELEASE_MOBILE = "0c424c10954208924b1c0abc9eea118191c72cee"
READING_HOUSE_RELEASE_MIGRATION_PATH = (
    "supabase/migrations/"
    "20260905152737_reading_house_rooms_realtime_and_read_state.sql"
)
READING_HOUSE_RELEASE_MIGRATION_BLOB = (
    "2ca4ee63640b6eca6bf3d255d36a295d6f7a0eb0"
)
READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH = Path(
    "ci/runtime-authority/reading-house-four-flow-missing-tests.v1.json"
)
READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB = (
    "7dfb6324a576cb4260c76cdc1f03f09f4073be83"
)
READING_HOUSE_RELEASE_MISSING_TEST_COUNT = 202
MAAT_VISUAL_TEST_RENAME_DECLARED_BASE = (
    "020f9808fbcd4a03df42009fd2f5a7f4a83d94b5"
)
MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT = (
    "4f37d1213ecdefc115a509d0fde0a4f5e5eb776b"
)
MAAT_VISUAL_TEST_RENAME_BASE_MOBILE = (
    "ddc78e8b48779454bf1b20ff4cc88671af99fcb1"
)
MAAT_VISUAL_TEST_RENAME_MOBILE = "a75e9ec88870db799cad64cacf63d77b1ce3f373"
MAAT_VISUAL_TEST_RENAME_AUDIT_PATH = Path(
    "ci/runtime-authority/maat-visual-test-renames.v1.json"
)
MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB = (
    "035c6867672bc2a7aa0d647fc0f0233f18af3e1d"
)
MAAT_VISUAL_TEST_RENAME_COUNT = 16
FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE = (
    "ea0651e3d2d1aa8018dd96f291143ee348e2210a"
)
FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT = (
    "ff0154e37e987f2854bf4e281481f876e6bb1db0"
)
FLOW_DETAIL_SURFACE_TEST_RENAME_BASE_MOBILE = (
    "c620de90057ed1efb65562196a645aac4f0c0eef"
)
FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE = (
    "5221aa27b14132e8d3bcc700e766ddb8245b3433"
)
FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH = Path(
    "ci/runtime-authority/flow-detail-surface-test-renames.v1.json"
)
FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB = (
    "5071fdc49b3022b7faefabfd1bbe10064e3d09b7"
)
FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT = 9
KAR_RELEASE_DECLARED_BASE = "eccd4583aef31aaeba04fcffecd1a781020fccb2"
KAR_RELEASE_PRODUCT_PARENT = "ea0b1751cbc9fa8a721e10bf6536e9fbee993931"
KAR_RELEASE_BASE_MOBILE = "2a9b1007f4a47b981bae23fce5064e508c3912ba"
KAR_RELEASE_MOBILE = "2900d556203f9b055a75c20d97e53032855e8d15"
KAR_RELEASE_MIGRATION_PATH = (
    "supabase/migrations/20260910092351_kar_private_versioned_history.sql"
)
KAR_RELEASE_MIGRATION_BLOB = "2384865b8d10c5da9866609024a1603bb1524b1b"
KAR_RELEASE_TEST_RENAME_AUDIT_PATH = Path(
    "ci/runtime-authority/kar-five-flow-test-renames.v1.json"
)
KAR_RELEASE_TEST_RENAME_AUDIT_BLOB = (
    "dd178ba7ec7dd5aed2244e5bd972f9e2c7861e18"
)
KAR_RELEASE_TEST_RENAME_COUNT = 24
KAR_GUARD_REPAIR_DECLARED_BASE = "14ed760d6f9094c6a9cb51862b80070dcb4291d9"
KAR_GUARD_REPAIR_DIRECT_PARENT = "d813ce2d2f55b7eef257daafe448078f7411445e"
KAR_GUARD_REPAIR_BASE_MOBILE = "2900d556203f9b055a75c20d97e53032855e8d15"
KAR_GUARD_REPAIR_MOBILE = "863024f6bc3d976ef2460b8d5131657f989fd2ca"
KAR_GUARD_REPAIR_PARENT_PATHS = frozenset(
    {
        MOBILE_GITLINK_PATH,
        "ci/LOCK_GATE.md",
        "tool/ci/forward_candidate_gate.py",
        "tool/ci/test_forward_candidate_gate.py",
    }
)
WILDCARD_CHARS = re.compile(r"[*?\[\]]")

ALLOWED_AUTHORITY_PARENT_PATHS = frozenset(
    {
        ".github/workflows/admin.yml",
        ".github/workflows/mobile.yml",
        ".github/workflows/supabase-functions.yml",
        "ci/LOCK_GATE.md",
        READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix(),
        MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix(),
        FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
        KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix(),
        "tool/ci/forward_candidate_gate.py",
        "tool/ci/release_pipeline_gate.py",
        "tool/ci/test_forward_candidate_gate.py",
        "tool/ci/test_release_pipeline_gate.py",
    }
)

CUT_CLASS_AUTHORITY_ROLLOVER = "parent-authority-rollover"
CUT_CLASS_GITLINK_ONLY = "parent-gitlink-only"
CUT_CLASS_READING_HOUSE_RELEASE = "reading-house-release-reconciliation"
CUT_CLASS_MAAT_VISUAL_TEST_RENAME = "maat-visual-test-rename-reconciliation"
CUT_CLASS_FLOW_DETAIL_SURFACE_TEST_RENAME = (
    "flow-detail-surface-test-rename-reconciliation"
)
CUT_CLASS_KAR_RELEASE = "kar-five-flow-release-reconciliation"
CUT_CLASS_KAR_GUARD_REPAIR = "kar-restoration-guard-reconciliation"
CUT_CLASS_EMPTY = "empty"

REQUIRED_AGGREGATE_JOBS = (
    "resolve-historical-pair",
    "mobile-fast-suite",
    "lock-gate-evaluator",
    "release-pipeline-contracts",
    "locked-contract-vm",
    "locked-contract-process",
    "full-suite-quarantine-monitor",
    "forward-candidate-runtime",
)

REQUIRED_FORWARD_RUNTIME_COMMANDS = (
    "python3 tool/ci/forward_candidate_gate.py verify-forward",
    "flutter pub get --enforce-lockfile",
    "flutter analyze --no-fatal-infos",
    "python3 tool/ci/forward_candidate_gate.py compare-analyze",
    "flutter test --no-pub --machine --concurrency=1",
    "python3 tool/ci/forward_candidate_gate.py compare-test",
)

HUMAN_DIAGNOSTIC = re.compile(
    r"^\s*(error|warning|info|hint)\s+•\s+(.*?)\s+•\s+(.*?):(\d+):(\d+)\s+•\s+(\S+)\s*$",
    re.IGNORECASE,
)
ANALYZER_SUCCESS_STATUSES = {0, 1}
TEST_HARNESS_STATUSES = {0, 1}
FORWARD_PASS = "PASS"
FORWARD_FAIL = "FAIL"
FORWARD_ERROR = "ERROR"
FORWARD_TIMEOUT = "TIMEOUT"
FORWARD_SKIP = "SKIP"
WORSENING_STATUSES = frozenset(
    {FORWARD_FAIL, FORWARD_ERROR, FORWARD_TIMEOUT, FORWARD_SKIP}
)
FAILURE_STATUSES = frozenset({FORWARD_FAIL, FORWARD_ERROR, FORWARD_TIMEOUT})
ABS_PATH_NOISE = re.compile(
    r"(?:file://)?"
    r"(?:/private)?"
    r"(?:/var/folders/[^\s:'\"]+|/tmp/[^\s:'\"]+|/Users/[^\s:'\"]+|"
    r"/home/[^\s:'\"]+|/opt/[^\s:'\"]+|[A-Za-z]:/[^\s:'\"]+)"
)
DART_LOCATION_NOISE = re.compile(
    r"(?i)(?:[A-Za-z0-9_.:/-])+\.dart:\d+(?::\d+)?"
)
WHITESPACE_NOISE = re.compile(r"\s+")


class ForwardCandidateError(ValueError):
    """Fail-closed forward-candidate authority error."""


def _is_hex40(value: Any) -> bool:
    return isinstance(value, str) and HEX40.fullmatch(value) is not None


def _run_git(
    cwd: Path, *args: str, check: bool = True
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=check,
        capture_output=True,
        text=True,
    )


def _git_text(cwd: Path, *args: str) -> str:
    return _run_git(cwd, *args).stdout.strip()


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


def _mobile_gitlink(cwd: Path, revision: str) -> str | None:
    line = _git_text(cwd, "ls-tree", revision, "--", MOBILE_GITLINK_PATH)
    if not line:
        return None
    metadata, path = line.split("\t", 1)
    if path != MOBILE_GITLINK_PATH:
        return None
    parts = metadata.split()
    if len(parts) != 3 or parts[0] != "160000" or parts[1] != "commit":
        return None
    return parts[2]


def _parse_name_status(cwd: Path, base: str, candidate: str) -> list[dict[str, str]]:
    raw = _git_text(
        cwd,
        "diff",
        "--name-status",
        "--no-renames",
        f"{base}..{candidate}",
    )
    records: list[dict[str, str]] = []
    if not raw:
        return records
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) != 2 or parts[0] not in {"A", "D", "M", "T"}:
            raise ForwardCandidateError(f"unsupported parent delta record: {line!r}")
        records.append({"status": parts[0], "path": parts[1]})
    return records


def _job_block(source: str, job_id: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(job_id)}:\n(.*?)(?=^  [a-zA-Z0-9_-]+:\n|\Z)",
        source,
    )
    if not match:
        raise ForwardCandidateError(f"workflow lacks required job {job_id!r}")
    return match.group(0)


def _load_merged_mobile_commit(profile_path: Path) -> str:
    try:
        raw = json.loads(profile_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ForwardCandidateError(f"July 1 profile cannot be read: {error}") from error
    identity = raw.get("identity") if isinstance(raw, dict) else None
    merged = identity.get("mergedMobileCommit") if isinstance(identity, dict) else None
    if not _is_hex40(merged):
        raise ForwardCandidateError(
            "identity.mergedMobileCommit must be a lowercase 40-hex value"
        )
    return merged


def resolve_historical_parent(*, parent_root: Path, profile_path: Path) -> dict[str, Any]:
    """Newest unambiguous ancestor whose gitlink equals mergedMobileCommit."""

    merged = _load_merged_mobile_commit(profile_path)
    candidate = _git_text(parent_root, "rev-parse", "HEAD")
    ancestors = _git_text(parent_root, "rev-list", candidate).splitlines()
    matching: list[str] = []
    gitlinks: dict[str, str | None] = {}
    for sha in ancestors:
        gitlink = _mobile_gitlink(parent_root, sha)
        gitlinks[sha] = gitlink
        if gitlink == merged:
            matching.append(sha)
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "command": "resolve-historical",
        "mergedMobileCommit": merged,
        "candidateParent": candidate,
        "matchingAncestors": matching,
        "historicalParent": None,
        "passed": False,
        "errors": [],
    }
    if not matching:
        receipt["errors"].append(
            "no ancestor mobile gitlink equals identity.mergedMobileCommit"
        )
        return receipt
    newest = matching[0]
    for other in matching[1:]:
        if not _git_is_ancestor(parent_root, other, newest):
            receipt["errors"].append(
                "historical parent resolution is ambiguous: "
                f"{newest} and {other} both have gitlink {merged} "
                "and are not in a single ancestor chain"
            )
            return receipt
    receipt["historicalParent"] = newest
    receipt["historicalGitlink"] = gitlinks[newest]
    return receipt


def materialize_historical_pair(
    *,
    parent_root: Path,
    historical_parent: str,
    historical_root: Path,
) -> None:
    if historical_root.exists():
        raise ForwardCandidateError(
            f"historical root already exists: {historical_root}"
        )
    _run_git(
        parent_root,
        "worktree",
        "add",
        "--detach",
        str(historical_root),
        historical_parent,
    )
    update = _run_git(
        historical_root,
        "submodule",
        "update",
        "--init",
        "--recursive",
        check=False,
    )
    if update.returncode != 0:
        detail = (update.stderr or update.stdout).strip()
        raise ForwardCandidateError(
            "historical submodule update failed: "
            f"{detail or f'exit {update.returncode}'}"
        )


def verify_historical_pair(
    *,
    profile_path: Path,
    historical_root: Path,
    historical_parent: str,
) -> dict[str, Any]:
    mobile_root = historical_root / MOBILE_GITLINK_PATH
    receipt = verify_checkout(
        profile_path=profile_path,
        parent_root=historical_root,
        mobile_root=mobile_root,
        expected_parent=historical_parent,
        include_toolchain=False,
    )
    return receipt


def _classify_parent_delta(
    paths: Iterable[str],
    *,
    declared_base: str,
    candidate_gitlink: str | None,
) -> tuple[str | None, list[str]]:
    observed = set(paths)
    errors: list[str] = []
    if not observed:
        return CUT_CLASS_EMPTY, errors
    if observed == {MOBILE_GITLINK_PATH}:
        return CUT_CLASS_GITLINK_ONLY, errors
    if {
        MOBILE_GITLINK_PATH,
        KAR_RELEASE_MIGRATION_PATH,
        KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix(),
    }.issubset(observed):
        allowed = ALLOWED_AUTHORITY_PARENT_PATHS | {
            MOBILE_GITLINK_PATH,
            KAR_RELEASE_MIGRATION_PATH,
        }
        if declared_base != KAR_RELEASE_DECLARED_BASE:
            errors.append(
                "Kꜣr release reconciliation requires declared_base "
                f"{KAR_RELEASE_DECLARED_BASE}, got {declared_base}"
            )
        if candidate_gitlink != KAR_RELEASE_MOBILE:
            errors.append(
                "Kꜣr release reconciliation requires candidate mobile "
                f"{KAR_RELEASE_MOBILE}, got {candidate_gitlink}"
            )
        extra = sorted(observed - allowed)
        if extra:
            errors.append(
                "Kꜣr release reconciliation contains paths outside its exact "
                f"allowlist: extra={extra}"
            )
        if errors:
            return None, errors
        return CUT_CLASS_KAR_RELEASE, errors
    if {
        MOBILE_GITLINK_PATH,
        MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix(),
    }.issubset(observed):
        allowed = ALLOWED_AUTHORITY_PARENT_PATHS | {MOBILE_GITLINK_PATH}
        if declared_base != MAAT_VISUAL_TEST_RENAME_DECLARED_BASE:
            errors.append(
                "Ma’at visual test rename reconciliation requires declared_base "
                f"{MAAT_VISUAL_TEST_RENAME_DECLARED_BASE}, got {declared_base}"
            )
        if candidate_gitlink != MAAT_VISUAL_TEST_RENAME_MOBILE:
            errors.append(
                "Ma’at visual test rename reconciliation requires candidate mobile "
                f"{MAAT_VISUAL_TEST_RENAME_MOBILE}, got {candidate_gitlink}"
            )
        extra = sorted(observed - allowed)
        if extra:
            errors.append(
                "Ma’at visual test rename reconciliation contains paths outside "
                f"its exact allowlist: extra={extra}"
            )
        if errors:
            return None, errors
        return CUT_CLASS_MAAT_VISUAL_TEST_RENAME, errors
    if {
        MOBILE_GITLINK_PATH,
        FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
    }.issubset(observed):
        allowed = ALLOWED_AUTHORITY_PARENT_PATHS | {MOBILE_GITLINK_PATH}
        if declared_base != FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE:
            errors.append(
                "Flow-detail surface test rename reconciliation requires "
                "declared_base "
                f"{FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE}, "
                f"got {declared_base}"
            )
        if candidate_gitlink != FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE:
            errors.append(
                "Flow-detail surface test rename reconciliation requires "
                "candidate mobile "
                f"{FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE}, "
                f"got {candidate_gitlink}"
            )
        extra = sorted(observed - allowed)
        if extra:
            errors.append(
                "Flow-detail surface test rename reconciliation contains paths "
                f"outside its exact allowlist: extra={extra}"
            )
        if errors:
            return None, errors
        return CUT_CLASS_FLOW_DETAIL_SURFACE_TEST_RENAME, errors
    if {
        MOBILE_GITLINK_PATH,
        READING_HOUSE_RELEASE_MIGRATION_PATH,
    }.issubset(observed):
        allowed = ALLOWED_AUTHORITY_PARENT_PATHS | {
            MOBILE_GITLINK_PATH,
            READING_HOUSE_RELEASE_MIGRATION_PATH,
        }
        if declared_base != READING_HOUSE_RELEASE_DECLARED_BASE:
            errors.append(
                "Reading House release reconciliation requires declared_base "
                f"{READING_HOUSE_RELEASE_DECLARED_BASE}, got {declared_base}"
            )
        if candidate_gitlink != READING_HOUSE_RELEASE_MOBILE:
            errors.append(
                "Reading House release reconciliation requires candidate mobile "
                f"{READING_HOUSE_RELEASE_MOBILE}, got {candidate_gitlink}"
            )
        extra = sorted(observed - allowed)
        if extra:
            errors.append(
                "Reading House release reconciliation contains paths outside its "
                f"exact allowlist: extra={extra}"
            )
        if errors:
            return None, errors
        return CUT_CLASS_READING_HOUSE_RELEASE, errors
    if observed == KAR_GUARD_REPAIR_PARENT_PATHS:
        if declared_base != KAR_GUARD_REPAIR_DECLARED_BASE:
            errors.append(
                "Kꜣr restoration-guard reconciliation requires declared_base "
                f"{KAR_GUARD_REPAIR_DECLARED_BASE}, got {declared_base}"
            )
        if candidate_gitlink != KAR_GUARD_REPAIR_MOBILE:
            errors.append(
                "Kꜣr restoration-guard reconciliation requires candidate mobile "
                f"{KAR_GUARD_REPAIR_MOBILE}, got {candidate_gitlink}"
            )
        if errors:
            return None, errors
        return CUT_CLASS_KAR_GUARD_REPAIR, errors
    extra = sorted(observed - ALLOWED_AUTHORITY_PARENT_PATHS)
    if extra:
        errors.append(
            "parent delta contains paths outside the authority-rollover "
            f"allowlist and is not gitlink-only: extra={extra}"
        )
        return None, errors
    return CUT_CLASS_AUTHORITY_ROLLOVER, errors


def _validate_reading_house_release_identity(
    *,
    parent_line: Sequence[str],
    migration_records: Sequence[dict[str, str]],
    migration_blob: str | None,
    audit_records: Sequence[dict[str, str]],
    audit_blob: str | None,
) -> list[str]:
    errors: list[str] = []
    if (
        len(parent_line) != 2
        or parent_line[1] != READING_HOUSE_RELEASE_AUTHORITY_PARENT
    ):
        errors.append(
            "Reading House release reconciliation must be one commit directly "
            f"on top of {READING_HOUSE_RELEASE_AUTHORITY_PARENT}"
        )
    if list(migration_records) != [
        {"status": "A", "path": READING_HOUSE_RELEASE_MIGRATION_PATH}
    ]:
        errors.append("Reading House release migration must be exactly one added path")
    if migration_blob != READING_HOUSE_RELEASE_MIGRATION_BLOB:
        errors.append(
            "Reading House release migration blob must remain "
            f"{READING_HOUSE_RELEASE_MIGRATION_BLOB}, got {migration_blob}"
        )
    if list(audit_records) != [
        {
            "status": "A",
            "path": READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix(),
        }
    ]:
        errors.append("Reading House missing-test audit must be exactly one added path")
    if audit_blob != READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB:
        errors.append(
            "Reading House missing-test audit blob must remain "
            f"{READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB}, got {audit_blob}"
        )
    return errors


def _validate_maat_visual_test_rename_identity(
    *,
    parent_line: Sequence[str],
    base_gitlink: str | None,
    candidate_gitlink: str | None,
    audit_records: Sequence[dict[str, str]],
    audit_blob: str | None,
) -> list[str]:
    errors: list[str] = []
    if (
        len(parent_line) != 2
        or parent_line[1] != MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT
    ):
        errors.append(
            "Ma’at visual test rename reconciliation must be one commit directly "
            f"on top of {MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT}"
        )
    if base_gitlink != MAAT_VISUAL_TEST_RENAME_BASE_MOBILE:
        errors.append(
            "Ma’at visual test rename reconciliation requires base mobile "
            f"{MAAT_VISUAL_TEST_RENAME_BASE_MOBILE}, got {base_gitlink}"
        )
    if candidate_gitlink != MAAT_VISUAL_TEST_RENAME_MOBILE:
        errors.append(
            "Ma’at visual test rename reconciliation requires candidate mobile "
            f"{MAAT_VISUAL_TEST_RENAME_MOBILE}, got {candidate_gitlink}"
        )
    if list(audit_records) != [
        {
            "status": "A",
            "path": MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix(),
        }
    ]:
        errors.append("Ma’at visual test rename audit must be exactly one added path")
    if audit_blob != MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB:
        errors.append(
            "Ma’at visual test rename audit blob must remain "
            f"{MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB}, got {audit_blob}"
        )
    return errors


def _validate_flow_detail_surface_test_rename_identity(
    *,
    parent_line: Sequence[str],
    base_gitlink: str | None,
    candidate_gitlink: str | None,
    audit_records: Sequence[dict[str, str]],
    audit_blob: str | None,
) -> list[str]:
    errors: list[str] = []
    if (
        len(parent_line) != 2
        or parent_line[1] != FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT
    ):
        errors.append(
            "Flow-detail surface test rename reconciliation must be one commit "
            "directly on top of "
            f"{FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT}"
        )
    if base_gitlink != FLOW_DETAIL_SURFACE_TEST_RENAME_BASE_MOBILE:
        errors.append(
            "Flow-detail surface test rename reconciliation requires base mobile "
            f"{FLOW_DETAIL_SURFACE_TEST_RENAME_BASE_MOBILE}, got {base_gitlink}"
        )
    if candidate_gitlink != FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE:
        errors.append(
            "Flow-detail surface test rename reconciliation requires candidate "
            f"mobile {FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE}, "
            f"got {candidate_gitlink}"
        )
    if list(audit_records) != [
        {
            "status": "A",
            "path": FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix(),
        }
    ]:
        errors.append(
            "Flow-detail surface test rename audit must be exactly one added path"
        )
    if audit_blob != FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB:
        errors.append(
            "Flow-detail surface test rename audit blob must remain "
            f"{FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB}, got {audit_blob}"
        )
    return errors


def _validate_kar_release_identity(
    *,
    parent_line: Sequence[str],
    base_gitlink: str | None,
    candidate_gitlink: str | None,
    migration_records: Sequence[dict[str, str]],
    migration_blob: str | None,
    audit_records: Sequence[dict[str, str]],
    audit_blob: str | None,
) -> list[str]:
    errors: list[str] = []
    if len(parent_line) != 2 or parent_line[1] != KAR_RELEASE_PRODUCT_PARENT:
        errors.append(
            "Kꜣr release reconciliation must be one commit directly on top of "
            f"{KAR_RELEASE_PRODUCT_PARENT}"
        )
    if base_gitlink != KAR_RELEASE_BASE_MOBILE:
        errors.append(
            "Kꜣr release reconciliation requires base mobile "
            f"{KAR_RELEASE_BASE_MOBILE}, got {base_gitlink}"
        )
    if candidate_gitlink != KAR_RELEASE_MOBILE:
        errors.append(
            "Kꜣr release reconciliation requires candidate mobile "
            f"{KAR_RELEASE_MOBILE}, got {candidate_gitlink}"
        )
    if list(migration_records) != [
        {"status": "A", "path": KAR_RELEASE_MIGRATION_PATH}
    ]:
        errors.append("Kꜣr release migration must be exactly one added path")
    if migration_blob != KAR_RELEASE_MIGRATION_BLOB:
        errors.append(
            "Kꜣr release migration blob must remain "
            f"{KAR_RELEASE_MIGRATION_BLOB}, got {migration_blob}"
        )
    if list(audit_records) != [
        {
            "status": "A",
            "path": KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix(),
        }
    ]:
        errors.append("Kꜣr test rename audit must be exactly one added path")
    if audit_blob != KAR_RELEASE_TEST_RENAME_AUDIT_BLOB:
        errors.append(
            "Kꜣr test rename audit blob must remain "
            f"{KAR_RELEASE_TEST_RENAME_AUDIT_BLOB}, got {audit_blob}"
        )
    return errors


def _validate_kar_guard_repair_identity(
    *,
    parent_line: Sequence[str],
    base_gitlink: str | None,
    candidate_gitlink: str | None,
) -> list[str]:
    errors: list[str] = []
    if len(parent_line) != 2 or parent_line[1] != KAR_GUARD_REPAIR_DIRECT_PARENT:
        errors.append(
            "Kꜣr restoration-guard reconciliation must be one commit directly "
            f"on top of {KAR_GUARD_REPAIR_DIRECT_PARENT}"
        )
    if base_gitlink != KAR_GUARD_REPAIR_BASE_MOBILE:
        errors.append(
            "Kꜣr restoration-guard reconciliation requires base mobile "
            f"{KAR_GUARD_REPAIR_BASE_MOBILE}, got {base_gitlink}"
        )
    if candidate_gitlink != KAR_GUARD_REPAIR_MOBILE:
        errors.append(
            "Kꜣr restoration-guard reconciliation requires candidate mobile "
            f"{KAR_GUARD_REPAIR_MOBILE}, got {candidate_gitlink}"
        )
    return errors


def verify_forward(
    *,
    parent_root: Path,
    mobile_root: Path,
    declared_base: str,
) -> dict[str, Any]:
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "command": "verify-forward",
        "passed": False,
        "cutClass": None,
        "declaredBase": declared_base,
        "errors": [],
    }
    if not _is_hex40(declared_base) or declared_base == ZERO_SHA:
        receipt["errors"].append(
            "declared_base must be a nonzero lowercase 40-hex SHA"
        )
        return receipt

    try:
        candidate_parent = _git_text(parent_root, "rev-parse", "HEAD")
        candidate_mobile = _git_text(mobile_root, "rev-parse", "HEAD")
        candidate_gitlink = _mobile_gitlink(parent_root, candidate_parent)
        base_gitlink = _mobile_gitlink(parent_root, declared_base)
        parent_delta = _parse_name_status(parent_root, declared_base, candidate_parent)
        parent_status = _git_text(parent_root, "status", "--porcelain=v1")
        mobile_status = _git_text(mobile_root, "status", "--porcelain=v1")
    except (OSError, subprocess.CalledProcessError, ForwardCandidateError) as error:
        receipt["errors"].append(str(error))
        return receipt

    receipt["candidateParent"] = candidate_parent
    receipt["candidateMobile"] = candidate_mobile
    receipt["candidateGitlink"] = candidate_gitlink
    receipt["baseMobileGitlink"] = base_gitlink
    receipt["parentDelta"] = parent_delta
    receipt["mobileDelta"] = None

    if not _git_is_ancestor(parent_root, declared_base, candidate_parent):
        receipt["errors"].append(
            f"declared_base {declared_base} is not an ancestor of HEAD {candidate_parent}"
        )
    if candidate_gitlink is None:
        receipt["errors"].append("candidate mobile gitlink is missing or not 160000")
    elif candidate_gitlink != candidate_mobile:
        receipt["errors"].append(
            f"mobile HEAD {candidate_mobile} != parent gitlink {candidate_gitlink}"
        )
    if parent_status:
        receipt["errors"].append(f"parent worktree/index is dirty: {parent_status}")
    if mobile_status:
        receipt["errors"].append(f"mobile worktree/index is dirty: {mobile_status}")

    cut_class, class_errors = _classify_parent_delta(
        (record["path"] for record in parent_delta),
        declared_base=declared_base,
        candidate_gitlink=candidate_gitlink,
    )
    receipt["cutClass"] = cut_class
    receipt["errors"].extend(class_errors)

    if cut_class in {CUT_CLASS_AUTHORITY_ROLLOVER, CUT_CLASS_EMPTY}:
        if base_gitlink != candidate_gitlink:
            receipt["errors"].append(
                "authority-rollover/empty cuts require base mobile gitlink "
                f"{base_gitlink} == candidate mobile gitlink {candidate_gitlink}"
            )
        else:
            receipt["mobileDelta"] = []
    elif cut_class in {
        CUT_CLASS_GITLINK_ONLY,
        CUT_CLASS_READING_HOUSE_RELEASE,
        CUT_CLASS_MAAT_VISUAL_TEST_RENAME,
        CUT_CLASS_FLOW_DETAIL_SURFACE_TEST_RENAME,
        CUT_CLASS_KAR_RELEASE,
        CUT_CLASS_KAR_GUARD_REPAIR,
    } and base_gitlink and candidate_gitlink:
        if cut_class == CUT_CLASS_KAR_GUARD_REPAIR:
            try:
                parent_line = _git_text(
                    parent_root, "rev-list", "--parents", "-n", "1", candidate_parent
                ).split()
            except (OSError, subprocess.CalledProcessError) as error:
                receipt["errors"].append(
                    f"Kꜣr restoration-guard identity inspection failed: {error}"
                )
                parent_line = []
            receipt["karGuardRepairDirectParent"] = (
                parent_line[1] if len(parent_line) == 2 else None
            )
            receipt["errors"].extend(
                _validate_kar_guard_repair_identity(
                    parent_line=parent_line,
                    base_gitlink=base_gitlink,
                    candidate_gitlink=candidate_gitlink,
                )
            )
        elif cut_class == CUT_CLASS_KAR_RELEASE:
            try:
                parent_line = _git_text(
                    parent_root, "rev-list", "--parents", "-n", "1", candidate_parent
                ).split()
                migration_blob = _git_text(
                    parent_root,
                    "rev-parse",
                    f"{candidate_parent}:{KAR_RELEASE_MIGRATION_PATH}",
                )
                audit_blob = _git_text(
                    parent_root,
                    "rev-parse",
                    (
                        f"{candidate_parent}:"
                        f"{KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix()}"
                    ),
                )
            except (OSError, subprocess.CalledProcessError) as error:
                receipt["errors"].append(
                    f"Kꜣr release identity inspection failed: {error}"
                )
                parent_line = []
                migration_blob = None
                audit_blob = None
            receipt["karReleaseDirectParent"] = (
                parent_line[1] if len(parent_line) == 2 else None
            )
            receipt["karReleaseMigrationBlob"] = migration_blob
            receipt["karReleaseTestRenameAuditBlob"] = audit_blob
            migration_records = [
                record
                for record in parent_delta
                if record["path"] == KAR_RELEASE_MIGRATION_PATH
            ]
            audit_records = [
                record
                for record in parent_delta
                if record["path"] == KAR_RELEASE_TEST_RENAME_AUDIT_PATH.as_posix()
            ]
            receipt["errors"].extend(
                _validate_kar_release_identity(
                    parent_line=parent_line,
                    base_gitlink=base_gitlink,
                    candidate_gitlink=candidate_gitlink,
                    migration_records=migration_records,
                    migration_blob=migration_blob,
                    audit_records=audit_records,
                    audit_blob=audit_blob,
                )
            )
        elif cut_class == CUT_CLASS_READING_HOUSE_RELEASE:
            try:
                parent_line = _git_text(
                    parent_root, "rev-list", "--parents", "-n", "1", candidate_parent
                ).split()
                migration_blob = _git_text(
                    parent_root,
                    "rev-parse",
                    f"{candidate_parent}:{READING_HOUSE_RELEASE_MIGRATION_PATH}",
                )
                audit_blob = _git_text(
                    parent_root,
                    "rev-parse",
                    (
                        f"{candidate_parent}:"
                        f"{READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix()}"
                    ),
                )
            except (OSError, subprocess.CalledProcessError) as error:
                receipt["errors"].append(
                    f"Reading House release identity inspection failed: {error}"
                )
                parent_line = []
                migration_blob = None
                audit_blob = None
            receipt["readingHouseReleaseDirectParent"] = (
                parent_line[1] if len(parent_line) == 2 else None
            )
            receipt["readingHouseReleaseMigrationBlob"] = migration_blob
            receipt["readingHouseReleaseMissingTestAuditBlob"] = audit_blob
            migration_records = [
                record
                for record in parent_delta
                if record["path"] == READING_HOUSE_RELEASE_MIGRATION_PATH
            ]
            audit_records = [
                record
                for record in parent_delta
                if record["path"]
                == READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH.as_posix()
            ]
            receipt["errors"].extend(
                _validate_reading_house_release_identity(
                    parent_line=parent_line,
                    migration_records=migration_records,
                    migration_blob=migration_blob,
                    audit_records=audit_records,
                    audit_blob=audit_blob,
                )
            )
        elif cut_class == CUT_CLASS_MAAT_VISUAL_TEST_RENAME:
            try:
                parent_line = _git_text(
                    parent_root, "rev-list", "--parents", "-n", "1", candidate_parent
                ).split()
                audit_blob = _git_text(
                    parent_root,
                    "rev-parse",
                    (
                        f"{candidate_parent}:"
                        f"{MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix()}"
                    ),
                )
            except (OSError, subprocess.CalledProcessError) as error:
                receipt["errors"].append(
                    f"Ma’at visual test rename identity inspection failed: {error}"
                )
                parent_line = []
                audit_blob = None
            receipt["maatVisualTestRenameDirectParent"] = (
                parent_line[1] if len(parent_line) == 2 else None
            )
            receipt["maatVisualTestRenameAuditBlob"] = audit_blob
            audit_records = [
                record
                for record in parent_delta
                if record["path"] == MAAT_VISUAL_TEST_RENAME_AUDIT_PATH.as_posix()
            ]
            receipt["errors"].extend(
                _validate_maat_visual_test_rename_identity(
                    parent_line=parent_line,
                    base_gitlink=base_gitlink,
                    candidate_gitlink=candidate_gitlink,
                    audit_records=audit_records,
                    audit_blob=audit_blob,
                )
            )
        elif cut_class == CUT_CLASS_FLOW_DETAIL_SURFACE_TEST_RENAME:
            try:
                parent_line = _git_text(
                    parent_root, "rev-list", "--parents", "-n", "1", candidate_parent
                ).split()
                audit_blob = _git_text(
                    parent_root,
                    "rev-parse",
                    (
                        f"{candidate_parent}:"
                        f"{FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix()}"
                    ),
                )
            except (OSError, subprocess.CalledProcessError) as error:
                receipt["errors"].append(
                    "Flow-detail surface test rename identity inspection failed: "
                    f"{error}"
                )
                parent_line = []
                audit_blob = None
            receipt["flowDetailSurfaceTestRenameDirectParent"] = (
                parent_line[1] if len(parent_line) == 2 else None
            )
            receipt["flowDetailSurfaceTestRenameAuditBlob"] = audit_blob
            audit_records = [
                record
                for record in parent_delta
                if record["path"]
                == FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH.as_posix()
            ]
            receipt["errors"].extend(
                _validate_flow_detail_surface_test_rename_identity(
                    parent_line=parent_line,
                    base_gitlink=base_gitlink,
                    candidate_gitlink=candidate_gitlink,
                    audit_records=audit_records,
                    audit_blob=audit_blob,
                )
            )
        try:
            mobile_delta = _parse_name_status(
                mobile_root, base_gitlink, candidate_gitlink
            )
        except (OSError, subprocess.CalledProcessError, ForwardCandidateError) as error:
            receipt["errors"].append(f"mobile delta inspection failed: {error}")
            mobile_delta = None
        receipt["mobileDelta"] = mobile_delta

    receipt["passed"] = not receipt["errors"]
    return receipt


def _posix_relative(path: str, mobile_root: Path | None) -> str:
    normalized = path.replace("\\", "/")
    if mobile_root is not None:
        try:
            return (
                Path(path)
                .resolve()
                .relative_to(mobile_root.resolve())
                .as_posix()
            )
        except (OSError, ValueError):
            root = mobile_root.resolve().as_posix().rstrip("/")
            if normalized.startswith(root + "/"):
                return normalized[len(root) + 1 :]
    return normalized.lstrip("./")


def diagnostic_fingerprint(diagnostic: dict[str, str]) -> tuple[str, str, str, str]:
    return (
        diagnostic["severity"].lower(),
        diagnostic["code"],
        diagnostic["path"].replace("\\", "/"),
        diagnostic["message"],
    )


def _diagnostic_from_mapping(
    raw: dict[str, Any], *, mobile_root: Path | None
) -> dict[str, str] | None:
    location = raw.get("location") if isinstance(raw.get("location"), dict) else {}
    file_path = (
        raw.get("file")
        or raw.get("path")
        or location.get("file")
        or location.get("path")
    )
    message = raw.get("problemMessage") or raw.get("message")
    code = raw.get("code") or raw.get("diagnosticCode")
    severity = raw.get("severity") or raw.get("type")
    if not isinstance(file_path, str) or not isinstance(message, str):
        return None
    if not isinstance(code, str) or not isinstance(severity, str):
        return None
    return {
        "severity": severity.lower(),
        "code": code,
        "path": _posix_relative(file_path, mobile_root),
        "message": message,
    }


def _diagnostics_from_json(value: Any, *, mobile_root: Path | None) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            found.extend(_diagnostics_from_json(item, mobile_root=mobile_root))
        return found
    if not isinstance(value, dict):
        return found
    if "diagnostics" in value:
        found.extend(_diagnostics_from_json(value["diagnostics"], mobile_root=mobile_root))
        return found
    diagnostic = _diagnostic_from_mapping(value, mobile_root=mobile_root)
    if diagnostic is not None:
        found.append(diagnostic)
        return found
    issues = value.get("issues") or value.get("errors")
    if issues is not None:
        found.extend(_diagnostics_from_json(issues, mobile_root=mobile_root))
    return found


def _extract_json_values(text: str) -> list[Any]:
    values: list[Any] = []
    decoder = json.JSONDecoder()
    index = 0
    while index < len(text):
        while index < len(text) and text[index] not in "{[":
            index += 1
        if index >= len(text):
            break
        try:
            value, end = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            index += 1
            continue
        values.append(value)
        index = end
    return values


def parse_analyzer_log(text: str, *, mobile_root: Path | None = None) -> list[dict[str, str]]:
    diagnostics: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()

    def add(diagnostic: dict[str, str]) -> None:
        fingerprint = diagnostic_fingerprint(diagnostic)
        if fingerprint in seen:
            return
        seen.add(fingerprint)
        diagnostics.append(diagnostic)

    for value in _extract_json_values(text):
        for diagnostic in _diagnostics_from_json(value, mobile_root=mobile_root):
            add(diagnostic)
    for line in text.splitlines():
        match = HUMAN_DIAGNOSTIC.fullmatch(line)
        if match is None:
            continue
        add(
            {
                "severity": match.group(1).lower(),
                "code": match.group(6),
                "path": _posix_relative(match.group(3), mobile_root),
                "message": match.group(2),
            }
        )
    return diagnostics


def compare_analyze(
    *,
    base_log: str,
    candidate_log: str,
    base_mobile_root: Path | None = None,
    candidate_mobile_root: Path | None = None,
    base_status: int | None = None,
    candidate_status: int | None = None,
) -> dict[str, Any]:
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "command": "compare-analyze",
        "passed": False,
        "errors": [],
        "baseStatus": base_status,
        "candidateStatus": candidate_status,
    }
    if base_status is not None and base_status not in ANALYZER_SUCCESS_STATUSES:
        receipt["errors"].append(f"base analyzer exited {base_status}")
    if (
        candidate_status is not None
        and candidate_status not in ANALYZER_SUCCESS_STATUSES
    ):
        receipt["errors"].append(f"candidate analyzer exited {candidate_status}")

    base_diagnostics = parse_analyzer_log(base_log, mobile_root=base_mobile_root)
    candidate_diagnostics = parse_analyzer_log(
        candidate_log, mobile_root=candidate_mobile_root
    )
    if base_status == 1 and not base_diagnostics:
        receipt["errors"].append("base analyzer reported issues that could not be parsed")
    if candidate_status == 1 and not candidate_diagnostics:
        receipt["errors"].append(
            "candidate analyzer reported issues that could not be parsed"
        )

    base_set = {diagnostic_fingerprint(item) for item in base_diagnostics}
    candidate_set = {diagnostic_fingerprint(item) for item in candidate_diagnostics}
    new_diagnostics = sorted(candidate_set - base_set)
    dropped_diagnostics = sorted(base_set - candidate_set)
    receipt["baseCount"] = len(base_set)
    receipt["candidateCount"] = len(candidate_set)
    receipt["newDiagnostics"] = [
        {
            "severity": severity,
            "code": code,
            "path": path,
            "message": message,
        }
        for severity, code, path, message in new_diagnostics
    ]
    receipt["droppedDiagnostics"] = [
        {
            "severity": severity,
            "code": code,
            "path": path,
            "message": message,
        }
        for severity, code, path, message in dropped_diagnostics
    ]
    if new_diagnostics:
        receipt["errors"].append(
            "candidate analyzer introduced diagnostics absent from declared base: "
            + "; ".join(
                f"{severity}/{code} {path}: {message}"
                for severity, code, path, message in new_diagnostics
            )
        )
    receipt["passed"] = not receipt["errors"]
    return receipt


@dataclass(frozen=True)
class ForwardTestResult:
    identity: str
    status: str
    category: str
    signature: str
    skip_reason: str


@dataclass(frozen=True)
class MissingTestAuditEntry:
    identity: str
    disposition: str
    replacement_identity: str | None


def load_missing_test_audit(
    path: Path,
    *,
    expected_authority: dict[str, Any] | None = None,
    expected_count: int | None = None,
    authority_label: str = "Reading House release",
) -> dict[str, MissingTestAuditEntry]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ForwardCandidateError(
            f"missing-test audit cannot be read: {error}"
        ) from error
    if not isinstance(raw, dict) or raw.get("schemaVersion") != 1:
        raise ForwardCandidateError("missing-test audit schemaVersion must be 1")
    authority = raw.get("authority")
    if expected_authority is None:
        expected_authority = {
            "declaredBase": READING_HOUSE_RELEASE_DECLARED_BASE,
            "candidateMobile": READING_HOUSE_RELEASE_MOBILE,
            "candidateDirectParent": READING_HOUSE_RELEASE_AUTHORITY_PARENT,
            "expectedMissingCount": READING_HOUSE_RELEASE_MISSING_TEST_COUNT,
        }
    if expected_count is None:
        expected_count = READING_HOUSE_RELEASE_MISSING_TEST_COUNT
    if authority != expected_authority:
        raise ForwardCandidateError(
            "missing-test audit authority must match the exact "
            f"{authority_label} pin: expected={expected_authority}, got={authority}"
        )
    entries = raw.get("entries")
    if not isinstance(entries, list) or len(entries) != expected_count:
        observed = len(entries) if isinstance(entries, list) else None
        raise ForwardCandidateError(
            "missing-test audit must contain exactly "
            f"{expected_count} entries, got {observed}"
        )

    audit: dict[str, MissingTestAuditEntry] = {}
    observed_order: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ForwardCandidateError(
                f"missing-test audit entry {index} must be an object"
            )
        identity = entry.get("identity")
        disposition = entry.get("disposition")
        replacement = entry.get("replacementIdentity")
        if (
            not isinstance(identity, str)
            or not identity.startswith("test/")
            or " :: " not in identity
        ):
            raise ForwardCandidateError(
                f"missing-test audit entry {index} has invalid identity"
            )
        if WILDCARD_CHARS.search(identity):
            raise ForwardCandidateError(
                f"missing-test audit identity may not contain wildcards: {identity}"
            )
        if identity in audit:
            raise ForwardCandidateError(
                f"missing-test audit contains duplicate identity: {identity}"
            )
        if disposition not in {"retired", "replaced"}:
            raise ForwardCandidateError(
                f"missing-test audit entry {identity} must be retired or replaced"
            )
        if disposition == "retired":
            if replacement is not None:
                raise ForwardCandidateError(
                    f"retired audit entry may not name a replacement: {identity}"
                )
        elif (
            not isinstance(replacement, str)
            or not replacement.startswith("test/")
            or " :: " not in replacement
            or replacement == identity
        ):
            raise ForwardCandidateError(
                f"replaced audit entry must name a distinct test identity: {identity}"
            )
        elif WILDCARD_CHARS.search(replacement):
            raise ForwardCandidateError(
                f"replacement identity may not contain wildcards: {replacement}"
            )
        observed_order.append(identity)
        audit[identity] = MissingTestAuditEntry(
            identity=identity,
            disposition=disposition,
            replacement_identity=replacement,
        )
    if observed_order != sorted(observed_order):
        raise ForwardCandidateError(
            "missing-test audit identities must be sorted lexicographically"
        )
    return audit


def resolve_pinned_missing_test_audit(
    *,
    base_parent_root: Path,
    candidate_parent_root: Path,
    candidate_mobile_root: Path,
) -> tuple[
    dict[str, MissingTestAuditEntry] | None,
    dict[str, Any],
    list[str],
]:
    metadata: dict[str, Any] = {"path": None, "applied": False}
    try:
        base_parent = _git_text(base_parent_root, "rev-parse", "HEAD")
        candidate_parent = _git_text(candidate_parent_root, "rev-parse", "HEAD")
        candidate_mobile = _git_text(candidate_mobile_root, "rev-parse", "HEAD")
        candidate_gitlink = _mobile_gitlink(candidate_parent_root, candidate_parent)
        base_gitlink = _mobile_gitlink(base_parent_root, base_parent)
        parent_line = _git_text(
            candidate_parent_root,
            "rev-list",
            "--parents",
            "-n",
            "1",
            candidate_parent,
        ).split()
    except (OSError, subprocess.CalledProcessError) as error:
        return None, metadata, [
            f"missing-test audit identity inspection failed: {error}"
        ]

    direct_parent = parent_line[1] if len(parent_line) == 2 else None
    metadata.update(
        {
            "declaredBase": base_parent,
            "candidateParent": candidate_parent,
            "candidateDirectParent": direct_parent,
            "candidateMobile": candidate_mobile,
            "candidateGitlink": candidate_gitlink,
            "baseGitlink": base_gitlink,
        }
    )
    pins = (
        {
            "label": "Reading House release",
            "declaredBase": READING_HOUSE_RELEASE_DECLARED_BASE,
            "baseMobile": None,
            "directParent": READING_HOUSE_RELEASE_AUTHORITY_PARENT,
            "candidateMobile": READING_HOUSE_RELEASE_MOBILE,
            "path": READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_PATH,
            "blob": READING_HOUSE_RELEASE_MISSING_TEST_AUDIT_BLOB,
            "count": READING_HOUSE_RELEASE_MISSING_TEST_COUNT,
        },
        {
            "label": "Ma’at visual test rename reconciliation",
            "declaredBase": MAAT_VISUAL_TEST_RENAME_DECLARED_BASE,
            "baseMobile": MAAT_VISUAL_TEST_RENAME_BASE_MOBILE,
            "directParent": MAAT_VISUAL_TEST_RENAME_DIRECT_PARENT,
            "candidateMobile": MAAT_VISUAL_TEST_RENAME_MOBILE,
            "path": MAAT_VISUAL_TEST_RENAME_AUDIT_PATH,
            "blob": MAAT_VISUAL_TEST_RENAME_AUDIT_BLOB,
            "count": MAAT_VISUAL_TEST_RENAME_COUNT,
        },
        {
            "label": "Flow-detail surface test rename reconciliation",
            "declaredBase": FLOW_DETAIL_SURFACE_TEST_RENAME_DECLARED_BASE,
            "baseMobile": FLOW_DETAIL_SURFACE_TEST_RENAME_BASE_MOBILE,
            "directParent": FLOW_DETAIL_SURFACE_TEST_RENAME_DIRECT_PARENT,
            "candidateMobile": FLOW_DETAIL_SURFACE_TEST_RENAME_MOBILE,
            "path": FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_PATH,
            "blob": FLOW_DETAIL_SURFACE_TEST_RENAME_AUDIT_BLOB,
            "count": FLOW_DETAIL_SURFACE_TEST_RENAME_COUNT,
        },
        {
            "label": "Kꜣr five-flow release reconciliation",
            "declaredBase": KAR_RELEASE_DECLARED_BASE,
            "baseMobile": KAR_RELEASE_BASE_MOBILE,
            "directParent": KAR_RELEASE_PRODUCT_PARENT,
            "candidateMobile": KAR_RELEASE_MOBILE,
            "path": KAR_RELEASE_TEST_RENAME_AUDIT_PATH,
            "blob": KAR_RELEASE_TEST_RENAME_AUDIT_BLOB,
            "count": KAR_RELEASE_TEST_RENAME_COUNT,
        },
    )
    matching_pins = [
        pin
        for pin in pins
        if base_parent == pin["declaredBase"]
        and direct_parent == pin["directParent"]
        and candidate_mobile == pin["candidateMobile"]
        and candidate_gitlink == pin["candidateMobile"]
        and (pin["baseMobile"] is None or base_gitlink == pin["baseMobile"])
    ]
    if not matching_pins:
        return None, metadata, []
    if len(matching_pins) != 1:
        return None, metadata, ["multiple missing-test audit pins match this cut"]

    pin = matching_pins[0]
    audit_path = pin["path"]
    assert isinstance(audit_path, Path)
    audit_blob_pin = pin["blob"]
    expected_count = pin["count"]
    assert isinstance(audit_blob_pin, str)
    assert isinstance(expected_count, int)
    expected_authority = {
        "declaredBase": pin["declaredBase"],
        "candidateMobile": pin["candidateMobile"],
        "candidateDirectParent": pin["directParent"],
        "expectedMissingCount": expected_count,
    }

    metadata["applied"] = True
    metadata["path"] = audit_path.as_posix()
    metadata["pin"] = pin["label"]
    try:
        audit_blob = _git_text(
            candidate_parent_root,
            "rev-parse",
            f"{candidate_parent}:{audit_path.as_posix()}",
        )
    except (OSError, subprocess.CalledProcessError) as error:
        return None, metadata, [f"missing-test audit blob inspection failed: {error}"]
    metadata["blob"] = audit_blob
    if audit_blob != audit_blob_pin:
        return None, metadata, [
            "missing-test audit blob must remain "
            f"{audit_blob_pin}, got {audit_blob}"
        ]
    try:
        audit = load_missing_test_audit(
            candidate_parent_root / audit_path,
            expected_authority=expected_authority,
            expected_count=expected_count,
            authority_label=str(pin["label"]),
        )
    except ForwardCandidateError as error:
        return None, metadata, [str(error)]
    metadata["entryCount"] = len(audit)
    return audit, metadata, []


def require_parent_pair_layout(parent_root: Path) -> list[str]:
    errors: list[str] = []
    mobile = parent_root / MOBILE_GITLINK_PATH
    supabase = parent_root / "supabase"
    if not mobile.is_dir():
        errors.append(f"parent-pair layout missing mobile/: {parent_root}")
    if not supabase.is_dir():
        errors.append(f"parent-pair layout missing supabase/: {parent_root}")
    return errors


def normalize_failure_signature(text: str) -> str:
    normalized = text.replace("\\", "/")
    normalized = DART_LOCATION_NOISE.sub("<src>:<loc>", normalized)
    normalized = ABS_PATH_NOISE.sub("<path>", normalized)
    normalized = re.sub(r"<path>:\d+(?::\d+)?", "<path>:<loc>", normalized)
    return WHITESPACE_NOISE.sub(" ", normalized).strip()


def _primary_error(test: TestRecord) -> str:
    for item in test.errors:
        error = str(item.get("error") or "").strip()
        if error:
            return error
    for item in test.errors:
        stack = str(item.get("stackTrace") or "").strip()
        if stack:
            return stack.splitlines()[0]
    return test.result


def _classify_failure(test: TestRecord) -> tuple[str, str]:
    error_text = "\n".join(str(item.get("error") or "") for item in test.errors)
    lowered = error_text.lower()
    if "timeout" in lowered or "timed out" in lowered:
        return FORWARD_TIMEOUT, "timeout"
    if test.result == "error":
        return FORWARD_ERROR, "uncaught-runtime-error"
    return FORWARD_FAIL, "assertion-mismatch"


def forward_test_result(test: TestRecord) -> ForwardTestResult:
    if test.skipped:
        return ForwardTestResult(
            identity=test.identity,
            status=FORWARD_SKIP,
            category="skip",
            signature="",
            skip_reason=(test.skip_reason or "").strip(),
        )
    if test.result == "success":
        return ForwardTestResult(
            identity=test.identity,
            status=FORWARD_PASS,
            category="pass",
            signature="",
            skip_reason="",
        )
    status, category = _classify_failure(test)
    return ForwardTestResult(
        identity=test.identity,
        status=status,
        category=category,
        signature=normalize_failure_signature(_primary_error(test)),
        skip_reason="",
    )


def _checkout_test_suites(mobile_root: Path) -> set[str] | None:
    test_root = mobile_root / "test"
    if not test_root.is_dir():
        return None
    return {
        path.relative_to(mobile_root).as_posix()
        for path in test_root.rglob("*_test.dart")
        if path.is_file()
    }


def inventory_from_run(
    run: MachineRun,
    *,
    mobile_root: Path,
    label: str,
) -> tuple[dict[str, ForwardTestResult], list[str]]:
    errors = [f"{label} machine log: {item}" for item in run.stream_errors]
    hidden_failures = sorted(
        test.identity
        for test in run.tests
        if test.hidden and (test.result != "success" or test.skipped)
    )
    if hidden_failures:
        errors.append(
            f"{label} compile/loading tests did not pass; inventory is unreliable: "
            f"{hidden_failures}"
        )

    checkout = _checkout_test_suites(mobile_root)
    if checkout is None:
        errors.append(f"{label} mobile checkout has no test/ directory")
    else:
        missing_suites = sorted(checkout - run.suite_files)
        extra_suites = sorted(run.suite_files - checkout)
        if missing_suites:
            errors.append(
                f"{label} checkout suites missing from machine log: {missing_suites}"
            )
        if extra_suites:
            errors.append(
                f"{label} machine suites absent from checkout: {extra_suites}"
            )

    substantive = [test for test in run.tests if not test.hidden]
    identity_counts: dict[str, int] = {}
    for test in substantive:
        identity_counts[test.identity] = identity_counts.get(test.identity, 0) + 1
    duplicate_ids = sorted(
        identity for identity, count in identity_counts.items() if count > 1
    )
    if duplicate_ids:
        errors.append(f"{label} duplicate stable test IDs: {duplicate_ids}")

    inventory: dict[str, ForwardTestResult] = {}
    for test in substantive:
        if identity_counts.get(test.identity, 0) != 1:
            continue
        if test.result not in {"success", "failure", "error"}:
            errors.append(
                f"{label} test {test.identity} has invalid result {test.result!r}"
            )
            continue
        inventory[test.identity] = forward_test_result(test)
    return inventory, errors


def _same_failure(base: ForwardTestResult, candidate: ForwardTestResult) -> bool:
    return (
        base.status == candidate.status
        and base.category == candidate.category
        and base.signature == candidate.signature
    )


def _same_skip(base: ForwardTestResult, candidate: ForwardTestResult) -> bool:
    return (
        base.status == FORWARD_SKIP
        and candidate.status == FORWARD_SKIP
        and base.skip_reason == candidate.skip_reason
    )


def _result_payload(result: ForwardTestResult) -> dict[str, str]:
    return {
        "id": result.identity,
        "status": result.status,
        "category": result.category,
        "signature": result.signature,
        "skipReason": result.skip_reason,
    }


def compare_test_inventories(
    base: dict[str, ForwardTestResult],
    candidate: dict[str, ForwardTestResult],
    *,
    missing_test_audit: dict[str, MissingTestAuditEntry] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    persisting: list[dict[str, str]] = []
    improvements: list[str] = []
    new_passing: list[str] = []
    regressions: list[dict[str, Any]] = []
    audited_missing: list[dict[str, str]] = []

    def reject(identity: str, reason: str, **extra: Any) -> None:
        errors.append(f"{identity}: {reason}")
        regressions.append({"id": identity, "reason": reason, **extra})

    actual_missing = set(base) - set(candidate)
    if missing_test_audit is not None:
        audited_identities = set(missing_test_audit)
        if actual_missing != audited_identities:
            errors.append(
                "pinned missing-test audit does not exactly match this cut: "
                f"unapproved={sorted(actual_missing - audited_identities)}, "
                f"notMissing={sorted(audited_identities - actual_missing)}"
            )

    for identity in sorted(set(base) | set(candidate)):
        base_result = base.get(identity)
        candidate_result = candidate.get(identity)
        if base_result is None:
            assert candidate_result is not None
            if candidate_result.status == FORWARD_PASS:
                new_passing.append(identity)
            else:
                reject(
                    identity,
                    f"new test is {candidate_result.status}",
                    candidate=_result_payload(candidate_result),
                )
            continue
        if candidate_result is None:
            audit_entry = (
                missing_test_audit.get(identity)
                if missing_test_audit is not None
                else None
            )
            if audit_entry is not None:
                audited_payload = {
                    "id": identity,
                    "disposition": audit_entry.disposition,
                }
                if audit_entry.replacement_identity is not None:
                    replacement = candidate.get(audit_entry.replacement_identity)
                    audited_payload["replacementIdentity"] = (
                        audit_entry.replacement_identity
                    )
                    if replacement is None or replacement.status != FORWARD_PASS:
                        reject(
                            identity,
                            "audited replacement is not a passing candidate test",
                            replacementIdentity=audit_entry.replacement_identity,
                        )
                        continue
                audited_missing.append(audited_payload)
                continue
            reject(
                identity,
                "test missing from candidate",
                base=_result_payload(base_result),
            )
            continue
        if base_result.status == FORWARD_PASS:
            if candidate_result.status == FORWARD_PASS:
                continue
            reject(
                identity,
                f"PASS → {candidate_result.status}",
                base=_result_payload(base_result),
                candidate=_result_payload(candidate_result),
            )
            continue
        if base_result.status in FAILURE_STATUSES:
            if candidate_result.status == FORWARD_PASS:
                improvements.append(identity)
                continue
            if _same_failure(base_result, candidate_result):
                persisting.append(_result_payload(base_result))
                continue
            reject(
                identity,
                (
                    f"{base_result.status}/{base_result.category} → "
                    f"{candidate_result.status}/{candidate_result.category}"
                ),
                base=_result_payload(base_result),
                candidate=_result_payload(candidate_result),
            )
            continue
        if base_result.status == FORWARD_SKIP:
            if candidate_result.status == FORWARD_PASS:
                improvements.append(identity)
                continue
            if _same_skip(base_result, candidate_result):
                continue
            reject(
                identity,
                (
                    "SKIP reason changed"
                    if candidate_result.status == FORWARD_SKIP
                    else f"SKIP → {candidate_result.status}"
                ),
                base=_result_payload(base_result),
                candidate=_result_payload(candidate_result),
            )
            continue
        reject(
            identity,
            f"unclassified base status {base_result.status}",
            base=_result_payload(base_result),
            candidate=_result_payload(candidate_result),
        )

    return {
        "errors": errors,
        "persistingBaselineFailures": persisting,
        "improvements": improvements,
        "newPassingTests": new_passing,
        "auditedMissingTests": audited_missing,
        "regressions": regressions,
    }


def compare_test(
    *,
    base_log: Path,
    candidate_log: Path,
    base_mobile_root: Path,
    candidate_mobile_root: Path,
    base_parent_root: Path,
    candidate_parent_root: Path,
    base_status: int | None = None,
    candidate_status: int | None = None,
) -> dict[str, Any]:
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "command": "compare-test",
        "passed": False,
        "errors": [],
        "baseStatus": base_status,
        "candidateStatus": candidate_status,
        "persistingBaselineFailures": [],
        "improvements": [],
        "newPassingTests": [],
        "auditedMissingTests": [],
        "missingTestAudit": {"path": None, "applied": False},
        "regressions": [],
    }
    receipt["errors"].extend(require_parent_pair_layout(base_parent_root))
    receipt["errors"].extend(require_parent_pair_layout(candidate_parent_root))
    if base_status not in TEST_HARNESS_STATUSES:
        receipt["errors"].append(
            "base test harness exited "
            f"{base_status}; inventory cannot be authorized"
        )
    if candidate_status not in TEST_HARNESS_STATUSES:
        receipt["errors"].append(
            "candidate test harness exited "
            f"{candidate_status}; inventory cannot be authorized"
        )

    base_run = load_machine_run(base_log, base_mobile_root)
    candidate_run = load_machine_run(candidate_log, candidate_mobile_root)
    base_inventory, base_errors = inventory_from_run(
        base_run, mobile_root=base_mobile_root, label="base"
    )
    candidate_inventory, candidate_errors = inventory_from_run(
        candidate_run, mobile_root=candidate_mobile_root, label="candidate"
    )
    receipt["errors"].extend(base_errors)
    receipt["errors"].extend(candidate_errors)

    missing_test_audit, audit_metadata, audit_errors = (
        resolve_pinned_missing_test_audit(
            base_parent_root=base_parent_root,
            candidate_parent_root=candidate_parent_root,
            candidate_mobile_root=candidate_mobile_root,
        )
    )
    receipt["missingTestAudit"] = audit_metadata
    receipt["errors"].extend(audit_errors)

    def _status_conflicts(
        label: str,
        status: int | None,
        inventory: dict[str, ForwardTestResult],
    ) -> None:
        has_failures = any(
            item.status in FAILURE_STATUSES for item in inventory.values()
        )
        if status == 0 and has_failures:
            receipt["errors"].append(
                f"{label} flutter test exited 0 but inventory contains failures"
            )
        if status == 1 and inventory and not has_failures:
            receipt["errors"].append(
                f"{label} flutter test exited 1 but inventory has no failures"
            )

    if not receipt["errors"]:
        _status_conflicts("base", base_status, base_inventory)
        _status_conflicts("candidate", candidate_status, candidate_inventory)

    if receipt["errors"]:
        return receipt

    compared = compare_test_inventories(
        base_inventory,
        candidate_inventory,
        missing_test_audit=missing_test_audit,
    )
    receipt["persistingBaselineFailures"] = compared["persistingBaselineFailures"]
    receipt["improvements"] = compared["improvements"]
    receipt["newPassingTests"] = compared["newPassingTests"]
    receipt["auditedMissingTests"] = compared["auditedMissingTests"]
    receipt["regressions"] = compared["regressions"]
    receipt["errors"].extend(compared["errors"])
    receipt["baseCount"] = len(base_inventory)
    receipt["candidateCount"] = len(candidate_inventory)
    receipt["passed"] = not receipt["errors"]
    return receipt


def verify_worktree_clean(*, parent_root: Path, mobile_root: Path) -> dict[str, Any]:
    parent_status = _git_text(parent_root, "status", "--porcelain=v1")
    mobile_status = _git_text(mobile_root, "status", "--porcelain=v1")
    errors: list[str] = []
    if parent_status:
        errors.append(f"parent worktree/index is dirty: {parent_status}")
    if mobile_status:
        errors.append(f"mobile worktree/index is dirty: {mobile_status}")
    return {
        "schemaVersion": 1,
        "command": "verify-worktree-clean",
        "passed": not errors,
        "errors": errors,
    }


def validate_forward_workflow(path: Path) -> dict[str, Any]:
    source = path.read_text(encoding="utf-8")
    aggregate = _job_block(source, "lock-gate-required")
    if "if: always()" not in aggregate:
        raise ForwardCandidateError(
            "LOCK-GATE required must evaluate cancelled/errored/skipped dependencies"
        )
    for job_id in REQUIRED_AGGREGATE_JOBS:
        if not re.search(rf"(?m)^      - {re.escape(job_id)}\s*$", aggregate):
            raise ForwardCandidateError(
                f"LOCK-GATE required does not need {job_id}"
            )
        assertion = f'${{{{ needs.{job_id}.result }}}}" = "success"'
        if assertion not in aggregate:
            raise ForwardCandidateError(
                f"LOCK-GATE required does not fail closed on {job_id}"
            )

    historical = _job_block(source, "mobile-fast-suite")
    if "needs.resolve-historical-pair.outputs.parent" not in historical:
        raise ForwardCandidateError(
            "July 1 source-integrity job does not checkout the resolved historical pair"
        )
    if "$GITHUB_SHA" in historical:
        raise ForwardCandidateError(
            "July 1 source-integrity job still verifies GITHUB_SHA as the recovery pair"
        )

    runtime = _job_block(source, "forward-candidate-runtime")
    if "continue-on-error:" in runtime:
        raise ForwardCandidateError("forward-candidate-runtime may not continue on error")
    if re.search(r"(?m)^    if:", runtime):
        raise ForwardCandidateError("forward-candidate-runtime may not be conditionally skipped")
    missing = [
        command
        for command in REQUIRED_FORWARD_RUNTIME_COMMANDS
        if command not in runtime
    ]
    if missing:
        raise ForwardCandidateError(
            f"forward-candidate-runtime lacks required commands: {missing}"
        )
    if "july1_runtime_gate.py evaluate-full" in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must not evaluate the current suite "
            "against July 1 inventory authority"
        )
    if "july1_runtime_gate.py verify-checkout" in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must not apply July 1 verify-checkout "
            "to the current candidate"
        )
    if "compare-analyze" not in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must compare candidate analyzer output "
            "to the declared-base analyzer output"
        )
    if "compare-test" not in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must compare candidate test results "
            "to the declared-base test results"
        )
    if "tests-base.jsonl" not in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must run the declared-base test suite "
            "in the parent-pair layout"
        )
    if "acceptedDebt" in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must not consult July accepted debt"
        )
    if "july1-recovery.v1.json" in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must not read the July 1 recovery profile"
        )
    if "declared-base" not in runtime:
        raise ForwardCandidateError(
            "forward-candidate-runtime must materialize the declared base pair "
            "for analyzer comparison"
        )
    return {
        "workflow": path.as_posix(),
        "aggregate_job": "lock-gate-required",
        "required_jobs": list(REQUIRED_AGGREGATE_JOBS),
        "forward_runtime_job": "forward-candidate-runtime",
    }


def _write_json(path: Path | None, payload: dict[str, Any]) -> None:
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if path is None:
        sys.stdout.write(text)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _fail_if_needed(receipt: dict[str, Any]) -> int:
    if receipt.get("passed"):
        return 0
    errors = receipt.get("errors") or ["forward candidate gate failed"]
    for error in errors:
        print(f"FORWARD CANDIDATE GATE: FAIL: {error}", file=sys.stderr)
    return 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    resolve = sub.add_parser("resolve-historical")
    resolve.add_argument("--profile", type=Path, default=JULY1_PROFILE_PATH)
    resolve.add_argument("--parent-root", type=Path, default=Path("."))
    resolve.add_argument("--historical-root", type=Path, required=True)
    resolve.add_argument("--output", type=Path)

    forward = sub.add_parser("verify-forward")
    forward.add_argument("--parent-root", type=Path, default=Path("."))
    forward.add_argument("--mobile-root", type=Path, default=Path("mobile"))
    forward.add_argument("--declared-base", required=True)
    forward.add_argument("--output", type=Path)

    clean = sub.add_parser("verify-worktree-clean")
    clean.add_argument("--parent-root", type=Path, default=Path("."))
    clean.add_argument("--mobile-root", type=Path, default=Path("mobile"))
    clean.add_argument("--output", type=Path)

    analyze = sub.add_parser("compare-analyze")
    analyze.add_argument("--base-log", type=Path, required=True)
    analyze.add_argument("--candidate-log", type=Path, required=True)
    analyze.add_argument("--base-mobile-root", type=Path)
    analyze.add_argument("--candidate-mobile-root", type=Path)
    analyze.add_argument("--base-status", type=int)
    analyze.add_argument("--candidate-status", type=int)
    analyze.add_argument("--output", type=Path)

    tests = sub.add_parser("compare-test")
    tests.add_argument("--base-log", type=Path, required=True)
    tests.add_argument("--candidate-log", type=Path, required=True)
    tests.add_argument("--base-mobile-root", type=Path, required=True)
    tests.add_argument("--candidate-mobile-root", type=Path, required=True)
    tests.add_argument("--base-parent-root", type=Path, required=True)
    tests.add_argument("--candidate-parent-root", type=Path, required=True)
    tests.add_argument("--base-status", type=int, required=True)
    tests.add_argument("--candidate-status", type=int, required=True)
    tests.add_argument("--output", type=Path)

    workflow = sub.add_parser("validate-workflow")
    workflow.add_argument("--workflow", type=Path, default=WORKFLOW_PATH)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        if arguments.command == "validate-workflow":
            result = validate_forward_workflow(arguments.workflow)
            print(
                "FORWARD CANDIDATE GATE: PASS "
                f"aggregate={result['aggregate_job']} "
                f"runtime={result['forward_runtime_job']}"
            )
            return 0
        if arguments.command == "resolve-historical":
            receipt = resolve_historical_parent(
                parent_root=arguments.parent_root,
                profile_path=arguments.profile,
            )
            if receipt.get("historicalParent") and not receipt["errors"]:
                historical_parent = receipt["historicalParent"]
                materialize_historical_pair(
                    parent_root=arguments.parent_root,
                    historical_parent=historical_parent,
                    historical_root=arguments.historical_root,
                )
                checkout = verify_historical_pair(
                    profile_path=arguments.profile,
                    historical_root=arguments.historical_root,
                    historical_parent=historical_parent,
                )
                receipt["verifyCheckout"] = checkout
                if not checkout.get("passed"):
                    receipt["errors"].extend(
                        checkout.get("errors")
                        or ["historical verify-checkout failed"]
                    )
                else:
                    receipt["passed"] = True
            _write_json(arguments.output, receipt)
            if receipt.get("passed") and receipt.get("historicalParent"):
                print(f"HISTORICAL_PARENT={receipt['historicalParent']}")
            return _fail_if_needed(receipt)
        if arguments.command == "verify-forward":
            receipt = verify_forward(
                parent_root=arguments.parent_root,
                mobile_root=arguments.mobile_root,
                declared_base=arguments.declared_base,
            )
            _write_json(arguments.output, receipt)
            return _fail_if_needed(receipt)
        if arguments.command == "compare-analyze":
            receipt = compare_analyze(
                base_log=arguments.base_log.read_text(encoding="utf-8"),
                candidate_log=arguments.candidate_log.read_text(encoding="utf-8"),
                base_mobile_root=arguments.base_mobile_root,
                candidate_mobile_root=arguments.candidate_mobile_root,
                base_status=arguments.base_status,
                candidate_status=arguments.candidate_status,
            )
            _write_json(arguments.output, receipt)
            return _fail_if_needed(receipt)
        if arguments.command == "compare-test":
            receipt = compare_test(
                base_log=arguments.base_log,
                candidate_log=arguments.candidate_log,
                base_mobile_root=arguments.base_mobile_root,
                candidate_mobile_root=arguments.candidate_mobile_root,
                base_parent_root=arguments.base_parent_root,
                candidate_parent_root=arguments.candidate_parent_root,
                base_status=arguments.base_status,
                candidate_status=arguments.candidate_status,
            )
            _write_json(arguments.output, receipt)
            return _fail_if_needed(receipt)
        receipt = verify_worktree_clean(
            parent_root=arguments.parent_root,
            mobile_root=arguments.mobile_root,
        )
        _write_json(arguments.output, receipt)
        return _fail_if_needed(receipt)
    except (OSError, ForwardCandidateError) as error:
        print(f"FORWARD CANDIDATE GATE: FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
