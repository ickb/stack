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
- `infoFrom` operates at the per-cell level (`ccc-dev/ccc/packages/udt/src/udt/index.ts:624-641`), providing fine-grained control over how each cell contributes to balance
- `getInputsInfo`/`getOutputsInfo` contain input resolution logic (`input.getCell(client)`) and output iteration (`tx.outputCells`) that would need to be duplicated if overridden
- `infoFrom` receives a `client: ccc.Client` parameter (unused in base implementation) that the override needs for header fetches
- `infoFrom` is async, allowing network calls within the override
- A single `infoFrom` override handles both inputs and outputs uniformly -- input/output distinction is via `outPoint` presence

### Three Cell Types in infoFrom

**1. xUDT cells (standard UDT balance)**

- **Identification:** `this.isUdt(cell)` -- checks `cell.cellOutput.type?.eq(this.script)` with full `Script.eq()` (codeHash + hashType + args) and `outputData.length >= 16` bytes (`ccc-dev/ccc/packages/udt/src/udt/index.ts:1063-1069`)
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
- The base `infoFrom` implementation (`ccc-dev/ccc/packages/udt/src/udt/index.ts:624-641`)
- The current `IckbUdtManager.getInputsUdtBalance()` logic (`packages/core/src/udt.ts:66-141`)
- The line-by-line migration mapping from `03-01-INVESTIGATION.md`
