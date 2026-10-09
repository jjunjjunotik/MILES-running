# MILES

A running app for people who would rather race a friend than a leaderboard.

Three ways to run, and they are deliberately separate:

- **Free Run** — distance, pace, splits. Nothing is claimed.
- **Territory Run** — get back to where you started and everything your loop
  encloses becomes yours. Closing the loop is what ends the run.
- **Race** — you and up to four friends agree a distance; whoever crosses it
  first wins. Everyone publishes distance, pace and position live, so the
  standings reorder as you run.

Every run ends in a record card that says which of the three it was. Quests are
the only source of XP, and XP is the only thing that moves your **rank**.

Around that: **crews** — find the running clubs near you, or start one and run
it yourself.

No build step and no dependencies. Open `index.html`. On its own it is a
self-contained demo whose only network use is map imagery, and that is
optional — see **The map** below. Pointed at the server in `server/`, the
same app is a real account on a shared map — see **The app and the server**.

---

## Run it

```bash
# simplest — just open the file
open index.html                 # macOS  (xdg-open on Linux)

# or serve it, which is what you want for a real two-tab duel
python3 -m http.server 8000
# → http://localhost:8000
```

In the demo everything is stored in `localStorage` on the device and nothing
is uploaded.

### Racing a friend for real

Live telemetry travels over `BroadcastChannel`, so **two tabs of the same
origin genuinely race each other** with no server:

1. Serve the app (`python3 -m http.server 8000`) and open it in two tabs.
2. In each tab: **You → Runner name**, give them different names.
3. In each tab: **Race → same distance, same friends → Start race**.

Each tab now shows the other's real distance and position in the standings.
Anyone who has not joined is run by a pace bot at the speed their weekly volume
implies, so a race is never a dead screen.

Signed in to a server, a race is made on the server instead: each friend you
pick gets the invite on their own phone the moment you start, and telemetry
travels over the account's WebSocket (`src/js/api.js`, `server/src/live.js`).
The pace bots stay, standing in for whoever has not started yet.

---

## What is in it

| Screen | What it does |
|---|---|
| **Home** | Weekly / monthly volume with a KM ⇄ MI switch, intensity tier, map with your location, Territory and Quest tiles, and the two start buttons |
| **Run** | Live map, distance, pace, a third cell that answers whatever the current run kind is asking, and the live race standings |
| **Finish** | The record card — Map, Poster or Sticker, picked from a picture of each — the splits under it, the race result table, and what the run earned |
| **Land** | Every claim in the neighbourhood, yours and your rivals', with standings |
| **Quests** | Ten quests, XP, and six ranks from Rookie to Apex |
| **Feed** | Strava-style activity cards with route thumbnails |
| **Crew** | The crews near you, and the one you are in — captains manage it from here |
| **You** | Your run history as a wall of record cards, your friends, units, simulated pace, runner name, GPS, reset |

The **Feed** is reached from Home ("See feed").

### Crew missions

Three, and only three — the three things the app measures:

| | Counts |
|---|---|
| **Distance run** | every kilometre the crew runs this week |
| **Land claimed** | new land the crew claims |
| **Land taken** | land the crew takes from runners outside it |

**Headcount is the difficulty.** Each mission has a per-member target and the
ask is that times the crew's size, so a crew of twelve is asked for twelve
times what a crew of one is and nobody picks a level. A runner joining raises
the bar by exactly one person's worth; the mission records the size it was
priced for, so the card can say so.

**All three cost the same.** Three missions are only a choice if they are
equally hard, and targets set by eye are not — the first set asked for 0.44 of
a member's week in distance, 0.38 in claimed ground and 0.74 in taken, so
"pick one" meant "pick the cheap one". The targets are now derived from a
single measured member-week (mean weekly volume, mean run length, the share of
runs that are territory runs, the area a closed loop encloses, and the share
of claimed ground that came off somebody), multiplied by one `ASK` constant.
Change the ask and all three move together; they cannot drift apart. The XP is
the same for all three, because equal work paying unequal rewards would make
the choice about the reward again.

