# Calendar Geometry Test Migration Manifest

Status: Phase 0 initial classification

Baseline source: parent `b8be991`, mobile `3fc62eb`

Any test affected by the refactor but absent from this manifest is an
**unexpected failure**. Implementation stops before changing that test or its
assertions. The manifest may be amended only through an explicit reviewed
decision, not retroactively as part of making a red test green.

## A. Authorized contract replacements

These changes are authorized only in the banner cutover commit.

| Test | Current contract | Required replacement |
|---|---|---|
| `mobile/test/features/calendar/scrolling_calendar_month_header_test.dart` — `shows the centered Kemetic month and its year context` | Component is described as presenting the centered month. | Rename/reframe as presenting the active leading section while preserving month text, season/year context, semantics, and fixed height. |
| Same file — `cross-fades when the centered month changes` | Transition is described in terms of centered state. | Preserve the transition behavior but describe the input as the active leading month. Selector behavior must be tested separately through the coordinator. |

The existing component tests do not prove scroll selection. New integration or
coordinator tests must cover top-edge ownership, both directions, Heriu, the
month 12 → 13 → next-year month 1 boundary, interstitial ownership, and the
deadband.

## B. Implementation guards requiring stronger successors

These tests may be removed only in the phase that deletes the old mechanism.

| Test | Old mechanism protected | Stronger successor required |
|---|---|---|
| `mobile/test/features/calendar/calendar_month_key_test.dart` — `keyForMonth returns a stable key for the same month` | Stable GlobalKey identity for geometry lookup. | Logical `MonthRef` identity is stable; geometry lookup creates no keys; every mounted section appears exactly once in a snapshot; registry size is bounded. |
| `mobile/test/features/calendar/hydration/calendar_viewport_geometry_test.dart` — `contains every month occupying visible pixels` | Visibility derived from synthetic GlobalKey bounds. | Snapshot intersection includes every physically visible section. |
| Same file — `sorts correctly across a Kemetic year boundary` | Synthetic month 13 → next-year month 1 sorting. | Canonical snapshot coordinates sort month 12 → Heriu → next-year month 1 on both sides of the center sliver. |
| Same file — `edge-only contact does not expand the requested range` | Edge intersection semantics. | Preserve the same half-open interval behavior in the new snapshot resolver. |

## C. Protected invariants expected to be directly touched

These tests remain green. Fixture/schema updates are permitted only when the
asserted behavior remains at least as strong.

### Header presentation

- `scrolling_calendar_month_header_test.dart` — `fits long month names on a narrow calendar viewport`.

### Restoration storage and validation

- `app_restoration_service_test.dart` — `stores route, calendar, day view, and day sheet per window`.
- Same file — `keeps restorable routes and calendar position in the same snapshot`.
- Same file — `accepts the labeled calendar expansion restoration state`.
- Same file — `drops invalid nested restoration payloads without losing route`.
- Same file — `rejects invalid calendar writes before they reach durable storage`.
- `app_navigation_restoration_controller_test.dart` — `stale legacy inbox plus valid calendar state launches Calendar`.
- Same file — `calendar page-state writes preserve the durable Library launch route`.
- Same file — `calendar Day View state restores with the durable Calendar launch route`.
- Same file — `warm cache and calendar restore do not replace deferred durable page`.

Required additions in the restoration phase:

- mismatched layout revision preserves valid logical year/month/day and
  preferences while discarding legacy pixels;
- invalid logical identity falls back to today;
- day 30 normalizes to day 5 in a five-day Heriu year;
- day 30 normalizes to day 6 in a six-day Heriu year;
- new logical anchors round-trip through durable storage;
- banner transitions do not write restoration state.

### ANR and covered-route paint safety

- `day_view_rotation_anr_guard_test.dart` — `covered Calendar route does not build hidden landscape grid`.
- Same file — `covered Calendar route skips heavy calendar body builds`.
- Same file — `portrait recenter keeps Calendar body painted`.
- `detail_sheet_unification_guard_test.dart` — `Main Calendar keeps rendering behind detail and quick-add sheets`.
- Same file — `Main Calendar quick-add sheet uses transparent route background`.

These assertions may not be weakened by the geometry branch.

### Pinch and expansion

- All tests in `mobile/test/core/pinch_gesture_surface_test.dart`.
- `landscape_month_view_test.dart` — `pinch expansion has four persisted states and no action control`.
- Same file — `calendar expansion restoration uses interrupted settle target`.
- Same file — `calendar date system toggle does not post-frame repair scroll`.

Required additions in the pinch phase:

- focal point inside Heriu resolves to Heriu;
- divider and season-header focal points resolve to the following month;
- a new snapshot generation preserves the focal logical anchor;
- pinch does not indirectly write banner or restoration state.

### Landscape and rotation identity

- `landscape_month_view_test.dart` — `reports the current month when disposed after a settled swipe`.
- Same file — `reports the rounded visible month when disposed during a swipe`.
- Existing layout, overflow, event-card, and typography tests in that file.

New rotation tests must prove that portrait and landscape exchange logical
`MonthRef`, optional day, and intra-section alignment rather than pixel offsets.

### Restoration architecture ownership

The following `restoration_architecture_guard_test.dart` tests are protected:

- `scoped session persistence stays in the approved files`;
- `permanent restoration writes stay in the approved files`;
- `calendar action entrypoints stay centralized`;
- `calendar sheet continuity keeps the boot retry restorer`;
- `custom gesture systems stay documented and allowlisted`;
- `calendar launch restores app-owned route and sheet state`.

If a new coordinator file legitimately becomes a persistence or gesture owner,
the allowlist change must be predeclared in the phase commit and preserve single
ownership. An unexpected match is a stop condition.

## D. New invariant suites required before cutover

The refactor must add tests for:

- logical months 1–13 in every supported year;
- authoritative five/six-day Heriu validation;
- chronological predecessor/successor across year boundaries;
- deterministic ownership of every divider and season header;
- ordered, non-overlapping mounted extents;
- canonical normalization of past/negative and future/positive offsets;
- atomic snapshot generation and stale-result rejection;
- no idle publication loop;
- bounded mounted-geometry memory;
- one resolver for live and scroll-end samples;
- direction-aware deadband in both directions;
- stationary geometry changes preserving the incumbent while it owns the
  activation line;
- hydration including Heriu-only viewports;
- distant logical materialization followed by physical alignment;
- exactly one authoritative writer per consumer.
