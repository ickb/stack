# Less-Is-More Addendum

## Scope

- Third review pass, requested after the decisions snapshot (`2026-08-09T20-26-38Z-snapshot-overhaul-decisions.md`): additional cuts unlocked by the settled decisions. Three auditors (validation harness, ops layer vs systemd, published packages + interface + tooling), each instructed to flag load-bearing code alongside deletion candidates. All claims verified against code at baseline `42a090c`; read-only.
- Verdicts below either extend the decisions snapshot or need a maintainer call (marked **[call]**).

## 1. Ops layer: the launcher dissolves into systemd (5,665 → ~1,350 src lines)

- **Launcher (1,659 → ~70).** Of its 13 responsibilities, six are systemd-native (restart, signals, kill grace, singleton lock, journal, cgroup), five serve only the file-based liveness proof, two belong in the bot CLI (artifact dir, log file). Replacement: `Type=notify` — the bot writes `READY=1` to `$NOTIFY_SOCKET` after `bot.chain.preflight` (~20 lines, zero deps); `systemctl show -p MainPID,ExecMainStartTimestampMonotonic` becomes the PID-reuse-safe identity query, replacing the hand-rolled bootId/startTimeTicks apparatus. Bot CLI gains per-run log file + bounded rotation (~40 lines). Optional ~80-line dev wrapper for non-systemd runs. **[call]** — changes the production deploy shape.
- **Incident collector (2,096 → ~150 + jq recipes).** Irreplaceable core: artifact sha256 re-verification and whole-file bundling with source separation. Window-filtering and summary aggregation are jq one-liners (recipes already in `apps/bot/README.md:113-125`); the stderr time-window scanner dies (slot files are already per-run bounded). Keep: no-config/no-env collection stance, hash verification.
- **`node-utils/process.ts` (507 → ~340).** Survivors: `runProcess` core with kill-on-timeout (the bot spawn needs it), one signal-forwarding context, `minimalProcessEnv`. Dies: procfs identity parsing (with the launcher), process-group exit-polling machinery (no more detached `pnpm` pipelines once loops are in-process).
- **systemd scripts (1,403 → ~750).** Keep verbatim: the credential script (167 — correctly shaped) and the update script's atomic-switch/proven-rollback engine (fund-safety load-bearing). Delete: the ~200-line one-time legacy migration path, the ~120-line hand-written unit-file parser (ship a tracked unit template + `systemd-analyze verify`), and the 105-line readiness heredoc (collapses to "`systemctl start` returns" under `Type=notify`).
- **Sequencing constraint:** `launches.ndjson` has exactly four consumers (launcher, stimulus preflight, incident collector, updater readiness). Launcher deletion, sd_notify adoption, updater readiness rewrite, and stimulus liveness redesign are **one coordinated change** — never delete the file before its consumers move.
- Must-not-cut: exit-code-2 transparency end to end (`RestartPreventExitStatus=2` is what stops systemd relaunching a fund-safety halt).

## 2. Validation harness: confirmed at ~55% (15,704 → ~6,600–7,700 src lines)

- **Loop layers (3,087 → ~250).** Total real decision logic is ~90 lines (`decideNext` ~55, scenario choice 34, retry policy ~30); everything else is spawn/parse/re-validate ceremony that dies in-process: stdout-regex stop-reason recovery, summary re-validation, chunk-timeout derivation, both arg parsers, prebuild-as-component (survives as an operator/CI step, fixing the N+1 rerun). Survive once: backoff/stable-limit (~7 lines), output-root reservation + symlink safety (one shared ~70-line helper replacing 5 copies), the 2^31−1 ms timer clamp (moves to the timeout-constants module).
- **Tester wire-reconstruction layer (~1,050 lines) is dead** under the in-process decision: `supervisorTesterClassification.ts` + `supervisorTesterEvidence.ts` (string-matching skip reasons; dust detected via `giveCkb === "0.00000001"` — a decimal-formatter round-trip through a process boundary), the funding-error regex, the `--owned-tx-hash` argv round-trip (~180 lines across three files), tester env/CLI plumbing, `testerContract.ts` wire constants. Of 32 `OutcomeKind` values: `tester_dust_order_created` dies outright; eight `tester_*` kinds become typed function-result variants; infra kinds survive for the bot spawn only.
- **Preflight: three independent spawn+text-reparse sites become one library call** (supervisor, dynamic-loop with its `fixed8DecimalToUnits` formatter-reverser, stimulus). The retry-budget/wall-clock policy (~200 lines) survives.
- **Stimulus unifies with the supervisor** (3,433 → ~1,000–1,300) as a `--mode live-launcher` flag: ~2,000 lines are duplicates (third arg parser, private helper family, parallel session/paths/artifacts, second repoRoot climb, summary round-trip that re-parses a file written by the same process). Genuinely unique and kept: launcher/liveness proof (redesigned per §1), event-file cursor tailing with rotation handling, quiescence-wait policy, public-identity cross-check.
- Must-not-cut: bot-side fail-closed classification (~1,450 lines), coverage ledger (it *is* the product), infrastructure-failure precedence, truncation-flagged capture of the bot spawn.
- Accepted trade (extends the tester decision): with loops in-process, "kill a hung supervisor from outside" moves to AbortSignal deadlines inside + systemd outside.

