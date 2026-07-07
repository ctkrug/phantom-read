import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database, ISO, SerializationError } from '../src/engine/mvcc.js';
import { SCENARIOS, scenarioById } from '../src/engine/scenarios.js';

// Drive a scenario's scripted steps through the engine at a chosen isolation
// level, returning a trace of every read/scan result plus any commit error.
function run(scenario, iso) {
  const db = new Database(scenario.seed);
  const txns = {};
  const reads = [];
  let error = null;
  try {
    for (const step of scenario.steps) {
      const t = txns[step.actor];
      switch (step.op) {
        case 'begin':
          txns[step.actor] = db.begin(iso);
          break;
        case 'read':
          reads.push({ actor: step.actor, key: step.key, value: t.read(step.key) });
          break;
        case 'scan':
          reads.push({ actor: step.actor, op: 'scan', count: t.scan().length });
          break;
        case 'write':
          t.write(step.key, step.value);
          break;
        case 'remove':
          t.remove(step.key);
          break;
        case 'commit':
          t.commit();
          break;
        case 'abort':
          t.abort();
          break;
        default:
          throw new Error(`unknown op ${step.op}`);
      }
    }
  } catch (e) {
    error = e;
  }
  return { reads, error, db };
}

test('every scenario has a stable shape', () => {
  for (const s of SCENARIOS) {
    assert.ok(s.id && s.title && s.anomaly, `${s.id} metadata`);
    assert.ok(Array.isArray(s.steps) && s.steps.length > 0, `${s.id} steps`);
    assert.equal(scenarioById(s.id), s);
  }
});

test('dirty-read scenario never leaks the uncommitted value', () => {
  const s = scenarioById('dirty-read');
  const { reads } = run(s, ISO.READ_COMMITTED);
  assert.equal(reads[0].value, 100, 'first read is the committed value');
  assert.equal(reads[1].value, 999, 'second read after commit sees new value');
});

test('phantom-read appears under RC and is prevented under RR', () => {
  const s = scenarioById('phantom-read');
  const rc = run(s, ISO.READ_COMMITTED).reads.filter((r) => r.op === 'scan');
  assert.deepEqual(
    rc.map((r) => r.count),
    [2, 3],
    'read committed sees the phantom on re-scan',
  );
  const rr = run(s, ISO.REPEATABLE_READ).reads.filter((r) => r.op === 'scan');
  assert.deepEqual(
    rr.map((r) => r.count),
    [2, 2],
    'repeatable read holds a stable snapshot',
  );
});

test('lost-update slips through RC but the second writer aborts under RR', () => {
  const s = scenarioById('lost-update');
  // Read Committed: both commit; the final counter reflects only T2's write —
  // T1's +10 is silently overwritten (the lost update).
  const rc = run(s, ISO.READ_COMMITTED);
  assert.equal(rc.error, null, 'read committed lets both commit — update lost');
  assert.equal(rc.db.committedValue('counter'), 120, "T1's update is lost; only T2's survives");
  // Repeatable Read: first-updater-wins aborts T2's overwrite, so T1's value stands.
  const rr = run(s, ISO.REPEATABLE_READ);
  assert.ok(rr.error instanceof SerializationError, 'repeatable read makes the loser abort');
  assert.equal(rr.db.committedValue('counter'), 110, "T1's update is preserved after the abort");
});

test('write-skew commits under RR but the loser aborts under Serializable', () => {
  const s = scenarioById('write-skew');
  // Repeatable Read: both doctors go off call — the invariant (someone on call)
  // is broken.
  const rr = run(s, ISO.REPEATABLE_READ);
  assert.equal(rr.error, null, 'write skew slips through RR');
  const onCallRR = rr.db.committedValue('alice-oncall') + rr.db.committedValue('bob-oncall');
  assert.equal(onCallRR, 0, 'nobody is on call — the invariant is violated');
  // Serializable: the antidependency check aborts the loser, so one stays on call.
  const ser = run(s, ISO.SERIALIZABLE);
  assert.ok(ser.error instanceof SerializationError, 'serializable catches it');
  const onCallSer = ser.db.committedValue('alice-oncall') + ser.db.committedValue('bob-oncall');
  assert.equal(onCallSer, 1, 'exactly one doctor remains on call — the invariant holds');
});