The same member-week scales the modelled half of the sum, so a crew of
team-mates is asked for exactly what a crew of real runners would be —
otherwise the difficulty would depend on how much of your crew is fiction.

The third one is measured rather than modelled for your own share: it replays
the same cuts that decide the live map and counts only the ones your crew made,
so ground two members both ran over is counted once and the total can never
exceed what those runners actually lost. Your team-mates' share is still
modelled from their weekly volume, as every other number about them is, until
there is a server to ask.

### Crews

A crew is a running club with a home turf. Browse the ones near you sorted by
distance, join an open one or ask to join a reviewed one, or start your own —
which makes you its captain. Captains get the tools that being a captain
implies: approve or decline join requests, promote members to pacer, remove
people, edit the crew's name, tagline and regular run, hand the crew to someone
else, or disband it.

The crew screen reads top to bottom in the order a crew's week is lived: the
crew itself, **This week**'s mission, **The crew** in numbers and when it meets,
the latest notice, and the ground it holds — one titled block each. **Manage
crew** opens on whatever is waiting for the captain, join requests first.

A crew meets on **as many days a week as it likes**, at a time set in plain
am/pm. The front page names whoever holds the crew's quickest pace, and lists
everyone running faster than the crew's average under **Setting the pace**.

Captains also run the crew's week:

- **Crew photo** — the captain picks an image and it becomes the crew's face.
  It is cropped square and shrunk to 256 px before it is stored, because a
  full-size photo will not fit in `localStorage`. Without one, a crew shows its
  initials.
- **Notice board** — tap the board to post an announcement the whole crew reads.
  Newest sits on the crew's front page; the rest are on the board.
- **Weekly mission** — pick one goal for the week and everybody's running counts
  toward it: cover the ground, turn out, take ground, line up, or nobody sits
  out. Targets scale with crew size, so the ask is the same whether there are
  three of you or twelve. Clearing it earns the crew XP, once per week.
A crew with other runners in it cannot be deleted. Pressing **Disband** asks the
captain to choose who takes it over; the crew carries on under them and the old
captain stays on as a member. Only a crew of one disbands outright.

- **Four tiers** — Startline, Pack, Legion, Dynasty. A crew climbs **only** by
  clearing weekly missions, so a big crew that never finishes a week stays at
  Startline.

Every captain action is refused in the model, not merely hidden in the UI: a
member who reaches for one is turned away.

---

### Racing

Pick the distance first, then up to four friends — a race holds five runners.
Crossing the agreed distance ends your race and fixes your place; finishers are
ordered by the clock time they crossed on, and anyone still out on the course is
ranked behind them, furthest first. Giving up early keeps the run and records it
as a did-not-finish.

### Your history

**You → Run history** is every card you have earned, filtered by kind. Tap one
to open it full size; Back returns you to where you opened it from.

### The interface gets more energetic the more you run

Trailing 7-day volume drives a single `--energy` value that changes the accent
ramp, the speed of the moving backdrop, the glow on the hero number and the
speed streaks. It uses a rolling window rather than the calendar week on
purpose — otherwise the app would go flat every Monday morning.

| Tier | Trailing 7 days |
|---|---|
| Ember | 0 – 10 km |
| Spark | 10 – 20 km |
| Blaze | 20 – 35 km |
| Surge | 35 – 55 km |
| Storm | 55 – 80 km |
| Apex | 80 km + |

### Territory

The Territory tab is a map you drive: **drag to pan, pinch or scroll to zoom**,
with a scale bar so a claim's size is a measured thing rather than a guess. It
opens framed on your own ground with the neighbours around it, and `◎` brings
that framing back whenever you have wandered. Once you have moved the view it
is yours — re-rendering the screen never snatches it back.

The city keeps going past your own neighbourhood, and it is already spoken for:
districts of other runners' claims are seeded across several kilometres in every
direction. The legend under the map answers for **whatever is on screen**, so
panning somewhere new tells you whose land you are looking at; when there is
none in view it points the way to the nearest, with a distance and a bearing.

