-- Allow authenticated clients to call the community/profile feed RPC.
-- The function is created in 20260426170000_get_profile_feed_and_sync_insight_posts.sql.
revoke all on function public.get_profile_feed(integer, integer) from public;
grant execute on function public.get_profile_feed(integer, integer) to authenticated;
