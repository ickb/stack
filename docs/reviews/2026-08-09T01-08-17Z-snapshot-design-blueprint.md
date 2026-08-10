# Design Blueprint Snapshot — The Better Version

## Scope

- Checkout: `/var/home/user/Projects/ickb/stack`, branch `wip` at `ca51bf88d57887fcc554f8697939e0560e9ef2ab`.
- Companion to the defect-focused snapshot `2026-08-09T00-33-53Z-snapshot-whole-repo-parallel-review.md` (referenced below as "the defect review", findings C1-C10). This report does not re-list defects; it designs the target shape of the stack.
- Premise set by the maintainer: the library is **unpublished** (breaking API changes are free), the on-chain **contracts are fixed**, primary published-package audience is **wallet/dApp integrators**, a single packaging recommendation was requested, **dev-dependencies are acceptable but published packages stay near-zero-dependency** (CCC only), and the **100% coverage mandate stays** — proposals work within it.
- Method: six parallel design reviewers (consumer-driven API, domain modeling/type safety, workspace/pipeline blueprint, error+observability model, bot/validation runtime, testing strategy) plus four deep exploration maps (event/log contract surfaces, app-boundary error handling, validation harness anatomy, config-surface catalog). All current-behavior claims were verified against the cited files; two proposals were additionally verified by execution (the entity-pattern compilation check against CCC typings, and the matcher counterexample).
- Role boundary: review only. No source, test, or configuration files were modified; this report is the only artifact written.

## Design thesis

Every real consumer of the SDK executes the same pipeline — sample L1, project availability, plan, complete, sign/send, wait — yet the surface exposes it as six free-floating steps whose consistency is the caller's problem. Every prior money bug is a convention failure (direction booleans, positional bigints, hidden constants) that types could have caught. The private runtime's mass comes from five process layers, duplicated wire contracts, and hand-rolled plumbing that one shared contract module and two fewer layers would delete. The better version is built around four moves:

1. **One consumer-shaped entry object** (`Snapshot`) that owns the invariants callers currently hand-thread.
2. **Conventions promoted into types** (direction-named conversions, branded amounts, result unions, discriminated states).
3. **One contract module and fewer processes** on the private side.
4. **A test bed adjudicated by the contracts themselves** (independent oracle, properties, real-binary execution) layered on top of the retained 100% mandate.

---

## 1. Published surface — consumer-driven API redesign

Evidence base: all three transaction-building consumers duplicate the same glue (`apps/interface/src/query/queries.ts:96-101`, `packages/validation/src/tester/runtime/runtime.ts:82-94`, `packages/bot/src/bot/state.ts:13-31`); no consumer ever calls `getL1State`/`getAccountState`/`getPoolDeposits` directly — only `getL1AccountState`; the interface maintains a 180-line structural mirror of SDK types solely to build a cache key (`apps/interface/src/query/queryStateId.ts`); the bot carries a parallel `managers` object because the SDK hides its own as `protected` (`packages/bot/src/runtime/types.ts:13-16`); `cellPageSize` is plumbed through ~10 signatures and set by no one; two direction vocabularies coexist (`isCkb2Udt: boolean` in 8+ APIs vs `"ckb-to-ickb" | "ickb-to-ckb"` at `sdk_types.ts:25`).

### A1. `IckbSdk` + `Snapshot` replace the class tower and the manual context pipeline

One entry object bound to `{deployment, client, tuning}`, constructed in one step (`ickbSdk("mainnet", {client})`), with **public** managers. One `Snapshot` value per L1 sample that carries:

- `id` — deterministic identity over tip/feeRate/ratio/pool/cells/orders/withdrawals (generalizing `PoolDepositState.id`, `sdk_types.ts:37`; deletes the interface's `queryStateId.ts` mirror);
- `tip`, `feeRate`, `exchangeRatio`, `system`, `account` — all derived from the same tip, so the tip-consistency invariant becomes unrepresentable as a caller bug;
- planning methods: `estimate(direction, amount)`, `planConversion(direction, amount)`, `planCollect()`, `buildBaseTransaction(tx)` (escape hatch), `ring()`.

The 3-level inheritance chain (`IckbSdkBase → IckbSdkConversion → IckbSdkL1 → IckbSdk`) is file-splitting via inheritance — it holds one abstract member nothing calls (`sdk_conversion_class.ts:32-38`) and forces the triple type declaration at `sdk.ts:60-199`. Collapse to one class (or factory + interface) delegating to plain internal modules. `snapshot()` samples the tip first and runs system+account scans concurrently (fixing the strictly-sequential scan at `sdk_l1_class.ts:115-116`).

### A2. Result unions everywhere planning can fail; one direction enum; plain-bigint amounts

`estimate` currently throws `OrderConversionRepresentabilityError` while its sibling returns `undefined`, and both consumers convert the throw back into "no result" by matching `error.name` strings (`apps/interface/src/shared/quote.ts:38`, `testerOrderPlanning.ts:185-187`). The call sites have voted: estimation is a total function.

```ts
type EstimateResult =
  | {
      ok: true;
      output: bigint;
      ckbFee: bigint;
      maturity: MaturityEstimate;
      notice?: ConversionNotice;
    }
  | { ok: false; reason: "unrepresentable" | "amount-too-small" };
```

`planConversion` returns `{ok: true, tx, complete(signer)}` or `{ok: false, reason}`; `complete` defaults `feeRate` to the snapshot's value — every current call site passes exactly that (`transaction.ts:90-93`, `runtime.ts:132-135`, and the bot's closure at `apps/bot/src/index.ts:143-144` exists only to erase the parameter). One `Direction` type replaces the boolean/string split and the consumer-written bridges (`planAmounts`, inline ternary pairs).

### A3. Transaction lifecycle: `SentTransaction` handle; options-object `waitTransaction`

Both consumers wrap `waitTransaction` in the same retry loop, classifying window-timeout by exception sniffing (`actionTransaction.ts:183-202`, `loop.ts:298-352`), and the interface must pass a positional `undefined` to reach the sixth argument. Redesign: `sendTransaction` returns `{txHash, wait(options)}` where one polling window resolves `undefined` on timeout (loop-friendly) and throws only for terminal states. This also gives the bot's C2 fix (confirmation budget) a natural home.

### A4. Snapshot-free quote for wallets

A display quote today requires three packages and a copied fee constant (`quote.ts:26-36` hardcodes the SDK default `{fee: 1n, feeBase: 100000n}`, which appears unnamed in five places). Ship `quoteConversion(direction, amount, tipHeader)` plus exported `DEFAULT_ORDER_FEE`/`DEFAULT_ORDER_FEE_BASE`. For the stated wallet-integrator audience this is the single highest-leverage convenience API.

### A5. Publish the invariants consumers currently guess

- `availableOutputSlots(tx, snapshot)` and exported `DAO_TX_OUTPUT_LIMIT`/`MAX_DIRECT_DEPOSITS` — deletes the bot's hand-carried `MAX_OUTPUTS_BEFORE_CHANGE = 58` guess, the root of defect C3.
- `snapshot.ring(): RingAnalysis` — the aggregate the bot rebuilds from five flat exports (`bot/policy/ring.ts:122-189`), moving the cross-package invariant documented at `ring.ts:95-98` inside the boundary that owns it.
- Merge `AccountState` + `AccountAvailabilityProjection` into one `AccountPortfolio` with a single balance-derivation site (structurally prevents C4-style drift).

### A6. Naming and dead surface

`collect` → `collectOrders`, `request` → `placeOrder` (drop the unused `Signer` overload and its forced `async`, `sdk_base.ts:89-98`); config key `logic` vs param `ickbLogic` unify; `cellPageSize` moves to construction options and vanishes from every method signature; drop the never-called `IckbSdk.maturity` static and the abstract `getPoolDeposits`.

### A7. Packaging: one published package — `@ickb/sdk` with subpath exports

Recommendation (requested): merge `utils + dao + core + order + sdk` into a single published `@ickb/sdk` with subpaths `./core`, `./order`, `./dao`. Rationale from evidence: all five version in lockstep (`1001.0.0`, `workspace:*`, one release train — independent semver was never real); the interface (best proxy for an external dApp) needs 4 of the 5 packages to render a UI; `@ickb/dao` has zero direct app consumers; `sideEffects: false` ESM with subpaths preserves bundler granularity; api-extractor runs once per entry point (4 small configs replacing 5). `@ickb/utils` becomes `src/internal/`. The re-export set at the root should cover the handful of core symbols consumers actually reach for (`ickbExchangeRatio`, `convert`, `ICKB_DEPOSIT_CAP`, `unique`) so a wallet needs one import. Escape hatch: `./order` keeps a coherent internal boundary (depcruise-enforced), so if a real generic-sUDT audience appears post-v1, extracting `@ickb/order` is a `git mv` plus one manifest — extract on demand, not on speculation.

