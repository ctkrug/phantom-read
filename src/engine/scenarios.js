// Curated scenarios: each is a scripted pair of transactions whose interleaving
// produces (or, at a high enough isolation level, prevents) a named anomaly.
//
// A scenario is data, not code — the UI turns each step into a timeline action
// and the engine executes it. `defaultIso` is what makes the anomaly fire; the
// point of the sandbox is to raise the level and watch it disappear.

import { ISO } from './mvcc.js';

/**
 * @typedef {Object} Step
 * @property {'T1'|'T2'} actor
 * @property {'begin'|'read'|'scan'|'write'|'remove'|'commit'|'abort'} op
 * @property {string} [key]
 * @property {any} [value]
 * @property {string} note   short human explanation shown on the step
 */

export const SCENARIOS = [
  {
    id: 'dirty-read',
    title: 'Dirty read',
    anomaly: 'dirty-read',
    blurb:
      'T2 reads a row T1 has written but not committed. Only possible below ' +
      'Read Committed — this engine never allows it, so the read stays clean.',
    seed: { balance: 100 },
    defaultIso: ISO.READ_COMMITTED,
    preventedAtOrAbove: ISO.READ_COMMITTED,
    steps: [
      { actor: 'T1', op: 'begin', note: 'T1 starts' },
      { actor: 'T2', op: 'begin', note: 'T2 starts' },
      { actor: 'T1', op: 'write', key: 'balance', value: 999, note: 'T1 writes 999 (uncommitted)' },
      { actor: 'T2', op: 'read', key: 'balance', note: 'T2 reads balance — sees committed value, not 999' },
      { actor: 'T1', op: 'commit', note: 'T1 commits' },
      { actor: 'T2', op: 'read', key: 'balance', note: 'T2 reads again — now sees 999' },
      { actor: 'T2', op: 'commit', note: 'T2 commits' },
    ],
  },
  {
    id: 'phantom-read',
    title: 'Phantom read',
    anomaly: 'phantom-read',
    blurb:
      'T1 runs a range scan twice. Between the scans, T2 inserts a matching ' +
      'row. Under Read Committed the new row appears; Repeatable Read freezes ' +
      "T1's snapshot so it never does.",
    seed: { 'order-1': 40, 'order-2': 55 },
    defaultIso: ISO.READ_COMMITTED,
    preventedAtOrAbove: ISO.REPEATABLE_READ,
    steps: [
      { actor: 'T1', op: 'begin', note: 'T1 starts' },
      { actor: 'T1', op: 'scan', note: 'T1 scans orders — 2 rows' },
      { actor: 'T2', op: 'begin', note: 'T2 starts' },
      { actor: 'T2', op: 'write', key: 'order-3', value: 70, note: 'T2 inserts order-3' },
      { actor: 'T2', op: 'commit', note: 'T2 commits' },
      { actor: 'T1', op: 'scan', note: 'T1 scans again — phantom row?' },
      { actor: 'T1', op: 'commit', note: 'T1 commits' },
    ],
  },
  {
    id: 'lost-update',
    title: 'Lost update',
    anomaly: 'lost-update',
    blurb:
      'Both transactions read the same counter, each adds to it, and both ' +
      'commit. Under Read Committed one update silently overwrites the other; ' +
      'Repeatable Read makes the second writer lose the race and abort.',
    seed: { counter: 100 },
    defaultIso: ISO.READ_COMMITTED,
    preventedAtOrAbove: ISO.REPEATABLE_READ,
    steps: [
      { actor: 'T1', op: 'begin', note: 'T1 starts' },
      { actor: 'T2', op: 'begin', note: 'T2 starts' },
      { actor: 'T1', op: 'read', key: 'counter', note: 'T1 reads counter (100)' },
      { actor: 'T2', op: 'read', key: 'counter', note: 'T2 reads counter (100)' },
      { actor: 'T1', op: 'write', key: 'counter', value: 110, note: 'T1 writes 100 + 10' },
      { actor: 'T1', op: 'commit', note: 'T1 commits' },
      { actor: 'T2', op: 'write', key: 'counter', value: 120, note: 'T2 writes 100 + 20' },
      { actor: 'T2', op: 'commit', note: "T2 commits — T1's +10 lost?" },
    ],
  },
  {
    id: 'write-skew',
    title: 'Write skew',
    anomaly: 'write-skew',
    blurb:
      'Two doctors are on call. Each transaction checks that the *other* is ' +
      'still on call, then goes off call. Both commit — and now nobody is on ' +
      'call. Only Serializable stops it.',
    seed: { 'alice-oncall': 1, 'bob-oncall': 1 },
    defaultIso: ISO.REPEATABLE_READ,
    preventedAtOrAbove: ISO.SERIALIZABLE,
    steps: [
      { actor: 'T1', op: 'begin', note: 'T1 (Alice) starts' },
      { actor: 'T2', op: 'begin', note: 'T2 (Bob) starts' },
      { actor: 'T1', op: 'read', key: 'bob-oncall', note: 'T1 checks Bob is on call' },
      { actor: 'T2', op: 'read', key: 'alice-oncall', note: 'T2 checks Alice is on call' },
      { actor: 'T1', op: 'write', key: 'alice-oncall', value: 0, note: 'Alice goes off call' },
      { actor: 'T2', op: 'write', key: 'bob-oncall', value: 0, note: 'Bob goes off call' },
      { actor: 'T1', op: 'commit', note: 'T1 commits' },
      { actor: 'T2', op: 'commit', note: 'T2 commits — invariant broken?' },
    ],
  },
];

export function scenarioById(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}
