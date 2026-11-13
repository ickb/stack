# History

`readHistory(signer)` lists the conversions of the account, newest first, as an async generator of `{ txHash, timestamp, operations }`. `timestamp` is the block timestamp, in unix ms. Each operation is one thing the transaction made for the account:

- `deposit`: `ckb`, the free capacity its receipt records (deposit quantity times amount); `ickb`, the iCKB that receipt is worth at the deposit block.
- `withdrawal`: `ckb`, the free capacity of the withdrawal request an owner marker at the account points to.
- `order`: `ckb` and `ickb`, the unoccupied CKB and the iCKB the minted order offers, found from its master at the account.

An entry never has an empty list: a transaction that made none of these for the account is skipped. A `for await` that breaks stops the reads, so a page of history costs only that page.

## One scan

Every user conversion mints a limit order ([always an order](transaction_completion.md#always-an-order)), whose master sits at the lock of the user. So one index scan per account lock finds them all: the transactions that touched a cell at that lock typed by the order script, newest first. The locks of the signer are asked again on each call, as `readState` asks them.

A record whose matched cells are all inputs only spent masters at that lock: a collection or a melt. It's dropped from the stream of its lock without reading anything. For the others, the transaction is read cache first then checked against its hash, as the order scan reads the one of a master. The block header is read once per block, shared within the call.

The scans run one per lock, merged lazily: the newest head, by block number then transaction index, goes next. A stream is asked for more only once its head is consumed. A transaction two locks of the account share comes from both streams in a row, kept once. The input-only records go before the merge, so a melt at one lock can't hide the mint the same transaction placed at another.

## Outputs only

Amounts come from what the transaction created, only from outputs at the locks of the account. A cell at another lock never counts: a deposit locked by iCKB Logic, or the receipt of another account in the same transaction. Inputs aren't valued: reading them would cost a read per spent cell, while the own outputs of a conversion already say what it did.

## Known gaps

The history lists conversions, not every movement of funds:

- **Fills:** the bot fills an order by spending it, then creating its next state. The master of the user isn't touched, so the fill isn't listed.
- **Collections and claims:** a transaction that only melts orders, completes receipts or claims withdrawals only spends what the account holds.
- **Fees and transfers:** plain CKB or iCKB sent in or out, or the fees paid, aren't conversions.
- **Older conversions:** before 9003, two user transactions on mainnet converted without an order (one deposit, one withdrawal request). They left no master, so they aren't found. Every other order-less one was the own transaction of the bot.

The index records of the node are its claim: see [node trust](node_trust.md#history). The list is for display.
