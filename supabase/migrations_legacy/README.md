# Pre-Squash Migrations

The SQL files in `pre_squash_20260523/` are preserved for audit/history only.
They were replaced in the active migration chain by the squashed baseline at:

- `supabase/migrations/20251208030627_remote_schema.sql`

Reason: the original active baseline was empty, while later migrations assumed
core app tables already existed. A fresh `supabase db reset` therefore failed
before newer output-control migrations could run. The active chain now starts
from the squashed app-schema baseline and keeps only post-baseline admin, cron,
and output truth-loop migrations.
