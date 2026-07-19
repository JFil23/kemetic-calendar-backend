# STARTUP-WORDMARK-01

## Contract

The PWA presents one continuous, glyph-safe `ḥꜣw` launch identity from the
pre-Flutter HTML frame through Flutter boot. It must not show a missing-glyph
box, a flat replacement wordmark, or a blank frame between launch owners.

## Authority

- Pre-Flutter surface: `mobile/web/index.html`
- Flutter boot surface: `mobile/lib/root_boot.dart`
- Auth/bootstrap overlay reuse: `mobile/lib/main.dart`
- Canonical mobile fix: `a65e1972079ee7c07ddabd1a2d26b1a569b39fcd`
- Parent gitlink checkpoint: `763dd1d`

The exact historical underlined artwork was not recovered and is not claimed
by this contract. The recovered behavior is the bundled Gentium glyph and
animated gold shimmer.

## Executable Evidence

- `mobile/test/widgets/root_boot_app_test.dart`
- `mobile/test/services/pwa_boot_splash_guard_test.dart`
- `mobile/test/services/root_app_shell_startup_guard_test.dart`

The widget test verifies that Flutter boot owns the animated `GlossyText`.
The web guard verifies the bundled Gentium preload, glyph owner, and matching
2600 ms shimmer. The startup architecture guard verifies that Flutter installs
its shell before nonessential bootstrap work.

## Local Evidence

On 2026-07-13, a local PWA hard reload at the candidate source rendered the
HTML wordmark with the bundled font and transitioned to the Flutter destination
without an observed square glyph or blank frame. The test browser was not
authenticated, so this check did not exercise the production calendar route.

## Must Preserve

- HTML and Flutter use the same launch word, backdrop, and shimmer treatment.
- The HTML surface defines and preloads the glyph-capable font itself.
- Root boot remains the Flutter launch authority.
- Auth/bootstrap code reuses the shared Flutter launch surface.
- No replacement underlined artwork is invented without an approved reference.

## Production Acceptance

Pending. Record the Cloudflare deployment ID, artifact hash, exact parent and
mobile SHAs, and installed-PWA result before changing this contract to passed.
