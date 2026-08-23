# Repository Review

> Status: Historical review. The current decisions in `../decisions.md` supersede this document where they differ.

## Scope

- Checkout: `/var/home/user/Projects/ickb/stack`
- Branch and HEAD: `wip` at `ca51bf88d57887fcc554f8697939e0560e9ef2ab`
- Requested scope: whole repo, current state, all dimensions (simplification, architecture, correctness, tooling/docs/tests), read-only.
- Method: 11 parallel independent reviewers, one per slice — core+dao, order, sdk, bot (+app), validation supervisor, validation tester, shared utils (utils/node-utils/testkit/log), interface+sampler, scripts/, monorepo architecture+tooling+CI, and a spec-fidelity cross-check against `/var/home/user/Projects/ickb/whitepaper` and `/var/home/user/Projects/ickb/contracts` (including the 2026-05-01 audit report). Findings below survived per-slice verification by reading (and in one case executing) the actual code; cross-slice duplicates were merged.
- Role boundary: reviewer-only; no source, test, or configuration files were modified. This report is the only artifact written.

## Verdict

The protocol-facing code is in good shape: the spec cross-check verified AR conversion math, receipt/deposit semantics, owned-owner rules, DAO edge cases, order codecs/match rounding, and the confusion-attack resolver as faithful to the deployed contracts, and the workspace graph is clean and acyclic with a well-curated public surface. Two problem classes dominate:

1. A small set of confirmed correctness defects, led by an inverted ratio conversion in the order matcher (verified by execution and against contract source) and a liveness gap in the bot confirmation loop.
2. Mass: a large fraction of the repo is tooling/validation ceremony — lint-rule workarounds, a 100%-coverage mandate producing fixture-testing tests, duplicated mini-frameworks — compressible by tens of thousands of lines with no behavior change.

## Correctness findings

### C1. high — Order matcher: ckb2udt minimum-match conversion inverted

`packages/order/src/matching/order_matcher.ts:209` computes `bMinMatch = ceil(ckbMinMatch * udtScale / ckbScale)`; the contract rule (`contracts/scripts/contracts/limit_order/src/entry.rs:116`, CKB delta `i.ckb - o.ckb >= ckb_min_match`) and the package's own `Ratio.convert(true, ...)` (`ratio.ts:205`) require the reciprocal `ceil(ckbMinMatch * ckbScale / udtScale)`.

- Verified by execution: ratio `{ckbScale: 2, udtScale: 1}`, `ckbMinMatchLog = 3` (min 8 CKB) yields `bMinMatch = 4` and a partial moving 2 CKB — below the declared minimum; the deployed script would reject with `InsufficientMatch`.
- Mainnet impact bounded: for iCKB, `udtScale = AR_m >= ckbScale = AR_0` always, so the flip is only over-restrictive (forgoes legal small matches, roughly `(AR_m/AR_0)^2` × required minimum). But `@ickb/order` is documented as generic for any sUDT-convention token, where the failing regime is legal.
- The udt2ckb branch has an explicit post-guard (`order_matcher.ts:130-137`) mirroring `entry.rs:127`; the c2u branch has no symmetric guard.
- Pre-existing divergence (present in pinned commit `ad53177`), not a wip regression.
- Test blind spot: every min-match test uses 1:1 ratios or the u2c direction; the exhaustive oracle iterates `from matcher.bMinMatch`, inheriting the constant it should independently check.

Direction: swap the scales (or add the symmetric CKB-side post-check), derive the oracle minimum independently from `Info.getCkbMinMatch()` + `Ratio.convert`, add asymmetric-ratio min-match tests in both scale regimes with `ckbMinMatchLog >= 4`.

### C2. high — Bot: confirmation timeouts never consume the retry budget; ambiguous broadcasts can poll forever

