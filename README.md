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
- `apps/validation`: Node CLI adapters for deterministic live testnet validation flows, including bounded supervisor cycles and tester order stimulus.

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

Run continuous matching with the production-style bot launcher and an unbounded bot config:

```bash
pnpm live:config-from-env -- --force
BOT_CONFIG_FILE=config/bot-live-testnet.json node scripts/bot/launcher.ts --no-child-tee
```

Every 30-minute watch audit must first prove the bot launcher and child are still running. Only then inspect `log/bot/launches.ndjson`, the current `logFiles.events` and `logFiles.stderr` from the latest `launcher.started` record, and any referenced files under `log/bot/artifacts/<slot>/` for recent `bot.iteration.started`, `bot.state.read`, chain preflight matches, terminal failures, retry-budget exhaustion, transaction failures, or exit records. If the bot is not running, the audit fails before interpreting stale logs.

Generated live configs default to `sleepIntervalSeconds: 60`; override with `ICKB_TESTNET_SLEEP_INTERVAL_SECONDS` only when the operator deliberately wants a different cadence. Bounded supervisor/tester configs default to `maxRetryableAttempts: 10`; the unbounded live launcher config omits `maxRetryableAttempts` unless `ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS` is set intentionally.

Use the supervisor-owned live stimulus cadence when the long-running bot is healthy and continuous production-bot validation is required:

```bash
pnpm -s live:supervisor:bot-stimulus-test --keep-going --log-root log
```

The cadence keeps the single production-like bot under its existing launcher and runs non-overlapping cycles until `SIGINT` or `SIGTERM`. Every cycle gets fresh bot and tester preflights and an ignored `log/validation/live-bot-stimulus-<time>-<pid>-cycle-<n>/` summary. It refuses new stimulus unless tester preflight proves `inventory.matchableUserOrderCount` is exactly zero, chooses from tester balances without predicting bot inventory, and creates exactly one bounded non-dust tester order. It then waits for the correlated bot matched-order commit and a later `bot.decision.skipped` with zero market orders and receipts. The default wait has no deadline so bot reserve, partial-fill, ring, and maturity policy can run normally; `--wait-seconds` adds an explicit operator deadline. Tester CKB planning can spend projected available CKB collected by the same transaction, while the post-build plain-cell reserve check remains authoritative. Every actionable tester-owned mint is protected from collection for 180 blocks across tester restarts; bot-updated and nonmatchable descendants are immediately collectable. iCKB-to-CKB stimulus uses only `bounded-ickb-to-ckb-limit-order`, capped at `ICKB_DEPOSIT_CAP`; this command rejects unbounded `ickb-to-ckb-limit-order`. Any bot or tester transaction failure, malformed event, launcher identity change, or explicit wait timeout stops the cadence. Omit `--keep-going` for the unchanged one-shot command; `--keep-going` cannot be combined with `--session-root`.

## Live Testnet Supervisor

Provide ignored bounded configs, then run the supervisor from the repo root:

```bash
pnpm live:supervisor
```

By default the supervisor uses ignored `config/bot-testnet.json` and `config/tester-testnet.json`, writes standalone artifacts under ignored `log/live-supervisor/<run-id>/` paths, and runs deterministic bounded bot/tester commands only.

Rebuild disposable live configs from required `ICKB_TESTNET_BOT_PRIVATE_KEY`, `ICKB_TESTNET_TESTER_PRIVATE_KEY`, and `ICKB_TESTNET_RPC_URL` values with `pnpm live:config-from-env -- --force` when they are missing or stale. The RPC URL is exclusive (no CCC public fallbacks), and omission or an empty value fails. The helper writes bounded `config/bot-testnet.json` and `config/tester-testnet.json` for supervisor/tester runs, plus unbounded `config/bot-live-testnet.json` for the production-style bot launcher. When `ICKB_TESTNET_SLEEP_INTERVAL_SECONDS` is unset, all generated configs use `sleepIntervalSeconds: 60`. When `ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS` is unset, bounded configs use `10` and the live launcher config remains unbounded. The supervisor does not patch, verify, rebuild, relaunch, or invoke an LLM; external loops and operators consume `summary.json` between runs.

