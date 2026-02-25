# Stack Research

**Domain:** CCC API adoption for iCKB protocol library migration
**Researched:** 2026-02-21
**Confidence:** HIGH (primary source: local CCC source code in `ccc-fork/ccc/`)

## Context

This research focuses on the CCC APIs and patterns that should be adopted as part of the iCKB stack v2 migration. The existing TypeScript/pnpm/CCC stack is established and does not need re-research. This document identifies specific CCC APIs to adopt, local utilities to replace, and patterns to follow for the SmartTransaction removal, UDT handling adoption, and CCC alignment audit.

## Recommended Stack Changes

### CCC APIs to Adopt (replacing local implementations)

| CCC API | Replaces | Package(s) Affected | Confidence |
|---------|----------|---------------------|------------|
| `ccc.Transaction.completeFeeChangeToLock()` | `SmartTransaction.completeFee()` for CKB change | `@ickb/utils`, all consumers | HIGH |
| `ccc.Transaction.completeFeeBy()` | `SmartTransaction.completeFee()` convenience | `@ickb/utils`, all consumers | HIGH |
| `ccc.Transaction.completeFeeChangeToOutput()` | N/A (new capability) | Order matching, bot | HIGH |
| `ccc.Transaction.completeInputsByCapacity()` | `CapacityManager.findCapacities()` + manual add | `@ickb/utils` | HIGH |
| `ccc.Transaction.completeInputsAll()` | Custom collect-all patterns | `@ickb/utils` | HIGH |
| `ccc.Transaction.completeInputs()` | Custom accumulator patterns | `@ickb/utils` | HIGH |
| `ccc.Transaction.getInputsCapacity()` | `SmartTransaction.getInputsCapacity()` | `@ickb/utils` | HIGH |
| `ccc.Transaction.getOutputsCapacity()` | Direct usage (already available) | All packages | HIGH |
| `ccc.Transaction.getFee()` | Manual fee calculation | All packages | HIGH |
| `@ckb-ccc/udt` `Udt` class | `UdtManager` class | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.completeInputsByBalance()` | `UdtManager.completeUdt()` input portion | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.completeChangeToLock()` | `UdtManager.completeUdt()` change portion | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.completeBy()` | Convenience UDT completion | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.complete()` | Custom UDT completion with change function | `@ickb/core` (IckbUdtManager) | HIGH |
| `Udt.getInputsBalance()` / `Udt.getInputsInfo()` | `UdtManager.getInputsUdtBalance()` | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.getOutputsBalance()` / `Udt.getOutputsInfo()` | `UdtManager.getOutputsUdtBalance()` | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.balanceFromUnsafe()` | `ccc.udtBalanceFrom()` (deprecated) | All packages using UDT balance | HIGH |
| `Udt.infoFrom()` | Manual per-cell UDT info aggregation | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.isUdt()` | `UdtManager.isUdt()` | `@ickb/utils`, `@ickb/core` | HIGH |
| `Udt.addCellDeps()` | `SmartTransaction.addUdtHandlers()` cell dep portion | All packages | HIGH |
| `UdtInfo` class | `[ccc.FixedPoint, ccc.FixedPoint]` tuple | `@ickb/utils`, `@ickb/core` | HIGH |
| `ErrorUdtInsufficientCoin` (from `@ckb-ccc/udt`) | `ErrorTransactionInsufficientCoin` (local) | `@ickb/utils` | HIGH |
| `ccc.numMax()` / `ccc.numMin()` | Local `max()` / `min()` for bigint | `@ickb/utils` | HIGH |
| `ccc.gcd()` | Local `gcd()` | `@ickb/utils` | HIGH |
| `ccc.isHex()` | Local `isHex()` | `@ickb/utils` | HIGH |
| `ccc.hexFrom()` | Local `hexFrom()` (partial -- CCC's takes `HexLike` not `bigint | Entity`) | `@ickb/utils` | MEDIUM |
| `ccc.reduce()` / `ccc.reduceAsync()` | Already adopted | N/A | HIGH |
| `ccc.Epoch` | Already adopted (local deleted) | N/A | HIGH |
| `ccc.Cell.getDaoProfit()` | Manual DAO profit calculation in `SmartTransaction.getInputsCapacity()` | `@ickb/utils` | HIGH |
| `ccc.CellInput.getExtraCapacity()` | Manual extra capacity in `SmartTransaction.getInputsCapacity()` | `@ickb/utils` | HIGH |
| `ccc.Cell.getNervosDaoInfo()` | Manual header fetching for deposit/withdrawal | `@ickb/dao` | HIGH |
| `ccc.CellAny` | N/A (use for output cell representation) | All packages | HIGH |
| `ccc.CellOutput.from(output, outputData)` | Manual capacity calculation | All packages | HIGH |
| `ccc.Client.cache` | `SmartTransaction.headers` map | `@ickb/utils` | HIGH |

### Local Utilities to KEEP (no CCC equivalent)

| Utility | Location | Why Keep |
|---------|----------|----------|
| `binarySearch()` | `packages/utils/src/utils.ts` | Domain-specific, no CCC equivalent |
| `asyncBinarySearch()` | `packages/utils/src/utils.ts` | Domain-specific, no CCC equivalent |
| `shuffle()` | `packages/utils/src/utils.ts` | Domain-specific, no CCC equivalent |
| `unique()` | `packages/utils/src/utils.ts` | Works on `ccc.Entity` with `.eq()`, CCC has no equivalent |
| `collect()` | `packages/utils/src/utils.ts` | Async generator collector, no CCC equivalent |
| `BufferedGenerator` | (if exists) | Batched async iteration, no CCC equivalent |
| `MinHeap` | `packages/utils/src/heap.ts` | Data structure, no CCC equivalent |
| `sum()` | `packages/utils/src/utils.ts` | Generic sum, no CCC equivalent |
| `ScriptDeps` interface | `packages/utils/src/utils.ts` | iCKB-specific manager composition pattern |
| `ValueComponents` interface | `packages/utils/src/utils.ts` | iCKB-specific dual-value abstraction |
| `ExchangeRatio` interface | `packages/utils/src/utils.ts` | iCKB-specific exchange rate abstraction |

### CCC `@ckb-ccc/udt` Package

**Version:** Local build from `ccc-fork/ccc/packages/udt/`
**Key classes:** `Udt`, `UdtInfo`, `UdtConfig`, `ErrorUdtInsufficientCoin`
**Depends on:** `@ckb-ccc/core`, `@ckb-ccc/ssri`

Use `@ckb-ccc/udt` because:
1. It provides the complete UDT lifecycle: cell finding, balance calculation, input completion, change handling, transfer, mint
2. It is designed for subclassing -- `infoFrom()` and `balanceFrom()` are virtual methods that subclasses can override
3. It tracks both UDT balance AND capacity per cell via `UdtInfo` (balance, capacity, count), matching iCKB's need for dual-value tracking
4. The `complete()` method's two-phase change function (shouldModify=false for capacity estimation, shouldModify=true for mutation) is the correct pattern for iCKB's complex UDT handling

**SSRI dependency note:** `Udt` extends `ssri.Trait`. For iCKB's use case (legacy xUDT, not SSRI-compliant), the executor will be `undefined`. This is explicitly supported -- the `Udt` class falls back to direct cell manipulation when no executor is provided.

## SmartTransaction Removal Strategy

### What SmartTransaction Does Today (and CCC Replacements)

| SmartTransaction Feature | CCC Native Replacement | Notes |
|--------------------------|------------------------|-------|
| UDT handler management (`udtHandlers` map) | `Udt` instances per UDT type | Udt instances are standalone; no need for a map on the transaction |
| `completeFee()` override (UDT + CKB change) | `Udt.completeBy()` then `tx.completeFeeBy()` | Two-step: complete UDT first, then CKB fee |
| `getInputsUdtBalance()` override | `Udt.getInputsBalance()` | Direct method on Udt instance |
| `getOutputsUdtBalance()` override | `Udt.getOutputsBalance()` | Direct method on Udt instance |
| `getInputsCapacity()` override (DAO profit) | `ccc.Transaction.getInputsCapacity()` | CCC's base implementation now calls `getExtraCapacity()` per input, which includes DAO profit via `Cell.getDaoProfit()` |
| Header caching (`headers` map) | `ccc.Client.cache` (ClientCacheMemory) | Headers cached automatically by Client on fetch |
| `addHeaders()` / `getHeader()` | Removed. Call sites inline CCC client calls (`client.getTransactionWithHeader()`, `client.getHeaderByNumber()`); `addHeaders()` call sites push to `tx.headerDeps` directly | CCC caches confirmed headers |
| `addUdtHandlers()` | `udt.addCellDeps(tx)` | Cell deps added directly by Udt instance |
| `default()` factory | `ccc.Transaction.default()` | Same pattern, no extra state |
| `clone()` with shared state | `ccc.Transaction.clone()` | No shared state needed without udtHandlers/headers maps |
| `fromLumosSkeleton()` | `ccc.Transaction.fromLumosSkeleton()` | Base class method, still available |

### Critical Design Decision: Header Caching

SmartTransaction's `headers` map served two purposes:
1. **Performance:** Avoid re-fetching headers
2. **Correctness:** Ensure headers are in `headerDeps` when needed for DAO calculations

CCC's `Client.cache` handles purpose (1) -- all `getHeaderByHash()` and `getHeaderByNumber()` calls are cached if the header is confirmed. Purpose (2) -- adding to `headerDeps` -- is handled by inlining CCC client calls at each call site.

**Decision (from Phase 1 context):** `getHeader()` function and `HeaderKey` type are removed entirely from `@ickb/utils`. Call sites inline CCC client calls: `txHash` lookups use `(await client.getTransactionWithHeader(hash))?.header`, `number` lookups use `await client.getHeaderByNumber(n)`. `addHeaders()` call sites in DaoManager/LogicManager push to `tx.headerDeps` directly.

### Critical Design Decision: DAO Profit in getInputsCapacity

CCC's `Transaction.getInputsCapacity()` now includes DAO profit via `CellInput.getExtraCapacity()` -> `Cell.getDaoProfit()`. This means SmartTransaction's override of `getInputsCapacity()` is **no longer needed** -- CCC does this natively.

Verified in CCC source (`ccc-fork/ccc/packages/core/src/ckb/transaction.ts` lines 1860-1883):
```typescript
async getInputsCapacity(client: Client): Promise<Num> {
  return (
    (await reduceAsync(
      this.inputs,
      async (acc, input) => {
        const { cellOutput: { capacity } } = await input.getCell(client);
        return acc + capacity;
      },
      Zero,
    )) + (await this.getInputsCapacityExtra(client))
  );
}
```

Where `getInputsCapacityExtra` sums `getExtraCapacity()` per input, which calls `Cell.getDaoProfit()`.

## IckbUdtManager -> CCC Udt Subclass Migration

### Current IckbUdtManager

`IckbUdtManager` extends `UdtManager` (local) and overrides `getInputsUdtBalance()` to account for iCKB's three value representations:
1. **xUDT cells** -- standard UDT balance from output data
2. **Receipt cells** -- iCKB value calculated from deposit amount and header's accumulated rate
3. **Deposit cells being withdrawn** -- negative iCKB value (burning UDT to withdraw deposit)

### Recommended Approach: Subclass `Udt` from `@ckb-ccc/udt`

Create `IckbUdt extends Udt` that overrides `infoFrom()` to recognize all three representations.

**Why `infoFrom()` (updated in Phase 3 research):**
- `infoFrom()` is called by all balance/info methods, so overriding it propagates everywhere. Input cells passed via `getInputsInfo()` → `CellInput.getCell()` always have `outPoint` set on the `CellAny`/`Cell` objects, enabling header fetches for receipt/deposit value calculation. Output cells from `tx.outputCells` lack `outPoint`, allowing `infoFrom` to distinguish inputs from outputs.
- `CellAny` has `capacityFree` (transaction.ts:404-405), so deposit cell valuation works directly. Only `DaoManager.isDeposit()` requires constructing a `Cell` from `CellAny`.
- CCC's `completeInputsByBalance()` chains through `getInputsInfo()` → `infoFrom()`, so overriding `infoFrom` changes balancing behavior correctly without duplicating resolution logic.

**Why NOT override `completeInputsByBalance()`:**
- The base implementation's dual-constraint logic (balance + capacity) is correct for iCKB
- The subclass only needs to change HOW balance is calculated from cells, not the input selection strategy

**Implementation sketch:** See 03-RESEARCH.md for the `infoFrom()` override pattern. ARCHITECTURE.md "CCC Udt Adoption for iCKB" section has the same corrected example.

**Header fetching within `infoFrom()` override:**

Since input cells have `outPoint` set (resolved via `CellInput.getCell(client)` in `getInputsInfo`), the `infoFrom` override can fetch headers using:

1. **`client.getTransactionWithHeader(cell.outPoint.txHash)`** -- Fetches the block header for the transaction that created the cell. Cached by CCC Client. Returns `{ transaction, header? }`.

2. **`client.getTransaction()` + `client.getHeaderByHash()`** -- Alternative two-step approach: get the transaction response (which includes `blockHash`), then fetch the header. Both are cached by CCC Client.

Option 1 is simpler and sufficient for the `infoFrom()` override.

## CCC Transaction Completion Pattern

### Old Pattern (SmartTransaction)

```typescript
const tx = SmartTransaction.default();
tx.addUdtHandlers(ickbUdtHandler);
// ... add outputs ...
await tx.completeFee(signer, changeLock, feeRate);
// completeFee internally calls handler.completeUdt() for each UDT,
// then super.completeFee() for CKB
```

### New Pattern (plain ccc.Transaction + Udt instances)

```typescript
const tx = ccc.Transaction.default();
// ... add outputs ...

