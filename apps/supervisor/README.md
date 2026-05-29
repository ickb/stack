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

By default this uses `config/bot-testnet.json` and `config/tester-testnet.json`. Configs must be ignored JSON files with `maxIterations: 1`; the supervisor refuses to launch an actor when preflight reports the config is missing that one-iteration bound.

Treat these files as disposable local output: rebuild them from `ICKB_TESTNET_BOT_PRIVATE_KEY` and `ICKB_TESTNET_TESTER_PRIVATE_KEY` with `pnpm live:config-from-env -- --force` when they are missing or stale. `ICKB_TESTNET_RPC_URL` is optional; when omitted, the generated JSON omits `rpcUrl` and CCC chooses its default testnet endpoint. The supervisor passes config paths to the existing app env names and does not print config contents.

To get a public funding address and verify balances without printing config contents, run:

```bash
pnpm live:preflight -- --config config/bot-testnet.json --role bot
```

Use `key.recommendedAddress` as the funding address. After funding, rerun the same preflight command and check `balances.CKB.available`, `balances.CKB.reserve`, `balances.CKB.spendable`, `balances.CKB.projectedAvailable`, `balances.CKB.total`, and `capital.minimumCkbCapital`. `available` and `spendable` are actual plain-cell values, while `projectedAvailable` and `total` can include projected sources such as ready withdrawals. If you need machine-readable JSON for piping, run `node scripts/ickb-live-preflight.mjs --config config/bot-testnet.json --role bot` directly so package-manager output is not mixed into stdout.

## Artifacts

Standalone supervisor artifacts live under `logs/live-supervisor/<run-id>/`, which is ignored by git. Each run writes:

- `supervisor.ndjson`: concise supervisor events.
- `cycle-<n>-<actor>.stdout.ndjson` and `.stderr.log`: bounded raw bot/tester app-process evidence for that actor.
- `cycle-<n>-<actor>-preflight.stdout.json` and `.stderr.log`: bounded public preflight evidence for that actor. Preflight stdout is one pretty JSON report, not NDJSON.
- `cycle-<n>-<actor>.command.json`: command shape and exit status.
- `cycle-<n>-incident.json`: written only on unknown, unsafe, unsupported, or unmet explicit coverage outcomes.
- `summary.json`: aggregate outcomes, safe preflight balance and tester-steering summaries, coverage ledger, tx hashes by outcome, and public-vs-owned state assumptions.

The supervisor treats public testnet iCKB deposits, receipts, and orders as observable scenario surface. It does not count public state as bot/tester-owned inventory or as permission to mutate unrelated cells.

Actor artifacts preserve debugging evidence, including public chain/RPC identity evidence and raw transaction-shaped fields such as `inputs`, `outputs`, `cellDeps`, `headerDeps`, `outputsData`, and `witnesses`. Captured bot stdout remains the canonical bot NDJSON stream with `app: "bot"` and `bot.*` event semantics unchanged; validation context belongs in supervisor/operator summaries, not rewritten bot events. Bot, tester, and preflight producers own their configured private keys and must use them only for signing, never logging helpers, redaction helpers, masking callbacks, or guard utilities. If a configured key or other secret reaches supervisor capture, stop and fix that producer instead of masking and continuing.

## Scenario Coverage

The default planner prefers under-covered safe outcomes over repeating the same known-good path. Supported selectors are:

```bash
--scenario auto|standard-cycle|tester-only|bot-only|tester-fresh-skip-two-pass
--tester-scenario auto|random-order|sdk-conversion|extra-large-limit-order|multi-order-limit-orders|two-ckb-to-ickb-limit-orders|all-ckb-limit-order|ickb-to-ckb-limit-order|bounded-ickb-to-ckb-limit-order|two-ickb-to-ckb-limit-orders|mixed-direction-limit-orders|dust-ckb-conversion|dust-ickb-conversion
--tester-fee <n>
--tester-fee-base <n>
--target-outcome <outcome>
```

Coverage goals never override stop conditions. If a requested scenario cannot be reached through safe supervisor/test-harness controls, the supervisor writes an incident instead of mutating funded configs in place or forcing tx-bearing paths.

Bot withdrawal-request, receipt-completion, and withdrawal-completion coverage are satisfied by any committed bot transaction whose built action evidence has `withdrawalRequests > 0`, `completedDeposits > 0`, or `withdrawals > 0`, including transactions that also match orders. `bot_match_plus_deposit_committed` remains the more specific combined match-and-deposit outcome.

Explicit repeatable `--target-outcome` values are coverage contracts for the bounded run. If the bounded cycle or wall-clock budget ends before observing them, the supervisor writes a logical `unmet_coverage_goal` incident. Default coverage goals still steer the planner, but they are best-effort and do not make a bare one-cycle run fail. `--stop-after-tx-count` remains a successful operator stop even if explicit coverage remains unmet.

