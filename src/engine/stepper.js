// The stepper turns a scenario + a pair of isolation levels into a *trace*: one
// immutable world snapshot per step, plus a generic, engine-driven explanation
// of what each step did and why. The UI renders a frame; stepping forward/back
// is just moving a cursor across precomputed frames, so replaying a prefix can
// never drift from stepping to it (the "no drift" guarantee).
//
// Everything here is pure and DOM-free, so the same trace the browser renders is
// the trace the test suite asserts on.

import { Database, ISO, SerializationError, TXN } from './mvcc.js';

const ISO_LABEL = {
  [ISO.READ_COMMITTED]: 'Read Committed',
  [ISO.REPEATABLE_READ]: 'Repeatable Read',
  [ISO.SERIALIZABLE]: 'Serializable',
};

export function isoLabel(iso) {
  return ISO_LABEL[iso] || iso;
}

/** Format a stored value for display; undefined renders as the empty-set glyph. */
export function fmt(v) {
  return v === undefined ? '∅' : String(v);
}

const ACTORS = ['T1', 'T2'];

/**
 * Execute every step of `scenario` at the given per-lane `levels` and return the
 * full trace.
 *
 * @param {object} scenario a scenarios.js entry
 * @param {{T1:string,T2:string}} levels isolation level per transaction
 * @returns {{frames:Array, outcome:object, flare:(object|null), levels:object}}
 */
export function buildTrace(scenario, levels) {
  const db = new Database(scenario.seed);
  /** @type {Object<string, import('./mvcc.js').Transaction>} */
  const txObj = {};
  const lastScan = {}; // actor -> last scan count, for phantom detection
  const frames = [snapshot(db, txObj, { index: 0 })];

  scenario.steps.forEach((step, i) => {
    const t = txObj[step.actor];
    let result = '';
    let error = null;
    let explain = '';

    try {
      switch (step.op) {
        case 'begin': {
          const iso = levels[step.actor];
          txObj[step.actor] = db.begin(iso);
          result = isoLabel(iso);
          explain = explainBegin(step.actor, iso, txObj[step.actor]);
          break;
        }
        case 'read': {
          const info = t.resolve(step.key);
          const value = t.read(step.key);
          result = `= ${fmt(value)}`;
          explain = explainRead(step, value, info, t);
          break;
        }
        case 'scan': {
          const rows = t.scan();
          result = `→ ${rows.length} rows`;
          explain = explainScan(step, rows, lastScan[step.actor]);
          lastScan[step.actor] = rows.length;
          break;
        }
        case 'write': {
          t.write(step.key, step.value);
          result = `${step.key} := ${fmt(step.value)}`;
          explain = `${step.actor} appends a new uncommitted version of ${step.key} = ${fmt(step.value)}.`;
          break;
        }
        case 'remove': {
          t.remove(step.key);
          result = `del ${step.key}`;
          explain = `${step.actor} marks ${step.key} deleted (stamps xmax on the live version).`;
          break;
        }
        case 'commit': {
          t.commit();
          result = 'committed';
          explain = `${step.actor} commits. Its writes become visible to new snapshots.`;
          break;
        }
        case 'abort': {
          t.abort();
          result = 'aborted';
          explain = `${step.actor} rolls back — every version it created vanishes.`;
          break;
        }
        default:
          throw new Error(`unknown op ${step.op}`);
      }
    } catch (err) {
      error = err.name;
      result = `✗ ${err.name}`;
      explain = explainError(step, err, t);
    }

    frames.push(
      snapshot(db, txObj, {
        index: i + 1,
        step,
        result,
        error,
        explain,
        event: eventFor(step, error),
      }),
    );
  });

  const { outcome, flare } = analyze(scenario, frames);
  return { frames, outcome, flare, levels: { ...levels } };
}

/** Which SFX to play for a step's outcome. */
function eventFor(step, error) {
  if (error) return 'abort';
  if (step.op === 'commit') return 'commit';
  if (step.op === 'write' || step.op === 'remove') return 'write';
  if (step.op === 'read' || step.op === 'scan') return 'read';
  if (step.op === 'begin') return 'begin';
  return 'step';
}

// ---- world snapshot ---------------------------------------------------------

function snapshot(db, txObj, meta) {
  const txns = {};
  for (const actor of ACTORS) {
    txns[actor] = txView(db, txObj[actor], actor);
  }
  const table = db.keys().map((key) => ({
    key,
    committed: db.committedValue(key),
    versions: db.versionsOf(key),
  }));
  return { ...meta, txns, table };
}

