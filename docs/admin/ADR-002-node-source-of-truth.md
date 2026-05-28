# ADR-002: Node Source Of Truth

Status: Accepted for interim Phase 1-5 behavior

Date: 2026-05-18

## Decision

Use Option C for now: Dart remains the app-visible canonical node source, and the admin console may only create node drafts in a later phase. The admin console must not directly publish app-visible node edits until a future ADR chooses a DB-canonical or codegen pipeline.

## Current Split

- `mobile/lib/features/nodes/kemetic_node_library.dart` contains rich node bodies and link maps used by the Flutter app.
- `public.nodes` and `public.node_links` exist in Supabase.
- `supabase/seeds/20260422093000_kemetic_nodes_seed.sql` seeds a condensed DB graph with shorter body text.

This means a DB edit can fail to appear in the app, and a Dart edit can leave the DB graph stale.

## Future Options

- Option A: DB canonical, app fetches nodes from API/database.
- Option B: DB canonical, publish pipeline generates the Dart bundle and opens a Codex/PR task.
- Option C: Dart canonical for now, admin only creates drafts.

## Consequences

- Phase 1 does not build Node CMS.
- Phase 6 must resolve source-of-truth before publishing node edits.
- Agents must not edit `KemeticNodeLibrary.dart` directly.
- Future admin node work starts as drafts, version history, previews, approvals, and Codex tasks.
