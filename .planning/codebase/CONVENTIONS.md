# Coding Conventions

**Analysis Date:** 2026-02-17

## Important Context

**Legacy vs. New code:**
- `@ickb/lumos-utils@1.4.2` and `@ickb/v1-core@1.4.2` are **LEGACY and DEPRECATED** npm packages. The apps (`apps/bot`, `apps/tester`, `apps/interface`) still depend on them.
- The `packages/` directory contains the **NEW replacement libraries** built on CCC (ckb-ccc), which will eventually replace the legacy packages in the apps.
- All `@ckb-lumos/*` packages are **DEPRECATED** -- Lumos is being replaced by CCC.
- CCC PRs for UDT and Epochs have been **MERGED** upstream -- those features now exist in CCC itself.
- `SmartTransaction` was **ABANDONED** in favor of CCC's client cache for header caching. The class still exists in `packages/utils/src/transaction.ts` but should not be extended further.
- CCC is sometimes overridden locally via `ccc-dev/record.sh` and `.pnpmfile.cjs` for testing unpublished changes.

**When writing new code:** Use CCC (`@ckb-ccc/core`) types and patterns exclusively in `packages/`. Never introduce new Lumos dependencies.

## Naming Patterns

**Files:**
- Use `snake_case` for multi-word source files: `owned_owner.ts`
- Use single lowercase words when possible: `cells.ts`, `entities.ts`, `logic.ts`, `codec.ts`, `utils.ts`, `heap.ts`, `udt.ts`
- Every package has an `index.ts` barrel file that re-exports everything
- Config files at root use dot-prefix convention: `prettier.config.cjs`, `eslint.config.mjs`, `vitest.config.mts`

**Functions:**
- Use `camelCase` for all functions: `binarySearch`, `asyncBinarySearch`, `hexFrom`, `isHex`, `getHeader`
- Prefix boolean-returning functions with `is`: `isHex()`, `isDeposit()`, `isCapacity()`, `isReceipt()`, `isCkb2Udt()`, `isMatchable()`, `isFulfilled()`
- Use `tryFrom` for fallible constructors that return `undefined` on failure: `OrderCell.tryFrom()`, `OrderGroup.tryFrom()`
- Use `mustFrom` for throwing constructors: `OrderCell.mustFrom()`
- Use `from` for static factory methods: `Ratio.from()`, `Info.from()`, `Epoch.from()`, `MasterCell.from()`
- Use `validate()` for throwing validation and `isValid()` for boolean validation -- always as a pair

**Variables:**
- Use `camelCase` for variables and parameters: `ckbScale`, `udtScale`, `tipHeader`, `feeRate`
- Use `UPPER_SNAKE_CASE` for constants: `ICKB_SOFT_CAP_PER_DEPOSIT`, `ICKB_DEPOSIT_CAP`
- Prefix private module-level mutable state with underscore: `_knownHeaders`, `_knownTxsOutputs`

**Types/Interfaces:**
- Use `PascalCase` for types, interfaces, and classes: `Ratio`, `Info`, `OrderData`, `OrderCell`, `Epoch`
- Suffix data-transfer / input interfaces with `Like`: `InfoLike`, `RelativeLike`, `OrderDataLike`, `MasterLike`, `EpochLike`, `SmartTransactionLike`
- The `Like` type is the "encodable" or input representation; the plain name is the decoded/validated form
- Use `ValueComponents` interface for anything with `ckbValue` and `udtValue` properties

**Classes:**
- Use `PascalCase`: `MinHeap`, `BufferedGenerator`, `SmartTransaction`, `CapacityManager`, `UdtManager`, `DaoManager`, `LogicManager`, `OrderManager`, `OwnedOwnerManager`, `IckbSdk`
- Manager classes implement `ScriptDeps` interface and contain `script` and `cellDeps` properties
- Generic type parameters use single capital letters: `<T>`, `<K>`

## Code Style

**Formatting:**
- Prettier with `prettier-plugin-organize-imports`
- Double quotes (not single quotes): `singleQuote: false`
- Trailing commas everywhere: `trailingComma: "all"`
- Config: `prettier.config.cjs`
- Interface app additionally uses `prettier-plugin-tailwindcss` via `apps/interface/.prettierrc`

