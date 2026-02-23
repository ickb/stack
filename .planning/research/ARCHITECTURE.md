# Architecture Research

**Domain:** CCC-based blockchain library suite refactoring (iCKB protocol)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
+-------------------------------------------------------------------+
|                     Application Layer                               |
|  +----------+  +----------+  +----------+  +---------+  +--------+ |
|  |   bot    |  | interface |  |  tester  |  | faucet  |  | sampler| |
|  | (Lumos)  |  |  (Lumos) |  | (Lumos)  |  |  (CCC)  |  | (CCC)  | |
|  +----+-----+  +----+-----+  +----+-----+  +----+----+  +---+----+ |
|       |              |              |             |            |     |
+-------+--------------+--------------+-------------+------------+----+
                                      |
+-------------------------------------------------------------------+
|                      SDK Composition Layer                          |
|  +---------------------------------------------------------------+ |
|  |                  @ickb/sdk (IckbSdk)                          | |
|  |  estimate() | maturity() | request() | collect() | getL1State | |
|  +---------------------------------------------------------------+ |
|       |              |              |             |                  |
+-------+--------------+--------------+-------------+-----------------+
|                      Domain Layer                                   |
|  +-----------+  +---------------+  +--------------------+           |
|  | @ickb/dao |  | @ickb/order   |  |    @ickb/core      |           |
|  | DaoManager|  | OrderManager  |  | LogicManager       |           |
|  |           |  | OrderMatcher  |  | OwnedOwnerManager  |           |
|  |           |  |               |  | IckbUdtManager     |           |
|  +-----------+  +---------------+  +--------------------+           |
|       |              |              |             |                  |
+-------+--------------+--------------+-------------+-----------------+
|                     Utilities Layer                                  |
|  +---------------------------------------------------------------+ |
|  |              @ickb/utils                                      | |
|  |  SmartTransaction | CapacityManager | UdtManager | UdtHandler | |
|  |  collect() | unique() | binarySearch() | MinHeap              | |
|  +---------------------------------------------------------------+ |
|                              |                                      |
+------------------------------+--------------------------------------+
|                     Foundation Layer                                 |
|  +---------------------------------------------------------------+ |
|  |              @ckb-ccc/core                                    | |
|  |  Transaction | Client | Signer | Script | Epoch | Molecule    | |
|  +---------------------------------------------------------------+ |
|  +---------------------------------------------------------------+ |
|  |              @ckb-ccc/udt (CCC's Udt class)                  | |
|  |  Udt | UdtInfo | completeInputsByBalance | completeBy         | |
|  +---------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `@ickb/utils` | Transaction building, capacity management, generic UDT handling, shared utilities | `@ckb-ccc/core` |
| `@ickb/dao` | NervosDAO deposit/withdrawal/request operations, DaoCell wrapping | `@ickb/utils`, `@ckb-ccc/core` |
| `@ickb/order` | Limit order minting/matching/melting, order cell management, exchange ratio math | `@ickb/utils`, `@ckb-ccc/core` |
| `@ickb/core` | iCKB protocol logic: deposits, receipts, owned-owner pairing, iCKB UDT calculations | `@ickb/dao`, `@ickb/utils`, `@ckb-ccc/core` |
| `@ickb/sdk` | Composes all domain managers into a high-level facade. System state fetching, conversion estimates, order lifecycle | All `@ickb/*` packages |
| Apps | User-facing applications consuming the SDK | `@ickb/sdk` (or individual packages) |

## Recommended Architecture After Refactoring

### Target: Remove SmartTransaction, Adopt CCC Udt

The refactored architecture replaces `SmartTransaction` (a subclass of `ccc.Transaction`) with plain `ccc.Transaction` plus utility functions, and replaces the local `UdtHandler`/`UdtManager` with CCC's `Udt` class (possibly subclassed for iCKB).

```
+-------------------------------------------------------------------+
|                     Application Layer                               |
|  +----------+  +----------+  +----------+  +---------+  +--------+ |
|  |   bot    |  | interface |  |  tester  |  | faucet  |  | sampler| |
|  |  (CCC)   |  |  (CCC)   |  |  (CCC)   |  |  (CCC)  |  | (CCC)  | |
|  +----+-----+  +----+-----+  +----+-----+  +----+----+  +---+----+ |
|       |              |              |             |            |     |
+-------+--------------+--------------+-------------+------------+----+
                                      |
+-------------------------------------------------------------------+
|                      SDK Composition Layer                          |
|  +---------------------------------------------------------------+ |
|  |                  @ickb/sdk (IckbSdk)                          | |
|  |  estimate() | maturity() | request() | collect() | getL1State | |
|  |  Uses: ccc.Transaction (plain) + utility functions            | |
|  +---------------------------------------------------------------+ |
|       |              |              |             |                  |
+-------+--------------+--------------+-------------+-----------------+
|                      Domain Layer                                   |
|  +-----------+  +---------------+  +--------------------+           |
|  | @ickb/dao |  | @ickb/order   |  |    @ickb/core      |           |
|  | DaoManager|  | OrderManager  |  | LogicManager       |           |
|  |           |  | OrderMatcher  |  | OwnedOwnerManager  |           |
|  |           |  |               |  | IckbUdt (extends   |           |
|  |           |  |               |  |   ccc Udt)         |           |
|  +-----------+  +---------------+  +--------------------+           |
|       |              |              |             |                  |
+-------+--------------+--------------+-------------+-----------------+
|                     Utilities Layer                                  |
|  +---------------------------------------------------------------+ |
|  |              @ickb/utils                                      | |
|  |  collect() | unique() | binarySearch() | MinHeap              | |
|  |  (NO SmartTransaction, NO UdtHandler, NO UdtManager,         | |
|  |   NO CapacityManager, NO getHeader()/HeaderKey)               | |
|  +---------------------------------------------------------------+ |
|                              |                                      |
+------------------------------+--------------------------------------+
|                     Foundation Layer                                 |
|  +---------------------------------------------------------------+ |
|  |              @ckb-ccc/core + @ckb-ccc/udt                    | |
|  |  Transaction (with completeFee, completeInputsByCapacity)     | |
|  |  Udt (with completeInputsByBalance, completeBy, infoFrom)    | |
|  |  Client | Signer | Script | Epoch | Molecule                 | |
|  +---------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

### Key Architectural Changes

**1. SmartTransaction Removal**

Current state: `SmartTransaction extends ccc.Transaction` adding:
- `udtHandlers: Map<string, UdtHandler>` for tracking UDT balancing
- `headers: Map<string, ClientBlockHeader>` for header caching
- Overrides `completeFee()` to call UDT handlers first
- Overrides `getInputsUdtBalance()`/`getOutputsUdtBalance()` to delegate to handlers
- Overrides `getInputsCapacity()` to account for DAO withdrawal profit

Target: All manager methods accept `ccc.TransactionLike` instead of `SmartTransaction` (following CCC's convention: TransactionLike input, Transaction output). Each concern migrates to a different place:

| SmartTransaction feature | Replacement |
|---|---|
| `udtHandlers` map + `addUdtHandlers()` | CCC `Udt.completeBy()` / `Udt.completeInputsByBalance()` called at transaction completion time |
| `completeFee()` override that calls UDT handlers | App-level orchestration: call `ickbUdt.completeBy(tx, signer)` then `tx.completeFeeBy(signer)` |
| `getInputsUdtBalance()`/`getOutputsUdtBalance()` overrides | `ickbUdt.getInputsInfo(client, tx)` / `ickbUdt.getOutputsInfo(client, tx)` (delegating to overridden `infoFrom()`) |
| `getInputsCapacity()` DAO profit override | Not needed -- CCC's `Transaction.getInputsCapacity()` handles DAO profit natively via `getInputsCapacityExtra()` -> `Cell.getDaoProfit()` |
| `headers` map + `addHeaders()` + `getHeader()` | Removed entirely. `getHeader()` call sites inline CCC client calls (`client.getTransactionWithHeader()`, `client.getHeaderByNumber()`). `addHeaders()` call sites push to `tx.headerDeps` directly. CCC's Client Cache handles caching transparently |
| `addCellDeps()` deduplication | `tx.addCellDeps()` (already on `ccc.Transaction`) |
| `SmartTransaction.default()` | `ccc.Transaction.default()` |

**2. CCC Udt Adoption for iCKB**

CCC's `Udt` class (from `@ckb-ccc/udt`) provides:
- `isUdt(cell)` -- checks type script match + data length >= 16
- `getInputsInfo(client, tx)` / `getOutputsInfo(client, tx)` -- returns `UdtInfo { balance, capacity, count }`
- `completeInputsByBalance(tx, signer)` -- adds UDT inputs to cover outputs
- `completeBy(tx, signer)` -- complete with change to signer's recommended address
- `completeChangeToLock(tx, signer, lock)` -- complete with change to specific lock
- `balanceFrom(client, cells)` -- extract balance from cells
- `infoFrom(client, cells, acc)` -- extract and accumulate UDT info from cells

iCKB's triple-representation value requires custom balance calculation to account for:
1. Standard xUDT cells (balance from first 16 bytes of output data) -- standard Udt behavior
2. Receipt cells (valued as `depositQuantity * ickbValue(depositAmount, header)`)
3. iCKB deposit cells consumed as inputs (negative iCKB value: `-ickbValue(cell.capacityFree, header)`)

**Recommended approach: Subclass `Udt` as `IckbUdt`, overriding `infoFrom()`.**

**Correction (Phase 3):** This section originally recommended overriding `getInputsInfo()`/`getOutputsInfo()` based on the incorrect premise that `CellAnyLike` lacks `outPoint`. In fact, `CellAnyLike` has `outPoint?: OutPointLike | null`, and input cells passed through `getInputsInfo` → `CellInput.getCell()` always have `outPoint` set. `CellAny` also has `capacityFree`. Therefore `infoFrom()` is the better override point — it's more granular (per-cell) and avoids duplicating resolution logic. See 03-RESEARCH.md for the corrected design. The code example below uses the older `getInputsInfo()` pattern; the corrected `infoFrom()` pattern is in 03-RESEARCH.md.

```typescript
// packages/core/src/udt.ts -- refactored
import { udt } from "@ckb-ccc/udt";

export class IckbUdt extends udt.Udt {
  constructor(
    code: ccc.OutPointLike,
    script: ccc.ScriptLike,
    public readonly logicScript: ccc.Script,
    public readonly daoManager: DaoManager,
    config?: udt.UdtConfigLike | null,
  ) {
    super(code, script, config);
  }

  /**
   * Override getInputsInfo to account for iCKB's three value representations:
   * 1. xUDT cells (standard 16-byte balance)
   * 2. Receipt cells (type = logicScript, balance = depositQuantity * ickbValue)
   * 3. Deposit cells being withdrawn (lock = logicScript + DAO deposit,
   *    negative balance = -ickbValue)
   *
   * NOTE: Phase 3 research recommends overriding infoFrom() instead.
   * CellAnyLike has outPoint, and input cells always have it set.
   */
  override async getInputsInfo(
    client: ccc.Client,
    txLike: ccc.TransactionLike,
  ): Promise<udt.UdtInfo> {
    const tx = ccc.Transaction.from(txLike);
    const info = udt.UdtInfo.default();

    for (const input of tx.inputs) {
      const cell = await input.getCell(client);
      if (!cell) continue;

      // Standard xUDT
      if (this.isUdt(cell)) {
        info.addAssign({
          balance: udt.Udt.balanceFromUnsafe(cell.outputData),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // iCKB Receipt
      if (cell.cellOutput.type?.eq(this.logicScript)) {
        const { header } = (await client.getTransactionWithHeader(input.previousOutput.txHash)) ?? {};
        const { depositQuantity, depositAmount } = ReceiptData.decode(cell.outputData);
        info.addAssign({
          balance: ickbValue(depositAmount, header) * BigInt(depositQuantity),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // iCKB Deposit being withdrawn (negative UDT balance)
      if (cell.cellOutput.lock.eq(this.logicScript) && this.daoManager.isDeposit(cell)) {
        const { header } = (await client.getTransactionWithHeader(input.previousOutput.txHash)) ?? {};
        info.addAssign({
          balance: -ickbValue(cell.capacityFree, header),
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

This approach works because:
- CCC's `Udt.completeInputsByBalance()` calls `this.getInputsInfo()` -- overriding it changes balancing behavior
- CCC's `Udt.getBalanceBurned()` delegates to `getInputsBalance()` - `getOutputsBalance()` which call `getInputsInfo()`/`getOutputsInfo()` -- so the conservation law check naturally accounts for all three representations
- The `completeBy()` and `completeChangeToLock()` methods automatically work with the overridden balance calculation
- Input outpoints are available in `tx.inputs`, enabling header fetching for receipt/deposit value calculation

**Note:** This is a preliminary design. The viability of subclassing CCC's `Udt` is an open question to be resolved during Phase 3 (CCC Udt Integration Investigation). See Pitfall 2 in PITFALLS.md for the risks involved.

**3. DAO Capacity Calculation**

`SmartTransaction.getInputsCapacity()` is currently overridden to add DAO withdrawal profit. **This override is no longer needed** — CCC's `Transaction.getInputsCapacity()` already handles DAO profit natively via `getInputsCapacityExtra()` -> `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()` (verified from CCC source, see STACK.md lines 116-132). No standalone utility function is required; simply removing the override and using the base `ccc.Transaction.getInputsCapacity()` is sufficient.

### Component Boundaries After Refactoring

| Component | Owns | Does NOT Own |
|-----------|------|-------------|
| `@ickb/utils` | `collect()`, `unique()`, `binarySearch()`, `MinHeap`, `BufferedGenerator`, codec utilities | No SmartTransaction, no UdtHandler, no UdtManager, no CapacityManager, no `getHeader()`/`HeaderKey` (all removed; CCC equivalents used directly) |
| `@ickb/dao` | `DaoManager` (deposit/withdraw/requestWithdrawal/find operations), `DaoCell` wrapping | No UDT concerns, no DAO capacity utility (CCC handles natively) |
| `@ickb/order` | `OrderManager` (convert/mint/match/melt/find), `OrderMatcher`, `OrderCell`/`MasterCell`/`OrderGroup`, `Info`/`Ratio`/`OrderData` entities | No direct UDT balancing (delegates to UDT handler) |
| `@ickb/core` | `LogicManager` (deposit/completeDeposit/findReceipts/findDeposits), `OwnedOwnerManager`, `IckbUdt extends udt.Udt` (triple-representation balancing), iCKB exchange rate math | No generic UDT handling |
| `@ickb/sdk` | `IckbSdk` facade, `SystemState`, config/constants, pool snapshot codec. Orchestrates all managers. | No direct cell operations |

## Data Flow

### Transaction Building Flow (Post-Refactoring)

```
App creates: tx = ccc.Transaction.default()
    |
    v
Manager operations (domain layer):
  orderManager.mint(tx, lock, info, amounts)   // Adds outputs, cellDeps
  logicManager.deposit(tx, qty, amount, lock)   // Adds DAO outputs, receipt
  daoManager.requestWithdrawal(tx, deposits, lock)  // Adds inputs/outputs
    |
    v
UDT completion (IckbUdt):
  ickbUdt.completeBy(tx, signer)               // Adds UDT inputs + change
    |
    v
Fee completion (ccc.Transaction):
  tx.completeFeeBy(signer)                     // Adds capacity inputs + change
    |
    v
Sign and send:
  signer.sendTransaction(tx)
```

### iCKB Value Conservation Flow

```
Input UDT + Input Receipts = Output UDT + Input Deposits

getInputsInfo():
  For each input cell:
    if xUDT cell      -> balance += UDT amount (16 bytes LE)
    if receipt cell    -> balance += qty * ickbValue(amount, depositHeader)
    if deposit cell    -> balance -= ickbValue(capacityFree, depositHeader)
                          (deposits consumed as inputs reduce UDT balance)

getOutputsInfo():
  For each output cell:
    if xUDT cell      -> balance += UDT amount (16 bytes LE)
    (receipts and deposits are NOT counted in outputs because
     they are tracked by the contract's conservation law)
```

### State Discovery Flow

```
IckbSdk.getL1State(client, locks):
    |
    +-> client.getTipHeader()           -> tip header
    +-> ickbExchangeRatio(tip)          -> exchange ratio
    |
    +-> Parallel:
    |   +-> getCkb(client, tip)         -> ckbAvailable, ckbMaturing
    |   +-> order.findOrders(client)    -> all order groups
    |   +-> client.getFeeRate()         -> fee rate
    |
    +-> Filter orders into user/system
    +-> Estimate maturity for user orders
    |
    v
    SystemState { feeRate, tip, exchangeRatio, orderPool, ckbAvailable, ckbMaturing }
```

### Manager Method Signatures (Before vs After)

**Before (SmartTransaction):**
```typescript
// All managers require SmartTransaction
daoManager.deposit(tx: SmartTransaction, capacities, lock): void
orderManager.mint(tx: SmartTransaction, lock, info, amounts): void
logicManager.deposit(tx: SmartTransaction, qty, amount, lock): void
```

**After (plain ccc.TransactionLike / ccc.Transaction):**
```typescript
// All managers accept ccc.TransactionLike, return ccc.Transaction (CCC convention)
daoManager.deposit(tx: ccc.TransactionLike, capacities, lock): ccc.Transaction
orderManager.mint(tx: ccc.TransactionLike, lock, info, amounts): ccc.Transaction
logicManager.deposit(tx: ccc.TransactionLike, qty, amount, lock): ccc.Transaction
```

The key difference: managers no longer call `tx.addUdtHandlers()` or `tx.addHeaders()`. Instead:
- CellDeps are added via `tx.addCellDeps()` (already exists on `ccc.Transaction`)
- UDT completion is handled by the caller at transaction completion time
- Headers are fetched via inlined CCC client calls; `getHeader()`/`HeaderKey` removed entirely

## Architectural Patterns

### Pattern 1: Manager + Utility Functions (replacing Manager + SmartTransaction)

**What:** Stateless manager classes with methods that operate on plain `ccc.Transaction`. Side concerns (UDT balancing, fee completion) handled by caller using CCC-native methods.

**When to use:** All domain operations that modify transactions.

**Trade-offs:**
- Pro: Managers are simpler, no coupling to custom transaction subclass
- Pro: Callers can use any completion strategy (CCC's completeFeeBy, completeFeeChangeToOutput, etc.)
- Con: Caller must remember to call UDT completion and fee completion separately
- Con: Slightly more boilerplate at call sites

**Example:**
```typescript
// Application code (e.g., bot)
const tx = ccc.Transaction.default();

// Domain operations
orderManager.addMatch(tx, bestMatch);

// UDT completion (new pattern using CCC Udt)
const completedTx = await ickbUdt.completeBy(tx, signer);

// Fee completion (CCC native)
await completedTx.completeFeeBy(signer);

// Send
await signer.sendTransaction(completedTx);
```

### Pattern 2: IckbUdt Subclass with Overridden Balance Calculation

**Correction (Phase 3):** Phase 3 research determined that `infoFrom()` is the preferred override point, not `getInputsInfo()`/`getOutputsInfo()`. The code example below uses the older `getInputsInfo()` pattern; see 03-RESEARCH.md for the corrected `infoFrom()` pattern.

**What:** `IckbUdt extends udt.Udt` overriding `infoFrom()` to account for the triple-representation value model.

**When to use:** Whenever iCKB UDT balancing is needed (order creation, deposit completion, any tx involving iCKB tokens).

**Trade-offs:**
- Pro: All CCC Udt methods (completeBy, completeInputsByBalance, getBalanceBurned) automatically work with iCKB's special value model
- Pro: Consistent with CCC ecosystem patterns -- other projects can adopt the same pattern
- Con: Requires header fetching inside infoFrom(), which adds async complexity
- Con: `IckbUdt` needs references to `logicScript` and `daoManager` for cell type detection

**Example (outdated — uses `getInputsInfo()` override; see 03-RESEARCH.md for corrected `infoFrom()` pattern):**
```typescript
export class IckbUdt extends udt.Udt {
  constructor(
    code: ccc.OutPointLike,
    script: ccc.ScriptLike,
    public readonly logicScript: ccc.Script,
    public readonly daoManager: DaoManager,
  ) {
    super(code, script);
  }

  override async getInputsInfo(
    client: ccc.Client,
    txLike: ccc.TransactionLike,
  ): Promise<udt.UdtInfo> {
    const tx = ccc.Transaction.from(txLike);
    const info = udt.UdtInfo.default();

    for (const input of tx.inputs) {
      const cell = await input.getCell(client);
      if (!cell) continue;

      // Standard xUDT
      if (this.isUdt(cell)) {
        info.addAssign({
          balance: udt.Udt.balanceFromUnsafe(cell.outputData),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // iCKB Receipt
      if (cell.cellOutput.type?.eq(this.logicScript)) {
        const { header } = (await client.getTransactionWithHeader(input.previousOutput.txHash)) ?? {};
        const { depositQuantity, depositAmount } = ReceiptData.decode(cell.outputData);
        info.addAssign({
          balance: ickbValue(depositAmount, header) * BigInt(depositQuantity),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // iCKB Deposit being withdrawn (negative UDT balance)
      if (cell.cellOutput.lock.eq(this.logicScript) && this.daoManager.isDeposit(cell)) {
        const { header } = (await client.getTransactionWithHeader(input.previousOutput.txHash)) ?? {};
        info.addAssign({
          balance: -ickbValue(cell.capacityFree, header),
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

### Pattern 3: Explicit Transaction Completion Pipeline

**What:** Instead of SmartTransaction's "magic" `completeFee()` that internally handles UDT balancing, make the completion pipeline explicit at the call site.

**When to use:** All application-level transaction building.

**Trade-offs:**
- Pro: Transparent -- every step is visible
- Pro: Composable -- easy to add/remove steps
- Pro: No hidden state (no udtHandlers map, no headers map)
- Con: Every call site must follow the same pattern (consider a helper function)

**Example:**
```typescript
// Helper function to standardize the completion pipeline
export async function completeIckbTransaction(
  tx: ccc.Transaction,
  signer: ccc.Signer,
  ickbUdt: IckbUdt,
): Promise<ccc.Transaction> {
  // Step 1: Complete iCKB UDT inputs and change
  const completedTx = await ickbUdt.completeBy(tx, signer);

  // Step 2: Complete CKB fee (with DAO profit awareness if needed)
  await completedTx.completeFeeBy(signer);

  return completedTx;
}
```

## Anti-Patterns

### Anti-Pattern 1: Extending ccc.Transaction with Custom Subclass

**What people do:** Create `SmartTransaction extends ccc.Transaction` to add domain-specific state.

**Why it's wrong:**
- CCC's methods (`completeFee`, `completeInputsByCapacity`) return `ccc.Transaction`, not the subclass -- leading to type coercion issues
- The subclass couples UDT concerns (balancing) with transaction concerns (inputs/outputs) into one God object
- CCC's `Udt` class already provides the UDT completion features that SmartTransaction implemented
- The ecosystem rejected this pattern (no adoption)
- Makes it impossible to use CCC's newer completion methods directly

**Do this instead:** Use plain `ccc.Transaction` and compose domain operations through utility functions and CCC's `Udt` class.

### Anti-Pattern 2: Storing Headers in the Transaction Object

**What people do:** Keep a `headers: Map` on SmartTransaction for lookups during balance calculation.

**Why it's wrong:**
- CCC's Client Cache already caches headers fetched via the client
- The headers map creates shared mutable state between cloned transactions
- Header dependencies (`headerDeps`) are already tracked by `ccc.Transaction`

**Do this instead:** Use `client.getTransactionWithHeader()` or `client.getHeaderByNumber()` and rely on CCC's client-side caching. For transaction-specific header operations (like DAO profit calculation), pass headers explicitly.

### Anti-Pattern 3: Generic UdtHandler Interface in Utils

**What people do:** Define a `UdtHandler` interface in `@ickb/utils` that all UDT types implement.

**Why it's wrong:**
- CCC's `Udt` class already provides this abstraction with a richer API
- The custom `UdtHandler` interface creates a parallel type system that doesn't interop with CCC ecosystem tools
- Forces `SmartTransaction` dependency (methods take `SmartTransaction` parameter)

**Do this instead:** Use CCC's `Udt` class directly. For iCKB-specific behavior, subclass `Udt`.

## Build Order

> **Note:** This research originally suggested a per-package bottom-up build order. The actual ROADMAP uses a **feature-slice approach** instead — each removal is chased across ALL packages so the build stays green at every step. See `.planning/ROADMAP.md` for the authoritative 7-phase structure (SmartTransaction Removal → CCC Utility Adoption → Udt Investigation → Deprecated API Replacement → Core UDT Refactor → SDK Completion → Full Verification). App migration is deferred to a future milestone.

The dependency graph still applies to the order of operations within each feature-slice:

```
@ickb/utils  (foundation -- SmartTransaction, CapacityManager, getHeader live here)
    |
    +---> @ickb/dao   (depends on utils)
    +---> @ickb/order  (depends on utils)
    |         |
    +---> @ickb/core   (depends on dao + utils)
              |
          @ickb/sdk    (depends on all above)
```

**Rationale for dependency order within feature-slices:**

1. **@ickb/utils first** because every other package imports it. Changes to exports here affect all downstream packages.

2. **@ickb/dao and @ickb/order in parallel** since neither depends on the other directly.

3. **@ickb/core after dao** because `@ickb/core` depends on `@ickb/dao` (LogicManager has a DaoManager).

4. **@ickb/sdk last** because it depends on all domain packages.

**Critical dependency:** The `IckbUdt` subclass design (ROADMAP Phase 3 investigation) is the riskiest and most uncertain part. If CCC's `Udt` class cannot be subclassed effectively for the triple-representation model, the architecture may need to fall back to a wrapper pattern rather than inheritance.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| CKB RPC (via CCC Client) | `ccc.ClientPublicTestnet` / `ccc.ClientPublicMainnet` | All chain queries, cell discovery, transaction submission |
| CCC Client Cache | Transparent caching of headers, cells | Replaces SmartTransaction's `headers` map |
| JoyId Wallet (interface app) | CCC Signer abstraction | No direct API calls, uses CCC's wallet connector pattern |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Utils <-> Domain | Domain managers call utility functions (collect, unique, binarySearch, codec) | Direction: domain calls utils, never reverse. CapacityManager removed; CCC's `completeInputsByCapacity()` replaces it |
| Domain <-> SDK | SDK instantiates and orchestrates domain managers | SDK owns manager lifecycle via `getConfig()` |
| SDK <-> Apps | Apps call SDK methods, receive immutable snapshots | `SystemState` is a plain readonly object, no circular dependency |
| Domain <-> CCC Udt | `IckbUdt extends udt.Udt` in `@ickb/core` | CCC Udt is the extension point; iCKB does NOT modify CCC code |
| All packages <-> CCC | Import `{ ccc } from "@ckb-ccc/core"` | One-way dependency: iCKB depends on CCC, never reverse. PRs go upstream |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (few users, single bot) | Monolith is fine. Single process bot, single RPC endpoint |
| Multiple bots | Bot lock script array in SDK already supports this. No architecture change needed |
| High-frequency order matching | OrderManager.bestMatch() is O(n^2) over order pool. If order count grows beyond ~1000, consider pre-indexing by ratio range |
| Multiple UDT types | CCC's Udt class is per-token instance. Each additional token requires a new Udt instance with its own script. The IckbUdt subclass is specific to iCKB -- other tokens use base Udt |

## Sources

- CCC `@ckb-ccc/udt` source code: `/workspaces/stack/ccc-dev/ccc/packages/udt/src/udt/index.ts` (HIGH confidence -- direct code examination)
- CCC `@ckb-ccc/core` Transaction class: `/workspaces/stack/ccc-dev/ccc/packages/core/src/ckb/transaction.ts` (HIGH confidence -- direct code examination)
- Current SmartTransaction: `/workspaces/stack/packages/utils/src/transaction.ts` (HIGH confidence -- direct code examination)
- Current IckbUdtManager: `/workspaces/stack/packages/core/src/udt.ts` (HIGH confidence -- direct code examination)
- Current UdtManager/UdtHandler: `/workspaces/stack/packages/utils/src/udt.ts` (HIGH confidence -- direct code examination)
- PROJECT.md decisions and context (HIGH confidence -- project documentation)
- Current codebase architecture analysis: `.planning/codebase/ARCHITECTURE.md` (HIGH confidence)

---
*Architecture research for: iCKB library suite CCC refactoring*
*Researched: 2026-02-21*
