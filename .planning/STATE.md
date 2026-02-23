# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Clean, CCC-aligned library packages published to npm that frontends can depend on to interact with iCKB contracts -- no Lumos, no abandoned abstractions, no duplicated functionality with CCC.
**Current focus:** Phase 2: CCC Utility Adoption

## Current Position

Phase: 2 of 7 (CCC Utility Adoption)
Plan: 1 of 1 in current phase (phase complete)
Status: Phase 02 complete, ready for phase 03
Last activity: 2026-02-23 -- Plan 02-01 executed (local utility functions replaced with CCC equivalents)

Progress: [███░░░░░░░] 25%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: ~15min
- Total execution time: 1.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3/3 | 52min | 17min |
| 02 | 1/1 | 7min | 7min |

**Recent Trend:**
- Last 5 plans: 01-01 (~30min), 01-02 (~6min), 01-03 (~16min), 02-01 (~7min)
- Trend: accelerating

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phase 1 uses feature-slice approach -- each removal chased across all packages, build stays green after every step. SMTX-01 (all signatures to TransactionLike) completed in Phase 1, not Phase 5.
- [Roadmap]: UDT investigation (Phase 3) is a design phase that produces a decision document; its outcome determines UdtHandler/UdtManager replacement pattern used in Phases 4-5
- [Roadmap]: Phases 4-5 reduced in scope: Phase 4 focuses on deprecated API replacement + UDT pattern finalization in dao/order; Phase 5 focuses on IckbUdt implementation + conservation law in core
- [Phase 1 Context]: DAO 64-output limit check contributed to CCC core via ccc-dev/, CCC PR submitted during Phase 1
- [Phase 1 Context]: getHeader()/HeaderKey removed entirely -- inline CCC client calls at read-only call sites; addHeaders() call sites in DaoManager/LogicManager push to tx.headerDeps directly
- [Phase 1 Context]: Script comparison must always use full Script.eq(), never just codeHash comparison
- [01-01]: Added ccc-dev local patch mechanism (pins/local/*.patch) for deterministic replay of CCC modifications
- [01-01]: DaoManager.requestWithdrawal/withdraw client parameter placed before optional options for cleaner API
- [01-01]: assertDaoOutputLimit uses early return when outputs <= 64 for zero-cost common case
- [01-02]: Moved getHeader/HeaderKey to transaction.ts as non-exported internals (SmartTransaction still uses internally until Plan 03 deletion)
- [01-02]: TransactionHeader moved to utils.ts as canonical location for downstream consumers
- [01-02]: Inlined CCC client calls use explicit null checks with descriptive error messages
- [01-03]: All manager methods accept ccc.TransactionLike and return ccc.Transaction (TransactionLike pattern)
- [01-03]: Replaced addUdtHandlers with tx.addCellDeps(this.udtHandler.cellDeps) across all packages
- [01-03]: SmartTransaction class and CapacityManager class fully deleted from @ickb/utils
- [01-03]: SDK getCkb() uses direct client.findCellsOnChain instead of CapacityManager
- [02-01]: Used Number(ccc.numMax()) over Math.max() to maintain CCC utility adoption consistency
- [02-01]: Used entity.toHex() for Entity args, ccc.hexFrom() for BytesLike args -- matching CCC's type-safe separation

### Pending Todos

None yet.

### Blockers/Concerns

- Resolved: CCC's `Transaction.getInputsCapacity()` handles DAO profit natively via `getInputsCapacityExtra()` -> `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()` (verified in STACK.md from CCC source). No standalone utility needed.
- Research gap: CCC Udt `getInputsInfo()` signature needs verification for header fetching context -- must confirm during Phase 3 investigation.

## Session Continuity

Last session: 2026-02-23
Stopped at: Completed 02-01-PLAN.md (Phase 02 complete)
Resume file: .planning/phases/02-ccc-utility-adoption/02-01-SUMMARY.md