function txView(db, t, actor) {
  if (!t) return { actor, started: false, status: 'idle', sees: {} };
  const active = t.status === TXN.ACTIVE;
  const sees = {};
  if (active) {
    for (const key of db.keys()) sees[key] = t.peek(key);
  }
  return {
    actor,
    started: true,
    id: t.id,
    iso: t.iso,
    status: t.status,
    snapshot: t.snapshot,
    reads: t.reads,
    writes: t.writes,
    sees,
  };
}

// ---- explanations (engine-driven) ------------------------------------------

function explainBegin(actor, iso, t) {
  if (iso === ISO.READ_COMMITTED) {
    return `${actor} begins at Read Committed — it re-reads the latest committed value on every statement.`;
  }
  const seen = t.snapshot.filter((id) => id !== 0);
  const horizon = seen.length ? `committed txns {${seen.join(', ')}}` : 'no concurrent commits yet';
  return `${actor} begins at ${isoLabel(iso)} — its snapshot freezes now (${horizon}).`;
}

function explainRead(step, value, info, t) {
  if (!info.version) {
    return `${t.actor ?? step.actor} reads ${step.key}: no version is visible (∅).`;
  }
  const v = info.version;
  let why;
  if (v.xmin === t.id) {
    why = 'its own uncommitted write';
  } else if (t.iso === ISO.READ_COMMITTED) {
    why = `the latest committed version (v${v.id}, by T#${v.xmin})`;
  } else {
    why = `v${v.id} (by T#${v.xmin}), which is inside its frozen snapshot`;
  }
  let tail = '';
  if (info.hiddenNewerCommitted) {
    tail = ' — a newer committed value exists but is hidden by the frozen snapshot (a repeatable read).';
  }
  return `${step.actor} reads ${step.key} = ${fmt(value)}: resolves ${why}${tail}`;
}

function explainScan(step, rows, prevCount) {
  const n = rows.length;
  if (prevCount === undefined) {
    return `${step.actor} scans and matches ${n} row${n === 1 ? '' : 's'}.`;
  }
  if (n > prevCount) {
    return `${step.actor} re-scans and now matches ${n} rows (was ${prevCount}) — a row appeared mid-transaction: a PHANTOM.`;
  }
  if (n < prevCount) {
    return `${step.actor} re-scans and matches ${n} rows (was ${prevCount}) — a row vanished mid-transaction.`;
  }
  return `${step.actor} re-scans: still ${n} rows — its frozen snapshot hid any concurrent insert.`;
}

function explainError(step, err, t) {
  if (err instanceof SerializationError) {
    const key = err.key;
    const wrote = t && t.writes.includes(key);
    const kind = wrote
      ? `it and a concurrent transaction both wrote "${key}" (first-updater-wins)`
      : `a concurrent transaction wrote "${key}" that it had read (a read-write antidependency — write skew)`;
    return `${step.actor}'s commit is refused: ${kind}. The database aborts it to stay serializable.`;
  }
  return `${step.actor}'s ${step.op} failed: ${err.message}`;
}

// ---- anomaly analysis (generic, keyed on the declared anomaly) --------------

/**
 * Decide, from engine-observable facts in the trace, whether the scenario's
 * declared anomaly fired or was prevented, and which frame/rows to flare.
 */
function analyze(scenario, frames) {
  const abortFrame = frames.find((f) => f.error === 'SerializationError');
  const anomaly = scenario.anomaly;

  // A serialization abort means the database stepped in — a prevention.
  if (abortFrame) {
    return {
      outcome: {
        status: 'prevented',
        anomaly,
        title: preventionTitle(anomaly),
        detail: 'The database refused a commit to keep the data consistent.',
      },
      flare: { index: abortFrame.index, keys: keysWritten(frames), prevented: true },
    };
  }

  if (anomaly === 'phantom-read') {
    const grew = findScanGrowth(frames);
    if (grew) {
      return {
        outcome: {
          status: 'fired',
          anomaly,
          title: 'PHANTOM READ',
          detail: 'A row appeared between two scans of the same transaction.',
        },
        flare: { index: grew.index, keys: grew.newKeys, prevented: false },
      };
    }
    return {
      outcome: {
        status: 'prevented',
        anomaly,
        title: 'NO PHANTOM',
        detail: 'The frozen snapshot hid the concurrent insert.',
      },
      flare: { index: lastOpIndex(frames, 'scan'), keys: [], prevented: true },
    };
  }

  if (anomaly === 'dirty-read') {
    // This engine never surfaces an uncommitted value, so a dirty read can never
    // fire — the read stays clean at every level.
    return {
      outcome: {
        status: 'prevented',
        anomaly,
        title: 'NO DIRTY READ',
        detail: 'The uncommitted value was never visible — reads only ever see committed data.',
      },
      flare: { index: lastOpIndex(frames, 'read'), keys: [], prevented: true },
    };
  }

  // lost-update / write-skew with no abort: the anomaly slipped through.
  return {
    outcome: {
      status: 'fired',
      anomaly,
      title: firedTitle(anomaly),
      detail: 'Both transactions committed and the invariant is now broken.',
    },
    flare: { index: lastOpIndex(frames, 'commit'), keys: keysWritten(frames), prevented: false },
  };
}

