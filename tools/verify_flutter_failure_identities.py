#!/usr/bin/env python3
"""Verify the reproducible identity gate for an allowed Flutter failure set."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--expected", required=True, type=Path)
    return parser.parse_args()


def _events(report: Path) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for number, raw_line in enumerate(
        report.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid JSON event on line {number}: {error}") from error
        if not isinstance(event, dict):
            raise ValueError(f"JSON event on line {number} is not an object")
        events.append(event)
    return events


def _canonical_identities(report: Path, root: Path) -> str:
    suites: dict[int, Path] = {}
    tests: dict[int, dict[str, object]] = {}
    failed_ids: set[int] = set()

    for event in _events(report):
        event_type = event.get("type")
        if event_type == "suite":
            suite = event.get("suite")
            if isinstance(suite, dict):
                suites[int(suite["id"])] = Path(str(suite["path"])).resolve()
        elif event_type == "testStart":
            test = event.get("test")
            if isinstance(test, dict):
                tests[int(test["id"])] = test
        elif event_type == "testDone" and event.get("result") == "failure":
            failed_ids.add(int(event["testID"]))

    root = root.resolve()
    identities: list[str] = []
    for test_id in failed_ids:
        test = tests.get(test_id)
        if test is None:
            raise ValueError(f"failure test id {test_id} has no testStart event")
        suite_path = suites.get(int(test["suiteID"]))
        if suite_path is None:
            raise ValueError(f"failure test id {test_id} has no suite event")
        try:
            relative_path = suite_path.relative_to(root).as_posix()
        except ValueError as error:
            raise ValueError(
                f"failure suite {suite_path} is outside declared root {root}"
            ) from error
        identities.append(f"{relative_path} :: {test['name']}")

    identities.sort()
    return "".join(f"{identity}\n" for identity in identities)


def main() -> int:
    args = _arguments()
    observed = _canonical_identities(args.report, args.root)
    expected = args.expected.read_text(encoding="utf-8")
    digest = hashlib.sha256(observed.encode("utf-8")).hexdigest()

    print(observed, end="")
    print(f"count={len(observed.splitlines())}")
    print(f"sha256={digest}")

    if observed != expected:
        print("failure identity gate mismatch", file=sys.stderr)
        return 1
    print("failure identity gate passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
