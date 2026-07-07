# Design — Phantom Read

The art-direction brief. Every build and QA run follows this file; change it
only deliberately, in its own commit, and say why.

## 1. Aesthetic direction

**Phantom Read is an architectural blueprint: prussian-blue drafting paper, a
fine cyan grid, white ink linework, mono annotations, and a hot coral "anomaly"
accent that flares when a dirty read, phantom, or write skew fires.**

The metaphor fits the subject. A database's transaction machinery is a precise,
engineered system — so we draw it like an engineer's schematic. The two
transactions are parallel drafting tracks; the shared table is the elevation;
the version chain is a dimensioned assembly. Anomalies are the one place the calm
blue plan is violated, so they get the single warm colour on the page. Restraint
is the point: this must read as *drafted*, not decorated.

Portfolio check: recent ships lean dark-neutral and arcade/CRT. Blueprint
prussian-blue with a coral accent is a distinct palette family and a distinct
personality (technical, drafted, calm) from the recent set.

## 2. Tokens

| Token | Value | Use |
|---|---|---|
| `--paper` | `#0d1b2a` | page background (drafting paper) |
| `--paper-2` | `#12253a` | raised surface base |
| `--surface` | `#16304a` | card / panel |
| `--surface-line` | `rgba(120,190,230,0.18)` | hairline borders |
| `--grid` | `rgba(120,190,230,0.09)` | background grid rules |
| `--ink` | `#eaf2ff` | primary text / linework |
| `--muted` | `#8fb0cf` | secondary text, annotations |
| `--cyan` | `#58c4dc` | **primary accent** — T1, structure, active |
| `--cyan-deep` | `#2f8fb0` | pressed / focus ring |
| `--coral` | `#ff6b57` | **anomaly accent** — T2, flares, danger |
| `--amber` | `#ffcf6b` | committed / success glow |
| `--radius` | `10px` | cards; `6px` for chips |

**Type pairing** (Google Fonts, with fallbacks):

- **Display:** `Space Grotesk` (500/700) — wordmark, headings, big numerals. Its
  slightly technical geometry suits the drafting theme.
- **UI / annotation:** `IBM Plex Mono` (400/500) — labels, step notes, values,
  version stamps. Mono reinforces "engineering drawing" and keeps columns of
  reads aligned.

**Scale:** 8px spacing unit (4px half-step). Type scale ~1.25:
0.78 / 0.875 / 1 / 1.3 / 1.6 / clamp hero.

**Depth:** panels use a top inset highlight (`rgba(255,255,255,0.04)`) plus a
soft long shadow (`0 18px 40px -24px rgba(0,0,0,0.8)`); accents glow rather than
drop-shadow (coral/cyan `drop-shadow` at ~40% alpha). Never flat single-hue
panels.

**Motion:** UI transitions 140–220ms ease-out. Step advance 120ms. Anomaly flare
90–140ms. Respect `prefers-reduced-motion` (keep function, drop shake/particles).

## 3. Layout intent

The **hero is the transaction timeline**: two vertical lanes (T1 cyan, T2 coral)
running down the page with the **shared table** and its live version chain
between/beside them. This occupies ~65% of the viewport on desktop.

- **1440×900:** three columns — controls rail (isolation selectors, scenario
  picker, transport) · the two lanes with the table板 in the centre · a right
  "what just happened" annotation column. The grid background fills all bleed;
  no dead margins.
- **390×844:** single column. Controls collapse into a compact top bar; the two
  lanes stack as a shared timeline with actor chips (T1/T2) per step; the table
  sits as a sticky mini-panel. No horizontal scroll; the timeline still fills the
  screen.

Controls are never naked native widgets: the isolation `select`s render as
styled segmented pills, the transport as chunky buttons that depress on press.

## 4. Signature detail

**The anomaly flare.** When the engine produces an anomaly, the offending row on
the shared table pulses coral, a spectral "phantom" ghost of the value drifts up
and fades, and a dimension-line callout snaps in naming the anomaly
("PHANTOM READ — row appeared mid-transaction"). The same event under a higher
isolation level shows the row staying calm blue with a struck-through ghost —
the *prevention* is its own designed moment. This flare, drawn as blueprint
annotation, is the memorable thing.

## 5. Juice plan (this is a playful explanatory toy)

- **Step advance:** the active step's row draws in left-to-right (blueprint line
  wipe, 120ms); the actor chip lights.
- **Read feedback:** a thin cyan leader line snaps from the reading transaction
  to the table row it resolved against; the returned value pops (scale 1→1.08→1).
- **Write feedback:** a new version card slides onto the chain; the superseded
  version dims and gains an `xmax` stamp.
- **Anomaly flare:** coral pulse + rising ghost value + callout (see §4); tiny
  1-frame shake on the table (disabled under reduced-motion).
- **Commit / abort:** commit → amber glow + soft check; abort/serialization
  error → coral cross-hatch stamp ("ABORTED") slammed over the lane.
- **Wow moment:** replaying write skew at Serializable, the losing commit gets
  the ABORTED stamp and a "the database saved you" callout — celebratory, with a
  short particle burst along the dimension line.

**Synth SFX** (WebAudio, generated in code, no binary assets; lazy AudioContext
on first gesture; mute toggle persisted in `localStorage`; guarded for
test/no-audio environments):

- `step` — short low tick (sine, ~140ms) on each advance.
- `read` — soft blip (triangle) when a value resolves.
- `write` — a two-tone click (square) when a version is appended.
- `anomaly` — a detuned coral buzz (sawtooth + slight noise) when one fires.
- `commit` — a warm rising two-note (sine) on a clean commit.
- `abort` — a muted thunk (filtered noise) on serialization abort.

All volumes subtle and rate-throttled; global mute respected.

## 6. Brand assets

- **Favicon:** generated inline SVG (already in `index.html`) — a coral phantom
  glyph on a prussian rounded tile. Never the default globe.
- **Wordmark:** `Phantom` in ink + `Read` in cyan, led by a coral `◈` node glyph
  with a soft glow — designed, not just the name in the heading font.

The landing page (`site/`) uses these exact tokens and this exact direction:
product and page are one brand.
