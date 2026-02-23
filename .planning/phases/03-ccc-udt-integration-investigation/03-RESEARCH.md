# Phase 3: CCC Udt Integration Investigation - Research

**Researched:** 2026-02-23
**Domain:** CCC UDT subclassing, composite UDT patterns, async header access
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- CCC alignment is the primary driver -- iCKB should feel native to CCC users and benefit from upstream improvements
- Upstream CCC PRs are explicitly on the table if CCC's Udt class needs small, targeted changes to accommodate iCKB's multi-representation value
- No concern about CCC upgrade risk -- if we contribute to CCC's Udt, we co-own the design
- PR #328 (FeePayer abstraction by ashuralyk) is the target architecture -- investigation should design around it and identify improvements that would better fit iCKB's needs. Branch cloned to `reference/ccc-fee-payer/`
- Investigation should cover both cell discovery and balance calculation, not just balance
- Design upstream: if CCC Udt changes are needed, design them generically as a "composite UDT" pattern that benefits other CKB tokens beyond iCKB
- Leaning toward `IckbUdt extends udt.Udt` -- iCKB is fundamentally a UDT, just with extra cell types carrying value
- Two viable override points identified: `getInputsInfo/getOutputsInfo` and `infoFrom`
- `infoFrom` can distinguish between input and output cells by checking outpoint presence (inputs have outpoints, outputs don't)
- Dealbreaker for subclass: if upstream CCC changes needed are too invasive (large, likely-to-be-rejected PRs)
- If subclassing doesn't work, reevaluate WHY it fails and determine what CCC Udt changes would fix it -- don't fall back to custom without first trying the upstream path
- Standard xUDT token completion must integrate seamlessly (already supported by CCC)
- Accounting for iCKB-specific cells (receipts, deposits) that carry UDT value must also integrate seamlessly into CCC's completion pipeline
- Auto-fetching and auto-adding of receipt/withdrawal-request cells: to be determined -- investigate how this fits within PR #328's FeePayer framework (`completeInputs()` with accumulator pattern)
- On-chain iCKB Logic script already enforces `Input UDT + Input Receipts = Output UDT + Input Deposits` at validation time
- Investigation should explore both: (a) IckbUdt subclass enforcing at tx-building time (prevents invalid tx construction), and (b) caller responsibility (IckbUdt only reports accurate balances)
- No risk of funds loss either way -- just risk of building invalid transactions that fail on-chain
- Settled: `client.getTransactionWithHeader(outPoint.txHash)` for per-cell header fetching
- CCC is async-native -- no concern about async header fetches inside Udt overrides
- Receipt cells store `depositQuantity` and `depositAmount` (not block numbers) -- header provides the DAO AR field for exchange rate computation via `ickbValue()`
- Both receipt and deposit cell value calculation need per-cell headers
- Estimate scenarios (SDK.estimate) use pre-computed `ExchangeRatio` from tip header -- this is separate from Udt's per-cell balance methods

### Claude's Discretion
- Technical investigation methodology (which CCC Udt internals to trace first)
- Decision document format and depth of analysis
- Prototype code scope (if any)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UDT-01 | Feasibility assessment: can `IckbUdt extends udt.Udt` override `infoFrom()` or `getInputsInfo()`/`getOutputsInfo()` to account for receipt cells and deposit cells alongside xUDT cells | CCC Udt class traced end-to-end; override points mapped; `infoFrom` identified as optimal override; async compatibility confirmed |
| UDT-02 | Header access pattern for receipt value calculation designed -- determine whether `client.getCellWithHeader()`, `client.getTransactionWithHeader()`, or direct CCC client calls are used within the Udt override | `client.getTransactionWithHeader(outPoint.txHash)` confirmed as correct API; `getCellWithHeader` wraps same; header access within async `infoFrom` confirmed viable |
| UDT-03 | Decision documented: subclass CCC `Udt` vs. keep custom `UdtHandler` interface vs. hybrid approach | Full analysis of all three approaches with clear recommendation for subclass approach |
</phase_requirements>

## Summary

This research investigates whether iCKB's multi-representation UDT value (xUDT cells + receipt cells + deposit cells) can be modeled as a subclass of CCC's `udt.Udt` class. The investigation traces CCC's Udt class internals, the current iCKB `IckbUdtManager` implementation, and PR #328's FeePayer architecture.

**The subclass approach is feasible.** CCC's `udt.Udt` class provides a clean override point via `infoFrom()` that accepts `CellAnyLike | CellAnyLike[]` and a `ccc.Client` parameter. The method is async, allowing header fetches within the override. Input cells passed through `getInputsInfo()` carry `outPoint` (resolved via `CellInput.getCell(client)`), while output cells from `tx.outputCells` do not -- this outPoint presence/absence is the reliable mechanism for distinguishing input vs output cells within `infoFrom()`, which is necessary because receipt and deposit cells only carry iCKB value as inputs (not outputs). The `completeInputsByBalance` method chains through `infoFrom` cleanly, so the override will automatically participate in CCC's completion pipeline.

**The header access pattern is straightforward.** Receipt and deposit cell value calculation requires the block header of the transaction that created the cell. This is obtained via `client.getTransactionWithHeader(outPoint.txHash)`, which is already used in the current `IckbUdtManager.getInputsUdtBalance()`. Since `infoFrom()` only needs headers for input cells (which have outPoints), and since the method receives a `client` parameter and is async, the pattern integrates naturally.

**Primary recommendation:** Subclass CCC's `udt.Udt` with `IckbUdt extends udt.Udt`, overriding `infoFrom()` to recognize receipt cells and deposit cells alongside xUDT cells. No upstream CCC changes are required for the core feasibility. PR #328's FeePayer pattern is compatible but orthogonal -- iCKB's `completeInputs` can work with either the current Signer-based approach or future FeePayer-based approach.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ckb-ccc/udt` | workspace (local CCC fork) | Base `Udt` class for subclassing | CCC's official UDT abstraction; `infoFrom` override point |
| `@ckb-ccc/core` | workspace (local CCC fork) | `Transaction`, `Client`, `CellAny`, `CellInput`, `Cell` types | CCC core primitives |
| `@ckb-ccc/ssri` | workspace (local CCC fork) | `ssri.Trait` base class (parent of `Udt`) | SSRI protocol support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ickb/dao` | workspace | `DaoManager.isDeposit()` for deposit cell identification | Within `infoFrom` override for deposit cells |
| `@ickb/utils` | workspace | `ExchangeRatio`, `ValueComponents`, `ScriptDeps` types | Type definitions shared across packages |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `infoFrom` override | `getInputsInfo`/`getOutputsInfo` override | `infoFrom` is more granular (per-cell); `getInputsInfo`/`getOutputsInfo` override would duplicate iteration logic already in base class |
| Subclass `udt.Udt` | Keep `UdtHandler` interface | Custom interface doesn't participate in CCC completion pipeline, loses `completeInputsByBalance`/`completeBy`/etc |

## Architecture Patterns

### Pattern 1: `infoFrom` Override for Multi-Representation UDT

**What:** Override `infoFrom()` in `IckbUdt extends udt.Udt` to recognize three cell types (xUDT, receipt, deposit) and accumulate their iCKB value.

**When to use:** When a UDT's value is distributed across multiple cell types beyond standard xUDT cells.

**Key insight:** `infoFrom()` receives `CellAnyLike` objects. Input cells (from `getInputsInfo -> CellInput.getCell()`) have `outPoint` set; output cells (from `getOutputsInfo -> tx.outputCells`) do not. This allows `infoFrom` to:
- For cells with outPoint (inputs): check receipt cells, deposit cells, AND xUDT cells
- For cells without outPoint (outputs): only count standard xUDT cells (receipt/deposit outputs don't carry iCKB value in the same way)

**Example (conceptual):**
```typescript
// Source: Synthesized from CCC Udt source + iCKB IckbUdtManager source
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

      // Standard xUDT cell -- delegate to base class logic
      if (this.isUdt(cell)) {
        info.addAssign({
          balance: udt.Udt.balanceFromUnsafe(cell.outputData),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Only input cells (with outPoint) can be receipt/deposit cells
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
          balance: ickbValue(depositAmount, txWithHeader.header) * depositQuantity,
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Deposit cell: lock === logicScript && isDeposit
      if (lock.eq(this.logicScript)) {
        // Construct Cell for isDeposit() which requires ccc.Cell, not CellAny
        const fullCell = ccc.Cell.from({ outPoint: cell.outPoint, cellOutput: cell.cellOutput, outputData: cell.outputData });
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

### Pattern 2: Header Access via outPoint.txHash

**What:** For each receipt or deposit input cell, fetch the block header via `client.getTransactionWithHeader(outPoint.txHash)`, then extract the DAO AR field for exchange rate computation.

**When to use:** Whenever per-cell iCKB value calculation is needed (not estimate scenarios that use pre-computed ExchangeRatio from tip header).

**Key details:**
- `client.getTransactionWithHeader()` returns `{ transaction, header? }` where `header` is a `ClientBlockHeader` containing the `dao` field with `ar` (accumulate rate)
- CCC's `Client.cache` transparently caches transaction responses and headers, so repeated calls for the same txHash are cheap
- The method is async, which is compatible with `infoFrom`'s async signature
- `getCellWithHeader()` is a convenience wrapper that calls `getTransactionWithHeader()` internally -- either can be used, but `getTransactionWithHeader` is more direct when you already have the txHash

### Pattern 3: CCC Completion Pipeline Integration

**What:** The `IckbUdt` subclass automatically participates in CCC's completion pipeline through inherited methods.

**How the chain works:**
1. `completeInputsByBalance(tx, signer)` calls `getInputsInfo` and `getOutputsInfo` to compute balance deficit
2. `getInputsInfo` resolves inputs via `CellInput.getCell(client)` then calls `infoFrom(client, inputCells)`
3. `getOutputsInfo` iterates `tx.outputCells` then calls `infoFrom(client, outputCells)`
4. `completeInputs(tx, signer, accumulator, init)` delegates to `tx.completeInputs(signer, this.filter, ...)`
5. The `filter` property on `Udt` controls which cells the signer's `findCellsOnChain` returns

**Critical detail about `filter`:** The base `Udt` constructor sets `filter` to `{ script: this.script, outputDataLenRange: [16, "0xffffffff"] }` which only finds xUDT cells. The `IckbUdt` subclass should NOT rely on this filter for receipt/deposit cell discovery -- those cells have different type/lock scripts and would not match the xUDT filter. Receipt and deposit cell completion should be handled separately (e.g., by the caller or a dedicated completion method on `IckbUdt`).

### Anti-Patterns to Avoid
- **Overriding `getInputsInfo`/`getOutputsInfo` directly:** These methods contain resolution logic (resolving `CellInput` to `Cell`, iterating `tx.outputCells`) that would need to be duplicated. Override `infoFrom` instead for cleaner code.
- **Using `infoFrom` for cell discovery:** `infoFrom` is for balance calculation from already-known cells, not for finding cells on-chain. Cell discovery uses `filter` + `completeInputs`.
- **Passing `CellAny` to `DaoManager.isDeposit()`:** `DaoManager.isDeposit()` expects `ccc.Cell`, not `CellAny`. When calling within `infoFrom`, construct `Cell.from({ outPoint, cellOutput, outputData })` from the `CellAny` when `outPoint` is present. This is safe because deposit cells are only relevant as inputs. Note: `capacityFree` is available on `CellAny` directly -- only `isDeposit` requires the `Cell` construction.
- **Ignoring the sign convention for deposits:** In the iCKB conservation law, deposit cells consumed as inputs SUBTRACT from iCKB balance. The current `IckbUdtManager.getInputsUdtBalance()` uses `udtValue - ickbValue(...)` for deposits. The `infoFrom` override must preserve this negative balance contribution.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UDT balance tracking | Custom balance tracking interface | `udt.UdtInfo` accumulator with `addAssign()` | UdtInfo already handles balance + capacity + count aggregation, tested in CCC |
| Transaction completion | Custom input search + accumulator | `udt.Udt.completeInputsByBalance()` inherited | Handles dual-constraint (balance + capacity) optimization, error reporting |
| Header fetching + caching | Custom header cache | `client.getTransactionWithHeader()` + CCC's `Client.cache` | CCC caches transparently; no need for application-level header caching |
| Cell type checking | Manual script comparison | `this.isUdt(cell)` + `Script.eq()` for logic/deposit checks | Always use full `Script.eq()` (codeHash + hashType + args) per CLAUDE.md |

**Key insight:** The CCC Udt class already solves the hard problems (completion pipeline, balance/capacity optimization, input deduplication). The iCKB subclass only needs to teach `infoFrom` how to value three cell types instead of one.

## Common Pitfalls

### Pitfall 1: Filter Mismatch for Multi-Cell-Type UDTs
**What goes wrong:** The `Udt.filter` only matches xUDT cells (by type script + data length). Calling `completeInputsByBalance` will only find xUDT cells, not receipt or deposit cells.
**Why it happens:** CCC's `completeInputs` uses `Udt.filter` to find cells from the signer. Receipt/deposit cells have different type scripts and lock scripts.
**How to avoid:** Do NOT expect `completeInputsByBalance` to automatically fetch receipt/deposit cells. Either: (a) override `filter` to also include receipt/deposit cells (complex, may not be feasible with single filter), or (b) have the caller pre-add receipt/deposit cells to the transaction before calling completion, or (c) add a custom `completeInputsByBalance` override that performs multiple cell searches.
**Warning signs:** `completeInputsByBalance` reports insufficient balance when receipt/deposit cells exist but are not in the transaction.

### Pitfall 2: Output Cells vs Input Cells in infoFrom
**What goes wrong:** Applying receipt/deposit valuation logic to output cells, which do not have outPoints and do not carry iCKB value in the same way.
**Why it happens:** `infoFrom` is called for both inputs and outputs. Receipt output cells and deposit output cells exist in transactions but their iCKB value semantics differ from inputs.
**How to avoid:** Check `cell.outPoint` presence before applying receipt/deposit logic. Only input cells (with outPoint) contribute receipt/deposit value. Output receipt cells are new receipts being created (handled by LogicManager.deposit), not value carriers for balance purposes.
**Warning signs:** Double-counting or sign errors in balance calculation.

### Pitfall 3: Deposit Cell Balance Sign Convention
**What goes wrong:** Treating deposit cell iCKB value as positive when it should be negative (conservation law: consuming a deposit reduces the iCKB balance the user must provide).
**Why it happens:** The conservation law is `Input UDT + Input Receipts = Output UDT + Input Deposits`. Rearranging for net balance: `Input UDT + Input Receipts - Input Deposits = Output UDT`. So deposits consumed as inputs have negative iCKB balance contribution.
**How to avoid:** In `infoFrom`, deposit cells use `balance: -ickbValue(...)` (negative). The current `IckbUdtManager.getInputsUdtBalance()` already uses this convention.
**Warning signs:** Transactions fail on-chain with conservation law violation.

### Pitfall 4: Capacity Calculation for Deposit Cells
**What goes wrong:** Using `cell.cellOutput.capacity` directly instead of `cell.capacityFree` (unoccupied capacity) for deposit cell iCKB value.
**Why it happens:** The iCKB exchange rate applies to unoccupied capacity, not total capacity. Deposit cells have 82 CKB occupied capacity.
**How to avoid:** Use `cell.capacityFree` (which is `capacity - fixedPointFrom(occupiedSize)`) when computing `ickbValue()` for deposit cells. `CellAny` has `capacityFree` (transaction.ts:404-405), so this works directly within `infoFrom`.
**Warning signs:** Slight over-valuation of deposit cells leading to invalid transactions.

### Pitfall 5: Async infoFrom and CCC's Completion Loop
**What goes wrong:** The `infoFrom` override makes network calls (header fetches) inside the completion loop, potentially causing performance issues.
**Why it happens:** `completeInputsByBalance` calls `getInputsInfo` which calls `infoFrom` for each input. If there are many receipt/deposit cells, each triggers a header fetch.
**How to avoid:** CCC's `Client.cache` mitigates this -- repeated calls for the same txHash are served from cache. For the initial fetch, the overhead is inherent and acceptable because: (a) receipt/deposit cells are typically few per transaction, and (b) headers are small payloads. No custom optimization needed.
**Warning signs:** Slow transaction building with many receipt/deposit inputs (unlikely in practice).

## Code Examples

### Current IckbUdtManager Balance Calculation (Reference)
```typescript
// Source: packages/core/src/udt.ts lines 66-141
// This is the existing implementation that the IckbUdt subclass must replicate
override async getInputsUdtBalance(
  client: ccc.Client,
  txLike: ccc.TransactionLike,
): Promise<[ccc.FixedPoint, ccc.FixedPoint]> {
  const tx = ccc.Transaction.from(txLike);
  return ccc.reduceAsync(
    tx.inputs,
    async (acc, input) => {
      await input.completeExtraInfos(client);
      const { previousOutput: outPoint, cellOutput, outputData } = input;
      if (!cellOutput || !outputData) throw new Error("Unable to complete input");
      const { type, lock } = cellOutput;
      if (!type) return acc;
      const cell = new ccc.Cell(outPoint, cellOutput, outputData);
      const [udtValue, capacity] = acc;

      // xUDT cell
      if (this.isUdt(cell)) {
        return [udtValue + ccc.numFromBytes(ccc.bytesFrom(outputData).slice(0, 16)), capacity + cellOutput.capacity];
      }
      // Receipt cell
      if (this.logicScript.eq(type)) {
        const txWithHeader = await client.getTransactionWithHeader(outPoint.txHash);
        if (!txWithHeader?.header) throw new Error("Header not found");
        const { depositQuantity, depositAmount } = ReceiptData.decode(outputData);
        return [udtValue + ickbValue(depositAmount, txWithHeader.header) * depositQuantity, capacity + cellOutput.capacity];
      }
      // Deposit cell
      if (this.logicScript.eq(lock) && this.daoManager.isDeposit(cell)) {
        const txWithHeader = await client.getTransactionWithHeader(outPoint.txHash);
        if (!txWithHeader?.header) throw new Error("Header not found");
        return [udtValue - ickbValue(cell.capacityFree, txWithHeader.header), capacity + cellOutput.capacity];
      }
      return acc;
    },
    [0n, 0n],
  );
}
```

### CCC Udt.infoFrom Base Implementation (Override Target)
```typescript
// Source: ccc-dev/ccc/packages/udt/src/udt/index.ts lines 624-641
async infoFrom(
  _client: ccc.Client,
  cells: ccc.CellAnyLike | ccc.CellAnyLike[],
  acc?: UdtInfoLike,
): Promise<UdtInfo> {
  return [cells].flat().reduce((acc, cellLike) => {
    const cell = ccc.CellAny.from(cellLike);
    if (!this.isUdt(cell)) {
      return acc;
    }
    return acc.addAssign({
      balance: Udt.balanceFromUnsafe(cell.outputData),
      capacity: cell.cellOutput.capacity,
      count: 1,
    });
  }, UdtInfo.from(acc).clone());
}
```

### CCC getInputsInfo Chain (How Input Cells Reach infoFrom)
```typescript
// Source: ccc-dev/ccc/packages/udt/src/udt/index.ts lines 1099-1108
async getInputsInfo(client: ccc.Client, txLike: ccc.TransactionLike): Promise<UdtInfo> {
  const tx = ccc.Transaction.from(txLike);
  const inputCells = await Promise.all(
    tx.inputs.map((input) => input.getCell(client)),
    // getCell returns Cell.from({ outPoint: input.previousOutput, cellOutput, outputData })
    // These Cell objects ALWAYS have outPoint set
  );
  return this.infoFrom(client, inputCells);
}

// Source: ccc-dev/ccc/packages/udt/src/udt/index.ts lines 1178-1184
async getOutputsInfo(client: ccc.Client, txLike: ccc.TransactionLike): Promise<UdtInfo> {
  const tx = ccc.Transaction.from(txLike);
  return this.infoFrom(client, Array.from(tx.outputCells));
  // tx.outputCells yields CellAny WITHOUT outPoint
}
```

### CellAny OutPoint Presence (Input vs Output Detection)
```typescript
// Source: ccc-dev/ccc/packages/core/src/ckb/transaction.ts lines 313-318, 331-348
type CellAnyLike = {
  outPoint?: OutPointLike | null;     // present for inputs, absent for outputs
  previousOutput?: OutPointLike | null;
  cellOutput: CellOutputLike;
  outputData?: HexLike | null;
};

class CellAny {
  public outPoint: OutPoint | undefined;  // undefined for output cells
  get capacityFree() { return this.cellOutput.capacity - fixedPointFrom(this.occupiedSize); }
  // ...
}
```

### PR #328 FeePayer.completeInputs Signature
```typescript
// Source: reference/ccc-fee-payer/packages/core/src/signer/feePayer/feePayer.ts lines 26-39
abstract completeInputs<T>(
  tx: Transaction,
  filter: ClientCollectableSearchKeyFilterLike,
  accumulator: (acc: T, v: Cell, i: number, array: Cell[]) => Promise<T | undefined> | T | undefined,
  init: T,
): Promise<{
  addedCount: number;
  accumulated?: T;
}>;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `UdtHandler` interface + `UdtManager` class (iCKB custom) | CCC `udt.Udt` class with `infoFrom`/`getInputsInfo`/`getOutputsInfo` | CCC `@ckb-ccc/udt` package | Udt class provides completion pipeline; UdtHandler/UdtManager don't |
| `ccc.udtBalanceFrom()` (deprecated) | `udt.Udt.balanceFromUnsafe(outputData)` | Current CCC | Old API deprecated, new one in Udt class |
| `tx.completeInputsByUdt()` (deprecated) | `udt.completeInputsByBalance(tx, signer)` | Current CCC | Old on Transaction, new on Udt instance |
| `tx.getInputsUdtBalance()` / `tx.getOutputsUdtBalance()` (deprecated) | `udt.getInputsInfo(client, tx)` / `udt.getOutputsInfo(client, tx)` | Current CCC | New methods return UdtInfo (balance + capacity + count) |
| PR #328 FeePayer Udt (uses deprecated APIs) | Current CCC Udt (uses `infoFrom`) | Not yet merged | PR #328's Udt is simpler, still uses old deprecated APIs; current CCC Udt is more complete |

**Deprecated/outdated:**
- `ccc.udtBalanceFrom()`: Replaced by `udt.Udt.balanceFromUnsafe()`
- `tx.completeInputsByUdt()`: Replaced by `udt.Udt.completeInputsByBalance()`
- `tx.getInputsUdtBalance()` / `tx.getOutputsUdtBalance()`: Replaced by `udt.Udt.getInputsInfo()` / `udt.Udt.getOutputsInfo()`
- PR #328 FeePayer branch's Udt class: Uses deprecated APIs above; the current CCC Udt class (which we work with via ccc-dev) is more advanced

## Open Questions

1. **Receipt/Deposit Cell Discovery in completeInputsByBalance**
   - What we know: `completeInputsByBalance` uses `this.filter` to find cells, which only matches xUDT cells by type script. Receipt and deposit cells have different scripts and won't be found.
   - What's unclear: Should `IckbUdt` override `completeInputsByBalance` to also search for receipt/deposit cells? Or should receipt/deposit cells be pre-added to the transaction by the caller (as the current `LogicManager.completeDeposit` and `OwnedOwnerManager.requestWithdrawal` do)?
   - Recommendation: **Caller responsibility.** The current pattern already has `LogicManager` and `OwnedOwnerManager` handling receipt/deposit cell discovery and addition. `IckbUdt.infoFrom` should accurately VALUE these cells when they appear in the transaction, but should NOT be responsible for FINDING them. This keeps the subclass clean and avoids fighting CCC's single-filter design. The `completeInputsByBalance` method then correctly accounts for receipt/deposit value that the caller has already added.

2. **`capacityFree` on CellAny vs Cell**
   - What we know: `ickbValue()` for deposit cells uses `cell.capacityFree` (unoccupied capacity).
   - **Resolved:** `CellAny` has `capacityFree` getter (transaction.ts:404-405): `get capacityFree() { return this.cellOutput.capacity - fixedPointFrom(this.occupiedSize); }`. No need to construct a `Cell` -- `CellAny.from(cellLike).capacityFree` works directly in `infoFrom`.
   - Note: `DaoManager.isDeposit()` still requires `ccc.Cell` (not `CellAny`). For deposit cells (which have `outPoint`), construct `Cell.from({ outPoint, cellOutput, outputData })` for the `isDeposit` call only.

3. **PR #328 FeePayer Integration**
   - What we know: PR #328 abstracts `completeInputs` into `FeePayer.completeInputs(tx, filter, accumulator, init)`. The current CCC Udt's `completeInputs` delegates to `tx.completeInputs(from, this.filter, ...)` which delegates to `from.completeInputs(...)` (Signer). PR #328 changes this to go through `FeePayer.completeInputs`.
   - What's unclear: Whether IckbUdt needs any special handling for the FeePayer transition.
   - Recommendation: **No special handling needed.** The `infoFrom` override is at a level below the completion plumbing. Whether `completeInputs` goes through Signer (current) or FeePayer (PR #328), the cells still flow through `getInputsInfo` -> `infoFrom`. The override is compatible with both architectures.

4. **Conservation Law Enforcement in IckbUdt**
   - What we know: On-chain iCKB Logic script enforces `Input UDT + Input Receipts = Output UDT + Input Deposits`. User decision says to explore both enforcement-at-build-time and caller-responsibility.
   - What's unclear: The exact enforcement mechanism if implemented at build time.
   - Recommendation: Start with **accurate balance reporting only** (caller responsibility). `infoFrom` correctly values all three cell types with proper sign conventions. A `getBalanceBurned()` call (inherited from base `Udt`) can then be used by callers to verify the conservation law before submitting. Enforcement at build time can be added later as a validation method if needed, but should not be embedded in `infoFrom` (which is a balance calculation method, not a validation method).

## Sources

### Primary (HIGH confidence)
- `ccc-dev/ccc/packages/udt/src/udt/index.ts` -- CCC Udt class source, `infoFrom`, `getInputsInfo`, `getOutputsInfo`, `completeInputsByBalance` full implementation
- `ccc-dev/ccc/packages/core/src/ckb/transaction.ts` -- `CellAny`, `CellAnyLike`, `Cell`, `CellInput.getCell()`, `outputCells` getter
- `ccc-dev/ccc/packages/core/src/client/client.ts` -- `getTransactionWithHeader()`, `getCellWithHeader()` implementations
- `packages/core/src/udt.ts` -- Current `IckbUdtManager`, `ickbValue()`, `convert()`, `ickbExchangeRatio()`
- `packages/utils/src/udt.ts` -- Current `UdtHandler` interface, `UdtManager` base class
- `packages/core/src/logic.ts` -- `LogicManager`, receipt/deposit identification
- `packages/core/src/cells.ts` -- `ReceiptCell`, `IckbDepositCell`, `receiptCellFrom` header access pattern
- `reference/ccc-fee-payer/packages/core/src/signer/feePayer/feePayer.ts` -- PR #328 FeePayer abstract class
- `reference/ccc-fee-payer/packages/udt/src/udt/index.ts` -- PR #328's simpler Udt (still uses deprecated APIs)
- `reference/ccc-fee-payer/packages/core/src/ckb/transaction.ts` -- PR #328 `completeByFeePayer`, completion chain

### Secondary (MEDIUM confidence)
- None -- all findings verified from source code

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all source code directly inspected in the workspace
- Architecture: HIGH -- override points verified by tracing full method chains in CCC source
- Pitfalls: HIGH -- derived from comparing current iCKB implementation with CCC Udt API surface; sign conventions and cell type distinctions verified from existing code

**Research date:** 2026-02-23
**Valid until:** Stable -- CCC Udt class API is mature; valid until major CCC refactor
