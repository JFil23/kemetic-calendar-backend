# Onboarding Flow - Codex Plan

## 1. Overview

- **Goal:** First-time users see a concise, one-time onboarding that highlights the calendar toggle, Flow Studio + AI generator, notes/reminders, and journal with reflection/save.
- **Scope:** Flutter app in `mobile/`; onboarding overlay shown after main calendar loads. Primary persistence is per-user via backend; local cache optional. No video, multi-language, A/B tests, or analytics in this version.
- **Out of scope:** Backend feature changes beyond storing the completion flag; no journal/reminder logic changes beyond copy references.

## 2. Behavior (once per user)

- **Who/When:** Every authenticated user the first time they use the app after this release.
- **Frequency:** Exactly once per account; after completion or skip it never shows again on any device until a deliberate new onboarding version ships.
- **Persistence strategy:** Store completion in backend keyed by user id (per-account). Optionally mirror locally to avoid flashing overlay while awaiting backend read.

### Backend options

| Option | Shape | Notes |
|--------|-------|-------|
| **A - profiles column** | Add `onboarding_completed_at timestamptz` (or `boolean`) to `profiles`. | Simple; one flag per user. |
| **B - onboarding table** | Table `user_onboarding (user_id uuid pk, onboarding_version text, completed_at timestamptz)` | Supports versioned/on-next-release onboarding (e.g., `onboarding_v2`). |

Flow: after auth, fetch completion for `currentUser.id`. If incomplete -> show overlay. On Done/Skip -> set backend flag -> never show again for that account. Local cache: `SharedPreferences` key (e.g., `onboarding_v1_completed`) to avoid overlay flash before backend fetch resolves.

## 3. User flow

1. User signs in -> `AuthGate` shows `CalendarPage`.
2. If onboarding not completed for this account -> show onboarding overlay.
3. Overlay runs through N steps (see Step list), each highlighting one UI target with short copy and Next/Done/Skip.
4. On Done or Skip -> mark completion (backend + local cache) -> overlay never shows again.

## 4. Step list (order and copy)

| # | Target | Suggested copy |
|---|--------|----------------|
| 1 | App bar title "ḥꜣw" | Tap the title to switch between Kemetic and Gregorian dates. |
| 2 | Flow Studio icon (action strip) | Open Flow Studio to plan recurring flows. Use "Generate with AI" inside to create flows from a description. |
| 3 | New note (+) icon | Add a single event or note for any day. Reminders are managed here too. |
| 4 | Journal icon | Open your daily journal. You can also swipe in from the right edge. |
| 5 | (In-context/follow-up) | In Journal, use the Reflection tab to generate a reflection from today's badges, then "Save to journal." |
| 6 | (Reminders) | Reminders live in the New note sheet-open the + button, then the Reminders section. |

Steps 5-6 can be combined into a "Journal & reminders" step to keep the flow to 4-5 steps total.

## 5. Technical plan

### 5.1 Persistence

- **Backend:** Mark onboarding completion per user (`profiles` column or `user_onboarding` table). Fetch after auth; block overlay if completed.
- **Local cache (optional):** `SharedPreferences` key `onboarding_v1_completed` to avoid showing overlay while waiting for backend. Set after backend write succeeds.
- **Set flag:** On Done or Skip. If backend write fails, retry or keep local flag false to avoid desync.

### 5.2 Onboarding overlay widget

- **New file:** `mobile/lib/features/onboarding/onboarding_overlay.dart`.
- **Behavior:** Full-screen dimmed barrier; per-step spotlight/highlight on target widget plus card/tooltip with title/body and Next/Done/Skip controls.
- **Inputs:** List of `OnboardingStep` with target refs (`GlobalKey` or `Rect`), `String title`, `String body`.
- **Implementation:** Use `OverlayEntry` or `Stack` with `Positioned` + `CustomPaint` for spotlight. Guard for missing layout/keys (skip step or wait for layout).

### 5.3 Integration point

- **Where:** `CalendarPage` (`mobile/lib/features/calendar/calendar_page.dart`).
- **When:** After first frame when calendar is laid out (`addPostFrameCallback`).
- **What:** Assign `GlobalKey`/`LayerLink` to:
  - App bar title "ḥꜣw".
  - Flow Studio action button (tooltip "Flow Studio").
  - New note action button (tooltip "New note").
  - Journal action button (tooltip "Journal").
- Build steps with these targets; include journal/reminders copy step (can be text-only).
- Show overlay only if backend flag is false; optionally also check local cache.

### 5.4 Skipping and completion

- "Skip" -> set completion (backend + local cache) -> close overlay.
- "Next" -> advance step; no persistence until Done/Skip.
- "Done" on last step -> set completion flags -> close overlay.

## 6. File change summary (expected)

| Action | File / location |
|--------|-----------------|
| **Create** | `mobile/lib/features/onboarding/onboarding_overlay.dart` - overlay UI, step state, spotlight, buttons. |
| **Create** | `mobile/lib/features/onboarding/onboarding_storage.dart` (optional) - shared preferences helper and backend call for onboarding flag. |
| **Modify** | `mobile/lib/features/calendar/calendar_page.dart` - add keys for title + action buttons; post-frame check for onboarding completion; trigger overlay with steps. |
| **Modify** | Backend schema (if Option A/B) - add completion flag column/table and Supabase client call to read/write per user. |

## 7. Acceptance criteria

- First launch after release: overlay appears after calendar is visible if backend flag is false.
- Each step highlights the correct control and shows the specified copy.
- Next/Done/Skip behave correctly; Done/Skip persist completion (backend + local cache) and dismiss.
- After completion, overlay never shows again for that user on any device (until a new onboarding version is intentionally shipped).
- No crashes when keys are not yet laid out; overlay waits or skips gracefully.

## 8. Optional follow-ups

- Analytics events: `onboarding_started`, `onboarding_step_N_viewed`, `onboarding_completed`, `onboarding_skipped`.
- Versioning: use `onboarding_v1_completed`; future versions add `onboarding_v2_completed` row/column and "What's new" onboarding.
- Journal deepening: auto-open Journal on its step and show a coach mark on Reflection -> "Save to journal" using a secondary overlay inside Journal.
