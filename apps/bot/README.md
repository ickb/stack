# iCKB Bot

The bot is CCC-native. It reads market state from `@ickb/sdk`, matches profitable limit orders, collects the bot's own orders, completes receipts and ready withdrawals, optionally rebalances between CKB and iCKB, completes iCKB UDT balance, CKB capacity, and fees, then signs, sends, and waits for commit.

The bot minimizes excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

Order directions in logs and diagnostics are the on-chain order owner's direction, not the bot's inventory direction. When the bot matches `ckb-to-ickb`, it spends iCKB and receives CKB. When it matches `ickb-to-ckb`, it spends CKB and receives iCKB. Matcher allowance steps therefore follow the asset the bot spends; at an unbalanced rate such as `1 BTC = 100000 USD`, the same value step is `1000 USD` on the USD-spending side and `0.01 BTC` on the BTC-spending side.

## Docs

- [Current Bot Rebalancing Policy](docs/current_rebalancing_policy.md)

## Runtime Config

The bot reads three environment variables:

- `BOT_CHAIN`: `testnet` or `mainnet`.
- `BOT_RPC_URL`: the exclusive HTTP(S) RPC URL for that chain; the client keeps no CCC public fallbacks beside it. Userinfo, whitespace, and control characters are rejected.
- `BOT_PRIVATE_KEY_FILE`: path of a mode `0600` file holding only the signing key as lowercase `0x` plus 64 lowercase hex characters. Surrounding whitespace, such as an editor's final newline, is ignored. A relative path resolves against `INIT_CWD` when pnpm sets it, otherwise the working directory.

The key lives in a file rather than a variable because unit files, `systemctl show`, and every child process expose environment values. Invalid values fail with `Invalid env <NAME>` and never echo the value. `BOT_ARTIFACT_ROOT` optionally names the directory for content-addressed artifacts; without it, ring diagnostics stay inline in events.

Each bot process runs one turn and exits, so continuous matching is a loop around the process: a systemd user unit with `Restart=always`, or the operator between reads.

## Run

From a plain checkout, run `pnpm install` from the repo root. CCC is resolved as a normal package dependency, and the app runs from TypeScript source under Node 22.19+. Local key files under `config/` are ignored by git:

```bash
pnpm install
mkdir -p config && (umask 077 && $EDITOR config/testnet.key)
export BOT_CHAIN=testnet BOT_RPC_URL=https://testnet.ckb.dev/ BOT_PRIVATE_KEY_FILE=config/testnet.key
pnpm --filter ./apps/bot start
```

The start script runs the bot once from source. Stdout is the NDJSON event stream and stderr carries diagnostics; both go wherever the caller sends them, which is journald under systemd. Balance and fee amounts are decimal strings so large on-chain values do not lose precision. Restart policy belongs to the service manager.

## Structured Events

Every stdout line is one JSON object with `chain`, `runId`, ISO `timestamp`, and a `bot.*` type. These events are the sole bot stdout contract.

The stable event contract is the bot NDJSON object stream, not a particular file path. Under systemd the stream is the unit's journal; elsewhere it is whatever file stdout was redirected to. Consumers should depend on records with `bot.*` event types, not supervisor/tester output or log locations.

Stable event types:

- `bot.run.started`
- `bot.chain.preflight`
- `bot.turn.started`
- `bot.state.read`
- `bot.match.evaluated`
- `bot.rebalance.evaluated`
- `bot.decision.skipped`
- `bot.transaction.built`
- `bot.transaction.sent`
- `bot.transaction.confirmation`
- `bot.transaction.committed`
- `bot.transaction.failed`
- `bot.turn.failed`

`bot.chain.preflight` emits credential-free RPC endpoint identity (protocol, hostname, port, and pathname), expected chain identity, observed genesis hash/address prefix/tip, and match booleans before signing starts. It never prints the full RPC URL, query, or fragment. No-action iterations emit `bot.decision.skipped` with `reason` and evidence. Build-time skip reasons `no_actions`, `match_value_not_above_fee`, and `post_tx_ckb_reserve` include a `decision` transcript. Reserve skips report zero committed `actions`, keep attempted action counts under `decision.skip.attemptedActions`, and keep reserve arithmetic under `decision.audit.reserveCheck` because the transaction was not broadcast. Bot reserve arithmetic is projected available CKB, not actual plain-cell accounting; withdrawal requests with non-negative match CKB delta are staged CKB recovery actions and bypass the immediate reserve skip. The pre-build safety skip `capital_below_minimum` exits with code `2` and includes zero `actions`, `deficit`, and `state` evidence instead of a `decision` transcript because match, rebalance, fee, and transaction shape were not evaluated. `bot.turn.failed` includes an `error` summary plus `retryable` and `terminal` booleans from the bot retry policy. Rebalance decisions include normalized `reason`; no-op reasons remain policy-owned strings such as `insufficient_output_slots`, `low_ickb_ckb_reserve_unavailable`, `no_withdrawable_ickb`, `no_ring_surplus_ready_deposits`, `ring_surplus_withdrawal_over_budget`, and `no_ready_withdrawal_selection`, while action reasons include `low_ickb_balance`, `ring_inventory`, `excess_ickb_balance`, and `reserve_recovery`.

