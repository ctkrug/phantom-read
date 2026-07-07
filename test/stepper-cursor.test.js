import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISO } from '../src/engine/mvcc.js';
import { scenarioById } from '../src/engine/scenarios.js';
import { buildTrace, Stepper } from '../src/engine/stepper.js';

const both = (iso) => ({ T1: iso, T2: iso });

// A comparable projection of a frame's observable world: committed row values
// plus each transaction's status. If stepping back drifted from replaying a
// prefix, these would diverge.
function project(frame) {
  return {
    table: frame.table.map((r) => [r.key, r.committed]),
    T1: frame.txns.T1.status,
    T2: frame.txns.T2.status,
  };
}

test('stepping forward then back returns to an identical frame (no drift)', () => {
  const s = scenarioById('lost-update');
  const st = new Stepper(s, both(ISO.READ_COMMITTED));

  const seen = [];
  while (!st.atEnd) seen.push(project(st.frame)), st.stepForward();
  seen.push(project(st.frame));

  // Walk all the way back; every frame must match what we saw on the way up.
  for (let i = st.length; i >= 0; i--) {
    assert.deepEqual(project(st.frame), seen[i], `frame ${i} matches on the way down`);
    if (!st.atStart) st.stepBack();
  }
});

test('the world after k steps equals replaying only the first k steps', () => {
  const s = scenarioById('write-skew');
  const full = buildTrace(s, both(ISO.REPEATABLE_READ));

  for (let k = 0; k <= s.steps.length; k++) {
    const prefix = { ...s, steps: s.steps.slice(0, k) };
    const replayed = buildTrace(prefix, both(ISO.REPEATABLE_READ));
    assert.deepEqual(
      project(full.frames[k]),
      project(replayed.frames.at(-1)),
      `prefix of length ${k} reconstructs frame ${k}`,
    );
  }
});

test('seek clamps to the valid range', () => {
  const st = new Stepper(scenarioById('phantom-read'), both(ISO.READ_COMMITTED));
  st.seek(999);
  assert.equal(st.cursor, st.length, 'over-seek clamps to the end');
  st.seek(-5);
  assert.equal(st.cursor, 0, 'under-seek clamps to the start');
});

test('changing a lane level re-arms from the start and changes the outcome', () => {
  const st = new Stepper(scenarioById('phantom-read'), both(ISO.READ_COMMITTED));
  st.seek(st.length);
  assert.equal(st.outcome.status, 'fired', 'phantom fires under RC');

  st.setLevels(both(ISO.REPEATABLE_READ));
  assert.equal(st.cursor, 0, 're-armed to the start after a level change');
  assert.equal(st.outcome.status, 'prevented', 'no phantom under RR');
});

test('per-lane levels are independent', () => {
  const st = new Stepper(scenarioById('write-skew'), both(ISO.REPEATABLE_READ));
  assert.equal(st.levels.T1, ISO.REPEATABLE_READ);
  st.setLevel('T2', ISO.SERIALIZABLE);
  assert.equal(st.levels.T1, ISO.REPEATABLE_READ, 'T1 untouched');
  assert.equal(st.levels.T2, ISO.SERIALIZABLE, 'T2 updated');
});

test('flaring turns on only once the cursor reaches the flare frame', () => {
  const st = new Stepper(scenarioById('phantom-read'), both(ISO.READ_COMMITTED));
  assert.equal(st.flaring, false, 'no flare at the start');
  st.seek(st.flare.index - 1);
  assert.equal(st.flaring, false, 'not yet');
  st.seek(st.flare.index);
  assert.equal(st.flaring, true, 'flares on arrival');
});
