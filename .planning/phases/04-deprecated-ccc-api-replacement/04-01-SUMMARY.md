---
phase: 04-deprecated-ccc-api-replacement
plan: 01
subsystem: api
tags: [ccc, udt, order, refactor, decoupling]

# Dependency graph
requires:
  - phase: 03-ccc-udt-integration-investigation
    provides: Decision to use ccc.Script for UDT type identification in managers
provides:
  - OrderManager with udtScript: ccc.Script parameter (no UdtHandler dependency)
  - UDT cellDeps removed from OrderManager (caller/CCC Udt responsibility)
  - SDK caller site updated to pass ickbUdt.script
affects: [05-remaining-ccc-migration]

# Tech tracking
tech-stack:
  added: []
  patterns: [managers-receive-plain-script, caller-manages-udt-celldeps]

key-files:
  created: []
  modified:
    - packages/order/src/order.ts
    - packages/sdk/src/constants.ts

key-decisions:
  - "OrderManager receives ccc.Script (not udt.Udt) -- simpler than Phase 3 anticipated"
  - "UDT cellDeps are caller responsibility -- documented via JSDoc @remarks on mint/addMatch/melt"

patterns-established:
  - "Manager plain-script pattern: managers receive plain ccc.Script for UDT type identification, udt.Udt instance lives at SDK/caller level"
  - "Caller cellDeps pattern: transaction-building methods do not add UDT cellDeps; callers ensure them via CCC Udt balance completion"

requirements-completed: [SMTX-05]

# Metrics
duration: 4min
completed: 2026-02-26
---

# Phase 4 Plan 01: Replace UdtHandler with udtScript Summary

**OrderManager decoupled from UdtHandler: constructor takes ccc.Script, UDT cellDeps removed, SDK caller updated**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-26T11:11:01Z
- **Completed:** 2026-02-26T11:14:56Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- OrderManager constructor parameter changed from `udtHandler: UdtHandler` to `udtScript: ccc.Script`
- All 4 `this.udtHandler.script` accesses simplified to `this.udtScript`
- All 3 `tx.addCellDeps(this.udtHandler.cellDeps)` lines deleted from mint/addMatch/melt
- `UdtHandler` import removed from @ickb/order
- JSDoc `@remarks` added to mint(), addMatch(), melt() documenting caller cellDeps responsibility
- SDK caller updated to pass `ickbUdt.script` instead of `ickbUdt`
- @ickb/dao verified clean (no UdtHandler, no deprecated CCC APIs)
- Phase 3 decision doc verified correct (no changes needed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace UdtHandler with udtScript in OrderManager and update SDK caller** - `9e6e3d8` (feat)
2. **Task 2: Verify @ickb/dao and Phase 3 decision doc are already clean** - no commit (verification-only, no changes)

## Files Created/Modified
- `packages/order/src/order.ts` - OrderManager: udtScript parameter, removed UDT cellDeps, updated JSDoc
- `packages/sdk/src/constants.ts` - SDK getConfig: passes ickbUdt.script to OrderManager constructor

## Decisions Made
- OrderManager receives `ccc.Script` directly (not `udt.Udt`) -- simpler pattern than Phase 3 anticipated, since OrderManager only needs the type script for cell identification
- UDT cellDeps responsibility moved to caller, documented via JSDoc `@remarks` on affected methods

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 complete (single plan phase)
- Pattern established: managers receive plain `ccc.Script`, `udt.Udt` lives at caller level
- Ready for Phase 5: IckbUdt implementation in @ickb/core, UdtHandler/UdtManager deletion in @ickb/utils

## Self-Check: PASSED

- FOUND: packages/order/src/order.ts
- FOUND: packages/sdk/src/constants.ts
- FOUND: 04-01-SUMMARY.md
- FOUND: commit 9e6e3d8

---
*Phase: 04-deprecated-ccc-api-replacement*
*Completed: 2026-02-26*
