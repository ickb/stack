# History

`readHistory(signer)` lists the account's conversions, newest first, as an async generator of `{ txHash, timestamp, operations }`. `timestamp` is the block's, in unix ms. Each operation is one thing the transaction made for the account:

- `deposit`: `ckb`, the free capacity its receipt records, deposit quantity times amount; `ickb`, the iCKB that receipt is worth at the deposit block.
- `withdrawal`: `ckb`, the free capacity of the withdrawal request an owner marker at the account points to.
- `order`: `ckb` and `ickb`, the unoccupied CKB and the iCKB the minted order offers, found from its master at the account.

An entry never has an empty list: a transaction that made none of these for the account is skipped. A `for await` that breaks stops the reads, so a page of history costs only that page.

## One scan

Every user conversion mints a limit order ([always an order](transaction_completion.md#always-an-order)), and its master sits at the user's lock. So one index scan per account lock finds them all: the transactions that touched a cell at that lock typed by the order script, newest first. The signer's locks are asked again on each call, as `readState` asks them.

A record whose matched cells are all inputs only spent masters at that lock, a collection or a melt, and is dropped from its lock's stream without reading anything. For the others the transaction is read cache first and checked against its hash, as the order scan reads a master's, and the block header once per block, shared within the call.

The scans run one per lock and are merged lazily: the newest head, by block number then transaction index, goes next, and a stream is asked for more only once its head is consumed. A transaction two of the account's locks share comes from both streams in a row and is kept once. The input-only records go before the merge, so a melt at one lock cannot hide the mint the same transaction placed at another.

## Outputs only

Amounts come from what the transaction created, and only from outputs at the account's locks. A cell at another lock, a deposit locked by iCKB Logic or another account's receipt in the same transaction, never counts. Inputs aren't valued: reading them would cost a read per spent cell, and a conversion's own outputs already say what it did.

## Known gaps

The history lists conversions, not every movement of funds:

- **Fills:** the bot fills an order by spending it and creating its next state; the user's master isn't touched, so the fill isn't listed.
- **Collections and claims:** a transaction that only melts orders, completes receipts or claims withdrawals only spends what the account holds.
- **Fees and transfers:** plain CKB or iCKB sent in or out, and the fees paid, aren't conversions.
- **Older conversions:** before 9003 two user transactions on mainnet converted without an order (one deposit, one withdrawal request); they left no master, so they aren't found. Every other order-less one was the bot's own.

The node's index records are its claim: see [node trust](node_trust.md#history). The list is for display.
