# Phase 1: SmartTransaction Removal (feature-slice) - Research

**Researched:** 2026-02-22
**Domain:** TypeScript refactoring / CCC blockchain SDK alignment
**Confidence:** HIGH

## Summary

Phase 1 removes `SmartTransaction`, `CapacityManager`, `getHeader()`/`HeaderKey`, and 7 scattered 64-output DAO limit checks. It contributes the DAO check to CCC core via `ccc-fork/`, updates all manager method signatures across all 5 library packages from `SmartTransaction` to `ccc.TransactionLike`, and keeps the build green after every step.

The codebase is well-structured: SmartTransaction has exactly 9 consumer files across 5 packages; `getHeader` has 5 standalone call sites plus 4 instance method call sites; the 64-output DAO check appears in 7 locations across 4 files. CCC's native `Transaction` already handles DAO profit in `getInputsCapacity()` via `getInputsCapacityExtra()` -> `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()`, making SmartTransaction's `getInputsCapacity` override redundant. CCC's `Transaction.from(txLike)` provides the `TransactionLike` -> `Transaction` entry-point conversion pattern that all updated method signatures will follow.

**Primary recommendation:** Execute in the exact 5-step sequence from CONTEXT.md, with CCC DAO utility first (purely additive), then sweep each removal across all packages before moving to the next removal. Every step must pass `pnpm check:full`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Build the 64-output NervosDAO limit check **in CCC core**, not in @ickb/utils
- Develop in `ccc-fork/ccc/`, record pins, use immediately via workspace override while waiting for upstream merge
- **Submit the upstream CCC PR during Phase 1 execution**
- CCC PR includes three components:
  1. **`completeFee()` safety net** -- async check using `client.getKnownScript(KnownScript.NervosDao)` with full `Script.eq()` comparison
  2. **Standalone utility function** -- `assertDaoOutputLimit(tx, client)` that auto-resolves unresolved inputs (populating `CellInput.cellOutput` as a side effect) and checks both inputs and outputs
  3. **`ErrorNervosDaoOutputLimit` error class** in `transactionErrors.ts` with metadata fields (count) and hardcoded limit of 64
- The check logic: if `outputs.length > 64` AND any input or output has DAO type script, throw error
- **PR description should mention** the possibility of adding the check to `addOutput()` as a future enhancement, inviting maintainer feedback
- All 6+ scattered DAO checks across dao/core/utils packages are replaced with calls to the new CCC utility **in Phase 1**
- **Remove `getHeader()` function and `HeaderKey` type entirely** from @ickb/utils
- Inline CCC client calls at each of the 8+ call sites across dao/core/sdk
- SmartTransaction's redundant `Map<hexString, Header>` cache is deleted -- CCC's built-in `ClientCacheMemory` LRU (128 blocks) handles caching
- **`addHeaders()` replacement needed** -- 3 call sites push to `tx.headerDeps` directly
- **Build must pass after every removal step** -- no intermediate broken states
- Execution order:
  1. CCC DAO utility (adds new code, nothing breaks)
  2. Replace all scattered DAO checks with CCC utility calls (all packages)
  3. Remove `getHeader()`/`HeaderKey` and inline CCC calls at all call sites (all packages)
  4. Remove SmartTransaction class and update all method signatures to `ccc.TransactionLike` (all packages)
  5. Remove CapacityManager and update SDK call sites (utils + sdk)
- Follow CCC's convention: public APIs accept `ccc.TransactionLike` (flexible input), return `ccc.Transaction` (concrete)
- Convert internally with `ccc.Transaction.from(txLike)` at method entry point
- UdtHandler interface and UdtManager class **stay in @ickb/utils** for Phase 1, signatures updated from `SmartTransaction` to `ccc.TransactionLike`
- CapacityManager is deleted from @ickb/utils; SDK call sites updated to use CCC's native cell finding
- **Clean delete** -- no deprecation stubs, no migration comments, no breadcrumbs
- File deletions + barrel export removal in the **same commit** (atomic)
- Files deleted: `transaction.ts`, `capacity.ts` (from @ickb/utils)
- Files kept: `udt.ts` (signatures updated), `utils.ts` (getHeader/HeaderKey removed), `codec.ts`, `heap.ts`, `index.ts`
- Script comparison must use full `Script.eq()` (codeHash + hashType + args), never just `codeHash`