## 3. Published packages: proportionality cuts

- **SDK exact best-fit selector — cut (~500 src + ~350 test).** The meet-in-the-middle subset enumerator (2×2^15 masks over 30 deposits) feeds a plan comparator that sorts by a *bucketed heuristic maturity estimate* first — shannon-exact optimization under a coarse comparator is disproportionate. The greedy already runs in parallel on every call and is within one deposit of optimal fill; constraints (cap, ready-assert, uniqueness, ring anchors) live outside the optimizer and survive untouched. Also kills the fragile cached-selector invariant (defect C10). If exact optimization is ever wanted for bot profit, it is policy → `apps/bot`. **[call]** — trades bounded economic optimality for simplicity on a money path (constraints unaffected).
- **Order search: keep the budget cap (DoS surface — permissionless pool), cut the certification preflight (~150 src + ~350 test).** The capped-arithmetic work-bound predictor exists only to decide atomic-vs-stepped before searching; "run atomic, restart stepped on exhaustion" costs at most 2× budget once per bot iteration. **Truncation evidence (`requiredWork`, `searchMode`, budget fields) has zero consumers beyond the bot transcript — cut (~80 src + ~300 test)**; keep the counter diagnostics that bot policy actually reads (`usefulMatchFloors` inputs are money-path).
- **Ring modules: keep semantics, merge 3 files → 1** (~30 lines of scaffolding).
- **Sampler: keep and extend** with a `--fixtures` mode (~60–80 lines) emitting raw header bytes for the ckb-debugger fixture library — it already owns the header-walking machinery.

## 4. Interface

- **`actionTransaction` wait/abort machinery (~150 src + large test fraction) collapses under `SentTransaction.wait({signal})`**; `shared/quote.ts` dies via `quoteConversion`. Preserve in the SDK handle: the fail-closed persist-hash-before-broadcast ordering.
- **Pending-transaction store: stop using the react-query cache as a store** (the `enabled: false` + `gcTime: Infinity` + `removeQueries` dance) — a ~40-line `useSyncExternalStore` module; 238 → ~100 lines. This is the real fix regardless of the next item.
- **react-query itself: neutral [call].** Features actually used are minimal (5 queries, retry 2, one interval, one invalidate); a replacement hook is ~100 lines, so the win is one runtime dependency, not lines. Either way is defensible.
- **Rate chart: keep** (product's landing-page argument, accessible, zero deps); merge 6 modules → 2 and optionally precompute the static historical samples (~100–130 lines).

## 5. Tooling

- **`publicApiDocumentation` (386-line re-export-graph walker + tests ≈ 450 lines) → one JSON line**: `"ae-undocumented": {"logLevel": "error"}` in api-extractor, which analyzes exactly the same 5 packages at the resolved-export-graph level. Caveats: type-alias-literal members lose individual flagging; enforcement moves to the build-dependent lane.
- **More structure-linter deaths**: package-root inventory guards (derive from `pnpm-workspace.yaml`), the three *planned* vitest-config guards (cancel — they guard 13 configs that won't exist), workspace-import-dependency rules (knip covers, pending one confirmation). Combined with prior decisions: linter lands well under the ~800-line target.
- **jscpd: delete the stage and the dependency [call].** Zero ignore-comments repo-wide, and the review's own duplication catalogue sat *under* its 12-line threshold — it passes while missing what matters. The events-contract module and helper consolidation remove those classes by construction. Conservative fallback: keep in `check:deep` only.
- **JoyID patch + CVE ignore: keep** — verified still live, version-pinned, runtime-guarded. No savings available.
- Hygiene: delete stray `packages/utils/src/{codec,index,utils}.d.ts` (untracked tsc output beside sources) and gitignore-guard `src/**/*.d.ts` exceptions.

## Aggregate

| Area | Now (src) | End state (src) |
|---|---:|---:|
| Validation harness (pkg + scripts + app shims) | 15,704 | ~6,600–7,700 |
| Ops layer (launcher, incident, process.ts, systemd) | 5,665 | ~1,350 |
| Published-package cuts (§3) | — | −~760 |
| Interface (§4) | — | −~300–400 |
| Tooling (§5) | — | −~900 + 1 lint stage |

Roughly **12–13k source lines and ~6k test lines** removed beyond the blueprint's baseline plan, plus one lint stage, one dev dependency (jscpd), optionally one runtime dependency (react-query).

## Maintainer calls needed

1. Launcher → `Type=notify`/systemd-native (changes production deploy shape; single coordinated change with all four `launches.ndjson` consumers).
2. Exact best-fit → greedy-only in the published sdk (bounded economic-optimality trade; constraints unaffected).
3. jscpd: delete vs demote to `check:deep`.
4. react-query: keep vs replace (~100-line hook; dependency-count question only).
