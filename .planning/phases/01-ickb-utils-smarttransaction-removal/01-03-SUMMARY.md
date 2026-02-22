---
phase: 01-ickb-utils-smarttransaction-removal
plan: 03
subsystem: transaction
tags: [SmartTransaction, CapacityManager, TransactionLike, ccc-Transaction, API-cleanup]

# Dependency graph
requires:
  - phase: 01-01
    provides: assertDaoOutputLimit centralized in CCC core; DaoManager/LogicManager async signatures with client parameter
  - phase: 01-02
    provides: getHeader/HeaderKey removed from public API; all consumer packages use direct CCC client calls; TransactionHeader moved to utils.ts
provides:
  - All manager methods accept ccc.TransactionLike and return ccc.Transaction
  - SmartTransaction class and CapacityManager class fully deleted from @ickb/utils
  - addUdtHandlers replaced with tx.addCellDeps(udtHandler.cellDeps) across all packages
  - defaultFindCellsLimit moved from capacity.ts to utils.ts
affects: [01-04]

# Tech tracking
tech-stack:
  added: []
  patterns: [TransactionLike-input-Transaction-return, direct-findCellsOnChain]

key-files:
  created: []
  modified:
    - packages/utils/src/udt.ts
    - packages/utils/src/utils.ts
    - packages/utils/src/index.ts
    - packages/dao/src/dao.ts
    - packages/core/src/logic.ts
    - packages/core/src/owned_owner.ts
    - packages/core/src/udt.ts
    - packages/order/src/order.ts
    - packages/sdk/src/sdk.ts
    - packages/sdk/src/constants.ts
    - apps/faucet/src/main.ts
  deleted:
    - packages/utils/src/transaction.ts
    - packages/utils/src/capacity.ts

key-decisions:
  - "Methods accept ccc.TransactionLike and return ccc.Transaction with ccc.Transaction.from(txLike) at entry, enabling callers to pass plain objects or existing Transactions"
  - "Replaced addUdtHandlers with tx.addCellDeps(this.udtHandler.cellDeps) since addUdtHandlers was just a wrapper around addCellDeps"
  - "SDK getCkb() replaced CapacityManager.findCapacities with direct client.findCellsOnChain calls with scriptLenRange filter"
  - "defaultFindCellsLimit moved from capacity.ts to utils.ts to preserve existing imports across packages"

patterns-established:
  - "TransactionLike pattern: all methods accept ccc.TransactionLike and return ccc.Transaction, converting with Transaction.from() at entry"
  - "Cell deps: use tx.addCellDeps(handler.cellDeps) directly instead of wrapper methods"

requirements-completed: [SMTX-01, SMTX-02, SMTX-03, SMTX-05]

# Metrics
duration: 16min
completed: 2026-02-22
---

# Phase 01 Plan 03: SmartTransaction/CapacityManager Deletion Summary

**Deleted SmartTransaction class and CapacityManager class from @ickb/utils, replaced all 20+ method signatures with ccc.TransactionLike input / ccc.Transaction return pattern**

## Performance

- **Duration:** 16 min
- **Started:** 2026-02-22T16:31:36Z
- **Completed:** 2026-02-22T16:47:58Z
- **Tasks:** 2
- **Files modified:** 13 (11 modified, 2 deleted)

## Accomplishments
- Updated all manager method signatures across 7 files in 5 packages to accept ccc.TransactionLike and return ccc.Transaction
- Replaced all 8 addUdtHandlers() calls with direct tx.addCellDeps(this.udtHandler.cellDeps)
- Deleted SmartTransaction class (460+ lines) and CapacityManager class (220+ lines) from @ickb/utils
- Replaced CapacityManager usage in SDK with direct client.findCellsOnChain calls
- Updated faucet app to use ccc.Transaction.default() with inline cell queries
- Moved defaultFindCellsLimit constant to utils.ts, preserving all downstream imports

## Task Commits

Each task was committed atomically:

1. **Task 1: Update method signatures from SmartTransaction to TransactionLike** - `2e832ae` (refactor)
2. **Task 2: Delete SmartTransaction/CapacityManager and clean exports** - `de8f4a7` (refactor)

