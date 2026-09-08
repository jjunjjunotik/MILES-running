# MILES — Design specification

The visual language of MILES, written so it can be rebuilt in Figma (or any
other tool) without reading the code. Every value here is the same value the
app ships: `src/css/tokens.css` is the implementation of this document, and
`design/tokens.json` is the machine-readable form.

---

## 1. Product idea in one line

**Run alone or head-to-head with a friend, and the ground you loop around
becomes yours.**

Three loops carry the whole product:

| Loop | Question it answers | Where it lives |
|---|---|---|
| **Volume** | Am I running enough? | Home header, intensity tier |
| **Rivalry** | Am I ahead of my friend? | Duo run, feed, standings |
| **Territory** | What have I taken? | Map, Land tab, quests |

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
| Label (all caps) | 10–11 px | 700 | 0.14 em |
| Wordmark | 20 px | 800 | 0.24 em |

---

## 5. Geometry

Radii: `10 / 16 / 22 / 30 / 999` px. Spacing scale: `4 / 8 / 12 / 16 / 22 / 30 / 42`.
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
   `Duo` (magenta-outlined). Equal weight, side by side: the app has exactly
   two ways in.
4. **Friends this week** — ranked bars, you highlighted in the accent.

### 6.2 Run

Map fills the upper half and auto-frames your route plus the start pin. Below
it: distance as the hero, then Time / Pace / *To start* — the third cell
becomes the captured area once a loop closes. In a duo, a magenta head-to-head
strip shows the gap **centred on a ±300 m window**, because two runners 80 m
apart in a 5 km race would otherwise sit on top of each other.

### 6.3 Finish — the record card

A 1080 × 1350 shareable canvas: wordmark, date, title, hero distance, the route
(loop-filled violet when land was taken), a territory badge, a Time / Pace /
Elev row, and a footer carrying the duel verdict. Themed by what the run *was*:
violet if it claimed land, magenta if it was a duel, lime otherwise.

### 6.4 Land

A neighbourhood map of every claim — yours in violet, each rival tinted in
their own colour — over total area held, standings, and your plots as
thumbnails.

### 6.5 Quests

Rank card (badge, name, XP to next) over a progress list. Quests are the only
source of XP, and XP is the only source of rank: the ladder rewards intent,
not raw mileage.

### 6.6 Feed

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
5. Screen order for the flow: Home → Duo lobby → Run → Finish → Land → Quests
   → Feed → Profile.
