---
title: "I built a database isolation-level sandbox so I could finally see write skew"
published: false
tags: databases, javascript, webdev, learning
---

Every backend developer has met the isolation-level table. Read Committed
prevents dirty reads. Repeatable Read prevents phantom reads. Serializable
prevents write skew. You nod, you memorize the grid for the interview, and you
never really see any of it happen.

That grid always bothered me, because it hides the interesting part: *why*. The
answer lives in snapshot visibility and version chains, the machinery a database
runs that you never get to watch. So I built [Phantom
Read](https://apps.charliekrug.com/phantom-read/), a browser sandbox that runs
two transactions on a small MVCC engine and lets you step them through one action
at a time. The anomalies are not animations. They happen because the engine's
rules produce them.

Here are two decisions from the build that were more interesting than I expected.

## The engine has to be real, so the UI can be dumb

The temptation with a teaching tool is to script each anomaly: play this
animation when the user picks Read Committed, play that one for Serializable. That
is a lie factory. The moment the script and the explanation disagree, you have
taught someone the wrong thing.

So the engine came first and stands alone. Each row keeps a chain of versions,
each stamped with the transaction that created it (`xmin`) and the one that
superseded or deleted it (`xmax`). A read walks the chain and returns the first
version visible under the reader's snapshot. Isolation levels differ only in how
that snapshot is chosen: Read Committed refreshes it every statement, Repeatable
Read and Serializable freeze it at `begin`. Serializable adds one commit-time
check for read-write antidependencies, and that single check is the whole reason
write skew gets caught.

The UI never re-implements any of this. A scenario is data, a scripted pair of
transactions. The engine executes it into an immutable list of frames, and the
front end is just a cursor moving across them. Stepping forward and replaying a
prefix land on the identical frame by construction, so the demo can never drift
from the truth. It also means the browser and the test suite assert on the exact
same engine code.

## The bug that only shows up when you abort

The subtle bug was in rollback. When a transaction writes, it closes the version
it can see by stamping its own id on that version's `xmax`. If the transaction
later aborts, you undo that by clearing the `xmax` back to null.

Except under a frozen snapshot, the version you can see may already have been
superseded by a *different* concurrent transaction that committed. Clearing
`xmax` to null on abort then revives a version that is not actually live anymore,
and the whole table quietly reports the wrong value. The fix was to remember the
version's prior `xmax` before overwriting it, and restore that on abort instead
of assuming null. A property-based fuzz test that runs random interleavings and
checks the engine's invariants is what pushed me to the boundary where this
mattered.

## What I would do differently

The trace-and-cursor model is clean but it recomputes the entire trace whenever
you change an isolation level. For four short scenarios that is free, but if I
extended this to user-authored transaction scripts I would want to diff traces
and re-render only the frames that changed. I would also add a free-play mode
where you issue reads and writes yourself, instead of only stepping curated
scenarios. The engine already supports it; it is only a UI away.

The code is on [GitHub](https://github.com/ctkrug/phantom-read) and the live
sandbox is [here](https://apps.charliekrug.com/phantom-read/). If you have ever
argued with a coworker about whether Repeatable Read is enough, run the write-skew
scenario at Repeatable Read and then at Serializable. It settles the argument in
about ten seconds.
