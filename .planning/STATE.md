# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Clean, CCC-aligned library packages published to npm that frontends can depend on to interact with iCKB contracts -- no Lumos, no abandoned abstractions, no duplicated functionality with CCC.
**Current focus:** Phase 4: Deprecated CCC API Replacement

## Current Position

Phase: 3 of 7 (CCC Udt Integration Investigation) -- COMPLETE
Plan: 2 of 2 in current phase (all plans complete)
Status: Phase 3 complete, ready for Phase 4
Last activity: 2026-02-24 -- Plan 03-02 decision document complete (execute-phase)

Progress: [████░░░░░░] 43%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: ~12min
- Total execution time: 1.2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3/3 | 52min | 17min |
| 02 | 1/1 | 7min | 7min |
| 03 | 2/2 | 9min | 4.5min |

**Recent Trend:**
- Last 5 plans: 01-03 (~16min), 02-01 (~7min), 03-01 (~5min), 03-02 (~4min)
- Trend: accelerating

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phase 1 uses feature-slice approach -- each removal chased across all packages, build stays green after every step. SMTX-01 (all signatures to TransactionLike) completed in Phase 1, not Phase 5.
- [Roadmap]: UDT investigation (Phase 3) is a design phase that produces a decision document; its outcome determines UdtHandler/UdtManager replacement pattern used in Phases 4-5
- [Roadmap]: Phases 4-5 reduced in scope: Phase 4 focuses on deprecated API replacement + UDT pattern finalization in dao/order; Phase 5 focuses on IckbUdt implementation + conservation law in core
- [Phase 1 Context]: DAO 64-output limit check contributed to CCC core via ccc-fork/, CCC PR submitted during Phase 1
- [Phase 1 Context]: getHeader()/HeaderKey removed entirely -- inline CCC client calls at read-only call sites; addHeaders() call sites in DaoManager/LogicManager push to tx.headerDeps directly
- [Phase 1 Context]: Script comparison must always use full Script.eq(), never just codeHash comparison
- [01-01]: Added ccc-fork local patch mechanism for deterministic replay of CCC modifications (now multi-file format: manifest + res-N.resolution + local-*.patch)
- [01-01]: DaoManager.requestWithdrawal/withdraw client parameter placed before optional options for cleaner API
- [01-01]: assertDaoOutputLimit uses early return when outputs <= 64 for zero-cost common case
- [01-02]: Moved getHeader/HeaderKey to transaction.ts as non-exported internals (deleted alongside SmartTransaction in 01-03)
- [01-02]: TransactionHeader moved to utils.ts as canonical location for downstream consumers
- [01-02]: Inlined CCC client calls use explicit null checks with descriptive error messages
- [01-03]: All manager methods accept ccc.TransactionLike and return ccc.Transaction (TransactionLike pattern)
- [01-03]: Replaced addUdtHandlers with tx.addCellDeps(this.udtHandler.cellDeps) across all packages
- [01-03]: SmartTransaction class and CapacityManager class fully deleted from @ickb/utils
- [01-03]: SDK getCkb() uses direct client.findCellsOnChain instead of CapacityManager
- [02-01]: Used Math.max() over Number(ccc.numMax()) for number-typed contexts to avoid unnecessary number→bigint→number round-trips
- [02-01]: Used entity.toHex() for Entity args, ccc.hexFrom() for BytesLike args -- matching CCC's type-safe separation
- [03-01]: infoFrom is the sole override point for IckbUdt -- no need to override getInputsInfo/getOutputsInfo
- [03-01]: No upstream CCC changes required for IckbUdt subclass -- all override points are public with appropriate signatures
- [03-01]: Caller responsibility for receipt/deposit cell discovery (not IckbUdt's filter) -- LogicManager/OwnedOwnerManager handle this
- [03-01]: Accurate balance reporting only -- conservation law enforcement is separate from infoFrom
- [03-02]: Decision: subclass CCC Udt (option a) -- IckbUdt extends udt.Udt with infoFrom override
- [03-02]: Conservation law: accurate balance reporting only; on-chain script is authoritative enforcer; build-time validation optional later
- [03-02]: Cell discovery boundary: infoFrom values cells already in transaction; callers (LogicManager/OwnedOwnerManager) find and add receipt/deposit cells
- [03-02]: UdtHandler interface and UdtManager class to be deleted in Phase 5, replaced by udt.Udt type

### Pending Todos

None yet.

### Blockers/Concerns

- Resolved: CCC's `Transaction.getInputsCapacity()` handles DAO profit natively via `getInputsCapacityExtra()` -> `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()` (verified in STACK.md from CCC source). No standalone utility needed.
- Resolved: CCC Udt `getInputsInfo()` resolves inputs to `Cell` objects (which have `outPoint`) before passing to `infoFrom()`. `infoFrom()`'s `CellAnyLike` parameter has `outPoint?: OutPointLike | null` — optional, not absent. Input cells have outPoint (for header fetches), output cells don't. Both `infoFrom` and `getInputsInfo/getOutputsInfo` are viable override points for IckbUdt (verified during Phase 3 discuss-phase).
- Resolved: STACK.md research correction applied — `client.getHeaderByTxHash()` (non-existent) replaced with `client.getTransactionWithHeader()` in STACK.md, ROADMAP.md Phase 3 success criterion #2, and REQUIREMENTS.md UDT-02.
- Resolved: PR #328 stance updated during Phase 3 context — user decision is to design around PR #328 as target architecture (overrides research recommendation to "not wait for #328"). PR #328 is now integrated into `ccc-fork/ccc` via pins; FeePayer classes available at `ccc-fork/ccc/packages/core/src/signer/feePayer/`. The separate `reference/ccc-fee-payer` clone is no longer needed.
- Resolved: `CellAny` has `capacityFree` getter (CCC transaction.ts:404-405) — 03-RESEARCH.md corrected (previously claimed `CellAny` lacked it).

## Session Continuity

Last session: 2026-02-24
Stopped at: Completed 03-02-PLAN.md (Phase 3 complete)
Resume file: Phase 4 planning needed
