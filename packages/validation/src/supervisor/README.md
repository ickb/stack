# iCKB Live Supervisor Operations

Run live commands from the Stack repository root. The command shapes below match the source-owned scripts at the time of writing, but operators must verify `package.json`, each referenced entrypoint, and the relevant `--help` output before use. Stop and correct stale documentation instead of guessing renamed commands or options.

## Configuration Boundary

Ignored files under `config/` are disposable local output. If they are missing, stale, or of unknown provenance, rebuild the complete set from externally supplied `ICKB_TESTNET_BOT_PRIVATE_KEY` and `ICKB_TESTNET_TESTER_PRIVATE_KEY`:

```bash
pnpm live:config-from-env -- --force
```

If either key or `ICKB_TESTNET_RPC_URL` is absent or empty, stop. Generated configs require that explicit URL and use it without CCC fallbacks. Do not generate replacement identities unless identity rotation is intentional.

The helper writes bounded `config/bot-testnet.json` and `config/tester-testnet.json`, plus unbounded `config/bot-live-testnet.json`. Bounded actor configs used by Supervisor must set `maxIterations: 1`; preflight rejects any actor config that is not bounded to exactly one iteration. Unless explicitly capped, the live config omits `maxIterations` and `maxRetryableAttempts`. An unexpected live cap or missing bounded one-iteration contract indicates stale output; rebuild the set rather than hand-editing one generated file. The default sleep interval is 60 seconds unless `ICKB_TESTNET_SLEEP_INTERVAL_SECONDS` intentionally overrides it.

Runtime config is the sole chain authority. The bot reads `BOT_CONFIG_FILE`, constructs the CCC client from `config.chain`, and verifies public chain identity. Tools and log paths must not introduce separate network authority.

Private keys are for signing only. Never pass them to logs, events, telemetry, error formatters, redaction or masking helpers, generic guards, callbacks, production hooks, command text, or output. Credentialed RPC URLs and secret-bearing environment or config dumps have the same boundary. Public chain identity, transactions, witnesses, scripts, cells, hashes, counts, and summaries may be inspected. If secret material reaches any output stream, stop and repair the producing boundary; do not mask it and continue.

## Live Bot Watch

Run continuous matching from an unbounded config, sending stdout to journald through a unit or to a file:

```bash
BOT_CONFIG_FILE=config/bot-live-testnet.json node apps/bot/src/index.ts > log/bot/events.ndjson
```

Process supervision belongs to systemd. The bot writes content-addressed artifacts under `BOT_ARTIFACT_ROOT` and nothing else to disk.

## Bounded Supervisor Runs

Bounded supervisor runs are smoke tests or deliberate validation stimulus, not the production watch path. Verify `pnpm live:supervisor --help` before running a short repair smoke:

```bash
pnpm live:supervisor --scenario standard-cycle --max-cycles 10 --max-wall-clock-seconds 1200 --stop-after-tx-count 1 --command-timeout-seconds 900
```

Lengthen a run only after the short summary is understood. Long-horizon testnet validation is operator-driven: the operator reads the bot journal and each run's `summary.json`, places tester orders with `--scenario tester-only`, and decides the next run; no script loops the supervisor.

For deterministic non-dust iCKB-to-CKB stimulus, first verify that the current fee behavior still requires this shape:

```bash
pnpm live:supervisor --scenario standard-cycle --max-cycles 1 --command-timeout-seconds 240 --tester-scenario ickb-to-ckb-limit-order --tester-fee 1 --tester-fee-base 1000
```

## Timeout Alignment

Align actor `--command-timeout-seconds`, supervisor `--max-wall-clock-seconds`, and the outer process or tool timeout. The supervisor wall clock must exceed the actor command timeout and include preflight time. A slow preflight can consume the actor-start budget; increase the aligned budgets rather than repeating an ineffective run unchanged.

## Audit Process

Audit a live watch every 30 minutes:

1. Prove the bot is still running: `systemctl is-active` for a unit, or the PID for a foreground run. If it is absent, the audit fails before interpreting stale events.
2. Read the event stream: `journalctl -u <unit> -o cat` or the redirected file.
3. Check for missing recent `bot.iteration.started` or `bot.state.read`, chain identity mismatch, terminal errors, retry exhaustion, transaction failure, unresolved post-broadcast state, repeated unexplained no-action decisions, and secret leakage.
4. When diagnosing a bounded run, inspect `summary.json` first, then supervisor events, `*.command.json`, actor output, decisions, transactions, witnesses, scripts, config paths, and the non-secret environment shape.

Relaunch only after an explained environmental interruption or an intentional restart. Do not relaunch an unresolved incident or secret-boundary failure. Bounded pulses are for specific validation or fresh stimulus, not a substitute for the long-running launcher.

