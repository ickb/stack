---
phase: 01-ickb-utils-smarttransaction-removal
plan: 02
subsystem: transaction
tags: [getHeader, HeaderKey, addHeaders, CCC-client, header-management, inline-refactor]

# Dependency graph
requires:
  - phase: 01-01
    provides: assertDaoOutputLimit centralized in CCC core; DaoManager/LogicManager async signatures with client parameter
provides:
  - TransactionHeader type in utils.ts (moved from transaction.ts)
  - All consumer packages use direct CCC client calls for header fetching
  - All consumer packages use direct tx.headerDeps push with dedup for header deps
  - getHeader/HeaderKey removed from @ickb/utils public API
affects: [01-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [inline-ccc-client-calls, direct-headerDeps-push-with-dedup]

key-files:
  created: []
  modified:
    - packages/utils/src/utils.ts
    - packages/utils/src/transaction.ts
    - packages/dao/src/cells.ts
    - packages/dao/src/dao.ts
    - packages/core/src/cells.ts
    - packages/core/src/udt.ts
    - packages/core/src/logic.ts
    - packages/sdk/src/sdk.ts

key-decisions:
  - "Moved getHeader/HeaderKey to transaction.ts as non-exported internals (deleted alongside SmartTransaction in 01-03)"
  - "TransactionHeader moved to utils.ts as canonical location, imported by transaction.ts"
  - "Inlined CCC client calls use explicit null checks with descriptive error messages matching original getHeader throw semantics"

patterns-established:
  - "Header fetching: use client.getTransactionWithHeader() or client.getHeaderByNumber() directly with null check + throw"
  - "Header deps: push hash to tx.headerDeps with dedup via .some() check, no SmartTransaction wrapper"

requirements-completed: [SMTX-04]

# Metrics
duration: 6min
completed: 2026-02-22
---

# Phase 01 Plan 02: getHeader/addHeaders Removal Summary

**Removed getHeader()/HeaderKey from @ickb/utils public API, inlined 10 call sites with direct CCC client calls, replaced addHeaders with headerDeps push**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-22T16:23:02Z
- **Completed:** 2026-02-22T16:29:31Z
- **Tasks:** 1
- **Files modified:** 8

## Accomplishments
- Removed getHeader() function and HeaderKey type from @ickb/utils public API
- Inlined 5 standalone getHeader() call sites in dao/cells.ts, core/cells.ts, and sdk/sdk.ts with direct CCC client calls (getTransactionWithHeader/getHeaderByNumber) with null checks
- Inlined 2 tx.getHeader() instance method call sites in core/udt.ts with direct CCC client calls
- Replaced 3 addHeaders() call sites in dao/dao.ts and core/logic.ts with direct tx.headerDeps push with dedup logic
- Moved TransactionHeader interface from transaction.ts to utils.ts as canonical export location

## Task Commits

Each task was committed atomically:

1. **Task 1: Move TransactionHeader type and inline all getHeader/addHeaders call sites** - `85ead3a` (refactor)

## Files Created/Modified
- `packages/utils/src/utils.ts` - Added TransactionHeader interface; removed getHeader function and HeaderKey type
- `packages/utils/src/transaction.ts` - Moved getHeader/HeaderKey to non-exported internals; imports TransactionHeader from utils.ts
- `packages/dao/src/cells.ts` - Inlined 3 getHeader calls with client.getHeaderByNumber and client.getTransactionWithHeader
- `packages/dao/src/dao.ts` - Replaced 2 addHeaders calls with direct tx.headerDeps push with dedup
- `packages/core/src/cells.ts` - Inlined 1 getHeader call with client.getTransactionWithHeader
- `packages/core/src/udt.ts` - Inlined 2 tx.getHeader calls with client.getTransactionWithHeader
- `packages/core/src/logic.ts` - Replaced 1 addHeaders call with direct tx.headerDeps push with dedup
- `packages/sdk/src/sdk.ts` - Inlined 1 getHeader call with client.getTransactionWithHeader

## Decisions Made
- Moved getHeader/HeaderKey into transaction.ts as non-exported internals rather than deleting entirely. SmartTransaction's own instance methods (getHeader, encodeHeaderKey, addHeaders) still reference these internally. Deleting them would break SmartTransaction, which was removed in Plan 01-03. This kept the public API clean while maintaining internal consistency.
- TransactionHeader placed in utils.ts as the canonical location since it outlives SmartTransaction (used by DaoCell.headers and ReceiptCell.header).
- Inlined CCC client calls preserve the original error semantics: getHeader always threw on null results, and the inlined code also throws with descriptive messages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Retained getHeader/HeaderKey as non-exported internals in transaction.ts**
- **Found during:** Task 1 (Step 5 - removing getHeader from utils.ts)
- **Issue:** SmartTransaction class in transaction.ts imports and uses the standalone getHeader function and HeaderKey type internally. Removing them from utils.ts without providing them in transaction.ts would break the class.
- **Fix:** Moved getHeader function and HeaderKey type into transaction.ts as non-exported (internal) declarations. They are no longer part of the @ickb/utils public API but remained available for SmartTransaction's internal use until 01-03 deleted the class.
- **Files modified:** packages/utils/src/transaction.ts
- **Verification:** pnpm check:full passes; HeaderKey/getHeader not found in any consumer packages
- **Committed in:** 85ead3a (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep SmartTransaction functional until 01-03 removed it. No scope creep.

## Issues Encountered
None - plan executed smoothly once the internal SmartTransaction dependency was handled.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All getHeader/HeaderKey usage removed from public API and consumer packages
- TransactionHeader type available in utils.ts for downstream use
- SmartTransaction class ready for deletion in Plan 03 (all external dependencies on its header methods removed)
- Build stays green

## Self-Check: PASSED

- FOUND: all 8 modified files exist
- FOUND: 01-02-SUMMARY.md
- FOUND: commit 85ead3a (Task 1)

---
*Phase: 01-ickb-utils-smarttransaction-removal*
*Completed: 2026-02-22*
