# Scans

How the [state read](state_read.md) finds its cells, then batches and dates what it found.

## One scan per lock

Each account lock is scanned once, unfiltered, then sorted by cell kind. The order book is also read once: the market sees every order past par, the account sees its own. An older order from the same wallet can rightly queue ahead of its new one.

Dual-ratio orders are valid on chain, but nothing in the stack places them. So the scan drops them: they aren't matched, estimated, shown or collected here.

## The page loop

Every scan uses the uncached [`findCells`](../src/utils/utils.ts) loop, 400 cells a page, stopping at the first short page:

- **Raw answers:** it reads the indexer answer through the JSON-RPC requestor of the client, because that answer carries the block number of each cell. The typed CCC scan drops it. Receipts, deposits and withdrawal requests then read their committing header by number, instead of first asking the node for the status of each creating transaction. The number is the claim of the node either way.
- **JSON-RPC only:** the SDK needs a JSON-RPC client for its raw reads (scans, status polls, transaction proofs). The composition proxy of the connector forwards the requestor. There's no typed fallback: CCC has none, while two code paths per read would have to be kept equal.
- **Pages of 400:** the CKB sample config recommends that `request_limit`. A node set that way refuses a bigger page instead of cutting it.
- **No budget:** there's no total scan limit, no page-size option. A large account or book costs a slower read, never a partial one.
- **Cursors:** a full page whose cursor doesn't move throws. The cursor is only a key to continue from, not a snapshot, so one walk can return a cell then its successor. Planning has to tolerate that.

## Batches

Transaction and header reads are batched before the decoding, which is pure. Concurrent reads of one block header, or of one creating transaction, share a request inside the [verified client](node_trust.md#the-verified-client). That client lives for one read. So a batch passes its block numbers as they come: no reader dedupes its own. Each deposit carries its value, so nothing downstream values it again.

The CCC speculative broadcast cache isn't trusted for committed cells.

## Order dates

An order cell is dated by the block the scan reports for it: the last fill, or the mint while it's unfilled. Its origin is dated by the block of the master, because the master is created beside the mint order, then never changes until it's melted. So no status read is needed. The origin transaction is read cache first. The body is checked against its hash, cached or not; the order in it stays a node's claim until the send checks every cell it spends.

Each group also carries the header of the master block, the mint one, read beside its origin: it's when the order was placed (the `createdAt` of `datesOf`). The verified client shares one read among the groups minted in one block. The CCC client cache keeps a header once it's about eight minutes old (50 blocks). So a read costs one header request per order minted in the last eight minutes or so, plus whatever the cache has dropped.
