# iCKB Node Actors

`sdk/node` holds three one-turn entrypoints sharing preflight, configuration and logging:

- `src/bot.ts`: reads the market, matches profitable orders, collects ready funds and optionally rebalances between CKB and iCKB, then completes, signs, sends and waits.
- `src/stimulus.ts`: generates random testnet activity from a separate account.
- `src/sampler.ts`: samples mainnet headers to cross-check the interface's interpolated rate chart.

The bot minimizes excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

Order directions in logs and diagnostics are the on-chain order owner's direction, not the bot's inventory direction. When the bot matches `ckb-to-ickb`, it spends iCKB and receives CKB. When it matches `ickb-to-ckb`, it spends CKB and receives iCKB. Matcher allowance steps therefore follow the asset the bot spends; at an unbalanced rate such as `1 BTC = 100000 USD`, the same value step is `1000 USD` on the USD-spending side and `0.01 BTC` on the BTC-spending side.

The [bot policy](docs/policy.md) owns matching, rebalancing, inventory thresholds and funding tradeoffs. This document owns running the actors and interpreting their output.

## Runtime Config

The bot reads these environment variables:

- `BOT_CHAIN`: `testnet` or `mainnet`.
- `BOT_RPC_URL` (optional): one node's HTTP(S) or WebSocket RPC URL, used as the only endpoint. Absent, the bot uses CCC's public endpoints for the chain, WebSocket first with HTTPS fallbacks, and the journal's `rpcEndpoint` reads `{"mode":"default"}`. Userinfo, whitespace, and control characters are rejected.
- `BOT_PRIVATE_KEY_FILE`: path of a mode `0600` file holding only the signing key as lowercase `0x` plus 64 lowercase hex characters. Surrounding whitespace, such as an editor's final newline, is ignored. A relative path resolves against `INIT_CWD` when pnpm sets it, otherwise the working directory.

Use an RPC endpoint whose pathname contains no credential: preflight includes that path in the journal. Query and fragment are omitted from endpoint identity, but transport errors are logged whole, so this is not a general credential-removal layer. A credential-bearing provider needs a separate review of that output boundary before use.

The key lives in a file rather than a variable because unit files, `systemctl show`, and every child process expose environment values. Invalid values fail with `Invalid env <NAME>` and never echo the value.

Each bot process runs one turn and exits, so continuous matching is a loop around the process: a systemd user unit with `Restart=always`, or the operator between reads.

The process owns the CCC client and disposes it at the end of the turn so open sockets do not keep the process alive. The SDK borrows that client; it does not choose endpoints or dispose it.

## Run

From a plain checkout, run `pnpm install` from the repo root. CCC is resolved as a normal package dependency, and the app runs from TypeScript source under Node 22.19+. The key file lives outside the checkout, in a private directory:

```bash
pnpm install
install -d -m 700 ~/.config/ickb-bot && (umask 077 && $EDITOR ~/.config/ickb-bot/testnet.key)
export BOT_CHAIN=testnet BOT_PRIVATE_KEY_FILE=~/.config/ickb-bot/testnet.key
pnpm --filter ./sdk/node bot
```

The start script runs the bot once from source. Stdout is the NDJSON event stream and stderr carries diagnostics; both go wherever the caller sends them, which is journald under systemd. Balance and fee amounts are decimal strings so large on-chain values do not lose precision. Restart policy belongs to the service manager.

## Structured Events

Every stdout line is one JSON object with `chain`, `runId`, ISO `timestamp`, and a `bot.*` type. These events are the sole bot stdout contract.

The stable event contract is the bot NDJSON object stream, not a particular file path. Under systemd the stream is the unit's journal; elsewhere it is whatever file stdout was redirected to. Consumers should depend on records with `bot.*` event types, not generator output or log locations.

The eight event types, each complete on its own:

- `bot.turn.started`
- `bot.chain.preflight`
- `bot.state.read`
- `bot.decision.skipped`
- `bot.transaction.built`
- `bot.transaction.sent`
- `bot.transaction.committed`
- `bot.turn.failed`

One turn emits at most six of them: a skip ends the turn after `bot.decision.skipped`, and a failure ends it at `bot.turn.failed` in place of the rest.

