# iCKB Tester

The tester is now CCC-native. It waits while its own fresh matchable orders are still live, then cancels stale active orders and places randomized iCKB limit orders against the selected chain exchange ratio using the shared `@ickb/sdk`, `@ickb/core`, and `@ickb/order` packages.

## Runtime Config

The tester reads one strict JSON config file named by `TESTER_CONFIG_FILE`:

```json
{"chain":"testnet","privateKey":"0x...","rpcUrl":"http://127.0.0.1:8114/","sleepIntervalSeconds":10,"maxIterations":1}
```

The JSON config accepts exactly `chain`, `privateKey`, `rpcUrl`, `sleepIntervalSeconds`, and optional `maxIterations`. Unknown keys, wrong types, non-HTTP(S) RPC URLs, whitespace/control characters in `rpcUrl`, and non-canonical private keys are rejected. The private key must be exactly lowercase `0x` plus 64 lowercase hex characters, with no newline, spaces, tabs, or comments. Local config files under `config/` are ignored by git.

Current network support:

- `"chain":"testnet"`
- `"chain":"mainnet"`

## Run

From a plain checkout, follow the root [Local CCC Workflow](../../README.md#local-ccc-workflow) first so `forks/ccc/repo` is materialized. If you are working against patched local CCC packages, rerun `pnpm forks:ccc` or keep `pnpm forks:ccc --watch` running. The app build commands below then build the runtime workspace package closure they import.

```bash
pnpm install
pnpm --filter ./apps/tester build
mkdir -p config
$EDITOR config/tester-testnet.json
export TESTER_CONFIG_FILE="$(pwd)/config/tester-testnet.json"
pnpm --filter ./apps/tester start
```

Or from `apps/tester`:

```bash
pnpm install
pnpm build
mkdir -p ../../config
$EDITOR ../../config/tester-testnet.json
export TESTER_CONFIG_FILE="$(pwd)/../../config/tester-testnet.json"
pnpm run start
```

The start script writes one newline-delimited JSON log stream per run. Each loop appends one JSON object to the log file. Balance, amount, and fee values are decimal strings so bigint values do not lose precision. Confirmation timeouts are logged with the broadcast hash and stop the loop with exit code `2` so a wrapper does not immediately send conflicting replacement work.

## Licensing

The license for this repository is the MIT License, see the [`LICENSE`](../../LICENSE).