`packages/bot/src/bot/loop.ts:345-347` `continue`s the wait loop on confirmation timeout without touching `maxRetryableAttempts`, contradicting `apps/bot/README.md:107` and `apps/bot/docs/current_rebalancing_policy.md:118` (both promise timeout counts toward the budget, exit code 2). `packages/bot/test/bot/loop.ts:385` pins the unbounded behavior. The `broadcast_ambiguous` path (`loop.ts:257-268`) feeds a possibly never-sent hash into that loop; only "rejected" is terminal in `packages/sdk/src/send/wait_transaction.ts:158-175`, so an evicted transaction means indefinite polling with no rebroadcast and no exit. `isRetryableConfirmationTimeout` (`failure.ts:203`) is currently cosmetic.

Direction: throw after N timeout windows so the retry-budget machinery applies (or fix both docs), and add an eviction/unknown-status bailout for ambiguous broadcasts.

### C3. medium — Bot: output-slot budget ignores base-transaction outputs (livelock risk)

`packages/bot/src/runtime/transaction.ts:144` computes `outputSlots = 58 - tx.outputs.length` on the match-only transaction; `buildBaseTransaction` (`packages/sdk/src/client/sdk_base.ts:118-153`) later adds withdrawal-request, order-collection, receipt-completion, and ready-withdrawal outputs. Overflow is caught only post-hoc (`transaction.ts:60`) as an `output_limit` skip discarding all actions; receipts persist in account state, so the skip can repeat every iteration. Untested scenario.

Direction: budget slots after adding base steps (or subtract their known output counts) and degrade gracefully (trim partials / drop rebalance) instead of skipping wholesale. Document overflow behavior in the policy doc (line 33 area).

### C4. medium — SDK: per-bot 2000-CKB reserve double-debited for bots with ready withdrawals

`packages/sdk/src/conversion/sdk_value_helpers.ts:97-104` and `:13-22`, used at `packages/sdk/src/client/sdk_l1_class.ts:166-185`: `addBotCkb` seeds every map key with `-2000` CKB, so a bot with ready withdrawals is debited once in `botWithdrawalCkb`'s `ready` map and again via `mergeBotCkb`, skewing `system.ckbAvailable`. No test asserts the reserve amount.

Direction: apply the reserve once per bot lock explicitly in `getCkb`, name the constant, pin with a test.

### C5. medium — Interface: post-broadcast storage failure hangs the action UI

`apps/interface/src/query/pendingTransactionQuery.ts:110-128, 218-230`: if `writeStoredTransactionHash` throws after successful broadcast, the two-arg `.then` fulfillment handler throws, `completion` never settles, and `transact()` awaits forever with the cache stuck in `"submitting"` (button disabled, no failure surfaced). Related docs defect: `apps/interface/README.md:45` claims the hash is not persisted across reloads, but the code writes and hydrates `ickb-pending-transaction:v1` from localStorage.

Direction: wrap the fulfillment body in try/catch (resolve with the hash even if persistence fails, or reject explicitly); update the README.

### C6. medium — Validation/scripts: relative log-root resolution writes inside the source tree

`repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url))` duplicated at `packages/validation/src/supervisor/runtime/shared/supervisorConstants.ts:34` and `.../stimulus/shared/liveBotStimulusConstants.ts:17`. Stray runtime output at `packages/log/validation/...` and `packages/validation/src/log/validation/...` proves it misfired (the stray `summary.json` records the resulting ENOENT failure), hidden by the unanchored `log/` rule at `.gitignore:9`. Confirmed independently by three reviewers.

Direction: inject `rootDir` from the app entrypoint (alongside `actorEntrypoints`), anchor the gitignore to `/log/`, delete both stray directories.

### C7. medium — Tester: documented dust scenarios are unreachable

`packages/validation/src/tester/planning/testerAttemptEstimate.ts:30-39`: the unconditional `10n * feeRate` maturity-fee gate always skips 1-shannon plans from `testerScenarioPlans.ts:172-184`, so `dust-ckb-conversion`/`dust-ickb-conversion` always end in `estimated-conversion-too-small`, making the supervisor's `tester_dust_order_created` outcome (README line 111; `supervisorTesterClassification.ts:292-300`) dead. The surprising behavior is untested.

