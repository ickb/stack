# Best Shape Snapshot — Zero-Base Synthesis

## Scope

- Fourth review pass: everything reopenable (product scope, tech stack, prior decisions), requested as "imagine the best shape, go wild, less is more". Five zero-base reviewers: greenfield repo architect, interface, bot policy (product-level), validation (product-level), published libs vs CCC leverage. All grounded in code/whitepaper/CCC-typings cites at baseline `42a090c`; read-only.
- This synthesis adopts the consensus findings, surfaces the inter-reviewer conflicts for maintainer adjudication (§5), and consolidates the fund-safety keep-list. It amends the decisions snapshot (`2026-08-09T20-26-38Z`) and the addendum (`2026-08-09T20-41-50Z`) where noted.

## 1. Headline

Rebuilt from scratch with today's knowledge, the repo lands at **~50-55k TS lines total (src+test) versus ~107k today** — roughly half — while _adding_ capability (deployed-code congruence check, contract-oracle adjudication, sd_notify readiness) and keeping every fund-safety invariant. The extra distance below the addendum's ~65k projection comes from product-level cuts: the bot's ring policy, the validation coverage ledger, tester stimulus diversity, react-query and its cache choreography, four npm publish surfaces' worth of scaffolding, and test suites written fresh against typed seams instead of trimmed.

## 2. Consensus findings (adopted; no adjudication needed)

### 2.1 Bot policy: the whitepaper defines no bot role — most policy is self-assigned

