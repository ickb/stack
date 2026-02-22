# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Clean, CCC-aligned library packages published to npm that frontends can depend on to interact with iCKB contracts -- no Lumos, no abandoned abstractions, no duplicated functionality with CCC.
**Current focus:** Phase 1: SmartTransaction Removal (feature-slice)

## Current Position

Phase: 1 of 7 (SmartTransaction Removal — feature-slice)
Plan: 0 of 3 in current phase
Status: Context gathered, ready to plan
Last activity: 2026-02-22 -- Phase 1 context gathered

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phase 1 uses feature-slice approach — each removal chased across all packages, build stays green after every step. SMTX-01 (all signatures to TransactionLike) completed in Phase 1, not Phase 5.
- [Roadmap]: UDT investigation (Phase 3) is a design phase that produces a decision document; its outcome determines UdtHandler/UdtManager replacement pattern used in Phases 4-5
- [Roadmap]: Phases 4-5 reduced in scope: Phase 4 focuses on deprecated API replacement + UDT pattern finalization in dao/order; Phase 5 focuses on IckbUdt implementation + conservation law in core
- [Phase 1 Context]: DAO 64-output limit check contributed to CCC core via ccc-dev/, CCC PR submitted during Phase 1
- [Phase 1 Context]: getHeader()/HeaderKey removed entirely — inline CCC client calls at read-only call sites; addHeaders() call sites in DaoManager/LogicManager push to tx.headerDeps directly
- [Phase 1 Context]: Script comparison must always use full Script.eq(), never just codeHash comparison

### Pending Todos

None yet.

### Blockers/Concerns

- Resolved: CCC's `Transaction.getInputsCapacity()` handles DAO profit natively via `getInputsCapacityExtra()` -> `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()` (verified in STACK.md from CCC source). No standalone utility needed.
- Research gap: CCC Udt `getInputsInfo()` signature needs verification for header fetching context -- must confirm during Phase 3 investigation.

## Session Continuity

Last session: 2026-02-22
Stopped at: Phase 1 context gathered
Resume file: .planning/phases/01-ickb-utils-smarttransaction-removal/01-CONTEXT.md
