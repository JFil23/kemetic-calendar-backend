# Phase 0 Source and Artifact Authority

This file is the immutable historical Phase 0 authority. The canonical RC
origin has since been replaced by the verified Phase 4 candidate recorded in
[Phase 4 RC source and artifact authority](phase_4_rc_source_authority.md).

Verification date: 2026-08-13

Verification lane: Cloudflare Pages project `kemet-rc`, branch `main`

Stable alias: <https://kemet-rc.pages.dev>

Immutable deployment: <https://8319b6b7.kemet-rc.pages.dev>

## Source identity

| Field | Value |
|---|---|
| Parent commit | `b8be991ad9be2297223ab4e56c580838cf2c8067` |
| Parent tree | `cf44d84cb034b75f011d629afd22797bbfeb860e` |
| Parent mobile gitlink | `3fc62eb518d487fe087b80edceab56f91c70c2dd` |
| Mobile commit | `3fc62eb518d487fe087b80edceab56f91c70c2dd` |
| Mobile tree | `736a02eb802a7af57486d0f85ad6a3aa6a86053d` |
| Original RC branch | `codex/calendar-scroll-month-header-rc` |
| Refactor branch | `codex/calendar-geometry-refactor-rc` |

Both repositories were clean before the refactor branches were created.

## Sealed artifact identity

| Field | Value |
|---|---|
| Build ID | `f8157a5a24f849d8ec5c38ef7bd9a57c6f9ad405b4ee8eff97082b3f723e419e` |
| Build version | `staging-3fc62eb-f8157a5a24f8` |
| Build timestamp | `2026-08-13T13:48:53Z` |
| Archive filename | `staging-3fc62eb-f8157a5a24f8-web.tar.gz` |
| Archive bytes | `114555709` |
| Archive SHA-256 | `01cb668b1e4a9add474588777dda186b757e386357c77b8c0bf9e23109d47c79` |
| Payload files | `78` |
| Payload manifest SHA-256 | `62afa1fbfd0de1853d5c403629a80303ea5e2c74ab07baf299ce0ad918066739` |
| Release receipt SHA-256 | `cc3437a3e85d103b51dedef95feeeaa48c71fc054c280b1f9fda43608bcc41b7` |
| Cloudflare deployment ID | `8319b6b7-c391-4db1-ab1d-a0da7b9e64a3` |
| Wrangler version | `4.114.0` |

## Live verification

The repository's fail-closed `served_artifact_verifier.py` was rerun against
both the immutable deployment and stable alias. It verified payload, identity,
app routing, and AASA bodies against the sealed manifest. The four pre-existing
July 1 clean-URL legal self-loop failures remained explicitly waived by the
versioned served contract; no new waiver or mismatch was introduced.

The regenerated live receipt was written outside the repository at
`/tmp/calendar-geometry-phase0-served-deployment.json` and had SHA-256
`4d616757166d538b5d89190f9934861461fc7e496ec88e2c280d08918fb8bdd4`.
That path is ephemeral; the sealed release and deployment receipts under
`mobile/dist/web-releases` remain the local detailed evidence.

## Toolchain identity

| Tool | Version / identity |
|---|---|
| Flutter | `3.35.3` stable |
| Flutter framework revision | `a402d9a4376add5bc2d6b1e33e53edaae58c07f8` |
| Dart | `3.9.2` |
| Engine revision | `ddf47dd3ff96dbde6d9c614db0d7f019d7c7a2b7` |
| Build platform | `macOS-15.7.4-x86_64-i386-64bit-Mach-O` |

## Authority consequence

All behavioral evidence and Phase 0 baselines apply only to this exact source,
artifact, and deployment. A future RC must receive its own source and artifact
receipt; evidence does not transfer merely because a stable alias is reused.
