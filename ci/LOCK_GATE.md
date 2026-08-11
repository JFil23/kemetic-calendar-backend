# July 1 recovery plus reminder preservation `LOCK-GATE required`

`LOCK-GATE required` remains the stable branch-protection check. Its active
authority is the versioned profile in
`runtime-authority/july1-recovery.v1.json`.

The selected runtime is the recovered July 1 application plus the separately
approved DB-backed reminder-occurrence preservation correction. It still
predates the later 242-contract shard. Ten of the nineteen later locked test
files and the later fresh-process harness are absent. The exact later manifest
and seven-entry registry therefore live under `superseded/` as non-executable
evidence. They are never interpreted as passing against files that do not
exist.

## Active runtime authority

The July 1 profile is bound to:

- the exact authorized parent delta from `7c270354…`, including every changed
  path, deleted legacy authority path, Git object mode/type, content hashes for
  every non-self file, strict schema/self-path validation for this authority
  profile, and the exact merged mobile gitlink; any unrelated parent path fails
  closed;
- the recovered linked-database migration ledger plus the versioned, set-based
  calendar-hydration RPC migration, each bound by exact path and content hash;
- the exact restored-and-corrected mobile tree, `lib/` tree, `test/` tree,
  dependency lock, Flutter version, and Dart version;
- the nineteen deterministic build-control files retained over historical
  July 1, each by exact path and SHA-256;
- all 235 test suites and all 2,068 stable test IDs, including the permanent
  production-path reminder-preservation contract;
- exactly 2,060 passes;
- exactly six named failures classified as `ACCEPTED_BASELINE_DEBT`;
- exactly two named and owned skips.

The complete July 1 serial inventory runs under an explicit
`TZ=America/Los_Angeles` historical fixture-environment binding. One unchanged
July 1 test supplies a Pacific wall-clock date where its helper expects an
instant; it passes in the original Pacific environment and fails under an
ambient UTC host. The evaluator requires the exact `TZ` value and records it in
the decision receipt. Missing or different `TZ` fails closed. This constraint
is not product timezone policy, a pass/locked contract, quarantine, or accepted
baseline debt. The later test-only correction
`f0a56d83b269532d84ff66ce81d27001f0870c52` remains superseded evidence and is
not imported into the exact July 1 test tree.

Accepted baseline debt is not a pass, locked contract, quarantine, wildcard,
or ignored result. A failure that passes, disappears, changes category, or is
renamed fails the gate until the authority is deliberately reviewed and
versioned. Any additional failure, test, skip, missing suite, duplicate ID, or
unaccounted result also fails.

Historical July 1 tracks `.flutter-plugins-dependencies`, even though Flutter
regenerates that file with a host-specific timestamp and absolute package
paths. CI verifies the pristine tracked tree first, permits only an unstaged
worktree rewrite of that one file during `flutter pub get --enforce-lockfile`,
and requires its complete dependency/platform semantics to remain identical
after normalizing only the timestamp and valid package-cache/Flutter-SDK path
roots. It records the generated form, uses it for the Linux workload, restores
the exact tracked bytes, and then repeats the strict tree check. Any other
source or index mutation fails.

## Required jobs

The aggregate check requires:

- exact source, tree, dependency, build-control, and toolchain identity;
- runtime-authority evaluator self-tests;
- deterministic release-pipeline contracts;
- the complete serial July 1 inventory evaluated against its exact outcome
  authority.

Identity is recorded before and after test execution. Raw machine output,
normalized decisions, receipts, and SHA-256 manifests are archived even on a
failure. No job can be skipped or treated as advisory by the aggregate.
