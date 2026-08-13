# Phase 2 Brief — Uniform Sections and Passive Geometry Publication

Status: **Implemented; full-suite verification pending**

Date: 2026-08-13

## Objective

Prove the running-app geometry mechanism on the real lazy calendar while
giving months 1–13 one structural section contract. Phase 2 may publish atomic
snapshots for diagnostics and tests, but no banner, restoration, hydration,
pinch, rotation, or navigation consumer may read them authoritatively.

## Structure contract

- Preserve the fixed-length top-level `CustomScrollView.slivers` array and the
  lazy `SliverList` per past/future year. Months do not become top-level
  slivers.
- Every month is wrapped in one section carrying `MonthRef`.
- A section contains its leading divider, any leading season header, and its
  month body. Month 1 owns the previous-year divider and Akhet heading; months
  5 and 9 own the Peret and Shemu headings; Heriu owns its leading divider.
- The trailing divider after the old Heriu card is removed because that
  divider belongs to next-year month 1.
- Existing month-body and header `GlobalKey`s remain temporarily for the old
  consumers. Month 13 receives the same legacy body/header anchors as months
  1–12. The new geometry collector does not read or create those keys.

## Heriu behavior expected in this phase

Giving Heriu a legacy body anchor means the still-authoritative centered
selector can select month 13 before the leading-edge banner cutover. This is an
expected RC-visible structural checkpoint, not a banner-authority cutover and
not a regression to suppress.

When the old selector changes the active month to Heriu, existing day
normalization executes in production for the first time. Five-day years clamp
to 1–5 and six-day years clamp to 1–6 through the same `KemeticMath` authority
used by `CalendarSectionIndex`.

## Day-anchor ownership

Heriu day chips mirror ordinary day chips:

- `_todayDayKey` is attached only as the day chip's primary `anchorKey` when
  that chip is today;
- `dayAnchorKeyProvider(13, day)` is attached only as the separate highlight
  anchor layer; and
- no wrapper, header, or second chip may attach either key.

This prevents the duplicate-`GlobalKey` crash that otherwise appears only
during the five or six Heriu days.

## Collector mechanism

- A dedicated `CalendarGeometryCollector` is owned and disposed by
  `CalendarPageState` and supplied through an inherited scope around the
  portrait scroll view.
- Each section uses a `RenderProxyBox` only to register mounted identity,
  report layout invalidation, and expose its final render box to the collector.
- The proxy does not publish its own offset from `performLayout`; an ancestor
  may not have assigned that offset yet.
- One coalesced post-frame callback reads final mounted transforms through the
  enclosing `RenderAbstractViewport`. Flutter's reveal coordinate therefore
  includes the owning sliver's `precedingScrollExtent` and center-side growth
  direction without a layout-time `setState` or `GlobalKey` lookup.
- The collector creates a complete immutable
  `CalendarGeometrySnapshot` in logical order and publishes it as one new
  generation only when mounted geometry actually changes.
- Registration is removed on render-object detach, so retained state is
  bounded by the sliver/cache window.
- Publication does not call `scheduleFrame`; an idle layout schedules no
  callbacks or frames.

## Restoration guard disposition

The inherited red guard extracts only `_restoreFlowStudioOverlay` and its
detached counterpart from `calendar_page.dart`. Geometry publication lives in
a dedicated module and does not become a restoration owner. The existing guard
and its failure diagnostic remain byte-identical; it must not be relaxed or
allowlisted for this work.

## Required tests

- centered viewport publishes past-negative, center-zero, and future-positive
  canonical extents in chronological order;
- layout bursts coalesce into one atomic generation;
- an unchanged idle tree publishes nothing further and schedules no frame;
- detached/lazily evicted sections disappear and registry size remains bounded
  during long traversal;
- all 13 real `_YearSection` children use the uniform wrapper exactly once;
- interstitial ownership is following-month, including Heriu → next-year
  Thoth;
- Heriu exposes body/header anchors and distinct today/highlight anchor slots;
- five- and six-day clamping remains correct; and
- old banner/restoration/hydration/pinch/rotation authority is unchanged.

## Performance and stop gates

Use one common profile-mode device, seeded data, viewport, and gesture script
for the frozen baseline and Phase 2 candidate. Record build/raster percentiles,
janky frames, memory, mounted-entry count, publication count, and idle frames.

Stop Phase 2 for:

- any failure outside the fixed six identities;
- any change in the fixed-six diagnostic fingerprint;
- duplicate, reversed, or overlapping snapshot geometry;
- layout-time `setState`, a `GlobalKey` geometry lookup, or continuous idle
  scheduling;
- monotonic registry growth across long traversal;
- p95 build/raster regression greater than 10%; or
- janky-frame regression greater than one percentage point.

## Profile-rig disposition

The profile comparison is unresolved and is not a Phase 2 landing gate. The
product owner made that disposition explicitly on 2026-08-13 after the rig
showed nondeterministic stalls and could exercise only the macOS desktop
target.

Observed results are retained without reinterpretation:

- one frozen-Phase-0 run completed and emitted timing/memory data, but exited
  `1` because `idle_frames` was `0` while `idle_frame_scheduled` was `true`
  against an expected `false`;
- an unchanged preservation repeat stalled after the first-traversal marker
  with the app and driver at 0% CPU; and
- the Phase 2 candidate build was stopped at the product owner's direction
  before it produced a measurement.

No percentile, jank, memory, or idle-performance parity claim follows from
these runs. The temporary profile fixture and driver are not part of the Phase
2 structural commit. A future performance gate needs a stable device-capable
rig and an independently ratified idle-frame oracle.
