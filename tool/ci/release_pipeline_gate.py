#!/usr/bin/env python3
"""Static fail-closed proof that release-pipeline contracts feed LOCK-GATE."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Sequence


class WorkflowContractError(ValueError):
    pass


REQUIRED_PIPELINE_COMMANDS = (
    "python3 mobile/scripts/web_release_pipeline_test.py",
    "python3 mobile/scripts/served_artifact_verifier_test.py",
    "python3 -m unittest tool.ci.test_reconstruction_registry",
    "python3 tool/ci/reconstruction_registry.py",
    "python3 -m py_compile",
    "bash -n",
    "config/web/cloudflare-served-contract.v1.json",
    "config/web/environment-delta-contract.v1.json",
)


def _job_block(source: str, job_id: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(job_id)}:\n(.*?)(?=^  [a-zA-Z0-9_-]+:\n|\Z)",
        source,
    )
    if not match:
        raise WorkflowContractError(f"workflow lacks required job {job_id!r}")
    return match.group(0)


def validate_workflow(path: Path) -> dict[str, object]:
    source = path.read_text(encoding="utf-8")
    if not re.search(r"(?m)^  pull_request:\s*$", source):
        raise WorkflowContractError("workflow does not run on pull requests")
    if not re.search(r'(?m)^      - main\s*$', source):
        raise WorkflowContractError("workflow does not run on protected main pushes")

    pipeline = _job_block(source, "release-pipeline-contracts")
    aggregate = _job_block(source, "lock-gate-required")
    if "continue-on-error:" in pipeline:
        raise WorkflowContractError("pipeline contracts may not continue on error")
    if re.search(r"(?m)^    if:", pipeline):
        raise WorkflowContractError("pipeline job may not be conditionally skipped")
    missing_commands = [
        command for command in REQUIRED_PIPELINE_COMMANDS if command not in pipeline
    ]
    if missing_commands:
        raise WorkflowContractError(
            f"pipeline job lacks required commands: {missing_commands}"
        )
    if not re.search(
        r"(?m)^      - release-pipeline-contracts\s*$",
        aggregate,
    ):
        raise WorkflowContractError(
            "LOCK-GATE required does not need release-pipeline-contracts"
        )
    expected_assertion = (
        '${{ needs.release-pipeline-contracts.result }}" = "success"'
    )
    if expected_assertion not in aggregate:
        raise WorkflowContractError(
            "LOCK-GATE required does not fail closed on the pipeline job result"
        )
    if "if: always()" not in aggregate:
        raise WorkflowContractError(
            "LOCK-GATE required must evaluate cancelled/errored/skipped dependencies"
        )
    return {
        "workflow": path.as_posix(),
        "pipeline_job": "release-pipeline-contracts",
        "aggregate_job": "lock-gate-required",
        "required_commands": list(REQUIRED_PIPELINE_COMMANDS),
        "transitively_required": True,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workflow",
        type=Path,
        default=Path(".github/workflows/mobile.yml"),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        result = validate_workflow(arguments.workflow)
    except (OSError, WorkflowContractError) as error:
        print(f"RELEASE PIPELINE GATE: FAIL: {error}", file=sys.stderr)
        return 1
    print(
        "RELEASE PIPELINE GATE: PASS "
        f"job={result['pipeline_job']} aggregate={result['aggregate_job']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
