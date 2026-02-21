# Roadmap: iCKB Stack v2

## Overview

This roadmap delivers the v1 milestone: removing the abandoned SmartTransaction abstraction, adopting CCC-native utilities and UDT patterns, and verifying the entire 5-package library suite compiles and functions against plain `ccc.Transaction`. The work follows the package dependency graph bottom-up (`@ickb/utils` -> `@ickb/dao` + `@ickb/order` -> `@ickb/core` -> `@ickb/sdk`), with a parallel design investigation for CCC Udt integration that feeds into the `@ickb/core` refactor.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: @ickb/utils SmartTransaction Removal** - Delete SmartTransaction class and its infrastructure; extract standalone utilities for header caching and DAO output limits
- [ ] **Phase 2: CCC Utility Adoption** - Replace local utility functions that duplicate CCC equivalents across all packages; preserve iCKB-unique utilities
- [ ] **Phase 3: CCC Udt Integration Investigation** - Assess feasibility of subclassing CCC's Udt class for iCKB's multi-representation value; design header access pattern; document decision
- [ ] **Phase 4: @ickb/dao and @ickb/order Migration** - Update DaoManager and OrderManager to accept plain ccc.Transaction; replace UDT handler registration pattern; replace deprecated CCC API calls
- [ ] **Phase 5: @ickb/core Refactor** - Update all remaining managers to plain ccc.Transaction; implement IckbUdt class or refactor IckbUdtManager based on Phase 3 findings; preserve conservation law
- [ ] **Phase 6: SDK Completion Pipeline** - Wire IckbSdk facade to CCC-native fee completion; verify estimate() and maturity() work end-to-end
- [ ] **Phase 7: Full Stack Verification** - Verify all 5 library packages compile clean with no SmartTransaction remnants and no type errors

## Phase Details

### Phase 1: @ickb/utils SmartTransaction Removal
**Goal**: SmartTransaction class and its dependent types (UdtHandler, UdtManager, CapacityManager) are removed from @ickb/utils; header caching and 64-output DAO limit check are consolidated into standalone utility functions
**Depends on**: Nothing (first phase)
**Requirements**: SMTX-02, SMTX-04, SMTX-06
**Success Criteria** (what must be TRUE):
  1. `SmartTransaction` class, `UdtHandler` interface, `UdtManager` class, and `CapacityManager` class no longer exist in `@ickb/utils` source or exports
  2. A standalone `getHeader()` utility function exists that delegates to `ccc.Client.cache` for header lookups instead of maintaining its own `Map<hexString, Header>`
  3. A single `assertDaoOutputLimit(tx)` utility function exists that checks the 64-output NervosDAO limit, replacing the check currently scattered across 6 locations
  4. `@ickb/utils` compiles successfully with the SmartTransaction-related code removed (downstream packages will have expected compilation errors until they are updated)
**Plans**: TBD

Plans:
- [ ] 01-01: TBD
- [ ] 01-02: TBD
- [ ] 01-03: TBD

