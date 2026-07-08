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

The JSON config accepts exactly `chain`, `privateKey`, optional `rpcUrl`, `sleepIntervalSeconds`, optional `maxIterations`, and optional `maxRetryableAttempts`. Omit `rpcUrl` to let CCC use its default public endpoint for the selected chain. Unknown keys, wrong types, empty/non-HTTP(S) RPC URLs, whitespace/control characters in `rpcUrl`, and non-canonical private keys are rejected. The private key must be exactly lowercase `0x` plus 64 lowercase hex characters, with no newline, spaces, tabs, or comments. Local config files under `config/` are ignored by git.

For local testnet live supervision, keep funded identities in external environment variables and rebuild disposable ignored configs when needed:

```bash
export ICKB_TESTNET_BOT_PRIVATE_KEY='0x...'
export ICKB_TESTNET_TESTER_PRIVATE_KEY='0x...'
# Optional: export ICKB_TESTNET_RPC_URL='https://...'
# Optional: export ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS=10 to cap all generated configs
pnpm live:config-from-env -- --force
```

The helper writes bounded `config/bot-testnet.json` and `config/tester-testnet.json` for supervisor/tester runs, plus unbounded `config/bot-live-testnet.json` for a production-like long-running bot. Bounded configs default to `maxRetryableAttempts: 10`; the live config omits `maxRetryableAttempts` unless `ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS` is set intentionally. Use the live config with the source-owned launcher when the goal is continuous matching:

```bash
BOT_CONFIG_FILE=config/bot-live-testnet.json node --experimental-default-type=module scripts/bot/launcher.ts --no-child-tee
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
pnpm --filter ./apps/bot start:loop
```

Or from `apps/bot`:

```bash
pnpm install
mkdir -p ../../config
$EDITOR ../../config/bot-testnet.json
export BOT_CONFIG_FILE="$(pwd)/../../config/bot-testnet.json"
pnpm run start:loop
```

The start script writes NDJSON logs to stdout and tees one log file per run. Balance and fee amounts are logged as decimal strings so large on-chain values do not lose precision. Intentional shutdowns, including low capital and transaction confirmation timeouts after broadcast, exit with code `2`; `start:loop` stops on that code instead of restarting immediately. `start:loop` also stops on exit code `0`, so bounded runs do not relaunch after JSON `maxIterations` is exhausted.

## Structured Events

Every bot observability record is one JSON object on stdout with `version`, `app: "bot"`, `chain`, `runId`, `iterationId`, ISO `timestamp`, and `type`. Execution-log records also remain on stdout, and structured bot records can be selected with `app == "bot"`.

The stable event contract is the bot NDJSON object stream, not a particular file path. The source-owned production launcher keeps bot logs under the repo-root `log/` tree by default and records the current event file in `launches.ndjson`. Consumers should depend on records with `app: "bot"` and `bot.*` event types, not supervisor/tester output, launcher metadata, slot layout, incident bundles, `/var/log`, or validation log directories.

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

`bot.chain.preflight` emits public chain identity evidence before signing starts: whether a custom RPC URL was configured, expected chain identity, observed genesis hash/address prefix/tip, and match booleans. It does not print the RPC URL because configured URLs may contain credentials. No-action iterations emit `bot.decision.skipped` with `reason` and evidence. Build-time skip reasons `no_actions`, `match_value_not_above_fee`, and `post_tx_ckb_reserve` include a `decision` transcript. Reserve skips report zero committed `actions`, keep attempted action counts under `decision.skip.attemptedActions`, and keep reserve arithmetic under `decision.audit.reserveCheck` because the transaction was not broadcast. Bot reserve arithmetic is projected available CKB, not actual plain-cell accounting; withdrawal requests with non-negative match CKB delta are staged CKB recovery actions and bypass the immediate reserve skip. The pre-build safety skip `capital_below_minimum` exits with code `2` and includes zero `actions`, `deficit`, and `state` evidence instead of a `decision` transcript because match, rebalance, fee, and transaction shape were not evaluated. `bot.iteration.failed` includes an `error` summary plus `retryable` and `terminal` booleans from the bot retry policy. Rebalance decisions include normalized `reason`; no-op reasons remain policy-owned strings such as `insufficient_output_slots`, `low_ickb_ckb_reserve_unavailable`, `no_withdrawable_ickb`, `no_ring_surplus_ready_deposits`, `ring_surplus_withdrawal_over_budget`, and `no_ready_withdrawal_selection`, while action reasons include `low_ickb_balance`, `ring_inventory`, `excess_ickb_balance`, and `reserve_recovery`.

