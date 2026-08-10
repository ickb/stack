# Overhaul Decisions Snapshot

## Scope

- Records the maintainer decisions from the 2026-08-09 design discussion, point by point.
- Supersedes the corresponding proposals in `2026-08-09T01-08-17Z-snapshot-design-blueprint.md` where they differ; everything not amended here stands as written there.
- Baseline for comparison: tag `pre-rewrite-baseline` (commit `42a090c`), worktree at `../stack-baseline`.
- Constraint set: nothing is frozen except the on-chain contracts; published packages stay near-zero-dependency (CCC only); dev-dependencies acceptable; 100% coverage mandate retained.

## Decisions

### 1. API — Snapshot-centric SDK (approved)

- `sdk.snapshot(locks)` returns the immutable per-sample value (id, tip, feeRate, system, account, planning methods). Result unions (`{ok, reason}`) for every planning/estimation outcome — no throw/undefined asymmetry. `SentTransaction` handle with `wait({signal})`. `quoteConversion(direction, amount, tipHeader)` for scan-free wallet quotes.
- Preserved from the current design, deliberately: the partial-transaction / explicit `complete()` boundary (the bot's match-first flow depends on it) and the pure scan/projection split (kept internal to `snapshot()`).
- Internals-access policy (replaces the blueprint's tiering): the in-repo bot may use sdk internals freely. Capability parity for community bots is guaranteed by the layer below, not by the sdk's export list; anything internal the bot leans on durably graduates to an exported `@beta` symbol when convenient.
- Two hard rules (depcruise-enforced):
  1. sdk consumes only the public surface of core/dao/order (already true today; keeps "build upon core" true by construction).
  2. `@ickb/core` stays a complete protocol layer — the community-bot capability floor. The known export gaps (e.g. `receiptCellFrom`) get fixed as part of completeness.
- Community-bot persona: mechanism (state, matching, building, completing) is published and documented; policy (profitability, ring, withdrawal strategy) stays in-app, forkable source, no API contract. Required invariant exports: `availableOutputSlots`, `DAO_TX_OUTPUT_LIMIT`, `MAX_DIRECT_DEPOSITS`, ring aggregate, named per-bot reserve constant.

### 2. Packaging — five published packages (amends blueprint)

- Published, `@ickb` scope, **lockstep versioning** (changesets kept for per-package changelogs, so unchanged packages show "no changes" explicitly):
  - `@ickb/utils` — generic CCC helpers (must stay published: dao/order depend on it).
  - `@ickb/dao` — generic Nervos DAO helpers.
  - `@ickb/order` — generic sUDT limit-order library.
  - `@ickb/core` — iCKB protocol layer. **Not merged into sdk** (reverses the blueprint): the package boundary mechanically enforces rule 1 above, keeps the capability floor a visible artifact, and lets the contract-mirroring layer settle early while sdk churns.
  - `@ickb/sdk` — Snapshot API; root re-exports the core math trio (`convert`, `ickbExchangeRatio`, `ICKB_DEPOSIT_CAP`, `receiptPhase2Capacity`) so wallets need one import.
- Generic-tier rule (depcruise): dao/order/utils never import iCKB-specific code. Consequence for order: asymmetric-ratio testing is the package's core warranty (the C1 regime is real for foreign tokens), and docs must read for a non-iCKB audience.
- Private: `packages/bot` → `apps/bot`, `packages/validation` → `apps/validation` (restores the original design; verified no external importers). Lib-vs-cli stays as a directory split with one depcruise rule. `packages/node-utils` and `packages/testkit` stay separate. `packages/log` deleted. End state: 11 workspaces (from 14).

### 3. Type-safety foundations (all approved)

- Direction-named, rounding-typed `Ratio` methods (`udtFromCkb(x, "ceil")`) as the only home of the conversion formula.
- **Required** brands (`Ckb`, `Udt`) on the public money-path signatures of order + core; raw bigint internally; skipped elsewhere.
- Single-declaration entity pattern (compilation-verified); remaining check: api-extractor handling.
- The blueprint's discriminated unions (`MaturityEstimate`, `OrderPrice`, DAO readiness, interface `ActionPhase`, `FeeFraction`) as proposed.

### 4. Errors and events contract (approved as designed)

- `IckbError` base, stable machine-readable `code` union, `retryable` as data (kills name-string classification). Codes are ordinary API: additive changes cheap, renames breaking post-v1; nothing pre-frozen.
- One events-contract module in `@ickb/node-utils` (only package reachable from bot + validation + scripts): event types, envelope validator (replaces 5 divergent copies), field-accessor family (one, resolving the safe-integer drift), launcher record schema, tester wire constants, one `transactionShape` (with `outputsData`). Hand-rolled validators, no runtime deps.
- Fatal-path policy: structured full-fidelity error (stack + cause) always logged; one-line public message to stderr; packages never write `process.exitCode` — typed stop reasons mapped at the CLI via the shared table.

### 5. Runtime — two process types (amends blueprint)

- **Tester runs in-process inside the supervisor** (amends the blueprint's keep-both-actor-spawns): the tester is validation tooling, not a production artifact, so production parity doesn't apply. Typed evidence returns delete the tester CLI, `TESTER_*` env plumbing, and ~600 lines of supervisor-side wire re-parsing. Hangs handled by `AbortSignal`; a tester crash surfacing as a supervisor stack trace is acceptable (better evidence, not worse).
- **The bot stays a spawned process** — it is the system under test: spawning the real CLI validates the production path (args, env, NDJSON, exit codes, signals), enables kill-on-timeout, and preserves fail-closed outside observation of crashes.
- Launcher unchanged (production runtime under systemd).
- Dynamic-loop, supervisor-loop, and preflight become library calls inside `apps/validation` (deletes the stdout-regex contract, summary re-validation, and most of the ~1,000 parser lines).
- **C2 resolved: bounded confirmation policy.** Declared `ConfirmationPolicy` budget; timeouts consume the retry budget; exhaustion exits 2; systemd restarts with a fresh chain read. Includes an eviction/unknown-status bailout for `broadcast_ambiguous`.
- One layered config system (defaults < file < env < flags, single schema/parser in node-utils); unified log-root; single timeout/kill-grace constants module; entrypoints and repo root injected.
- Test seams: exactly four ports (chain client, filesystem, clock, process spawner); everything else concrete.

### 6. Testing (approved; ckb-debugger layer amended)

- Contract oracle (~80 lines ported from the Rust, imports nothing from the implementation), fast-check properties across both scale regimes (fast-check is the only new npm dependency, dev), golden vectors generated by the contracts repo's Rust harness, `FakeClient` replacing `StubClient` (fail-fast on unstubbed calls).
- **ckb-debugger layer is in**, with two amendments addressing the header-heavy concern:
  1. Real-header fixture library (sampler dumps raw mainnet header bytes) alongside fabricated headers — fabricated for edge sweeps (cap boundaries, maturity edges the real chain can't produce on demand; scripts cannot distinguish fake headers from real ones since they trust consensus-verified fields), real for encoding truth.
  2. The real `dao.c` system script binary included in executed groups, so phase-2 `since`/epoch rules are checked by the actual consensus script.
  - Added requirements (all dev/CI): pinned prebuilt ckb-debugger binary (checksummed, cached; tests skip-if-absent locally, required in CI); the 4 contract ELFs + `dao.c` committed as sha256-pinned fixtures; ~150-line mock-tx serializer; header fixture file.
- Live-testnet validation demotes to a scheduled smoke run (wallets, fee market, mempool — what no local layer can fake). The residual gap the debugger layer cannot cover — live header *selection* against a real node — stays with the smoke run.

### 7. Coverage under the retained 100% mandate

- The private-package merge does not change the mandate's reach (apps are already covered and passing).
- DI-permutation tests are replaced by: the four ports (in-process coverage of loop logic), real-process smoke tests for CLI shims (behavioral truth), and a small **documented coverage exclude for `src/cli/*` bootstrap files** — chosen over literal-100%-including-shims because vitest cannot observe coverage in spawned child processes, and the alternatives (DI theater or child-coverage merging) fail KISS.
- Coverage scope strictly `src/**` with the `test/` directory convention; the `test/**/coverage/` fixture-test genre is deleted.

### 8. Tooling/pipeline (approved as designed in the blueprint)

- ESLint: `max-params` satisfied via options objects; `no-param-reassign` `props: true` scoped out for designated mutable-state modules.
- One root vitest config with generated projects; two-lane `check`/`check:deep` (default never touches `node_modules`); CI as three parallel jobs with pnpm caching and concurrency cancel; api-extractor reports enabled and committed; structure linter reduced per the three-way split; scripts absorbed by their owning apps; one entry-point convention.

## Net deltas vs the blueprint

1. Core stays a separate published package (was: merged into sdk).
2. Lockstep versioning for all published packages (was: independent).
3. Tester embedded in the supervisor process (was: spawned actor).
4. Internals-access relaxed to "graduate durable uses to `@beta`" (was: hard three-tier dogfooding rule).
5. Named coverage exclude for CLI bootstrap files (was: implicit).
6. ckb-debugger layer amended with real-header fixtures + `dao.c` in executed groups.

## Still open

- None blocking. Minor items to settle during implementation: v1 version number (`1001.0.0` continuity vs clean restart), api-extractor behavior with the single-declaration entity pattern (one-hour check), and whether `docs/reviews/` stays tracked long-term.