The decision transcript groups evidence under `chainTip`, `balances`, `orders`, `withdrawals`, `poolDeposits`, `match`, `rebalance`, `audit`, `actions`, `fee`, `transactionShape`, `exchangeRatio`, and `depositCapacity`. `balances` includes available, unavailable, total, equivalent, minimum-capital, spendable CKB, and matchable CKB evidence. `match.reason` normalizes the matching outcome, while `match.diagnostics` carries public allowance, mining fee, direction counts, candidate counts, positive-gain counts, and rejection counts. `match.search` records bounded-search evidence when matching was incomplete. A positive incomplete match still passes transaction completion and final fee profitability, but runtime does not derive globally useful inventory floors from incomplete diagnostics. An incomplete empty match is a soft `match_search_incomplete` skip. `rebalance` carries kind, reason, projected balances, output slots, and pool/deposit/withdrawal counts. Ring diagnostics are compact inline on `bot.rebalance.evaluated`; repeated full segment detail is stored as a content-addressed artifact under `$BOT_ARTIFACT_ROOT/ringSegments/sha256-<hash>.json` and referenced by `rebalance.diagnostics.ring.segmentsRef`. If artifact writing is unavailable, the event falls back to inline full diagnostics. Final `bot.decision.skipped` and `bot.transaction.built` decision transcripts keep compact ring evidence under `audit.selectedRing`. `audit` carries compact operator checks for reserve arithmetic, rebalance CKB costs, and selected ring segment shape so reserve and ring decisions can be reviewed without reimplementing the policy. `fee.feeRate` is included on state and decision events.

Transaction events summarize action counts, fee, fee rate, tx hash, phase, outcome, confirmation status, elapsed time, wait policy, retryable/terminal policy, and transaction shape counts. Error summaries preserve non-secret enumerable error fields. This keeps CKB/CCC send rejection evidence such as `code`, `data`, `outPoint`, `currentFee`, and `leastFee` visible in `bot.transaction.failed` and `bot.turn.failed`. Non-secret debugging data may be logged when useful, including raw transactions, witnesses, public config fields, noncredentialed RPC identity evidence, scripts, cells, hashes, counts, and summaries.

Observed testnet full-node send rejection signatures for generic stale-state races are: in-pool same-input conflict can return `code:-1111` with `data:"RBFRejected(...)"` and CCC fields `currentFee`/`leastFee`; a post-commit spent input returns `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"` and CCC field `outPoint`; resending the same tx returns `code:-1107` with `data:"Duplicated(Byte32(...))"` and CCC field `txHash`. CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. CCC JSON-RPC response id mismatch errors such as `Id mismatched, got null, expected 319` are also retry candidates because the bot discards the failed state read and rebuilds from fresh state. Treat these as retry candidates only when the bot discards the transaction or read state and rebuilds from fresh state, not by blindly resending the same transaction.

One process is one turn: `pnpm --filter ./apps/bot start` exits with code `0` after a skipped decision or a committed transaction, with code `1` after any failure, and with code `2` only for capital below the minimum. Every failure is safe to follow with a fresh turn, including the finite 10-minute confirmation timeout: the next turn rebuilds from committed state, and a transaction still pending from the previous turn conflicts with the rebuilt one at the node, which the bot reports as a retryable send failure until the pending one commits or drops. Exit `2` is the only hold, because another turn would fail the same way until the account is funded.

Structured events contain the evidence needed to understand bot behavior. The bot must not print its configured private key to events, errors, stdout, or stderr. Private keys are for signing only: logger, event, error, and test-hook APIs must not receive private keys, signers, secret contexts, masking callbacks, redaction parameters, or guard inputs. Tests use a configured canary private key from outside the production path and verify produced output cannot reveal it. Secrets, credentialed RPC URLs, tokens, passwords, API keys, and secret-bearing config/env dumps must not be logged or passed to logging, redaction, masking, or guard helpers.

