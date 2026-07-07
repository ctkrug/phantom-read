// Property-based fuzzing of the engine. Rather than scripting one interleaving,
// we generate thousands of random two-transaction histories at random isolation
// levels and assert invariants that must hold for ANY history. A deterministic
// LCG seeds the generator so a failure is reproducible from the printed seed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database, ISO, SerializationError, TXN } from '../src/engine/mvcc.js';

const LEVELS = [ISO.READ_COMMITTED, ISO.REPEATABLE_READ, ISO.SERIALIZABLE];
const KEYS = ['a', 'b'];
const VALUES = [10, 20, 30, 40];

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// The engine models snapshot isolation with commit-time conflict detection, not
// row write-locks (see docs/ENGINE.md "Modeled concurrency, and its boundary").
// A history where two transactions hold concurrent *uncommitted* writes to the
// same key is therefore outside the modeled space — real databases block the
// second writer, which a replay can't. The shipped scenarios never do this, so
// the fuzzer stays inside the contract by skipping such a write.
function peerHoldsUncommittedWrite(txns, self, key) {
  return txns.some(
    (o) => o !== self && o.status === TXN.ACTIVE && o.writes.includes(key),
  );
}

// Run one random history and return the database plus the value pool that was
// ever legitimately introduced (seed + writes), for the "no phantom value" check.
function runHistory(rand) {
  const db = new Database({ a: 10, b: 20 });
  const known = new Set([10, 20]);
  const txns = [
    db.begin(LEVELS[Math.floor(rand() * 3)]),
    db.begin(LEVELS[Math.floor(rand() * 3)]),
  ];
  const steps = 4 + Math.floor(rand() * 8);
  for (let i = 0; i < steps; i++) {
    const t = txns[Math.floor(rand() * txns.length)];
    if (t.status !== TXN.ACTIVE) continue;
    const key = KEYS[Math.floor(rand() * KEYS.length)];
    const roll = rand();
    try {
      if (roll < 0.35) {
        const v = t.read(key);
        assert.ok(v === undefined || known.has(v), `read surfaced an unknown value ${v}`);
      } else if (roll < 0.6) {
        if (peerHoldsUncommittedWrite(txns, t, key)) continue; // stay in the modeled contract
        const v = VALUES[Math.floor(rand() * VALUES.length)];
        known.add(v);
        t.write(key, v);
      } else if (roll < 0.72) {
        if (peerHoldsUncommittedWrite(txns, t, key)) continue;
        t.remove(key);
      } else {
        t.commit();
      }
    } catch (err) {
      // Only a serialization abort is an acceptable failure; anything else is a bug.
      if (!(err instanceof SerializationError)) throw err;
    }
  }
  // Drive every transaction to a terminal state.
  for (const t of txns) {
    if (t.status === TXN.ACTIVE) {
      try {
        t.commit();
      } catch (err) {
        if (!(err instanceof SerializationError)) throw err;
      }
    }
  }
  return db;
}

test('random histories keep at most one live committed version per key', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const rand = lcg(seed);
    let db;
    try {
      db = runHistory(rand);
    } catch (err) {
      assert.fail(`seed ${seed} threw unexpectedly: ${err.stack}`);
    }
    for (const key of db.keys()) {
      const live = db.versionsOf(key).filter((v) => v.xmax == null && v.xminStatus === TXN.COMMITTED);
      assert.ok(
        live.length <= 1,
        `seed ${seed}, key ${key}: ${live.length} live committed versions (expected <= 1)`,
      );
      // committedValue must agree with the single live committed version (if any).
      const cv = db.committedValue(key);
      if (live.length === 1) assert.equal(cv, live[0].value, `seed ${seed}, key ${key}: committedValue matches the live version`);
    }
  }
});

test('a transaction never reads a peer\'s uncommitted value (no dirty read)', () => {
  for (let seed = 5000; seed < 6000; seed++) {
    const rand = lcg(seed);
    const db = new Database({ a: 10 });
    const writer = db.begin(LEVELS[Math.floor(rand() * 3)]);
    const reader = db.begin(LEVELS[Math.floor(rand() * 3)]);
    const secret = 999; // a value only the writer knows, never committed
    writer.write('a', secret);
    // No matter the reader's level, it must not observe the uncommitted secret.
    assert.notEqual(reader.read('a'), secret, `seed ${seed}: dirty read leaked`);
    assert.notEqual(reader.peek('a'), secret, `seed ${seed}: dirty peek leaked`);
  }
});
