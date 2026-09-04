# iCKB Bot

The bot is CCC-native. It reads market state from `@ickb/sdk`, matches profitable limit orders, collects the bot's own orders, completes receipts and ready withdrawals, optionally rebalances between CKB and iCKB, completes iCKB UDT balance, CKB capacity, and fees, then signs, sends, and waits for commit.

The bot minimizes excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

Order directions in logs and diagnostics are the on-chain order owner's direction, not the bot's inventory direction. When the bot matches `ckb-to-ickb`, it spends iCKB and receives CKB. When it matches `ickb-to-ckb`, it spends CKB and receives iCKB. Matcher allowance steps therefore follow the asset the bot spends; at an unbalanced rate such as `1 BTC = 100000 USD`, the same value step is `1000 USD` on the USD-spending side and `0.01 BTC` on the BTC-spending side.

## Docs

- [Current Bot Rebalancing Policy](docs/current_rebalancing_policy.md)

## Runtime Config

The bot reads one strict JSON config file named by `BOT_CONFIG_FILE`:

```json
{
  "chain": "testnet",
  "privateKey": "0x...",
  "rpcUrl": "http://127.0.0.1:8114/"
}
```

The JSON config accepts exactly `chain`, `privateKey`, and `rpcUrl`. `rpcUrl` is required and exclusive: the client does not keep CCC public fallbacks beside that URL. Unknown keys, wrong types, omitted/empty/non-HTTP(S) RPC URLs, URL userinfo, whitespace/control characters in `rpcUrl`, and non-canonical private keys are rejected. The private key must be exactly lowercase `0x` plus 64 lowercase hex characters, with no newline, spaces, tabs, or comments. Local config files under `config/` are ignored by git.

For local testnet live supervision, keep funded identities in external environment variables and rebuild disposable ignored configs when needed:

```bash
export ICKB_TESTNET_BOT_PRIVATE_KEY='0x...'
export ICKB_TESTNET_TESTER_PRIVATE_KEY='0x...'
export ICKB_TESTNET_RPC_URL='https://testnet.ckb.dev/'
pnpm live:config-from-env -- --force
```

The helper writes `config/bot-testnet.json` and `config/tester-testnet.json`. Each bot process runs one turn and exits, so continuous matching is a loop around this command, a systemd unit with `Restart=always`, or the operator between reads:

```bash
BOT_CONFIG_FILE=config/bot-testnet.json node src/index.ts
```

Current network support:

- `"chain":"testnet"`
- `"chain":"mainnet"`

## Run

From a plain checkout, run `pnpm install` from the repo root. CCC is resolved as a normal package dependency, and the app itself runs from TypeScript source under Node 22.19+.

From the repo root for an ad hoc foreground bot run:

```bash
pnpm install
mkdir -p config
$EDITOR config/bot-testnet.json
export BOT_CONFIG_FILE="$(pwd)/config/bot-testnet.json"
pnpm --filter ./apps/bot start
```

Or from `apps/bot`:

```bash
pnpm install
mkdir -p ../../config
$EDITOR ../../config/bot-testnet.json
export BOT_CONFIG_FILE="$(pwd)/../../config/bot-testnet.json"
pnpm start
```

The start script runs the bot once from source. Stdout is the NDJSON event stream and stderr carries diagnostics; both go wherever the caller sends them, which is journald under systemd. Balance and fee amounts are decimal strings so large on-chain values do not lose precision. Process restart policy belongs to the service manager, not the launcher.

## Structured Events

Every stdout line is one JSON object with `chain`, `runId`, ISO `timestamp`, and a `bot.*` type. These events are the sole bot stdout contract.

The stable event contract is the bot NDJSON object stream, not a particular file path. Under systemd the stream is the unit's journal; elsewhere it is whatever file stdout was redirected to. Consumers should depend on records with `app: "bot"` and `bot.*` event types, not supervisor/tester output or log locations.

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

`bot.chain.preflight` emits credential-free RPC endpoint identity (protocol, hostname, port, and pathname), expected chain identity, observed genesis hash/address prefix/tip, and match booleans before signing starts. It never prints the full RPC URL, query, or fragment. No-action iterations emit `bot.decision.skipped` with `reason` and evidence. Build-time skip reasons `no_actions`, `match_value_not_above_fee`, and `post_tx_ckb_reserve` include a `decision` transcript. Reserve skips report zero committed `actions`, keep attempted action counts under `decision.skip.attemptedActions`, and keep reserve arithmetic under `decision.audit.reserveCheck` because the transaction was not broadcast. Bot reserve arithmetic is projected available CKB, not actual plain-cell accounting; withdrawal requests with non-negative match CKB delta are staged CKB recovery actions and bypass the immediate reserve skip. The pre-build safety skip `capital_below_minimum` exits with code `2` and includes zero `actions`, `deficit`, and `state` evidence instead of a `decision` transcript because match, rebalance, fee, and transaction shape were not evaluated. `bot.iteration.failed` includes an `error` summary plus `retryable` and `terminal` booleans from the bot retry policy. Rebalance decisions include normalized `reason`; no-op reasons remain policy-owned strings such as `insufficient_output_slots`, `low_ickb_ckb_reserve_unavailable`, `no_withdrawable_ickb`, `no_ring_surplus_ready_deposits`, `ring_surplus_withdrawal_over_budget`, and `no_ready_withdrawal_selection`, while action reasons include `low_ickb_balance`, `ring_inventory`, `excess_ickb_balance`, and `reserve_recovery`.