Direction: exempt dust scenarios from the actionability gate, or document them as refusal-path validators and remove the dead supervisor classification; add one attempt-level test pinning the end state.

### C8. medium — Dynamic loop: stop reason recovered by regex over child stdout

`scripts/supervisor/dynamic-loop/runtime.ts:443-453, 224-234` regex-matches `/^loop stopped reason=(\S+)/` against delegated supervisor-loop stdout; a `formatRunLine` change or 1 MB `maxBuffer` truncation (`dynamic-loop/command.ts:29` — truncation drops exactly the trailing stop line) turns an expected `max_runs` stop into a session-killing "unexpected" one. Related: prebuild typecheck timeout aliased to the 65-minute child timeout (`scripts/supervisor/loop/model.ts:24-25`), and the same typecheck reruns in every delegated chunk (N+1 times).

Direction: have the loop write machine-readable `loop-summary.json` into its out-root and read that; give prebuild its own small timeout constant plus a `--skip-prebuild` passthrough for delegated chunks.

### C9. medium — Supply-chain pinning gaps

- `pnpm-workspace.yaml:32-53`: 20-entry `minimumReleaseAgeExclude` block annotated "Remove after 2026-07-24" is past due; with `minimumReleaseAgeStrict: true`, stale exclusions quietly widen the window.
- `package.json:39`: `"@typescript/native-preview": "latest"` lets the typechecker float on install refresh, at odds with SHA-pinned actions and integrity-suffixed `packageManager`.

### C10. low — Smaller confirmed items

- `packages/order/src/order.ts:94-101`: reported `ckbFee` can go negative from floor/ceil double rounding (e.g. `ckbScale=5, udtScale=53, amount=1, fee=1, feeBase=1000` gives `-1`); clamp at `0n` or document the sign convention.
- `packages/core/src/udt.ts:119-135`: `completeChangeToLock` can append a UDT change output past the 64-output DAO limit without `assertDaoOutputLimit` on the manual-completion path (SDK re-asserts; the documented lower-level path has no guard).
- `packages/core/src/udt.ts:362-373` vs `ickb_logic/src/entry.rs:121-126`: TS never asserts the contract's `u64::MAX` output-amount cap (unreachable with real supply; fail-fast assert suggested).
- `packages/sdk/src/estimate/sdk_estimate.ts:30-32`: rethrows `OrderConversionRepresentabilityError` with no message/cause, losing context — notable given the recent error-transparency commits.
- `packages/sdk/src/withdrawal/withdrawal_selection.ts:116-152`: cached exact-count selector is sound only under an undocumented, unasserted maturity-bucket monotonicity invariant of the exported function.
- `packages/sdk/src/conversion/sdk_conversion_plans.ts:88-107`: reported `lastFailure` reason is an artifact of Map insertion order.
- `packages/bot/src/runtime/transaction.ts:321`: `reserveRecoveryThreshold` hardcodes `1000n * fixedPointFrom(1)` instead of importing `CKB_RESERVE` (`policy/constants.ts:4`); silent desync risk.
- `packages/validation/src/tester/runtime/testerErrors.ts:66-72`: retryability classification matches `error.name` as a string against a module-private class; a rename silently reclassifies confirmation failures.
- `packages/node-utils/src/logging.ts:12`: symbols typed as JSON-line-safe but silently dropped by `JSON.stringify`.
- `packages/node-utils/src/process.ts:142-160`: each `runProcess` without `signalContext` installs fresh SIGINT/SIGTERM handlers; >10 concurrent invocations trip MaxListenersExceededWarning.
- `packages/testkit/src/index.ts:44-61`: `StubClient` falls through unstubbed methods to a real testnet client at `https://example.invalid` (slow network failure instead of an immediate descriptive throw).
- `packages/core/src/logic.ts:96-98`: `deposit` silently no-ops on negative `depositQuantity` and skips `assertDaoOutputLimit` on that early return.
- `apps/interface/src/action/Action.tsx:101`: `hydratePendingTransaction` mutates external state during render (unsafe under concurrent rendering, though idempotent).
- `scripts/supervisor/dynamic-loop/model.ts:42`: `MAX_SUPERVISOR_COMMANDS_PER_DYNAMIC_CHUNK = 6` hardcodes supervisor-per-cycle command count in scripts; export it from `packages/validation` instead.
- `packages/validation/src/supervisor/stimulus/selection/liveBotStimulusEventScan.ts:362-376`: `KNOWN_BOT_EVENT_TYPES` closed allowlist makes any new bot event type a hard "malformed evidence" failure; also filtered/overflow lines all count as `malformedLineCount`, producing inaccurate incident reasons.

