# Current Bot Rebalancing Policy

This document describes the behavior implemented by `packages/bot/src/bot/turn.ts`, `packages/bot/src/runtime/`, `packages/bot/src/policy.ts`, and the `apps/bot/src/index.ts` script.

## Goal

The bot keeps enough liquid iCKB for order matching and withdrawals while leaving as much capital as practical in CKB. Each turn builds at most one completed transaction, sends it, and waits until the transaction is committed before the process exits; the service manager starts the next turn.

The bot exits when its total CKB-equivalent capital is less than or equal to `21 / 20 * depositCapacity`, where `depositCapacity` is recalculated from the live exchange ratio.

## Runtime State

The runtime reads system and account state through `@ickb/sdk`, then derives the balances and pool slices used by `planRebalance(...)`.

- `system`: live exchange ratio, tip header, fee rate, market order pool, and configured pool deposit snapshot from `sdk.getL1AccountState(...)`.
- `userOrders`: the bot's order groups from `sdk.getL1AccountState(...)`.
- `marketOrders`: resolved public `OrderGroup` entries from the system order pool.
- `poolDeposits`: configured public pool deposit snapshot used for ring coverage.
- `availableCkbBalance` and `availableIckbBalance`: account balances projected with collected orders available.
- `unavailableCkbBalance`: CKB pending in not-ready withdrawals.
- `depositCapacity`: CKB required for one standard 100,000 iCKB deposit at the live exchange ratio.
- `minCkbBalance`: shutdown threshold set to `21 / 20 * depositCapacity`.

The public pool scan uses the SDK L1 state snapshot, the bot's configured pool lock-up window, and the default CCC cell-query page size unless callers pass `cellPageSize`. Ring coverage uses that whole `poolDeposits` snapshot. Planning derives ready withdrawal candidates from each deposit's `isReady` field instead of storing a second pool slice.

## Constants

- `CKB_RESERVE = 1000 CKB`: hard available-CKB floor for match allowance and the projected post-transaction reserve guard. CKB-consuming matches also keep the fixed fee headroom out of allowance so ordinary matching does not predictably build below reserve after fees. Direct-deposit gates require the same fixed fee headroom. There is no soft CKB reserve above it.
- `MATCH_STEP_DIVISOR = 100`: matcher allowance step is `depositCapacity / 100` in CKB, converted to iCKB for CKB-to-iCKB matching.
- `MAX_WITHDRAWAL_REQUESTS = 30`: maximum deposits requested for withdrawal by one rebalance action.
- `BEST_FIT_SEARCH_CANDIDATES = 30`: bounded top-ranked horizon for exact subset selection.

One direct deposit or withdrawal request uses two output slots. The bot computes remaining output slots before rebalancing as `58 - tx.outputs.length` after order matches have been added.

## Decision Order

`planRebalance(...)` returns one of three actions: `none`, `deposit`, or `withdraw`.

1. Let order matching spend first: iCKB allowance is the full iCKB balance, and CKB allowance is `max(0, availableCkb - CKB_RESERVE - direct deposit fee headroom)`.
2. Derive useful post-match floors only from a complete `OrderManager.bestMatch(...)` result. An incomplete positive match uses actual post-match balances with zero optimality-dependent floors.
3. If fewer than two output slots remain after matching, return `none`.
4. If post-match iCKB is below the useful CKB-to-iCKB floor, return one same-transaction direct `deposit` when CKB can fund `directDepositCapacity + CKB_RESERVE + direct deposit fee headroom`.
5. If the current full-pool ring bucket is under-covered and the same creation gates pass, return one direct `deposit`.
6. If post-match CKB is below `CKB_RESERVE + useful UDT-to-CKB floor`, or iCKB refill is needed but cannot be funded, try reserve recovery withdrawal.
7. If iCKB refill is still needed after reserve recovery fails, return `none`.
8. If iCKB exceeds the useful withdrawal floor, select ready ring-surplus deposits for ordinary withdrawal.
9. If no candidate satisfies the ring rules, return `none`.

Runtime transaction construction applies the chosen action after order matching. For `withdraw`, the withdrawal request is passed into `sdk.buildBaseTransaction(...)`. For `deposit`, `logic.deposit(...)` adds the fresh deposit. The bot completes iCKB UDT balance, CKB capacity, fees, and the DAO output-limit check through `sdk.completeTransaction(...)` before signing.

The final CKB reserve guard uses projected `availableCkbBalance + match.ckbDelta - rebalance costs - fee`. It blocks transactions that would end below `CKB_RESERVE`, except withdrawal requests with non-negative match CKB delta. Withdrawal requests spend CKB now to restore CKB later, including ordinary `excess_ickb_balance`; they must not hide an unrelated CKB-spending match below reserve. Pending CKB from withdrawal requests still is not liquid in the current turn.

The direct-deposit fee headroom is a fixed prebuild margin. Exact fee remains a runtime completion concern because it depends on selected inputs, change, and witness size.

## Ring Bucket Seeding

Ring bucket seeding uses a fixed 180-epoch ring model over the configured live iCKB pool snapshot. The target segment is the segment containing `tip.epoch`; this is a policy bucket, not an exact post-inclusion maturity prediction.

The ring model is:

