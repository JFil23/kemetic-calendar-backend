# LOCK-GATE required

`LOCK-GATE required` remains the stable branch-protection check. It now has
three authorities. None of them may be skipped or treated as advisory.

```text
Historical July 1 recovery
    └── exact recovered runtime on a frozen second checkout

Forward candidate
    └── declared_base → HEAD provenance, pairing, and CURRENT mobile runtime

Release pipeline
    └── sealed-build / reconstruction contracts on the current checkout
```

CI proves the declared forward transition. Release authority separately proves
that the declared starting point was actually served production. This workflow
does not fetch `kemet.pages.dev`.

## Historical July 1 recovery

The versioned profile in `runtime-authority/july1-recovery.v1.json` remains
`ACTIVE_EXACT_RECOVERY_RUNTIME`. It is predecessor evidence. It is not retargeted
to current production.

Those jobs check out a frozen recovery pair:

1. resolve the newest unambiguous ancestor whose `mobile` gitlink equals
   `identity.mergedMobileCommit`;
2. run the existing July 1 `verify-checkout` against that pair;
3. only then use that pair for historical analyzer/tests.

Gitlink equality alone is not proof. If resolution is ambiguous or
`verify-checkout` rejects the pair, the gate fails closed. It does not update
the July 1 profile and does not select another convenient ancestor.

The selected historical runtime is the recovered July 1 application plus the
separately approved DB-backed reminder-occurrence preservation correction. It
still predates the later 242-contract shard. Ten of the nineteen later locked
test files and the later fresh-process harness are absent. The exact later
manifest and seven-entry registry therefore live under `superseded/` as
non-executable evidence. They are never interpreted as passing against files
that do not exist.

The July 1 profile is bound to:

- the exact authorized parent delta from `7c270354…`, including every changed
  path, deleted legacy authority path, Git object mode/type, content hashes for
  every non-self file, strict schema/self-path validation for this authority
  profile, and the exact merged mobile gitlink; any unrelated parent path fails
  closed;
- the recovered linked-database migration ledger plus the versioned, set-based
  calendar-hydration and flow-accounting RPC migrations, each bound by exact
  path and content hash;
- the exact restored-and-corrected mobile tree, `lib/` tree, `test/` tree,
  dependency lock, Flutter version, and Dart version;
- the nineteen deterministic build-control files retained over historical
  July 1, each by exact path and SHA-256;
- all 236 test suites and all 2,071 stable test IDs, including the permanent
  production-path reminder-preservation contract;
- exactly 2,063 passes;
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

Historical failure authority does not transfer to current production.

## Forward candidate

`tool/ci/forward_candidate_gate.py` records the declared base and candidate
parent/mobile gitlinks plus the parent and mobile deltas.

Declared base is the cut's actual base commit, not a pinned current-production
file:

- pull request: `github.event.pull_request.base.sha`
- push to the sole active `production` branch: `github.event.before`

Routine CI, tests, builds, and releases use the canonical `production` source
only. Historical refs live outside the active repositories in the recovery
archive and are never consulted by this workflow.

Zero SHAs fail closed.

Parent deltas are either:

- gitlink-only (`mobile`), or
- a subset of the authority-rollover allowlist, in which case the mobile
  gitlink must remain identical to the declared base.

One exact, temporary Reading House release reconciliation is also recognized.
It requires declared base `addeec5e196e8282f97d58e9cc857e11d99f2d4b`,
the frozen mobile gitlink
`0c424c10954208924b1c0abc9eea118191c72cee`, and a parent delta containing
only `mobile`,
`supabase/migrations/20260905152737_reading_house_rooms_realtime_and_read_state.sql`,
and the existing authority-rollover files. The migration must remain the exact
added blob pinned by the evaluator. The provenance reconciliation landed at
`74dc57f804b01db366d03f285e8b530c92546a5a`; the only permitted continuation
is one direct child that adds the exact versioned missing-test audit at
`ci/runtime-authority/reading-house-four-flow-missing-tests.v1.json`. That
audit is valid only for declared base
`addeec5e196e8282f97d58e9cc857e11d99f2d4b` and frozen mobile gitlink
`0c424c10954208924b1c0abc9eea118191c72cee`. It enumerates exactly 202 stable
test identities without wildcards: retired entries record obsolete active-flow
contracts, and replaced entries name a passing candidate identity. Any missing
identity outside that exact manifest still fails closed, as does any changed or
non-passing replacement. New tests must still pass, and the three persisting
baseline failures remain recorded rather than becoming accepted debt. No other
mixed gitlink/parent cut or missing-test exception is accepted.

