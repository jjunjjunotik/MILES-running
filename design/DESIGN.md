# MILES — Design specification

The visual language of MILES, written so it can be rebuilt in Figma (or any
other tool) without reading the code. Every value here is the same value the
app ships: `src/css/tokens.css` is the implementation of this document, and
`design/tokens.json` is the machine-readable form.

---

## 1. Product idea in one line

**Run free, run to take ground, or race up to four friends to an agreed
distance.**

The three run kinds are the spine of the product. They never blur into each
other: a Free Run claims nothing, a Territory Run is the only way to take
ground, and a Race is scored purely by who crosses the agreed distance first.
Each has its own accent, its own badge, and its own record card.

Three loops carry the whole product:

| Loop | Question it answers | Where it lives |
|---|---|---|
| **Volume** | Am I running enough? | Home header, intensity tier |
| **Rivalry** | Did I beat them to the line? | Race, feed, standings |
| **Territory** | What have I taken? | Map, Land tab, quests |
| **Belonging** | Who do I run with? | Crew |

| Run kind | Accent | Badge | Scored by |
|---|---|---|---|
| Free Run | `#c8ff2e` | `RUN` | Distance |
| Territory Run | `#8b5cf6` | `TERRITORY` | Ground enclosed |
| Race | `#ff3d8b` | `RACE` | Finish order |

---

## 2. Principle: the interface earns its energy

The app is deliberately calm when you are not running much and visibly alive
when you are. Weekly volume (a trailing 7-day window, so it does not collapse
every Monday) maps to a `--energy` value between 0 and 1, which drives:

- **Accent ramp** — a heat ramp from ember orange to apex violet.
- **Backdrop motion** — the aurora drifts between 22 s and 7 s per cycle.
- **Glow radius** — 8 px to 54 px on the volume readout and Solo button.
- **Speed streaks** — invisible at rest, prominent at the top tiers.

| Tier | Trailing 7 days | Accent | Secondary |
|---|---|---|---|
| Ember | 0 – 10 km | `#ff8a4c` | `#ffb020` |
| Spark | 10 – 20 km | `#ffc63d` | `#c8ff2e` |
| Blaze | 20 – 35 km | `#c8ff2e` | `#6ee7ff` |
| Surge | 35 – 55 km | `#2fe0ff` | `#c8ff2e` |
| Storm | 55 – 80 km | `#ff3d8b` | `#2fe0ff` |
| Apex | 80 km + | `#a855f7` | `#ff3d8b` |

No tier is ever grey. The lowest rung should still look like something worth
stoking.

---

## 3. Colour

### Surfaces (dark-first — running happens at dawn and dusk)

| Token | Value | Use |
|---|---|---|
| `--ink-900` | `#05070a` | App background |
| `--ink-800` | `#0a0e14` | Sheets, map ground |
| `--ink-700` | `#0f151d` | Raised panels |
| `--ink-600` | `#151d27` | Inputs |
| `--ink-500` | `#1d2733` | Dividers on solid fills |
| `--ink-400` | `#2a3644` | Grips, disabled |
| `--line` | `rgba(255,255,255,.08)` | Hairlines |
| `--line-strong` | `rgba(255,255,255,.16)` | Emphasised borders |

Cards are not flat fills: they are a 170° gradient from `rgba(255,255,255,.055)`
to `rgba(255,255,255,.02)` over a 14 px backdrop blur, with a `--line` border.

### Text

`--text-hi #f2f6fa` · `--text-mid #9dabbd` · `--text-lo #64748b`

### Meaning

| Token | Value | Means |
|---|---|---|
| `--lime` | `#c8ff2e` | You: your pace, your route, your land |
| `--cyan` | `#2fe0ff` | Live data and telemetry |
| `--magenta` | `#ff3d8b` | Your rival |
| `--violet` | `#8b5cf6` | Territory |
| `--amber` | `#ffb020` | Quests, rank, reward |
| `--ok` / `--warn` / `--bad` | `#2ee6a8` / `#ffb020` / `#ff5964` | State |

Colour always means the same thing. A violet shape is land; a magenta dot is
the person you are racing. Nothing is coloured decoratively.

---

## 4. Type

Two families only.

Small labels are the app's most repeated text, so they are set to be read, not
to look technical: 11 px and up, with tracking wide enough to space the caps and
no wider. The tab bar is the one place that drops the uppercase entirely — five
words a thumb aims at should read as words.

- **UI** — Inter / SF Pro Text / system sans. Weights 600, 700, 800.
- **Numbers** — SF Mono / JetBrains Mono / any tabular mono. Every measured
  value uses it, so digits never jitter as they tick.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Hero volume | 46–62 px (fluid) | 800 | −0.03 em |
| Run distance | 60–82 px (fluid) | 800 | −0.03 em |
| Screen title | 22 px | 700 | −0.02 em |
| Card value | 19–30 px | 700 | −0.03 em |
| Body | 13–14 px | 600 | 0 |
| Label (all caps) | 11–11.5 px | 700 | 0.07–0.08 em |
| Tab label | 11.5 px | 600 (700 active) | 0.005 em, sentence case |
| Wordmark | 20 px | 800 | 0.24 em |

---

## 5. Geometry

Radii: `10 / 16 / 22 / 30 / 999` px. Spacing scale: `4 / 8 / 12 / 16 / 22 / 30 / 42`.

