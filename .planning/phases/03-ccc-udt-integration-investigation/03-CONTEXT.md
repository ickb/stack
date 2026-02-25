# Phase 3: CCC Udt Integration Investigation - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Assess feasibility of subclassing CCC's `udt.Udt` class for iCKB's multi-representation value (xUDT + receipts + deposits). Design the header access pattern. Document the decision. This feeds directly into Phases 4 and 5 — the decision determines how UdtHandler/UdtManager (which remain in `@ickb/utils` with updated signatures after Phase 1) get replaced.

</domain>

<decisions>
## Implementation Decisions

### Evaluation priorities
- CCC alignment is the primary driver — iCKB should feel native to CCC users and benefit from upstream improvements
- Upstream CCC PRs are explicitly on the table if CCC's Udt class needs small, targeted changes to accommodate iCKB's multi-representation value
- No concern about CCC upgrade risk — if we contribute to CCC's Udt, we co-own the design
- PR #328 (FeePayer abstraction by ashuralyk) is the target architecture — investigation should design around it and identify improvements that would better fit iCKB's needs. Now integrated into `forks/ccc` (available at `forks/ccc/packages/core/src/signer/feePayer/`)
- Investigation should cover both cell discovery and balance calculation, not just balance
- Design upstream: if CCC Udt changes are needed, design them generically as a "composite UDT" pattern that benefits other CKB tokens beyond iCKB

### Subclassing approach
- Leaning toward `IckbUdt extends udt.Udt` — iCKB is fundamentally a UDT, just with extra cell types carrying value
- Two viable override points identified: `getInputsInfo/getOutputsInfo` and `infoFrom`
- `infoFrom` can distinguish between input and output cells by checking outpoint presence (inputs have outpoints, outputs don't)
- Dealbreaker for subclass: if upstream CCC changes needed are too invasive (large, likely-to-be-rejected PRs)
- If subclassing doesn't work, reevaluate WHY it fails and determine what CCC Udt changes would fix it — don't fall back to custom without first trying the upstream path

### Transaction completion integration
- Standard xUDT token completion must integrate seamlessly (already supported by CCC)
- Accounting for iCKB-specific cells (receipts, deposits) that carry UDT value must also integrate seamlessly into CCC's completion pipeline
- Auto-fetching and auto-adding of receipt/withdrawal-request cells: to be determined — investigate how this fits within PR #328's FeePayer framework (`completeInputs()` with accumulator pattern)

### Conservation law enforcement
- On-chain iCKB Logic script already enforces `Input UDT + Input Receipts = Output UDT + Input Deposits` at validation time
- Investigation should explore both: (a) IckbUdt subclass enforcing at tx-building time (prevents invalid tx construction), and (b) caller responsibility (IckbUdt only reports accurate balances)
- No risk of funds loss either way — just risk of building invalid transactions that fail on-chain

### Header access pattern
- Settled: `client.getTransactionWithHeader(outPoint.txHash)` for per-cell header fetching
- CCC is async-native — no concern about async header fetches inside Udt overrides
- Receipt cells store `depositQuantity` and `depositAmount` (not block numbers) — header provides the DAO AR field for exchange rate computation via `ickbValue()`
- Both receipt and deposit cell value calculation need per-cell headers
- Estimate scenarios (SDK.estimate) use pre-computed `ExchangeRatio` from tip header — this is separate from Udt's per-cell balance methods

### Claude's Discretion
- Technical investigation methodology (which CCC Udt internals to trace first)
- Decision document format and depth of analysis
- Prototype code scope (if any)

</decisions>

<specifics>
## Specific Ideas

- `infoFrom` can detect input vs output cells via outpoint presence — investigate this as a cleaner override strategy. Note: STACK.md research incorrectly claimed `CellAnyLike` lacks `outPoint`; it actually has `outPoint?: OutPointLike | null`. `getInputsInfo()` passes `Cell` objects (always have outPoint) to `infoFrom()`, while `getOutputsInfo()` passes `CellAny` from `tx.outputCells` (no outPoint). Both override points are viable.
- PR #328's `completeInputs(tx, filter, accumulator)` pattern (now in `forks/ccc/packages/core/src/signer/feePayer/feePayer.ts`) could be the hook for auto-fetching iCKB receipt/deposit cells during transaction completion. Note: STACK.md research recommended `client.getHeaderByTxHash()` which does not exist in CCC — the correct API is `client.getTransactionWithHeader()` as used in the current codebase.
- The `ickbValue()` function (core/udt.ts:151) and `convert()` function (core/udt.ts:179) are the core exchange rate calculation — these must work within the Udt override context
- Current `IckbUdtManager.getInputsUdtBalance()` (core/udt.ts:66) is the reference implementation for multi-representation balance calculation — three cell types: xUDT cells, receipt cells (type = logicScript), deposit cells (lock = logicScript + isDeposit)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-ccc-udt-integration-investigation*
*Context gathered: 2026-02-23*
