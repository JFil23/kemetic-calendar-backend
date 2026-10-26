# ḥꜣw Admin Activity Ledger

The private admin application is a single-purpose activity ledger. It lists
registered accounts, searches names/emails/handles, filters recorded activity,
and expands each person into a timeline grouped by their local calendar day.
The 7/30/90-day controls and account sorting share this same view. Known screen
routes and Pages card selections use readable names. Consecutive visits to the
same screen within two minutes are grouped; expanding the group retains every
original timestamp. Counts remain raw recorded events. Historical navigation
records cannot establish actions that the consumer did not record.

The implementation reuses the ledger merged in backend PR #85. The existing
Supabase staff gate and the `admin_activity_users` / `admin_activity_user_detail`
RPCs remain the authorization and data owners. The browser uses a public
Supabase key and the signed-in staff session. Private journal, message and
calendar content is not part of the ledger payload.

## Run locally

From `admin/`:

```sh
npm ci
cp .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the existing project's
public browser values, then run:

```sh
npm run dev -- --host 127.0.0.1 --strictPort
```

Open `http://127.0.0.1:5174/` and sign in with the existing staff account.
An optional development UI preview uses the authored fictional accounts;
its banner identifies the data as illustrative. A production build always
uses the existing staff authorization flow.

## Verification

```sh
npm run lint
npm run build
```

Lint includes type checking, the privileged-key guard, and the ledger/PWA
tests. Tests cover filters, search, local midnight, date-window boundaries,
the shared four-request gate, and the service worker's private-data boundary.

The reproducible browser fixture runs on loopback and contains only synthetic
accounts. Build the same source against it without changing `.env.local`:

```sh
VITE_SUPABASE_URL=http://127.0.0.1:5176 \
VITE_SUPABASE_ANON_KEY=fixture-public-browser-key-not-a-secret \
npm run build -- --outDir /tmp/haw-admin-qa-dist --emptyOutDir
python3 scripts/ledger_browser_fixture.py --directory /tmp/haw-admin-qa-dist
```

At `http://127.0.0.1:5176/`, use `qa-owner@example.test` and any fixture-only
password. Change 30 → 7 → 90 days while lists/details are delayed, expand all,
then collapse and reopen the nodes. Only the newest range should render.
`/__qa/metrics` reports actual request counts: the peak must stay at four,
obsolete queued ranges should be skipped, and reopening loaded nodes should
reuse their details. This fixture does not connect to Supabase.

## Hosting and PWA

The existing admin host is `https://haw-admin.pages.dev`, Cloudflare Pages
project `haw-admin`, production branch `main`. Build `admin/dist` with the
production public Supabase values for this existing host.

`manifest.webmanifest` requests standalone display and includes regular and
maskable icons. The service worker caches the interface shell and assets;
authentication and activity responses bypass its cache. Home-screen
installation requires HTTPS and should be verified on the target device.

The consumer hosts are independent of this admin application. The ledger's
readable-label migration must qualify through the complete backend gate and be
applied before publishing a frontend that uses its presentation metadata. It
changes read projections only and remains compatible with the existing consumer
and previous admin frontend. No Edge Function deployment is needed.
