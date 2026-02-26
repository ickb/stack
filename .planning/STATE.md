---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-02-26T16:31:09.127Z"
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 9
  completed_plans: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Clean, CCC-aligned library packages published to npm that frontends can depend on to interact with iCKB contracts -- no Lumos, no abandoned abstractions, no duplicated functionality with CCC.
**Current focus:** Phase 5: @ickb/core UDT Refactor

## Current Position

Phase: 5 of 7 (@ickb/core UDT Refactor) -- Complete
Plan: 2 of 2 in current phase (all complete)
Status: Phase 5 complete -- all UDT infrastructure deleted, SDK rewired
Last activity: 2026-02-26 -- Completed 05-02-PLAN.md (delete UDT infra + wire SDK)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 9
- Average duration: ~10min
- Total execution time: 1.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3/3 | 52min | 17min |
| 02 | 1/1 | 7min | 7min |
| 03 | 2/2 | 9min | 4.5min |
| 04 | 1/1 | 4min | 4min |
| 05 | 2/2 | 11min | 5.5min |

**Recent Trend:**
- Last 5 plans: 03-02 (~4min), 04-01 (~4min), 05-01 (~7min), 05-02 (~4min)
- Trend: stable at ~5min per plan

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phase 1 uses feature-slice approach -- each removal chased across all packages, build stays green after every step. SMTX-01 (all signatures to TransactionLike) completed in Phase 1, not Phase 5.
- [Roadmap]: UDT investigation (Phase 3) is a design phase that produces a decision document; its outcome determines UdtHandler/UdtManager replacement pattern used in Phases 4-5
- [Roadmap]: Phases 4-5 reduced in scope: Phase 4 focuses on deprecated API replacement + UDT pattern finalization in dao/order; Phase 5 focuses on IckbUdt implementation + conservation law in core
- [Phase 1 Context]: DAO 64-output limit check contributed to CCC core via forks/ccc/, CCC PR submitted during Phase 1
- [Phase 1 Context]: getHeader()/HeaderKey removed entirely -- inline CCC client calls at read-only call sites; addHeaders() call sites in DaoManager/LogicManager push to tx.headerDeps directly
- [Phase 1 Context]: Script comparison must always use full Script.eq(), never just codeHash comparison
- [01-01]: Added forks/ccc local patch mechanism for deterministic replay of CCC modifications (now multi-file format: manifest + res-N.resolution + local-*.patch)
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
- [04-context]: DaoManager never had UdtHandler parameter -- @ickb/dao has no UDT-related code, no changes needed in Phase 4
- [04-context]: OrderManager gets udtScript: ccc.Script (not udt.Udt) -- simpler pattern than Phase 3 anticipated
- [04-context]: UDT cellDeps removed from OrderManager -- caller/CCC Udt manages externally during balance completion
- [04-context]: No deprecated CCC API calls in dao or order packages -- those calls (ccc.udtBalanceFrom) are in utils (UdtManager) and core (IckbUdtManager), handled in Phase 5
- [04-context]: Pattern established: managers receive plain ccc.Script for UDT type identification; udt.Udt instance lives at SDK/caller level
- [04-context]: Phase 3 decision doc corrected (DaoManager row removed, OrderManager updated, Phase 4 guidance rewritten)
- [04-01]: OrderManager receives ccc.Script (not udt.Udt) -- simpler than Phase 3 anticipated
- [04-01]: UDT cellDeps are caller responsibility -- documented via JSDoc @remarks on mint/addMatch/melt
- [05-context]: IckbUdt uses individual code deps (xUDT + Logic OutPoints), not dep group -- CCC author dislikes dep groups for breaking semantics
- [05-context]: Override addCellDeps on IckbUdt to add both code deps; other managers keep dep groups for now (mixed coexistence OK)
- [05-context]: Drop compressState feature -- CCC completeInputsByBalance handles completion; no wrapper needed
- [05-context]: Accept CCC's ErrorUdtInsufficientCoin; delete ErrorTransactionInsufficientCoin from utils; callers format messages
- [05-context]: Delete findUdts/addUdts/UdtCell/isUdtSymbol -- all internal to UdtManager, no external consumers
- [05-context]: LogicManager/OwnedOwnerManager: remove udtHandler param + cellDeps calls (Phase 4 pattern); UdtHandler interface has zero consumers → delete
- [05-context]: calculateScript renamed to IckbUdt.typeScriptFrom (static, same params)
- [05-context]: ValueComponents kept as-is for Phase 5; redesign deferred (ambiguous naming in multi-UDT context)
- [05-context]: Phase 5 handles SDK error handling updates (not deferred to Phase 6)
- [05-context]: CCC isUdt length check (>=16 bytes) equivalent to old >=34 hex chars -- no iCKB-specific reason for old threshold
- [05-context]: Matching bot infoFrom caching concern noted for researcher -- CCC Client.cache handles header dedup
- [05-01]: IckbUdt.infoFrom handles three cell types: xUDT (positive), receipt (positive via ickbValue), deposit (negative via ickbValue)
- [05-01]: addCellDeps adds individual code deps (xUDT + Logic OutPoints), not dep group
- [05-01]: CellAny cast to Cell for daoManager.isDeposit is safe: input cells are Cell instances, output cells gated by !cell.outPoint check
- [05-02]: IckbUdt.typeScriptFrom computes type script dynamically from raw UDT and Logic scripts (not hardcoded)
- [05-02]: Devnet code OutPoints fallback to cellDeps[0].outPoint -- pragmatic since devnet deps are typically depType: code
- [05-02]: ErrorTransactionInsufficientCoin had zero catch blocks across entire codebase -- clean deletion with no migration

### Pending Todos

None yet.

### Blockers/Concerns

- Resolved: CCC's `Transaction.getInputsCapacity()` handles DAO profit natively via `getInputsCapacityExtra()` -> `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()` (verified in STACK.md from CCC source). No standalone utility needed.
- Resolved: CCC Udt `getInputsInfo()` resolves inputs to `Cell` objects (which have `outPoint`) before passing to `infoFrom()`. `infoFrom()`'s `CellAnyLike` parameter has `outPoint?: OutPointLike | null` — optional, not absent. Input cells have outPoint (for header fetches), output cells don't. Both `infoFrom` and `getInputsInfo/getOutputsInfo` are viable override points for IckbUdt (verified during Phase 3 discuss-phase).
- Resolved: STACK.md research correction applied — `client.getHeaderByTxHash()` (non-existent) replaced with `client.getTransactionWithHeader()` in STACK.md, ROADMAP.md Phase 3 success criterion #2, and REQUIREMENTS.md UDT-02.
- Resolved: PR #328 stance updated during Phase 3 context — user decision is to design around PR #328 as target architecture (overrides research recommendation to "not wait for #328"). PR #328 is now integrated into `forks/ccc/` via pins; FeePayer classes available at `forks/ccc/packages/core/src/signer/feePayer/`. The separate ccc-fee-payer reference clone is no longer needed.
- Resolved: `CellAny` has `capacityFree` getter (CCC transaction.ts:404-405) — 03-RESEARCH.md corrected (previously claimed `CellAny` lacked it).

## Session Continuity

Last session: 2026-02-26
Stopped at: Completed 05-02-PLAN.md -- Phase 5 complete
Resume file: N/A (all phases complete)
Next action: PR preparation or Phase 6 planning
