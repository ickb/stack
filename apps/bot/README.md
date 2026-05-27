# iCKB Bot

The bot is CCC-native. It reads market state from `@ickb/sdk`, matches profitable limit orders, collects the bot's own orders, completes receipts and ready withdrawals, optionally rebalances between CKB and iCKB, completes iCKB UDT balance, CKB capacity, and fees, then signs, sends, and waits for commit.

The bot minimizes excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

## Docs

- [Current Bot Rebalancing Policy](docs/current_rebalancing_policy.md)

## Runtime Config

The bot reads one strict JSON config file named by `BOT_CONFIG_FILE`:

```json
{"chain":"testnet","privateKey":"0x...","rpcUrl":"http://127.0.0.1:8114/","sleepIntervalSeconds":60,"maxIterations":1,"maxRetryableAttempts":10}
```

The JSON config accepts exactly `chain`, `privateKey`, optional `rpcUrl`, `sleepIntervalSeconds`, optional `maxIterations`, and optional `maxRetryableAttempts`. Omit `rpcUrl` to let CCC use its default public endpoint for the selected chain. Unknown keys, wrong types, empty/non-HTTP(S) RPC URLs, whitespace/control characters in `rpcUrl`, and non-canonical private keys are rejected. The private key must be exactly lowercase `0x` plus 64 lowercase hex characters, with no newline, spaces, tabs, or comments. Local config files under `config/` are ignored by git.

For local testnet live supervision, keep funded identities in external environment variables and rebuild disposable ignored configs when needed:

```bash
export ICKB_TESTNET_BOT_PRIVATE_KEY='0x...'
export ICKB_TESTNET_TESTER_PRIVATE_KEY='0x...'
# Optional: export ICKB_TESTNET_RPC_URL='https://...'
# Optional: export ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS=10
pnpm live:config-from-env -- --force
```

Current network support:

- `"chain":"testnet"`
- `"chain":"mainnet"`

## Run

From the repo root:

```bash
pnpm install
pnpm --filter ./apps/bot build
mkdir -p config
$EDITOR config/bot-testnet.json
export BOT_CONFIG_FILE="$(pwd)/config/bot-testnet.json"
pnpm --filter ./apps/bot start:loop
```

Or from `apps/bot`:

```bash
pnpm install
pnpm build
mkdir -p ../../config
$EDITOR ../../config/bot-testnet.json
export BOT_CONFIG_FILE="$(pwd)/../../config/bot-testnet.json"
pnpm run start:loop
```

The start script writes NDJSON logs to stdout and tees one log file per run. Balance and fee amounts are logged as decimal strings so large on-chain values do not lose precision. Intentional shutdowns, including low capital and transaction confirmation timeouts after broadcast, exit with code `2`; `start:loop` stops on that code instead of restarting immediately. `start:loop` also stops on exit code `0`, so bounded runs do not relaunch after JSON `maxIterations` is exhausted.

## Structured Events

Every bot observability record is one JSON object on stdout with `version`, `app: "bot"`, `chain`, `runId`, `iterationId`, ISO `timestamp`, and `type`. Execution-log records also remain on stdout, and structured bot records can be selected with `app == "bot"`.

The stable event contract is the bot NDJSON object stream, not a particular file path. Production launchers may route stdout to journald, files, or another operator-owned log root; consumers should depend on records with `app: "bot"` and `bot.*` event types, not supervisor/tester output, launcher metadata, rotation layout, incident bundles, `/var/log`, or validation log directories.

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

`bot.chain.preflight` emits public chain identity evidence before signing starts: whether a custom RPC URL was configured, expected chain identity, observed genesis hash/address prefix/tip, and match booleans. It does not print the RPC URL because configured URLs may contain credentials. No-action iterations emit `bot.decision.skipped` with `reason` and evidence. Build-time skip reasons `no_actions`, `match_value_not_above_fee`, and `post_tx_ckb_reserve` include a `decision` transcript. Reserve skips report zero committed `actions` and keep attempted action counts under `decision.skip.attemptedActions` because the transaction was not broadcast. The pre-build safety skip `capital_below_minimum` exits with code `2` and includes zero `actions`, `deficit`, and `state` evidence instead of a `decision` transcript because match, rebalance, fee, and transaction shape were not evaluated. `bot.iteration.failed` includes an `error` summary plus `retryable` and `terminal` booleans from the bot retry policy. Rebalance decisions include normalized `reason`; no-op reasons remain policy-owned strings such as `insufficient_output_slots`, `low_ickb_ckb_reserve_unavailable`, `target_ickb_not_exceeded`, and `no_ready_withdrawal_selection`.

