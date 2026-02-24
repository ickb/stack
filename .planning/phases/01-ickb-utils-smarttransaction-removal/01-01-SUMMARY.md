---
phase: 01-ickb-utils-smarttransaction-removal
plan: 01
subsystem: transaction
tags: [nervos-dao, error-handling, ccc-core, assertDaoOutputLimit, async-refactor]

# Dependency graph
requires: []
provides:
  - ErrorNervosDaoOutputLimit error class in CCC core
  - assertDaoOutputLimit centralized utility function in CCC core
  - completeFee safety net for DAO output limit in CCC core
  - ccc-dev local patch mechanism for deterministic builds
affects: [01-02, 01-03, 01-04]

# Tech tracking
tech-stack:
  added: []
  patterns: [centralized-dao-limit-check, ccc-dev-local-patches]

key-files:
  created:
    - ccc-dev/pins/local/001-dao-output-limit.patch
  modified:
    - ccc-dev/ccc/packages/core/src/ckb/transactionErrors.ts
    - ccc-dev/ccc/packages/core/src/ckb/transaction.ts
    - ccc-dev/record.sh
    - ccc-dev/replay.sh
    - packages/dao/src/dao.ts
    - packages/core/src/logic.ts
    - packages/core/src/owned_owner.ts
    - packages/utils/src/transaction.ts

key-decisions:
  - "Added ccc-dev local patch mechanism (pins/local/*.patch) to support deterministic replay of CCC source modifications"
  - "Moved client parameter before optional options in DaoManager.requestWithdrawal and DaoManager.withdraw signatures"
  - "assertDaoOutputLimit uses early return when outputs <= 64 for zero-cost in common case"

patterns-established:
  - "Local CCC patches: place .patch files in ccc-dev/pins/local/ for changes applied after standard merge+patch cycle"
  - "DAO output limit: always use ccc.assertDaoOutputLimit(tx, client) instead of inline checks"

requirements-completed: [SMTX-06]

# Metrics
duration: 30min
completed: 2026-02-22
---

# Phase 01 Plan 01: DAO Output Limit Check Summary

**Centralized NervosDAO 64-output limit into CCC core assertDaoOutputLimit utility, replacing all 7 scattered inline checks across dao/core/utils packages**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-02-22T16:00:00Z
- **Completed:** 2026-02-22T16:30:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Built ErrorNervosDaoOutputLimit error class with count/limit metadata in CCC core
- Built assertDaoOutputLimit utility function that checks both inputs and outputs for DAO type script using full Script.eq() comparison
- Added completeFee safety net in CCC Transaction class (both return paths)
- Replaced all 7 inline DAO output checks across 4 files with centralized utility calls
- Added local patch mechanism to ccc-dev record/replay for deterministic builds of CCC modifications

## Task Commits

Each task was committed atomically:

1. **Task 1: Build ErrorNervosDaoOutputLimit and assertDaoOutputLimit in CCC core** - `7081869` (feat)
2. **Task 2: Replace all 7 scattered DAO checks with assertDaoOutputLimit calls** - `2decd06` (refactor)

## Files Created/Modified
- `ccc-dev/ccc/packages/core/src/ckb/transactionErrors.ts` - ErrorNervosDaoOutputLimit error class
- `ccc-dev/ccc/packages/core/src/ckb/transaction.ts` - assertDaoOutputLimit utility + completeFee safety net
- `ccc-dev/pins/` - Updated pins for deterministic replay
- `ccc-dev/record.sh` - Added local patch preservation and application
- `ccc-dev/replay.sh` - Added local patch application after standard merge+patch
- `packages/dao/src/dao.ts` - DaoManager.deposit/requestWithdrawal/withdraw now async with client param
- `packages/core/src/logic.ts` - LogicManager.deposit now async with client param
- `packages/core/src/owned_owner.ts` - OwnedOwnerManager.requestWithdrawal/withdraw now async with client param
- `packages/utils/src/transaction.ts` - SmartTransaction.completeFee DAO check replaced

## Decisions Made
- Added ccc-dev local patch mechanism (pins/local/*.patch) because the existing record/replay infrastructure had no way to persist source-level CCC modifications through the clean/replay cycle. This was a necessary blocking-issue fix (Rule 3).
- Placed `client: ccc.Client` parameter before optional `options` parameters in DaoManager signatures for cleaner API design (required params before optional).
- assertDaoOutputLimit uses early return when `outputs.length <= 64` so the common-case path has zero async overhead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ccc-dev local patch mechanism**
- **Found during:** Task 1 (CCC core changes)
- **Issue:** ccc-dev record/replay infrastructure had no way to persist local CCC source modifications. Running `pnpm ccc:record` or `pnpm check:full` would wipe changes because replay clones fresh from upstream.
- **Fix:** Added `pins/local/` directory for `.patch` files. Modified `record.sh` to preserve local patches during re-recording and apply them after standard merge+patch. Modified `replay.sh` to apply local patches after standard replay. Both use deterministic git identity/timestamps for reproducible HEAD SHAs.
- **Files modified:** `ccc-dev/record.sh`, `ccc-dev/replay.sh`, `ccc-dev/pins/local/001-dao-output-limit.patch`
- **Verification:** `pnpm check:full` passes (clean wipe + replay + build cycle)
- **Committed in:** 7081869 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential infrastructure addition to make CCC modifications work through the deterministic build cycle. No scope creep.

## Issues Encountered
- Plan incorrectly stated that `requestWithdrawal` and `withdraw` in DaoManager already had `client` as a parameter. They did not. Added `client` parameter to both methods and updated all callers.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- assertDaoOutputLimit is available in CCC core for all packages
- DAO output limit check is centralized, ready for SmartTransaction removal in subsequent plans
- Local patch mechanism established for further CCC modifications if needed

## Self-Check: PASSED

- FOUND: ccc-dev/pins/local/001-dao-output-limit.patch
- FOUND: 01-01-SUMMARY.md
- FOUND: commit 7081869 (Task 1)
- FOUND: commit 2decd06 (Task 2)

---
*Phase: 01-ickb-utils-smarttransaction-removal*
*Completed: 2026-02-22*
