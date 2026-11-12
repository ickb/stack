# Bot Events

Every stdout line is one JSON object with `chain`, `runId`, ISO `timestamp` and a `bot.*` type. `runId` names the turn: the start time and pid of the process, then the number of the turn. Balance and fee amounts are decimal strings, so large on-chain values keep their precision.

The stable contract is this NDJSON stream of `bot.*` records, not a file path. Under systemd it's the journal of the unit; elsewhere it's wherever stdout goes. Consumers depend on the records, not on generator output or log locations.

## The nine types

Each event carries what's new at its step:

- `bot.turn.started`
- `bot.chain.preflight`
- `bot.state.read`
- `bot.decision.skipped`
- `bot.transaction.built`
- `bot.transaction.sent`
- `bot.transaction.committed`
- `bot.transaction.unresolved`
- `bot.turn.failed`

A decision follows the `bot.state.read` line it judged. The planned fee and shape of a sent transaction are in `bot.transaction.built`. One turn emits at most six: a skip ends the turn after `bot.decision.skipped`. A failure ends it at `bot.turn.failed` in place of the rest.

## Order directions

Directions in logs are the direction of the on-chain order owner, not of the bot inventory. Matching `ckb-to-ickb`, the bot spends iCKB to receive CKB. Matching `ickb-to-ckb`, it spends CKB to receive iCKB. So matcher allowance steps follow the asset the bot spends: at a rate such as `1 BTC = 100000 USD`, the same value step is `1000 USD` on the side spending USD and `0.01 BTC` on the side spending BTC.

## Preflight

`bot.chain.preflight` carries the recommended address, the primary lock and the RPC endpoint identities. It's emitted once the genesis hash of the node matches the chain, before any signing. A process opens with `bot.turn.started`, then this event.

