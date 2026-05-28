-- Tighten receipt idempotency and expose receipt status through an
-- authenticated support/debug lookup path.

with ranked as (
  select
    id,
    row_number() over (
      partition by
        coalesce(user_id::text, ''),
        delivery_key,
        receipt_event,
        coalesce(device_id, '')
      order by event_at asc, created_at asc, id asc
    ) as rn
  from public.maat_delivery_receipt_events
)
delete from public.maat_delivery_receipt_events r
using ranked
where r.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists idx_maat_delivery_receipt_events_device_once
  on public.maat_delivery_receipt_events (
    coalesce(user_id::text, ''),
    delivery_key,
    receipt_event,
    coalesce(device_id, '')
  );

comment on index public.idx_maat_delivery_receipt_events_device_once is
'Prevents repeated mobile/web lifecycle double-fires from creating duplicate receipt states for the same user, delivery key, receipt event, and device.';