The decision transcript groups evidence under `chainTip`, `balances`, `orders`, `withdrawals`, `poolDeposits`, `match`, `rebalance`, `audit`, `actions`, `fee`, `transactionShape`, `exchangeRatio`, and `depositCapacity`. `balances` includes available, unavailable, total, equivalent, minimum-capital, spendable CKB, and matchable CKB evidence. `match.reason` normalizes the matching outcome, while `match.diagnostics` carries public allowance, mining fee, direction counts, candidate counts, positive-gain counts, and rejection counts. Runtime derives the post-match useful CKB and iCKB floors from those diagnostics before evaluating refill and recovery. `rebalance` carries kind, reason, projected balances, output slots, and pool/deposit/withdrawal counts. Ring diagnostics are compact inline on `bot.rebalance.evaluated`; repeated full segment detail is stored as a content-addressed artifact under `log/bot/artifacts/<slot>/ringSegments/sha256-<hash>.json` and referenced by `rebalance.diagnostics.ring.segmentsRef`. If artifact writing is unavailable, the event falls back to inline full diagnostics. Final `bot.decision.skipped` and `bot.transaction.built` decision transcripts keep compact ring evidence under `audit.selectedRing`. `audit` carries compact operator checks for reserve arithmetic, rebalance CKB costs, and selected ring segment shape so reserve and ring decisions can be reviewed without reimplementing the policy. `fee.feeRate` is included on state and decision events.

Transaction events summarize action counts, fee, fee rate, tx hash, phase, outcome, confirmation status, check count, elapsed time, retryable/terminal policy, and transaction shape counts. Error summaries preserve non-secret enumerable error fields. This keeps CKB/CCC send rejection evidence such as `code`, `data`, `outPoint`, `currentFee`, and `leastFee` visible in `bot.transaction.failed` and `bot.iteration.failed`. Non-secret debugging data may be logged when useful, including raw transactions, witnesses, public config fields, noncredentialed RPC identity evidence, scripts, cells, hashes, counts, and summaries.

Observed testnet full-node send rejection signatures for generic stale-state races are: in-pool same-input conflict can return `code:-1111` with `data:"RBFRejected(...)"` and CCC fields `currentFee`/`leastFee`; a post-commit spent input returns `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"` and CCC field `outPoint`; resending the same tx returns `code:-1107` with `data:"Duplicated(Byte32(...))"` and CCC field `txHash`. CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. CCC JSON-RPC response id mismatch errors such as `Id mismatched, got null, expected 319` are also retry candidates because the bot discards the failed state read and rebuilds from fresh state. Treat these as retry candidates only when the bot discards the transaction or read state and rebuilds from fresh state, not by blindly resending the same transaction.

JSON `"maxIterations":1` makes `pnpm --filter ./apps/bot start` exit with code `0` after one terminal iteration when that terminal outcome is a skipped decision, committed transaction, or non-safety transaction failure. Nonretryable deterministic iteration failures exit with code `1`. Retryable iteration failures do not count toward `maxIterations`; set `maxRetryableAttempts` to stop repeated fresh-state retries with exit code `2` after that many consecutive retryable failures. Safety stops still keep their nonzero behavior: low capital and confirmation timeouts after broadcast exit with code `2`. Omitting `maxIterations` keeps the default infinite loop; omitting `maxRetryableAttempts` leaves retryable attempts unbounded.

