# iCKB Node Actors

`apps/node` holds three one-turn entrypoints that share chain preflight, config, and logging: the bot (`src/bot.ts`), the testnet stimulus generator (`src/stimulus.ts`), and the mainnet rate sampler (`src/sampler.ts`). The bot is CCC-native. It reads market state from `@ickb/sdk`, matches profitable limit orders, collects the bot's own orders, completes receipts and ready withdrawals, optionally rebalances between CKB and iCKB, completes iCKB UDT balance, CKB capacity, and fees, then signs, sends, and waits for commit.

The bot minimizes excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

Order directions in logs and diagnostics are the on-chain order owner's direction, not the bot's inventory direction. When the bot matches `ckb-to-ickb`, it spends iCKB and receives CKB. When it matches `ickb-to-ckb`, it spends CKB and receives iCKB. Matcher allowance steps therefore follow the asset the bot spends; at an unbalanced rate such as `1 BTC = 100000 USD`, the same value step is `1000 USD` on the USD-spending side and `0.01 BTC` on the BTC-spending side.

## Docs

- [Bot Policy](docs/policy.md)

## Runtime Config

The bot reads three environment variables:

- `BOT_CHAIN`: `testnet` or `mainnet`.
- `BOT_RPC_URL`: the exclusive HTTP(S) RPC URL for that chain; the client keeps no CCC public fallbacks beside it. Userinfo, whitespace, and control characters are rejected.
- `BOT_PRIVATE_KEY_FILE`: path of a mode `0600` file holding only the signing key as lowercase `0x` plus 64 lowercase hex characters. Surrounding whitespace, such as an editor's final newline, is ignored. A relative path resolves against `INIT_CWD` when pnpm sets it, otherwise the working directory.

The key lives in a file rather than a variable because unit files, `systemctl show`, and every child process expose environment values. Invalid values fail with `Invalid env <NAME>` and never echo the value.

Each bot process runs one turn and exits, so continuous matching is a loop around the process: a systemd user unit with `Restart=always`, or the operator between reads.

## Run

From a plain checkout, run `pnpm install` from the repo root. CCC is resolved as a normal package dependency, and the app runs from TypeScript source under Node 22.19+. Local key files under `config/` are ignored by git:

```bash
pnpm install
mkdir -p config && (umask 077 && $EDITOR config/testnet.key)
export BOT_CHAIN=testnet BOT_RPC_URL=https://testnet.ckb.dev/ BOT_PRIVATE_KEY_FILE=config/testnet.key
pnpm --filter ./apps/node bot
```

The start script runs the bot once from source. Stdout is the NDJSON event stream and stderr carries diagnostics; both go wherever the caller sends them, which is journald under systemd. Balance and fee amounts are decimal strings so large on-chain values do not lose precision. Restart policy belongs to the service manager.

## Structured Events

Every stdout line is one JSON object with `chain`, `runId`, ISO `timestamp`, and a `bot.*` type. These events are the sole bot stdout contract.

The stable event contract is the bot NDJSON object stream, not a particular file path. Under systemd the stream is the unit's journal; elsewhere it is whatever file stdout was redirected to. Consumers should depend on records with `bot.*` event types, not generator output or log locations.

The seven event types, each complete on its own:

- `bot.turn.started`
- `bot.chain.preflight`
- `bot.state.read`
- `bot.decision.skipped` or `bot.transaction.built`
- `bot.transaction.sent`
- `bot.transaction.committed` or `bot.turn.failed`

`bot.chain.preflight` emits the recommended address, the primary lock, credential-free RPC endpoint identity (protocol, hostname, port, and pathname), expected chain identity, observed genesis hash/address prefix/tip, and match booleans before signing starts. It never prints the full RPC URL, query, or fragment. `bot.state.read` carries the state summary: chain tip, balances, order, withdrawal, and pool deposit counts, exchange ratio, deposit capacity, and fee rate. `bot.decision.skipped` and `bot.transaction.built` embed the full `decision` transcript, which is the match and rebalance evaluation. Build-time skip reasons are `no_actions`, `match_search_incomplete`, `match_value_not_above_fee`, and `post_tx_ckb_reserve`. Reserve skips report zero committed `actions`, keep attempted action counts under `decision.skip.attemptedActions`, and keep reserve arithmetic under `decision.audit.reserveCheck` because the transaction was not broadcast. Bot reserve arithmetic is projected available CKB, not actual plain-cell accounting; withdrawal requests with non-negative match CKB delta are staged CKB recovery actions and bypass the immediate reserve skip. The pre-build safety skip `capital_below_minimum` exits with code `2` and includes zero `actions`, `deficit`, and `state` instead of a `decision` transcript because match, rebalance, fee, and transaction shape were not evaluated. Rebalance decisions include normalized `reason`; no-op reasons remain policy-owned strings such as `low_ickb_ckb_reserve_unavailable`, `no_withdrawable_ickb`, `no_ring_surplus_ready_deposits`, `ring_surplus_withdrawal_over_budget`, `no_ready_withdrawal_selection`, and the runtime's `no_fundable_withdrawal_prefix` when completion could fund no withdrawal prefix, while action reasons include `low_ickb_balance`, `ring_inventory`, `excess_ickb_balance`, and `reserve_recovery`.

