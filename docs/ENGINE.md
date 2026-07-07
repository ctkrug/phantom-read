# The MVCC engine

How `src/engine/mvcc.js` decides what a transaction sees. The whole point of the
project is that the anomalies are *emergent* from these rules, not scripted — so
this is the file to read to trust the demo.

## Version chains

Every row is an array of **versions**, appended over time:

```
row "x": [ {value: 1, xmin: 0, xmax: 4}, {value: 2, xmin: 4, xmax: null} ]
```

- `xmin` — the id of the transaction that **created** this version.
- `xmax` — the id of the transaction that **superseded or deleted** it, or
  `null` if it's still the live tip.

A write never mutates a value in place. It appends a new version and stamps
`xmax` on the version it replaced. Reads walk the chain newest-first and return
the first **visible** version.

## Transaction status and commit order

Each transaction is `active`, `committed`, or `aborted`. Committed transactions
receive a monotonically increasing `commitSeq`. Transaction `0` is the system
transaction that owns all seeded rows; it is committed from the start and visible
to everyone.

## Snapshots

When a transaction begins it captures a **snapshot**: the set of transaction ids
already committed at that instant. This frozen set is what distinguishes the
isolation levels:

- **Read Committed** ignores the frozen snapshot and asks a live question — *is
  the creating transaction committed right now?* So a re-read can observe another
  transaction's commit (non-repeatable read / phantom).
- **Repeatable Read** and **Serializable** consult only the frozen snapshot, so
  reads are stable for the transaction's whole life.

## Visibility

A version `v` is visible to transaction `T` when **both** hold:

1. **Its creator is visible.** Either `v.xmin === T` (T's own write, even
   uncommitted) or the creator is committed *and* visible to `T` — which for
   Read Committed means "committed now" and for the higher levels means "in T's
   snapshot." This is what blocks **dirty reads**: another transaction's
   uncommitted version is never visible.

2. **Its deletion is not visible.** If `v.xmax` is `null` the version is live. If
   `v.xmax === T`, T deleted it itself, so it's gone for T. Otherwise the version
   stays visible unless the deleting transaction is *also* visible to T under the
   same rule.

## Commit-time conflict checks

Snapshots alone prevent dirty and non-repeatable reads, but not lost updates or
write skew. Those are caught at commit:

- **First-updater-wins** (Repeatable Read + Serializable): if a concurrent
  transaction — committed, and *not* in our snapshot — wrote a key we also wrote,
  we lose the race and abort with a `SerializationError`. This catches the **lost
  update**.

- **Read-write antidependency** (Serializable only): if a concurrent committed
  transaction wrote a key we *read*, our snapshot was not serialisable and we
  abort. This catches **write skew**, where the two transactions write disjoint
  keys but each read what the other wrote. The check is deliberately conservative
  — it can abort a safe interleaving — which is the same trade-off real snapshot
  isolation engines (e.g. PostgreSQL SSI) accept.

## Abort

Aborting removes every version the transaction created and undoes any `xmax`
stamps it placed — as if the transaction never ran. Undoing a stamp restores the
version's *prior* `xmax`: usually `null` (reviving a row it had tried to delete),
but if a concurrent transaction had already superseded that version under our
frozen snapshot, the stamp is restored to that committed transaction's id so the
chain keeps exactly one live version.

## Modeled concurrency, and its boundary

The engine models **snapshot isolation with commit-time conflict detection**. It
deliberately does **not** model row-level write locks. In a real database, a
second transaction that updates a row already updated by another *uncommitted*
transaction **blocks** until the first resolves. There is no blocking in a
step-at-a-time replay, so histories where two transactions hold concurrent
*uncommitted* writes to the **same key** are outside the modeled space — under
Read Committed they can leave two live versions in a chain, because neither
writer can see (and therefore close) the other's pending version.

This boundary is never crossed by the shipped product: all four curated
scenarios write disjoint keys concurrently (write skew) or serialise their writes
to a shared key behind a commit (lost update), so the version chain the UI draws
always resolves to a single live version. The property tests
(`test/mvcc.property.test.js`) fuzz within this contract.

## Why this matters

Because visibility is computed from these rules on every read, the anomalies are
not animations. Raising an isolation level changes which branch of the visibility
function or which commit check applies, and the anomaly disappears on its own.
The test suite (`test/mvcc.test.js`, `test/scenarios.test.js`) asserts each
anomaly both fires at the permissive level and is prevented at the strict one.