Territory is **exclusive**: where two loops enclose the same ground, whoever
claimed it later owns it and the earlier claim gives up that part. No two plots
on the map overlap, and no area is counted twice. A claim keeps two shapes — the
loop you actually ran, which never changes and is what the record card draws,
and what you still hold of it, which is what the map, the thumbnails and every
area figure use. A later loop landing inside an earlier one leaves a hole in it;
one cutting across can leave it in two parts, and the plot list says so.

On a **Territory run** — and only there — run at least 400 m and come back
within 30 m of where you started. A free run or a race never takes ground,
however neatly it happens to loop.

**Closing the loop is the finish.** Meeting your own start point ends the run
by itself: there is no Finish button to press and no way to stop a territory
run early with land in hand. The enclosed area (shoelace formula on a local
metre projection) is added to your land and the record card opens. Until then
the banner over the map counts you down — first the distance still to cover
before a loop may close, then the distance back to your start.

If you need to stop anyway, **Abandon loop** asks first and then files the
effort as an ordinary run: the distance, pace and splits all count towards your
week, but an open loop encloses nothing, so no land is claimed.

---

## Location

Real GPS is used whenever it is granted — the browser's `watchPosition`, or
in the Android and iOS app the background-location plugin (see **The phone
app** below). If it is
denied or unavailable — file URLs, no HTTPS, a desktop at a desk — a simulated
runner takes over so every screen stays usable. **You → Simulated pace** plays
those runs back at 1×, 12× or 40×, which is how you capture a loop in under a
minute during a demo. The chip at the top of the run screen always says which
one you are on: `GPS` or `SIM`.

Signed in to a server there is no simulator: until the first fix the chip
reads `GPS…` and the clock waits with you.

---

## Layout

```
index.html            Markup for all seven screens
src/css/tokens.css    Design tokens — the single source of visual truth
src/css/app.css       Shell, grain, shared components
src/css/screens.css   Per-screen layout
src/fonts/            Instrument Sans (text), Barlow Condensed (numbers); OFL
src/js/core.js        Units, geometry, storage, event bus
src/js/state.js       Data model: activities, territory, quests, ranks, crews
src/js/crew.js        Crews: discovery, membership, captain's tools
src/js/clip.js        Polygon difference (Greiner-Hormann), so land cannot overlap
src/js/land.js        Resolves every claim against the ones made after it
src/js/tiles.js       Slippy-map tiles: sources, cache, fallback
src/js/map.js         Canvas map: imagery or drawn city, plus overlays
src/js/realtime.js    Live race telemetry + pace bots
src/js/tracker.js     Run engine: GPS, splits, loop capture, race scoring
src/js/card.js        The 1080×1350 record card
src/js/ui.js          Screen rendering and events
src/js/app.js         Bootstrap
design/DESIGN.md      Full design specification
design/tokens.json    Tokens Studio format, importable into Figma
```

Distances are metres, durations seconds, areas square metres — everywhere.
Conversion to km/mi happens only at the display edge, in `Units`.

### The map

The basemap is real and needs no API key: Esri's Dark Gray Canvas by default,
dark enough that a route drawn over it still reads, standard OpenStreetMap
tiles as `Street`, or OpenTopoMap as `Topo`. **You → Map** switches between
`Dark`, `Street`, `Topo` and `Drawn`, and the choice is remembered. (Dark was
CARTO's until CARTO started answering keyless requests with a watermark
instead of a map.) The record card draws the run on the same map.

`Drawn` is the original procedurally generated city, seeded so it looks the
same every time. It is also the automatic fallback: if tiles are blocked,
offline, or simply never arrive, the map quietly becomes the drawn city rather
than going blank, and the setting says so. Nothing else in the app depends on
imagery — a run, a loop and a claim work identically either way.

Two details worth knowing:

- **The projections differ.** Tiles are Web Mercator; everything else here —
  routes, loops, the territory subtraction — is a local equirectangular metre
  projection anchored at your home. Rather than convert the app, each tile is
  placed by projecting its own two corners through that same projection. The
  two disagree by a smooth scale factor in latitude, which across one tile is
  well under a pixel, and placing tiles independently stops the error
  accumulating across the screen.
