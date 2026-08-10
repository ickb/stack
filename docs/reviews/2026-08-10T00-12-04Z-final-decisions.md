# Final Decisions Record — iCKB Stack Rewrite

Authoritative record for the rewrite. Consolidates and, where stated, amends the five 2026-08-09 documents (whole-repo-parallel-review, design-blueprint, overhaul-decisions, less-is-more-addendum, best-shape), the critic pass, and the July-corpus salvage. Baseline: tag `pre-rewrite-baseline` = `42a090c`. Where this record conflicts with an earlier document, this record wins; the earlier documents remain as rationale.

## 1. Target architecture

- **One published package: `@ickb/sdk`, single entry point.** Directories `core/`, `order/`, `dao/`, `internal/` are comprehension boundaries, not packages. `internal/` means the ex-utils subtree only; the domain directories are not "internal" — their public symbols are exported from the root barrel. No subpath exports (may be added additively later). Rationale: the order script's on-chain weakness (see §5 caveat) removes the generic-adoption thesis; per-entry-point costs, not per-package costs, were the real overhead.
- **Root export surface** (enforced by the committed api-extractor report): the Snapshot API (snapshot, result unions, SentTransaction, quoteConversion, completeTransaction), managers, `IckbError` + code union, and the community-bot capability floor — `OrderManager`, `Match`, `OrderGroup`, `OrderCell`, `Info`, `Ratio`, `convert`, `ickbExchangeRatio`, `ICKB_DEPOSIT_CAP`, `receiptPhase2Capacity`, `receiptCellFrom`, `ickbValue`, `IckbDepositCell`, `ReceiptCell`, `WithdrawalGroup`, `unique`, `availableOutputSlots`, `DAO_TX_OUTPUT_LIMIT`, `MAX_DIRECT_DEPOSITS`, `DEFAULT_ORDER_FEE`, `DEFAULT_ORDER_FEE_BASE`, named bot reserve constant. This list resolves the internal-dirs-vs-floor contradiction flagged by the critic.
- **Ring surface resolution** (supersedes blueprint A5 `RingAnalysis`): no SDK ring aggregate. The SDK exposes the deposit pool with maturity data; the bot computes the one-window kernel in-app. The earlier "ring aggregate" invariant-export decision is superseded.
- **6 workspaces**: `packages/{sdk,node-utils,testkit}`, `apps/{bot,validation,interface}`. Bot and validation absorb their old packages and scripts layers (lib/cli directory split, depcruise-enforced); sampler dissolves into a testkit bin (CSV + `--fixtures` header dump).
- **Depcruise rules (4)**: sdk browser-safety (no node builtins); `internal/` never exported; testkit never imported from `src/**`; oracle imports nothing from the implementation. Superseded and retired: "sdk consumes only core/dao/order public surface" and the generic-tier purity rule (both die with the package merge). Asymmetric-ratio/fast-check testing stays regardless — its justification is now oracle honesty and C1-class regression, not a foreign-token warranty.
- **Versioning**: single `CHANGELOG.md`, changesets dropped. **Version number and npm-registry handling UNRESOLVED** — all five `@ickb/*` names have live history at `1000.0.82`; publishing `0.x` needs an explicit registry decision (deprecate 1000.x with pointer / accept ordering quirk / new name). Blocks only the publish step, nothing else.
- Tech: React + Vite + Tailwind + CCC connector kept in the interface; react-query, React Compiler/Babel, lazy-load machinery dropped. jscpd deleted. `Type=notify` systemd-native ops (launcher dissolved). 100% coverage kept, scoped to `src/**`, with the documented `src/cli/*` exclude (vitest cannot observe spawned children).

## 2. Adjudicated decisions (user-confirmed)

