# Pool Maturity Estimates

How the SDK dates an order. The estimate models the [bot](../node/docs/policy.md). It's not a protocol deadline, nor a promise that a bot has what it takes to fill the order. Where the date shows up and what the model leaves out are in [estimate limits](estimate_limits.md).

## Inputs

`getL1AccountState` reads, at the parent of the sampled tip:

- **`system.orderBook`:** every order past par on the book, the wallet own included, since the bot fills by price, not by owner. The scan drops dual-ratio orders: nothing in the stack places one, so they aren't matched, estimated, shown or melted here.
- **`system.poolDeposits`:** every iCKB pool deposit, with its sampled claim epoch, read as its real claim date. A claim the bot can no longer request in time rolls a cycle, by the twenty-minute floor of `BOT_LOCK_UP`: the bot makes the requests, so its rule dates the supply, whatever the caller policy is. A deposit counts on its date, a week out or thirty.
- **`blockNumber` of each order cell:** the block the scan reports for it. A fill replaces the order cell, so it's the last fill, or the mint while unfilled.

The bot working capital isn't read. Naming one operator wallet in a published library would turn a key rotation into an SDK release. Moving that address into interface config would only move the upkeep. So the model below stands in for it.

## Turns

`BOT_TURN_MS` is ten minutes, the interval at which the bot loop starts turns. The loop reads it from here, so the two can't drift apart. A failed turn adds a ten-minute restart, which the model doesn't count. It's a modeling interval, not a runtime bound.

An order counts on the book only when the bot would take it whole (`fillsWhole`: past par, over the ten-fee floor). Dust the bot ignores doesn't queue ahead of anyone, nor supply anyone.

## A seller (iCKB to CKB)

A seller waits for CKB. The supply, in time order:

1. **Now:** one deposit worth of CKB, the cap at the DAO ratio, as assumed working capital. The model zeros it as a shortage signal when a fillable seller, this order included, has gone unfilled for over an eighth of an epoch of blocks since it was placed or last filled, about three turns. One turn left no margin for an order placed just after a turn, or for the restart after a failed one. Counting from the last fill keeps an order the bot fills a little every turn from reading as a shortage. It doesn't measure the bot balance.
2. **Later:** each pool deposit at its real claim date, earliest first. The deposits the same plan withdraws directly are left out, since they can't fill its order leg too.

The demand is the CKB this order pays out, plus the CKB of every fillable seller priced at least as well, valued at the DAO ratio. A tie counts as ahead, since the bot fills ties in an order of its own choosing. An order already on the book is left out of its own queue.

The date is the first one whose total supply covers the demand, plus one turn. When the sampled supply falls short, it's the last supply date plus one turn. That fallback waits on no DAO growth: the pool always covers an ask at or below par. An ask above par is never fillable whole, so it's collected rather than dated.

## A buyer (CKB to iCKB)

A buyer waits for the bot to mint. The model assumes the bot can mint one cap-sized deposit per turn once its unknown inventory is spent.

The net CKB demand is this request, plus fillable buyers priced at least as well, less the iCKB fillable sellers bring in, valued at the DAO ratio. The wait is one turn, plus one per whole deposit cap of positive net demand. On purpose, this coarse model doesn't check the bot funds or whether it's running.
