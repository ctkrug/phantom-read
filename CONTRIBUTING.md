# Contributing

Thanks for taking a look at Phantom Read.

## Setup

```bash
npm install     # dev tooling only — the app has zero runtime deps
npm test        # run the MVCC engine spec (node:test)
npm run lint    # syntax-check the engine sources
npm start       # serve the site at http://localhost:5173
```

Node 20 is the supported version (see `.nvmrc`).

## Ground rules

- **The engine is the source of truth.** Every behaviour the UI shows must be
  produced by `src/engine/mvcc.js`, never hard-coded per scenario. If you're
  adding an anomaly, add it as *data* in `src/engine/scenarios.js` and back it
  with a test that asserts it both fires and is prevented at the right level.
- **Keep it pure and dependency-free.** The engine must run unchanged in the
  browser and under `node:test`. No DOM assumptions, no runtime dependencies.
- **Follow `docs/DESIGN.md`.** UI work uses the blueprint tokens and direction;
  changing the direction is a deliberate, explained commit.
- **Tests stay green.** CI runs lint + the suite on every push and PR.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`,
`ci:`) with an imperative subject and a short body explaining the *why* for
non-trivial changes.
