# Project Research Summary

**Project:** iCKB Stack v2 — CCC API Migration
**Domain:** CKB blockchain protocol library suite (NervosDAO liquid staking / iCKB)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Executive Summary

The iCKB library suite is a unique CKB protocol library — there are no direct competitors. It handles NervosDAO liquid staking via the iCKB xUDT token, featuring multi-representation value tracking (UDT tokens + receipt cells + DAO deposit cells), limit order matching, and delegated withdrawal management. The established TypeScript/pnpm/CCC stack is sound. The entire migration centers on one architectural pivot: removing `SmartTransaction` (a `ccc.Transaction` subclass abandoned by the broader CCC ecosystem) and replacing its responsibilities with plain `ccc.Transaction` combined with CCC-native APIs — specifically the `@ckb-ccc/udt` package's `Udt` class and the transaction completion methods added to CCC core (`completeFeeBy`, `completeInputsByCapacity`, `completeFeeChangeToLock`).

The recommended approach is a strict bottom-up refactoring that proceeds through the dependency graph: `@ickb/utils` (remove SmartTransaction/UdtHandler/UdtManager) → `@ickb/dao` and `@ickb/order` (update to plain `ccc.Transaction`) → `@ickb/core` (create `IckbUdt extends udt.Udt` with iCKB-specific balance overrides) → `@ickb/sdk` (explicit completion pipeline) → apps (bot, interface, tester migrated from Lumos). CCC's `Udt` class covers standard xUDT operations; iCKB's triple-representation value logic must remain in `IckbUdt` and must NOT be delegated to a generic Udt subclass that changes how `completeInputsByBalance` selects cells.

The primary risk is losing implicit behaviors baked into `SmartTransaction` — particularly the DAO-profit-aware `getInputsCapacity` override, the 64-output NervosDAO limit check inside `completeFee`, and the UDT handler dispatch loop that runs before CKB fee completion. All three of these are silent, non-obvious behaviors that a mechanical find-and-replace will miss. The mitigation is straightforward: catalog every SmartTransaction-specific method, write characterization tests before touching anything, and add codec roundtrip tests to prevent byte-level regressions in the Molecule encodings that the on-chain contracts enforce.

## Key Findings

### Recommended Stack

The existing TypeScript/pnpm/CCC stack requires no new technology choices. The migration is a CCC API adoption exercise: replace 14 local utilities with CCC equivalents (`ccc.numMax`/`numMin`, `ccc.gcd`, `ccc.isHex`, `Udt.balanceFromUnsafe`, etc.), add `@ckb-ccc/udt` as a dependency to `@ickb/core`, and restructure transaction building around CCC's native completion pipeline. The local `ccc-fork/` build system already makes `@ckb-ccc/udt` available via `.pnpmfile.cjs` rewriting — no additional infrastructure work needed.

**Core technologies:**
- `@ckb-ccc/core` ^1.12.2: Transaction building, cell queries, signer abstraction — already adopted, native replacement for all SmartTransaction behaviors
- `@ckb-ccc/udt` (local ccc-fork build): UDT lifecycle management (cell finding, balance calculation, input completion, change handling) — replaces local UdtManager/UdtHandler; `IckbUdt` subclasses this
- `ccc.Transaction.completeFeeBy` / `completeFeeChangeToLock`: CKB fee completion — direct SmartTransaction.completeFee replacement for the CKB-change portion
- `ccc.Transaction.completeInputsByCapacity`: CKB capacity input collection — replaces CapacityManager's cell-finding role
- `ccc.Client.cache`: Transparent header caching — replaces SmartTransaction's `headers` map for performance; header deps must still be added explicitly

**Do NOT use:**
- `SmartTransaction`: Abandoned ecosystem pattern; all capabilities now exist in CCC natively
- `UdtHandler` / `UdtManager`: Parallel type system absorbed by CCC's `Udt` class
- `CapacityManager` (for input completion): `tx.completeInputsByCapacity(signer)` does this in one call
- Deprecated CCC APIs: `ccc.udtBalanceFrom()`, `ccc.Transaction.getInputsUdtBalance()`, `ccc.Transaction.completeInputsByUdt()`

