# iCKB Tester

The tester is now CCC-native. It waits while its own fresh matchable orders are still live, then cancels stale active orders and places randomized iCKB limit orders against the selected chain exchange ratio using the shared `@ickb/sdk`, `@ickb/core`, and `@ickb/order` packages.

## Environment

Required shell variable:

```text
CHAIN=testnet
```

Required operator config variable in `env/${CHAIN}/tester.env`:

```text
TESTER_SLEEP_INTERVAL=10
```

Required secret source, exactly one of:

```text
TESTER_PRIVATE_KEY=0x...
TESTER_PRIVATE_KEY_FILE=/path/to/tester-private-key
```

Optional variable:

```text
RPC_URL=http://127.0.0.1:8114/
```

The file form is useful when tester traffic is run under systemd credentials; keep tester keys disposable and testnet-scoped unless there is a deliberate reason to run tester on another network. The private key must be exactly lowercase `0x` plus 64 lowercase hex characters. A private-key file must contain exactly that key and nothing else: no final newline, spaces, tabs, or comments.

Current network support:

- `CHAIN=testnet`
- `CHAIN=mainnet`

## Run

From a plain checkout, follow the root [Local CCC Workflow](../../README.md#local-ccc-workflow) first so `forks/ccc/repo` is materialized. If you are working against patched local CCC packages, rerun `pnpm forks:ccc` or keep `pnpm forks:ccc --watch` running. The app build commands below then build the runtime workspace package closure they import.

```bash
pnpm install
pnpm --filter ./apps/tester build
mkdir -p env/testnet
$EDITOR env/testnet/tester.env
export CHAIN=testnet
pnpm --filter ./apps/tester start
```

Or from `apps/tester`:

```bash
pnpm install
pnpm build
mkdir -p ../../env/testnet
$EDITOR ../../env/testnet/tester.env
export CHAIN=testnet
pnpm run start
```

`CHAIN` selects the repo-root operator config file `env/${CHAIN}/tester.env`, which must contain app runtime variables such as `TESTER_SLEEP_INTERVAL` and one private-key source. Do not commit files under `env/`; the root `.gitignore` excludes them.

The start script writes one newline-delimited JSON log stream per run. Each loop appends one JSON object to the log file. Balance, amount, and fee values are decimal strings so bigint values do not lose precision. Confirmation timeouts are logged with the broadcast hash and stop the loop with exit code `2` so a wrapper does not immediately send conflicting replacement work.

## Licensing

The license for this repository is the MIT License, see the [`LICENSE`](../../LICENSE).
