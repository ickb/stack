# Reading the State

What `readState` reads, under which timing rules, plus the pool figures it adds. How it scans is in [scans](scans.md). What a node can still lie about is in [node trust](node_trust.md).

## The call

`readState(signer)` is the one public read. It asks the signer for its locks on every call, the recommended one first, so the next read scans an address the wallet adds. It reads under `WALLET_LOCK_UP`, keeps the recommended lock as `state.changeLock`, then projects the result ([the projection](projection.md)).

Underneath, the internal `readRawState(client, locks, lockUp, maxFeeRate?)` reads the account, the iCKB pool and the order book in one go. The bot calls it directly, with the locks of its own keys, `BOT_LOCK_UP` and its fee cap:

- **`maxFeeRate`:** caps the fee rate the node samples, through the CCC `getFeeRate`. Everything that reads the state then plans at one rate: completion, the planned fee, the collect rule, the estimates. The bot config refuses a cap under the CCC minimum fee rate, so the read takes it as given. CCC would read zero as no cap at all.
- **`state.depositCapacity`:** the CKB a cap-sized deposit takes at the sampled exchange ratio. It's computed once here, for the planners, the estimates and the bot.
- **`lockUp`:** the timing rules of the caller for withdrawal requests, carried on `state.lockUp`. Deposits carry a sampled `claimEpoch`. Readers apply the policy of the caller to decide if one is ready.

## Lock-up presets

[`src/dao.ts`](../src/dao.ts) defines two presets. A person can leave a wallet popup open, so `WALLET_LOCK_UP` has wider margins than `BOT_LOCK_UP`.

Each preset can send a fresh, ready request: `0 < broadcastReserve < minLockUp < maxLockUp`, with `minLockUp` under one DAO cycle. Only those two policies reach the read, so a unit test on them pins the rule, rather than a check on every read. Every claim lies within a cycle of the tip, so a `maxLockUp` past one cycle is clamped to it rather than refused.

A policy option on `readState` was left out. Under `WALLET_LOCK_UP` a direct withdrawal may have to be sent as little as thirty minutes after its build. So a signer slower than that, such as a multisig collecting signatures over hours, can see a direct iCKB to CKB conversion end `expired`, again after each rebuild. Taking a policy would add the runtime check above to every read, for custodians nobody has asked for yet. Reopen when one does.

## Pool and APY

`state.poolIckb` and `state.poolCkb` total the pool deposits the read already valued. They take no read of their own:

- **`poolIckb`:** the iCKB each deposit is worth at its deposit header, a deposit above the soft cap at its 10% discount on the excess.
- **`poolCkb`:** the CKB each deposit holds, capacity plus DAO interest to the tip.

`state.apyPercent` is the nominal yearly DAO rate in percent. It comes from the live tip header and its parent, the header the state is priced at:

```text
(ar_live - ar_parent) / ar_parent × L × 6 × 365 × 100
```

`ar` is the accumulated rate in the DAO field of each header. `L` is the epoch length in blocks of the live header.

The accumulated rate grows each block by the share of that block in the secondary issuance of its epoch (`util/dao` in nervosnetwork/ckb). So one block of growth times a year of blocks gives the rate without the noise of block timestamps. The epoch length of the live header counts, since its block is the one the growth was issued in. Across an epoch boundary the parent would give the length of the previous epoch, about 15% off.

It's computed in bigint fixed point, then converted to a number once. The rate is nominal, not compounded.

At mainnet block 20,977,589 this gave 2.035878%, against 2.031789% for the seven-day window of NervDAO and 1.98% in Neuron.
