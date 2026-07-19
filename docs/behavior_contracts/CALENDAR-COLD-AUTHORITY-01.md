# CALENDAR-COLD-AUTHORITY-01

## Contract

A cold calendar start without a valid warm snapshot must not publish a focused
or partial event set as complete. Loading authority remains active until the
wide flow and standalone event snapshot is ready. A warm start keeps the cached
calendar visible while fresh data reconciles.

## Authority

- Startup orchestration: `mobile/lib/features/calendar/calendar_page.dart`
- Canonical mobile fix: `aa567220357d81680bad0739def29984a9ac0744`
- Parent gitlink checkpoint: `763dd1d`

## Executable Evidence

- `mobile/test/features/calendar/calendar_stale_while_revalidate_first_paint_test.dart`
- `mobile/test/features/calendar/calendar_startup_warm_start_test.dart`
- `mobile/test/features/calendar/reminder_sync_idempotence_test.dart`
- `mobile/test/features/calendar/shared_calendar_event_tap_navigation_guard_test.dart`

The cold-start fixture blocks the wide event request. Before the fix, the
focused subset removed the loader while the wide request was still pending.
After the fix, no partial event state is published, the loader remains, and
both focused and wide events appear after the authoritative request completes.

## Must Preserve

- Persisted view restoration is awaited before selecting hydration state.
- A cache miss performs one authoritative cold load.
- A valid warm snapshot remains visible during background backfill.
- Standalone, reminder, and shared-calendar lanes are not erased by partial
  refresh authority.
- Selected date and viewport do not jump during reconciliation.
- No source-name switch may reactivate focused cold-start hydration.

## Scope

This contract prevents visibly staged or incomplete cold publication. It does
not claim to reduce backend latency, repair month expansion persistence, or
resolve unrelated badge timing.

## Production Acceptance

Pending. Verify cold and warm installed-PWA launches without clearing storage,
including event-lane continuity and selected-date stability. Record the exact
deployment and artifact identity before changing this contract to passed.
