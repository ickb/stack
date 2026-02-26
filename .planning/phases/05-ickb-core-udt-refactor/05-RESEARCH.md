# Phase 5: @ickb/core UDT Refactor - Research

**Researched:** 2026-02-26
**Domain:** CCC UDT subclassing, iCKB multi-representation balance, code deps migration
**Confidence:** HIGH

## Summary

Phase 5 replaces the custom `IckbUdtManager` (extending `UdtManager`) in `@ickb/core` with `IckbUdt` (extending `udt.Udt` from `@ckb-ccc/udt`). The core challenge is overriding `infoFrom()` to account for iCKB's three on-chain value representations: xUDT cells (positive balance), receipt cells (positive, input only), and deposit cells (negative, input only). The CCC `Udt` class provides all required override points and a complete input-completion pipeline (`completeInputsByBalance`) that consumes the output of `infoFrom`.

Simultaneously, the phase removes `udtHandler` from `LogicManager` and `OwnedOwnerManager` (matching Phase 4's `OrderManager` pattern), deletes the entire UDT infrastructure from `@ickb/utils` (`UdtHandler`, `UdtManager`, `ErrorTransactionInsufficientCoin`, `UdtCell`, `findUdts`, `addUdts`, `isUdtSymbol`), and migrates the SDK from `IckbUdtManager` to `IckbUdt`. The dep group pattern is replaced with individual code deps (xUDT OutPoint + iCKB Logic OutPoint) for `IckbUdt` only.

All required code cell OutPoints are available in `forks/contracts/scripts/deployment/` for both mainnet and testnet. The `@ckb-ccc/udt` package is already available via the local CCC fork build (workspace-linked by `.pnpmfile.cjs`).

**Primary recommendation:** Implement `IckbUdt extends udt.Udt` with `infoFrom` override as the sole customization point. Use the CCC `completeInputsByBalance` pipeline for balance completion. Delete all UDT infrastructure from `@ickb/utils` since `IckbUdt` replaces it entirely.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Drop `compressState` feature entirely -- CCC's `completeInputsByBalance` handles completion
- Callers use `ickbUdt.completeInputsByBalance(tx, signer)` directly -- no convenience wrapper
- Destructure return as needed: `const { tx } = await ickbUdt.completeInputsByBalance(...)` -- `addedCount` available but not required
- Trust CCC fully for completion -- `infoFrom` provides accurate cell valuations, CCC handles dual-constraint (balance + capacity) optimization
- Stick to `completeInputsByBalance` only -- `completeInputsAll` and `completeByTransfer` are inherited but not documented for iCKB callers
- IckbUdt overrides `addCellDeps` to add both xUDT code dep AND iCKB Logic code dep (individual `depType: "code"` deps, not dep group)
- Constructor takes `code: OutPointLike` (xUDT script code cell) via base class + `logicCode: OutPointLike` (iCKB Logic script code cell) as new param
- Individual code cell OutPoints sourced from `forks/contracts/` (mainnet + testnet deployments)
- Only IckbUdt switches to code deps pattern in Phase 5; other managers (DaoManager, LogicManager, OrderManager, OwnedOwnerManager) keep `CellDep[]` for now
- Mixed patterns (code deps + dep groups) coexist temporarily -- `tx.addCellDeps` deduplicates
- Delete `findUdts`, `addUdts`, `UdtCell` interface, `isUdtSymbol` -- all internal to `UdtManager`, no external consumers
- CCC's `completeInputs` (used internally by `completeInputsByBalance`) handles cell discovery via `Udt.filter`
- CCC's `isUdt()` length check (>= 16 bytes) is equivalent to current `>= 34` hex chars -- no iCKB-specific reason for old threshold
- Accept CCC's `ErrorUdtInsufficientCoin` from `completeInputsByBalance` -- callers (SDK, UI) format error messages themselves
- Delete `ErrorTransactionInsufficientCoin` class from `@ickb/utils`
- Plain `Error` throws for header-not-found in `infoFrom` (exceptional path -- CCC cache should provide headers)
- Phase 5 handles SDK error handling updates (not deferred to Phase 6)
- Renamed to `IckbUdt.typeScriptFrom(udt, ickbLogic)` -- static method, CCC-aligned naming
- Keep current parameter types: `(udt: ccc.Script, ickbLogic: ccc.Script): ccc.Script`
- Computes the `script` param for IckbUdt constructor (token identity via args)
- LogicManager: remove `udtHandler: UdtHandler` constructor param, remove `tx.addCellDeps(this.udtHandler.cellDeps)` calls (2 sites) -- UDT cellDeps are caller responsibility
- OwnedOwnerManager: same treatment -- remove `udtHandler` param, remove cellDeps calls (2 sites)
- This matches Phase 4's OrderManager pattern exactly
- With all three managers cleaned, `UdtHandler` interface has zero consumers -> delete from `@ickb/utils`
- `ScriptDeps` interface: researcher should check if any consumers remain after `UdtHandler` deletion

### Claude's Discretion
- Constructor parameter for `IckbUdt`: whether to take `CellDep[]` or single `CellDep` for the dep group -- Claude picks cleanest pattern
- Internal organization of the `infoFrom` override code
- How to structure the `@ckb-ccc/udt` dependency addition to `@ickb/core` package.json
- Exact migration of SDK `IckbUdtManager` construction to `IckbUdt` construction

### Deferred Ideas (OUT OF SCOPE)
- **ValueComponents redesign**: `udtValue` field name is ambiguous in multi-UDT context (which UDT?). CCC's `UdtInfo` scoped to specific Udt instance is cleaner. Evaluate renaming/replacing across all packages in a future phase
- **All managers to code deps**: Switch DaoManager, LogicManager, OrderManager, OwnedOwnerManager from `CellDep[]` to individual code OutPoints (CCC pattern). Phase 5 only migrates IckbUdt
- **infoFrom caching for matching bot**: If matching bot performance becomes a bottleneck, add cell->UdtInfo result caching in IckbUdt to avoid recomputation across trial transactions
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SMTX-05 | UDT handler registration replaced by direct Udt instance usage | LogicManager/OwnedOwnerManager `udtHandler` removed (4 sites); `UdtHandler` interface deleted; callers pass `ickbUdt.script` to managers and call `ickbUdt.addCellDeps(tx)` externally |
| SMTX-07 | IckbUdtManager multi-representation balance logic preserved | `IckbUdt.infoFrom()` override handles xUDT cells (positive), receipt cells (positive, input only), deposit cells (negative, input only); conservation law preserved via accurate sign conventions |
| SMTX-10 | Deprecated CCC API calls replaced | `ccc.udtBalanceFrom()` calls (3 in `UdtManager`) eliminated by deleting `UdtManager`; `IckbUdtManager.getInputsUdtBalance()` replaced by `IckbUdt.infoFrom()` override; no deprecated APIs remain |
| UDT-04 | IckbUdt extends udt.Udt implemented | `IckbUdt` class with `infoFrom` override, `addCellDeps` override (individual code deps), `typeScriptFrom` static method, LogicManager/OwnedOwnerManager `udtHandler` removed |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ckb-ccc/udt` | workspace (local CCC fork) | Base `Udt` class for subclassing | CCC's official UDT abstraction; `infoFrom` is the override point for multi-representation balance |
| `@ckb-ccc/core` | catalog: ^1.12.2 | CKB core types, Transaction, Client | Already used across all packages |
| `@ckb-ccc/ssri` | workspace (local CCC fork) | `ssri.Trait` base class (parent of `Udt`) | Transitive dependency; `Udt extends ssri.Trait` provides `code: OutPoint` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ickb/dao` | workspace:* | `DaoManager.isDeposit()` for deposit cell identification | Already a dependency of `@ickb/core`; used in `infoFrom` for deposit cell detection |
| `@ickb/utils` | workspace:* | `ExchangeRatio`, `ValueComponents`, `ScriptDeps`, utility functions | Already a dependency; `ScriptDeps` still used by managers after `UdtHandler` deletion |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Subclass `Udt` | Keep `UdtManager` | Loses CCC's completion pipeline, keeps duplicated code |
| Override `infoFrom` only | Override `getInputsInfo`/`getOutputsInfo` | `infoFrom` is simpler -- single override handles both inputs and outputs |
| Dep group for IckbUdt | Individual code deps | Dep groups semantically imply "all cells in group needed"; CCC author prefers individual code deps |

**Installation:**
Add `@ckb-ccc/udt` to `@ickb/core/package.json` dependencies. With the local CCC fork build active, `.pnpmfile.cjs` automatically rewires to workspace:*:
```json
{
  "dependencies": {
    "@ckb-ccc/core": "catalog:",
    "@ckb-ccc/udt": "catalog:",
    "@ickb/dao": "workspace:*",
    "@ickb/utils": "workspace:*"
  }
}
```

**Note on catalog:** `@ckb-ccc/udt` is NOT currently in the pnpm-workspace.yaml catalog. It needs to be added OR use `"workspace:*"` directly since the `.pnpmfile.cjs` hook rewires it anyway. Recommendation: add `"@ckb-ccc/udt": "^1.12.2"` to the catalog for consistency with `@ckb-ccc/core`, though the pnpmfile hook will override it to `workspace:*` when the fork is present.

## Architecture Patterns

### IckbUdt Class Structure
```
@ickb/core/src/udt.ts
├── IckbUdt extends udt.Udt
│   ├── constructor(code, script, logicCode, logicScript, daoManager)
│   ├── static typeScriptFrom(udt, ickbLogic): Script
│   ├── override infoFrom(client, cells, acc?): Promise<UdtInfo>
│   └── override addCellDeps(txLike): Transaction
├── ickbValue(capacity, header): FixedPoint  (unchanged)
├── convert(isCkb2Udt, amount, rate, ...): FixedPoint  (unchanged)
├── ickbExchangeRatio(header, ...): ExchangeRatio  (unchanged)
└── constants (AR_0, ICKB_DEPOSIT_CAP, etc.)  (unchanged)
```

### Pattern 1: infoFrom Override for Multi-Representation Balance
**What:** Override `infoFrom()` to value three cell types: xUDT (positive), receipts (positive, input only), deposits (negative, input only).
**When to use:** Called by CCC's `getInputsInfo()` and `getOutputsInfo()` which pass resolved cells.
**Key insight:** `infoFrom` receives `CellAnyLike` which may or may not have `outPoint`. Input cells (from `getInputsInfo`) have `outPoint` (needed for header fetches). Output cells (from `getOutputsInfo`) do not have `outPoint` -- receipt and deposit cells should only appear as inputs, so the absence of `outPoint` naturally excludes them from output-side processing.

```typescript
// Source: Verified from CCC Udt source (forks/ccc/packages/udt/src/udt/index.ts)
import { udt } from "@ckb-ccc/udt";

export class IckbUdt extends udt.Udt {
  constructor(
    code: ccc.OutPointLike,             // xUDT code cell OutPoint (via base Trait)
    script: ccc.ScriptLike,              // iCKB UDT type script (via base Udt)
    public readonly logicCode: ccc.OutPoint,   // iCKB Logic code cell OutPoint
    public readonly logicScript: ccc.Script,   // iCKB Logic script
    public readonly daoManager: DaoManager,    // for isDeposit check
  ) {
    super(code, script);
  }

  async infoFrom(
    client: ccc.Client,
    cells: ccc.CellAnyLike | ccc.CellAnyLike[],
    acc?: udt.UdtInfoLike,
  ): Promise<udt.UdtInfo> {
    const info = udt.UdtInfo.from(acc).clone();

    for (const cellLike of [cells].flat()) {
      const cell = ccc.CellAny.from(cellLike);

      // Standard xUDT cell -- delegate to base class pattern
      if (this.isUdt(cell)) {
        info.addAssign({
          balance: udt.Udt.balanceFromUnsafe(cell.outputData),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Receipt and deposit cells need outPoint for header fetch.
      // Output cells (no outPoint) are skipped -- correct by design.
      if (!cell.outPoint) {
        continue;
      }

      const { type, lock } = cell.cellOutput;

      // Receipt cell: type === logicScript
      if (type && this.logicScript.eq(type)) {
        const txWithHeader = await client.getTransactionWithHeader(
          cell.outPoint.txHash,
        );
        if (!txWithHeader?.header) {
          throw new Error("Header not found for txHash");
        }
        const { depositQuantity, depositAmount } =
          ReceiptData.decode(cell.outputData);
        info.addAssign({
          balance: ickbValue(depositAmount, txWithHeader.header) *
            depositQuantity,
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Deposit cell: lock === logicScript AND isDeposit
      if (this.logicScript.eq(lock) && this.daoManager.isDeposit(cell)) {
        const txWithHeader = await client.getTransactionWithHeader(
          cell.outPoint.txHash,
        );
        if (!txWithHeader?.header) {
          throw new Error("Header not found for txHash");
        }
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

  override addCellDeps(txLike: ccc.TransactionLike): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    // xUDT code dep (from base class's this.code)
    tx.addCellDeps({ outPoint: this.code, depType: "code" });
    // iCKB Logic code dep
    tx.addCellDeps({ outPoint: this.logicCode, depType: "code" });
    return tx;
  }

  static typeScriptFrom(udt: ccc.Script, ickbLogic: ccc.Script): ccc.Script {
    const { codeHash, hashType } = udt;
    return new ccc.Script(
      codeHash,
      hashType,
      [ickbLogic.hash(), "00000080"].join("") as ccc.Hex,
    );
  }
}
```

### Pattern 2: Manager udtHandler Removal (Phase 4 Pattern)
**What:** Remove `udtHandler: UdtHandler` constructor parameter and `tx.addCellDeps(this.udtHandler.cellDeps)` calls from `LogicManager` and `OwnedOwnerManager`.
**When to use:** Follows Phase 4's `OrderManager` pattern exactly.
**Example (LogicManager):**
```typescript
// BEFORE:
constructor(
  public readonly script: ccc.Script,
  public readonly cellDeps: ccc.CellDep[],
  public readonly daoManager: DaoManager,
  public readonly udtHandler: UdtHandler,  // REMOVE
) {}

// AFTER:
constructor(
  public readonly script: ccc.Script,
  public readonly cellDeps: ccc.CellDep[],
  public readonly daoManager: DaoManager,
) {}

// BEFORE (in deposit, completeDeposit methods):
tx.addCellDeps(this.udtHandler.cellDeps);  // REMOVE (4 sites total: 2 in LogicManager, 2 in OwnedOwnerManager)

// Caller responsibility (SDK or app code):
tx = ickbUdt.addCellDeps(tx);  // Caller adds UDT cellDeps before or after calling manager methods
```

### Pattern 3: SDK Construction Migration
**What:** Replace `IckbUdtManager` construction with `IckbUdt` in `getConfig()`.
**Key change:** `getConfig` needs xUDT code OutPoint and iCKB Logic code OutPoint (not dep group).

```typescript
// BEFORE:
const ickbUdt = new IckbUdtManager(
  d.udt.script,        // UDT type script
  d.udt.cellDeps,      // dep group CellDep[]
  d.logic.script,      // logic script
  dao,                  // DaoManager
);

// AFTER:
const ickbUdt = new IckbUdt(
  udtCode,              // xUDT code cell OutPoint
  d.udt.script,        // UDT type script (computed via typeScriptFrom)
  logicCode,            // iCKB Logic code cell OutPoint
  d.logic.script,      // logic script
  dao,                  // DaoManager
);
```

### Anti-Patterns to Avoid
- **Overriding `getInputsInfo`/`getOutputsInfo` instead of `infoFrom`:** The Phase 3 decision (03-02) explicitly chose `infoFrom` as the sole override point. `getInputsInfo` and `getOutputsInfo` both delegate to `infoFrom` already.
- **Adding CCC `isUdt()` workaround:** CCC's `isUdt()` checks `>= 16 bytes` data length, which is equivalent to the old `>= 34` hex chars check. No iCKB-specific override needed.
- **Wrapping `completeInputsByBalance`:** The decision explicitly says "no convenience wrapper." Callers use `ickbUdt.completeInputsByBalance(tx, signer)` directly.
- **Keeping `UdtHandler` for backward compatibility:** The interface has zero consumers after LogicManager/OwnedOwnerManager cleanup. Delete it cleanly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UDT cell discovery | Custom `findUdts` generator | `Udt.completeInputs` (via `filter`) | CCC handles dedup, pagination, signer address resolution |
| Balance completion pipeline | Custom `completeUdt` | `Udt.completeInputsByBalance` | CCC handles dual-constraint (balance + capacity) optimization, change output, error throwing |
| UDT balance extraction | `ccc.udtBalanceFrom()` | `Udt.balanceFromUnsafe()` | `udtBalanceFrom` is deprecated; `balanceFromUnsafe` is the replacement |
| Insufficient coin error | Custom `ErrorTransactionInsufficientCoin` | CCC's `ErrorUdtInsufficientCoin` | CCC throws it from `completeInputsByBalance`; has `amount`, `type`, `reason` fields |

**Key insight:** The entire `UdtManager` class (cell finding, balance calculation, input completion, change output) is replaced by CCC's `Udt` class. The only custom code needed is the `infoFrom` override for multi-representation balance.

## Common Pitfalls

### Pitfall 1: Receipt/Deposit Cells in Outputs
**What goes wrong:** `infoFrom` accidentally counts receipt or deposit cells in transaction outputs, breaking the conservation law.
**Why it happens:** `getOutputsInfo` also calls `infoFrom`. If `infoFrom` doesn't distinguish inputs from outputs, receipt/deposit cells could be double-counted.
**How to avoid:** Check for `cell.outPoint` existence. Input cells have `outPoint` (resolved by `CellInput.getCell()`). Output cells created by `Array.from(tx.outputCells)` do NOT have `outPoint`. Receipt and deposit cells should only appear as inputs, so checking `outPoint` naturally excludes them from output processing.
**Warning signs:** Balance reported by `getOutputsInfo` includes non-xUDT cell values.

### Pitfall 2: DaoManager.isDeposit Requires Full Cell
**What goes wrong:** `daoManager.isDeposit(cell)` called on a `CellAny` that hasn't been fully resolved.
**Why it happens:** `CellAny.from(cellLike)` preserves the `outPoint`, `cellOutput`, and `outputData` from the input. `isDeposit` checks `outputData` for the 8-zero-byte DAO deposit marker.
**How to avoid:** `isDeposit` only checks `outputData` format (8 zero bytes = deposit), not headers. It works on any `CellAny`-compatible object as long as `outputData` is present. The `CellAny.from()` factory preserves `outputData` from the `CellAnyLike`, so this works correctly. Verify by checking `DaoManager.isDeposit` signature accepts `CellAny` (or a compatible type).
**Warning signs:** `isDeposit` returns false for valid deposit cells because `outputData` is missing.

### Pitfall 3: ScriptDeps Interface Consumers After Deletion
**What goes wrong:** `ScriptDeps` interface deleted along with `UdtHandler`, breaking downstream imports.
**Why it happens:** `ScriptDeps` is used by `LogicManager`, `OwnedOwnerManager`, `OrderManager`, `DaoManager`, and `getConfig()` (SDK constants). It has many consumers beyond `UdtHandler`.
**How to avoid:** `ScriptDeps` MUST be preserved. Only `UdtHandler` extends it and is deleted. `ScriptDeps` remains in `@ickb/utils/utils.ts` and continues to be imported by all manager classes.
**Warning signs:** Compilation errors in packages importing `ScriptDeps`.

### Pitfall 4: Catalog Entry for @ckb-ccc/udt
**What goes wrong:** `pnpm install` fails because `@ckb-ccc/udt` is not in the catalog and `catalog:` specifier is used.
**Why it happens:** Currently only `@ckb-ccc/core` is in the pnpm-workspace.yaml catalog. The `.pnpmfile.cjs` hook rewires to `workspace:*` when the fork is present, but catalog: specifier needs a matching entry.
**How to avoid:** Either add `"@ckb-ccc/udt": "^1.12.2"` to the catalog in `pnpm-workspace.yaml`, OR use `"workspace:*"` directly in `@ickb/core/package.json`. The pnpmfile hook will rewrite either way when forks are present. Using `catalog:` is cleaner for consistency but requires the catalog entry.
**Warning signs:** `pnpm install` errors about unresolved catalog specifier.

### Pitfall 5: IckbUdt Constructor and ssri.Trait
**What goes wrong:** `IckbUdt` constructor doesn't properly call `super()` with the right arguments.
**Why it happens:** `Udt extends ssri.Trait`, and `Trait` expects `(code: OutPointLike, executor?: Executor)`. The `Udt` constructor is `(code: OutPointLike, script: ScriptLike, config?: UdtConfigLike)`. `IckbUdt` must pass `code` (xUDT OutPoint) and `script` (iCKB UDT type script) to `super()`, plus store `logicCode` and other iCKB-specific params.
**How to avoid:** Keep constructor simple: `super(code, script)` passes xUDT code OutPoint and iCKB type script to base `Udt`. No executor needed (legacy xUDT, not SSRI). Store `logicCode`, `logicScript`, `daoManager` as own properties.
**Warning signs:** `this.code` doesn't point to xUDT code cell; `this.script` doesn't match iCKB UDT type script.

## Code Examples

### IckbUdt addCellDeps Override
```typescript
// Source: Verified pattern from CCC Udt.addCellDeps (forks/ccc/packages/udt/src/udt/index.ts:856-863)
override addCellDeps(txLike: ccc.TransactionLike): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  // xUDT code dep (base class stores this as this.code from ssri.Trait)
  tx.addCellDeps({ outPoint: this.code, depType: "code" });
  // iCKB Logic code dep (new param)
  tx.addCellDeps({ outPoint: this.logicCode, depType: "code" });
  return tx;
}
```

### SDK getConfig Migration
```typescript
// Source: Current SDK constants.ts construction + planned migration

// NEW: xUDT and Logic code cell OutPoints (from forks/contracts/scripts/deployment/)
const MAINNET_XUDT_CODE = { txHash: "0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7", index: "0x0" };
const MAINNET_LOGIC_CODE = { txHash: "0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44", index: "0x0" };
const TESTNET_XUDT_CODE = { txHash: "0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f", index: "0x0" };
const TESTNET_LOGIC_CODE = { txHash: "0x9ac989b3355764f76cdce02c69dedb819fdfbcbda49a7db1a2c9facdfdb9a7fe", index: "0x0" };

// In getConfig():
const ickbUdt = new IckbUdt(
  d === "mainnet" ? MAINNET_XUDT_CODE : TESTNET_XUDT_CODE,  // xUDT code OutPoint
  IckbUdt.typeScriptFrom(                                      // iCKB UDT type script
    ccc.Script.from(UDT),
    ccc.Script.from(ICKB_LOGIC),
  ),
  d === "mainnet" ? MAINNET_LOGIC_CODE : TESTNET_LOGIC_CODE,  // Logic code OutPoint
  ccc.Script.from(ICKB_LOGIC),                                 // Logic script
  dao,                                                          // DaoManager
);
```

### Error Handling Migration in SDK
```typescript
// Source: CCC ErrorUdtInsufficientCoin (forks/ccc/packages/udt/src/udt/index.ts:27-83)

// BEFORE (old pattern):
import { ErrorTransactionInsufficientCoin } from "@ickb/utils";
try {
  // ...
} catch (e) {
  if (e instanceof ErrorTransactionInsufficientCoin) { ... }
}

// AFTER (CCC pattern):
import { ErrorUdtInsufficientCoin } from "@ckb-ccc/udt";
try {
  const { tx } = await ickbUdt.completeInputsByBalance(tx, signer);
} catch (e) {
  if (e instanceof ErrorUdtInsufficientCoin) {
    // e.amount: shortfall amount
    // e.type: UDT type script
    // e.message: "Insufficient coin, need {amount} extra coin"
  }
}
```

### LogicManager After udtHandler Removal
```typescript
// Source: Current logic.ts with modifications applied

export class LogicManager implements ScriptDeps {
  constructor(
    public readonly script: ccc.Script,
    public readonly cellDeps: ccc.CellDep[],
    public readonly daoManager: DaoManager,
    // udtHandler REMOVED
  ) {}

  async deposit(txLike, depositQuantity, depositAmount, lock, client) {
    let tx = ccc.Transaction.from(txLike);
    // ...
    tx.addCellDeps(this.cellDeps);
    // tx.addCellDeps(this.udtHandler.cellDeps);  // REMOVED
    // ...
  }

  completeDeposit(txLike, receipts) {
    const tx = ccc.Transaction.from(txLike);
    // ...
    tx.addCellDeps(this.cellDeps);
    // tx.addCellDeps(this.udtHandler.cellDeps);  // REMOVED
    // ...
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `UdtHandler` interface + `UdtManager` class | CCC `udt.Udt` class with `infoFrom` override | Phase 5 | Entire custom UDT infrastructure deleted |
| `ccc.udtBalanceFrom()` (deprecated) | `udt.Udt.balanceFromUnsafe()` | CCC upstream | Deprecated calls eliminated by deleting `UdtManager` |
| `ccc.ErrorTransactionInsufficientCoin` (deprecated) | `udt.ErrorUdtInsufficientCoin` | CCC upstream | New error class with `amount`, `type`, `reason` fields |
| `IckbUdtManager.getInputsUdtBalance()` | `IckbUdt.infoFrom()` (override) | Phase 5 | Single override point handles both inputs and outputs |
| Dep group `CellDep` for all iCKB scripts | Individual code OutPoints for IckbUdt | Phase 5 | xUDT + Logic code deps added individually |
| `IckbUdtManager.calculateScript()` | `IckbUdt.typeScriptFrom()` | Phase 5 | Static method renamed for CCC alignment |

**Deprecated/outdated:**
- `UdtHandler` interface: Replaced by CCC `udt.Udt` type
- `UdtManager` class: Replaced by CCC `udt.Udt` class (which has same capabilities + completion pipeline)
- `ErrorTransactionInsufficientCoin`: Replaced by `ErrorUdtInsufficientCoin` from `@ckb-ccc/udt`
- `UdtCell` interface, `findUdts`, `addUdts`, `isUdtSymbol`: All internal to `UdtManager`, no external consumers

## Detailed Code Analysis

### Files to Modify

| File | Changes | Lines Affected |
|------|---------|----------------|
| `packages/core/src/udt.ts` | Replace `IckbUdtManager` with `IckbUdt extends udt.Udt`; rename `calculateScript` to `typeScriptFrom` | ~100 lines (rewrite class, keep `ickbValue`, `convert`, `ickbExchangeRatio`, constants) |
| `packages/core/src/logic.ts` | Remove `udtHandler` constructor param; remove 2 `tx.addCellDeps(this.udtHandler.cellDeps)` calls; remove `UdtHandler` import | ~6 lines changed |
| `packages/core/src/owned_owner.ts` | Remove `udtHandler` constructor param; remove 2 `tx.addCellDeps(this.udtHandler.cellDeps)` calls; remove `UdtHandler` import | ~6 lines changed |
| `packages/core/package.json` | Add `@ckb-ccc/udt` dependency | 1 line |
| `packages/utils/src/udt.ts` | Delete entire file | ~406 lines deleted |
| `packages/utils/src/index.ts` | Remove `export * from "./udt.js"` | 1 line |
| `packages/sdk/src/constants.ts` | Rewrite `getConfig()` to construct `IckbUdt`; add code OutPoint constants; adjust `LogicManager`/`OwnedOwnerManager` construction (no `ickbUdt` arg); pass `ickbUdt.script` to `OrderManager` | ~30 lines |
| `packages/sdk/src/sdk.ts` | No changes needed -- SDK uses managers, not UdtHandler directly | 0 lines |

### ScriptDeps Consumer Audit

`ScriptDeps` is imported/used in these locations (MUST survive `UdtHandler` deletion):

| File | Usage | Status |
|------|-------|--------|
| `packages/utils/src/utils.ts` | Interface definition | Keep (canonical location) |
| `packages/core/src/logic.ts` | `LogicManager implements ScriptDeps` | Keep |
| `packages/core/src/owned_owner.ts` | `OwnedOwnerManager implements ScriptDeps` | Keep |
| `packages/order/src/order.ts` | `OrderManager implements ScriptDeps` | Keep |
| `packages/dao/src/dao.ts` | `DaoManager implements ScriptDeps` | Keep |
| `packages/sdk/src/constants.ts` | `getConfig()` param type | Keep |
| `packages/utils/src/udt.ts` | `UdtHandler extends ScriptDeps`, `UdtManager implements UdtHandler` | Deleted with file |

**Conclusion:** `ScriptDeps` has 6 consumers remaining after `UdtHandler`/`UdtManager` deletion. It MUST be preserved.

### ExchangeRatio Consumer Audit

`ExchangeRatio` from `@ickb/utils` is used in:
| File | Usage |
|------|-------|
| `packages/core/src/udt.ts` | `convert()` function parameter type |
| `packages/sdk/src/sdk.ts` | Imported from `@ickb/utils` (indirect via `@ickb/core`) |

**Conclusion:** `ExchangeRatio` stays in `@ickb/utils/utils.ts`. Not affected by udt.ts deletion.

### Catch Blocks for ErrorTransactionInsufficientCoin

Searched across all apps and packages:
- **`packages/`**: Only thrown in `packages/utils/src/udt.ts:258` (inside `UdtManager.completeUdt`). No catch blocks.
- **`apps/`**: No catch blocks referencing `ErrorTransactionInsufficientCoin`. Zero hits.
- **Conclusion:** Deleting the class has no impact on error handling. CCC's `ErrorUdtInsufficientCoin` (thrown by `completeInputsByBalance`) is the only error callers will encounter going forward.

### Code Cell OutPoints (from forks/contracts/scripts/deployment/)

| Network | Script | tx_hash | index |
|---------|--------|---------|-------|
| Mainnet | xUDT | `0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7` | 0 |
| Mainnet | iCKB Logic | `0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44` | 0 |
| Testnet | xUDT | `0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f` | 0 |
| Testnet | iCKB Logic | `0x9ac989b3355764f76cdce02c69dedb819fdfbcbda49a7db1a2c9facdfdb9a7fe` | 0 |

Source: `forks/contracts/scripts/deployment/mainnet/deployment.toml` and `forks/contracts/scripts/deployment/testnet/deployment.toml` (HIGH confidence -- direct file examination).

### CCC Udt.infoFrom Signature Details

```typescript
// From forks/ccc/packages/udt/src/udt/index.ts:624-641
async infoFrom(
  _client: ccc.Client,         // Client for network requests (subclasses use it)
  cells: ccc.CellAnyLike | ccc.CellAnyLike[],  // Single cell or array
  acc?: UdtInfoLike,           // Optional accumulator for running totals
): Promise<UdtInfo>
```

Key details:
- `_client` parameter: Base class doesn't use it (local-only operation), but it's available for subclass network requests (header fetches in IckbUdt)
- `cells` is flattened with `[cells].flat()` -- accepts single cell or array
- `acc` is optional starting accumulator; `UdtInfo.from(acc).clone()` creates a safe copy
- Returns `UdtInfo` with `{ balance, capacity, count }` fields (all mutable)
- `balance` can go negative (deposit cells subtract) -- this is intentional for conservation law accounting
- CCC's `completeInputsByBalance` uses `infoFrom` as the accumulator in `completeInputs`, checking `info.balance >= 0 && info.capacity >= 0` to stop

### CCC getInputsInfo Flow

```typescript
// From forks/ccc/packages/udt/src/udt/index.ts:1099-1108
async getInputsInfo(client, txLike): Promise<UdtInfo> {
  const tx = ccc.Transaction.from(txLike);
  const inputCells = await Promise.all(
    tx.inputs.map((input) => input.getCell(client)),  // Resolves to Cell (has outPoint)
  );
  return this.infoFrom(client, inputCells);  // Passes Cell[] to infoFrom
}
```

`CellInput.getCell(client)` returns a `Cell` (extends `CellAny`, has guaranteed `outPoint`). So when `infoFrom` is called from `getInputsInfo`, all cells have `outPoint`. When called from `getOutputsInfo`, cells come from `tx.outputCells` which creates `CellAny` without `outPoint`.

### DaoManager.isDeposit Compatibility

```typescript
// DaoManager.isDeposit checks cell.outputData for 8 zero bytes (DAO deposit marker)
// It accepts ccc.Cell which extends CellAny
// CellAny.from(cellLike) preserves outputData from CellAnyLike
// So passing CellAny to isDeposit works IF outputData has 8+ bytes
```

The `daoManager.isDeposit(cell)` call in `infoFrom` receives a `CellAny`. Need to verify `isDeposit` accepts `CellAny` (not just `Cell`). Checking the `DaoManager.isDeposit` signature:

```typescript
// From packages/dao/src/dao.ts (Phase 1 migrated signature)
isDeposit(cell: ccc.Cell): boolean
```

This takes `ccc.Cell`, not `ccc.CellAny`. Since `Cell extends CellAny`, a `CellAny` is NOT a `Cell`. However, for input cells in `infoFrom`, `getInputsInfo` resolves to `Cell` objects (via `CellInput.getCell()`), so this works for inputs. For output cells, we skip deposit detection (no `outPoint` check gates it). This is correct by design -- deposits only appear as inputs.

## Open Questions

1. **getConfig devnet path**
   - What we know: `getConfig()` accepts a devnet object with `ScriptDeps` for each script. Phase 5 changes IckbUdt construction from `ScriptDeps` (script + cellDeps) to code OutPoints.
   - What's unclear: The devnet path provides `{ udt: ScriptDeps, logic: ScriptDeps, ... }`. With `IckbUdt` needing code OutPoints instead of `CellDep[]`, the devnet interface needs adjustment. The `udt` entry would need to provide an OutPoint (for xUDT code cell) instead of `cellDeps`.
   - Recommendation: For devnet, accept either: (a) a new `codeOutPoint` field in each ScriptDeps-like config, or (b) restructure the devnet config type to match the new needs. Since devnet usage is secondary, keep it minimal -- document the interface change.

2. **pnpm-workspace.yaml catalog entry**
   - What we know: `@ckb-ccc/core` has `catalog:` entry; `@ckb-ccc/udt` does not.
   - What's unclear: Whether to add `@ckb-ccc/udt` to catalog or use `workspace:*` directly.
   - Recommendation: Add `"@ckb-ccc/udt": "^1.12.2"` to catalog alongside `@ckb-ccc/core` for consistency. The pnpmfile hook rewrites to `workspace:*` when forks are present.

## Sources

### Primary (HIGH confidence)
- CCC `Udt` class source: `/workspaces/stack/forks/ccc/packages/udt/src/udt/index.ts` -- `infoFrom`, `addCellDeps`, `completeInputsByBalance`, `getInputsInfo`, `getOutputsInfo` signatures and implementations verified
- CCC `ssri.Trait` source: `/workspaces/stack/forks/ccc/packages/ssri/src/trait.ts` -- constructor `(code: OutPointLike, executor?: Executor)` verified
- CCC `CellAny` class: `/workspaces/stack/forks/ccc/packages/core/src/ckb/transaction.ts:313-432` -- `outPoint` optional, `capacityFree` getter verified
- CCC `ErrorUdtInsufficientCoin`: `/workspaces/stack/forks/ccc/packages/udt/src/udt/index.ts:27-83` -- `amount`, `type`, `reason` fields verified
- Current `IckbUdtManager`: `/workspaces/stack/packages/core/src/udt.ts` -- full source examined
- Current `UdtManager`/`UdtHandler`: `/workspaces/stack/packages/utils/src/udt.ts` -- full source examined
- Current `LogicManager`: `/workspaces/stack/packages/core/src/logic.ts` -- `udtHandler` usage at 2 sites confirmed
- Current `OwnedOwnerManager`: `/workspaces/stack/packages/core/src/owned_owner.ts` -- `udtHandler` usage at 2 sites confirmed
- SDK `getConfig()`: `/workspaces/stack/packages/sdk/src/constants.ts` -- construction flow verified
- Contract deployments: `/workspaces/stack/forks/contracts/scripts/deployment/mainnet/deployment.toml` and testnet equivalent -- xUDT and Logic code cell OutPoints verified

### Secondary (MEDIUM confidence)
- Phase 3 decision document: `.planning/phases/03-ccc-udt-integration-investigation/03-DECISION.md` -- `infoFrom` as sole override point, cell discovery boundary
- Phase 4 context/execution: `.planning/phases/04-deprecated-ccc-api-replacement/` -- OrderManager pattern for udtHandler removal
- Project STATE.md accumulated decisions -- cross-referenced with source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified from local source code; `@ckb-ccc/udt` available via workspace
- Architecture: HIGH -- `infoFrom` override pattern verified from CCC source; all 4 `udtHandler` removal sites identified and confirmed
- Pitfalls: HIGH -- `outPoint` availability, `ScriptDeps` consumers, catalog entry all verified against source

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable -- all source code is local, no external API changes expected)
