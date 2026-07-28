# Superseded post-July 1 test authority

These files preserve the required-test authority that applied to the later
runtime on parent `7c270354a9c03310339820c1f5dfb7b101f26bec`:

- `locked-contracts.post-july1.242.json`
  - SHA-256:
    `6528fea450eea5d43acb2f166c11ac182aa050c1e700520245bf93567e831a2d`
  - 34 VM units representing 242 tests.
  - 3 fresh-process units.
- `quarantine-registry.post-july1.7.json`
  - SHA-256:
    `30237a32f8c77a46e8520b5eba1ad527ac3afaf1d7f827c6919eb9bc49e27121`
  - 7 later-runtime quarantines and 2 owned skips.

They are immutable, **superseded evidence**. They are not executable authority
for the selected July 1 recovery runtime. Ten of their nineteen unique mobile
test files and their process harness do not exist in that runtime. Treating
those absent tests as passing, locked, skipped, or quarantined would be false.

The active required authority is
`../runtime-authority/july1-recovery.v1.json`. It binds every test in the
selected runtime to one exact outcome and keeps the five historical failures
visibly classified as accepted baseline debt.