The decision transcript groups evidence under `chainTip`, `balances`, `orders`, `withdrawals`, `poolDeposits`, `match`, `rebalance`, `audit`, `actions`, `fee`, `transactionShape`, `exchangeRatio`, and `depositCapacity`. `balances` includes available, unavailable, total, equivalent, minimum-capital, spendable CKB, and matchable CKB evidence. `match.reason` normalizes the matching outcome, while `match.diagnostics` carries public allowance, mining fee, direction counts, candidate counts, positive-gain counts, and rejection counts. `match.search` records bounded-search evidence when matching was incomplete. A positive incomplete match still passes transaction completion and final fee profitability, but runtime does not derive globally useful inventory floors from incomplete diagnostics. An incomplete empty match is a soft `match_search_incomplete` skip. `rebalance` carries kind, reason, projected balances, output slots, and pool/deposit/withdrawal counts. Ring diagnostics are compact inline on `bot.rebalance.evaluated`; repeated full segment detail is stored as a content-addressed artifact under `log/bot/artifacts/<slot>/ringSegments/sha256-<hash>.json` and referenced by `rebalance.diagnostics.ring.segmentsRef`. If artifact writing is unavailable, the event falls back to inline full diagnostics. Final `bot.decision.skipped` and `bot.transaction.built` decision transcripts keep compact ring evidence under `audit.selectedRing`. `audit` carries compact operator checks for reserve arithmetic, rebalance CKB costs, and selected ring segment shape so reserve and ring decisions can be reviewed without reimplementing the policy. `fee.feeRate` is included on state and decision events.

Transaction events summarize action counts, fee, fee rate, tx hash, phase, outcome, confirmation status, elapsed time, wait policy, retryable/terminal policy, and transaction shape counts. Error summaries preserve non-secret enumerable error fields. This keeps CKB/CCC send rejection evidence such as `code`, `data`, `outPoint`, `currentFee`, and `leastFee` visible in `bot.transaction.failed` and `bot.iteration.failed`. Non-secret debugging data may be logged when useful, including raw transactions, witnesses, public config fields, noncredentialed RPC identity evidence, scripts, cells, hashes, counts, and summaries.

Observed testnet full-node send rejection signatures for generic stale-state races are: in-pool same-input conflict can return `code:-1111` with `data:"RBFRejected(...)"` and CCC fields `currentFee`/`leastFee`; a post-commit spent input returns `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"` and CCC field `outPoint`; resending the same tx returns `code:-1107` with `data:"Duplicated(Byte32(...))"` and CCC field `txHash`. CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. CCC JSON-RPC response id mismatch errors such as `Id mismatched, got null, expected 319` are also retry candidates because the bot discards the failed state read and rebuilds from fresh state. Treat these as retry candidates only when the bot discards the transaction or read state and rebuilds from fresh state, not by blindly resending the same transaction.

One process is one turn: `pnpm --filter ./apps/bot start` exits with code `0` after a skipped decision or a committed transaction, and with code `1` after a failure that a fresh turn may retry, which is the restart policy's cue. One broadcast gets one observation window: no confirmation outcome other than an RBF replacement rebuilds and resends, and a nonretryable post-broadcast confirmation failure, including the finite 10-minute confirmation timeout, exits with code `2` so systemd stops the unit instead of restarting a turn that would resend the intent. Low capital also exits with code `2`.

Structured events contain the evidence needed to understand bot behavior. The bot must not print its configured private key to events, errors, stdout, or stderr. Private keys are for signing only: logger, event, error, and test-hook APIs must not receive private keys, signers, secret contexts, masking callbacks, redaction parameters, or guard inputs. Tests use a configured canary private key from outside the production path and verify produced output cannot reveal it. Secrets, credentialed RPC URLs, tokens, passwords, API keys, and secret-bearing config/env dumps must not be logged or passed to logging, redaction, masking, or guard helpers.

Bot-only log queries over a saved bot stdout NDJSON stream, or over `journalctl -u ickb-bot-<network>.service -o cat` piped through the same filters:

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

## Ubuntu systemd Deployment

For unattended Ubuntu 24.04 deployments, run testnet and mainnet as separate systemd services with separate users, immutable release directories, encrypted JSON credentials, and shared bot-only logs. The generated units run the bot from source, not `dist`:

```text
/usr/bin/node apps/bot/src/index.ts
```

`apps/bot` is the CLI workspace for the private `packages/bot` runtime. Production runs Stack source and resolves CCC from installed package dependencies.