### Expected Features

**Must have (table stakes — blocks npm publication):**
- SmartTransaction removal (TS-1) — the critical path; all other work depends on it
- CCC utility deduplication (TS-2) — adopt CCC equivalents, keep iCKB-unique utilities
- Clean public API surface (TS-3) — audit exports, mark internals, curate index.ts files
- Bot migration (TS-5) — validates entire library stack under real production conditions
- Multi-representation UDT preservation (D-1) — iCKB balance logic must survive removal intact
- npm publication with provenance (TS-11) — already configured, depends on clean API

**Should have (add after bot migration validates the library):**
- Interface app migration (TS-6) — same UI, swap Lumos internals for CCC + new packages
- Tester app migration (TS-7) — validates all transaction paths in simulation
- Complete Lumos removal (TS-4) — remove `@ickb/lumos-utils`, `@ickb/v1-core`, all `@ckb-lumos/*`; gate on all apps migrated
- CCC Udt subclassing investigation (D-2) — exploratory; informs long-term architecture
- Type export audit (TS-12) — after public API stabilizes

**Defer (v2+):**
- Upstream CCC contributions (D-9) — continue tracking FeePayer PR #328; adopt if merged
- Additional UDT type support — generalize pattern if other xUDT tokens need multi-representation handling
- Pool snapshot encoding improvements — only if bot requirements grow beyond current capacity

The library already implements all differentiators (D-3 through D-8, D-10): maturity estimation, pool snapshots, async generator cell discovery, composable ScriptDeps pattern, deterministic exchange rates, limit order lifecycle, delegated withdrawals. These must survive the migration unchanged.

### Architecture Approach

The architecture shifts from a God-object transaction (SmartTransaction carrying UDT handlers + header cache + overridden behaviors) to a layered composition model: plain `ccc.Transaction` for state, standalone utility functions for concerns like header dep management, `IckbUdt extends udt.Udt` for iCKB-specific balance calculation, and an explicit completion pipeline at the call site (complete UDT first, then CKB capacity, then fee). The build order is strictly bottom-up through the dependency graph.

**Major components:**
1. `@ickb/utils` — async data utilities (`collect`, `unique`, `binarySearch`, `MinHeap`), codec utilities; NO SmartTransaction, NO UdtHandler, NO UdtManager, NO CapacityManager, NO `getHeader()`/`HeaderKey` after refactor
2. `@ickb/dao` + `@ickb/order` — domain managers operating on plain `ccc.Transaction`; add cell deps directly; no UDT awareness
3. `@ickb/core` — `IckbUdt extends udt.Udt` overriding `infoFrom()` for triple-representation balance; `LogicManager` and `OwnedOwnerManager` for iCKB protocol operations
4. `@ickb/sdk` — `IckbSdk` facade orchestrating all managers; explicit completion pipeline: `ickbUdt.completeBy(tx, signer)` then `tx.completeFeeBy(signer)`
5. Apps (bot, interface, tester) — consume SDK; no direct manager usage for most operations

**Key pattern — explicit completion pipeline:**
```typescript
const tx = ccc.Transaction.default();
// domain operations...
const completedTx = await ickbUdt.completeBy(tx, signer);   // UDT inputs + change
await completedTx.completeFeeBy(signer);                     // CKB capacity + fee
await signer.sendTransaction(completedTx);
```

**Key architectural decision — override `infoFrom()` (corrected in Phase 3 research):**
`infoFrom()` receives `CellAnyLike` objects — input cells (from `getInputsInfo` → `CellInput.getCell()`) always have `outPoint` set, enabling header fetches for receipt/deposit value calculation. Output cells lack `outPoint`, allowing `infoFrom` to distinguish inputs from outputs. See 03-RESEARCH.md for the corrected design.

### Critical Pitfalls

1. **SmartTransaction implicit behaviors lost during removal** — `completeFee` silently iterates all UDT handlers, `getInputsCapacity` adds DAO withdrawal profit, `clone()` shares handler/header maps. A mechanical find-and-replace misses all three. Avoid by: cataloging every SmartTransaction-specific method, writing characterization tests before removing anything, and designing the replacement as explicit utility functions rather than a companion object.

