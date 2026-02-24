---
phase: 03-ccc-udt-integration-investigation
plan: 02
subsystem: udt
tags: [ccc, udt, subclass, infoFrom, decision-document, header-access, conservation-law]

# Dependency graph
requires:
  - phase: 03-ccc-udt-integration-investigation
    plan: 01
    provides: "Source code trace evidence for infoFrom override feasibility, resolved open questions"
  - phase: 01-lumos-removal
    provides: "IckbUdtManager with TransactionLike pattern, DaoManager with isDeposit()"
  - phase: 02-ccc-deprecation-removal
    provides: "Clean codebase without deprecated CCC APIs"
provides:
  - "Formal decision: IckbUdt extends udt.Udt with infoFrom override"
  - "Complete implementation guidance for Phases 4 and 5"
  - "Conservation law strategy (accurate balance reporting, caller responsibility)"
  - "Cell discovery vs balance calculation boundary definition"
  - "Deprecated API replacement table for dao/order/core packages"
affects: [04-deprecated-api-replacement, 05-ickb-udt-implementation, 06-sdk-completion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "infoFrom override: per-cell balance calculation with outPoint-based input/output discrimination"
    - "Three cell types: xUDT (positive), receipt (positive, input only), deposit (negative, input only)"
    - "Caller-responsibility pattern for receipt/deposit cell discovery"

key-files:
  created:
    - ".planning/phases/03-ccc-udt-integration-investigation/03-DECISION.md"
  modified: []

key-decisions:
  - "Subclass CCC Udt: IckbUdt extends udt.Udt with infoFrom override (option a)"
  - "No upstream CCC changes required for IckbUdt subclass"
  - "Conservation law: accurate balance reporting only, enforcement is on-chain and optionally build-time later"
  - "Cell discovery boundary: infoFrom values cells, callers find and add them"
  - "UdtHandler interface and UdtManager class to be deleted in Phase 5"

patterns-established:
  - "Deprecated API replacement: udtBalanceFrom -> balanceFromUnsafe, getInputsUdtBalance -> getInputsInfo, etc."
  - "DaoManager/OrderManager receive udt.Udt instance instead of UdtHandler"

requirements-completed: [UDT-01, UDT-02, UDT-03]

# Metrics
duration: 4min
completed: 2026-02-24
---

# Phase 3 Plan 2: CCC Udt Decision Document Summary

**Formal decision document choosing IckbUdt extends udt.Udt with infoFrom override -- feasibility confirmed, header access pattern designed, implementation guidance for Phases 4-5 with deprecated API replacement table and conservation law strategy**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-24T11:27:42Z
- **Completed:** 2026-02-24T11:31:27Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Wrote complete decision document with all 8 required sections (Feasibility Assessment, Header Access Pattern, Decision, Conservation Law Strategy, Cell Discovery Boundary, Implementation Guidance, Upstream Changes, Risks)
- Decision: (a) subclass CCC Udt -- IckbUdt extends udt.Udt with infoFrom override, no upstream CCC changes needed
- Conservation law strategy: accurate balance reporting with correct sign conventions (deposits negative), enforcement on-chain only, optional build-time validation later
- Phase 4 guidance: deprecated API replacement table mapping old APIs to new Udt instance methods
- Phase 5 guidance: IckbUdt creation in core package, UdtHandler/UdtManager deletion from utils package, SDK update to use IckbUdt instance
- Six risks documented with concrete mitigations (filter mismatch, isDeposit type, header performance, negative balance, output misidentification, return type changes)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write feasibility assessment and header access pattern (UDT-01, UDT-02)** - `681248e` (docs)
2. **Task 2: Write decision and implementation guidance (UDT-03)** - `8daffd7` (docs)

## Files Created/Modified
- `.planning/phases/03-ccc-udt-integration-investigation/03-DECISION.md` - Formal decision document: feasibility YES, header access via getTransactionWithHeader, decision to subclass with infoFrom override, conservation law strategy, cell discovery boundary, implementation guidance for Phases 4-5, upstream assessment, risks and mitigations

## Decisions Made
- **Subclass CCC Udt (option a):** IckbUdt extends udt.Udt with single infoFrom override handling three cell types (xUDT, receipt, deposit) with outPoint-based input/output discrimination
- **No upstream CCC changes required:** All override points are public with appropriate signatures
- **Conservation law: accurate reporting only:** infoFrom computes balance, does not validate conservation law. On-chain script is authoritative enforcer. Build-time validation can be added later as separate method
- **Cell discovery boundary:** infoFrom values cells already in transaction; LogicManager/OwnedOwnerManager find and add receipt/deposit cells; completeInputsByBalance only finds xUDT cells via filter
- **UdtHandler/UdtManager deletion:** Replaced by udt.Udt type and base class in Phase 5

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 investigation is complete -- decision document provides all information needed for Phases 4-5
- Phase 4 can proceed: deprecated API replacement table specifies exact old->new API mappings for dao and order packages
- Phase 5 can proceed: IckbUdt class specification (constructor, override, deletions, preservations) is fully documented
- No re-investigation needed -- document is self-contained for downstream phase planners

## Self-Check: PASSED

- FOUND: `.planning/phases/03-ccc-udt-integration-investigation/03-DECISION.md`
- FOUND: `.planning/phases/03-ccc-udt-integration-investigation/03-02-SUMMARY.md`
- FOUND: commit `681248e`
- FOUND: commit `8daffd7`

---
*Phase: 03-ccc-udt-integration-investigation*
*Completed: 2026-02-24*