The decision transcript groups evidence under `chainTip`, `balances`, `orders`, `withdrawals`, `poolDeposits`, `match`, `rebalance`, `actions`, `fee`, `transactionShape`, `exchangeRatio`, and `depositCapacity`. `balances` includes available, unavailable, total, equivalent, minimum-capital, and spendable CKB evidence. `match.reason` normalizes the matching outcome, while `match.diagnostics` carries public allowance, mining fee, direction counts, candidate counts, positive-gain counts, and rejection counts. `rebalance` carries kind, reason, projected balances, output slots, pool/deposit/withdrawal counts, and policy diagnostics. `fee.feeRate` is included on state and decision events.

Transaction events summarize action counts, fee, fee rate, tx hash, phase, outcome, confirmation status, check count, elapsed time, retryable/terminal policy, and transaction shape counts. Error summaries preserve non-secret enumerable error fields. This keeps CKB/CCC send rejection evidence such as `code`, `data`, `outPoint`, `currentFee`, and `leastFee` visible in `bot.transaction.failed` and `bot.iteration.failed`. Non-secret debugging data may be logged when useful, including raw transactions, witnesses, public config fields, noncredentialed RPC identity evidence, scripts, cells, hashes, counts, and summaries.

Observed testnet full-node send rejection signatures for generic stale-state races are: in-pool same-input conflict can return `code:-1111` with `data:"RBFRejected(...)"` and CCC fields `currentFee`/`leastFee`; a post-commit spent input returns `code:-301` with `data:"Resolve(Unknown(OutPoint(...)))"` and CCC field `outPoint`; resending the same tx returns `code:-1107` with `data:"Duplicated(Byte32(...))"` and CCC field `txHash`. CKB source also has a `Resolve(Dead(OutPoint(...)))` path for some pool conflicts. Treat these as retry candidates only when the bot discards the transaction and rebuilds from fresh state, not by blindly resending the same transaction.

JSON `"maxIterations":1` makes `pnpm --filter ./apps/bot start` exit with code `0` after one terminal iteration when that terminal outcome is a skipped decision, committed transaction, non-safety transaction failure, or non-safety iteration failure. Retryable iteration failures do not count toward `maxIterations`; set `maxRetryableAttempts` to stop repeated fresh-state retries with exit code `2` after that many consecutive retryable failures. Safety stops still keep their nonzero behavior: low capital and confirmation timeouts after broadcast exit with code `2`. Omitting `maxIterations` keeps the default infinite loop; omitting `maxRetryableAttempts` leaves retryable attempts unbounded.

Structured events should contain evidence needed to understand bot behavior. The bot must not print its configured private key to events, execution logs, errors, stdout, or stderr. Private keys are for signing only: logger, event, and error helpers must not receive private keys, secret contexts, masking callbacks, redaction parameters, or guard inputs. Tests use a configured canary private key from outside the production path and verify produced output cannot reveal it, even unlabeled or nested in arbitrary text. Secrets, credentialed RPC URLs, tokens, passwords, API keys, and secret-bearing config/env dumps must not be logged or passed to logging, redaction, masking, or guard helpers.

Bot-only log queries, using the production event file or any saved bot stdout NDJSON stream:

```bash
LOG_DIR=/opt/ickb-stack-testnet/log/bot/testnet
jq -c 'select(.app == "bot")' "$LOG_DIR/bot.events.ndjson"
jq -r 'select(.app == "bot") | .type' "$LOG_DIR/bot.events.ndjson" | sort | uniq -c
jq -c 'select(.app == "bot" and .type == "bot.chain.preflight") | {timestamp, chain, rpcConfigured, expected, observed, matches}' "$LOG_DIR/bot.events.ndjson"
jq -c 'select(.app == "bot" and .type == "bot.decision.skipped") | {timestamp, chain, runId, iterationId, reason, actions, deficit, state, skip: .decision.skip}' "$LOG_DIR/bot.events.ndjson"
jq -c 'select(.app == "bot" and .type == "bot.match.evaluated") | {timestamp, iterationId, reason: .match.reason, orders, diagnostics: .match.diagnostics}' "$LOG_DIR/bot.events.ndjson"
jq -c 'select(.app == "bot" and .type == "bot.rebalance.evaluated") | {timestamp, iterationId, rebalance, poolDeposits}' "$LOG_DIR/bot.events.ndjson"
jq -c 'select(.app == "bot" and (.type == "bot.transaction.failed" or .type == "bot.iteration.failed")) | {timestamp, chain, runId, iterationId, type, phase, outcome, retryable, terminal, retryableAttempts, maxRetryableAttempts, retryBudgetExhausted, txHash, status, checks, elapsedMs, error}' "$LOG_DIR/bot.events.ndjson"
jq -c 'select(.type == "launcher.child.exited") | {timestamp, status, signal, elapsedMs, logRoot, logDir, command}' "$LOG_DIR/launches.ndjson"
```