Bot-only log queries over a saved bot stdout NDJSON stream, or over `journalctl --user -u ickb-bot-<network>.service -o cat` piped through the same filters:

```bash
EVENT_FILE=log/bot/events.ndjson
jq -r '.type' "$EVENT_FILE" | sort | uniq -c
jq -c 'select(.type == "bot.chain.preflight") | {timestamp, chain, identity, expected, observed, matches}' "$EVENT_FILE"
jq -c 'select(.type == "bot.decision.skipped") | {timestamp, chain, runId, reason, actions, deficit, state, skip: .decision.skip}' "$EVENT_FILE"
jq -c 'select(.type == "bot.match.evaluated") | {timestamp, reason: .match.reason, orders, diagnostics: .match.diagnostics}' "$EVENT_FILE"
jq -c 'select(.type == "bot.rebalance.evaluated") | {timestamp, rebalance, poolDeposits}' "$EVENT_FILE"
jq -c 'select((.type == "bot.decision.skipped" or .type == "bot.transaction.built")) | {timestamp, reason, actions, reserve: .decision.audit.reserveCheck, ring: .decision.audit.selectedRing}' "$EVENT_FILE"
jq -c 'select((.type == "bot.transaction.failed" or .type == "bot.turn.failed")) | {timestamp, chain, runId, type, phase, outcome, retryable, terminal, txHash, status, elapsedMs, timeoutMs, intervalMs, error}' "$EVENT_FILE"
```

## systemd Deployment

The bot runs as the operator's own user under the systemd user manager, from an ordinary git checkout, with Node wherever the operator installed it. The same steps apply to a developer desktop and a production VM; systemd 255 and later are supported. There is no root install, service user, release directory, encrypted credential, or update script: git owns revisions, the unit owns the process, and a `0600` key file owns the secret. That trades per-network user isolation and atomic updates for one concept fewer each; a single trusted operator on one host loses little.

The tracked example `apps/bot/ickb-bot-testnet.service` is the whole configuration for one network. Copy it under a name per network, edit every path and the RPC URL, and keep the rest:

```bash
pnpm bot:install
install -d -m 700 ~/.config/ickb-bot ~/.config/systemd/user
(umask 077 && $EDITOR ~/.config/ickb-bot/testnet.key)
cp apps/bot/ickb-bot-testnet.service ~/.config/systemd/user/
$EDITOR ~/.config/systemd/user/ickb-bot-testnet.service
systemd-analyze --user verify ~/.config/systemd/user/ickb-bot-testnet.service
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now ickb-bot-testnet.service
journalctl --user -u ickb-bot-testnet.service -f -o cat
```

`ExecStart` needs the absolute path of the node binary: the user manager never sees the shell PATH, and a version manager's per-shell link vanishes at logout, so point at the versioned install itself (`readlink -f "$(command -v node)"`). A literal `%` in any value must be written `%%`. Linger keeps the user manager running without a login session, so the unit survives logout and starts at boot. A mainnet unit is the same file with `mainnet` values and its own key file.

Operate the unit as usual:

```bash
systemctl --user status ickb-bot-testnet.service
systemctl --user --failed
systemctl --user restart ickb-bot-testnet.service
```

To update, stop every unit that shares the checkout, move the checkout to the reviewed revision, run `pnpm bot:install`, then start them again; a turn must never observe a half-updated tree. Editing a unit needs `systemd-analyze --user verify`, `systemctl --user daemon-reload`, and a restart of that unit, because a reload alone keeps the running process.

Exit code `2` means the account is below the capital minimum: `RestartPreventExitStatus=2` leaves the unit failed instead of restarting it, and `systemctl --user --failed` lists it. It does not survive a reboot: an enabled unit starts again with the user manager. Before restarting, inspect the journal for the terminal event and the exit status:

```bash
journalctl --user -u ickb-bot-testnet.service -o cat -n 2000 --no-pager | jq -c 'select((.terminal == true or .type == "bot.decision.skipped" or .type == "bot.transaction.failed" or .type == "bot.turn.failed"))'
systemctl --user show ickb-bot-testnet.service -p ActiveState -p Result -p ExecMainStatus
```

The unit sets `LimitCORE=0`, so crash diagnosis uses the journal rather than a core file. Journald owns event and stderr retention through its normal limits; reading a user's journal history without `sudo` needs persistent split journals. Artifacts under `BOT_ARTIFACT_ROOT` are content-addressed and never rotated by the bot, so prune them by age when disk space matters.

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
