# Phase 3: CCC Udt Integration Decision

**Date:** 2026-02-24
**Status:** Final
**Requirement IDs:** UDT-01, UDT-02, UDT-03
**Based on:** 03-01-INVESTIGATION.md (source code trace), 03-RESEARCH.md (architecture analysis)

---

## Feasibility Assessment (UDT-01)

**Can `IckbUdt extends udt.Udt` override `infoFrom()` to account for receipt cells and deposit cells alongside xUDT cells?**

**Answer: YES -- feasible with no upstream CCC changes required.**

### Override Point Selection

**Selected: `infoFrom`** (not `getInputsInfo`/`getOutputsInfo`)

Rationale:
- `infoFrom` operates at the per-cell level (`forks/ccc/packages/udt/src/udt/index.ts:624-641`), providing fine-grained control over how each cell contributes to balance
- `getInputsInfo`/`getOutputsInfo` contain input resolution logic (`input.getCell(client)`) and output iteration (`tx.outputCells`) that would need to be duplicated if overridden
- `infoFrom` receives a `client: ccc.Client` parameter (unused in base implementation) that the override needs for header fetches
- `infoFrom` is async, allowing network calls within the override
- A single `infoFrom` override handles both inputs and outputs uniformly -- input/output distinction is via `outPoint` presence

### Three Cell Types in infoFrom

**1. xUDT cells (standard UDT balance)**

- **Identification:** `this.isUdt(cell)` -- checks `cell.cellOutput.type?.eq(this.script)` with full `Script.eq()` (codeHash + hashType + args) and `outputData.length >= 16` bytes (`forks/ccc/packages/udt/src/udt/index.ts:1063-1069`)
- **Balance:** `udt.Udt.balanceFromUnsafe(cell.outputData)` -- reads first 16 bytes as 128-bit LE integer (`index.ts:590-593`). Replaces the manual `ccc.numFromBytes(ccc.bytesFrom(outputData).slice(0, 16))` pattern in current `IckbUdtManager`
- **Applies to:** Both input and output cells
- **Sign:** Positive

**2. Receipt cells (pending conversion receipts)**

- **Identification:** `cell.cellOutput.type?.eq(this.logicScript)` -- the iCKB Logic type script identifies receipt cells by type
- **Balance:** `ReceiptData.decode(cell.outputData)` extracts `depositQuantity` and `depositAmount`, then `ickbValue(depositAmount, header) * depositQuantity` computes the iCKB value using the DAO accumulate rate from the block header
- **Applies to:** Input cells only (output receipt cells are newly created receipts from `LogicManager.deposit`, not value carriers)
- **Sign:** Positive -- receipts consumed as inputs contribute iCKB value

**3. Deposit cells (DAO deposits locked under iCKB Logic)**

- **Identification:** Two checks: `cell.cellOutput.lock.eq(this.logicScript)` (lock script matches iCKB Logic) AND `this.daoManager.isDeposit(fullCell)` (DAO deposit data pattern). `isDeposit` requires `ccc.Cell` not `CellAny` (see capacityFree resolution below)
- **Balance:** `ickbValue(cell.capacityFree, header)` -- uses unoccupied capacity (not total capacity) with the DAO accumulate rate
- **Applies to:** Input cells only (output deposit cells have DAO type script, not iCKB xUDT type script)
- **Sign:** NEGATIVE -- deposits consumed as inputs subtract from iCKB balance per the conservation law: `Input UDT + Input Receipts = Output UDT + Input Deposits`, rearranged as `Input UDT + Input Receipts - Input Deposits = Output UDT`

### Input vs Output Distinction

The `outPoint` property on cells cleanly separates input cells from output cells within `infoFrom`:

| Source | Type | outPoint |
|--------|------|----------|
| `getInputsInfo` -> `input.getCell(client)` | `Cell` | Always `OutPoint` (from `CellInput.previousOutput`) |
| `getOutputsInfo` -> `tx.outputCells` | `CellAny` | Always `undefined` (no outPoint passed) |
| `completeInputs` accumulator (new cells found) | `Cell` | Always `OutPoint` |