`pnpm live:preflight -- --config config/bot-testnet.json` prints public balance evidence for funding checks. Use `key.recommendedAddress` as the funding address, then rerun preflight and check `balances.CKB.available`, `balances.CKB.reserve`, `balances.CKB.spendable`, `balances.CKB.projectedAvailable`, `balances.CKB.unavailable`, `balances.CKB.total`, `balances.ICKB.available`, `balances.ICKB.unavailable`, `balances.ICKB.total`, and `capital.minimumCkbCapital`. `CKB.available` and `CKB.spendable` are actual plain-cell values, `CKB.projectedAvailable` includes account sources the SDK can collect in the same transaction, `unavailable` is known locked or pending account value, and `total` is `projectedAvailable + unavailable`. For machine-readable JSON without package-manager output, run `pnpm -s live:preflight -- --config config/bot-testnet.json`.

For repeated bounded invocations, keep loop-owned options before `--` and supervisor options after it. The loop owns child run directories through `--out-root`, so do not pass supervisor `--out-dir` after `--`:

```bash
pnpm live:supervisor:loop --max-runs 1 -- --scenario standard-cycle --max-cycles 1
```

The loop type-checks Stack source before the first run. Use loop-owned `--child-timeout-seconds` to bound the outer supervisor child process when running long watches; keep it long enough for the whole supervisor invocation, including actor preflights and actor commands, so the supervisor remains alive to enforce its own `--command-timeout-seconds` process-group cleanup.

For bounded standalone tester-stimulus validation that does not drive the production bot, use the dynamic external loop. It reads only tester preflight balance summaries, chooses `all-ckb-limit-order` when plain CKB can cover the tester reserve, all-CKB order overhead, and the live fee-rate-derived maturity-fee threshold, otherwise chooses `ickb-to-ckb-limit-order` with `--tester-fee 1 --tester-fee-base 1000` when plain `CKB.available >= 2100` and projected `ICKB.available >= 100`, otherwise leaves the tester scenario as `auto`, then runs bounded supervisor-loop chunks:

```bash
pnpm live:supervisor:dynamic-loop --keep-going --max-chunks 2
```

Dynamic validation sessions default to ignored `log/validation/dynamic-<time>-<pid>/` under the checkout. Override the root with `--log-root <path>` or pin a single session with `--session-root <path>`; the session root must be exactly `<log-root>/validation/<session>`, stay under the resolved log root, avoid symlinked parents, and be new for each run. Loop-owned options stay before `--`, while supervisor options stay after it. The dynamic loop owns one-cycle chunking and command timeout: pass `--command-timeout-seconds` before `--`, keep `--child-timeout-seconds` at least six delegated command-timeout windows plus 60 seconds, and do not pass supervisor `--max-cycles` after `--` because each delegated chunk always uses `--max-cycles 1`. The dynamic loop derives `--chunk-timeout-seconds` from the delegated supervisor-loop prebuild budget, child timeout, chunk run count, chunk backoff, and the process helper's cleanup grace for prebuild and every possible child run so the outer chunk timeout does not preempt supervisor-owned child cleanup:

```bash
pnpm live:supervisor:dynamic-loop --keep-going --log-root log --max-chunks 2 -- --target-outcome bot_match_committed
```

Session layout is source-separated: `supervisor/events.ndjson`, `supervisor/launch.json`, optional `supervisor/stderr.log`, and `chunks/chunk-0001/run-0001/summary.json` plus the supervisor-owned preflight, bot, tester, and supervisor artifacts. Production bot-only logs remain separate under `log/bot/`, for example `log/bot/bot.events.slot-00.ndjson`, with large diagnostic artifacts under `log/bot/artifacts/slot-00/`.

Explicit repeatable `--target-outcome` requests become bounded coverage contracts: if `--max-cycles` ends before they are observed, the supervisor writes a logical incident for external review. `tester_order_created` covers non-dust raw order stimulus; dust-only committed tester orders are reported as `tester_dust_order_created` and stop for tx inspection without satisfying useful order coverage. Match-only bot commits whose emitted match value does not exceed the tx fee stop as terminal `economic_loss`. The supervisor treats public testnet iCKB deposits, receipts, and orders as observable stress surface, but only bot/tester-owned state from the supplied configs is treated as spend authority.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and it is released under the [MIT License](./LICENSE).
