# LOCK-GATE-001/002

`LOCK-GATE required` is the stable required-check name. Repository branch
protection must require it before a parent change can merge. It aggregates the
existing analyzer/fast suite, evaluator simulations, zero-tolerance behavioral
VM shard, forced fresh-process restoration shard, and full serial quarantine
monitor.

The locked shard has no quarantine input. Its exact behavioral inventory is in
`locked-contracts.json`; every whole-file selection is pinned by test count and
the SHA-256 of its sorted stable IDs, and every mixed-file selection must emit
exactly its declared stable-ID set. Source-string and grep guards are rejected as
locked evidence. `NAV-CONTRACT-001` and the complete navigation matrix are
never quarantinable.

The full monitor executes every test serially. `quarantine-registry.yaml` is
JSON-compatible YAML so the evaluator needs no downloaded parser. Entries are
exact stable IDs with a normalized category, classification, governing
contract, owner ticket, accountable owner, creation date, and an expiry no
more than 14 days later. A new, changed, missing, renamed, disappeared,
duplicated, wildcarded, expired, incomplete, or frozen-overlap result fails.
The two existing skips are independently exact and owned; any additional or
disappeared skip fails.

Every shard verifies the parent SHA, `160000` mobile gitlink, mobile HEAD,
clean worktrees, and pinned Flutter/Dart identity before and after execution.
Raw machine streams, normalized decisions, screenshots, receipts, and SHA-256
manifests are archived even when a gate fails.
