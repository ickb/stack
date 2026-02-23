---
phase: 02-ccc-utility-adoption
plan: 01
subsystem: utils
tags: [ccc, numMax, numMin, gcd, hexFrom, isHex, toHex, deduplication]

# Dependency graph
requires:
  - phase: 01-ickb-utils-smarttransaction-removal
    provides: Clean @ickb/utils with SmartTransaction/CapacityManager already removed
provides:
  - "@ickb/utils exports reduced: max/min/gcd/hexFrom/isHex deleted"
  - "All call sites use CCC equivalents or native JS: Math.max (number contexts), ccc.gcd, entity.toHex(), ccc.hexFrom()"
  - "unique() uses entity.toHex() internally instead of local hexFrom()"
affects: [03-udt-investigation, 04-deprecated-api-replacement]

# Tech tracking
tech-stack:
  added: []
  patterns: [entity.toHex() for Entity-to-Hex, Math.max()/Math.min() for number-typed max/min contexts]

key-files:
  created:
    - ".changeset/remove-local-utility-functions.md"
  modified:
    - "packages/utils/src/utils.ts"
    - "packages/order/src/entities.ts"
    - "packages/order/src/order.ts"
    - "packages/sdk/src/codec.ts"
    - "packages/sdk/src/sdk.ts"
    - "apps/faucet/src/main.ts"

key-decisions:
  - "Used Math.max()/Math.min() for number-typed contexts to avoid unnecessary number→bigint→number round-trips via ccc.numMax()"
  - "Used entity.toHex() for Entity args, ccc.hexFrom() for BytesLike args -- matching CCC's type-safe separation"

patterns-established:
  - "Entity-to-Hex: use entity.toHex() method, never ccc.hexFrom(entity)"
  - "Number context max/min: use Math.max()/Math.min() directly, avoid ccc.numMax() number→bigint→number round-trips"

requirements-completed: [DEDUP-01, DEDUP-02, DEDUP-03, DEDUP-04, DEDUP-05]

# Metrics
duration: 7min
completed: 2026-02-23
---

# Phase 2 Plan 01: CCC Utility Adoption Summary

**Replaced 5 local utility functions (max, min, gcd, hexFrom, isHex) with CCC equivalents at 8 external call sites, updated unique() internals, deleted all local implementations**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-23T18:00:48Z
- **Completed:** 2026-02-23T18:07:52Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Replaced all 8 external call sites across 5 files with CCC equivalents or native JS (Math.max, ccc.gcd, entity.toHex(), ccc.hexFrom())
- Deleted 5 local function definitions (~135 lines) from @ickb/utils
- Updated unique() internal implementation from hexFrom(i) to i.toHex()
- Preserved all 8 iCKB-unique utilities (binarySearch, asyncBinarySearch, shuffle, collect, BufferedGenerator, MinHeap, sum, unique)
- Generated changeset documenting the breaking API removal
- pnpm check:full passes with zero errors (lint + build + test, twice -- fresh and CI)

## Task Commits

Each task had an initial refactor commit, then a follow-up fix:

1. **Task 1: Replace all external call sites with CCC equivalents** — refactor, then fix (Math.max over ccc.numMax + planning docs + changeset bump downgrade)
2. **Task 2: Update unique() internals, delete local functions, generate changeset, and verify** — refactor, then docs (unique() JSDoc)

## Files Created/Modified
- `packages/utils/src/utils.ts` - Deleted max/min/gcd/hexFrom/isHex, updated unique() to use i.toHex()
- `packages/order/src/entities.ts` - Replaced gcd() with ccc.gcd(), max() with Math.max()
- `packages/order/src/order.ts` - Replaced hexFrom(outPoint/master) with .toHex()
- `packages/sdk/src/codec.ts` - Replaced max() with Math.max()
- `packages/sdk/src/sdk.ts` - Replaced hexFrom(lock) with lock.toHex()
- `apps/faucet/src/main.ts` - Replaced hexFrom(bytes) with ccc.hexFrom(bytes)
- `.changeset/remove-local-utility-functions.md` - Changeset for breaking API change

## Decisions Made
- Used `Math.max()` instead of `Number(ccc.numMax(...))` for the two number-typed max() call sites, avoiding unnecessary number→bigint→number round-trips (ccc.numMax() is for bigint contexts)
- Used `entity.toHex()` for all Entity-typed hexFrom() call sites and `ccc.hexFrom()` for the single BytesLike call site, following CCC's type-safe separation pattern

## Deviations from Plan

- Plan step 3 changeset summary prescribed `ccc.numMax`/`ccc.numMin` as replacements for `max()`/`min()`, but all call sites were number-typed. Used `Math.max()` instead to avoid unnecessary `number→bigint→number` round-trips — corrected in the fix commit.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- @ickb/utils is now free of duplicated CCC functionality
- All packages compile cleanly with CCC utility calls
- Ready for Phase 3 (UDT Investigation) which will analyze CCC's Udt class for handler/manager replacement patterns

---
*Phase: 02-ccc-utility-adoption*
*Completed: 2026-02-23*
