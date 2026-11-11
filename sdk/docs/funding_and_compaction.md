# Funding and Compaction

How completion funds a plan and why it spends more of the account than the amount needs.

## Spending the offer

Completion spends every liquid cell the projection offers, `state.cells`, and adds no other: it funds the outputs and the fee from them, and a shortfall is `insufficient-capacity` or `insufficient-ickb`. The projection sizes that offer, with the receipts and collections, to fit one transaction ([limits of one transaction](projection.md#the-limits-of-one-transaction)), so completion needs no input limit of its own.

So expect a transaction to spend more of the account than the amount alone requires. Compaction is on purpose: every transaction tidies its share of the account. A sweep that stopped at 1,000 inputs and a fee loop that added cells one at a time were removed: they bounded only the cells completion added, never the receipts and collections beside them, so a large backlog could build a transaction the node refused on every rebuild.

Plain-cell discovery doesn't filter mining rewards by cellbase maturity. If the scan returns an immature reward, completion can include it and the node refuses the transaction. Rebuilding can pick it again until it matures. That's accepted: current uses don't justify reward-specific checks.

## Capacity and change

CKB capacity and iCKB quantity stay separate, in bigint. An input full capacity funds the transaction, but the outputs still have to pay their occupied capacity, a plain change cell, any order master and the fee.

Ordinary change is always a plain cell. Existing typed outputs are never reused as fee change. A duplicate input is a builder bug, caught by completion.

## Header deps

Completion names the header the plan was priced at as the last header dep. A parent a node invented would pass the hash checks and, dated fresh, the age bound. Its DAO rate would then set the exchange ratio that fills and orders are priced at. But the chain refuses a transaction whose header deps are off the main chain.

It goes last because the deployed `dao.c` reads one byte of a deposit header index, so the deposit headers lead. Why that header is the parent of the tip: see [node trust](node_trust.md#the-tip-parent).

Receipts and deposits being withdrawn count at the iCKB value the state read gave them at their deposit headers. That value comes from the receipts and the `state.poolDeposits` completion is given, rather than every candidate asking the node again which block created them. A wrong value can only get the transaction refused by the strict equality of iCKB Logic. A protocol input without a value is a builder bug and throws.

## Who owns what

CCC prepares the signer and resolves the witness-aware fee. The SDK owns the chosen cells and the output shape. Calling the CCC input collectors would add another discovery path, with different cache and filter rules. Every candidate plan uses the same sampled state.
