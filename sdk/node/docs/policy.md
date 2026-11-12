# Bot Policy

What one bot turn does, in which order, with who owns each part. The next turn starts ten minutes after this one started ([the loop](loop.md)).

- [`match.ts`](../src/bot/match.ts) chooses fills ([matching](matching.md)).
- [`policy.ts`](../src/bot/policy.ts) chooses rebalances ([rebalancing](rebalancing.md)).
- [`transaction.ts`](../src/bot/transaction.ts) builds the candidates.
- [`turn.ts`](../src/bot/turn.ts) sends the first fundable one.

## One turn

1. Match profitable orders with the current inventory.
2. On the balances left, try a deposit, then a withdrawal chain, then the match or the collections alone. A transaction never carries both a deposit and a withdrawal request.
3. Collect receipts and matured withdrawals on every candidate. Complete iCKB, capacity and fees from the liquid cells the projection offers, spending every one.
4. Send only when a match, deposit, withdrawal request, collection or liquid cell away from the primary lock remains, such as [one at another key](changing_the_key.md). Compacting cells already at the primary lock never sends.

A skip, a commit or a failure ends the turn. The next one, in the same process or after the [restart](loop.md), reads the chain again.

There's no capital hold: an underfunded account recovers as soon as it's funded. A hold turned that self-healing retry into unattended downtime.

There's no durable pending store either. A rebuilt transaction can conflict with a pending one, or be a second valid transaction. Duplicate intent is an accepted risk; the turn model doesn't prevent it.

## Completion owns affordability

The bot tries prefixes of one greedy withdrawal chain, longest first, with the [SDK completer](../../docs/transaction_completion.md#the-plan-walk) as the oracle. A shorter prefix needs fewer markers and less iCKB.

Trying every start made this walk quadratic in ready deposits. A chain starting later can still fund where these prefixes don't, when the iCKB of the account lies past the share of cells one transaction gets. That missed chance is accepted: a later transaction consolidates the account.

Collections and the offered liquid cells stay on each candidate:

- **A matured withdrawal:** brings in CKB.
- **A receipt:** becomes an iCKB cell of about its own capacity.
- **DAO outputs:** neither adds one.

Funding the action comes first. The action prefix stays first in the transaction, with housekeeping after it. The projection selects at most 256 matured withdrawals per transaction, because the deployed DAO script addresses only that many deposit-header slots. The rest wait a turn.

## Why the reserve is not a final check

Matches and deposits are sized to leave at least 1,000 CKB in liquid cells, plain and iCKB alike. Completion can draw on it for the fee, a receipt and an iCKB change cell when no iCKB cell was offered. Withdrawal chains are sized in iCKB, so their owner markers can spend CKB down to fee headroom.

A final reserve check stalled live turns. The bot picked a fill sized to the reserve. Completion paid the remaining costs of the transaction. Then the check refused the result, so the next turn picked the same fill again. Raising the reserve moves both lines. Adding a tolerance creates a second sizing rule. So completion is the funding authority, while the next turn plans from the actual balance.

The reserve isn't a loss limiter. Tests and the balance changes in the journal catch a builder defect that gives capacity away, not the removed check.

## More

- [Matching](matching.md): how fills are picked, the partial cap and the refill coupling.
- [Rebalancing](rebalancing.md): the iCKB band, the deposit and withdrawal rules, the stress line.
- [The maturity ring](maturity_ring.md): how deposit maturities spread over a DAO cycle.
- [Withdrawal timing](withdrawal_timing.md): `BOT_LOCK_UP`, the step two minutes after the send, the restart cost.
- [Operating assumptions](operating_assumptions.md): the node, the funding, recovery.
