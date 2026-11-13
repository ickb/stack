# Rebalancing

How the bot moves inventory between CKB and iCKB after matching: the iCKB band, the deposit and withdrawal rules, the stress line.

## What it reads

The policy uses the balances after matching. The bands and the stress line read what the bot holds. What one transaction moves (the CKB of a deposit, the iCKB budget of a withdrawal, the spendable balances of the match) comes from what that transaction is offered: `ckbConvertible` and `ickbConvertible` ([limits of one transaction](../../docs/transaction_limits.md)). So an account past its share never plans more than completion can fund.

The CKB Max sets aside the cells of an order, which the bot doesn't mint: about 440 CKB of slack below the reserve. That's accepted for one number shared with the wallet.

## The rules

A deposit has priority among fundable candidates:

- **Deposit:** one cap-sized deposit when iCKB is below 2,000, or when the ring segment holding the tip has less than half its equal share of the pool iCKB ([the maturity ring](maturity_ring.md)). A refill keeps the 1,000 CKB reserve after it. A coverage deposit also keeps the stress line below. One deposit serves either reason.
- **Withdraw:** otherwise, while iCKB exceeds 120,000, withdraw ready surplus deposits, keeping 20,000. Walk the earliest claims first, skipping deposits that don't fit the iCKB budget. When the deposit candidate can't complete, try this withdrawal in the same turn.

[`policy.ts`](../src/bot/policy.ts) writes the band in units of the 100,000-iCKB deposit cap `Q`: refill below `Q/50`, keep `Q/5`, withdraw above `Q + Q/5`. A refill lands below the withdrawal line. A withdrawal keeps ten times the refill line. These fixed thresholds replaced floors derived from demand: a changing book doesn't redefine the operating band of the bot.

## The stress line

The bot keeps the cost of one deposit, receipt included, in CKB, the reserve counted in. A cap-sized seller arriving at a quiet bot is then served at once, but for the tail the reserve covers. A larger order is served in partials; the tail follows as anchors mature. With a queue, matured CKB goes to the best-priced sellers in the same transaction that collects it. So the line triggers stress; it isn't a balance the bot holds.

Under stress, when CKB in hand plus the own requests in flight is under that line, ready anchors may be withdrawn too, surplus first. The next matured request restores the line. Requests in flight count because they claim within the ready window: without them, a second anchor went to the same dip.

The line counts the reserve because a matured cap anchor returns about the capacity of the deposit, under its cost by the receipt and the fees. Measured beyond the reserve, no single anchor ever restored the line. Each dip took a second anchor, so a quiet bot settled near two deposits of CKB.

Taking an anchor can cost its segment coverage for a cycle: the ring is a heuristic, not a liquidity guarantee.

Rejected:

- **Gating stress on the order book, or journaling demand to tune it:** an owner can cancel an order through any interface, so the book is no signal the bot can trust. A withdrawal request can't be taken back. Tuning on volatile demand would churn anchors.
- **A fraction of a deposit as the line:** immediate service saturates at one deposit.
- **More than one deposit:** it removes a seed from every levelling cycle. It raises the funding floor for a tail partials already cover.

A coverage deposit keeps the line, so it can't cause stress. Keeping only the reserve let stress withdraw the anchor of the next segment, then the matured CKB seeded that segment again, with the CKB of the bot pinned at the reserve. The refill keeps only the reserve: a bot with one deposit of CKB and no iCKB gets CKB only from buyers, who need its iCKB.