One exact follow-up reconciles 16 renamed Ma’at visual-test identities without
weakening the generic missing-test rule. It is valid only for declared base
`020f9808fbcd4a03df42009fd2f5a7f4a83d94b5`, base mobile
`ddc78e8b48779454bf1b20ff4cc88671af99fcb1`, candidate mobile
`a75e9ec88870db799cad64cacf63d77b1ce3f373`, and one candidate commit directly
on `4f37d1213ecdefc115a509d0fde0a4f5e5eb776b`. The candidate may add only the
exact, blob-pinned
`ci/runtime-authority/maat-visual-test-renames.v1.json` manifest alongside the
existing authority-rollover files, with no wildcard entries. Every named
replacement must execute and pass; any other missing identity or any missing,
skipped, or failing replacement still fails closed. This pin creates no generic
permission for renamed or missing tests.

One exact follow-up reconciles the nine test identities renamed when the four
authored flow details stopped owning page/route wrappers and became content in
the existing Flow Studio sheet. It re-evaluates the original product cut from
declared base `ea0651e3d2d1aa8018dd96f291143ee348e2210a`, whose mobile
gitlink is `c620de90057ed1efb65562196a645aac4f0c0eef`, through product
parent `ff0154e37e987f2854bf4e281481f876e6bb1db0` and frozen candidate
mobile `5221aa27b14132e8d3bcc700e766ddb8245b3433`. The reconciliation
must be one direct child of that product parent and may add only the exact,
blob-pinned `ci/runtime-authority/flow-detail-surface-test-renames.v1.json`
manifest alongside the existing authority-rollover files. It lists exactly
nine old identities and nine replacement identities without wildcards. Every
replacement must execute and pass; all other missing, skipped, failing, and
new-test checks remain fail-closed. A normal authority-only comparison against
the already-pushed product parent is not accepted as evidence for this cut.

Unrelated parent paths fail closed. Authority-rollover mixed with a gitlink
change fails closed.

Analyzer validation is baseline-relative. The job materializes the declared
base pair, runs the same pinned `flutter analyze --no-fatal-infos` there and on
the candidate, then requires:

```text
candidate diagnostics ⊆ declared-base diagnostics
```

Fingerprints are severity, diagnostic code, repo-relative path, and message.
Line and column are not identity. Disappearing diagnostics may pass. Newly
introduced diagnostics fail. Both sets are derived during the run. There is no
stored analyzer allowlist, accepted-debt registry, or current-production
profile.

The forward runtime job then runs the complete current test suite against
**both** the declared-base parent-pair layout and the candidate parent-pair
layout, using the same command, toolchain, and timezone:

```text
flutter pub get --enforce-lockfile
flutter analyze --no-fatal-infos
compare-analyze against declared base
flutter test --no-pub --machine --concurrency=1   # declared base
flutter test --no-pub --machine --concurrency=1   # candidate
compare-test against declared base
```

Stable test identity is repo-relative file + group hierarchy + leaf name.
`compare-test` derives current baseline failures from the declared served SHA
during the run. It does not read July accepted debt. A candidate may preserve
or improve served production tests; it may not worsen them.

Same failure means the same normalized fingerprint: identity, failure
category, and primary error/assertion signature after stripping path and
line/column noise. A red test that changes failure mode is a new regression.
New tests must pass. Removals, newly introduced skips, and incomplete or
malformed inventories fail closed. Persisting baseline failures are recorded
as `persistingBaselineFailures`, never as accepted debt.

Analyzer comparison is not a test-failure inventory. Current-candidate test
failures remain census items, not silent July 1 debt.

Post-test identity must be a clean parent/mobile worktree after restoring
generated plugin metadata. A failing Flutter golden can also create an
untracked `test/features/calendar/failures/` renderer directory. Only after
the unchanged-baseline comparison has passed with zero candidate regressions,
the workflow removes that directory when it is the mobile checkout's sole
remaining status, rejects a symlink or unexpected path, and archives the PNG
evidence before removal. Any additional source or index mutation still fails
closed, and cleanup cannot change a test result or comparison decision.

## Release pipeline

The existing `release-pipeline-contracts` job continues to validate sealed
build, served-artifact, and reconstruction contracts on the current checkout.
`tool/ci/release_pipeline_gate.py` remains the owner of that wiring only.

## Required jobs

The aggregate check requires:

- resolution and verification of the frozen July 1 pair;
- exact July 1 source, tree, dependency, build-control, and toolchain identity
  on that frozen pair;
- runtime-authority evaluator self-tests, including forward-candidate wiring;
- deterministic release-pipeline contracts on the current checkout;
- the complete serial July 1 inventory evaluated against its exact outcome
  authority on the frozen pair;
- current-candidate provenance, differential `flutter analyze` against the
  declared base, and differential `flutter test` of the declared-base pair
  against the current candidate pair.

Identity is recorded before and after test execution. Raw machine output,
normalized decisions, receipts, and SHA-256 manifests are archived even on a
failure. No job can be skipped or treated as advisory by the aggregate.
