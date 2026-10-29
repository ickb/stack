# iCKB SDK

`@ickb/sdk` builds iCKB conversions on CCC. Construct it with `IckbSdk.fromChain(chain)`, read account state, build a funded transaction, then sign, send and wait. The public surface follows that workflow and includes the types its signatures need; managers and raw deployment configuration are internal.

## Layout

The top-level script modules are `src/udt.ts` (iCKB), `src/logic.ts` (deposits and receipts), `src/owned_owner.ts` (requests and withdrawals) and `src/dao.ts` (shared Nervos DAO rules). The other concerns are:

- `src/order/`: UDT limit orders and matching.
- `src/conversion/`: state projection, estimates, plans, the withdrawal ring and completion.
- `src/send/`: signing, broadcast and confirmation.
- `src/utils/`: shared readers and codecs.

`src/index.ts` is the only barrel. The package has one runtime dependency, `@ckb-ccc/core`, and no Node built-ins. A separate DAO manager layer had one caller per operation and no raw-DAO consumer, so those operations now live with the iCKB script that uses them. Internal barrels and alternate public entry points would recreate boundaries without another consumer.

## Account state

`getL1AccountState(client, locks, lockUp)` reads the account, pool and order book. The caller supplies a `LockUpPolicy`, carried on `system.lockUp`; deposits carry a sampled `claimEpoch`, and readers apply the caller's policy to decide readiness. [`src/dao.ts`](src/dao.ts) defines the wallet and bot presets. A human can leave a wallet popup open, so the wallet's selection and broadcast margins are wider than the bot's.

Each account lock is scanned once, unfiltered, then classified by cell kind. The book is also read once: the market sees orders past par, while the account sees its own orders. An older order from the same wallet legitimately queues ahead of its new one. Dual-ratio orders are valid on chain but excluded by the scan because Stack neither places nor handles them; they are not matched, estimated, displayed or collected here.

Every cell scan uses the uncached [`findCells`](src/utils/utils.ts) loop with pages of 400, ending on the first short page. It reads the indexer's raw answer through the client's JSON-RPC requestor, because the answer carries each cell's block number and CCC's typed scan drops it: receipts, deposits and withdrawal requests then read their committing header by number, instead of asking the node for each creating transaction's status first. The number is the node's claim either way. A client without a requestor cannot scan; the connector's composition proxy forwards it. Pages stay at 400 because CKB's sample config recommends that `request_limit`, and a node configured with it refuses a larger page rather than truncating it. There is no aggregate scan budget or page-size option: a large account or book costs a slower read rather than a partial result. A full page whose cursor does not advance throws. The cursor is only a continuation key, not a snapshot; one traversal can return a cell and its successor. Planning must tolerate that rather than assume page coherence.

Transaction and header reads are batched before pure decoding. This replaced promise caches and batch-specific reader wrappers; each deposit carries its value instead of being valued again downstream. CCC's speculative broadcast cache is not authority for committed cells. An origin transaction cached without a block number is refreshed, as the comment at the order reader explains.

