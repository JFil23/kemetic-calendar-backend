# ADR-004: Agent Execute Semantics

Status: Accepted

Date: 2026-05-18

## Decision

All admin agents are draft-first. No Phase 1 code runs agents. Future agent output saves drafts, reports, suggestions, tasks, or approval requests; it does not publish, post, deploy, trade, email, mutate production content, or edit app-visible nodes without explicit approval.

## In-Scope Future Agents

- research
- social
- copy
- suggest_updates
- product_qa
- chief_operator

## Default Output Semantics

- Research: cited Archive brief.
- Social: manual-post draft only.
- Copy: variants in Archive.
- Suggest Updates: suggestion rows and evidence.
- Product QA: Codex-ready task draft.
- Chief Operator: weekly operating report.

## Approval Gates

Approval is required before:

- public-facing copy is applied,
- social content is considered cleared for manual posting,
- Codex task drafts become active work,
- high-cost jobs run,
- support/break-glass data is viewed,
- Ma'at policy/routing changes are made,
- node drafts are published.

## Consequences

- Phase 1 has no agent runtime.
- Phase 3 starts with a stub/echo pipeline only.
- Future tests must use mock LLM responses by default.
- Treasury caps and `admin_audit_log` are part of execution, not optional add-ons.
