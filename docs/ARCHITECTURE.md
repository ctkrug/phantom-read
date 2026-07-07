# Architecture — Phantom Read

A concise map of the codebase so a fresh session can orient fast. The project is
a static, zero-dependency web app: a pure MVCC engine driving an interactive
two-transaction timeline.

## Data flow

```
scenarios.js  ──(seed + scripted steps)──▶  stepper.js  ──(frames)──▶  app.js  ──▶  DOM
   (data)                                   buildTrace()               controller
                     mvcc.js  ◀──executes steps──┘
                   (the engine)                          sound.js ──▶ WebAudio
```

1. **`scenarios.js`** declares each anomaly as *data*: a seed and a scripted list
   of steps (`begin`/`read`/`scan`/`write`/`remove`/`commit`/`abort`), plus the
   level that makes it fire and the level that prevents it.
2. **`stepper.js`** replays a scenario through a fresh `Database` at the chosen
   per-lane isolation levels and captures one immutable **frame** per step — the
   whole world after that step: each transaction's status/snapshot/reads/writes
   and what it sees, plus the shared table's committed value and version chains.
   Each frame also carries a generic, engine-derived **explanation** and an SFX
   **event**. A small analyzer maps engine-observable facts to a fired/prevented
   **outcome** and the row to flare.
3. **`app.js`** is the controller: it owns a `Stepper` (a cursor over the frames)
   and re-renders the three regions from the current frame. Nothing here
   re-implements visibility or anomaly logic — all truth comes from the engine.

## Key files

| File | Responsibility |
|---|---|
| `src/engine/mvcc.js` | The MVCC engine: version chains, snapshots, visibility, commit-time conflict checks. Pure, DOM-free. Also read-only introspection (`committedValue`, `versionsOf`, `resolve`, `peek`, `keys`). |
| `src/engine/scenarios.js` | The four scenarios as data (dirty read, phantom read, lost update, write skew). |
| `src/engine/stepper.js` | `buildTrace()` → frames + outcome + flare; `Stepper` cursor (forward/back/seek/reset/setLevel). Generic explanations and anomaly analysis. |
| `src/ui/app.js` | Controller + renderers (rail, timeline stage, panel, callout) and a tiny `el()` DOM helper. Keyboard driving and hash deep-linking. |
| `src/ui/sound.js` | `SoundBoard`: WebAudio-synthesised SFX, lazy context, throttle, persisted mute. Injectable deps for headless tests. |
| `src/ui/styles.css` | The blueprint direction (see `docs/DESIGN.md`) for both app and landing band. |
| `index.html` | Shell: masthead + mute, landing band, three app regions, callout, favicon. |
| `scripts/serve.js` | Zero-dependency static dev server (`npm start`). |

## The three UI regions

- **Rail** (`#rail`) — scenario pills, fire/safe hint, per-lane RC/RR/SER
  segmented selectors, transport (reset/back/play/step).
- **Stage** (`#stage`, the hero) — two swim lanes stepping the engine, and the
  shared table with live version chains and the anomaly flare.
- **Panel** (`#panel`) — the per-step explanation and the snapshot inspector.

The **callout** (`#callout`) overlays the anomaly/prevention moment with a CTA.

## Engine invariants (don't regress)

- Reads never surface an uncommitted value (no dirty reads, ever).
- RR/SER freeze the snapshot at `begin`; RC re-reads per statement.
- Commit checks: first-updater-wins (RR+SER) catches lost update; read-write
  antidependency (SER only) catches write skew. See `docs/ENGINE.md`.

## Run & test

- **Test:** `npm test` (or `node --test`) — pure logic + a headless DOM smoke
  test, no browser or network.
- **Lint:** `npm run lint` (syntax check of the engine modules).
- **Serve:** `npm start` → http://localhost:5173. Static and base-path-relative,
  so it also hosts unchanged under a subpath.