## Test blind spots (protocol-critical)

- `packages/core/src/udt.ts:393-404`: the 10% above-cap discount branch of `ickbValue` is never exercised — `ICKB_DEPOSIT_CAP` appears in no test; all core fixtures use identity `AR_0`; several expectations call the function under test against itself (`core/test/cells/cells.ts:195,260,318,388`; `owned_owner_find_filters.ts:208`). Add golden-value tests with realistic AR and above-cap amounts.
- `packages/core/src/udt.ts:416-427`: no test pins `convert` truncation direction for non-divisible amounts or round-trip loss (`convert(false, convert(true, x)) <= x`), which sdk/bot pricing relies on.
- Order min-match tests: 1:1 ratios only (see C1).
- Coverage-policy inversion: the root `vitest.config.mts:20-25` 100% mandate drives test bloat (validation ~14k test lines for ~7.3k supervisor source, including `coverage/`-named directories and tests of test fixtures, e.g. `test/supervisor/runtime/coverage/fixtureBranches.ts:7-59`; sdk 72 test files, many single-scenario), while the 9.2k-line `scripts/test/` suite has no coverage enforcement at all. Pick defensible per-project thresholds and make rigor consistent.
- `packages/utils/test/utils.ts:215-232`: binary search boundary cases (`n = 0`, `n = 1`, all-true) untested; `asyncBinarySearch` has a single case.
- Bot: the base-transaction output-overflow scenario (C3) is the one untested policy behavior; policy doc otherwise matches code clause-for-clause.

## Simplification opportunities

Dominant diagnosis across reviewers: much of the repo's mass is generated by fighting its own tooling.