This is structural, not accidental: `Cell` (which extends `CellAny`) requires `outPoint` in its constructor (`transaction.ts:498`), while `tx.outputCells` yields `CellAny.from({ cellOutput, outputData })` without outPoint (`transaction.ts:1715-1728`).

The override gates receipt/deposit logic behind `if (!cell.outPoint) continue` -- output cells skip straight to the `isUdt` check for standard xUDT balance.

### capacityFree Resolution

`CellAny` has a `capacityFree` getter (`transaction.ts:404-405`):

```typescript
get capacityFree() {
  return this.cellOutput.capacity - fixedPointFrom(this.occupiedSize);
}
```

No `Cell` construction is needed for the `ickbValue(cell.capacityFree, header)` computation on deposit cells.

However, `DaoManager.isDeposit()` (`packages/dao/src/dao.ts:30`) requires `ccc.Cell` (not `CellAny`). Since deposit cells are only relevant as inputs (where `outPoint` is always present), constructing `Cell.from({ outPoint: cell.outPoint!, cellOutput: cell.cellOutput, outputData: cell.outputData })` is safe. The non-null assertion on `outPoint` is valid because deposit detection is gated behind the `if (!cell.outPoint) continue` check.

### Completion Pipeline Compatibility

`completeInputsByBalance` chains through `infoFrom` correctly:

1. `completeInputsByBalance(tx, signer)` calls `getInputsInfo` and `getOutputsInfo` to compute balance deficit
2. Both delegate to `infoFrom` -- the override automatically participates
3. The accumulator in `completeInputs` calls `infoFrom` per new cell found during completion
4. New cells found during completion are `Cell` objects (with `outPoint`), so receipt/deposit logic applies

**Filter limitation:** `Udt.filter` only matches xUDT cells (by type script + data length >= 16). `completeInputsByBalance` will only find xUDT cells on-chain, not receipt or deposit cells. This is correct by design:

- Receipt/deposit cell discovery is a separate concern handled by `LogicManager.completeDeposit()` and `OwnedOwnerManager.requestWithdrawal()`
- Callers pre-add receipt/deposit cells to the transaction
- `infoFrom` then accurately values all cells present in the transaction
- `completeInputsByBalance` accounts for the value of pre-added receipt/deposit inputs when calculating how many additional xUDT inputs are needed

### Blockers

**No blockers identified.** All override points are public methods with appropriate signatures. No upstream CCC changes are required for core feasibility.

---

## Header Access Pattern (UDT-02)

### API

`client.getTransactionWithHeader(outPoint.txHash)` -- confirmed from investigation (`client.ts:631-661`).

Returns `{ transaction: ClientTransactionResponse, header?: ClientBlockHeader } | undefined` where `header` contains the `dao` field with `ar` (accumulate rate) needed for `ickbValue()`.

`getCellWithHeader()` is a convenience wrapper that calls `getTransactionWithHeader()` internally -- either works, but `getTransactionWithHeader` is more direct when the txHash is already available from `cell.outPoint.txHash`.

### When

Only for input cells with `outPoint` -- specifically receipt cells and deposit cells. Standard xUDT cells do not need header access.

### What

The header provides the DAO accumulate rate (`header.dao.ar`) used by `ickbValue()` to compute the exchange rate between CKB capacity and iCKB UDT value:
- Receipt cells: `ickbValue(depositAmount, header) * depositQuantity`
- Deposit cells: `ickbValue(cell.capacityFree, header)`

### Caching

CCC's `Client.cache` handles repeated calls transparently:
- First call for a txHash: network fetch + `cache.recordTransactionResponses()` stores result
- Subsequent calls: `cache.getTransactionResponse(txHash)` returns cached response + `cache.hasHeaderConfirmed(header)` confirms header validity
- Multiple cells from the same transaction share one cached header fetch