## Ubuntu systemd Deployment

For unattended Ubuntu 24.04 deployments, run testnet and mainnet as separate systemd services with separate users, deploy directories, encrypted JSON config credentials, and bot-only file logs. The production units execute the built app through `scripts/ickb-bot-launcher.mjs`, which owns only process and file plumbing: it starts `/usr/bin/node apps/bot/dist/index.js`, writes bot stdout byte-for-byte to `bot.events.ndjson`, writes child stderr byte-for-byte to `bot.stderr.log`, writes launch metadata to `launches.ndjson`, and tees stdout/stderr to journald as a fallback. Launcher metadata records the executable basename and argument count, but not raw child argument values or environment. The package `start` script is for local JSON-config runs and tees app-local log files.

The launcher resolves the log root in this order: explicit `--log-root`, runtime `ICKB_BOT_LOG_ROOT`, then `<deploy-checkout>/log`. The systemd install script bakes an explicit `--log-root` into generated units only when `ICKB_BOT_LOG_ROOT` is set during install; relative values are resolved against that network's deploy directory. Without an explicit configured root, testnet defaults to `/opt/ickb-stack-testnet/log` and mainnet defaults to `/opt/ickb-stack-mainnet/log`.

The launcher refuses empty paths, log directories outside the resolved log root, symlinked log roots or parent directories, and symlinked log files. It creates `bot.events.ndjson`, `bot.stderr.log`, and `launches.ndjson` with mode `0600` for service-user writes.

Production log layout:

```text
<log-root>/bot/testnet/bot.events.ndjson
<log-root>/bot/testnet/bot.stderr.log
<log-root>/bot/testnet/launches.ndjson
<log-root>/bot/mainnet/bot.events.ndjson
<log-root>/bot/mainnet/bot.stderr.log
<log-root>/bot/mainnet/launches.ndjson
```

These are production bot-only logs. They are separate from local live validation supervisor artifacts such as `logs/live-supervisor/...`.

This layout keeps the workflow simple while avoiding accidental cross-network updates:

```text
/opt/ickb-stack-testnet
/opt/ickb-stack-mainnet
/opt/ickb-stack-testnet/log/bot/testnet/
/opt/ickb-stack-mainnet/log/bot/mainnet/
/etc/ickb/credentials/ickb-bot-testnet-config.cred
/etc/ickb/credentials/ickb-bot-mainnet-config.cred
/etc/systemd/system/ickb-bot-testnet.service
/etc/systemd/system/ickb-bot-mainnet.service
```

From a deployed checkout on the VM, install service users, deploy directories, and unit files:

```bash
sudo scripts/ickb-bot-systemd-install.sh all
```

To use one explicit log root for both networks, set it while installing or regenerating the units:

```bash
sudo ICKB_BOT_LOG_ROOT=/path/to/ickb-log-root scripts/ickb-bot-systemd-install.sh all
```

Populate and build each deploy directory before starting services. Clone or copy the same repo revision into both directories, then build as the matching service user:

```bash
sudo -u ickb-bot-testnet git clone <repo-url> /opt/ickb-stack-testnet
sudo -u ickb-bot-mainnet git clone <repo-url> /opt/ickb-stack-mainnet
sudo -u ickb-bot-testnet pnpm -C /opt/ickb-stack-testnet bot:install
sudo -u ickb-bot-mainnet pnpm -C /opt/ickb-stack-mainnet bot:install
sudo -u ickb-bot-testnet pnpm -C /opt/ickb-stack-testnet bot:ccc
sudo -u ickb-bot-mainnet pnpm -C /opt/ickb-stack-mainnet bot:ccc
sudo -u ickb-bot-testnet pnpm -C /opt/ickb-stack-testnet bot:build
sudo -u ickb-bot-mainnet pnpm -C /opt/ickb-stack-mainnet bot:build
```

If `/opt/ickb-stack-testnet` or `/opt/ickb-stack-mainnet` already exists from the install script, clone into a temporary path and move the checkout into place, or initialize the existing directory with your normal deployment tooling. The update script expects each deploy directory to be a clean git checkout.

