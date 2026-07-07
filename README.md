# Phantom Read

**▶ Live demo — [apps.charliekrug.com/phantom-read](https://apps.charliekrug.com/phantom-read/)**

[![CI](https://github.com/ctkrug/phantom-read/actions/workflows/ci.yml/badge.svg)](https://github.com/ctkrug/phantom-read/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**See isolation levels break, step by step.** Run two transactions side by side,
pick each one's isolation level, and watch dirty reads, phantom reads, lost
updates, and write skew happen (or not happen) one action at a time on a real
MVCC engine.

Most explanations of isolation levels are a grid in a textbook: "Repeatable Read
prevents X but allows Y." Phantom Read is a live multi-version concurrency
control engine you can poke. It keeps a real version chain per row, takes a real
snapshot when a transaction begins, and decides visibility with the same rules a
database uses. When an anomaly fires, it fires because the semantics produced it,
not because a diagram said it would.

Built for backend and full-stack developers who half-remember isolation levels
from a systems class and want to actually see why they matter.

## What a step looks like

Stepping the write-skew scenario at Repeatable Read, watching the shared table:

```
alice-oncall   value 1        bob-oncall   value 0
  v1  xmin 0 · xmax ∞           v1  xmin 0 · xmax 2
                                v2  xmin 2 · xmax ∞   (value 0)

T1 (Alice)  READ bob-oncall = 1     "Bob is still on call, safe to go off"
T2 (Bob)    COMMIT               →  WRITE SKEW: both read the other, both
                                    committed, and now nobody is on call.
```

Raise both transactions to Serializable and replay the exact same script: the
database detects the read-write conflict at commit time and aborts the losing
transaction instead.

## The anomalies

| Anomaly | What happens | Prevented by |
|---|---|---|
| **Dirty read** | T2 reads a row T1 wrote but has not committed | Read Committed and up (never happens here) |
| **Phantom read** | T1 re-runs a range scan and a new row appears | Repeatable Read (frozen snapshot) |
| **Lost update** | Two txns read a counter, each writes back, one write is silently overwritten | Repeatable Read (first-updater-wins) |
| **Write skew** | Two txns read an overlapping set, each writes, both commit into an invalid state | Serializable only |

## Isolation levels modelled

- **Read Committed:** each statement sees the latest committed data, so no dirty reads.
- **Repeatable Read:** a snapshot taken at transaction start gives stable reads,
  but write skew still slips through.
- **Serializable:** snapshot isolation plus conflict detection, so the losing
  transaction aborts.

## How to use it

1. **Pick a scenario:** dirty read, phantom read, lost update, or write skew.
2. **Set each transaction's isolation level** with the RC/RR/SER pills. T1 is
   cyan, T2 is coral.
3. **Step** through with the transport, or the keyboard: `←`/`→`/`space` to step,
   `Home`/`End` to jump to the start or the anomaly, `P` to play, `R` to reset,
   `M` to mute. Each step runs exactly one action on the engine and updates the
   shared table, the version chains, and the snapshot inspector.
4. **Watch the flare.** When an anomaly fires, the offending row flares coral and
   a callout names it. Raise the level and replay: the same script now stays calm,
   or the database aborts the losing commit and celebrates.

Try write skew first. Run it at Repeatable Read (both doctors go off call and the
invariant breaks silently), then raise both lanes to Serializable and replay.
Same clicks, and the database now saves you.

## How it works

The whole point is that nothing is faked. The engine (`src/engine/mvcc.js`) keeps
a version chain per row, each version stamped with the transaction that created
it (`xmin`) and the one that superseded or deleted it (`xmax`). A read walks the
chain and returns the first version visible under the reader's snapshot; isolation
levels differ only in how that snapshot is chosen. Serializable adds a commit-time
check for read-write antidependencies, which is exactly what catches write skew.

The engine is pure and dependency-free, so the same code runs in the browser UI
and under the Node test runner. A scenario is data, not code: each is a scripted
pair of transactions in `src/engine/scenarios.js`, and the engine executes it into
an immutable trace the UI just renders a cursor over. That is why replaying a
prefix can never drift from stepping to it.

## Develop

```bash
npm install     # dev tooling only; the app itself has zero runtime deps
npm test        # run the MVCC engine spec (node:test)
npm run lint    # syntax-check the engine sources
npm start       # serve locally at http://localhost:5173
npm run build   # assemble the deployable static output into site/
```

Then open the served URL and step two transactions through a scenario.

## Project layout

```
src/engine/   the MVCC engine: versions, snapshots, visibility, conflict checks
src/ui/       the controller, styles, and synthesized sound (no binary assets)
test/         the engine spec plus property-based fuzzing of its invariants
docs/         design direction, architecture map, and the engine deep-dive
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the code map,
[`docs/ENGINE.md`](docs/ENGINE.md) for the visibility rules, and
[`docs/DESIGN.md`](docs/DESIGN.md) for the visual direction.

## License

MIT © Charlie Krug. See [`LICENSE`](LICENSE).

More of Charlie's projects → [apps.charliekrug.com](https://apps.charliekrug.com)