function preventionTitle(anomaly) {
  return anomaly === 'write-skew' ? 'WRITE SKEW PREVENTED' : 'ABORTED — UPDATE PROTECTED';
}
function firedTitle(anomaly) {
  return anomaly === 'write-skew' ? 'WRITE SKEW' : 'LOST UPDATE';
}

function findScanGrowth(frames) {
  const perActor = {};
  for (const f of frames) {
    if (!f.step || f.step.op !== 'scan') continue;
    const actor = f.step.actor;
    const view = f.txns[actor];
    const count = countMatches(f, view);
    if (perActor[actor] !== undefined && count > perActor[actor].count) {
      const before = new Set(perActor[actor].keys);
      const newKeys = f.table.map((r) => r.key).filter((k) => f.txns[actor].sees[k] !== undefined && !before.has(k));
      return { index: f.index, newKeys };
    }
    const keys = f.table.map((r) => r.key).filter((k) => view.sees[k] !== undefined);
    perActor[actor] = { count, keys };
  }
  return null;
}

function countMatches(frame, view) {
  return frame.table.filter((r) => view.sees[r.key] !== undefined).length;
}

function lastOpIndex(frames, op) {
  let idx = frames.length - 1;
  for (const f of frames) {
    if (f.step && f.step.op === op) idx = f.index;
  }
  return idx;
}

function keysWritten(frames) {
  const keys = new Set();
  const last = frames[frames.length - 1];
  for (const actor of ACTORS) {
    const v = last.txns[actor];
    if (v.started && v.writes) v.writes.forEach((k) => keys.add(k));
  }
  return [...keys];
}

// ---- Stepper: a cursor over a trace ----------------------------------------

/**
 * Stateful driver for the UI. Holds a precomputed trace and a cursor into it.
 * Changing a lane's isolation level rebuilds the trace and re-arms to the start.
 */
export class Stepper {
  constructor(scenario, levels) {
    this.scenario = scenario;
    this._levels = { ...levels };
    this._rebuild();
  }

  _rebuild() {
    const trace = buildTrace(this.scenario, this._levels);
    this.frames = trace.frames;
    this.outcome = trace.outcome;
    this.flare = trace.flare;
    this.cursor = 0;
  }

  get length() {
    return this.frames.length - 1; // number of executable steps
  }

  get levels() {
    return { ...this._levels };
  }

  /** The world after `cursor` steps. */
  get frame() {
    return this.frames[this.cursor];
  }

  get atStart() {
    return this.cursor === 0;
  }

  get atEnd() {
    return this.cursor === this.length;
  }

  stepForward() {
    if (!this.atEnd) this.cursor += 1;
    return this.frame;
  }

  stepBack() {
    if (!this.atStart) this.cursor -= 1;
    return this.frame;
  }

  seek(index) {
    this.cursor = Math.max(0, Math.min(this.length, index | 0));
    return this.frame;
  }

  reset() {
    this.cursor = 0;
    return this.frame;
  }

  /** Change one lane's level (or both) and re-arm from the start. */
  setLevel(actor, iso) {
    this._levels[actor] = iso;
    this._rebuild();
    return this.frame;
  }

  setLevels(levels) {
    this._levels = { ...this._levels, ...levels };
    this._rebuild();
    return this.frame;
  }

  /** True once the cursor has reached the frame the anomaly flares on. */
  get flaring() {
    return this.flare != null && this.cursor >= this.flare.index;
  }
}
