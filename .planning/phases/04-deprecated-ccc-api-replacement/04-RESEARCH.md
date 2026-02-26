# Phase 4: Deprecated CCC API Replacement - Research

**Researched:** 2026-02-26
**Domain:** CKB UDT handler interface replacement in @ickb/order package
**Confidence:** HIGH

## Summary

Phase 4 is a focused refactoring of `OrderManager` in `@ickb/order` to replace the `UdtHandler` interface dependency with a plain `ccc.Script` parameter. The scope is narrow and well-defined: 9 lines in one file (`order.ts`) need modification, one SDK caller site needs updating, and `@ickb/dao` needs verification (already confirmed clean). The Phase 3 decision document was already corrected in commit `c7ba503` during the discuss-phase -- this should be verified rather than re-done.

This is a straightforward mechanical refactoring with no new dependencies, no architecture decisions, and no deprecated API calls to replace in the target packages. The pattern established here (managers receive `ccc.Script`, not `udt.Udt`) is the foundation that Phase 5 builds upon.

**Primary recommendation:** Single plan covering OrderManager parameter swap, cellDeps removal, SDK caller update, dao verification, and Phase 3 doc verification. All changes are interdependent and should be in one atomic commit.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Replace `udtHandler: UdtHandler` constructor parameter with `udtScript: ccc.Script`
- OrderManager only needs the UDT type script -- not the full `udt.Udt` class or `UdtHandler` interface
- No new `@ckb-ccc/udt` dependency needed on `@ickb/order` -- `ccc.Script` comes from existing `@ckb-ccc/core`
- Strict parameter swap: all 9 `this.udtHandler.script` references become `this.udtScript`
- Keep `ScriptDeps` interface on OrderManager (still describes its own script + cellDeps)
- Keep `ExchangeRatio`, `ValueComponents`, and other `@ickb/utils` imports unchanged
- Update JSDoc `@param` for the renamed parameter
- Do NOT audit unrelated imports -- only replace UdtHandler
- Remove all `tx.addCellDeps(this.udtHandler.cellDeps)` calls from `mint()`, `addMatch()`, and `melt()`
- UDT cellDeps are now caller responsibility -- CCC Udt adds its own cellDeps during balance completion
- OrderManager still adds its own cellDeps via `tx.addCellDeps(this.cellDeps)` (order script deps)
- Add JSDoc note on `mint()`, `addMatch()`, `melt()`: caller must ensure UDT cellDeps are added to the transaction
- `ScriptDeps` interface unchanged -- still correctly describes OrderManager's own deps
- `@ickb/dao`: No changes needed. Already clean (no UdtHandler, no deprecated CCC APIs). Verified by `pnpm check:full`
- `@ickb/order`: Replace UdtHandler with udtScript, remove UDT cellDeps calls
- `@ickb/utils`: Leave UdtManager's 3 deprecated `ccc.udtBalanceFrom()` calls for Phase 5 (UdtManager is being deleted there)
- Update roadmap success criteria to reflect actual changes (UdtHandler replacement, not deprecated API removal in dao/order)
- Correct Phase 3 decision document: rewrite the "Implementation Guidance for Phase 4" section to match actual decisions
- Import audit of remaining @ickb/utils imports: out of scope

### Claude's Discretion
- Exact JSDoc wording for the cellDeps caller-responsibility notes
- Whether to update the Phase 3 decision's replacement mapping table or restructure the section

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SMTX-05 | UDT handler registration (`addUdtHandlers()`) is replaced by direct `Udt` instance usage or standalone utility functions | Phase 4 portion: OrderManager.udtHandler replaced with udtScript: ccc.Script; UDT cellDeps removed from OrderManager methods. The `UdtHandler` import is removed from @ickb/order. Full deletion of UdtHandler/UdtManager deferred to Phase 5. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ckb-ccc/core` | Already in package.json (catalog:) | Provides `ccc.Script`, `ccc.CellDep`, `ccc.Transaction`, `ccc.TransactionLike` | Core CCC types -- `ccc.Script` is the replacement for `UdtHandler.script` |
| `@ickb/utils` | workspace:* | Provides `ScriptDeps`, `ExchangeRatio`, `ValueComponents`, `BufferedGenerator`, `defaultFindCellsLimit` | Shared types/utilities -- UdtHandler import removed but other imports remain |

### Supporting
No new libraries needed. No dependency changes to package.json.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ccc.Script` | `udt.Udt` instance | Over-engineered -- OrderManager only needs type script for cell identification, not balance/completion capabilities. Locked decision: `ccc.Script`. |

