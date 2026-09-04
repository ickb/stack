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
  "rpcUrl": "http://127.0.0.1:8114/",
  "sleepIntervalSeconds": 60,
  "maxIterations": 1,
  "maxRetryableAttempts": 10
}
```

The JSON config accepts exactly `chain`, `privateKey`, `rpcUrl`, `sleepIntervalSeconds`, optional `maxIterations`, and optional `maxRetryableAttempts`. `rpcUrl` is required and exclusive: the client does not keep CCC public fallbacks beside that URL. Unknown keys, wrong types, omitted/empty/non-HTTP(S) RPC URLs, URL userinfo, whitespace/control characters in `rpcUrl`, and non-canonical private keys are rejected. The private key must be exactly lowercase `0x` plus 64 lowercase hex characters, with no newline, spaces, tabs, or comments. Local config files under `config/` are ignored by git.

For local testnet live supervision, keep funded identities in external environment variables and rebuild disposable ignored configs when needed:

```bash
export ICKB_TESTNET_BOT_PRIVATE_KEY='0x...'
export ICKB_TESTNET_TESTER_PRIVATE_KEY='0x...'
export ICKB_TESTNET_RPC_URL='https://testnet.ckb.dev/'
# Optional: export ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS=10 to cap all generated configs
pnpm live:config-from-env -- --force
```

The helper writes bounded `config/bot-testnet.json` and `config/tester-testnet.json` for supervisor/tester runs, plus unbounded `config/bot-live-testnet.json` for a production-like long-running bot. Bounded configs default to `maxRetryableAttempts: 10`; the live config omits `maxRetryableAttempts` unless `ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS` is set intentionally. Use the live config with the source-owned launcher when the goal is continuous matching:

```bash
BOT_CONFIG_FILE=config/bot-live-testnet.json node scripts/bot/launcher.ts --no-child-tee
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

The start script runs the source-owned launcher once. It validates child stdout as bot event NDJSON, stores events and stderr in fixed run slots, writes separate launch metadata, and preserves the child exit status or signal. Balance and fee amounts are decimal strings so large on-chain values do not lose precision. Process restart policy belongs to the service manager, not the launcher.

## Structured Events

Every child stdout line is one JSON object with `version`, `app: "bot"`, `chain`, `runId`, `iterationId`, ISO `timestamp`, and a `bot.*` type. These versioned events are the sole bot stdout contract.

The stable event contract is the bot NDJSON object stream, not a particular file path. The source-owned production launcher keeps bot logs under the repo-root `log/` tree by default and records the current event file in `launches.ndjson`. Consumers should depend on records with `app: "bot"` and `bot.*` event types, not supervisor/tester output, launcher metadata, slot layout, `/var/log`, or validation log directories.

Stable event types:

- `bot.run.started`
- `bot.chain.preflight`
- `bot.iteration.started`
- `bot.state.read`
- `bot.match.evaluated`
- `bot.rebalance.evaluated`
- `bot.decision.skipped`
- `bot.transaction.built`
- `bot.transaction.sent`
- `bot.transaction.confirmation`
- `bot.transaction.committed`
- `bot.transaction.failed`
- `bot.iteration.failed`

`bot.chain.preflight` emits credential-free RPC endpoint identity (protocol, hostname, port, and pathname), expected chain identity, observed genesis hash/address prefix/tip, and match booleans before signing starts. It never prints the full RPC URL, query, or fragment. No-action iterations emit `bot.decision.skipped` with `reason` and evidence. Build-time skip reasons `no_actions`, `match_value_not_above_fee`, and `post_tx_ckb_reserve` include a `decision` transcript. Reserve skips report zero committed `actions`, keep attempted action counts under `decision.skip.attemptedActions`, and keep reserve arithmetic under `decision.audit.reserveCheck` because the transaction was not broadcast. Bot reserve arithmetic is projected available CKB, not actual plain-cell accounting; withdrawal requests with non-negative match CKB delta are staged CKB recovery actions and bypass the immediate reserve skip. The pre-build safety skip `capital_below_minimum` exits with code `2` and includes zero `actions`, `deficit`, and `state` evidence instead of a `decision` transcript because match, rebalance, fee, and transaction shape were not evaluated. `bot.iteration.failed` includes an `error` summary plus `retryable` and `terminal` booleans from the bot retry policy. Rebalance decisions include normalized `reason`; no-op reasons remain policy-owned strings such as `insufficient_output_slots`, `low_ickb_ckb_reserve_unavailable`, `no_withdrawable_ickb`, `no_ring_surplus_ready_deposits`, `ring_surplus_withdrawal_over_budget`, and `no_ready_withdrawal_selection`, while action reasons include `low_ickb_balance`, `ring_inventory`, `excess_ickb_balance`, and `reserve_recovery`.

