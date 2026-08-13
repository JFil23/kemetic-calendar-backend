# Phase 4 Brief — Leading-Edge Banner Authority Cutover

Status: **Implemented, verified, and simulator-approved**

Date: 2026-08-13

## Objective

Make the fixed 58 px scrolling month banner read the coordinator's ratified
top-edge result instead of `_lastView`, while leaving every other calendar
consumer on its existing writer.

## Authorized contract spent

The product owner explicitly authorized replacing the two centered-language
assertions in `scrolling_calendar_month_header_test.dart`. The banner contract
is now:

- the activation line is the top edge of the scroll viewport directly below
  the fixed banner;
- a gold divider or season header belongs to the month after it;
- the switch uses an 8 px direction-aware deadband; and
- Heriu Renpet is an ordinary selectable month between Mesut-Ra and next-year
  Thoth.

No other locked assertion was replaced.

## Implementation

Mobile commit:
`73765b96ef106ba33fc32637d3a52f263d1fb1b3`

`CalendarScrollCoordinator` owns a private `ValueNotifier<MonthRef>` seeded
from today's logical month and exposes it only as
`ValueListenable<MonthRef> activeBannerMonth`. A fresh, generation- and
scroll-serial-validated non-null resolver result updates that notifier. A
duplicate result produces no notification.

`CalendarPageState._buildBodyWithJournal` binds only the
`ScrollingCalendarMonthHeader` subtree through a
`ValueListenableBuilder<MonthRef>`. The builder derives display metadata and
the Gregorian year label from the active `MonthRef`. The binding contains no
`_lastView`, page `setState`, restoration call, or hydration call.

The old centered live and scroll-end selectors remain active because
restoration, hydration, pinch, rotation, landscape handoff, and distant
navigation still consume their state. Their writes no longer control the
banner. Shadow comparison remains diagnostic and is not an authority oracle.

## Tests

The authorized header tests now describe the active leading month while
preserving text, transliteration, season/year, semantics, animation, height,
and narrow-viewport behavior.

New tests prove:

- a fresh non-null resolution publishes through `activeBannerMonth` exactly
  once and an unchanged result does not notify;
- forward switching holds Mesut-Ra through 107.999 and selects Heriu at 108;
- forward switching holds Heriu through 137.999 and selects Thoth at 138;
- reverse switching holds Thoth through 122.001 and selects Heriu at 122;
- reverse switching holds Heriu through 92.001 and selects Mesut-Ra at 92;
- the production banner binding reads coordinator year/month and contains no
  `_lastView`, `setState`, restoration, or hydration reference;
- coordinator banner authority contains no page, restoration, hydration,
  navigation, or console writer; and
- a real production-calendar traversal renders the same month text published
  by the coordinator, including during `AnimatedSwitcher` transitions.

Focused analysis of the seven changed/tested files reported no issues. The
full analyzer reported exactly the inherited 21
`unnecessary_string_escapes` infos and no new warning, error, or info identity.

The focused Phase 4 gate passed 48 tests across resolver, coordinator, header
presentation, production-calendar smoke, uniform Heriu structure, hydration
architecture, day-view rotation ANR protection, and detail-sheet paint
protection.

## Exact full-suite gate

The full suite ran serially against the exact mobile commit with:

| Result | Count |
|---|---:|
| Passed | 2,175 |
| Skipped | 2 |
| Failed | 6 |
| Completed | 2,183 |

Elapsed time was 1,126.913 seconds. The six failures have exactly the frozen
paths and names in `baseline_exception.md`. Their sorted
path/name/error/stack-trace payload has SHA-256
`36ca4dd662f8bb8903efa477f0c9f4fbce63d0e278e1657081a77ab2d6577a54`
and is byte-for-byte equal to the Phase 0 artifact. No inherited failure
turned green.

## Simulator verification

The exact committed candidate was launched on the local iPhone 17 simulator
with the existing nonpublic staging runtime configuration. No deployment was
performed.

The restored calendar opened at next-year Thoth. A reverse pass placed Heriu
Renpet at the activation line, and the banner displayed `Heriu Renpet` while
the Thoth-owned leading section remained below the line. A forward pass changed
the banner to `Thoth` when the leading gold divider / Akhet season header owned
by Thoth reached the activation boundary. Reversing across the buffer changed
the banner back to `Heriu Renpet`.

The observed order and hysteresis matched the ratified contract in both
directions. No calendar layout, geometry, focus, or disposal exception was
observed during the transition. The simulator did emit its existing missing
Firebase initialization configuration warning at startup; that warning is
unrelated to this branch and did not block the calendar run.

## Non-goals preserved

- no restoration, hydration, pinch, rotation, landscape, or distant-navigation
  cutover;
- no edit to the fixed six failures;
- no profile-rig revival;
- no repair of the separately tracked 390×844 Heriu header overflow;
- no repair of the separately tracked `_KemeticKeyboardHostState` focus
  exception;
- no compositor/covered-route paint work;
- no converter unification;
- no PWA delivery-weight work; and
- no RC or production deployment.
