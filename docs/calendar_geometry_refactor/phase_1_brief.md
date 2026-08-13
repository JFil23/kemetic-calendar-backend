# Phase 1 Brief — Pure Calendar Geometry Domain

## Scope

Phase 1 adds pure identities, calendar section indexing, day validation and
normalization, section ownership, canonical coordinate math, immutable geometry
snapshot value types, and leading-edge resolver policy. It does not touch the
widget tree, scroll controller, sliver publication, hydration, persistence,
navigation, or deployed artifacts. Nothing visible should change.

## Required authorities and policies

### Past-side coordinate normalization

Past slivers before `CustomScrollView.center` are built nearest-year first.
Their `precedingScrollExtent` grows away from the center along that side's
growth direction. A named pure normalization function must reverse and negate
that representation into the common chronological coordinate domain:

```text
leading = centerOrigin - precedingScrollExtent - sectionExtent
trailing = centerOrigin - precedingScrollExtent
```

The result is a half-open `[leading, trailing)` extent. Earlier sections are
more negative, the center boundary is zero, and chronological order increases
through past, center, and future sections. This math requires separate tests for
the nearest past section, multiple accumulated past sections, and continuity at
the center boundary.

### Sole calendar-length authority

`KemeticMath` and its fixed repeating year cycle `[365, 365, 366, 365]` are the
sole authority for section length and day validity. Months 1–12 have 30 days;
Heriu Renpet has five days except for the six-day year identified by
`KemeticMath.isLeapKemeticYear`.

The geometry domain must not import or call `KemeticConverter`, duplicate the
leap formula, infer length from rendered children, or derive validity from day
card data. `DayRef` validation and clamping must use the same authority.

### Geometry-only banner resolution

A new geometry snapshot received at an unchanged scroll offset is resolved as
a geometry-only sample. The previous active month is passed as incumbent, no
scroll direction is inferred, and directional deadband is disabled. A mounted
incumbent remains selected until a real user, ballistic, or programmatic scroll
sample arrives; if it is no longer mounted, the new top-edge owner is used.
Hydration or expansion resizing therefore cannot flip the banner under a
stationary user or synthesize direction from layout correction.

## Phase 1 acceptance

- all 13 months have stable logical identities in every supported integer year;
- predecessor/successor and ordinal conversion work across year zero and year
  boundaries;
- Heriu day 6 is accepted only in the authoritative six-day year;
- invalid restored days clamp to the valid range for the target section;
- divider and season-header identities are owned by the following month;
- past and future geometry normalize into one monotonic coordinate domain;
- snapshots are immutable, generation-tagged, ordered, unique, and
  non-overlapping;
- the leading-edge resolver handles direct ownership, both deadband directions,
  multi-section jumps, and geometry-only samples;
- the new domain contains no Flutter widget or render-object types; and
- validation preserves exactly the documented six-red baseline.

## Completion record

Completed: 2026-08-13

Implementation consists of:

- `calendar_section_index.dart`: stable `MonthRef`, validated/clamped `DayRef`,
  ordinal chronology, authoritative Heriu length, and following-month
  interstitial ownership;
- `calendar_geometry_snapshot.dart`: named past/future normalization,
  half-open canonical extents, section geometry, and immutable
  generation-tagged snapshots; and
- `calendar_banner_resolver.dart`: top-edge resolution, symmetric directional
  deadband, multi-section jump handling, and stationary geometry-only policy.

Verification:

- 33 focused Phase 1 tests pass;
- focused static analysis reports no issues;
- the full serial suite completed 2,156 tests: 2,148 passed, 2 skipped, and
  exactly the fixed six failed in 1,111.774 seconds;
- the sorted path, name, error, and stack-trace payload for those six has the
  same Phase 0 and Phase 1 SHA-256 fingerprint,
  `36ca4dd662f8bb8903efa477f0c9f4fbce63d0e278e1657081a77ab2d6577a54`;
- the full analyzer reports exactly the 21 documented baseline infos, with no
  new warning, error, or info identity; and
- no widget, scroll controller, navigation, persistence, hydration, or
  deployment code changed.
