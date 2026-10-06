# Commons public activity and daily answers

The canonical Commons home returns rhythm.scope = following. It counts only
visible public records by accounts followed by auth.uid(), retaining profile
discoverability and excluding either block direction. People are distinct authors
of observed/partial public shared-practice entries for the requested date; steps
count those entries. Fragments count published insight posts created that day
using the existing UTC day convention. Open practices count active public groups
hosted by followed accounts, with at least two accepted members and the existing
viewer request-eligibility check. No personal completion or journal data is read.

The existing get_commons_home and get_commons_together_home_cards delegates retain
get_commons_home_cards as the base. The Together wrapper retains its existing
public-group discovery and does not overwrite the followed practice count.
Discovery sections remain community-wide independently of statistic scope.

get_commons_question_answers reads all public visible answers to the exact daily
question across follows, excluding both block directions. It uses a bounded
created_at/ID keyset and one look-ahead row, with a supporting partial index.
The canonical home reuses that reader for its initial page and adds
answers_has_more. The app preserves the raw cursor timestamp on web. Existing
answer_commons_question and delete_commons_answer remain the account-owned
publication boundaries; private journals are never projected into public answers.

The private rhythm helper is invoker-only and has no public/authenticated execution
grant. Its existing authenticated, auth.uid()-checked Commons caller retains
definer access needed to aggregate explicitly public entries outside membership
RLS. The new answer reader is authenticated-only and performs its public,
moderation and block checks before serialization. No table grant or RLS policy
is widened.

Verification: commons_following_public_answers_smoke.sql rolls back synthetic
fixtures after checking all four totals, empty follows, people versus steps,
private/calendar-only/hidden/skipped exclusions, bidirectional blocks, more than
24 answers with equal timestamps, public publication/edit/delete by an unfollowed
author, distinct question identity and anonymous denial. The local Supabase
security advisor reported no notice for either new function. Backend source
contracts passed (73 tests). This contract does not claim a remote deployment.
