import tempfile
import unittest
from pathlib import Path

from tool.ci.release_pipeline_gate import (
    REQUIRED_PIPELINE_COMMANDS,
    WorkflowContractError,
    validate_workflow,
)


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/mobile.yml"


class ReleasePipelineGateTest(unittest.TestCase):
    def _mutated(self, old: str, new: str) -> Path:
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(old, source)
        temporary = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".yml",
            delete=False,
        )
        temporary.write(source.replace(old, new, 1))
        temporary.close()
        self.addCleanup(Path(temporary.name).unlink)
        return Path(temporary.name)

    def test_current_workflow_is_transitively_required(self) -> None:
        result = validate_workflow(WORKFLOW)
        self.assertTrue(result["transitively_required"])
        self.assertEqual(
            result["required_commands"],
            list(REQUIRED_PIPELINE_COMMANDS),
        )

    def test_missing_pipeline_job_fails(self) -> None:
        path = self._mutated(
            "  release-pipeline-contracts:\n",
            "  release-pipeline-contracts-removed:\n",
        )
        with self.assertRaisesRegex(WorkflowContractError, "lacks required job"):
            validate_workflow(path)

    def test_optional_pipeline_job_fails(self) -> None:
        path = self._mutated(
            "  release-pipeline-contracts:\n",
            "  release-pipeline-contracts:\n    continue-on-error: true\n",
        )
        with self.assertRaisesRegex(WorkflowContractError, "continue on error"):
            validate_workflow(path)

    def test_pipeline_job_condition_fails(self) -> None:
        path = self._mutated(
            "  release-pipeline-contracts:\n",
            "  release-pipeline-contracts:\n    if: github.event_name == 'push'\n",
        )
        with self.assertRaisesRegex(WorkflowContractError, "conditionally skipped"):
            validate_workflow(path)

    def test_missing_contract_command_fails(self) -> None:
        path = self._mutated(
            "python3 mobile/scripts/served_artifact_verifier_test.py",
            "python3 mobile/scripts/removed_verifier_test.py",
        )
        with self.assertRaisesRegex(WorkflowContractError, "lacks required commands"):
            validate_workflow(path)

    def test_missing_aggregate_need_fails(self) -> None:
        path = self._mutated(
            "      - release-pipeline-contracts\n",
            "      - release-pipeline-contracts-removed\n",
        )
        with self.assertRaisesRegex(WorkflowContractError, "does not need"):
            validate_workflow(path)

    def test_cancelled_or_skipped_result_cannot_be_ignored(self) -> None:
        path = self._mutated(
            'test "${{ needs.release-pipeline-contracts.result }}" = "success"',
            'echo "${{ needs.release-pipeline-contracts.result }}"',
        )
        with self.assertRaisesRegex(WorkflowContractError, "fail closed"):
            validate_workflow(path)


if __name__ == "__main__":
    unittest.main()