---

## 2. Domain model — make the known bug classes unrepresentable

The three historical money bugs are type-system failures: C1 hand-inlined a ratio formula with scales transposed; the 12-positional-bigint `OrderMatcher` constructor makes transposition invisible; C4 hides a `-2000` CKB constant inside a non-associative map accumulator. The codebase already uses the right idioms elsewhere (`ConversionTransactionResult` union, `isDeposit: true/false` discriminants) — it just doesn't apply them to direction, units, rounding, or UI phase.

### T1. Direction-named, rounding-typed conversion methods — the only place the formula exists

```ts
type Rounding = "floor" | "ceil";
class Ratio {
  udtFromCkb(ckb: Ckb, rounding: Rounding): Udt; // the ONLY amount·ckbScale/udtScale
  ckbFromUdt(udt: Udt, rounding: Rounding): Ckb; // the ONLY amount·udtScale/ckbScale
}
// order_matcher.ts:209 becomes, un-invertibly:
const bMinMatch = ratio.udtFromCkb(info.getCkbMinMatch(), "ceil");
```

Replaces `convert(isCkb2Udt: boolean, amount, mustCeil: boolean)` (`ratio.ts:31/187-206`; the call `base.convert(false, x, false)` at `order.ts:99-100` is unreadable) and the three additional hand-rolled variants (`order_matcher.ts:209`, `nonDecreasing` at `:228-232`, core `convert` at `udt.ts:416-427`). Enforceable invariant: `ckbScale`/`udtScale` appear in arithmetic only inside these methods. This is the C1-class kill.

### T2. Branded amounts at package-public boundaries

`type Ckb = bigint & {__brand?: "ckb"}`, `Udt`, `UnixMs` — zero runtime cost, applied to public signatures, persistent struct fields (`ValueComponents`, whose two `bigint` fields currently swap without complaint), and codec smart constructors. Raw `bigint` stays legal in loop-local accumulators; brand at `return`. The matcher's deliberately symmetric core instead gets side brands (`Amt<"give">`/`Amt<"take">`) with named-field factories `OrderMatcher.forCkb2Udt(group, fee)` / `forUdt2Ckb(...)` replacing the 12-positional constructor.

### T3. Single-declaration entity pattern (compilation-verified)

The interface + anonymous class + hand-typed const triple declaration (~70 sync-prone lines per entity at `core/src/entities.ts`, `order/src/model/*.ts`, `sdk/src/sdk.ts`) collapses to one class + a shared generic:

```ts
class ReceiptDataImpl extends ccc.Entity.Base<ReceiptDataLike, ReceiptDataImpl>() {
  static { ccc.codec(ReceiptDataCodec)(this); }
  ...
}
export type ReceiptData = ReceiptDataImpl;
export const ReceiptData: EntityClass<ReceiptDataLike, ReceiptDataImpl,
  ConstructorParameters<typeof ReceiptDataImpl>, { decodePrefix(e: ccc.Hex): ReceiptDataImpl }> = ReceiptDataImpl;
```

Both this and the plainer direct-class-export variant were compiled against the repo's CCC 1.17 typings with strict declaration emit — both work; the `EntityClass` variant additionally hides the `Entity.Base` statics. Remaining check when applying: api-extractor's handling of the unexported impl referenced by the alias.

### T4. Lawful ledger for the bot reserve; named constant

Separate the mergeable monoid (per-lock CKB contributions) from the one-shot adjustment (reserve, applied exactly once by `netBotCkb(contributions)` with exported `BOT_CKB_RESERVE`). Kills the C4 class: constants hidden in accumulator defaults, and merge-of-already-adjusted-maps bugs.

### T5. Discriminated unions where boolean combinations encode state

