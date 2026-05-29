-- Track OS push delivery attempts separately from user engagement state.
alter table public.maat_guidance_deliveries
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_error text,
  add column if not exists push_attempt_count integer not null default 0,
  add column if not exists push_last_attempt_at timestamptz;

alter table public.maat_guidance_deliveries
  drop constraint if exists maat_guidance_deliveries_status_check;

alter table public.maat_guidance_deliveries
  add constraint maat_guidance_deliveries_status_check
  check (
    status in (
      'pending',
      'shown',
      'dismissed',
      'opened',
      'acted',
      'expired',
      'archive_only'
    )
  );

create index if not exists idx_maat_guidance_push_retry
  on public.maat_guidance_deliveries (
    kind,
    push_sent_at,
    push_attempt_count,
    push_last_attempt_at
  )
  where kind = 'decan_opening' and push_sent_at is null;
