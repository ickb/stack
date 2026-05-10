# Current Bot Rebalancing Policy

This document describes the behavior implemented by `apps/bot/src/index.ts`, `apps/bot/src/runtime.ts`, and `apps/bot/src/policy.ts`.

## Goal

The bot keeps enough liquid iCKB for order matching and withdrawals while leaving as much capital as practical in CKB. Each loop builds at most one completed transaction, sends it, and waits until the transaction is committed before starting the next loop.

The bot exits when its total CKB-equivalent capital is less than or equal to `21 / 20 * depositCapacity`, where `depositCapacity` is recalculated from the live exchange ratio.

## Runtime State

The runtime reads system and account state through `@ickb/sdk`, then derives the balances and pool slices used by `planRebalance(...)`.

- `accountLocks`: all signer address locks, deduplicated by full script bytes.
- `system`: live exchange ratio, tip header, fee rate, and market order pool from `sdk.getL1State(...)`.
- `userOrders`: the bot's order groups from `sdk.getL1State(...)`.
- `account`: spendable capacity, native iCKB, receipts, and withdrawals from `sdk.getAccountState(...)`.
- `marketOrders`: system order-pool entries not already owned by the bot.
- `readyPoolDeposits`: pool deposits that are ready now.
- `nearReadyPoolDeposits`: not-ready pool deposits from the end of the current ready window until, but not including, one hour later.
- `futurePoolDeposits`: not-ready pool deposits after that near-ready hour.
- `availableCkbBalance` and `availableIckbBalance`: account balances projected with collected orders available.
- `unavailableCkbBalance`: CKB pending in not-ready withdrawals.
- `depositCapacity`: CKB required for one standard 100,000 iCKB deposit at the live exchange ratio.
- `minCkbBalance`: shutdown threshold set to `21 / 20 * depositCapacity`.

The public pool scan reads one sentinel entry beyond the default cell limit and fails closed if that sentinel appears, because rebalance decisions require a complete pool slice.

`nearReadyPoolDeposits` only ranks ready-window withdrawal choices. Fresh deposits are scored against `futurePoolDeposits`, not against the near-ready hour.

## Constants

- `CKB_RESERVE = 1000 CKB`: CKB left aside when creating a direct refill or future inventory.
- `MIN_ICKB_BALANCE = 2000 iCKB`: below this value, the bot prioritizes a direct deposit refill.
- `TARGET_ICKB_BALANCE = 120000 iCKB`: above this value, the bot may request ready withdrawals.
- `NEAR_READY_LOOKAHEAD_MS = 1 hour`: exclusive horizon used to compute ready-bucket refill tie-breaks.
- `READY_POOL_BUCKET_SPAN_MS = 15 minutes`: maturity bucket width for ready deposit selection.
- `MAX_WITHDRAWAL_REQUESTS = 30`: maximum deposits requested for withdrawal by one rebalance action.
- `BEST_FIT_SEARCH_CANDIDATES = 30`: bounded top-ranked horizon for exact subset selection.

One direct deposit or withdrawal request uses two output slots. The bot computes remaining output slots before rebalancing as `58 - tx.outputs.length` after order matches have been added.

## Decision Order

`planRebalance(...)` returns one of three actions: `none`, `deposit`, or `withdraw`.

1. If fewer than two output slots remain, return `none`.
2. If `ickbBalance < MIN_ICKB_BALANCE`, return one `deposit` only when `ckbBalance >= depositCapacity + CKB_RESERVE`; otherwise return `none`.
3. If future seeding gates pass, return one direct `deposit`.
4. Compute `excessIckb = ickbBalance - TARGET_ICKB_BALANCE`.
5. If `excessIckb <= 0`, return `none`.
6. Try at most one ready-only non-standard cleanup withdrawal.
7. Select ordinary ready deposits for withdrawal using the ready-window rules below.
8. If no withdrawal candidate satisfies the rules, return `none`.

Runtime transaction construction applies the chosen action after order matching. For `withdraw`, the withdrawal request is passed into `sdk.buildBaseTransaction(...)`. For `deposit`, `logic.deposit(...)` adds the fresh deposit. The bot completes iCKB UDT balance, CKB capacity, fees, and the DAO output-limit check through `sdk.completeTransaction(...)` before signing.

## Future Inventory

Future inventory actions use a fixed 180-epoch ring model around the coarse fresh-deposit target `tip.epoch.add([180, 0, 1]).toUnix(tip)`. This target is only a candidate region for a future deposit, not an exact post-inclusion maturity prediction.

The ring model is:

- ring length: `tip.epoch.add([180, 0, 1]).toUnix(tip) - tip.epoch.toUnix(tip)`
- origin: absolute unix `0` modulo the ring length
- segment count: `2^(ceil(log2(futureDepositCount)))`
- segment index: `floor(((maturityUnix mod ringLength) * segmentCount) / ringLength)`
- segment density: `segmentUdtValue / segmentLength`
- average density: `totalFutureUdt / ringLength`

The target segment is under-covered when `targetDensity < 0.5 * averageDensity`. If total future `udtValue` is zero, density-based seeding does not run.

Future seeding requires all future-inventory creation gates:

- `ickbBalance > MIN_ICKB_BALANCE`
- `ckbBalance >= depositCapacity + CKB_RESERVE`
- `ickbBalance + ICKB_DEPOSIT_CAP <= TARGET_ICKB_BALANCE`

Then the topology rules apply:

- `0` future deposits: return one direct `deposit`.
- `1` future deposit: return `none`.
- `2` future deposits: seed only when both deposits land in the same `Q = 2` segment and the target segment is under-covered.
- `3+` future deposits: seed when the target segment is under-covered.

