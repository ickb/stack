# Limits of One Transaction

The deployed scripts bound one transaction: here are the bounds, then how the SDK stays inside them.

## The bounds

Measured on the deployed binaries, 2026-11-10 and 11:

- **2,048 inputs:** the iCKB xUDT script refuses any transaction with more inputs, of any lock or type, once an iCKB cell is among them (`MAX_LOCK_SCRIPT_HASH_COUNT` in ckb-production-scripts `c/xudt_rce.c`). 2,048 passes.
- **330 orders:** the limit order script keeps one B-tree entry per order. It runs out of heap at 330 in the worst master out-point order found, which isn't proven the worst (383 in sorted order). The [contracts tests](https://github.com/ickb/contracts/pull/23) pin it. With the bot's at most 58 matches, a transaction holds at most 186 orders.
- **256 withdrawals:** the DAO script reads one byte of a deposit-header index.
- **64 outputs:** the DAO script refuses more in a transaction that uses it.
- **597 KB:** one block. A full 2,048-input transaction measured about 110 to 145 KB. A quantum-resistant signature adds up to 50 KB.

The DAO limits come from the deployed script, not from a consensus cap. Their constants and reasons are in [`src/dao.ts`](../src/dao.ts).

## Shares of the inputs

So the projection offers the next transaction a fixed share of each input kind, in [`src/conversion/projection.ts`](../src/conversion/projection.ts):

| Kind              | Share                                                                                       | Inputs              |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------- |
| Collected orders  | 128, a 2.6× margin under 330                                                                | 256: order, master  |
| Ready withdrawals | 256                                                                                         | 512: request, owner |
| Receipts          | 128                                                                                         | 128                 |
| iCKB cells        | 256                                                                                         | 256                 |
| Plain cells       | 806                                                                                         | 806                 |
| Plan inputs       | at most 32 withdrawn pool deposits (30 for a conversion), at most 58 orders the bot matches | 90                  |

That's 2,048 in all. A test in `sdk/node/test/bot/input_shares.ts` fails the gate when a raised share or a new input source would pass it.

Each share takes the largest first: cells by capacity, iCKB cells by their iCKB, receipts and withdrawals by CKB, orders by their value at the exchange ratio. Anyone can send cells, or mint order groups under the lock of a user, so dust sorts last: it can't crowd value out of a share. Without shares, every rebuild from the same state would build the same over-limit transaction, which the node would refuse for good.

`state.cells` and `state.receipts` are the offered ones: completion spends every one of them, nothing else. The balances still count everything the account owns, so `ckbBalance - ckbAvailable` stays exactly the converting positions. Only the two Maxes, `ckbConvertible` and `ickbConvertible`, count the shares alone. For an account with thousands of cells a Max can be well below the balance. Each conversion compacts its share. An amount between the Max and the available balance fails at completion as `insufficient-capacity` or `insufficient-ickb`.

## Outputs per conversion

A conversion makes at most 60 deposits: the 64 DAO outputs less the receipt, the order, its master, the change. An iCKB change output takes one more when the account holds more iCKB than the outputs need: the walk then steps down to 59.

Withdrawal requests take two outputs each, a request plus its owner marker. So a conversion holds 30 beside the order, its master, the CKB change, the iCKB change.

No lower cap: a large depositor can send several transactions. Through the SDK, the rest becomes an order the bot refills one cap at a time inside the same ring segment: only a fee and a wait more.

## Header deps

The projection caps the ready batch at 256 matured withdrawals (`DAO_HEADER_INDEX_LIMIT`). Their deposit headers go first, so each can always be addressed, whatever other headers there are. The builder doesn't check the index again: every SDK build, the bot and the generator read their state through that projection. The accepted cost: a wrong index would reach the node, which only then refuses it.

The claim-epoch model test compares the installed CCC with a pinned transcription of the deployed `dao.c`. So a dependency regression fails the gate instead of hiding behind a local copy.

## Cycles

Cycles don't bind. Every iCKB script scans every cell: about 18k cycles per input, 80k per melted order. A node verifies a sent transaction against the 3.5B of a block. A full transaction measured:

- about 60M cycles with a secp256k1 lock (about 1.65M per lock group);
- 65M with JoyID (about 6.9M per lock group);
- around 86M to 165M with a Quantum Purse lock, which costs 12M to 92M per signature (depending on its SPHINCS+ variant) plus about 7.2k per input, since it hashes every input.

The 70M cycle bound of a node only labels a relayed transaction as large. One corner is accepted: a reorg doesn't put a dropped transaction above 70M back in the pool. Its wait times out, then it's built again. Only a large Quantum Purse collection can reach that.