- ring length: `180` epochs
- origin: epoch `0` modulo the 180-epoch ring
- segment count: `2^(ceil(log2(poolDepositCount)))`
- segment index: `floor(((maturityEpoch mod 180 epochs) * segmentCount) / 180 epochs)`
- segment density: `segmentUdtValue / segmentLength`
- average density: `totalPoolUdt / ringLength`

Because all segments are equal width, the implementation checks under-coverage as `2 * targetSegmentUdtValue * segmentCount < totalPoolUdt`. If total pool `udtValue` is zero, density-based seeding does not run.

Ring seeding requires all creation gates:

- `ickbBalance >= useful CKB-to-iCKB floor`
- `ckbBalance >= directDepositCapacity + CKB_RESERVE + direct deposit fee headroom`

Then the current ring bucket rule applies:

- `0` pool deposits: return one direct `deposit`.
- Non-empty pool: seed when the current target segment is under-covered.

Public pool shape may admit or block direct ring seeding. If a seed is needed but `ckbBalance < directDepositCapacity + CKB_RESERVE + direct deposit fee headroom`, the bot does not use that ring need to withdraw. Public state still cannot create a future withdrawal, same-transaction rotation, retry widening, or persistent state. A known-code attacker can crowd, drain, dust, or stale-shape public deposits, but those shapes can only admit a direct deposit or block ring seeding.

Far-future withdrawal, same-transaction future rotation, retry widening, and persistence are disabled.

## Excess Withdrawals

Ordinary excess withdrawal is independent of ring seeding. It runs only after deposit and reserve-recovery paths decline, and only when available iCKB is above the useful iCKB withdrawal floor.

Normal candidates come only from ready deposits that are ring surplus in the configured live pool snapshot. Ring anchors for selected surplus deposits are passed as required live deposits.

When ordinary excess withdrawal does not build, the policy-owned no-op reason distinguishes the cause: `no_ready_withdrawal_selection` for no ready withdrawal selection at all, `no_ring_surplus_ready_deposits` when ready deposits exist but all are ring anchors, and `ring_surplus_withdrawal_over_budget` when ring-surplus ready deposits exist but none fit the withdrawable iCKB budget.

Pending CKB from an excess withdrawal request is not treated as liquid until a later turn reads it from account state.

## Reserve Recovery

Reserve recovery is bot-only anchor breaking. It runs when post-match CKB is below `CKB_RESERVE + useful UDT-to-CKB floor`, or when iCKB refill is needed but CKB cannot fund a direct deposit.

The useful floor is derived from matcher diagnostics. It is a recovery trigger after matching has spent freely, not a soft reserve withheld from matching.

This useful CKB floor is the urgency signal that permits reserve recovery to break ring anchors before the hard reserve is breached. Without that signal, anchors remain protected by normal withdrawal policy.

Once reserve recovery is triggered, the selector first tries ring surplus, then may choose any ready deposit within the available iCKB and output-slot caps. This may break ring anchors because restoring CKB matching capability takes priority once the bot is below the useful CKB floor or cannot fund the required iCKB refill.

## Ready Withdrawals

Ready withdrawals run only when no deposit action has already been selected. They are labeled `reserve_recovery` when they restore matching capability and `excess_ickb_balance` otherwise.

The normal selector filters ready deposits through configured-pool ring surplus. A deposit is ring surplus when its ring segment still has an anchor after removing it. The chosen anchor for selected surplus is passed as a required live deposit, so stale inclusion fails instead of silently consuming the last live representative.

Candidate selection calls `selectReadyWithdrawalDeposits(...)`, which compares a bounded best-fit search over the top 30 ranked candidates against a greedy scan over the full candidate list. The selected set is the higher-value valid subset under the amount and count limits. Ties keep the earlier candidate order.

Normal ready withdrawals never spend ring anchors. The only path that can break ring anchors is reserve recovery above.

Withdrawal count is capped by `min(MAX_WITHDRAWAL_REQUESTS, floor(outputSlots / 2))`.

## Send Turn

Each process runs one turn: it builds at most one transaction, sends it through the initialization-owned signer closure, and calls the SDK transaction waiter with a 10-minute timeout and 10-second polling interval. There is no inner loop, retry budget, or sleep; the systemd unit (`Restart=always`, `RestartSec=60`) or the operator starts the next turn. Rejections and confirmation failures are reported as `bot.transaction.failed` and `bot.turn.failed` events with the broadcast hash. A broadcast transaction gets that one observation window: a confirmation failure or a node hash mismatch exits with code `2`, which `RestartPreventExitStatus=2` turns into a hold rather than a rebuild and resend of the intent. Only an RBF-replaced rejection exits `1`, because the sent transaction can then never confirm. Large numeric values are logged as strings to preserve bigint precision.

## Non-Goals

The bot does not try to:

- globally optimize the full 180-epoch pool outside the configured snapshot
- predict the exact inclusion maturity of a pending fresh deposit
- withdraw far-future deposits or rotate future sources in the same transaction as a fresh deposit
- create ring inventory when the hard CKB reserve, useful iCKB floor, or output-slot gates fail
- persist ring observations or retry-widen across loops
- treat pending CKB from withdrawal requests as liquid before account state reports it
- publish a consensus or API pool snapshot; operator diagnostics may include compact pool summaries and content-addressed artifacts under `log/`
- coordinate with other bots beyond the current visible chain state
