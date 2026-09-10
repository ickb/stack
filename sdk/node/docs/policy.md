# Bot Policy

The behaviour of `sdk/node/src/bot/` as settled in decisions amendment 52: `policy.ts` decides, `runtime/transaction.ts` builds, `turn.ts` sends once and waits.

## The policy

Every turn, at most one transaction. The bot reads the chain, decides, sends once, waits for confirmation, and forgets everything.

1. **Match.** Take the best profitable match from the book, spending at most the bot's CKB minus the 1,000 CKB reserve (clamped at zero), and its iCKB. Own limit orders are ignored entirely; they are only excluded from the market book. Orders whose minimum-match exponent is above the default (33, about 86 CKB) are left to other bots: above it an order fills only in whole steps larger than the default minimum, which is what lets a crafted book hide a cross behind subsets that never close; every standard order carries the default, and an order whose remaining size falls below its minimum still fills whole. Up to 58 partials per transaction, since the DAO 64-output limit is shared with deposits and requests. Feasibility is decided by the final net balances of the whole transaction; candidate generation may use optimistic bounds as long as they exclude no feasible match.

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
- No stall above the recommended funding, except unvisited candidates of the match search (dust starvation is an accepted adversarial cost: the attacker pays fees and parks capital every turn). Below the recommended funding, only the documented idle.
- No busywork beyond coverage-driven ring rolls, which are bounded by ready deposits and affordability.
- Fund safety: signer-body check, signed fee-rate ceiling, conservation.
- Tradeoffs, explicit: buyers are served up to current iCKB inventory plus transit; sellers up to spendable CKB; withdrawal markers may spend plain CKB down to fee headroom, after which the bot waits for maturity; a request committed after its sampled window locks for another cycle; anchors cost one segment's coverage for one cycle when taken.