**Installation:**
No installation needed. All required types already available from existing `@ckb-ccc/core` dependency.

## Architecture Patterns

### Current Structure (Before Phase 4)
```
packages/order/src/
  order.ts        # OrderManager class -- 9 udtHandler references to change
  cells.ts        # OrderCell, MasterCell, OrderGroup -- no changes needed
  entities.ts     # OrderData, Info, Ratio -- no changes needed
  index.ts        # barrel export -- no changes needed
```

### Pattern 1: Manager Receives Plain Script
**What:** OrderManager constructor takes `udtScript: ccc.Script` instead of `udtHandler: UdtHandler`. The manager only uses the UDT type script for cell identification (type script matching in `isOrder`, `findSimpleOrders`, output cell construction in `mint`, `addMatch`).
**When to use:** When a manager needs to identify cells by type script but does not need balance calculation, completion, or cellDeps management for that script.
**Example:**
```typescript
// Before (current):
constructor(
  public readonly script: ccc.Script,
  public readonly cellDeps: ccc.CellDep[],
  public readonly udtHandler: UdtHandler,
) {}

// After (Phase 4):
constructor(
  public readonly script: ccc.Script,
  public readonly cellDeps: ccc.CellDep[],
  public readonly udtScript: ccc.Script,
) {}
```

### Pattern 2: Caller-Managed CellDeps
**What:** OrderManager no longer adds UDT cellDeps to transactions. The UDT's cellDeps are the caller's responsibility -- CCC's `udt.Udt` adds its own cellDeps during balance completion (`Trait.addCellDeps(tx)`), so OrderManager does not need to duplicate this.
**When to use:** When a component constructs partial transactions that are completed by a higher-level orchestrator (SDK) using CCC's completion pipeline.
**Example:**
```typescript
// Before (current) -- mint():
tx.addCellDeps(this.cellDeps);
tx.addCellDeps(this.udtHandler.cellDeps);  // REMOVE this line

// After (Phase 4) -- mint():
tx.addCellDeps(this.cellDeps);
// UDT cellDeps handled by caller/CCC Udt during balance completion
```

### Pattern 3: SDK Caller Passes Script
**What:** The SDK's `getConfig()` constructs `OrderManager` with `ickbUdt.script` (a `ccc.Script`) instead of the full `IckbUdtManager` instance.
**Example:**
```typescript
// Before (packages/sdk/src/constants.ts:78):
const order = new OrderManager(d.order.script, d.order.cellDeps, ickbUdt);

// After:
const order = new OrderManager(d.order.script, d.order.cellDeps, ickbUdt.script);
```

### Anti-Patterns to Avoid
- **Passing full UdtHandler/UdtManager to managers that only need Script:** Over-couples components. Managers should receive the minimum data they need.
- **Adding UDT cellDeps in multiple places:** Creates duplication and ordering issues. CCC's completion pipeline handles cellDeps via `Trait.addCellDeps`.
- **Changing cells.ts or entities.ts:** These files have no UdtHandler dependency. Do not modify them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UDT type script identification | Custom `UdtHandler` interface with `.script` property | Plain `ccc.Script` parameter | `ccc.Script` already has `.eq()` for comparison -- no wrapper needed |
| UDT cellDeps management in partial transactions | `tx.addCellDeps(udtHandler.cellDeps)` in every method | CCC's `udt.Udt.addCellDeps(tx)` during completion | CCC manages its own deps -- managers should not duplicate |

