# Phase 3 Plan 1: CCC Udt Integration Investigation

**Investigated:** 2026-02-24
**Source base:** ccc-fork/ccc (local fork with PR #328 integrated)
**Purpose:** Trace CCC Udt class internals end-to-end, verify infoFrom override feasibility, resolve all open questions from 03-RESEARCH.md

## CCC Udt Method Chain Trace

### Udt Constructor

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:412-425`

```typescript
constructor(
  code: ccc.OutPointLike,
  script: ccc.ScriptLike,
  config?: UdtConfigLike | null,
) {
  super(code, config?.executor);
  this.script = ccc.Script.from(script);
  this.filter = ccc.ClientIndexerSearchKeyFilter.from(
    config?.filter ?? {
      script: this.script,
      outputDataLenRange: [16, "0xffffffff"],
    },
  );
}
```

**Key findings:**
- `this.script` is set from the `script` parameter -- this is the xUDT type script
- `this.filter` defaults to matching cells by `this.script` type with minimum 16-byte output data
- The filter only matches standard xUDT cells -- receipt and deposit cells have different type/lock scripts and will NOT be found by this filter
- `super(code, config?.executor)` passes to `ssri.Trait` -- stores `code` (OutPoint) and optional `executor`

### infoFrom (Override Target)

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:624-641`

```typescript
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

**Key findings:**
- Signature: `(client: ccc.Client, cells: ccc.CellAnyLike | ccc.CellAnyLike[], acc?: UdtInfoLike) => Promise<UdtInfo>`
- `_client` is unused in the base implementation but available for override (iCKB needs it for header fetches)
- Accepts single cell or array, flattened with `[cells].flat()`
- Each cell is converted to `CellAny` via `ccc.CellAny.from(cellLike)`
- `acc` parameter enables accumulation across multiple `infoFrom` calls
- Base implementation only counts cells where `this.isUdt(cell)` returns true
- Override can add custom logic for receipt and deposit cells while preserving the `UdtInfo` accumulator pattern
- Return type is `Promise<UdtInfo>` -- async allows network calls in override

### isUdt

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:1063-1069`

```typescript
isUdt(cellLike: ccc.CellAnyLike) {
  const cell = ccc.CellAny.from(cellLike);
  return (
    (cell.cellOutput.type?.eq(this.script) ?? false) &&
    ccc.bytesFrom(cell.outputData).length >= 16
  );
}
```

**Key findings:**
- Accepts `CellAnyLike` (not just `Cell`) -- works on both input and output cells
- Uses `Script.eq()` for full script comparison (codeHash + hashType + args) -- matches CLAUDE.md guidance
- Checks output data length >= 16 bytes (UDT balance is stored as 128-bit LE integer)
- **Comparison with `UdtManager.isUdt()`** (`packages/utils/src/udt.ts:132-137`): `UdtManager.isUdt()` accepts `ccc.Cell` and checks `cell.outputData.length >= 34` (hex string: `"0x" + 32 hex chars = 34 chars`). Both are checking for 16 bytes minimum -- `UdtManager` uses hex string length, CCC `Udt` uses byte array length. Functionally equivalent.

### balanceFromUnsafe

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:590-593`

```typescript
static balanceFromUnsafe(outputData: ccc.HexLike): ccc.Num {
  const data = ccc.bytesFrom(outputData).slice(0, 16);
  return data.length < 16 ? ccc.Zero : ccc.numFromBytes(data);
}
```

**Key findings:**
- Static method -- extracts UDT balance from first 16 bytes of output data
- Returns `ccc.Zero` if data is shorter than 16 bytes (safe default)
- Equivalent to the deprecated `ccc.udtBalanceFrom()` and the `ccc.numFromBytes(ccc.bytesFrom(outputData).slice(0, 16))` pattern used in `IckbUdtManager`

### getInputsInfo

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:1099-1108`

```typescript
async getInputsInfo(
  client: ccc.Client,
  txLike: ccc.TransactionLike,
): Promise<UdtInfo> {
  const tx = ccc.Transaction.from(txLike);
  const inputCells = await Promise.all(
    tx.inputs.map((input) => input.getCell(client)),
  );
  return this.infoFrom(client, inputCells);
}
```

**Key findings:**
- Resolves all transaction inputs in parallel via `input.getCell(client)`
- `CellInput.getCell()` (transaction.ts:861-872) calls `completeExtraInfos(client)` then returns `Cell.from({ outPoint: this.previousOutput, cellOutput, outputData })`
- The returned `Cell` objects **always have `outPoint` set** (from `this.previousOutput`)
- These `Cell` objects are passed to `infoFrom` as `CellAnyLike[]`
- Since `Cell extends CellAny`, and `Cell` always has `outPoint`, input cells in `infoFrom` will always have `outPoint !== undefined`

### getOutputsInfo

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:1178-1184`

```typescript
async getOutputsInfo(
  client: ccc.Client,
  txLike: ccc.TransactionLike,
): Promise<UdtInfo> {
  const tx = ccc.Transaction.from(txLike);
  return this.infoFrom(client, Array.from(tx.outputCells));
}
```

**Key findings:**
- Uses `tx.outputCells` getter (transaction.ts:1715-1728)
- `outputCells` yields `CellAny.from({ cellOutput: outputs[i], outputData: outputsData[i] ?? "0x" })`
- No `outPoint` is passed to `CellAny.from()`, so `outPoint` is `undefined` on output cells
- Output cells passed to `infoFrom` will have `outPoint === undefined`

### completeInputsByBalance

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:1394-1446`

```typescript
async completeInputsByBalance(
  txLike: ccc.TransactionLike,
  from: ccc.Signer,
  balanceTweak?: ccc.NumLike,
  capacityTweak?: ccc.NumLike,
): Promise<{ addedCount: number; tx: ccc.Transaction }> {
  const tx = ccc.Transaction.from(txLike);
  const { balance: inBalance, capacity: inCapacity } =
    await this.getInputsInfo(from.client, tx);
  const { balance: outBalance, capacity: outCapacity } =
    await this.getOutputsInfo(from.client, tx);

  const balanceBurned = inBalance - outBalance - ccc.numFrom(balanceTweak ?? 0);
  const capacityBurned =
    ccc.numMin(inCapacity - outCapacity, await tx.getFee(from.client)) -
    ccc.numFrom(capacityTweak ?? 0);

  if (balanceBurned >= ccc.Zero && capacityBurned >= ccc.Zero) {
    return { addedCount: 0, tx };
  }

  const { tx: txRes, addedCount, accumulated } = await this.completeInputs(
    tx, from,
    async (acc, cell) => {
      const info = await this.infoFrom(from.client, cell, acc);
      return info.balance >= ccc.Zero && info.capacity >= ccc.Zero
        ? undefined : info;
    },
    { balance: balanceBurned, capacity: capacityBurned },
  );

  if (accumulated === undefined || accumulated.balance >= ccc.Zero) {
    return { tx: txRes, addedCount };
  }

  throw new ErrorUdtInsufficientCoin({ amount: -accumulated.balance, type: this.script });
}
```

**Key findings:**
- Full chain: `getInputsInfo` -> `infoFrom` (for existing inputs) and `getOutputsInfo` -> `infoFrom` (for outputs)
- Calculates balance and capacity deficit
- Early exit if both constraints satisfied (no new inputs needed)
- Uses `completeInputs` with accumulator that calls `infoFrom` per new cell found
- The accumulator in `completeInputs` receives `Cell` objects (from signer's `findCellsOnChain`), which always have `outPoint`
- `infoFrom` is called with these individual `Cell` objects during completion -- override automatically participates
- Throws `ErrorUdtInsufficientCoin` if insufficient balance (not capacity -- capacity is a soft constraint)

### completeInputs (Low-Level)

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:1309-1331`

```typescript
async completeInputs<T>(
  txLike: ccc.TransactionLike,
  from: ccc.Signer,
  accumulator: (acc: T, v: ccc.Cell, ...) => Promise<T | undefined> | T | undefined,
  init: T,
): Promise<{ tx: ccc.Transaction; addedCount: number; accumulated?: T }> {
  const tx = ccc.Transaction.from(txLike);
  const res = await tx.completeInputs(from, this.filter, accumulator, init);
  return { ...res, tx };
}
```

**Key finding:** Delegates to `tx.completeInputs(from, this.filter, ...)` which uses the Udt's `filter` to find cells via the signer. The `filter` only matches xUDT cells. Receipt and deposit cells must be pre-added to the transaction by the caller.

## CellAny vs Cell: outPoint and capacityFree

### CellAnyLike type

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:313-318`

```typescript
export type CellAnyLike = {
  outPoint?: OutPointLike | null;
  previousOutput?: OutPointLike | null;
  cellOutput: CellOutputLike;
  outputData?: HexLike | null;
};
```

- `outPoint` is `OutPointLike | null | undefined` -- explicitly optional

### CellAny class

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:331-457`

```typescript
export class CellAny {
  public outPoint: OutPoint | undefined;  // line 332

  constructor(
    public cellOutput: CellOutput,
    public outputData: Hex,
    outPoint?: OutPoint,          // line 346: optional
  ) {
    this.outPoint = outPoint;     // line 347
  }
}
```

- `outPoint` is `OutPoint | undefined` at the class level
- Constructor parameter `outPoint` is optional -- defaults to `undefined`

### CellAny.from() factory

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:374-386`

```typescript
static from(cell: CellAnyLike): CellAny {
  if (cell instanceof CellAny) { return cell; }
  const outputData = hexFrom(cell.outputData ?? "0x");
  return new CellAny(
    CellOutput.from(cell.cellOutput, outputData),
    outputData,
    apply(OutPoint.from, cell.outPoint ?? cell.previousOutput),
  );
}
```

- Uses `apply(OutPoint.from, cell.outPoint ?? cell.previousOutput)` -- if both are null/undefined, `outPoint` is `undefined`

### CellAny.capacityFree

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:404-405`

```typescript
get capacityFree() {
  return this.cellOutput.capacity - fixedPointFrom(this.occupiedSize);
}
```

**Confirmed:** `capacityFree` is a getter on `CellAny` -- available on ALL cells, both input and output. No need to construct `Cell` to access `capacityFree`. The getter computes `capacity - fixedPointFrom(occupiedSize)` where `occupiedSize` is `cellOutput.occupiedSize + bytesFrom(outputData).byteLength`.

### Cell class (extends CellAny)

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:488-503`

```typescript
export class Cell extends CellAny {
  constructor(
    public outPoint: OutPoint,     // line 498: NOT optional
    cellOutput: CellOutput,
    outputData: Hex,
  ) {
    super(cellOutput, outputData, outPoint);
  }
}
```

- `Cell.outPoint` is `OutPoint` (non-optional) -- always present
- `Cell extends CellAny` -- a `Cell` is a `CellAny` with guaranteed `outPoint`

### CellInput.getCell()

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:861-872`

```typescript
async getCell(client: Client): Promise<Cell> {
  await this.completeExtraInfos(client);
  if (!this.cellOutput || !this.outputData) {
    throw new Error("Unable to complete input");
  }
  return Cell.from({
    outPoint: this.previousOutput,
    cellOutput: this.cellOutput,
    outputData: this.outputData,
  });
}
```

**Confirmed:** Returns `Cell.from(...)` with `outPoint: this.previousOutput`. Since `CellInput.previousOutput` is always an `OutPoint`, the returned `Cell` always has `outPoint` set.

### tx.outputCells getter

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:1715-1728`

```typescript
get outputCells(): Iterable<CellAny> {
  const { outputs, outputsData } = this;
  function* generator(): Generator<CellAny> {
    for (let i = 0; i < outputs.length; i++) {
      yield CellAny.from({
        cellOutput: outputs[i],
        outputData: outputsData[i] ?? "0x",
      });
    }
  }
  return generator();
}
```

**Confirmed:** Output cells are created via `CellAny.from({ cellOutput, outputData })` -- no `outPoint` is passed, so `outPoint` is `undefined`.

### Summary: outPoint as Input/Output Discriminator

| Source | Type | outPoint |
|--------|------|----------|
| `getInputsInfo` -> `input.getCell(client)` | `Cell` | Always `OutPoint` |
| `getOutputsInfo` -> `tx.outputCells` | `CellAny` | Always `undefined` |
| `completeInputs` accumulator (new cells found) | `Cell` | Always `OutPoint` |

**Verdict:** Checking `cell.outPoint` in `infoFrom` reliably distinguishes input cells from output cells. This is structural, not accidental -- `Cell` requires `outPoint`, and output generators never provide one.

## UdtInfo Migration Mapping

### UdtInfo structure

**File:** `ccc-fork/ccc/packages/udt/src/udt/index.ts:218-292`

```typescript
export class UdtInfo {
  constructor(
    public balance: ccc.Num,    // UDT balance
    public capacity: ccc.Num,   // total CKB capacity of UDT cells
    public count: number,       // number of UDT cells
  ) {}

  addAssign(infoLike: UdtInfoLike) {
    const info = UdtInfo.from(infoLike);
    this.balance += info.balance;
    this.capacity += info.capacity;
    this.count += info.count;
    return this;
  }
}
```

### Migration from [FixedPoint, FixedPoint]

Current `IckbUdtManager.getInputsUdtBalance()` returns `[ccc.FixedPoint, ccc.FixedPoint]`:
- `[0]`: Total UDT balance (iCKB amount) -- maps to `UdtInfo.balance`
- `[1]`: Total CKB capacity -- maps to `UdtInfo.capacity`

CCC `UdtInfo` adds `count` (number of cells) which has no equivalent in the current code. This is purely additive -- the override just tracks it alongside balance and capacity.

| Current (IckbUdtManager) | CCC (UdtInfo) | Notes |
|---------------------------|---------------|-------|
| `acc[0]` (udtValue) | `info.balance` | Same semantics: total iCKB amount |
| `acc[1]` (capacity) | `info.capacity` | Same semantics: total CKB capacity |
| N/A | `info.count` | New field: count of cells contributing |
| `[0n, 0n]` initial | `UdtInfo.from(acc).clone()` | UdtInfo.from(undefined) defaults to `{balance: 0n, capacity: 0n, count: 0}` |

### addAssign for accumulation

Current code uses `return [udtValue + amount, capacity + cellCapacity]` tuple pattern.
CCC uses `acc.addAssign({ balance, capacity, count: 1 })` method pattern.

Key difference: `addAssign` mutates in place and returns `this`. The override must use `addAssign` for each cell type (xUDT, receipt, deposit) to maintain compatibility with the accumulator pattern in `completeInputsByBalance`.

## Header Access Verification

### client.getTransactionWithHeader()

**File:** `ccc-fork/ccc/packages/core/src/client/client.ts:631-661`

```typescript
async getTransactionWithHeader(
  txHashLike: HexLike,
): Promise<
  | { transaction: ClientTransactionResponse; header?: ClientBlockHeader }
  | undefined
> {
  const txHash = hexFrom(txHashLike);
  const tx = await this.cache.getTransactionResponse(txHash);
  if (tx?.blockHash) {
    const header = await this.getHeaderByHash(tx.blockHash);
    if (header && this.cache.hasHeaderConfirmed(header)) {
      return { transaction: tx, header };
    }
  }

  const res = await this.getTransactionNoCache(txHash);
  if (!res) { return; }

  await this.cache.recordTransactionResponses(res);
  return {
    transaction: res,
    header: res.blockHash
      ? await this.getHeaderByHash(res.blockHash)
      : undefined,
  };
}
```

**Confirmed:**
- Returns `{ transaction: ClientTransactionResponse, header?: ClientBlockHeader } | undefined`
- `header` is a `ClientBlockHeader` which contains `dao` field with `ar` (accumulate rate) needed for `ickbValue()`
- First checks cache: `this.cache.getTransactionResponse(txHash)` -- if cached and header confirmed, returns immediately
- Falls back to network fetch: `this.getTransactionNoCache(txHash)`, then caches the response
- Subsequent calls for the same txHash are served from cache -- no redundant network requests

### client.getCellWithHeader()

**File:** `ccc-fork/ccc/packages/core/src/client/client.ts:212-234`

```typescript
async getCellWithHeader(
  outPointLike: OutPointLike,
): Promise<{ cell: Cell; header?: ClientBlockHeader } | undefined> {
  const outPoint = OutPoint.from(outPointLike);
  const res = await this.getTransactionWithHeader(outPoint.txHash);
  // ... extracts cell from transaction output ...
  return { cell, header };
}
```

**Confirmed:** `getCellWithHeader` is a convenience wrapper around `getTransactionWithHeader`. Either can be used in `infoFrom` -- `getTransactionWithHeader` is more direct since we already have `outPoint.txHash`.

### Caching behavior

The `Client.cache` is checked first in `getTransactionWithHeader`. The `cache.recordTransactionResponses()` call ensures that fetched transactions are cached. This means:
- First call for a txHash: network fetch + cache store
- Subsequent calls: cache hit, no network
- Multiple receipt/deposit cells from the same transaction share the same cached header

This is transparent to the `infoFrom` override -- just call `client.getTransactionWithHeader()` and the cache handles the rest.

## PR #328 Compatibility

### FeePayer abstract class

**File:** `ccc-fork/ccc/packages/core/src/signer/feePayer/feePayer.ts:14-72`

```typescript
export abstract class FeePayer {
  constructor(protected client_: Client) {}

  abstract completeTxFee(
    txLike: TransactionLike,
    options?: FeeRateOptionsLike,
  ): Promise<Transaction>;

  abstract completeInputs<T>(
    tx: Transaction,
    filter: ClientCollectableSearchKeyFilterLike,
    accumulator: (acc: T, v: Cell, ...) => Promise<T | undefined> | T | undefined,
    init: T,
  ): Promise<{ addedCount: number; accumulated?: T }>;

  async prepareTransaction(tx: TransactionLike): Promise<Transaction> {
    return Transaction.from(tx);
  }
}
```

### Transaction.completeByFeePayer()

**File:** `ccc-fork/ccc/packages/core/src/ckb/transaction.ts:2264-2275`

```typescript
async completeByFeePayer(...feePayers: FeePayer[]): Promise<void> {
  let tx = this.clone();
  for (const feePayer of feePayers) {
    tx = await feePayer.prepareTransaction(tx);
  }
  for (const feePayer of feePayers) {
    await feePayer.completeTxFee(tx);
  }
  this.copy(tx);
}
```

### Compatibility Assessment

The `infoFrom` override operates at a level below the completion plumbing. The call chain is:

1. `completeInputsByBalance` -> `getInputsInfo` -> `infoFrom` (for existing inputs)
2. `completeInputsByBalance` -> `getOutputsInfo` -> `infoFrom` (for outputs)
3. `completeInputsByBalance` -> `completeInputs` -> `tx.completeInputs(from, this.filter, ...)` -> `from.completeInputs(...)` which goes to Signer or FeePayer
4. Within the accumulator: `infoFrom` is called per new cell found

The FeePayer change affects step 3: how `completeInputs` finds and adds cells. It does NOT affect:
- How `getInputsInfo` resolves inputs to cells (still `input.getCell(client)`)
- How `getOutputsInfo` iterates outputs (still `tx.outputCells`)
- How `infoFrom` processes cells (per-cell logic, unchanged)
- The `infoFrom` signature or semantics

**Verdict: Fully compatible.** The `infoFrom` override works with both:
- Current architecture: `from.completeInputs(this, filter, accumulator, init)` via Signer
- PR #328 architecture: `feePayer.completeInputs(tx, filter, accumulator, init)` via FeePayer

The override point is insulated from the completion routing layer.

## Open Questions Resolved

### 1. Receipt/Deposit Cell Discovery in completeInputsByBalance

**Question:** Should `IckbUdt` override `completeInputsByBalance` to also search for receipt/deposit cells?

**Answer: No -- caller responsibility is confirmed correct.**

**Evidence:** `Udt.completeInputs` (line 1325) delegates to `tx.completeInputs(from, this.filter, accumulator, init)`. The `this.filter` is hardcoded at construction to match only xUDT cells by type script. There is no multi-filter mechanism in `completeInputs`.

The current architecture already handles this correctly:
- `LogicManager.completeDeposit()` adds receipt/deposit cells to the transaction
- `OwnedOwnerManager.requestWithdrawal()` adds deposit cells
- `IckbUdt.infoFrom()` then accurately VALUES these cells when `getInputsInfo`/`getOutputsInfo` processes them

Overriding `completeInputsByBalance` to perform multiple filter searches would:
1. Require reimplementing the dual-constraint optimization logic (balance + capacity deficit)
2. Fight CCC's single-filter design pattern
3. Duplicate cell discovery logic that already exists in `LogicManager` and `OwnedOwnerManager`

**Recommendation confirmed:** `IckbUdt` overrides only `infoFrom` for accurate balance calculation. Cell discovery is the caller's responsibility.

### 2. capacityFree on CellAny vs Cell

**Question:** Does `CellAny` have `capacityFree`?

**Answer: Yes -- confirmed at transaction.ts:404-405.**

```typescript
// CellAny class, line 404-405
get capacityFree() {
  return this.cellOutput.capacity - fixedPointFrom(this.occupiedSize);
}
```

`CellAny.occupiedSize` (line 394-396) = `this.cellOutput.occupiedSize + bytesFrom(this.outputData).byteLength`

Since `Cell extends CellAny`, both classes have `capacityFree`. No need to construct `Cell` for capacity computation.

However, `DaoManager.isDeposit()` (`packages/dao/src/dao.ts:30`) requires `ccc.Cell` (not `CellAny`):

```typescript
isDeposit(cell: ccc.Cell): boolean {
  const { cellOutput: { type }, outputData } = cell;
  return outputData === DaoManager.depositData() && type?.eq(this.script) === true;
}
```

The `ccc.Cell` requirement is a type constraint -- `isDeposit` only reads `cellOutput` and `outputData`, not `outPoint`. But since `Cell.from()` requires `outPoint`, and deposit cells in `infoFrom` always have `outPoint` (they are input cells), constructing `Cell.from({ outPoint: cell.outPoint, cellOutput: cell.cellOutput, outputData: cell.outputData })` is safe and straightforward.

### 3. PR #328 FeePayer Integration

**Question:** Does `IckbUdt` need special handling for the FeePayer transition?

**Answer: No -- confirmed by code trace above** (see "PR #328 Compatibility" section).

The `infoFrom` override operates below the completion routing layer. Whether cells arrive via `Signer.completeInputs` or `FeePayer.completeInputs`, they flow through the same `getInputsInfo` -> `infoFrom` chain.

### 4. Conservation Law Enforcement in IckbUdt

**Question:** Should IckbUdt enforce the conservation law at build time?

**Answer: Accurate balance reporting is sufficient; enforcement is out of scope for the Udt subclass.**

**Evidence:** The conservation law is `Input UDT + Input Receipts = Output UDT + Input Deposits`. With `infoFrom` correctly valuing all three cell types:

- `getInputsInfo` returns: xUDT balance + receipt value - deposit value (for inputs)
- `getOutputsInfo` returns: xUDT balance (for outputs, since receipt/deposit outputs don't carry iCKB value)
- `getBalanceBurned` (inherited, line 1257-1266) = inputs - outputs

If the conservation law holds, `getBalanceBurned` returns 0 (or the intended burn amount). Callers can check this before submitting.

Embedding enforcement in `infoFrom` would:
1. Conflate balance calculation with validation
2. Prevent legitimate partial-construction scenarios where the transaction is not yet balanced
3. Break the `completeInputsByBalance` loop which expects `infoFrom` to report current state, not validate final state

**Recommendation confirmed:** Start with accurate balance reporting only. Validation can be added as a separate method (e.g., `assertConservationLaw(client, tx)`) if needed later.

## IckbUdtManager -> IckbUdt Override Mapping

### Line-by-line mapping

**Current:** `IckbUdtManager.getInputsUdtBalance()` at `packages/core/src/udt.ts:66-141`
**Target:** `IckbUdt.infoFrom()` override

| Current Code (IckbUdtManager) | infoFrom Override | Notes |
|-------------------------------|-------------------|-------|
| `const tx = ccc.Transaction.from(txLike)` | N/A -- `infoFrom` receives cells directly, not a transaction | Transaction handling is in `getInputsInfo`/`getOutputsInfo` |
| `ccc.reduceAsync(tx.inputs, async (acc, input) => { ... }, [0n, 0n])` | `for (const cellLike of [cells].flat()) { ... }` on `UdtInfo` accumulator | Iteration pattern differs -- `infoFrom` gets pre-resolved cells |
| `await input.completeExtraInfos(client)` | N/A -- cells are already resolved when `infoFrom` is called | `getInputsInfo` handles resolution via `input.getCell(client)` |
| `const { previousOutput: outPoint, cellOutput, outputData } = input` | `const cell = ccc.CellAny.from(cellLike)` then `cell.outPoint`, `cell.cellOutput`, `cell.outputData` | Property access pattern changes |
| `if (!cellOutput \|\| !outputData) throw ...` | N/A -- `CellAny.from()` always produces valid `cellOutput` and `outputData` (defaults to `"0x"`) | Error case eliminated by type system |
| `if (!type) return acc` | Handled by `this.isUdt(cell)` returning false for typeless cells | Implicit in isUdt check |
| `const cell = new ccc.Cell(outPoint, cellOutput, outputData)` | `const cell = ccc.CellAny.from(cellLike)` -- for `isDeposit`, construct `Cell.from(...)` when needed | Only need `Cell` for `isDeposit()` call |
| `if (this.isUdt(cell)) { return [udtValue + numFromBytes(...), capacity + ...] }` | `if (this.isUdt(cell)) { info.addAssign({ balance: Udt.balanceFromUnsafe(...), capacity: ..., count: 1 }) }` | Use `balanceFromUnsafe` instead of manual `numFromBytes(bytesFrom(outputData).slice(0, 16))` |
| `if (this.logicScript.eq(type)) { // receipt ... }` | Same logic: check `cell.cellOutput.type?.eq(this.logicScript)` | Receipt detection unchanged |
| `client.getTransactionWithHeader(outPoint.txHash)` | `client.getTransactionWithHeader(cell.outPoint!.txHash)` | `outPoint` available since receipt cells are inputs (verified above) |
| `ReceiptData.decode(outputData)` | `ReceiptData.decode(cell.outputData)` | Direct access to `outputData` |
| `ickbValue(depositAmount, header) * depositQuantity` | Same computation | `ickbValue` function unchanged |
| `return [udtValue + receiptValue, capacity + ...]` | `info.addAssign({ balance: receiptValue, capacity: ..., count: 1 })` | Use addAssign pattern |
| `if (this.logicScript.eq(lock) && this.daoManager.isDeposit(cell))` | Check `cell.cellOutput.lock.eq(this.logicScript)` then construct `Cell.from(...)` for `isDeposit` | Need Cell construction for `isDeposit` |
| `ickbValue(cell.capacityFree, header)` | `ickbValue(cell.capacityFree, header)` -- `capacityFree` available on `CellAny` | Direct access, no Cell needed for capacity |
| `return [udtValue - depositValue, capacity + ...]` | `info.addAssign({ balance: -depositValue, capacity: ..., count: 1 })` | Negative balance via addAssign |
| Output cells: handled by separate `getOutputsUdtBalance` | Output cells flow through same `infoFrom` -- only `isUdt` check matches (no receipt/deposit for outputs) | Unified by `outPoint` check: `if (!cell.outPoint) continue` for receipt/deposit logic |

### Key behavioral difference: Outputs

Current `IckbUdtManager` has separate methods:
- `getInputsUdtBalance()`: processes xUDT + receipt + deposit inputs
- No explicit output override -- `UdtManager.getOutputsUdtBalance()` handles standard xUDT outputs

New `IckbUdt.infoFrom()` handles BOTH inputs and outputs in a single method. For output cells (no `outPoint`), only the `isUdt` check applies -- receipt/deposit output cells are skipped because:
1. `cell.outPoint` is `undefined` for outputs
2. Receipt/deposit logic is gated behind `if (!cell.outPoint) continue`
3. The base `isUdt` check catches standard xUDT output cells

This is correct because:
- iCKB receipt outputs are newly created receipts (by `LogicManager.deposit`), not value carriers for balance
- iCKB deposit outputs have DAO type script, not iCKB UDT type script -- `isUdt` returns false
- Only standard xUDT outputs carry iCKB value in the output direction

### Constructor migration

| Current (IckbUdtManager) | Target (IckbUdt) | Notes |
|--------------------------|-------------------|-------|
| `constructor(script, cellDeps, logicScript, daoManager)` | `constructor(code, script, logicScript, daoManager, config?)` | New `code` param (OutPoint for cell deps), `config` optional |
| `super(script, cellDeps, "iCKB", "iCKB", 8)` | `super(code, script, config)` | Base class changes: UdtManager -> Udt |
| `this.logicScript` | `this.logicScript` | Preserved |
| `this.daoManager` | `this.daoManager` | Preserved |
| N/A | `this.script` (from Udt base) | Replaces `UdtManager.script` |
| `this.cellDeps` | `this.code` (OutPoint) + `addCellDeps()` | CCC uses OutPoint for code dep, not explicit CellDep array |
| `this.name`, `this.symbol`, `this.decimals` | Via `udt.name()`, `udt.symbol()`, `udt.decimals()` (SSRI) or custom properties | Metadata access changes |

## Edge Cases and Risks

### 1. CellAny.from() coerces both outPoint and previousOutput

**File:** `transaction.ts:384`
```typescript
apply(OutPoint.from, cell.outPoint ?? cell.previousOutput),
```

If a `CellAnyLike` has `previousOutput` but not `outPoint`, the resulting `CellAny` still gets `outPoint` set. This is safe -- both names refer to the same concept. But within `infoFrom`, always check `cell.outPoint` (not `cell.previousOutput`, which doesn't exist on `CellAny`).

### 2. DaoManager.isDeposit() type requirement

`DaoManager.isDeposit()` accepts `ccc.Cell`, not `CellAny`. Since deposit cells are only relevant as inputs (where `outPoint` is always present), constructing `Cell.from({ outPoint: cell.outPoint!, cellOutput: cell.cellOutput, outputData: cell.outputData })` is always valid. The non-null assertion on `outPoint` is safe because the deposit check is gated behind `if (!cell.outPoint) continue`.

### 3. UdtInfo.balance allows negative values

`UdtInfo.balance` is `ccc.Num` (bigint), not unsigned. The `addAssign` method does `this.balance += info.balance`. For deposit cells, passing `balance: -depositIckbValue` works because bigint addition with negative values is well-defined. This is tested by `completeInputsByBalance` which checks `info.balance >= ccc.Zero` as its termination condition -- negative balance contributions from deposits are correctly accumulated.

### 4. Cell discovery gap: completeInputsByBalance only finds xUDT cells

As documented in Open Question #1, `Udt.filter` only matches xUDT cells. If a caller relies solely on `completeInputsByBalance` to provide all iCKB value, receipt and deposit cells will be missed. This is by design -- callers must pre-add receipt/deposit cells (via `LogicManager`/`OwnedOwnerManager`) before calling `completeInputsByBalance`.

Risk mitigation: Document this clearly in `IckbUdt` API documentation. The `completeInputsByBalance` inherited method correctly accounts for pre-added receipt/deposit inputs via `getInputsInfo` -> `infoFrom`.

### 5. Async infoFrom and potential performance

The base `infoFrom` is synchronous (returns `Promise` but internally uses `.reduce()` without `await`). The override will be truly async due to `client.getTransactionWithHeader()` calls. This changes `infoFrom` from O(1) network calls to O(n) where n is the number of receipt/deposit cells in the input.

Mitigation:
- CCC `Client.cache` ensures each txHash is fetched at most once per session
- Receipt/deposit cells are typically few per transaction (1-5)
- Multiple cells from the same transaction share one cached header fetch
- The async signature is already declared on the base class, so no interface change needed

### 6. No upstream CCC changes required

The investigation confirms that `IckbUdt extends udt.Udt` with `infoFrom` override requires ZERO changes to CCC's Udt class. All override points are public methods with appropriate signatures. This eliminates the dealbreaker risk identified in CONTEXT.md.

---

*Investigation: Phase 03-ccc-udt-integration-investigation, Plan 01*
*Completed: 2026-02-24*
