// A small multi-version concurrency control (MVCC) engine.
//
// The model mirrors how a real database resolves reads: every row keeps a chain
// of *versions*, each stamped with the transaction that created it (`xmin`) and
// the transaction that superseded or deleted it (`xmax`). A read never mutates
// data — it walks the chain and returns the first version *visible* under the
// reader's snapshot. Isolation levels differ only in how that snapshot is
// chosen, which is exactly where dirty reads, phantom reads, and write skew come
// from.
//
// This module is pure and dependency-free so it runs identically in the browser
// UI and under the Node test runner.

export const ISO = Object.freeze({
  READ_COMMITTED: 'read-committed',
  REPEATABLE_READ: 'repeatable-read',
  SERIALIZABLE: 'serializable',
});

export const TXN = Object.freeze({
  ACTIVE: 'active',
  COMMITTED: 'committed',
  ABORTED: 'aborted',
});

/** Raised when a serializable/repeatable-read commit loses a write conflict. */
export class SerializationError extends Error {
  constructor(key) {
    super(`could not serialize access due to concurrent update of "${key}"`);
    this.name = 'SerializationError';
    this.key = key;
  }
}

// The bootstrap transaction that owns all seeded rows. Always committed and
// visible to every snapshot.
const SYSTEM_TXID = 0;

let VERSION_SEQ = 1;

export class Database {
  /**
   * @param {Object<string, any>} [seed] initial committed rows, keyed by id.
   */
  constructor(seed = {}) {
    /** @type {Map<string, Array<{id:number,value:any,xmin:number,xmax:(number|null)}>>} */
    this.rows = new Map();
    /** @type {Map<number, object>} */
    this.txns = new Map();
    this.txns.set(SYSTEM_TXID, {
      id: SYSTEM_TXID,
      iso: ISO.SERIALIZABLE,
      status: TXN.COMMITTED,
      commitSeq: 0,
      writes: new Set(),
    });
    this._nextTxid = 1;
    this._commitSeq = 1;
    for (const [key, value] of Object.entries(seed)) {
      this.rows.set(key, [{ id: VERSION_SEQ++, value, xmin: SYSTEM_TXID, xmax: null }]);
    }
  }

  /** Begin a transaction and capture its snapshot. */
  begin(iso = ISO.READ_COMMITTED) {
    const id = this._nextTxid++;
    const snapshot = new Set();
    for (const t of this.txns.values()) {
      if (t.status === TXN.COMMITTED) snapshot.add(t.id);
    }
    const txn = {
      id,
      iso,
      status: TXN.ACTIVE,
      commitSeq: null,
      snapshot, // committed txn ids as of begin — the frozen horizon for RR/SER
      writes: new Set(),
      reads: new Set(),
    };
    this.txns.set(id, txn);
    return new Transaction(this, txn);
  }

  _committedVisible(creatorId, txn) {
    const c = this.txns.get(creatorId);
    if (!c || c.status !== TXN.COMMITTED) return false;
    if (creatorId === SYSTEM_TXID) return true;
    // Read Committed takes a fresh snapshot per statement, so any committed txn
    // is visible. Repeatable Read / Serializable freeze the snapshot at begin.
    if (txn.iso === ISO.READ_COMMITTED) return true;
    return txn.snapshot.has(creatorId);
  }

  _isVisible(version, txn) {
    const createdBySelf = version.xmin === txn.id;
    const createdVisible = createdBySelf || this._committedVisible(version.xmin, txn);
    if (!createdVisible) return false;
    if (version.xmax == null) return true;
    // The row was deleted/superseded. It stays visible unless that deletion is
    // visible to us too.
    if (version.xmax === txn.id) return false; // we deleted it ourselves
    return !this._committedVisible(version.xmax, txn);
  }

  /**
   * The value an outside observer would see right now: the newest version whose
   * creator is committed and whose deletion (if any) is not committed. Used by
   * the UI to render the "ground truth" row value independent of any lane.
   */
  committedValue(key) {
    const chain = this.rows.get(key);
    if (!chain) return undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i];
      const creator = this.txns.get(v.xmin);
      if (!creator || creator.status !== TXN.COMMITTED) continue;
      if (v.xmax == null) return v.value;
      const closer = this.txns.get(v.xmax);
      if (!closer || closer.status !== TXN.COMMITTED) return v.value;
    }
    return undefined;
  }

  /** All keys ever touched, in stable insertion order, for rendering the table. */
  keys() {
    return [...this.rows.keys()];
  }

  /**
   * A plain, defensively-copied view of a row's version chain, each version
   * annotated with the status of its creating/closing transactions. This is what
   * the UI renders as the dimensioned assembly — with live xmin/xmax stamps.
   */
  versionsOf(key) {
    const chain = this.rows.get(key) || [];
    return chain.map((v) => ({
      id: v.id,
      value: v.value,
      xmin: v.xmin,
      xmax: v.xmax,
      xminStatus: this.txns.get(v.xmin)?.status ?? null,
      xmaxStatus: v.xmax == null ? null : (this.txns.get(v.xmax)?.status ?? null),
    }));
  }
}