2. **Incorrect CCC Udt subclassing for multi-representation value** — CCC's `Udt.completeInputsByBalance` assumes UDT balance = sum of `u128 LE` fields in matching type cells. iCKB's conservation law spans xUDT cells, receipt cells, and DAO deposit cells. Avoid by: overriding `infoFrom()` in `IckbUdt` to value all three cell types with correct sign conventions (Phase 3 research confirmed `CellAnyLike` has `outPoint` for input cells, enabling header fetches). Do NOT override `balanceFrom()` for iCKB-specific representations.

3. **Exchange rate divergence between TypeScript and Rust contract** — The `ickbValue()` formula must produce byte-identical results to the on-chain `ickb_logic` script. Integer division order and the soft-cap formula are dangerous. Avoid by: creating cross-validation tests with known Rust contract outputs BEFORE touching any exchange rate code.

4. **64-output NervosDAO limit lost from `completeFee`** — This check is buried in SmartTransaction's `completeFee` override and currently enforced in 6 separate locations. Removal without consolidation will cause production failures. Avoid by: extracting a single `assertDaoOutputLimit(tx)` utility called from one canonical location, with an integration test that verifies a 65-output DAO transaction throws.

5. **Conservation law violation during app migration** — The bot must produce byte-identical transactions to the Lumos version. On-chain contracts enforce position-sensitive rules (owned_distance relative offsets, master_distance in orders, witness structure for DAO withdrawals). Avoid by: migrating in a feature branch, capturing golden transactions from the Lumos bot, comparing byte-for-byte with the CCC version, and keeping the Lumos bot runnable during the testnet validation period.

6. **Molecule codec byte layout mismatch** — `ReceiptData`, `OwnedOwnerData`, `OrderData` must match the Molecule schema exactly. TypeScript field reordering silently changes byte encoding. Avoid by: adding codec roundtrip tests with hardcoded expected hex strings before any refactoring.

## Implications for Roadmap

> **Note:** The phase structure below was a pre-roadmap research suggestion. The actual ROADMAP (`.planning/ROADMAP.md`) uses a different 7-phase feature-slice approach: SmartTransaction Removal → CCC Utility Adoption → Udt Investigation → Deprecated API Replacement → Core UDT Refactor → SDK Completion → Full Verification. App migration (bot, interface, tester) is deferred to a future milestone. The research findings below still inform the roadmap decisions.

Based on research, suggested phase structure:

### Phase 1: Library Foundation Refactor
**Rationale:** SmartTransaction removal is the critical path — 100% of downstream work depends on it. Characterization tests and codec tests must come first to create a safety net. CCC utility deduplication is cheap and cleans up the API surface. The dependency graph demands `@ickb/utils` changes before any domain package changes.
**Delivers:** CCC-native library packages with clean public API; no SmartTransaction anywhere; all P1 features ready for npm publication; test infrastructure protecting against regressions.
**Addresses:** TS-1 (SmartTransaction removal), TS-2 (utility deduplication), TS-3 (clean public API), D-1 (multi-representation UDT preservation)
**Avoids:** Pitfalls 1 (SmartTransaction implicit behaviors), 3 (exchange rate divergence), 4 (64-output limit), 6 (codec byte layout)
**Sub-phases (dependency-driven):**
1a. Test infrastructure: characterization tests for SmartTransaction behaviors; codec roundtrip tests; exchange rate cross-validation fixtures
1b. `@ickb/utils`: remove SmartTransaction, CapacityManager, `getHeader()`/`HeaderKey`; adopt CCC utility equivalents
1c. `@ickb/dao` + `@ickb/order` (parallel): update all manager methods from `SmartTransaction` to `ccc.TransactionLike`
1d. `@ickb/core`: create `IckbUdt extends udt.Udt`; update LogicManager/OwnedOwnerManager
1e. `@ickb/sdk`: implement explicit completion pipeline; update IckbSdk facade
**Research flag:** Phase 1d needs careful investigation — the `IckbUdt` subclassing approach is architecturally sound (confirmed by both STACK.md and ARCHITECTURE.md research) but the header-access-in-`getInputsInfo` pattern requires verification against the CCC `Udt` API.