### Preflight and decisions

`bot.chain.preflight` emits the recommended address, primary lock, RPC endpoint identity, expected chain identity, observed genesis hash/address prefix/tip and match booleans before signing starts. Endpoint identity contains protocol, hostname, port and pathname, subject to the [RPC configuration restriction](#runtime-config); it omits the full URL, query and fragment.

`bot.state.read` carries the tip, balances, order/withdrawal/deposit counts, exchange ratio, deposit capacity and fee rate. `bot.decision.skipped` and `bot.transaction.built` embed the match and rebalance evaluation in `decision`. Build-time skip reasons are `no_actions` (no match, collection or fundable rebalance) and `no_fundable_candidate` (every candidate failed to complete). A skip exits `0`; the next turn reads the chain again. The [reserve is a sizing line](docs/policy.md#why-the-reserve-is-not-a-final-check), not a check on the completed transaction.

The decision transcript groups its evidence by purpose:

- `chainTip`, `exchangeRatio`, `depositCapacity` and `fee.feeRate`: the sampled conditions.
- `balances`: CKB and iCKB available now, pending CKB, total equivalent CKB, matchable CKB and cell count. `counts` covers orders, receipts, withdrawals and pool deposits.
- `match`: reason, candidate and profitable-whole-fill counts, per-fill mining fee, shuffle seed and matched order outpoints. Reasons are `matched`, `no_market_orders`, `no_gain` or `unfunded_gain`; the last means profitable fills exist but the balances cannot pay them.
- `rebalance`: deposit reason (`low_ickb` or `ring_coverage`), withdrawal candidates and stress flag, plus the compact ring summary.
- `core`: the completed choice (`none`, `deposit` or `withdraw`), its withdrawal request count and candidate attempts. `actions` and `transactionShape` describe the result; `skip.reason` explains a skipped turn.

### Transaction outcomes

`bot.transaction.sent` carries the local hash, fee, fee rate, transaction shape, elapsed time and `outcome`: `broadcasted`, or `broadcast_ambiguous` with the send error. An ambiguous send still waits for that hash. `bot.transaction.committed` carries the hash, status, elapsed time and wait policy.

`bot.turn.failed` carries the error's name, message, stack, cause chain and public enumerable fields. Send evidence includes fields such as `code`, `data`, `outPoint`, `currentFee` and `leastFee`. A rejection during confirmation includes `txHash`, `status` and `reason`; a timeout uses CCC's timeout error, with the hash in the preceding sent event of the same `runId`. Non-secret transaction, script and cell data may be logged when useful.

Observed testnet full-node send rejection signatures for generic stale-state races are: in-pool same-input conflict can return `code:-1111` with `data:"RBFRejected(...)"` and CCC fields `currentFee`/`leastFee`; a post-commit spent input returns `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"` and CCC field `outPoint`; resending the same tx returns `code:-1107` with `data:"Duplicated(Byte32(...))"` and CCC field `txHash`. CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. CCC JSON-RPC response id mismatch errors such as `Id mismatched, got null, expected 319` are in the same family. The bot does not classify them: every failure exits `1`, and the next turn discards the failed state and rebuilds from fresh state rather than resending the same transaction.

One process is one turn: `pnpm --filter ./sdk/node bot` exits `0` after a skip or commitment and `1` after any failure. The [two-minute wait](docs/policy.md#withdrawal-timing-and-confirmation) joins a send to its observed commit; it does not decide whether the next turn may run. That turn rebuilds from committed state rather than resending. It may conflict with a still-pending transaction or select disjoint inputs and produce a second valid transaction. Duplicate intent is an accepted limit of having no durable pending store.

### Output boundary and retention

Structured events contain the evidence needed to understand bot behavior. The bot must not print its configured private key to events, errors, stdout, or stderr. Private keys are for signing only: logger, event, error, and test-hook APIs must not receive private keys, signers, secret contexts, masking callbacks, redaction parameters, or guard inputs. Tests use a configured canary private key from outside the production path and verify produced output cannot reveal it. Secrets, credentialed RPC URLs, tokens, passwords, API keys, and secret-bearing config/env dumps must not be logged or passed to logging, redaction, masking, or guard helpers.

The journal is the only retained record. A second artifact store, incident directory or summary file would add another retention policy for the same turn. Compact ring evidence stays in the decision transcript; the exact deposit sample is not retained and cannot be reconstructed from the journal alone.

### Reading the journal

Bot-only log queries over the unit's journal saved as one JSON line per event (a saved stdout stream works the same):

```bash
EVENT_FILE=$(mktemp) && journalctl --user -u ickb-bot-testnet.service -o cat | grep '^{' > "$EVENT_FILE"
jq -r '.type' "$EVENT_FILE" | sort | uniq -c
jq -c 'select(.type == "bot.chain.preflight") | {timestamp, chain, identity, expected, observed, matches}' "$EVENT_FILE"
jq -c 'select(.type == "bot.decision.skipped") | {timestamp, chain, runId, reason, actions: .decision.actions, skip: .decision.skip}' "$EVENT_FILE"
jq -c 'select((.type == "bot.decision.skipped" or .type == "bot.transaction.built")) | {timestamp, reason, actions: .decision.actions, match: .decision.match, rebalance: .decision.rebalance, core: .decision.core}' "$EVENT_FILE"
jq -c 'select(.type == "bot.transaction.sent" or .type == "bot.transaction.committed") | {timestamp, type, txHash, outcome, status, elapsedMs}' "$EVENT_FILE"
jq -c 'select(.type == "bot.turn.failed") | {timestamp, chain, runId, error}' "$EVENT_FILE"
```

## Stimulus Generator

The generator draws one random action per turn from its own testnet account. It reads `STIMULUS_CHAIN`, `STIMULUS_RPC_URL` and `STIMULUS_PRIVATE_KEY_FILE` like the bot, but refuses a non-testnet chain before constructing a signer. Orders accumulate across turns, so a single action already changes the book the bot sees. Named scenario planners and transaction batches added machinery without being needed for that accumulation; `RestartSec` controls the cadence. Pool maturity and inventory still need their own preconditions, as the [journal cases](#what-the-journals-should-show) explain.

Each turn reads the account, then:

1. draws a kind (`order` three times in four, otherwise `conversion`), a direction weighted by the CKB value spendable on each side, an amount, and for an order a fee numerator over `100000` from `{0, 10, 100}` for a sell and `{10, 100}` for a buy, `10` twice as likely as `100` (a zero-fee buy is one the bot never takes); the amount is the smallest positive one in one draw out of eight, the whole budget in another, and otherwise spread evenly across the decades from one CKB up, so dust, mid-size, and whole-balance stimulus all recur;
2. mints the order on a transaction that also collects the account's fulfilled orders and cancels live orders the bot will not take: buys the bot's own matcher would refuse to fill whole today (the DAO ratio only grows past them), and any order older than thirty days (the bot has had every chance by then), or asks the SDK for the conversion with the same collections in its context; with five hundred own orders live it stops minting (testnet hygiene, not safety) and only collects;
3. skips a transaction that the completer cannot fund, or whose amount the order format cannot represent; whenever the drawn action is refused and there is anything to collect (fulfilled, refused, or stale orders, receipts, ready withdrawals), it sends the collection alone instead;
4. signs, sends, waits up to ten minutes, and exits `0` on commit or skip and `1` on any failure.

Each knob pins one draw and leaves the rest random: `STIMULUS_KIND=order|conversion`, `STIMULUS_DIRECTION=ckb-to-ickb|ickb-to-ckb`, `STIMULUS_AMOUNT=<whole CKB or iCKB, up to eight decimals>|max`, and `STIMULUS_FEE=<numerator below 100000>`. A pinned amount is used as drawn even when it exceeds the budget; the completer's refusal is then the evidence.

Collection uses the [SDK's refused-buy and age rules](../src/order/fill.ts), shared with the interface. A zero-fee sell can become profitable as the DAO ratio grows, so it stays until filled or aged out. Predicting a second profitability rule in the generator would let it disagree with the bot. Dust and low-fee draws are retained because seeing the bot skip them is part of the test.

Each turn writes one JSON line with `type` `stimulus.turn`, `timestamp` and the bot's envelope. `identity` contains the chain, recommended address, primary lock, endpoint identity and preflight evidence; the same [RPC path restriction](#runtime-config) applies. Other fields are `balance`, `orders` (live, fulfilled, refused and stale counts), `draw` and `outcome`: `committed`, `unresolved`, `rejected`, `skipped` or `failed`.

A sent transaction carries `action` (minted order/master output indices, or conversion kind), `transactionShape`, `txFee` and `txHash`. Only `committed` proves it reached the chain. Join that hash and output index to the bot's `decision.match.matchedOrderOutPoints`. A nonzero stale count means an order reached the nominal thirty-day age cutoff and deserves a look.

```bash
export STIMULUS_CHAIN=testnet STIMULUS_PRIVATE_KEY_FILE=~/.config/ickb-bot/stimulus-testnet.key
pnpm --filter ./sdk/node stimulus
```

### Alerting

Neither program carries a notification channel: a run is one turn, and anything worth an operator's attention is a run of turns, which only the journal sees. Both journals are JSON lines with `type` and `timestamp` first, so a watcher is a pipe. Consecutive `bot.turn.failed` lines, or `bot.decision.skipped` lines whose `decision.match.reason` is `unfunded_gain`, are the two conditions worth forwarding; a `stale` count above zero in the generator's `orders` is a third. Put the destination in an environment file with mode `0600` next to the key, since a Telegram or ntfy URL carries the token, and let `curl` encode the message:

```bash
journalctl -f --user -u ickb-bot-testnet.service -o cat | jq -R -c 'fromjson? | select(.type == "bot.turn.failed")' \
  | while read -r line; do curl -sG --data-urlencode "text=$line" "$ALERT_URL" >/dev/null; done
```

### What the journals should show

The bot's reasons are lossy (any nonempty match is `matched`, whatever was rejected on the way) and some branches need pool or maturity state no order can create, so a missing reason means its precondition never occurred, not that the generator failed. Tally both journals, then read the table:

```bash
BOT=$(mktemp) && journalctl --user -u ickb-bot-testnet.service -o cat | grep '^{' > "$BOT"
STIMULUS=$(mktemp) && journalctl --user -u ickb-stimulus-testnet.service -o cat | grep '^{' > "$STIMULUS"
jq -r 'select(.decision) | .decision.match.reason' "$BOT" | sort | uniq -c
jq -r 'select(.decision) | "\(.decision.core.kind) \(.decision.rebalance.deposit // "-") \(.decision.rebalance.withdrawal.stress // "-")"' "$BOT" | sort | uniq -c
jq -r 'select(.type == "bot.decision.skipped") | .reason' "$BOT" | sort | uniq -c
jq -r 'select(.decision.match.reason == "matched") | "\(.decision.match.partialCount) \(.decision.match.candidates)"' "$BOT" | sort | uniq -c
jq -r '"\(.outcome) \(.draw.kind // "-") \(.draw.direction // "-") \(.skip.reason // "-")"' "$STIMULUS" | sort | uniq -c
```

| Bot variant                            | Precondition                                              | Evidence                                                                  | Owner                                                                        |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Profitable match, one or many partials | Payable orders above the ten-fee floor                    | `match.reason` `matched`, `partialCount`                                  | unattended                                                                   |
| Unprofitable or dust-only book         | Fee `0` orders only, or dust below ten fees               | `match.reason` `no_gain`, `match.candidates` above zero                   | unattended                                                                   |
| Gains the balances cannot pay          | Buyers with no iCKB to serve them, or sellers with no CKB | `match.reason` `unfunded_gain`, `match.gains` above zero                  | operator: top up, or wait for a withdrawal to mature                         |
| Partial cap                            | Fifty-nine or more live eligible orders                   | `match.partialCount` `58` with orders left on the book                    | operator: run the generator faster than the bot, or stop the bot for an hour |
| Empty book                             | Nothing live                                              | `match.reason` `no_market_orders`                                         | unattended                                                                   |
| Deposit                                | Under 2,000 iCKB, or the tip's ring segment thin          | `core.kind` `deposit`, `rebalance.deposit` `low_ickb` or `ring_coverage`  | operator: fund or drain the bot; wait for maturity                           |
| Withdrawal requests                    | Over 120,000 iCKB with ready surplus deposits             | `core.kind` `withdraw`, `core.withdrawalRequests`, `rebalance.withdrawal` | operator: fund the bot with iCKB; wait for maturity                          |
| Anchors under stress                   | Spendable CKB under a fifth of a deposit                  | `rebalance.withdrawal.stress` `true`                                      | operator: drain the bot's CKB                                                |
| Nothing fundable                       | No core, match, or collection completes                   | skip `no_fundable_candidate`, `core.attempts`                             | operator: a thin bot                                                         |

## systemd Deployment

The actors run as the operator's user under systemd, from an ordinary git checkout with an absolute Node path. systemd 255 and later are supported. One hand-edited unit per network owns configuration; Git owns revisions. This trades per-network user isolation and atomic updates for a stopped-checkout update procedure. A root installer, release-directory swap or template/drop-in hierarchy would add deployment concepts without changing that operating model.

### Host isolation

A mode `0600` key file excludes other users, not other processes under the same UID. The operator sets the mode; the runtime does not check it. `LoadCredential` would copy the same user's readable file without creating another boundary, and local encryption without a separate key boundary would leave both on the same disk.

The intended mainnet boundary is a separate production VM with no agent running as the key-owning account. Model-steered testnet work belongs on the testnet desktop. Export production journals over SSH for inspection. If a host must serve both, mainnet needs a separate OS account and its own user manager; a same-UID agent otherwise has mainnet signing authority. A separate signing service would add a component and IPC protocol where host/account isolation already supplies the required boundary.

### Install and operate

The tracked examples `sdk/node/ickb-bot-testnet.service` and `sdk/node/ickb-stimulus-testnet.service` are the whole configuration for one network each. Copy one under a name per network, edit every path and the RPC URL, and keep the rest:

```bash
pnpm node:install
install -d -m 700 ~/.config/ickb-bot ~/.config/systemd/user
(umask 077 && $EDITOR ~/.config/ickb-bot/testnet.key)
cp sdk/node/ickb-bot-testnet.service ~/.config/systemd/user/
$EDITOR ~/.config/systemd/user/ickb-bot-testnet.service
systemd-analyze --user verify ~/.config/systemd/user/ickb-bot-testnet.service
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now ickb-bot-testnet.service
journalctl --user -u ickb-bot-testnet.service -f -o cat
```

`ExecStart` needs the absolute path of the node binary: the user manager never sees the shell PATH, and a version manager's per-shell link vanishes at logout, so point at the versioned install itself (`readlink -f "$(command -v node)"`). A literal `%` in any value must be written `%%`. Linger keeps the user manager running without a login session, so the unit survives logout and starts at boot. A mainnet bot unit is the same file with `mainnet` values and its own key file; the generator refuses any chain but testnet.

Operate the unit as usual:

```bash
systemctl --user status ickb-bot-testnet.service
systemctl --user --failed
systemctl --user restart ickb-bot-testnet.service
```

To update, stop every unit that shares the checkout, move the checkout to the reviewed revision, run `pnpm node:install`, then start them again; a turn must never observe a half-updated tree. Editing a unit needs `systemd-analyze --user verify`, `systemctl --user daemon-reload`, and a restart of that unit, because a reload alone keeps the running process.

A turn never holds: every exit starts the next turn after `RestartSec`, and an underfunded account skips turn after turn until it is funded. To see why a unit keeps skipping or failing, inspect the journal for the last event and the exit status:

```bash
journalctl --user -u ickb-bot-testnet.service -o cat -n 2000 --no-pager | jq -c 'select(.type == "bot.decision.skipped" or .type == "bot.turn.failed")'
systemctl --user show ickb-bot-testnet.service -p ActiveState -p Result -p ExecMainStatus
```

The unit sets `LimitCORE=0`, so crash diagnosis uses the journal rather than a core file. The journal is the only store: journald owns event and stderr retention through its normal limits, and reading a user's journal history without `sudo` needs persistent split journals.

Funding and indexer configuration are covered by the policy's [operating assumptions](docs/policy.md#operating-assumptions).
