# MILES API

The server behind the MILES app: accounts, runs, the shared territory map,
crews and their weekly missions, friends and the feed, live races, payments,
and the moderation the stores require.

Node 22 and PostgreSQL 13 or newer. Two dependencies, `pg` and `ws`. The
territory and crew rules are not reimplemented here: the server loads the
app's own `src/js/clip.js`, `land.js`, `crew.js` and `pro.js` (see
`src/shared.js`), so a loop is resolved by the same code on the phone and on
the server.

---

## Run it

```bash
# A Postgres you can reach, with a database for MILES:
createdb miles

cd server
npm install
DATABASE_URL=postgres://you@localhost/miles npm start
# → MILES API listening on port 8080
```

The server applies its migrations (`migrations/*.sql`) every time it starts.

Or Postgres and the API together, in Docker:

```bash
docker compose -f server/docker-compose.yml up --build
```

Point the app at it with `index.html?api=http://localhost:8080` (see
**The app and the server** in the main README).

## Tests

```bash
cd server
npm test        # 79 tests, about 4 seconds
```

Each test file creates a database of its own, boots the real server on a
random port, talks to it over HTTP and WebSocket the way the app does, and
drops the database afterwards. They need a Postgres where the role may
create databases: `TEST_DATABASE_URL` (default
`postgres://miles:miles@127.0.0.1:5432/postgres`).

---

## Configuration

Everything comes from the environment; `.env.example` has every setting with
a note on what it is for.

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres connection string. The only one required. |
| `PUBLIC_URL` | Where the server is reached. The privacy, terms and deletion pages live here. |
| `COMPANY_NAME`, `CONTACT_EMAIL` | Who runs MILES, on the privacy policy and terms. Reports are mailed to `CONTACT_EMAIL`. |
| `RESEND_API_KEY`, `MAIL_FROM` | Password reset emails. Without them nobody can reset a password. |
| `ADMIN_TOKEN` | Bearer token for `/admin`. Empty turns `/admin` off. |
| `REVENUECAT_WEBHOOK_SECRET` | The Authorization value RevenueCat sends. Empty turns the webhook off. |
| `REVENUECAT_API_KEY` | Optional: RevenueCat's V1 secret key (`sk_…`), so a purchase counts the moment it is made. Newer projects only make V2 keys, which do not work here; leave it empty and the webhook does it. Never in the app. |
| `ARCGIS_MAP_KEY` | The key that licenses the map's tiles (see **Map tiles**). Without it the app falls back to keyless tile servers, which are not licensed for a store app. |
| `TRUST_PROXY` | `true` behind a load balancer, so rate limits see runners, not the balancer. |
| `ALLOW_SIMULATED_RUNS` | `false` in production: the app's simulator must never claim real ground. |
| `CORS_ORIGINS` | Default `*`. Safe, because the API uses bearer tokens, not cookies. |

---

## Deploying

Any host that runs a Docker image and supports WebSockets, plus a managed
Postgres (which gives you backups and point-in-time restore).

```bash
# From the repository root — the image needs src/js as well as server/
docker build -f server/Dockerfile -t miles-api .
```

Run it with the variables above, behind HTTPS, with `/healthz` as the health
check. **Run one instance.** Rate limits and live-race rooms are kept in
memory; a second instance would split them. One instance carries a long way;
past that, move both to Redis or Postgres `LISTEN/NOTIFY`.

After the first deploy:

1. Open `PUBLIC_URL/privacy`, `/terms`, `/support` and `/delete-account` and
   check the company name and contact address read right. The text is a
   careful starting draft that matches what this server does — have it
   reviewed for your jurisdiction before launch, and add a Korean version if
   you publish in Korea.
2. Put those URLs in App Store Connect (privacy policy, support) and the Play
   Console (privacy policy, account deletion).
3. Make the account App Review signs in with, and give it Pro so every screen
   can be reviewed:

   ```bash
   curl -X POST https://api.example.com/admin/entitlements \
     -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"email":"review@example.com","plan":"pro_yearly","days":365}'
   ```

---

## Moderation

Apple's guideline 1.2 asks for reporting, blocking, and someone acting on
reports within 24 hours. Runners report and block from the app; reports are
mailed to `CONTACT_EMAIL` and queue at `/admin/reports`:

```bash
curl https://api.example.com/admin/reports -H "authorization: Bearer $ADMIN_TOKEN"

# Each report lists the actions that fit it
curl -X POST https://api.example.com/admin/reports/<id>/resolve \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"action":"ban","note":"slurs in crew notices"}'
```

| Reported | Actions |
|---|---|
| runner | `dismiss`, `rename` (to "Runner"), `ban` (signs out, blocks sign-in, removes their land) |
| crew | `dismiss`, `reset` (name, tagline, photo and spot cleared), `delete` |
| notice | `dismiss`, `hide` |
| run, plot | `dismiss`, `delete` (land goes back to whoever it was taken from); a plot can also be `reset` |

Names, crew details, notices and plot names are checked against
`data/blocklist.txt` (English and Korean) before they are saved. It catches
the obvious; add to it from what reports turn up. `/admin/stats` counts
runners, runs, crews and open reports, with the age of the oldest.

---

## Map tiles

The app's map is Esri's, through an ArcGIS Location Platform account: two
million tiles a month free, then $0.15 per thousand. In the account, make API
key credentials with one privilege, **Static basemap tiles**, generate a key,
and set it as `ARCGIS_MAP_KEY`. The app asks for it at `GET /v1/config` and
keeps the last one it was given.

