# iCKB Bot

The bot is CCC-native. It reads market state from `@ickb/sdk`, matches profitable limit orders, collects the bot's own orders, completes receipts and ready withdrawals, optionally rebalances between CKB and iCKB, completes iCKB UDT balance, CKB capacity, and fees, then signs, sends, and waits for commit.

The bot minimizes excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

## Docs

- [Current Bot Rebalancing Policy](docs/current_rebalancing_policy.md)

## Environment

Required variables:

```text
CHAIN=testnet
BOT_PRIVATE_KEY=0x...
BOT_SLEEP_INTERVAL=60
```

Optional variable:

```text
RPC_URL=http://127.0.0.1:8114/
MAX_ITERATIONS=1
```

Current network support:

- `CHAIN=testnet`
- `CHAIN=mainnet`

## Run

From the repo root:

```bash
pnpm install
pnpm --filter ./apps/bot build
mkdir -p apps/bot/env/testnet
$EDITOR apps/bot/env/testnet/.env
export CHAIN=testnet
pnpm --filter ./apps/bot start:loop
```

Or from `apps/bot`:

```bash
pnpm install
pnpm build
mkdir -p env/testnet
$EDITOR env/testnet/.env
export CHAIN=testnet
pnpm run start:loop
```

`CHAIN` selects `env/${CHAIN}/.env`, which must contain the remaining runtime variables such as `BOT_PRIVATE_KEY` and `BOT_SLEEP_INTERVAL`.

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

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
