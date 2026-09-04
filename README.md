# iCKB Stack

iCKB Stack is the monorepo for the current TypeScript iCKB libraries and apps built on top of [CCC](https://github.com/ckb-devrel/ccc).

The Stack rewrite is in progress. The [rewrite overview](docs/stack-rewrite/README.md) explains the target architecture, completed foundations, remaining phases, and open design findings. The rest of this README describes the current repository.

## Transaction Completion Boundary

`@ickb/sdk` builders still return partial `ccc.Transaction` values. Callers explicitly choose when to finalize, and the shared completion path now also lives in `@ickb/sdk`.

Callers own the final completion pipeline:

1. Build the partial transaction through `IckbSdk` and the package managers.
2. Before send, call `sdk.completeTransaction(...)` from `@ickb/sdk`.
3. Only then send the transaction.

Withdrawal requests built from public pool ready deposits may include `requiredLiveDeposits`. `@ickb/sdk` adds those cells as live `cell_dep` checks so a transaction fails if a protected pool anchor disappears before inclusion.

## Scan Page Size Boundary

Stack cell scans that feed account state, pool state, order books, or maturity estimates use a per-request page size. SDK state APIs expose it as `cellPageSize`; lower-level scan wrappers expose it as `pageSize` and pass it to CCC as `limit`.

## User Lock Assumption

Current stack flows assume user-owned cells are protected by locks whose signatures bind the whole transaction, such as standard `sighash` wallet flows. Passing a raw `ccc.Script` is only safe when that lock gives the same output and recipient binding. Delegated-signature or OTX-style locks are integration-specific and must account for the weak-lock boundary documented in the iCKB whitepaper and contracts audit.

## Workspace Map

Apps:

- `apps/bot`: Node CLI adapter for the private bot runtime.
- `apps/interface`: Browser interface for CCC wallet connection, conversion previews, transaction completion, signing, sending, and confirmation.
- `apps/sampler`: Mainnet sampling utility that writes historical CKB-per-iCKB CSV output.
- `apps/validation`: Node CLI adapters for deterministic live testnet validation flows, the bounded supervisor and the tester.

Apps are private workspace runtimes and run from source under Node 22.19+ or Vite. The supported reusable API surface lives in the packages below. Stack package `build` scripts emit `dist/` for publishing reusable packages only; local development, tests, live supervisor runs, and bot deployments use TypeScript source directly.

Packages:

- `packages/core`: iCKB protocol primitives, cells, UDT conversion helpers, and low-level transaction builders.
- `packages/bot`: Private order-fulfillment and rebalance bot core for matching profitable orders, collecting owned orders, completing receipts and withdrawals, and rebalancing pool exposure.
- `packages/dao`: Nervos DAO cell classification, readiness, deposit, request, and withdrawal helpers.
- `packages/node-utils`: Private Node app utilities for env parsing, RPC client setup, signer locks, sleeps, and JSON logs.
- `packages/order`: UDT limit-order entities, grouping, matching, minting, melting, and deployed-script confusion mitigation.
- `packages/sdk`: Stack-level SDK that composes core, DAO, and order packages into account state, conversion planning, completion, sending, and confirmation helpers.
- `packages/testkit`: Private test helpers and fixtures for workspace tests.
- `packages/utils`: Shared low-level utilities such as complete-scan enforcement, binary search, collection helpers, and bounded subset selection.
- `packages/validation`: Private live validation core for tester and supervisor flows.

## Dependencies

CCC packages are normal package dependencies resolved through `pnpm-workspace.yaml` catalog entries and `pnpm-lock.yaml`. From a plain checkout, run `pnpm install`; no local CCC fork, build step, or workspace alias is required.

`pnpm check` is the validation gate. It always runs with `CI=true`.

## Live Testnet Bot Watch

Run the bot as a long-lived process with an unbounded config. Its stdout is the NDJSON event stream: hand it to journald through a systemd unit, or redirect it to a file:

```bash
pnpm live:config-from-env -- --force
mkdir -p log/bot
BOT_CONFIG_FILE=config/bot-live-testnet.json node apps/bot/src/index.ts > log/bot/events.ndjson
```

The watch is operator-driven. Between checks, read the event stream, place a tester order with `pnpm live:supervisor --scenario tester-only` when the bot should be exercised, and look for the correlated `bot.transaction.committed` followed by a `bot.decision.skipped` with no market orders. There is no launcher, launch record, or automated cadence.

Generated live configs default to `sleepIntervalSeconds: 60`; override with `ICKB_TESTNET_SLEEP_INTERVAL_SECONDS` only when the operator deliberately wants a different cadence. Bounded supervisor/tester configs default to `maxRetryableAttempts: 10`; the unbounded live config omits `maxRetryableAttempts` unless `ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS` is set intentionally.

## Live Testnet Supervisor

Provide ignored bounded configs, then run the supervisor from the repo root:

```bash
pnpm live:supervisor
```

By default the supervisor uses ignored `config/bot-testnet.json` and `config/tester-testnet.json`, writes standalone artifacts under ignored `log/live-supervisor/<run-id>/` paths, and runs deterministic bounded bot/tester commands only.

Rebuild disposable live configs from required `ICKB_TESTNET_BOT_PRIVATE_KEY`, `ICKB_TESTNET_TESTER_PRIVATE_KEY`, and `ICKB_TESTNET_RPC_URL` values with `pnpm live:config-from-env -- --force` when they are missing or stale. The RPC URL is exclusive (no CCC public fallbacks), and omission or an empty value fails. The helper writes bounded `config/bot-testnet.json` and `config/tester-testnet.json` for supervisor/tester runs, plus unbounded `config/bot-live-testnet.json` for the long-running bot. When `ICKB_TESTNET_SLEEP_INTERVAL_SECONDS` is unset, all generated configs use `sleepIntervalSeconds: 60`. When `ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS` is unset, bounded configs use `10` and the live config remains unbounded. The supervisor does not patch, verify, rebuild, relaunch, or invoke an LLM; external loops and operators consume `summary.json` between runs.

`pnpm live:preflight -- --config config/bot-testnet.json` prints public balance evidence for funding checks. Use `key.recommendedAddress` as the funding address, then rerun preflight and check `balances.CKB.available`, `balances.CKB.reserve`, `balances.CKB.spendable`, `balances.CKB.projectedAvailable`, `balances.CKB.unavailable`, `balances.CKB.total`, `balances.ICKB.available`, `balances.ICKB.unavailable`, `balances.ICKB.total`, and `capital.minimumCkbCapital`. `CKB.available` and `CKB.spendable` are actual plain-cell values, `CKB.projectedAvailable` includes account sources the SDK can collect in the same transaction, `unavailable` is known locked or pending account value, and `total` is `projectedAvailable + unavailable`. For machine-readable JSON without package-manager output, run `pnpm -s live:preflight -- --config config/bot-testnet.json`.

Repeatable `--target-outcome` requests are echoed in `summary.json` as `requestedOutcomes` next to the observed `aggregateCounts`; the supervisor does not enforce them and writes no incident when they go unobserved. `tester_order_created` covers non-dust raw order stimulus; dust-only committed tester orders are reported as `tester_dust_order_created` and stop for tx inspection. Match-only bot commits whose emitted match value does not exceed the tx fee stop as terminal `economic_loss`. The supervisor treats public testnet iCKB deposits, receipts, and orders as observable stress surface, but only bot/tester-owned state from the supplied configs is treated as spend authority.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and it is released under the [MIT License](./LICENSE).