- **Tiles are requested with `crossOrigin="anonymous"`.** Without it, a canvas
  that has drawn a cross-origin tile is tainted and `toDataURL` throws — which
  would break *Save card*. The record card and the route thumbnails draw no
  imagery at all, so they are safe regardless.

Imagery is a third-party request, and a tile URL contains the area you are
looking at. `Drawn` is the setting to use if you would rather it did not.

Routes, territories and live runners are real data drawn on top in true metres,
whichever basemap is underneath.

---

## Tests

Nineteen checks live in the repo root. The first is plain Node; the rest drive the
real app in headless Chromium and need Playwright, which the app itself does
not — `npm i playwright`, or run with `NODE_PATH` pointing at an install that
has it. The three marked `:8765` want `python3 -m http.server 8765` running.

```
node test-clip.js         polygon subtraction, against a sampled oracle
node test-rank.js         a rank-up fires once, and only when earned
node test-mission.js      three crew missions, scaled and reachable
node test-icons.js        one icon language, and no emoji anywhere
node test-pro.js          the paid boundary, and the numbers Pro sells
node test-tiles.js        tile alignment, seams, canvas taint, fallback
node test-map.js          panning, zooming, and who owns what is in view
node test-territory.js    a loop is the only way a territory run ends
node test-contrast.js     text against WCAG AA, and a weight floor  :8765
node test-sheets.js       sheets never leave the shell scrolled     :8765
node test-dialogs.js      confirms and prompts where modals are blocked :8765
node test-touch.js        every control is big enough to hit with a thumb
node test-type.js         nothing renders below the legibility floor
node test-hero.js         the home picture swipes, and nothing a swipe could break does
node test-crew.js         a captain's crew screen: one job per block, nothing shown twice
node test-card.js         the record card: every layout fits, and its climb is real
node test-native.js       the phone app: a run records in the background, the notch is clear
node test-online.js       the app against the real server, from sign-up to deleting the account
node test-billing.js      buying, upgrading and restoring a plan, against the server and a stand-in store
```

`test-online.js` and `test-billing.js` start the API from `server/` on a
database of their own, so they also need the server's dependencies (`cd server && npm install`) and a
Postgres where the role may create databases (`TEST_DATABASE_URL`). The
server has 85 tests of its own: `cd server && npm test`.

`test-tiles.js` serves its own tiles from a throwaway HTTP server, so it needs
no network, and refuses the real tile hosts itself where it checks what the app
says when they cannot be reached: it passes with the network open or blocked.

---

## Ranking up

XP comes from quests, and quests settle when a run is saved, so a rank can
only change at the moment a run ends. When it does, the app stops and says so:
a full-screen moment with the new rank's badge, its name, and one line about
what reaching it means. It is modal on purpose — this is the one thing worth
interrupting for — so the scrim, Escape and the button all close it.

If the browser allows notifications and you have turned them on (**You → Rank
alerts**), the same promotion arrives as a real notification. That matters for
a running app: a run usually ends with the phone going back in a pocket, and a
promotion nobody sees is not a promotion. Notifications are blocked outright in
a sandboxed frame and on `file://` URLs, so everything about them is optional —
the on-screen celebration is the part that always happens, and the settings row
says plainly which state you are in.

**A promotion is announced once.** The rank last announced is stored
(`rankSeen`), not worked out at render time, so reloading the app is not
earning it again. Two cases exist only to avoid lying: a fresh save starts from
the rank its seeded weeks already imply, and an upgrade from a version without
the field starts from wherever you already are. Without those, the first run
after installing would announce a promotion nobody ran for. Crossing two ranks
at once says so rather than quietly dropping the one in between.

---

## Type

Text on a dark ground is thinner than its colour suggests — light strokes bloom
and lose their edges — so **weight carries more of the legibility here than
contrast does**, and the smaller the text the more of it is needed. The floor
is `700` at 12px and below, `600` above; body copy is `700`, headings `800`.
Leading rose with the weight, because heavier lines close the gaps between
them.

