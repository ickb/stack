# Operating Assumptions

What the bot expects from its node and its funding, with what recovery does and doesn't promise.

## The node

Prefer an exclusive node with `[indexer_v2] index_tx_pool = false`. With pool indexing on, a timed-out intent can be duplicated with disjoint inputs on a later turn. A public node is acceptable when the operator accepts that risk.

## Funding

The recommended funding is about 3.2 deposits of total value plus the reserve:

- **iCKB:** 1.2 deposits before withdrawal.
- **CKB to refill:** one deposit.
- **CKB for sellers:** one deposit, kept.

The stress line counts the reserve, but a coverage deposit needs two deposits of CKB beyond it, so the reserve stays on top ([rebalancing](rebalancing.md)). Recompute the recommendation when the thresholds change.

Below two deposits of CKB, the bot matches, refills and sheds surplus, but never seeds the ring. Below one deposit of CKB, it still matches what it can, but may idle at its reserve.

## Recovery

No process state needs clearing after a failed turn, a partial collection or a reorg. Recovery still depends on the inventory at hand, the chain state and the market. It isn't a promise to serve every order, nor to make an unfunded account progress.