The decision transcript groups evidence under `chainTip`, `balances` (`ckb` and `ickb` available now, `pendingCkb` in not-ready withdrawals, `totalEquivalentCkb`, `matchableCkb`, `cellCount`), `counts` (market orders, receipts, ready and pending withdrawals, pool deposits and the ready ones), `match`, `rebalance`, `core`, `actions`, `fee`, `transactionShape`, `exchangeRatio`, and `depositCapacity`. `match.reason` is `matched`, `no_market_orders`, `search_incomplete`, or `no_match`; `match.diagnostics` carries the SDK's counters (allowance, mining fee, direction, candidate, positive-gain, and rejection counts) and `match.search` the bounded-search evidence when the search was incomplete; matched orders are listed by outpoint. `rebalance` carries the deposit reason (`low_ickb` or `ring_coverage`), the withdrawal candidate count with its `stress` flag, and the ring summary (pool deposit count, segment count, target segment and its iCKB, total pool iCKB). `core` is the core the completion walk settled on (`none`, `deposit`, or `withdraw`), the withdrawal requests it carries, and how many candidates were built on the way. A skipped decision carries `skip.reason`: `no_actions`, `match_search_incomplete`, `match_value_not_above_fee`, or `no_fundable_candidate`. `fee.feeRate` is included on state and decision events.

`bot.transaction.sent` carries the hash, fee, fee rate, transaction shape counts, elapsed time, and `outcome`: `broadcasted`, or `broadcast_ambiguous` with the send `error` when the hash was known before the send failed, in which case the turn still waits for that hash. `bot.transaction.committed` carries the hash, status, elapsed time, and wait policy. `bot.turn.failed` carries the thrown `error` with its name, message, stack, cause chain, and public enumerable fields: CKB/CCC send rejection evidence such as `code`, `data`, `outPoint`, `currentFee`, and `leastFee`, and for a rejection after broadcast the SDK wait error with `txHash`, `status`, and `reason`; a confirmation timeout is CCC's timeout error, and the hash it concerns is in the preceding `bot.transaction.sent` of the same `runId`. Non-secret debugging data may be logged when useful, including raw transactions, witnesses, public config fields, noncredentialed RPC identity evidence, scripts, cells, hashes, counts, and summaries.

Observed testnet full-node send rejection signatures for generic stale-state races are: in-pool same-input conflict can return `code:-1111` with `data:"RBFRejected(...)"` and CCC fields `currentFee`/`leastFee`; a post-commit spent input returns `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"` and CCC field `outPoint`; resending the same tx returns `code:-1107` with `data:"Duplicated(Byte32(...))"` and CCC field `txHash`. CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. CCC JSON-RPC response id mismatch errors such as `Id mismatched, got null, expected 319` are in the same family. The bot does not classify them: every failure exits `1`, and the next turn discards the failed state and rebuilds from fresh state rather than resending the same transaction.

One process is one turn: `pnpm --filter ./apps/node bot` exits with code `0` after a skipped decision or a committed transaction and with code `1` after any failure. Every failure is safe to follow with a fresh turn, including the finite 10-minute confirmation timeout: the next turn rebuilds from committed state, and a transaction still pending from the previous turn conflicts with the rebuilt one at the node, which the bot reports as a send failure until the pending one commits or drops.