### Phase 2: CCC Utility Adoption
**Goal**: Local utility functions that duplicate CCC core functionality are replaced with CCC equivalents across all packages; iCKB-unique utilities are explicitly preserved
**Depends on**: Phase 1
**Requirements**: DEDUP-01, DEDUP-02, DEDUP-03, DEDUP-04, DEDUP-05
**Success Criteria** (what must be TRUE):
  1. All call sites using local `max()`/`min()` now use `ccc.numMax()`/`ccc.numMin()` and the local implementations are deleted
  2. All call sites using local `gcd()` now use `ccc.gcd()` and the local implementation is deleted
  3. Local `isHex()` in `@ickb/utils` is replaced with `ccc.isHex()`
  4. Local `hexFrom()` call sites are refactored to explicit calls: `ccc.numToHex()` for bigint and `ccc.hexFrom(entity.toBytes())` for entities (CCC's `hexFrom()` only handles `HexLike`, not `bigint | Entity`)
  5. iCKB-unique utilities (`binarySearch`, `asyncBinarySearch`, `shuffle`, `unique`, `collect`, `BufferedGenerator`, `MinHeap`) remain in `@ickb/utils` unchanged
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: CCC Udt Integration Investigation
**Goal**: Clear, documented decision on whether IckbUdt should extend CCC's `udt.Udt` class for iCKB's multi-representation value (xUDT + receipts + deposits), with the header access pattern designed
**Depends on**: Nothing (can proceed in parallel with Phases 1-2; design investigation, not code changes)
**Requirements**: UDT-01, UDT-02, UDT-03
**Success Criteria** (what must be TRUE):
  1. A written feasibility assessment exists answering: can `IckbUdt extends udt.Udt` override `getInputsInfo()`/`getOutputsInfo()` to account for receipt cells and deposit cells alongside xUDT cells, without breaking CCC's internal method chains
  2. The header access pattern for receipt value calculation is designed and documented -- specifying whether `client.getCellWithHeader()`, `client.getHeaderByTxHash()`, or the existing `getHeader()` utility is used within the Udt override
  3. A decision document exists with one of three outcomes: (a) subclass CCC Udt, (b) keep custom interface, (c) hybrid approach -- with rationale for the chosen path
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: @ickb/dao and @ickb/order Migration
**Goal**: DaoManager and OrderManager accept plain `ccc.Transaction`; the UDT handler registration pattern (`addUdtHandlers()`) is replaced in these packages; deprecated CCC API calls are replaced with `@ckb-ccc/udt` equivalents
**Depends on**: Phase 1 (SmartTransaction removed from utils)
**Requirements**: SMTX-05, SMTX-10
**Success Criteria** (what must be TRUE):
  1. `DaoManager` methods in `@ickb/dao` accept `ccc.Transaction` as their transaction parameter (not `SmartTransaction`)
  2. `OrderManager` methods in `@ickb/order` accept `ccc.Transaction` as their transaction parameter (not `SmartTransaction`)
  3. No calls to `addUdtHandlers()` exist in `@ickb/dao` or `@ickb/order`; UDT-related operations use direct `Udt` instance methods or standalone utility functions
  4. No calls to deprecated CCC APIs (`udtBalanceFrom`, `getInputsUdtBalance`, `getOutputsUdtBalance`, `completeInputsByUdt`) exist in `@ickb/dao` or `@ickb/order`
  5. Both `@ickb/dao` and `@ickb/order` compile successfully
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: @ickb/core Refactor
**Goal**: All remaining managers (LogicManager, OwnedOwnerManager, IckbUdtManager) accept plain `ccc.Transaction`; IckbUdt class is implemented or IckbUdtManager is refactored based on Phase 3 findings; the iCKB conservation law is preserved through the refactor
**Depends on**: Phase 3 (UDT decision), Phase 4 (dao+order done)
**Requirements**: SMTX-01, SMTX-07, UDT-04, UDT-05
**Success Criteria** (what must be TRUE):
  1. ALL manager methods across ALL 5 library packages accept `ccc.Transaction` instead of `SmartTransaction` (this is the completion gate for SMTX-01 -- utils managers removed in Phase 1, dao+order managers updated in Phase 4, core managers updated here)
  2. The iCKB conservation law (`Input UDT + Input Receipts = Output UDT + Input Deposits`) is enforced correctly in the refactored code -- multi-representation UDT balance logic survives intact
  3. If Phase 3 concluded subclassing is viable: `IckbUdt extends udt.Udt` exists in `@ickb/core` with overridden `getInputsInfo()`/`getOutputsInfo()` that account for xUDT cells, receipt cells, and deposit cells
  4. If Phase 3 concluded subclassing is not viable: `IckbUdtManager` is refactored to work with plain `ccc.Transaction` while maintaining a compatible interface for balance calculation
  5. `@ickb/core` compiles successfully with no SmartTransaction imports
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

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
(Note: Phase 3 could theoretically start in parallel with Phases 1-2, but sequential execution is configured)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. @ickb/utils SmartTransaction Removal | 0/3 | Not started | - |
| 2. CCC Utility Adoption | 0/2 | Not started | - |
| 3. CCC Udt Integration Investigation | 0/2 | Not started | - |
| 4. @ickb/dao and @ickb/order Migration | 0/2 | Not started | - |
| 5. @ickb/core Refactor | 0/3 | Not started | - |
| 6. SDK Completion Pipeline | 0/2 | Not started | - |
| 7. Full Stack Verification | 0/1 | Not started | - |