// Step 1: Complete UDT inputs and change
const completedTx = await ickbUdt.completeBy(tx, signer);
// OR for more control:
// const completedTx = await ickbUdt.completeChangeToLock(tx, signer, changeLock);

// Step 2: Complete CKB capacity inputs
await completedTx.completeInputsByCapacity(signer);

// Step 3: Complete fee with CKB change
await completedTx.completeFeeBy(signer);
// OR: await completedTx.completeFeeChangeToLock(signer, changeLock);
```

**Why this order matters:**
1. UDT completion first because UDT cells also contribute CKB capacity
2. CKB capacity second to cover any remaining capacity needs
3. Fee completion last because it needs the final transaction size

This matches the pattern shown in CCC's own `Udt.transfer()` example (lines 900-904 of udt source):
```typescript
const completedTx = await udt.completeBy(tx, signer);
await completedTx.completeInputsByCapacity(signer);
await completedTx.completeFeeBy(signer);
```

## Utility Replacement Details

### Replace Local `hexFrom()` (MEDIUM confidence)

Local `hexFrom(v: bigint | ccc.Entity | ccc.BytesLike)` handles three input types:
- `bigint` -> hex string via `numToHex`
- `ccc.Entity` -> hex via `.toBytes()` then `ccc.hexFrom()`
- `ccc.BytesLike` -> delegates to `ccc.hexFrom()`

CCC's `hexFrom(hex: HexLike)` only handles `HexLike` (which is `BytesLike`). The local version adds `bigint` and `Entity` support.

**Recommendation:** Keep local `hexFrom()` but rename it to avoid confusion. Or split into explicit calls: use `ccc.numToHex()` for bigint, `ccc.hexFrom(entity.toBytes())` for entities. The split approach is clearer and avoids maintaining a custom wrapper.

### Replace Local `max()`/`min()` (HIGH confidence)

Local `max<T>()` and `min<T>()` are generic (work with any comparable type). CCC's `numMax()`/`numMin()` are bigint-specific.

**Recommendation:** Use `ccc.numMax()`/`ccc.numMin()` for all bigint comparisons (which is the only use case in this codebase). Delete local `max()`/`min()` since they are only used with bigint.

### Replace Local `gcd()` (HIGH confidence)

Local `gcd()` accepts variadic `bigint` args. CCC's `gcd()` accepts two `NumLike` args.

**Recommendation:** Use `ccc.gcd()` with `.reduce()` for variadic case. Or keep local wrapper if variadic is used extensively.

### Replace Local `isHex()` (HIGH confidence)

Both implementations are functionally equivalent (check for `0x` prefix, even length, valid hex chars).

**Recommendation:** Use `ccc.isHex()` directly. Delete local `isHex()`.

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `SmartTransaction` class | Abandoned ecosystem concept; all its features now exist in CCC natively | `ccc.Transaction` + `Udt` instances |
| `UdtHandler` interface | Coupled to SmartTransaction; CCC's `Udt` class provides richer equivalent | `Udt` class from `@ckb-ccc/udt` |
| `UdtManager` class | Replaced by CCC's `Udt` class which has the same capabilities + more | `Udt` from `@ckb-ccc/udt` |
| `CapacityManager` for input completion | CCC's `Transaction.completeInputsByCapacity()` does this natively | `tx.completeInputsByCapacity(signer)` |
| `CapacityManager` for cell finding | CCC's `Client.findCellsByLock()` and `Signer.findCells()` handle this | `client.findCellsByLock()` or `signer.findCells()` |
| `ccc.udtBalanceFrom()` | Deprecated in CCC core; marked with `@deprecated` annotation | `Udt.balanceFromUnsafe()` from `@ckb-ccc/udt` |
| `ccc.Transaction.getInputsUdtBalance()` | Deprecated in CCC core | `Udt.getInputsBalance()` from `@ckb-ccc/udt` |
| `ccc.Transaction.getOutputsUdtBalance()` | Deprecated in CCC core | `Udt.getOutputsBalance()` from `@ckb-ccc/udt` |
| `ccc.Transaction.completeInputsByUdt()` | Deprecated in CCC core | `Udt.completeInputsByBalance()` from `@ckb-ccc/udt` |
| `SmartTransaction.headers` map | Header caching now handled by `Client.cache` | Let CCC Client cache handle it |
| Manual header dep management for DAO | CCC's `getInputsCapacity()` handles DAO profit natively | Use CCC's built-in DAO profit calculation |
| `@ckb-lumos/*` packages | Being entirely replaced by CCC | CCC equivalents for all Lumos functionality |
| `@ickb/lumos-utils` | Legacy iCKB Lumos utilities being replaced | `@ickb/utils` + CCC |
| `@ickb/v1-core` | Legacy iCKB core being replaced | `@ickb/core` + CCC |

## CapacityManager Fate

`CapacityManager` currently has two roles:
1. **Cell finding** -- `findCapacities()` async generator
2. **Cell adding** -- `addCapacities(tx, cells)` helper

Both are now redundant:
- Cell finding: `ccc.Transaction.completeInputsByCapacity(signer)` handles capacity collection and input addition in one step
- Cell adding: `ccc.Transaction.addInput(cell)` is the native method

**However,** `CapacityManager` is used by the faucet app for a specific pattern: find cells matching a lock, then transfer them. This pattern could use `signer.findCells()` with a filter instead.

**Recommendation:** Remove `CapacityManager` after verifying that `completeInputsByCapacity()` covers all use cases. For the faucet's cell-discovery-then-transfer pattern, use CCC's `client.findCellsByLock()` directly.

## PR #328 (FeePayer) Status

PR #328 proposes a `FeePayer` abstraction for CCC that would allow specifying who pays transaction fees. This is relevant because SmartTransaction's fee completion could designate a specific lock for fee payment.

**Current status (updated):** PR #328 is now integrated into `ccc-fork/ccc` via the pins/record system. FeePayer classes are available at `ccc-fork/ccc/packages/core/src/signer/feePayer/`. The user decided during Phase 3 context that PR #328 is the target architecture -- investigation should design around it.

**Impact on migration:** The FeePayer abstraction is available to build against directly. The `infoFrom()` override is compatible with both the current Signer-based completion and the FeePayer-based completion -- cells flow through `getInputsInfo` → `infoFrom` regardless of which completion plumbing is used.

**Recommendation:** Design around FeePayer as the target architecture. Use `completeFeeChangeToLock()` / `completeFeeBy()` for current execution while investigating how FeePayer's `completeInputs(tx, filter, accumulator, init)` pattern can improve iCKB's receipt/deposit cell discovery.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@ckb-ccc/core` ^1.12.2 | `@ckb-ccc/udt` (local build) | Both from same CCC build; version-locked via catalog |
| `@ckb-ccc/udt` | `@ckb-ccc/ssri` | `Udt` extends `ssri.Trait`; comes from same CCC build |
| `@ckb-ccc/core` ^1.12.2 | Node.js >= 24 | CCC uses standard APIs; no Node.js compatibility issues |
| `@ckb-ccc/ccc` ^1.1.21 | `apps/interface` | Full bundle with wallet connectors; separate from core |

**New dependency for packages:** `@ckb-ccc/udt` must be added to packages that subclass `Udt`. Currently only `@ickb/core` needs this (for `IckbUdt`). The `@ickb/utils` package may also need it if `UdtManager` is replaced with re-exports from `@ckb-ccc/udt`.

## Installation Changes

```bash
# New dependency for @ickb/core (and potentially @ickb/utils)
# Added to pnpm-workspace.yaml catalog:
#   '@ckb-ccc/udt': ^1.x.x  (version aligned with @ckb-ccc/core)

# Per-package:
# @ickb/core: add @ckb-ccc/udt to dependencies
# @ickb/utils: potentially add @ckb-ccc/udt if re-exporting Udt types

# No other new dependencies needed -- all other changes use existing @ckb-ccc/core APIs
```

**Note:** With `ccc-fork/` local build active, `.pnpmfile.cjs` automatically rewires all `@ckb-ccc/*` dependencies to local packages, so the `@ckb-ccc/udt` package is already available from the local CCC build.

## Sources

- `ccc-fork/ccc/packages/udt/src/udt/index.ts` -- CCC Udt class, full source (1798 lines) -- HIGH confidence
- `ccc-fork/ccc/packages/core/src/ckb/transaction.ts` -- CCC Transaction class, full source (2537 lines) -- HIGH confidence
- `ccc-fork/ccc/packages/core/src/client/client.ts` -- CCC Client class with caching, cell finding -- HIGH confidence
- `ccc-fork/ccc/packages/core/src/num/index.ts` -- `numMax`, `numMin`, `numFrom` etc. -- HIGH confidence
- `ccc-fork/ccc/packages/core/src/hex/index.ts` -- `isHex`, `hexFrom`, `bytesLen` -- HIGH confidence
- `ccc-fork/ccc/packages/core/src/utils/index.ts` -- `reduce`, `reduceAsync`, `gcd`, `apply`, `sleep` -- HIGH confidence
- `ccc-fork/ccc/packages/core/src/ckb/epoch.ts` -- `Epoch` class (already adopted) -- HIGH confidence
- `packages/utils/src/transaction.ts` -- Current SmartTransaction implementation (517 lines) -- HIGH confidence
- `packages/utils/src/udt.ts` -- Current UdtManager/UdtHandler implementation (393 lines) -- HIGH confidence
- `packages/utils/src/capacity.ts` -- Current CapacityManager implementation (221 lines) -- HIGH confidence
- `packages/core/src/udt.ts` -- Current IckbUdtManager implementation (213 lines) -- HIGH confidence
- `.planning/PROJECT.md` -- Project context and requirements -- HIGH confidence
- `.planning/codebase/STACK.md` -- Current stack analysis -- HIGH confidence

---
*Stack research for: CCC API adoption in iCKB migration*
*Researched: 2026-02-21*