Structured events contain the evidence needed to understand bot behavior. The bot must not print its configured private key to events, errors, stdout, or stderr. Private keys are for signing only: logger, event, error, and test-hook APIs must not receive private keys, signers, secret contexts, masking callbacks, redaction parameters, or guard inputs. Tests use a configured canary private key from outside the production path and verify produced output cannot reveal it. Secrets, credentialed RPC URLs, tokens, passwords, API keys, and secret-bearing config/env dumps must not be logged or passed to logging, redaction, masking, or guard helpers.

Bot-only log queries over a saved bot stdout NDJSON stream, or over `journalctl --user -u ickb-bot-<network>.service -o cat` piped through the same filters:

```bash
EVENT_FILE=log/bot/events.ndjson
jq -r '.type' "$EVENT_FILE" | sort | uniq -c
jq -c 'select(.type == "bot.chain.preflight") | {timestamp, chain, identity, expected, observed, matches}' "$EVENT_FILE"
jq -c 'select(.type == "bot.decision.skipped") | {timestamp, chain, runId, reason, actions, skip: .decision.skip}' "$EVENT_FILE"
jq -c 'select((.type == "bot.decision.skipped" or .type == "bot.transaction.built")) | {timestamp, reason, actions, match: .decision.match, rebalance: .decision.rebalance, core: .decision.core}' "$EVENT_FILE"
jq -c 'select(.type == "bot.transaction.sent" or .type == "bot.transaction.committed") | {timestamp, type, txHash, outcome, status, elapsedMs}' "$EVENT_FILE"
jq -c 'select(.type == "bot.turn.failed") | {timestamp, chain, runId, error}' "$EVENT_FILE"
```

## Stimulus Generator

The generator is the bot's testnet counterpart: each turn it draws one random action from its own account, sends it, and exits, so the book the bot reads keeps changing in the ways real users change it. It reads `STIMULUS_CHAIN` (testnet only), `STIMULUS_RPC_URL`, and `STIMULUS_PRIVATE_KEY_FILE` like the bot. There are no scenarios: with orders accumulating on the book across turns, one action per turn already produces every shape of book the bot has to handle, and how fast the book grows is the unit's `RestartSec`.

Each turn reads the account, then:

1. draws a kind (`order` three times in four, otherwise `conversion`), a direction weighted by the CKB value spendable on each side, an amount, and for an order a fee numerator from `{0, 1, 10}` over `100000` with `1` twice as likely; the amount is the smallest positive one in one draw out of eight, the whole budget in another, and otherwise spread evenly across the decades from one CKB up, so dust, mid-size, and whole-balance stimulus all recur;
2. mints the order on a transaction that also collects the account's fulfilled orders and cancels live orders older than thirty days (the bot has had every chance by then), or asks the SDK for the conversion with the same collections in its context; with five hundred own orders live it stops minting (testnet hygiene, not safety) and only collects;
3. skips a transaction that would leave plain CKB below the thousand-CKB reserve and lower than before, or that the completer cannot fund, or whose amount the order format cannot represent; whenever the drawn action is refused and there is anything to collect (fulfilled or stale orders, receipts, ready withdrawals), it sends the collection alone instead;
4. signs, sends, waits up to ten minutes, and exits `0` on commit or skip and `1` on any failure.

Each knob pins one draw and leaves the rest random: `STIMULUS_KIND=order|conversion`, `STIMULUS_DIRECTION=ckb-to-ickb|ickb-to-ckb`, `STIMULUS_AMOUNT=<whole CKB or iCKB, up to eight decimals>|max`, and `STIMULUS_FEE=<numerator below 100000>`. A pinned amount is used as drawn even when it exceeds the budget; the completer's refusal is then the evidence.

