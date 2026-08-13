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
2. Prove a lazy, sliver-aware, atomic geometry publication mechanism.
3. Route months 1–13 through one structural section path.
4. Publish full geometry snapshots and run the new coordinator in passive
   shadow mode.
5. Cut the banner over to the ratified leading-edge contract.
6. Migrate restoration to logical anchors and reject legacy pixel geometry.
7. Cut hydration over to snapshot-derived visible ranges.
8. Cut pinch targeting over to section geometry.
9. Cut rotation, landscape handoff, and distant navigation over to logical
   anchors.
10. Delete the old GlobalKey geometry database and competing selectors.
11. Verify and deploy an RC artifact. Production remains untouched.

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
- [Performance baseline](performance_baseline.md)

## Phase 0 gate status

Source authority, product policy, test governance, and performance-comparison
requirements are frozen on the dedicated RC branch. The inherited mobile test
baseline is deterministically red in six tests unrelated to the calendar
banner contract. Under the stop-and-report rule, Phase 1 implementation must
not begin until those reds are dispositioned explicitly; Phase 0 did not edit
application code or test assertions to manufacture a green baseline.
