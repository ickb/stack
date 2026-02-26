---
phase: 05-ickb-core-udt-refactor
plan: 02
subsystem: core
tags: [udt, ccc, xudt, ickb, sdk, deletion, code-deps]

# Dependency graph
requires:
  - phase: 05-ickb-core-udt-refactor
    plan: 01
    provides: IckbUdt class extending udt.Udt, LogicManager/OwnedOwnerManager without udtHandler
provides:
  - Deleted UDT infrastructure from @ickb/utils (~406 lines)
  - SDK getConfig() constructing IckbUdt with individual code OutPoints
  - Code cell OutPoint constants for mainnet and testnet (xUDT + Logic)
affects: [sdk, bot, apps]

# Tech tracking
tech-stack:
  added: []
  patterns: [IckbUdt constructed with individual code OutPoints, network capture for code OutPoint selection]

key-files:
  created: []
  modified:
    - packages/utils/src/index.ts
    - packages/sdk/src/constants.ts
  deleted:
    - packages/utils/src/udt.ts

key-decisions:
  - "IckbUdt.typeScriptFrom computes type script dynamically from raw UDT and Logic scripts (not hardcoded)"
  - "Devnet code OutPoints fallback to cellDeps[0].outPoint -- pragmatic since devnet deps are typically depType: code"
  - "ErrorTransactionInsufficientCoin had zero catch blocks across entire codebase -- clean deletion with no migration"

patterns-established:
  - "SDK network capture pattern: extract network string before d gets reassigned, use for conditional constants"
  - "Code OutPoint constants: hardcoded per-network OutPoints for individual code deps, sourced from deployment.toml"

requirements-completed: [SMTX-05, SMTX-07, SMTX-10, UDT-04]

# Metrics
duration: 4min
completed: 2026-02-26
---

# Phase 5 Plan 2: Delete UDT Infrastructure and Wire SDK Summary

**Deleted UdtHandler/UdtManager/ErrorTransactionInsufficientCoin from @ickb/utils (~406 lines) and rewired SDK to construct IckbUdt with individual xUDT and Logic code OutPoints**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-26T16:16:16Z
- **Completed:** 2026-02-26T16:20:08Z
- **Tasks:** 2
- **Files modified:** 2 modified, 1 deleted

## Accomplishments
- Deleted packages/utils/src/udt.ts removing UdtHandler, UdtManager, ErrorTransactionInsufficientCoin, UdtCell, findUdts, addUdts, isUdtSymbol (~406 lines)
- Updated SDK getConfig() to construct IckbUdt with individual code OutPoints (mainnet/testnet) and IckbUdt.typeScriptFrom for script computation
- Removed ickbUdt argument from LogicManager and OwnedOwnerManager construction in SDK
- Added 4 code cell OutPoint constants (mainnet xUDT, mainnet Logic, testnet xUDT, testnet Logic) sourced from deployment.toml
- Confirmed zero ErrorTransactionInsufficientCoin catch blocks across entire codebase -- clean deletion

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete utils/src/udt.ts and update barrel export** - `c5d4363` (refactor)
2. **Task 2: Update SDK getConfig to construct IckbUdt with code OutPoints and verify full stack** - `6400cc4` (feat)

## Files Created/Modified
- `packages/utils/src/udt.ts` - DELETED: removed ~406 lines of UdtHandler, UdtManager, ErrorTransactionInsufficientCoin, UdtCell, findUdts, addUdts, isUdtSymbol
- `packages/utils/src/index.ts` - Removed "export * from ./udt.js" barrel export
- `packages/sdk/src/constants.ts` - IckbUdt import, code OutPoint constants, IckbUdt construction with typeScriptFrom, LogicManager/OwnedOwnerManager 3-param construction

## Decisions Made
- Used IckbUdt.typeScriptFrom to compute type script dynamically from raw UDT and Logic scripts, rather than passing d.udt.script directly (which would bypass the correct args computation)
- Devnet fallback uses cellDeps[0].outPoint for code OutPoints -- pragmatic since devnet deps are typically depType: code
- Network string captured before d gets reassigned via `const network = typeof d === "string" ? d : undefined` for clean conditional logic

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 5 complete: IckbUdt replaces all UDT infrastructure, full stack compiles
- All deprecated CCC API calls (udtBalanceFrom, getInputsUdtBalance, etc.) eliminated
- ScriptDeps, ExchangeRatio, ValueComponents preserved for downstream consumers
- Ready for Phase 6 (SDK refactor) or PR preparation

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 05-ickb-core-udt-refactor*
*Completed: 2026-02-26*
