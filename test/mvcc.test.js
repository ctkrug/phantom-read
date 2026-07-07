import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database, ISO, SerializationError } from '../src/engine/mvcc.js';

test('seeded rows are visible to a fresh transaction', () => {
  const db = new Database({ alice: 100 });
  const t = db.begin(ISO.READ_COMMITTED);
  assert.equal(t.read('alice'), 100);
});

test('read committed does not see an uncommitted write (no dirty read)', () => {
  const db = new Database({ alice: 100 });
  const t1 = db.begin(ISO.READ_COMMITTED);
  const t2 = db.begin(ISO.READ_COMMITTED);
  t1.write('alice', 999);
  assert.equal(t2.read('alice'), 100, 'must not observe uncommitted value');
  t1.commit();
  assert.equal(t2.read('alice'), 999, 'sees value once committed');
});

test('read committed re-read reflects a concurrent commit (non-repeatable read)', () => {
  const db = new Database({ x: 1 });
  const reader = db.begin(ISO.READ_COMMITTED);
  assert.equal(reader.read('x'), 1);
  const writer = db.begin(ISO.READ_COMMITTED);
  writer.write('x', 2);
  writer.commit();
  assert.equal(reader.read('x'), 2, 'read committed sees the newer committed value');
});

test('repeatable read keeps a stable snapshot across a concurrent commit', () => {
  const db = new Database({ x: 1 });
  const reader = db.begin(ISO.REPEATABLE_READ);
  assert.equal(reader.read('x'), 1);
  const writer = db.begin(ISO.READ_COMMITTED);
  writer.write('x', 2);
  writer.commit();
  assert.equal(reader.read('x'), 1, 'snapshot frozen at begin');
});

test('phantom row appears under read committed but not repeatable read', () => {
  const db = new Database({ a: 5 });
  const rc = db.begin(ISO.READ_COMMITTED);
  const rr = db.begin(ISO.REPEATABLE_READ);
  assert.equal(rc.scan().length, 1);
  assert.equal(rr.scan().length, 1);

  const inserter = db.begin(ISO.READ_COMMITTED);
  inserter.write('b', 9);
  inserter.commit();

  assert.equal(rc.scan().length, 2, 'read committed sees the phantom');
  assert.equal(rr.scan().length, 1, 'repeatable read does not');
});

test('abort discards writes and revives deleted rows', () => {
  const db = new Database({ x: 1 });
  const t = db.begin(ISO.READ_COMMITTED);
  t.write('y', 2);
  t.remove('x');
  t.abort();
  const after = db.begin(ISO.READ_COMMITTED);
  assert.equal(after.read('x'), 1, 'deleted row revived');
  assert.equal(after.read('y'), undefined, 'inserted row discarded');
});

test('aborting a losing writer restores the version it superseded', () => {
  // Lost update at Repeatable Read: T2 cannot see T1's new version, so it
  // re-closes the seeded version. When T2 then loses first-updater-wins and
  // aborts, that seeded version must be restored to T1's supersession — not
  // revived as live. A regression leaves two live versions in the chain.
  const db = new Database({ counter: 100 });
  const t1 = db.begin(ISO.REPEATABLE_READ);
  const t2 = db.begin(ISO.REPEATABLE_READ);
  t1.read('counter');
  t2.read('counter');
  t1.write('counter', 110);
  t1.commit();
  t2.write('counter', 120);
  assert.throws(() => t2.commit(), SerializationError);

  const live = db.versionsOf('counter').filter((v) => v.xmax == null);
  assert.deepEqual(
    live.map((v) => v.value),
    [110],
    'exactly one live version remains after the loser aborts',
  );
  assert.equal(db.committedValue('counter'), 110);
});

test('serializable aborts the loser of a concurrent write conflict', () => {
  const db = new Database({ x: 1 });
  const t1 = db.begin(ISO.SERIALIZABLE);
  const t2 = db.begin(ISO.SERIALIZABLE);
  t1.read('x');
  t2.read('x');
  t1.write('x', 10);
  t2.write('x', 20);
  t1.commit();
  assert.throws(() => t2.commit(), SerializationError);
  assert.equal(t2.status, 'aborted');
});