**Key insight:** OrderManager's relationship to UDT is purely type-script-based identification. It checks "is this cell a UDT cell?" and "construct a UDT-typed output cell". Both operations only need `ccc.Script`, not the full `UdtHandler` interface with balance/completion methods.

## Common Pitfalls

### Pitfall 1: Forgetting the SDK Caller Site
**What goes wrong:** Changing `OrderManager` constructor but not updating `packages/sdk/src/constants.ts:78` where `new OrderManager(d.order.script, d.order.cellDeps, ickbUdt)` passes the full `IckbUdtManager` instance.
**Why it happens:** The change is in `@ickb/order` but the caller is in `@ickb/sdk`, a different package.
**How to avoid:** Update `constants.ts:78` to pass `ickbUdt.script` instead of `ickbUdt`. TypeScript will catch this at compile time since `IckbUdtManager` is not assignable to `ccc.Script`.
**Warning signs:** Type error during `pnpm check:full` -- "Argument of type 'IckbUdtManager' is not assignable to parameter of type 'Script'".

### Pitfall 2: Missing the Import Removal
**What goes wrong:** Removing all `udtHandler` usage but leaving `type UdtHandler` in the import statement on line 7 of `order.ts`.
**Why it happens:** Mechanical replacement of property accesses misses the import declaration.
**How to avoid:** After replacing all 9 references, remove `type UdtHandler` from the import statement. The linter will also catch unused imports.
**Warning signs:** `@typescript-eslint/no-unused-vars` or `no-unused-imports` lint error.

### Pitfall 3: Incorrect Reference Count
**What goes wrong:** Thinking there are only 4 `.script` references when there are actually 9 total `udtHandler` mentions (including JSDoc, constructor parameter, `.script` accesses, and `.cellDeps` accesses).
**Why it happens:** Counting only one property pattern instead of all mentions.
**How to avoid:** The 9 references break down as:
  - Line 22: JSDoc `@param udtHandler` -> update to `@param udtScript`
  - Line 27: Constructor `public readonly udtHandler: UdtHandler` -> `public readonly udtScript: ccc.Script`
  - Line 42: `this.udtHandler.script` -> `this.udtScript` (isOrder)
  - Line 190: `this.udtHandler.cellDeps` -> DELETE LINE (mint)
  - Line 196: `this.udtHandler.script` -> `this.udtScript` (mint output)
  - Line 229: `this.udtHandler.cellDeps` -> DELETE LINE (addMatch)
  - Line 236: `this.udtHandler.script` -> `this.udtScript` (addMatch output)
  - Line 519: `this.udtHandler.cellDeps` -> DELETE LINE (melt)
  - Line 635: `this.udtHandler.script` -> `this.udtScript` (findSimpleOrders filter)

### Pitfall 4: Phase 3 Decision Doc Re-correction
**What goes wrong:** Attempting to re-correct the Phase 3 decision document when it was already corrected in commit `c7ba503` during the discuss-phase.
**Why it happens:** The roadmap success criterion #5 says to correct it, but the correction was applied proactively.
**How to avoid:** Verify the current content of `03-DECISION.md` lines 369-388 already contains the correct Phase 4 guidance (updated 2026-02-26). If correct, document verification rather than making changes.
**Warning signs:** If lines 369-388 mention "DaoManager UdtHandler replacement" or "udt.Udt instance" for OrderManager, correction is still needed. Current content correctly says neither.

### Pitfall 5: Breaking @ickb/core Callers of UdtHandler
**What goes wrong:** Modifying `UdtHandler` interface or `UdtManager` class in `@ickb/utils` during Phase 4.
**Why it happens:** Desire to clean up the source of `UdtHandler`.
**How to avoid:** Phase 4 only touches `@ickb/order` (consumer) and `@ickb/sdk` (caller). The `UdtHandler` interface and `UdtManager` class in `@ickb/utils` remain untouched until Phase 5. `@ickb/core`'s `LogicManager` and `OwnedOwnerManager` still use `udtHandler: UdtHandler` -- they are out of scope.

