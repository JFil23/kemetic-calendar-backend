#!/usr/bin/env python3
"""Contracts for the append-only reconstruction registry authority."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from tool.ci import reconstruction_registry as registry


class ReconstructionRegistryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[2]
        cls.registry_path = cls.repo_root / registry.REGISTRY_PATH
        cls.seed_bytes = registry.build_seed_bytes(cls.repo_root)
        cls.seed_events = [
            json.loads(line) for line in cls.seed_bytes.decode("utf-8").splitlines()
        ]

    def _rehash(self, events: list[dict[str, object]]) -> bytes:
        rebuilt: list[dict[str, object]] = []
        for sequence, source in enumerate(events, start=1):
            rebuilt.append(
                registry.make_event(
                    sequence=sequence,
                    event_id=str(source["eventId"]),
                    event_kind=str(source["eventKind"]),
                    payload=copy.deepcopy(source["payload"]),
                    previous_event_sha256=(
                        str(rebuilt[-1]["eventSha256"]) if rebuilt else None
                    ),
                )
            )
        return registry.registry_bytes(rebuilt)

    def _append_policy(
        self,
        *,
        event_id: str = "policy-test-future-append",
        statement: str = "A future decision is appended without rewriting history.",
    ) -> bytes:
        events = copy.deepcopy(self.seed_events)
        events.append(
            registry.make_event(
                sequence=len(events) + 1,
                event_id=event_id,
                event_kind="policy",
                payload={"statement": statement},
                previous_event_sha256=str(events[-1]["eventSha256"]),
            )
        )
        return registry.registry_bytes(events)

    def test_tracked_registry_is_exact_24_event_seed(self) -> None:
        self.assertEqual(self.seed_bytes, self.registry_path.read_bytes())
        summary = registry.validate_registry_file(
            repo_root=self.repo_root,
            registry_path=self.registry_path,
            require_seed_only=True,
        )
        self.assertEqual(24, summary.event_count)
        self.assertEqual(24, summary.seed_event_count)
        self.assertEqual(0, summary.appended_event_count)

    def test_seed_imports_every_predecessor_row_exactly_once(self) -> None:
        artifact_events = [
            event for event in self.seed_events if event["eventKind"] == "artifact"
        ]
        checkpoint_events = [
            event for event in self.seed_events if event["eventKind"] == "checkpoint"
        ]
        policy_events = [
            event for event in self.seed_events if event["eventKind"] == "policy"
        ]
        self.assertEqual(7, len(artifact_events))
        self.assertEqual(7, len(checkpoint_events))
        self.assertEqual(9, len(policy_events))

        for specification, imported_events in (
            (registry.CSV_SPECS[0], artifact_events),
            (registry.CSV_SPECS[1], checkpoint_events),
        ):
            predecessor_bytes = (
                self.repo_root / specification["path"]
            ).read_bytes()
            rows = registry._read_csv_rows(predecessor_bytes, specification)
            self.assertEqual(
                list(range(2, 2 + len(rows))),
                [
                    event["payload"]["predecessorRowNumber"]
                    for event in imported_events
                ],
            )
            self.assertEqual(
                rows,
                [event["payload"]["originalRow"] for event in imported_events],
            )
            for row, event in zip(rows, imported_events, strict=True):
                self.assertEqual(
                    registry.sha256_bytes(registry.canonical_json_bytes(row)),
                    event["payload"]["originalRowSha256"],
                )

        self.assertEqual(
            [event_id for event_id, _ in registry.POLICIES],
            [event["eventId"] for event in policy_events],
        )
        self.assertEqual(
            [statement for _, statement in registry.POLICIES],
            [event["payload"]["statement"] for event in policy_events],
        )

    def test_malformed_event_fails(self) -> None:
        malformed = b"{not-json}\n" + b"".join(
            registry.canonical_json_bytes(event) + b"\n"
            for event in self.seed_events[1:]
        )
        with self.assertRaisesRegex(
            registry.RegistryValidationError, "malformed JSON"
        ):
            registry.validate_registry_bytes(malformed, self.repo_root)

    def test_duplicate_event_id_fails_even_with_valid_chain(self) -> None:
        duplicate = self._append_policy(
            event_id=str(self.seed_events[0]["eventId"])
        )
        with self.assertRaisesRegex(
            registry.RegistryValidationError, "duplicate eventId"
        ):
            registry.validate_registry_bytes(duplicate, self.repo_root)

    def test_modified_historical_event_fails_even_when_rehashed(self) -> None:
        events = copy.deepcopy(self.seed_events)
        events[1]["payload"]["originalRow"]["classification"] = "REWRITTEN"
        modified = self._rehash(events)
        with self.assertRaisesRegex(
            registry.RegistryValidationError, "immutable seed event 2"
        ):
            registry.validate_registry_bytes(modified, self.repo_root)

    def test_removed_historical_event_fails_even_when_rehashed(self) -> None:
        events = copy.deepcopy(self.seed_events)
        del events[4]
        removed = self._rehash(events)
        with self.assertRaisesRegex(
            registry.RegistryValidationError,
            "deleted immutable seed events|immutable seed event",
        ):
            registry.validate_registry_bytes(removed, self.repo_root)

    def test_reordered_historical_events_fail_even_when_rehashed(self) -> None:
        events = copy.deepcopy(self.seed_events)
        events[2], events[3] = events[3], events[2]
        reordered = self._rehash(events)
        with self.assertRaisesRegex(
            registry.RegistryValidationError, "immutable seed event"
        ):
            registry.validate_registry_bytes(reordered, self.repo_root)

    def test_noncanonical_json_fails(self) -> None:
        first = json.dumps(self.seed_events[0], ensure_ascii=False).encode("utf-8")
        noncanonical = first + b"\n" + registry.registry_bytes(self.seed_events[1:])
        with self.assertRaisesRegex(
            registry.RegistryValidationError, "not canonical JSON"
        ):
            registry.validate_registry_bytes(noncanonical, self.repo_root)

    def test_valid_future_event_may_only_append(self) -> None:
        appended = self._append_policy()
        summary = registry.validate_registry_bytes(appended, self.repo_root)
        self.assertEqual(25, summary.event_count)
        self.assertEqual(1, summary.appended_event_count)
        registry.validate_append_only(appended, self.seed_bytes)

        rewritten = bytearray(appended)
        rewritten[10] ^= 1
        with self.assertRaisesRegex(
            registry.RegistryValidationError, "exact byte prefix"
        ):
            registry.validate_append_only(bytes(rewritten), self.seed_bytes)

        with self.assertRaisesRegex(
            registry.RegistryValidationError, "removed bytes"
        ):
            registry.validate_append_only(self.seed_bytes[:-1], self.seed_bytes)

    def test_future_event_cannot_duplicate_a_predecessor_import(self) -> None:
        events = copy.deepcopy(self.seed_events)
        events.append(
            registry.make_event(
                sequence=len(events) + 1,
                event_id="artifact-attempted-predecessor-reimport",
                event_kind="artifact",
                payload=copy.deepcopy(events[1]["payload"]),
                previous_event_sha256=str(events[-1]["eventSha256"]),
            )
        )
        with self.assertRaisesRegex(
            registry.RegistryValidationError, "re-import predecessor evidence"
        ):
            registry.validate_registry_bytes(
                registry.registry_bytes(events), self.repo_root
            )

    def test_base_file_enforces_exact_append_only_prefix(self) -> None:
        appended = self._append_policy()
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            current_path = temporary / "current.jsonl"
            base_path = temporary / "base.jsonl"
            current_path.write_bytes(appended)
            base_path.write_bytes(self.seed_bytes)

            summary = registry.validate_registry_file(
                repo_root=self.repo_root,
                registry_path=current_path,
                base_file=base_path,
            )
            self.assertEqual(1, summary.appended_event_count)

            base_path.write_bytes(self.seed_bytes.replace(b'"sequence":2', b'"sequence":9'))
            with self.assertRaises(registry.RegistryValidationError):
                registry.validate_registry_file(
                    repo_root=self.repo_root,
                    registry_path=current_path,
                    base_file=base_path,
                )

    def test_wrong_predecessor_hash_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            fake_root = Path(temporary_directory)
            fake_predecessor = fake_root / registry.PREDECESSOR_DIRECTORY
            fake_predecessor.mkdir(parents=True)
            for source in (
                self.repo_root / registry.PREDECESSOR_DIRECTORY
            ).iterdir():
                (fake_predecessor / source.name).write_bytes(source.read_bytes())
            artifact_csv = fake_predecessor / "artifact-registry.csv"
            artifact_csv.write_bytes(artifact_csv.read_bytes() + b"\n")

            with self.assertRaisesRegex(
                registry.RegistryValidationError, "hash mismatch"
            ):
                registry.load_predecessor_evidence(fake_root)


if __name__ == "__main__":
    unittest.main()