## Files Created/Modified
- `packages/utils/src/udt.ts` - UdtHandler interface and UdtManager class: TransactionLike signatures, addUdts returns Transaction
- `packages/utils/src/utils.ts` - Added defaultFindCellsLimit constant (moved from capacity.ts)
- `packages/utils/src/index.ts` - Removed capacity.js and transaction.js barrel exports
- `packages/dao/src/dao.ts` - DaoManager deposit/requestWithdrawal/withdraw: TransactionLike in, Transaction out
- `packages/core/src/logic.ts` - LogicManager deposit/completeDeposit: TransactionLike in, Transaction out
- `packages/core/src/owned_owner.ts` - OwnedOwnerManager requestWithdrawal/withdraw: TransactionLike in, Transaction out
- `packages/core/src/udt.ts` - IckbUdtManager getInputsUdtBalance: TransactionLike parameter
- `packages/order/src/order.ts` - OrderManager mint/addMatch/melt: TransactionLike in, Transaction out
- `packages/sdk/src/sdk.ts` - IckbSdk request/collect: TransactionLike in, Transaction out; getCkb uses findCellsOnChain
- `packages/sdk/src/constants.ts` - Removed CapacityManager from getConfig return type
- `apps/faucet/src/main.ts` - Uses ccc.Transaction.default() + inline findCellsOnChain
- `packages/utils/src/transaction.ts` - DELETED (SmartTransaction class)
- `packages/utils/src/capacity.ts` - DELETED (CapacityManager class)

## Decisions Made
- Methods accept ccc.TransactionLike and return ccc.Transaction. This uses ccc.Transaction.from(txLike) at method entry, which is a no-op if the input is already a Transaction instance. Callers can pass plain transaction-like objects or existing Transactions interchangeably.
- Replaced addUdtHandlers with tx.addCellDeps(this.udtHandler.cellDeps) because addUdtHandlers was internally just a loop calling addCellDeps on each handler's cellDeps array. The direct call is more transparent.
- SDK getCkb() uses direct findCellsOnChain with scriptLenRange: [0n, 1n] filter (no type script) to replicate CapacityManager.withAnyData() behavior, plus explicit lock.eq() check for correctness.
- Deferred SDK CapacityManager removal from Task 1 to Task 2 to keep each task independently compilable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Deferred SDK constructor change from Task 1 to Task 2**
- **Found during:** Task 1 (signature updates)
- **Issue:** Removing CapacityManager from SDK constructor in Task 1 caused lint errors because getCkb() still referenced this.capacity. The plan specified removing SDK capacity in Task 2 but the constructor change in Task 1 broke the build.
- **Fix:** Kept CapacityManager import and constructor field in SDK during Task 1, then properly removed both in Task 2 alongside the findCellsOnChain replacement.
- **Files modified:** packages/sdk/src/sdk.ts
- **Verification:** pnpm check:full passes after both tasks
- **Committed in:** de8f4a7 (Task 2 commit)

**2. [Rule 1 - Bug] Removed unused 'collect' import in faucet app**
- **Found during:** Task 2 (faucet update)
- **Issue:** After replacing CapacityManager with inline findCellsOnChain, the 'collect' import became unused, causing lint failure.
- **Fix:** Removed unused import.
- **Files modified:** apps/faucet/src/main.ts
- **Verification:** pnpm check:full passes
- **Committed in:** de8f4a7 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Necessary task-boundary adjustment to keep each task independently buildable. No scope creep.

## Issues Encountered
- defaultFindCellsLimit was exported from both utils.ts and capacity.ts via barrel index.ts, causing TS2308 ambiguous export error. Resolved by keeping it in capacity.ts during Task 1 and moving to utils.ts only after capacity.ts deletion in Task 2.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SmartTransaction and CapacityManager fully removed from codebase
- All packages use standard CCC Transaction types
- @ickb/utils public API is clean: only exports codec, heap, udt, and utils modules
- Ready for Plan 04 (completeFee refactoring) which can now use plain ccc.Transaction

## Self-Check: PASSED

- FOUND: packages/utils/src/udt.ts
- FOUND: packages/utils/src/utils.ts
- FOUND: packages/utils/src/index.ts
- FOUND: packages/dao/src/dao.ts
- FOUND: packages/core/src/logic.ts
- FOUND: packages/core/src/owned_owner.ts
- FOUND: packages/core/src/udt.ts
- FOUND: packages/order/src/order.ts
- FOUND: packages/sdk/src/sdk.ts
- FOUND: packages/sdk/src/constants.ts
- FOUND: apps/faucet/src/main.ts
- MISSING (expected): packages/utils/src/transaction.ts (deleted)
- MISSING (expected): packages/utils/src/capacity.ts (deleted)
- FOUND: commit 2e832ae (Task 1)
- FOUND: commit de8f4a7 (Task 2)

---
*Phase: 01-ickb-utils-smarttransaction-removal*
*Completed: 2026-02-22*
