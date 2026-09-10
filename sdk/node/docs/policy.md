# Bot Policy

The behaviour of `sdk/node/src/bot/` as settled in decisions amendment 52: `policy.ts` decides, `runtime/transaction.ts` builds, `turn.ts` sends once and waits.

## The policy

Every turn, at most one transaction. The bot reads the chain, decides, sends once, waits for confirmation, and forgets everything.

1. **Match.** One fill at a time from the book, each the largest the balances pay: the bot's CKB minus the 1,000 CKB reserve (clamped at zero) and its iCKB, the fill's mining fee reserved first. Each step takes the fill that returns most per unit of value paid, its exchange value net of ten fees (the buffer for the rebalancing it commits the bot to, so dust never qualifies), and stops when nothing returns or at 58 partials, since the DAO 64-output limit is shared with deposits and requests. Buyers and sellers fund each other only across steps, a whole order beyond the balances waits for a later turn, and a losing order is never a bridge; the bot converts its own inventory through the protocol instead. Every order is matchable whatever its minimum match. Orders are shuffled once per turn by a seed from the tip, so equal fills fall in no fixed order and no book can be arranged against one. Own limit orders are ignored entirely; they are only excluded from the market book. The contract is progress per turn, not the best match: what is not taken this turn is offered again next turn to a book the match changed.

2. **Then one of these two, never both, judged on the balances after the match:**
   - **Deposit** one cap-sized deposit when the ring segment containing the tip lacks coverage (under half its equal share of the pool's iCKB), or when the bot holds under 2,000 iCKB, if 1,000 CKB remains after it. One deposit serves both reasons; the reason is recorded.
   - **Otherwise withdraw** ready surplus deposits while the bot holds over 120,000 iCKB, keeping 20,000: oldest first, skipping any deposit that does not fit, as many as fit. Anchors are never touched, except under stress: when spendable CKB (CKB minus reserve) is below one fifth of a deposit, ready anchors may be taken under the same order and limits.
   - If both fire, the deposit is tried first; if it cannot complete, the withdrawal is tried in the same turn. Priority is among fundable candidates, never a reason to send nothing. A ring roll is therefore a deposit one turn and a withdrawal the next.

3. **Housekeeping rides along.** Every transaction also collects what is ready (matured withdrawals, then receipts) and sweeps the bot's loose plain and iCKB cells, largest first, up to a 64 KiB prepared-size limit. Funding for the action comes first and may draw on collectible cells. Position in the transaction is protocol-fixed: the aligned action prefix first (deposit input i to request output i, matched order cells), everything else appended.

4. **One acceptance check, on the completed transaction.** Matches and deposits must leave the reserve in plain CKB after fees and change; withdrawal requests must leave only fee headroom, because they bring the CKB back. No other arithmetic bound.

5. **If the transaction does not complete or fails the check,** shed first the sweep, then the collections, then the last item of the action core, and try again; when a deposit core is exhausted, continue with the withdrawal candidates; when no prefix of a withdrawal chain completes, drop its oldest deposit and rebuild the chain from the next one. A transaction sends only if it still carries a match, a deposit, a withdrawal request, or a collection. Compaction alone never sends. The profit gate applies to the match core only; housekeeping fees never veto a match.

## Units

iCKB thresholds are constants in units of the deposit cap `Q` (100,000 iCKB), compared with the iCKB balance: refill below `Q/50`, retain `Q/5`, withdraw above `Q + Q/5`. The CKB side uses one deposit `D`, which is `Q` converted at the sampled tip: stress below `D/5`. The reserve is 1,000 CKB. See `src/bot/policy/constants.ts`.

## Prerequisites

- Committed-only indexer reads: the operator's node keeps CKB's default `[indexer_v2] index_tx_pool = false`. With pool indexing on, a timed-out send can be duplicated with disjoint inputs on later turns.
- An exclusive node.
- Recommended funding: about 2.2 deposits total plus some plain CKB above the reserve. Below it the bot still matches what it can but may idle with a full buffer waiting for a buyer. The number derives from the thresholds (1.2 deposits of iCKB before withdrawal, one deposit plus reserve to deposit) and must be recomputed if they change.

## Properties

- Self-recovery: from every reachable state, including a crashed turn, a timed-out send, a reorg, or a partial collection, later stateless turns rebuild a normal state without an operator. Under committed-only reads a retry either conflicts with the pending transaction or is a second independently valid one; no durable pending state exists.
- No stall above the recommended funding: a turn is empty only when no fill the balances pay returns ten fees. A better-priced order that keeps refilling can win every turn ahead of the rest; that is best price per turn, not eventual service for every order. Below the recommended funding, only the documented idle.
- No busywork beyond coverage-driven ring rolls, which are bounded by ready deposits and affordability.
- Fund safety: signer-body check, signed fee-rate ceiling, conservation.
- Tradeoffs, explicit: buyers are served up to current iCKB inventory plus transit; sellers up to spendable CKB; withdrawal markers may spend plain CKB down to fee headroom, after which the bot waits for maturity; a request committed after its sampled window locks for another cycle; anchors cost one segment's coverage for one cycle when taken.