## Code Examples

Verified patterns from codebase investigation:

### OrderManager Constructor Change
```typescript
// packages/order/src/order.ts
// Source: Verified from current codebase line 16-28

import { ccc } from "@ckb-ccc/core";
import {
  BufferedGenerator,
  defaultFindCellsLimit,
  type ExchangeRatio,
  type ScriptDeps,
  // NOTE: UdtHandler import REMOVED
  type ValueComponents,
} from "@ickb/utils";

export class OrderManager implements ScriptDeps {
  /**
   * Creates an instance of OrderManager.
   *
   * @param script - The order script.
   * @param cellDeps - The cell dependencies for the order.
   * @param udtScript - The UDT (User Defined Token) type script.
   */
  constructor(
    public readonly script: ccc.Script,
    public readonly cellDeps: ccc.CellDep[],
    public readonly udtScript: ccc.Script,
  ) {}
```

### isOrder Method Change
```typescript
// packages/order/src/order.ts
// Source: Verified from current codebase line 39-44

isOrder(cell: ccc.Cell): boolean {
  return (
    cell.cellOutput.lock.eq(this.script) &&
    Boolean(cell.cellOutput.type?.eq(this.udtScript))  // was: this.udtHandler.script
  );
}
```

### mint() cellDeps Removal and JSDoc Update
```typescript
// packages/order/src/order.ts
// Source: Verified from current codebase lines 154-209

/**
 * Mints a new order cell and appends it to the transaction.
 *
 * ...existing JSDoc...
 *
 * @remarks Caller must ensure UDT cellDeps are added to the transaction
 * (e.g., via CCC Udt balance completion).
 */
mint(
  txLike: ccc.TransactionLike,
  lock: ccc.Script,
  info: InfoLike,
  amounts: ValueComponents,
): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  // ...data creation...

  tx.addCellDeps(this.cellDeps);
  // REMOVED: tx.addCellDeps(this.udtHandler.cellDeps);

  const position = tx.addOutput(
    {
      lock: this.script,
      type: this.udtScript,  // was: this.udtHandler.script
    },
    data.toBytes(),
  );
  // ...rest unchanged...
}
```