Structured events should contain evidence needed to understand bot behavior. The bot must not print its configured private key to events, execution logs, errors, stdout, or stderr. Private keys are for signing only: logger, event, and error helpers must not receive private keys, secret contexts, masking callbacks, redaction parameters, or guard inputs. Tests use a configured canary private key from outside the production path and verify produced output cannot reveal it, even unlabeled or nested in arbitrary text. Secrets, credentialed RPC URLs, tokens, passwords, API keys, and secret-bearing config/env dumps must not be logged or passed to logging, redaction, masking, or guard helpers.

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
jq -c 'select(.app == "bot" and (.type == "bot.transaction.failed" or .type == "bot.iteration.failed")) | {timestamp, chain, runId, iterationId, type, phase, outcome, retryable, terminal, retryableAttempts, maxRetryableAttempts, retryBudgetExhausted, txHash, status, checks, elapsedMs, error}' "$EVENT_FILE"
jq -c 'select(.type == "launcher.child.exited") | {timestamp, status, signal, elapsedMs, logRoot, logDir, command}' "$LOG_DIR/launches.ndjson"
```

## Ubuntu systemd Deployment

For unattended Ubuntu 24.04 deployments, run testnet and mainnet as separate systemd services with separate users, deploy directories, encrypted JSON credentials, and bot-only logs. The generated units run the bot from source, not `dist`:

```text
/usr/bin/node --experimental-default-type=module scripts/bot/launcher.ts --no-child-tee
```

`apps/bot` is the CLI workspace for the private `packages/bot` runtime. Production runs Stack source and resolves CCC from installed package dependencies.

Production log layout:

```text
<deploy-dir>/log/bot/bot.events.slot-00.ndjson
<deploy-dir>/log/bot/bot.stderr.slot-00.log
<deploy-dir>/log/bot/artifacts/slot-00/ringSegments/sha256-<hash>.json
<deploy-dir>/log/bot/launches.ndjson
```

The launcher keeps 16 fixed run slots, `slot-00` through `slot-15`. Each new launcher run truncates the selected event/stderr slot and resets that slot's artifact directory. `launches.ndjson` is append-only metadata and records `logFiles.events`, `logFiles.stderr`, `logFiles.artifacts`, `logSlot`, and retention settings for every run. These are production bot-only logs. They are separate from local live validation supervisor artifacts such as `log/live-supervisor/...` and `log/validation/...`.

Default deployment layout:

```text
/opt/ickb-stack-testnet
/opt/ickb-stack-mainnet
/opt/ickb-stack-testnet/log/bot/
/opt/ickb-stack-mainnet/log/bot/
/etc/ickb/credentials/ickb-bot-testnet-config.cred
/etc/ickb/credentials/ickb-bot-mainnet-config.cred
/etc/systemd/system/ickb-bot-testnet.service
/etc/systemd/system/ickb-bot-mainnet.service
```

Install each service user, deploy directory, log directory, and unit file from that network's deployed checkout on the VM:

```bash
sudo -u ickb-bot-testnet git clone <repo-url> /opt/ickb-stack-testnet
cd /opt/ickb-stack-testnet
sudo scripts/ickb-bot-systemd-install.sh testnet

sudo -u ickb-bot-mainnet git clone <repo-url> /opt/ickb-stack-mainnet
cd /opt/ickb-stack-mainnet
sudo scripts/ickb-bot-systemd-install.sh mainnet
```

Install runtime dependencies and check source as the matching service user:

```bash
sudo -u ickb-bot-testnet pnpm -C /opt/ickb-stack-testnet bot:install
sudo -u ickb-bot-testnet pnpm -C /opt/ickb-stack-testnet bot:check
sudo -u ickb-bot-mainnet pnpm -C /opt/ickb-stack-mainnet bot:install
sudo -u ickb-bot-mainnet pnpm -C /opt/ickb-stack-mainnet bot:check
```

The install script uses the current checkout as that network's `WorkingDirectory` and log root. Run it separately from the testnet and mainnet checkouts. The update script expects each deploy directory to be a clean git checkout.

Create encrypted config credentials on the VM. The helper prompts for the private key, optional RPC URL, sleep interval, optional max iterations, and optional max retryable attempts. Leaving the retryable-attempt prompt empty keeps retryable attempts unbounded. The helper validates the bot JSON config and encrypts it as one systemd credential. Private keys and credentialed RPC URLs must stay inside the encrypted credential and must not appear in logs, unit text, environment dumps, incident bundles, or diagnostic output.

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

Generated systemd units use the checkout-local `<deploy-dir>/log` root. The launcher also accepts `--log-root` or `ICKB_BOT_LOG_ROOT` for explicit non-systemd workflows, but production units intentionally avoid those overrides so logs, artifacts, validation output, and incident bundles stay under the repo-root `log/` tree. With `--no-child-tee`, systemd/journald gets launcher lifecycle output only; bot stdout/stderr are written byte-for-byte to the current slot files. Launcher metadata records only the executable basename and argument count, not raw child arguments or environment. Set `ICKB_BOT_LOG_STORAGE_QUOTA_BYTES` while generating units to enable best-effort pruning of inactive slot files and artifact directories by storage quota.

Update testnet first, then mainnet after the same revision is validated. Regenerate the units with `scripts/ickb-bot-systemd-install.sh` before updating when the unit shape changes. The update script refuses stale units and dirty deploy checkouts, pulls with `--ff-only`, runs `bot:install`, type-checks source with `bot:check`, then restarts the service.

```bash
sudo scripts/ickb-bot-systemd-update.sh testnet
sudo scripts/ickb-bot-systemd-update.sh mainnet
```

Use `scripts/ickb-bot-systemd-update.sh mainnet` only after the same revision has been validated on testnet.

Exit code `2` is an intentional safety stop, including low capital and transaction confirmation timeout after broadcast. `RestartPreventExitStatus=2` keeps systemd from relaunching immediately. Before restarting, inspect `launches.ndjson` for the child exit record, the current event slot for the terminal bot event, the current stderr slot for runtime errors, referenced artifacts for full diagnostics, and journald for launcher lifecycle output:

```bash
LOG_DIR=/opt/ickb-stack-testnet/log/bot
EVENT_FILE=$(jq -r 'select(.type == "launcher.started") | .logFiles.events' "$LOG_DIR/launches.ndjson" | tail -n 1)
jq -c 'select(.type == "launcher.child.exited")' "$LOG_DIR/launches.ndjson"
jq -c 'select(.app == "bot" and (.terminal == true or .type == "bot.decision.skipped" or .type == "bot.transaction.failed" or .type == "bot.iteration.failed"))' "$EVENT_FILE"
sudo journalctl -u ickb-bot-testnet.service -n 200 --no-pager
```

The generated units set `LimitCORE=0`, so crash diagnosis should use bot logs, launcher exit records, stderr, journald, and the bundled systemd unit properties rather than expecting a core file.

### Incident Bundles

Use `scripts/bot/collect-incident.ts` before restarting after exit code `2` or any unexpected production behavior. The collector reads only bot production sources: event slot files, stderr slot files, legacy flat files when present, `launches.ndjson`, referenced bot artifacts, and version metadata. It keeps those sources separated and writes a restricted incident directory under the selected bot log directory:

```text
<log-root>/bot/incidents/<incident-id>/
  README.txt
  bot.events.slot-00.ndjson
  bot.stderr.slot-00.log
  artifacts/slot-00/ringSegments/sha256-<hash>.json
  launches.ndjson
  summary.json
  version.json
