# Phase 4 Brief — Leading-Edge Banner Authority Cutover

Status: **Implemented, verified, and simulator-approved**

Date: 2026-08-13

> Historical boundary note: this brief records the first RC cutover, whose
> banner handoff was the incoming section edge. After phone review, the product
> owner amended only the banner handoff to the measured edge after the outgoing
> third-decan label. The current binding decision is in
> `product_contract.md`; physical section ownership described here is unchanged.

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
- the switch uses an 8 px direction-aware deadband;
- the banner text changes immediately, without a fade, slide, or other visual
  transition; and
- Heriu Renpet is an ordinary selectable month between Mesut-Ra and next-year
  Thoth.

No other locked assertion was replaced.

## Implementation

Authority-cutover mobile commit:
`73765b96ef106ba33fc32637d3a52f263d1fb1b3`

No-animation follow-up mobile commit:
`9c72f2852d35f3bc3911b897267cb9caf2595727`

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

The follow-up removes the header's 160 ms `AnimatedSwitcher` and its outgoing
child stack. The coordinator boundary and deadband are unchanged; each new
month row replaces the previous row in the first rebuilt frame.

## Tests

The authorized header tests now describe the active leading month while
preserving text, transliteration, season/year, semantics, height, and
narrow-viewport behavior.

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
  by the coordinator; and
- an active-month update removes the old month immediately and the header
  contains no `AnimatedSwitcher`.

Focused analysis of the seven changed/tested files reported no issues. The
full analyzer reported exactly the inherited 21
`unnecessary_string_escapes` infos and no new warning, error, or info identity.

The focused Phase 4 gate passed 48 tests across resolver, coordinator, header
presentation, production-calendar smoke, uniform Heriu structure, hydration
architecture, day-view rotation ANR protection, and detail-sheet paint
protection. The same 48-test gate passed again after the no-animation
follow-up. Focused analysis of the changed header and test also reported no
issues.

## Exact full-suite gate

The full suite ran serially against the exact no-animation mobile commit with:

| Result | Count |
|---|---:|
| Passed | 2,175 |
| Skipped | 2 |
| Failed | 6 |
| Completed | 2,183 |

Elapsed time was 1,142.789 seconds. The six failures have exactly the frozen
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

The exact no-animation follow-up was then run on the same simulator. Forward
and reverse passes across Heriu Renpet and Thoth showed only the active banner
label after each crossing, with no visible overlap or cross-dissolve. The
widget test separately proves that the old label is absent in the first rebuilt
frame.

## Narrow-phone Heriu follow-up

Before producing an RC web artifact, the separately tracked Heriu header
overflow was reproduced against the untouched Phase 4 candidate through the
real production `CalendarPage` at a 390×844 logical viewport. Both a five-day
Heriu year and a six-day Heriu year overflowed by exactly 201 pixels.

The render tree identified the same cause in every mounted Heriu section: its
531-pixel month title received unconstrained width inside a 330-pixel header
row. Regular months already bounded the title with a 3:1
`Expanded`/`Flexible` header. Mobile commit
`fd1d6ed493a1aa689b58510dcb859c62a0889222` gives Heriu that same structural
contract; it does not hide or clip a still-overflowing row.

A production-page regression test now mounts both five- and six-day Heriu
years at exactly 390×844 and requires a mounted month-header anchor with no
Flutter exception. Focused analysis reported no issues. The protected gate
passed 49 tests: the prior 48 plus the new narrow-layout regression.

The full suite then ran serially against that exact commit. It observed 2,176
passes, 2 skips, and the fixed 6 failures, for 2,184 completed tests in
1,118.583 seconds. The sorted failure diagnostic payload is 362,648 bytes,
remains byte-for-byte equal to the Phase 4 no-animation baseline, and retains
SHA-256
`36ca4dd662f8bb8903efa477f0c9f4fbce63d0e278e1657081a77ab2d6577a54`.
No inherited failure turned green and no seventh failure appeared.

## Non-goals preserved

- no restoration, hydration, pinch, rotation, landscape, or distant-navigation
  cutover;
- no edit to the fixed six failures;
- no profile-rig revival;
- no repair of the separately tracked `_KemeticKeyboardHostState` focus
  exception;
- no compositor/covered-route paint work;
- no converter unification;
- no PWA delivery-weight work; and
- no RC or production deployment.

## Final-day-block banner-policy follow-up

Phone review of the first CanvasKit RC refined the banner-only boundary. Mobile
commit `5ff66008f6bd083147637ed4962db91f6ecf3f66` publishes a measured handoff edge
immediately after each regular month's third-decan label and at Heriu Renpet's
sole weekday/day block. `CalendarBannerResolver` maps that outgoing edge to the
logical successor while retaining the existing symmetric 8 px deadband.

Physical section ownership is unchanged. Gold dividers and season headers
still belong to the following month, and restoration, hydration, pinch,
rotation, landscape, and distant navigation continue to use their existing
writers.

Focused static analysis reported no issue. The protected calendar, hydration,
ANR, and covered-route paint gate passed 76 tests. The full analyzer retained
only the 21 inherited `unnecessary_string_escapes` infos. The exact serial full
suite observed 2,181 passes, 2 skips, and the fixed 6 failures, for 2,189
completed tests in 1,039.385 seconds.

The product owner explicitly waived the historical byte-level diagnostic
fingerprint after this run because neither its original serialized artifact nor
its generating procedure exists in the repository. The six paths/names matched
the frozen set and no allowed failure source or assertion changed. The
replacement reproducible identity gate is documented in
`baseline_exception.md`.
