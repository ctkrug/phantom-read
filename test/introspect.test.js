import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database, ISO, TXN } from '../src/engine/mvcc.js';

test('committedValue reflects only committed versions', () => {
  const db = new Database({ x: 1 });
  assert.equal(db.committedValue('x'), 1, 'seeded value is committed');

  const t = db.begin(ISO.READ_COMMITTED);
  t.write('x', 2);
  assert.equal(db.committedValue('x'), 1, 'uncommitted write is not ground truth');

  t.commit();
  assert.equal(db.committedValue('x'), 2, 'after commit the new value is ground truth');

  assert.equal(db.committedValue('missing'), undefined, 'unknown key is undefined');
});

test('committedValue ignores an aborted write', () => {
  const db = new Database({ x: 1 });
  const t = db.begin(ISO.READ_COMMITTED);
  t.write('x', 99);
  t.abort();
  assert.equal(db.committedValue('x'), 1, 'aborted version never becomes truth');
});

test('peek resolves visibility without recording a read', () => {
  const db = new Database({ x: 1 });
  const t = db.begin(ISO.SERIALIZABLE);
  assert.equal(t.peek('x'), 1);
  assert.equal(t.peek('missing'), undefined);
  assert.deepEqual(t.reads, [], 'peek did not record a read');

  t.read('x');
  assert.deepEqual(t.reads, ['x'], 'read does record');
});

test('peek sees the transaction own uncommitted write but not others', () => {
  const db = new Database({ x: 1 });
  const t1 = db.begin(ISO.READ_COMMITTED);
  const t2 = db.begin(ISO.READ_COMMITTED);
  t1.write('x', 2);
  assert.equal(t1.peek('x'), 2, 'a txn sees its own uncommitted write');
  assert.equal(t2.peek('x'), 1, 'others do not — no dirty read');
});

test('versionsOf exposes the chain with xmin/xmax and status stamps', () => {
  const db = new Database({ x: 1 });
  const t = db.begin(ISO.READ_COMMITTED);
  t.write('x', 2);

  let chain = db.versionsOf('x');
  assert.equal(chain.length, 2, 'a write appends a version');
  assert.equal(chain[0].value, 1);
  assert.equal(chain[0].xmax, t.id, 'the superseded version is stamped with the writer');
  assert.equal(chain[0].xmaxStatus, TXN.ACTIVE, 'writer is still active');
  assert.equal(chain[1].value, 2);
  assert.equal(chain[1].xmax, null, 'the tip is live');
  assert.equal(chain[1].xminStatus, TXN.ACTIVE);

  t.commit();
  chain = db.versionsOf('x');
  assert.equal(chain[1].xminStatus, TXN.COMMITTED, 'status stamps update after commit');
});

test('versionsOf returns a copy — mutating it does not corrupt the engine', () => {
  const db = new Database({ x: 1 });
  const copy = db.versionsOf('x');
  copy[0].value = 'tampered';
  assert.equal(db.committedValue('x'), 1, 'engine state is untouched');
  assert.deepEqual(db.keys(), ['x']);
});

test('snapshot getter reflects the frozen begin horizon', () => {
  const db = new Database({ x: 1 });
  const t1 = db.begin(ISO.READ_COMMITTED);
  t1.write('x', 2);
  t1.commit();
  const t2 = db.begin(ISO.REPEATABLE_READ);
  assert.ok(t2.snapshot.includes(t1.id), 'a committed predecessor is in the snapshot');
  const t3 = db.begin(ISO.REPEATABLE_READ);
  assert.ok(!t3.snapshot.includes(t2.id), 'a still-active peer is not');
});
