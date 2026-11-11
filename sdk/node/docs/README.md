# Node Docs

The details behind the [node actors](../README.md), one topic per page:

- [Bot policy](policy.md): what one turn does, in which order, why completion owns affordability, why the reserve isn't a final check.
- [Matching](matching.md): how fills are picked, the partial cap, the refill coupling.
- [Rebalancing](rebalancing.md): the iCKB band, the deposit and withdrawal rules, the stress line.
- [The maturity ring](maturity_ring.md): how deposit maturities spread over a DAO cycle.
- [Withdrawal timing](withdrawal_timing.md): `BOT_LOCK_UP`, the two-minute wait, the restart cost.
- [Operating assumptions](operating_assumptions.md): the node, the funding, recovery.
- [Runtime config](runtime_config.md): the environment variables, the RPC list, the key file and the fee cap.
- [The loop](loop.md): the ten-minute cadence, the six-hour exit, the warm cache and the designs it replaced.
- [Events](events.md): every `bot.*` event, its fields, what never gets logged and some `jq` queries.
- [Monitoring](monitoring.md): what to alert on, why a unit keeps skipping, what the journals should show.
- [Generator](generator.md): the testnet stimulus, its draw, its cadence and its log.
- [Deployment](deployment.md): the systemd install, updates and host isolation.
- [Changing the key](changing_the_key.md): moving the bot to a new key, with the rejected alternative.