Events and stderr go to the unit's journal. The only disk output is the content-addressed artifact root:

```text
/opt/ickb-stack-<network>/log/bot/artifacts/ringSegments/sha256-<hash>.json
```

Default deployment layout:

```text
/opt/ickb-stack-testnet/releases/<release-id>/
/opt/ickb-stack-testnet/current -> releases/<release-id>
/opt/ickb-stack-testnet/log/bot/
/opt/ickb-stack-mainnet/releases/<release-id>/
/opt/ickb-stack-mainnet/current -> releases/<release-id>
/opt/ickb-stack-mainnet/log/bot/
/etc/ickb/credentials/ickb-bot-testnet-config.cred
/etc/ickb/credentials/ickb-bot-mainnet-config.cred
/etc/systemd/system/ickb-bot-testnet.service
/etc/systemd/system/ickb-bot-mainnet.service
```

From a clean committed checkout, install service users, publish that checkout's `HEAD` as each initial read-only release, create the real shared log directories, create `current` symlinks, and install the units:

```bash
sudo scripts/ickb-bot-systemd-install.sh all
```

The installer copies Git metadata into a staging directory, checks out `HEAD`, and runs `pnpm bot:install` and `pnpm bot:check` as the matching service user before publishing the release. It refuses a dirty source checkout. Existing release-layout installs are validated and their units can be regenerated without replacing `current`; the validator permits the intentional `current` code symlink but rejects symlinks in the deployment root, `releases`, shared `log`, or `log/bot` paths.

Create encrypted config credentials on the VM. The helper prompts for the private key and the required RPC URL; leaving the RPC URL empty fails validation. The helper validates the bot JSON config and encrypts it as one systemd credential. Private keys and sensitive RPC URLs must stay inside the encrypted credential and must not appear in logs, unit text, environment dumps, incident bundles, or diagnostic output.

```bash
sudo systemd-creds setup
sudo scripts/ickb-bot-systemd-credential.sh testnet
sudo scripts/ickb-bot-systemd-credential.sh mainnet
```

Validate and start the units:

```bash
sudo systemd-analyze verify /etc/systemd/system/ickb-bot-testnet.service /etc/systemd/system/ickb-bot-mainnet.service
sudo systemctl daemon-reload
sudo systemctl enable --now ickb-bot-testnet.service
sudo systemctl enable --now ickb-bot-mainnet.service
```

Operate through systemd instead of logging in as the service users:

```bash
sudo systemctl status ickb-bot-testnet.service
sudo systemctl status ickb-bot-mainnet.service
sudo journalctl -u ickb-bot-testnet.service -f
sudo journalctl -u ickb-bot-mainnet.service -f
sudo systemctl restart ickb-bot-testnet.service
sudo systemctl restart ickb-bot-mainnet.service
```

Generated systemd units set `WorkingDirectory` to `/opt/ickb-stack-<network>/current`, point `BOT_ARTIFACT_ROOT` at the shared `log/bot/artifacts` directory, and grant `ReadWritePaths` only for that real log directory. `ProtectSystem=strict`, `ProtectHome=true`, `NoNewPrivileges=true`, and the existing process/core hardening remain enabled.

Update testnet first, then mainnet after the exact same revision is validated. Pass an explicit remote branch, tag, or commit; the updater does not infer or pull the active branch:

```bash
sudo scripts/ickb-bot-systemd-update.sh testnet <revision>
sudo scripts/ickb-bot-systemd-update.sh mainnet <same-revision>
```

The updater requires the service to be active and serializes each network with `flock`. It copies Git metadata from the active immutable release into sibling staging, fetches and checks out the requested revision there, then runs frozen-lockfile `bot:install`, `bot:check`, and clean-worktree validation as the service user while the old bot keeps running. The validated release is made read-only before publication. Only then does the updater stop the service, create `current.new`, atomically replace `current` with `mv`, and start the service.

Readiness is bounded to 120 seconds by default: the service must be active and the journal of its current invocation must contain a canonical successful `bot.chain.preflight` for the network. A rollback is proved the same way.

Exit code `2` is an intentional safety stop, including low capital and a nonretryable post-broadcast confirmation failure. `RestartPreventExitStatus=2` keeps systemd from relaunching immediately. Before restarting, inspect the journal for the terminal event and the exit status:

```bash
sudo journalctl -u ickb-bot-testnet.service -o cat -n 2000 --no-pager | jq -c 'select((.terminal == true or .type == "bot.decision.skipped" or .type == "bot.transaction.failed" or .type == "bot.turn.failed"))'
sudo systemctl status ickb-bot-testnet.service --no-pager
```

The generated units set `LimitCORE=0`, so crash diagnosis should use the journal and the unit properties rather than expecting a core file.

### Retention

Journald owns event and stderr retention through its normal `journald.conf` limits. Artifacts under `log/bot/artifacts` are content-addressed and never rotated by the bot, so prune them by age when disk space matters.

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