No application-level caching is needed.

### Async Flow

`infoFrom` is declared `async` in the base class (`Promise<UdtInfo>` return type). The override uses `await client.getTransactionWithHeader(...)` for receipt and deposit cells. This integrates naturally -- no async wrapper or callback indirection needed.

### Performance

- Receipt and deposit cells are typically few per transaction (1-5 in practice)
- Header fetches are small payloads
- CCC caching ensures each unique txHash is fetched at most once per session
- The completion loop in `completeInputsByBalance` re-calls `infoFrom` for each iteration, but the cache prevents redundant network requests

### Code Sketch

```typescript
import * as ccc from "@ckb-ccc/core";
import * as udt from "@ckb-ccc/udt";
import type { DaoManager } from "@ickb/dao";
import { ReceiptData, ickbValue } from "./existing-imports.js";

class IckbUdt extends udt.Udt {
  constructor(
    code: ccc.OutPointLike,
    script: ccc.ScriptLike,
    public readonly logicScript: ccc.Script,
    public readonly daoManager: DaoManager,
    config?: udt.UdtConfigLike | null,
  ) {
    super(code, script, config);
  }

  override async infoFrom(
    client: ccc.Client,
    cells: ccc.CellAnyLike | ccc.CellAnyLike[],
    acc?: udt.UdtInfoLike,
  ): Promise<udt.UdtInfo> {
    const info = udt.UdtInfo.from(acc).clone();

    for (const cellLike of [cells].flat()) {
      const cell = ccc.CellAny.from(cellLike);
      const { type, lock } = cell.cellOutput;

      // Standard xUDT cell -- applies to both inputs and outputs
      if (this.isUdt(cell)) {
        info.addAssign({
          balance: udt.Udt.balanceFromUnsafe(cell.outputData),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Receipt and deposit cells are only relevant as inputs (with outPoint)
      if (!cell.outPoint) {
        continue;
      }

      // Receipt cell: type === logicScript
      if (type?.eq(this.logicScript)) {
        const txWithHeader = await client.getTransactionWithHeader(
          cell.outPoint.txHash,
        );
        if (!txWithHeader?.header) {
          throw new Error("Header not found for receipt cell");
        }
        const { depositQuantity, depositAmount } =
          ReceiptData.decode(cell.outputData);
        info.addAssign({
          balance:
            ickbValue(depositAmount, txWithHeader.header) * depositQuantity,
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Deposit cell: lock === logicScript && isDeposit
      if (lock.eq(this.logicScript)) {
        // Construct Cell for isDeposit() which requires ccc.Cell, not CellAny
        const fullCell = ccc.Cell.from({
          outPoint: cell.outPoint,
          cellOutput: cell.cellOutput,
          outputData: cell.outputData,
        });
        if (!this.daoManager.isDeposit(fullCell)) {
          continue;
        }
        const txWithHeader = await client.getTransactionWithHeader(
          cell.outPoint.txHash,
        );
        if (!txWithHeader?.header) {
          throw new Error("Header not found for deposit cell");
        }
        // Deposits SUBTRACT from iCKB balance (conservation law)
        info.addAssign({
          balance: -ickbValue(cell.capacityFree, txWithHeader.header),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }
    }

    return info;
  }
}
```

This code sketch is derived from:
- The base `infoFrom` implementation (`forks/ccc/packages/udt/src/udt/index.ts:624-641`)
- The current `IckbUdtManager.getInputsUdtBalance()` logic (`packages/core/src/udt.ts:66-141`)
- The line-by-line migration mapping from `03-01-INVESTIGATION.md`

---

## Decision (UDT-03)

### Chosen: (a) Subclass CCC Udt

**`IckbUdt extends udt.Udt`** with `infoFrom` override is the chosen approach.

### Rationale

