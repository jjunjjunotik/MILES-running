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

### Crew missions

Three, and only three — the three things the app measures:

| | Counts |
|---|---|
| **Cover the ground** | every kilometre the crew runs this week |
| **Take ground** | new land the crew claims |
| **Take it off somebody** | ground the crew cuts out of runners outside it |

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

Fifteen checks live in the repo root. The first is plain Node; the rest drive the
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
```

`test-tiles.js` serves its own tiles from a throwaway HTTP server, so it needs
no network and passes with the real CDN blocked.

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

A paid tier exists in the app. **It is a product surface, not enforcement** —
the app is a static front end whose state is in `localStorage`, so
`pro.plan` is one devtools edit away for anyone who wants it. Real
entitlement needs a server, and `Pro.verify()` in `src/js/pro.js` is the single
function that has to change when there is one: it asks the backend, caches the
answer, and nothing above it moves.

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

## Not included

This is a complete, working front end with a local data model. It has no
backend: friends, crews and their activity are generated locally, live
telemetry is device-local, and there is no account system. Those are the seams
to build on.
