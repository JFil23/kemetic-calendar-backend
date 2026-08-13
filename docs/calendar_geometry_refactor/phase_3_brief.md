# Phase 3 Brief — Passive Scroll-Coordinator Shadow Run

Status: **Implemented and verified; stopped before Phase 4**

Date: 2026-08-13

## Objective

Wire the Phase 1 leading-edge resolver to the Phase 2 mounted-geometry
snapshots and run it passively beside the old centered selectors. Phase 3 may
observe, classify, and retain bounded diagnostics. It must not change the
month banner or any other authoritative calendar consumer.

## Authority and visible behavior

- The existing centered live-scroll selector remains the only banner writer.
- The existing scroll-end selector remains authoritative at scroll end.
- Shadow results never call `setState`, `_setView`,
  `_handlePortraitMonthChanged`, persistence, hydration, pinch, rotation, or
  navigation code.
- `scrolling_calendar_month_header_test.dart` retains the old centered
  assertions during this phase. The ratified leading-edge contract is spent
  only in the separate Phase 4 cutover.
- No RC or production deployment is part of Phase 3.

## Sampling contract

The coordinator has two independent input triggers because a geometry
generation does not change during ordinary scrolling:

1. scroll notifications queue one frame-coalesced sample using the newest
   scroll offset and newest complete snapshot; and
2. snapshot publication queues a geometry-only sample, including when the
   scroll offset has not changed.

Scroll end is an explicitly tagged scroll sample. Live and scroll-end shadow
selection use the same `CalendarBannerResolver`; the tag exists only to
compare the two old authoritative paths and classify their divergence.
A scroll-end notification arriving before a queued live sample is flushed may
not replace that live sample; the coordinator preserves one coalesced live
sample and one distinct settled sample.

On a new geometry generation at an unchanged offset, the resolver uses the
previous shadow month as the incumbent with
`geometryOnlyAtUnchangedOffset`. No direction or deadband is manufactured by
layout. Hydration, expansion, or corrected pixels therefore cannot change the
shadow banner under a stationary user.

## Freshness contract

Every resolved sample records:

- geometry generation;
- monotonically increasing scroll-sample serial;
- sampled scroll offset / activation coordinate;
- sample reason and resolver mode;
- old authoritative month;
- old selector candidate when independently available; and
- shadow result.

A result may enter the trace only if both its generation and its sample serial
are still current at commit time. A stale generation or stale serial is
rejected and counted, never committed. The activation coordinate is the
scroll offset itself: the fixed 58 px banner is outside the scroll viewport
and must not be added again.

## Diagnostic trace

Diagnostics are bounded in memory and retain transitions and divergences
only. They never log once per frame to the console. Cumulative category counts
remain available even when the bounded detail buffer evicts old entries.

The primary divergence taxonomy is frozen in this order so observations are
not made to fit an expected explanation:

1. `interstitialOwnership` when the activation line is in a divider or season
   header owned by the following month;
2. `heriu` when either compared result is Heriu Renpet;
3. `legacyScrollEndBias` when a scroll-end sample differs from the old precise
   scroll-end calculation;
4. `samplingCadence` when the independently measured old candidate and old
   authoritative state differ;
5. `centerVsLeadingEdgePolicy` for an adjacent-month centered-versus-leading
   result; and
6. `unclassified` for every remaining divergence.

An unclassified result is reported as such. Category counts are diagnostic,
not pass/fail expectations. The old system is known-defective and is a
comparison target, not an oracle.

## Expected observations, not required results

The following are hypotheses to measure, not counts to manufacture:

- centered-versus-leading differences at normal month boundaries;
- Heriu-specific differences now that month 13 mounts structurally;
- following-month ownership while a gold divider or season header occupies
  the activation line; and
- scroll-end differences caused by the old coordinate calculation.

Any different observation or absence of an expected observation is reported
without changing the code to force agreement.

## Required tests

- a scroll-offset change resolves without a new geometry generation;
- a geometry-only generation at an unchanged offset preserves the mounted
  incumbent and applies no deadband;
- stale generations and stale scroll serials cannot commit;
- repeated scroll input in one frame coalesces into one resolution;
- the detail trace remains bounded while cumulative counts remain accurate;
- interstitial ownership is measurable without a `GlobalKey` lookup;
- live and scroll-end shadow samples call the same resolver;
- Phase 3 introduces no authoritative mutation writer; and
- the full suite is run against the exact Phase 3 commit.

## Non-goals and protected adjacent work

- no banner authority cutover or centered-test migration;
- no restoration, hydration, pinch, rotation, or navigation cutover;
- no revival of the nondeterministically stalling macOS profile rig;
- no repair of the separately tracked 201 px Heriu header overflow;
- no repair of the separately tracked `_KemeticKeyboardHostState` focus
  exception;
