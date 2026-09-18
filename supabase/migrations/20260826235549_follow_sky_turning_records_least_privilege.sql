-- Repair only the client-role privileges inherited when the table was created.
-- Row-level policies and Storage remain unchanged.
revoke all on table public.follow_sky_turning_records
  from anon, authenticated;

grant select, insert, update, delete
  on table public.follow_sky_turning_records
  to authenticated;
