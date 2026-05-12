# Pool Maturity Estimates

This note describes the current stack-owned contract for estimating iCKB-to-CKB conversion timing in UI consumers.

## Scope

This is an off-chain stack mechanism, not protocol law.

- `apps/bot` owns bot liquidity and withdrawal-request production.
- `@ickb/sdk` owns the summary that interface consumers read as `system.ckbAvailable` and `system.ckbMaturing`.
- `apps/interface` renders that summary into conversion-time estimates.

## Current Runtime Path

The current SDK estimate path does **not** use a bot-written pool snapshot.

This direct-scan path assumes the deposit pool is still small enough that interface-side maturity estimates can afford a live scan when needed.

Instead, `packages/sdk/src/sdk.ts` builds the estimate from:

- bot plain-capacity cells
- bot-owned ready and pending withdrawal requests
- direct scans of pool deposits via `LogicManager.findDeposits(...)`

Ready deposits are counted as immediately available CKB.
Not-ready deposits remain in the future maturity buckets.

These scans fail closed when the scan reaches the configured cell limit sentinel. A partial pool scan is not treated as a lower-confidence estimate, because interface timing and bot liquidity decisions need to distinguish incomplete state from genuinely unavailable liquidity.

## Why The Older Snapshot Path Was Removed

The older snapshot idea tried to summarize the full deposit pool without scanning every deposit.

That design was removed from the live runtime because the old format had no explicit discriminator. In practice, arbitrary aligned bot-owned no-type data could be mistaken for a snapshot. For UI estimation, approximation is acceptable, but misidentifying unrelated bytes as an estimate source is not.

So the current stack chooses the smaller honest contract:

- direct deposit scans are slower at large pool sizes
- but the data source is unambiguous

An archived copy of the older codec is kept at `packages/sdk/docs/pool_snapshot_codec.ts` as future implementation reference only.

## What A Future Snapshot Implementation Would Need

If deposit-pool growth makes direct scans too expensive for UI use, a snapshot design can still make sense. But it must be a real stack-owned format, not just a byte-length heuristic.

A future revival should define:

1. an explicit format identity, such as a versioned prefix or a dedicated cell shape
2. a clear writer, likely the bot
3. a clear reader, `@ickb/sdk`
4. freshness and fallback rules
5. exact behavior when the snapshot is missing, stale, malformed, or partial

Until then, direct deposit scanning remains the active runtime contract.
