# ADR-003: Staff Auth

Status: Accepted

Date: 2026-05-18

## Decision

Use a dedicated `staff_members` table plus server-side scope checks. Do not add admin flags to user-facing `profiles`.

## Model

`staff_members` stores:

- `user_id`
- `role`
- `scopes`
- `is_active`
- invite and timestamp metadata

Initial roles:

- `owner`
- `operator`
- `support`
- `readonly`

Initial scopes match the Phase 1 roadmap and are checked inside `admin_*` Edge Functions.

## Enforcement

Each admin Edge Function must:

1. Parse the `Authorization` header.
2. Verify the user JWT server-side.
3. Look up active staff membership using the service role client.
4. Check the required scope, except `admin_auth /me`, which only proves active staff membership.
5. Write an `admin_audit_log` entry.
6. Return sanitized data.

## Consequences

- The browser never receives a service role key.
- Existing app RLS remains strict.
- Owner can be treated as full-scope server-side, even if the `scopes` array is empty.
- The first owner must be bootstrapped deliberately after migration.

## Bootstrap Note

After deployment, insert the founder's auth user id as the first owner:

```sql
insert into public.staff_members (user_id, role, scopes)
values ('<founder-auth-user-id>', 'owner', '{}')
on conflict (user_id) do update
set role = 'owner', is_active = true, updated_at = timezone('utc', now());
```
