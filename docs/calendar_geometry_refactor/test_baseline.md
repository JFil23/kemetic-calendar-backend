# Phase 0 Test Baseline

Baseline source: parent `b8be991`, mobile `3fc62eb`

Branch: `codex/calendar-geometry-refactor-rc`

Date: 2026-08-13

## Full serial run

Command:

```text
flutter test --reporter json --concurrency=1
```

The repository contains 243 files matching `test/**/*_test.dart`. The serial
run completed in 1,082.046 seconds (18 minutes 2.046 seconds) with:

| Result | Count |
|---|---:|
| Passed | 2,115 |
| Skipped | 2 |
| Failed | 6 |
| Completed | 2,123 |

The process exited 1. No Phase 0 application or test code had been changed.

## Analyzer baseline

`flutter analyze` also exited 1 with 21 existing `info` findings and no
warnings or errors. Every finding is `unnecessary_string_escapes` in generated
or split Kemetic day-data sources:

- 7 in `lib/widgets/kemetic_day_data_compressed.dart`;
- 7 in `lib/widgets/kemetic_day_data_entries_2.dart`; and
- 7 in `lib/widgets/kemetic_day_data_map_2.dart`.

These findings are recorded, not repaired, because they are unrelated to Phase
0 and changing generated calendar content would expand scope without restoring
the six failing behavioral guards.

## Deterministic inherited failures

All four affected files were immediately rerun together with concurrency 1.
All six failures reproduced, so they are not full-suite ordering noise.

1. `test/services/restoration_architecture_guard_test.dart`
   - `restoration architecture guard Ma’at template restoration seeds initial routes`
   - The guarded restoration method contains `addPostFrameCallback`, contrary
     to the test's current prohibition.
2. `test/services/app_bar_action_guard_test.dart`
   - `app bar action guard community feed distinguishes load errors from empty state`
   - `profile_page.dart` does not contain the required
     `Community Feed could not load` state copy.
   - `app bar action guard raw context.push usage stays centralized or explicitly local`
   - Seven raw `context.push` call sites remain outside the guard's accepted
     centralization/allowlist: two calendar files, the shared-practice chooser,
     and four profile-page sites.
3. `test/widgets/daily_reflection_widget_data_test.dart`
   - `daily reflection widget data matches KemeticDayData`
   - The generated widget-data payload differs from `KemeticDayData`; the first
     reported mismatch is `kaherka_10_1` (`Can the old form rest?` versus the
     expected `Have I done the start, and can I now wait?`).
4. `test/widgets/kemetic_day_info_test.dart`
   - `KemeticDayData decan resolution uses normalized visible date labels for all standard day cards`
   - Nine standard-card labels for Ka-her-ka, Shef-Bedet, and Rekh-Wer repeat
     the day in both the decan title and the parenthetical visible date.
   - `KemeticDayData decan resolution keeps day card rhythms short and rejects rollback copy`
   - `sefbedet_20_2` contains 68 words and violates the guard's short-rhythm
     constraint.

## Governance consequence

These failures are outside the authorized centered-to-leading-edge banner test
migration. They must not be "fixed" by weakening assertions as part of the
calendar geometry work. Phase 1 is blocked by the agreed stop-and-report rule
until their owner either restores the protected behavior, records an explicit
independent contract change, or authorizes a documented pre-existing-red
exception for this branch.

The calendar-specific protected and migratable tests remain classified in
[test_migration_manifest.md](test_migration_manifest.md).
