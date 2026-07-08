# iCKB Stack

iCKB Stack is the monorepo for the current TypeScript iCKB libraries and apps built on top of [CCC](https://github.com/ckb-devrel/ccc).

## Transaction Completion Boundary

`@ickb/sdk` builders still return partial `ccc.Transaction` values. Callers explicitly choose when to finalize, and the shared completion path now also lives in `@ickb/sdk`.

Callers own the final completion pipeline:

1. Build the partial transaction through `IckbSdk` and the package managers.
2. Before send, call `sdk.completeTransaction(...)` or `completeIckbTransaction(...)` from `@ickb/sdk`.
3. Only then send the transaction.

Withdrawal requests built from public pool ready deposits may include `requiredLiveDeposits`. `@ickb/sdk` adds those cells as live `cell_dep` checks so a transaction fails if a protected pool anchor disappears before inclusion.

## Scan Page Size Boundary

Stack cell scans that feed account state, pool state, order books, or maturity estimates use a per-request page size. SDK state APIs expose it as `cellPageSize`; lower-level scan wrappers expose it as `pageSize` and pass it to CCC as `limit`.

## User Lock Assumption

Current stack flows assume user-owned cells are protected by locks whose signatures bind the whole transaction, such as standard `sighash` wallet flows. Passing a raw `ccc.Script` is only safe when that lock gives the same output and recipient binding. Delegated-signature or OTX-style locks are integration-specific and must account for the weak-lock boundary documented in the iCKB whitepaper and contracts audit.

## Workspace Map

Apps:

- `apps/bot`: Node order-fulfillment and rebalance bot for matching profitable orders, collecting owned orders, completing receipts and withdrawals, and rebalancing pool exposure.
- `apps/interface`: Browser interface for CCC wallet connection, conversion previews, transaction completion, signing, sending, and confirmation.
- `apps/sampler`: Mainnet sampling utility that writes historical iCKB exchange-rate CSV output.
- `apps/supervisor`: Deterministic live testnet supervisor for bounded bot/tester stress cycles, ignored artifacts, and incident bundles.
- `apps/tester`: Node simulator that creates random conversion orders to exercise the order and conversion flows.

The Node app packages (`@ickb/bot`, `@ickb/sampler`, and `@ickb/tester`) publish their built entrypoints for distribution, but the supported reusable API surface lives in the packages below. `@ickb/interface` is a deployable browser app package and does not expose a library entrypoint.

Packages:

- `packages/core`: iCKB protocol primitives, cells, UDT conversion helpers, and low-level transaction builders.
- `packages/dao`: Nervos DAO cell classification, readiness, deposit, request, and withdrawal helpers.
- `packages/node-utils`: Private Node app utilities for env parsing, RPC client setup, signer locks, sleeps, and JSON logs.
- `packages/order`: UDT limit-order entities, grouping, matching, minting, melting, and deployed-script confusion mitigation.
- `packages/sdk`: Stack-level SDK that composes core, DAO, and order packages into account state, conversion planning, completion, sending, and confirmation helpers.
- `packages/testkit`: Private test helpers and fixtures for workspace tests.
- `packages/utils`: Shared low-level utilities such as complete-scan enforcement, binary search, collection helpers, and bounded subset selection.

## Dependencies

CCC packages are normal package dependencies resolved through `pnpm-workspace.yaml` catalog entries and `pnpm-lock.yaml`. From a plain checkout, run `pnpm install`; no local CCC fork, build step, or workspace alias is required.

`pnpm check` is the validation gate. It always runs with `CI=true`.

## Live Testnet Supervisor

Provide ignored bounded configs, then run the supervisor from the repo root:

```bash
pnpm live:supervisor
```

By default the supervisor uses ignored `config/bot-testnet.json` and `config/tester-testnet.json`, writes standalone artifacts under ignored `logs/live-supervisor/<run-id>/` paths, and runs deterministic bounded bot/tester commands only.

Rebuild disposable live configs from `ICKB_TESTNET_BOT_PRIVATE_KEY` and `ICKB_TESTNET_TESTER_PRIVATE_KEY` with `pnpm live:config-from-env -- --force` when they are missing or stale; `ICKB_TESTNET_RPC_URL` is optional. The supervisor does not patch, verify, rebuild, relaunch, or invoke an LLM; external loops and operators consume `summary.json` between runs.

`pnpm live:preflight -- --config config/bot-testnet.json --role bot` prints public balance evidence for funding checks. Use `key.recommendedAddress` as the funding address, then rerun preflight and check `balances.CKB.available`, `balances.CKB.reserve`, `balances.CKB.spendable`, `balances.CKB.projectedAvailable`, `balances.CKB.total`, and `capital.minimumCkbCapital`; `available` and `spendable` are actual plain-cell values, while `projectedAvailable` and `total` are projected accounting values. For machine-readable JSON without package-manager output, run `node scripts/ickb-live-preflight.mjs --config config/bot-testnet.json --role bot` directly.

For repeated bounded invocations, keep loop-owned options before `--` and supervisor options after it. The loop owns child run directories through `--out-root`, so do not pass supervisor `--out-dir` after `--`:

```bash
pnpm live:supervisor:loop --max-runs 1 -- --scenario standard-cycle --max-cycles 1
```

By default the loop prebuilds bot, tester, and supervisor runtime before the first run. Use loop-owned `--skip-build` only when another wrapper has already built those artifacts. Use loop-owned `--child-timeout-seconds` to bound the outer supervisor child process when running long watches; keep it long enough for the whole supervisor invocation, including actor preflights and actor commands, so the supervisor remains alive to enforce its own `--command-timeout-seconds` process-group cleanup.

For continuous live matching, use the dynamic external loop. It reads only tester preflight balance summaries, chooses `all-ckb-limit-order` when `CKB.available >= 3001`, otherwise chooses `ickb-to-ckb-limit-order` with `--tester-fee 1 --tester-fee-base 1000` when `CKB.available >= 2100` and `ICKB.available >= 100`, otherwise leaves the tester scenario as `auto`, then runs bounded `scripts/ickb-supervisor-loop.mjs` chunks:

```bash
pnpm live:supervisor:dynamic-loop
```

Dynamic validation sessions default to ignored `log/validation/dynamic-<time>-<pid>/` under the checkout. Override the root with `--log-root <path>` or pin a single session with `--session-root <path>`; the session root must be exactly `<log-root>/validation/<session>`, stay under the resolved log root, avoid symlinked parents, and be new for each run. Loop-owned options stay before `--`, while supervisor options stay after it. The dynamic loop derives `--chunk-timeout-seconds` from its delegated supervisor-loop child timeout, chunk run count, and chunk backoff so the outer chunk timeout does not preempt supervisor-owned child cleanup:

```bash
pnpm live:supervisor:dynamic-loop --log-root log --max-chunks 2 -- --target-outcome bot_match_committed
```

Session layout is source-separated: `operator/events.ndjson`, `operator/launch.json`, optional `operator/stderr.log`, and `chunks/chunk-0001/run-0001/summary.json` plus the supervisor-owned preflight, bot, tester, and supervisor artifacts. Production bot-only logs remain separate under the configured production log root, for example `<log-root>/bot/testnet/bot.events.ndjson`.

Explicit repeatable `--target-outcome` requests become bounded coverage contracts: if `--max-cycles` ends before they are observed, the supervisor writes a logical incident for external review. The supervisor treats public testnet iCKB deposits, receipts, and orders as observable stress surface, but only bot/tester-owned state from the supplied configs is treated as spend authority.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and it is released under the [MIT License](./LICENSE).