1. **Feasibility confirmed:** The investigation (03-01-INVESTIGATION.md) traced every CCC Udt method chain end-to-end and confirmed that `infoFrom` is a clean, sufficient override point. No upstream CCC changes are required.

2. **CCC alignment is the primary driver:** Per CONTEXT.md, iCKB should feel native to CCC users and benefit from upstream improvements. Subclassing `udt.Udt` achieves this -- `IckbUdt` is a first-class CCC UDT that participates in all CCC completion and querying pipelines.

3. **The override is minimal and clean:** A single method override (`infoFrom`) teaches CCC how to value iCKB's three cell types. No other overrides are needed -- `getInputsInfo`, `getOutputsInfo`, `completeInputsByBalance`, `completeInputs`, `filter` all work as inherited.

4. **No dealbreakers:** The identified risks (filter mismatch, DaoManager.isDeposit type requirement, async performance) all have clean mitigations (see Risks section). No invasive upstream CCC changes are needed.

### What It Replaces

| Current | Replacement | Package |
|---------|-------------|---------|
| `UdtHandler` interface | Deleted -- replaced by `udt.Udt` instance | `@ickb/utils` |
| `UdtManager` class | Deleted -- replaced by `udt.Udt` base class | `@ickb/utils` |
| `IckbUdtManager` class | `IckbUdt extends udt.Udt` | `@ickb/core` |
| `DaoManager` constructor `udtHandler` param | `DaoManager` receives `udt.Udt` instance | `@ickb/dao` |
| `OrderManager` constructor `udtHandler` param | `OrderManager` receives `udt.Udt` instance | `@ickb/order` |
| `tx.getInputsUdtBalance()` (deprecated) | `ickbUdt.getInputsInfo(client, tx)` | All packages |
| `tx.getOutputsUdtBalance()` (deprecated) | `ickbUdt.getOutputsInfo(client, tx)` | All packages |
| `tx.completeInputsByUdt()` (deprecated) | `ickbUdt.completeInputsByBalance(tx, signer)` | All packages |
| `ccc.udtBalanceFrom()` (deprecated) | `udt.Udt.balanceFromUnsafe(outputData)` | All packages |

### What CCC Features It Gains

- **`completeInputsByBalance`:** Dual-constraint (balance + capacity) completion with automatic error reporting via `ErrorUdtInsufficientCoin`
- **`UdtInfo` accumulator:** Structured balance + capacity + count tracking via `addAssign`, replacing ad-hoc `[bigint, bigint]` tuples
- **CCC completion pipeline integration:** `IckbUdt` participates in `Transaction.completeBy()` chains alongside other CCC completers
- **Future upstream improvements:** Any improvements to CCC's Udt class (better completion algorithms, new query methods, SSRI integration) automatically apply to `IckbUdt`
- **`getBalanceBurned`:** Inherited method for conservation law verification (inputs - outputs)

### What It Loses or Changes

- **`name`, `symbol`, `decimals` as constructor args:** Current `UdtManager` stores these as direct properties. CCC's `Udt` accesses them via SSRI protocol methods (`udt.name()`, `udt.symbol()`, `udt.decimals()`). If direct properties are needed, they can be added as custom fields on `IckbUdt`
- **`cellDeps` array:** Current `UdtHandler.cellDeps` is an explicit `CellDep[]` array. CCC's `Udt` uses `code: OutPoint` which is resolved to cell deps differently. The `Trait.addCellDeps(tx)` method handles this
- **`getInputsUdtBalance` return type:** Changes from `[FixedPoint, FixedPoint]` to `UdtInfo` (which contains `balance`, `capacity`, `count`). Callers must destructure differently
- **Output balance method:** `getOutputsUdtBalance` is replaced by `getOutputsInfo`. Same semantics but returns `UdtInfo` instead of `[FixedPoint, FixedPoint]`

---

## Conservation Law Strategy

### The Conservation Law

`Input UDT + Input Receipts = Output UDT + Input Deposits`