Create encrypted config credentials on the VM. The tested Ubuntu 24.04 VM has `systemd-creds` and no TPM device, so host-key credentials are the compatible unattended option. If a future VM exposes a TPM, replace `--with-key=host` with the TPM-backed mode selected for that host. The helper prompts for the private key, optional RPC URL, sleep interval, optional max iterations, and max retryable attempts, validates the same strict JSON schema that the app reads, and encrypts that JSON as one systemd credential.

```bash
sudo systemd-creds setup
sudo scripts/ickb-bot-systemd-credential.sh testnet
sudo scripts/ickb-bot-systemd-credential.sh mainnet
```

The install script writes `/etc/systemd/system/ickb-bot-testnet.service` equivalent to:

```ini
[Unit]
Description=iCKB bot testnet
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ickb-bot-testnet
Group=ickb-bot-testnet
WorkingDirectory=/opt/ickb-stack-testnet
Environment=BOT_CONFIG_FILE=%d/ickb-bot-testnet-config.json
LoadCredentialEncrypted=ickb-bot-testnet-config.json:/etc/ickb/credentials/ickb-bot-testnet-config.cred
ExecStart=/usr/bin/node scripts/ickb-bot-launcher.mjs --network testnet -- /usr/bin/node apps/bot/dist/index.js
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=2
LimitCORE=0
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
ReadWritePaths=/opt/ickb-stack-testnet/log
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

It writes `/etc/systemd/system/ickb-bot-mainnet.service` equivalent to:

```ini
[Unit]
Description=iCKB bot mainnet
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ickb-bot-mainnet
Group=ickb-bot-mainnet
WorkingDirectory=/opt/ickb-stack-mainnet
Environment=BOT_CONFIG_FILE=%d/ickb-bot-mainnet-config.json
LoadCredentialEncrypted=ickb-bot-mainnet-config.json:/etc/ickb/credentials/ickb-bot-mainnet-config.cred
ExecStart=/usr/bin/node scripts/ickb-bot-launcher.mjs --network mainnet -- /usr/bin/node apps/bot/dist/index.js
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=2
LimitCORE=0
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
ReadWritePaths=/opt/ickb-stack-mainnet/log
ProtectHome=true

[Install]
WantedBy=multi-user.target
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
sudo tail -f /opt/ickb-stack-testnet/log/bot/testnet/bot.events.ndjson
sudo tail -f /opt/ickb-stack-mainnet/log/bot/mainnet/bot.events.ndjson
jq -c 'select(.type == "launcher.child.exited")' /opt/ickb-stack-testnet/log/bot/testnet/launches.ndjson
sudo systemctl restart ickb-bot-testnet.service
sudo systemctl restart ickb-bot-mainnet.service
```

Update testnet first, then mainnet after the same revision is validated. Regenerate the units with `scripts/ickb-bot-systemd-install.sh` before updating when the documented unit shape changes. The update script refuses stale units that are missing the production launcher wiring or `LimitCORE=0`, then pulls, installs, and builds before restarting the service, so a failed build leaves the currently running bot alone.

```bash
sudo scripts/ickb-bot-systemd-update.sh testnet
sudo scripts/ickb-bot-systemd-update.sh mainnet
```

Use `scripts/ickb-bot-systemd-update.sh mainnet` only after the same revision has been validated on testnet.

Exit code `2` is an intentional safety stop, including low capital and transaction confirmation timeout after broadcast. `RestartPreventExitStatus=2` keeps systemd from relaunching immediately. Before restarting, inspect `launches.ndjson` for the child exit record, `bot.events.ndjson` for the terminal bot event, `bot.stderr.log` for runtime errors, and journald for launcher fallback output:

```bash
LOG_DIR=/opt/ickb-stack-testnet/log/bot/testnet
jq -c 'select(.type == "launcher.child.exited")' "$LOG_DIR/launches.ndjson"
jq -c 'select(.app == "bot" and (.terminal == true or .type == "bot.decision.skipped" or .type == "bot.transaction.failed" or .type == "bot.iteration.failed"))' "$LOG_DIR/bot.events.ndjson"
sudo journalctl -u ickb-bot-testnet.service -n 200 --no-pager
```

The generated units set `LimitCORE=0`, so crash diagnosis should use bot logs, launcher exit records, stderr, journald, and the bundled unit text rather than expecting a core file.

### Incident Bundles

Use `scripts/ickb-bot-collect-incident.mjs` before restarting after exit code `2` or any unexpected production behavior. The collector reads only bot production sources: `bot.events.ndjson`, `bot.stderr.log`, `launches.ndjson`, version metadata, and optional systemd status/journal/unit text. It keeps those sources separated and writes a restricted incident directory under the selected bot log directory:

```text
<log-root>/bot/<network>/incidents/<incident-id>/
  README.txt
  bot.events.ndjson
  bot.stderr.log
  launches.ndjson
  summary.json
  version.json
  systemd.status.txt      # when systemd output is available
  systemd.journal.txt     # when systemd output is available
  systemd.unit.txt        # when systemd output is available