export class Transaction {
  constructor(db, txn) {
    this._db = db;
    this._txn = txn;
  }

  get id() {
    return this._txn.id;
  }
  get iso() {
    return this._txn.iso;
  }
  get status() {
    return this._txn.status;
  }

  /** The frozen begin-snapshot: committed txn ids this transaction can see. */
  get snapshot() {
    return [...(this._txn.snapshot ?? [])];
  }

  /** Keys this transaction has read (drives the antidependency explanation). */
  get reads() {
    return [...this._txn.reads];
  }

  /** Keys this transaction has written. */
  get writes() {
    return [...this._txn.writes];
  }

  /**
   * Resolve the value visible for `key` WITHOUT recording a read. The UI calls
   * this to show what each lane currently sees on every row; using `read` would
   * pollute the read set and change commit-time antidependency checks.
   */
  peek(key) {
    const chain = this._db.rows.get(key);
    if (!chain) return undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (this._db._isVisible(chain[i], this._txn)) return chain[i].value;
    }
    return undefined;
  }

  _assertActive() {
    if (this._txn.status !== TXN.ACTIVE) {
      throw new Error(`transaction ${this._txn.id} is ${this._txn.status}`);
    }
  }

  /** Return the visible value for `key`, or undefined if no row is visible. */
  read(key) {
    this._assertActive();
    this._txn.reads.add(key);
    const chain = this._db.rows.get(key);
    if (!chain) return undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (this._db._isVisible(chain[i], this._txn)) return chain[i].value;
    }
    return undefined;
  }

  /** Return all keys whose visible row satisfies `predicate(value, key)`. */
  scan(predicate = () => true) {
    this._assertActive();
    const out = [];
    for (const key of this._db.rows.keys()) {
      const value = this.read(key);
      if (value !== undefined && predicate(value, key)) out.push({ key, value });
    }
    return out;
  }

  /** Insert or update `key`. Creates a new version and closes the prior one. */
  write(key, value) {
    this._assertActive();
    const chain = this._db.rows.get(key) || [];
    for (let i = chain.length - 1; i >= 0; i--) {
      if (this._db._isVisible(chain[i], this._txn)) {
        chain[i].xmax = this._txn.id;
        break;
      }
    }
    chain.push({ id: VERSION_SEQ++, value, xmin: this._txn.id, xmax: null });
    this._db.rows.set(key, chain);
    this._txn.writes.add(key);
    return this;
  }

  /** Delete the visible row for `key`, if any. */
  remove(key) {
    this._assertActive();
    const chain = this._db.rows.get(key);
    if (chain) {
      for (let i = chain.length - 1; i >= 0; i--) {
        if (this._db._isVisible(chain[i], this._txn)) {
          chain[i].xmax = this._txn.id;
          break;
        }
      }
    }
    this._txn.writes.add(key);
    return this;
  }

  /**
   * Commit and run the isolation level's conflict checks.
   *
   * - Repeatable Read / Serializable enforce first-updater-wins: a concurrent
   *   transaction that committed a write to one of *our* written keys makes us
   *   lose the write-write race and abort.
   * - Serializable additionally checks read-write antidependencies: if a
   *   concurrent transaction committed a write to a key we *read*, our snapshot
   *   is no longer serializable and we abort. This is what catches write skew,
   *   where the two transactions write disjoint keys but read each other's.
   *   The check is conservative (it can abort a safe interleaving) — the same
   *   trade-off real snapshot-isolation implementations accept.
   */
  commit() {
    this._assertActive();
    const txn = this._txn;
    const concurrentCommitted = (other) =>
      other.id !== txn.id &&
      other.status === TXN.COMMITTED &&
      !txn.snapshot.has(other.id);

    if (txn.iso !== ISO.READ_COMMITTED) {
      for (const key of txn.writes) {
        for (const other of this._db.txns.values()) {
          if (concurrentCommitted(other) && other.writes.has(key)) {
            this.abort();
            throw new SerializationError(key);
          }
        }
      }
    }
    if (txn.iso === ISO.SERIALIZABLE) {
      for (const key of txn.reads) {
        for (const other of this._db.txns.values()) {
          if (concurrentCommitted(other) && other.writes.has(key)) {
            this.abort();
            throw new SerializationError(key);
          }
        }
      }
    }
    txn.status = TXN.COMMITTED;
    txn.commitSeq = this._db._commitSeq++;
    return this;
  }

  /** Roll back: undo every version this transaction created. */
  abort() {
    if (this._txn.status !== TXN.ACTIVE) return this;
    const txn = this._txn;
    for (const [key, chain] of this._db.rows) {
      const kept = chain.filter((v) => v.xmin !== txn.id);
      for (const v of kept) {
        if (v.xmax === txn.id) v.xmax = null; // revive rows we tried to delete
      }
      this._db.rows.set(key, kept);
    }
    txn.status = TXN.ABORTED;
    return this;
  }
}