This is enforced on-chain by the iCKB Logic type script. If a transaction violates it, on-chain validation rejects the transaction. There is no risk of funds loss -- only risk of building invalid transactions that fail at submission.

### How infoFrom Preserves It

`infoFrom` reports accurate balances with correct sign conventions:

- **xUDT cells:** Positive balance (both input and output)
- **Receipt cells (input only):** Positive balance -- represents iCKB value the user is redeeming
- **Deposit cells (input only):** NEGATIVE balance -- represents iCKB value the user is providing as CKB deposits

This means:
- `getInputsInfo` returns: `xUDT balance + receipt value - deposit value`
- `getOutputsInfo` returns: `xUDT balance` (only standard xUDT outputs carry iCKB value)
- `getBalanceBurned` (inherited) = `getInputsInfo.balance - getOutputsInfo.balance`

When the conservation law holds, `getBalanceBurned` returns zero (or the intended burn amount).

### Enforcement Location

- **On-chain (existing):** iCKB Logic script validates the conservation law during CKB transaction verification. This is the authoritative enforcement point and cannot be circumvented.
- **Build-time (future, optional):** A validation method (e.g., `assertConservationLaw(client, tx)`) can be added to `IckbUdt` as a convenience for callers who want early rejection of invalid transactions. This is separate from `infoFrom`.

### Recommendation

Per CONTEXT.md: start with accurate balance reporting (caller responsibility). The `infoFrom` override performs balance calculation, not validation. Conservation law enforcement is NOT embedded in `infoFrom` because:

1. It would conflate calculation with validation
2. It would break the `completeInputsByBalance` loop, which processes partially-constructed transactions that may not yet satisfy the conservation law
3. The on-chain script is the authoritative enforcer -- build-time validation is a convenience, not a requirement

Build-time validation can be added later as a separate method if needed. The accurate balance reporting from `infoFrom` provides all the data callers need to verify the conservation law themselves.

---

## Cell Discovery vs Balance Calculation Boundary

### infoFrom Responsibility: VALUE Cells

`infoFrom` receives cells that are already in the transaction and computes their iCKB value. It does not search for cells on-chain. It does not add cells to the transaction.

Specifically:
- Cells arrive via `getInputsInfo` (resolved from `tx.inputs`) or `getOutputsInfo` (from `tx.outputCells`)
- `infoFrom` computes `UdtInfo` (balance + capacity + count) for these cells
- The accumulator in `completeInputsByBalance` also feeds cells through `infoFrom` as they are found

### Caller Responsibility: FIND and ADD Cells

Receipt and deposit cell discovery is handled by existing manager classes:

| Cell Type | Discovery Mechanism | Who Calls It |
|-----------|---------------------|--------------|
| xUDT cells | `completeInputsByBalance` via `Udt.filter` | Automatic (CCC completion pipeline) |
| Receipt cells | `LogicManager.completeDeposit()` | Caller (SDK, application code) |
| Deposit cells | `OwnedOwnerManager.requestWithdrawal()`, `LogicManager` | Caller (SDK, application code) |

### Why No filter Override

`Udt.filter` is a `ClientIndexerSearchKeyFilter` that only matches xUDT cells (by type script + minimum data length). Receipt and deposit cells have different type scripts and lock scripts -- they cannot be matched by a single filter.

This is correct by design:
- CCC's `completeInputs` uses a single filter for cell search
- Multi-filter search would require overriding `completeInputsByBalance` and reimplementing dual-constraint optimization
- Receipt/deposit cell discovery involves domain-specific logic (deposit maturity, receipt validity) that belongs in `LogicManager`/`OwnedOwnerManager`, not in `IckbUdt`

The correct pattern is:
1. Caller adds receipt/deposit cells to the transaction (via LogicManager/OwnedOwnerManager)
2. `infoFrom` accurately values all cells in the transaction (including pre-added receipt/deposit cells)
3. `completeInputsByBalance` determines remaining xUDT deficit and finds additional xUDT cells if needed

