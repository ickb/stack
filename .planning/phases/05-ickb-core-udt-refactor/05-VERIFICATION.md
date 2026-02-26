---
phase: 05-ickb-core-udt-refactor
verified: 2026-02-26T17:00:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
---

# Phase 5: @ickb/core UDT Refactor Verification Report

**Phase Goal:** Implement `IckbUdt extends udt.Udt` in `@ickb/core`, replacing `IckbUdtManager`. Delete entire UDT infrastructure from `@ickb/utils`. Wire SDK to construct `IckbUdt`.
**Verified:** 2026-02-26T17:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `IckbUdt extends udt.Udt` exists in `@ickb/core` with `infoFrom` override | VERIFIED | `packages/core/src/udt.ts` line 20: `export class IckbUdt extends udt.Udt`, line 84: `override async infoFrom` |
| 2  | `infoFrom` correctly values xUDT cells (positive), receipt cells (positive, input only), deposit cells (negative, input only) | VERIFIED | xUDT: `udt.Udt.balanceFromUnsafe` (line 97); receipt: `ickbValue(depositAmount, ...) * depositQuantity` (lines 124-128); deposit: `-ickbValue(cell.capacityFree, ...)` (lines 146-149); output cells gated by `!cell.outPoint` check (line 106) |
| 3  | `IckbUdt.addCellDeps` overridden to add individual code deps | VERIFIED | `packages/core/src/udt.ts` line 168: `override addCellDeps`; adds xUDT code dep (line 171) and Logic code dep (line 173) with `depType: "code"` |
| 4  | `IckbUdt.typeScriptFrom` static method computes iCKB UDT type script | VERIFIED | `packages/core/src/udt.ts` line 57: `static typeScriptFrom(udt: ccc.Script, ickbLogic: ccc.Script): ccc.Script` |
| 5  | `LogicManager` and `OwnedOwnerManager` no longer take `udtHandler` parameter; no `tx.addCellDeps(this.udtHandler.cellDeps)` calls remain | VERIFIED | `logic.ts` constructor has 3 params (script, cellDeps, daoManager); `owned_owner.ts` constructor has 3 params; grep confirms zero `udtHandler` references across both files |
| 6  | `UdtHandler`, `UdtManager`, `ErrorTransactionInsufficientCoin`, `UdtCell`, `findUdts`, `addUdts`, `isUdtSymbol` deleted from `@ickb/utils` | VERIFIED | `packages/utils/src/udt.ts` deleted; `packages/utils/src/index.ts` has no `udt.js` export; grep across all packages confirms zero references |
| 7  | SDK constructs `IckbUdt` with individual code OutPoints; passes `ickbUdt.script` to `OrderManager` | VERIFIED | `packages/sdk/src/constants.ts` line 3: `import { IckbUdt, ... }`, line 63: `new IckbUdt(...)` with `MAINNET_XUDT_CODE`/`TESTNET_XUDT_CODE` and `MAINNET_LOGIC_CODE`/`TESTNET_LOGIC_CODE`; line 86: `OrderManager(d.order.script, d.order.cellDeps, ickbUdt.script)` |
| 8  | `pnpm check:full` passes | VERIFIED | Exit code 0; all 5 library packages lint, build, and test clean |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/udt.ts` | IckbUdt class extending udt.Udt with infoFrom, addCellDeps, typeScriptFrom | VERIFIED | 249 lines; `class IckbUdt extends udt.Udt` at line 20; all three overrides present |
| `packages/core/src/logic.ts` | LogicManager without udtHandler parameter | VERIFIED | Constructor at line 28-32: 3 params only; zero `udtHandler` references |
| `packages/core/src/owned_owner.ts` | OwnedOwnerManager without udtHandler parameter | VERIFIED | Constructor at line 23-27: 3 params only; zero `udtHandler` references |
| `packages/core/package.json` | `@ckb-ccc/udt` dependency | VERIFIED | Line 57: `"@ckb-ccc/udt": "catalog:"` |
| `pnpm-workspace.yaml` | Catalog entry for `@ckb-ccc/udt` | VERIFIED | Line 16: `"@ckb-ccc/udt": ^1.12.2` |
| `packages/utils/src/udt.ts` | Deleted | VERIFIED | File does not exist; confirmed by `test -f` returning false |
| `packages/utils/src/index.ts` | Barrel export without `udt.js` | VERIFIED | 3 lines only: codec.js, heap.js, utils.js |
| `packages/sdk/src/constants.ts` | `getConfig()` constructing `IckbUdt` with code OutPoints | VERIFIED | `new IckbUdt(` at line 63; `IckbUdt.typeScriptFrom` at line 69; 4 code OutPoint constants added (lines 168-202) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/core/src/udt.ts` | `@ckb-ccc/udt` | `import { udt } from '@ckb-ccc/udt'` | WIRED | Line 2: exact import; `udt.Udt`, `udt.UdtInfo`, `udt.UdtInfoLike` all used |
| `packages/core/src/udt.ts` | `packages/core/src/entities.ts` | `ReceiptData.decode` for receipt cell valuation | WIRED | Line 3: `import { ReceiptData }`, line 122: `ReceiptData.decode(cell.outputData)` |
| `packages/core/src/udt.ts` | `@ickb/dao` | `daoManager.isDeposit` for deposit cell identification | WIRED | Line 4: `import type { DaoManager }`, line 137: `this.daoManager.isDeposit(cell as ccc.Cell)` |
| `packages/sdk/src/constants.ts` | `packages/core/src/udt.ts` | `import { IckbUdt }` and constructor call | WIRED | Line 2: `import { IckbUdt, ... } from "@ickb/core"`, line 63: `new IckbUdt(...)` |
| `packages/sdk/src/constants.ts` | `packages/core/src/udt.ts` | `IckbUdt.typeScriptFrom` for script computation | WIRED | Line 69: `IckbUdt.typeScriptFrom(ccc.Script.from(d.udt.script), ccc.Script.from(d.logic.script))` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SMTX-05 | 05-01, 05-02 | UDT handler registration replaced by direct Udt instance usage | SATISFIED | LogicManager/OwnedOwnerManager no longer take `udtHandler`; UdtHandler/UdtManager/etc deleted from utils; SDK uses `IckbUdt` instance |
| SMTX-07 | 05-01, 05-02 | IckbUdtManager multi-representation UDT balance logic survives intact | SATISFIED | `IckbUdt.infoFrom` handles xUDT (positive), receipts (positive via `ickbValue`), deposits (negative via `ickbValue`); conservation law encoded in sign conventions |
| SMTX-10 | 05-01, 05-02 | Deprecated CCC API calls replaced | SATISFIED | grep confirms zero `udtBalanceFrom`, `getInputsUdtBalance`, `getOutputsUdtBalance`, `completeInputsByUdt` across all packages |
| UDT-04 | 05-01, 05-02 | `IckbUdt extends udt.Udt` with infoFrom, addCellDeps, typeScriptFrom; managers cleaned | SATISFIED | Full implementation verified; `typeScriptFrom` replaces `calculateScript`; all 4 manager `udtHandler.cellDeps` call sites removed |

All 4 requirements from plan frontmatter are satisfied. No orphaned requirements found (no additional Phase 5 requirements in REQUIREMENTS.md traceability table beyond those declared).

### Anti-Patterns Found

No anti-patterns detected in modified files:
- No TODO/FIXME/HACK/PLACEHOLDER comments
- No empty return stubs (`return null`, `return {}`, etc.)
- No console-only handlers
- All method overrides have substantive implementations

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No issues found |

### Human Verification Required

None required. All success criteria are verifiable through static code analysis and `pnpm check:full`.

The following items are noted as runtime-only and untestable without a live CKB node, but they are architectural/wiring correct:

1. **`infoFrom` header fetch correctness** — The `client.getTransactionWithHeader(cell.outPoint.txHash)` calls fetch headers correctly only when connected to a real CKB RPC. Static analysis confirms the call pattern matches Phase 1's established pattern (replacing `getHeader()`). No human action needed for phase acceptance; this is a runtime concern for Phase 6/7.

### Gaps Summary

No gaps found. All 8 observable truths are verified. The phase goal is fully achieved:

- `IckbUdt extends udt.Udt` is implemented with a substantive `infoFrom` override that handles all three iCKB cell representations
- `addCellDeps` adds individual code deps (not dep group) as specified
- `typeScriptFrom` static method correctly computes the UDT type script
- All `udtHandler` references removed from `LogicManager` and `OwnedOwnerManager`
- The entire UDT infrastructure (`UdtHandler`, `UdtManager`, `ErrorTransactionInsufficientCoin`, `UdtCell`, `findUdts`, `addUdts`, `isUdtSymbol`) is deleted from `@ickb/utils`
- SDK wiring is complete: `IckbUdt` constructed with correct code OutPoints for mainnet and testnet; `IckbUdt.typeScriptFrom` used for script computation; `LogicManager` and `OwnedOwnerManager` constructed without `ickbUdt`
- `pnpm check:full` passes with exit code 0 (both `check:fresh` and `check:ci` stages)

---

_Verified: 2026-02-26T17:00:00Z_
_Verifier: AI Coworker (gsd-verifier)_