Protocol health is designed to be emergent (anyone can match, anyone exits through anyone's deposit, the 10% oversize discount incentivizes matching; a user-side low-liquidity exit fallback is specified). The justified kernel is "match profitably, don't go broke," plus a thin liveness courtesy:

- **The ring is over-engineered ~20×.** Its honest kernel — "is the current maturity window thin, and don't consume its last deposit" — is ~30 stateless lines (a deposit made now can only ever cover the window _now_; segmentation/density/anchors/requiredLiveDeposits deliver nothing beyond that, and the spec itself admits the public-state control loop is attacker-steerable). Replace with the one-window check (lookahead W ≈ 22 epochs); delete segments, anchors, surplus filter, `requiredLiveDeposits` plumbing into core, both cross-layer invariant banners, and the ring diagnostics mirror (~600 lines → ~30).
- **Best-fit → greedy** (resolves addendum call 2, both zero-base reviewers concur): with protocol-incentivized uniform deposit sizes, greedy is within dust of optimal; fixed iCKB float replaces the dynamic useful-floors machinery.
- **Minimal policy ≈ 200 lines vs ~1,150 today.** Kept verbatim, untouchable: the reserve floor + projected post-tx guard + recovery exception (fund-stuck), match-value-beats-fee (fund-loss), 21/20 shutdown (fund-loss), consensus output caps (reclassified as SDK mechanism).
- **Monitoring replaces policy**: four metrics already computed in the decision transcript (max forward maturity gap, ready-in-window count, allowance-rejection streaks, leftover excess after withdrawal) become alerts instead of control loops.
- Risk classes admitted are liveness/profit-delay only — never fund-loss (the peg is deterministic; deposits mature regardless).

### 2.2 Validation: the product is four live-only facts, not a coverage platform

- Live testnet uniquely proves: real signer/node acceptance, fee-market magnitude, RPC provider quirks, long-run bot stability — plus opportunistic observation of mempool events. Everything else is owned by the offline layers (oracle, properties, vectors, FakeClient, ckb-debugger with dao.c and real headers).
- **New requirement (add, ~40 lines):** a preflight congruence check — sha256 deployed script code cells against the debugger layer's pinned ELF fixtures. Converts the "deployed-script vs fixture" risk class into a deterministic assertion; nothing covers it today.
- Minimal product: congruence+identity preflight → one-shot smoke (in-process tester builds one bounded non-dust order; spawn the real bot CLI once; classify fail-closed; assert match-committed-above-fee or explained no-action) → continuous systemd watch with alerts (exit-2, missing iteration events, confirmation-timeout, stale tip) → ~150-line incident bundler.
- Tester stimulus diversity (random/mixed/multi-order planning, ~500-700 lines) exists only to feed the coverage chooser; two deterministic shapes (one per direction) suffice.
- Landing zone **~4,300-5,300 src lines** (vs the addendum's ~6,600-7,700), with the bot-side fail-closed classification core (~1,450) untouched.

### 2.3 Interface: right features, half-priced implementation

- Feature inventory verified complete and minimal — nothing product-level to cut. Must-keeps confirmed in code: CKB-signer filter, chain-switch auto-disconnect, freeze-refresh-rebuild-before-sign, collect-only action, dust notice, fail-closed pending store (storage-write failure blocks broadcast), the real a11y work, exact-bigint money paths.
- The wallet modal is a **Lit web component**; React comes only from the thin `connector-react` wrapper. Verdict: keep React anyway (hand-driving the element or hand-syncing ~25 dynamic bindings costs more than React costs), keep Vite + Tailwind; **drop** react-query (resolves addendum call 4: replace — ~80-line poll hook + `useSyncExternalStore` pending store), React Compiler + Babel (4 dev deps), lazy-load machinery, saved-connection restore delay, shell triplication.
- Target ~1,560 src + ~1,700-2,100 test (with @testing-library replacing the hand-rolled element-traversal harness that made single component tests run 400+ lines) vs ~10,100 today. 100% coverage stays; one conditional exclude if the Lit provider mount proves un-coverable under jsdom.
- Fixes riding along: stale `README.md:45` (pending-tx persistence claim), `unique` added to sdk root re-exports (or interface keeps a utils dep).

### 2.4 CCC leverage: delete ~600 lines now, upstream ~500 more

- Deletable now against installed CCC 1.17/platform: `collect` (=`Array.fromAsync`), DAO header-walk duplication of `Cell.getNervosDaoInfo` + hand caches shadowing `client.cache` (~90-100), `cellInputLikeFrom` shims, `getTransactionWithHeader` ×3 → one 15-line helper, `decodeUdtBalance` → `udtBalanceFrom`, entity ceremony (~350-400, already decided).
- **Keep with documented reasons** (CCC's versions verified subtly wrong): paged-scan cursor-progress guard (CCC loops forever on stale cursor), `waitTransaction` (CCC can never surface "rejected"), checked codecs (CCC 2's-complements negatives), `formatCkb` (CCC mangles negative sign), `assertDaoOutputLimit` (sync/typed/indeterminate-aware), send path (persist-before-broadcast invariant).
- **Explicit strategy: upstream the generic tier to CCC** (paged-scan guard, hardened waitTransaction, possibly DAO builders) — CCC demonstrably absorbed this layer release by release (`calcDao*`, `Epoch`, `getTransactionWithHeader`, `CellAny` all appeared during the window this repo tracks). Each landed PR deletes iCKB-side code and shrinks the published estate.
- Public-surface audit: `@ickb/order` has 11 of 22 exports with zero external consumers (incl. the entire `Relative` module); `@ickb/core` has 3 dead exports and — worse — **missing** ones: `receiptCellFrom` and `ickbValue` are not in the barrel, so a build-on-core bot cannot value a receipt; the sdk root currently re-exports **zero** core symbols (the decided wallet trio is real outstanding work). The honest capability floor is 9 symbols (order: `OrderManager`, `Match`, `OrderGroup`; core: `convert`, `ICKB_DEPOSIT_CAP`, `IckbDepositCell`, `ReceiptCell`, `WithdrawalGroup`, `receiptPhase2Capacity`).

### 2.5 Repo shape (architect, uncontested parts)

- **6 workspaces**: `packages/{published…, node-utils, testkit}` + `apps/{bot, validation, interface}`. Sampler dissolves into a testkit bin (its two outputs — chart CSV and header fixtures — are both dev-time artifacts). Bot and validation absorb their scripts/ops layers per the addendum; one `parseArgs` CLI with subcommands per app.
- **One test runner** (scripts tests join vitest), one flat eslint config (interface override scoped by `files`), ESLint plugins 10 → ~6, jscpd deleted (resolves addendum call 3), `Type=notify` launcher adopted (resolves addendum call 1 — in a rebuild the four `launches.ndjson` consumers never exist, dissolving the sequencing constraint; `RestartPreventExitStatus=2` kept end to end).
- Root scripts 30 → ~8; config files ~60 → ~30.
- Artifacts: `PRODUCT.md` → `apps/interface/` (it is the interface's product charter by its own text); operator runbooks live with their apps; `docs/lint-policy-map.md` rewritten (several rows already invalidated); `docs/reviews/` → keep the four operative 2026-08-09 documents (ideally distilled into `docs/decisions/` ADRs), prune the 32 prior process artifacts (fully preserved at the `pre-rewrite-baseline` tag).

## 3. Conflicts requiring maintainer adjudication

**A. Published package count — 5 (decided) vs 4 (CCC reviewer) vs 1 (architect).**
The CCC reviewer's 4-package case is the best-evidenced middle: fold **dao** into core as `@ickb/core/dao` (zero consumers anywhere outside core/sdk; CCC is eating its generic thesis upstream; iCKB-free boundary stays depcruise-enforced so extraction remains a `git mv`), keep **order** standalone (the one real differentiated generic artifact), keep **core/sdk** separate (the mechanical sdk→core-public rule), keep **utils** while order is published (order needs its 6 symbols; folding forces order→core, violating the generic tier). The architect's 1-package shape maximizes simplicity but buries the generic libs' npm identity inside a protocol-named package — directly against the stated generic-reuse goal. _Recommendation: 4 — `utils`, `order`, `core` (+`/dao` subpath), `sdk`; revisit utils→3 only after upstreaming lands._

**B. Coverage ledger — keep (architect) vs kill (validation zero-base).**
The validation reviewer brought consumer evidence: `summary.json` is read only by the harness's own scripts — no CI lane, no external tool, no reviewer pipeline; the "external loops" of the design intent are the scripts the settled plan already absorbs. The architect asserted "it is the product" without a consumer check. Classification (what makes pass/fail meaningful on a shared testnet) is kept by both. _Recommendation: kill the ledger/scenario-chooser/target-outcome contracts (~450-600 lines + the stimulus-diversity tail), keep per-run classification + summary as operator artifact._

**C. Ring — one-window kernel vs none.**
Both are defensible per the policy reviewer; the one-window check is so cheap (~30 lines) that it dominates "none". _Recommendation: one-window check + gap alert._

**D. Changesets — keep (decisions §2) vs single CHANGELOG (architect).**
With lockstep and (post-A) four packages, changesets still provides PR-time changelog discipline at near-zero cost; a single CHANGELOG is simpler but hand-maintained. _Recommendation: keep changesets; revisit if A lands on 1 package._

**E. Bot policy depth — minimal (~200 lines) vs current-minus-ring.**
The minimal policy trades whale-order capture latency and exact excess-withdrawal optimality for ~950 lines and two invariant banners. The reviewer's risk table shows nothing fund-loss-class is admitted. _Recommendation: adopt minimal; the four alert metrics are the safety net; policy can grow back selectively if profit data demands it._

## 4. Consolidated must-never-cut list (all five reviewers)

- Reserve floor + projected post-tx guard + recovery exception; match-value-beats-fee; 21/20 shutdown; consensus output caps.
- Exit-code-2 transparency end to end (`RestartPreventExitStatus=2`); bounded confirmation + `broadcast_ambiguous` bailout; persist-hash-before-broadcast (storage failure blocks broadcast).
- Fail-closed classification precedence (timeout/spawn/truncation/malformed terminal first); `economic_loss` guard never softened; truncation-flagged capture of the bot spawn; chain-identity-before-signing; bounded one-iteration actor-config rejection; secret boundary as stop condition.
- Atomic-switch/proven-rollback deploy engine; credential script; deploy readiness proof (as sd_notify, never merely deleted).
- Interface: signer filter, chain-switch auto-disconnect, freeze-refresh-rebuild, a11y inventory, exact-bigint money paths.
- Money-path divergences from CCC kept with documented reasons (§2.4); oracle independence (lint-enforced).

## 5. Net effect on the plan

| Layer                               | Decisions/addendum plan | Best shape                                                                                 |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| Published packages                  | 5, ~10,400 src          | 4 (pending A), ~8,700 src, −600 CCC dupes, 9-symbol floor guaranteed, upstreaming pipeline |
| Bot (app+ops)                       | ~3,600 + 750 sh         | ~2,700-3,000 + 750 sh (minimal policy, ring kernel)                                        |
| Validation                          | ~6,600-7,700            | ~4,300-5,300 (ledger dead, smoke+watch product, +40-line congruence)                       |
| Interface                           | ~3,800                  | ~1,560 src + ~2,000 test                                                                   |
| Workspaces / configs / root scripts | 11 / ~40 / ~12          | 6 / ~30 / ~8                                                                               |
| **Repo total (src+test)**           | **~65k**                | **~50-55k**                                                                                |

## 6. Open items after this pass

- Adjudications A-E (§3).
- Prior open items unchanged: v1 version number; api-extractor × entity-pattern check.
- New work items discovered: sdk root re-export of the wallet trio (+`unique`); core barrel completeness (`receiptCellFrom`, `ickbValue`); deployed-code congruence preflight; CCC upstream PRs (paged-scan guard, waitTransaction hardening); stale interface README claim.