`test-contrast.js` enforces both halves: the AA ratio and the weight floor. The
floor immediately found three styles carrying no `font-weight` at all and so
inheriting `400` — a map chip, a rank paragraph and the crew notice body.

Where the heavier type made a line crowd, the **words** gave way rather than
the weight: "Start and finish in the same place — the run ends the moment you
close the loop. Everything it encloses becomes yours." is now "Close the loop
back at your start. Everything inside becomes yours." Around thirty strings
were cut this way. Nothing lost its meaning; they lost the words that were not
doing any work.

---

## The design system

Four colour roles that never swap jobs:

| | |
|---|---|
| **flame** `#ff6a1f` | the brand, and every action — buttons, selected controls, tabs |
| **violet** `#a855f7` | territory and the game around it |
| **lime** `#c8ff2e` | you — your route, your land, your name among rivals |
| `--accent` | **not a brand colour.** The intensity ramp, ember → apex with weekly volume. Atmosphere only: glow, aurora, the tier bar. |

That last row is the reason the split exists. `--accent` was painting every
primary button as well as driving the ramp, so the button you pressed changed
colour as you trained. Actions are fixed now; only the atmosphere moves.

A type ladder rather than a cluster — `--t-hero` (62–86px) through `--t-display`
30, `--t-title` 21, `--t-lead` 17, `--t-body` 15, down to `--t-micro` 11.5 —
and one gutter (`--gutter`) with one gap between sections (`--band`).

**Surfaces come in three levels and the first is "no box".** Most content sits
on the page with nothing around it; a card has to earn its edges. Every screen
uses the same header (`.screen-head`, `.screen-title`, `.screen-sub`), the same
section pattern (`.section`, `.section-title`, `.link`), and leads with the one
number or picture it is actually about.

### Imagery

Drawn, not fetched — `src/js/visual.js` says why. A stock photograph of
somebody else's run is the same picture in every app that bought it, needs a
licence to ship, can fail to load, and knows nothing about the person looking
at it. These are made from the runner's own week instead: the sky is the hour
of their last run, the skyline is the city the map draws, and the route through
the ground is the route they actually ran. No request, no 404, no licence, and
different for every runner.

`Visual.photo(host, src, fallback)` is the seam for real photography. Pass a
`src` and it is used, with a drawn band showing underneath while it loads and
staying if it fails. With no `src` it goes straight to the drawn version —
nothing here invents a URL.

---

## Icons

Every mark in the app is a sprite from one set in `index.html` — 41 line icons
at 24×24, stroke only, drawn at the app's own weight. Nothing is an emoji and
nothing is a typed glyph.

That distinction is the point. An emoji arrives as somebody else's artwork, at
somebody else's weight, in whatever set the viewer's OS happens to ship — the
same `🏴` is a different picture on three phones. A typed `▶` or `✓` arrives at
the *text* font's weight, which is never the icon weight. Either one reads as
pasted in next to a drawn interface.

Sprites take their colour from the text they sit with (`stroke: currentColor`),
so a lock in a segmented control, a tick in a crew row and a quest badge look
like one family without a rule for each. `UI.icon(name)` builds them; nothing
constructs an icon any other way.

They are drawn for the size they are used at, which is usually 18–23px. Marks
that survive 40px can be mush at 21, so the set was reviewed by rendering it at
both — a pass that caught, among others, sliders standing in for a race, a
molecule for crew territory and a games controller for card themes.
`test-icons.js` checks that nothing pictographic survives in the source or on
any screen, that every reference resolves, that no sprite hard-codes a fill
(which would break colour inheritance), and that each stays inside its box.

---

## MILES Pro

A paid tier exists in the app. In the demo it is a product surface, not
enforcement: state lives in `localStorage`, so `pro.plan` is one devtools edit
away. Signed in to a server it is enforced: `/v1/me` says what the account has
paid for, `Pro.verify()` reads that answer without changing, and the server
itself refuses what is paid for and not paid — founding a crew, a race of more
than four rivals or at a distance of your own, the time machine's history, who
took your land, naming a plot. Plans are bought in the phone app from the App
Store or Google Play, through RevenueCat (`src/js/billing.js`,
`server/README.md`), at the store's own price in the runner's currency; the
dollar prices below are the demo's.