## Stop Interpretation

Never infer success from a bounded stop. Interpret `max_wall_clock_seconds`, `max_cycles`, `stable_no_progress`, and `tx_observed` through `summary.json` and structured diagnostics.

- Treat a nonzero status, `decision=incident`, missing or invalid summary, malformed evidence, secret-leak sentinel, timeout, nonzero actor exit, chain rejection, confirmation timeout, or unresolved post-broadcast state as unexpected. Diagnose it before continuing.
- Treat `decision=tx_observed` and `decision=new_outcome` as inspection stops. For tester transactions, inspect the scenario, new and cancelled orders, and fee fields. A committed tester order can still be dust or economically unactionable.
- Treat max-cycles and max-wall-clock stops as unexplained until parsed actor decisions establish the reason.
- After a shell or tool timeout, inspect `summary.json`, supervisor events, and `*.command.json` before deciding whether an in-flight run was killed. Resume with a shorter run or a longer aligned timeout.
- Outcomes such as `tester_fresh_order_skip`, `tester_estimated_too_small_skip`, and `bot_no_action_skip` are expected only after inspection rules out hidden failures and explains the state.

## Operational Diagnostics

If the tester reports `fresh-matchable-order` while the bot cannot act, compare the tester guard with `OrderManager.bestMatch`, not only `order.isMatchable()` or the SDK midpoint predicate. The guard accepts a positive visited match as actionable, returns false only for a complete empty result, and treats an incomplete empty result as actionable to fail closed. A large unmarketable order can therefore conservatively block new tester stimulus for the 180-block freshness window. Do not equate `tester_order_created` with useful stimulus; inspect order amounts against matcher fees and classify dust orders as ineffective stimulus.

Repeated no-action with visible market orders requires aggregate match diagnostics: direction-matchable counts, viable and positive-gain candidate counts, `rebalance.kind`, and `rebalance.reason`. A visible order with zero direction matchers is not actionable. After a large iCKB-to-CKB match, CKB allowance can make the remainder unprofitable even when it stays direction-matchable; inspect allowance and positive-gain diagnostics before deliberately changing direction.

Inspect reserve and ring behavior from structured decision evidence. `bot.rebalance.evaluated` carries compact ring diagnostics; full segment details are content-addressed under `log/bot/artifacts/<slot>/ringSegments/sha256-<hash>.json` and referenced by `rebalance.diagnostics.ring.segmentsRef`. Final skip and build decisions carry compact selected-ring evidence under `decision.audit.selectedRing`. Periodically inspect `ringCanCreateInventory`, `ringTargetSegmentUdtValue`, `ringTotalPoolUdt`, `poolDepositCount`, and `readyPoolDepositCount`, together with referenced empty or nonempty, protected or surplus, target, and heaviest-segment evidence. Persistent under-coverage without the expected rebalance reason requires diagnosis.

On `low_capital_stop`, preserve explicit plain-CKB reserve plus transaction overhead and verify projected post-transaction plain CKB before broadcast. Do not repeat low-capital stops. A transient preflight fetch failure may be retried once; repetition requires repair, classification, or reduced loop pressure. Chain-tip scan retries remain retryable only while they do not cause timeout, exhaust no-progress limits, or hide a terminal error.

After a successful stimulus cycle, inspect built actions, projected balances, the correlated match, any recorded post-match maintenance commits, and the final quiescence skip. The source-owned cadence does not add the next stimulus before this idle proof.

## Incident Repair

1. Stop the affected watch or bounded run.
2. Diagnose from `summary.json` and structured evidence, then use targeted source reads. Transaction and witness data may be inspected; private-key material must never be printed.
3. Fix the smallest owning layer: validation core, validation CLI, bot core, bot CLI/startup, documentation/tests, or build/runtime wiring.
4. Add or strengthen a focused regression test. Put broadly reusable support in `packages/testkit`; keep domain fixture language local.
5. Run focused tests and builds, review the repair, address material findings, and resume with a new ignored output directory.

## Focused Verification

Verify current package and script names before selecting checks:

- Supervisor/tester core: `pnpm --filter @ickb/validation test:ci` and `pnpm live:check:source`.
- Validation CLI: add `pnpm --filter @ickb/validation-cli test:ci`.
- Bot core: `pnpm --filter @ickb/bot test:ci`; add `pnpm bot:check` for runtime and type wiring.
- Bot CLI/startup: `pnpm --filter @ickb/bot-cli test:ci`; add `pnpm bot:check`.
- Config helper: run its current focused tests and prove `pnpm live:config-from-env -- --help` reaches the CLI.
- Root wiring: run the smallest top-level check that covers the changed surface.

Runtime packages and apps must retain the repository's current full-coverage policy; `packages/testkit` may remain test infrastructure.
