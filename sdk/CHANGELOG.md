# Changelog

What changed in `@ickb/sdk` and what to do about it. Versions follow [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver), so every breaking change takes the next major.

## Unreleased

### Breaking

- **`lock` is gone from `buildConversionTransaction`.** Every output and the change now belong to the signer's recommended lock. Drop the option. To move funds to another wallet, send them after the conversion.
- **`isSweepComplete` is gone from conversion results.** Drop it: the next build sweeps whatever a capped one left behind.
- **`signAndSendTransaction(signer, { tx, plannedFee, broadcastBefore? })`.** It takes the build result whole, so pass it on as returned. The hash callback is gone: read the hash from the returned value, or from `TransactionBroadcastError.txHash` when the send never answers.
- **`projectConversionTransactionContext` takes a fourth argument, `changeLock`.** Pass `(await signer.getRecommendedAddressObj()).script`.
- **`OrderGroup.blockNumber` is gone.** Read `group.origin.blockNumber` for the same block, the master's. `group.order.blockNumber` is the order cell's own: its last fill, or its mint.
- **`clientCache()` is gone; `CACHE_SIZES` replaces it.** Write `new ccc.ClientCacheMemory(...ickb.CACHE_SIZES)`, and add your app's own needs on top if it shares the client for other reads.
- **`OrderCell.isFulfilled()` is gone.** Use `!order.isMatchable()`.
- **A built conversion's `estimatedMaturity` covers that conversion only.** The account-wide date stays on the context. To show one date for both, take the later of the two.

### Changed

- An order the bot would fill whole in neither direction is collected by the owner's next transaction. The 30-day cutoff for stale orders is gone.
- `getL1AccountState` throws `RangeError` for a lock-up policy that could never send a ready request. A `maxLockUp` past one DAO cycle is clamped to it.
- `WALLET_LOCK_UP` now picks deposits claiming up to 42 epochs out, about 7 days, instead of 3 days.
- An amount of zero with nothing to collect is `nothing-to-do`.

### Added

- `projection.ckbConvertible`: the CKB a conversion can always take, for a Max button.
- `readyAt(position, system)`: when a pending position is ready.
- The whole SDK is also exported as the `ickb` namespace: `import { ickb } from "@ickb/sdk"`.