- `MaturityEstimate = {kind: "immediate"} | {kind: "at"; time: UnixMs} | {kind: "unknown"; why: ...}` — replaces the `0n` sentinel and two distinct `undefined` meanings (`sdk_maturity.ts:11-26`).
- `OrderPrice = {kind: "ckb2udt" | "udt2ckb" | "dual"; ...}` with `PopulatedRatio` — makes `Info`'s empty-ratio sentinel and its four runtime validation throws unreachable above the codec boundary (wire layout unchanged; contracts fixed).
- DAO readiness unions (`{status: "renewable" | "locked" | "claimable" | "maturing"}` + `evaluatedAt: TipRef`) — one boolean currently carries two different semantics (`dao/src/cells.ts:27-39`).
- Interface `ActionPhase` union (`no-state | entering | previewing | ready | preparing | submitting | confirming | failed`) replacing the 16-field, 8-boolean message-params matrix (`actionStatus.ts:5-22`, `Action.tsx:344-364`) — the C5 hang is a stuck-flag-combination bug this machine cannot express.
- `FeeFraction.of(fee, feeBase)` value object — validates once, cannot be transposed or half-supplied (`ratio.ts:134-167`, three layers of independent defaults).

---

## 3. Workspace, pipeline, publish

Target: **7 workspaces** from 14 — `packages/sdk` (published, merged per A7), `packages/node-utils`, `packages/testkit` (kept separate: its prod-import ban is a depcruise rule that merging would destroy), `apps/bot` (absorbs `packages/bot`), `apps/validation` (absorbs `packages/validation`), `apps/interface`, `apps/sampler`. `packages/log` deleted (runtime debris, defect C6). Private manifests trimmed to testkit shape.

Pipeline redesign, in dependency order:

1. **Fix the two bloat-generating ESLint rules first** — `max-params` satisfied via options objects (an object is one param: the workaround becomes the fix), `no-param-reassign` `props: true` dropped for designated mutable-state modules via scoped `files` override. Do this before any `git mv` so clean code moves.
2. **One root vitest config, zero per-package files** — inline projects generated from workspace globs, recursive `test/**` includes (ends the silently-skipped-directory class from 13 hand-enumerated configs). Coverage: the 100% mandate is retained per maintainer decision; scope it precisely to `{packages,apps}/*/src/**` with the `test/` directory convention as the only exclusion, which removes the incentive for fixture-branch tests without lowering any threshold (see §6).
3. **Two-lane check**: `check` = typecheck + prettier + eslint (all `--cache`) + structure-lint + depcruise + knip + `vitest run` — never touches `node_modules`; `check:deep` adds frozen install, audit, build, api-extractor, publint/attw `--pack`, coverage run, jscpd. `clean:deep` becomes a manual escape hatch. `lint`/`lint:inspect` derive from one stage array.
4. **CI**: three parallel jobs (lint on one node version; test matrix 22/24; build + api + publish dry-run) with pnpm store caching and a concurrency cancel group — replaces the current 2× full-`pnpm check` matrix with no caching.
5. **Structure linter 2,426 → ~800 lines** via three-way split: rules that die with the 7-workspace layout; rules that become local ESLint rules (typed AST, editor feedback); rules that stay custom (git-index/YAML/manifest surfaces). Workflow-YAML rules delegate to zizmor in CI.
6. **Publish story**: fixed versioning, changesets for changelog discipline, release workflow with `id-token: write` (manifests already declare `provenance: true` with no workflow able to honor it); **turn api-extractor reports on** (`apiReport.enabled` is currently `false`) and commit `etc/*.api.md` so PR diffs review the public surface; deliberate v1 version choice (`1001.0.0` is a placeholder); root README = orientation + map, operator runbook moves to `docs/operations/`.
7. **Scripts absorbed by their owners**: launcher/systemd/incident → `apps/bot`, supervisor/live loops → `apps/validation` (fixes the deep-internal imports and the `MAX_SUPERVISOR_COMMANDS_PER_DYNAMIC_CHUNK` ownership inversion); `scripts/` keeps only build/lint tooling; one entry-point convention; `run-node-tests.ts` deleted in favor of a `scripts` vitest project.

---

## 4. Error model and observability contracts

