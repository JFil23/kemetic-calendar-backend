# Calendar Geometry Refactor

This directory is the authority record for the RC-only calendar geometry
refactor. The work begins from parent commit
`b8be991ad9be2297223ab4e56c580838cf2c8067` with mobile gitlink
`3fc62eb518d487fe087b80edceab56f91c70c2dd`.

The program replaces the calendar's fragmented GlobalKey geometry lookups with
a logical month index, atomic mounted-geometry snapshots, and one scroll
coordinator with separate consumer policies for the banner, restoration,
hydration, pinch, and rotation.

## Phase order

0. Establish source authority, baselines, product policy, and test governance.
1. Add pure calendar identity, validation, section ownership, and resolver
   policy types.
2. Prove a lazy, sliver-aware, atomic geometry publication mechanism while
   routing months 1–13 through one structural section path. Publication is
   passive and no consumer authority changes.
3. Run the new coordinator in instrumented passive shadow mode.
4. Cut the banner over to the ratified scroll-geometry contract. The first RC
   used the incoming section edge; phone review then amended the banner-only
   handoff to the measured edge after the outgoing third-decan label. See
   `product_contract.md`.
5. Migrate restoration to logical anchors and reject legacy pixel geometry.
6. Cut hydration over to snapshot-derived visible ranges.
7. Cut pinch targeting over to section geometry.
8. Cut rotation, landscape handoff, and distant navigation over to logical
   anchors.
9. Delete the old GlobalKey geometry database and competing selectors.
10. Verify and deploy an RC artifact. Production remains untouched.

## Priority decision

The product owner explicitly chose calendar work before delivery-weight work
on 2026-08-13. Phases 3 and 4 of this program land and receive their separate
verification checkpoints before PWA artifact-weight reduction resumes. This is
a priority decision only; it does not pull delivery-weight changes into the
calendar branch.

Phase 1 is complete in the mobile repository. It adds only pure domain and
policy files plus 33 passing unit tests; no widget or existing application
behavior file changed. Phase 2 is implemented on the RC branch as the first
running-app fork: all 13 months share one structural section path and publish
passive mounted-geometry snapshots, while every existing consumer remains on
its old authoritative path pending later cutover phases. Phase 3 is complete
and verified at mobile commit `7db9048fa5827517ce5b35c15501b9b833999135`:
the new coordinator resolves the mounted snapshots in passive shadow mode,
while the old selector remains available for legacy consumers and diagnostics.
Phase 4 is complete and verified at mobile commit
`73765b96ef106ba33fc32637d3a52f263d1fb1b3`: the banner alone now reads the
coordinator's leading-edge month through an isolated listenable. Restoration,
hydration, pinch, rotation, and distant navigation remain on their existing
writers pending their later phases. The visual follow-up at mobile commit
`9c72f2852d35f3bc3911b897267cb9caf2595727` removes the month-label
cross-dissolve so the banner changes immediately at the same boundary. The
narrow-phone Heriu follow-up is complete at mobile commit
`fd1d6ed493a1aa689b58510dcb859c62a0889222`. The final-day-block handoff
follow-up is sealed at mobile commit
`5ff66008f6bd083147637ed4962db91f6ecf3f66`: regular months hand the banner to
their successor after the outgoing third-decan label, and Heriu uses its sole
day block. That follow-up is now deployed to the canonical RC origin after
native and CanvasKit verification. Its exact source, artifact, initial alias
mismatch, and successful served-payload verification are recorded in
[Phase 4 final-day handoff RC source and artifact authority](phase_4_final_day_handoff_rc_source_authority.md).
The preceding candidate remains recorded separately in
[Phase 4 RC source and artifact authority](phase_4_rc_source_authority.md).

## Authority rule

At every phase, each consumer has exactly one writer. Shadow code may observe
and compare, but it may not mutate authoritative state. A cutover commit must
install the new writer and remove the old writer together.

## Scope boundaries

The following are tracked separately and are not part of this branch:

- divider and covered-route compositor work;
- core converter unification;
- PWA artifact-weight reduction;
- changes to the intentional exclusion of Heriu from ordinary decan
  reflections.

Protected tests for those systems remain mandatory.

## Phase 0 records

- [Product contract](product_contract.md)
- [Source and artifact authority](source_authority.md)
- [Test migration manifest](test_migration_manifest.md)
- [Test baseline](test_baseline.md)
- [Fixed six-red exception](baseline_exception.md)
- [Performance baseline](performance_baseline.md)
- [Phase 1 brief](phase_1_brief.md)
- [Phase 2 brief](phase_2_brief.md)
- [Phase 3 brief](phase_3_brief.md)
- [Phase 4 brief](phase_4_brief.md)
- [Phase 4 RC source and artifact authority](phase_4_rc_source_authority.md)
- [Phase 4 final-day handoff RC source and artifact authority](phase_4_final_day_handoff_rc_source_authority.md)

## Phase 0 gate status

Source authority, product policy, test governance, and performance-comparison
requirements are frozen on the dedicated RC branch. The product owner granted
a fixed-identity exception for the six deterministic inherited failures in the
mobile baseline. The original error/stack fingerprint was explicitly waived on
2026-08-13 because its serializer and payload were not reproducible. The
checked-in sorted `path :: test name` verifier is now the gate; any change to
the count or identities remains a stop condition.
