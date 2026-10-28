# Website contact delivery

This backend-only Worker owns exactly `POST https://thisishaw.com/api/contact`.
The website source remains in the app-only production checkout's `public-site/`;
Pages assets, Flutter deployment, app routes, account repositories and warm caches
are outside this Worker's authority. No Supabase function or migration changes.

The recipient is fixed at `info@thisishaw.com`. Visitor email is used only as
Reply-To; messages are plain text with UTF-8 MIME encoding. The handler requires
the exact website Origin, bounded JSON fields and a known topic. It rejects
recipient overrides, header injection and a populated honeypot. A Cloudflare
rate-limit binding limits anonymous submissions to ten per minute per edge/IP.
This is an abuse limit, not a durable global quota or account identity.

No support message, email address or pending write is persisted in a browser
cache, database or Worker log. The mail provider owns delivered support content.
Success is returned only after the email binding acknowledges acceptance. This
acknowledgement does not prove inbox receipt; release verification also needs a
real test message observed in the configured recipient inbox. Failed sends retain
the visitor's form values. The browser prevents concurrent submission and does
not automatically retry ambiguous network failures.

## Configuration required before release

1. Create and verify the user's chosen receiving inbox or forwarding destination
   for `info@thisishaw.com`. Do not provision a paid subscription, enter a new
   password, or accept service terms on the user's behalf.
2. Configure Cloudflare Email Routing for the dedicated `contact.thisishaw.com`
   sender subdomain and verify `info@thisishaw.com` as a destination. Retain the
   root domain's selected mailbox provider and MX records. The EmailMessage
   binding is restricted to this single verified recipient. Do not substitute
   unrestricted arbitrary-recipient Email Sending or purchase Workers Paid.
3. Confirm DNSSEC, the existing root website CNAME, www redirect, and HTML
   preservation rules remain intact. Leave `kemet.pages.dev` unchanged.

References: [Email routing and verified destinations](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/),
[Email subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/),
[Worker email binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

## Verification and cutover

Run `node --test cloudflare/contact/handler.test.mjs` from this canonical backend
checkout on `main`. The existing full backend workflow now requires this check
as well as all retained Supabase checks. Preserve its exact-commit successful
run/attempt before deploying. Preserve unrelated local changes.

Deploy only these committed backend files using the pinned Wrangler version,
with the exact backend commit as its version tag. Retain the Worker version,
script/config digests and exact-source hosted gate in a deployment receipt.
The route must remain exactly `thisishaw.com/api/contact`; the Worker must not
proxy or serve website assets. Verify GET returns 405 and the expected commit
header, invalid requests cannot send email, and one identified test submission
arrives at the configured inbox with the expected Reply-To.

Publish the corresponding sealed website preview to the custom domain only
after those checks. Its static Pages seal still forbids `_worker.js`, Functions,
app runtime artifacts, missing assets and unapproved landing modifications.
Rollback the frontend through its previous verified preview alias. If needed,
remove only this Worker's exact contact route; do not alter app or website DNS.