```

The log root resolves the same way as the launcher: explicit `--log-root`, then runtime `ICKB_BOT_LOG_ROOT`, then `<deploy-checkout>/log`. `--network testnet|mainnet` selects `<log-root>/bot/<network>/`. `--log-dir <path>` may be used instead of `--network` only when the resolved path stays inside the resolved log root, which is useful for copied logs or a custom contained bot log directory. The collector refuses empty paths, paths outside the resolved log root, symlinked log directories, symlinked incident parents, and symlinked source log files.

Examples from the deployed checkout:

```bash
sudo -u ickb-bot-testnet node scripts/ickb-bot-collect-incident.mjs --network testnet --since 2h --until now
sudo -u ickb-bot-mainnet node scripts/ickb-bot-collect-incident.mjs --network mainnet --since 2026-05-25T10:00:00Z --until 2026-05-25T11:00:00Z
sudo -u ickb-bot-testnet node scripts/ickb-bot-collect-incident.mjs --log-root /path/to/ickb-log-root --network testnet --since 30m --until now
sudo -u ickb-bot-testnet ICKB_BOT_LOG_ROOT=/path/to/ickb-log-root node scripts/ickb-bot-collect-incident.mjs --log-dir /path/to/ickb-log-root/bot/testnet --since 30m --until now
```

If you do not want systemd status, journal, or unit text in the bundle, add `--no-systemd`. The collector does not include runtime config files or environment dumps because they can contain private keys, credentialed RPC URLs, tokens, passwords, or API keys. Selected source logs and systemd output are bundled as public producer-owned evidence; if a private key or other secret reaches those sources, fix the producer that wrote it before sharing or archiving the bundle.

Inspect `summary.json` first. It includes selected source files, malformed/undated/out-of-window line counts, first/last timestamps, event counts by type, transaction hashes by outcome, skip/failure reasons, launcher exit codes, systemd capture results, package version, git commit, Node version, and the collector script version. `bot.stderr.log` is raw child stderr, so undated stack-trace lines after an in-window timestamped stderr line are kept with that timestamped line; when stderr has no timestamps at all, the collector includes the last 200 non-empty stderr lines and marks that in `summary.json`. For exit code `2`, review the `launcher.child.exited` record, terminal bot events (`bot.decision.skipped`, `bot.transaction.failed`, `bot.iteration.failed`, or records with `terminal:true`), stderr, and journald before deciding whether the restart is safe.

The collector writes the incident directory directly and prints a portable compression command instead of assuming `tar`, `gzip`, or `zstd` are present. On a host with `tar` and gzip, run the printed command or equivalently:

```bash
tar -czf /opt/ickb-stack-testnet/log/bot/testnet/incidents/<incident-id>.tar.gz -C /opt/ickb-stack-testnet/log/bot/testnet/incidents <incident-id>
```

Retain incident bundles long enough to cover your operational review and postmortem window, then remove them with the same sensitivity as production logs. A practical default is to keep testnet bundles for 14 days and mainnet bundles for 30 days, matching the rotation examples below unless an active incident review requires longer retention.

### Log Rotation

The launcher keeps the three log files open for the lifetime of the service and does not implement a reopen signal. Use `copytruncate` if you want rotation without restarting the bot. This can lose a small write window during copy/truncate, but it preserves continuous systemd supervision. If you require exact handoff instead, restart the service after rotation and treat the restart as an operational event.

Default-root logrotate example for testnet:

```text
/opt/ickb-stack-testnet/log/bot/testnet/bot.events.ndjson
/opt/ickb-stack-testnet/log/bot/testnet/bot.stderr.log
/opt/ickb-stack-testnet/log/bot/testnet/launches.ndjson {
  daily
  rotate 14
  missingok
  notifempty
  compress
  copytruncate
  su ickb-bot-testnet ickb-bot-testnet
}
```

Default-root logrotate example for mainnet:

```text
/opt/ickb-stack-mainnet/log/bot/mainnet/bot.events.ndjson
/opt/ickb-stack-mainnet/log/bot/mainnet/bot.stderr.log
/opt/ickb-stack-mainnet/log/bot/mainnet/launches.ndjson {
  daily
  rotate 30
  missingok
  notifempty
  compress
  copytruncate
  su ickb-bot-mainnet ickb-bot-mainnet
}
```

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
