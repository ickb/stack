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

## Test Scenarios

`TESTER_SCENARIO` selects the order-building path for live supervision. Omit it, or set `auto`, to choose randomly from the supported scenarios on each tester process start:

- `random-order`: current randomized raw limit-order behavior.
- `sdk-conversion`: uses the SDK conversion transaction builder, then completes and sends the transaction. Its log `actions.conversion.kind` reports whether the SDK built a direct conversion, an order, or both.
- `extra-large-limit-order`: creates a raw CKB-to-iCKB limit order larger than one deposit-cap unit. It fails instead of silently downsizing if the account cannot preserve the tester CKB reserve.
- `multi-order-limit-orders`: creates any supported two-order raw limit-order transaction based on available balances. It prefers mixed direction when both sides can fund two orders, then CKB-to-iCKB, then iCKB-to-CKB. Its log records `actions.requestedTesterScenario` as `multi-order-limit-orders` and `actions.testerScenario` as the concrete multi-order type.
- `two-ckb-to-ickb-limit-orders`: creates two raw CKB-to-iCKB limit orders in one transaction. Its log uses `actions.newOrders` and `actions.orderCount` instead of singular `actions.newOrder`.
- `all-ckb-limit-order`: creates one raw CKB-to-iCKB limit order with all currently available CKB except the tester reserve.
- `ickb-to-ckb-limit-order`: creates one raw iCKB-to-CKB limit order with all currently available iCKB. Use this for iCKB withdrawal-through-LO coverage.
- `two-ickb-to-ckb-limit-orders`: creates two raw iCKB-to-CKB limit orders in one transaction. Its log uses `actions.newOrders` and `actions.orderCount`.
- `mixed-direction-limit-orders`: creates one raw CKB-to-iCKB order and one raw iCKB-to-CKB order in one transaction. Its log uses `actions.newOrders` and `actions.orderCount`.
- `all-ickb-limit-order`: compatibility alias for `ickb-to-ckb-limit-order`.
- `dust-ckb-conversion`: tries a one-shannon CKB-to-iCKB conversion with the normal tester order fee.
- `dust-ickb-conversion`: tries a one-shannon iCKB-to-CKB conversion with the normal tester order fee.

These are tester-owned scenario controls. The supervisor may set `TESTER_SCENARIO`, but it must not mutate funded config files in place or force tx-bearing paths outside the tester runtime.

Raw limit-order scenarios use `TESTER_FEE=1` and `TESTER_FEE_BASE=100000` by default, matching the normal 0.001% order fee. Set `TESTER_FEE` and `TESTER_FEE_BASE` to unsigned integers to exercise alternate raw order fees; `TESTER_FEE` must be less than `TESTER_FEE_BASE`, and `TESTER_FEE_BASE` is capped at `1000000`. The selected numerator/base are recorded on `actions.newOrder.feeNumerator` and `actions.newOrder.feeBase`, or on each `actions.newOrders[]` entry for multi-order scenarios. `sdk-conversion` keeps using SDK-owned fee defaults for any order remainder.

## Licensing

The license for this repository is the MIT License, see the [`LICENSE`](../../LICENSE).
