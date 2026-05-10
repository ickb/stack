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

The start script writes JSON logs and one log file per run. Intentional shutdowns, including low capital and transaction confirmation timeouts after broadcast, exit with code `2`; `start:loop` stops on that code instead of restarting immediately.

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content and owns final iCKB completion, fee completion, signing, sending, and commit waiting.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/blob/master/LICENSE).
