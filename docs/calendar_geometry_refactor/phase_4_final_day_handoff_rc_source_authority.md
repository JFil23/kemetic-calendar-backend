# Phase 4 Final-Day Handoff RC Source and Artifact Authority

Verification date: 2026-08-13

Verification lane: Cloudflare Pages project `kemet-rc`, branch `main`

Canonical RC origin: <https://kemet-rc.pages.dev>

Immutable RC origin: <https://a0c072f1.kemet-rc.pages.dev>

Internal rollback deployment: `85415160-154b-4ff5-b6a4-314abde6044e`

## Source identity

| Field | Value |
|---|---|
| Parent commit | `b4232c95398669698b71d43522e84937bc138ab1` |
| Parent tree | `eb2146d34e25a0e308159b114bebafaacf4f5c0f` |
| Parent mobile gitlink | `5ff66008f6bd083147637ed4962db91f6ecf3f66` |
| Mobile commit | `5ff66008f6bd083147637ed4962db91f6ecf3f66` |
| Mobile tree | `8caf0dabe36fcb78445508c4216ec3e6422bf1e4` |
| Refactor branch | `codex/calendar-geometry-refactor-rc` |

Both repositories were clean when the staging artifact was built. The release
pipeline compiled a fresh `git archive` extraction of the tracked mobile tree;
ignored and untracked workspace files were not build inputs.

## Test and native-device gate

The exact mobile commit passed the focused calendar geometry lane (53 tests)
and the protected calendar, hydration, ANR, and paint lane (76 tests). Focused
analysis was clean. Full analysis retained the same 21 inherited
`unnecessary_string_escapes` information findings.

The serial full suite completed 2,189 tests: 2,181 passed, two were skipped,
and the same six inherited tests failed. Their sorted `path :: test name`
identities matched the checked-in authority exactly. The reproducible identity
SHA-256 was
`e751c750a5765817307b4801473d24eaae0d7fdbcb72651c406aa51c1fdd19e6`.
No allowed-failure source or assertion changed.

The obsolete byte-level diagnostics fingerprint was not used. The product
owner explicitly waived it because the original serialization procedure was
not checked into the repository and could not be independently reproduced.

An iPhone 17 simulator run verified both directions at the Hathor → Ka-her-Ka
boundary. Hathor remained authoritative while its third-decan label was below
the activation line. Ka-her-Ka became authoritative only after that measured
edge crossed, while Hathor's final 21–30 row remained visible. Reverse motion
restored Hathor at the corresponding edge. The banner changed directly with
no cross-dissolve. No overflow, geometry exception, or focus exception was
observed during this check.

## Sealed artifact identity

| Field | Value |
|---|---|
| Build ID | `4c847bf2e6f4a41fae5977c637b8be10760b4cb7adecbfd16a4deed671039ab4` |
| Build version | `staging-5ff6600-4c847bf2e6f4` |
| Build timestamp | `2026-08-13T22:09:44Z` |
| Archive filename | `staging-5ff6600-4c847bf2e6f4-web.tar.gz` |
| Archive bytes | `114560668` |
| Archive SHA-256 | `fef7e7b33803b2e2810153c70c57c2c461aa4c7bbc2ae92a708cb07de9787881` |
| Payload files | `78` |
| Payload manifest SHA-256 | `7f27fc39b010a89eef81ef08ab0686c022ac498d30c3073c9c8aaca6704af2b4` |
| Release receipt SHA-256 | `28fd82f6bb13cbf7388a16f10e5a9a99eeca848a28b3e32f01e719c85d2c2d5d` |
| Configuration SHA-256 | `190545d2a3211031849a92260038652e8a33a2c3aa2378635e811b63e0b84432` |
| Lockfile SHA-256 | `5ddc5cfcfacf0d9bb7f0c9522efa05ce9363dc1f7f82dac63b168b785c4b1981` |
| Toolchain SHA-256 | `3c8454ae70782a36797929a2a93176491108d2a3f56211a157e9a0a06916eac7` |

## Cloudflare deployment evidence

| Field | Value |
|---|---|
| Project | `kemet-rc` |
| Environment | `Production` |
| Branch | `main` |
| Deployment ID | `a0c072f1-af48-4428-a74f-8ceb28efe92f` |
| Source reported by Cloudflare | `5ff6600` |
| Wrangler version | `4.114.0` |
| Upload-attempt receipt SHA-256 | `5461bc4aa0096a4da56d4417595b5bdb602ba5acb8fb16677ff7b821fab5d5c4` |
| Served-deployment receipt SHA-256 | `f82cb856a1f41d03eb4791b3fa6ed7bc50e0772ff8132c84bc45e10c2f2d65d4` |

The guarded helper uploaded the sealed artifact without rebuilding. Cloudflare
metadata identified it as the newest production deployment on the RC
project's `main` branch.

The first post-upload verification attempt stopped on a real mismatch: the
immutable deployment served the new `flutter_bootstrap.js` body SHA-256
`05d81d3032c9a0a11bb0ea7a89d19a91683063929d6efd73e3224daae2b13137`,
while the stable alias still served the previous RC body SHA-256
`a5dd50b28ebe800b527e3cff96eeb5f60ec2982826803c13bc0df59278e36758`.
The failure evidence was preserved. No rebuild, upload retry, redeploy,
rollback, cache purge, or payload mutation followed the mismatch.

A subsequent no-cache read showed the immutable origin and stable alias both
serving the new hash with the same ETag and `no-store, must-revalidate` policy.
The verifier was then rerun against the existing deployment. It passed for
both origins: all 71 directly served bodies, all six application-route
rewrites, the AASA body and media type, index redirect, Pages controls, and
runtime build identity matched the sealed payload. The four versioned July 1
clean-URL self-loop waivers remained unchanged.

Detailed ignored evidence is under
`mobile/dist/web-releases/web-deployment-receipts/attempt.KkicOp/`. The sealed
release is under
`mobile/dist/web-releases/staging-4c847bf2e6f4a41f/`.

## Phone-sized CanvasKit verification

The canonical RC origin was exercised at a 390×844 viewport. The deployed
bootstrap explicitly selects the `canvaskit` renderer.

Observed behavior:

- Hathor remained in the banner while its third-decan label remained below
  the activation line;
- after the measured edge and 8 px directional deadband crossed the line,
  Ka-her-Ka became authoritative while Hathor's final 21–30 row remained
  visible;
- reverse traversal restored Hathor once the third-decan edge re-entered the
  reverse threshold;
- the banner changed immediately, without a cross-dissolve;
- gold dividers, month titles, and day rows showed no visible overflow,
  doubling, tearing, or stale overlap; and
- the browser console contained no warning or error during the directed
  boundary check.

This is deployed CanvasKit evidence at an exact phone-sized viewport. It is
not represented as physical-phone Safari acceptance. That remains a human RC
checkpoint before production promotion.

## Promotion consequence

The canonical RC origin now serves the final-day handoff candidate. Production
remains untouched. A production release requires a separately built and
verified `production` artifact; this staging archive is not promotable across
lanes.
