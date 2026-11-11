# Confirmation

`waitTransaction(client, txHash, { timeout?, interval?, signal? })` watches one transaction that was already sent, for a bounded window. It resolves to a `WaitTransactionResult`: `{ ok: true }` once the node reports it committed, at depth zero.

## Options

- **`timeout`:** 60,000 ms by default. It covers the whole wait, in-flight client calls included. It must be a non-negative safe integer no larger than a host timer delay.
- **`interval`:** 2,000 ms by default.
- **`signal`:** aborts the wait.

## How it polls

It polls `get_transaction` at verbosity 1. The typed CCC read hides a rejected transaction behind a null body, so the raw status is needed to keep the rejection evidence. The body is never read: no caller uses it. A second answer from the same node would prove nothing anyway.

## How it ends

- **Rejected:** `{ ok: false, reason: "rejected", detail }`, `detail` is the reason the node gave, or `undefined` when it gave none. The key is always there, so a caller reads it without checking.
- **Timed out:** `{ ok: false, reason: "timed-out" }`. The wait recognizes its own window timeout by identity. Any other failure throws, a read that can't answer included.
- **Aborted:** throws the reason of the signal.

A discarded result would read as success, so every caller handles it. The bot and the generator throw on `!ok`. The interface releases a rejection but keeps a timed-out hash for a retry.

An abort or a timeout stops the wait, but CCC transports may still finish their in-flight work. A late answer is handled. Nothing clears or marks the cache here.

## After the window

What happens after a closed window is up to the caller. The bot and the generator rebuild from committed state next turn. The interface can reopen a window on the same hash, without another signature or send.

No caller needs a confirmation depth today. One could be added without replacing this helper.

There's no durable store of signed bytes, replay graph or pending overlay. Such a store would need reconciling on every start, while duplicate intent stays an accepted result of rebuilding instead of persisting intent.

## Old headers

CCC keeps old enough headers even across `ClientCacheMemory.clear()`. A consumer that must drop them after a failed transaction gives the client a new cache, as the [interface](../../interface/docs/wallet_session.md#a-new-cache-after-an-error) does. A deep reorg is possible, so age alone doesn't make a header immutable.
