# Phase 4: Deprecated CCC API Replacement - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace `UdtHandler` dependency in `@ickb/order` with a plain `ccc.Script` parameter; remove UDT cellDeps management from OrderManager (caller/CCC Udt handles it externally during balance completion); verify `@ickb/dao` has no deprecated CCC API calls (it doesn't); correct Phase 3 decision document inaccuracies. UdtHandler/UdtManager deletion happens in Phase 5, not here.

</domain>

<decisions>
## Implementation Decisions

### OrderManager parameter design
- Replace `udtHandler: UdtHandler` constructor parameter with `udtScript: ccc.Script`
- OrderManager only needs the UDT type script -- not the full `udt.Udt` class or `UdtHandler` interface
- No new `@ckb-ccc/udt` dependency needed on `@ickb/order` -- `ccc.Script` comes from existing `@ckb-ccc/core`
- Strict parameter swap: all 9 `this.udtHandler.script` references become `this.udtScript`
- Keep `ScriptDeps` interface on OrderManager (still describes its own script + cellDeps)
- Keep `ExchangeRatio`, `ValueComponents`, and other `@ickb/utils` imports unchanged
- Update JSDoc `@param` for the renamed parameter
- Do NOT audit unrelated imports -- only replace UdtHandler

### CellDeps migration pattern
- Remove all `tx.addCellDeps(this.udtHandler.cellDeps)` calls from `mint()`, `addMatch()`, and `melt()`
- UDT cellDeps are now caller responsibility -- CCC Udt adds its own cellDeps during balance completion
- OrderManager still adds its own cellDeps via `tx.addCellDeps(this.cellDeps)` (order script deps)
- Add JSDoc note on `mint()`, `addMatch()`, `melt()`: caller must ensure UDT cellDeps are added to the transaction
- `ScriptDeps` interface unchanged -- still correctly describes OrderManager's own deps

### Phase scope boundaries
- `@ickb/dao`: No changes needed. Already clean (no UdtHandler, no deprecated CCC APIs). Verified by `pnpm check:full`
- `@ickb/order`: Replace UdtHandler with udtScript, remove UDT cellDeps calls
- `@ickb/utils`: Leave UdtManager's 3 deprecated `ccc.udtBalanceFrom()` calls for Phase 5 (UdtManager is being deleted there)
- Update roadmap success criteria to reflect actual changes (UdtHandler replacement, not deprecated API removal in dao/order)
- Correct Phase 3 decision document: rewrite the "Implementation Guidance for Phase 4" section to match actual decisions (DaoManager never had UdtHandler; OrderManager gets ccc.Script not udt.Udt)
- Import audit of remaining @ickb/utils imports: out of scope

### Claude's Discretion
- Exact JSDoc wording for the cellDeps caller-responsibility notes
- Whether to update the Phase 3 decision's replacement mapping table or restructure the section

</decisions>

<specifics>
## Specific Ideas

- The pattern established here is simpler than Phase 3 anticipated: managers get `ccc.Script`, not `udt.Udt` instances. The `udt.Udt` instance (including `IckbUdt`) lives at the SDK/caller level, not in dao/order managers.
- Phase 5 should note that dao/order managers don't need `udt.Udt` propagated to them -- the Udt instance handles completion externally.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 04-deprecated-ccc-api-replacement*
*Context gathered: 2026-02-26*