1. **Lint-workaround idioms (repo-wide).** The `...[a, b, c]: [a: A, ...]` tuple-spread idiom (defeating `max-params: 4`, `eslint.config.mts:167`) appears in ~40 validation functions, sdk (`sdk.ts:124`, `sdk_estimate_core.ts:7`, `withdrawal_best_fit_support.ts:135`), and order — including the 12-positional-bigint `OrderMatcher` constructor (`order_matcher.ts:6-98`), the exact transposition-error shape behind C1. `Object.assign(state, {...})` (defeating `no-param-reassign {props: true}`, `eslint.config.mts:171`) appears 51 times in validation. Fix the two rules (context objects / options objects / scoped exemptions); hundreds of lines and real risk removed.
2. **Entity triple-declaration boilerplate.** Interface + anonymous class + hand-maintained typed const (~60-90 sync-prone lines each, with eslint suppressions): `order/src/model/{info,ratio,relative,order_data}.ts`, `core/src/entities.ts:25-96,122-203`, `sdk/src/sdk.ts:120-199` (~70 removable lines). Export classes directly or one shared `EntityConstructor<T, Like>` helper.
3. **Validation package: est. 25-35% shrink.** The `stimulus/` subtree is a parallel mini-framework duplicating supervisor utils/constants (`liveBotStimulusUtils.ts:56-139` re-implements `stringField`/`isRecord`/etc.; event names and `TX_HASH_PATTERN` duplicated; `findLastIndex` re-implements ES2023). Two hand-rolled ~530-line arg parsers vs Node 22 `util.parseArgs`. `writeSummary` takes 9 positional args unpacked identically at 8 call sites. 30-module `export *` barrel (`supervisor/index.ts`) consumed only by tests. Duplicate evidence pipeline in `supervisorBotClassificationB.ts:305-338`. Tester slice: 15-20% layering overhead (re-plan/re-estimate of the auto-resolved winner in `testerPlanning.ts:70-124`, no-op `ExecutionLogWriter`, test-only barrel, duplicated predicates).
4. **Scripts: est. 3-5k line shrink.** Bespoke per-module DI (~50 `dependencies.X ?? defaultX` sites) exists purely for test fakes; `isRecord` ×7, `displayPath`/sleep/ENOENT/`errorMessage` duplicated between loop layers just under jscpd's 12-line threshold; key/URL validation triplicated across `scripts/live/config` and node-utils. The four-layer loop stack (dynamic-loop → supervisor-loop → supervisor → actors) is one layer too many: merging dynamic-loop into supervisor-loop as a mode deletes C8's stdout contract and the chunk-timeout derivation. Seven entry files repeat the `pathToFileURL` guard under two competing conventions (note confusing siblings `scripts/live/config-from-env.ts` vs `scripts/live/config/config-from-env.ts`).
5. **Tooling pipeline.** 13 near-identical `vitest.config.mts` files, some hand-enumerating test dirs so new folders silently stop running; 13×2 per-workspace `lint`/`test:ci` scripts nothing invokes; `pnpm check` runs `clean:deep` (deletes all `node_modules`) every invocation; CI matrix reruns node-version-independent lint twice with no pnpm caching or concurrency group; the stage list is duplicated between `lint` and `lint:inspect` (`package.json:12-13`); the 2,426-line custom structure linter has rows already marked deferrable in `docs/lint-policy-map.md`.
6. **Small duplications with single-home fixes.** `getTransactionWithHeader` ×3 (`dao/src/cells.ts:306-316`, `core/src/udt.ts:290-316`, `core/src/cells.ts:100-108`); input-uniqueness assertions ×3; deposit re-validation ×3 (`logic.ts:295-303`); `utils.collect` re-implements `Array.fromAsync`; `sumUdtValue` and maturity sort duplicated in sdk; `minBigInt` ×3 and `emptyMatch` ×2 in order; dead public exports (`timerDelayMs`, `parseRuntimeConfig`, `pagedScanCursorErrorCode`, `Ratio.applyFee`, testkit passthroughs); `collectCellsPaged` cached-mode dedup is O(cached × fetched) — use a hex `Set` (`utils/src/utils.ts:137-146`).
7. **Interface.** Boolean-flag explosion in action status (~10 flags through a 16-field params object, `actionStatus.ts:5-42`, `Action.tsx:130-190`) → one discriminated-union phase; `shared/quote.ts:26-36` hardcodes SDK default fee constants; `queryStateId.ts:3-56` structurally mirrors SDK types instead of importing; rawText re-parsed in five places; trivial single-use modules (45 files < 60 lines) mergeable.

## Architecture

Sound baseline: acyclic `workspace:*` graph (`utils` leaf; `core → dao,utils`; `sdk → core,dao,order,utils`; private `bot`/`validation → sdk,core,order,node-utils`), source-first exports with `dist/` only for the 5 published packages, api-extractor wired, barrel tests pinning the public surface, JoyID patch verified still live and justified. Adjustments worth making:

