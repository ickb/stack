# The Projection

How one state read becomes the flat `State` that a wallet shows and the next transaction plans with.

`projectState(system, account, userOrders, changeLock)` turns one state read into one `State`. What a wallet shows and what the next transaction plans with are the same object. `changeLock` is the recommended lock of the signer, which owns every output a conversion creates. The state carries it as `state.changeLock` for the build and completion.

The state carries no pending totals: `ckbBalance` and `ickbBalance` are the available amounts plus what the pending positions hold. A caller that needs a pending figure sums the pending lists itself.

## Ready or converting

The projection splits the account into what the next transaction collects and what stays converting. One internal `readyAt` owns that split for every kind of position. The public `datesOf(state, position)` reads the same formula, so a panel listing positions and the projection can't disagree. `datesOf` gives `{ createdAt, readyAt }` in unix ms:

- **An order:** created at its mint block, the one of its master. Ready at the tip when the bot would take it whole in neither direction, since the next transaction collects it. Otherwise ready at its fill estimate, always past the tip.
- **A withdrawal group:** created at its request block. Ready at its claim, which is at or before the tip exactly when it has matured.
- **A receipt:** created at its deposit block, ready then too.

A `readyAt` at or before the tip means ready now. It's never `0n`.

An order is dated by the copy the state holds, found by its master. The master names the order for its whole life, while the order cell moves with every fill. So a position kept from an older read dates against the newer state, fills since included. An order the state no longer holds (melted or filled away) is ready at the tip. The fill estimate leaves the dated order out of the book the same way, by its master.

One transaction completes at most 256 matured withdrawals. It collects at most 128 ready orders, the largest first ([limits of one transaction](transaction_limits.md)). A matured group or a ready order past its cap stays pending with its past date, then goes with the next transaction: it counts as pending, not as available CKB or iCKB.

`state.estimatedMaturity` dates what's already converting: the latest of the pending dates.

## When an order is collected

An order is collected when the bot would take it whole in neither direction ([`isCollectable`](../src/order/fill.ts)). That covers two cases:

- a fulfilled order, with nothing left to match;
- a buy or a sell priced under the fill cost of the bot.

A fee spike refuses a sell just like a buy.

No age cutoff backs the rule: one would only refund an order the bot could fill but has stopped filling. The bot is watched anyway. The cost is no automatic refund while the bot is broken. The SDK offers no call to cancel a live order the bot would still fill either: filling it is the job of the bot, which is watched, while a cancel call would be one more public API to keep. For cancel, the cost is waiting for the fill, however long the inventory of the bot takes. Reopen when users ask to cancel.

## The CKB a conversion can take

`state.ckbConvertible` is the most CKB a CKB-to-iCKB conversion can always take: the amount for a Max button. It's the CKB the next transaction is offered ([its share](transaction_limits.md#shares-of-the-inputs) of cells, receipts and collections) less:

- the outputs of an order-only conversion, all under `changeLock`: the order cell, its master, a plain change, an iCKB change;
- a fee bound for that shape over every input the next transaction is offered, with the largest witness a supported wallet signs (JoyID), plus 1 CKB.

It's never negative.

Why an order-only shape, the one with the fewest cells to fund: an order brings the bot the CKB it's usually short of. Its 0.01% fee comes back as DAO interest in under two days. A deposit shape was rejected: it needs a receipt reserve, plus a round-down for remainders an order can't represent. The planner still tries deposit plans first. It takes one when it can fund it.

One limit is accepted: at Max the walk first completes every deposit plan above the order-only one. That's unnoticeable at ordinary sizes. It takes around ten seconds only from millions of CKB on a thousand cells.

For iCKB, `state.ickbConvertible` is the Max: the iCKB of the offered cells, receipts and collectable orders. An iCKB-to-CKB conversion needs no iCKB beyond the amount.