- **A**: one package, single entry, as above.
- **B**: coverage ledger, scenario auto-chooser, and target-outcome _contracts_ killed. Kept: per-run classification, `summary.json`, incident files (with `suggestedNextAction`), and a `--target-outcome` **summary echo** (requested vs observed, no ledger machinery). Supersession chain: addendum listed the ledger as keep; best-shape overturned with consumer evidence; user confirmed after the LLM-operator reframe.
- **C**: ring policy → one-window kernel (~30 lines): don't deposit into an already-thick maturity window; don't consume a thin window's last ready deposit; window W ≈ 22 epochs; gap metric alerts.
- **D**: single CHANGELOG (consequence of A).
- **E**: minimal bot policy (~200 lines): match-value-beats-fee, reserve floor + projected post-tx guard + recovery exception, 21/20 shutdown, fixed iCKB float, ring kernel, greedy withdrawals under consensus caps. Monitoring replaces deleted policy — see the alert table (§6).
- **Validation product**: four legs — preflight (chain identity + **deployed-code sha256 congruence vs pinned ELF fixtures**, ~40 lines, new), one-shot smoke, **soak** (long-horizon testnet loop: production-style bot + repeating tester stimulus + journal digest), continuous watch. Testnet operation is **LLM-steered** (LLM reads artifacts between runs, steers via flags, writes the journal, may change code); **mainnet is code-only** — no LLM in any fund-touching loop; the harness never invokes an LLM.

## 3. Critic resolutions folded in

- **Soak code-identity**: every run's summary/incident stamps harness+bot git SHA + dirty flag + steering flags (~5 lines) so behavior changes attribute to code vs chain.
- **Secret-free artifact invariant** (stated once, applies everywhere): everything under the LLM-readable artifact root (events, summaries, journal, incidents) excludes key/env/config material, testnet keys included. Secret boundary remains a stop condition, not masking.
- **Alert table owned by the watch leg** (§6) — merges the four policy-replacement metrics with the four watch conditions.
- **Treeshake probe** added to `check:deep` (agadoo/rollup pass over the merged package) before "no subpaths" becomes consumer-irreversible; entity static-block shakeability is the specific risk.
- **api-extractor × single-declaration entity pattern**: still-open one-hour check; the committed api report is also the floor-enforcement mechanism, so this check is a Phase-1 gate.
- **Release procedure** (post-changesets): manual version bump + hand-edited CHANGELOG + tag + provenance workflow (`id-token: write`) + publint/attw `--pack` in the deep lane. First publish waits on the registry decision.
- **Weak-lock README caveat** must be written from the contracts audit, not memory: cite **LO-01 (confusion attack: mint-time output-lock non-execution)** as the adoption-limiting finding, state what the SDK mitigates (confusion-attack resolver + attestation boundary), and separately state the weak-lock integration assumption (strong transaction-binding locks required; recipient reassignment possible under non-binding locks — documented boundary, not a live finding).

## 4. July-corpus carry-overs (salvage-verified against current code)

Defects to fix in the rewrite (none covered by C1-C10):

1. **ICKB-001 — unbounded aggregate L1 scans**: `collectPagedScan` has no aggregate budget; all financial-state scans materialize complete results over a permissionless pool. Fix: one aggregate budget + typed exhaustion error at the collector owner; fail closed, never return partial financial state. Lands in the Snapshot scan layer.
2. **ICKB-023 — forwarded shutdown orphans detached descendants**: signal-forwarding path in `process.ts` never awaits group cleanup (only the timeout path arms it). Fix in the surviving `runProcess`.
3. **ICKB-018 — waived by maintainer (2026-08-10)**: no credentialed-path RPC providers in use; pathname in endpoint identity is not a leak here. Revisit only if a path-keyed provider is ever adopted.
4. **ICKB-020 — terminal rejection clears the whole client cache**, wiping unrelated transactions' marks; must be scoped before any CCC upstreaming of `waitTransaction`.
5. **ICKB-008 — `waitTransaction` confirmations>0 reorg race** (status and tip read separately, no inclusion re-check): fix in the `SentTransaction.wait` rewrite; it is published wallet API.
6. **ICKB-022 remainder — pre-admission ambiguity recovery**: retain signed bytes with the submission owner; reconcile bounded; rebroadcast identical bytes when admission stays unknown; never rebuild/discard identity until terminal reconciliation. Interface counterpart (ICKB-014): the indefinite confirmation retry with frozen preview is an unmade product decision — carried to open items.
7. **ICKB-019 — sampler earliest-block search assumes monotone timestamps** (consensus permits decreases): fix or rename result approximate; matters for the fixtures mode.