---

## Implementation Guidance for Phases 4-5

### Phase 4: dao and order Packages (Deprecated API Replacement)

Replace deprecated CCC API calls with `udt.Udt` instance methods:

| Deprecated API | Replacement | Notes |
|----------------|-------------|-------|
| `ccc.udtBalanceFrom(outputData)` | `udt.Udt.balanceFromUnsafe(outputData)` | Static method on Udt class |
| `tx.getInputsUdtBalance(client)` | `ickbUdt.getInputsInfo(client, tx)` | Returns `UdtInfo` not `[FixedPoint, FixedPoint]` |
| `tx.getOutputsUdtBalance(client)` | `ickbUdt.getOutputsInfo(client, tx)` | Returns `UdtInfo` not `[FixedPoint, FixedPoint]` |
| `tx.completeInputsByUdt(signer, handler)` | `ickbUdt.completeInputsByBalance(tx, signer)` | On Udt instance, not Transaction |

Manager constructor changes:
- `DaoManager` and `OrderManager` receive a `udt.Udt` instance instead of `UdtHandler`
- The `UdtHandler.cellDeps` pattern is replaced by `udt.addCellDeps(tx)` (inherited from `ssri.Trait`)
- Balance queries use the Udt instance: `this.udt.getInputsInfo(client, tx)` instead of `this.udtHandler.getInputsUdtBalance(client, tx)`

### Phase 5: core Package (IckbUdt Implementation)

**Create `IckbUdt extends udt.Udt`** in `packages/core/src/udt.ts`:

```
Constructor parameters:
  - code: ccc.OutPointLike    -- OutPoint for xUDT cell dep
  - script: ccc.ScriptLike    -- xUDT type script
  - logicScript: ccc.Script   -- iCKB Logic type script
  - daoManager: DaoManager    -- for isDeposit() checks
  - config?: udt.UdtConfigLike | null  -- optional UDT config

Override:
  - infoFrom(client, cells, acc?) -- three-cell-type valuation logic
    (see Code Sketch in Header Access Pattern section above)
```

**Delete from `packages/core/src/udt.ts`:**
- `IckbUdtManager` class (replaced by `IckbUdt`)
- `getInputsUdtBalance()` override (logic moves to `infoFrom`)
- `getOutputsUdtBalance()` override (base `getOutputsInfo` via `infoFrom` handles this)

**Delete from `packages/utils/src/udt.ts`:**
- `UdtHandler` interface (replaced by `udt.Udt` type)
- `UdtManager` class (replaced by `udt.Udt` base class)

**Preserve (do not delete):**
- `ickbValue()` function (`packages/core/src/udt.ts`) -- used within `infoFrom` override and by SDK estimate scenarios
- `convert()` function (`packages/core/src/udt.ts`) -- used by SDK for CKB-to-iCKB conversion
- `ickbExchangeRatio()` function (`packages/core/src/udt.ts`) -- used by SDK estimate scenarios with pre-computed ExchangeRatio from tip header
- `ExchangeRatio` type, `ValueComponents` type -- shared types used across packages
- `ReceiptData` codec -- used within `infoFrom` override for receipt cell decoding

**Update SDK (`packages/sdk/src/sdk.ts`):**
- Construct `IckbUdt` instance instead of `IckbUdtManager`
- Pass `IckbUdt` instance to managers that need UDT operations
- Update balance queries from `[FixedPoint, FixedPoint]` tuple to `UdtInfo` destructuring

---

## Upstream CCC Changes

**No upstream changes required for core feasibility.**

The CCC `udt.Udt` class API surface is sufficient for `IckbUdt` subclassing without modification:
- `infoFrom` is a public async method with the right signature
- `isUdt` is a public method for cell type checking
- `balanceFromUnsafe` is a public static method for balance extraction
- `UdtInfo` supports negative balance values via bigint addition
- `Client` provides `getTransactionWithHeader` for header access
- `CellAny` provides `capacityFree` for unoccupied capacity