**Linting:**
- ESLint with `typescript-eslint` strict type-checked config
- Root config: `eslint.config.mjs`
- Interface has its own ESLint config: `apps/interface/eslint.config.mjs` (adds React plugins)
- Key enforced rule: `@typescript-eslint/explicit-function-return-type: "error"` -- every function must have an explicit return type annotation
- Strict type checking enabled (`tseslint.configs.strictTypeChecked`)

**TypeScript Compiler:**
- Root `tsconfig.json` targets `ES2020` with `NodeNext` module resolution
- `strict: true` with additional strict checks:
  - `noUnusedLocals: true`
  - `noUnusedParameters: true`
  - `noFallthroughCasesInSwitch: true`
  - `noUncheckedIndexedAccess: true`
  - `noImplicitOverride: true`
  - `noImplicitAny: true`
  - `noEmitOnError: true`
- `verbatimModuleSyntax: true` -- use `import type` for type-only imports
- `declaration: true`, `declarationMap: true`, `sourceMap: true`
- `removeComments: true`, `stripInternal: true` -- comments stripped from output, `@internal` members excluded from .d.ts
- Required Node.js version: `>=24`

## Import Organization

**Order (enforced by `prettier-plugin-organize-imports`):**
1. External dependencies (`@ckb-ccc/core`, `@ckb-lumos/*`, `crypto`, `process`)
2. Internal workspace packages (`@ickb/utils`, `@ickb/core`, `@ickb/dao`, `@ickb/order`)
3. Relative imports (`./entities.js`, `./cells.js`, `./utils.js`)

**Style:**
- Always use `.js` extension in relative imports (required by `NodeNext` resolution): `import { gcd } from "./utils.js";`
- Use `import type` for type-only imports: `import type { UdtHandler } from "./udt.js";`
- Mixed imports combine values and types: `import { unique, type ValueComponents } from "./utils.js";`
- Destructure imports at the top: `import { ccc, mol } from "@ckb-ccc/core";`
- Named exports only -- no default exports anywhere in the codebase

**Path Aliases:**
- None. All imports use bare specifiers for packages and relative paths within packages.

## Error Handling

**Patterns:**

1. **Throw `Error` directly** -- never custom error classes except `ErrorTransactionInsufficientCoin` in `packages/utils/src/udt.ts`:
```typescript
throw Error("Ratio invalid: not empty, not populated");
throw Error("iCKB deposit minimum is 1082 CKB");
throw Error("Header not found");
```

2. **validate() / isValid() pair** -- consistent throughout the codebase. Use this pair on all domain entities:
```typescript
validate(): void {
  if (/* invalid condition */) {
    throw Error("Description of what is wrong");
  }
}

isValid(): boolean {
  try {
    this.validate();
    return true;
  } catch {
    return false;
  }
}
```
This pattern appears in: `Ratio` (`packages/order/src/entities.ts`), `Info` (same file), `Relative` (same file), `OrderData` (same file), `OrderCell` (`packages/order/src/cells.ts`), `OrderGroup` (same file), `MasterCell` (same file)

3. **tryFrom / mustFrom factory pair** for parsing from raw blockchain data:
```typescript
// packages/order/src/cells.ts
static tryFrom(cell: ccc.Cell): OrderCell | undefined {
  try {
    return OrderCell.mustFrom(cell);
  } catch {
    return undefined;
  }
}

static mustFrom(cell: ccc.Cell): OrderCell {
  const data = OrderData.decode(cell.outputData);
  data.validate();
  // ... construct and return
}
```

4. **Env var validation at app entry** -- check and throw immediately:
```typescript
// apps/bot/src/index.ts, apps/tester/src/index.ts
if (!CHAIN) {
  throw Error("Invalid env CHAIN: Empty");
}
if (!isChain(CHAIN)) {
  throw Error("Invalid env CHAIN: " + CHAIN);
}
```

