# Pool Maturity Estimates

How the SDK dates an order-based conversion for the interface's "Ready:" line. This is an off-chain stack mechanism, not protocol law: the bot (`sdk/node`) fills orders, and the estimate is a model of it (decisions amendment 52(ai)(15)).

## Inputs

`getL1AccountState` samples one tip and reads:

- `system.orderPool`: every order past par on the book, the wallet's own included; the bot fills by price, not by owner. A dual-ratio order (both directions priced) is dropped at the scan: nothing in the stack places one, so it is neither matched, estimated, shown nor melted here.
- `system.poolDeposits`: every iCKB pool deposit with its sampled claim epoch, read here as its real claim date: rolled a cycle when the bot can no longer request it in time (under the bot's twenty-minute floor, `BOT_LOCK_UP`; the bot makes the requests, so its rule dates the supply whatever the caller's own policy). No readiness collapse: a deposit counts on its date, three days out or thirty.
- Each order group's `blockNumber`, the block that committed its origin, read from the same transaction response the scan already fetches. An uncommitted origin has none.

The bot's own working capital is not read: a published library should not name one operator's wallet, and the model below stands in for it.

## The one duration

`BOT_TURN_MS` is ten minutes: the bot's one-minute cadence plus its confirmation wait, with room for slow reads. It is the one duration the bot can be held to, so every estimate is built from it. The lock-up window's ten-minute lower bound and the sitting-seller threshold below are the same length for their own reasons and change independently.

An order counts on the book only when the bot would take it whole (`fillsWhole`: past par, over the ten-fee floor). Dust the bot ignores does not queue ahead of anyone and does not supply anyone.

## A seller (iCKB to CKB)

The seller waits for CKB. Supply, in time order:

1. Now: one deposit's worth of CKB (the cap at the DAO ratio), the bot's working capital, unless a fillable seller has already sat on the book for more than a turn (its origin is more than a twenty-fourth of an epoch of blocks below the tip). Then the bot evidently has none to give, and this term is zero.
2. Each pool deposit at its real claim date, earliest first, less the deposits the same plan withdraws directly (they cannot fill its order leg too).

Demand is the CKB this order pays out, plus the CKB of every fillable seller priced at or better than it (asking at most its CKB per iCKB; a tie is filled in an order of the bot's choosing, so it counts as ahead), valued at the DAO ratio. When the order is already on the book it is left out of its own queue.

The estimate is the first date whose cumulative supply covers the demand, plus one turn. Every iCKB is backed by a pool deposit that matures within one DAO cycle, so the pool always covers an order at par. An order asking above par may outrun the pool's CKB at today's ratio; it waits for the DAO ratio to reach its ask, later than any claim date, and reads the pool's last claim date plus one turn, an understatement accepted as the nearest date the model knows.

## A buyer (CKB to iCKB)

The buyer waits for the bot to mint. Once its iCKB inventory is spent the bot mints one cap-sized deposit per turn, and the inventory is unknown here, so the wait is one turn plus one per cap of net CKB demand ahead: fillable buyers paying more per iCKB than this one, less the iCKB the fillable sellers bring in, at the DAO ratio. One cap per worst-case turn is about 630,000 CKB an hour, five to ten times slower than a normal day, deliberately.

## The date on screen

`ConversionTransactionContext.estimatedMaturity` is the latest date at which everything the wallet has converting, plus this request, is collectable: pending withdrawals at their claim dates, pending orders at their estimates, and the request's own direct deposits and order leg. An amount of zero is the collection itself. Users track their conversions on the interface, so the one date is the feature.

Plans are ordered direct first (the most deposits withdrawn directly), and the completion walk takes the first it can fund; the estimate never ranks plans (decisions amendment 52(ak)).

## Accepted limits

- The bot filling early is a pleasant surprise; the reverse was a broken promise. In a thin pool with a sitting seller the line reads the next claim date where the bot might fill within a turn.
- A buyer-side distress signal (a fillable buyer sitting for over a turn) is not modelled; add it only when a journal shows buyers sitting.
- In-flight withdrawal requests are not read as a dated supply grade; the simpler policy was preferred.
- The pool is read by direct scans, whose cost grows with the pool. A bot-written snapshot would need an explicit format identity, a writer, a reader, freshness and fallback rules; none exists yet.
