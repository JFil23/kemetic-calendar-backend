# ḥꜣw Admin Console

Private operator web app for the ḥꜣw / Kemetic Calendar project.

This app is a static Vite + React shell. It uses the Supabase anon key in the browser and calls `admin_*` Edge Functions with the signed-in user's JWT. Never put a service role key in `admin/src`.

## Prerequisites

- Node.js and npm
- Supabase CLI
- Access to the same Supabase project used by the consumer app
- A Supabase Auth user for the founder/operator account

## Local Setup

```bash
cd admin
cp .env.example .env
npm ci
```

Set `admin/.env`:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Run the app:

```bash
cd admin
npm run dev
```

Open `http://127.0.0.1:5174/`.

## Apply Phase 1 Migration

From the repo root:

```bash
supabase db push
```

Or apply the migration directly:

```text
supabase/migrations/20260518090000_admin_console_phase1.sql
```

This creates:

- `public.staff_members`
- `public.admin_audit_log`
- `public.is_staff(uid)`
- `public.staff_has_scope(uid, scope)`

## Deploy `admin_auth`

Deploy with JWT verification disabled at the Supabase gateway so the function can handle CORS, return consistent 401/403 responses, and write denied-access audit rows itself:

```bash
supabase functions deploy admin_auth --no-verify-jwt
```

The function still verifies the user JWT internally and checks active staff membership server-side.

Phase 2 adds the read-only War Room function. Deploy it with the same gateway pattern:

```bash
supabase functions deploy admin_war_room --no-verify-jwt
```

`admin_war_room` verifies the JWT internally, checks active staff membership plus `war_room.read`, calls `admin_war_room_summary`, and writes `admin_audit_log` entries for allowed and denied access.

Phase 3 adds the echo-only ops runtime functions:

```bash
supabase functions deploy admin_archive --no-verify-jwt
supabase functions deploy admin_armory --no-verify-jwt
supabase functions deploy admin_approvals --no-verify-jwt
supabase functions deploy admin_treasury --no-verify-jwt
supabase functions deploy admin_agent_run --no-verify-jwt
```

These functions verify the JWT internally, check active staff membership plus the required scope, and use the service role only inside the Edge Function process.

Phase 4 enables real Research and Copy agent handlers through `admin_agent_run`.
Set the model API key only in the Supabase function environment:

```bash
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

Optional model override:

```bash
supabase secrets set OPENAI_ADMIN_MODEL=gpt-4o-mini
```

Phase 5 enables Social, Suggest Updates, Product QA, and Chief Operator through the same function. The browser app never receives model keys. Default CI uses injected mock LLM responses and does not make live model calls.

Phase 6 adds Ma'at ops and ADR-002 interim Node CMS functions:

```bash
supabase functions deploy admin_maat_ops --no-verify-jwt
supabase functions deploy admin_maat_dry_run --no-verify-jwt
supabase functions deploy admin_nodes --no-verify-jwt
```

`admin_maat_dry_run` is no-write. `admin_nodes` creates drafts, versions, and approval records only; it does not mutate `KemeticNodeLibrary.dart` or publish app-visible node content.

Phase 7 adds Content Lab previews for real user-specific decan reflections, decan openings, Ma'at/Isfet nudges, and push packaging:

```bash
supabase functions deploy admin_content_preview --no-verify-jwt
```

`admin_content_preview` verifies the operator JWT internally, requires `product.content.read`, `product.content.test`, or `product.content.write` depending on action, writes `admin_audit_log`, and stores operator reviews in `admin_content_evaluations`. Preview generation never sends a push or overwrites live user content.

Required function environment:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

If your project uses `SERVICE_ROLE_KEY` instead, the function accepts that name too.

## Bootstrap Founder Staff Row

Find your auth user id:

```sql
select id, email
from auth.users
where email = '<founder-email>';
```

Insert or refresh the owner row:

```sql
insert into public.staff_members (user_id, role, scopes)
values ('<founder-auth-user-id>', 'owner', '{}')
on conflict (user_id) do update
set role = 'owner',
    scopes = excluded.scopes,
    is_active = true,
    updated_at = timezone('utc', now());
```

Owners are treated as full-scope by `staff_has_scope` for known scopes.

## Verify Access

1. Start the admin app with `npm run dev`.
2. Sign in with the founder account.
3. The admin app calls `admin_auth`.
4. A valid owner should land on Product Overview and see the full placeholder navigation.

Optional API check with a current Supabase access token:

```bash
curl "$VITE_SUPABASE_URL/functions/v1/admin_auth/me" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

Expected success shape:

```json
{
  "user": { "id": "...", "email": "f******@example.com" },
  "staff": { "role": "owner", "scopes": [] }
}
```

Expected failures:

- missing token: `401 auth_required`
- signed-in non-staff: `403 staff_required`
- inactive staff: `403 staff_inactive`

Every success/failure handled by `admin_auth` writes `admin_audit_log`.

## Checks

```bash
cd admin
npm run lint
npm run build
```

From the repo root:

```bash
deno test --allow-env \
  supabase/functions/admin_auth/admin_auth_test.ts \
  supabase/functions/admin_war_room/admin_war_room_test.ts \
  supabase/functions/admin_archive/admin_archive_test.ts \
  supabase/functions/admin_armory/admin_armory_test.ts \
  supabase/functions/admin_approvals/admin_approvals_test.ts \
  supabase/functions/admin_treasury/admin_treasury_test.ts \
  supabase/functions/admin_agent_run/admin_agent_run_test.ts \
  supabase/functions/admin_maat_ops/admin_maat_ops_test.ts \
  supabase/functions/admin_maat_dry_run/admin_maat_dry_run_test.ts \
  supabase/functions/admin_content_preview/admin_content_preview_test.ts \
  supabase/functions/admin_nodes/admin_nodes_test.ts
```

The guard script fails if privileged key names appear under `admin/src`.

## Phase Boundary

Phase 7 adds controlled content-preview and operator-critique workflows. It intentionally does not include external posting APIs, auto-PRs, direct pushes to end users from admin, production content overwrites, direct `KemeticNodeLibrary.dart` mutation, mobile app changes, or live node publishing before ADR-002 moves from Option C to Option A/B.