Esri's keys last a year at most. A month before one expires, generate the
credentials' second key, set `ARCGIS_MAP_KEY` to it and restart; phones take
it up the next time they open the app, and nobody has to update anything.

## Payments

Purchases go through [RevenueCat](https://www.revenuecat.com), which sits in
front of both Apple's in-app purchase and Google Play Billing. The app buys
with RevenueCat's SDK (`src/js/billing.js`), logged in as the runner's MILES
user id; RevenueCat tells the server what that runner now has.

- **The products.** Name them after the plans in `src/js/pro.js`:
  `supporter_monthly`, `supporter_yearly`, `pro_monthly`, `pro_yearly`. On
  the App Store all four go in **one subscription group**, so moving between
  them is an upgrade or a downgrade, not a second subscription. On Google
  Play each is a subscription with one base plan (`pro_yearly:yearly` is
  understood). Set the prices in each store; the app shows whatever they are.
  The yearly plans say "two months free", so price them at ten months.
- **RevenueCat.** Entitlements called `supporter` and `pro`, with each
  product attached to its tier.
- **The app.** RevenueCat's public key for each store at build time:
  `REVENUECAT_IOS_KEY=appl_…` and `REVENUECAT_ANDROID_KEY=goog_…` (see the
  phone app in the main README).
- **The server.** The webhook, at `PUBLIC_URL/v1/billing/revenuecat` with
  an Authorization value equal to `REVENUECAT_WEBHOOK_SECRET`, sending both
  production and sandbox events (App Review buys in the sandbox). It carries
  everything: the purchase a few seconds after it is made — the app keeps
  looking until it lands — then renewals, cancellations, refunds and expiry.
  Optionally `REVENUECAT_API_KEY`, a V1 secret key, with which the server
  asks RevenueCat the moment a purchase is made (`POST /v1/billing/sync`).
  RevenueCat's newer projects only make V2 keys; without one, leave it empty.

Every event is stored in `billing_events` and applied once. What a runner has
is in `entitlements`, and every Pro gate on the server reads it — founding a
crew, races with more than four rivals or at a distance of your own, the time
machine's history, who took your land, naming a plot.

The 14-day Pro trial is the app's own, needs no payment, and can be taken
once per account.

---

## The API

JSON in and out, `Authorization: Bearer <token>` from sign-in, errors as
`{ "error": { "code", "message" } }` with a message the app can show as it is.
Distances are metres, durations seconds, areas square metres, times epoch
milliseconds — as in the app.

| | |
|---|---|
| `POST /v1/auth/signup` · `login` · `logout` | Accounts. Sign-up needs `acceptTerms` and `ageConfirmed` (14+). |
| `POST /v1/auth/password/forgot` · `reset` | A six-digit code by email, five tries, fifteen minutes. |
| `GET` · `PATCH` · `DELETE /v1/me` | You, your name and settings; deleting needs the password. |
| `POST /v1/me/password` · `trial` · `GET /v1/me/export` | Change password; start the trial; everything held about you. |
| `POST` · `GET /v1/runs`, `DELETE /v1/runs/:id` | Runs. A closed territory loop claims its ground in the same request. |
| `GET /v1/land?bbox=w,s,e,n` · `/v1/land/mine` · `/v1/land/raiders` | The map, your plots, who took your land. `history=1` is the time machine. |
| `PATCH /v1/claims/:id` | Name and colour a plot of yours. |
| `GET` · `POST /v1/crews`, `/v1/crews/:id/...` | Crews near a point, founding, joining, every captain's tool, notices, the mission. |
| `GET` · `POST /v1/friends`, `DELETE /v1/friends/:id` | Friends, added by their six-character code. |
| `GET /v1/feed`, `POST` · `DELETE /v1/runs/:id/kudos` | Friends' runs (route ends trimmed), and kudos. |
| `POST /v1/races`, `GET /v1/races/invites` | Races with friends. |
| `WS /v1/live` | Presence, race invites, live telemetry. First message `{type:'auth', token}`. |
| `POST /v1/reports`, `GET` · `POST /v1/blocks` | Reporting and blocking. |
| `GET /v1/config` | What the app needs from the server before anything else: the map's key. No sign-in. |
| `POST /v1/billing/sync` | After a purchase or a restore: the server asks RevenueCat what you have now. |
| `POST /v1/billing/revenuecat` | RevenueCat's webhook. |
| `/privacy` · `/terms` · `/support` · `/delete-account` · `/healthz` | Pages and the health check. |

### What the server checks about a run

Not an anti-cheat system — the cheap checks that keep the map honest enough
to play on: no start in the future or more than 60 days back, no average
speed beyond what a runner holds (7.5 m/s over a kilometre or more), no
simulated runs, and a territory loop has to come back within 60 m of where it
started and enclose between 1,000 m² and 50 km².

### Territory

A claim keeps the loop as run (`polygon`) and what is still held of it
(`pieces`, `area`). When a claim arrives or goes, every claim whose extent
touches it is resolved again from scratch with the app's `Land.resolve`,
against every claim that could cut it, and each bite one claim took out of
another is recorded in `takes` — which is what "land taken" means for crew
missions and for who took your land. Claims are ordered by when the run
ended, so a run uploaded after an hour offline lands where it happened in
time. Writes take one advisory lock, so two loops closing at the same moment
are still resolved one after the other.