**Potential future upstream contributions (non-blocking):**

If the "composite UDT" pattern (UDT value distributed across multiple cell types) proves useful to other CKB tokens, a generic version could be proposed upstream. This would be a new base class or mixin, not a modification to existing `Udt`. This is not required for iCKB and should only be pursued if clear demand exists from other projects.

**PR #328 (FeePayer) compatibility:** The `infoFrom` override is compatible with both current and FeePayer architectures. The override operates below the completion routing layer -- whether cells arrive via `Signer.completeInputs` or `FeePayer.completeInputs`, they flow through `getInputsInfo` -> `infoFrom`. No special handling needed for the FeePayer transition.

---

## Risks and Mitigations

### 1. Filter Mismatch for Receipt/Deposit Cell Discovery

**Risk:** `completeInputsByBalance` only finds xUDT cells via `Udt.filter`. If callers forget to pre-add receipt/deposit cells, balance calculation will be incomplete.

**Mitigation:** Caller-responsibility pattern. Document clearly that receipt/deposit cells must be added by `LogicManager`/`OwnedOwnerManager` before calling `completeInputsByBalance`. The SDK already follows this pattern -- `LogicManager.completeDeposit()` and `OwnedOwnerManager.requestWithdrawal()` add these cells. No behavioral change from current implementation.

### 2. DaoManager.isDeposit() Requires Cell, Not CellAny

**Risk:** Type mismatch when calling `isDeposit` from within `infoFrom`, which receives `CellAnyLike`.

**Mitigation:** Construct `Cell.from({ outPoint: cell.outPoint!, cellOutput: cell.cellOutput, outputData: cell.outputData })` when `outPoint` is present. This is safe because deposit cells are only relevant as inputs (which always have `outPoint`). The `capacityFree` computation itself uses `CellAny.capacityFree` directly -- only `isDeposit` needs the `Cell` construction.

### 3. Completion Loop Performance with Header Fetches

**Risk:** `infoFrom` makes network calls (header fetches) inside the `completeInputsByBalance` loop. If re-called repeatedly, this could be slow.

**Mitigation:** CCC `Client.cache` ensures each txHash is fetched at most once per session. Receipt/deposit cells are typically few per transaction (1-5). Multiple cells from the same transaction share one cached header fetch. The base `infoFrom` was already async -- the override does not change the method's contractual behavior, only adds actual async work.

### 4. UdtInfo.balance Negative Values

**Risk:** Deposit cells contribute negative balance. If code assumes `UdtInfo.balance >= 0`, it could produce incorrect results.

**Mitigation:** `UdtInfo.balance` is `ccc.Num` (bigint), which supports negative values. The `completeInputsByBalance` method already checks `info.balance >= ccc.Zero` as its termination condition, correctly handling negative balance contributions. The `addAssign` method does `this.balance += info.balance` which works with negative values. No special handling needed.

### 5. Output Receipt/Deposit Cell Misidentification

**Risk:** Output cells that happen to have logic script as type or lock could be misidentified as iCKB value carriers.

**Mitigation:** The `if (!cell.outPoint) continue` gate prevents any receipt/deposit logic from applying to output cells. Only input cells (with `outPoint`) are evaluated for receipt/deposit value. This is both correct and defensive.

### 6. Breaking Change in Return Types

**Risk:** Callers currently expect `[FixedPoint, FixedPoint]` from `getInputsUdtBalance`/`getOutputsUdtBalance`. The new `getInputsInfo`/`getOutputsInfo` return `UdtInfo`.

**Mitigation:** This is an intentional API change that occurs during Phases 4-5. The migration is straightforward: `const [balance, capacity] = await udtHandler.getInputsUdtBalance(...)` becomes `const { balance, capacity } = await ickbUdt.getInputsInfo(...)`. The `count` field in `UdtInfo` is new and additive.
