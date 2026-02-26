# Roadmap: iCKB Stack v2

## Overview

This roadmap delivers the v1 milestone: removing the abandoned SmartTransaction abstraction, adopting CCC-native utilities and UDT patterns, and verifying the entire 5-package library suite compiles and functions against plain `ccc.Transaction`. Phase 1 uses a **feature-slice approach** — each removal is chased across all packages so the build stays green at every step, which front-loads method signature migration. Later phases handle UDT pattern finalization (after Phase 3 investigation), deprecated API replacement, SDK completion, and full verification.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: SmartTransaction Removal (feature-slice)** - Delete SmartTransaction class and infrastructure across all packages; contribute 64-output DAO limit check to CCC core; migrate all method signatures to ccc.TransactionLike
- [x] **Phase 2: CCC Utility Adoption** - Replace local utility functions that duplicate CCC equivalents across all packages; preserve iCKB-unique utilities
- [x] **Phase 3: CCC Udt Integration Investigation** - Assess feasibility of subclassing CCC's Udt class for iCKB's multi-representation value; design header access pattern; document decision
- [x] **Phase 4: Deprecated CCC API Replacement** - Replace UdtHandler dependency in `@ickb/order` with plain `ccc.Script`; remove UDT cellDeps management from OrderManager; correct Phase 3 docs; verify `@ickb/dao` already clean
- [ ] **Phase 5: @ickb/core UDT Refactor** - Implement `IckbUdt extends udt.Udt` with `infoFrom` override; remove `udtHandler` from LogicManager/OwnedOwnerManager; delete UdtHandler/UdtManager/ErrorTransactionInsufficientCoin/findUdts from utils; adopt individual code deps for IckbUdt; update SDK construction and error handling
- [ ] **Phase 6: SDK Completion Pipeline** - Wire IckbSdk facade to CCC-native fee completion; verify estimate() and maturity() work end-to-end
- [ ] **Phase 7: Full Stack Verification** - Verify all 5 library packages compile clean with no SmartTransaction remnants and no type errors

## Phase Details

### Phase 1: SmartTransaction Removal (feature-slice)
**Goal**: SmartTransaction class, CapacityManager class are deleted; all manager method signatures across all 5 library packages accept `ccc.TransactionLike` instead of `SmartTransaction`; 64-output DAO limit check is contributed to CCC core; `getHeader()`/`HeaderKey` are removed and inlined. Each removal is chased across all packages — build stays green at every step.
**Depends on**: Nothing (first phase)
**Requirements**: SMTX-01, SMTX-02, SMTX-04, SMTX-06
**Success Criteria** (what must be TRUE):
  1. `SmartTransaction` class and `CapacityManager` class no longer exist in `@ickb/utils` source or exports
  2. `UdtHandler` interface and `UdtManager` class remain in `@ickb/utils` with method signatures updated from `SmartTransaction` to `ccc.TransactionLike` (full replacement deferred to Phase 3+)
  3. `getHeader()` function and `HeaderKey` type are removed from `@ickb/utils`; all call sites across dao/core/sdk inline CCC client calls (`client.getTransactionWithHeader()`, `client.getHeaderByNumber()`); `SmartTransaction.addHeaders()` call sites in DaoManager/LogicManager push to `tx.headerDeps` directly
  4. A 64-output NervosDAO limit check exists in CCC core (via `forks/ccc/`): `completeFee()` safety net, standalone async utility, and `ErrorNervosDaoOutputLimit` error class; all 6+ scattered checks across dao/core packages are replaced with calls to this CCC utility
  5. ALL manager method signatures across ALL 5 library packages accept `ccc.TransactionLike` instead of `SmartTransaction`, following CCC's convention (TransactionLike input, Transaction output with `Transaction.from()` conversion at entry point)
  6. `pnpm check:full` passes after each feature-slice removal step — no intermediate broken states
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Build CCC DAO utility (ErrorNervosDaoOutputLimit + assertDaoOutputLimit) and replace all 7 scattered DAO checks
- [x] 01-02-PLAN.md — Remove getHeader()/HeaderKey, inline CCC client calls at all call sites, replace addHeaders with headerDeps push
- [x] 01-03-PLAN.md — Delete SmartTransaction + CapacityManager, update all method signatures to TransactionLike, clean SDK

