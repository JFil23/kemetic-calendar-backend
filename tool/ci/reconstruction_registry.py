#!/usr/bin/env python3
"""Validate Kemet's sole append-only reconstruction authority.

The JSONL registry is deliberately derived from immutable predecessor evidence.
This module validates both the evidence and the exact mechanical import before
it accepts any later appended events.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import subprocess
import sys
import tarfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping, Sequence


SCHEMA_VERSION = 1
REGISTRY_PATH = Path("stabilization/reconstruction-registry.v1.jsonl")
PREDECESSOR_DIRECTORY = Path(
    "stabilization/evidence/reconstruction-registry-v1/predecessor"
)
PREDECESSOR_ARCHIVE = PREDECESSOR_DIRECTORY / (
    "kemetic-stabilization-reconstruction-001-phase01.tar.gz"
)
PREDECESSOR_ARCHIVE_SHA256 = (
    "9bceb49a7fd6a9d040c4cfcd936b95a12036cad715b209d945957d4f25c1c837"
)

CSV_SPECS: tuple[dict[str, Any], ...] = (
    {
        "filename": "artifact-registry.csv",
        "path": PREDECESSOR_DIRECTORY / "artifact-registry.csv",
        "sha256": (
            "9629dc055508889ef56cfe011c45d0c7b6e5718363a4f9fc66755e5c9ff73c47"
        ),
        "eventKind": "artifact",
        "rowCount": 7,
        "header": (
            "artifact",
            "source_checkpoint",
            "archive_sha256",
            "manifest_sha256",
            "build_identity",
            "immutable_origin",
            "classification",
        ),
    },
    {
        "filename": "checkpoint-registry.csv",
        "path": PREDECESSOR_DIRECTORY / "checkpoint-registry.csv",
        "sha256": (
            "86e48a3b092643fddd87a8d199adab560f9c78adf5c74b9aaddf69649d551c79"
        ),
        "eventKind": "checkpoint",
        "rowCount": 7,
        "header": (
            "checkpoint",
            "parent_sha",
            "parent_tree",
            "mobile_sha",
            "mobile_tree",
            "classification",
        ),
    },
)

POLICIES: tuple[tuple[str, str], ...] = (
    (
        "policy-001-reconstructed-artifacts-use-closed-builder",
        "Reconstructed A–G artifacts use the new closed builder.",
    ),
    (
        "policy-002-reconstructed-hashes-need-not-match-history",
        "Reconstructed archive hashes are not expected to equal historical hashes.",
    ),
    (
        "policy-003-historical-artifact-evidence-remains-authoritative",
        "Historical artifact hashes and artifact-specific evidence remain authoritative "
        "for those historical artifacts.",
    ),
    (
        "policy-004-evidence-never-transfers-between-artifacts",
        "Evidence never transfers between artifacts merely because they share a source "
        "SHA.",
    ),
    (
        "policy-005-d3-source-checkpoint-remains-rejected",
        "Source checkpoint d3ebcc216c2626b9df463f7e2ab2c8b6dcd57e5a remains "
        "REJECTED_COMBINED_STACK.",
    ),
    (
        "policy-006-d3-historical-archives-remain-independently-rejected",
        "The two historical d3ebcc216c2626b9df463f7e2ab2c8b6dcd57e5a archives "
        "remain independently classified and rejected.",
    ),
    (
        "policy-007-rc-label-is-not-build-identity",
        "rc-198d9d4 is a stable channel label—not a source, artifact, or current build "
        "identity.",
    ),
    (
        "policy-008-runtime-receipt-is-build-authority",
        "Runtime receipt/configuration identity is the build authority.",
    ),
    (
        "policy-009-immutable-bytes-stable-origin-continuity",
        "Immutable URLs verify exact bytes; the stable RC alias owns installed-origin, "
        "storage, OAuth, and service-worker continuity.",
    ),
)

EVENT_KEYS = {
    "schemaVersion",
    "sequence",
    "eventId",
    "eventKind",
    "previousEventSha256",
    "eventSha256",
    "payload",
}
FUTURE_EVENT_KINDS = {"artifact", "checkpoint", "policy"}
PREDECESSOR_IMPORT_PAYLOAD_KEYS = {
    "predecessorFilename",
    "predecessorPath",
    "predecessorRowNumber",
    "originalRow",
    "originalRowSha256",
}


class RegistryValidationError(ValueError):
    """A fail-closed reconstruction registry validation error."""


@dataclass(frozen=True)
class RegistrySummary:
    event_count: int
    seed_event_count: int
    appended_event_count: int
    final_event_sha256: str


def canonical_json_bytes(value: Any) -> bytes:
    """Return the one permitted JSON representation."""

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_event(
    *,
    sequence: int,
    event_id: str,
    event_kind: str,
    payload: Mapping[str, Any],
    previous_event_sha256: str | None,
) -> dict[str, Any]:
    """Construct a canonical hash-chained event."""

    event_without_hash: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "sequence": sequence,
        "eventId": event_id,
        "eventKind": event_kind,
        "previousEventSha256": previous_event_sha256,
        "payload": dict(payload),
    }
    return {
        **event_without_hash,
        "eventSha256": sha256_bytes(canonical_json_bytes(event_without_hash)),
    }


def registry_bytes(events: Iterable[Mapping[str, Any]]) -> bytes:
    return b"".join(canonical_json_bytes(event) + b"\n" for event in events)


def _require_file_hash(path: Path, expected_sha256: str) -> bytes:
    try:
        content = path.read_bytes()
    except OSError as error:
        raise RegistryValidationError(
            f"required predecessor evidence is unavailable: {path}: {error}"
        ) from error
    actual_sha256 = sha256_bytes(content)
    if actual_sha256 != expected_sha256:
        raise RegistryValidationError(
            f"predecessor evidence hash mismatch for {path}: "
            f"expected {expected_sha256}, got {actual_sha256}"
        )
    return content


def _safe_archive_member_name(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts


def load_predecessor_evidence(repo_root: Path) -> dict[str, bytes]:
    """Verify all predecessor hashes and the CSV copies embedded in the archive."""

    archive_path = repo_root / PREDECESSOR_ARCHIVE
    archive_bytes = _require_file_hash(archive_path, PREDECESSOR_ARCHIVE_SHA256)

    csv_bytes: dict[str, bytes] = {}
    for specification in CSV_SPECS:
        csv_path = repo_root / specification["path"]
        csv_bytes[specification["filename"]] = _require_file_hash(
            csv_path, specification["sha256"]
        )

    try:
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
            members = archive.getmembers()
            if any(not _safe_archive_member_name(member.name) for member in members):
                raise RegistryValidationError(
                    "predecessor archive contains an unsafe member path"
                )
            for specification in CSV_SPECS:
                filename = specification["filename"]
                matches = [
                    member
                    for member in members
                    if PurePosixPath(member.name).name == filename
                ]
                if len(matches) != 1:
                    raise RegistryValidationError(
                        f"predecessor archive must contain exactly one {filename}; "
                        f"found {len(matches)}"
                    )
                member = matches[0]
                if not member.isfile():
                    raise RegistryValidationError(
                        f"predecessor archive entry is not a regular file: {member.name}"
                    )
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise RegistryValidationError(
                        f"could not read predecessor archive entry: {member.name}"
                    )
                embedded_bytes = extracted.read()
                if embedded_bytes != csv_bytes[filename]:
                    raise RegistryValidationError(
                        f"archive-contained {filename} is not byte-identical to the "
                        "tracked predecessor copy"
                    )
    except (tarfile.TarError, OSError) as error:
        raise RegistryValidationError(
            f"could not validate predecessor archive {archive_path}: {error}"
        ) from error

    return csv_bytes


def _read_csv_rows(
    content: bytes, specification: Mapping[str, Any]
) -> list[dict[str, str]]:
    filename = specification["filename"]
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RegistryValidationError(
            f"{filename} is not valid UTF-8: {error}"
        ) from error
    if not text.endswith("\n"):
        raise RegistryValidationError(f"{filename} must end with a newline")

    reader = csv.DictReader(io.StringIO(text, newline=""))
    actual_header = tuple(reader.fieldnames or ())
    expected_header = tuple(specification["header"])
    if actual_header != expected_header:
        raise RegistryValidationError(
            f"{filename} header mismatch: expected {expected_header}, got {actual_header}"
        )

    rows: list[dict[str, str]] = []
    for row_number, row in enumerate(reader, start=2):
        if None in row:
            raise RegistryValidationError(
                f"{filename} row {row_number} has unexpected extra columns"
            )
        if any(value is None for value in row.values()):
            raise RegistryValidationError(
                f"{filename} row {row_number} has missing columns"
            )
        rows.append({field: row[field] for field in expected_header})

    expected_count = specification["rowCount"]
    if len(rows) != expected_count:
        raise RegistryValidationError(
            f"{filename} row-count mismatch: expected {expected_count}, got {len(rows)}"
        )
    return rows


def build_seed_events(repo_root: Path) -> list[dict[str, Any]]:
    """Mechanically derive the immutable 24-event seed."""

    csv_bytes = load_predecessor_evidence(repo_root)
    parsed_rows = {
        specification["filename"]: _read_csv_rows(
            csv_bytes[specification["filename"]], specification
        )
        for specification in CSV_SPECS
    }

    events: list[dict[str, Any]] = []

    def append_event(event_id: str, event_kind: str, payload: Mapping[str, Any]) -> None:
        previous = events[-1]["eventSha256"] if events else None
        events.append(
            make_event(
                sequence=len(events) + 1,
                event_id=event_id,
                event_kind=event_kind,
                payload=payload,
                previous_event_sha256=previous,
            )
        )

    append_event(
        "authority-reconstruction-registry-v1",
        "authority",
        {
            "schemaVersion": SCHEMA_VERSION,
            "registryPath": REGISTRY_PATH.as_posix(),
            "predecessorArchive": {
                "path": PREDECESSOR_ARCHIVE.as_posix(),
                "sha256": PREDECESSOR_ARCHIVE_SHA256,
            },
            "predecessorCsvs": [
                {
                    "path": specification["path"].as_posix(),
                    "sha256": specification["sha256"],
                    "eventKind": specification["eventKind"],
                    "importedRowCount": specification["rowCount"],
                }
                for specification in CSV_SPECS
            ],
            "historicalImportedEventsImmutable": True,
            "futureChangesAppendOnly": True,
            "predecessorCsvsAreEvidenceOnly": True,
        },
    )

    for specification in CSV_SPECS:
        filename = specification["filename"]
        event_kind = specification["eventKind"]
        for row_number, original_row in enumerate(parsed_rows[filename], start=2):
            row_sha256 = sha256_bytes(canonical_json_bytes(original_row))
            append_event(
                f"import-{event_kind}-{row_number:03d}-{row_sha256[:16]}",
                event_kind,
                {
                    "predecessorFilename": filename,
                    "predecessorPath": specification["path"].as_posix(),
                    "predecessorRowNumber": row_number,
                    "originalRow": original_row,
                    "originalRowSha256": row_sha256,
                },
            )

    for event_id, statement in POLICIES:
        append_event(event_id, "policy", {"statement": statement})

    return events


def build_seed_bytes(repo_root: Path) -> bytes:
    return registry_bytes(build_seed_events(repo_root))


def _parse_registry_lines(content: bytes) -> list[dict[str, Any]]:
    if not content:
        raise RegistryValidationError("registry is empty")
    if not content.endswith(b"\n"):
        raise RegistryValidationError("registry must end with a newline")

    events: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(content.splitlines(keepends=True), start=1):
        if raw_line == b"\n":
            raise RegistryValidationError(
                f"registry line {line_number} must not be blank"
            )
        try:
            event = json.loads(raw_line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RegistryValidationError(
                f"registry line {line_number} is malformed JSON: {error}"
            ) from error
        if not isinstance(event, dict):
            raise RegistryValidationError(
                f"registry line {line_number} must contain a JSON object"
            )
        expected_line = canonical_json_bytes(event) + b"\n"
        if raw_line != expected_line:
            raise RegistryValidationError(
                f"registry line {line_number} is not canonical JSON"
            )
        events.append(event)
    return events


def _validate_event_chain(events: Sequence[Mapping[str, Any]]) -> None:
    seen_ids: set[str] = set()
    previous_sha256: str | None = None
    for index, event in enumerate(events, start=1):
        if set(event) != EVENT_KEYS:
            raise RegistryValidationError(
                f"event {index} keys mismatch: expected {sorted(EVENT_KEYS)}, "
                f"got {sorted(event)}"
            )
        if event["schemaVersion"] != SCHEMA_VERSION:
            raise RegistryValidationError(
                f"event {index} has unsupported schemaVersion"
            )
        if (
            not isinstance(event["sequence"], int)
            or isinstance(event["sequence"], bool)
            or event["sequence"] != index
        ):
            raise RegistryValidationError(
                f"event {index} sequence mismatch: got {event['sequence']!r}"
            )
        event_id = event["eventId"]
        if not isinstance(event_id, str) or not event_id:
            raise RegistryValidationError(f"event {index} has an invalid eventId")
        if event_id in seen_ids:
            raise RegistryValidationError(f"duplicate eventId: {event_id}")
        seen_ids.add(event_id)
        if event["previousEventSha256"] != previous_sha256:
            raise RegistryValidationError(
                f"event {index} previousEventSha256 does not match the chain"
            )
        if not isinstance(event["payload"], dict):
            raise RegistryValidationError(f"event {index} payload must be an object")

        event_without_hash = {
            key: value for key, value in event.items() if key != "eventSha256"
        }
        expected_sha256 = sha256_bytes(canonical_json_bytes(event_without_hash))
        if event["eventSha256"] != expected_sha256:
            raise RegistryValidationError(
                f"event {index} eventSha256 mismatch: expected {expected_sha256}, "
                f"got {event['eventSha256']!r}"
            )
        previous_sha256 = expected_sha256


def validate_registry_bytes(content: bytes, repo_root: Path) -> RegistrySummary:
    events = _parse_registry_lines(content)
    _validate_event_chain(events)

    expected_seed = build_seed_events(repo_root)
    if len(events) < len(expected_seed):
        raise RegistryValidationError(
            f"registry deleted immutable seed events: expected at least "
            f"{len(expected_seed)}, got {len(events)}"
        )
    for index, expected_event in enumerate(expected_seed):
        if events[index] != expected_event:
            raise RegistryValidationError(
                f"immutable seed event {index + 1} was edited, reordered, or replaced"
            )

    for index, event in enumerate(
        events[len(expected_seed) :], start=len(expected_seed) + 1
    ):
        if (
            not isinstance(event["eventKind"], str)
            or event["eventKind"] not in FUTURE_EVENT_KINDS
        ):
            raise RegistryValidationError(
                f"appended event {index} has unsupported eventKind "
                f"{event['eventKind']!r}"
            )
        reserved_keys = PREDECESSOR_IMPORT_PAYLOAD_KEYS.intersection(event["payload"])
        if reserved_keys:
            raise RegistryValidationError(
                f"appended event {index} attempts to re-import predecessor evidence "
                f"through reserved payload keys: {sorted(reserved_keys)}"
            )

    return RegistrySummary(
        event_count=len(events),
        seed_event_count=len(expected_seed),
        appended_event_count=len(events) - len(expected_seed),
        final_event_sha256=events[-1]["eventSha256"],
    )


def validate_append_only(current: bytes, base: bytes) -> None:
    """Require the current registry to preserve every base byte as a prefix."""

    if not base:
        raise RegistryValidationError("append-only base registry is empty")
    if not base.endswith(b"\n"):
        raise RegistryValidationError(
            "append-only base registry does not end at an event boundary"
        )
    if len(current) < len(base):
        raise RegistryValidationError("registry removed bytes from its append-only base")
    if current[: len(base)] != base:
        raise RegistryValidationError(
            "registry does not preserve its append-only base as an exact byte prefix"
        )


def _repo_relative_registry_path(repo_root: Path, registry_path: Path) -> str:
    try:
        return registry_path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError as error:
        raise RegistryValidationError(
            "registry must be inside the repository when validating a git base"
        ) from error


def _read_git_base(
    *, repo_root: Path, registry_path: Path, git_ref: str
) -> bytes | None:
    verify = subprocess.run(
        ["git", "rev-parse", "--verify", f"{git_ref}^{{commit}}"],
        cwd=repo_root,
        capture_output=True,
        check=False,
        text=True,
    )
    if verify.returncode != 0:
        raise RegistryValidationError(
            f"append-only git base is not a valid commit: {git_ref}"
        )

    relative_path = _repo_relative_registry_path(repo_root, registry_path)
    exists = subprocess.run(
        ["git", "cat-file", "-e", f"{git_ref}:{relative_path}"],
        cwd=repo_root,
        capture_output=True,
        check=False,
    )
    if exists.returncode != 0:
        return None
    show = subprocess.run(
        ["git", "show", f"{git_ref}:{relative_path}"],
        cwd=repo_root,
        capture_output=True,
        check=False,
    )
    if show.returncode != 0:
        raise RegistryValidationError(
            f"could not read append-only registry from git base {git_ref}"
        )
    return show.stdout


def validate_registry_file(
    *,
    repo_root: Path,
    registry_path: Path,
    base_file: Path | None = None,
    base_git_ref: str | None = None,
    require_seed_only: bool = False,
) -> RegistrySummary:
    if base_file is not None and base_git_ref is not None:
        raise RegistryValidationError(
            "--base-file and --base-git-ref are mutually exclusive"
        )

    try:
        content = registry_path.read_bytes()
    except OSError as error:
        raise RegistryValidationError(
            f"could not read registry {registry_path}: {error}"
        ) from error
    summary = validate_registry_bytes(content, repo_root)
    seed = build_seed_bytes(repo_root)

    if require_seed_only and content != seed:
        raise RegistryValidationError(
            "initial registry must equal the exact deterministic seed"
        )

    if base_file is not None:
        try:
            base = base_file.read_bytes()
        except OSError as error:
            raise RegistryValidationError(
                f"could not read append-only base {base_file}: {error}"
            ) from error
        validate_registry_bytes(base, repo_root)
        validate_append_only(content, base)

    if base_git_ref is not None:
        base = _read_git_base(
            repo_root=repo_root,
            registry_path=registry_path,
            git_ref=base_git_ref,
        )
        if base is None:
            if content != seed:
                raise RegistryValidationError(
                    "registry is absent from the git base, so the initial addition "
                    "must equal the exact deterministic seed"
                )
        else:
            validate_registry_bytes(base, repo_root)
            validate_append_only(content, base)

    return summary


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    default_repo_root = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=default_repo_root,
        help="parent repository root (default: inferred from this script)",
    )
    parser.add_argument(
        "--registry",
        type=Path,
        help="registry path (default: <repo-root>/stabilization/reconstruction-registry.v1.jsonl)",
    )
    parser.add_argument(
        "--base-file",
        type=Path,
        help="previous registry bytes that the current registry must extend",
    )
    parser.add_argument(
        "--base-git-ref",
        help="git commit whose registry must be an exact byte prefix",
    )
    parser.add_argument(
        "--require-seed-only",
        action="store_true",
        help="reject any event beyond the deterministic 24-event initial seed",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _argument_parser().parse_args(argv)
    repo_root = arguments.repo_root.resolve()
    registry_path = (
        arguments.registry.resolve()
        if arguments.registry is not None
        else repo_root / REGISTRY_PATH
    )
    try:
        summary = validate_registry_file(
            repo_root=repo_root,
            registry_path=registry_path,
            base_file=arguments.base_file,
            base_git_ref=arguments.base_git_ref,
            require_seed_only=arguments.require_seed_only,
        )
    except RegistryValidationError as error:
        print(f"RECONSTRUCTION REGISTRY: FAIL: {error}", file=sys.stderr)
        return 1

    print(
        "RECONSTRUCTION REGISTRY: PASS "
        f"events={summary.event_count} "
        f"seed={summary.seed_event_count} "
        f"appended={summary.appended_event_count} "
        f"head={summary.final_event_sha256}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