- no compositor/covered-route paint work;
- no converter unification; and
- no PWA delivery-weight work.

## Stop and report gate

Run the full suite against the exact commit. The inherited baseline is six
fixed failures with the frozen identities and byte-diagnostic fingerprint in
`baseline_exception.md`. Any seventh failure, changed identity, changed
diagnostic fingerprint, or inherited red turning green is a stop-and-report
condition. Do not alter code, assertions, or diagnostics to recover the
expected result. Report observed divergence counts by the frozen taxonomy and
stop; Phase 4 requires a separate product-owner instruction.

## Completion record

Completed: 2026-08-13

Mobile commit:
`7db9048fa5827517ce5b35c15501b9b833999135`

The first exact-commit full-suite run stopped on a seventh failure. The
calendar hydration architecture guard locates `CalendarPageState.initState`
with a source-text anchor that requires `EndFlowAuthReadiness.instance` to
immediately follow `super.initState()`. Coordinator construction had been
inserted between those statements. No behavior protected by the guard had
changed, but its implementation matcher no longer found the expected anchor.
The product owner authorized moving coordinator construction below the
readiness call. The guard and every assertion remained untouched, and the
mobile commit was amended before the verification rerun.

Exact-commit verification then completed 2,179 tests in 1,108.202 seconds:

| Result | Count |
|---|---:|
| Passed | 2,171 |
| Skipped | 2 |
| Failed | 6 |
| Completed | 2,179 |

The six failures have the fixed paths and names in `baseline_exception.md`.
Their sorted path/name/error/stack-trace diagnostic payload has SHA-256
`36ca4dd662f8bb8903efa477f0c9f4fbce63d0e278e1657081a77ab2d6577a54`
and compares byte-for-byte equal with the Phase 0 artifact. No inherited red
turned green.

Focused coordinator, resolver, geometry, production-smoke, and architecture
tests passed (42 tests), and focused analysis reported no issues. The full
analyzer retained only the 21 inherited `unnecessary_string_escapes` infos.

## Shadow observations

The deterministic production-calendar traversal committed 11 samples, with
zero stale-generation and zero stale-scroll-serial rejections. The frozen
taxonomy reported:

| Category | Count |
|---|---:|
| `centerVsLeadingEdgePolicy` | 2 |
| `heriu` | 0 |
| `interstitialOwnership` | 1 |
| `legacyScrollEndBias` | 1 |
| `samplingCadence` | 0 |
| `unclassified` | 7 |

Every one of the seven unclassified records was inspected individually. All
seven were live-scroll samples; the old live candidate and authoritative month
agreed in every record. The shadow result owned the top-edge activation
coordinate, while the old result owned the viewport-center neighborhood. Six
records differed by two logical months and the year-boundary record differed
by one.

This is not a fourth resolver defect, stale-snapshot failure, or sampling
coalescing artifact. The test viewport's scrollable height is 1,086 px, so the
old activation line is 543 px below the new top-edge line. Rendered sections in
the sample were roughly 326–363 px tall, allowing the old center selector to
lead by two months. The frozen Phase 3 classifier calls a centered-versus-
leading divergence `centerVsLeadingEdgePolicy` only when the months are
adjacent; larger policy distances therefore fall through to `unclassified`.
The records remain in that frozen category, but their cause is identified.

Snapshot generation `0` was coherent: the collector published once, rejected
zero candidates, and the section extents remained stable during ordinary
scrolling. A geometry generation is not expected merely because the scroll
offset changes.

## Boundary probe

A temporary diagnostic widget probe exercised the real production calendar
around Mesut-Ra → Heriu Renpet → next-year Thoth at 20 px slow-scroll samples,
a forward fling, and a slow reverse pass. It was removed after the run; the
committed test and production trees remained unchanged.

Observed section boundaries were 4,017.60 px for Mesut-Ra → Heriu and 4,189.25
px for Heriu → Thoth. With the ratified 8 px directional deadband:

- forward, the shadow held Mesut-Ra at 4,005.60, selected Heriu at 4,025.60,
  held Heriu at 4,185.60, and selected Thoth at 4,205.60;
- reverse, it held Thoth at the 4,189.25 boundary, selected Heriu by 4,169.25,
  and selected Mesut-Ra at 4,009.25; and
- the fling crossed multiple sections and settled at 4,944.77 with both the
  snapshot owner and shadow result at next-year month 3.

The probe passed without a layout, geometry, focus, or disposal exception.
These observations validate the Phase 1 boundary and multi-section-jump
policy on Phase 2 production geometry. They do not cut banner authority over;
the visible banner remains intentionally centered until a separately
authorized Phase 4 commit.
