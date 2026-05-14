-- Allow PWA Web Push subscriptions to persist in push_tokens.
-- Older environments restricted platform to native values only.

alter table public.push_tokens
drop constraint if exists push_tokens_platform_check;

alter table public.push_tokens
add constraint push_tokens_platform_check
check (platform = any (array['android'::text, 'ios'::text, 'web_push'::text, 'unknown'::text]));
