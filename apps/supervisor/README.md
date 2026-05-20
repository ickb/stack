# iCKB Live Supervisor

The supervisor is a deterministic operator app for funded testnet validation. It runs bounded bot/tester app processes, classifies known outcomes without LLM involvement, records ignored artifacts, and stops with an incident bundle on unknown or unsafe outcomes. It does not patch, verify, rebuild, relaunch, or invoke an LLM; operators and external loops consume `summary.json` between runs.

## Run

Build the local CCC fork, shared packages, live apps, and supervisor first:

```bash
pnpm forks:ccc
pnpm --filter @ickb/utils --filter @ickb/dao --filter @ickb/core --filter @ickb/order --filter @ickb/sdk --filter @ickb/node-utils build
pnpm --filter ./apps/bot build
pnpm --filter ./apps/tester build
pnpm --filter @ickb/supervisor build
```

Run from the repo root:

```bash
pnpm live:supervisor
```

By default this uses `config/bot-testnet.json` and `config/tester-testnet.json`. Configs must be ignored JSON files and should keep `maxIterations: 1`. The supervisor passes config paths to the existing app env names and does not print config contents.

## Artifacts

Default artifacts live under `logs/live-supervisor/<run-id>/`, which is ignored by git. Each run writes:

- `supervisor.ndjson`: concise supervisor events.
- `cycle-<n>-<actor>.stdout.ndjson` and `.stderr.log`: bounded app-process evidence for that actor.
- `cycle-<n>-<actor>.command.json`: redacted command shape and exit status.
- `cycle-<n>-incident.json`: written only on unknown, unsafe, unsupported, or unmet explicit coverage outcomes.
- `summary.json`: aggregate outcomes, coverage ledger, tx hashes by outcome, and public-vs-owned state assumptions.

The supervisor treats public testnet iCKB deposits, receipts, and orders as observable scenario surface. It does not count public state as bot/tester-owned inventory or as permission to mutate unrelated cells.

## Scenario Coverage

The default planner prefers under-covered safe outcomes over repeating the same known-good path. Supported selectors are:

```bash
--scenario auto|standard-cycle|tester-only|bot-only|tester-fresh-skip-two-pass
--tester-scenario auto|random-order|sdk-conversion|extra-large-limit-order|multi-order-limit-orders|two-ckb-to-ickb-limit-orders|all-ckb-limit-order|ickb-to-ckb-limit-order|two-ickb-to-ckb-limit-orders|mixed-direction-limit-orders|dust-ckb-conversion|dust-ickb-conversion
--tester-fee <n>
--tester-fee-base <n>
--target-outcome <outcome>
```

Coverage goals never override stop conditions. If a requested scenario cannot be reached through safe supervisor/test-harness controls, the supervisor writes an incident instead of mutating funded configs in place or forcing tx-bearing paths.

Explicit repeatable `--target-outcome` values are coverage contracts for the bounded run. If `--max-cycles` is reached before observing them, the supervisor writes a logical `unmet_coverage_goal` incident. Default coverage goals still steer the planner, but they are best-effort and do not make a bare one-cycle run fail. `--stop-after-tx-count` remains a successful operator stop even if explicit coverage remains unmet.

`--tester-scenario` is passed to the tester as `TESTER_SCENARIO`. When it is left as `auto`, `--target-outcome tester_conversion_created` steers the tester to `sdk-conversion`, the SDK conversion-builder selector. Use `ickb-to-ckb-limit-order` for iCKB withdrawal-through-LO coverage. Use `sdk-conversion` when the intended behavior is the SDK conversion builder, including direct conversions that do not create limit orders, `multi-order-limit-orders` for any funded two-order raw limit-order type, `two-ckb-to-ickb-limit-orders`, `two-ickb-to-ckb-limit-orders`, or `mixed-direction-limit-orders` for a specific two-order transaction, and `extra-large-limit-order` to stress non-interface users placing large raw limit orders. An explicit `--tester-scenario` overrides target-outcome steering.

`tester-fresh-skip-two-pass` runs the same tester config twice in one supervisor cycle. Pass 1 uses `multi-order-limit-orders` to create any funded multi-order transaction; pass 2 leaves `TESTER_SCENARIO=auto` and is expected to classify `tester_fresh_order_skip` when the same key still owns a fresh matchable order. Artifacts use `tester-pass-1` and `tester-pass-2` labels so the two passes do not overwrite each other.

`--tester-fee` and `--tester-fee-base` are tester-owned raw limit-order fee controls. Defaults stay `1 / 100000` (0.001%). When provided, the supervisor passes them only to the tester as `TESTER_FEE` and `TESTER_FEE_BASE`; `sdk-conversion` keeps using SDK-owned fee defaults for any order remainder.

## External Loops

Keep long-running policy outside this app. A loop or human operator should run bounded supervisor commands, read only `summary.json`, and decide whether to continue, back off, stop for inspection, or patch code. This keeps the live harness deterministic and keeps LLM/watch logic outside the funded actor process boundary.

The KISS watcher script runs one deterministic supervisor invocation per child output directory and prints one summary-only line per run:

```bash
node scripts/ickb-supervisor-loop.mjs --max-runs 1 --stable-limit 2 --backoff-seconds 0 -- --scenario standard-cycle --max-cycles 1
```

Loop-owned options go before `--`; supervisor options go after `--`. If using `pnpm live:supervisor:loop`, keep loop-owned options before the first `--` so they are not passed through to the supervisor. The loop stops on supervisor nonzero exit, incident artifacts listed in `summary.json`, any tx hash, a new outcome after the first run, repeated no-progress signatures, or `--max-runs`.
