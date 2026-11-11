# The Projection

`projectState(system, account, userOrders, changeLock)` turns one state read into one flat `State`: what a wallet shows and what the next transaction plans with are the same object. `changeLock` is the signer recommended lock, which owns every output a conversion creates; the state carries it as `state.changeLock` for the build and completion. The state carries no pending totals: `ckbBalance` and `ickbBalance` are the available amounts plus what the pending positions hold, and a caller that needs a pending figure sums the pending lists itself.

## Ready or converting

The projection splits the account into what the next transaction collects and what stays converting. One internal `readyAt` owns that split, for every kind of position, and the public `datesOf(position, state)` reads the same formula, so a panel listing positions and the projection can't disagree. `datesOf` gives `{ createdAt, readyAt }` in unix ms:

- **An order:** created at its mint block, the master's. Ready at the tip when the bot would take it whole in neither direction, since the next transaction collects it; otherwise at its fill estimate, always past the tip.
- **A withdrawal group:** created at its request block. Ready at its claim, which is at or before the tip exactly when it has matured.
- **A receipt:** created at its deposit block, and ready then.

A `readyAt` at or before the tip means ready now; it's never `0n`. An order is dated by the state's own copy of it, found by its master, which names it for its whole life, where the order cell moves with every fill. So a position kept from an older read dates against the newer state, fills since included, and an order the state no longer holds, melted or filled away, is ready at its tip. The fill estimate leaves the dated order out of the book the same way, by its master.

One transaction completes at most 256 matured withdrawals and collects at most 128 ready orders, the largest first ([limits of one transaction](#the-limits-of-one-transaction)). A matured group or a ready order past its cap stays pending with its past date, and goes with the next transaction: it counts as pending, not as available CKB or iCKB.

`state.estimatedMaturity` dates what's already converting, the latest of the pending dates.

## The limits of one transaction

The deployed scripts bound one transaction (measured on the deployed binaries, 2026-11-10 and 11):

- **2,048 inputs:** the iCKB xUDT script refuses any transaction with more inputs, of any lock or type, once an iCKB cell is among them (`MAX_LOCK_SCRIPT_HASH_COUNT` in ckb-production-scripts `c/xudt_rce.c`); 2,048 passes.
- **330 orders:** the limit order script keeps one B-tree entry per order and runs out of its heap at 330 in the worst master out-point order we could construct (383 in sorted order).
- **256 withdrawals:** the DAO script reads one byte of a deposit-header index.
- **597 KB:** one block. A full 2,048-input transaction measured about 110 to 145 KB, and a quantum-resistant signature adds up to 50 KB.

So the projection offers the next transaction a fixed share of each input kind, in [`src/conversion/projection.ts`](../src/conversion/projection.ts):

| Kind              | Share                                                                                                               | Inputs                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Collected orders  | 128, a 2.6× margin under 330                                                                                        | 256: the order and its master  |
| Ready withdrawals | 256                                                                                                                 | 512: the request and its owner |
| Receipts          | 128                                                                                                                 | 128                            |
| iCKB cells        | 256                                                                                                                 | 256                            |
| Plain cells       | 806                                                                                                                 | 806                            |
| The plan's own    | at most 32 withdrawn pool deposits (the bot's start; a conversion's is 30), and the bot's at most 58 matched orders | 90                             |

That's 2,048 in all; a test in `sdk/node/test/bot/input_shares.ts` fails the gate when a raised share or a new input source would pass it. Each share takes the largest first: cells by capacity, iCKB cells by their iCKB, receipts and withdrawals by CKB, orders by their value at the exchange ratio. Anyone can send cells, or mint order groups whose master carries a user's lock, so dust sorts last and can't crowd value out of a share. Without a share, every rebuild from the same state would build the same over-limit transaction and the node would refuse it for good.

`state.cells` and `state.receipts` are the offered ones; completion spends every one of them and nothing else. The balances still count everything the account owns, so `ckbBalance - ckbAvailable` stays exactly the converting positions. Only the two Maxes, `ckbConvertible` and `ickbConvertible`, count the shares alone: for an account with thousands of cells a Max can be well below the balance. Each conversion compacts its share, and the next read offers the next one. An amount between the Max and the available balance fails at completion as `insufficient-capacity` or `insufficient-ickb`.

Cycles don't bind: every iCKB script scans every cell, about 18k cycles per input and 80k per melted order, and a node verifies a sent transaction against a block's 3.5B. A full transaction measured about 60M cycles with a secp256k1 lock (about 1.65M per lock group) and 65M with JoyID (about 6.9M). A Quantum Purse lock costs 12M to 92M per signature, depending on its SPHINCS+ variant, plus about 7.2k per transaction input, since it hashes every input; a full transaction it signs lands around 86M to 165M. A node's 70M cycle bound only labels a relayed transaction as large. One corner is accepted: a transaction above 70M that a reorg drops is not put back in the pool, so its wait times out and it's built again, which only a large Quantum Purse collection can reach.

## When an order is collected

An order is collected when the bot would take it whole in neither direction (`isCollectable` in [`src/order/fill.ts`](../src/order/fill.ts)). That covers two cases: a fulfilled order, with nothing left to match, or a buy or a sell priced under the bot fill cost. A fee spike refuses a sell just like a buy.

No age cutoff backs the rule: one would only refund an order the bot could fill but has stopped filling. The bot is watched anyway. The cost is no automatic refund while the bot is broken.

## The CKB a conversion can take

`state.ckbConvertible` is the most CKB a CKB-to-iCKB conversion can always take, the amount for a Max button. It's the CKB the next transaction is offered (its share of cells, receipts and collections) less:

- the outputs of an order-only conversion: the order cell and its master, a plain change and an iCKB change, all under `changeLock`;
- a fee bound for that shape, over every input the next transaction is offered, with the largest witness a supported wallet signs (JoyID), plus 1 CKB.

It's never negative.

Why an order-only shape, the one with the fewest cells to fund: an order brings the bot the CKB it's usually short of. Its 0.01% fee comes back as DAO interest in under two days. A deposit shape was rejected: it needs a receipt reserve, plus a round-down for remainders an order can't represent. The planner still tries deposit plans first and takes one when it can fund it.

One limit is accepted: at Max the walk first completes every deposit plan above the order-only one. That's unnoticeable at ordinary sizes, around ten seconds only from millions of CKB on a thousand cells.

For iCKB, `state.ickbConvertible` is the Max: the iCKB of the offered cells, receipts and collectable orders, since an iCKB-to-CKB conversion needs no iCKB beyond the amount.
