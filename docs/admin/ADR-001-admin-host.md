# ADR-001: Admin Host

Status: Accepted

Date: 2026-05-18

## Decision

Build the private admin console as a new Vite + React + TypeScript app under `admin/`.

## Context

The consumer app is a Flutter app under `mobile/`, and privileged logic already belongs naturally in Supabase Edge Functions. The admin console needs dense tables, protected navigation, form workflows, approvals, and markdown-style operational surfaces. It does not need a Next.js server layer for Phase 1 because secrets and privileged logic must not live in the browser or frontend framework runtime.

## Consequences

- The admin browser bundle uses only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the current staff user's JWT.
- All privileged access goes through `admin_*` Edge Functions.
- No service role key is permitted under `admin/src`.
- Deployment can be static hosting plus Supabase Functions.
- If a future phase requires a server-rendered host, that change needs a new ADR.

## Rejected Alternative

Next.js was not chosen for Phase 1 because it would add a second server boundary without solving the security requirement. Admin privileges still belong in Supabase Edge Functions.
