# Pool Maturity Estimates

This note describes the current stack-owned contract for estimating iCKB-to-CKB conversion timing in UI consumers.

## Scope

This is an off-chain stack mechanism, not protocol law.

- `sdk/node` (the bot) fills orders and produces withdrawal requests; the estimate does not model it.
- `@ickb/sdk` owns the summary that interface consumers read as `system.ckbAvailable` and `system.ckbMaturing`.
- `interface` renders that summary into conversion-time estimates.

## Current Runtime Path

The current SDK estimate path does **not** use a bot-written pool snapshot.

This direct-scan path assumes the deposit pool is still small enough that interface-side maturity estimates can afford a live scan when needed.

Instead, `getL1AccountState` builds the estimate from direct scans of pool deposits via `LogicManager.findDeposits(...)`.

Ready deposits, those whose claim epoch lies within the readiness window (three days by default), are counted as immediately available CKB.
Not-ready deposits remain in the future maturity buckets.

The bot's own working capital is not counted: the SDK used to carry one hardcoded bot lock per network for this, but that capital only matters when no pool deposit matures inside the window, and a published library should not name one operator's wallet (decisions amendment 52(ai)).

The result is eventually consistent rather than snapshot-atomic: the targeted indexer scans can observe different indexer progress while sharing one sampled tip. The SDK does not reread them to manufacture snapshot semantics.

## Why Direct Scans Are Used

The older snapshot idea tried to summarize the full deposit pool without scanning every deposit.

That design was removed from the live runtime because the old format had no explicit discriminator. In practice, arbitrary aligned bot-owned no-type data could be mistaken for a snapshot. For UI estimation, approximation is acceptable, but misidentifying unrelated bytes as an estimate source is not.

So the current stack chooses the smaller honest contract:

- direct deposit scans are slower at large pool sizes
- but the data source is unambiguous

## What A Future Snapshot Implementation Would Need

If deposit-pool growth makes direct scans too expensive for UI use, a snapshot design can still make sense. But it must be a real stack-owned format, not just a byte-length heuristic.

A future revival should define:

1. an explicit format identity, such as a versioned prefix or a dedicated cell shape
2. a clear writer, likely the bot
3. a clear reader, `@ickb/sdk`
4. freshness and fallback rules
5. exact behavior when the snapshot is missing, stale, malformed, or partial

Until then, direct deposit scanning remains the active runtime contract.