Public future pool shape may veto or choose whether the already-budgeted direct deposit targets the first future segment policy path, but it cannot create any withdrawal request, same-transaction rotation, retry widening, or persistent state. This is the non-amplification invariant: public pool state is negative-only for removals. A known-code attacker can crowd, drain, dust, or stale-shape public future deposits, but those shapes can only block or admit the bot's independently budgeted direct deposit; they cannot make the bot remove future liquidity.

Far-future withdrawal, same-transaction future rotation, retry widening, and persistence are disabled.

## Non-Standard Cleanup

Non-standard cleanup is a narrow ready-only withdrawal path for crowded-bucket extras whose iCKB value is larger than one standard deposit. It runs only after output slots and `excessIckb` are known and only when no deposit action has already been selected.

The bot admits at most one cleanup candidate per rebalance. The candidate must come from `readyPoolDeposits`, be a withdrawable extra rather than a singleton or protected crowded anchor, have `deposit.udtValue > ICKB_DEPOSIT_CAP`, and leave `ickbBalance - deposit.udtValue >= TARGET_ICKB_BALANCE`. Cleanup also pins the protected anchor from the same ready bucket as a `cell_dep`; if that anchor is spent before inclusion, the cleanup transaction fails instead of consuming the extra as the new live anchor.

The value-positive predicate is intentionally the implementation predicate from `@ickb/core`: iCKB value discounts only amounts above `ICKB_DEPOSIT_CAP`, so cleanup starts with `deposit.udtValue > ICKB_DEPOSIT_CAP`. Under-cap and cap-sized dust are ignored.

Cleanup does not inspect `nearReadyPoolDeposits` or `futurePoolDeposits`, does not persist observations, does not widen retries, and does not couple a withdrawal to a same-transaction deposit. It classifies ready buckets without near-ready refill, so public near-ready state cannot steer cleanup. Pending CKB from the withdrawal is not treated as liquid CKB for future seeding until the normal send loop observes it in account state after chain processing.

The `ickbBalance` used for cleanup is the post-match liquid iCKB passed to `planRebalance(...)`. Positive-gain matched orders are already selected before rebalancing and are treated as current transaction liquidity; public pool candidates still cannot enlarge the cleanup budget.

Cleanup is not a standard redeposit policy. The bot may later create standard deposits only through the ordinary deposit gates, in a later exclusive rebalance action.

Attack assumption: a known-code attacker can add near-ready, future, under-cap, cap-sized, or over-cap public deposits. Only a ready over-cap extra that preserves the target liquid iCKB floor can be removed, and only one per loop. Public non-ready state cannot unlock cleanup, protected-anchor consumption, or same-transaction rotation. This is the cleanup non-amplification invariant.

## Ready Withdrawals

Ready withdrawals run only when `ickbBalance > TARGET_ICKB_BALANCE` and no deposit action has already been selected.

The selector groups ready deposits into 15-minute maturity buckets.

- A bucket with one ready deposit is a singleton anchor.
- A bucket with multiple ready deposits is crowded.
- In each crowded bucket, the protected deposit is the largest `udtValue` deposit. With equal values, the runtime keeps the latest deposit because ready deposits are sorted by maturity before selection.
- The other deposits in crowded buckets are withdrawable extras.
- Crowded buckets rank by withdrawable extra value first, then by near-ready refill in the following hour, then by earlier bucket.
- Singleton buckets rank by near-ready refill first, then by earlier bucket.

Candidate selection calls `selectReadyDeposits(...)`, which compares a bounded best-fit search over the top 30 ranked candidates against a greedy scan over the full candidate list. The selected set is the higher-value valid subset under the amount and count limits. Ties keep the earlier candidate order.

Singleton anchors are spendable only when `excessIckb >= ICKB_DEPOSIT_CAP`.

The ordinary ready withdrawal flow is:

1. Try crowded-bucket extras under `excessIckb`.
2. If extras were selected and singleton consumption is unlocked, top up from singleton buckets with remaining amount and withdrawal slots.
3. If no extras were selected and singleton consumption is locked, try all non-singleton ready deposits.
4. If singleton consumption is unlocked, try singleton buckets, then all ready deposits.

When an ordinary withdrawal selects a crowded-bucket extra, the transaction also pins that bucket's protected deposit as a `cell_dep`. If the protected deposit is spent before inclusion, the withdrawal transaction fails instead of succeeding against stale bucket classification. This is only an inclusion-time liveness check: it does not reserve public protected deposits after the bot transaction commits, and it cannot stop a later same-block or later transaction from spending a public protected deposit.

Withdrawal count is capped by `min(MAX_WITHDRAWAL_REQUESTS, floor(outputSlots / 2))`.

## Send Loop

The bot validates `BOT_SLEEP_INTERVAL` as a finite number of seconds greater than or equal to one. Each loop sleeps for a random duration from `0` to `2 * BOT_SLEEP_INTERVAL`, builds at most one transaction, sends it, and polls the transaction status every 10 seconds until it is committed. `sent`, `pending`, `proposed`, `unknown`, and missing status are treated as pending. Rejected transactions and confirmation timeouts are reported in the JSON log with the broadcast hash when one exists. Large numeric values are logged as strings to preserve bigint precision. Confirmation timeouts stop the loop with exit code `2` so the wrapper does not immediately build conflicting replacement work.

## Non-Goals

The bot does not try to:

- globally optimize the full 180-epoch pool
- predict the exact inclusion maturity of a pending fresh deposit
- withdraw far-future deposits or rotate future sources in the same transaction as a fresh deposit
- create future inventory when reserve, minimum iCKB, target-band, or output-slot gates fail
- persist future-pool observations or retry-widen across loops
- treat pending CKB from cleanup withdrawals as liquid before account state reports it
- encode or publish a pool snapshot summary
- coordinate with other bots beyond the current visible chain state
