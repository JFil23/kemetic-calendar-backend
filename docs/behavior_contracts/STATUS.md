# Behavior Contract Status

This index is the repository source of truth for user-visible behavior that has
been recovered or repaired. A contract is closed only after its exact source
checkpoint is deployed and verified in the installed production PWA.

| Contract | Mobile source | Parent gitlink checkpoint | Local | Production |
| --- | --- | --- | --- | --- |
| [STARTUP-WORDMARK-01](STARTUP-WORDMARK-01.md) | `a65e1972079ee7c07ddabd1a2d26b1a569b39fcd` | `763dd1d` | Passed | Pending |
| [CALENDAR-COLD-AUTHORITY-01](CALENDAR-COLD-AUTHORITY-01.md) | `aa567220357d81680bad0739def29984a9ac0744` | `763dd1d` | Passed | Pending |

## Status Rules

- `Passed` under Local requires an executable regression test and a local
  behavior check where the surface can be exercised.
- `Passed` under Production requires a deployment ID, artifact fingerprint,
  exact parent/mobile SHAs, and an installed-PWA smoke result.
- Screenshots and recordings are evidence, not substitutes for executable
  tests or deployment identity.
- Chat history, temporary worktrees, and dirty backup trees are never release
  authorities.
