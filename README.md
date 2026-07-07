# Phantom Read

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

## The three anomalies

| Anomaly | What happens | Blocked by |
|---|---|---|
| **Dirty read** | T2 reads a row T1 wrote but hasn't committed | Read Committed and up |
| **Phantom read** | T2 re-runs a range query and a new row appears | Repeatable Read (snapshot) |
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

## Status

Early scaffold — see [`docs/VISION.md`](docs/VISION.md) for the plan and
[`docs/BACKLOG.md`](docs/BACKLOG.md) for the epic/story breakdown.

## License

MIT © Charlie Krug — see [`LICENSE`](LICENSE).