The decision transcript groups evidence under `chainTip`, `balances`, `orders`, `withdrawals`, `poolDeposits`, `match`, `rebalance`, `audit`, `actions`, `fee`, `transactionShape`, `exchangeRatio`, and `depositCapacity`. `balances` includes available, unavailable, total, equivalent, minimum-capital, spendable CKB, and matchable CKB evidence. `match.reason` normalizes the matching outcome, while `match.diagnostics` carries public allowance, mining fee, direction counts, candidate counts, positive-gain counts, and rejection counts. `match.search` records bounded-search evidence when matching was incomplete. A positive incomplete match still passes transaction completion and final fee profitability, but runtime does not derive globally useful inventory floors from incomplete diagnostics. An incomplete empty match is a soft `match_search_incomplete` skip. `rebalance` carries kind, reason, projected balances, output slots, and pool/deposit/withdrawal counts. Ring diagnostics are compact inline on `bot.rebalance.evaluated`; repeated full segment detail is stored as a content-addressed artifact under `log/bot/artifacts/<slot>/ringSegments/sha256-<hash>.json` and referenced by `rebalance.diagnostics.ring.segmentsRef`. If artifact writing is unavailable, the event falls back to inline full diagnostics. Final `bot.decision.skipped` and `bot.transaction.built` decision transcripts keep compact ring evidence under `audit.selectedRing`. `audit` carries compact operator checks for reserve arithmetic, rebalance CKB costs, and selected ring segment shape so reserve and ring decisions can be reviewed without reimplementing the policy. `fee.feeRate` is included on state and decision events.

Transaction events summarize action counts, fee, fee rate, tx hash, phase, outcome, confirmation status, elapsed time, wait policy, retryable/terminal policy, and transaction shape counts. Error summaries preserve non-secret enumerable error fields. This keeps CKB/CCC send rejection evidence such as `code`, `data`, `outPoint`, `currentFee`, and `leastFee` visible in `bot.transaction.failed` and `bot.iteration.failed`. Non-secret debugging data may be logged when useful, including raw transactions, witnesses, public config fields, noncredentialed RPC identity evidence, scripts, cells, hashes, counts, and summaries.

Observed testnet full-node send rejection signatures for generic stale-state races are: in-pool same-input conflict can return `code:-1111` with `data:"RBFRejected(...)"` and CCC fields `currentFee`/`leastFee`; a post-commit spent input returns `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"` and CCC field `outPoint`; resending the same tx returns `code:-1107` with `data:"Duplicated(Byte32(...))"` and CCC field `txHash`. CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. CCC JSON-RPC response id mismatch errors such as `Id mismatched, got null, expected 319` are also retry candidates because the bot discards the failed state read and rebuilds from fresh state. Treat these as retry candidates only when the bot discards the transaction or read state and rebuilds from fresh state, not by blindly resending the same transaction.

JSON `"maxIterations":1` makes `pnpm --filter ./apps/bot start` exit with code `0` after one completed iteration: a skipped decision or committed transaction. Nonretryable iteration failures exit with code `1`. One broadcast gets one observation window: no confirmation outcome other than an RBF replacement rebuilds and resends, and a nonretryable post-broadcast confirmation failure, including the finite 10-minute confirmation timeout, exits with code `2` so systemd stops the unit instead of restarting a turn that would resend the intent. Retryable iteration failures do not count toward `maxIterations`; set `maxRetryableAttempts` to stop repeated fresh-state retries with exit code `2` after that many consecutive retryable failures. Low capital also exits with code `2`. Omitting `maxIterations` keeps the default infinite loop; omitting `maxRetryableAttempts` leaves retryable attempts unbounded.

Structured events contain the evidence needed to understand bot behavior. The bot must not print its configured private key to events, errors, stdout, or stderr. Private keys are for signing only: logger, event, error, and test-hook APIs must not receive private keys, signers, secret contexts, masking callbacks, redaction parameters, or guard inputs. Tests use a configured canary private key from outside the production path and verify produced output cannot reveal it. Secrets, credentialed RPC URLs, tokens, passwords, API keys, and secret-bearing config/env dumps must not be logged or passed to logging, redaction, masking, or guard helpers.

Bot-only log queries, using the production event file or any saved bot stdout NDJSON stream:

```bash
LOG_DIR=/opt/ickb-stack-testnet/log/bot
EVENT_FILE=$(jq -r 'select(.type == "launcher.started") | .logFiles.events' "$LOG_DIR/launches.ndjson" | tail -n 1)
jq -c 'select(.app == "bot")' "$EVENT_FILE"
jq -r 'select(.app == "bot") | .type' "$EVENT_FILE" | sort | uniq -c
jq -c 'select(.app == "bot" and .type == "bot.chain.preflight") | {timestamp, chain, rpcConfigured, expected, observed, matches}' "$EVENT_FILE"
jq -c 'select(.app == "bot" and .type == "bot.decision.skipped") | {timestamp, chain, runId, iterationId, reason, actions, deficit, state, skip: .decision.skip}' "$EVENT_FILE"
jq -c 'select(.app == "bot" and .type == "bot.match.evaluated") | {timestamp, iterationId, reason: .match.reason, orders, diagnostics: .match.diagnostics}' "$EVENT_FILE"
jq -c 'select(.app == "bot" and .type == "bot.rebalance.evaluated") | {timestamp, iterationId, rebalance, poolDeposits}' "$EVENT_FILE"
jq -c 'select(.app == "bot" and (.type == "bot.decision.skipped" or .type == "bot.transaction.built")) | {timestamp, iterationId, reason, actions, reserve: .decision.audit.reserveCheck, ring: .decision.audit.selectedRing}' "$EVENT_FILE"
jq -c 'select(.app == "bot" and (.type == "bot.transaction.failed" or .type == "bot.iteration.failed")) | {timestamp, chain, runId, iterationId, type, phase, outcome, retryable, terminal, retryableAttempts, maxRetryableAttempts, retryBudgetExhausted, txHash, status, elapsedMs, timeoutMs, intervalMs, error}' "$EVENT_FILE"
jq -c 'select(.type == "launcher.child.exited") | {timestamp, status, signal, elapsedMs, logRoot, logDir, command}' "$LOG_DIR/launches.ndjson"
```

## Ubuntu systemd Deployment

For unattended Ubuntu 24.04 deployments, run testnet and mainnet as separate systemd services with separate users, immutable release directories, encrypted JSON credentials, and shared bot-only logs. The generated units run the bot from source, not `dist`:

```text
/usr/bin/node scripts/bot/launcher.ts --log-root /opt/ickb-stack-<network>/log --no-child-tee
```

`apps/bot` is the CLI workspace for the private `packages/bot` runtime. Production runs Stack source and resolves CCC from installed package dependencies.

Production log layout:

```text
/opt/ickb-stack-<network>/log/bot/bot.events.slot-00.ndjson
/opt/ickb-stack-<network>/log/bot/bot.stderr.slot-00.log
/opt/ickb-stack-<network>/log/bot/artifacts/slot-00/ringSegments/sha256-<hash>.json
/opt/ickb-stack-<network>/log/bot/launches.ndjson
```

The launcher keeps 16 fixed run slots, `slot-00` through `slot-15`. On Ubuntu/Linux, it binds a process-owned abstract Unix-domain socket keyed to the service UID and resolved bot log directory before slot selection and holds it through child close and launcher cleanup, so a second same-UID launcher using the same directory fails before spawning. This lock guarantees same-UID exclusivity only; cross-UID shared custom log directories are not supported. The generated systemd deployment uses one service UID per unit and an owner-private `0700` bot log directory, so different UIDs do not share a log directory. The kernel releases ownership when the launcher exits, including after SIGKILL, OOM termination, or host failure. The lock creates no filesystem entry. Each new launcher run truncates the selected event/stderr slot and resets that slot's artifact directory. `launches.ndjson` is append-only metadata. Version 3 records include `runId`, `identity.bootId`, `identity.launcher`, and `identity.child`; each process identity contains the exact PID and Linux proc start-time ticks captured after spawn, and start and exit records retain the same identity. They also record `logFiles.events`, `logFiles.stderr`, `logFiles.artifacts`, and `logSlot`. Live stimulus validation rejects version 2, legacy, or malformed identity records, so restart a launcher created by an older deployment before running that workflow. These are production bot-only logs. They are separate from local live validation supervisor artifacts such as `log/live-supervisor/...` and `log/validation/...`.

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

For a one-time migration from the legacy layout, run the new installer from a clean committed migration-capable checkout. The legacy deployment root must be a clean checkout owned by its matching service user, `log` and `log/bot` must be real directories, neither `current` nor `releases` may exist, and the shipped legacy unit must be active. Then migrate one network at a time:

```bash
sudo scripts/ickb-bot-systemd-install.sh --migrate testnet
sudo scripts/ickb-bot-systemd-install.sh --migrate mainnet
```