Each turn writes one JSON line: `identity` first (chain, recommended address, primary lock, credential-free RPC endpoint, and the chain preflight evidence), then `startTime`, `balance`, `orders` (live, fulfilled, and stale counts), `draw`, and `outcome`: `committed`, `unresolved` (sent, but the wait window closed), `rejected` (the node refused it), `skipped` with its `skip` reason, or `failed` with `error`. A sent transaction carries `action` (the order and master output indices of a mint, or the SDK's conversion kind), `transactionShape`, `txFee`, and `txHash`; only `committed` proves the stimulus reached the chain. The order outpoints the bot logs in `decision.match.matchedOrderOutPoints` are `txHash` plus the logged output index, so the two journals join.

```bash
export STIMULUS_CHAIN=testnet STIMULUS_RPC_URL=https://testnet.ckb.dev/ STIMULUS_PRIVATE_KEY_FILE=config/stimulus-testnet.key
pnpm --filter ./apps/node stimulus
```

### What the journals should show

The bot's reasons are lossy (any nonempty match is `matched`, whatever was rejected on the way) and some branches need pool or maturity state no order can create, so a missing reason means its precondition never occurred, not that the generator failed. Tally both journals, then read the table:

```bash
BOT=log/bot/events.ndjson; STIMULUS=log/stimulus/events.ndjson
jq -r 'select(.decision) | .decision.match.reason' "$BOT" | sort | uniq -c
jq -r 'select(.decision) | "\(.decision.core.kind) \(.decision.rebalance.deposit // "-") \(.decision.rebalance.withdrawal.stress // "-")"' "$BOT" | sort | uniq -c
jq -r 'select(.type == "bot.decision.skipped") | .reason' "$BOT" | sort | uniq -c
jq -r 'select(.decision.match.search) | .decision.match.search.truncation' "$BOT" | sort | uniq -c
jq -r '"\(.outcome) \(.draw.kind // "-") \(.draw.direction // "-") \(.skip.reason // "-")"' "$STIMULUS" | sort | uniq -c
```

| Bot variant                            | Precondition                                     | Evidence                                                                           | Owner                                                                        |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Profitable match, one or many partials | Orders with fee `1` or `10` on the book          | `match.reason` `matched`, `partialCount`                                           | unattended                                                                   |
| Unprofitable or dust-only book         | Fee `0` orders only, or dust                     | `match.reason` `no_match`, `match.diagnostics.candidates.rejected.nonPositiveGain` | unattended                                                                   |
| Match not worth its transaction fee    | Small orders at low fee rates                    | skip `match_value_not_above_fee`                                                   | unattended; pin `STIMULUS_FEE=0` with a small `STIMULUS_AMOUNT` when missing |
| Partial cap                            | Fifty-nine or more live eligible orders          | `match.diagnostics.candidates.rejected.maxPartials`                                | operator: run the generator faster than the bot, or stop the bot for an hour |
| Incomplete search                      | A crowded book within the work budget            | `match.reason` `search_incomplete`, skip `match_search_incomplete`                 | operator, as above                                                           |
| Empty book                             | Nothing live                                     | `match.reason` `no_market_orders`                                                  | unattended                                                                   |
| Deposit                                | Under 2,000 iCKB, or the tip's ring segment thin | `core.kind` `deposit`, `rebalance.deposit` `low_ickb` or `ring_coverage`           | operator: fund or drain the bot; wait for maturity                           |
| Withdrawal requests                    | Over 120,000 iCKB with ready surplus deposits    | `core.kind` `withdraw`, `core.withdrawalRequests`, `rebalance.withdrawal`          | operator: fund the bot with iCKB; wait for maturity                          |
| Anchors under stress                   | Spendable CKB under a fifth of a deposit         | `rebalance.withdrawal.stress` `true`                                               | operator: drain the bot's CKB                                                |
| Nothing fundable                       | No core, match, or collection completes          | skip `no_fundable_candidate`, `core.attempts`                                      | operator: a thin bot                                                         |

## systemd Deployment

The bot and the stimulus generator run as the operator's own user under the systemd user manager, from an ordinary git checkout, with Node wherever the operator installed it. The same steps apply to a developer desktop and a production VM; systemd 255 and later are supported. There is no root install, service user, release directory, encrypted credential, or update script: git owns revisions, the unit owns the process, and a `0600` key file owns the secret. That trades per-network user isolation and atomic updates for one concept fewer each; a single trusted operator on one host loses little.

The tracked examples `apps/node/ickb-bot-testnet.service` and `apps/node/ickb-stimulus-testnet.service` are the whole configuration for one network each. Copy one under a name per network, edit every path and the RPC URL, and keep the rest:

```bash
pnpm node:install
install -d -m 700 ~/.config/ickb-bot ~/.config/systemd/user
(umask 077 && $EDITOR ~/.config/ickb-bot/testnet.key)
cp apps/node/ickb-bot-testnet.service ~/.config/systemd/user/
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

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Fund the bot with about 2.2 deposits of capital plus plain CKB above the 1,000 CKB reserve; below that it still matches what it can but may idle with a full buffer waiting for a buyer.
- Run it against an exclusive node that keeps CKB's default `[indexer_v2] index_tx_pool = false`: with pool indexing on, a timed-out send can be duplicated with disjoint inputs on later turns.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
