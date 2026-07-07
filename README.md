# Phantom Read

[![CI](https://github.com/ctkrug/phantom-read/actions/workflows/ci.yml/badge.svg)](https://github.com/ctkrug/phantom-read/actions/workflows/ci.yml)

**An interactive sandbox for database isolation levels.** Run two transactions
side by side, pick each one's isolation level, and watch dirty reads, phantom
reads, and write skew happen — or *not* happen — one step at a time.

Most explanations of isolation levels are a table in a textbook. Phantom Read is
a **live MVCC engine** you can poke: it keeps a real version chain per row,
takes a real snapshot when a transaction starts, and decides visibility with the
same rules a database does. When an anomaly fires, it fires because the semantics
actually produced it — not because a diagram said it would.

## Why it's interesting

Isolation levels are usually taught as trivia ("Repeatable Read prevents X but
not Y"). The *why* lives in snapshot visibility and version chains — internals
you never see. Phantom Read makes those internals the whole UI: every read
resolves against a snapshot you can inspect, and the anomaly classes emerge from
the model instead of being hard-coded animations.

## The anomalies

| Anomaly | What happens | Blocked by |
|---|---|---|
| **Dirty read** | T2 reads a row T1 wrote but hasn't committed | Read Committed and up (never happens here) |
| **Phantom read** | T2 re-runs a range query and a new row appears | Repeatable Read (frozen snapshot) |
| **Lost update** | Two txns read a counter, each writes back, one write is silently overwritten | Repeatable Read (first-updater-wins) |
| **Write skew** | Two txns read an overlapping set, each writes, both commit into an invalid state | Serializable only |

## Isolation levels modelled

- **Read Committed** — each statement sees the latest committed data; no dirty reads.
- **Repeatable Read** — a snapshot taken at transaction start; stable reads, but
  write skew still slips through.
- **Serializable** — snapshot isolation plus conflict detection; the losing
  transaction aborts.

## Stack

- **Vanilla JavaScript (ES modules)** — no framework, no build step for the app.
- **A hand-written MVCC engine** (`src/engine/`) — versioned rows, per-transaction
  snapshots, visibility resolution, conflict detection. Pure and framework-free,
  so it runs identically in the browser and under the Node test runner.
- **Node's built-in test runner** (`node:test`) for the engine spec.
- **A static, self-contained site** — hostable under any base path, no server.

## Develop

```bash
npm install     # dev-only tooling; the app itself has zero runtime deps
npm test        # run the MVCC engine spec
npm start       # serve the site locally at http://localhost:5173
```

Then open `index.html` (or the served URL) and step two transactions through a
scenario.

## How to use

1. **Pick a scenario** — dirty read, phantom read, lost update, or write skew.
2. **Set each transaction's isolation level** with the RC/RR/SER pills. T1 is
   cyan, T2 is coral.
3. **Step** through with the transport (or the keyboard: `←`/`→`/`space` to step,
   `P` to play, `R` to reset, `M` to mute). Each step runs exactly one action on
   the engine and updates the shared table, the version chains, and the snapshot
   inspector.
4. **Watch the flare.** When an anomaly fires, the offending row flares coral and
   a callout names it. Raise the level and replay — the same script now stays
   calm, or the database aborts the losing commit and celebrates.

The write-skew scenario is the one to try first: run it at Repeatable Read (both
doctors go off call — the invariant breaks silently), then raise both lanes to
Serializable and replay. Same clicks; the database now saves you.

Everything is driven by the real engine in `src/engine/` — the anomalies emerge
from snapshot visibility and conflict detection, not scripted animation.

## Status

Core complete and playable — all four scenarios, per-lane isolation, the live
version chains, synth SFX, and the landing page. See [`docs/VISION.md`](docs/VISION.md)
for the plan, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the code map, and
[`docs/BACKLOG.md`](docs/BACKLOG.md) for the epic/story breakdown.

## License

MIT © Charlie Krug — see [`LICENSE`](LICENSE).
