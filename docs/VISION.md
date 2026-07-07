# Vision — Phantom Read

## The problem

Database isolation levels are one of the most consequential and least understood
topics in backend engineering. Almost everyone has seen the canonical table —
"Read Committed prevents dirty reads, Repeatable Read prevents non-repeatable
reads, Serializable prevents everything" — and almost no one can explain *why*.

The why lives in machinery students never get to see: **multi-version rows,
per-transaction snapshots, and visibility rules.** Textbook diagrams animate the
anomalies as if they were scripted cartoons. That teaches the vocabulary but not
the mechanism, so the knowledge evaporates. The moment a real bug shows up —
a lost update, a double-booking, a balance that briefly goes negative — the
engineer is back to guessing.

## The core idea

Phantom Read replaces the diagram with a **working MVCC engine you can drive**.
Two transactions run side by side on a shared table. You choose each one's
isolation level and step them through, action by action. Every read resolves
against a real snapshot; every write appends a real version to a real chain.

When a dirty read, phantom read, or write skew occurs, it occurs because the
**semantics produced it** — not because an animation was hard-coded to play.
Raise the isolation level and the anomaly disappears on its own, because the
snapshot rules changed. The mechanism *is* the UI.

That is the difference between illustrating an anomaly and modelling it, and it
is what makes the project a credible demonstration of database-internals
understanding rather than a pretty explainer.

## Who it's for

- **Engineers** who've hit a concurrency bug and want to build real intuition.
- **Students** learning transactions who need to *see* snapshot isolation, not
  memorise a table.
- **Interviewers / interviewees** who want a shared, concrete reference for
  "explain write skew."

## The wow moment

**Step the write-skew scenario to its end under Repeatable Read and watch both
transactions commit into a broken invariant — both doctors go off call — then
flip the level to Serializable, replay, and watch the second commit get aborted
with a serialization error.** Same script, same clicks; the only thing that
changed is the snapshot rule, and the outcome flips from "silent data
corruption" to "the database saved you." That contrast, produced by the model
rather than narrated at you, is the whole point.

## Key design decisions

- **A real engine, not scripted animations.** `src/engine/mvcc.js` keeps version
  chains with `xmin`/`xmax` stamps and resolves reads against per-transaction
  snapshots. Isolation levels change only how the snapshot is chosen — exactly
  as in a real MVCC database. Anomalies are emergent, not authored.
- **Pure and portable.** The engine has zero dependencies and no DOM
  assumptions, so the identical code runs in the browser and under `node:test`.
  Every claim the UI makes is backed by an executable test.
- **Serializable = snapshot isolation + conflict detection.** First-updater-wins
  for write-write races, plus a read-write antidependency check that catches
  write skew. Conservative, like real SI implementations — and honest about it.
- **Scenarios are data.** Each anomaly is a scripted list of steps
  (`src/engine/scenarios.js`) with the level that makes it fire and the level
  that prevents it. Adding a new anomaly is adding data, not code.
- **Static and self-contained.** No server, no build step, relative asset paths
  only — hostable under any base path (e.g. a subdomain subpath).
- **Design as a first-class concern.** An architectural-blueprint art direction
  (see `docs/DESIGN.md`) treats the timeline and version chains as the hero, not
  a widget in a corner.

## What "v1 done" looks like

- All three anomalies — dirty read, phantom read, write skew — are playable
  step by step, with a working isolation-level selector per transaction.
- The **wow moment** lands: replaying write skew at Serializable visibly aborts
  the loser where Repeatable Read silently corrupted.
- The timeline is the hero: two transaction lanes, the shared table with its
  live version chain, and a clear anomaly flare when one fires.
- The build is craft-complete against `docs/DESIGN.md`: filled layout at phone
  and desktop widths, styled controls with interaction states, synth SFX with a
  persisted mute toggle, and a designed win/anomaly moment.
- The engine spec is green in CI and covers every anomaly's fire-and-prevent
  behaviour.
- A landing page shares the app's brand and links straight into a scenario.