### Phase 2: CCC Utility Adoption
**Goal**: Local utility functions that duplicate CCC core functionality are replaced with CCC equivalents across all packages; iCKB-unique utilities are explicitly preserved
**Depends on**: Phase 1
**Requirements**: DEDUP-01, DEDUP-02, DEDUP-03, DEDUP-04, DEDUP-05
**Success Criteria** (what must be TRUE):
  1. All call sites using local `max()`/`min()` now use `Math.max()`/`Math.min()` (number-typed contexts) and the local implementations are deleted
  2. All call sites using local `gcd()` now use `ccc.gcd()` and the local implementation is deleted
  3. Local `isHex()` in `@ickb/utils` is replaced with `ccc.isHex()`
  4. Local `hexFrom()` call sites are refactored to explicit calls: `ccc.numToHex()` for bigint and `ccc.hexFrom(entity.toBytes())` for entities (CCC's `hexFrom()` only handles `HexLike`, not `bigint | Entity`)
  5. iCKB-unique utilities (`binarySearch`, `asyncBinarySearch`, `shuffle`, `unique`, `collect`, `BufferedGenerator`, `MinHeap`) remain in `@ickb/utils` unchanged
**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md — Replace local max/min/gcd/hexFrom/isHex with CCC equivalents, delete local implementations, preserve iCKB-unique utilities

### Phase 3: CCC Udt Integration Investigation
**Goal**: Clear, documented decision on whether IckbUdt should extend CCC's `udt.Udt` class for iCKB's multi-representation value (xUDT + receipts + deposits), with the header access pattern designed. This decision determines the replacement for UdtHandler/UdtManager (which remain in `@ickb/utils` with updated signatures after Phase 1).
**Depends on**: Nothing (can proceed in parallel with Phases 1-2; design investigation, not code changes)
**Requirements**: UDT-01, UDT-02, UDT-03
**Success Criteria** (what must be TRUE):
  1. A written feasibility assessment exists answering: can `IckbUdt extends udt.Udt` override `infoFrom()` (or `getInputsInfo()`/`getOutputsInfo()`) to account for receipt cells and deposit cells alongside xUDT cells, without breaking CCC's internal method chains
  2. The header access pattern for receipt value calculation is designed and documented -- specifying whether `client.getCellWithHeader()`, `client.getTransactionWithHeader()`, or direct CCC client calls are used within the Udt override (note: `getHeader()` was removed in Phase 1)
  3. A decision document exists with one of three outcomes: (a) subclass CCC Udt, (b) keep custom interface, (c) hybrid approach -- with rationale for the chosen path
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Trace CCC Udt internals end-to-end, verify infoFrom override feasibility, resolve open questions
- [x] 03-02-PLAN.md — Write formal decision document (feasibility assessment, header access pattern, decision with rationale)

### Phase 4: Deprecated CCC API Replacement
**Goal**: `UdtHandler` dependency in `@ickb/order` is replaced with plain `ccc.Script` (`udtScript`); UDT cellDeps management removed from OrderManager (caller/CCC Udt handles externally during balance completion); `@ickb/dao` verified clean (no UdtHandler, no deprecated APIs); Phase 3 decision doc corrected to match actual codebase state
**Depends on**: Phase 1 (signatures migrated), Phase 3 (UDT decision)
**Requirements**: SMTX-05
**Success Criteria** (what must be TRUE):
  1. `OrderManager` constructor accepts `udtScript: ccc.Script` instead of `udtHandler: UdtHandler` -- all 9 `this.udtHandler.script` references replaced with `this.udtScript`
  2. All `tx.addCellDeps(this.udtHandler.cellDeps)` calls removed from `mint()`, `addMatch()`, `melt()` -- UDT cellDeps are caller responsibility
  3. `@ickb/order` no longer imports `UdtHandler` from `@ickb/utils`; no new `@ckb-ccc/udt` dependency added
  4. `@ickb/dao` has no UdtHandler references and no deprecated CCC API calls (verified, no changes needed)
  5. Phase 3 decision doc `03-DECISION.md` "Implementation Guidance for Phase 4" section corrected
  6. `pnpm check:full` passes
**Plans**: 1 plan

Plans:
- [x] 04-01-PLAN.md — Replace OrderManager udtHandler with udtScript: ccc.Script, remove UDT cellDeps, update SDK caller, verify dao and decision doc clean

### Phase 5: @ickb/core UDT Refactor
**Goal**: `IckbUdt extends udt.Udt` implemented in `@ickb/core` with `infoFrom` override for multi-representation balance; iCKB conservation law preserved via accurate balance reporting; `udtHandler` removed from LogicManager/OwnedOwnerManager (Phase 4 pattern); `UdtHandler`, `UdtManager`, `ErrorTransactionInsufficientCoin`, `UdtCell`, `findUdts`, `addUdts` deleted from `@ickb/utils`; IckbUdt uses individual code deps (not dep group) with overridden `addCellDeps`; SDK updated to construct `IckbUdt` and handle CCC's `ErrorUdtInsufficientCoin`. See `05-CONTEXT.md` for full decisions.
**Depends on**: Phase 3 (UDT decision), Phase 4 (order UDT pattern finalized)
**Requirements**: SMTX-05, SMTX-07, SMTX-10, UDT-04
**Success Criteria** (what must be TRUE):
  1. `IckbUdt extends udt.Udt` exists in `@ickb/core` with overridden `infoFrom()` that accurately values xUDT cells (positive), receipt cells (positive, input only), and deposit cells (negative, input only) -- conservation law preserved via correct sign conventions
  2. `IckbUdt.addCellDeps` overridden to add individual code deps (xUDT code OutPoint + iCKB Logic code OutPoint) instead of dep group
  3. `IckbUdtManager.calculateScript` renamed to `IckbUdt.typeScriptFrom` (static, same params)
  4. `LogicManager` and `OwnedOwnerManager` no longer take `udtHandler` parameter; `tx.addCellDeps(this.udtHandler.cellDeps)` calls removed (4 sites) -- UDT cellDeps are caller responsibility (Phase 4 pattern)
  5. `UdtHandler` interface, `UdtManager` class, `ErrorTransactionInsufficientCoin` class, `UdtCell` interface, `findUdts`, `addUdts`, `isUdtSymbol` deleted from `@ickb/utils`
  6. No calls to deprecated CCC APIs (`ccc.udtBalanceFrom`) exist in `@ickb/core` or `@ickb/utils`
  7. SDK constructs `IckbUdt` instead of `IckbUdtManager`; passes `ickbUdt.script` to managers; handles `ErrorUdtInsufficientCoin` from CCC (not old `ErrorTransactionInsufficientCoin`)
  8. `pnpm check:full` passes
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — Implement IckbUdt extends udt.Udt in core (infoFrom, addCellDeps, typeScriptFrom); remove udtHandler from LogicManager/OwnedOwnerManager; add @ckb-ccc/udt dependency
- [ ] 05-02-PLAN.md — Delete UDT infrastructure from utils (UdtHandler, UdtManager, ErrorTransactionInsufficientCoin, UdtCell, findUdts, addUdts); update SDK to construct IckbUdt with code OutPoints; verify pnpm check:full

### Phase 6: SDK Completion Pipeline
**Goal**: IckbSdk facade uses CCC-native fee completion pipeline; estimate() and maturity() continue working after SmartTransaction removal
**Depends on**: Phase 5 (core refactored)
**Requirements**: SMTX-03, SMTX-08
**Success Criteria** (what must be TRUE):
  1. `IckbSdk` transaction building uses `ccc.Transaction.completeFeeBy()` or `completeFeeChangeToLock()` for fee completion, with DAO-aware capacity calculation (no SmartTransaction.completeFee override)
  2. `IckbSdk.estimate()` returns correct iCKB exchange rate estimates when called against the refactored library
  3. `IckbSdk.maturity()` returns correct deposit maturity information when called against the refactored library
  4. The explicit completion pipeline ordering is correct: UDT completion before CKB capacity completion before fee completion
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Full Stack Verification
**Goal**: All 5 library packages compile clean with strict TypeScript settings, no SmartTransaction remnants, and no deprecated CCC API calls anywhere in the codebase
**Depends on**: Phase 6 (SDK done -- all packages now updated)
**Requirements**: SMTX-09
**Success Criteria** (what must be TRUE):
  1. `pnpm check:full` passes -- all 5 library packages (`@ickb/utils`, `@ickb/dao`, `@ickb/order`, `@ickb/core`, `@ickb/sdk`) compile with zero type errors under strict TypeScript settings (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride`)
  2. No imports of `SmartTransaction` exist anywhere in the codebase (library packages or apps)
  3. No calls to deprecated CCC APIs (`udtBalanceFrom`, `getInputsUdtBalance`, `getOutputsUdtBalance`, `completeInputsByUdt`) exist anywhere in the 5 library packages
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
(Note: Phase 3 could start in parallel with Phases 1-2; Phase 4 now depends on Phase 3 in addition to Phase 1)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. SmartTransaction Removal (feature-slice) | 3/3 | Complete    | 2026-02-22 |
| 2. CCC Utility Adoption | 1/1 | Complete    | 2026-02-23 |
| 3. CCC Udt Integration Investigation | 2/2 | Complete    | 2026-02-24 |
| 4. Deprecated CCC API Replacement | 1/1 | Complete    | 2026-02-26 |
| 5. @ickb/core UDT Refactor | 0/2 | Not started | - |
| 6. SDK Completion Pipeline | 0/2 | Not started | - |
| 7. Full Stack Verification | 0/1 | Not started | - |