`--tester-scenario` is passed to the tester as `TESTER_SCENARIO`. When it is left as `auto`, `--target-outcome tester_conversion_created` steers the tester to `sdk-conversion`, the SDK conversion-builder selector. Use `ickb-to-ckb-limit-order` for iCKB withdrawal-through-LO coverage. Use `sdk-conversion` when the intended behavior is the SDK conversion builder, including direct conversions that do not create limit orders, `multi-order-limit-orders` for any funded two-order raw limit-order type, `two-ckb-to-ickb-limit-orders`, `two-ickb-to-ckb-limit-orders`, or `mixed-direction-limit-orders` for a specific two-order transaction, and `extra-large-limit-order` to stress non-interface users placing large raw limit orders. An explicit `--tester-scenario` overrides target-outcome steering.

`tester-fresh-skip-two-pass` runs the same tester config twice in one supervisor cycle. Both passes leave `TESTER_SCENARIO=auto` unless `--tester-scenario` is explicit, so the tester selects a currently fundable first-pass order instead of forcing a CKB-heavy multi-order stimulus. Pass 2 is expected to classify `tester_fresh_order_skip` when the same key still owns a fresh matchable order. Artifacts use `tester-pass-1` and `tester-pass-2` labels so the two passes do not overwrite each other.

`--tester-fee` and `--tester-fee-base` are tester-owned raw limit-order fee controls. Defaults stay `1 / 100000` (0.001%). When provided, the supervisor passes them only to the tester as `TESTER_FEE` and `TESTER_FEE_BASE`; `sdk-conversion` keeps using SDK-owned fee defaults for any order remainder.

## External Loops

Keep long-running policy outside this app. A loop or human operator should run bounded supervisor commands, read only `summary.json`, and decide whether to continue, back off, stop for inspection, or patch code. This keeps the live harness deterministic and keeps LLM/watch logic outside the funded actor process boundary.

The KISS watcher script runs one deterministic supervisor invocation per child output directory and prints one summary-only line per run:

```bash
node scripts/ickb-supervisor-loop.mjs --max-runs 1 --stable-limit 2 --backoff-seconds 0 -- --scenario standard-cycle --max-cycles 1
```

Loop-owned options go before `--`; supervisor options go after `--`. If using `pnpm live:supervisor:loop`, keep loop-owned options before the first `--` so they are not passed through to the supervisor. The loop stops on supervisor nonzero exit, incident artifacts listed in `summary.json`, tx-creating outcomes or tx hashes for tx-creating outcomes, a new outcome after the first run, repeated no-progress signatures, or `--max-runs`. `-- --help` and `-- -h` are child help passthroughs: the delegated help is printed and the wrapper exits with the child status.

The external loop also has a loop-owned `--child-timeout-seconds` guard for the supervisor child process. Keep it long enough for the whole delegated supervisor run, including actor preflights and actor commands, not just one `--command-timeout-seconds` window. The dynamic loop defaults this guard to the supervisor-loop default so the supervisor keeps ownership of killing funded actor process groups on command timeout.

For continuous tester-bot matching, use `node scripts/ickb-supervisor-dynamic-loop.mjs` or `pnpm live:supervisor:dynamic-loop`. This remains outside `apps/supervisor`: it reads tester preflight balance summaries, chooses a currently fundable tester scenario, and delegates each bounded chunk to `scripts/ickb-supervisor-loop.mjs`. When `--target-outcome tester_fresh_order_skip` is passed through, supervisor auto-planning can choose `tester-fresh-skip-two-pass`; the dynamic loop itself only chooses fundable tester stimuli. The dynamic loop also treats `-- --help` and `-- -h` as child help passthroughs and exits with the delegated status.

Loop and dynamic-loop exit codes are operator-visible control flow: tx/new-outcome stops exit `0`, incidents exit `2`, `max_runs` and `stable_no_progress` inspection stops exit `3`, and child nonzero statuses are preserved.

Dynamic loop sessions are live-validation artifacts, separate from production bot-only logs. They default to ignored `log/validation/dynamic-<time>-<pid>/`; override the root with `--log-root <path>` or pin one run with `--session-root <path>`. The session root must be exactly `<log-root>/validation/<session>`, stay under the resolved log root, avoid symlinked parents, and not already exist. The dynamic loop derives its chunk timeout from the delegated supervisor-loop child timeout, chunk run count, and chunk backoff unless `--chunk-timeout-seconds` is explicitly set high enough, so an outer chunk timeout does not kill the supervisor-loop process before it can enforce its child cleanup boundary.

```bash
node scripts/ickb-supervisor-dynamic-loop.mjs --log-root log --max-chunks 2 -- --target-outcome bot_match_committed
```

The dynamic loop writes operator records under the session and passes each chunk root to `scripts/ickb-supervisor-loop.mjs` as loop-owned `--out-root` before `--`:

```text
<log-root>/validation/dynamic-<time>-<pid>/
  operator/events.ndjson
  operator/launch.json
  operator/stderr.log (only when child stderr is captured)
  chunks/chunk-0001/run-0001/summary.json
  chunks/chunk-0001/run-0001/supervisor.ndjson
  chunks/chunk-0001/run-0001/cycle-0001-bot.stdout.ndjson
  chunks/chunk-0001/run-0001/cycle-0001-tester.stdout.ndjson
```

Production bot-only logs can share the same configured log root but stay under `bot/<network>/`, for example `<log-root>/bot/testnet/bot.events.ndjson`. See [apps/bot/README.md](../bot/README.md) for the production launcher layout.