Invariants to preserve verbatim in the send-path rewrite: the explicit `DEFAULT_MAX_FEE_RATE` guard is load-bearing (`sendTransactionNoCache` bypasses CCC's ceiling); locally derived hash is authoritative (mismatch throws before cache marking, unresolved not rebuild-ready); post-acceptance cache-mark failure is swallowed so node acceptance is never reported as failure.

CCC divergences to add to the documented-reasons list: `TransportFallback` shared-index race under concurrency; `TransportHttp` abort-timer leak on failed-primary; WebSocket default transports keeping finite processes alive — the real reasons behind `fallbacks: []`.

Matcher rules that must survive the rewrite: work budget charged per visited pair _before_ feasibility filtering; marginal partial fee computed on the **prepared** serialized size (one empty witness entry, +8 bytes, per preceding order input).

Audit reconciliation (only record of per-ID status): **ICKB-017 is a stale false positive** (its repro mirrors old control flow; the audit's `pnpm test:deps` green is untrustworthy until corrected). Cycle-19 table: open-then = 001, 018, 020, 022, 023, 025; fixed/stale = 007, 009-012, 021, 024; deliberate/policy/latent = 002-005, 008, 013-016. Post-rewrite: 025 mooted by greedy-only; 002 rides the CCC-upstream watch. **The ckb-integration-audit catalog is non-Git local** (`/var/home/user/Projects/ckb-integration-audit/` — REPORT.md, DEPENDENCIES.md, BEHAVIORS.md, SOURCES.md, candidates.md, findings/ickb-stack/, IDs through ICKB-025); the baseline tag does not preserve it — this record is the pointer. Evidence pins: CCC 1.17.0 = `a74017fc99e00c0e3cbd2a45afe150908b8ab734`; deployed `ickb_logic` = `454cfa966052a621c4e8b67001718c29ee8191a2`.

## 5. CCC-audit constraint (blocking, mapping in flight)

The integration audit documents **59 confirmed CCC defects** against CCC pin `8a19abcd`. The full mapping is **delivered**: see `2026-08-10T00-12-04Z-final-decisions-appendix-ccc-audit.md` (constraints table + 12 amendments, all adopted). Headlines: installed CCC 1.17.0 _predates_ the audit pin (all 59 defects present; the "fixed on master" items are not in 1.17.0) — maintainer has authorized updating CCC and other deps to latest published versions under the pnpm minimum-release-age rules, which supersedes the floor question once the update lands at ≥ `8a19abcd`; DAO claim-epoch math never migrates to CCC (bug 057 verified in 1.17.0); ICKB-017 is superseded by ICKB-022 (bounded reconcile-by-hash + `-1107`→accepted mapping, bot and interface); `snapshot()` gains a tip fence; sdk/bot own the pending-spend set (CCC cache is a read accelerator only); debugger `dao.c`/system-script fixtures pin to deployed genesis binaries (`ckb-system-scripts@f25c5ae` — repo HEAD removed the 64-output cap); config gains a `maxFeeRate` knob. Phase-2 send/wait/cache is unblocked under these constraints.

## 6. Alert table (watch leg owns; bot emits in the decision transcript)

| Signal                                               | Source          | Alert condition             |
| ---------------------------------------------------- | --------------- | --------------------------- |
| Exit code 2 / nonzero exit                           | systemd         | any                         |
| Missing `bot.iteration.started`                      | events          | > 2× sleep interval         |
| `confirmation_timeout` / `post_broadcast_unresolved` | classification  | any                         |
| Stale tip                                            | preflight/state | no growth over threshold    |
| Max forward maturity gap                             | pool scan       | > W′                        |
| Ready-in-window count                                | pool scan       | 0 while withdrawals pending |
| Allowance-rejection streak                           | match reasons   | ≥ N consecutive             |
| Leftover excess iCKB after withdrawal loop           | balances        | > threshold across loops    |
| Secret-leak sentinel                                 | logs            | any                         |

## 7. Fund-safety keep-list (verbatim; inviolable)

- Reserve floor + projected post-tx guard + recovery exception; match-value-beats-fee; 21/20 shutdown; consensus output caps.
- Exit-code-2 transparency end to end (`RestartPreventExitStatus=2`); bounded confirmation + `broadcast_ambiguous` bailout; persist-hash-before-broadcast (storage failure blocks broadcast).
- Fail-closed classification precedence (timeout/spawn/truncation/malformed terminal first); `economic_loss` guard never softened; truncation-flagged capture of the bot spawn; chain-identity-before-signing; bounded one-iteration actor-config rejection; secret boundary as stop condition.
- Atomic-switch/proven-rollback deploy engine; credential script; deploy readiness proof as sd_notify (never merely deleted).
- Interface: CKB-signer filter, chain-switch auto-disconnect, freeze-refresh-rebuild-before-sign, a11y inventory, exact-bigint money paths.
- Send-path invariants (§4); money-path CCC divergences kept with documented reasons; oracle independence (lint-enforced).

## 8. Implementation sequencing (in-place rewrite from `42a090c` on `wip`)

Because this is in-place (not a fresh tree), two blueprint pins re-bind: **ESLint rule fixes before mass `git mv`**, and **the `launches.ndjson` four-consumer constraint** (launcher, stimulus preflight, incident collector, updater readiness move in one coordinated change with sd_notify adoption).

1. **Phase 0 — foundations + adjudicated defects** (audit-independent): C1 matcher fix **with contract oracle + asymmetric-ratio properties landed first** (mass-moving `order/matching` before S1-S3 exist is the exact transposition-risk moment they police); ESLint rule fixes; hygiene (stray `.d.ts`, `packages/log`, gitignore anchors); supply-chain pins (C9).
2. **Phase 1 — test bed**: golden vectors, FakeClient, api-extractor entity-pattern gate, treeshake probe.
3. **Phase 2 — SDK reshape**: Snapshot, result unions, brands, entities, IckbError; **send/wait/cache waits for the §5 audit mapping**.
4. **Phase 3 — package merge + workspace/tooling collapse** (after Phase 0-1 gates green).
5. **Phase 4 — runtime**: bot state machine + minimal policy + kernel; validation four-leg harness; events-contract module; config system; systemd-native ops (coordinated `launches.ndjson` change).
6. **Phase 5 — depth**: ckb-debugger layer + fixtures, mutation spot-checks, soak journal digester, live smoke wiring.

## 9. Open items

- npm version + registry handling (blocks publish only).
- ICKB-014 interface product decision: bounded vs indefinite confirmation UX for the pending transaction.
- CCC-audit mapping appendix (in flight; blocks Phase-2 send/wait/cache).
- Correct the integration-audit catalog (ICKB-017 stale repro) so its gate is trustworthy again.
- api-extractor × entity pattern check (Phase-1 gate).

## Amendments (2026-08-10, from review `reviews/2026-08-10-stack-overhaul-plan`)

1. **Phase-2 blocking (F-001)**: the §5/§8 "waits for the audit mapping" language is superseded — the mapping is delivered (appendix); Phase 2 proceeds after Phase 1 under the appendix constraints. ICKB-014 narrows to the interface's post-deadline UX presentation only (bounded confirmation itself is adopted, appendix amendment 3).
2. **Debugger gate timing (F-004)**: ckb-debugger execution of built transactions against the 4 pinned iCKB ELFs + deployed dao is a **Phase-2 exit gate** and a prerequisite for signing paths (mock-tx serializer moves from Phase 5 to Phase 2).
3. **Staged systemd cutover (F-003)**: replaces the single coordinated change. (i) additive compatibility release (bot CLI dual-mode: launcher/Type=simple AND Type=notify via NOTIFY_SOCKET detection; old journal still written); (ii) unit+release cutover as one change with a joint rollback pair; (iii) launcher and old journal deleted only after the rollback target supports the new unit.
4. **Journal consumer inventory (F-007)**: the "four consumers" count is replaced by the repository-derived owner inventory: `scripts/bot/launcher/{logs,runtime/{types,constants,execute}}.ts`, `scripts/bot/incident/{model/{constants,types},source/summary}.ts`, `scripts/ickb-bot-systemd-install.sh` (migration + readiness, incl. :344-353,:412-417), `scripts/ickb-bot-systemd-update.sh` (readiness), `packages/validation/src/supervisor/stimulus/artifacts/liveBotStimulusPaths.ts` (+ preflight reader), plus operator docs (`apps/bot/README.md`, root README watch section). Migration is additive-first; the old journal is removed only after every owner has moved.
5. **Gate/artifact ordering (F-008)**: the Phase-1 treeshake probe is risk discovery; the **mandatory** packed-artifact treeshake/api check is the Phase-3a exit gate on the merged package. The soak journal digester moves to Phase 4 so the four-leg validation product ships complete.
6. **Phase-3 slicing (F-009)**: Phase 3 lands as green slices — 3a merged SDK + packed-artifact gate; 3b private workspace moves; 3c test/config collapse with before/after test-count parity; 3d two-lane check + CI graph, every mandatory gate assigned to a named CI job.
7. **Export contract vs internal/ (F-010)**: the ex-utils subtree is `shared/` (root-exportable), not `internal/`; the "never exported" depcruise rule applies to nothing by default (dropped) — the root barrel plus the committed api report ARE the export gate. The root contract (§1) additionally includes the B4 pattern's public symbols: `EntityBase` (one shared helper, lives in `shared/`) and the per-entity `XBase` consts.
8. **Entity gate durably recorded (F-006, partial)**: the B4 recipe — `export const XBase: EntityBase<XLike, X> = ccc.Entity.Base<XLike, X>()` + `export class X extends XBase`, `@public` on `XLike`/`XBase`/`X`; when committed api reports are enabled set `"ae-forgotten-export": {"logLevel": "error", "addToApiReportFile": false}`. Status: verified 2026-08-10 in an ephemeral scaffold (since evicted from /tmp); **re-verification as a committed, re-runnable probe is a Phase-1 exit item**, together with a packed consumer fixture importing every root-contract export.
9. **Withdrawal selection contract (F-011)**: greedy selection is an explicit product-contract amendment, not a mooting: the whitepaper's maximize-whole-deposit-withdrawal behavior is superseded for this bot by bounded greedy underfill (within one deposit of optimal per selection round; excess clears in later loops). ICKB-025 is supporting evidence that the exact selector was also defective, not the justification. The Phase-4 policy doc must carry this divergence note.
10. **Toolchain pin precision (F-012)**: ckb-debugger v1.1.1 = release asset `ckb-debugger_v1.1.1_x86_64-unknown-linux-gnu.tar.gz` (nervosnetwork/ckb-standalone-debugger, release `-sha256.txt` verified); installed binary sha256 `24641357274ca464ecd86fd63b715ad96b5490d27b5ca029df37511e435d96f0`.
11. **Secret/LLM boundary mechanics (F-005)**: generated configs stop carrying private keys in agent-visible files. Keys flow keyring/systemd-creds → process env/fd of the signer process only; steering schemas are testnet-only by construction; Phase 4 adds mainnet-rejection tests on every steering entrypoint and leak-canary tests over the LLM-readable artifact root.
