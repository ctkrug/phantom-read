# Backlog — Phantom Read

Epic/story breakdown for the build. Each story has verifiable acceptance
criteria a later run can confirm true or false. Build implements to the criteria;
QA attacks them. `[ ]` = not started.

Legend: **AC** = acceptance criteria.

---

## Epic A — The playable timeline (the wow moment first)

The core loop: step two transactions through a scenario on the real engine and
watch anomalies emerge and be prevented. The first story is the wow moment; it
must land before anything optional.

- [x] **A1 — Write-skew wow moment: RR corrupts, Serializable saves.**
  Load the write-skew scenario, step it to the end under Repeatable Read, and
  see both transactions commit into a broken invariant. Switch to Serializable,
  replay the same steps, and see the losing commit aborted.
  - AC1: At Repeatable Read the final state shows both `*-oncall` rows = 0 and
    both transactions committed (no error) — the invariant is visibly broken.
  - AC2: At Serializable the same script ends with one transaction showing a
    serialization abort and the invariant intact (one row still = 1).
  - AC3: Switching level and replaying requires no page reload and no code edit —
    only the isolation control changes.

- [x] **A2 — Two-lane timeline that steps the engine.**
  Render T1 and T2 as parallel lanes; a transport (step / step-back / play /
  reset) advances the scripted steps through the MVCC engine.
  - AC1: Each transport "step" executes exactly one scenario step on the engine
    and reveals its result (read value, scan count, commit/abort).
  - AC2: "Step back" and "reset" return to an earlier state consistent with
    re-running the prefix (no drift between stepping forward and replaying).
  - AC3: The currently active step is visually distinct from done/upcoming steps.

- [x] **A3 — Per-transaction isolation selectors.**
  Each lane has its own isolation-level control (Read Committed / Repeatable
  Read / Serializable); changing it re-arms the scenario from the start.
  - AC1: Selecting a level updates that transaction's behaviour on the next
    replay (verified against the engine, e.g. phantom appears at RC, not at RR).
  - AC2: The selector is a styled control (segmented pills), not a naked native
    `<select>`, with hover/focus-visible/active/disabled states.
  - AC3: The active level is announced to assistive tech (label + `aria`).

- [x] **A4 — Scenario picker for all three anomalies.**
  Switch between dirty-read, phantom-read, and write-skew scenarios.
  - AC1: All three scenarios from `scenarios.js` are selectable and load their
    seed + steps correctly.
  - AC2: Each scenario shows its blurb and the level that makes the anomaly fire
    vs. prevents it.
  - AC3: Switching scenarios resets the timeline cleanly (no leftover state).

- [x] **A5 — Design polish: timeline is the hero.**
  Execute `docs/DESIGN.md` for Epic A surfaces.
  - AC1: On a 1440px viewport the timeline occupies ≥60% of the viewport height
    and the page has no dead empty margins (grid background bleeds to edges).
  - AC2: At 390px the layout is single-column, fills the screen, and has no
    horizontal scroll or overlapping elements.
  - AC3: Fonts (Space Grotesk + IBM Plex Mono) and the token palette from
    DESIGN.md are applied; a squint test shows clear hierarchy.

---

## Epic B — Seeing the MVCC machinery

Make the *mechanism* visible: version chains, snapshots, and the anomaly flare
that distinguishes "modelled" from "illustrated."

- [x] **B1 — Shared table with live version chain.**
  Render the shared table's rows and, on demand, each row's version chain with
  `xmin`/`xmax` stamps.
  - AC1: After a write, the row shows a new version and the superseded version
    carries an `xmax` stamp matching the writing transaction.
  - AC2: An aborted transaction's versions disappear from the chain on abort.
  - AC3: The value each transaction currently *sees* is labelled per lane and
    matches `engine.read` for that transaction's snapshot.

- [x] **B2 — Anomaly flare + prevention moment.**
  When an anomaly fires, flare the offending row and name it; when a higher level
  prevents it, show the prevention as its own designed state.
  - AC1: A fired anomaly produces a coral flare and a callout naming the anomaly
    (dirty/phantom/write-skew) on the correct row/step.
  - AC2: The same scenario at a preventing level shows no flare and a "prevented"
    annotation instead.
  - AC3: The flare respects `prefers-reduced-motion` (no shake/particles; the
    callout still appears).

- [x] **B3 — Snapshot inspector.**
  Show what each transaction's snapshot includes (which committed txns are
  visible), so the "why" of a read is inspectable.
  - AC1: For a selected transaction, the UI lists the committed transactions its
    snapshot can see, consistent with the engine's `snapshot` set.
  - AC2: Under Read Committed the visible set updates as other txns commit; under
    Repeatable Read / Serializable it stays frozen at begin.

- [x] **B4 — Plain-language explainer per step.**
  Each executed step gets a one-line explanation of what the engine did and why
  the result is what it is.
  - AC1: A read step explains which version was resolved and why (e.g. "sees
    committed v1; T1's v2 is invisible — uncommitted").
  - AC2: Explanations are driven by engine state, not hard-coded per scenario.

- [x] **B5 — Design polish: version chain + inspector.**
  - AC1: Version cards, stamps, and the inspector match DESIGN.md tokens and
    depth treatment (no flat single-hue panels).
  - AC2: All interactive elements have hover/focus-visible/active states.

---

## Epic C — Feel, sound, and the landing page

Craft-complete the experience and give it a front door.

- [x] **C1 — Synth SFX with persisted mute.**
  Implement the WebAudio SFX from DESIGN.md §5 (step/read/write/anomaly/
  commit/abort) with a mute toggle.
  - AC1: Each event triggers its sound; AudioContext is created lazily on first
    user gesture and guarded so tests/no-audio environments don't throw.
  - AC2: The mute state persists across reloads via `localStorage` and the
    toggle reflects it on load.

- [x] **C2 — Win/celebration for the wow moment.**
  The Serializable-saves outcome is a designed moment, not a silent state change.
  - AC1: Reaching the Serializable abort in write skew shows an "ABORTED / the
    database saved you" callout with a short celebratory flourish.
  - AC2: A clear next action (replay / try another scenario) is offered.
  - AC3: Reduced-motion drops particles but keeps the callout and CTA.

- [x] **C3 — Keyboard + touch controls.**
  The timeline is drivable without a mouse and on a phone.
  - AC1: Left/right (or space) step the transport; focus order is sane; icon-only
    buttons have `aria-label`.
  - AC2: Touch targets are ≥44px; stepping works via tap on mobile widths.

- [x] **C4 — Landing page sharing the brand.**
  A `site/` (or root) landing section that explains the tool and links into a
  scenario, using the same tokens/direction as the app.
  - AC1: The landing page uses DESIGN.md tokens and reads as the same brand as
    the app (shared wordmark, palette, fonts).
  - AC2: A CTA deep-links into the wow-moment scenario.
  - AC3: Assets use relative paths only and the site builds into one directory,
    hostable under any base path.

- [ ] **C5 — Design self-review + a11y pass (QA gate).**
  Run the DESIGN.md D3 checklist before ship.
  - AC1: Verified composed/filled at 390/768/1440 with no overlap or dead space.
  - AC2: Contrast ≥4.5:1 for text; focus visible on every control; a favicon is
    present (not the default globe).
  - AC3: Full write-skew scenario played end to end: stepping feels instant,
    sound fires and mute persists, the wow moment celebrates.

---

**Story count: 14** (A1–A5, B1–B5, C1–C5).
