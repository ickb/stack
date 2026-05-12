# iCKB Tester

The tester is now CCC-native. It waits while its own fresh matchable orders are still live, then cancels stale active orders and places randomized iCKB limit orders against the selected chain exchange ratio using the shared `@ickb/sdk`, `@ickb/core`, and `@ickb/order` packages.

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

From a plain checkout, follow the root [Local CCC Workflow](../../README.md#local-ccc-workflow) first so `forks/ccc/repo` is materialized. If you are working against patched local CCC packages, rerun `pnpm forks:ccc` or keep `pnpm forks:ccc --watch` running. The app build commands below then build the runtime workspace package closure they import.

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

The start script writes one newline-delimited JSON log stream per run. Each loop appends one JSON object to the log file. Balance, amount, and fee values are decimal strings so bigint values do not lose precision. Confirmation timeouts are logged with the broadcast hash and stop the loop with exit code `2` so a wrapper does not immediately send conflicting replacement work.

## Licensing

The license for this repository is the MIT License, see the [`LICENSE`](../../LICENSE).
