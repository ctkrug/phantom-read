import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISO } from '../src/engine/mvcc.js';
import { SCENARIOS, scenarioById } from '../src/engine/scenarios.js';
import { buildTrace, Stepper, fmt, isoLabel } from '../src/engine/stepper.js';

const both = (iso) => ({ T1: iso, T2: iso });

test('a trace has one frame per step plus the initial frame', () => {
  for (const s of SCENARIOS) {
    const { frames } = buildTrace(s, both(s.defaultIso));
    assert.equal(frames.length, s.steps.length + 1, `${s.id} frame count`);
    assert.equal(frames[0].index, 0, 'first frame is the pre-run state');
    assert.equal(frames[0].step, undefined, 'the initial frame ran no step');
  }
});

test('each scenario fires its anomaly at the permissive level', () => {
  const expect = {
    'dirty-read': 'prevented', // this engine can never surface a dirty read
    'phantom-read': 'fired',
    'lost-update': 'fired',
    'write-skew': 'fired',
  };
  for (const s of SCENARIOS) {
    const { outcome } = buildTrace(s, both(s.defaultIso));
    assert.equal(outcome.status, expect[s.id], `${s.id} at default level`);
    assert.equal(outcome.anomaly, s.anomaly);
  }
});

test('each anomaly is prevented at or above its preventing level', () => {
  for (const s of SCENARIOS) {
    const { outcome } = buildTrace(s, both(s.preventedAtOrAbove));
    assert.equal(outcome.status, 'prevented', `${s.id} at ${s.preventedAtOrAbove}`);
  }
});

test('the write-skew wow moment: RR corrupts, Serializable saves', () => {
  const s = scenarioById('write-skew');

  const rr = buildTrace(s, both(ISO.REPEATABLE_READ));
  assert.equal(rr.outcome.status, 'fired', 'both doctors go off call under RR');
  const finalRR = rr.frames.at(-1);
  assert.equal(finalRR.txns.T1.status, 'committed');
  assert.equal(finalRR.txns.T2.status, 'committed');
  assert.equal(finalRR.table.find((r) => r.key === 'alice-oncall').committed, 0);
  assert.equal(finalRR.table.find((r) => r.key === 'bob-oncall').committed, 0);

  const ser = buildTrace(s, both(ISO.SERIALIZABLE));
  assert.equal(ser.outcome.status, 'prevented', 'Serializable aborts the loser');
  const aborted = ser.frames.some((f) => f.error === 'SerializationError');
  assert.ok(aborted, 'a serialization error is raised');
  const finalSer = ser.frames.at(-1);
  const stillOnCall = ['alice-oncall', 'bob-oncall'].some(
    (k) => finalSer.table.find((r) => r.key === k).committed === 1,
  );
  assert.ok(stillOnCall, 'the invariant survives — someone is still on call');
});

test('read explanations name the resolved version and the frozen-snapshot reason', () => {
  const s = scenarioById('phantom-read');
  // phantom scan growth is explained as a PHANTOM
  const rc = buildTrace(s, both(ISO.READ_COMMITTED));
  const grewFrame = rc.frames.find(
    (f) => f.step && f.step.op === 'scan' && f.explain.includes('PHANTOM'),
  );
  assert.ok(grewFrame, 'a re-scan is explained as a phantom under RC');

  // Under RR the re-scan explains the stable snapshot instead.
  const rr = buildTrace(s, both(ISO.REPEATABLE_READ));
  const stableFrame = rr.frames.filter((f) => f.step && f.step.op === 'scan').at(-1);
  assert.match(stableFrame.explain, /frozen snapshot/i);
});

test('a lane sees its own uncommitted write but never a peer\'s', () => {
  const s = scenarioById('dirty-read');
  const { frames } = buildTrace(s, both(ISO.READ_COMMITTED));
  // Step 3 is T1's uncommitted write of 999; step 4 is T2's read.
  const afterWrite = frames[3];
  assert.equal(afterWrite.txns.T1.sees.balance, 999, 'writer sees its own value');
  assert.equal(afterWrite.txns.T2.sees.balance, 100, 'peer still sees committed value');
});

test('flare targets the phantom row when it fires, and the abort step when prevented', () => {
  const rc = buildTrace(scenarioById('phantom-read'), both(ISO.READ_COMMITTED));
  assert.equal(rc.flare.prevented, false);
  assert.deepEqual(rc.flare.keys, ['order-3']);

  const ser = buildTrace(scenarioById('write-skew'), both(ISO.SERIALIZABLE));
  assert.equal(ser.flare.prevented, true);
  const abortIdx = ser.frames.find((f) => f.error === 'SerializationError').index;
  assert.equal(ser.flare.index, abortIdx);
});

test('fmt and isoLabel format for display', () => {
  assert.equal(fmt(undefined), '∅');
  assert.equal(fmt(0), '0');
  assert.equal(fmt(42), '42');
  assert.equal(isoLabel(ISO.SERIALIZABLE), 'Serializable');
  assert.equal(isoLabel('unknown'), 'unknown');
});
