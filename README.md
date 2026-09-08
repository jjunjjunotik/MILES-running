# MILES

A running app for people who would rather race a friend than a leaderboard.

Run **solo** or **duo**. In a duo, both runners publish distance, pace and
position live, and each phone shows the gap opening and closing in real time.
Finish where you started and everything your loop encloses becomes your
**territory**. Quests are the only source of XP, and XP is the only thing that
moves your **rank**.

No build step, no dependencies, no network calls. Open `index.html`.

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
3. In each tab: **Duo → pick the same friend → Start duel**.

Each tab now shows the other's real distance, pace and position, and the
head-to-head strip is symmetric across both. If nobody joins, a pace bot runs
your friend's recent average so a duo is never a dead screen.

To put this on a real network, replace `_send` and the channel wiring in
`src/js/realtime.js` with a WebSocket. Nothing else changes.

---

## What is in it

| Screen | What it does |
|---|---|
| **Home** | Weekly / monthly volume with a KM ⇄ MI switch, intensity tier, map with your location, Territory and Quest tiles, and the two start buttons |
| **Run** | Live map, distance, pace, loop-capture readout, and the duo head-to-head strip |
| **Finish** | The shareable record card, exportable as a PNG |
| **Land** | Every claim in the neighbourhood, yours and your rivals', with standings |
| **Quests** | Nine quests, XP, and six ranks from Rookie to Apex |
| **Feed** | Strava-style activity cards with route thumbnails |
| **You** | Units, simulated pace, runner name, GPS, reset |

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

Run at least 400 m and come back within 30 m of where you started. The loop is
**latched** the moment you pass your start point — you never have to hit Finish
while standing inside a circle — and the enclosed area (shoelace formula on a
local metre projection) is added to your land. Run a second, wider loop and the
bigger one replaces it.

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
src/js/state.js       Data model: activities, territory, quests, ranks
src/js/map.js         Procedural canvas map (no tile server)
src/js/realtime.js    Live duo telemetry + pace bot
src/js/tracker.js     Run engine: GPS, splits, loop capture
src/js/card.js        The 1080×1350 record card
src/js/ui.js          Screen rendering and events
src/js/app.js         Bootstrap
design/DESIGN.md      Full design specification
design/tokens.json    Tokens Studio format, importable into Figma
```

Distances are metres, durations seconds, areas square metres — everywhere.
Conversion to km/mi happens only at the display edge, in `Units`.

### Why the map is drawn, not fetched

There is no tile provider. The city is generated from a fixed seed, so the app
starts instantly, works with no network, and makes no third-party requests with
your location in them. Routes, territories and live runners are real data drawn
on top in true metres.

---

## Not included

This is a complete, working front end with a local data model. It has no
backend: friends and their activity are generated locally, live telemetry is
device-local, and there is no account system. Those are the seams to build on.