Headers are verified by the client, not the readers: `verifiedClient` wraps any CCC client and checks every header it hands out against the header's own hash, and a header read by number or by hash against what was asked for; the tip, headers by number and by hash, and the header beside a transaction or a cell are covered. A transaction read by hash must hash to that hash, so a body the SDK builds on, such as an order's origin, is the one the chain committed; CCC's own cache keys transactions by their body's hash, so its hits need no check. A header's DAO rate sets the interest a withdrawal collects and the iCKB a deposit is worth, and CCC's own completion values that interest from headers it reads through the client it is given, so the check has to sit on the client to cover the SDK's reads and CCC's alike. The header beside a transaction or a cell is pinned only to the block the node names for it, so a node can still answer another real block there; the chain values a transaction at the headers it names in its deps, and the [send check](#signing-and-broadcast) refuses an input valued outside them and proves which block committed a withdrawal request. Nothing binds the tip on chain: its hash check catches a tampered real tip, and the optional age bound, `tipMaxAgeMs(policy)`, the selection margin less the broadcast reserve, five minutes for the bot and thirty for a wallet, catches an honest node that has fallen behind; an invented fresh tip passes both, which the policies bound to one turn's balances. The bot, the generator and the interface wrap their clients; a consumer that does not gets node claims. They also open their clients with `clientCache()`: CCC's default cache keeps 128 blocks, fewer than a pool's deposits span, so every read refetched most headers; the larger cache holds them, and a cached header is still checked.

## Transaction completion

`buildConversionTransaction(...)` returns a completed transaction funded from the cells in its state read. It never discovers more inputs while trying candidates. The [root user-lock assumption](../README.md#user-locks) applies to both the wallet's lock and a caller-supplied destination.

The SDK tries the most direct plan first and returns the first that completes. Completion is the only authority on affordability: markers, remainder orders, change and fees all affect the answer. Removing one withdrawal can introduce a remainder order costing more capacity than the removed marker, so binary search or a policy-side count bound would be wrong. Typed fundability failures advance the walk; transport, scan, signer and malformed-transaction failures propagate. When every candidate fails, the last fundability failure is thrown.

The ready-deposit selection excludes [ring anchors](node/docs/policy.md#rebalancing-and-the-maturity-ring) to preserve the pool's spread of maturities. If every ready deposit is an anchor, only an order plan remains.

Direct-first deliberately favors a known claim date and avoiding an order fee over a faster estimated bot fill. A user may therefore receive a direct withdrawal days away even when an order could be filled in minutes. The estimate describes the chosen plan; it does not rank candidates. The greedy maturity-ordered selection also accepts a larger remainder order where an exact best-fit search could withdraw more directly. Capped deposits and the bot's regular deposit sizes reduce that cost without another combinatorial selector.

### Funding and compaction

Inputs needed by the outputs go in first, largest first. The completer then sweeps remaining liquid cells until the transaction has 1,000 inputs, about 50 KB. That is a compaction target, not a size bound: funding the outputs can exceed it outright, and fee completion can use cells left after the sweep. An integrator should expect a transaction to spend more of the account than the requested amount alone requires: compaction is deliberate.

The sweep limit does not bound the whole transaction. Receipts and collectable orders are added in full, while required funding can exceed that limit. Large collection backlogs can therefore produce an oversized transaction; rebuilding from the same state may repeat the failure. Whole-transaction sizing remains an open design issue.

Plain-cell discovery does not filter mining rewards by cellbase maturity. If the scan returns an immature reward, completion can include it and the node rejects the transaction; rebuilding can select it again until it matures. This limitation is accepted: current use cases do not justify reward-specific discovery checks and their complexity.

CKB capacity and iCKB quantity stay separate, in bigint. An input's full capacity funds the transaction, but the outputs' occupied capacity, a plain change cell, any order master and the fee still have to be paid. Ordinary change remains a plain cell; existing typed outputs are never repurposed as fee change. A duplicate input is a builder defect detected by completion.

CCC prepares the signer and resolves the witness-aware fee; Stack owns the selected cells and output shape. Calling CCC's input collectors would introduce another discovery path with different cache and filtering rules. All candidate plans use the same sampled state.

DAO output and deposit-header limits come from the deployed script, not a general consensus output cap. Their constants and reasons live in [`src/dao.ts`](src/dao.ts). Collected withdrawals' deposit headers go first, making the projection's batch of at most 256 matured withdrawals addressable regardless of other headers. The claim-epoch model test compares installed CCC with a pinned transcription of deployed `dao.c`, so a dependency regression fails the gate rather than being hidden behind a local copy.

## Signing and broadcast

`signAndSendTransaction(signer, tx, recordTxHash?, broadcastBefore?)` signs locally, then checks the body, fee rate and optional epoch deadline before sending.

- Every input is verified before signing: its creating transaction is read from the client cache, else the node, and accepted only when its hash is the one the `OutPoint` names, so the output at the index is the real cell. A planned cell that differs from it in capacity, lock, type or data is rejected. The default lock signs each input as its `OutPoint` only, so without this a node understating a plain cell's capacity or an iCKB amount would turn the difference into fee or a burn on a transaction that passes every other check. One `get_transaction` per distinct creating transaction not already cached.
- Different ordered inputs, outputs or outputs data are rejected. Witnesses, `cellDeps` and `headerDeps` remain signer-owned. The fee ceiling values the verified inputs, and a phase-2 DAO input's interest at the deposit and request headers the transaction names in its deps: CCC values that interest from headers it reads afresh, which a node can answer with another real block, while the chain reads the deps, so an input valued at a header outside them, or at a request header not after its deposit as the deployed dao.c requires, is refused. The deps alone bind the request header to some block the transaction names, not to the block that committed the input, so in a withdrawal of several requests a node could swap which named request header values which input, paying the rate drift between the two blocks times the capacity imbalance to the miner. The send therefore asks the node for each request transaction's `get_transaction_proof` against the request header it valued, and refuses unless the Merkle path from the transaction's hash reaches that header's transactions root, which the header's own hash binds; a proven pair is kept for the process's life, so a withdrawal costs one call of a few hundred bytes per request block once. Rejected: reading the whole block, which proves the same at up to hundreds of kilobytes; a second node, which replaces proof with trust; a planner rule valuing every request at the highest-numbered dep, which closes the swap without a call but splits withdrawals by block; an on-chain script recomputing a digest of the inputs and their headers, whose carrier cell a flow's last transaction leaves behind; and accepting the swap, the earlier choice. Deposits, receipts and their headers need no proof: iCKB Logic settles them with strict equality, so a wrong header gets the transaction refused, and a deposit header is matched by the number in the verified cell data.
- The signed fee rate must not exceed CCC's maximum, which `sendTransactionNoCache` bypasses. There is no operator override that could silently disable this protection.
- A withdrawal plan carries `broadcastBefore`, the earliest selected claim less the policy's reserve. After signing and the fee check, one fresh tip read rejects an expired plan with `TransactionExpiredError`, without broadcasting. Timing uses epochs because CKB has no transaction expiry and a request committed after its claim can lock the deposit for another cycle.

`recordTxHash` receives `signed.hash()` before the send RPC starts. That local hash is authoritative; no hash returned by a node replaces it. Comparing a successful response's hash could only reject after the node had already received the transaction. A duplicate response is accepted only when it names the local hash. Every other send failure is ambiguous and throws `TransactionBroadcastError` carrying `txHash`; callers can observe that hash instead of resending. The client cache is never marked by this helper.

## Confirmation

`waitTransaction(client, txHash, { timeout?, interval?, signal? })` observes one already-broadcast transaction for a bounded window and returns it once the node reports commitment, at depth zero. `timeout` defaults to 60,000 ms and covers the whole wait, including in-flight client operations; it must be a non-negative safe integer no larger than a host timer delay. `interval` defaults to 2,000 ms.

A client exposing a JSON-RPC requestor is polled with `get_transaction` verbosity 1, including the connector's composition proxy. CCC's typed read hides a rejected transaction with a null body, so raw status is needed to preserve rejection evidence. Body reads use `getTransactionNoCache` and are normalized with `ccc.ClientTransactionResponse.from`; a malformed generic-client response is treated as unconfirmed. The typed path remains for clients without a requestor.

A terminal rejection throws `TransactionWaitError` with the hash, status and node reason. Timeout uses CCC's `ErrorClientWaitTransactionTimeout`. Aborting or timing out stops the wait, but CCC transports may still finish their in-flight work; late settlement is handled. Nothing clears or marks the cache here.

Callers own what follows a closed window. The actors rebuild from committed state next turn; the app can reopen a window on the same hash without another signature or broadcast. No caller needs positive confirmation depth today; it could be added without replacing this helper. There is no durable signed-byte store, replay graph or pending overlay. Such a store would need reconciliation on every start, while duplicate intent remains an accepted consequence of rebuilding rather than persisting intent.

CCC caches sufficiently old headers even across `ClientCacheMemory.clear()`. A consumer that must discard them after a failed transaction gives the client a new cache, as the [interface](../interface/README.md#wallet-session-and-client) does; a deep reorg is possible, so age alone does not make a header immutable.

## Estimates and fees

[Pool maturity estimates](docs/pool_maturity_estimates.md) explains the model and its limits. The default order fee lives beside the quote and plan code in [`src/conversion/estimate.ts`](src/conversion/estimate.ts). It buys a window for a bot to fill a buy before DAO growth erodes its incentive; it is not a completion guarantee.

## Versioning and API checks

The repository follows [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver). The [release policy](../README.md#releases) explains this rewrite's starting version.

Before this rewritten API is first published, its shape follows actual consumers rather than a committed API report. API Extractor still rejects forgotten exports, so every type reachable from the entry point is importable. A frozen report and release tags would add maintenance without a compatibility promise yet; revisit the report when the new surface has published consumers.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/tree/master/sdk) and released under the [MIT License](../LICENSE).
