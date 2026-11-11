# SDK Docs

The details behind the [SDK README](../README.md), one topic per page:

- [Package shape](package.md): layout, CCC as a peer, the runtime floor, versioning.
- [The `ickb` namespace](namespace.md): one barrel, one name, why no flat exports.
- [Reading the state](state_read.md): what `readState` reads, the lock-up presets, pool totals, APY.
- [Scans](scans.md): one scan per lock, the page loop, batched reads, order dates.
- [Node trust](node_trust.md): what the SDK checks in every node answer, what a lie can still cost.
- [The projection](projection.md): ready or converting, `datesOf`, the collect rule, `ckbConvertible`.
- [Limits of one transaction](transaction_limits.md): the script bounds, the input shares, outputs per conversion, cycles.
- [Building a conversion](transaction_completion.md): the plan walk, direct first, always an order, ring anchors.
- [What a build returns](build_result.md): the result fields, who owns the outputs, amount zero.
- [History](history.md): `readHistory`, one scan per lock, outputs-only amounts, known gaps.
- [Funding and compaction](funding_and_compaction.md): spending the offered cells, change and header deps.
- [Signing and broadcast](signing_and_broadcast.md): the checks before a send and the deadline.
- [The transaction hash](transaction_hash.md): the local hash, `maybe-sent` and why no hash leaves before the send.
- [Request header proof](request_header_proof.md): why each withdrawal request is proven in its block.
- [Confirmation](confirmation.md): `waitTransaction` and what follows a closed window.
- [Pool maturity estimates](pool_maturity_estimates.md): how an order is dated and the bot model behind it.
- [Estimate limits](estimate_limits.md): where the dates show up, what the order fee buys and what the model leaves out.
