# MILES

A running app for people who would rather race a friend than a leaderboard.

Three ways to run, and they are deliberately separate:

- **Free Run** — distance, pace, splits. Nothing is claimed.
- **Territory Run** — finish where you started and everything your loop
  encloses becomes yours.
- **Race** — you and up to four friends agree a distance; whoever crosses it
  first wins. Everyone publishes distance, pace and position live, so the
  standings reorder as you run.

Every run ends in a record card that says which of the three it was. Quests are
the only source of XP, and XP is the only thing that moves your **rank**.

Around that: **crews** (find the clubs near you, or start one and run it) and a
**coach** that reads your actual training — a plan built from your real volume,
form work aimed at what your data suggests, and an assistant you can ask.

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
| **Coach** | Training plan, running form, and an assistant that knows your numbers |
| **You** | Your run history as a wall of record cards, your friends, units, simulated pace, runner name, coach endpoint, GPS, reset |

The **Feed** is reached from Home ("See feed").

### Crews

A crew is a running club with a home turf. Browse the ones near you sorted by
distance, join an open one or ask to join a reviewed one, or start your own —
which makes you its captain. Captains get the tools that being a captain
implies: approve or decline join requests, promote members to pacer, remove
people, edit the crew's name, tagline and regular run, hand the crew to someone
else, or disband it. Everything else is refused for anyone who is not the
captain.

### Coach

Three surfaces, all reading your real training:

- **Plan** — pick a goal (5K, 10K, half, consistency, or territory), a length
  and how many days a week. The progression is computed locally from your
  trailing 7-day volume: roughly 10% a week, every fourth week a cutback, the
  long run kept under a third of the week. A model then comments on the plan
  rather than replacing it, so the mileage maths stays trustworthy.
- **Form** — general form cues, plus the two or three flags your own data
  argues for (a streak with no rest day, a long run that is too big a share of
  the week).
- **Ask** — an assistant with your training in its context.

It will not diagnose an injury, offline or online.

#### Where the model lives — and why there is no API key in this app

The app is a static front end, so it **never holds an Anthropic API key**: a key
shipped to a browser is a key you have given away. Three backends are tried in
order, and the Coach screen always says which one answered:

1. **Published as an Artifact** — `claude.use("sample")`, so the viewer's own
   Claude answers. Nothing to host, no key.
2. **A proxy you run** — `server/coach-proxy.mjs` holds the key server-side and
   calls Claude with the official SDK (`@anthropic-ai/sdk`, `claude-opus-5`,
   adaptive thinking, server-side refusal fallbacks):

   ```bash
   npm install @anthropic-ai/sdk
   export ANTHROPIC_API_KEY=sk-ant-...    # or run `ant auth login`
   node server/coach-proxy.mjs
   ```

   Then **You → Coach AI → endpoint** → `http://localhost:8787/coach`. If you
   deploy it, put it behind your own auth and rate limiting and narrow
   `ALLOW_ORIGIN` — every answer is billed to your key.
3. **Offline coaching** — a deterministic coach that still reads your data and
   answers the common questions. This is the default, so the feature is never a
   dead button.

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

On a **Territory run** — and only there — run at least 400 m and come back
within 30 m of where you started. A free run or a race never takes ground,
however neatly it happens to loop. The loop is **latched** the moment you pass
your start point — you never have to hit Finish
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
src/js/state.js       Data model: activities, territory, quests, ranks, crews
src/js/crew.js        Crews: discovery, membership, captain's tools
src/js/coach.js       Coach: AI adapter, plan builder, offline coaching
src/js/map.js         Procedural canvas map (no tile server)
src/js/realtime.js    Live race telemetry + pace bots
src/js/tracker.js     Run engine: GPS, splits, loop capture, race scoring
src/js/card.js        The 1080×1350 record card
src/js/ui.js          Screen rendering and events
src/js/app.js         Bootstrap
server/coach-proxy.mjs  Keeps the API key server-side and calls Claude
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
backend of its own: friends, crews and their activity are generated locally,
live telemetry is device-local, and there is no account system. The one server
in the repo, `server/coach-proxy.mjs`, exists solely so the API key has
somewhere to live that is not the browser. Those are the seams to build on.
