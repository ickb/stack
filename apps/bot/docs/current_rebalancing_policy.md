# Current Bot Rebalancing Policy

This document describes the policy currently implemented in `apps/bot/src/policy.ts`.

## Goal

The bot keeps enough liquid iCKB to keep matching and redemption paths responsive, while leaving as much capital as practical in CKB.

The live policy is intentionally small:

- keep a minimum iCKB inventory
- refill that inventory with one direct deposit when it gets too low
- request withdrawals from ready pool deposits when iCKB inventory drifts too high
- do nothing when output space or balances make the action unsafe

## Inputs

`planRebalance(...)` decides from five inputs:

- `outputSlots`: how many transaction output slots remain before the bot would hit its DAO-safe output cap
- `ickbBalance`: currently available iCKB after pending order matches are applied
- `ckbBalance`: currently available CKB after pending order matches are applied
- `depositCapacity`: the current CKB capacity required for one standard iCKB deposit at the live exchange ratio
- `readyDeposits`: ready pool deposits that the bot can request for withdrawal now

## Constants

The current policy is shaped by three constants in `apps/bot/src/policy.ts`:

- `CKB_RESERVE = 1000 CKB`: the bot keeps this much extra CKB after making a new deposit
- `MIN_ICKB_BALANCE = 2000 iCKB`: if iCKB falls below this line, the bot tries to replenish it
- `TARGET_ICKB_BALANCE = 100000 iCKB + 20000 iCKB`: if iCKB rises above this target band, the bot tries to convert excess iCKB back toward CKB through ready deposit withdrawals

The current withdrawal request cap is `30` deposits per transaction.

## Decision Order

The policy is deliberately greedy and local.

1. If fewer than two output slots remain, do nothing.
2. If available iCKB is below `MIN_ICKB_BALANCE`:
   - request one new deposit if available CKB is at least `depositCapacity + CKB_RESERVE`
   - otherwise do nothing
3. If available iCKB is at or above `MIN_ICKB_BALANCE`, compute `excessIckb = ickbBalance - TARGET_ICKB_BALANCE`.
4. If `excessIckb <= 0`, do nothing.
5. Otherwise, pick a bounded subset of ready deposits whose total `udtValue` stays within `excessIckb`, and request withdrawals for that subset.

## Ready Deposit Selection

`selectReadyDeposits(...)` is intentionally simple.

- It walks the ready deposits in the order they were prepared by the bot state reader.
- It skips any deposit that would push the cumulative selected `udtValue` above the current excess target.
- It stops once it reaches the request limit.

This keeps the live policy predictable and cheap. It does not try to globally optimize pool shape.

## Ownership Boundary

This file describes bot-owned operating policy only.

- The bot owns when to add one more deposit.
- The bot owns when to request ready withdrawals.
- `@ickb/sdk` owns UI-side maturity estimation from live stack state.
- The older pool snapshot idea is not part of the current runtime path.

## Non-Goals

This policy does not try to:

- maintain a global optimal distribution of deposits over the full 180-epoch clock
- encode a snapshot summary for interface use
- predict or coordinate other bots' behavior beyond acting on current visible state

Those may still be useful research directions, but they are not the current live contract.
