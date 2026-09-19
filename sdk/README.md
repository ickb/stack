# iCKB/SDK

iCKB SDK built on top of CCC

## Layout

One package, one file per on-chain script at the top of `src` (`udt.ts` the iCKB token, `logic.ts` deposits and receipts, `owned_owner.ts` withdrawal requests and withdrawals, `dao.ts` the shared Nervos DAO rules) and four directories by concern: `src/order` (UDT limit orders and matching), `src/conversion` (state read, projection, estimates, plans, the withdrawal ring, completion), `src/send` (sign, send, wait), and `src/utils` (the one uncached cell paging loop and shared helpers). The only barrel is `src/index.ts`. The only runtime dependency is `@ckb-ccc/core`, and nothing here imports Node built-ins, so the package runs in the browser.

## Send Confirmation

`signAndSendTransaction(signer, tx, recordTxHash?)` signs locally, checks the signed fee rate against the CCC maximum that `sendTransactionNoCache` bypasses, and calls `recordTxHash` with `signed.hash()` before starting the send RPC. Before that fee check, it rejects a signer or connector that returns different ordered inputs, outputs, or outputs data than it was handed; witnesses, `cellDeps`, and `headerDeps` remain signer-owned, and the fee ceiling values inputs from the pre-sign transaction. That local hash is authoritative and is what callers wait on; the hash the node returns is not compared. A node reporting a duplicate of this exact transaction is an acceptance. Any other send failure is ambiguous and throws `TransactionBroadcastError` carrying `txHash`. The client cache is never marked.

`waitTransaction(client, txHash, { timeout?, interval?, signal? })` observes one already-broadcast transaction for a single bounded window and returns it once the node reports it committed. `timeout` defaults to 60000 ms, must be a non-negative safe integer no larger than one host timer delay, and is the absolute budget for the whole wait including in-flight client operations; `interval` defaults to 2000 ms. For `ClientJsonRpc`, it raw-polls `get_transaction` verbosity 1 so status-only rejections are preserved despite the current CCC cache issue. Every transaction body read uses `getTransactionNoCache`, also for non-JSON clients, and is normalized through `ccc.ClientTransactionResponse.from` so a generic client returning a malformed body is treated as unconfirmed rather than as commitment. Every Stack caller waits at depth zero for one window and then rebuilds from committed state; a consumer that needs depth would get it as an additive option.

Headers whose timestamp is at least 500 s old are served from CCC's confirmed-header cache, which `ClientCacheMemory.clear()` does not empty; a consumer that must forget a header after a failed transaction gives its client a new cache, as the Stack interface does, since a deep reorg is possible on CKB, where one pool holds a majority of the hash power. A terminal rejection throws `TransactionWaitError` with `txHash`, `status`, and the node `reason`; the next attempt rebuilds from exact committed cells, so nothing here clears or marks the client cache. Timeout uses CCC's `ErrorClientWaitTransactionTimeout`. CCC transports cannot be cancelled, so an in-flight operation may complete after the waiter rejects; its late settlement is handled. Callers own what follows a closed window: this helper never reopens one.

## Epoch Semantic Versioning

This repository follows [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver). In short ESV aims to provide a more nuanced and effective way to communicate software changes, allowing for better user understanding and smoother upgrades.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/tree/master/sdk) and it is released under the [MIT License](https://github.com/ickb/stack/tree/master/LICENSE).
