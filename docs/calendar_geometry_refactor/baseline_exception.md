# Fixed Six-Red Baseline Exception

Status: **Granted by the product owner**

Date: 2026-08-13

Baseline mobile source: `3fc62eb518d487fe087b80edceab56f91c70c2dd`

## Authorized identities

Each failure below reproduced when its four affected files were rerun together
with `flutter test --concurrency=1` on the baseline source. None is caused by or
part of the calendar geometry contract.

| # | Test path | Exact test name | Geometry relationship |
|---:|---|---|---|
| 1 | `test/services/restoration_architecture_guard_test.dart` | `restoration architecture guard Ma’at template restoration seeds initial routes` | Pre-existing Flow Studio restoration guard failure; not calendar section identity or geometry. Read the guard before post-layout publication work because callback restrictions may overlap the later implementation mechanism. |
| 2 | `test/services/app_bar_action_guard_test.dart` | `app bar action guard community feed distinguishes load errors from empty state` | Pre-existing profile/feed copy contract failure; unrelated to calendar geometry. |
| 3 | `test/services/app_bar_action_guard_test.dart` | `app bar action guard raw context.push usage stays centralized or explicitly local` | Pre-existing navigation allowlist failure; unrelated to calendar geometry. The geometry branch must not absorb navigation cleanup. |
| 4 | `test/widgets/daily_reflection_widget_data_test.dart` | `daily reflection widget data matches KemeticDayData` | Pre-existing generated reflection-data parity failure; unrelated to section geometry. |
| 5 | `test/widgets/kemetic_day_info_test.dart` | `KemeticDayData decan resolution uses normalized visible date labels for all standard day cards` | Pre-existing day-card content normalization failure; unrelated to section geometry. |
| 6 | `test/widgets/kemetic_day_info_test.dart` | `KemeticDayData decan resolution keeps day card rhythms short and rejects rollback copy` | Pre-existing day-card copy-length failure; unrelated to section geometry. |

## Hard baseline rule

The permitted failure count is **six** and the six identities above are fixed.
The following are all stop-and-report conditions:

- a seventh failure;
- one of the six disappearing or turning green;
- a failure moving to a different path or test name;
- any edit on this branch to its assertion, fixture, allowlist, or underlying
  unrelated product behavior.

The 21 analyzer `info` findings recorded in `test_baseline.md` are not an
analyzer gate. Validation must distinguish their fixed baseline identities from
new warnings, errors, or infos introduced by the geometry branch.

## Reproducible identity gate

On 2026-08-13 the product owner explicitly waived the old byte-level
path/name/error/stack-trace fingerprint. Its original serialization procedure
and payload were not checked into the repository, the recorded hash could not
be independently regenerated, and continuing to target it would reward tuning
a serialization to an expected answer.

The replacement gate is the newline-terminated, UTF-8, lexicographically sorted
list of `relative test path :: full test name` in
`allowed_failure_identities.txt`. It deliberately excludes error bodies and
stack traces, whose runner formatting is not the failure identity. The current
canonical file contains six identities and has SHA-256
`e751c750a5765817307b4801473d24eaae0d7fdbcb72651c406aa51c1fdd19e6`.

The checked-in verifier is run from the parent repository with:

```sh
python3 tools/verify_flutter_failure_identities.py \
  --report /path/to/flutter-test.jsonl \
  --root mobile \
  --expected docs/calendar_geometry_refactor/allowed_failure_identities.txt
```

Any count or identity mismatch returns a nonzero exit status. Changes to an
allowed test's assertion, fixture, allowlist, or underlying product source
remain separately forbidden and must be checked by source diff.
