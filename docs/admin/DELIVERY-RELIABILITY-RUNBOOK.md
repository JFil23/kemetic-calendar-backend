# Ma'at Delivery Reliability Runbook

This runbook proves that scheduled guidance is generated, claimed, delivered,
received, and reviewed once.

## Current deployment state

- Active local migration chain includes:
  - `20260523113000_schedule_delivery_crons.sql`
  - `20260523114500_delivery_timing_proof.sql`
  - `20260523120000_delivery_receipt_proof.sql`
  - `20260523135000_delivery_push_release_gate.sql`
- The linked Supabase project has the delivery timing and receipt migrations
  applied directly while migration-history alignment remains a tracked
  deployment concern.
- Deployed edge functions required for receipt proof:
  - `send_push`
  - `ack_maat_guidance`
  - `record_delivery_receipt`
  - `get_delivery_receipt_status`

## Fresh rebuild proof

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/dev/maat_delivery_timing_smoke.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/dev/maat_delivery_receipt_smoke.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/dev/maat_delivery_push_release_gate_smoke.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -c "do \$\$ declare blocker_count integer; begin select count(*)::integer into blocker_count from public.maat_delivery_push_release_blockers; if blocker_count <> 0 then raise exception 'maat_delivery_push_release_blockers must be 0, got %', blocker_count; end if; end \$\$;"
deno test --allow-env supabase/functions/
```

Expected result:

- migration chain rebuilds from empty
- timing smoke shows cron/timing health rows
- receipt smoke shows one opened receipt and one missing-receipt alert
- push release smoke proves the gate catches legacy/fallback violations
- `maat_delivery_push_release_blockers` returns zero rows
- full function suite passes

## Linked database smoke

```bash
supabase db query --linked \
  --file supabase/migrations/20260523120000_delivery_receipt_proof.sql
supabase db query --linked \
  --file supabase/dev/maat_delivery_timing_smoke.sql
supabase db query --linked \
  --file supabase/dev/maat_delivery_receipt_smoke.sql
supabase db query --linked \
  --file supabase/dev/maat_delivery_push_release_gate_smoke.sql
supabase db query --linked \
  "select count(*)::int as blocker_count from public.maat_delivery_push_release_blockers;"
```

The smoke files run inside transactions and roll back their rows.
The linked `blocker_count` must be `0`.

## Function deploy

```bash
supabase functions deploy \
  record_delivery_receipt \
  get_delivery_receipt_status \
  ack_maat_guidance \
  send_push
```

If local Docker bundling fails because an external ESM import host such as
`esm.sh` returns a transient 5xx while creating the function graph, retry the
same deploy with server-side bundling:

```bash
supabase functions deploy evaluate_maat_guidance --use-api
```

Treat this as deploy infrastructure noise only after tests and SQL smokes pass.
Do not use `--use-api` to bypass type, lint, or smoke failures.

After deploy, verify the receipt endpoint is reachable and protected:

```bash
curl -i -X OPTIONS \
  https://vrbubwqapwkxxexkwkgu.supabase.co/functions/v1/record_delivery_receipt
curl -i -X POST \
  https://vrbubwqapwkxxexkwkgu.supabase.co/functions/v1/record_delivery_receipt \
  -H 'content-type: application/json' \
  -d '{"delivery_key":"smoke:unauth","receipt_event":"opened"}'
```

Expected result:

- `OPTIONS` returns `204`
- unauthenticated `POST` returns `401`

## Health queries

```sql
select *
from public.maat_delivery_cron_health
order by job_name;

select *
from public.maat_delivery_timing_health
order by cron_job_name, delivery_kind;

select *
from public.maat_delivery_receipt_health
order by sent_at desc
limit 50;

select *
from public.maat_delivery_alerts
order by severity desc, created_at desc;

select *
from public.maat_delivery_push_release_blockers
order by created_at desc;
```

Treat any `critical` alert as blocking. Treat `receipt_missing` and
`surface_missing` as last-mile proof failures until the device/app path is
confirmed.
Treat any row in `maat_delivery_push_release_blockers` as a release blocker:
compiler-owned outputs may not use legacy push text, fallback/not-quality-proof
packages may not push, and compiled packages missing `push_text` may not derive
push copy from legacy fields.

## Post-Deploy Release Gate

Run this after any deploy touching `output_compiler`, `send_push`,
`evaluate_maat_guidance`, `cron_evaluate_maat_guidance`,
`cron_maat_decan_opening`, `cron_decan_reflection_push`,
`cron_reminder_push`, `ai_generate_reflection`, or admin preview generation.

```bash
supabase db query --linked \
  --file supabase/dev/maat_delivery_timing_smoke.sql
supabase db query --linked \
  --file supabase/dev/maat_delivery_receipt_smoke.sql
supabase db query --linked \
  --file supabase/dev/maat_delivery_push_release_gate_smoke.sql
supabase db query --linked \
  "select count(*)::int as blocker_count from public.maat_delivery_push_release_blockers;"
```

Acceptance rule:

```text
blocker_count = 0
```

If `blocker_count` is not zero, stop the release and inspect:

```sql
select *
from public.maat_delivery_push_release_blockers
order by created_at desc;
```

## Real-device receipt proof

Run this with a signed-in test account and a registered device/PWA.

1. Send a push self-test from Settings.
2. Background the app and wait for the notification.
3. Tap the notification.
4. Query `maat_delivery_receipt_health` for `delivery_kind = 'push_test'`.
5. Confirm the row reaches `receipt_status = 'opened'`.
6. In Settings, confirm the Push test receipt panel shows the same delivery key
   and opened status.

Then prove product surfaces:

1. Trigger one due reminder and confirm `reminder` reaches `opened` or
   `received`.
2. Trigger one decan reflection push and confirm `decan_reflection` reaches
   `opened`.
3. Show/open/dismiss/act on one Ma'at guidance delivery and confirm
   `maat_guidance:*` receipt rows record `shown`, `opened`, `dismissed`, or
   `acted`.

## Acceptance standard

- no duplicate sent keys
- no late sends above SLA
- no cron auth failures
- push self-test produces an opened receipt row
- in-app guidance acknowledgements produce receipt rows
- `maat_delivery_alerts` is empty or contains only understood test alerts
- `maat_delivery_push_release_blockers` returns zero rows