5. **Async error handling in app loops** -- catch, log structured JSON, continue:
```typescript
// apps/bot/src/index.ts, apps/tester/src/index.ts, apps/faucet/src/index.ts
try {
  // ... main logic
} catch (e) {
  if (e instanceof Object && "stack" in e) {
    /* eslint-disable-next-line @typescript-eslint/no-misused-spread */
    executionLog.error = { ...e, stack: e.stack ?? "" };
  } else {
    executionLog.error = e ?? "Empty Error";
  }
}
console.log(JSON.stringify(executionLog, replacer, " "));
```

## Logging

**Framework:** `console` only -- no logging framework.

**Patterns:**
- Apps log structured JSON via `console.log(JSON.stringify(executionLog, replacer, " "))` where `replacer` converts `bigint` to `number`
- The sampler app (`apps/sampler/src/index.ts`) logs CSV output directly
- Library packages (`packages/*`) do not log -- they only throw errors

**BigInt serialization helper** used in apps:
```typescript
function replacer(_: unknown, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}
```

## Comments

**When to Comment:**
- Use JSDoc (`/** ... */`) for all public functions, methods, classes, and interfaces in `packages/`
- Include `@param`, `@returns`, `@throws`, `@example`, `@remarks` tags as appropriate
- Use `@internal` tag for functions that should be excluded from generated declarations
- Use `@credits` for code ported from other languages (Go standard library translations in `packages/utils/src/utils.ts`, `packages/utils/src/heap.ts`)
- Use `@link` for referencing external resources
- Inline comments (`//`) explain non-obvious logic like bit operations or mathematical formulas
- The sampler app uses `@packageDocumentation` at the module level

**TypeDoc / Documentation:**
- TypeDoc generates API documentation from JSDoc, configured via `typedoc.base.json`
- Sort order: `source-order, alphabetical, kind`
- Source links point to GitHub master branch
- Each package has its own `typedoc.json` extending the base

**eslint-disable comments** are used sparingly for known-safe patterns:
```typescript
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
/* eslint-disable-next-line @typescript-eslint/no-misused-spread */
/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
```

## Function Design

**Size:** Functions are generally compact (under 50 lines). Longer functions exist in the apps for transaction orchestration but are organized into clear named sub-functions.

**Parameters:**
- Use object destructuring for multi-field inputs: `{ ckbScale, udtScale }`, `{ cell, data, ckbUnoccupied, ... }`
- Use `options?` objects for optional parameters with defaults:
```typescript
// packages/dao/src/dao.ts
async *findDeposits(
  client: ccc.Client,
  locks: ccc.Script[],
  options?: {
    tip?: ccc.ClientBlockHeader;
    onChain?: boolean;
    minLockUp?: Epoch;
    maxLockUp?: Epoch;
    limit?: number;
  },
): AsyncGenerator<DaoCell> { ... }
```
- Use variadic args with flat support: `addUdtHandlers(...udtHandlers: (UdtHandler | UdtHandler[])[])`

**Return Values:**
- Use tuples for multi-value returns: `Promise<[number, boolean]>`, `[ccc.FixedPoint, ccc.FixedPoint]`
- Use `| undefined` instead of `null` for missing values: `OrderCell | undefined`
- Use explicit `void` return for side-effect-only functions
- All return types must be explicit (enforced by ESLint)

## Module Design

**Exports:**
- Every package uses barrel exports via `index.ts`: `export * from "./cells.js";`
- All exports are named, never default
- Type-only exports use `export type` in conjunction with `verbatimModuleSyntax`

**Barrel Files:**
- Located at `packages/*/src/index.ts`
- Re-export everything from each source module
- No logic in barrel files
- Example (`packages/utils/src/index.ts`):
```typescript
export * from "./codec.js";
export * from "./capacity.js";
export * from "./epoch.js";
export * from "./heap.js";
export * from "./transaction.js";
export * from "./udt.js";
export * from "./utils.js";
```