```

The log root resolves the same way as the launcher: explicit `--log-root`, then runtime `ICKB_BOT_LOG_ROOT`, then `<deploy-checkout>/log`. Production systemd units use `<deploy-checkout>/log`, so the default selected bot log directory is `<log-root>/bot`. `--log-dir <path>` may be used for copied logs or a custom contained bot log directory when the resolved path stays inside the resolved log root. The collector refuses empty paths, paths outside the resolved log root, symlinked log directories, symlinked incident parents, symlinked source log files, and symlinked artifact path components. Referenced artifacts must be under `artifacts/`, use `sha256-<hash>.json` filenames, and match the referenced hash before they are bundled; missing or mismatched artifact refs are reported in `summary.json`.

Examples from the deployed checkout:

```bash
sudo -u ickb-bot-testnet node --experimental-default-type=module scripts/bot/collect-incident.ts --since 2h --until now
sudo -u ickb-bot-mainnet node --experimental-default-type=module scripts/bot/collect-incident.ts --since 2026-05-25T10:00:00Z --until 2026-05-25T11:00:00Z
sudo -u ickb-bot-testnet node --experimental-default-type=module scripts/bot/collect-incident.ts --log-root log --since 30m --until now
```

The collector does not include runtime config files, environment dumps, systemd output, or raw unit text because they can contain private keys, credentialed RPC URLs, tokens, passwords, or API keys. Selected source logs are bundled as public producer-owned evidence; if a private key or other secret reaches those sources, fix the producer that wrote it before sharing or archiving the bundle.

Inspect `summary.json` first. It includes selected source files, malformed/undated/out-of-window line counts, first/last timestamps, event counts by type, transaction hashes by outcome, skip/failure reasons, launcher exit codes, artifact refs included/missing/mismatched, package version, git commit, Node version, and the collector script version. Bot stderr files are raw child stderr, so undated stack-trace lines after an in-window timestamped stderr line are kept with that timestamped line; when stderr has no timestamps at all, the collector includes the last 200 non-empty stderr lines and marks that in `summary.json`. For exit code `2`, review the `launcher.child.exited` record, terminal bot events (`bot.decision.skipped`, `bot.transaction.failed`, `bot.iteration.failed`, or records with `terminal:true`), stderr, and referenced artifacts before deciding whether the restart is safe.

The collector writes the incident directory directly and prints a portable compression command instead of assuming `tar`, `gzip`, or `zstd` are present. On a host with `tar` and gzip, run the printed command or equivalently:

```bash
tar -czf /opt/ickb-stack-testnet/log/bot/incidents/<incident-id>.tar.gz -C /opt/ickb-stack-testnet/log/bot/incidents <incident-id>
```

Retain incident bundles long enough to cover your operational review and postmortem window, then remove them with the same sensitivity as production logs. A practical default is to keep testnet bundles for 14 days and mainnet bundles for 30 days, matching the rotation examples below unless an active incident review requires longer retention.

### Retention

The launcher owns run-slot retention, so logrotate is not required for bot event and stderr files. It keeps 16 slots by default and can additionally prune inactive slot files and artifact directories when `ICKB_BOT_LOG_STORAGE_QUOTA_BYTES` is configured before systemd unit generation or `--log-storage-quota-bytes` is passed to the launcher. Quota pruning is best-effort: the current run's open files and artifact directory are preserved, and a long current run can grow beyond the configured quota until the next launcher run.

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
