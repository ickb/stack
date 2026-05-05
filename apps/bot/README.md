# iCKB Bot

The bot is now CCC-native. It reads market state from `@ickb/sdk`, melts the bot's own orders, completes matured receipts and withdrawals, matches profitable limit orders, optionally rebalances between CKB and iCKB, then completes iCKB UDT balance, CKB capacity, fees, signs, and sends.

The bot still aims to minimize excess iCKB holdings so more liquidity stays available in CKB during iCKB-to-CKB redemption pressure.

## Docs

- [iCKB Deposit Pool Rebalancing Algorithm](pool_rebalancing.md)
- [iCKB Deposit Pool Snapshot Encoding](pool_snapshot.md)

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

The start script keeps the existing JSON log format and writes one log file per run.

## Notes

- Distribute liquidity across multiple isolated bots to limit blast radius.
- Keep at least roughly 130k CKB worth of capital available for the bot to operate comfortably.
- The bot relies on shared CCC packages for protocol-specific transaction content, but it still owns final iCKB completion, fee completion, signing, and send.

## Licensing

Released under the [MIT License](../../LICENSE).
