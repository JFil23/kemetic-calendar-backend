# Posted flow appearance

An owner's acknowledged `flows.appearance` update projects only appearance into
`flow_posts.ai_metadata.payload.appearance` for the exact source flow and author.
The source row and every matching owned post commit or roll back together.
Published event content, captions, rules, dates, post identity, publication time,
engagement and unknown JSON fields remain snapshots. Direct shares and imported
flows remain independent. Removing an image projects JSON null; no storage
object deletion or broad read grant is added.

Private trigger functions run as the caller with existing RLS, an empty search
path, and no public execution grant. Accepted calendar editors retain their
existing ability to edit a shared-calendar flow; they do not gain permission to
rewrite another author's profile posts. The propagation guarantee is for the
owner's My Flows edit. Missing or differently owned source rows leave the post's
snapshot intact. A malformed linked metadata/payload shape aborts an appearance
save atomically instead of discarding data.

Post inserts normalize appearance from a same-author source while holding a
shared source-row lock. Post metadata updates normalize stale appearance too,
including old clients' whole-JSON caption writes. They already hold the post-row
lock and do not lock the source, avoiding inverse flow/post lock order. The
source projection changes only distinct appearance values. Other source updates
and matching appearances do not rewrite posts. The migration's idempotent
backfill repairs only same-author source/post appearance differences.

The SQL smoke runs under authenticated owner/viewer/editor roles and checks
exact event identity/content, all nonappearance post JSON, source rules, direct
shares/imports, engagement, removal, missing/deleted sources, stale caption
writes, private image access, actual feed reads and RLS. The concurrency smoke
forces lock overlap for source-save/caption-update and source-save/publication
in both orders, verifies the final committed image and caption, and replays the
backfill twice. Both are registered in the backend gate. The app continues to
own account-fenced cache reconciliation after the source mutation acknowledgement;
there is no new cache namespace or second app post write.