Every icon is a stroked path with round caps and joins (`svg { stroke-linecap:
round; stroke-linejoin: round }`). Square ends are what make an icon set read as
hard, and one rule settles it for all of them.
Frame: 430 × 932 (iPhone 16 Pro Max), safe-area aware, capped at `max-width: 430px`.

---

## 6. Screens

### 6.1 Home

Top to bottom, and this order is the argument the screen makes:

1. **Volume header** — Weekly / Monthly segment, KM / MI segment, hero number,
   delta against the previous period, 7-bar sparkline, and the intensity tier
   with its progress to the next.
2. **Field** — a two-column grid: the map (with your live position) on the
   left, and a narrow rail on the right holding **Territory** (violet) and
   **Quests** (amber) tiles. Both are tappable shortcuts to their tabs.
3. **The two starts** — `Solo` (filled with the live accent gradient) and
   `Race` (magenta-outlined). Equal weight, side by side. Solo opens a sheet
   asking which kind of run it is, because that choice changes what the run
   means, not merely how it is logged.
4. **Friends this week** — ranked bars, you highlighted in the accent.

### 6.2 Run

Map fills the upper half and auto-frames your route plus the start pin. Below
it: distance as the hero, then Time / Pace / and a third cell that answers
whatever this run kind is asking — elevation on a free run, distance back to
the start (then area captured) on a territory run, distance remaining in a
race.

A race adds the live standings: every runner ordered, each with a progress
track against the agreed distance, your row in lime and your place called out
top-right. It replaces the old two-runner gap strip, which could not hold a
field of five.

### 6.3 Finish — the record card

A 1080 × 1350 shareable canvas, themed and badged by run kind so it is legible
at a glance and at thumbnail size.

The headline is **the one number that run was about**, not always distance:

| Kind | Headline | Outcome badge |
|---|---|---|
| Race | `3rd of 5` | `CROSSED THE LINE 3RD` |
| Territory | `0.21 km²` | `LOOP CLOSED · LAND TAKEN` |
| Free | `8.20 km` | none |

Underneath, the same three cells appear on every card — Distance / Time / Pace
— so cards stay comparable however different their headlines are.

### 6.4 Land

A neighbourhood map of every claim — yours in violet, each rival tinted in
their own colour — over total area held, standings, and your plots as
thumbnails.

### 6.5 Quests

The rank **ladder** sits on top: one disc per rank, swiped sideways. The letter
is in the circle and the XP is the ring around it, so the shape carries the
number — a full ring is a rank behind you, an empty one is a rank you have not
reached. The ring measures XP *inside that rank's band*, not lifetime total,
which is why every reached rank reads 100% instead of shrinking as you climb.

Neighbours peek at both edges and fade out rather than being cut, so the
gesture is discoverable without a hint; dots below take a tap, and arrow keys
work. Under the deck, one card explains whichever rank you are looking at —
behind you, where you are, or ahead — and names the quest closest to completion.

Quests are the only source of XP, and XP is the only source of rank: the ladder
rewards intent, not raw mileage.

### 6.6 You

Identity, three lifetime figures, then **Run history**: every record card you
have earned as a filterable wall of thumbnails, each badged by kind and
labelled with what it was about (a placing, an area, a distance). Below it,
friends — the people who can line up in a race — with their race pace, and the
settings.

### 6.7 Crew

Your crew first (or the invitation to start one), then the local crews sorted by
how far their turf is from yours. A crew card carries the icon, tagline, size,
weekly volume and distance — enough to choose without opening it.

The crew sheet is one screen with three registers, in the order a captain
needs them: **join requests** (the thing waiting on a decision), **the roster**
with role tags, then **the actions**. What you see depends on who you are:
a visitor gets Join, a member gets Leave, a captain gets the roster's `⋯`
menu — pacer, hand over, remove — plus Edit and Disband. The model refuses
every captain action for anyone who is not the captain, rather than only
hiding the buttons.

### 6.8 Feed

Strava-style cards: athlete, title, relative time, route thumbnail, four
stats, and Kudos / Card actions.

---

## 7. Motion

| Element | Duration | Curve |
|---|---|---|
| Screen change | 220 ms | ease |
| Sheet in | 300 ms | `cubic-bezier(.2,1,.3,1)` |
| Toast in | 280 ms | `cubic-bezier(.2,1,.3,1)` |
| Button press | 120 ms | ease, scale .97 |
| Progress bars | 500 ms | `cubic-bezier(.2,1,.3,1)` |
| Aurora drift | 22 s → 7 s | ease-in-out, energy-driven |

Everything decorative is disabled under `prefers-reduced-motion: reduce`.

---

## 8. Rebuilding this in Figma

1. Import `design/tokens.json` with the **Tokens Studio** plugin — it carries
   colour, spacing, radius and type as a single set.
2. Create a 430 × 932 frame; background `--ink-900`.
3. Build the card style once as a component: 170° gradient fill, 1 px `--line`
   stroke, 22 px radius, 14 px background blur.
4. Build six variants of every accent-bearing component, one per intensity
   tier, so the energy ramp is visible in the file rather than only in code.
5. Screen order for the flow: Home → Solo sheet / Race lobby → Run → Finish →
   Crew → Land → Quests → Feed → You.
