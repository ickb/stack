# Pool Maturity Estimates

How the SDK dates an order-based conversion for the interface's "Ready:" line. The estimate models the [bot](../node/docs/policy.md); it is neither a protocol deadline nor a promise that a bot has the inventory to fill the order.

## Inputs

`getL1AccountState` samples one tip and reads:

- `system.orderPool`: every order past par on the book, the wallet's own included; the bot fills by price, not by owner. A dual-ratio order (both directions priced) is dropped at the scan: nothing in the stack places one, so it is neither matched, estimated, shown nor melted here.
- `system.poolDeposits`: every iCKB pool deposit with its sampled claim epoch, read here as its real claim date: rolled a cycle when the bot can no longer request it in time (under the bot's twenty-minute floor, `BOT_LOCK_UP`; the bot makes the requests, so its rule dates the supply whatever the caller's own policy). No readiness collapse: a deposit counts on its date, three days out or thirty.
- Each order group's `blockNumber`, the block that committed its origin, read from the same transaction response the scan already fetches. An uncommitted origin has none.

The bot's own working capital is not read. Naming one operator's wallet in a published library would turn a key rotation into an SDK release. Moving that address into interface configuration would only relocate the maintenance, so the model below stands in for it.

## The one duration

`BOT_TURN_MS` assumes ten minutes per turn, allowing for a one-minute restart delay, confirmation and slow reads. It is a modeling interval, not a runtime bound. The sitting-seller threshold below is its own heuristic, unrelated to the bot's twenty-minute lock-up floor (`BOT_LOCK_UP`).

An order counts on the book only when the bot would take it whole (`fillsWhole`: past par, over the ten-fee floor). Dust the bot ignores does not queue ahead of anyone and does not supply anyone.

## A seller (iCKB to CKB)

The seller waits for CKB. Supply, in time order:

1. Now: one deposit's worth of CKB (the cap at the DAO ratio) as assumed working capital. When another fillable seller has sat for more than a twenty-fourth of an epoch of blocks, the model treats that as a shortage signal and zeros this term. It does not measure the bot's balance.
2. Each pool deposit at its real claim date, earliest first, less the deposits the same plan withdraws directly (they cannot fill its order leg too).

Demand is the CKB this order pays out, plus the CKB of every fillable seller priced at or better than it (asking at most its CKB per iCKB; a tie is filled in an order of the bot's choosing, so it counts as ahead), valued at the DAO ratio. When the order is already on the book it is left out of its own queue.

The estimate is the first date whose cumulative supply covers the demand, plus one turn. When sampled supply is insufficient, it uses the last supply date plus one turn. That fallback can understate the wait: an above-par ask can need further DAO growth beyond the modeled claim dates. The function does not forecast when that price becomes profitable.

## A buyer (CKB to iCKB)

The buyer model assumes the bot can mint one cap-sized deposit per turn once its unknown inventory is spent. Net CKB demand is this request plus fillable buyers priced at least as well, less the iCKB brought by fillable sellers valued at the DAO ratio. The wait is one turn plus the whole number of deposit caps in positive net demand. This deliberately coarse throughput model does not check the bot's funds or availability.

## The date on screen

`ConversionTransactionContext.estimatedMaturity` is the latest date at which everything the wallet has converting, plus this request, is collectable: pending withdrawals at their claim dates, pending orders at their estimates, and the request's own direct deposits and order leg. An amount of zero is the collection itself. Users track their conversions on the interface, so the one date is the feature.

The [SDK's direct-first completion walk](../README.md#transaction-completion) chooses the plan. The estimate describes that choice; it never ranks plans.

## Accepted limits

- In a thin pool with a sitting seller, removing assumed working capital can move the date to the next claim even if a bot could fill within a turn. This accepts a conservative date rather than maintaining a list of operator balances.
- A buyer-side distress signal (a fillable buyer sitting for over a turn) is not modelled; add it only when a journal shows buyers sitting.
- In-flight withdrawal requests are not read as a dated supply grade; the simpler policy was preferred.
- The pool is read by direct scans, whose cost grows with the pool. A bot-written snapshot would need an explicit format identity, a writer, a reader, freshness and fallback rules; none exists yet.
