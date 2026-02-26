---
phase: 05-ickb-core-udt-refactor
plan: 01
subsystem: core
tags: [udt, ccc, xudt, ickb, balance, cellDeps]

# Dependency graph
requires:
  - phase: 04-deprecated-api-udt-pattern
    provides: UDT pattern (managers receive ccc.Script, cellDeps are caller responsibility)
  - phase: 03-udt-investigation
    provides: IckbUdt subclass design (infoFrom override for multi-representation balance)
provides:
  - IckbUdt class extending udt.Udt with infoFrom, addCellDeps, typeScriptFrom
  - LogicManager without udtHandler parameter
  - OwnedOwnerManager without udtHandler parameter
  - "@ckb-ccc/udt" dependency in @ickb/core
affects: [05-02, sdk, bot]

# Tech tracking
tech-stack:
  added: ["@ckb-ccc/udt"]
  patterns: [IckbUdt subclass with multi-representation infoFrom, individual code deps]

key-files:
  created: []
  modified:
    - packages/core/src/udt.ts
    - packages/core/src/logic.ts
    - packages/core/src/owned_owner.ts
    - packages/core/package.json
    - pnpm-workspace.yaml

key-decisions:
  - "IckbUdt.infoFrom handles three cell types: xUDT (positive), receipt (positive via ickbValue), deposit (negative via ickbValue)"
  - "addCellDeps adds individual code deps (xUDT + Logic OutPoints), not dep group"
  - "Widened DaoManager.isDeposit to accept CellAny — cleaner than type assertion, only inspects fields CellAny provides"

patterns-established:
  - "IckbUdt subclass pattern: extend udt.Udt, override infoFrom for custom balance, override addCellDeps for custom deps"
  - "Manager cellDeps responsibility: managers document caller responsibility via JSDoc @remarks"

requirements-completed: [SMTX-05, SMTX-07, SMTX-10, UDT-04]

# Metrics
duration: 7min
completed: 2026-02-26
---

# Phase 5 Plan 1: IckbUdt Implementation Summary

**IckbUdt extends CCC udt.Udt with multi-representation balance (xUDT + receipts + deposits) and individual code deps; udtHandler removed from LogicManager and OwnedOwnerManager**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-26T16:05:59Z
- **Completed:** 2026-02-26T16:12:50Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Replaced IckbUdtManager with IckbUdt extending CCC's udt.Udt class, providing accurate multi-representation balance via infoFrom override
- Added addCellDeps override with individual code deps (xUDT + Logic OutPoints) instead of dep group
- Renamed calculateScript to typeScriptFrom static method
- Removed udtHandler parameter and cellDeps calls from LogicManager (deposit, completeDeposit) and OwnedOwnerManager (requestWithdrawal, withdraw)
- Added @ckb-ccc/udt dependency to workspace catalog and @ickb/core

## Task Commits

Each task was committed atomically:

1. **Task 1: Add @ckb-ccc/udt dependency and implement IckbUdt class** - `4cd87ea` (feat)
2. **Task 2: Remove udtHandler from LogicManager and OwnedOwnerManager** - `e5dd4c3` (refactor)

## Files Created/Modified
- `packages/core/src/udt.ts` - IckbUdt class extending udt.Udt with infoFrom, addCellDeps, typeScriptFrom; standalone functions preserved
- `packages/core/src/logic.ts` - LogicManager without udtHandler; JSDoc @remarks on deposit/completeDeposit
- `packages/core/src/owned_owner.ts` - OwnedOwnerManager without udtHandler; JSDoc @remarks on requestWithdrawal/withdraw
- `packages/core/package.json` - Added @ckb-ccc/udt dependency
- `pnpm-workspace.yaml` - Added @ckb-ccc/udt catalog entry

## Decisions Made
- Widened DaoManager.isDeposit() to accept CellAny instead of adding a type assertion — cleaner than casting, and isDeposit only inspects cellOutput.type and outputData which CellAny provides
- addCellDeps adds individual code deps (not dep group) per CCC author preference, matching 05-CONTEXT decision

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Widened DaoManager.isDeposit to accept CellAny**
- **Found during:** Task 1 (IckbUdt class implementation)
- **Issue:** daoManager.isDeposit() takes ccc.Cell but infoFrom processes CellAny; TypeScript type mismatch
- **Fix:** Widened DaoManager.isDeposit() parameter from ccc.Cell to ccc.CellAny in packages/dao/src/dao.ts (cleaner than a type assertion)
- **Files modified:** packages/dao/src/dao.ts
- **Verification:** TypeScript compilation passes with no errors across all packages

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Upstream signature widened for type correctness. Runtime behavior unchanged. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- IckbUdt class ready for SDK integration (05-02)
- UdtHandler interface has zero consumers in core after this plan -- ready for deletion in 05-02
- All standalone functions (ickbValue, convert, ickbExchangeRatio) preserved unchanged for downstream consumers

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 05-ickb-core-udt-refactor*
*Completed: 2026-02-26*
