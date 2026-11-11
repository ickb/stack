# Reading the State

What `readState` reads and why it reads it that way. What a node can still lie about is in [node trust](node_trust.md).

## The call

`readState(signer)` is the one public read. It asks the signer for its locks on every call, the recommended one first, so an address the wallet adds is scanned at the next read. It reads under `WALLET_LOCK_UP`, keeps the recommended lock as `state.changeLock` and projects the result ([the projection](projection.md)).

Underneath, the internal `readRawState(client, locks, lockUp, maxFeeRate?)` reads the account, the iCKB pool and the order book in one go. The bot calls it directly, with its own keys' locks, `BOT_LOCK_UP` and its fee cap:

- **`maxFeeRate`:** caps the fee rate the node samples, through the CCC `getFeeRate`. Everything that reads the state then plans at one rate: completion, the planned fee, the collect rule and the estimates. The bot's config refuses a cap under CCC's minimum fee rate, so the read takes it as given; CCC would read zero as no cap at all.
- **`state.depositCapacity`:** the CKB a cap-sized deposit takes at the sampled exchange ratio. It's computed once here, for the planners, the estimates and the bot.
- **`lockUp`:** the caller timing rules for withdrawal requests, carried on `state.lockUp`. Deposits carry a sampled `claimEpoch`. Readers apply the caller policy to decide if one is ready.

[`src/dao.ts`](../src/dao.ts) defines two presets. A person can leave a wallet popup open, so `WALLET_LOCK_UP` has wider margins than `BOT_LOCK_UP`.

Each preset can send a fresh, ready request: `0 < broadcastReserve < minLockUp < maxLockUp`, with `minLockUp` under one DAO cycle. Only those two policies reach the read, so a unit test on them pins the rule, rather than a check on every read. Every claim lies within a cycle of the tip, so a `maxLockUp` past one cycle is clamped to it rather than refused.

## Scans

Each account lock is scanned once, unfiltered, then sorted by cell kind. The order book is also read once: the market sees every order past par, the account sees its own. An older order from the same wallet can rightly queue ahead of its new one.

Dual-ratio orders are valid on chain, but nothing in the stack places them. So the scan drops them: they aren't matched, estimated, shown or collected here.

Every scan uses the uncached [`findCells`](../src/utils/utils.ts) loop, 400 cells a page, stopping at the first short page:

- **Raw answers:** it reads the indexer answer through the client JSON-RPC requestor, because that answer carries the block number of each cell and the typed CCC scan drops it. Receipts, deposits and withdrawal requests then read their committing header by number, instead of first asking the node for the status of each creating transaction. The number is the node claim either way.
- **JSON-RPC only:** the SDK needs a JSON-RPC client for its raw reads (scans, status polls, transaction proofs). The connector composition proxy forwards the requestor. There's no typed fallback: CCC has none, while two code paths per read had to be kept equal.
- **Pages of 400:** the CKB sample config recommends that `request_limit`. A node set that way refuses a bigger page instead of cutting it.
- **No budget:** there's no total scan limit and no page-size option. A large account or book costs a slower read, never a partial one.
- **Cursors:** a full page whose cursor doesn't move throws. The cursor is only a key to continue from, not a snapshot, so one walk can return a cell and its successor. Planning has to tolerate that.

## Batches and dates

Transaction and header reads are batched before the decoding, which is pure. Concurrent reads of one block's header or one creating transaction share a request inside the [verified client](node_trust.md#the-verified-client), which lives for one read, so a batch passes its block numbers as they come and no reader dedupes its own. Each deposit carries its value, so nothing downstream values it again.

The CCC speculative broadcast cache isn't trusted for committed cells.

An order cell is dated by the block the scan reports for it: the last fill, or the mint while it's unfilled. Its origin is dated by the master block, because the master is created beside the mint order and never changes until it's melted. So no status read is needed. The origin transaction is read cache first. A cached body is trusted like the scan itself: the send checks every cell it spends anyway.

Each group also carries the header of the master's block, the mint's, read beside its origin: it's when the order was placed (`datesOf`'s `createdAt`). The verified client shares one read among the groups minted in one block, and CCC's client cache keeps a header once it's about eight minutes old (50 blocks), so a read costs one header request per order minted in the last eight minutes or so, plus whatever the cache has dropped.
