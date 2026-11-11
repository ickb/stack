# SDK Docs

The details behind the [SDK README](../README.md), one topic per page:

- [Package shape](package.md): layout, the `ickb` namespace, CCC as a peer, the runtime floor and versioning.
- [Reading the state](state_read.md): what `readState` reads and how it scans.
- [Node trust](node_trust.md): what the SDK checks in every node answer and what a lie can still cost.
- [The projection](projection.md): ready or converting, `datesOf`, the collect rule and `ckbConvertible`.
- [Building a conversion](transaction_completion.md): the plan walk, direct first, ring anchors and DAO limits.
- [History](history.md): `readHistory`, its one scan per lock, outputs-only amounts and known gaps.
- [Funding and compaction](funding_and_compaction.md): spending the offered cells, change and header deps.
- [Signing and broadcast](signing_and_broadcast.md): the checks before a send, the deadline and the hash.
- [Request header proof](request_header_proof.md): why each withdrawal request is proven in its block.
- [Confirmation](confirmation.md): `waitTransaction` and what follows a closed window.
- [Pool maturity estimates](pool_maturity_estimates.md): how an order is dated and the bot model behind it.
- [Estimate limits](estimate_limits.md): where the dates show up, what the order fee buys and what the model leaves out.
