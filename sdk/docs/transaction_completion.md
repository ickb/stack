# Building a Conversion

How `buildConversionTransaction` picks a plan. What it returns is in [what a build returns](build_result.md). How it funds the plan is in [funding and compaction](funding_and_compaction.md).

## The plan walk

The SDK tries the most direct plan first. It returns the first one that completes. Only completion knows if a plan is affordable: markers, remainder orders, change and fees all count. Dropping one withdrawal can add a remainder order that costs more than the marker it saved. So a binary search or a count bound in policy would be wrong.

Completion returns its failures as values: too few iCKB, too little CKB for the cells and the fee, or more outputs than the DAO script accepts. Each moves the walk on. Whatever throws (transport, scan, signer, a malformed transaction) stops it. When every candidate fails, the build returns the last failure, a shortfall the caller shows. A last failure at the DAO output limit throws instead: the last plans of the walk have at most four outputs, so reaching it is a defect.

## Direct first

Direct-first favors a known claim date with no order fee over a faster estimated fill by the bot. So a user may get a direct withdrawal days away even when an order could fill in minutes. The estimate describes the chosen plan: it doesn't rank plans.

Withdrawals pick ready deposits greedily, earliest claim first. That can leave a larger remainder order where an exact best-fit search would withdraw more directly. Capped deposits plus the regular deposit sizes of the bot keep that cost small, without another combinatorial selector.

## Always an order

Every conversion mints a limit order, beside its deposits or withdrawals or alone. So `conversionKind` is `order` or `direct-plus-order`. Only a collection, amount zero, mints none. The own transactions of the bot aren't conversions.

The bot fills from the CKB of the order, or the CKB its iCKB brings in. The bot is usually short of CKB: a conversion of deposits alone would give it nothing. So the plan walk skips a plan whose remainder is zero:

- **CKB to iCKB:** an exact multiple of the deposit capacity takes one deposit fewer. The CKB of that deposit goes to the order.
- **iCKB to CKB:** an amount the selected deposits cover exactly leaves the last of them to the order.

The cost is the order fee on what could have converted directly, 0.01%.

## Ring anchors

The withdrawal selection skips [ring anchors](../node/docs/maturity_ring.md#the-segments), to keep the pool maturities spread out. If every ready deposit is an anchor, only an order plan is left.

The ring is advice, not a guard: any iCKB holder can withdraw any pool deposit. So a large deposit followed at once by a withdrawal of the ready surplus empties the near term, until new surplus enters the window from its far end.

The planner classifies the ring once, from the pool before the withdrawal. A withdrawal can only lower the segment count, then segments merge whole. So this errs toward keeping too many anchors near a band edge. It never leaves a segment uncovered.

How many deposits or withdrawals fit in one conversion is in [limits of one transaction](transaction_limits.md#outputs-per-conversion).
