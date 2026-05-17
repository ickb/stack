# iCKB Bot

The bot is CCC-native. It reads market state from `@ickb/sdk`, matches profitable limit orders, collects the bot's own orders, completes receipts and ready withdrawals, optionally rebalances between CKB and iCKB, completes iCKB UDT balance, CKB capacity, and fees, then signs, sends, and waits for commit.

The bot minimizes excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

## Docs

- [Current Bot Rebalancing Policy](docs/current_rebalancing_policy.md)

## Environment

Required shell variable:

```text
CHAIN=testnet
```

Required operator config variable in `env/${CHAIN}/bot.env` or the service environment:

```text
BOT_SLEEP_INTERVAL=60
```

Required secret source, exactly one of:

```text
BOT_PRIVATE_KEY=0x...
BOT_PRIVATE_KEY_FILE=/path/to/bot-private-key
```

Optional variable:

```text
RPC_URL=http://127.0.0.1:8114/
MAX_ITERATIONS=1
```

`BOT_PRIVATE_KEY` is convenient for local testnet runs. `BOT_PRIVATE_KEY_FILE` is preferred for production services because systemd can expose an encrypted credential as a private runtime file without putting the key value in the process environment.

Current network support:

- `CHAIN=testnet`
- `CHAIN=mainnet`

## Run

From the repo root:

```bash
pnpm install
pnpm --filter ./apps/bot build
mkdir -p env/testnet
$EDITOR env/testnet/bot.env
export CHAIN=testnet
pnpm --filter ./apps/bot start:loop
```

Or from `apps/bot`:

```bash
pnpm install
pnpm build
mkdir -p ../../env/testnet
$EDITOR ../../env/testnet/bot.env
export CHAIN=testnet
pnpm run start:loop
```

`CHAIN` selects the repo-root operator config file `env/${CHAIN}/bot.env`, which must contain app runtime variables such as `BOT_SLEEP_INTERVAL` and one private-key source. Do not commit files under `env/`; the root `.gitignore` excludes them.

The start script writes NDJSON logs to stdout and tees one log file per run. Balance and fee amounts are logged as decimal strings so large on-chain values do not lose precision. Intentional shutdowns, including low capital and transaction confirmation timeouts after broadcast, exit with code `2`; `start:loop` stops on that code instead of restarting immediately. `start:loop` also stops on exit code `0`, so bounded runs do not relaunch after `MAX_ITERATIONS` is exhausted.

## Structured Events

Every bot observability record is one JSON object on stdout with `version`, `app: "bot"`, `chain`, `runId`, `iterationId`, ISO `timestamp`, and `type`. Legacy execution logs remain on stdout for compatibility, but structured bot records can be selected with `app == "bot"`.

Stable event types:

- `bot.run.started`
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

No-action iterations emit `bot.decision.skipped` with `reason` and evidence. Build-time skip reasons `no_actions` and `match_value_not_above_fee` include a `decision` transcript. The pre-build safety skip `capital_below_minimum` exits with code `2` and includes zero `actions` plus `state` evidence instead of a `decision` transcript because match, rebalance, fee, and transaction shape were not evaluated. Rebalance no-op decisions include policy-owned reasons such as `insufficient_output_slots`, `low_ickb_ckb_reserve_unavailable`, `target_ickb_not_exceeded`, and `no_ready_withdrawal_selection`.

The decision transcript groups evidence under `chainTip`, `balances`, `orders`, `withdrawals`, `poolDeposits`, `match`, `rebalance`, `actions`, `fee`, `transactionShape`, `exchangeRatio`, and `depositCapacity`. Transaction events summarize action counts, fee, fee rate, tx hash, confirmation status, check count, elapsed time, and transaction shape counts.

`MAX_ITERATIONS=1` makes `pnpm --filter ./apps/bot start` exit with code `0` after one terminal iteration when that terminal outcome is a skipped decision, committed transaction, non-safety transaction failure, or non-safety iteration failure. Safety stops still keep their nonzero behavior: low capital and confirmation timeouts after broadcast exit with code `2`. The default remains an infinite loop.

Structured events should contain public evidence and summaries needed to understand bot behavior. Do not add private keys, seed phrases, mnemonics, or other secrets to log payloads; omit noisy public fields at the call site instead of relying on redaction.

## Ubuntu systemd Deployment

For unattended Ubuntu 24.04 deployments, run testnet and mainnet as separate systemd services with separate users, deploy directories, and encrypted credentials. The production units should execute the built app directly with `node apps/bot/dist/index.js`; the package `start` script is for operator env-file runs and tees app-local log files.

This layout keeps the workflow simple while avoiding accidental cross-network updates:

```text
/opt/ickb-stack-testnet
/opt/ickb-stack-mainnet
/etc/ickb/credentials/bot-testnet-private-key.cred
/etc/ickb/credentials/bot-mainnet-private-key.cred
/etc/systemd/system/ickb-bot-testnet.service
/etc/systemd/system/ickb-bot-mainnet.service
```

From a deployed checkout on the VM, install service users, deploy directories, and unit files:

```bash
sudo scripts/ickb-bot-systemd-install.sh all
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

Create encrypted credentials on the VM. The tested Ubuntu 24.04 VM has `systemd-creds` and no TPM device, so host-key credentials are the compatible unattended option. If a future VM exposes a TPM, replace `--with-key=host` with the TPM-backed mode selected for that host.

```bash
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
Environment=CHAIN=testnet
Environment=BOT_SLEEP_INTERVAL=60
Environment=BOT_PRIVATE_KEY_FILE=%d/bot-private-key
LoadCredentialEncrypted=bot-private-key:/etc/ickb/credentials/bot-testnet-private-key.cred
ExecStart=/usr/bin/node apps/bot/dist/index.js
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=2
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
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
Environment=CHAIN=mainnet
Environment=BOT_SLEEP_INTERVAL=60
Environment=BOT_PRIVATE_KEY_FILE=%d/bot-private-key
LoadCredentialEncrypted=bot-private-key:/etc/ickb/credentials/bot-mainnet-private-key.cred
ExecStart=/usr/bin/node apps/bot/dist/index.js
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=2
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
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
sudo systemctl restart ickb-bot-testnet.service
sudo systemctl restart ickb-bot-mainnet.service
```

Update testnet first, then mainnet after the same revision is validated. The update script pulls, installs, and builds before restarting the service, so a failed build leaves the currently running bot alone.

```bash
sudo scripts/ickb-bot-systemd-update.sh testnet
sudo scripts/ickb-bot-systemd-update.sh mainnet
```

Use `scripts/ickb-bot-systemd-update.sh mainnet` only after the same revision has been validated on testnet.

Exit code `2` is an intentional safety stop, including low capital and transaction confirmation timeout after broadcast. Inspect the journal before restarting a service that stopped with code `2`.

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
