# Bot Policy

One process reads committed state, builds at most one transaction, signs, sends, waits, and exits. [`policy.ts`](../src/bot/policy.ts) chooses rebalances, [`match.ts`](../src/bot/match.ts) chooses fills, [`transaction.ts`](../src/bot/transaction.ts) builds candidates, and [`turn.ts`](../src/bot/turn.ts) sends the first fundable one.

## One turn

1. Match profitable orders using the current inventory.
2. On the resulting balances, try a deposit, then a withdrawal chain, then the match or collections alone. A transaction never carries both a deposit and a withdrawal request.
3. Collect receipts and matured withdrawals on every candidate. Complete iCKB, capacity and fees from the sampled liquid cells, sweeping spare cells along.
4. Send only if a match, deposit, withdrawal request or collection remains. Compaction alone never sends.

A skip or commit exits `0`; any failure exits `1`. The next process reads the chain again. There is no capital hold: an underfunded account can recover as soon as it is funded, whereas a hold turned that self-healing retry into unattended downtime. There is no durable pending store. A rebuilt transaction can conflict with a pending one or be a second independently valid transaction; duplicate intent is an accepted risk, not prevented by the turn model.

## Matching makes progress from available inventory

The bot places no orders. Its book is every order past par, regardless of owner. It shuffles once using a logged seed from the tip hash, then repeatedly:

- sizes each order's largest fill payable from the remaining balances;
- probes the exact matcher and subtracts ten mining fees from the fill's exchange value;
- takes the fill returning most per unit of value paid and applies its balance changes.

The ten-fee margin pays for the rebalancing a fill commits the bot to. The loop stops when no payable fill clears that cost or at 58 partials, leaving room for other outputs under the deployed DAO script's 64-output limit. There is no second whole-transaction profit gate: housekeeping fees do not veto a match that already passed its own gate.

This replaces whole-book search. Minimum fills, rounding, fixed fees and the partial cap defeated the search's dominance assumptions; bounded searches could spend their budget in dead ends before finding a feasible pair. A solver would add a dependency without removing that combinatorial problem. The simpler contract is progress per turn, not the best combination across the book.

The cost is explicit: buyers and sellers fund each other only across successive fills; a cross requiring both directions at once from empty inventory is not attempted. A whole-only order beyond the balances waits, and a losing order is never a bridge. Better-priced orders can win repeatedly, so there is no eventual-service guarantee. Shuffling breaks fixed-order ties, not price priority.

### Partials and the refill threshold

A partial leaves at least the order's own minimum match. An order smaller than twice that minimum is taken whole or left. This avoids stranding a fresh remainder under the fill-cost floor when the bot's balance is just short of a full fill.

The SDK's default minimum is `2^36` shannons, about 687 CKB. **Twice the minimum, converted to iCKB, must remain below the bot's refill threshold.** Otherwise a buyer can be too large to fill whole and too small to split while the bot still holds enough iCKB not to refill. The coupling is documented at both [`CKB_MIN_MATCH_LOG_DEFAULT`](../../src/order/info.ts) and [`ICKB_REFILL_BELOW`](../src/bot/policy.ts).

The minimum is a proxy, not a promise about future fees or prices: an aged buyer's remainder can still become unprofitable. The rule also refuses profitable splits inside the whole-only band; a bot slightly short of a seller's whole amount leaves it waiting. A fee-aware remainder would add a forecast and another threshold to maintain. The default instead leaves headroom at the fee rates observed when it was selected, without raising the inventory band.

## Rebalancing and the maturity ring

The policy uses the balances after matching. A deposit has priority among fundable candidates:

- Deposit one cap-sized amount if iCKB is below 2,000, or the ring segment containing the tip holds less than half its equal share of the pool's iCKB. Keep 1,000 CKB after the planned deposit. One deposit serves either reason.
- Otherwise withdraw ready surplus deposits while iCKB exceeds 120,000, retaining 20,000. Walk earliest claims first, skipping deposits that do not fit the iCKB budget. If the deposit candidate cannot complete, try this withdrawal in the same turn.