### Claude's Discretion
- `addUdtHandlers()` replacement strategy at call sites
- CapacityManager replacement approach in SDK (CCC native equivalent)
- Exact commit boundaries within each feature-slice step
- CCC PR code style and test approach (follow CCC's vitest patterns)

### Deferred Ideas (OUT OF SCOPE)
- **addOutput() DAO check** -- Sync check in `Transaction.addOutput()`. Deferred due to CCC maintainer acceptance concerns. Mentioned in CCC PR description as future possibility.
- **getHeader as CCC contribution** -- A unified header lookup function. Low priority since the wrapper is being removed and calls inlined.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SMTX-01 | All manager method signatures across all 5 library packages accept `ccc.TransactionLike` instead of `SmartTransaction` | Exact inventory: 9 files use SmartTransaction type across 5 packages; CCC's `Transaction.from(txLike)` is the conversion pattern; all method signatures identified with line numbers |
| SMTX-02 | `SmartTransaction` class and its `completeFee()` override deleted from `@ickb/utils` | SmartTransaction in `transaction.ts` (480 lines); `completeFee()` override (lines 63-98) wraps UDT handlers + DAO check; CCC's native `getInputsCapacity` already handles DAO profit -- override is redundant |
| SMTX-04 | `getHeader()` function and `HeaderKey` type removed; all call sites inline CCC client calls | 5 standalone `getHeader` call sites + 4 `tx.getHeader` instance method call sites identified; each maps to `client.getTransactionWithHeader(hash)?.header` or `client.getHeaderByNumber(n)`; 3 `addHeaders` call sites need `tx.headerDeps.push()` with dedup |
| SMTX-06 | 64-output NervosDAO limit check consolidated into a single CCC utility | 7 check locations across 4 files identified; CCC error class pattern documented from `transactionErrors.ts`; `completeFee()` integration point identified; CCC vitest test patterns documented |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ckb-ccc/core` | catalog: (^1.12.2) | CKB blockchain SDK | Project's core dependency; `Transaction`, `TransactionLike`, `Client`, `Script.eq()` |
| TypeScript | ^5.9.3 (strict mode) | Type safety | `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride` |
| tsgo | native-preview | Type checking | Used via `ccc-fork/tsgo-filter.sh` when CCC is cloned |
| vitest | ^3.2.4 | Testing | CCC's test framework; tests for the CCC PR |
| pnpm | 10.30.1 | Package management | Workspace protocol, catalog specifiers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ccc-fork/` system | local | Local CCC development | Building/testing CCC DAO contribution before upstream merge |
| `@changesets/cli` | ^2.29.8 | Versioning | After API changes, run `pnpm changeset` |

### Alternatives Considered
No alternatives -- this is a refactoring phase within an existing codebase. All decisions are locked.

## Architecture Patterns

### Recommended Project Structure
```
packages/
├── utils/src/
│   ├── codec.ts          # Molecule codec utilities (kept)
│   ├── heap.ts           # MinHeap (kept)
│   ├── udt.ts            # UdtHandler/UdtManager (kept, signatures updated)
│   ├── utils.ts          # Utility functions (getHeader/HeaderKey REMOVED)
│   ├── index.ts          # Barrel exports (transaction.ts + capacity.ts removed)
│   ├── transaction.ts    # DELETED (SmartTransaction)
│   └── capacity.ts       # DELETED (CapacityManager)
├── dao/src/
│   ├── dao.ts            # DaoManager (SmartTransaction -> TransactionLike)
│   └── cells.ts          # DaoCell (getHeader inlined)
├── core/src/
│   ├── logic.ts          # LogicManager (SmartTransaction -> TransactionLike)
│   ├── owned_owner.ts    # OwnedOwnerManager (SmartTransaction -> TransactionLike)
│   ├── udt.ts            # IckbUdtManager (SmartTransaction -> TransactionLike)
│   └── cells.ts          # ReceiptCell/etc (getHeader inlined)
├── order/src/
│   └── order.ts          # OrderManager (SmartTransaction -> TransactionLike)
├── sdk/src/
│   ├── sdk.ts            # IckbSdk (SmartTransaction -> TransactionLike, CapacityManager removed)
│   └── constants.ts      # getConfig (CapacityManager removed)
ccc-fork/ccc/packages/core/src/ckb/
├── transactionErrors.ts  # + ErrorNervosDaoOutputLimit (new)
└── transaction.ts        # + completeFee safety net + assertDaoOutputLimit (new)
```

### Pattern 1: TransactionLike Input / Transaction Output
**What:** CCC convention for public APIs that transform transactions
**When to use:** Every manager method that accepts a transaction
**Example:**
```typescript
// Source: CCC packages (udt, type-id, spore) all follow this pattern
// Before:
deposit(tx: SmartTransaction, capacities: ccc.FixedPoint[], lock: ccc.Script): void

// After:
deposit(txLike: ccc.TransactionLike, capacities: ccc.FixedPoint[], lock: ccc.Script): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  // ... mutate tx ...
  return tx;
}
```

### Pattern 2: Inline Header Fetching
**What:** Replace `getHeader(client, { type, value })` with direct CCC client calls
**When to use:** All call sites where `getHeader` or `tx.getHeader` was used
**Example:**
```typescript
// Before (standalone function):
const header = await getHeader(client, { type: "txHash", value: txHash });

// After (inlined):
const txWithHeader = await client.getTransactionWithHeader(txHash);
if (!txWithHeader?.header) {
  throw new Error("Header not found");
}
const header = txWithHeader.header;

// Before (number lookup):
const header = await getHeader(client, { type: "number", value: blockNumber });

// After:
const header = await client.getHeaderByNumber(blockNumber);
if (!header) {
  throw new Error("Header not found");
}
```

### Pattern 3: Direct headerDeps Push (replacing addHeaders)
**What:** Push header hashes to `tx.headerDeps` directly with dedup
**When to use:** The 3 call sites where `tx.addHeaders()` was used
**Example:**
```typescript
// Before:
tx.addHeaders(depositHeader); // TransactionHeader with { header, txHash? }

// After:
const hash = depositHeader.header.hash;
if (!tx.headerDeps.some((h) => h === hash)) {
  tx.headerDeps.push(hash);
}
```

### Pattern 4: CCC DAO Error Class Convention
**What:** Error class in `transactionErrors.ts` following existing patterns
**When to use:** The new `ErrorNervosDaoOutputLimit`
**Example:**
```typescript
// Source: ccc-fork/ccc/packages/core/src/ckb/transactionErrors.ts
// Follow the ErrorTransactionInsufficientCapacity pattern:
export class ErrorNervosDaoOutputLimit extends Error {
  public readonly count: number;
  public readonly limit: number;

  constructor(count: number) {
    super(
      `NervosDAO transaction has ${count} output cells, exceeding the limit of 64`,
    );
    this.count = count;
    this.limit = 64;
  }
}
```

### Pattern 5: DAO Check Utility Function
**What:** Standalone async utility + completeFee integration
**When to use:** Replacing all 7 scattered DAO checks
**Example:**
```typescript
// Standalone utility:
export async function assertDaoOutputLimit(
  tx: Transaction,
  client: Client,
): Promise<void> {
  if (tx.outputs.length <= 64) return;

  const { codeHash, hashType } = await client.getKnownScript(
    KnownScript.NervosDao,
  );
  const dao = Script.from({ codeHash, hashType, args: "0x" });

  // Auto-resolve unresolved inputs
  for (const input of tx.inputs) {
    await input.completeExtraInfos(client);
  }

  const isDaoTx =
    tx.inputs.some((i) => i.cellOutput?.type?.eq(dao)) ||
    tx.outputs.some((o) => o.type?.eq(dao));

  if (isDaoTx) {
    throw new ErrorNervosDaoOutputLimit(tx.outputs.length);
  }
}
```

### Pattern 6: addUdtHandlers Replacement
**What:** When SmartTransaction is removed, `addUdtHandlers()` calls can only do what `ccc.Transaction` supports
**When to use:** The 8 `addUdtHandlers` call sites across 4 files
**Example:**
```typescript
// Before:
tx.addUdtHandlers(this.udtHandler);

// After (only the cellDeps part survives):
tx.addCellDeps(this.udtHandler.cellDeps);
// The UDT handler registration was SmartTransaction-specific.
// The cellDeps are the only persistent effect on a plain Transaction.
// Note: Most call sites already also call tx.addCellDeps(this.cellDeps)
// just before addUdtHandlers, so this may be a no-op if deduplication
// in addCellDeps handles it. Check each site.
```

### Anti-Patterns to Avoid
- **Partial script comparison:** Never compare just `codeHash`. Always use `Script.eq()` (codeHash + hashType + args). CCC's own `isNervosDao` uses codeHash + hashType but not args -- the new CCC utility should use the safer `Script.eq()` with args: "0x".
- **Leaving broken intermediate states:** Each feature-slice step must pass `pnpm check:full`. Don't delete SmartTransaction before all its consumers are updated.
- **Creating wrapper types:** Don't create a "TransactionWrapper" or similar -- use plain `ccc.Transaction` directly.
- **Keeping dead exports:** When `transaction.ts` is deleted, its barrel export `export * from "./transaction.js"` in `index.ts` must be removed in the same commit.
- **Redundant header caching:** Don't create a replacement header cache. CCC's `ClientCacheMemory` (128-block LRU) handles this transparently.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DAO profit calculation | Custom getInputsCapacity | CCC's native `Transaction.getInputsCapacity()` | Already handles DAO profit via `getInputsCapacityExtra()` -> `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()` |
| Header caching | Custom Map<string, Header> | CCC's `ClientCacheMemory` | Built-in LRU cache for 128 blocks, transparent to caller |
| Transaction type conversion | Custom `SmartTransaction.from()` | CCC's `Transaction.from(txLike)` | Standard pattern across CCC ecosystem; handles all TransactionLike variations |
| Cell finding | Custom CapacityManager.findCapacities | CCC's `client.findCells()` / `client.findCellsOnChain()` | Native CCC API with filter support |
| Fee completion | SmartTransaction.completeFee override | CCC's `tx.completeFeeBy()` / `tx.completeFeeChangeToLock()` | CCC provides multiple fee completion strategies |

**Key insight:** SmartTransaction was created before CCC had many of these features. CCC now handles DAO profit, fee completion, cell finding, and caching natively. The abstraction layer is no longer needed.

## Common Pitfalls

### Pitfall 1: Breaking imports during staged deletion
**What goes wrong:** Deleting SmartTransaction from utils before consumers are updated causes cascading type errors across all 5 packages.
**Why it happens:** The dependency chain is utils -> dao -> core -> order -> sdk. Removing a type from utils breaks everything downstream.
**How to avoid:** Follow the 5-step execution order strictly. Update all consumers to use `ccc.TransactionLike` BEFORE deleting the SmartTransaction class.
**Warning signs:** TypeScript errors mentioning "SmartTransaction is not exported" in any package.

### Pitfall 2: addUdtHandlers cellDeps duplication
**What goes wrong:** When replacing `addUdtHandlers`, the cellDeps are added twice (once by the explicit `tx.addCellDeps(this.cellDeps)` that usually precedes `addUdtHandlers`, and again when replacing `addUdtHandlers` itself).
**Why it happens:** Most call sites already have `tx.addCellDeps(this.cellDeps)` right before `tx.addUdtHandlers(this.udtHandler)`. The `addUdtHandlers` internally also calls `this.addCellDeps(udtHandler.cellDeps)`.
**How to avoid:** Audit each `addUdtHandlers` call site to check if the cellDeps are already added by a preceding `addCellDeps`. CCC's `addCellDeps` deduplicates, so double-adding is harmless but messy.
**Warning signs:** Duplicate cellDeps in transaction output (functional but wasteful).

### Pitfall 3: Missing null checks when inlining getHeader
**What goes wrong:** `client.getTransactionWithHeader(hash)` returns `undefined` if the transaction is not found. The original `getHeader` had a null check + throw.
**Why it happens:** Inlining the CCC client call without preserving the error path.
**How to avoid:** Always include `if (!result?.header) throw new Error("Header not found")` at each inlined call site.
**Warning signs:** Runtime `Cannot read property 'epoch' of undefined` errors.

### Pitfall 4: headerDeps dedup logic
**What goes wrong:** When replacing `addHeaders`, pushing the same header hash twice to `tx.headerDeps`.
**Why it happens:** `addHeaders` had dedup logic (`if (!this.headerDeps.some((h) => h === hash))`). Inlining without preserving the check.
**How to avoid:** Always include the dedup check before `tx.headerDeps.push(hash)`.
**Warning signs:** Duplicate entries in `headerDeps`, which could cause verification failures on-chain.

### Pitfall 5: TransactionHeader type still needed by DaoCell
**What goes wrong:** Deleting SmartTransaction's `TransactionHeader` interface breaks `DaoCell.headers` and `ReceiptCell.header`.
**Why it happens:** `TransactionHeader` is defined in `transaction.ts` (being deleted) but used by `@ickb/dao` and `@ickb/core`.
**How to avoid:** The `TransactionHeader` interface (`{ header: ccc.ClientBlockHeader, txHash?: ccc.Hex }`) must be moved to a surviving file (e.g., `utils.ts`) or its definition inlined where used. This interface is still needed even after SmartTransaction is gone -- `DaoCell.headers` is a tuple of `[TransactionHeader, TransactionHeader]`.
**Warning signs:** "TransactionHeader is not exported" errors after deleting transaction.ts.

### Pitfall 6: SmartTransaction.getInputsCapacity vs tx.getHeader
**What goes wrong:** SmartTransaction's `getInputsCapacity` override (lines 154-202) uses `this.getHeader()` (the instance method). When SmartTransaction is deleted, this override disappears. But CCC's native `Transaction.getInputsCapacity()` already handles DAO profit differently.
**Why it happens:** The override was written before CCC added native DAO profit calculation.
**How to avoid:** Verify that CCC's native `getInputsCapacity()` handles all cases that SmartTransaction's override did. CCC's version uses `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()` which resolves headers through the client. This is functionally equivalent.
**Warning signs:** Incorrect fee calculation after SmartTransaction removal (would manifest in over/under-paying fees).

### Pitfall 7: IckbUdtManager.getInputsUdtBalance uses tx.getHeader
**What goes wrong:** `IckbUdtManager.getInputsUdtBalance` (core/src/udt.ts lines 108, 125) calls `tx.getHeader()` which is a SmartTransaction instance method. After SmartTransaction is removed, this call doesn't exist on plain `ccc.Transaction`.
**Why it happens:** The method relies on SmartTransaction's header cache + headerDeps validation.
**How to avoid:** Replace `tx.getHeader(client, { type: "txHash", value: outPoint.txHash })` with inlined CCC client calls. The headerDeps validation from the old `getHeader` instance method was a runtime check that headers were pre-populated -- after removal, the client call fetches headers directly.
**Warning signs:** TypeScript error `Property 'getHeader' does not exist on type 'Transaction'`.

### Pitfall 8: ccc-fork pins must be recorded after CCC changes
**What goes wrong:** Making changes to `ccc-fork/ccc/` without running `pnpm fork:record` means the pins don't reflect the new state.
**Why it happens:** `ccc-fork/pins/` contains an integrity check. If ccc code changes but pins don't update, replay won't reproduce the same state.
**How to avoid:** After developing the DAO utility in `ccc-fork/ccc/`, run `pnpm fork:record` to update pins. Check `pnpm fork:status` to verify.
**Warning signs:** `pnpm fork:status` reports exit code 1 (pending work).

## Code Examples

### Complete DAO Check Replacement Pattern
```typescript
// Source: Verified from ccc-fork/ccc/packages/core/src/ckb/transaction.ts
// and packages/dao/src/dao.ts

// Before (scattered in 7 locations):
if (tx.outputs.length > 64) {
  throw new Error("More than 64 output cells in a NervosDAO transaction");
}

// After (calling CCC utility -- requires async context):
await assertDaoOutputLimit(tx, client);

// For sync contexts (where client is not available),
// the check can be done at completeFee time as a safety net.
```

### Method Signature Migration Pattern
```typescript
// Before (dao/src/dao.ts DaoManager.deposit):
deposit(
  tx: SmartTransaction,
  capacities: ccc.FixedPoint[],
  lock: ccc.Script,
): void {
  tx.addCellDeps(this.cellDeps);
  // ...
}

// After:
deposit(
  txLike: ccc.TransactionLike,
  capacities: ccc.FixedPoint[],
  lock: ccc.Script,
): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  tx.addCellDeps(this.cellDeps);
  // ...
  return tx;
}
```

### CapacityManager Replacement in SDK
```typescript
// Before (sdk/src/sdk.ts, line 376):
for await (const c of this.capacity.findCapacities(client, this.bots, opts)) {
  // ...
}

// After (using CCC's native cell finding):
for (const lock of unique(this.bots)) {
  for await (const cell of client.findCellsOnChain(
    {
      script: lock,
      scriptType: "lock",
      filter: {
        scriptLenRange: [0n, 1n],
      },
      scriptSearchMode: "exact",
      withData: true,
    },
    "asc",
    400,
  )) {
    if (cell.cellOutput.type !== undefined || !cell.cellOutput.lock.eq(lock)) {
      continue;
    }
    // ... rest of logic using cell directly
  }
}
```

### CCC Vitest Test Pattern
```typescript
// Source: ccc-fork/ccc/packages/core/src/ckb/transaction.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ccc } from "../index.js";

describe("assertDaoOutputLimit", () => {
  let client: ccc.Client;

  beforeEach(async () => {
    client = new ccc.ClientPublicTestnet();
  });

  it("should not throw when outputs <= 64", async () => {
    const tx = ccc.Transaction.default();
    // Add 64 outputs
    for (let i = 0; i < 64; i++) {
      tx.addOutput({ lock: /* ... */ });
    }
    await expect(assertDaoOutputLimit(tx, client)).resolves.not.toThrow();
  });

  it("should throw ErrorNervosDaoOutputLimit when DAO tx has > 64 outputs", async () => {
    // ... mock setup with DAO cells
    await expect(assertDaoOutputLimit(tx, client)).rejects.toThrow(
      ErrorNervosDaoOutputLimit,
    );
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SmartTransaction extends Transaction | Plain ccc.Transaction + utilities | This phase | All method signatures change to TransactionLike |
| Custom getInputsCapacity override | CCC native getInputsCapacity with DAO profit | CCC core update (PR #260, merged) | Override in SmartTransaction is redundant |
| Custom header cache (Map<string, Header>) | CCC ClientCacheMemory LRU (128 blocks) | CCC core feature | No manual header management needed |
| Scattered DAO output checks | Centralized CCC utility | This phase | Single source of truth for the 64-output limit |
| Custom CapacityManager.findCapacities | CCC client.findCells/findCellsOnChain | CCC core feature | Direct client API is sufficient |

**Deprecated/outdated:**
- `SmartTransaction.getInputsUdtBalance` / `getOutputsUdtBalance`: Use `@ckb-ccc/udt` Udt class methods instead (Phase 4-5)
- `ccc.udtBalanceFrom`: Deprecated, replaced by `@ckb-ccc/udt` (tracked in SMTX-10, Phase 4-5)
- `ccc.ErrorTransactionInsufficientCoin`: Deprecated, replaced by `ErrorUdtInsufficientCoin` from `@ckb-ccc/udt`

## Detailed Inventory

### SmartTransaction Consumer Map (9 files)

| File | Usage | Migration |
|------|-------|-----------|
| `packages/utils/src/transaction.ts` | Class definition | **DELETE** entire file |
| `packages/utils/src/capacity.ts` | `addCapacities(tx: SmartTransaction, ...)` | **DELETE** entire file |
| `packages/utils/src/udt.ts` | `UdtHandler` interface + `UdtManager` methods accept `SmartTransaction` | Update signatures to `ccc.TransactionLike` |
| `packages/dao/src/dao.ts` | `DaoManager.deposit/requestWithdrawal/withdraw(tx: SmartTransaction, ...)` | Update signatures to `ccc.TransactionLike` |
| `packages/core/src/logic.ts` | `LogicManager.deposit/completeDeposit(tx: SmartTransaction, ...)` | Update signatures to `ccc.TransactionLike` |
| `packages/core/src/owned_owner.ts` | `OwnedOwnerManager.requestWithdrawal/withdraw(tx: SmartTransaction, ...)` | Update signatures to `ccc.TransactionLike` |
| `packages/core/src/udt.ts` | `IckbUdtManager.getInputsUdtBalance(client, tx: SmartTransaction)` | Update signature to `ccc.TransactionLike` |
| `packages/order/src/order.ts` | `OrderManager.mint/addMatch/melt(tx: SmartTransaction, ...)` | Update signatures to `ccc.TransactionLike` |
| `packages/sdk/src/sdk.ts` | `IckbSdk.request/collect(tx: SmartTransaction, ...)` | Update signatures to `ccc.TransactionLike` |

### getHeader Call Sites (9 total)

**Standalone function `getHeader()` (5 sites):**

| File | Line | Key Type | Replacement |
|------|------|----------|-------------|
| `packages/dao/src/cells.ts` | 91 | `number` | `client.getHeaderByNumber(mol.Uint64LE.decode(cell.outputData))` |
| `packages/dao/src/cells.ts` | 97 | `txHash` | `(await client.getTransactionWithHeader(txHash))?.header` |
| `packages/dao/src/cells.ts` | 109 | `txHash` | `(await client.getTransactionWithHeader(txHash))?.header` |
| `packages/core/src/cells.ts` | 84 | `txHash` | `(await client.getTransactionWithHeader(txHash))?.header` |
| `packages/sdk/src/sdk.ts` | 388 | `txHash` | `(await client.getTransactionWithHeader(c.cell.outPoint.txHash))?.header` |

**Instance method `tx.getHeader()` (4 sites -- deleted with SmartTransaction):**

| File | Line | Key Type | Replacement |
|------|------|----------|-------------|
| `packages/utils/src/transaction.ts` | 185 | `txHash` | Deleted with SmartTransaction (CCC handles natively) |
| `packages/utils/src/transaction.ts` | 190 | `number` | Deleted with SmartTransaction (CCC handles natively) |
| `packages/core/src/udt.ts` | 108 | `txHash` | `(await client.getTransactionWithHeader(outPoint.txHash))?.header` |
| `packages/core/src/udt.ts` | 125 | `txHash` | `(await client.getTransactionWithHeader(outPoint.txHash))?.header` |

### addHeaders Call Sites (3 sites)

| File | Line | What It Pushes | Replacement |
|------|------|----------------|-------------|
| `packages/dao/src/dao.ts` | 160 | Single `depositHeader` TransactionHeader | Push `depositHeader.header.hash` to `tx.headerDeps` with dedup |
| `packages/dao/src/dao.ts` | 216 | Array of `headers` (from DaoCell) | Push each `header.header.hash` to `tx.headerDeps` with dedup |
| `packages/core/src/logic.ts` | 125 | Array of receipt headers | Push each `r.header.header.hash` to `tx.headerDeps` with dedup |

### 64-Output DAO Check Locations (7 sites)

| File | Line | Context |
|------|------|---------|
| `packages/utils/src/transaction.ts` | 93-95 | SmartTransaction.completeFee (async, has client) |
| `packages/dao/src/dao.ts` | 100-102 | DaoManager.deposit (sync) |
| `packages/dao/src/dao.ts` | 174-176 | DaoManager.requestWithdrawal (sync) |
| `packages/dao/src/dao.ts` | 245-247 | DaoManager.withdraw (sync) |
| `packages/core/src/logic.ts` | 106-108 | LogicManager.deposit (sync) |
| `packages/core/src/owned_owner.ts` | 104-106 | OwnedOwnerManager.requestWithdrawal (sync) |
| `packages/core/src/owned_owner.ts` | 146-148 | OwnedOwnerManager.withdraw (sync) |

**Note on sync vs async:** 6 of 7 check locations are in sync methods. The CCC `assertDaoOutputLimit` is async (needs client for `getKnownScript`). Options: (a) make the caller methods async, (b) pass the DAO script as a parameter so the check can remain sync, or (c) keep a simple sync `outputs.length > 64` check at the sync sites and use the async utility in completeFee. Option (a) is cleanest since these methods do IO-adjacent work.

### addUdtHandlers Call Sites (8 sites)

| File | Line | Preceding addCellDeps? | Safe to just remove? |
|------|------|------------------------|---------------------|
| `packages/core/src/owned_owner.ts` | 88 | Yes (line 87: `tx.addCellDeps(this.cellDeps)`) | Need `tx.addCellDeps(this.udtHandler.cellDeps)` |
| `packages/core/src/owned_owner.ts` | 135 | Yes (line 134: `tx.addCellDeps(this.cellDeps)`) | Need `tx.addCellDeps(this.udtHandler.cellDeps)` |
| `packages/core/src/logic.ts` | 87 | Yes (line 86: `tx.addCellDeps(this.cellDeps)`) | Need `tx.addCellDeps(this.udtHandler.cellDeps)` |
| `packages/core/src/logic.ts` | 123 | Yes (line 122: `tx.addCellDeps(this.cellDeps)`) | Need `tx.addCellDeps(this.udtHandler.cellDeps)` |
| `packages/utils/src/udt.ts` | 282 | Yes (line 281: `tx.addCellDeps(this.cellDeps)`) | Self-registering; replace with `tx.addCellDeps(this.cellDeps)` (already done on line 281) |
| `packages/order/src/order.ts` | 191 | Yes (line 190: `tx.addCellDeps(this.cellDeps)`) | Need `tx.addCellDeps(this.udtHandler.cellDeps)` |
| `packages/order/src/order.ts` | 228 | Yes (line 227: `tx.addCellDeps(this.cellDeps)`) | Need `tx.addCellDeps(this.udtHandler.cellDeps)` |
| `packages/order/src/order.ts` | 516 | Yes (line 515: `tx.addCellDeps(this.cellDeps)`) | Need `tx.addCellDeps(this.udtHandler.cellDeps)` |

**Analysis:** Each `addUdtHandlers` call does two things: (1) registers the handler in `udtHandlers` Map (SmartTransaction-specific, lost), (2) calls `addCellDeps(udtHandler.cellDeps)`. After SmartTransaction removal, replace with `tx.addCellDeps(this.udtHandler.cellDeps)` at each site. The UDT handler registration is only consumed by SmartTransaction's overridden `getInputsUdtBalance`/`getOutputsUdtBalance`/`completeFee` -- which are all being deleted.

### TransactionHeader Type Preservation

`TransactionHeader` (defined in `transaction.ts` line 506-517) is imported by:
- `packages/dao/src/cells.ts` (DaoCell.headers, daoCellFrom)
- `packages/core/src/cells.ts` (ReceiptCell.header, receiptCellFrom)

This interface must be moved to a surviving file before `transaction.ts` is deleted. Candidate: `utils.ts` (it already contains `HeaderKey` which is being removed, so there's precedent for header-related types there). Alternatively, define it inline in each consumer. The interface is simple: `{ header: ccc.ClientBlockHeader, txHash?: ccc.Hex }`.

### CapacityManager Consumer Map (3 files)

| File | Usage | Migration |
|------|-------|-----------|
| `packages/utils/src/capacity.ts` | Class definition | **DELETE** entire file |
| `packages/sdk/src/sdk.ts` | `this.capacity.findCapacities(client, this.bots, opts)` | Inline CCC `client.findCellsOnChain()` with appropriate filters |
| `packages/sdk/src/constants.ts` | `CapacityManager.withAnyData()` constructor + return type | Remove from getConfig return type; remove instantiation |

## Open Questions

1. **Sync DAO check after utility migration**
   - What we know: 6 of 7 scattered checks are in sync methods. The CCC `assertDaoOutputLimit` is async.
   - What's unclear: Should all 6 sync methods become async to call the CCC utility, or should they accept a pre-resolved DAO script?
   - Recommendation: Make the iCKB methods async (they already return void and do other mutations). Alternatively, the methods could accept an optional `client` parameter. The user's CONTEXT.md execution order puts "Replace all scattered DAO checks with CCC utility calls" as step 2, implying all checks become calls to the CCC utility. Making the methods async is the cleanest path.

2. **Return type change: void -> Transaction**
   - What we know: CCC convention returns `ccc.Transaction`. Current methods return `void` (mutating in-place).
   - What's unclear: Changing return types from `void` to `ccc.Transaction` changes the API contract even if callers can ignore the return.
   - Recommendation: Change return types to `ccc.Transaction` per CCC convention. Since these are library methods (not callback interfaces), callers can adapt. The `TransactionLike` input already forces callers to think about the pattern.

3. **DaoCell.headers and TransactionHeader after removal**
   - What we know: `TransactionHeader` is used by DaoCell (dao package) and ReceiptCell (core package). It's defined in transaction.ts (being deleted).
   - What's unclear: Should the type be moved to utils.ts, or should it be relocated to the dao package where it's most used?
   - Recommendation: Move to `utils.ts` since both dao and core import from `@ickb/utils`. The type is simple and doesn't create unwanted coupling.

## Sources

### Primary (HIGH confidence)
- Codebase source files in `/workspaces/stack/packages/` -- all SmartTransaction consumers, getHeader call sites, DAO checks inventoried directly
- CCC source in `/workspaces/stack/ccc-fork/ccc/packages/core/src/` -- Transaction class, TransactionLike type, error patterns, completeFee implementation, getInputsCapacity, test patterns
- `.planning/phases/01-ickb-utils-smarttransaction-removal/01-CONTEXT.md` -- User decisions and constraints
- `.planning/REQUIREMENTS.md` -- Requirement definitions and traceability

### Secondary (MEDIUM confidence)
- CCC's `Cell.isNervosDao()` implementation (line 415-437) -- shows CCC pattern for DAO detection (uses codeHash + hashType, not full Script.eq())
- CCC's vitest configuration and test patterns -- from `vitest.config.mts` and `transaction.test.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- verified directly from codebase and CCC source
- Architecture: HIGH -- all patterns verified from CCC source and existing iCKB code
- Pitfalls: HIGH -- identified from direct code analysis, not speculation
- Inventory: HIGH -- all call sites counted by direct grep, every file read

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable codebase, locked decisions)