Evidence base (exploration maps): six ad-hoc error classes across five packages, only one carrying a machine `code`; retryability decided by name-string matching; five independent re-implementations of the bot-event envelope check with real drift (the launcher accepts any `bot.*` prefix, the stimulus scanner requires a closed 13-type allowlist); 13 producer event-type literals re-declared 13 times on the consumer side, 7 of those constants themselves duplicated across two constants files, plus 6 more inline copies; ~18 tester wire-field strings duplicated raw between producer and consumer; `transactionShape` typed differently on the two sides (bot omits `outputsData`); three copies of the JSON log normalizer (`toJsonLogValue` not exported from node-utils, so the bot wrote its own); message-only flatteners at every CLI top-level catch (stack and cause lost exactly where a fatal infrastructure bug needs them), while the two accidental no-catch paths are the highest-fidelity fatal paths in the repo.

### E1. One error architecture

```ts
export type IckbErrorCode =
  | "utils/paged-scan-cursor" | "dao/output-limit" | "order/conversion-unrepresentable"
  | "sdk/tx-broadcast" | "sdk/tx-wait-terminal" | ...;   // namespaced, aligned with existing reason unions

export abstract class IckbError extends Error {
  abstract readonly code: IckbErrorCode;
  readonly retryable: boolean = false;                    // classification travels WITH the error
}
export function isIckbError<C extends IckbErrorCode>(e: unknown, code?: C): e is IckbError & { code: C };
```

Existing classes keep their rich fields and gain literal codes; bare `new Error("...")` throws in money-path validation get codes. All `isRetryable*` classifiers (bot, tester, node-utils) collapse into the `retryable` property plus one shared predicate — a rename can no longer silently reclassify confirmation failures (defect review, tester item). The published SDK documents the guarantee: everything thrown is `IckbError` with a stable `code`, `cause` chains preserved (continuing the intent of commits `e797e00`/`ff90fdd`/`7079c7b`/`1a84c56`; also fixes the context-losing rethrow at `sdk_estimate.ts:30-32`).

### E2. One events-contract module, hosted in `@ickb/node-utils`

`@ickb/node-utils` is the only module already reachable from bot + validation + scripts (validation does not depend on the bot package; scripts import node-utils by relative path) — the zero-new-dependency host. Per the maintainer's runtime-minimal directive, validators are hand-rolled (no zod), following the proven `testerContract.ts` precedent:

```
packages/node-utils/src/contracts/
  botEvents.ts       // the 13 type literals, envelope type + THE validator (one, versioned)
  launcherRecords.ts // LaunchRecordShape v3, the three launcher.* literals
  testerWire.ts      // skip reasons, scenario names, field names, transactionShape (one shape, with outputsData)
  outcomes.ts        // OutcomeKind, exit-code table, STOP_EXIT_CODE
  json.ts            // isRecord/stringField/numberField/recordField (one family; resolves the
                     // safe-integer semantic drift), TX_HASH_PATTERN, toJsonLogValue (exported)
```

Producer and every consumer import the same constants and the same validator; the closed-allowlist trap (new bot event type ⇒ hard "malformed evidence" failure) disappears because the list has one home. Deletes, by count from the maps: 5 envelope validators → 1, 3 log normalizers → 1, 14 `isRecord` copies → 1, 3 `TX_HASH_PATTERN` → 1, 2 `STOP_EXIT_CODE` declarations → 1, ~40 test-fixture literal copies retire to imports.

### E3. Emit once, preserve deliberately

- Bot events: emit `logValue` output directly (delete the stringify→parse→fromEntries triple pass at `events.ts:304-308`); build the decision transcript once per iteration (today twice per candidate plus 3× `summarizeBotState`); derive the balance-audit event from the already-computed classification instead of re-running the seven-step pipeline (`supervisorBotClassificationB.ts:305-338`).
- Fatal-path policy: top-level catches keep the one-line public message on stderr **and** preserve the full `toJsonLogValue` error (stack + cause chain) to the structured log; the retryable-error stack-dropping asymmetry (`includeStack: !retryable` on both bot and tester sides) becomes a deliberate, documented choice or is removed. The "no catch = best fidelity" accident (sampler, tester init) becomes intentional: catch, log structured, rethrow.
- Exit codes: packages never write `process.exitCode`; loops return typed stop reasons (`low_capital | retry_budget_exhausted | non_retryable | max_iterations | signal`), and the CLI adapter alone maps them through the shared `outcomes.ts` table. The currently-unrecoverable distinction (low-capital vs budget-exhausted both = 2) stays distinguishable in data.
- Interface: `errorMessageOf` falls back to `error.name` before object-stringify (fixes the `"{}"` render); the structured `transactionFailureMessage` pattern (reason/status/txHash preserved) becomes the norm for all failure surfaces, with `cause` chains logged to devtools at every boundary, not only `ErrorBoundary`.

