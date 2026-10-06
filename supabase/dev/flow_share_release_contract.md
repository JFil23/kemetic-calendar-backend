# Flow sharing snapshot repair — October 6, 2026

The existing flow_shares table owns sent snapshots; its existing appearance
trigger and Storage RLS remain authoritative. No schema or policy change.
create_flow_share now validates the sender through Auth, reads all source event
pages in deterministic order, and fails without sending on any page failure.
Civil dates and clock times use the sender profile timezone, preserving initial
gaps, DST boundaries and overnight/multiday ends. Optional end_offset_days is
additive; older app versions ignore it.

flow_post_id is an alternate source. The handler reads the published snapshot
through the sender's RLS client, rejects unavailable/hidden/incomplete posts,
and sends that snapshot without reading another user's private flow. Existing
share rows, recipient routes, notifications and image access owners are retained.
The app must deploy the new Inbox post sender after this function is deployed.

Evidence: six handler/snapshot tests cover 1001-event pagination, failed pages,
authentication, ownership, published content and time preservation. The local
runtime test creates disposable accounts with a real calendar, runs the actual
handler against Auth/PostgREST, and verifies the exact persisted source behavior,
image trigger, local clock values, published payload, forwarding another
user's published snapshot and recipient RLS reads.
The Save round trip also verifies inactive/unsaved staging accepts event writes,
keeps incomplete copies out of saved lookup, and becomes saved only after
acknowledgement. Hidden is a deleted state, not a staging flag.
Push is captured, with no messages to real contacts. Existing database event
normalization adds shared-practice metadata, so comparison is to the persisted
source row. Cleanup removes fixture events before users to satisfy archive FKs.
Runtime receipt: /tmp/haw-flow-share-runtime-final.log. Function and source-contract
suite receipts: /tmp/haw-flow-backend-pinned-suite.log and /tmp/haw-flow-backend-final-contracts.log.

Release authorization: the user approved publication to backend main and app
rc, followed by deployment after their complete release gates pass. Local
verification is complete; remote gate and deployment receipts are recorded
with the release. Deploy this function before the RC app uses flow_post_id.
