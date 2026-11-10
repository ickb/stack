# Building a Conversion

How `buildConversionTransaction` picks a plan and what it returns. How it funds that plan is in [funding and compaction](funding_and_compaction.md).

## What comes back

A built conversion carries:

- `tx`: the completed transaction, funded from the cells of its state read. It never looks for more inputs while trying candidates.
- `plannedFee`: the fee completion priced, the limit the [send](signing_and_broadcast.md) refuses to exceed.
- `estimatedMaturity`: when this conversion alone is collectable, from the tip: its direct claims and its order estimate, or the tip for a collection.
- `orderOccupiedCapacity`: when it mints an order, the CKB the order and master cells take beyond the amount. Collecting the order returns it.
- `broadcastBefore`: when it requests withdrawals, the deadline to send it by.

Pass the whole result to `signAndSendTransaction`, so the deadline can't get lost on the way.

Every cell it creates for the user, the conversion outputs and the change, belongs to the signer recommended lock. The [root user-lock assumption](../../README.md#user-locks) applies to that lock.

A destination lock chosen by the caller was removed. The change and up to 1,000 swept cells went with it, so a conversion "sent to a friend" moved the user own funds too. Its one use, a send-everything for key-only wallets without an xUDT transfer screen, didn't justify that. Rejected: a destination only at amount zero, combined signers or a transfer built by the interface. Those wallets lose that exit in the stack interface.

## Amount zero

An amount of zero builds the collection alone. `hasCollectable(context)` says if there's anything to collect: the interface, the generator and the bot share that test. With nothing to collect the build throws: a transaction that would only compact the account isn't worth its fee, and the caller can tell beforehand. A negative amount and a direction other than the two throw too, the direction even at amount zero, since a plain-JS caller's typo would otherwise read as iCKB to CKB. The failure values left are `insufficient-ckb`, `insufficient-ickb`, `amount-too-small` with its `minimum`, and from completion `insufficient-capacity` with CCC's capacity error as its `cause`.

## The plan walk

The SDK tries the most direct plan first and returns the first one that completes. Only completion knows if a plan is affordable: markers, remainder orders, change and fees all count. Dropping one withdrawal can add a remainder order that costs more than the marker it saved, so a binary search or a count bound in policy would be wrong.

Completion returns its failures as values: too few iCKB, too little CKB for the cells and the fee, or more outputs than the DAO script accepts. Each moves the walk on; whatever throws (transport, scan, signer, a malformed transaction) stops it. When every candidate fails, the build returns the last failure, a shortfall the caller shows. A last failure at the DAO output limit throws instead: the walk's last plans have at most four outputs, so reaching it is a defect.

## Direct first

Direct-first favors a known claim date with no order fee over a faster estimated fill by the bot. So a user may get a direct withdrawal days away even when an order could fill in minutes. The estimate describes the chosen plan; it doesn't rank plans.

Withdrawals pick ready deposits greedily, earliest claim first. That can leave a larger remainder order where an exact best-fit search would withdraw more directly. Capped deposits and the regular deposit sizes of the bot keep that cost small, without another combinatorial selector.

## Ring anchors

The withdrawal selection skips [ring anchors](../node/docs/policy.md#rebalancing-and-the-maturity-ring), to keep the pool maturities spread out. If every ready deposit is an anchor, only an order plan is left.

The ring is advice, not a guard: any iCKB holder can withdraw any pool deposit, so a large deposit followed at once by a withdrawal of the ready surplus empties the near term until new surplus enters the window from its far end. The planner classifies the ring once, from the pool before the withdrawal. A withdrawal can only lower the segment count, then segments merge whole. So this errs toward keeping too many anchors near a band edge. It never leaves a segment uncovered.

## Deposits per transaction

A conversion makes at most 63 deposits, the deployed DAO script limit of 64 outputs less one change. No lower cap: a large depositor can just send several transactions. Through the SDK, the rest would become an order the bot refills one cap at a time inside the same ring segment: only a fee and a wait more.

## DAO limits

The DAO output and deposit-header limits come from the deployed script, not from a consensus output cap. Their constants and reasons are in [`src/dao.ts`](../src/dao.ts). The account projection caps the ready batch at 256 matured withdrawals (`DAO_HEADER_INDEX_LIMIT`, in [`src/conversion/projection.ts`](../src/conversion/projection.ts)), and their deposit headers go first, so each can always be addressed, whatever other headers there are. The builder does not check the index again: every SDK build, the bot and the generator read their context through that projection, and a wrong index only the node can refuse.

The claim-epoch model test compares the installed CCC with a pinned transcription of the deployed `dao.c`. So a dependency regression fails the gate instead of hiding behind a local copy.
