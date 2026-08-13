# Phase 4 RC Source and Artifact Authority

Verification date: 2026-08-13

Verification lane: Cloudflare Pages project `kemet-rc`, branch `main`

Canonical RC origin: <https://kemet-rc.pages.dev>

Internal rollback receipt: `85415160-154b-4ff5-b6a4-314abde6044e`

## Source identity

| Field | Value |
|---|---|
| Parent commit | `16510258a5c07857ef1919782d506ac97c88b9cc` |
| Parent tree | `ce23e0fe37cb08537f8d051a19fe0a126acbbdda` |
| Parent mobile gitlink | `fd1d6ed493a1aa689b58510dcb859c62a0889222` |
| Mobile commit | `fd1d6ed493a1aa689b58510dcb859c62a0889222` |
| Mobile tree | `a12a3b446930a40e0356ba41f675e29f79125dc1` |
| Refactor branch | `codex/calendar-geometry-refactor-rc` |

Both repositories were clean when the staging artifact was built. The release
pipeline compiled a fresh `git archive` extraction of the tracked mobile tree;
ignored and untracked workspace files were not build inputs.

## Sealed artifact identity

| Field | Value |
|---|---|
| Build ID | `bfbd2ef5ddd01841a6e239bb444ff1a684ac023938346aa854955a12c075989f` |
| Build version | `staging-fd1d6ed-bfbd2ef5ddd0` |
| Build timestamp | `2026-08-13T21:14:56Z` |
| Archive filename | `staging-fd1d6ed-bfbd2ef5ddd0-web.tar.gz` |
| Archive bytes | `114559951` |
| Archive SHA-256 | `7af740adbf9fb332b856d10ba0e7d1915443eaf054b9112f2754375a3d14793c` |
| Payload files | `78` |
| Payload manifest SHA-256 | `dee2cfd1ea8e695bfe809dc7e57bdeacd0b9aa552f2508be9831c4021cfa4145` |
| Release receipt SHA-256 | `7e4218265374d2da7cca4b8ce152207bb79536bc64b52d8434a8525348b016d1` |
| Configuration SHA-256 | `190545d2a3211031849a92260038652e8a33a2c3aa2378635e811b63e0b84432` |
| Lockfile SHA-256 | `5ddc5cfcfacf0d9bb7f0c9522efa05ce9363dc1f7f82dac63b168b785c4b1981` |
| Toolchain SHA-256 | `3c8454ae70782a36797929a2a93176491108d2a3f56211a157e9a0a06916eac7` |

## Cloudflare deployment evidence

| Field | Value |
|---|---|
| Project | `kemet-rc` |
| Environment | `Production` |
| Branch | `main` |
| Deployment ID | `85415160-154b-4ff5-b6a4-314abde6044e` |
| Source reported by Cloudflare | `fd1d6ed` |
| Wrangler version | `4.114.0` |
| Upload-attempt receipt SHA-256 | `844e8f4addcae32aafa68baaccfc9b7b6b962bd9169e67935d198ff86eb747a8` |
| Served-deployment receipt SHA-256 | `2af49cfa3096e2e9300ba8648c934482082530ec2c4f498b2dbcf0eb8a4a5f37` |

The guarded deploy helper uploaded the already-sealed artifact without
rebuilding. Cloudflare metadata identified it as the newest production
deployment on `main`. The post-upload verifier checked both the deployment
receipt and the canonical RC origin against the local payload. Each origin
matched all 71 directly served bodies, all six application-route rewrites,
the AASA body and media type, the index redirect, the Pages controls, and the
runtime build identity. The four versioned July 1 clean-URL self-loop waivers
were unchanged. No automatic retry, rebuild, redeploy, promotion, or rollback
action was taken.

Detailed local evidence is under the ignored release path
`mobile/dist/web-releases/web-deployment-receipts/attempt.26Cahh/`. The sealed
release is under
`mobile/dist/web-releases/staging-bfbd2ef5ddd01841/`.

## Phone-sized CanvasKit verification

The canonical RC origin was exercised in the deployed web renderer at a
390×844 viewport. The traversal covered a slow, bidirectional
Mesut-Ra → Heriu Renpet → Thoth boundary walk and one coarse single-input
forward traversal.

Observed behavior:

- Mesut-Ra remained in the banner while Heriu was visible but below the
  activation line;
- Heriu Renpet became authoritative when its section reached the banner;
- Heriu remained authoritative while the Thoth-owned gold divider and Akhet
  season header remained below the activation line;
- Thoth became authoritative after that leading interstitial crossed the
  line, and reverse traversal returned cleanly to Heriu;
- the coarse traversal settled on the correct top-edge owner;
- Heriu and regular month titles remained bounded with no overflow;
- gold dividers and month-title paint showed no visible doubling, tearing,
  discontinuity, or stale overlap; and
- the browser reported no console warning or error during the traversal.

This is deployed CanvasKit evidence at an exact phone-sized viewport. It is
not represented as a physical-phone Safari acceptance run. That remains a
human RC checkpoint before production promotion.

## Promotion consequence

The canonical RC origin now serves this Phase 4 candidate. Production remains
untouched. A production release requires a separately built and verified
`production` artifact; the staging archive is not promotable across lanes.