---

## 5. Bot and validation runtime — the leaner harness

Evidence base (harness anatomy map): **five** nested process layers; the dynamic-loop recovers its child's stop reason by regex over human-readable stdout (`/^loop stopped reason=(\S+)/` — no shared constant, breaks under 1 MB `maxBuffer` truncation); the stimulus already calls the supervisor **in-process** yet still round-trips its result through `summary.json` on disk; `OutcomeKind` cannot cross into `scripts/`, so the loop re-validates summaries with a token regex; 9 hand-rolled arg parsers (~1,000 lines, 4 styles); 6+ paths configure the log root with tool-dependent precedence; four declarations of the same 5-second kill grace; two `repoRoot` climbs of `../../../../../../`; four copies of the bot entrypoint literal. In-scope total ≈ 48k lines (source + tests).

### R1. Bot loop as an explicit state machine

Keep the verified-good policy layer intact; redesign the shell around it:

```ts
type IterationState =
  | { phase: "read" }
  | { phase: "decide"; state: BotState }
  | { phase: "build"; decision: Decision }
  | { phase: "send"; tx: ccc.Transaction }
  | { phase: "confirm"; sent: SentTransaction; windowsUsed: number }
  | { phase: "settle"; outcome: IterationOutcome };

interface ConfirmationPolicy {
  windowMs: number;
  intervalMs: number;
  maxWindows: number | "unbounded";
}
type StopReason =
  | "max_iterations"
  | "low_capital"
  | "retry_budget_exhausted"
  | "non_retryable"
  | "signal";
async function runBotLoop(ports: BotPorts, policy: BotPolicy): Promise<StopReason>;
```

