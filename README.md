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

No build step and no dependencies. Open `index.html`. The only thing it ever
fetches is map imagery, and that is optional — see **The map** below.

---

## Run it

```bash
# simplest — just open the file
open index.html                 # macOS  (xdg-open on Linux)

# or serve it, which is what you want for a real two-tab duel
python3 -m http.server 8000
# → http://localhost:8000
```

Everything is stored in `localStorage` on the device. Nothing is uploaded.

### Racing a friend for real

Live telemetry travels over `BroadcastChannel`, so **two tabs of the same
origin genuinely race each other** with no server:

1. Serve the app (`python3 -m http.server 8000`) and open it in two tabs.
2. In each tab: **You → Runner name**, give them different names.
3. In each tab: **Race → same distance, same friends → Start race**.

Each tab now shows the other's real distance and position in the standings.
Anyone who has not joined is run by a pace bot at the speed their weekly volume
implies, so a race is never a dead screen.

To put this on a real network, replace `_send` and the channel wiring in
`src/js/realtime.js` with a WebSocket. Nothing else changes.

---

## What is in it

| Screen | What it does |
|---|---|
| **Home** | Weekly / monthly volume with a KM ⇄ MI switch, intensity tier, map with your location, Territory and Quest tiles, and the two start buttons |
| **Run** | Live map, distance, pace, a third cell that answers whatever the current run kind is asking, and the live race standings |
| **Finish** | The record card, the race result table, and what the run earned |
| **Land** | Every claim in the neighbourhood, yours and your rivals', with standings |
| **Quests** | Ten quests, XP, and six ranks from Rookie to Apex |
| **Feed** | Strava-style activity cards with route thumbnails |
| **Crew** | The crews near you, and the one you are in — captains manage it from here |
| **You** | Your run history as a wall of record cards, your friends, units, simulated pace, runner name, GPS, reset |

The **Feed** is reached from Home ("See feed").

### Crews

A crew is a running club with a home turf. Browse the ones near you sorted by
distance, join an open one or ask to join a reviewed one, or start your own —
which makes you its captain. Captains get the tools that being a captain
implies: approve or decline join requests, promote members to pacer, remove
people, edit the crew's name, tagline and regular run, hand the crew to someone
else, or disband it.

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

Real GPS is used whenever the browser grants it (`watchPosition`). If it is
denied or unavailable — file URLs, no HTTPS, a desktop at a desk — a simulated
runner takes over so every screen stays usable. **You → Simulated pace** plays
those runs back at 1×, 12× or 40×, which is how you capture a loop in under a
minute during a demo. The chip at the top of the run screen always says which
one you are on: `GPS` or `SIM`.

---

## Layout

```
index.html            Markup for all seven screens
src/css/tokens.css    Design tokens — the single source of visual truth
src/css/app.css       Shell, energy backdrop, shared components
src/css/screens.css   Per-screen layout
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

The basemap is real: standard OpenStreetMap tiles, served by CARTO's dark
style, which needs no API key and is dark enough that a route drawn over it
still reads. **You → Map** switches between `Real` and `Drawn`, and the choice
is remembered.

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

Six checks live in the repo root. The first is plain Node; the rest drive the
real app in headless Chromium and need Playwright, which the app itself does
not — `npm i playwright`, or run with `NODE_PATH` pointing at an install that
has it. The three marked `:8765` want `python3 -m http.server 8765` running.

```
node test-clip.js         polygon subtraction, against a sampled oracle
node test-tiles.js        tile alignment, seams, canvas taint, fallback
node test-territory.js    a loop is the only way a territory run ends
node test-contrast.js     every text style against WCAG AA          :8765
node test-sheets.js       sheets never leave the shell scrolled     :8765
node test-dialogs.js      confirms and prompts where modals are blocked :8765
```

`test-tiles.js` serves its own tiles from a throwaway HTTP server, so it needs
no network and passes with the real CDN blocked.

---

## Not included

This is a complete, working front end with a local data model. It has no
backend: friends, crews and their activity are generated locally, live
telemetry is device-local, and there is no account system. Those are the seams
to build on.
