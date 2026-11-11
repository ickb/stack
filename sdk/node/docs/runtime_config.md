# Runtime Config

The bot reads four environment variables. The generator reads `STIMULUS_CHAIN`, `STIMULUS_RPC_URL` and `STIMULUS_PRIVATE_KEY_FILE` the same way ([generator](generator.md)).

## The variables

- **`BOT_CHAIN`:** `testnet` or `mainnet`.
- **`BOT_RPC_URL`:** one or more HTTP(S) or WebSocket RPC URLs, comma-separated with no spaces. They're the only endpoints. Each must serve the indexer calls `get_cells` and `get_transaction_proof`. Userinfo, whitespace and control characters are refused ([the RPC list](#the-rpc-list)).
- **`BOT_PRIVATE_KEY_FILE`:** the absolute path of a mode `0600` file holding only signing keys ([the key file](#the-key-file)).
- **`BOT_MAX_FEE_RATE` (optional):** the most the bot plans to pay per kB, in shannons, at least 1000, the default node admission floor ([the fee cap](#the-fee-cap)).

An invalid value fails with `Invalid env <NAME>`. The value itself never appears.

## The RPC list

List the node of the operator beside providers such as a free-tier Ankr or GetBlock endpoint. Each process shuffles the list. CCC moves to the next URL only when a request fails in transport, then stays there. A node that answers with an error body or a stale tip doesn't move it: it fails the turn instead. With two nodes, a restart starts on the other one time in two, more often with more nodes.

The list is required, even with only public nodes: the public pool of CCC keeps a fixed order the shuffle can't reach. List one URL per node, as the testnet units do. The WebSocket and HTTPS URLs of `testnet.ckb.dev` reach the same node (same `local_node_info` id), so listing both would only make that node the start two times in three.

The shuffle replaced a fixed order with the node of the operator first. A liveness review found that a node answering badly then failed every restart from the same first URL. The cost: that node no longer takes most of the load, so provider quotas are spent in proportion.

The SDK verifies what it reads: every header against its hash. A tip whose parent is more than five minutes behind the host clock, the slack of the bot policy, fails the turn.

The journal names each endpoint by protocol, hostname and port only, never its path, query or fragment, where providers put API keys. The `rpcEndpoints` field lists them in the order the process uses. Transport errors are logged whole, so they may quote a URL. A free-tier provider key there costs at most its quota, which the operator accepts. A key worth more needs its own review of that output boundary first.

## The key file

The file holds signing keys only, one per line, each as lowercase `0x` plus 64 lowercase hex characters:

- **First line:** the primary key. Its lock receives change. Its CKB pays fees.
- **Later lines:** other keys the bot signs for. Turns move their cells to the primary lock ([changing the key](changing_the_key.md)).
- **Whitespace:** ignored around each line, as are blank lines at either end, such as the final newline of an editor. A blank line between keys or a repeated key is refused.

The path must be absolute: pnpm runs the script from the package directory, so a relative path would name a different file depending on how the bot started.

The key lives in a file rather than a variable because unit files, `systemctl show` and every child process expose environment values.

## The fee cap

The state read caps the fee rate the node samples at `BOT_MAX_FEE_RATE`, through the CCC `getFeeRate(…, { maxFeeRate })`. Nothing can verify that sampled rate. The cap bounds what a node can make the bot pay. It also bounds what a node can make the [match gate](matching.md) refuse by inflating the fee it subtracts.

A mainnet unit sets 1000, since mainnet activity is low. The testnet unit sets none, because the testnet rate moves. The [send](../../docs/signing_and_broadcast.md#the-fee) refuses a fee above the planned one, measured from verified inputs, so the cap also bounds what the chain takes. `bot.state.read` carries the rate planning uses, which equals the cap when it binds.

## The client

The process owns the CCC client. It disposes the client when it ends, so open sockets don't keep it alive. The SDK only borrows the client: it neither picks endpoints nor disposes it.