### Phase 2: Bot Migration and Library Validation
**Rationale:** The bot is the integration test for the entire library. It exercises every transaction type (deposit, withdrawal request, withdrawal, order match, order melt) under real production conditions. Bot migration cannot happen before Phase 1 completes — the bot must target the final library API, not an intermediate state. TS-5 (bot migration) is P1 precisely because it validates the library is production-ready.
**Delivers:** Fully migrated bot running on CCC + new packages; testnet validation complete; npm publication of updated packages.
**Addresses:** TS-5 (bot migration), TS-11 (npm publication)
**Avoids:** Pitfall 4 (conservation law violation during migration), Pitfall 3 (key logging security)
**Research flag:** No additional research needed — the migration pattern is well-documented by existing Lumos bot code and the new library API surface. Standard patterns apply.

### Phase 3: App Migration and Lumos Removal
**Rationale:** Interface and tester migrations are unblocked only after bot migration proves the library API is stable and correct. Lumos removal is the final gate — can only happen after all three legacy apps are migrated. This phase is lower stakes than Phase 2 (the interface has no autonomous signing; the tester uses simulation mode).
**Delivers:** All 5 apps on CCC; zero Lumos dependencies in the monorepo; complete removal of `@ickb/lumos-utils` and `@ickb/v1-core`.
**Addresses:** TS-6 (interface migration), TS-7 (tester migration), TS-4 (Lumos removal), TS-12 (type export audit)
**Avoids:** UX pitfalls (wallet connector behavior change, fee estimation differences, React Query cache migration)
**Research flag:** Interface migration is straightforward (same UI, swap data layer) but the JoyId wallet connector behavior difference between Lumos and CCC needs manual verification with actual wallet hardware.

### Phase 4: Ecosystem Hardening
**Rationale:** After the library is stable and published, long-term ecosystem work becomes safe to pursue without destabilizing production.
**Delivers:** CCC Udt investigation conclusions; potential upstream CCC contributions; type export completeness; improved test coverage.
**Addresses:** D-2 (CCC Udt investigation), D-9 (upstream contributions), TS-12 (type audit if deferred)
**Avoids:** Pitfall 2 (CCC Udt subclassing for multi-representation value) — this is where the subclassing viability is confirmed or the fallback approach is chosen
**Research flag:** D-2 (CCC Udt subclassing investigation) is explicitly exploratory — findings may change the long-term architecture of `IckbUdt`. Schedule this after Phase 2 validation so the decision is informed by production experience.

### Phase Ordering Rationale

- **Test infrastructure before code changes:** The pitfalls research is unambiguous — characterization tests and codec roundtrip tests must exist before removing SmartTransaction. Adding them after is too late.
- **Library before apps:** The feature dependency graph is strict: TS-1 → TS-5 → TS-6/TS-7 → TS-4. Any deviation risks app migration targeting an unstable API.
- **Bot before interface:** Bot validates correctness under real conditions. Interface migration is lower risk but depends on knowing the library is correct.
- **Lumos removal last:** The legacy packages must remain functional until every consumer is migrated. Early removal blocks incremental progress.
- **Udt investigation deferred:** D-2 is exploratory and should not block production library work. Its findings are architecture inputs for future decisions, not requirements for v1.

### Research Flags

Needs deeper research during planning:
- **Phase 1d (IckbUdt subclassing):** **Resolved in Phase 3 research.** `infoFrom()` is the preferred override point — input cells have `outPoint` for header fetching, `CellAny` has `capacityFree`. See 03-RESEARCH.md.
- **Phase 3 (JoyId wallet connector):** Manual testing with actual JoyId hardware required; CCC's wallet connector API differs from Lumos in ways that affect UX flow.