There are two paid tiers. **Supporter** ($2.99/mo, $29.99/yr) is expression:
naming and colouring your own plots, and the record card's colourways.
**Pro** ($4.99/mo, $49.99/yr) adds everything below, and contains Supporter.
A 14-day trial of Pro needs no card.

Every gate names a capability in `Pro.FEATURES` rather than testing a tier, so
moving a feature between tiers is one line in that table and nothing else in
the codebase moves.

**Nothing paid affects fairness.** No tier can claim more ground, hold it
longer, or level faster. Territory is a contest, and a contest you can buy is
not one. What Pro buys is knowing more about a map everybody plays on equally,
and organising more of it:

- **Time machine** — the map as it stood at any point in its life. The past is
  not stored: claims carry the time they were made and exclusivity is decided
  by that order alone, so a past map is recomputed by resolving only what had
  happened by then. It works on copies, so scrubbing never touches live state.
- **Who took your land** — every runner who has cut into your claims, with how
  much each took. Attribution replays the same cuts the live map is built from,
  one claim at a time in order, so ground two people later ran over is credited
  once, to whoever reached it first, and the total can never exceed what was
  actually lost.

- **Scout** — the largest circle in view that touches nobody's land, found by
  sampling and then checked against the claims themselves before it is offered.
- **Races up to 16** — the host's tier sets the field; everyone invited runs
  free, whatever they pay.
- **Founding a crew** — joining one is free and always will be.
- **Crew territory** — the map read by crew rather than by runner. A crew's
  ground is its members' ground, and since claims are already exclusive across
  the whole map the total is a sum needing no geometry of its own; what the
  crew adds is the grouping, so adjacent plots held by one crew read as one
  holding instead of five strangers. Crews are ranked by ground held, and the
  crew card names who in yours is carrying it — counted on land still held, so
  a member whose ground was taken back does not keep the credit.
- **Every map style** — street and light basemaps as well as dark.

The free tier keeps everything it had, including **all** of your history —
holding a runner's own data hostage is not a business model. What is free is
also the *fact* that you lost ground; what is paid is the breakdown of who took
it.

---

## The phone app