- Fold `apps/bot` (172-line adapter) into `packages/bot` and `apps/validation` (3 files) into `packages/validation`: both packages are `private: true`, so the split has no publish payoff and costs two workspaces of scaffolding.
- Move `process.exitCode` writes out of `packages/bot` core (`loop.ts:199`, `failure.ts:137,144`) — return a typed stop reason, let the CLI map exit codes. Same for env/config reading (`packages/bot/src/index.ts:17-21`).
- Scripts import `packages/validation` deep internals (`dynamic-loop/scenario.ts:1-5`); re-export needed symbols from the package index. Supervisor hardcodes `scripts/live/preflight.ts` (`supervisorPreflightStep.ts:72`) while other entrypoints are injected — inject `preflight` too.
- Move the root README operator runbook (lines 54-111) to `docs/operations/` with pointers; document or drop the unmentioned-but-maintained `pnpm live:generate-config`.
- Hygiene: delete stray `packages/log/` and `packages/validation/src/log/`; anchor `.gitignore` `log/`; gitignore-or-clean sdk's stale `coverage/`, `dist/`, `temp/`; empty dirs `scripts/build/`, `scripts/lint/source-structure/`; stale `.prettierignore` entries; decide fate of untracked `docs/reviews/` snapshots (this file included) — keep `docs/lint-policy-map.md`, consider ignoring the snapshots.
- Minor: react override pin vs `^` range coupling (`pnpm-workspace.yaml:28-29`); shared tool versions (typescript, react) belong in the catalog; private packages carry publish-shaped metadata (trim to testkit shape); `dao.isWithdrawalRequest` should accept `CellAny` like `isDeposit`; export `receiptCellFrom` or mark it internal deliberately.

## Verified-clean areas

Recorded so the findings above are read against the right baseline: AR conversion/cap/discount math bit-identical to `ickb_logic` (`AR_0 = 1e16`, cap, `excess/10`, floor directions); receipt quantity×value accounting and prefix-tolerant decoding; owned-owner Int32 distance/pairing; DAO phase-1 index/lock-size/header shapes, phase-2 `since`/witness, 64-output rule, one-cycle maturity roll (boundary-tested); order wire layout, zero-padding, concavity guard, match rounding always contract-satisfying; confusion-attack resolver + attestation boundary (closes audit LO-01 hand-pairing); `completeTransaction` DAO-limit retry; `waitTransaction` abort/timeout/late-settlement; complete-scan cursor enforcement (`cellPageSize` is purely a page size, matching the README); `binarySearch` Go-`sort.Search` invariants; `formatCkb` correctly not replaced by CCC's (which mishandles negatives); bot policy layer matches the policy doc clause-for-clause except C2 (verified: 21/20 shutdown threshold, allowance/floor derivation, decision ordering, under-coverage formula, no-op reasons, reserve-check recovery exception); tester reserve math and chain-derived 180-block mint protection (restart-safe, stateless); `runProcess` group cleanup/SIGKILL escalation/signal mapping; launcher abstract-socket locking and boot-ID identity binding; systemd scripts' fail-closed checks with rollback; chunk-timeout floor arithmetic mirrors the delegated loop exactly; dynamic-loop docs ("six windows plus 60 seconds") accurate; knip covers all script entry points; interface abort/ownership discipline and exact-bigint money paths (floats confined to the chart).

## Suggested order of attack

1. C1 order-matcher conversion + asymmetric-ratio and independent-oracle tests.
2. C2 confirmation-timeout/retry-budget reconciliation + ambiguous-broadcast bailout.
3. C4 SDK bot-reserve double-debit (+ pin with test), C3 output-slot budgeting.
4. C6 log-root injection + stray-directory cleanup; C9 supply-chain pins (both are one-liners).
5. ESLint rule fixes (max-params context objects, no-param-reassign exemptions) — unlocks the bulk of mechanical shrinkage in validation/sdk/order cheaply.
6. Coverage-policy rework, then the validation/scripts consolidation (stimulus subtree, parseArgs, loop-layer merge) and vitest/CI pipeline cleanup.
