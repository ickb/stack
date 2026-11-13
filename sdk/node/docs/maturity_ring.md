# The Maturity Ring

How the bot keeps pool deposit maturities spread over a DAO cycle, so withdrawals find CKB close at hand.

## The segments

The ring partitions the cycle into a power-of-two number of segments: one per two deposit caps of pool iCKB. Each occupied segment protects one anchor, preferring a deposit that isn't ready. Unlike fixed-width windows, segments shrink as the pool grows. A doubling splits each old segment into two.

[`withdrawal_ring.ts`](../../src/conversion/withdrawal_ring.ts) owns the partition. User withdrawal plans skip the anchors too ([transaction completion](../../docs/transaction_completion.md)).

## Why pool value, not deposit count

A deposit made without iCKB Logic running carries no iCKB, so counting deposits would let zero-value spam multiply the segments.

Two caps per segment leave room for the own fills of the bot. A covered ring holds about one cap per segment. With one cap per segment, the fills after a doubling would double the ring again.

Rejected:

- **A hysteresis on the count:** user withdrawal plans need the ring to be a pure function of the pool.
- **A value threshold on deposits:** deposits just above it still inflate the count.

## Spam and coverage

Tiny deposits that aren't ready can still take the anchor slot of a segment. The coverage rule repairs that segment with one deposit per cycle, once the bot has two deposits of CKB spendable ([rebalancing](rebalancing.md#the-rules)). A bot drained by sellers doesn't have that until demand turns.

Zero-value deposits are neither filtered from withdrawal chains nor sorted after valued ones. Withdrawing one returns its 82 CKB of occupied capacity. So a flood of them costs a withdrawer only the order fee on the iCKB they displace: under an eighth of what the flood costs its sender. A value threshold is defeated by one shannon of free capacity.
