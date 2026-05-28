# Codex Intentional Behavior

This file records guardrails for future Codex work on the ḥꜣw Admin / Operator Console.

## Mission

Build a secure solo-operator hub for running the ḥꜣw app and business. The correct sequence is secure shell, useful War Room, agent runtime, useful draft agents, full operating loop, then controlled product editing.

## Hard Rules

- Do not embed admin in `mobile/`.
- Do not put a service role key in `admin/` client code.
- Do not weaken RLS on existing app tables for admin convenience.
- Do not add `profiles.is_admin`.
- Do not expose raw journal content, private notes, or personal reflections by default.
- Do not create autonomous posting, trading, ad-buying, commerce, or product-generation agents.
- Do not build Node CMS until the source-of-truth decision is resolved.
- Do not build Ma'at editing before read-only War Room and agent workflows are stable.

## Phase 1 Definition

Phase 1 only provides:

- standalone `admin/` web shell,
- Supabase auth client using anon key,
- `admin_auth` staff gate,
- `staff_members`,
- `admin_audit_log`,
- placeholder navigation.

It does not provide:

- War Room metrics,
- agent runs,
- Archive/Armory/Approval/Treasury tables,
- node editing,
- Ma'at editing,
- mobile behavior changes.

## When Unsure

Prefer read-only views, drafts, audit logs, and approval queues over production writes.
