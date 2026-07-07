// Trace-builder coverage for the operations and explanation branches the four
// curated scenarios don't exercise: remove, abort, a shrinking scan, a
// non-serialization runtime error, and an unknown op. Scenarios are plain data,
// so we can hand-craft minimal ones to drive each path deterministically.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISO } from '../src/engine/mvcc.js';
import { buildTrace, Stepper } from '../src/engine/stepper.js';

const both = (iso) => ({ T1: iso, T2: iso });

function trace(steps, { seed = {}, anomaly = 'lost-update', levels = both(ISO.READ_COMMITTED) } = {}) {
  return buildTrace({ id: 'synthetic', anomaly, seed, steps }, levels);
}

test('a remove step marks the row deleted and is explained', () => {
  const { frames } = trace(
    [
      { actor: 'T1', op: 'begin' },
      { actor: 'T1', op: 'remove', key: 'x' },
      { actor: 'T1', op: 'commit' },
    ],
    { seed: { x: 1 } },
  );
  const removeFrame = frames[2];
  assert.equal(removeFrame.result, 'del x');
  assert.match(removeFrame.explain, /marks x deleted/);
  // After the delete commits, the row resolves to the empty set.
  assert.equal(frames.at(-1).table.find((r) => r.key === 'x').committed, undefined);
});

test('an abort step rolls the lane back and is explained', () => {
  const { frames } = trace(
    [
      { actor: 'T1', op: 'begin' },
      { actor: 'T1', op: 'write', key: 'x', value: 9 },
      { actor: 'T1', op: 'abort' },
    ],
    { seed: { x: 1 } },
  );
  const abortFrame = frames[3];
  assert.equal(abortFrame.result, 'aborted');
  assert.match(abortFrame.explain, /rolls back/);
  assert.equal(abortFrame.txns.T1.status, 'aborted');
  assert.equal(frames.at(-1).table.find((r) => r.key === 'x').committed, 1, 'write discarded');
});

test('a shrinking re-scan is explained as a vanished row', () => {
  // T1 scans, T2 deletes a matching row and commits, T1 (read committed)
  // re-scans and now matches fewer rows.
  const { frames } = trace(
    [
      { actor: 'T1', op: 'begin' },
      { actor: 'T1', op: 'scan' },
      { actor: 'T2', op: 'begin' },
      { actor: 'T2', op: 'remove', key: 'b' },
      { actor: 'T2', op: 'commit' },
      { actor: 'T1', op: 'scan' },
    ],
    { seed: { a: 1, b: 2 }, anomaly: 'phantom-read' },
  );
  const reScan = frames.at(-1);
  assert.match(reScan.explain, /row vanished mid-transaction/);
});

test('a read on a key with no visible version is explained as the empty set', () => {
  const { frames } = trace([
    { actor: 'T1', op: 'begin' },
    { actor: 'T1', op: 'read', key: 'ghost' },
  ]);
  assert.match(frames.at(-1).explain, /no version is visible/);
  assert.equal(frames.at(-1).result, '= ∅');
});

test('a runtime error that is not a serialization conflict is surfaced', () => {
  // Reading after commit throws a plain Error; the trace records it without
  // crashing and explains it generically.
  const { frames } = trace(
    [
      { actor: 'T1', op: 'begin' },
      { actor: 'T1', op: 'commit' },
      { actor: 'T1', op: 'read', key: 'x' },
    ],
    { seed: { x: 1 } },
  );
  const errFrame = frames.at(-1);
  assert.equal(errFrame.error, 'Error');
  assert.match(errFrame.result, /^✗ Error/);
  assert.match(errFrame.explain, /read failed/);
});

test('a read-committed read names the latest committed version it resolved', () => {
  const { frames } = trace(
    [
      { actor: 'T1', op: 'begin' },
      { actor: 'T1', op: 'read', key: 'x' },
    ],
    { seed: { x: 7 } },
  );
  assert.match(frames.at(-1).explain, /latest committed version/);
});

test('a repeatable read explains the newer committed value it cannot see', () => {
  const { frames } = trace(
    [
      { actor: 'T1', op: 'begin' }, // RR — freezes here
      { actor: 'T1', op: 'read', key: 'x' },
      { actor: 'T2', op: 'begin' },
      { actor: 'T2', op: 'write', key: 'x', value: 2 },
      { actor: 'T2', op: 'commit' },
      { actor: 'T1', op: 'read', key: 'x' }, // still 1, newer value hidden
    ],
    { seed: { x: 1 }, levels: { T1: ISO.REPEATABLE_READ, T2: ISO.READ_COMMITTED } },
  );
  const reread = frames.at(-1);
  assert.equal(reread.result, '= 1', 'frozen snapshot still resolves the old value');
  assert.match(reread.explain, /repeatable read/i);
});

test('reset returns the cursor to the initial frame', () => {
  const st = new Stepper(
    { id: 'synthetic', anomaly: 'lost-update', seed: { x: 1 }, steps: [
      { actor: 'T1', op: 'begin' },
      { actor: 'T1', op: 'write', key: 'x', value: 2 },
    ] },
    both(ISO.READ_COMMITTED),
  );
  st.stepForward();
  st.stepForward();
  assert.equal(st.atEnd, true);
  const frame = st.reset();
  assert.equal(st.cursor, 0);
  assert.equal(frame.index, 0);
  assert.equal(st.atStart, true);
});

test('an unknown op is caught and recorded as an error, not a crash', () => {
  const { frames } = trace([
    { actor: 'T1', op: 'begin' },
    { actor: 'T1', op: 'teleport' },
  ]);
  assert.equal(frames.at(-1).error, 'Error');
  assert.match(frames.at(-1).explain, /unknown op teleport/);
});