### SDK Caller Update
```typescript
// packages/sdk/src/constants.ts
// Source: Verified from current codebase line 78

// Before:
const order = new OrderManager(d.order.script, d.order.cellDeps, ickbUdt);

// After:
const order = new OrderManager(d.order.script, d.order.cellDeps, ickbUdt.script);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `UdtHandler` interface with script + cellDeps + balance methods | Plain `ccc.Script` for type identification; `udt.Udt` for cellDeps/balance at SDK level | Phase 4 (this phase) | Managers are simpler; UDT completion logic centralized in CCC |
| `tx.addCellDeps(udtHandler.cellDeps)` in every method | CCC Udt handles its own cellDeps during completion | Phase 4 (this phase) | No duplicate cellDep management; aligns with CCC patterns |

**Deprecated/outdated:**
- `UdtHandler` interface: Still exists in `@ickb/utils` -- deleted in Phase 5. Phase 4 only removes its usage from `@ickb/order`.
- `UdtManager` class: Still exists in `@ickb/utils` -- deleted in Phase 5. Not touched in Phase 4.

## Precise Change Map

### File: `packages/order/src/order.ts`

| Line | Current | After | Category |
|------|---------|-------|----------|
| 7 | `type UdtHandler,` | (remove from import) | Import cleanup |
| 22 | `@param udtHandler - The handler for UDT` | `@param udtScript - The UDT type script.` | JSDoc |
| 27 | `public readonly udtHandler: UdtHandler,` | `public readonly udtScript: ccc.Script,` | Constructor |
| 42 | `this.udtHandler.script` | `this.udtScript` | isOrder() |
| 190 | `tx.addCellDeps(this.udtHandler.cellDeps);` | (remove line) | mint() cellDeps |
| 196 | `type: this.udtHandler.script,` | `type: this.udtScript,` | mint() output |
| 229 | `tx.addCellDeps(this.udtHandler.cellDeps);` | (remove line) | addMatch() cellDeps |
| 236 | `type: this.udtHandler.script,` | `type: this.udtScript,` | addMatch() output |
| 519 | `tx.addCellDeps(this.udtHandler.cellDeps);` | (remove line) | melt() cellDeps |
| 635 | `script: this.udtHandler.script,` | `script: this.udtScript,` | findSimpleOrders() |

Additionally: JSDoc `@remarks` notes on `mint()`, `addMatch()`, `melt()` for caller responsibility.

### File: `packages/sdk/src/constants.ts`

| Line | Current | After | Category |
|------|---------|-------|----------|
| 78 | `new OrderManager(d.order.script, d.order.cellDeps, ickbUdt)` | `new OrderManager(d.order.script, d.order.cellDeps, ickbUdt.script)` | Caller update |

### Files NOT Changed (verified clean)
- `packages/dao/src/dao.ts` -- No UdtHandler, no deprecated CCC APIs
- `packages/dao/src/cells.ts` -- No UdtHandler, no deprecated CCC APIs
- `packages/dao/src/index.ts` -- No UdtHandler
- `packages/order/src/cells.ts` -- No UdtHandler
- `packages/order/src/entities.ts` -- No UdtHandler
- `packages/order/src/index.ts` -- No UdtHandler
- `packages/utils/src/udt.ts` -- UdtHandler/UdtManager remain (Phase 5 scope)
- `packages/core/src/logic.ts` -- udtHandler references remain (Phase 5 scope)
- `packages/core/src/owned_owner.ts` -- udtHandler references remain (Phase 5 scope)
- `packages/core/src/udt.ts` -- IckbUdtManager remains (Phase 5 scope)

### Phase 3 Decision Doc Verification
- `03-DECISION.md` lines 369-388: Already corrected in commit `c7ba503` (2026-02-26)
- Content now correctly states: DaoManager never had UdtHandler; OrderManager gets `udtScript: ccc.Script`; UDT cellDeps removed from OrderManager
- Action: Verify content is correct, no additional changes needed

## Open Questions

1. **Line numbers may shift after edits**
   - What we know: Line numbers referenced above are from the current file state
   - What's unclear: Removing 3 cellDeps lines shifts all subsequent line numbers
   - Recommendation: Apply changes top-to-bottom or use pattern matching rather than absolute line numbers

2. **SDK type return change**
   - What we know: `getConfig()` return type includes `order: OrderManager`. After this change, `OrderManager.udtScript` is `ccc.Script` instead of `OrderManager.udtHandler` being `UdtHandler`
   - What's unclear: Whether any SDK callers access `order.udtHandler` directly
   - Recommendation: Search for `order.udtHandler` usage in SDK tests/apps before finalizing. None found in library packages.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of `packages/order/src/order.ts` (all 9 udtHandler references verified line by line)
- Direct codebase inspection of `packages/dao/src/dao.ts`, `packages/dao/src/cells.ts` (confirmed zero UdtHandler/deprecated API usage)
- Direct codebase inspection of `packages/sdk/src/constants.ts:78` (single OrderManager construction site in libraries)
- Git log of `03-DECISION.md` (correction already in commit `c7ba503`)

### Secondary (MEDIUM confidence)
- Phase 3 decision document `03-DECISION.md` sections on Phase 4 guidance (verified current and accurate)

### Tertiary (LOW confidence)
- None -- all findings verified from codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all types from existing `@ckb-ccc/core`
- Architecture: HIGH - Mechanical refactoring with exact change map verified line-by-line
- Pitfalls: HIGH - All pitfalls discovered from codebase analysis (cross-package caller, import cleanup, reference count)

**Research date:** 2026-02-26
**Valid until:** Indefinite -- this is a mechanical refactoring with no external dependency concerns