The same app, packed into Android and iOS projects with
[Capacitor](https://capacitorjs.com). `android/` and `ios/` are the native
projects; the web app is copied into them, not rewritten.

```bash
npm install
npm run android        # copy the app into android/ and open Android Studio
npm run ios            # the same for Xcode (a Mac is needed for iOS)
npm run sync           # after changing the app: copy it into both

# A build for the stores talks to your server, over HTTPS, and sells
# through RevenueCat with its public key for each store:
MILES_API_URL=https://api.example.com \
REVENUECAT_IOS_KEY=appl_… REVENUECAT_ANDROID_KEY=goog_… npm run sync
```

Without `MILES_API_URL` the phone build is the demo. Without a store's key it
talks to the server but cannot sell; the subscribe button says so. Only the
public keys go in the app — `scripts/build-www.js` refuses RevenueCat's secret
`sk_` key, which belongs on the server.

What the app adds over the browser, all in `src/js/native.js`:

- **A run keeps recording with the screen off.** GPS comes from
  `@capacitor-community/background-geolocation`. On Android that is a
  foreground service of type `location` with a "Run in progress"
  notification; the notification permission is asked when the first run
  starts (`RunNoticePlugin.java`). There is no `ACCESS_BACKGROUND_LOCATION`:
  recording only ever happens in a run the runner started, which is what a
  foreground service covers. On iOS it is the `location` background mode.
- **"Centre on me"** asks for one position through the same permission,
  without the notification.
- **The notch and the home bar.** `--inset-top` and `--inset-bottom` in
  `tokens.css` pad the shell; Capacitor measures them on Android, `env()`
  does on iOS.
- **Buying Supporter and Pro** (`src/js/billing.js`), with
  `@revenuecat/purchases-capacitor`. Signing in tells the store which MILES
  account is buying; prices are the store's own; after a purchase the app
  waits the few seconds until RevenueCat's webhook has told the server, then
  says the plan is on. Upgrading on Google Play replaces the old plan rather than
  charging for both (on the App Store the four plans share one subscription
  group and Apple does this itself). The offer carries the renewal terms each
  store asks for, Restore purchases, and the terms and privacy policy; Manage
  opens the store's page for the subscription.
- Portrait only, iPhone only (no iPad layout to review), dark status bar.
- Android targets API 36, as Google Play requires from 31 August 2026.

The icon and launch screen are drawn from the wordmark face by
`node scripts/draw-icons.js` into `assets/`, and cut to every size with
`npx capacitor-assets generate`.

The app id is `app.miles.running` (`capacitor.config.json`). Change it before
the first store upload if you want another; after that it is permanent.

---

## The app and the server

`server/` is the backend: accounts, runs, the shared map, crews and their
missions, friends and the feed, live races, payments and moderation. Its own
README covers running and deploying it.

```bash
cd server && npm install && npm start                  # needs Postgres; see server/README.md
open "index.html?api=http://localhost:8080"            # the app, signed in to it
```

`?api=` is remembered in that browser until `?api=off`, and only works on
`file://` or `localhost` — anywhere else a link could point the sign-in form
at someone else's server. The phone builds take the address from
`MILES_API_URL` instead (`npm run android`, see **The phone app**) and refuse
anything but HTTPS.

What changes once there is a server:

- **An account.** The app opens on sign-up / sign-in (`src/js/account.js`):
  a runner name, an email, a password, and confirming you are 14 or older
  and accept the terms. A forgotten password is reset with a six-digit code
  by email. The account card on **You** holds your friend code, a new
  password, your data as a download, your blocked runners, signing out, and
  deleting the account.
- **Nothing is made up.** No seeded runs, rivals, districts, crews or
  friends: every runner, crew and plot on the screen is real. The demo's
  world is untouched and comes back with `?api=off`.
- **Runs are kept on the server.** A finished run goes into an outbox and is
  uploaded as soon as there is a connection — a run finished in a tunnel
  arrives when the phone is back. The server decides what a loop takes,
  with the same `land.js`, and the map is redrawn from its answer. A run the
  server will not keep (faster than anyone runs, say) is taken off the phone
  too, with the reason.
- **GPS only.** The simulator never runs on a real account: a made-up run
  must not claim real ground. For development, `?sim=1` against a server
  started with `ALLOW_SIMULATED_RUNS=true` lets it through.
- **The map loads a view at a time** as you pan, with everyone's ground.
- **Crews are real crews.** Founding, joining, approving, the notice board
  and the weekly mission all go to the server; the mission counts every
  member's actual runs, claims and takes, and the server pays it out.
- **Friends are added by code**, never by searching for a name. The feed is
  their runs from the last month, with the first and last 200 m of every
  route cut off. Kudos are real.
- **Report and block** wherever someone's content appears: a feed card, a
  crew's roster, a notice, a crew, your friends.
- **Settings and progress follow the account**: units, map style, card
  layout, quests and the rank you have seen.

None of the screens talk to the server. `src/js/sync.js` fills `State.data`
from it in exactly the shapes the demo's own data has — your id as `'me'`,
crews and plots and friends as the screens already draw them — and sends what
you do back. Crew actions apply on the phone at once and are confirmed or
undone by the server a moment later. `src/js/api.js` holds the session and
the live socket.

---

## Not included

What a store release still needs that is not built here:

- **Push notifications.** A race invite reaches a friend whose app is open;
  one whose app is closed sees it the next time they open it, for ten
  minutes.
- **Sign in with Apple or Google.** Email and password only. If a social
  sign-in is added, Apple requires Sign in with Apple alongside it.
- **A map tile provider licensed for an app in a store** (see **The map**).