A preflight with no `bot.turn.failed` before it follows an exit that logged nothing: the six-hour exit, the runtime limit of the unit, a stop or a kill. A configuration failure exits before any event, writing only to stderr. The systemd lines in the journal tell these apart. Endpoint identity is protocol, hostname and port only ([runtime config](runtime_config.md#the-rpc-list)).

## State and decisions

`bot.state.read` groups what the turn read:

- **`chainTip`:** the block the read is priced at, the parent of the tip.
- **`exchangeRatio`, `depositCapacity`, `feeRate`:** the sampled conditions, the fee rate after the [cap](runtime_config.md#the-fee-cap).
- **`balances`:** CKB and iCKB available now, pending CKB, total equivalent CKB, matchable CKB, cell count.
- **`counts`:** orders, receipts, withdrawals, pool deposits.

The cell count and the receipt count are the share offered to this transaction, the largest first, not the whole account.

`bot.decision.skipped` and `bot.transaction.built` carry the evaluation in `decision`:

- **`match`:** reason, candidate count, count of profitable whole fills, mining fee per fill, shuffle seed, matched order outpoints. The reason is `matched`, `no_market_orders`, `no_gain` or `unfunded_gain`. The last means profitable fills exist but the balances can't pay them.
- **`rebalance`:** the deposit reason (`low_ickb` or `ring_coverage`), the withdrawal candidates with the stress flag, the compact ring summary.
- **`core`:** the completed choice (`none`, `deposit` or `withdraw`) with its candidate attempts.
- **`actions`:** counts, the withdrawal requests among them. With `plannedFee` and `transactionShape`, it describes the result.

The `reason` of the event explains a skip: `no_actions` (no match, collection, fundable rebalance or liquid cell away from the primary lock) or `no_fundable_candidate` (every candidate failed to complete). A skip ends the turn. The next turn reads the chain again. A built transaction whose `actions` are all zero moves liquid cells to the primary lock, such as [those of another key](changing_the_key.md). The [reserve is a sizing line](policy.md#why-the-reserve-is-not-a-final-check), not a check on the completed transaction.

## Sends and commits

`bot.transaction.sent` carries the local hash, the elapsed time and `outcome`: `broadcasted`, or `broadcast_ambiguous` with the failure of the first broadcast as `error`, an answer that was unclear or a refusal. Either way the bot follows that hash, one step every 10 seconds for up to two minutes. A commit ends the turn at once, as does any failure, with `bot.turn.failed`. `bot.transaction.committed` carries the hash and the elapsed time. `bot.transaction.unresolved` carries the hash of a transaction still pending with no failure at two minutes: the turn ends normally, and the next one rebuilds on schedule.

`bot.turn.failed` carries the name, message, stack, cause chain and public enumerable fields of the error. Send evidence includes fields such as `code`, `data`, `outPoint`, `currentFee` and `leastFee`. Any other step fails the turn with `Transaction <hash> <status or reason>`, the step as its cause: `not-signed` or `expired` (nothing sent), `rejected` (the reason the node recorded, or its refusal, as the cause of the step), `abandoned`, or `pending` with the read that failed. Transaction, script and cell data that holds no secret may be logged when useful.

Rejections observed from a testnet full node in stale-state races:

- **Same input in the pool:** `code:-1111` with `data:"RBFRejected(...)"`, CCC fields `currentFee` and `leastFee`.
- **Input spent after a commit:** `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"`, CCC field `outPoint`.
- **The same transaction again:** `code:-1107` with `data:"Duplicated(Byte32(...))"`, CCC field `txHash`.

CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. CCC JSON-RPC id mismatches such as `Id mismatched, got null, expected 319` belong to the same family. The bot doesn't classify any of them: every failure exits `1`. The restarted process drops the failed state, then builds from fresh state rather than sending the same transaction again.

[Following the commit](withdrawal_timing.md#following-the-commit) joins a send to its observed commit. It doesn't decide whether the next turn may run. That turn builds from committed state. It may conflict with a transaction still pending, replacing it when it pays enough more, or pick other inputs for a second valid transaction. Duplicate intent is an accepted limit of having no durable pending store.

## What never gets logged

The bot never prints a private key to events, errors, stdout or stderr. Keys are for signing only:

- **Never handed over:** logger, event, error and test-hook APIs never receive private keys, signers, secret contexts, masking callbacks, redaction parameters or guard inputs.
- **Never logged:** secrets, tokens, passwords, API keys and config or environment dumps holding them. None goes to logging, redaction, masking or guard helpers either.
- **Tested:** the tests use a canary private key from outside the production path, then check no output can reveal it.

An RPC URL reaches the journal only as protocol, host and port, except where a transport error quotes it, which the [runtime config](runtime_config.md#the-rpc-list) accepts for free-tier keys.

## Retention

The journal is the only retained record. A second artifact store, incident directory or summary file would add another retention policy for the same turn. Compact ring evidence stays in the decision. The exact deposit sample isn't kept, so the journal alone can't rebuild it.

## Queries

Over the journal of the unit saved as one JSON line per event (a saved stdout stream works the same):

```bash
EVENT_FILE=$(mktemp) && journalctl --user -u ickb-bot-testnet.service -o cat | grep '^{' > "$EVENT_FILE"
jq -r '.type' "$EVENT_FILE" | sort | uniq -c
jq -c 'select(.type == "bot.chain.preflight") | {timestamp, chain, identity}' "$EVENT_FILE"
jq -c 'select(.type == "bot.decision.skipped") | {timestamp, chain, runId, reason, actions: .decision.actions}' "$EVENT_FILE"
jq -c 'select((.type == "bot.decision.skipped" or .type == "bot.transaction.built")) | {timestamp, reason, actions: .decision.actions, match: .decision.match, rebalance: .decision.rebalance, core: .decision.core}' "$EVENT_FILE"
jq -c 'select(.type | startswith("bot.transaction.") and . != "bot.transaction.built") | {timestamp, type, txHash, outcome, elapsedMs}' "$EVENT_FILE"
jq -c 'select(.type == "bot.turn.failed") | {timestamp, chain, runId, error}' "$EVENT_FILE"
jq -sc 'group_by(.runId) | sort_by(.[0].timestamp)[] | {runId: .[0].runId, events: map({(.type): del(.type, .runId, .chain)}) | add}' "$EVENT_FILE"  # one object per turn, its events keyed by type
```
