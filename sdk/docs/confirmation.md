# Confirmation

After the `sent` step, each `next()` of [`commitTransaction`](signing_and_broadcast.md) waits what's left of 10 seconds since the previous step, then reads the status once. `committed`, at depth zero, and every `ok: false` step are last. The commit takes no options: no timeout, interval or signal. It holds no timer between steps, so nothing runs until the next `next()`, and a caller's `break` stops it.

## How it reads

It reads `get_transaction` at verbosity 1. The typed CCC read hides a rejected transaction behind a null body, so the raw status is needed to keep the rejection evidence. The body is never read: no caller uses it. A second answer from the same node would prove nothing anyway.

## Each step

- **committed:** the last step.
- **rejected:** the node recorded a rejection, its reason the `cause`.
- **pending or proposed:** the node holds the transaction, a `pending` step.
- **unknown:** `rejected` after a refusal, which is final only while the node doesn't know the transaction: a later `pending` status clears it. A refusal is a send failure coded -301, -302 or -1100 to -1199 but -1107 (CKB `rpc/src/error.rs`). After an acknowledgment (an accepted send, a duplicate naming this hash or a pending status), `pending`: the transaction is only watched, never sent again. Otherwise the commit sends the same signed bytes again, unless a fresh tip has reached `broadcastBefore`, which ends `abandoned`.

After the broadcast nothing throws, since the outcome exists on chain. A failed read, a stale tip or a status record it can't read is a `pending` step with the error as `cause`, read again at the next step. Every `cause` is an Error: anything else thrown is wrapped, the original as its cause.

## When it ends

Under the default CKB configuration an acknowledged transaction ends committed or recorded rejected. The pool records a transaction it expires after 12 hours, one it evicts when full and one a committed conflict spends, then keeps those records 7 days.

A caller's `break` bounds the cases that don't end:

- a node that keeps answering pending;
- an acknowledged transaction lost without a record;
- a send that never gets an answer, for a transaction without `broadcastBefore`.

Two wrong endings remain, both on a fallback client whose backends disagree. A lagging backend that refused the transaction and recorded that can still answer `rejected` while another backend commits it. After a lost first answer, a send again can reach a backend that sees the inputs already spent by the transaction itself, committed through another backend: it refuses with -301, and while the status there is still unknown the commit ends `rejected`.

The bot and the generator take one step two minutes after `sent`. The interface holds until the last step ([signing](../../interface/docs/signing.md)).

## After the commit

No caller needs a confirmation depth today. One could be added as a later step.

There's no durable store of signed bytes, replay graph or pending overlay. Such a store would need reconciling on every start, while duplicate intent stays an accepted result of rebuilding instead of persisting intent.

## Old headers

CCC keeps old enough headers even across `ClientCacheMemory.clear()`, and a deep reorg is possible, so age alone doesn't make a header immutable. The SDK checks every header against its own hash, so a cached header a reorg dropped still names a real block: a stale entry can only refuse or skip. So no consumer drops its cache after a failure: the bot keeps it for a process, the interface for the life of the page.
