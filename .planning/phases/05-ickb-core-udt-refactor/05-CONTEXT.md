# Phase 5: @ickb/core UDT Refactor - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `IckbUdt extends udt.Udt` in `@ickb/core` with `infoFrom` override for multi-representation balance (xUDT + receipts + deposits). Delete `UdtHandler` interface, `UdtManager` class, `ErrorTransactionInsufficientCoin`, `UdtCell`, `findUdts`, `addUdts` from `@ickb/utils`. Remove `udtHandler` parameter from `LogicManager` and `OwnedOwnerManager` (same pattern as Phase 4 OrderManager fix). Replace deprecated CCC API calls in `@ickb/core` and `@ickb/utils`. Update SDK to construct and use `IckbUdt`.

</domain>

<decisions>
## Implementation Decisions

### UDT completion & state compression
- Drop `compressState` feature entirely — CCC's `completeInputsByBalance` handles completion
- Callers use `ickbUdt.completeInputsByBalance(tx, signer)` directly — no convenience wrapper
- Destructure return as needed: `const { tx } = await ickbUdt.completeInputsByBalance(...)` — `addedCount` available but not required
- Trust CCC fully for completion — `infoFrom` provides accurate cell valuations, CCC handles dual-constraint (balance + capacity) optimization
- Stick to `completeInputsByBalance` only — `completeInputsAll` and `completeByTransfer` are inherited but not documented for iCKB callers

### CellDeps strategy
- IckbUdt overrides `addCellDeps` to add both xUDT code dep AND iCKB Logic code dep (individual `depType: "code"` deps, not dep group)
- Constructor takes `code: OutPointLike` (xUDT script code cell) via base class + `logicCode: OutPointLike` (iCKB Logic script code cell) as new param
- Individual code cell OutPoints sourced from `forks/contracts/` (mainnet + testnet deployments)
- Only IckbUdt switches to code deps pattern in Phase 5; other managers (DaoManager, LogicManager, OrderManager, OwnedOwnerManager) keep `CellDep[]` for now
- Mixed patterns (code deps + dep groups) coexist temporarily — `tx.addCellDeps` deduplicates

### Cell discovery (findUdts)
- Delete `findUdts`, `addUdts`, `UdtCell` interface, `isUdtSymbol` — all internal to `UdtManager`, no external consumers
- CCC's `completeInputs` (used internally by `completeInputsByBalance`) handles cell discovery via `Udt.filter`
- CCC's `isUdt()` length check (>= 16 bytes) is equivalent to current `>= 34` hex chars — no iCKB-specific reason for old threshold

### Error reporting
- Accept CCC's `ErrorUdtInsufficientCoin` from `completeInputsByBalance` — callers (SDK, UI) format error messages themselves
- Delete `ErrorTransactionInsufficientCoin` class from `@ickb/utils`
- Plain `Error` throws for header-not-found in `infoFrom` (exceptional path — CCC cache should provide headers)
- Phase 5 handles SDK error handling updates (not deferred to Phase 6)

### calculateScript → typeScriptFrom
- Renamed to `IckbUdt.typeScriptFrom(udt, ickbLogic)` — static method, CCC-aligned naming
- Keep current parameter types: `(udt: ccc.Script, ickbLogic: ccc.Script): ccc.Script`
- Computes the `script` param for IckbUdt constructor (token identity via args)

### Manager dependency chain
- LogicManager: remove `udtHandler: UdtHandler` constructor param, remove `tx.addCellDeps(this.udtHandler.cellDeps)` calls (2 sites) — UDT cellDeps are caller responsibility
- OwnedOwnerManager: same treatment — remove `udtHandler` param, remove cellDeps calls (2 sites)
- This matches Phase 4's OrderManager pattern exactly
- With all three managers cleaned, `UdtHandler` interface has zero consumers → delete from `@ickb/utils`
- `ScriptDeps` interface: researcher should check if any consumers remain after `UdtHandler` deletion

### Claude's Discretion
- Constructor parameter for `IckbUdt`: whether to take `CellDep[]` or single `CellDep` for the dep group — Claude picks cleanest pattern
- Internal organization of the `infoFrom` override code
- How to structure the `@ckb-ccc/udt` dependency addition to `@ickb/core` package.json
- Exact migration of SDK `IckbUdtManager` construction to `IckbUdt` construction

</decisions>

<specifics>
## Specific Ideas

- CCC Udt's `completeInputsByBalance` capacity handling is more sophisticated than current `completeUdt` — caps capacity at tx fee to avoid over-providing from UDT cells
- CCC's `ErrorUdtInsufficientCoin` has a `reason` field for custom messages — could be used later for iCKB-specific formatting if needed (note for researcher)
- Researcher should check for catch blocks referencing the old `ErrorTransactionInsufficientCoin` class across SDK and apps
- Matching bot scenario: `infoFrom` may be called frequently during order matching. CCC `Client.cache` handles header fetch dedup, but researcher should evaluate if additional caching is needed for high-frequency scenarios
- Individual code cell OutPoints (replacing dep group) can be found in `forks/contracts/` for both mainnet and testnet

</specifics>

<deferred>
## Deferred Ideas

- **ValueComponents redesign**: `udtValue` field name is ambiguous in multi-UDT context (which UDT?). CCC's `UdtInfo` scoped to specific Udt instance is cleaner. Evaluate renaming/replacing across all packages in a future phase
- **All managers to code deps**: Switch DaoManager, LogicManager, OrderManager, OwnedOwnerManager from `CellDep[]` to individual code OutPoints (CCC pattern). Phase 5 only migrates IckbUdt
- **infoFrom caching for matching bot**: If matching bot performance becomes a bottleneck, add cell→UdtInfo result caching in IckbUdt to avoid recomputation across trial transactions

</deferred>

---

*Phase: 05-ickb-core-udt-refactor*
*Context gathered: 2026-02-26*