Migration holds the same per-network deployment lock as updates. While the legacy bot remains running, it prepares and validates the invoking checkout in sibling staging. At cutover it stops the legacy service, moves the existing `log` directory without copying or deleting its contents, makes `log/bot` writable by the service user, installs the new unit, and starts the prepared release. Readiness is checked from new launcher and bot preflight evidence. Any failure from stop through readiness follows one restoration path back to the original bare legacy checkout and unit; after successful readiness, migration back to the legacy layout is not supported. Ambiguous ownership, symlinks, dirty source or deployment checkouts, an inactive or unexpected legacy unit, and occupied staging paths fail closed before cutover.

Create encrypted config credentials on the VM. The helper prompts for the private key, required RPC URL, sleep interval, optional max iterations, and optional max retryable attempts. Leaving the RPC URL empty fails validation; leaving the retryable-attempt prompt empty keeps retryable attempts unbounded. The helper validates the bot JSON config and encrypts it as one systemd credential. Private keys and sensitive RPC URLs must stay inside the encrypted credential and must not appear in logs, unit text, environment dumps, incident bundles, or diagnostic output.

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
LOG_DIR=/opt/ickb-stack-testnet/log/bot
sudo tail -f "$(jq -r 'select(.type == "launcher.started") | .logFiles.events' "$LOG_DIR/launches.ndjson" | tail -n 1)"
sudo systemctl restart ickb-bot-testnet.service
sudo systemctl restart ickb-bot-mainnet.service
```

Generated systemd units set `WorkingDirectory` to `/opt/ickb-stack-<network>/current`, pass the absolute shared `--log-root /opt/ickb-stack-<network>/log`, and grant `ReadWritePaths` only for that real log directory. `ProtectSystem=strict`, `ProtectHome=true`, `NoNewPrivileges=true`, and the existing process/core hardening remain enabled. With `--no-child-tee`, bot event NDJSON and stderr stay in their current slot files.

Update testnet first, then mainnet after the exact same revision is validated. Pass an explicit remote branch, tag, or commit; the updater does not infer or pull the active branch:

```bash
sudo scripts/ickb-bot-systemd-update.sh testnet <revision>
sudo scripts/ickb-bot-systemd-update.sh mainnet <same-revision>
```

The updater requires the service to be active and serializes each network with `flock`. It copies Git metadata from the active immutable release into sibling staging, fetches and checks out the requested revision there, then runs frozen-lockfile `bot:install`, `bot:check`, and clean-worktree validation as the service user while the old bot keeps running. The validated release is made read-only before publication. Only then does the updater stop the service, create `current.new`, atomically replace `current` with `mv`, and start the service.

Readiness is bounded to 120 seconds by default and inspects a bounded tail of `launches.ndjson`. The newest `launcher.started` must name the expected real `repoRoot` and shared `logRoot`; its `runId` must have a canonical successful `bot.chain.preflight` in that launch's active event slot. Older matching launch records cannot satisfy readiness. Same-path recovery also rejects the latest `runId` captured after the service is stopped. Immediate `systemctl status` is not readiness. Set `ICKB_BOT_UPDATE_READINESS_TIMEOUT_SECONDS` to an integer from 1 through 600 if the host needs a different bound. On failure, the updater stops the failed release, atomically restores the previous `current`, restarts it, and verifies rollback with fresh evidence. A failed candidate is removed only after rollback is active again. After success, the active release, its rollback target, and one additional validated release are retained; the sole rollback target is never pruned. Shared logs are never part of release cleanup.

Exit code `2` is an intentional safety stop, including low capital, exhausted retryable-failure budget, and a nonretryable post-broadcast confirmation failure. `RestartPreventExitStatus=2` keeps systemd from relaunching immediately. Before restarting, inspect `launches.ndjson` for the child exit record, the current event slot for the terminal bot event, the current stderr slot for runtime errors, referenced artifacts for full diagnostics, and journald for launcher lifecycle output:

```bash
LOG_DIR=/opt/ickb-stack-testnet/log/bot
EVENT_FILE=$(jq -r 'select(.type == "launcher.started") | .logFiles.events' "$LOG_DIR/launches.ndjson" | tail -n 1)
jq -c 'select(.type == "launcher.child.exited")' "$LOG_DIR/launches.ndjson"
jq -c 'select(.app == "bot" and (.terminal == true or .type == "bot.decision.skipped" or .type == "bot.transaction.failed" or .type == "bot.iteration.failed"))' "$EVENT_FILE"
sudo journalctl -u ickb-bot-testnet.service -n 200 --no-pager
```

The generated units set `LimitCORE=0`, so crash diagnosis should use bot logs, launcher exit records, stderr, journald, and the bundled systemd unit properties rather than expecting a core file.

### Retention

The launcher keeps 16 fixed run slots. Reusing a slot truncates its event and stderr files and resets its artifact directory, while the active run remains complete. Storage is count-rotated rather than byte-bounded, so monitor available disk space for long-running deployments.

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
