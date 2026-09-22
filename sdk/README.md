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

Every cell scan uses the uncached [`findCells`](src/utils/utils.ts) loop with pages of 400, ending on the first short page. There is no aggregate scan budget or page-size option: a large account or book costs a slower read rather than a partial result. A full page whose cursor does not advance throws. The cursor is only a continuation key, not a snapshot; one traversal can return a cell and its successor. Planning must tolerate that rather than assume page coherence.

Transaction and header reads are batched before pure decoding. This replaced promise caches and batch-specific reader wrappers; each deposit carries its value instead of being valued again downstream. CCC's speculative broadcast cache is not authority for committed cells. An origin transaction cached without a block number is refreshed, as the comment at the order reader explains.

## Transaction completion

`buildConversionTransaction(...)` returns a completed transaction funded from the cells in its state read. It never discovers more inputs while trying candidates. The [root user-lock assumption](../README.md#user-locks) applies to both the wallet's lock and a caller-supplied destination.

The SDK tries the most direct plan first and returns the first that completes. Completion is the only authority on affordability: markers, remainder orders, change and fees all affect the answer. Removing one withdrawal can introduce a remainder order costing more capacity than the removed marker, so binary search or a policy-side count bound would be wrong. Typed fundability failures advance the walk; transport, scan, signer and malformed-transaction failures propagate. When every candidate fails, the last fundability failure is thrown.

The ready-deposit selection excludes [ring anchors](node/docs/policy.md#rebalancing-and-the-maturity-ring) to preserve the pool's spread of maturities. If every ready deposit is an anchor, only an order plan remains.

Direct-first deliberately favors a known claim date and avoiding an order fee over a faster estimated bot fill. A user may therefore receive a direct withdrawal days away even when an order could be filled in minutes. The estimate describes the chosen plan; it does not rank candidates. The greedy maturity-ordered selection also accepts a larger remainder order where an exact best-fit search could withdraw more directly. Capped deposits and the bot's regular deposit sizes reduce that cost without another combinatorial selector.

### Funding and compaction

Inputs needed by the outputs go in first, largest first. The completer then sweeps remaining liquid cells while about 64 KiB of prepared size allows; the budget is checked before each input, so the last may overshoot. Funding the outputs can exceed that budget outright, and fee completion can use cells left after the sweep. An integrator should expect a transaction to spend more of the account than the requested amount alone requires: compaction is deliberate.

The sweep budget does not bound the whole transaction. Receipts and collectable orders are added in full, while required funding can exceed that budget. Large collection backlogs can therefore produce an oversized transaction; rebuilding from the same state may repeat the failure. Whole-transaction sizing remains an open design issue.

Plain-cell discovery does not filter mining rewards by cellbase maturity. If the scan returns an immature reward, completion can include it and the node rejects the transaction; rebuilding can select it again until it matures. This limitation is accepted: current use cases do not justify reward-specific discovery checks and their complexity.

CKB capacity and iCKB quantity stay separate, in bigint. An input's full capacity funds the transaction, but the outputs' occupied capacity, a plain change cell, any order master and the fee still have to be paid. Ordinary change remains a plain cell; existing typed outputs are never repurposed as fee change. A duplicate input is a builder defect detected by completion.

CCC prepares the signer and resolves the witness-aware fee; Stack owns the selected cells and output shape. Calling CCC's input collectors would introduce another discovery path with different cache and filtering rules. All candidate plans use the same sampled state.

DAO output and deposit-header limits come from the deployed script, not a general consensus output cap. Their constants and reasons live in [`src/dao.ts`](src/dao.ts). Collected withdrawals' deposit headers go first, making the projection's batch of at most 256 matured withdrawals addressable regardless of other headers. The claim-epoch model test compares installed CCC with a pinned transcription of deployed `dao.c`, so a dependency regression fails the gate rather than being hidden behind a local copy.

## Signing and broadcast

`signAndSendTransaction(signer, tx, recordTxHash?, broadcastBefore?)` signs locally, then checks the body, fee rate and optional epoch deadline before sending.

- Different ordered inputs, outputs or outputs data are rejected. Witnesses, `cellDeps` and `headerDeps` remain signer-owned. The fee ceiling values inputs from the pre-sign transaction.
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