The band is expressed in [`policy.ts`](../src/bot/policy.ts) in units of the 100,000-iCKB deposit cap: refill below `Q/50`, retain `Q/5`, withdraw above `Q + Q/5`. A refill lands below the withdrawal line, while a withdrawal keeps ten times the refill line. These inventory thresholds replace demand-derived floors; a changing book does not redefine the bot's operating band.

The ring spreads deposit maturities over a DAO cycle. It partitions the cycle into a power-of-two number of segments based on the pool's deposit count and protects one anchor per occupied segment, preferring a non-ready deposit. Unlike fixed-width windows, segments shrink as the pool grows; doubling splits each old segment into two.

Under stress, ready anchors may be withdrawn too: spendable CKB, liquid capacity less the reserve, is below one fifth of a deposit's cost including its receipt. Serving a waiting user takes priority over dispersion. Taking an anchor can cost that segment its coverage for a cycle; the ring is a heuristic, not a liquidity guarantee.

## Completion owns affordability

The bot tries prefixes of one greedy withdrawal chain, longest first, using the [SDK completer](../../README.md#transaction-completion) as the oracle. A shorter prefix needs fewer markers and less iCKB. Trying every possible start made this walk quadratic in ready deposits; a later-start chain can still fund where these prefixes do not when the sweep cannot reach iCKB counted by the projection. That missed opportunity is accepted; a later sent transaction consolidates the account.

Collections and the liquid sweep stay on each candidate. A matured withdrawal brings in CKB; a receipt becomes an iCKB cell of about its own capacity; neither adds a DAO output. Funding the action comes first. The aligned action prefix stays first in the transaction, with housekeeping appended. The projection selects at most 256 matured withdrawals for one transaction because the deployed DAO script addresses only that many deposit-header slots; the rest wait for another turn.

### Why the reserve is not a final check

Matches and deposits are sized to leave 1,000 CKB in liquid cells, plain and iCKB alike. Completion can draw on it for the transaction fee, a receipt and an iCKB change cell when there was none to sweep. Withdrawal chains are sized in iCKB, so their owner markers can spend CKB down to fee headroom.

A final reserve check stalled live turns: the bot selected a fill sized to the reserve, completion paid the transaction's remaining costs, then the check rejected the result. The next turn selected the same fill. Raising the reserve moves both lines; adding tolerance creates a second sizing rule. Completion is therefore the funding authority, and the next turn plans from the actual balance.

The reserve is not a loss limiter. A builder defect that gave capacity away would need to be caught by tests and the journal's balance changes, not by that removed check.

## Withdrawal timing and confirmation

The bot uses [`BOT_LOCK_UP`](../../src/dao.ts). Its selection window and broadcast reserve use epochs; the minutes in that source comment assume a nominal four-hour epoch. A fresh tip read after signing refuses an expired request before broadcast, because committing after the claim can lock the deposit for another cycle. CKB has no transaction expiry that can enforce this after broadcast.

The bot waits up to two minutes so its journal can join a send to a commit. It rebuilds next turn whether that wait succeeds or not. A long wait on a stuck request consumes time that could be used to rebuild before the claim; rebuilding can repair a dropped or replaceable request, not accelerate one still pending. The timeout and interval live in [`turn.ts`](../src/bot/turn.ts).

## Operating assumptions

- Prefer an exclusive node with `[indexer_v2] index_tx_pool = false`. With pool indexing on, a timed-out intent can be duplicated with disjoint inputs on a later turn. A public node is acceptable when the operator accepts that risk.
- Recommended funding is about 2.5 deposits of total value plus the reserve: 1.2 deposits of iCKB before withdrawal, one deposit's worth of CKB to refill, and roughly half a deposit to continue serving sellers while a withdrawal matures. Recompute the recommendation if the thresholds change. Below it the bot still matches what it can but may idle at its reserve.
- No process state has to be cleared after a failed turn, partial collection or reorg. Recovery still depends on the available inventory, chain state and market; it is not a promise to serve every order or to make an unfunded account progress.
