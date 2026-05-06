# iCKB Tester

The tester is now CCC-native. It cancels the tester's own active orders, then places randomized iCKB limit orders against the live testnet exchange ratio using the shared `@ickb/sdk`, `@ickb/core`, and `@ickb/order` packages.

## Environment

Required variables:

```text
CHAIN=testnet
TESTER_PRIVATE_KEY=0x...
TESTER_SLEEP_INTERVAL=10
```

Optional variable:

```text
RPC_URL=http://127.0.0.1:8114/
```

Current network support:

- `CHAIN=testnet`
- `CHAIN=mainnet`

## Run

```bash
pnpm install
pnpm --filter ./apps/tester build
mkdir -p apps/tester/env/testnet
$EDITOR apps/tester/env/testnet/.env
export CHAIN=testnet
pnpm --filter ./apps/tester start
```

Or from `apps/tester`:

```bash
pnpm install
pnpm build
mkdir -p env/testnet
$EDITOR env/testnet/.env
export CHAIN=testnet
pnpm run start
```

`CHAIN` selects `env/${CHAIN}/.env`, which must contain the remaining runtime variables such as `TESTER_PRIVATE_KEY` and `TESTER_SLEEP_INTERVAL`.

The start script keeps the existing JSON log format and writes one log file per run.

## Licensing

The license for this repository is the MIT License, see the [`LICENSE`](../../LICENSE).
