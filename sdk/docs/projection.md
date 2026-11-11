# The Projection

`projectState(system, account, userOrders, changeLock)` turns one state read into one flat `State`: what a wallet shows and what the next transaction plans with are the same object. `changeLock` is the signer recommended lock, which owns every output a conversion creates; the state carries it as `state.changeLock` for the build and completion. The state carries no pending totals: `ckbBalance` and `ickbBalance` are the available amounts plus what the pending positions hold, and a caller that needs a pending figure sums the pending lists itself.

## Ready or converting

The projection splits the account into what the next transaction collects and what stays converting. `readyAt(position, state)` owns that split, for every kind of position:

- **An order:** ready when the bot would take it whole in neither direction, since the next transaction collects it. Otherwise it's dated at its fill estimate, always past the tip.
- **A withdrawal group:** dated at its claim, which is at or before the tip exactly when it has matured.
- **A receipt:** ready at once.

The date is in unix ms. `0n`, or a time at or before the tip, means now. A consumer that lists positions, like the NervDAO active panel, dates each one with it. So the panel and the projection can't disagree.

One transaction completes at most 256 matured withdrawals (the DAO script indexes deposit headers below that). A matured group past the cap stays pending with its past date. It goes with the next transaction.

One transaction collects at most 128 ready orders, in scan order; the rest stay pending with their past date and go with the next transaction. The deployed order script keeps one B-tree entry per order and runs out of its heap at 330 orders in the worst master out-point order we could construct (383 in sorted order), so 128 keeps a 2.6× margin; each melt also costs about 80k of the 70M cycles a node verifies per transaction (measured on the deployed binaries, 2026-11-10). Anyone can mint order groups whose master carries a user's lock, so without a cap every rebuild would melt the same over-limit set and the node would refuse it for good. Orders past the cap count as pending, not as available CKB or iCKB.

`state.estimatedMaturity` dates what's already converting, the latest of the pending dates.

## When an order is collected

An order is collected when the bot would take it whole in neither direction (`isCollectable` in [`src/order/fill.ts`](../src/order/fill.ts)). That covers two cases: a fulfilled order, with nothing left to match, or a buy or a sell priced under the bot fill cost. A fee spike refuses a sell just like a buy.

No age cutoff backs the rule: one would only refund an order the bot could fill but has stopped filling. The bot is watched anyway. The cost is no automatic refund while the bot is broken.

## The CKB a conversion can take

`state.ckbConvertible` is the most CKB a CKB-to-iCKB conversion can always take, the amount for a Max button. It's `ckbAvailable` less:

- the outputs of an order-only conversion: the order cell and its master, a plain change and an iCKB change, all under `changeLock`;
- a fee bound for that shape, over every input the account offers, with the largest witness a supported wallet signs (JoyID), plus 1 CKB.

It's never negative.

Why an order-only shape, the one with the fewest cells to fund: an order brings the bot the CKB it's usually short of. Its 0.01% fee comes back as DAO interest in under two days. A deposit shape was rejected: it needs a receipt reserve, plus a round-down for remainders an order can't represent. The planner still tries deposit plans first and takes one when it can fund it.

Two limits are accepted:

- **Inputs:** the amount can fail to complete when collections and iCKB cells already take 1,000 inputs (two for each collectable order or ready withdrawal, one for each receipt or iCKB cell). Completion stops adding iCKB cells at the sweep limit. The fee reserve is plain cells only.
- **Time:** at Max the walk first completes every deposit plan above the order-only one. That's unnoticeable at ordinary sizes, around ten seconds only from millions of CKB on a thousand cells.

For iCKB, `state.ickbAvailable` is already the Max: an iCKB-to-CKB conversion needs no iCKB beyond the amount.