The confirmation budget becomes declared data instead of an inline `while` (resolving defect C2's doc/code contradiction in whichever direction is chosen, plus an explicit eviction/unknown-status bailout for ambiguous broadcasts). `BotPorts = { chain, clock, events }` — three ports replace scattered client calls, sleeps, and emitter threading, and are exactly the test seams the suite needs (see R4).

### R2. Five process layers → two

| Boundary today                                                                     | Target                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dynamic-loop → supervisor-loop (OS process, stdout-regex contract)                 | **library call** — both merge into `apps/validation` as modes of one loop; `OutcomeKind` becomes importable, deleting the regex contract, the token-pattern re-validation (`loop/summary.ts:131-213`), and the exit-code re-mapping table |
| supervisor-loop → supervisor (OS process, `stdio: "ignore"`, reads `summary.json`) | **library call** returning a typed `SupervisionResult`; `summary.json` remains as an operator artifact, not the API                                                                                                                       |
| stimulus → supervisor (already in-process, but round-trips `summary.json`)         | typed return value; deletes the second summary re-parser (`liveBotStimulusTesterRun.ts:88-148`)                                                                                                                                           |
| supervisor → preflight (3 independent spawn copies)                                | **library call** (it is repo-local TypeScript reading the same chain state)                                                                                                                                                               |
| supervisor → bot / tester actors                                                   | **stays an OS process** — genuine crash isolation, separate signing configs, and the production launcher parity argument all hold                                                                                                         |
| launcher → bot                                                                     | **stays** — independent production process, unchanged                                                                                                                                                                                     |

Result: the only spawn boundaries left are the two that isolate keys and crashes. The `stimulus/` parallel mini-framework dissolves into the supervisor proper (shared constants/utils per E2); the 9 arg parsers become one `node:util` `parseArgs` wrapper with per-command option tables (~70% reduction measured against the two 530-line hand parsers alone). Rough size arithmetic from the anatomy map: ~3.1k lines of loop scripts + ~3.4k stimulus + ~1k parsers + duplicated helper families collapse into the merged supervisor; a ~40-50% reduction of the ~19k-line non-test harness (validation src + supervisor scripts + launcher/incident) is realistic without touching the fail-closed classification core, which stays as-is.

### R3. One layered configuration system

The config catalog found: 5 paths to set an RPC URL (validated by 4 near-identical implementations), 4 paths to a private key (3 validators, `SECP256K1_ORDER` copy-pasted thrice), 6+ paths to the log root with tool-dependent precedence and a second disjoint output-root concept, 3 conflicting command-timeout defaults, 4 declarations of the 5-second kill grace, and a phantom env name (`LIVE_PREFLIGHT_CONFIG_FILE`) that labels a flag-sourced path. Target:

```ts
// @ickb/node-utils/config — ONE schema, ONE parser, layered resolution
resolveConfig(schema, {
  defaults,
  file: readJson(path),
  env: mapEnv(prefix),
  flags: parseArgs(spec),
});
// precedence: defaults < file < env < flags; unknown keys rejected at every layer
```

One `--log-root`/`ICKB_LOG_ROOT` pair with uniform precedence; one `TIMEOUTS` constants module (command, child, prebuild, kill-grace declared once); key/URL validation lives only in node-utils; `repoRoot` and actor entrypoints injected from the app layer (defect C6's fix, generalized); generator scripts (`config-from-env`, `generate-config`) shrink to thin emitters over the same schema.

### R4. Testing seams: four ports, everything else concrete

The DI-for-coverage pattern (~50 `dependencies.X ?? defaultX` fallback sites in scripts, inject-everything module interfaces in validation) is replaced by real interfaces for exactly: **chain client** (the `FakeClient` of §6), **filesystem root** (temp-dir tests already proven by the systemd suites), **clock**, **process spawner**. Behavioral tests survive unchanged in intent; the fallback-wrapper plumbing and its coverage-driven permutation tests are deleted. Within the retained 100% mandate this is the honest path: shrink the injectable surface instead of testing it.

---

## 6. Testing strategy — adjudicated correctness on top of the 100% mandate

Maintainer decision honored: the 100% lines/functions/branches/statements mandate **stays**. The redesign therefore does not lower thresholds; it changes what the tests prove and shrinks the surface the mandate applies to (via §§2-5), while scoping coverage strictly to `src/**` with the `test/` directory convention — which alone deletes the reason for the fixture-branch test genre (tests of test-support code count toward nothing). Verified enablers: `fast-check` and Stryker are not yet dependencies anywhere; the contracts repo ships current RISC-V release binaries (`contracts/scripts/build/release/{ickb_logic,limit_order,owned_owner,xudt}`, verified ELF) and a ckb-testtool Rust harness; sampler history recovers 27 real mainnet AR values exactly (`ar = CkbPerIckb·10^16 − 8.2·10^12`, genesis-checked).

### S1. Independent contract oracle (~80 lines, test-only)

Port `limit_order::validate` (47 lines of pure integer math) and `ickb_logic::deposit_to_ickb` (13 lines) line-for-line from the Rust into a test-only module that imports **nothing** from `order/src/matching` or `core/src/udt.ts`. Every match the TS matcher emits must return `"ok"`; every `ickbValue` result must equal `depositToIckb` bit-for-bit. The current "exhaustive oracle" inherits `matcher.bMinMatch` — the very constant C1 inverts — so it cannot disagree with the bug; this one cannot agree with it. Guard the independence with one structure-lint rule (oracle module may not import the implementation).

### S2. Property suite (fast-check, dev-dependency) on money paths

Arbitraries deliberately straddle both scale regimes (`ckbScale > udtScale` and `<`) plus mainnet-AR-derived ratios — C1 is invisible in the 1:1 regime the current tests inhabit. Properties: contract-satisfaction of every emitted partial (via S1), allowance-respect, monotonicity in allowance, rounding minimality (`bOut − 1` violates the value rule), `Ratio` concavity guard, codec round-trips, `convert` round-trip loss bounds, `ickbValue` cap-branch equality at realistic ARs (cap engages above ~117k CKB at current AR — reachable, currently never tested). Seeds pinned and env-replayable; nightly high-`numRuns` job on core+order only.

### S3. Golden vectors generated by the Rust side

One committed `protocol_vectors.json` emitted by a small bin in the contracts repo's existing test crate: `{ar, capacity, expectedIckb}` rows including exact cap boundaries, and `{ratio, minMatchLog, orderIn, orderOut, contractVerdict}` rows including the C1 counterexample. Provably contract-derived; survives refactors of both implementation and tests. The 27 recovered mainnet AR values join as a fixture (longer term: sampler emits raw `dao.ar` alongside `CkbPerIckb`).

### S4. `FakeClient` replaces `StubClient`

Extend the abstract `ccc.Client` (bounded surface, ~17 abstract methods — verified against CCC 1.14 typings) over an in-memory `ChainState` (cells, headers, transactions, tip, fee stats) with a declarative builder; unscripted calls throw a named error immediately instead of resolving DNS for `https://example.invalid`. Scenario composition becomes data (cell lists) instead of per-test handler wiring across the 53 current call sites; migrate package-by-package behind a deprecated `StubClient` shim.

### S5. Deterministic integration layer: execute the real contract binaries

A ~150-line serializer turns a built `ccc.Transaction` plus its `ChainState` into ckb-debugger mock-tx JSON; tests assert exit 0 (or a specific contract error for negative cases) per script group. This layer validates codecs, witness/`since` layout, output ordering, and the 64-output rule against the actual referee, offline, in milliseconds — and would have surfaced C1 as a hard `InsufficientMatch` failure. Highest value per line of any testing proposal; gate on ckb-debugger presence in CI with a cached install. With it in place, live-testnet validation demotes to a scheduled smoke of what no local layer can fake (wallets, fee market, mempool), capping the growth of the 18.7k-line live-test tree.

### S6. Suite mechanics under the mandate

One suite file per src module with `describe` blocks (sdk: 72 files → ~10; support imports become a tree, not a web, enforced by one structure-lint rule); shared fixtures live in a single `test/support/` per package; the `test/**/coverage/` directories are deleted outright (their subjects are excluded from coverage scope by the src-only rule); scripts join the vitest projects and the uniform mandate — made attainable by the §5 dedup shrinking them first, which is the honest cost of "100% everywhere" and is stated here deliberately rather than hidden. Mutation-testing spot-checks (Stryker, dev-dependency, nightly, scoped to `core/udt.ts` + `order/matching/**` + `ratio.ts`) verify the suite distinguishes executed-from-asserted — the exact blindness that let C1 live under 100% branch coverage.

---

## Sequencing

Phases are ordered so each unlocks the next; defect fixes from the companion review (C1, C2, C4, C6, C9 first) precede and are independent of all of this.

1. **Foundations** — ESLint rule fixes (max-params/no-param-reassign); `IckbError` + code union; export `toJsonLogValue`; `Ratio` direction-named methods + `Direction` type (T1/T3, small diffs, kills the worst bug class immediately).
2. **Test bed** — contract oracle + fast-check properties + golden vectors (S1-S3) so every later refactor lands on adjudicated ground; coverage scope tightened to `src/**`.
3. **API reshape** — `Snapshot`, result unions, public managers, `SentTransaction`, `quoteConversion`, published invariants (§1); entity pattern (T5); branded amounts at the new public boundary (T2).
4. **Workspace** — private consolidations, then the published-package merge, vitest/tsconfig collapse, two-lane check, CI graph, api reports on (§3).
5. **Runtime** — events-contract module (E2), config system (R3), process-layer collapse (R2), bot state machine (R1), observability single-pass (E3).
6. **Depth** — FakeClient migration, ckb-debugger layer, mutation spot-checks, live-testnet demotion (S4-S6).

## Open decisions for the maintainer

- **`@ickb/order` as a separate published package** vs a subpath of `@ickb/sdk`: this report recommends the subpath (audience evidence), with extraction kept cheap. If the generic-sUDT limit-order audience is strategically important now, extract at publish time instead.
- **v1 version number**: `1001.0.0` epoch continuity vs a clean `1.0.0` — depends on whether the old `@ickb/*` npm history should chain semantically.
- **Brand strictness**: optional brands (`__brand?:`) are adoption-free but advisory; required brands are safe but force smart-constructor calls at every wire edge. Recommendation: required on `Ckb`/`Udt` in the merged package's public surface, optional internally.
- **Confirmation-timeout policy direction** (C2): bounded windows counting toward the retry budget (docs as written) vs unbounded waiting (code as written) — the state-machine redesign implements either, but one must be chosen.
- **How far the process collapse goes**: this report keeps actor spawns (bot/tester) as real processes; an even leaner variant runs the tester in-process too, trading crash isolation for another ~1-2k lines. Not recommended while the tester signs with a distinct key.
