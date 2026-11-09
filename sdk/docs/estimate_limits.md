# Estimate Limits

Where the [estimated dates](pool_maturity_estimates.md) show up, what the order fee buys and what the model leaves out on purpose.

## The date on screen

Each built conversion carries its own `estimatedMaturity`, counted from the tip: its direct claims and its order estimate, or the tip for a collection, which takes only what's ready.

`ConversionTransactionContext.estimatedMaturity` dates what the wallet already has converting: pending withdrawals at their claims, pending orders at their estimates.

A consumer that lists conversions apart, like the NervDAO active panel, shows each date on its own. The stack interface shows one "Ready:" date, the later of the two.

The [direct-first walk](transaction_completion.md#the-plan-walk) chooses the plan. The estimate describes that choice; it never ranks plans.

## The order fee

The default order fee, 0.01%, lives beside the quote and plan code in [`src/conversion/estimate.ts`](../src/conversion/estimate.ts). It buys a window for a bot to fill a buy before DAO growth wears away its incentive. It's not a promise that the order completes.

## Accepted limits

- **A thin pool:** with a seller sitting, dropping the assumed working capital can move the date to the next claim, even if a bot could fill within a turn. A careful date is preferred to keeping a list of operator balances.
- **Sitting buyers:** a fillable buyer sitting for over a turn isn't read as a signal. Add it only when a journal shows buyers sitting.
- **Requests in flight:** withdrawal requests already sent aren't counted as dated supply. The simpler policy was preferred.
- **Sustained selling:** the seller date runs optimistic in three ways, none modeled. Wallet plans withdraw surplus deposits up to seven days ahead (`WALLET_LOCK_UP`) while the bot looks one hour ahead, so those deposits never reach the book. A deposit whose window passes while the bot is down rolls a cycle: the date jumps at the next refresh. And the bot withdraws at most its iCKB beyond the 20,000 it keeps per claim cluster, so a cluster larger than that waits a cycle. A model change waits for a mainnet journal showing the gap.
- **Scan cost:** the pool is read by direct scans, whose cost grows with the pool. A snapshot written by the bot would need a format identity, a writer, a reader, freshness and fallback rules. None exists yet.
