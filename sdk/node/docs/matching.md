# Matching

How the bot picks which orders to fill each turn: progress from the inventory at hand, not the best combination across the book.

## The loop

The bot places no orders. Its book is every order past par, whoever owns it. It shuffles the book once with a logged seed, from the hash of the block the state was read at. Then it repeats:

1. Size the largest fill of each order the remaining balances can pay.
2. Probe the exact matcher. Subtract ten mining fees from the exchange value of the fill.
3. Take the fill returning most per unit of value paid. Apply its balance changes.

The ten-fee margin pays for the rebalancing a fill commits the bot to. The loop stops when no payable fill clears that cost, or at 58 partials. The cap leaves room for other outputs under the 64-output limit of the deployed DAO script.

There's no second profit gate on the whole transaction: housekeeping fees don't veto a match that already passed its own gate.

## Why not search the book

This replaced a search of the whole book. Minimum fills, rounding, fixed fees and the partial cap broke the dominance assumptions of the search. Bounded searches could spend their budget in dead ends before finding a feasible pair. A solver would add a dependency without removing that combinatorial problem. The simpler contract is progress per turn.

The cost:

- **Crosses:** buyers and sellers fund each other only across successive fills. A cross that needs both directions at once from empty inventory isn't tried.
- **Waiting:** a whole-only order beyond the balances waits. A losing order is never a bridge.
- **No service promise:** better-priced orders can win again and again. Shuffling breaks ties of fixed order, not price priority.

## Partials and the refill threshold

A partial leaves at least the minimum match of the order. An order smaller than twice that minimum is taken whole or left. This avoids stranding a fresh remainder under the fill-cost floor when the balance of the bot is just short of a full fill.

The default minimum of the SDK is `2^36` shannons, about 687 CKB.

**The coupling:** twice the minimum, converted to iCKB, must stay below the refill threshold of the bot. Otherwise a buyer can be too large to fill whole yet too small to split, while the bot still holds enough iCKB not to refill. The coupling is documented at both [`CKB_MIN_MATCH_LOG_DEFAULT`](../../src/order/info.ts) and [`ICKB_REFILL_BELOW`](../src/bot/policy.ts).

The minimum is a proxy, not a promise about future fees or prices: the remainder of an aged buyer can still turn unprofitable. The rule also refuses profitable splits inside the whole-only band. A bot slightly short of the whole amount of a seller leaves it waiting.

A fee-aware remainder was rejected: it would add a forecast and another threshold to maintain. The default instead leaves headroom at the fee rates seen when it was chosen, without raising the inventory band.
