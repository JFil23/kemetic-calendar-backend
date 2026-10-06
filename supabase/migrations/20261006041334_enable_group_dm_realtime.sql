-- The inbox watches these existing, member-protected tables. Without this
-- publication membership, successful sends never reach mounted conversations.
-- Preserve the existing RLS policies and any tables already in the publication.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'dm_conversations', 'dm_conversation_members', 'dm_messages'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = relation_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        relation_name
      );
    end if;
  end loop;
end;
$$;
