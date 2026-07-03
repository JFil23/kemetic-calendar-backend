# Shared Calendar Flow Smoke Report

Environment tested: Android emulator debug Flutter app against dev Supabase. Root branch `codex/inbox-group-chats`, starting root commit `f3b97650263866e59fb9eb0dedf1bff73b411a02`; mobile branch `codex/inbox-group-chats`, source/test commit `1f253943e12fa0c386704c7414f24798d912a51e`. Account A was the shared-calendar owner. Account B was an accepted shared-calendar editor/member. No credentials are included here.

Shared calendar: `Shared Flow Smoke 2026-07-02T17-28-49` (`ce4f65f1-fc84-4018-a306-61f8bbb1b43b`).

## Result Summary

Ma'at flow result: pass.

Account A moved `The Offering Table` to the shared calendar through the flow detail calendar picker. Account B could see the Ma'at flow from the shared calendar/day view and open the shared-practice room. Both accounts recorded progress, and each account saw the other's `observed today` status in the shared-practice room after account switching/restart. A light regression query after the custom-flow pass still returned both Ma'at room members as `observed`.

Created flow result: pass, after shared-practice access-label cleanup.

The original created-flow blocker was fixed: detached Flow Studio saves now materialize rule-only scheduled events. Account A created custom flow `Codex flow 100 by` through Flow Studio, confirmed it had one scheduled event, opened its detail page, and assigned it to the shared calendar with the direct detail calendar picker. Account B accessed the custom flow from the shared calendar/day view path. Account A recorded `observed`; Account B saw Account A's status, recorded `observed`, and Account A saw both members observed after a fresh account switch.

Entry path used: direct shared-calendar add from flow detail calendar picker. Commons was not used.

Member visibility result:

- Account B is not auto-added to My Flows for the custom flow.
- Account B can access the custom flow through the shared calendar/day view event.
- Shared-calendar members are effectively auto-participants in the shared-practice room: Account B did not explicitly join but could open the room and record progress.
- Shared-calendar-derived rooms now show shared-calendar access labels instead of `Private` / `Ask to join`.

Progress visibility result:

- Progress is visible in the shared-practice room member rows.
- Account B saw Account A as `observed today`.
- Account A saw Account B as `observed today` after switching back and reopening the room.
- Progress did not appear directly in My Flows. Day View exposes the event and completion/detail route, not the cross-member status summary.
- The `Shared Entries` section stayed empty for no-note completions; member-row status still showed the engagement.

Data notes:

- Custom flow `818` had `total_event_count: 1`, `live_event_count: 1`, and `lifecycle: active` before completion.
- After Account A completed the only event, `flow_filing_items_client` marked Account A's flow row inactive because no remaining live event existed. The event itself stayed visible through `user_event_filing_items_client`.
- Account B could see the custom event through `user_events_with_calendars` / `user_event_filing_items_client`, but `flow_filing_items_client` returned no custom-flow row for Account B. This matches the accepted no-auto-My-Flows model, but it is a data-surface caveat if My Flows is later expected to show shared-calendar flows.
- Final live regression check as both accounts returned the custom event visible, custom room members `observed` / `observed`, and Ma'at room members `observed` / `observed`.

## Files Changed

- `mobile/lib/data/shared_practice_models.dart`
- `mobile/lib/features/calendar/calendar_flow_pages.dart`
- `mobile/lib/features/calendar/calendar_flow_studio_models.dart`
- `mobile/lib/features/calendar/calendar_flow_studio_page.dart`
- `mobile/lib/features/calendar/calendar_page.dart`
- `mobile/lib/features/calendar/day_view.dart`
- `mobile/lib/features/shared_practice/shared_practice_room_page.dart`
- `mobile/lib/main.dart`
- `mobile/test/data/shared_practice_models_test.dart`
- `mobile/test/features/calendar/flow_studio_state_sync_regression_test.dart`
- `mobile/test/features/calendar/shared_flow_calendar_assignment_test.dart`

## Product Concerns

- Account A can see duplicate identical `The Offering Table` day-view cards: one personal and one shared. The shared card is hard to distinguish until opening the detail sheet.
- Shared-practice access labels now describe shared-calendar access, but the room still does not name which member is which when profile names are unavailable.
- Member rows are anonymized as `Member`, so screenshots prove status sharing but not identity-level attribution.
- The bottom action still says `Keep today's step` after the current viewer is already observed.
- Empty no-note completions update member status but do not create a visible item in `Shared Entries`.
- Old failed custom-flow rows remain in dev data with `total_event_count: 0` / inactive lifecycle; the passing row for this smoke is custom flow `818`.

## Screenshots

- `shared-flow-01-calendar-members.png`
- `shared-flow-02-maat-owner-personal-flow.png`
- `shared-flow-03-maat-calendar-picker-open.png`
- `shared-flow-04-maat-assigned-to-shared-calendar.png`
- `shared-flow-05-maat-member-can-access-flow.png`
- `shared-flow-06-maat-owner-records-progress.png`
- `shared-flow-07-maat-member-sees-owner-progress.png`
- `shared-flow-08-maat-member-records-progress.png`
- `shared-flow-09-maat-owner-sees-member-progress.png`
- `shared-flow-10-created-flow-created-with-event.png`
- `shared-flow-11-created-flow-detail-calendar-picker-open.png`
- `shared-flow-12-created-flow-assigned-to-shared-calendar.png`
- `shared-flow-13-created-flow-member-can-access-flow.png`
- `shared-flow-14-created-flow-owner-records-progress.png`
- `shared-flow-15-created-flow-member-sees-owner-progress.png`
- `shared-flow-16-created-flow-member-progress.png`
- `shared-flow-17-created-flow-owner-sees-member-progress.png`

Additional diagnostic screenshots remain in this folder for older failed states and route/debug checks.

## Tests

- `dart format lib/data/shared_practice_models.dart lib/features/shared_practice/shared_practice_room_page.dart test/data/shared_practice_models_test.dart`
- `dart format lib/features/calendar/calendar_flow_pages.dart lib/features/calendar/calendar_flow_studio_models.dart lib/features/calendar/calendar_flow_studio_page.dart lib/features/calendar/calendar_page.dart lib/features/calendar/day_view.dart lib/features/shared_practice/shared_practice_room_page.dart lib/main.dart test/features/calendar/flow_studio_state_sync_regression_test.dart test/features/calendar/shared_flow_calendar_assignment_test.dart`
- `flutter test test/features/calendar/flow_studio_state_sync_regression_test.dart`
- `flutter test test/features/calendar/shared_flow_calendar_assignment_test.dart`
- `flutter test test/data/shared_practice_models_test.dart`
- `flutter analyze lib/features/calendar/calendar_flow_studio_models.dart lib/features/calendar/calendar_flow_studio_page.dart lib/features/calendar/calendar_flow_pages.dart lib/features/calendar/calendar_page.dart lib/features/calendar/day_view.dart lib/features/shared_practice/shared_practice_room_page.dart lib/main.dart test/features/calendar/flow_studio_state_sync_regression_test.dart test/features/calendar/shared_flow_calendar_assignment_test.dart test/data/shared_practice_models_test.dart`
- `git -C mobile diff --check`

Mobile source/test commit created: `1f253943e12fa0c386704c7414f24798d912a51e` (`Complete shared-calendar flow smoke path`).