**Package structure (identical for all `packages/*`):**
- `src/index.ts` - barrel exports
- `src/*.ts` - source files
- `package.json` - with `"type": "module"`, `"sideEffects": false`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`
- `tsconfig.json` - extends root `../../tsconfig.json`, sets `rootDir: "src"`, `outDir: "dist"`
- `vitest.config.mts` - test configuration (includes `src/**/*.test.ts`)

## Molecule / Codec Patterns

**TS codecs must match the Molecule schema** at `contracts/schemas/encoding.mol`. The on-chain contracts use Molecule for serialization; the TS packages must produce byte-identical encodings.

**Entity classes** use CCC's `ccc.Entity.Base` with decorator-based codec definition:
```typescript
// packages/order/src/entities.ts
@ccc.codec(
  mol.struct({
    ckbScale: mol.Uint64,
    udtScale: mol.Uint64,
  }),
)
export class Ratio extends ccc.Entity.Base<ExchangeRatio, Ratio>() {
  constructor(
    public ckbScale: ccc.Num,
    public udtScale: ccc.Num,
  ) {
    super();
  }

  static override from(ratio: ExchangeRatio): Ratio {
    if (ratio instanceof Ratio) {
      return ratio;
    }
    const { ckbScale, udtScale } = ratio;
    return new Ratio(ckbScale, udtScale);
  }
}
```

Key conventions for entity classes:
- Two generic parameters: `<LikeType, SelfType>`
- Constructor takes decoded/validated fields with `public` modifier
- Static `from()` method overrides base, short-circuits on `instanceof` check
- `validate()` and `isValid()` pair for validation
- Static helper constructors: `Ratio.empty()`, `Info.create()`

## BigInt Usage

- Use `bigint` for all blockchain numeric values (capacity, amounts, block numbers, epochs)
- Use `0n` for zero, `1n` for one
- Use `ccc.Num` (alias for `bigint`) and `ccc.FixedPoint` (alias for `bigint`) for type clarity
- Bit operations on bigints: `1n << BigInt(this.ckbMinMatchLog)`, `n >> 1`
- Use `Number()` only when interfacing with JS APIs that require it
- Formatting for display: `ccc.fixedPointToString()` or custom `fmtCkb()` in apps

## Immutability Patterns

- Use `Object.freeze()` extensively for shared data:
```typescript
// apps/bot/src/index.ts
const frozenResult = Object.freeze(result);
Object.freeze(tx.outputs.map(...));
let origins: readonly I8Cell[] = Object.freeze([]);
```
- Use `readonly` on class fields and interface members where appropriate
- Use `Readonly<T>` wrapper type for maps and objects: `Readonly<Map<string, readonly Cell[]>>`

## Async Generator Pattern

Finder methods throughout the library use `async *` generators for lazy iteration:
```typescript
// packages/utils/src/capacity.ts
async *findCapacities(
  client: ccc.Client,
  locks: ccc.Script[],
  options?: { onChain?: boolean; limit?: number },
): AsyncGenerator<CapacityCell> {
  const limit = options?.limit ?? defaultFindCellsLimit;
  for (const lock of unique(locks)) {
    // ... RPC query setup ...
    for await (const cell of client.findCells(...findCellsArgs)) {
      if (!this.isCapacity(cell) || !cell.cellOutput.lock.eq(lock)) {
        continue;
      }
      yield { cell, ckbValue: cell.cellOutput.capacity, udtValue: 0n, [isCapacitySymbol]: true };
    }
  }
}
```

To collect results into an array, use the `collect()` helper from `packages/utils/src/utils.ts`:
```typescript
const capacities = await collect(capacityManager.findCapacities(client, locks));
```

## App Entry Points

- Apps use top-level `await` at the end of the module:
```typescript
// apps/sampler/src/index.ts
await main();
process.exit(0);
```
- Legacy apps (`apps/bot`, `apps/tester`) use `for (;;)` infinite loops with sleep
- New apps (`apps/faucet`, `apps/sampler`) also use `for (;;)` or run-once patterns
- All apps are ESM (`"type": "module"` in package.json)
- Build command for all: `tsc` (compile only, no bundler except for `apps/interface` which uses Vite)

---

*Convention analysis: 2026-02-17*