Standard patterns (skip research-phase):
- **Phase 1b/1c (utils, dao, order refactor):** Mapping of SmartTransaction methods to CCC equivalents is fully documented in STACK.md. Straight mechanical migration with test coverage.
- **Phase 2 (bot migration):** Pattern is migration from Lumos primitives to CCC + new packages. Well-documented by existing code and the explicit completion pipeline.
- **Phase 4 (npm publication):** Already configured (changesets, provenance). Execution only.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Primary source is local CCC source code (`ccc-fork/ccc/`); all APIs verified by direct inspection |
| Features | HIGH | Based on direct codebase analysis + CCC docs + npm ecosystem survey; competitor analysis confirms iCKB has no direct competitors |
| Architecture | HIGH | Build order derived from package dependency graph; key patterns verified against CCC Udt source; override point resolved (`infoFrom`, not `getInputsInfo`/`getOutputsInfo` — see Phase 3 research) |
| Pitfalls | HIGH | Derived from direct code reading (SmartTransaction 517 lines, IckbUdtManager 213 lines, CCC Udt 1798 lines) and on-chain contract constraints |

**Overall confidence:** HIGH

### Gaps to Address

- **Resolved — CCC Udt override point:** Phase 3 research (03-RESEARCH.md) determined that `infoFrom()` is the optimal override point. The earlier recommendation to override `getInputsInfo()`/`getOutputsInfo()` was based on the incorrect premise that `CellAnyLike` lacks `outPoint` — it actually has `outPoint?: OutPointLike | null`, and input cells from `getInputsInfo()` → `CellInput.getCell()` always have `outPoint` set. `CellAny` also has `capacityFree`. See 03-RESEARCH.md for the corrected design.
- **Resolved — DAO profit in CCC `getInputsCapacity`:** Verified from CCC source (transaction.ts lines 1860-1883) that `Transaction.getInputsCapacity()` handles DAO profit natively via `getInputsCapacityExtra()` → `CellInput.getExtraCapacity()` → `Cell.getDaoProfit()`. No standalone utility needed. SmartTransaction's override of `getInputsCapacity()` can be dropped without replacement.
- **Resolved — CCC PR #328 (FeePayer):** PR #328 is now integrated into `ccc-fork/ccc` via pins. FeePayer classes are available at `ccc-fork/ccc/packages/core/src/signer/feePayer/`. User decision during Phase 3 context: design around PR #328 as target architecture.
- **Bot key logging security:** PITFALLS.md notes the faucet already has a private key logging bug. The bot migration must include an explicit security audit of all logging paths.

## Sources

### Primary (HIGH confidence)
- `ccc-fork/ccc/packages/udt/src/udt/index.ts` — CCC Udt class (1798 lines), complete UDT lifecycle API
- `ccc-fork/ccc/packages/core/src/ckb/transaction.ts` — CCC Transaction class (2537 lines), completeFee/completeInputsByCapacity/getInputsCapacity
- `ccc-fork/ccc/packages/core/src/client/client.ts` — CCC Client with cache, findCells, cell/header fetching
- `packages/utils/src/transaction.ts` — SmartTransaction (deleted in Phase 1), was source of truth for replacement requirements
- `packages/utils/src/udt.ts` — Current UdtManager/UdtHandler (393 lines)
- `packages/core/src/udt.ts` — Current IckbUdtManager (213 lines), triple-representation balance logic
- `reference/contracts/schemas/encoding.mol` — Molecule schema, byte layout ground truth
- `reference/contracts/scripts/contracts/ickb_logic/src/entry.rs` — On-chain conservation law and exchange rate
- `.planning/PROJECT.md` — Project requirements and constraints

### Secondary (MEDIUM confidence)
- CCC GitHub: [ckb-devrel/ccc](https://github.com/ckb-devrel/ccc) — ecosystem context, PR #328 status
- CCC docs: [docs.ckbccc.com](https://docs.ckbccc.com/) — API surface documentation
- @ickb/utils on npm: [npmjs.com/@ickb/utils](https://www.npmjs.com/package/@ickb/utils) — current published versions

### Tertiary (LOW confidence)
- Enhanced UDT Standard discussion: [Nervos Talk](https://talk.nervos.org/t/enhanced-udt-standard/8354) — ecosystem context only

---
*Research completed: 2026-02-21*
*Ready for roadmap: yes*
