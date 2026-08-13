# Phase 0 Performance Baseline

Baseline source: parent `b8be991`, mobile `3fc62eb`

Baseline artifact: `staging-3fc62eb-f8157a5a24f8`

Date: 2026-08-13

## Available baseline surfaces

At Phase 0, Flutter reported these available targets:

| Target | Identity |
|---|---|
| Physical iPhone | iOS 26.2.1, device `00008110-0004058E0A2A801E` |
| iPhone 17 simulator | iOS 26.2 simulator |
| macOS | macOS 15.7.4 |
| Chrome | 151.0.7922.109 |

The sealed Cloudflare artifact uses Flutter 3.35.3 / Dart 3.9.2 and is served
through CanvasKit assets included in the verified payload.

## Live RC smoke baseline

The verified stable alias was opened at a temporary 390 × 844 mobile viewport.
The authenticated calendar rendered and responded to bidirectional scroll input.
No runtime error was recorded during the smoke pass. The browser console
contained one pre-existing warning that Flutter could not find a Noto fallback
covering every missing character.

That font warning is recorded as baseline evidence; it is not introduced by the
geometry work and must not be misclassified later as a new failure.

## Quantitative frame baseline status

The current application has no checked-in repeatable calendar frame-timing
benchmark. The browser-control surface available during Phase 0 does not expose
page `performance`, animation-frame, or Flutter engine timing APIs, so inventing
a p95 number here would not be reproducible.

This is an explicit baseline limitation, not permission to skip performance
comparison. The sealed Phase 0 artifact and source are immutable comparison
inputs. During the Phase 2 geometry feasibility gate, before any UI consumer
cutover, the program must add a repeatable profile-mode calendar scroll harness
and run it against both:

1. this frozen Phase 0 source/artifact; and
2. each candidate geometry publication mechanism.

The selected mechanism cannot advance without that A/B result.

## Required harness workload

Use the same device, build mode, viewport, seeded calendar data, and gesture
script for every sample. The workload must include:

- slow forward and reverse traversal through months 11, 12, Heriu, next-year 1,
  and 2;
- a multi-month fling and settle;
- compact and details layouts;
- empty and event-heavy months;
- a stationary hydration-driven height change;
- at least ten years of traversal for registry/memory observation;
- an idle period after scrolling to detect continuous frame scheduling.

Record:

- Flutter build and raster frame distributions;
- p50, p95, p99, and maximum frame time;
- frames above the target refresh budget;
- janky-frame percentage;
- peak and settled memory;
- mounted snapshot entry count over time;
- page rebuild count for a banner-only transition;
- idle scheduled-frame count.

## Acceptance guardrails

- No continuous frame scheduling while idle.
- Snapshot memory remains bounded by the mounted/cache window.
- Ten-year traversal does not cause monotonic geometry-registry growth.
- Banner-only transitions do not rebuild the full calendar page.
- p95 build or raster time does not regress by more than 10% against this
  frozen baseline when measured by the common harness.
- Janky-frame percentage does not increase by more than one percentage point.
- A persistent regression is a stop condition; thresholds may not be relaxed
  silently.

## Test-suite baseline

The serial test-suite result and its deterministic inherited failures are
recorded in [test_baseline.md](test_baseline.md). Integration tests are not
included in that command and require their own device/environment
prerequisites.
